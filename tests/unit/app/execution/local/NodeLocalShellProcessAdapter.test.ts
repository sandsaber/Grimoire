import {
  type LocalProcessSystem,
  localShellPlatformForNode,
  NodeLocalProcessSystem,
  NodeLocalShellProcessAdapter,
  type SpawnedLocalProcess,
  windowsCommandArguments,
  windowsDirectProcessArguments,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { LocalShellLaunchSpec } from '@/core/execution/local/LocalShellBackend';

describe('NodeLocalShellProcessAdapter', () => {
  it.each([
    ['darwin', 'posix'],
    ['linux', 'posix'],
    ['win32', 'windows'],
  ] as const)('maps Node platform %s to %s shell semantics', (platform, expected) => {
    expect(localShellPlatformForNode(platform)).toBe(expected);
  });

  it('fails closed instead of silently treating an unknown OS as POSIX', () => {
    expect(() => localShellPlatformForNode('aix')).toThrow('does not support');
  });

  it.each([
    'echo "hello world"',
    '(echo first & echo second)> "C:\\path with spaces\\result.txt"',
    'echo (nested) ^& literal',
  ])('preserves the raw cmd.exe command tail: %s', command => {
    expect(windowsCommandArguments({
      executable: 'cmd.exe',
      arguments: ['/d', '/s', '/c', command],
      terminationKind: 'windows-process-tree',
    })).toBe(`/d /s /c ${command}`);
  });

  it('rejects a Windows launch shape whose raw command boundary is ambiguous', () => {
    expect(() => windowsCommandArguments({
      executable: 'cmd.exe',
      arguments: ['/d', '/s', '/c', 'echo safe', 'unexpected'],
      terminationKind: 'windows-process-tree',
    })).toThrow('one raw command');
  });

  it('uses Windows direct-process quoting without changing cmd.exe raw-tail semantics', () => {
    expect(windowsDirectProcessArguments([
      '--model',
      'Gemini 3.5 Flash (High)',
      '--print',
      'say "hello" & continue',
      'C:\\trailing\\',
    ])).toBe('--model "Gemini 3.5 Flash (High)" --print "say \\"hello\\" & continue" C:\\trailing\\');
  });

  it('launches an isolated process and returns ownership before readiness', () => {
    const system = new FakeLocalProcessSystem();
    const adapter = new NodeLocalShellProcessAdapter(system);
    const spec = launchSpec('posix-process-group');

    expect(adapter.launch(spec)).toMatchObject({
      termination: { pid: 42, kind: 'posix-process-group' },
      started: expect.any(Promise),
    });
    expect(system.launches).toEqual([spec]);
  });

  it('signals the complete POSIX process group and confirms only observed exit', async () => {
    const system = new FakeLocalProcessSystem();
    const adapter = new NodeLocalShellProcessAdapter(system);
    system.groupPresence = [true, true, true, false];

    await expect(adapter.terminate(
      { pid: 42, kind: 'posix-process-group' },
      'graceful',
    )).resolves.toBe('unconfirmed');
    await expect(adapter.terminate(
      { pid: 42, kind: 'posix-process-group' },
      'forced',
    )).resolves.toBe('confirmed');
    expect(system.groupSignals).toEqual([
      { pid: 42, signal: 'SIGTERM' },
      { pid: 42, signal: 'SIGKILL' },
    ]);
  });

  it('delegates Windows tree termination with the requested escalation mode', async () => {
    const system = new FakeLocalProcessSystem();
    const adapter = new NodeLocalShellProcessAdapter(system);

    await expect(adapter.terminate(
      windowsTarget(42),
      'forced',
    )).resolves.toBe('confirmed');
    expect(system.windowsTerminations).toEqual([{
      ownershipId: WINDOWS_OWNERSHIP_ID,
      forced: true,
    }]);
  });

  it('confirms complete termination through the platform-specific tree probe', async () => {
    const system = new FakeLocalProcessSystem();
    const adapter = new NodeLocalShellProcessAdapter(system);
    system.groupPresence = [false];
    system.windowsPresence = [true, false];

    await expect(adapter.confirmTerminated({
      pid: 42,
      kind: 'posix-process-group',
    })).resolves.toBe(true);
    await expect(adapter.confirmTerminated({
      pid: 43,
      kind: 'windows-process-tree',
      ownershipId: WINDOWS_OWNERSHIP_ID,
    })).resolves.toBe(false);
    await expect(adapter.confirmTerminated({
      pid: 43,
      kind: 'windows-process-tree',
      ownershipId: WINDOWS_OWNERSHIP_ID,
    })).resolves.toBe(true);
  });

  it('rejects an invalid child pid before it can become unowned', () => {
    const system = new FakeLocalProcessSystem();
    system.child = {
      ...system.child,
      termination: { pid: 0, kind: 'posix-process-group' },
    };
    const adapter = new NodeLocalShellProcessAdapter(system);

    expect(() => adapter.launch(launchSpec('posix-process-group')))
      .toThrow('positive safe integer');
  });

  it('settles readiness when a real spawn fails before ownership exists', async () => {
    const adapter = new NodeLocalShellProcessAdapter(new NodeLocalProcessSystem());

    expect(() => adapter.launch({
      executable: `missing-grimoire-executable-${Date.now()}`,
      arguments: [],
      terminationKind: 'posix-process-group',
    })).toThrow('positive safe integer');
    await new Promise(resolve => setImmediate(resolve));
  });
});

class FakeLocalProcessSystem implements LocalProcessSystem {
  launches: LocalShellLaunchSpec[] = [];
  groupPresence: boolean[] = [];
  groupSignals: Array<{ pid: number; signal: string }> = [];
  windowsTerminations: Array<{ ownershipId: string; forced: boolean }> = [];
  windowsPresence: boolean[] = [];
  child: SpawnedLocalProcess = {
    termination: { pid: 42, kind: 'posix-process-group' },
    stdout: emptyChunks(),
    stderr: emptyChunks(),
    started: Promise.resolve(),
    exited: Promise.resolve({ code: 0 }),
  };

  spawn(spec: LocalShellLaunchSpec): SpawnedLocalProcess {
    this.launches.push(spec);
    return this.child;
  }

  processGroupExists(): boolean {
    return this.groupPresence.shift() ?? false;
  }

  signalProcessGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
    this.groupSignals.push({ pid, signal });
  }

  windowsJobTerminated(): boolean {
    return !(this.windowsPresence.shift() ?? false);
  }

  terminateWindowsJob(ownershipId: string, forced: boolean): Promise<boolean> {
    this.windowsTerminations.push({ ownershipId, forced });
    return Promise.resolve(true);
  }
}

const WINDOWS_OWNERSHIP_ID = 'windows-job-00000000-0000-4000-8000-000000000000';

function windowsTarget(pid: number) {
  return {
    pid,
    kind: 'windows-process-tree' as const,
    ownershipId: WINDOWS_OWNERSHIP_ID,
  };
}

function launchSpec(
  terminationKind: LocalShellLaunchSpec['terminationKind'],
): LocalShellLaunchSpec {
  return {
    executable: '/bin/bash',
    arguments: ['-lc', 'opaque'],
    terminationKind,
  };
}

function emptyChunks(): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ value: undefined as never, done: true }),
    }),
  };
}
