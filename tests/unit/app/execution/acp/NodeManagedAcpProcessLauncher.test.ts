import { PassThrough } from 'node:stream';

import {
  type ManagedAcpProcessAdapter,
  NodeManagedAcpProcessLauncher,
} from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import type {
  LocalShellLaunchSpec,
  LocalShellTerminationTarget,
} from '@/core/execution/local/LocalShellBackend';

describe('NodeManagedAcpProcessLauncher', () => {
  it.each([
    ['darwin' as const, 'posix-process-group'],
    ['linux' as const, 'posix-process-group'],
    ['win32' as const, 'windows-process-tree'],
  ] as const)('owns ACP stdio and the full process tree on %s', async (platform, terminationKind) => {
    const adapter = new FakeProcessAdapter(terminationKind);
    const launcher = new NodeManagedAcpProcessLauncher(
      {
        resolve: async () => ({
          executable: platform === 'win32' ? 'C:\\Tools\\opencode.exe' : '/opt/opencode',
          arguments: ['acp'],
          cwd: platform === 'win32' ? 'C:\\Vault' : '/vault',
          environment: { TOKEN: 'ephemeral' },
        }),
      },
      adapter,
      { wait: async () => undefined },
      platform,
    );

    const process = await launcher.launch('opaque-startup', new AbortController().signal);

    expect(adapter.specs).toEqual([expect.objectContaining({
      arguments: ['acp'],
      stdin: 'pipe',
      terminationKind,
    })]);
    expect(process.input).toBe(adapter.stdout);
    expect(process.output).toBe(adapter.stdin);
    await expect(process.terminate()).resolves.toBe('confirmed');
  });

  it('escalates graceful to forced termination and reports uncertainty honestly', async () => {
    const adapter = new FakeProcessAdapter('posix-process-group');
    adapter.confirmations = [false, false, false];
    adapter.terminations = ['unconfirmed', 'unconfirmed'];
    const waits: number[] = [];
    const launcher = new NodeManagedAcpProcessLauncher(
      {
        resolve: async () => ({
          executable: '/opt/opencode',
          arguments: ['acp'],
          cwd: '/vault',
          environment: {},
        }),
      },
      adapter,
      { wait: async delayMs => { waits.push(delayMs); } },
      'linux',
      10,
      20,
    );
    const process = await launcher.launch('opaque-startup', new AbortController().signal);

    await expect(process.terminate()).resolves.toBe('unconfirmed');
    expect(adapter.terminationModes).toEqual(['graceful', 'forced']);
    expect(waits).toEqual([10, 20]);
  });

  it('does not spawn when opaque startup resolution is aborted', async () => {
    const resolution = deferred<never>();
    const adapter = new FakeProcessAdapter('posix-process-group');
    const launcher = new NodeManagedAcpProcessLauncher(
      { resolve: () => resolution.promise },
      adapter,
      { wait: async () => undefined },
      'linux',
    );
    const abort = new AbortController();
    const launch = launcher.launch('opaque-startup', abort.signal);
    abort.abort(new Error('startup aborted'));

    await expect(launch).rejects.toThrow('startup aborted');
    expect(adapter.specs).toHaveLength(0);
  });

  it('retains an unconfirmed process and retries ownership cleanup on launcher disposal', async () => {
    const adapter = new FakeProcessAdapter('posix-process-group');
    adapter.confirmations = [false, false, false, true];
    adapter.terminations = ['unconfirmed', 'unconfirmed'];
    const launcher = new NodeManagedAcpProcessLauncher(
      {
        resolve: async () => ({
          executable: '/opt/opencode',
          arguments: ['acp'],
          cwd: '/vault',
          environment: {},
        }),
      },
      adapter,
      { wait: async () => undefined },
      'linux',
    );
    const process = await launcher.launch('opaque-startup', new AbortController().signal);

    await expect(process.terminate()).resolves.toBe('unconfirmed');
    await expect(launcher.dispose()).resolves.toBe('confirmed');
    await expect(launcher.launch('another-startup', new AbortController().signal))
      .rejects.toThrow('disposing');
    expect(adapter.specs).toHaveLength(1);
  });

  it('keeps owned stdio failures observed as process connection loss', async () => {
    const adapter = new FakeProcessAdapter('posix-process-group');
    const launcher = new NodeManagedAcpProcessLauncher(
      {
        resolve: async () => ({
          executable: '/opt/opencode',
          arguments: ['acp'],
          cwd: '/vault',
          environment: {},
        }),
      },
      adapter,
      { wait: async () => undefined },
      'linux',
    );
    const process = await launcher.launch('opaque-startup', new AbortController().signal);
    const closed = new Promise<Error | undefined>(resolve => process.onClose(resolve));

    adapter.stdin.emit('error', new Error('stdin EPIPE'));

    await expect(closed).resolves.toEqual(new Error('stdin EPIPE'));
    await expect(process.terminate()).resolves.toBe('confirmed');
  });
});

  it('says what to do about a CLI that is not on the path', async () => {
    const adapter = new FakeProcessAdapter('posix-process-group');
    const spawnFailure: NodeJS.ErrnoException = new Error('spawn grok ENOENT');
    spawnFailure.code = 'ENOENT';
    adapter.startFailure = spawnFailure;
    const launcher = new NodeManagedAcpProcessLauncher(
      { resolve: async () => ({
        executable: 'grok',
        arguments: ['agent', 'stdio'],
        // A directory that exists, because "the working directory is gone" is
        // the other thing an ENOENT means and has its own wording.
        cwd: process.cwd(),
        environment: {},
      }) },
      adapter,
      { wait: async () => undefined },
      'linux',
    );

    // The raw ENOENT reads as a transport failure, and the kernel then renders
    // it as the provider's resume hint — which tells the user to start a new
    // chat about a CLI that is not installed where Grimoire looked.
    await expect(launcher.launch('opaque-startup', new AbortController().signal))
      .rejects.toThrow(/command not found[\s\S]*absolute CLI path/);
  });

  it('keeps the last of what the process printed before it failed', async () => {
    const adapter = new FakeProcessAdapter('posix-process-group', { keepStderrOpen: true });
    const launcher = new NodeManagedAcpProcessLauncher(
      { resolve: async () => ({
        executable: 'grok',
        arguments: ['agent', 'stdio'],
        cwd: '/vault',
        environment: {},
      }) },
      adapter,
      { wait: async () => undefined },
      'linux',
    );
    const owned = await launcher.launch('opaque-startup', new AbortController().signal);
    const closed = new Promise<Error | undefined>(resolve => owned.onClose(resolve));

    adapter.stderr.write('error: cannot find module "@x/agent"\n');
    adapter.exit({ code: 1 });

    // Drained and discarded, the only thing left was "exited with code 1" —
    // which says nothing about why. Bounded, because a CLI that prints for an
    // hour must not be kept in memory.
    await expect(closed).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining('cannot find module') }),
    );
  });

class FakeProcessAdapter implements ManagedAcpProcessAdapter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly specs: LocalShellLaunchSpec[] = [];
  confirmations: boolean[] = [false];
  terminations: Array<'confirmed' | 'unconfirmed'> = ['confirmed'];
  readonly terminationModes: Array<'graceful' | 'forced'> = [];
  startFailure?: Error;
  private settleExit?: (exit: { code: number | null; signal?: string | null }) => void;

  constructor(
    private readonly kind: LocalShellTerminationTarget['kind'],
    options: { keepStderrOpen?: boolean } = {},
  ) {
    if (!options.keepStderrOpen) {
      this.stderr.end();
    }
  }

  exit(exit: { code: number | null; signal?: string | null }): void {
    this.settleExit?.(exit);
  }

  launch(spec: LocalShellLaunchSpec) {
    this.specs.push(spec);
    return {
      termination: this.kind === 'windows-process-tree'
        ? { kind: this.kind, pid: 42, ownershipId: 'job-1' }
        : { kind: this.kind, pid: 42 },
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
      stdoutReadable: this.stdout,
      stderrReadable: this.stderr,
      started: this.startFailure ? Promise.reject(this.startFailure) : Promise.resolve(),
      exited: new Promise<{ code: number | null; signal?: string | null }>(resolve => {
        this.settleExit = resolve;
      }),
    };
  }

  async confirmTerminated(): Promise<boolean> {
    return this.confirmations.shift() ?? false;
  }

  async terminate(
    _target: LocalShellTerminationTarget,
    mode: 'graceful' | 'forced',
  ): Promise<'confirmed' | 'unconfirmed'> {
    this.terminationModes.push(mode);
    return this.terminations.shift() ?? 'unconfirmed';
  }
}

function deferred<T>() {
  const promise = new Promise<T>(() => undefined);
  return { promise };
}
