import { PassThrough } from 'node:stream';

import {
  NodeCodexExecutionProcess,
  NodeCodexExecutionProcessFactory,
} from '@/app/execution/codex/NodeCodexExecutionProcess';
import type {
  LocalProcessSystem,
  SpawnedLocalProcess,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';

describe('NodeCodexExecutionProcess', () => {
  it.each([
    ['posix', 'posix-process-group', undefined],
    ['windows', 'windows-process-tree', 'argument-array'],
  ] as const)('owns persistent stdio on %s', async (platform, terminationKind, invocationMode) => {
    const system = new FakeProcessSystem();
    const process = new NodeCodexExecutionProcess({
      launchSpec: {
        command: platform === 'windows' ? 'codex.cmd' : '/usr/local/bin/codex',
        args: ['app-server', '--listen', 'stdio://'],
        spawnCwd: platform === 'windows' ? 'C:\\vault' : '/vault',
        env: { CODEX_HOME: platform === 'windows' ? 'C:\\codex' : '/codex' },
      },
      system,
      platform,
      gracefulTerminationMs: 1,
      forcedTerminationMs: 1,
    });

    process.start();
    process.stdin.write('{"jsonrpc":"2.0"}\n');

    expect(system.launches).toEqual([
      expect.objectContaining({
        executable: platform === 'windows' ? 'codex.cmd' : '/usr/local/bin/codex',
        arguments: ['app-server', '--listen', 'stdio://'],
        terminationKind,
        stdin: 'pipe',
        ...(invocationMode ? { windowsInvocationMode: invocationMode } : {}),
      }),
    ]);
    expect(system.stdin.read().toString()).toBe('{"jsonrpc":"2.0"}\n');
    expect(process.stdout).toBe(system.stdout);

    system.terminated = true;
    await expect(process.shutdown()).resolves.toBeUndefined();
  });

  it.each([
    ['codex.exe', 'direct'],
    ['codex.com', 'direct'],
    ['codex.cmd', 'argument-array'],
    ['codex.bat', 'argument-array'],
  ] as const)('selects the safe Windows invocation path for %s', (command, expected) => {
    const system = new FakeProcessSystem();
    const process = new NodeCodexExecutionProcess({
      launchSpec: { ...launchSpec(), command },
      system,
      platform: 'windows',
    });

    process.start();
    expect(system.launches[0]).toMatchObject({ windowsInvocationMode: expected });
  });

  it('escalates complete-tree shutdown and fails when ownership cannot be proven', async () => {
    const system = new FakeProcessSystem();
    const process = new NodeCodexExecutionProcess({
      launchSpec: launchSpec(),
      system,
      platform: 'posix',
      gracefulTerminationMs: 1,
      forcedTerminationMs: 1,
    });
    process.start();

    await expect(process.shutdown()).rejects.toThrow('could not be confirmed');
    expect(system.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('reports startup failure once and replays it to late subscribers', async () => {
    const system = new FakeProcessSystem();
    const process = new NodeCodexExecutionProcess({
      launchSpec: launchSpec(),
      system,
      platform: 'posix',
    });
    const first = jest.fn();
    process.onExit(first);
    process.start();

    const error = new Error('spawn failed');
    system.started.reject(error);
    await flushPromises();
    expect(first).toHaveBeenCalledWith(null, null, error);

    const late = jest.fn();
    process.onExit(late);
    expect(late).toHaveBeenCalledWith(null, null, error);
  });

  it('captures stdin EPIPE as a process lifecycle failure', () => {
    const system = new FakeProcessSystem();
    const process = new NodeCodexExecutionProcess({
      launchSpec: launchSpec(),
      system,
      platform: 'posix',
    });
    const exit = jest.fn();
    process.onExit(exit);
    process.start();
    const error = Object.assign(new Error('broken daemon pipe'), { code: 'EPIPE' });

    expect(() => system.stdin.emit('error', error)).not.toThrow();
    expect(exit).toHaveBeenCalledWith(null, null, error);
  });

  it('creates isolated process instances for one backend generation factory', () => {
    const system = new FakeProcessSystem();
    const factory = new NodeCodexExecutionProcessFactory({
      launchSpec: launchSpec(),
      system,
      platform: 'posix',
    });

    expect(factory.create()).not.toBe(factory.create());
  });
});

class FakeProcessSystem implements LocalProcessSystem {
  readonly launches: Array<Parameters<LocalProcessSystem['spawn']>[0]> = [];
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly started = deferred<void>();
  readonly signals: string[] = [];
  terminated = false;

  spawn(spec: Parameters<LocalProcessSystem['spawn']>[0]): SpawnedLocalProcess {
    this.launches.push(spec);
    return {
      termination: spec.terminationKind === 'windows-process-tree'
        ? {
          pid: 42,
          kind: 'windows-process-tree',
          ownershipId: 'windows-job-00000000-0000-4000-8000-000000000000',
        }
        : { pid: 42, kind: 'posix-process-group' },
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
      stdoutReadable: this.stdout,
      stderrReadable: this.stderr,
      started: this.started.promise,
      exited: new Promise(() => undefined),
    };
  }

  processGroupExists(): boolean {
    return !this.terminated;
  }

  signalProcessGroup(_pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
    this.signals.push(signal);
  }

  windowsJobTerminated(): boolean {
    return this.terminated;
  }

  terminateWindowsJob(): Promise<boolean> {
    return Promise.resolve(this.terminated);
  }
}

function launchSpec() {
  return {
    command: '/usr/local/bin/codex',
    args: ['app-server', '--listen', 'stdio://'],
    spawnCwd: '/vault',
    env: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}
