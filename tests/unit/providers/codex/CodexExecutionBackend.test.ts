import trace from '@test/fixtures/provider-traces/codex-execution.json';

import type {
  ExecutionRequest,
  ExecutionRun,
  ExecutionSession,
} from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  type InteractionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';
import {
  CodexExecutionBackend,
  type CodexExecutionBackendContext,
  type CodexExecutionInvocation,
  type CodexExecutionScheduler,
  type CodexTurnReconciliationEvidence,
} from '@/providers/codex/execution/CodexExecutionBackend';
import type {
  InitializeResult,
  Thread,
  ThreadStartResult,
  Turn,
  TurnStartParams,
  TurnStartResult,
} from '@/providers/codex/runtime/codexAppServerTypes';
import type {
  CodexExecutionConnection,
  CodexExecutionNotificationListener,
  CodexExecutionServerRequestHandler,
} from '@/providers/codex/runtime/CodexExecutionConnection';

const RUN_1 = runId(`run-${'1'.repeat(32)}`);
const RUN_2 = runId(`run-${'2'.repeat(32)}`);
const OWNER = { kind: 'conversation' as const, ownerId: 'conversation-codex' };
const THREAD_PARAMS = {
  model: 'gpt-5.6-codex',
  cwd: '/vault',
  approvalPolicy: 'on-request',
  sandbox: 'workspace-write',
  experimentalRawEvents: true,
  persistExtendedHistory: true,
};
const TURN_PARAMS: Omit<TurnStartParams, 'threadId'> = {
  input: [{ type: 'text', text: 'Implement the change' }],
  model: 'gpt-5.6-codex',
  summary: 'detailed',
};

describe('CodexExecutionBackend', () => {
  it('multiplexes sessions through one initialized connection and preserves early notifications', async () => {
    const fixture = createFixture();
    fixture.connection.beforeRequest = (method, params) => {
      if (method !== 'turn/start') {
        return undefined;
      }
      const record = params as { threadId: string };
      const turnId = `turn-${record.threadId}`;
      fixture.connection.notifyExecution('item/agentMessage/delta', {
        threadId: record.threadId,
        turnId,
        itemId: 'message-1',
        delta: `result for ${record.threadId}`,
      });
      fixture.connection.notifyExecution('turn/completed', {
        threadId: record.threadId,
        turn: turn(turnId, 'completed'),
      });
      return { turn: turn(turnId, 'inProgress') };
    };

    const [firstSession, secondSession] = await Promise.all([
      createSession(fixture.backend, 1),
      createSession(fixture.backend, 2),
    ]);
    const firstEvents = collectEvents(firstSession.createRun(request(RUN_1, 'first')));
    const secondEvents = collectEvents(secondSession.createRun(request(RUN_2, 'second')));

    await expect(firstEvents).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ event: { kind: 'run-started' } }),
      expect.objectContaining({ event: { kind: 'result', result: expect.any(Object) } }),
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      }),
    ]));
    await expect(secondEvents).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      }),
    ]));
    expect(summarizeEvents(await firstEvents)).toEqual(trace.cases.earlyNotificationCompletion);
    const firstSessionMethods = [
      'initialize',
      fixture.connection.calls.find(call => call.method === 'thread/start')?.method,
      fixture.connection.calls.find(call => call.method === 'turn/start'
        && (call.params as { threadId?: string }).threadId === 'thread-1')?.method,
    ].filter((method): method is string => method !== undefined);
    expect(firstSessionMethods).toEqual(trace.cases.initializationAndNewThread);
    expect((await firstEvents)[0]).toMatchObject({
      backendGeneration: trace.identity.backendGeneration,
      executionSessionId: trace.identity.executionSessionId,
      sessionInstanceId: trace.identity.sessionInstanceId,
      scope: { runId: trace.identity.runId, nativeRunRef: trace.identity.nativeTurnId },
    });
    expect(firstSession.getSnapshot()).toMatchObject({
      nativeSessionRef: trace.identity.nativeThreadId,
    });

    expect(fixture.connection.initializeCount).toBe(1);
    expect(fixture.connectionFactoryCalls).toBe(1);
    expect(fixture.connection.calls.filter(call => call.method === 'thread/start')).toHaveLength(2);
    expect(fixture.resultSinkInputs.map(input => input.output)).toEqual([
      'result for thread-1',
      'result for thread-2',
    ]);
  });

  it('creates a replacement daemon and resumes owned threads after connection loss', async () => {
    const first = new FakeCodexConnection();
    const second = new FakeCodexConnection();
    const fixture = createFixture({ connections: [first, second] });
    const session = await createSession(fixture.backend, 1);
    const firstEvents = collectEvents(session.createRun(request(RUN_1, 'default')));
    await first.waitForCall('turn/start');
    first.complete('thread-1', 'turn-1', 'first result');
    await firstEvents;

    first.lose(new Error('first daemon exited'));
    await flushPromises();
    const secondEvents = collectEvents(session.createRun(request(RUN_2, 'default')));
    await second.waitForCall('turn/start');
    second.complete('thread-1', 'turn-1', 'second result');
    expectTerminal(await secondEvents, 'succeeded', 'completed');

    expect(first.initializeCount).toBe(1);
    expect(second.initializeCount).toBe(1);
    expect(second.calls.map(call => call.method)).toEqual([
      'thread/resume',
      'turn/start',
    ]);
    expect(['initialize', ...second.calls.map(call => call.method)])
      .toEqual(trace.cases.resumeAfterDaemonReplacement);
    expect(second.calls[0].params).toMatchObject({
      threadId: 'thread-1',
      experimentalRawEvents: true,
      persistExtendedHistory: true,
    });
    expect(fixture.connectionFactoryCalls).toBe(2);
  });

  it('restores a persisted thread reference before dispatching the first post-restart turn', async () => {
    const fixture = createFixture();
    const session = await fixture.backend.createSession({
      executionSessionId: executionSessionId(`es-${'e'.repeat(32)}`),
      owner: OWNER,
      backendGeneration: 1,
      nativeSessionRef: 'thread-persisted',
    });
    expect(session.getSnapshot()).toMatchObject({ nativeSessionRef: 'thread-persisted' });

    const events = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('turn/start');
    fixture.connection.complete('thread-persisted', 'turn-1', 'post-restart result');
    expectTerminal(await events, 'succeeded', 'completed');
    expect(fixture.connection.calls.map(call => call.method)).toEqual([
      'thread/resume',
      'turn/start',
    ]);
  });

  it('orders resume and fork-resume-rollback before turn dispatch', async () => {
    const fixture = createFixture({
      invocations: {
        resume: {
          thread: {
            kind: 'resume',
            threadId: 'thread-existing',
            params: { model: 'gpt-5.6-codex', experimentalRawEvents: true },
          },
          turn: { kind: 'start', params: TURN_PARAMS },
        },
        fork: {
          thread: {
            kind: 'fork',
            sourceThreadId: 'thread-source',
            resumeAtTurnId: 'source-turn-1',
            resumeParams: { model: 'gpt-5.6-codex', experimentalRawEvents: true },
          },
          turn: { kind: 'start', params: TURN_PARAMS },
        },
      },
    });
    fixture.connection.beforeRequest = (method) => {
      if (method === 'thread/fork') {
        return startResult(thread('thread-fork', [
          turn('source-turn-1', 'completed'),
          turn('source-turn-2', 'completed'),
          turn('source-turn-3', 'completed'),
        ]));
      }
      return undefined;
    };

    const resumeSession = await createSession(fixture.backend, 1);
    const resumeEvents = collectEvents(resumeSession.createRun(request(RUN_1, 'resume')));
    await waitFor(() => fixture.connection.calls.some(call => call.method === 'turn/start'));
    fixture.connection.complete('thread-existing', 'turn-1', 'resumed');
    await resumeEvents;

    const forkSession = await createSession(fixture.backend, 2);
    const forkEvents = collectEvents(forkSession.createRun(request(RUN_2, 'fork')));
    await waitFor(() => fixture.connection.calls.filter(call => call.method === 'turn/start').length === 2);
    fixture.connection.complete('thread-fork', 'turn-2', 'forked');
    await forkEvents;

    expect(fixture.connection.calls.map(call => call.method)).toEqual([
      'thread/resume',
      'turn/start',
      'thread/fork',
      'thread/resume',
      'thread/rollback',
      'turn/start',
    ]);
    expect(fixture.connection.calls[3].params).toMatchObject({ threadId: 'thread-fork' });
    expect(fixture.connection.calls[4].params).toEqual({
      threadId: 'thread-fork',
      numTurns: 2,
    });
    expect(fixture.connection.calls.slice(-4).map(call => call.method))
      .toEqual(trace.cases.forkRollbackDispatch);
  });

  it('establishes compact turns from notification and steers only the owned active turn', async () => {
    const fixture = createFixture({
      invocations: {
        compact: {
          thread: { kind: 'new', params: THREAD_PARAMS },
          turn: { kind: 'compact' },
        },
      },
    });
    const session = await createSession(fixture.backend, 1);
    const events = collectEvents(session.createRun(request(RUN_1, 'compact')));
    await waitFor(() => fixture.connection.calls.some(call => call.method === 'thread/compact/start'));

    fixture.connection.notifyExecution('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-compact', 'inProgress'),
    });
    await expect(fixture.backend.steer(session.executionSessionId, 'steer')).resolves.toBe(true);
    expect(fixture.connection.calls.at(-1)).toMatchObject({
      method: 'turn/steer',
      params: { threadId: 'thread-1', expectedTurnId: 'turn-compact' },
    });
    expect(fixture.connection.calls.map(call => call.method))
      .toEqual(trace.cases.compactAndSteer);

    fixture.connection.complete('thread-1', 'turn-compact', 'compacted');
    await expect(events).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      }),
    ]));
    await expect(fixture.backend.steer(session.executionSessionId, 'steer')).resolves.toBe(false);
  });

  it('fences a stale prior turn/started while establishing a compact turn', async () => {
    const fixture = createFixture({
      invocations: {
        compact: {
          thread: { kind: 'new', params: THREAD_PARAMS },
          turn: { kind: 'compact' },
        },
      },
    });
    const session = await createSession(fixture.backend, 1);
    const firstEvents = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('turn/start');
    fixture.connection.complete('thread-1', 'turn-1', 'first result');
    await firstEvents;

    const compactEvents = collectEvents(session.createRun(request(RUN_2, 'compact')));
    await fixture.connection.waitForCall('thread/compact/start');
    fixture.connection.notifyExecution('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'inProgress'),
    });
    fixture.connection.notifyExecution('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-compact', 'inProgress'),
    });
    fixture.connection.complete('thread-1', 'turn-compact', 'compacted');

    const settled = await compactEvents;
    expectTerminal(settled, 'succeeded', 'completed');
    expect(settled.filter(event => event.event.kind === 'run-started')).toEqual([
      expect.objectContaining({ scope: expect.objectContaining({ nativeRunRef: 'turn-compact' }) }),
    ]);
  });

  it('requires terminal evidence for cancellation and timeout', async () => {
    const cancellation = createFixture();
    cancellation.connection.beforeRequest = (method, params) => {
      if (method === 'turn/interrupt') {
        const scope = params as { threadId: string; turnId: string };
        cancellation.connection.notifyExecution('turn/completed', {
          threadId: scope.threadId,
          turn: turn(scope.turnId, 'interrupted'),
        });
        return {};
      }
      return undefined;
    };
    const cancelSession = await createSession(cancellation.backend, 1);
    const cancelRun = cancelSession.createRun(request(RUN_1, 'default'));
    const cancelEvents = collectEvents(cancelRun);
    await cancellation.connection.waitForCall('turn/start');
    await cancelRun.cancel();
    expectTerminal(await cancelEvents, 'cancelled', 'cancellation-confirmed');
    expect(cancellation.connection.calls.map(call => call.method))
      .toEqual(trace.cases.interruptCancellation);

    const timeout = createFixture({ runTimeoutMs: 5_000 });
    timeout.connection.beforeRequest = (method, params) => {
      if (method === 'turn/interrupt') {
        const scope = params as { threadId: string; turnId: string };
        timeout.connection.notifyExecution('turn/completed', {
          threadId: scope.threadId,
          turn: turn(scope.turnId, 'interrupted'),
        });
        return {};
      }
      return undefined;
    };
    const timeoutSession = await createSession(timeout.backend, 2);
    const timeoutEvents = collectEvents(timeoutSession.createRun(request(RUN_2, 'default')));
    await timeout.connection.waitForCall('turn/start');
    timeout.scheduler.fireDelay(5_000);
    await flushPromises();
    expectTerminal(await timeoutEvents, 'failed', 'timeout');
  });

  it('retains ownership while native thread preparation is awaiting acknowledgement', async () => {
    const preparation = deferred<ThreadStartResult>();
    const fixture = createFixture();
    fixture.connection.beforeRequest = method => method === 'thread/start'
      ? preparation.promise
      : undefined;
    const session = await createSession(fixture.backend, 1);
    const run = session.createRun(request(RUN_1, 'default'));
    const events = collectEvents(run);
    await fixture.connection.waitForCall('thread/start');

    let cancellationSettled = false;
    const cancellation = run.cancel().then(() => { cancellationSettled = true; });
    await flushPromises();
    expect(cancellationSettled).toBe(false);

    preparation.resolve(startResult(thread('thread-prepared')));
    await cancellation;
    const settled = await events;
    expectTerminal(settled, 'cancelled', 'cancellation-confirmed');
    expect(settled.find(event => event.event.kind === 'terminal')?.event)
      .not.toHaveProperty('sideEffectFree');
    expect(fixture.connection.calls.some(call => call.method === 'turn/start')).toBe(false);
  });

  it('classifies a lost native-preparation acknowledgement as indeterminate', async () => {
    const preparation = deferred<ThreadStartResult>();
    const fixture = createFixture();
    fixture.connection.beforeRequest = method => method === 'thread/start'
      ? preparation.promise
      : undefined;
    const session = await createSession(fixture.backend, 1);
    const events = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('thread/start');

    preparation.reject(new Error('thread/start acknowledgement lost'));
    const settled = await events;
    expectTerminal(settled, 'indeterminate', 'effects-unknown');
    expect(settled.find(event => event.event.kind === 'terminal')?.event)
      .not.toHaveProperty('sideEffectFree');
    expect(fixture.connection.calls.some(call => call.method === 'turn/start')).toBe(false);
  });

  it('correlates approvals, questions, client resolution, and provider auto-resolution', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend, 1);
    const events = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('turn/start');

    const approval = fixture.connection.serverRequest(
      100,
      'item/commandExecution/requestApproval',
      { threadId: 'thread-1', turnId: 'turn-1', command: 'npm test' },
    );
    await waitFor(() => fixture.interactionIds.length === 1);
    await flushPromises();
    await fixture.backend.resolve({
      interactionId: fixture.interactionIds[0],
      responseId: 'accept',
      resolvedAt: 2,
    });
    await expect(approval).resolves.toEqual({ decision: 'accept' });

    const question = fixture.connection.serverRequest(
      'question-1',
      'item/tool/requestUserInput',
      { threadId: 'thread-1', turnId: 'turn-1', questions: [] },
    );
    await waitFor(() => fixture.interactionIds.length === 2);
    await flushPromises();
    fixture.connection.notifyExecution('serverRequest/resolved', {
      threadId: 'thread-1',
      requestId: 'question-1',
    });
    await expect(question).resolves.toEqual({ decision: 'provider-resolved' });

    fixture.connection.complete('thread-1', 'turn-1', 'approved result');
    const settled = await events;
    expect(settled.filter(event => event.event.kind === 'interaction-opened').map(event => event.event))
      .toMatchObject([
        { kind: 'interaction-opened', interaction: { kind: 'approval' } },
        { kind: 'interaction-opened', interaction: { kind: 'question' } },
      ]);
    expect(settled.filter(event => event.event.kind === 'interaction-resolved')).toHaveLength(2);
    expect(summarizeEvents(settled).filter(value => value.startsWith('interaction-')))
      .toEqual(trace.cases.interactions);
  });

  it('ignores stale turn notifications and safely declines wrong-turn server requests', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend, 1);
    const events = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('turn/start');

    fixture.connection.notifyExecution('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-stale', 'inProgress'),
    });
    await expect(fixture.connection.serverRequest(
      'approval-stale',
      'item/commandExecution/requestApproval',
      { threadId: 'thread-1', turnId: 'turn-stale', command: 'ignored' },
    )).resolves.toEqual({ decision: 'provider-resolved' });

    fixture.connection.complete('thread-1', 'turn-1', 'current result');
    const settled = await events;
    expectTerminal(settled, 'succeeded', 'completed');
    expect(settled.filter(event => event.event.kind === 'interaction-opened')).toEqual([]);
  });

  it('waits for the turn/start response before correlating an early server request', async () => {
    const turnStart = deferred<TurnStartResult>();
    const fixture = createFixture();
    fixture.connection.beforeRequest = method => method === 'turn/start'
      ? turnStart.promise
      : undefined;
    const session = await createSession(fixture.backend, 1);
    const events = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('turn/start');

    const staleRequest = fixture.connection.serverRequest(
      'approval-previous-turn',
      'item/commandExecution/requestApproval',
      { threadId: 'thread-1', turnId: 'turn-previous', command: 'ignored' },
    );
    await flushPromises();
    turnStart.resolve({ turn: turn('turn-current', 'inProgress') });
    await expect(staleRequest).resolves.toEqual({ decision: 'provider-resolved' });

    fixture.connection.complete('thread-1', 'turn-current', 'current result');
    const settled = await events;
    expectTerminal(settled, 'succeeded', 'completed');
    expect(settled.filter(event => event.event.kind === 'interaction-opened')).toEqual([]);
  });

  it('recovers a missing completion from durable turn evidence and fails closed on unknown loss', async () => {
    const recovered = createFixture({
      reconciliation: {
        kind: 'turn',
        turn: turn('turn-1', 'completed', [agentMessage('Recovered from JSONL')]),
      },
    });
    const recoveredSession = await createSession(recovered.backend, 1);
    const recoveredEvents = collectEvents(recoveredSession.createRun(request(RUN_1, 'default')));
    await recovered.connection.waitForCall('turn/start');
    recovered.connection.notifyExecution('thread/status/changed', {
      threadId: 'thread-1',
      status: { type: 'idle' },
    });
    recovered.scheduler.fireDelay(250);
    await flushPromises();

    expect(recovered.resultSinkInputs).toEqual([
      expect.objectContaining({ output: 'Recovered from JSONL', source: 'assistant' }),
    ]);
    const recoveredSettled = await recoveredEvents;
    expectTerminal(recoveredSettled, 'succeeded', 'completed');
    expect(summarizeEvents(recoveredSettled)).toEqual(trace.cases.missingCompletionRecovery);

    const lost = createFixture({ reconciliation: { kind: 'unknown' } });
    const lostSession = await createSession(lost.backend, 2);
    const lostEvents = collectEvents(lostSession.createRun(request(RUN_2, 'default')));
    await lost.connection.waitForCall('turn/start');
    lost.connection.lose(new Error('daemon exited'));
    await flushPromises();
    expectTerminal(await lostEvents, 'indeterminate', 'effects-unknown');
  });

  it('preserves provider failed and interrupted terminal evidence', async () => {
    const failed = createFixture();
    const failedSession = await createSession(failed.backend, 1);
    const failedEvents = collectEvents(failedSession.createRun(request(RUN_1, 'default')));
    await failed.connection.waitForCall('turn/start');
    failed.connection.notifyExecution('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'failed'),
    });
    expect(summarizeEvents(await failedEvents)).toEqual(trace.cases.providerFailure);

    const interrupted = createFixture();
    const interruptedSession = await createSession(interrupted.backend, 2);
    const interruptedEvents = collectEvents(
      interruptedSession.createRun(request(RUN_2, 'default')),
    );
    await interrupted.connection.waitForCall('turn/start');
    interrupted.connection.notifyExecution('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'interrupted'),
    });
    expect(summarizeEvents(await interruptedEvents)).toEqual(trace.cases.providerInterruption);
  });

  it('reconciles durable native session and run identities without redispatch', async () => {
    const fixture = createFixture({
      reconciliation: {
        kind: 'turn',
        turn: turn('native-turn-1', 'completed', [agentMessage('Durable recovery result')]),
      },
    });
    await createSession(fixture.backend, 1);

    await expect(fixture.backend.reconcile({
      backendId: fixture.backend.descriptor.backendId,
      backendGeneration: 1,
      executionSessionId: executionSessionId(`es-${'9'.repeat(32)}`),
      sessionInstanceId: sessionInstanceId(`si-${'8'.repeat(32)}`),
      runId: RUN_1,
      nativeSessionRef: 'native-thread-1',
      nativeRunRef: 'native-turn-1',
      cancellationRequested: false,
      resultExpectation: 'required',
    })).resolves.toMatchObject({
      kind: 'terminal',
      terminal: {
        kind: 'succeeded',
        reason: 'completed',
        resultRef: { storage: 'projection' },
      },
    });
    expect(fixture.connection.calls).toEqual([{
      method: 'thread/resume',
      params: {
        threadId: 'native-thread-1',
        experimentalRawEvents: true,
        persistExtendedHistory: true,
      },
    }]);
    expect(fixture.resultSinkInputs).toEqual([
      { output: 'Durable recovery result', source: 'assistant' },
    ]);

    await expect(fixture.backend.reconcile({
      backendId: fixture.backend.descriptor.backendId,
      backendGeneration: 1,
      executionSessionId: executionSessionId(`es-${'7'.repeat(32)}`),
      sessionInstanceId: sessionInstanceId(`si-${'6'.repeat(32)}`),
      runId: RUN_2,
      cancellationRequested: false,
      resultExpectation: 'required',
    })).resolves.toEqual({ kind: 'unknown', effectsPossible: true });
  });

  it('keeps durable recovery indeterminate when result persistence aborts', async () => {
    const fixture = createFixture({
      reconciliation: {
        kind: 'turn',
        turn: turn('native-turn-1', 'completed', [agentMessage('Recovered result')]),
      },
      resultCommitOutcome: { kind: 'aborted' },
    });
    await createSession(fixture.backend, 1);

    await expect(fixture.backend.reconcile({
      backendId: fixture.backend.descriptor.backendId,
      backendGeneration: 1,
      executionSessionId: executionSessionId(`es-${'9'.repeat(32)}`),
      sessionInstanceId: sessionInstanceId(`si-${'8'.repeat(32)}`),
      runId: RUN_1,
      nativeSessionRef: 'native-thread-1',
      nativeRunRef: 'native-turn-1',
      cancellationRequested: false,
      resultExpectation: 'required',
    })).resolves.toEqual({ kind: 'unknown', effectsPossible: true });
  });

  it('does not claim durable in-flight reattachment from an active turn snapshot', async () => {
    const fixture = createFixture({
      reconciliation: {
        kind: 'turn',
        turn: turn('native-turn-1', 'inProgress'),
      },
    });
    await createSession(fixture.backend, 1);

    await expect(fixture.backend.reconcile({
      backendId: fixture.backend.descriptor.backendId,
      backendGeneration: 1,
      executionSessionId: executionSessionId(`es-${'9'.repeat(32)}`),
      sessionInstanceId: sessionInstanceId(`si-${'8'.repeat(32)}`),
      runId: RUN_1,
      nativeSessionRef: 'native-thread-1',
      nativeRunRef: 'native-turn-1',
      cancellationRequested: false,
      resultExpectation: 'required',
    })).resolves.toEqual({ kind: 'unknown', effectsPossible: true });
  });

  it('projects stable native-agent identity and commits child results before the parent result', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend, 1);
    const events = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('turn/start');

    fixture.connection.notifyExecution('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        type: 'collabAgentToolCall',
        id: 'spawn-1',
        tool: 'spawnAgent',
        status: 'completed',
        arguments: { parent_agent_id: 'root-agent' },
        result: { agent_id: 'native-agent-7' },
      },
    });
    fixture.connection.notifyExecution('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        type: 'collabAgentToolCall',
        id: 'input-1',
        tool: 'sendInput',
        status: 'completed',
        arguments: { agent_id: 'native-agent-7' },
        result: { submission_id: 'submission-1' },
      },
    });
    fixture.connection.notifyExecution('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        type: 'collabAgentToolCall',
        id: 'wait-1',
        tool: 'wait',
        status: 'completed',
        arguments: { ids: ['native-agent-7'] },
        result: { status: { 'native-agent-7': { completed: 'Child result' } } },
      },
    });
    fixture.connection.notifyExecution('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        type: 'collabAgentToolCall',
        id: 'close-1',
        tool: 'closeAgent',
        status: 'completed',
        arguments: { agent_id: 'native-agent-7' },
        result: { status: 'closed' },
      },
    });
    fixture.connection.complete('thread-1', 'turn-1', 'Parent synthesis');

    const settled = await events;
    expect(settled).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: {
          kind: 'native-agent-observed',
          nativeAgentKey: 'native-agent-7',
          parentNativeAgentKey: 'root-agent',
        },
      }),
      expect.objectContaining({
        event: {
          kind: 'native-agent-result',
          nativeAgentKey: 'native-agent-7',
          result: expect.any(Object),
        },
      }),
    ]));
    expect(fixture.resultSinkInputs.map(input => [input.source, input.output])).toEqual([
      ['native-agent', 'Child result'],
      ['assistant', 'Parent synthesis'],
    ]);
    expect(summarizeEvents(settled)).toEqual(trace.cases.nativeAgentResult);
    expect(settled.filter(event => event.event.kind === 'terminal')).toHaveLength(1);
  });

  it('fails a required empty result and enforces the provider output bound', async () => {
    const empty = createFixture();
    const emptySession = await createSession(empty.backend, 1);
    const emptyEvents = collectEvents(emptySession.createRun(request(RUN_1, 'default')));
    await empty.connection.waitForCall('turn/start');
    empty.connection.notifyExecution('turn/completed', {
      threadId: 'thread-1',
      turn: turn('turn-1', 'completed'),
    });
    expectTerminal(await emptyEvents, 'failed', 'missing-required-result');

    const limited = createFixture({ maxResultBytes: 4 });
    const limitedSession = await createSession(limited.backend, 2);
    const limitedEvents = collectEvents(limitedSession.createRun(request(RUN_2, 'default')));
    await limited.connection.waitForCall('turn/start');
    limited.connection.complete('thread-1', 'turn-1', 'too large');
    expectTerminal(await limitedEvents, 'failed', 'output-limit');
    expect(limited.resultSinkInputs).toEqual([]);
    expect(limited.connection.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'turn/interrupt',
        params: { threadId: 'thread-1', turnId: 'turn-1' },
      }),
    ]));
  });

  it('enforces the UTF-8 output bound across streamed deltas before completion', async () => {
    const fixture = createFixture({ maxResultBytes: 4 });
    fixture.connection.beforeRequest = (method, params) => {
      if (method === 'turn/interrupt') {
        const scope = params as { threadId: string; turnId: string };
        fixture.connection.notifyExecution('turn/completed', {
          threadId: scope.threadId,
          turn: turn(scope.turnId, 'interrupted'),
        });
        return {};
      }
      return undefined;
    };
    const session = await createSession(fixture.backend, 1);
    const events = collectEvents(session.createRun(request(RUN_1, 'default')));
    await fixture.connection.waitForCall('turn/start');

    fixture.connection.notifyExecution('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'message-1',
      delta: 'ab',
    });
    fixture.connection.notifyExecution('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'message-1',
      delta: 'cde',
    });

    expectTerminal(await events, 'failed', 'output-limit');
    expect(fixture.resultSinkInputs).toEqual([]);
    expect(fixture.connection.calls.filter(call => call.method === 'turn/interrupt'))
      .toHaveLength(1);
  });

  it('arbitrates output-limit, cancellation, and timeout through one interrupt', async () => {
    const interrupt = deferred<Record<string, never>>();
    const fixture = createFixture({
      maxResultBytes: 4,
      runTimeoutMs: 5_000,
      reconciliation: {
        kind: 'turn',
        turn: turn('turn-1', 'interrupted'),
      },
    });
    fixture.connection.beforeRequest = method => method === 'turn/interrupt'
      ? interrupt.promise
      : undefined;
    const session = await createSession(fixture.backend, 1);
    const run = session.createRun(request(RUN_1, 'default'));
    const events = collectEvents(run);
    await fixture.connection.waitForCall('turn/start');

    fixture.connection.notifyExecution('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'message-1',
      delta: 'exceeds-limit',
    });
    const cancellation = run.cancel();
    fixture.scheduler.fireDelay(5_000);
    await flushPromises();
    expect(fixture.connection.calls.filter(call => call.method === 'turn/interrupt'))
      .toHaveLength(1);

    interrupt.resolve({});
    await cancellation;
    expectTerminal(await events, 'failed', 'output-limit');
    expect(fixture.connection.calls.filter(call => call.method === 'turn/interrupt'))
      .toHaveLength(1);
  });

  it('keeps output-limit precedence when shared termination recovery is unknown', async () => {
    const fixture = createFixture({
      maxResultBytes: 4,
      reconciliation: { kind: 'unknown' },
    });
    const session = await createSession(fixture.backend, 1);
    const run = session.createRun(request(RUN_1, 'default'));
    const events = collectEvents(run);
    await fixture.connection.waitForCall('turn/start');

    fixture.connection.notifyExecution('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'message-1',
      delta: 'exceeds-limit',
    });
    const cancellation = run.cancel();
    await cancellation;

    expectTerminal(await events, 'indeterminate', 'effects-unknown');
    expect(fixture.connection.calls.filter(call => call.method === 'turn/interrupt'))
      .toHaveLength(1);
  });
});

interface FixtureOptions {
  readonly invocations?: Readonly<Record<string, CodexExecutionInvocation>>;
  readonly reconciliation?: CodexTurnReconciliationEvidence;
  readonly runTimeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly connections?: readonly FakeCodexConnection[];
  readonly resultCommitOutcome?: ResultCommitOutcome;
}

function createFixture(options: FixtureOptions = {}) {
  const connections = options.connections ?? [new FakeCodexConnection()];
  const connection = connections[0];
  const scheduler = new ManualScheduler();
  const interactionIds: InteractionId[] = [];
  const resultSinkInputs: Array<{
    readonly output: string;
    readonly source: 'assistant' | 'native-agent';
  }> = [];
  let connectionFactoryCalls = 0;
  let sessionInstances = 0;
  let interactionIdsCreated = 0;
  let connectionIndex = 0;
  const defaultInvocation: CodexExecutionInvocation = {
    thread: { kind: 'new', params: THREAD_PARAMS },
    turn: { kind: 'start', params: TURN_PARAMS },
  };
  const context: CodexExecutionBackendContext = {
    connectionFactory: {
      create: () => {
        connectionFactoryCalls += 1;
        return connections[Math.min(connectionIndex++, connections.length - 1)];
      },
    },
    requestResolver: {
      resolve: async requestRef => options.invocations?.[requestRef] ?? defaultInvocation,
      resolveSteer: async () => [{ type: 'text', text: 'Continue with the correction' }],
    },
    resultSink: {
      storeResult: async input => {
        resultSinkInputs.push({ output: input.output, source: input.source });
        return options.resultCommitOutcome ?? {
          kind: 'committed',
          result: {
            resultId: `result-${resultSinkInputs.length}`,
            storage: 'projection',
          },
        };
      },
    },
    interactionBridge: {
      prepare: async ({ method }) => {
        const id = interactionId(`ix-${String(++interactionIdsCreated).padStart(32, '0')}`);
        interactionIds.push(id);
        return {
          presentationRef: `codex-${method.includes('requestUserInput') ? 'question' : 'approval'}`,
          responseIds: ['accept', 'decline', 'provider-resolved'],
          providerResolvedResponseId: 'provider-resolved',
          resolve: async (responseId: string) => ({ decision: responseId }),
          cancel: async () => ({ decision: 'provider-resolved' }),
        };
      },
    },
    turnReconcilerFactory: {
      create: () => ({
        reconcile: async () => options.reconciliation ?? { kind: 'unknown' },
      }),
    },
    defaultResumeParams: {
      experimentalRawEvents: true,
      persistExtendedHistory: true,
    },
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(
      `si-${String(++sessionInstances).padStart(32, '0')}`,
    ),
    interactionIdFactory: () => interactionIds.at(-1)
      ?? interactionId(`ix-${'f'.repeat(32)}`),
    now: () => 1,
    resultCommitTimeoutMs: 2_000,
    recoveryDelayMs: 250,
    cancellationTurnIdTimeoutMs: 500,
    runTimeoutMs: options.runTimeoutMs ?? 30_000,
    maxResultBytes: options.maxResultBytes ?? 1024,
  };
  const backend = new CodexExecutionBackend(context);
  return {
    backend,
    connection,
    connections,
    scheduler,
    interactionIds,
    resultSinkInputs,
    get connectionFactoryCalls() {
      return connectionFactoryCalls;
    },
  };
}

class FakeCodexConnection implements CodexExecutionConnection {
  initializeResult: InitializeResult | null = null;
  initializeCount = 0;
  readonly calls: Array<{ readonly method: string; readonly params: unknown }> = [];
  beforeRequest?: (method: string, params: unknown) => unknown;
  private readonly notifications = new Set<CodexExecutionNotificationListener>();
  private readonly serverRequests = new Set<CodexExecutionServerRequestHandler>();
  private readonly connectionLosses = new Set<(error?: Error) => void>();
  private threadSequence = 0;
  private turnSequence = 0;

  async initialize(): Promise<InitializeResult> {
    this.initializeCount += 1;
    this.initializeResult ??= {
      userAgent: 'codex-test',
      platformFamily: 'test',
      platformOs: 'test',
    };
    return this.initializeResult;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    const overridden = this.beforeRequest?.(method, params);
    if (overridden !== undefined) {
      return await Promise.resolve(overridden) as T;
    }
    const record = params as Record<string, unknown>;
    if (method === 'thread/start') {
      return startResult(thread(`thread-${++this.threadSequence}`)) as T;
    }
    if (method === 'thread/resume') {
      return startResult(thread(String(record.threadId))) as T;
    }
    if (method === 'thread/fork') {
      return startResult(thread(`thread-${++this.threadSequence}`)) as T;
    }
    if (method === 'turn/start') {
      return { turn: turn(`turn-${++this.turnSequence}`, 'inProgress') } as T;
    }
    if (method === 'turn/steer') {
      return { turnId: String(record.expectedTurnId) } as T;
    }
    return {} as T;
  }

  notify(): void {}

  onNotification(listener: CodexExecutionNotificationListener) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onServerRequest(handler: CodexExecutionServerRequestHandler) {
    this.serverRequests.add(handler);
    return () => this.serverRequests.delete(handler);
  }

  onConnectionLost(listener: (error?: Error) => void) {
    this.connectionLosses.add(listener);
    return () => this.connectionLosses.delete(listener);
  }

  async dispose(): Promise<void> {}

  notifyExecution(method: string, params: unknown): void {
    for (const listener of this.notifications) {
      listener(method, params);
    }
  }

  serverRequest(
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const handler = this.serverRequests.values().next().value;
    if (!handler) {
      return Promise.reject(new Error('No server request handler.'));
    }
    return handler(id, method, params);
  }

  lose(error?: Error): void {
    for (const listener of this.connectionLosses) {
      listener(error);
    }
  }

  complete(threadId: string, turnId: string, output: string): void {
    this.notifyExecution('item/agentMessage/delta', {
      threadId,
      turnId,
      itemId: 'message-1',
      delta: output,
    });
    this.notifyExecution('turn/completed', {
      threadId,
      turn: turn(turnId, 'completed'),
    });
  }

  waitForCall(method: string): Promise<void> {
    return waitFor(() => this.calls.some(call => call.method === method));
  }
}

class ManualScheduler implements CodexExecutionScheduler {
  private readonly tasks = new Map<object, { readonly callback: () => void; readonly delay: number }>();

  setTimeout(callback: () => void, delayMs: number): object {
    const handle = {};
    this.tasks.set(handle, { callback, delay: delayMs });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) {
      this.tasks.delete(handle);
    }
  }

  fireDelay(delayMs: number): void {
    const entry = [...this.tasks].find(([, task]) => task.delay === delayMs);
    if (!entry) {
      throw new Error(`No scheduled task at ${delayMs}ms.`);
    }
    this.tasks.delete(entry[0]);
    entry[1].callback();
  }
}

function request(id: typeof RUN_1, requestRef: string): ExecutionRequest {
  return {
    runId: id,
    owner: OWNER,
    resultExpectation: 'required',
    requestRef,
  };
}

function createSession(backend: CodexExecutionBackend, suffix: number): Promise<ExecutionSession> {
  return backend.createSession({
    executionSessionId: executionSessionId(
      `es-${String(suffix).padStart(32, '0')}`,
    ),
    owner: OWNER,
    backendGeneration: 1,
  });
}

function thread(id: string, turns: Turn[] = []): Thread {
  return {
    id,
    preview: '',
    ephemeral: false,
    path: `/sessions/${id}.jsonl`,
    cwd: '/vault',
    cliVersion: 'test',
    status: { type: 'active' },
    turns,
    createdAt: 1,
    updatedAt: 1,
    name: null,
    modelProvider: 'openai',
    source: 'app-server',
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
  };
}

function turn(
  id: string,
  status: Turn['status'],
  items: Turn['items'] = [],
): Turn {
  return { id, items, status, error: null };
}

function agentMessage(text: string): Turn['items'][number] {
  return {
    type: 'agentMessage',
    id: 'message-recovered',
    text,
    phase: 'final',
    memoryCitation: null,
  };
}

function startResult(nativeThread: Thread): ThreadStartResult {
  return {
    thread: nativeThread,
    model: 'gpt-5.6-codex',
    modelProvider: 'openai',
    serviceTier: null,
    cwd: '/vault',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' },
    reasoningEffort: 'high',
  };
}

async function collectEvents(run: ExecutionRun): Promise<ProviderExecutionEvent[]> {
  const events: ProviderExecutionEvent[] = [];
  for await (const event of run.events) {
    events.push(event);
  }
  return events;
}

function expectTerminal(
  events: readonly ProviderExecutionEvent[],
  terminal: string,
  reason: string,
): void {
  expect(events.filter(event => event.event.kind === 'terminal')).toEqual([
    expect.objectContaining({
      event: expect.objectContaining({ kind: 'terminal', terminal, reason }),
    }),
  ]);
}

function summarizeEvents(events: readonly ProviderExecutionEvent[]): string[] {
  return events.map(({ event }) => {
    if (event.kind === 'result') {
      return `result:${event.result.storage}`;
    }
    if (event.kind === 'terminal') {
      return `terminal:${event.terminal}:${event.reason}`;
    }
    if (event.kind === 'native-agent-observed') {
      return `native-agent-observed:${event.nativeAgentKey}`;
    }
    if (event.kind === 'native-agent-result') {
      return `native-agent-result:${event.nativeAgentKey}:${event.result.storage}`;
    }
    if (event.kind === 'native-agent-activity') {
      return `native-agent-activity:${event.nativeAgentKey}:${event.activity}`;
    }
    if (event.kind === 'native-agent-status') {
      return `native-agent-status:${event.nativeAgentKey}:${event.status}`;
    }
    if (event.kind === 'interaction-opened') {
      return `interaction-opened:${event.interaction.kind}`;
    }
    if (event.kind === 'interaction-resolved') {
      return `interaction-resolved:${event.responseId}`;
    }
    return event.kind;
  });
}

async function waitFor(predicate: () => boolean, attempts = 40): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Condition was not reached.');
}

async function flushPromises(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
