import type { ExecutionRequest } from '@/core/execution/ExecutionContracts';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import {
  LocalShellBackend,
  type LocalShellChildProcess,
  type LocalShellExit,
  type LocalShellLaunchSpec,
  type LocalShellProcessSupervisor,
  type LocalShellScheduler,
} from '@/core/execution/local/LocalShellBackend';

const executionSession = executionSessionId('es-11111111111111111111111111111111');
const instance = sessionInstanceId('si-11111111111111111111111111111111');
const run = runId('run-11111111111111111111111111111111');

describe('LocalShellBackend', () => {
  it('uses the internal service descriptor and Bash launch semantics on POSIX', async () => {
    const fixture = createFixture();
    const backend = fixture.backend('posix');
    const session = await backend.createSession(sessionConfig());
    session.createRun(request());
    await flush(12);

    expect(backend.descriptor.association).toEqual({ kind: 'internal', service: 'shell' });
    expect(fixture.launches).toEqual([expect.objectContaining({
      executable: '/bin/bash',
      arguments: ['-lc', 'echo secret-command'],
      terminationKind: 'posix-process-group',
    })]);
  });

  it('uses cmd launch semantics and a tree target on Windows', async () => {
    const fixture = createFixture();
    const backend = fixture.backend('windows');
    const session = await backend.createSession(sessionConfig());
    session.createRun(request());
    await flush();

    expect(fixture.launches[0]).toEqual(expect.objectContaining({
      executable: 'cmd.exe',
      arguments: ['/d', '/s', '/c', 'echo secret-command'],
      terminationKind: 'windows-process-tree',
    }));
  });

  it('allows an empty successful shell result when no result is expected', async () => {
    const fixture = createFixture();
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request({ resultExpectation: 'none' }));
    await flush();
    fixture.exit.resolve({ code: 0 });

    expect(await collect(execution.events)).toEqual([
      expect.objectContaining({ event: { kind: 'run-started' } }),
      expect.objectContaining({ event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' } }),
    ]);
  });

  it('cleans a live descendant tree before accepting root-process success', async () => {
    const fixture = createFixture({ confirmations: [false] });
    const session = await fixture.backend('windows').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();
    fixture.exit.resolve({ code: 0 });

    expect(await collect(execution.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      }),
    ]));
    expect(fixture.confirmations).toEqual([
      { pid: 42, kind: 'windows-process-tree' },
    ]);
    expect(fixture.terminations).toEqual([
      { pid: 42, kind: 'windows-process-tree', mode: 'graceful' },
    ]);
  });

  it('retains ownership during session unload while spawned-process readiness is pending', async () => {
    const started = deferred<void>();
    const fixture = createFixture({ started: started.promise });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();

    await session.dispose();

    expect(fixture.terminations).toEqual([
      { pid: 42, kind: 'posix-process-group', mode: 'graceful' },
    ]);
    expect((await collect(execution.events)).filter(event => event.event.kind === 'terminal'))
      .toEqual([
        expect.objectContaining({
          event: { kind: 'terminal', terminal: 'cancelled', reason: 'cancellation-confirmed' },
        }),
      ]);
  });

  it('times out and terminates an owned Windows guardian before readiness', async () => {
    const started = deferred<void>();
    const fixture = createFixture({
      started: started.promise,
      termination: ['unconfirmed', 'confirmed'],
    });
    const session = await fixture.backend('windows').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();

    fixture.scheduler.fireNext();
    await flush(6);
    fixture.scheduler.fireNext();
    await flush(6);

    expect(fixture.terminations).toEqual([
      { pid: 42, kind: 'windows-process-tree', mode: 'graceful' },
      { pid: 42, kind: 'windows-process-tree', mode: 'forced' },
    ]);
    expect((await collect(execution.events)).filter(event => event.event.kind === 'terminal'))
      .toEqual([
        expect.objectContaining({
          event: { kind: 'terminal', terminal: 'failed', reason: 'timeout' },
        }),
      ]);
  });

  it('reports indeterminate when a descendant remains after root exit and cleanup is unconfirmed', async () => {
    const fixture = createFixture({
      confirmations: [false, false],
      termination: ['unconfirmed', 'unconfirmed'],
    });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();
    fixture.exit.resolve({ code: 0 });
    await flush(20);
    fixture.scheduler.fireNext();
    await flush(6);
    fixture.scheduler.fireNext();

    expect((await collect(execution.events)).filter(event => event.event.kind === 'terminal'))
      .toEqual([
        expect.objectContaining({
          event: { kind: 'terminal', terminal: 'indeterminate', reason: 'effects-unknown' },
        }),
      ]);
  });

  it('fails a successful exit only when a required result was not produced', async () => {
    const fixture = createFixture();
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request({ resultExpectation: 'required' }));
    await flush();
    fixture.exit.resolve({ code: 0 });

    expect(await collect(execution.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: { kind: 'terminal', terminal: 'failed', reason: 'missing-required-result' } }),
    ]));
  });

  it('keeps stdout and stderr in the ephemeral observer', async () => {
    const fixture = createFixture({
      stdout: [bytes('abc')],
      stderr: [bytes('de')],
      maxOutputBytes: 10,
    });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush(12);
    fixture.exit.resolve({ code: 0 });

    expect(fixture.stdout).toEqual(['abc']);
    expect(fixture.stderr).toEqual(['de']);
    expect(fixture.outputLimitRuns).toEqual([]);
    const events = await collect(execution.events);
    expect(JSON.stringify(events)).not.toContain('secret-command');
    expect(JSON.stringify(events)).not.toContain('SECRET');
    expect(JSON.stringify(events)).not.toContain('value');
  });

  it('bounds each output stream and terminates without publishing raw output', async () => {
    const fixture = createFixture({ stdout: [bytes('abcde')], maxOutputBytes: 4 });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush(12);

    expect(fixture.outputLimitRuns).toEqual([run]);
    expect(fixture.terminations).toEqual([{ pid: 42, kind: 'posix-process-group', mode: 'graceful' }]);
    const events = await collect(execution.events);
    expect(events.filter((event) => event.event.kind === 'terminal')).toEqual([
      expect.objectContaining({ event: { kind: 'terminal', terminal: 'failed', reason: 'output-limit' } }),
    ]);
    expect(JSON.stringify(events)).not.toContain('abcde');
  });

  it('applies the output byte limit across stdout and stderr together', async () => {
    const fixture = createFixture({
      stdout: [bytes('abc')],
      stderr: [bytes('def')],
      maxOutputBytes: 5,
    });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush(12);

    expect(fixture.outputLimitRuns).toEqual([run]);
    expect((await collect(execution.events)).filter(event => event.event.kind === 'terminal'))
      .toEqual([
        expect.objectContaining({
          event: { kind: 'terminal', terminal: 'failed', reason: 'output-limit' },
        }),
      ]);
  });

  it('times out with bounded graceful then forced process-group termination', async () => {
    const fixture = createFixture({ termination: ['unconfirmed', 'confirmed'] });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush(12);
    fixture.scheduler.fireNext();
    await flush(6);
    fixture.scheduler.fireNext();
    await flush(6);

    expect(fixture.terminations).toEqual([
      { pid: 42, kind: 'posix-process-group', mode: 'graceful' },
      { pid: 42, kind: 'posix-process-group', mode: 'forced' },
    ]);
    expect((await collect(execution.events)).filter((event) => event.event.kind === 'terminal')).toEqual([
      expect.objectContaining({ event: { kind: 'terminal', terminal: 'failed', reason: 'timeout' } }),
    ]);
  });

  it('reports indeterminate when forced tree termination cannot be confirmed', async () => {
    const fixture = createFixture({
      termination: ['unconfirmed', 'unconfirmed'],
      confirmations: [false],
    });
    const session = await fixture.backend('windows').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();
    const cancelled = execution.cancel();
    await flush(6);
    fixture.scheduler.fireNext();
    await flush(6);
    fixture.scheduler.fireNext();
    await cancelled;

    expect((await collect(execution.events)).filter((event) => event.event.kind === 'terminal')).toEqual([
      expect.objectContaining({ event: { kind: 'terminal', terminal: 'indeterminate', reason: 'cancellation-unknown' } }),
    ]);
  });

  it('reports indeterminate when both supervisor attempts fail', async () => {
    const fixture = createFixture({
      termination: ['throw', 'throw'],
      confirmations: [false],
    });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();
    const cancelled = execution.cancel();
    await flush(6);
    fixture.scheduler.fireNext();
    await flush(6);
    fixture.scheduler.fireNext();
    await cancelled;

    expect((await collect(execution.events)).filter((event) => event.event.kind === 'terminal'))
      .toEqual([
        expect.objectContaining({
          event: {
            kind: 'terminal',
            terminal: 'indeterminate',
            reason: 'cancellation-unknown',
          },
        }),
      ]);
  });

  it('terminates the child when an output stream fails', async () => {
    const fixture = createFixture({ stdoutFailure: true });
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush(12);

    expect(fixture.terminations).toEqual([
      { pid: 42, kind: 'posix-process-group', mode: 'graceful' },
    ]);
    expect((await collect(execution.events)).filter((event) => event.event.kind === 'terminal'))
      .toEqual([
        expect.objectContaining({
          event: { kind: 'terminal', terminal: 'failed', reason: 'provider-failure' },
        }),
      ]);
  });

  it('makes cancellation and disposal idempotent and rejects work after disposal starts', async () => {
    const fixture = createFixture();
    const backend = fixture.backend('posix');
    const session = await backend.createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();

    await Promise.all([execution.cancel(), execution.cancel(), session.dispose(), session.dispose()]);
    await expect(backend.createSession(sessionConfig())).resolves.toBeDefined();
    await backend.dispose();
    await expect(backend.createSession(sessionConfig())).rejects.toThrow('disposing');

    const events = await collect(execution.events);
    expect(events.filter((event) => event.event.kind === 'terminal')).toHaveLength(1);
    expect(fixture.terminations).toHaveLength(1);
  });

  it('emits one terminal event when a process exit races with cancellation', async () => {
    const fixture = createFixture();
    const session = await fixture.backend('posix').createSession(sessionConfig());
    const execution = session.createRun(request());
    await flush();
    fixture.exit.resolve({ code: 0 });
    await execution.cancel();

    expect((await collect(execution.events)).filter((event) => event.event.kind === 'terminal')).toHaveLength(1);
  });
});

function createFixture(options: {
  readonly stdout?: readonly Uint8Array[];
  readonly stderr?: readonly Uint8Array[];
  readonly stdoutFailure?: boolean;
  readonly termination?: readonly ('confirmed' | 'unconfirmed' | 'throw')[];
  readonly confirmations?: readonly boolean[];
  readonly started?: Promise<void>;
  readonly maxOutputBytes?: number;
} = {}) {
  const exit = deferred<LocalShellExit>();
  const launches: LocalShellLaunchSpec[] = [];
  const terminations: Array<{ pid: number; kind: string; mode: string }> = [];
  const confirmations: Array<{ pid: number; kind: string }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outputLimitRuns: string[] = [];
  const scheduler = new FakeScheduler();
  let terminationIndex = 0;
  let confirmationIndex = 0;
  const supervisor: LocalShellProcessSupervisor = {
    confirmTerminated: async target => {
      confirmations.push({ pid: target.pid, kind: target.kind });
      return options.confirmations?.[confirmationIndex++] ?? true;
    },
    terminate: async (target, mode) => {
      terminations.push({ pid: target.pid, kind: target.kind, mode });
      const result = options.termination?.[terminationIndex++] ?? 'confirmed';
      if (result === 'throw') {
        throw new Error('supervisor failed');
      }
      return result;
    },
  };
  const child: LocalShellChildProcess = {
    termination: { pid: 42, kind: 'posix-process-group' },
    started: options.started ?? Promise.resolve(),
    stdout: options.stdoutFailure
      ? failingChunks()
      : chunks(options.stdout ?? []),
    stderr: chunks(options.stderr ?? []),
    exited: exit.promise,
  };
  return {
    exit,
    launches,
    terminations,
    confirmations,
    stdout,
    stderr,
    outputLimitRuns,
    scheduler,
    backend: (platform: 'posix' | 'windows') => new LocalShellBackend({
      platform,
      requestResolver: { resolve: async () => ({ command: 'echo secret-command', environment: { SECRET: 'value' } }) },
      launcher: { launch: (spec) => {
        launches.push(spec);
        return {
          ...child,
          termination: spec.terminationKind === 'windows-process-tree'
            ? {
              pid: 42,
              kind: 'windows-process-tree',
              ownershipId: 'windows-job-00000000-0000-4000-8000-000000000000',
            }
            : { pid: 42, kind: 'posix-process-group' },
        };
      } },
      supervisor,
      sessionInstanceIdFactory: () => instance,
      scheduler,
      timeoutMs: 10,
      gracefulTerminationMs: 5,
      forcedTerminationMs: 5,
      maxOutputBytes: options.maxOutputBytes,
      outputObserver: {
        onStdout: (_runId, chunk) => { stdout.push(new TextDecoder().decode(chunk)); },
        onStderr: (_runId, chunk) => { stderr.push(new TextDecoder().decode(chunk)); },
        onOutputLimit: (runId) => { outputLimitRuns.push(runId); },
      },
    }),
  };
}

function sessionConfig() {
  return {
    executionSessionId: executionSession,
    owner: { kind: 'internal-service' as const, ownerId: 'shell' },
    backendGeneration: 0,
  };
}

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    runId: run,
    owner: { kind: 'internal-service' as const, ownerId: 'shell' },
    resultExpectation: 'none' as const,
    requestRef: 'request-ref-opaque',
    ...overrides,
  };
}

class FakeScheduler implements LocalShellScheduler {
  private readonly callbacks: Array<() => void> = [];

  setTimeout(callback: () => void): unknown {
    this.callbacks.push(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    const index = this.callbacks.indexOf(handle as () => void);
    if (index >= 0) {
      this.callbacks.splice(index, 1);
    }
  }

  fireNext(): void {
    const callback = this.callbacks.shift();
    if (!callback) {
      throw new Error('No scheduled callback.');
    }
    callback();
  }
}

async function* chunks(values: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* values;
}

async function* failingChunks(): AsyncIterable<Uint8Array> {
  yield bytes('before-failure');
  throw new Error('stream failed');
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flush(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}
