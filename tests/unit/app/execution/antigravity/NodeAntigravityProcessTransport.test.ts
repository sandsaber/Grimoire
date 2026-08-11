import { NodeAntigravityProcessTransport } from '@/app/execution/antigravity/NodeAntigravityProcessTransport';
import type {
  LocalProcessSystem,
  SpawnedLocalProcess,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';

describe('NodeAntigravityProcessTransport', () => {
  it.each([
    ['posix', 'posix-process-group'],
    ['windows', 'windows-process-tree'],
  ] as const)('owns Antigravity through the %s process-tree contract', async (platform, kind) => {
    const system = new FakeProcessSystem();
    const transport = new NodeAntigravityProcessTransport(system, platform);

    const child = transport.launch({
      command: platform === 'windows' ? 'C:\\agy.exe' : '/bin/zsh',
      args: ['--print', 'hello'],
      cwd: '/vault',
      environment: { PATH: '/bin', OMITTED: undefined },
      shell: false,
    });

    expect(system.launches).toEqual([
      expect.objectContaining({
        terminationKind: kind,
        environment: { PATH: '/bin' },
      }),
    ]);
    await expect(child.confirmTerminated()).resolves.toBe(true);
    await expect(child.terminate('forced')).resolves.toBe('confirmed');
  });

  it('owns Windows command shims through the Job argument-array wrapper', () => {
    const transport = new NodeAntigravityProcessTransport(new FakeProcessSystem(), 'windows');

    const system = new FakeProcessSystem();
    const ownedTransport = new NodeAntigravityProcessTransport(system, 'windows');
    expect(() => ownedTransport.launch({
      command: 'agy.cmd',
      args: ['--print', 'hello & preserve'],
      cwd: 'C:\\vault',
      environment: {},
      shell: true,
    })).not.toThrow();
    expect(system.launches).toEqual([
      expect.objectContaining({
        executable: 'agy.cmd',
        arguments: ['--print', 'hello & preserve'],
        terminationKind: 'windows-process-tree',
        windowsInvocationMode: 'argument-array',
      }),
    ]);
    expect(transport).toBeInstanceOf(NodeAntigravityProcessTransport);
  });
});

class FakeProcessSystem implements LocalProcessSystem {
  readonly launches: Array<Parameters<LocalProcessSystem['spawn']>[0]> = [];

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
      stdout: chunks(),
      stderr: chunks(),
      started: Promise.resolve(),
      exited: Promise.resolve({ code: 0 }),
    };
  }

  processGroupExists(): boolean {
    return false;
  }

  signalProcessGroup(): void {}

  windowsJobTerminated(): boolean {
    return true;
  }

  terminateWindowsJob(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function chunks(): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {},
  };
}
