import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import trace from '@test/fixtures/provider-traces/gemini-execution.json';

import type {
  ExecutionRequest,
  RunRecoveryEvidence,
} from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpSessionNotification,
} from '@/providers/acp/types';
import {
  GeminiExecutionBackend,
  type GeminiExecutionBackendContext,
  type GeminiExecutionInvocation,
  type GeminiExecutionScheduler,
  type GeminiHistoryReplayPort,
  type GeminiPreparedInteraction,
} from '@/providers/gemini/execution/GeminiExecutionBackend';
import { GeminiHistoryReplayFence } from '@/providers/gemini/execution/GeminiHistoryReplayFence';
import { GeminiNativeHistoryReplayResolver } from '@/providers/gemini/execution/GeminiNativeHistoryReplayResolver';

describe('GeminiExecutionBackend', () => {
  it('initializes a managed client, creates a native session, and commits assistant output', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.emit(agentText('native-session', 'Gemini CLI result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    const captured = await events;
    expectTerminal(captured, 'succeeded', 'completed');
    expect(fixture.client.initializeCalls).toBe(1);
    expect(fixture.client.newRequests).toEqual([
      expect.objectContaining({ cwd: '/vault', mcpServers: [] }),
    ]);
    expect(fixture.stored).toEqual(['Gemini CLI result']);
    expect(session.getSnapshot().nativeSessionRef).toBe('native-session');
    expect(summarizeEvents(captured)).toEqual(trace.eventCases.success);
    expect(captured[0]).toEqual(expect.objectContaining({
      backendGeneration: trace.identity.backendGeneration,
      executionSessionId: trace.identity.executionSessionId,
      sessionInstanceId: trace.identity.sessionInstanceId,
      scope: expect.objectContaining({
        runId: trace.identity.runId,
        nativeRunRef: trace.identity.nativeRunId,
      }),
    }));
    const resultEvent = captured.find(event => event.event.kind === 'result');
    if (!resultEvent || resultEvent.event.kind !== 'result') throw new Error('No result event.');
    expect([
      ...(fixture.factory.inputs.length > 0 ? ['client/launch'] : []),
      ...(fixture.client.initializeCalls > 0 ? ['initialize'] : []),
      `session/new:${session.getSnapshot().nativeSessionRef}`,
      `session/prompt:${fixture.client.promptRequests[0].messageId}`,
      `result:${resultEvent.event.result.storage}`,
    ]).toEqual(trace.cases.initializeNewPrompt);
  });

  it('loads the exact saved ACP session and consumes native history replay before dispatch', async () => {
    const fixture = createFixture();
    fixture.client.omitLoadedSessionId = true;
    fixture.client.loadNotifications = [agentText('saved-session', 'restored native history')];
    const session = await createSession(fixture.backend, 'saved-session');
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('saved-session', 'resumed'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    expectTerminal(await events, 'succeeded', 'completed');
    expect(fixture.client.loadRequests).toEqual([
      expect.objectContaining({ sessionId: 'saved-session' }),
    ]);
    expect(fixture.client.newRequests).toHaveLength(0);
    expect(fixture.client.promptRequests[0].prompt).toEqual([
      { type: 'text', text: 'Do the work' },
    ]);
    expect(fixture.stored).toEqual(['resumed']);
    expect([
      `session/load:${fixture.client.loadRequests[0].sessionId}`,
      fixture.replayLog[0],
      `session/prompt:${fixture.client.promptRequests[0].messageId}`,
    ]).toEqual(trace.cases.resumeReplayFence);
  });

  it('rejects an explicit conflicting load identity without replacing the saved session', async () => {
    const fixture = createFixture({ isMissingSessionError: () => false });
    fixture.client.loadedSessionIdOverride = 'different-session';
    const session = await createSession(fixture.backend, 'saved-session');

    const captured = await collectEvents(session.createRun(request('1')));

    expectTerminal(captured, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.client.promptRequests).toHaveLength(0);
    expect(fixture.client.newRequests).toHaveLength(0);
    expect(session.getSnapshot().nativeSessionRef).toBe('saved-session');
  });

  it('replaces only an explicitly missing saved session and retains transient bindings', async () => {
    const missing = createFixture({
      isMissingSessionError: error => error instanceof Error && error.message === 'missing-session',
    });
    missing.client.loadError = new Error('missing-session');
    const missingSession = await createSession(missing.backend, 'deleted-session');
    const replacement = collectEvents(missingSession.createRun(request('1')));
    await waitFor(() => missing.client.promptRequests.length === 1);
    missing.client.emit(agentText('native-session', 'replacement'));
    missing.client.completePrompt({ stopReason: 'end_turn' });
    expectTerminal(await replacement, 'succeeded', 'completed');
    expect(missing.client.newRequests).toHaveLength(1);
    expect(missingSession.getSnapshot().nativeSessionRef).toBe('native-session');
    expect([
      `session/load:${missing.client.loadRequests[0].sessionId}`,
      `session/new:${missingSession.getSnapshot().nativeSessionRef}`,
      `prompt:${missing.client.promptRequests[0].prompt[0]?.type === 'text'
        ? missing.client.promptRequests[0].prompt[0].text
        : 'non-text'}`,
    ]).toEqual(trace.cases.missingSessionReplacement);

    const transient = createFixture({ isMissingSessionError: () => false });
    transient.client.loadError = new Error('authentication failed');
    const transientSession = await createSession(transient.backend, 'saved-session');
    const rejected = await collectEvents(transientSession.createRun(request('1')));
    expectTerminal(rejected, 'invalidated', 'pre-dispatch-rejected');
    expect(transient.client.newRequests).toHaveLength(0);
    expect(transientSession.getSnapshot().nativeSessionRef).toBe('saved-session');
    expect([
      `session/load:${transient.client.loadRequests[0].sessionId}`,
      ...summarizeEvents(rejected).filter(entry => entry.startsWith('terminal:')),
    ]).toEqual(trace.cases.transientLoadFailure);
  });

  it('lets native load confirm a missing session but rejects success without replay inventory', async () => {
    const testRoot = await fs.mkdtemp(path.join(tmpdir(), 'grimoire-gemini-missing-'));
    try {
      const historyReplay = new GeminiHistoryReplayFence(
        new GeminiNativeHistoryReplayResolver({
          globalGeminiDir: path.join(testRoot, '.gemini'),
        }),
        new FakeScheduler(),
        500,
      );
      const fixture = createFixture({
        historyReplay,
        isMissingSessionError: error => error instanceof Error
          && error.message === 'missing-session',
      });
      fixture.client.loadError = new Error('missing-session');
      const session = await createSession(fixture.backend, 'deleted-session');
      const events = collectEvents(session.createRun(request('1')));
      await waitForIo(() => fixture.client.promptRequests.length === 1);
      fixture.client.emit(agentText('native-session', 'replacement'));
      fixture.client.completePrompt({ stopReason: 'end_turn' });

      expectTerminal(await events, 'succeeded', 'completed');
      expect(fixture.client.loadRequests).toHaveLength(1);
      expect(fixture.client.newRequests).toHaveLength(1);
      expect(session.getSnapshot().nativeSessionRef).toBe('native-session');

      const unavailable = createFixture({
        historyReplay: new GeminiHistoryReplayFence(
          new GeminiNativeHistoryReplayResolver({
            globalGeminiDir: path.join(testRoot, '.gemini'),
          }),
          new FakeScheduler(),
          500,
        ),
        isMissingSessionError: () => false,
      });
      const unavailableSession = await createSession(unavailable.backend, 'saved-session');
      const rejected = await collectEvents(unavailableSession.createRun(request('2')));
      expectTerminal(rejected, 'invalidated', 'pre-dispatch-rejected');
      expect(unavailable.client.loadRequests).toHaveLength(1);
      expect(unavailable.client.promptRequests).toHaveLength(0);
      expect(unavailable.client.closeCalls).toBe(1);
    } finally {
      await fs.rm(testRoot, { recursive: true, force: true });
    }
  });

  it('retries a closed transport only before observable output', async () => {
    const first = new FakeManagedAcpClient('native-session');
    const second = new FakeManagedAcpClient('native-session');
    const fixture = createFixture({ clients: [first, second] });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => first.promptRequests.length === 1);

    first.loseConnection();
    await waitFor(() => second.promptRequests.length === 1);
    second.emit(agentText('native-session', 'retried safely'));
    second.completePrompt({ stopReason: 'end_turn' });

    expectTerminal(await events, 'succeeded', 'completed');
    expect(fixture.factory.inputs).toHaveLength(2);
    expect(second.loadRequests).toEqual([expect.objectContaining({ sessionId: 'native-session' })]);
    expect([
      'client/launch',
      `session/prompt:${first.promptRequests[0].messageId}`,
      ...(first.closeCalls > 0 ? ['client/close'] : []),
      'client/launch',
      `session/load:${second.loadRequests[0].sessionId}`,
      `session/prompt:${second.promptRequests[0].messageId}`,
    ]).toEqual(trace.cases.retryBeforeOutput);
  });

  it('reconciles instead of redispatching after observable output', async () => {
    const fixture = createFixture({
      reconciliation: {
        kind: 'terminal',
        terminal: {
          kind: 'succeeded',
          reason: 'completed',
          occurredAt: 10,
          resultRef: { resultId: 'native-result', storage: 'provider-native' },
        },
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'partial'));
    fixture.client.loseConnection();

    const captured = await events;
    expect(captured.map(event => event.event.kind)).toEqual([
      'run-started',
      'connection-lost',
      'recovery-started',
      'result',
      'terminal',
    ]);
    expectTerminal(captured, 'succeeded', 'completed');
    expect(fixture.factory.inputs).toHaveLength(1);
    expect(summarizeEvents(captured)).toEqual(trace.eventCases.recoveryAfterOutput);
  });

  it('reconciles instead of redispatching after observable tool activity', async () => {
    const second = new FakeManagedAcpClient('native-session');
    const fixture = createFixture({
      clients: [new FakeManagedAcpClient('native-session'), second],
      reconciliation: {
        kind: 'terminal',
        terminal: { kind: 'interrupted', reason: 'known-process-exit', occurredAt: 10 },
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(toolCall('native-session', 'tool-1'));
    fixture.client.loseConnection();

    const captured = await events;
    expectTerminal(captured, 'interrupted', 'known-process-exit');
    expect(fixture.factory.inputs).toHaveLength(1);
    expect(fixture.client.promptRequests).toHaveLength(1);
    expect(second.promptRequests).toHaveLength(0);
  });

  it('rejects conflicting provider run identity without changing the event scope', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'completed output'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'different-message' });

    const captured = await events;
    expectTerminal(captured, 'indeterminate', 'effects-unknown');
    expect(new Set(captured.map(event => (
      event.scope.kind === 'run' ? event.scope.nativeRunRef : undefined
    )))).toEqual(new Set(['message-1']));
    expect(fixture.stored).toHaveLength(0);
  });

  it('restarts only for startup configuration changes and reloads the native session', async () => {
    const first = new FakeManagedAcpClient('native-session');
    const second = new FakeManagedAcpClient('native-session');
    const fixture = createFixture({
      clients: [first, second],
      requestResolve: async requestRef => requestRef === 'first'
        ? invocation()
        : { ...invocation(), restartFingerprint: 'gemini-v2', messageId: 'message-2' },
    });
    const session = await createSession(fixture.backend);
    const firstEvents = collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => first.promptRequests.length === 1);
    first.emit(agentText('native-session', 'first'));
    first.completePrompt({ stopReason: 'end_turn' });
    expectTerminal(await firstEvents, 'succeeded', 'completed');

    const secondEvents = collectEvents(session.createRun(request('2', 'second')));
    await waitFor(() => second.promptRequests.length === 1);
    second.emit(agentText('native-session', 'second'));
    second.completePrompt({ stopReason: 'end_turn' });
    expectTerminal(await secondEvents, 'succeeded', 'completed');

    expect([
      ...(first.closeCalls > 0 ? ['client/close'] : []),
      ...(fixture.factory.inputs.length > 1 ? ['client/launch'] : []),
      `session/load:${second.loadRequests[0].sessionId}`,
      `session/prompt:${second.promptRequests[0].messageId}`,
    ]).toEqual(trace.cases.restartConfiguration);
  });

  it('round-trips a durable ACP approval and resolves retries idempotently', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1'));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    const permission = fixture.client.requestPermission(permissionRequest('native-session'));
    await waitFor(() => observed.some(event => event.event.kind === 'interaction-opened'));
    const opened = observed.find(event => event.event.kind === 'interaction-opened');
    if (!opened || opened.event.kind !== 'interaction-opened') throw new Error('No interaction.');
    const resolution = {
      interactionId: opened.event.interaction.interactionId,
      responseId: 'allow-once',
      resolvedAt: 1,
    };

    await Promise.all([fixture.backend.resolve(resolution), fixture.backend.resolve(resolution)]);

    await expect(permission).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    expect(fixture.interactionResolveCalls).toBe(1);
    expect(observed).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({ kind: 'interaction-resolved', responseId: 'allow-once' }),
    }));
    expect(summarizeEvents(observed).filter(entry => entry.startsWith('interaction-')))
      .toEqual(trace.cases.approval);
  });

  it('records native usage without treating Gemini commands or agents as runtime capabilities', async () => {
    let fixture!: ReturnType<typeof createFixture>;
    fixture = createFixture({
      dynamicApply: async ({ client }) => {
        (client as FakeManagedAcpClient).emit(agentText('native-session', 'control output'));
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.emit(commandsUpdate('native-session'));
    fixture.client.emit(usageUpdate('native-session'));
    fixture.client.emit(agentText('native-session', 'Parent result'));
    fixture.client.completePrompt({
      stopReason: 'end_turn',
      userMessageId: 'message-1',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });

    const captured = await events;
    expect(fixture.stored).toEqual(['Parent result']);
    expect(summarizeEvents(captured)).toEqual(trace.eventCases.success);
    expect(fixture.usageLog).toEqual(trace.cases.usage);
  });

  it('still releases the managed process when optional usage cleanup fails', async () => {
    const fixture = createFixture({
      usageDetach: () => { throw new Error('usage projection unavailable'); },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'done'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    expectTerminal(await events, 'succeeded', 'completed');

    await fixture.backend.dispose();

    expect(fixture.client.closeCalls).toBe(1);
  });

  it('cancels a permission prepared after its bounded request already failed closed', async () => {
    const preparation = deferred<GeminiPreparedInteraction>();
    const cancel = jest.fn(async () => ({ outcome: { outcome: 'cancelled' as const } }));
    const fixture = createFixture({ interactionPrepare: () => preparation.promise });
    const session = await createSession(fixture.backend);
    session.createRun(request('1'));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    const permission = fixture.client.requestPermission(permissionRequest('native-session'));
    await flushPromises();
    fixture.scheduler.fireLast();
    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } });

    preparation.resolve({
      kind: 'approval',
      presentationRef: 'late-permission',
      responseIds: ['deny-once'],
      providerResolvedResponseId: 'deny-once',
      resolve: async () => ({ outcome: { outcome: 'cancelled' } }),
      cancel,
    });
    await flushPromises();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on output overflow and never commits the truncated result', async () => {
    const fixture = createFixture({ maxResultBytes: 4 });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'too large'));
    await flushPromises();

    expectTerminal(await events, 'failed', 'output-limit');
    expect(fixture.client.cancelledSessions).toEqual(['native-session']);
    expect(fixture.stored).toHaveLength(0);
  });

  it('lets an already-started result commit win over a later cancellation', async () => {
    const commit = deferred<ResultCommitOutcome>();
    let commitStarted = false;
    const fixture = createFixture({
      resultStore: async () => {
        commitStarted = true;
        return commit.promise;
      },
    });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request('1'));
    const events = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'committed'));
    fixture.client.completePrompt({ stopReason: 'end_turn' });
    await waitFor(() => commitStarted);

    const cancellation = run.cancel();
    expect(fixture.client.cancelledSessions).toHaveLength(0);
    commit.resolve({
      kind: 'committed',
      result: { resultId: 'committed-result', storage: 'projection' },
    });

    await cancellation;
    expectTerminal(await events, 'succeeded', 'completed');
  });

  it('keeps an authoritative provider completion that wins the cancellation race', async () => {
    const fixture = createFixture({
      reconciliation: {
        kind: 'terminal',
        terminal: {
          kind: 'succeeded',
          reason: 'completed',
          occurredAt: 10,
          resultRef: { resultId: 'provider-result', storage: 'provider-native' },
        },
      },
    });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request('1'));
    const events = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);

    await run.cancel();

    const captured = await events;
    expectTerminal(captured, 'succeeded', 'completed');
    expect(captured).toContainEqual(expect.objectContaining({
      event: {
        kind: 'result',
        result: { resultId: 'provider-result', storage: 'provider-native' },
      },
    }));
  });

  it('rejects dynamic configuration before prompt dispatch', async () => {
    const fixture = createFixture({
      dynamicApply: async () => { throw new Error('configuration failed'); },
    });
    const session = await createSession(fixture.backend);
    const captured = await collectEvents(session.createRun(request('1')));

    expectTerminal(captured, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.client.promptRequests).toHaveLength(0);
  });

  it('invalidates a connection loss during pre-dispatch control without entering recovery', async () => {
    const fixture = createFixture({
      dynamicApply: ({ client, signal }) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(
          signal.reason instanceof Error ? signal.reason : new Error('control turn aborted'),
        ), { once: true });
        (client as FakeManagedAcpClient).emitConnectionLoss();
      }),
    });
    const session = await createSession(fixture.backend);

    const captured = await collectEvents(session.createRun(request('1')));

    expect(summarizeEvents(captured)).toEqual([
      'terminal:invalidated:pre-dispatch-rejected',
    ]);
    expect(fixture.client.promptRequests).toHaveLength(0);
    expect(fixture.client.closeCalls).toBe(1);
  });

  it('closes a client whose pre-dispatch control turn exceeds its bound', async () => {
    const fixture = createFixture({
      dynamicApply: () => new Promise<void>(() => undefined),
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await flushPromises();
    fixture.scheduler.fireLast();

    expectTerminal(await events, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.client.promptRequests).toHaveLength(0);
    expect(fixture.client.closeCalls).toBe(1);
  });

  it('closes a loaded session whose native-history replay never reaches its bound', async () => {
    const fixture = createFixture({
      historyReplaySettle: () => new Promise<void>(() => undefined),
    });
    const session = await createSession(fixture.backend, 'saved-session');
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.loadRequests.length === 1);
    fixture.scheduler.fireLast();

    expectTerminal(await events, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.client.promptRequests).toHaveLength(0);
    expect(fixture.client.closeCalls).toBe(1);
  });

  it('closes a client when native session loading never settles', async () => {
    const fixture = createFixture();
    fixture.client.loadSessionGate = new Promise<void>(() => undefined);
    const session = await createSession(fixture.backend, 'saved-session');
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.loadRequests.length === 1);
    fixture.scheduler.fireLast();

    expectTerminal(await events, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.client.promptRequests).toHaveLength(0);
    expect(fixture.client.closeCalls).toBe(1);
  });

  it('does not silently relinquish an unconfirmed managed process on disposal', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'done'));
    fixture.client.completePrompt({ stopReason: 'end_turn' });
    expectTerminal(await events, 'succeeded', 'completed');
    fixture.client.closeOutcome = 'unconfirmed';

    await expect(fixture.backend.dispose()).rejects.toThrow('termination was not confirmed');
  });

  it('quarantines an unconfirmed client and admits no second process tree', async () => {
    const first = new FakeManagedAcpClient('native-session');
    first.closeOutcomes = ['unconfirmed', 'unconfirmed', 'confirmed'];
    const second = new FakeManagedAcpClient('native-session');
    const fixture = createFixture({
      clients: [first, second],
      reconciliation: {
        kind: 'terminal',
        terminal: { kind: 'interrupted', reason: 'known-process-exit', occurredAt: 10 },
      },
    });
    const session = await createSession(fixture.backend);
    const firstEvents = collectEvents(session.createRun(request('1')));
    await waitFor(() => first.promptRequests.length === 1);
    first.emit(agentText('native-session', 'partial'));
    first.loseConnection();
    expectTerminal(await firstEvents, 'interrupted', 'known-process-exit');

    const blocked = await collectEvents(session.createRun(request('2')));
    expectTerminal(blocked, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.factory.inputs).toHaveLength(1);

    const admitted = collectEvents(session.createRun(request('3')));
    await waitFor(() => second.promptRequests.length === 1);
    second.emit(agentText('native-session', 'recovered ownership'));
    second.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    expectTerminal(await admitted, 'succeeded', 'completed');
    expect(fixture.factory.inputs).toHaveLength(2);
  });

  it('accepts factory-level cleanup only after it confirms retained process ownership', async () => {
    const client = new FakeManagedAcpClient('native-session');
    const dispose = jest.fn(async () => 'confirmed' as const);
    const fixture = createFixture({
      clients: [client],
      clientFactory: {
        create: async (input) => {
          client.permissionHandler = input.requestPermission;
          return client;
        },
        dispose,
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => client.promptRequests.length === 1);
    client.emit(agentText('native-session', 'done'));
    client.completePrompt({ stopReason: 'end_turn' });
    expectTerminal(await events, 'succeeded', 'completed');
    client.closeOutcome = 'unconfirmed';

    await expect(fixture.backend.dispose()).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps ownership of a client that appears while pre-dispatch unload is in progress', async () => {
    const client = new FakeManagedAcpClient('native-session');
    const creation = deferred<ManagedAcpClient>();
    let factoryInput: ManagedAcpClientFactoryInput | undefined;
    const factory: ManagedAcpClientFactory = {
      create: input => {
        factoryInput = input;
        client.permissionHandler = input.requestPermission;
        return creation.promise;
      },
    };
    const fixture = createFixture({ clients: [client], clientFactory: factory });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => factoryInput !== undefined);

    const disposal = fixture.backend.dispose();
    expect(factoryInput?.signal.aborted).toBe(true);
    creation.resolve(client);

    await expect(disposal).resolves.toBeUndefined();
    expectTerminal(await events, 'cancelled', 'cancellation-confirmed');
    expect(client.promptRequests).toHaveLength(0);
    expect(client.closeCalls).toBeGreaterThanOrEqual(1);
  });

  it('fences a cancelled native-session preparation before admitting the next run', async () => {
    const first = new FakeManagedAcpClient('stale-session');
    const second = new FakeManagedAcpClient('current-session');
    const firstSession = deferred<void>();
    first.newSessionGate = firstSession.promise;
    const fixture = createFixture({ clients: [first, second] });
    const session = await createSession(fixture.backend);
    const firstRun = session.createRun(request('1'));
    const firstEvents = collectEvents(firstRun);
    await waitFor(() => first.newRequests.length === 1);

    await firstRun.cancel();
    const secondEvents = collectEvents(session.createRun(request('2')));
    firstSession.resolve();
    await waitFor(() => second.promptRequests.length === 1);
    second.emit(agentText('current-session', 'current result'));
    second.completePrompt({ stopReason: 'end_turn' });

    expectTerminal(await firstEvents, 'cancelled', 'cancellation-confirmed');
    expectTerminal(await secondEvents, 'succeeded', 'completed');
    expect(first.promptRequests).toHaveLength(0);
    expect(session.getSnapshot().nativeSessionRef).toBe('current-session');
  });

});

function createFixture(options: {
  readonly clients?: FakeManagedAcpClient[];
  readonly clientFactory?: ManagedAcpClientFactory;
  readonly reconciliation?: RunRecoveryEvidence;
  readonly isMissingSessionError?: (error: unknown) => boolean;
  readonly maxResultBytes?: number;
  readonly resultStore?: (input: { readonly output: string }) => Promise<ResultCommitOutcome>;
  readonly dynamicApply?: GeminiExecutionBackendContext['dynamicApplier']['apply'];
  readonly interactionPrepare?: () => Promise<GeminiPreparedInteraction>;
  readonly historyReplay?: GeminiHistoryReplayPort;
  readonly historyReplaySettle?: () => Promise<void>;
  readonly usageDetach?: () => void;
  readonly requestResolve?: (requestRef: string) => Promise<GeminiExecutionInvocation>;
} = {}) {
  const clients = options.clients ?? [new FakeManagedAcpClient('native-session')];
  const factory = new FakeClientFactory(clients);
  const scheduler = new FakeScheduler();
  const stored: string[] = [];
  const replayLog: string[] = [];
  const usageLog: string[] = [];
  let interactionResolveCalls = 0;
  let replaySession: string | undefined;
  const backend = new GeminiExecutionBackend({
    clientFactory: options.clientFactory ?? factory,
    requestResolver: { resolve: options.requestResolve ?? (async () => invocation()) },
    dynamicApplier: { apply: options.dynamicApply ?? (async () => undefined) },
    interactionBridge: {
      prepare: options.interactionPrepare ?? (async () => ({
        kind: 'approval',
        presentationRef: 'permission-presentation',
        responseIds: ['allow-once', 'deny-once'],
        providerResolvedResponseId: 'deny-once',
        resolve: async responseId => {
          interactionResolveCalls += 1;
          return { outcome: { outcome: 'selected', optionId: responseId } };
        },
        cancel: async () => ({ outcome: { outcome: 'cancelled' } }),
      })),
    },
    resultSink: {
      storeResult: async ({ output }) => {
        if (options.resultStore) return options.resultStore({ output });
        stored.push(output);
        return {
          kind: 'committed',
          result: { resultId: `result-${stored.length}`, storage: 'projection' },
        };
      },
    },
    reconciler: {
      reconcile: async () => options.reconciliation ?? { kind: 'stopped-safe' },
    },
    historyReplay: options.historyReplay ?? {
      begin: async input => { replaySession = input.sessionId; },
      observe: notification => {
        if (notification.sessionId !== replaySession) return false;
        replayLog.push('history:replay-consumed');
        return true;
      },
      settle: options.historyReplaySettle ?? (async () => { replaySession = undefined; }),
      clear: sessionId => {
        if (replaySession === sessionId) replaySession = undefined;
      },
    },
    usage: {
      attach: () => undefined,
      detach: options.usageDetach ?? (() => undefined),
      recordNotification: notification => {
        if (notification.update.sessionUpdate === 'usage_update') {
          usageLog.push('usage:notification');
        }
      },
      recordTurn: async input => {
        usageLog.push('usage:turn-projection');
      },
    },
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'a'.repeat(32)}`),
    interactionIdFactory: () => interactionId(`ix-${'b'.repeat(32)}`),
    now: () => 1,
    controlTimeoutMs: 500,
    resultCommitTimeoutMs: 500,
    recoveryTimeoutMs: 500,
    runTimeoutMs: 60_000,
    maxResultBytes: options.maxResultBytes ?? 1024,
    ...(options.isMissingSessionError
      ? { isMissingSessionError: options.isMissingSessionError }
      : {}),
  });
  return {
    backend,
    client: clients[0],
    clients,
    factory,
    scheduler,
    stored,
    replayLog,
    usageLog,
    get interactionResolveCalls() { return interactionResolveCalls; },
  };
}

class FakeClientFactory {
  readonly inputs: ManagedAcpClientFactoryInput[] = [];
  private index = 0;

  constructor(private readonly clients: FakeManagedAcpClient[]) {}

  async create(input: ManagedAcpClientFactoryInput): Promise<FakeManagedAcpClient> {
    this.inputs.push(input);
    const client = this.clients[this.index++];
    if (!client) throw new Error('No fake ACP client available.');
    client.permissionHandler = input.requestPermission;
    return client;
  }
}

class FakeManagedAcpClient implements ManagedAcpClient {
  initializeCalls = 0;
  readonly newRequests: Parameters<ManagedAcpClient['newSession']>[0][] = [];
  readonly loadRequests: Parameters<ManagedAcpClient['loadSession']>[0][] = [];
  readonly promptRequests: Parameters<ManagedAcpClient['prompt']>[0][] = [];
  readonly cancelledSessions: string[] = [];
  readonly notificationListeners = new Set<(notification: AcpSessionNotification) => void>();
  readonly lossListeners = new Set<(error?: Error) => void>();
  loadNotifications: AcpSessionNotification[] = [];
  permissionHandler?: ManagedAcpClientFactoryInput['requestPermission'];
  loadError?: Error;
  loadSessionGate?: Promise<void>;
  omitLoadedSessionId = false;
  loadedSessionIdOverride?: string;
  closeCalls = 0;
  closeOutcome: 'confirmed' | 'unconfirmed' = 'confirmed';
  closeOutcomes: Array<'confirmed' | 'unconfirmed'> = [];
  newSessionGate?: Promise<void>;
  private promptCompletion = deferred<AcpPromptResponse>();

  constructor(private readonly createdSessionId: string) {}

  async initialize(): Promise<void> { this.initializeCalls += 1; }
  async newSession(request: Parameters<ManagedAcpClient['newSession']>[0]) {
    this.newRequests.push(request);
    await this.newSessionGate;
    return { sessionId: this.createdSessionId };
  }
  async loadSession(request: Parameters<ManagedAcpClient['loadSession']>[0]) {
    this.loadRequests.push(request);
    await this.loadSessionGate;
    if (this.loadError) throw this.loadError;
    for (const notification of this.loadNotifications) this.emit(notification);
    if (this.omitLoadedSessionId) return {} as Awaited<ReturnType<ManagedAcpClient['loadSession']>>;
    if (this.loadedSessionIdOverride) return { sessionId: this.loadedSessionIdOverride };
    return { sessionId: request.sessionId };
  }
  prompt(request: Parameters<ManagedAcpClient['prompt']>[0]) {
    this.promptRequests.push(request);
    return this.promptCompletion.promise;
  }
  async setConfigOption() { return { configOptions: [] }; }
  cancel(sessionId: string): void { this.cancelledSessions.push(sessionId); }
  onSessionNotification(listener: (notification: AcpSessionNotification) => void) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }
  onConnectionLost(listener: (error?: Error) => void) {
    this.lossListeners.add(listener);
    return () => this.lossListeners.delete(listener);
  }
  async close(): Promise<'confirmed' | 'unconfirmed'> {
    this.closeCalls += 1;
    return this.closeOutcomes.shift() ?? this.closeOutcome;
  }
  emit(notification: AcpSessionNotification): void {
    for (const listener of this.notificationListeners) listener(notification);
  }
  completePrompt(response: AcpPromptResponse): void { this.promptCompletion.resolve(response); }
  loseConnection(): void {
    const error = this.emitConnectionLoss();
    this.promptCompletion.reject(error);
  }
  emitConnectionLoss(): Error {
    const error = new Error('transport closed');
    for (const listener of this.lossListeners) listener(error);
    return error;
  }
  requestPermission(request: AcpRequestPermissionRequest) {
    if (!this.permissionHandler) throw new Error('No permission handler.');
    return this.permissionHandler(request);
  }
}

class FakeScheduler implements GeminiExecutionScheduler {
  private readonly tasks = new Map<object, () => void>();
  setTimeout(callback: () => void): object {
    const handle = {};
    this.tasks.set(handle, callback);
    return handle;
  }
  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) this.tasks.delete(handle);
  }
  fireNext(): void {
    const task = this.tasks.entries().next().value;
    if (!task) throw new Error('No timer.');
    this.tasks.delete(task[0]);
    task[1]();
  }
  fireLast(): void {
    const task = [...this.tasks.entries()].at(-1);
    if (!task) throw new Error('No timer.');
    this.tasks.delete(task[0]);
    task[1]();
  }
}

function invocation(): GeminiExecutionInvocation {
  return {
    startupRef: 'gemini-startup',
    restartFingerprint: 'gemini-v1',
    cwd: '/vault',
    prompt: [{ type: 'text', text: 'Do the work' }],
    replacementPrompt: [{ type: 'text', text: 'Rebuilt hidden context\n\nDo the work' }],
    mcpServers: [],
    messageId: 'message-1',
  };
}

function request(suffix: string, requestRef = 'request-ref'): ExecutionRequest {
  return {
    runId: runId(`run-${suffix.repeat(32)}`),
    owner: { kind: 'conversation', ownerId: 'gemini-tests' },
    resultExpectation: 'required',
    requestRef,
  };
}

async function createSession(backend: GeminiExecutionBackend, nativeSessionRef?: string) {
  return backend.createSession({
    executionSessionId: executionSessionId(`es-${'d'.repeat(32)}`),
    owner: { kind: 'conversation', ownerId: 'gemini-tests' },
    backendGeneration: 1,
    ...(nativeSessionRef ? { nativeSessionRef } : {}),
  });
}

function agentText(sessionId: string, text: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
      messageId: 'assistant-message',
    },
  };
}

function commandsUpdate(sessionId: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: '/review', description: 'Review the current work' }],
    },
  };
}

function usageUpdate(sessionId: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'usage_update',
      size: 1_000_000,
      used: 250_000,
      cost: null,
    },
  };
}

function permissionRequest(sessionId: string): AcpRequestPermissionRequest {
  return {
    sessionId,
    options: [
      { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
      { optionId: 'deny-once', kind: 'reject_once', name: 'Deny' },
    ],
    toolCall: { toolCallId: 'tool-1', title: 'Write', rawInput: { path: 'note.md' } },
  };
}

function toolCall(sessionId: string, toolCallId: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'Write file',
      status: 'in_progress',
    },
  };
}

async function collectEvents(run: { readonly events: AsyncIterable<ProviderExecutionEvent> }) {
  const events: ProviderExecutionEvent[] = [];
  for await (const event of run.events) events.push(event);
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, attempts = 80): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition not reached.');
}

async function waitForIo(predicate: () => boolean, attempts = 80): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('I/O condition not reached.');
}

async function flushPromises(turns = 12): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function summarizeEvents(events: readonly ProviderExecutionEvent[]): string[] {
  return events.flatMap(({ event }) => {
    if (event.kind === 'run-started' || event.kind === 'connection-lost' || event.kind === 'recovery-started') {
      return [event.kind];
    }
    if (event.kind === 'result') return [`result:${event.result.storage}`];
    if (event.kind === 'terminal') return [`terminal:${event.terminal}:${event.reason}`];
    if (event.kind === 'interaction-opened') return [`interaction-opened:${event.interaction.kind}`];
    if (event.kind === 'interaction-resolved') return [`interaction-resolved:${event.responseId}`];
    if (event.kind === 'tool-activity') return [`tool-activity:${event.toolCallId}`];
    return [];
  });
}
