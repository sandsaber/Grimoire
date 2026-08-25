import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { LocalShellExecution } from '@/app/execution/local/LocalShellExecution';
import type {
  LocalShellChildProcess,
  LocalShellExit,
  LocalShellLaunchSpec,
  LocalShellProcessLauncher,
  LocalShellProcessSupervisor,
  LocalShellTerminationTarget,
} from '@/core/execution/local/LocalShellBackend';

/**
 * Bang-bash mode, as a run on the kernel.
 *
 * It used to spawn its own child process from inside the chat feature, which
 * is why the composition-boundary gate carried an exemption for that file and
 * why a command still running at unload had nobody to stop it. These are the
 * behaviours the deleted `BangBashService` was tested for, asserted against
 * the path that replaced it.
 */
describe('local shell execution', () => {
  interface FakeProcess {
    /** Raw bytes when a test needs to split a character across two reads. */
    stdoutBytes?: Uint8Array[];
    stdout: string[];
    stderr: string[];
    exit: LocalShellExit;
    /** Never exits on its own; the run has to end another way. */
    hangs?: boolean;
  }

  class FakeProcesses implements LocalShellProcessLauncher, LocalShellProcessSupervisor {
    readonly launched: LocalShellLaunchSpec[] = [];
    terminated = false;

    constructor(private readonly next: () => FakeProcess) {}

    launch(spec: LocalShellLaunchSpec): LocalShellChildProcess {
      this.launched.push(spec);
      const script = this.next();
      const termination: LocalShellTerminationTarget = { pid: 4321, kind: 'posix-process-group' };
      return {
        termination,
        started: Promise.resolve(),
        stdout: script.stdoutBytes
          ? toByteStream(script.stdoutBytes)
          : toStream(script.stdout),
        stderr: toStream(script.stderr),
        exited: script.hangs
          ? new Promise<LocalShellExit>(() => {})
          : Promise.resolve(script.exit),
      };
    }

    async confirmTerminated(): Promise<boolean> {
      return this.terminated;
    }

    async terminate(): Promise<'confirmed' | 'unconfirmed'> {
      this.terminated = true;
      return 'confirmed';
    }
  }

  /** A scheduler the test fires by hand, so a timeout needs no fake clock. */
  class TestScheduler {
    private readonly pending = new Map<number, () => void>();
    private next = 1;

    setTimeout(callback: () => void): unknown {
      const handle = this.next++;
      this.pending.set(handle, callback);
      return handle;
    }

    clearTimeout(handle: unknown): void {
      this.pending.delete(handle as number);
    }

    fireAll(): void {
      const callbacks = [...this.pending.values()];
      this.pending.clear();
      for (const callback of callbacks) {
        callback();
      }
    }
  }

  function toByteStream(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    };
  }

  function toStream(chunks: string[]): AsyncIterable<Uint8Array> {
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield new TextEncoder().encode(chunk);
        }
      },
    };
  }

  async function createShell(script: FakeProcess | FakeProcess[]): Promise<{
    shell: LocalShellExecution;
    processes: FakeProcesses;
    scheduler: TestScheduler;
  }> {
    const scheduler = new TestScheduler();
    const scripts = Array.isArray(script) ? [...script] : [script];
    const processes = new FakeProcesses(() => scripts.shift() ?? scripts[0] ?? {
      stdout: [], stderr: [], exit: { code: 0 },
    });
    const host = new ExecutionKernelHost({ storage: new TestDurableStorage() });
    const shell = new LocalShellExecution(host.registry, {
      platform: 'posix',
      processes,
      scheduler,
    });
    host.registerBackend({ backend: shell.createBackend() });
    // The gate the host opens at plugin load; nothing is admitted before it.
    await host.start();
    return { shell, processes, scheduler };
  }

  /** Waits for the backend to actually reach its launcher. */
  async function waitForLaunch(processes: FakeProcesses): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (processes.launched.length > 0) {
        // One more turn, so the timeout the run arms after launching is set.
        await new Promise(resolve => setTimeout(resolve, 0));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    throw new Error('The command never reached the launcher.');
  }

  it('returns what a clean command printed', async () => {
    const { shell } = await createShell({ stdout: ['tomatoes\n'], stderr: [], exit: { code: 0 } });

    await expect(shell.run({ command: 'echo tomatoes' })).resolves.toEqual({
      stdout: 'tomatoes\n',
      stderr: '',
      failed: false,
    });
  });

  it('captures stdout and stderr together', async () => {
    const { shell } = await createShell({
      stdout: ['out-a', 'out-b'],
      stderr: ['err'],
      exit: { code: 0 },
    });

    await expect(shell.run({ command: 'both' })).resolves.toMatchObject({
      stdout: 'out-aout-b',
      stderr: 'err',
    });
  });

  it('joins a character the process wrote across two reads', async () => {
    // A pipe splits wherever it likes. Decoding each chunk on its own turns one
    // arrow into two replacement characters, and there is no output long enough
    // in these tests for that to happen by accident.
    const { shell } = await createShell({
      stdout: [],
      stdoutBytes: [new Uint8Array([0xe2]), new Uint8Array([0x86, 0x92])],
      stderr: [],
      exit: { code: 0 },
    });

    await expect(shell.run({ command: 'echo arrow' })).resolves.toMatchObject({
      stdout: '→',
    });
  });

  it('reports a non-zero exit as a failure and adds no message of its own', async () => {
    // The command already explained itself on stderr; a Grimoire sentence here
    // would sit in front of the shell's.
    const { shell } = await createShell({ stdout: [], stderr: ['no such file'], exit: { code: 2 } });

    await expect(shell.run({ command: 'cat missing' })).resolves.toEqual({
      stdout: '',
      stderr: 'no such file',
      failed: true,
    });
  });

  it('explains a timeout, which leaves nothing on stdout to explain it', async () => {
    const { shell, scheduler, processes } = await createShell({
      stdout: [], stderr: [], exit: { code: 0 }, hangs: true,
    });
    const running = shell.run({ command: 'sleep 600' });
    await waitForLaunch(processes);
    scheduler.fireAll();

    await expect(running).resolves.toMatchObject({
      failed: true,
      error: 'Command timed out after 30s',
    });
  });

  it('passes the working directory and environment through to the process', async () => {
    const { shell, processes } = await createShell({ stdout: [], stderr: [], exit: { code: 0 } });

    await shell.run({
      command: 'pwd',
      cwd: '/test/vault',
      environment: { PATH: '/opt/bin' },
    });

    expect(processes.launched[0]).toMatchObject({
      executable: '/bin/bash',
      arguments: ['-lc', 'pwd'],
      cwd: '/test/vault',
      environment: { PATH: '/opt/bin' },
    });
  });

  it('runs a second command on the session the first one opened', async () => {
    const { shell, processes } = await createShell([
      { stdout: ['one'], stderr: [], exit: { code: 0 } },
      { stdout: ['two'], stderr: [], exit: { code: 0 } },
    ]);

    await expect(shell.run({ command: 'first' })).resolves.toMatchObject({ stdout: 'one' });
    await expect(shell.run({ command: 'second' })).resolves.toMatchObject({ stdout: 'two' });
    expect(processes.launched).toHaveLength(2);
  });

  it('refuses to run once it has been disposed of', async () => {
    const { shell } = await createShell({ stdout: [], stderr: [], exit: { code: 0 } });
    await shell.run({ command: 'first' });

    await shell.dispose();

    await expect(shell.run({ command: 'second' })).rejects.toThrow();
  });
});
