import trace from '@test/fixtures/provider-traces/antigravity-execution.json';

import type {
  ExecutionRequest,
  ExecutionRun,
  ExecutionSession,
} from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  type RunId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  AntigravityExecutionBackend,
  type AntigravityExecutionBackendContext,
  type AntigravityInvocation,
  type AntigravityProcessHandle,
  type AntigravityProcessOutcome,
  type AntigravityProcessRunner,
  type AntigravityResultCommitOutcome,
  type AntigravityScheduler,
} from '@/providers/antigravity/execution/AntigravityExecutionBackend';

const SESSION_ID = executionSessionId(`es-${'a'.repeat(32)}`);
const RUN_ID = runId(`run-${'b'.repeat(32)}`);
const RUN_ID_2 = runId(`run-${'c'.repeat(32)}`);
const OWNER = { kind: 'conversation' as const, ownerId: 'conversation-antigravity' };

describe('AntigravityExecutionBackend', () => {
  it('declares a provider-associated stateless backend with no native session identity', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);

    expect(fixture.backend.descriptor).toEqual({
      backendId: 'provider-antigravity',
      association: { kind: 'provider', providerId: 'antigravity' },
    });
    expect(session.getSnapshot()).toEqual({
      executionSessionId: SESSION_ID,
      sessionInstanceId: expect.stringMatching(/^si-/),
    });
  });

  it('maps bounded stdout to one result and exactly one successful terminal', async () => {
    const fixture = createFixture();
    const process = fixture.runner.enqueue();
    const session = await createSession(fixture.backend);
    const run = session.createRun(request(RUN_ID));
    const events = collectEvents(run);

    process.complete({ exitCode: 0, stdout: '  Antigravity result\n', stderr: '' });

    await expect(events).resolves.toMatchObject([
      { event: { kind: 'run-started' } },
      { event: { kind: 'result', result: { storage: 'projection' } } },
      { event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' } },
    ]);
    expect(fixture.runner.invocations).toEqual([INVOCATION]);
    expect(fixture.resultSink.inputs).toEqual([{
      runId: RUN_ID,
      output: 'Antigravity result',
      source: 'stdout',
    }]);
    expect(summarizeEvents(await events)).toEqual(trace.cases.stdoutSuccess);
    expect((await events)[0]).toEqual(expect.objectContaining({
      backendGeneration: trace.identity.backendGeneration,
      executionSessionId: trace.identity.executionSessionId,
      sessionInstanceId: trace.identity.sessionInstanceId,
      scope: expect.objectContaining({ runId: trace.identity.runId }),
    }));
    expect((await events).filter(event => event.event.kind === 'terminal')).toHaveLength(1);
  });

  it('uses provider transcript recovery only when stdout is empty', async () => {
    const fixture = createFixture();
    const process = fixture.runner.enqueue();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request(RUN_ID)));

    process.complete({
      exitCode: 0,
      stdout: '',
      stderr: '',
      transcriptOutput: 'Recovered Windows output\n',
    });
    expect(summarizeEvents(await events)).toEqual(trace.cases.transcriptRecovery);

    expect(fixture.resultSink.inputs).toEqual([{
      runId: RUN_ID,
      output: 'Recovered Windows output',
      source: 'transcript',
    }]);
  });

  it('fails a required run when neither stdout nor the transcript has a result', async () => {
    const fixture = createFixture();
    const process = fixture.runner.enqueue();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request(RUN_ID)));

    process.complete({ exitCode: 0, stdout: '', stderr: 'diagnostic only' });

    await expect(events).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: {
          kind: 'terminal',
          terminal: 'failed',
          reason: 'missing-required-result',
        },
      }),
    ]));
    expect(summarizeEvents(await events)).toEqual(trace.cases.emptyRequiredResult);
    expect(fixture.resultSink.inputs).toEqual([]);
  });

  it('rejects approval-dependent permission modes before dispatch', async () => {
    const fixture = createFixture({
      invocation: { ...INVOCATION, permissionMode: 'normal' },
    });
    const session = await createSession(fixture.backend);

    const events = await collectEvents(session.createRun(request(RUN_ID)));

    expect(fixture.runner.invocations).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        event: {
          kind: 'terminal',
          terminal: 'invalidated',
          reason: 'pre-dispatch-rejected',
          sideEffectFree: true,
        },
      }),
    ]);
    expect(summarizeEvents(events)).toEqual(trace.cases.safeModePreDispatch);
  });

  it('classifies request resolution and validation failures before dispatch', async () => {
    const resolutionFailure = createFixture({
      resolve: () => Promise.reject(new Error('missing request ref')),
    });
    const failedSession = await createSession(resolutionFailure.backend);
    await expect(collectEvents(failedSession.createRun(request(RUN_ID))))
      .resolves.toEqual([
        expect.objectContaining({
          event: {
            kind: 'terminal',
            terminal: 'invalidated',
            reason: 'pre-dispatch-rejected',
            sideEffectFree: true,
          },
        }),
      ]);

    const invalidInvocation = createFixture({
      invocation: { ...INVOCATION, prompt: '' },
    });
    const invalidSession = await createSession(invalidInvocation.backend);
    await expect(collectEvents(invalidSession.createRun(request(RUN_ID))))
      .resolves.toEqual([
        expect.objectContaining({
          event: {
            kind: 'terminal',
            terminal: 'invalidated',
            reason: 'pre-dispatch-rejected',
            sideEffectFree: true,
          },
        }),
      ]);
  });

  it('maps spawn failure, nonzero exit, and output limits without exposing stderr', async () => {
    const spawnFailure = createFixture();
    spawnFailure.runner.startError = new Error('missing agy');
    const spawnSession = await createSession(spawnFailure.backend);
    await expect(collectEvents(spawnSession.createRun(request(RUN_ID))))
      .resolves.toEqual([
        expect.objectContaining({
          event: { kind: 'terminal', terminal: 'failed', reason: 'spawn-failed' },
        }),
      ]);

    const nonzero = createFixture();
    const nonzeroProcess = nonzero.runner.enqueue();
    const nonzeroSession = await createSession(nonzero.backend);
    const nonzeroEvents = collectEvents(nonzeroSession.createRun(request(RUN_ID)));
    nonzeroProcess.complete({ exitCode: 17, stdout: '', stderr: 'private diagnostic' });
    await expect(nonzeroEvents).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'failed', reason: 'nonzero-exit' },
      }),
    ]));
    expect(summarizeEvents(await nonzeroEvents)).toEqual(trace.cases.nonzeroExit);

    const limited = createFixture();
    const limitedProcess = limited.runner.enqueue();
    const limitedSession = await createSession(limited.backend);
    const limitedEvents = collectEvents(limitedSession.createRun(request(RUN_ID)));
    limitedProcess.exceedOutputLimit();
    await expect(limitedEvents).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'failed', reason: 'output-limit' },
      }),
    ]));
  });

  it('keeps serial-run ownership until the first print process is terminal', async () => {
    const fixture = createFixture();
    const firstProcess = fixture.runner.enqueue();
    const secondProcess = fixture.runner.enqueue();
    const session = await createSession(fixture.backend);
    const firstEvents = collectEvents(session.createRun(request(RUN_ID)));

    expect(() => session.createRun(request(RUN_ID_2))).toThrow('one active print process');
    firstProcess.complete({ exitCode: 0, stdout: 'first', stderr: '' });
    await firstEvents;

    const secondEvents = collectEvents(session.createRun(request(RUN_ID_2)));
    secondProcess.complete({ exitCode: 0, stdout: 'second', stderr: '' });
    await expect(secondEvents).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' } }),
    ]));
  });

  it('cancels side-effect-free without waiting for an unresolved request', async () => {
    const resolution = deferred<AntigravityInvocation>();
    const fixture = createFixture({ resolve: () => resolution.promise });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request(RUN_ID));
    const events = collectEvents(run);
    await expect(run.cancel()).resolves.toBeUndefined();
    await expect(fixture.backend.dispose()).resolves.toBeUndefined();

    expect(fixture.runner.invocations).toEqual([]);
    await expect(events).resolves.toEqual([
      expect.objectContaining({
        event: {
          kind: 'terminal',
          terminal: 'cancelled',
          reason: 'cancellation-confirmed',
          sideEffectFree: true,
        },
      }),
    ]);
  });

  it.each([
    ['cancel', 'cancelled', 'cancellation-confirmed'],
    ['timeout', 'failed', 'timeout'],
    ['dispose', 'cancelled', 'cancellation-confirmed'],
  ] as const)('aborts and settles an in-flight result commit before %s terminal', async (
    trigger,
    terminal,
    reason,
  ) => {
    const fixture = createFixture();
    fixture.resultSink.deferNext();
    const process = fixture.runner.enqueue();
    const session = await createSession(fixture.backend);
    const run = session.createRun(request(RUN_ID));
    const events = collectEvents(run);

    process.complete({ exitCode: 0, stdout: 'must not escape after cancellation', stderr: '' });
    await waitFor(() => fixture.resultSink.inputs.length === 1);
    let action: Promise<void>;
    if (trigger === 'cancel') {
      action = run.cancel();
    } else if (trigger === 'timeout') {
      fixture.scheduler.fireNext();
      action = Promise.resolve();
    } else {
      action = fixture.backend.dispose();
    }
    await expect(action).resolves.toBeUndefined();

    const settledEvents = await events;
    expect(settledEvents.some(event => event.event.kind === 'result')).toBe(false);
    expect(settledEvents.at(-1)).toMatchObject({
      event: {
        kind: 'terminal',
        terminal,
        reason,
      },
    });
    expect(fixture.resultSink.abortedCommits).toBe(1);
  });

  it('publishes an already-committed result instead of relabelling it cancelled', async () => {
    const fixture = createFixture();
    fixture.resultSink.deferCommittedResult();
    const process = fixture.runner.enqueue();
    const session = await createSession(fixture.backend);
    const run = session.createRun(request(RUN_ID));
    const events = collectEvents(run);

    process.complete({ exitCode: 0, stdout: 'durably committed result', stderr: '' });
    await waitFor(() => fixture.resultSink.inputs.length === 1);
    const cancellation = run.cancel();
    await flushPromises();
    fixture.resultSink.completeDeferredResult();
    await cancellation;

    expect((await events).slice(-2)).toMatchObject([
      { event: { kind: 'result' } },
      { event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' } },
    ]);
  });

  it.each(['cancel', 'dispose'] as const)(
    'bounds a never-settling result sink during %s and reports unknown effects',
    async trigger => {
      const fixture = createFixture();
      fixture.resultSink.deferForever();
      const process = fixture.runner.enqueue();
      const session = await createSession(fixture.backend);
      const run = session.createRun(request(RUN_ID));
      const events = collectEvents(run);

      process.complete({ exitCode: 0, stdout: 'result with unknown commit', stderr: '' });
      await waitFor(() => fixture.resultSink.inputs.length === 1);
      const action = trigger === 'cancel' ? run.cancel() : fixture.backend.dispose();
      await flushPromises();
      fixture.scheduler.fireAll();
      await expect(action).resolves.toBeUndefined();

      expect((await events).at(-1)).toMatchObject({
        event: { kind: 'terminal', terminal: 'indeterminate', reason: 'effects-unknown' },
      });
    },
  );

  it('escalates cancellation and classifies an unconfirmed process tree honestly', async () => {
    const fixture = createFixture();
    const process = fixture.runner.enqueue();
    process.terminationResults = ['unconfirmed', 'unconfirmed'];
    process.confirmed = false;
    const session = await createSession(fixture.backend);
    const run = session.createRun(request(RUN_ID));
    const events = collectEvents(run);
    await flushPromises();

    const cancellation = run.cancel({ code: 'user' });
    await flushPromises();
    fixture.scheduler.fireAll();
    await flushPromises();
    fixture.scheduler.fireAll();
    await cancellation;

    expect(process.terminationModes).toEqual(['graceful', 'forced']);
    await expect(events).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: {
          kind: 'terminal',
          terminal: 'indeterminate',
          reason: 'cancellation-unknown',
        },
      }),
    ]));
  });

  it('starts the timeout before readiness and owns cleanup through backend disposal', async () => {
    const fixture = createFixture();
    const process = fixture.runner.enqueue({ readiness: 'pending' });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request(RUN_ID));
    const events = collectEvents(run);
    await flushPromises();

    fixture.scheduler.fireNext();
    await flushPromises();

    expect(process.terminationModes).toEqual(['graceful']);
    await fixture.backend.dispose();
    await expect(events).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'failed', reason: 'timeout' },
      }),
    ]));
    await expect(fixture.backend.dispose()).resolves.toBeUndefined();
  });

  it('cleans descendants after root exit before publishing the result', async () => {
    const fixture = createFixture();
    const process = fixture.runner.enqueue();
    process.confirmed = false;
    process.terminationResults = ['unconfirmed', 'confirmed'];
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request(RUN_ID)));

    process.complete({ exitCode: 0, stdout: 'owned result', stderr: '' });
    await flushPromises();
    fixture.scheduler.fireAll();

    await expect(events).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ event: expect.objectContaining({ kind: 'result' }) }),
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      }),
    ]));
    expect(process.terminationModes).toEqual(['graceful', 'forced']);
  });

  it('emits no fabricated sessions, interactions, or agents for print mode', async () => {
    const fixture = createFixture();
    const process = fixture.runner.enqueue();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request(RUN_ID)));
    process.complete({ exitCode: 0, stdout: 'plain result', stderr: '' });

    const kinds = (await events).map(event => event.event.kind);
    expect(kinds).toEqual(['run-started', 'result', 'terminal']);
  });
});

interface FixtureOptions {
  readonly invocation?: AntigravityInvocation;
  readonly resolve?: (requestRef: string) => Promise<AntigravityInvocation>;
}

function createFixture(options: FixtureOptions = {}) {
  let clock = 0;
  const runner = new FakeProcessRunner();
  const scheduler = new ManualScheduler();
  const resultSink = new FakeResultSink();
  const context: AntigravityExecutionBackendContext = {
    requestResolver: {
      resolve: options.resolve ?? (() => Promise.resolve(options.invocation ?? INVOCATION)),
    },
    processRunner: runner,
    resultSink,
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'d'.repeat(32)}`),
    now: () => ++clock,
    timeoutMs: 100,
    gracefulTerminationMs: 10,
    forcedTerminationMs: 10,
    resultCommitTimeoutMs: 10,
  };
  return {
    backend: new AntigravityExecutionBackend(context),
    resultSink,
    runner,
    scheduler,
  };
}

function createSession(backend: AntigravityExecutionBackend): Promise<ExecutionSession> {
  return backend.createSession({
    executionSessionId: SESSION_ID,
    owner: OWNER,
    backendGeneration: 1,
  });
}

function request(id: RunId): ExecutionRequest {
  return {
    runId: id,
    owner: OWNER,
    resultExpectation: 'required',
    requestRef: `request-${id}`,
  };
}

const INVOCATION: AntigravityInvocation = {
  command: '/usr/local/bin/agy',
  cwd: '/vault',
  environment: { PATH: '/usr/local/bin' },
  model: 'Gemini 3.5 Flash (High)',
  permissionMode: 'full_access',
  prompt: 'Hello from Grimoire',
};

class FakeProcessRunner implements AntigravityProcessRunner {
  readonly invocations: AntigravityInvocation[] = [];
  private readonly processes: FakeProcess[] = [];
  startError: Error | undefined;

  enqueue(options: { readiness?: 'ready' | 'pending' } = {}): FakeProcess {
    const process = new FakeProcess(options.readiness ?? 'ready');
    this.processes.push(process);
    return process;
  }

  start(invocation: AntigravityInvocation): AntigravityProcessHandle {
    this.invocations.push(invocation);
    if (this.startError) {
      throw this.startError;
    }
    const process = this.processes.shift();
    if (!process) {
      throw new Error('No fake Antigravity process was queued.');
    }
    return process;
  }
}

class FakeProcess implements AntigravityProcessHandle {
  readonly started: Promise<void>;
  readonly completed: Promise<AntigravityProcessOutcome>;
  readonly outputLimitExceeded: Promise<void>;
  readonly terminationModes: Array<'graceful' | 'forced'> = [];
  terminationResults: Array<'confirmed' | 'unconfirmed'> = ['confirmed'];
  confirmed = true;
  private readonly readiness = deferred<void>();
  private readonly completion = deferred<AntigravityProcessOutcome>();
  private readonly outputLimit = deferred<void>();

  constructor(readiness: 'ready' | 'pending') {
    this.started = this.readiness.promise;
    this.completed = this.completion.promise;
    this.outputLimitExceeded = this.outputLimit.promise;
    if (readiness === 'ready') {
      this.readiness.resolve();
    }
  }

  complete(outcome: AntigravityProcessOutcome): void {
    this.completion.resolve(outcome);
  }

  exceedOutputLimit(): void {
    this.outputLimit.resolve();
  }

  confirmTerminated(): Promise<boolean> {
    return Promise.resolve(this.confirmed);
  }

  terminate(mode: 'graceful' | 'forced'): Promise<'confirmed' | 'unconfirmed'> {
    this.terminationModes.push(mode);
    const result = this.terminationResults.shift() ?? 'unconfirmed';
    if (result === 'confirmed') {
      this.confirmed = true;
    }
    return Promise.resolve(result);
  }
}

class FakeResultSink {
  readonly inputs: Array<{
    readonly runId: string;
    readonly output: string;
    readonly source: 'stdout' | 'transcript';
  }> = [];
  abortedCommits = 0;
  private defer: 'abort' | 'commit' | 'never' | undefined;
  private pendingResult: ReturnType<typeof deferred<AntigravityResultCommitOutcome>> | undefined;

  deferNext(): void {
    this.defer = 'abort';
  }

  deferCommittedResult(): void {
    this.defer = 'commit';
  }

  deferForever(): void {
    this.defer = 'never';
  }

  completeDeferredResult(): void {
    this.pendingResult?.resolve({
      kind: 'committed',
      result: { resultId: 'deferred-result', storage: 'projection' },
    });
  }

  storeResult(input: {
    readonly runId: string;
    readonly output: string;
    readonly source: 'stdout' | 'transcript';
    readonly signal: AbortSignal;
  }): Promise<AntigravityResultCommitOutcome> {
    this.inputs.push({ runId: input.runId, output: input.output, source: input.source });
    if (this.defer === 'abort') {
      this.defer = undefined;
      return new Promise(resolve => {
        input.signal.addEventListener('abort', () => {
          this.abortedCommits += 1;
          resolve({ kind: 'aborted' });
        }, { once: true });
      });
    }
    if (this.defer === 'commit') {
      this.defer = undefined;
      this.pendingResult = deferred<AntigravityResultCommitOutcome>();
      return this.pendingResult.promise;
    }
    if (this.defer === 'never') {
      this.defer = undefined;
      return new Promise(() => undefined);
    }
    return Promise.resolve({
      kind: 'committed',
      result: {
        resultId: `result-${input.runId}`,
        storage: 'projection',
      },
    });
  }
}

class ManualScheduler implements AntigravityScheduler {
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
    this.callbacks.shift()?.();
  }

  fireAll(): void {
    const callbacks = this.callbacks.splice(0);
    for (const callback of callbacks) {
      callback();
    }
  }
}

async function collectEvents(run: ExecutionRun): Promise<ProviderExecutionEvent[]> {
  const events: ProviderExecutionEvent[] = [];
  for await (const event of run.events) {
    events.push(event);
  }
  return events;
}

function summarizeEvents(events: readonly ProviderExecutionEvent[]): string[] {
  return events.map(event => {
    if (event.event.kind === 'result') {
      return `result:${event.event.result.storage}`;
    }
    if (event.event.kind === 'terminal') {
      return `terminal:${event.event.terminal}:${event.event.reason}`;
    }
    return event.event.kind;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function flushPromises(turns = 6): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flushPromises();
  }
  throw new Error('Timed out waiting for test condition.');
}
