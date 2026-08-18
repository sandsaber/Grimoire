import { PassThrough } from 'node:stream';

import {
  CodexActiveLaunchSpec,
  NodeCodexExecutionConnectionFactory,
} from '@/app/execution/codex/NodeCodexExecutionConnectionFactory';
import type {
  LocalProcessSystem,
  SpawnedLocalProcess,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { CodexLaunchSpec } from '@/providers/codex/runtime/codexLaunchTypes';

/**
 * The daemon a Codex connection runs, and the terms its paths are in.
 *
 * One launch spec answers both questions, and they have to be the same answer:
 * a turn whose paths were expressed for one target, dispatched to a daemon
 * launched for another, reads and writes somewhere the user did not point at.
 */
describe('Codex active launch spec', () => {
  it('resolves once and hands everyone the same answer', () => {
    let resolutions = 0;
    const active = new CodexActiveLaunchSpec(() => {
      resolutions += 1;
      return launchSpec();
    });

    expect(active.current()).toBe(active.current());
    expect(resolutions).toBe(1);
  });

  it('re-reads after the daemon it described is gone', () => {
    // Settings the user changed between daemons — a CLI path, a WSL distro —
    // take effect on the next connection rather than on the next plugin load.
    const commands = ['/old/codex', '/new/codex'];
    const active = new CodexActiveLaunchSpec(
      () => ({ ...launchSpec(), command: commands.shift() ?? '/exhausted' }),
    );

    expect(active.current().command).toBe('/old/codex');
    active.invalidate();
    expect(active.current().command).toBe('/new/codex');
  });

  it('does not remember a resolution that failed', () => {
    // A WSL distro that cannot be determined is a setting the user can fix, and
    // fixing it must not need a reload to take.
    let fail = true;
    const active = new CodexActiveLaunchSpec(() => {
      if (fail) {
        throw new Error('Unable to determine the WSL distro.');
      }
      return launchSpec();
    });

    expect(() => active.current()).toThrow(/WSL distro/);
    fail = false;
    expect(active.current().command).toBe('/usr/local/bin/codex');
  });
});

describe('Codex execution connection factory', () => {
  it('launches nothing, and reads no settings, until the connection initializes', async () => {
    // `create` is synchronous and the backend calls it before it can handle a
    // failure, so a misconfigured launch has to surface from `initialize`.
    const system = new FakeProcessSystem();
    let resolutions = 0;
    const factory = new NodeCodexExecutionConnectionFactory({
      activeLaunchSpec: new CodexActiveLaunchSpec(() => {
        resolutions += 1;
        return launchSpec();
      }),
      system,
      platform: 'posix',
    });

    const connection = factory.create();

    expect(resolutions).toBe(0);
    expect(system.launches).toEqual([]);

    await connection.initialize();

    expect(resolutions).toBe(1);
    expect(system.launches).toEqual([
      expect.objectContaining({
        executable: '/usr/local/bin/codex',
        arguments: ['app-server', '--listen', 'stdio://'],
        cwd: '/vault',
        environment: { CODEX_HOME: '/codex' },
      }),
    ]);
  });

  it('surfaces a launch spec that cannot be resolved as a failed initialize', async () => {
    const factory = new NodeCodexExecutionConnectionFactory({
      activeLaunchSpec: new CodexActiveLaunchSpec(() => {
        throw new Error('Unable to determine the WSL distro.');
      }),
      system: new FakeProcessSystem(),
      platform: 'posix',
    });

    const connection = factory.create();

    await expect(connection.initialize()).rejects.toThrow(/WSL distro/);
  });

  it('retires the launch spec when the daemon it described exits', async () => {
    const system = new FakeProcessSystem();
    let resolutions = 0;
    const factory = new NodeCodexExecutionConnectionFactory({
      activeLaunchSpec: new CodexActiveLaunchSpec(() => {
        resolutions += 1;
        return launchSpec();
      }),
      system,
      platform: 'posix',
    });

    const connection = factory.create();
    await connection.initialize();
    expect(resolutions).toBe(1);

    system.stdin.emit('error', Object.assign(new Error('broken daemon pipe'), { code: 'EPIPE' }));
    await flushPromises();

    await factory.create().initialize();

    expect(resolutions).toBe(2);
  });

  it('gives every connection its own process', async () => {
    const system = new FakeProcessSystem();
    const factory = new NodeCodexExecutionConnectionFactory({
      activeLaunchSpec: new CodexActiveLaunchSpec(() => launchSpec()),
      system,
      platform: 'posix',
    });

    const first = factory.create();
    const second = factory.create();
    expect(first).not.toBe(second);

    await Promise.all([first.initialize(), second.initialize()]);

    expect(system.launches).toHaveLength(2);
  });
});

function launchSpec(): CodexLaunchSpec {
  const target = {
    method: 'host-native' as const,
    platformFamily: 'unix' as const,
    platformOs: 'linux' as const,
  };
  return {
    target,
    command: '/usr/local/bin/codex',
    args: ['app-server', '--listen', 'stdio://'],
    spawnCwd: '/vault',
    targetCwd: '/vault',
    env: { CODEX_HOME: '/codex' },
    pathMapper: {
      target,
      toTargetPath: hostPath => hostPath,
      toHostPath: targetPath => targetPath,
      mapTargetPathList: hostPaths => [...hostPaths],
      canRepresentHostPath: () => true,
    },
  };
}

class FakeProcessSystem implements LocalProcessSystem {
  readonly launches: Array<Parameters<LocalProcessSystem['spawn']>[0]> = [];
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  terminated = false;

  spawn(spec: Parameters<LocalProcessSystem['spawn']>[0]): SpawnedLocalProcess {
    this.launches.push(spec);
    this.stdin.on('data', chunk => {
      const message = JSON.parse(String(chunk)) as { id?: unknown; method?: string };
      if (message.method === 'initialize') {
        this.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { userAgent: 'codex-fake' },
        })}\n`);
      }
    });
    return {
      termination: { pid: 42, kind: 'posix-process-group' },
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
      stdoutReadable: this.stdout,
      stderrReadable: this.stderr,
      started: Promise.resolve(),
      exited: new Promise(() => undefined),
    };
  }

  processGroupExists(): boolean {
    return !this.terminated;
  }

  signalProcessGroup(): void {
    this.terminated = true;
  }

  windowsJobTerminated(): boolean {
    return this.terminated;
  }

  terminateWindowsJob(): Promise<boolean> {
    return Promise.resolve(this.terminated);
  }
}

async function flushPromises(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}
