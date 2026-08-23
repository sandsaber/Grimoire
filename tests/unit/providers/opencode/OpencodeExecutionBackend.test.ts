import trace from '@test/fixtures/provider-traces/opencode-execution.json';

import type {
  ExecutionRequest,
  RunRecoveryEvidence,
  RunRecoveryQuery,
} from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';
import { AcpSpawnError } from '@/providers/acp/AcpSpawnError';
import { acpCancellationEvidence } from '@/providers/acp/execution/acpCancellationEvidence';
import {
  type ManagedAcpClient,
  type ManagedAcpClientFactory,
  type ManagedAcpClientFactoryInput,
  ManagedAcpTerminationUnconfirmedError,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpSessionNotification,
} from '@/providers/acp/types';
import {
  OpencodeExecutionBackend,
  type OpencodeExecutionInvocation,
  type OpencodeExecutionScheduler,
  type OpencodePreparedInteraction,
} from '@/providers/opencode/execution/OpencodeExecutionBackend';

describe('OpencodeExecutionBackend', () => {
  it('initializes a managed client, creates a native session, and commits assistant output', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.emit(agentText('native-session', 'OpenCode result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    const captured = await events;
    expectTerminal(captured, 'succeeded', 'completed');
    expect(fixture.client.initializeCalls).toBe(1);
    expect(fixture.client.newRequests).toEqual([
      expect.objectContaining({ cwd: '/vault', mcpServers: [] }),
    ]);
    expect(fixture.stored).toEqual(['OpenCode result']);
    expect(session.getSnapshot().nativeSessionRef).toBe('native-session');
    expect(summarizeEvents(captured)).toEqual(trace.eventCases.success);
    // The first event that knows the dispatch identity, which is not the first
    // event: what the session opened with is answered before the prompt is
    // sent, so there is no native run to name yet.
    expect(captured.find(event => event.event.kind === 'run-started')).toEqual(
      expect.objectContaining({
        backendGeneration: trace.identity.backendGeneration,
        executionSessionId: trace.identity.executionSessionId,
        sessionInstanceId: trace.identity.sessionInstanceId,
        scope: expect.objectContaining({
          runId: trace.identity.runId,
          nativeRunRef: trace.identity.nativeRunId,
        }),
      }),
    );
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

  it('forwards every session update the surface is drawn from, including the ones it never reads', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    // Two the backend derives nothing from: without the forward, a tab draws no
    // plan and no context badge because nothing else carries them.
    fixture.client.emit(planUpdate('native-session'));
    fixture.client.emit(usageUpdate('native-session'));
    fixture.client.emit(agentText('native-session', 'OpenCode result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    const captured = await events;
    expect(contentPayloads(captured)).toEqual([
      // What the session opened with comes first: it is answered before the
      // prompt is even sent.
      { kind: 'session-config', session: { sessionId: 'native-session' } },
      { kind: 'session-update', notification: planUpdate('native-session') },
      { kind: 'session-update', notification: usageUpdate('native-session') },
      { kind: 'session-update', notification: agentText('native-session', 'OpenCode result') },
      {
        kind: 'prompt-result',
        response: { stopReason: 'end_turn', userMessageId: 'message-1' },
      },
    ]);
  });

  it('forwards the configuration the session was opened with', async () => {
    const fixture = createFixture();
    fixture.client.newSessionConfigOptions = [{ id: 'model', name: 'Model' }];
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'OpenCode result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    // The models and the modes a tab can choose from are answered by
    // `session/new` and by nothing afterwards; a selector fed only from later
    // updates starts empty on a fresh vault.
    expect(contentPayloads(await events)).toContainEqual({
      kind: 'session-config',
      session: expect.objectContaining({
        sessionId: 'native-session',
        configOptions: [{ id: 'model', name: 'Model' }],
      }),
    });
  });

  it('forwards the configuration again when a reconnect loads the session', async () => {
    const second = new FakeManagedAcpClient('native-session');
    second.newSessionConfigOptions = [{ id: 'model', name: 'Model' }];
    const fixture = createFixture({ clients: [new FakeManagedAcpClient('native-session'), second] });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.loseConnection();
    await waitFor(() => second.promptRequests.length === 1);
    second.emit(agentText('native-session', 'recovered'));
    second.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    // A reloaded session answers with its own configuration, and the tab that
    // reconnected must be told rather than keep the dead session's.
    const configs = contentPayloads(await events)
      .filter(payload => (payload as { kind?: string }).kind === 'session-config');
    expect(configs).toHaveLength(2);
  });

  it('carries an assistant chunk to the surface before the text the kernel mirrors', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'OpenCode result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    // The message the answer hangs on is opened by the forwarded update, so a
    // delta that arrived first would be appended to nothing.
    expect(summarizeEvents(await events)).toEqual(trace.eventCases.success);
  });

  it('forwards nothing a turn cancelled for overflow will not commit', async () => {
    const fixture = createFixture({ maxResultBytes: 4 });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'too large'));
    await flushPromises();

    // A reader only ever sees a prefix of what will be committed, and the
    // content channel is a reader like any other. What the session opened with
    // is still carried: it is not the text that overflowed.
    expect(contentPayloads(await events).filter(
      payload => (payload as { kind?: string }).kind === 'session-update',
    )).toEqual([]);
  });

  it('loads the exact saved ACP session before dispatch', async () => {
    const fixture = createFixture();
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
    expect([
      'initialize',
      `session/load:${fixture.client.loadRequests[0].sessionId}`,
      `session/prompt:${fixture.client.promptRequests[0].messageId}`,
    ]).toEqual(trace.cases.resumeLoad);
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
      // What the session was opened with, which is answered before the run is
      // even dispatched.
      'provider-content',
      'run-started',
      // The partial text reaches the reader before the connection drops, which
      // is the point of streaming it: a turn interrupted mid-answer still shows
      // what was said — as the update the surface draws the message from, and
      // as the delta core reads.
      'provider-content',
      'output-delta',
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
    // Only the configuration the session opened with names nothing, having
    // been emitted before the turn was dispatched; no event names a second
    // native run.
    expect(new Set(captured.flatMap(event => (
      event.scope.kind === 'run' && event.scope.nativeRunRef ? [event.scope.nativeRunRef] : []
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
        : { ...invocation(), restartFingerprint: 'opencode-v2', messageId: 'message-2' },
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

  it('cancels a permission prepared after its bounded request already failed closed', async () => {
    const preparation = deferred<OpencodePreparedInteraction>();
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
    // The turn this cancel is racing had already finished, so the agent answers
    // the turn it completed rather than the one it was told to stop.
    fixture.client.cancelStopReason = 'end_turn';

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

  it('aborts and awaits an isolated auxiliary operation during backend disposal', async () => {
    let observedSignal: AbortSignal | undefined;
    const fixture = createFixture({
      auxiliaryExecute: (_requestRef, signal) => {
        observedSignal = signal;
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('auxiliary aborted')), {
            once: true,
          });
        });
      },
    });
    const auxiliary = fixture.backend.runAuxiliaryQuery('aux-ref');
    await waitFor(() => observedSignal !== undefined);

    await expect(fixture.backend.dispose()).resolves.toBeUndefined();
    await expect(auxiliary).rejects.toThrow('auxiliary aborted');
    expect(observedSignal?.aborted).toBe(true);
  });
  it('carries the caller\'s cancellation into the auxiliary turn', async () => {
    // A dialog the user closed has to stop the work, not only stop waiting for
    // it: an auxiliary turn holds a CLI process, and one nobody is waiting for
    // goes on spending the account's tokens until it finishes.
    let observedSignal: AbortSignal | undefined;
    const fixture = createFixture({
      auxiliaryExecute: (_requestRef, signal) => {
        observedSignal = signal;
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('the caller left')), { once: true });
        });
      },
    });
    const caller = new AbortController();

    const auxiliary = fixture.backend.runAuxiliaryQuery('aux-ref', { signal: caller.signal });
    await waitFor(() => observedSignal !== undefined);
    caller.abort(new Error('the caller left'));

    await expect(auxiliary).rejects.toThrow('the caller left');
    expect(observedSignal?.aborted).toBe(true);
    await fixture.backend.dispose();
  });

  it('does not start an auxiliary turn for a caller that has already cancelled', async () => {
    // The half a listener cannot cover: `abort` has already fired, so
    // subscribing to it subscribes to nothing and the turn runs to completion
    // for a caller that gave up before it started.
    let observedSignal: AbortSignal | undefined;
    const fixture = createFixture({
      auxiliaryExecute: async (_requestRef, signal) => {
        observedSignal = signal;
        if (signal.aborted) throw new Error('the caller had already left');
        return 'answered anyway';
      },
    });
    const caller = new AbortController();
    caller.abort(new Error('the caller had already left'));

    await expect(fixture.backend.runAuxiliaryQuery('aux-ref', { signal: caller.signal }))
      .rejects.toThrow('the caller had already left');
    expect(observedSignal?.aborted).toBe(true);
    await fixture.backend.dispose();
  });

  it('ends one auxiliary conversation without touching the others', async () => {
    const released: string[] = [];
    const fixture = createFixture({
      auxiliaryRelease: async retentionKey => { released.push(retentionKey); },
    });

    // `AuxQueryRunner.reset()`, from the backend's side. The other auxiliary
    // conversations and every chat session on this backend keep running.
    await fixture.backend.releaseAuxiliaryConversation('opencode-auxiliary:title-gen');

    expect(released).toEqual(['opencode-auxiliary:title-gen']);
    await fixture.backend.dispose();
  });

  it('closes the auxiliary processes it kept when the backend disposes', async () => {
    // The other half of the port. Auxiliary work keeps a process between turns —
    // inline edit's second message has to reach the first one's session — so
    // unlike a cold query there is something left to close, and the only thing
    // that closes it is the shutdown. A backend that disposed without this left
    // one idle CLI per purpose running until the app quit.
    let disposals = 0;
    const fixture = createFixture({ auxiliaryDispose: async () => { disposals += 1; } });

    await expect(fixture.backend.dispose()).resolves.toBeUndefined();

    expect(disposals).toBe(1);
  });

  it('does not report a clean shutdown when an auxiliary process will not confirm', async () => {
    const fixture = createFixture({
      auxiliaryDispose: async () => {
        throw new ManagedAcpTerminationUnconfirmedError();
      },
    });

    // Exactly what a chat session that would not confirm does. An auxiliary
    // process is a process: one that outlived the plugin is a leak whether it
    // was running a conversation or generating a title.
    await expect(fixture.backend.dispose()).rejects.toThrow('termination was not confirmed');
  });

  it('asks the provider for an answer it finished without streaming', async () => {
    // Grok can finish a turn without delivering its final message over ACP
    // while still writing the answer to its own session log — which surfaced,
    // before the legacy runtime read it back, as an empty answer or a
    // credentials error. A turn with no output is where that is asked.
    const fixture = createFixture({ recoverOutput: async () => 'the answer it never sent' });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    const captured = await events;

    expect(fixture.stored).toEqual(['the answer it never sent']);
    // Carried on the assistant channel as well as committed: the surface draws
    // an answer from the deltas, and a recovered one that is only committed is
    // a turn that succeeds with an empty bubble.
    expect(captured.some(event => (
      event.event.kind === 'output-delta' && event.event.text === 'the answer it never sent'
    ))).toBe(true);
    expectTerminal(captured, 'succeeded', 'completed');
  });

  it('fails a turn that produced nothing when the provider recovers nothing either', async () => {
    const fixture = createFixture({ recoverOutput: async () => null });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    const captured = await events;

    expect(fixture.stored).toEqual([]);
    expectTerminal(captured, 'failed', 'missing-required-result');
  });

  it('replaces a process that died while nothing was running', async () => {
    const first = new FakeManagedAcpClient('native-session');
    const second = new FakeManagedAcpClient('native-session-2');
    const fixture = createFixture({ clients: [first, second] });
    const session = await createSession(fixture.backend);
    const opening = collectEvents(session.createRun(request('1')));
    await waitFor(() => first.promptRequests.length === 1);
    first.emit(agentText('native-session', 'first answer'));
    first.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    await opening;

    // The agent exits between turns — a crash, a machine asleep, a CLI
    // upgrade. Nothing is running, so there is no run to recover; what must
    // happen is that the dead client stops being the one the next turn uses.
    for (const listener of first.lossListeners) listener(new Error('process exited'));
    await waitFor(() => first.closeCalls > 0);

    const events = collectEvents(session.createRun(request('2')));
    await waitFor(() => second.promptRequests.length === 1);
    // The same message id the invocation dispatches with: a different one is
    // how this backend fences a stale native run, which is a different test.
    second.emit(agentText('native-session', 'second answer'));
    second.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    const captured = await events;

    // Without this the next turn dispatches into a closed transport and fails
    // `invalidated` — and so does every turn after it, because nothing ever
    // clears the client. The conversation is wedged until a reload.
    expect([first.closeCalls > 0, second.promptRequests.length]).toEqual([true, 1]);
    expectTerminal(captured, 'succeeded', 'completed');
  });

  it('gives the provider its last look at a turn that was cancelled', async () => {
    // Grok reads what a turn cost off its own session log, and a cancelled turn
    // still spent tokens. The legacy runtime read it when the prompt returned,
    // whatever the stop reason; a hook that only runs when an answer is
    // committed loses every cancelled turn's cost.
    const fixture = createFixture({
      noteTurnEnded: input => {
        input.presentContent({ kind: 'session-usage', usage: { totalTokens: 512 } });
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.completePrompt({ stopReason: 'cancelled', userMessageId: 'message-1' });
    const captured = await events;

    const learned = captured.findIndex(event => (
      event.event.kind === 'provider-content'
      && (event.event.payload as { kind?: string }).kind === 'session-usage'
    ));
    expect(learned).toBeGreaterThan(-1);
    expect(learned).toBeLessThan(captured.map(event => event.event.kind).indexOf('terminal'));
    expectTerminal(captured, 'interrupted', 'known-process-exit');
  });

  it('gives the provider its last look when the user stops the turn', async () => {
    // The path a Stop actually takes. `completeFromPrompt` was the only caller
    // of the last look, and a user Stop goes through `terminate()` — which
    // reconciled and finished in a microtask, so the prompt's own answer
    // arrived after the terminal and the cancelled turn's cost was lost.
    const looks: string[] = [];
    const fixture = createFixture({
      noteTurnEnded: input => {
        looks.push('looked');
        input.presentContent({ kind: 'session-usage', usage: { totalTokens: 256 } });
      },
    });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request('1'));
    const events = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);

    await run.cancel();
    const captured = await events;

    // Once, not twice: the prompt answering the cancel takes the same look.
    expect(looks).toEqual(['looked']);
    const learned = captured.findIndex(event => (
      event.event.kind === 'provider-content'
      && (event.event.payload as { kind?: string }).kind === 'session-usage'
    ));
    expect(learned).toBeGreaterThan(-1);
    expect(learned).toBeLessThan(captured.map(event => event.event.kind).indexOf('terminal'));
  });

  it('gives the provider its last look when the agent never answers the stop', async () => {
    // The case `terminate()` itself has to cover. When the agent answers the
    // cancel, `completeFromPrompt` takes the look on the way past; when it
    // never answers, the turn ends on the control timeout and this is the only
    // caller left. Without it a wedged agent loses the turn's cost outright.
    const looks: string[] = [];
    const fixture = createFixture({
      reconciliation: { kind: 'unknown', effectsPossible: true },
      noteTurnEnded: () => {
        looks.push('looked');
      },
    });
    // An agent that swallows `session/cancel` and keeps the prompt open.
    fixture.client.cancelStopReason = null;
    const session = await createSession(fixture.backend);
    const run = session.createRun(request('1'));
    const events = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);

    const cancellation = run.cancel();
    await waitFor(() => fixture.client.cancelledSessions.length === 1);
    await flushPromises();
    fixture.scheduler.fireLast();
    await cancellation;

    expect(looks).toEqual(['looked']);
    expectTerminal(await events, 'indeterminate', 'cancellation-unknown');
  });

  it('reports a stopped turn as cancelled when the agent says it stopped', async () => {
    // The reconciler answers `unknown` — every ACP provider's does until it can
    // read its own session store — so a Stop used to end `indeterminate`, which
    // the surface words as "could not establish whether this run completed" for
    // the one outcome the user asked for and watched happen. ACP answers a
    // cancelled turn on the prompt itself, and that answer reaches the
    // reconciler as the turn's own stop reason.
    const seen: Array<string | undefined> = [];
    const fixture = createFixture({
      reconciliation: { kind: 'unknown', effectsPossible: true },
      onReconcile: query => {
        seen.push(query.nativeStopReason);
        return acpCancellationEvidence(query);
      },
    });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request('1'));
    const events = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);

    await run.cancel();

    expect(seen).toEqual(['cancelled']);
    expectTerminal(await events, 'cancelled', 'cancellation-confirmed');
  });

  // eslint-disable-next-line jest/expect-expect -- expectTerminal owns the assertion.
  it('keeps a stopped turn indeterminate when the provider still cannot say', async () => {
    // The evidence is offered, never imposed. A provider that cannot account
    // for its process says so, and a turn reporting itself cancelled does not
    // answer a question about a process whose termination was never proven.
    const fixture = createFixture({ reconciliation: { kind: 'unknown', effectsPossible: true } });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request('1'));
    const events = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);

    await run.cancel();

    expectTerminal(await events, 'indeterminate', 'cancellation-unknown');
  });

   
  it('reports a turn the transport died before sending as one that never ran', async () => {
    // A connection lost before the first dispatch used to reconcile — asking a
    // provider what became of a run it never received — and the answer to that
    // question is `unknown`, so the turn ended `indeterminate`: "Grimoire could
    // not establish what this run changed", about a run that changed nothing
    // because it was never sent.
    let fixture!: ReturnType<typeof createFixture>;
    fixture = createFixture({
      reconciliation: { kind: 'unknown', effectsPossible: true },
      // The window this row is about: the session is bound and the turn has not
      // been sent. Losing the transport here reaches the recovery path with an
      // attempt number of zero, which is the case it had no branch for.
      dynamicApply: async () => {
        fixture.client.loseConnection();
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));

    expectTerminal(await events, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.client.promptRequests).toHaveLength(0);
  });

  // eslint-disable-next-line jest/expect-expect -- expectTerminal owns the assertion.
  it('names an uninstalled CLI as one, rather than as a session that may be gone', async () => {
    // Every ACP provider words `pre-dispatch-rejected` as a saved session that
    // may no longer exist, which is the right sentence for a failed bind and
    // exactly the wrong one for a binary that is not on PATH. The launcher
    // already produced the words; nothing carried them past the classifier.
    const fixture = createFixture({
      clientFactory: {
        create: async () => {
          throw new AcpSpawnError('Failed to start "opencode": command not found.', undefined);
        },
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));

    expectTerminal(await events, 'failed', 'spawn-failed');
  });

  it('carries what the provider learned about a turn, before that turn ends', async () => {
    const fixture = createFixture({
      noteTurnEnded: input => {
        // Grok never sends a context-window update on the wire — its wire
        // recording observes none — and its own session log is the only source.
        // Read when the prompt returns, which is the last moment the turn is
        // still open.
        input.presentContent({ kind: 'session-usage', usage: { totalTokens: 4096 } });
      },
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.emit(agentText('native-session', 'answer'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    const captured = await events;

    const kinds = captured.map(event => event.event.kind);
    const learned = captured.findIndex(event => (
      event.event.kind === 'provider-content'
      && (event.event.payload as { kind?: string }).kind === 'session-usage'
    ));
    expect(learned).toBeGreaterThan(-1);
    expect(learned).toBeLessThan(kinds.indexOf('terminal'));
  });

  it('names the live process for the provider features that are not turns', async () => {
    const ready: ManagedAcpClient[] = [];
    let lost = 0;
    const fixture = createFixture({
      clientObserver: {
        onClientReady: client => { ready.push(client); },
        onClientLost: () => { lost += 1; },
      },
    });
    const session = await createSession(fixture.backend);
    void collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    // Grok reads its account's billing over the same transport a turn runs on,
    // and the composition owns neither the process nor its lifetime. Reported
    // after `initialize`, because a client that has not handshaken answers
    // nothing — and withdrawn when it goes, so a feature cannot hold a
    // reference to a process that is gone.
    expect(ready).toEqual([fixture.client]);
    expect(lost).toBe(0);

    await fixture.backend.dispose();

    expect(lost).toBe(1);
  });
});

function createFixture(options: {
  readonly clients?: FakeManagedAcpClient[];
  readonly clientFactory?: ManagedAcpClientFactory;
  readonly clientObserver?: {
    onClientReady(client: ManagedAcpClient): void;
    onClientLost(): void;
  };
  readonly reconciliation?: RunRecoveryEvidence;
  readonly isMissingSessionError?: (error: unknown) => boolean;
  readonly maxResultBytes?: number;
  readonly resultStore?: (input: { readonly output: string }) => Promise<ResultCommitOutcome>;
  readonly recoverOutput?: () => Promise<string | null>;
  readonly noteTurnEnded?: (input: {
    readonly nativeSessionRef: string;
    readonly presentContent: (payload: unknown) => void;
  }) => void;
  readonly onReconcile?: (query: RunRecoveryQuery) => RunRecoveryEvidence | null;
  readonly dynamicApply?: () => Promise<void>;
  readonly interactionPrepare?: () => Promise<OpencodePreparedInteraction>;
  readonly auxiliaryExecute?: (requestRef: string, signal: AbortSignal) => Promise<string>;
  readonly auxiliaryDispose?: () => Promise<void>;
  readonly auxiliaryRelease?: (retentionKey: string) => Promise<void>;
  readonly requestResolve?: (requestRef: string) => Promise<OpencodeExecutionInvocation>;
} = {}) {
  const clients = options.clients ?? [new FakeManagedAcpClient('native-session')];
  const factory = new FakeClientFactory(clients);
  const scheduler = new FakeScheduler();
  const stored: string[] = [];
  let interactionResolveCalls = 0;
  const backend = new OpencodeExecutionBackend({
    clientFactory: options.clientFactory ?? factory,
    ...(options.clientObserver ? { clientObserver: options.clientObserver } : {}),
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
      ...(options.recoverOutput ? { recoverOutput: options.recoverOutput } : {}),
      ...(options.noteTurnEnded
        ? { noteTurnEnded: async (input: never) => options.noteTurnEnded?.(input) }
        : {}),
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
      reconcile: async query => options.onReconcile?.(query)
        ?? options.reconciliation
        ?? { kind: 'stopped-safe' },
    },
    auxiliaryQueries: {
      execute: options.auxiliaryExecute ?? (async () => 'auxiliary'),
      ...(options.auxiliaryDispose ? { dispose: options.auxiliaryDispose } : {}),
      ...(options.auxiliaryRelease ? { release: options.auxiliaryRelease } : {}),
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
  permissionHandler?: ManagedAcpClientFactoryInput['requestPermission'];
  loadError?: Error;
  closeCalls = 0;
  closeOutcome: 'confirmed' | 'unconfirmed' = 'confirmed';
  closeOutcomes: Array<'confirmed' | 'unconfirmed'> = [];
  newSessionGate?: Promise<void>;
  newSessionConfigOptions?: unknown[];
  private promptCompletion = deferred<AcpPromptResponse>();

  constructor(private readonly createdSessionId: string) {}

  async initialize(): Promise<void> { this.initializeCalls += 1; }
  async newSession(request: Parameters<ManagedAcpClient['newSession']>[0]) {
    this.newRequests.push(request);
    await this.newSessionGate;
    return { sessionId: this.createdSessionId, ...this.openingConfiguration() };
  }
  async loadSession(request: Parameters<ManagedAcpClient['loadSession']>[0]) {
    this.loadRequests.push(request);
    if (this.loadError) throw this.loadError;
    return { sessionId: request.sessionId, ...this.openingConfiguration() };
  }
  private openingConfiguration() {
    return this.newSessionConfigOptions
      ? { configOptions: this.newSessionConfigOptions as never }
      : {};
  }
  cancelStopReason: string | null = 'cancelled';
  prompt(request: Parameters<ManagedAcpClient['prompt']>[0]) {
    this.promptRequests.push(request);
    return this.promptCompletion.promise;
  }
  async setMode() { return {}; }
  async setModel() { return {}; }
  async setConfigOption() { return { configOptions: [] }; }
  cancel(sessionId: string): void {
    this.cancelledSessions.push(sessionId);
    // A real agent answers `session/cancel` on the prompt it was sent about.
    // The stop reason is settable because the interesting disagreement is an
    // agent that had already finished when the cancel arrived, and answers the
    // turn it completed rather than the one it was told to stop.
    if (this.cancelStopReason) {
      this.promptCompletion.resolve({ stopReason: this.cancelStopReason });
    }
  }
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
    const error = new Error('transport closed');
    for (const listener of this.lossListeners) listener(error);
    // Only when a turn is actually in flight. Rejecting a prompt nobody asked
    // for leaves a rejection with no handler, which takes the whole run down —
    // and a transport dying before the first dispatch is a real case.
    if (this.promptRequests.length > 0) {
      this.promptCompletion.reject(error);
    }
  }
  requestPermission(request: AcpRequestPermissionRequest) {
    if (!this.permissionHandler) throw new Error('No permission handler.');
    return this.permissionHandler(request);
  }
}

class FakeScheduler implements OpencodeExecutionScheduler {
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

function invocation(): OpencodeExecutionInvocation {
  return {
    startupRef: 'opencode-startup',
    restartFingerprint: 'opencode-v1',
    cwd: '/vault',
    prompt: [{ type: 'text', text: 'Do the work' }],
    mcpServers: [],
    messageId: 'message-1',
  };
}

function request(suffix: string, requestRef = 'request-ref'): ExecutionRequest {
  return {
    runId: runId(`run-${suffix.repeat(32)}`),
    owner: { kind: 'conversation', ownerId: 'opencode-tests' },
    resultExpectation: 'required',
    requestRef,
  };
}

async function createSession(backend: OpencodeExecutionBackend, nativeSessionRef?: string) {
  return backend.createSession({
    executionSessionId: executionSessionId(`es-${'d'.repeat(32)}`),
    owner: { kind: 'conversation', ownerId: 'opencode-tests' },
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

function planUpdate(sessionId: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'plan',
      entries: [{ content: 'Read the note', priority: 'medium', status: 'in_progress' }],
    },
  };
}

function usageUpdate(sessionId: string): AcpSessionNotification {
  return {
    sessionId,
    update: { sessionUpdate: 'usage_update', used: 16_964, size: 200_000 },
  };
}

function contentPayloads(events: readonly ProviderExecutionEvent[]): unknown[] {
  return events.flatMap(({ event }) => (
    event.kind === 'provider-content' ? [event.payload] : []
  ));
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

async function flushPromises(turns = 12): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function summarizeEvents(events: readonly ProviderExecutionEvent[]): string[] {
  return events.flatMap(({ event }) => {
    if (event.kind === 'run-started' || event.kind === 'connection-lost' || event.kind === 'recovery-started') {
      return [event.kind];
    }
    // Streamed output is a recorded semantic, not noise. This summarizer drops
    // what it does not name, so leaving it out would have kept the trace silent
    // about whether a turn was readable while it ran.
    if (event.kind === 'output-delta') return [event.kind];
    if (event.kind === 'provider-content') {
      // Named by what it carries: a trace that recorded only "provider-content"
      // would freeze the fact that something was forwarded without freezing
      // what, and the surface is drawn from the what.
      const payload = event.payload as {
        kind: string;
        notification?: AcpSessionNotification;
      };
      return [`provider-content:${payload.notification?.update.sessionUpdate ?? payload.kind}`];
    }
    if (event.kind === 'result') return [`result:${event.result.storage}`];
    if (event.kind === 'terminal') return [`terminal:${event.terminal}:${event.reason}`];
    if (event.kind === 'interaction-opened') return [`interaction-opened:${event.interaction.kind}`];
    if (event.kind === 'interaction-resolved') return [`interaction-resolved:${event.responseId}`];
    return [];
  });
}
