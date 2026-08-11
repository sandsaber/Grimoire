import trace from '@test/fixtures/provider-traces/grok-execution.json';

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
  AcpAskUserQuestionRequest,
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpSessionNotification,
} from '@/providers/acp/types';
import {
  GrokExecutionBackend,
  type GrokExecutionInvocation,
  type GrokExecutionScheduler,
  type GrokPreparedApproval,
  type GrokPreparedQuestion,
} from '@/providers/grok/execution/GrokExecutionBackend';

describe('GrokExecutionBackend', () => {
  it('initializes a managed client, creates a native session, and commits assistant output', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    fixture.client.emit(agentText('native-session', 'Grok Build result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    const captured = await events;
    expectTerminal(captured, 'succeeded', 'completed');
    expect(fixture.client.initializeCalls).toBe(1);
    expect(fixture.client.newRequests).toEqual([
      expect.objectContaining({ cwd: '/vault', mcpServers: [] }),
    ]);
    expect(fixture.stored).toEqual(['Grok Build result']);
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
        : { ...invocation(), restartFingerprint: 'grok-v2', messageId: 'message-2' },
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

  it('round-trips a durable direct question through the same lifecycle fence', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1'));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    const question = fixture.client.askUserQuestion(questionRequest('native-session'));
    await waitFor(() => observed.some(event => (
      event.event.kind === 'interaction-opened' && event.event.interaction.kind === 'question'
    )));
    const opened = observed.find(event => (
      event.event.kind === 'interaction-opened' && event.event.interaction.kind === 'question'
    ));
    if (!opened || opened.event.kind !== 'interaction-opened') throw new Error('No question.');

    const resolution = {
      interactionId: opened.event.interaction.interactionId,
      responseId: 'answer',
      resolvedAt: 1,
    };
    await Promise.all([fixture.backend.resolve(resolution), fixture.backend.resolve(resolution)]);

    await expect(question).resolves.toEqual({
      outcome: 'accepted',
      answers: { '0': 'Answer' },
    });
    expect(fixture.questionResolveCalls).toBe(1);
    expect(summarizeEvents(observed).filter(entry => entry.startsWith('interaction-')))
      .toEqual(trace.cases.question);
  });

  it('fails an open direct question closed without publishing after the run terminal', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const run = session.createRun(request('1'));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    const question = fixture.client.askUserQuestion(questionRequest('native-session'));
    await waitFor(() => observed.some(event => event.event.kind === 'interaction-opened'));

    await run.cancel();
    await expect(question).resolves.toEqual({ outcome: 'cancelled' });

    expectTerminal(observed, 'cancelled', 'cancellation-confirmed');
    const terminalIndex = observed.findIndex(event => event.event.kind === 'terminal');
    expect(observed.slice(terminalIndex + 1)).toEqual([]);
  });

  it('cancels a question prepared after its bounded request already failed closed', async () => {
    const preparation = deferred<GrokPreparedQuestion>();
    const cancel = jest.fn(async () => ({ outcome: 'cancelled' as const }));
    const fixture = createFixture({ questionPrepare: () => preparation.promise });
    const session = await createSession(fixture.backend);
    session.createRun(request('1'));
    await waitFor(() => fixture.client.promptRequests.length === 1);

    const question = fixture.client.askUserQuestion(questionRequest('native-session'));
    await flushPromises();
    fixture.scheduler.fireLast();
    await expect(question).resolves.toEqual({ outcome: 'cancelled' });

    preparation.resolve({
      kind: 'question',
      presentationRef: 'late-question',
      responseIds: ['skip'],
      providerResolvedResponseId: 'skip',
      resolve: async () => ({ outcome: 'skip_interview' }),
      cancel,
    });
    await flushPromises();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('deduplicates the standard and provider-extension copies of one session update', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    const notification = agentText('native-session', 'one copy');

    fixture.client.emit(notification);
    fixture.client.emitExtension('x.ai/session/update', notification);
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    expectTerminal(await events, 'succeeded', 'completed');
    expect(fixture.stored).toEqual(['one copy']);
    expect([
      'standard:agent_message_chunk',
      'extension:agent_message_chunk',
      `result:${fixture.stored[0]?.replace(' ', '-')}`,
    ]).toEqual(trace.cases.notificationDeduplication);
  });

  it('requires final assistant text even when thinking and tools produced visible activity', async () => {
    const second = new FakeManagedAcpClient('native-session');
    const fixture = createFixture({
      clients: [new FakeManagedAcpClient('native-session'), second],
    });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentThought('native-session'));
    fixture.client.emit(toolCall('native-session', 'tool-1'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    const captured = await events;
    expectTerminal(captured, 'failed', 'missing-required-result');
    expect(fixture.factory.inputs).toHaveLength(1);
    expect(second.promptRequests).toHaveLength(0);
    expect(fixture.stored).toHaveLength(0);
    expect(summarizeEvents(captured)).toEqual(trace.eventCases.missingFinalText);
  });

  it('projects provider usage and exposes billing only through the connected client', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    const usage = usageNotification('native-session');
    fixture.client.emit(usage);

    await expect(fixture.usage.attachments[0]?.readBilling?.()).resolves.toEqual({
      remainingCredits: 42,
    });
    fixture.client.emit(agentText('native-session', 'done'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    expectTerminal(await events, 'succeeded', 'completed');
    expect(fixture.client.extensionRequests).toEqual([{ method: 'x.ai/billing', params: {} }]);
    expect(fixture.usage.notifications).toEqual([usage]);
    expect(fixture.usage.turns).toEqual(['native-session']);
    expect([
      'usage:notification',
      `billing:${fixture.client.extensionRequests[0]?.method}`,
      'usage:turn-projection',
    ]).toEqual(trace.cases.usageBilling);
  });

  it('keeps optional usage projection failures outside the execution lifecycle', async () => {
    const fixture = createFixture({ usageFailure: true });
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    expect(() => fixture.client.emit(usageNotification('native-session'))).not.toThrow();
    fixture.client.emit(agentText('native-session', 'authoritative result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    expectTerminal(await events, 'succeeded', 'completed');
    expect(fixture.stored).toEqual(['authoritative result']);
  });

  it('persists one native agent result from polling or mirrored async completion', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(completedToolCall(
      'native-session',
      'spawn-1',
      'spawn_subagent',
      'subagent_id=agent-1',
    ));
    const agentCompletion = {
      sessionId: 'native-session',
      update: {
        sessionUpdate: 'subagent_finished',
        subagent_id: 'agent-1',
        status: 'completed',
        output: 'agent result',
      },
    };
    fixture.client.emitExtension('x.ai/session/update', agentCompletion);
    fixture.client.emitExtension('_x.ai/session/update', agentCompletion);
    fixture.client.emit(completedToolCall(
      'native-session',
      'wait-1',
      'get_command_or_subagent_output',
      {
        TaskOutput: {
          MultiResult: {
            results: [{ task_id: 'agent-1', status: 'completed', output: 'agent result' }],
          },
        },
      },
    ));
    fixture.client.emit(agentText('native-session', 'parent result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    const captured = await events;
    expectTerminal(captured, 'succeeded', 'completed');
    expect(fixture.storedInputs).toEqual([
      { output: 'agent result', source: 'native-agent', nativeAgentKey: 'agent-1' },
      { output: 'parent result', source: 'assistant' },
    ]);
    const agentEvents = summarizeEvents(captured)
      .filter(entry => entry.startsWith('native-agent-'));
    expect(agentEvents).toEqual(trace.cases.nativeAgentLifecycle);
    expect(agentEvents).toEqual(trace.eventCases.nativeAgentLifecycle);
  });

  it('extracts a native agent result from polling when no async completion arrives', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(completedToolCall(
      'native-session',
      'wait-1',
      'get_command_or_subagent_output',
      JSON.stringify({
        TaskOutput: {
          MultiResult: {
            results: [{ task_id: 'agent-2', status: 'completed', output: 'polled result' }],
          },
        },
      }),
    ));
    fixture.client.emit(agentText('native-session', 'parent result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    expectTerminal(await events, 'succeeded', 'completed');
    expect(fixture.storedInputs).toEqual([
      { output: 'polled result', source: 'native-agent', nativeAgentKey: 'agent-2' },
      { output: 'parent result', source: 'assistant' },
    ]);
  });

  it('enriches a result-less async completion with one later polling result', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const events = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emitExtension('x.ai/session/update', {
      sessionId: 'native-session',
      update: {
        sessionUpdate: 'subagent_finished',
        subagent_id: 'agent-3',
        status: 'completed',
      },
    });
    await flushPromises();
    fixture.client.emit(completedToolCall(
      'native-session',
      'wait-3',
      'get_command_or_subagent_output',
      JSON.stringify({
        TaskOutput: {
          MultiResult: {
            results: [{ task_id: 'agent-3', status: 'completed', output: 'late result' }],
          },
        },
      }),
    ));
    fixture.client.emit(agentText('native-session', 'parent result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });

    const captured = await events;
    expectTerminal(captured, 'succeeded', 'completed');
    expect(fixture.storedInputs).toEqual([
      { output: 'late result', source: 'native-agent', nativeAgentKey: 'agent-3' },
      { output: 'parent result', source: 'assistant' },
    ]);
    expect(captured.filter(event => (
      event.event.kind === 'native-agent-status'
      && event.event.nativeAgentKey === 'agent-3'
      && event.event.status === 'completed'
    ))).toHaveLength(1);
    expect(captured.filter(event => (
      event.event.kind === 'native-agent-result'
      && event.event.nativeAgentKey === 'agent-3'
    ))).toHaveLength(1);
  });

  it('drains a native agent commit admitted during the parent result commit', async () => {
    const parentCommit = deferred<ResultCommitOutcome>();
    const agentCommit = deferred<ResultCommitOutcome>();
    let parentCommitStarted = false;
    let agentCommitStarted = false;
    const fixture = createFixture({
      resultStore: async ({ output }) => {
        if (output === 'parent result') {
          parentCommitStarted = true;
          return parentCommit.promise;
        }
        agentCommitStarted = true;
        return agentCommit.promise;
      },
    });
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const eventsPromise = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emit(agentText('native-session', 'parent result'));
    fixture.client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    await waitFor(() => parentCommitStarted);
    fixture.client.emitExtension('x.ai/session/update', {
      sessionId: 'native-session',
      update: {
        sessionUpdate: 'subagent_finished',
        subagent_id: 'agent-4',
        status: 'completed',
        output: 'agent result',
      },
    });
    await waitFor(() => agentCommitStarted);

    parentCommit.resolve({
      kind: 'committed',
      result: { resultId: 'parent-result', storage: 'projection' },
    });
    await flushPromises();
    expect(observed.some(event => event.event.kind === 'terminal')).toBe(false);
    agentCommit.resolve({
      kind: 'committed',
      result: { resultId: 'agent-result', storage: 'projection' },
    });

    const captured = await eventsPromise;
    expectTerminal(captured, 'succeeded', 'completed');
    const agentResultIndex = captured.findIndex(event => event.event.kind === 'native-agent-result');
    expect(agentResultIndex).toBeGreaterThanOrEqual(0);
    expect(agentResultIndex).toBeLessThan(
      captured.findIndex(event => event.event.kind === 'terminal'),
    );
  });

  it('drains a native agent commit admitted during cancellation reconciliation', async () => {
    const reconciliation = deferred<RunRecoveryEvidence>();
    const agentCommit = deferred<ResultCommitOutcome>();
    let agentCommitStarted = false;
    const fixture = createFixture({
      reconcile: () => reconciliation.promise,
      resultStore: async () => {
        agentCommitStarted = true;
        return agentCommit.promise;
      },
    });
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const run = session.createRun(request('1'));
    const eventsPromise = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);
    const cancellation = run.cancel();
    fixture.client.emitExtension('x.ai/session/update', {
      sessionId: 'native-session',
      update: {
        sessionUpdate: 'subagent_finished',
        subagent_id: 'agent-5',
        status: 'completed',
        output: 'agent result',
      },
    });
    await waitFor(() => agentCommitStarted);
    reconciliation.resolve({ kind: 'stopped-safe' });
    await flushPromises();
    expect(observed.some(event => event.event.kind === 'terminal')).toBe(false);
    agentCommit.resolve({
      kind: 'committed',
      result: { resultId: 'agent-result', storage: 'projection' },
    });
    await cancellation;

    const captured = await eventsPromise;
    expectTerminal(captured, 'cancelled', 'cancellation-confirmed');
    const agentResultIndex = captured.findIndex(event => event.event.kind === 'native-agent-result');
    expect(agentResultIndex).toBeGreaterThanOrEqual(0);
    expect(agentResultIndex).toBeLessThan(
      captured.findIndex(event => event.event.kind === 'terminal'),
    );
  });

  it('closes agent admission before unload drains the bounded admitted commit', async () => {
    const admittedCommit = deferred<ResultCommitOutcome>();
    let client: FakeManagedAcpClient | undefined;
    let resultStoreCalls = 0;
    const fixture = createFixture({
      resultStore: async () => {
        resultStoreCalls += 1;
        if (resultStoreCalls === 1) {
          const outcome = await admittedCommit.promise;
          client?.emitExtension('x.ai/session/update', {
            sessionId: 'native-session',
            update: {
              sessionUpdate: 'subagent_finished',
              subagent_id: 'agent-after-drain',
              status: 'completed',
              output: 'must not be admitted',
            },
          });
          return outcome;
        }
        return {
          kind: 'committed',
          result: { resultId: 'second-admitted-result', storage: 'projection' },
        };
      },
    });
    client = fixture.client;
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const eventsPromise = collectEvents(session.createRun(request('1')));
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emitExtension('x.ai/session/update', {
      sessionId: 'native-session',
      update: {
        sessionUpdate: 'subagent_finished',
        subagent_id: 'agent-admitted-1',
        status: 'completed',
        output: 'first admitted result',
      },
    });
    await waitFor(() => resultStoreCalls === 1);
    fixture.client.emitExtension('x.ai/session/update', {
      sessionId: 'native-session',
      update: {
        sessionUpdate: 'subagent_finished',
        subagent_id: 'agent-admitted-2',
        status: 'completed',
        output: 'second admitted result',
      },
    });

    const disposal = fixture.backend.dispose();
    await flushPromises();
    admittedCommit.resolve({
      kind: 'committed',
      result: { resultId: 'admitted-result', storage: 'projection' },
    });

    await expect(disposal).resolves.toBeUndefined();
    const captured = await eventsPromise;
    expectTerminal(captured, 'cancelled', 'cancellation-confirmed');
    expect(resultStoreCalls).toBe(2);
    expect(captured.filter(event => event.event.kind === 'native-agent-result').map(event => (
      event.event.kind === 'native-agent-result' ? event.event.nativeAgentKey : ''
    ))).toEqual(['agent-admitted-1', 'agent-admitted-2']);
    expect(observed.some(event => (
      event.event.kind === 'native-agent-observed'
      && event.event.nativeAgentKey === 'agent-after-drain'
    ))).toBe(false);
  });

  it('does not orphan an already-started native agent result commit during cancellation', async () => {
    const agentCommit = deferred<ResultCommitOutcome>();
    let agentCommitStarted = false;
    const fixture = createFixture({
      resultStore: async ({ output }) => {
        if (output === 'agent result') {
          agentCommitStarted = true;
          return agentCommit.promise;
        }
        return {
          kind: 'committed',
          result: { resultId: 'parent-result', storage: 'projection' },
        };
      },
    });
    const session = await createSession(fixture.backend);
    const run = session.createRun(request('1'));
    const events = collectEvents(run);
    await waitFor(() => fixture.client.promptRequests.length === 1);
    fixture.client.emitExtension('x.ai/session/update', {
      sessionId: 'native-session',
      update: {
        sessionUpdate: 'subagent_finished',
        subagent_id: 'agent-1',
        status: 'completed',
        output: 'agent result',
      },
    });
    await waitFor(() => agentCommitStarted);

    const cancellation = run.cancel();
    await flushPromises();
    agentCommit.resolve({
      kind: 'committed',
      result: { resultId: 'agent-result', storage: 'projection' },
    });
    await cancellation;

    const captured = await events;
    expect(captured).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        kind: 'native-agent-result',
        nativeAgentKey: 'agent-1',
      }),
    }));
    expectTerminal(captured, 'cancelled', 'cancellation-confirmed');
    expect(captured.findIndex(event => event.event.kind === 'native-agent-result'))
      .toBeLessThan(captured.findIndex(event => event.event.kind === 'terminal'));
  });

  it('cancels a permission prepared after its bounded request already failed closed', async () => {
    const preparation = deferred<GrokPreparedApproval>();
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
});

function createFixture(options: {
  readonly clients?: FakeManagedAcpClient[];
  readonly clientFactory?: ManagedAcpClientFactory;
  readonly reconciliation?: RunRecoveryEvidence;
  readonly reconcile?: () => Promise<RunRecoveryEvidence>;
  readonly isMissingSessionError?: (error: unknown) => boolean;
  readonly maxResultBytes?: number;
  readonly resultStore?: (input: { readonly output: string }) => Promise<ResultCommitOutcome>;
  readonly dynamicApply?: () => Promise<void>;
  readonly interactionPrepare?: () => Promise<GrokPreparedApproval>;
  readonly questionPrepare?: () => Promise<GrokPreparedQuestion>;
  readonly auxiliaryExecute?: (requestRef: string, signal: AbortSignal) => Promise<string>;
  readonly requestResolve?: (requestRef: string) => Promise<GrokExecutionInvocation>;
  readonly usageFailure?: boolean;
} = {}) {
  const clients = options.clients ?? [new FakeManagedAcpClient('native-session')];
  const factory = new FakeClientFactory(clients);
  const scheduler = new FakeScheduler();
  const stored: string[] = [];
  const storedInputs: Array<{
    readonly output: string;
    readonly source: 'assistant' | 'native-agent';
    readonly nativeAgentKey?: string;
  }> = [];
  const usage = {
    attachments: [] as Array<{
      readonly ownerRef: string;
      readonly readBilling?: () => Promise<unknown>;
    }>,
    detached: [] as string[],
    notifications: [] as AcpSessionNotification[],
    turns: [] as string[],
  };
  let interactionResolveCalls = 0;
  let questionResolveCalls = 0;
  const backend = new GrokExecutionBackend({
    clientFactory: options.clientFactory ?? factory,
    requestResolver: { resolve: options.requestResolve ?? (async () => invocation()) },
    dynamicApplier: { apply: options.dynamicApply ?? (async () => undefined) },
    interactionBridge: {
      prepareApproval: options.interactionPrepare ?? (async () => ({
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
      prepareQuestion: options.questionPrepare ?? (async () => ({
        kind: 'question',
        presentationRef: 'question-presentation',
        responseIds: ['answer', 'skip'],
        providerResolvedResponseId: 'skip',
        resolve: async responseId => {
          questionResolveCalls += 1;
          return responseId === 'answer'
            ? { outcome: 'accepted', answers: { '0': 'Answer' } }
            : { outcome: 'skip_interview' };
        },
        cancel: async () => ({ outcome: 'cancelled' }),
      })),
    },
    usage: {
      attach: input => {
        if (options.usageFailure) throw new Error('usage attach failed');
        usage.attachments.push(input);
      },
      detach: ownerRef => {
        if (options.usageFailure) throw new Error('usage detach failed');
        usage.detached.push(ownerRef);
      },
      recordNotification: notification => {
        if (options.usageFailure) throw new Error('usage notification failed');
        usage.notifications.push(notification);
      },
      recordTurn: async input => {
        if (options.usageFailure) throw new Error('usage turn failed');
        usage.turns.push(input.nativeSessionRef);
      },
    },
    resultSink: {
      storeResult: async ({ output, source, nativeAgentKey }) => {
        if (options.resultStore) return options.resultStore({ output });
        stored.push(output);
        storedInputs.push({ output, source, ...(nativeAgentKey ? { nativeAgentKey } : {}) });
        return {
          kind: 'committed',
          result: { resultId: `result-${stored.length}`, storage: 'projection' },
        };
      },
    },
    reconciler: {
      reconcile: options.reconcile
        ?? (async () => options.reconciliation ?? { kind: 'stopped-safe' }),
    },
    auxiliaryQueries: { execute: options.auxiliaryExecute ?? (async () => 'auxiliary') },
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
    storedInputs,
    usage,
    get interactionResolveCalls() { return interactionResolveCalls; },
    get questionResolveCalls() { return questionResolveCalls; },
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
    client.questionHandler = input.askUserQuestion;
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
  readonly extensionListeners = new Set<{
    readonly methods: readonly string[];
    readonly listener: (method: string, params: unknown) => void;
  }>();
  readonly extensionRequests: Array<{ readonly method: string; readonly params: unknown }> = [];
  permissionHandler?: ManagedAcpClientFactoryInput['requestPermission'];
  questionHandler?: ManagedAcpClientFactoryInput['askUserQuestion'];
  loadError?: Error;
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
    if (this.loadError) throw this.loadError;
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
  onExtensionNotification(
    methods: readonly string[],
    listener: (method: string, params: unknown) => void,
  ) {
    const registration = { methods, listener };
    this.extensionListeners.add(registration);
    return () => this.extensionListeners.delete(registration);
  }
  async requestExtension(method: string, params: unknown): Promise<unknown> {
    this.extensionRequests.push({ method, params });
    return { remainingCredits: 42 };
  }
  async close(): Promise<'confirmed' | 'unconfirmed'> {
    this.closeCalls += 1;
    return this.closeOutcomes.shift() ?? this.closeOutcome;
  }
  emit(notification: AcpSessionNotification): void {
    for (const listener of this.notificationListeners) listener(notification);
  }
  emitExtension(method: string, params: unknown): void {
    for (const registration of this.extensionListeners) {
      if (registration.methods.includes(method)) registration.listener(method, params);
    }
  }
  completePrompt(response: AcpPromptResponse): void { this.promptCompletion.resolve(response); }
  loseConnection(): void {
    const error = new Error('transport closed');
    for (const listener of this.lossListeners) listener(error);
    this.promptCompletion.reject(error);
  }
  requestPermission(request: AcpRequestPermissionRequest) {
    if (!this.permissionHandler) throw new Error('No permission handler.');
    return this.permissionHandler(request);
  }
  askUserQuestion(request: AcpAskUserQuestionRequest) {
    if (!this.questionHandler) throw new Error('No question handler.');
    return this.questionHandler(request);
  }
}

class FakeScheduler implements GrokExecutionScheduler {
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

function invocation(): GrokExecutionInvocation {
  return {
    startupRef: 'grok-startup',
    restartFingerprint: 'grok-v1',
    cwd: '/vault',
    prompt: [{ type: 'text', text: 'Do the work' }],
    mcpServers: [],
    messageId: 'message-1',
  };
}

function request(suffix: string, requestRef = 'request-ref'): ExecutionRequest {
  return {
    runId: runId(`run-${suffix.repeat(32)}`),
    owner: { kind: 'conversation', ownerId: 'grok-tests' },
    resultExpectation: 'required',
    requestRef,
  };
}

async function createSession(backend: GrokExecutionBackend, nativeSessionRef?: string) {
  return backend.createSession({
    executionSessionId: executionSessionId(`es-${'d'.repeat(32)}`),
    owner: { kind: 'conversation', ownerId: 'grok-tests' },
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

function questionRequest(sessionId: string): AcpAskUserQuestionRequest {
  return {
    sessionId,
    questions: [{
      question: 'Which path?',
      options: [{ label: 'Safe path' }],
    }],
  };
}

function agentThought(sessionId: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'reasoning' },
    },
  };
}

function usageNotification(sessionId: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'usage_update',
      used: 10,
      size: 100,
      cost: { amount: 0.01, currency: 'USD' },
    },
  };
}

function completedToolCall(
  sessionId: string,
  toolCallId: string,
  title: string,
  rawOutput: unknown,
): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      title,
      status: 'completed',
      rawOutput,
    },
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
    if (event.kind === 'result') return [`result:${event.result.storage}`];
    if (event.kind === 'thinking-activity') return ['thinking-activity'];
    if (event.kind === 'tool-activity') return [`tool-activity:${event.toolCallId}`];
    if (event.kind === 'terminal') return [`terminal:${event.terminal}:${event.reason}`];
    if (event.kind === 'interaction-opened') return [`interaction-opened:${event.interaction.kind}`];
    if (event.kind === 'interaction-resolved') return [`interaction-resolved:${event.responseId}`];
    if (event.kind === 'native-agent-observed') {
      return [`native-agent-observed:${event.nativeAgentKey}`];
    }
    if (event.kind === 'native-agent-result') {
      return [`native-agent-result:${event.nativeAgentKey}:${event.result.storage}`];
    }
    if (event.kind === 'native-agent-status') {
      return [`native-agent-status:${event.nativeAgentKey}:${event.status}`];
    }
    if (event.kind === 'native-agent-activity') {
      return [`native-agent-activity:${event.nativeAgentKey}:${event.activity}`];
    }
    return [];
  });
}
