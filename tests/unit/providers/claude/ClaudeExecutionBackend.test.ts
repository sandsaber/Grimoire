import type {
  PermissionMode,
  PermissionResult,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import trace from '@test/fixtures/provider-traces/claude-execution.json';

import { ExecutionEventQueue } from '@/core/execution/ExecutionEventQueue';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type { ResultCommitOutcome } from '@/core/execution/ResultCommit';
import {
  ClaudeExecutionBackend,
  type ClaudeExecutionBackendContext,
  type ClaudeExecutionInvocation,
  type ClaudeExecutionQuery,
  type ClaudeExecutionQueryFactoryInput,
  type ClaudeExecutionScheduler,
} from '@/providers/claude/execution/ClaudeExecutionBackend';

describe('ClaudeExecutionBackend', () => {
  it('keeps one persistent query across turns and applies only dynamic changes', async () => {
    const fixture = createFixture({
      invocations: {
        first: invocation('message-1', {
          model: 'sonnet',
          permissionMode: 'default',
          effortLevel: 'low',
          mcpServers: { first: { command: 'first-server' } },
        }),
        second: invocation('message-2', {
          model: 'opus',
          permissionMode: 'plan',
          effortLevel: 'high',
          mcpServers: { second: { command: 'second-server' } },
        }),
      },
    });
    const session = await createSession(fixture.backend, 'native-session');

    const firstEvents = collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(initMessage('native-session'));
    // The SDK reports the answer twice, as deltas and then whole in the result.
    // Emitting one delta here is what exercises the streaming path at all: the
    // scenario previously jumped straight to the result, so the backend's
    // delta handling was never run by any test.
    fixture.query.emit(textDeltaMessage('first '));
    fixture.query.emit(resultMessage('message-1', 'first result', 'result-1'));
    const firstCaptured = await firstEvents;
    expectTerminal(firstCaptured, 'succeeded', 'completed');
    expect(summarizeEvents(firstCaptured)).toEqual(trace.eventCases.persistentTurn);

    const secondEvents = collectEvents(session.createRun(request('2', 'second')));
    await waitFor(() => fixture.query.received.length === 2);
    fixture.query.emit(resultMessage('message-2', 'second result', 'result-2'));
    expectTerminal(await secondEvents, 'succeeded', 'completed');

    expect(fixture.factory.inputs).toHaveLength(1);
    expect(fixture.query.setModel).toHaveBeenNthCalledWith(1, 'sonnet');
    expect(fixture.query.setModel).toHaveBeenNthCalledWith(2, 'opus');
    expect(fixture.query.setPermissionMode).toHaveBeenNthCalledWith(1, 'default');
    expect(fixture.query.setPermissionMode).toHaveBeenNthCalledWith(2, 'plan');
    expect(fixture.query.controlTrace).toEqual(trace.cases.dynamicWithoutRestart);
    expect([
      'query/start',
      `message/enqueue:${fixture.query.received[0].uuid}`,
      `result:${fixture.stored[0].output}`,
      `message/enqueue:${fixture.query.received[1].uuid}`,
      `result:${fixture.stored[1].output}`,
    ]).toEqual(trace.cases.persistentTurns);
    expect(firstCaptured[0]).toEqual(expect.objectContaining({
      backendGeneration: trace.identity.backendGeneration,
      executionSessionId: trace.identity.executionSessionId,
      sessionInstanceId: trace.identity.sessionInstanceId,
      scope: expect.objectContaining({
        runId: trace.identity.runId,
        nativeRunRef: trace.identity.nativeRunId,
      }),
    }));
    expect(session.getSnapshot().nativeSessionRef).toBe('native-session');
    expect(session.getSnapshot().nativeSessionRef).toBe(trace.identity.nativeSessionId);
    expect(fixture.stored.map(entry => entry.output)).toEqual(['first result', 'second result']);
  });

  it('leaves a dialog kind it never declared for the client that did', async () => {
    // **A `request_user_dialog` this host does not draw belongs to another
    // client on the session.** `cancelled` is a real settlement and would close
    // that client's dialog as if the user had dismissed it, so the answer is to
    // return nothing at all — which skips the transport write and leaves the
    // dialog to whoever can render it, or to the CLI's own deadline.
    const fixture = createFixture({ invocations: { first: invocation('message-1', {}) } });
    const session = await createSession(fixture.backend, 'native-session');
    void collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.factory.inputs.length === 1);
    const dialog = fixture.factory.inputs[0]?.onUserDialog;

    const answer = await dialog?.(
      { dialogKind: 'refusal_fallback_prompt', payload: {} },
      { signal: new AbortController().signal },
    );

    expect(answer).toBeNull();
  });

  it('leaves a denied question denied rather than answering it', async () => {
    // The CLI resolves permission before it asks the host to draw, so a denial
    // has already been decided against the tool. Answering the question would
    // upgrade it — which is what spreading the payload's permission result into
    // the reply used to do.
    const fixture = createFixture({ invocations: { first: invocation('message-1', {}) } });
    const session = await createSession(fixture.backend, 'native-session');
    void collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.factory.inputs.length === 1);
    const dialog = fixture.factory.inputs[0]?.onUserDialog;

    const answer = await dialog?.(
      {
        dialogKind: 'permission_ask_user_question',
        payload: {
          permissionResult: { behavior: 'deny', message: 'Tool is not allowed here.' },
          questions: [{ header: 'Pick', question: 'Which?', options: [{ label: 'A' }] }],
        },
      },
      { signal: new AbortController().signal },
    );

    expect(answer).toEqual({
      behavior: 'completed',
      result: { behavior: 'deny', feedback: 'Tool is not allowed here.' },
    });
  });

  it('fences startup restart while a detached native task is still live', async () => {
    const fixture = createFixture({
      invocations: {
        first: invocation('message-1'),
        changed: { ...invocation('message-2'), restartFingerprint: 'startup-v2' },
      },
    });
    const session = await createSession(fixture.backend);

    const firstEvents = collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(taskStarted('task-1', 'tool-task-1'));
    fixture.query.emit(resultMessage('message-1', 'parent done', 'result-1'));
    expectTerminal(await firstEvents, 'succeeded', 'completed');

    const rejected = await collectEvents(session.createRun(request('2', 'changed')));
    expectTerminal(rejected, 'invalidated', 'pre-dispatch-rejected');
    expect(fixture.factory.inputs).toHaveLength(1);
    expect(fixture.query.received).toHaveLength(1);

    fixture.query.emit(taskNotification('task-1', 'stopped', 'tool-task-1'));
    await flushPromises();
  });

  it('forwards the messages a surface draws a turn from, once each', async () => {
    // The backend was harvested before the kernel had a content channel, so it
    // reported facts and text and nothing a tool card, a plan or a task could
    // be drawn from. Forwarding the message itself is what a flipped tab
    // renders from — the same shape wave 2 settled on, opaque to core.
    const fixture = createFixture();
    const session = await createSession(fixture.backend, 'native-session');
    const events = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.query.received.length === 1);

    const toolCall = assistantToolMessage('tool-1', 'Read');
    fixture.query.emit(toolCall);
    // The same message twice is the daemon repeating itself, not two tool
    // calls: a card drawn twice is the duplication this set exists to stop.
    fixture.query.emit(toolCall);
    fixture.query.emit(taskStarted('task-1', 'tool-task-1'));
    fixture.query.emit(resultMessage('message-1', 'done', 'result-1'));

    const forwarded = (await events)
      .map(({ event }) => event)
      .filter((event): event is Extract<typeof event, { kind: 'provider-content' }> => (
        event.kind === 'provider-content'
      ))
      .map(event => event.payload as { type: string; subtype?: string; uuid?: string });
    // A system message the session consumes itself, an assistant message, and
    // the result: all three are things the surface draws.
    expect(forwarded.filter(payload => payload.uuid === 'assistant-tool-1')).toHaveLength(1);
    expect(forwarded.some(payload => payload.subtype === 'task_started')).toBe(true);
    expect(forwarded.some(payload => payload.type === 'result')).toBe(true);
  });

  it('publishes a hydrated native-agent result after the parent run is terminal', async () => {
    const fixture = createFixture({ taskOutput: 'full sidecar result' });
    const session = await createSession(fixture.backend, 'native-session');
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));

    const parentEvents = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(taskStarted('task-1', 'tool-task-1'));
    fixture.query.emit(subagentToolMessage('tool-task-1', 'native-tool-1'));
    fixture.query.emit(resultMessage('message-1', 'parent result', 'result-1'));
    expectTerminal(await parentEvents, 'succeeded', 'completed');

    fixture.query.emit(taskNotification('task-1', 'completed', 'tool-task-1'));
    await waitFor(() => fixture.stored.some(entry => entry.source === 'native-agent'));
    await waitFor(() => observed.filter(event => event.scope.kind === 'agent').length === 5);

    expect(fixture.taskLoads).toEqual([{ taskId: 'task-1', outputFile: '/sdk/task-1.out' }]);
    expect(fixture.stored).toContainEqual(expect.objectContaining({
      output: 'full sidecar result',
      source: 'native-agent',
      nativeAgentKey: 'task-1',
    }));
    const taskEvents = observed.filter(event => event.scope.kind === 'agent');
    expect(taskEvents.map(event => event.event.kind)).toEqual([
      'native-agent-observed',
      'native-agent-status',
      'tool-activity',
      'native-agent-result',
      'native-agent-status',
    ]);
    expect(taskEvents.at(-1)).toEqual(expect.objectContaining({
      deliveryId: expect.stringContaining(':detached:'),
      scope: expect.objectContaining({ agentInstanceId: 'task-1', agentRunId: 'task-1' }),
      event: expect.objectContaining({ kind: 'native-agent-status', status: 'completed' }),
    }));
    expect(summarizeEvents(taskEvents)).toEqual(trace.eventCases.backgroundAgentLateResult);
    expect(summarizeBackgroundAgentCase(observed, fixture.taskLoads)).toEqual(
      trace.cases.backgroundAgentLateResult,
    );
  });

  it('observes a synchronous native task without relying on background level correlation', async () => {
    const fixture = createFixture({ taskOutput: 'synchronous task result' });
    const session = await createSession(fixture.backend, 'native-session');
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const parent = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(taskStarted('sync-task', 'sync-tool-use'));
    fixture.query.emit(taskNotification('sync-task', 'completed', 'sync-tool-use'));
    await waitFor(() => observed.some(event =>
      event.event.kind === 'native-agent-result'
      && event.event.nativeAgentKey === 'sync-task'));
    fixture.query.emit(resultMessage('message-1', 'parent result', 'result-1'));
    expectTerminal(await parent, 'succeeded', 'completed');
    expect(observed).toContainEqual(expect.objectContaining({
      scope: expect.objectContaining({ agentInstanceId: 'sync-task' }),
      event: expect.objectContaining({
        kind: 'native-agent-status',
        nativeAgentKey: 'sync-task',
        status: 'completed',
      }),
    }));
  });

  it('does not block the persistent SDK stream on slow native-task sidecar hydration', async () => {
    const sidecar = deferred<string | null>();
    const fixture = createFixture({ taskResultLoad: async () => sidecar.promise });
    const session = await createSession(fixture.backend, 'native-session');
    const parent = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(taskStarted('task-1', 'tool-task-1'));
    fixture.query.emit(taskNotification('task-1', 'completed', 'tool-task-1'));
    fixture.query.emit(resultMessage('message-1', 'parent is not blocked', 'result-1'));
    const parentEvents = await parent;
    expect(parentEvents.some(event => event.event.kind === 'terminal')).toBe(true);
    expectTerminal(parentEvents, 'succeeded', 'completed');
    sidecar.resolve(null);
    await flushPromises();
  });

  it('preserves nested native-agent parentage after the root turn has completed', async () => {
    const fixture = createFixture({ taskOutput: 'nested result' });
    const session = await createSession(fixture.backend, 'native-session');
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const parent = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(taskStarted('root-task', 'root-task-tool'));
    fixture.query.emit(resultMessage('message-1', 'root turn complete', 'result-1'));
    await parent;

    fixture.query.emit(subagentToolMessage('root-task-tool', 'nested-task-tool', 'Task'));
    fixture.query.emit(taskStarted('nested-task', 'nested-task-tool'));
    fixture.query.emit(taskNotification('nested-task', 'completed', 'nested-task-tool'));
    await waitFor(() => observed.some(event =>
      event.event.kind === 'native-agent-result'
      && event.event.nativeAgentKey === 'nested-task'));

    expect(observed).toContainEqual(expect.objectContaining({
      scope: expect.objectContaining({ agentInstanceId: 'nested-task' }),
      event: expect.objectContaining({
        kind: 'native-agent-observed',
        nativeAgentKey: 'nested-task',
        parentNativeAgentKey: 'root-task',
      }),
    }));
  });

  it('round-trips an SDK permission interaction through the durable interaction port', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1', 'default'));
    await waitFor(() => fixture.query.received.length === 1);

    const abort = new AbortController();
    const permission = fixture.factory.inputs[0].canUseTool(
      'AskUserQuestion',
      { questions: [] },
      { signal: abort.signal, requestId: 'request-1', toolUseId: 'tool-use-1' },
    );
    await waitFor(() => observed.some(event => event.event.kind === 'interaction-opened'));
    const opened = observed.find(event => event.event.kind === 'interaction-opened')!;
    if (opened.event.kind !== 'interaction-opened') {
      throw new Error('Expected an interaction event.');
    }
    await fixture.backend.resolve({
      interactionId: opened.event.interaction.interactionId,
      responseId: 'allow-once',
      resolvedAt: 1,
    });

    await expect(permission).resolves.toEqual({ behavior: 'allow', updatedInput: { questions: [] } });
    expect(observed).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        kind: 'interaction-resolved',
        interactionId: opened.event.interaction.interactionId,
        responseId: 'allow-once',
      }),
    }));
  });

  it('resolves the same interaction response idempotently across concurrent retries', async () => {
    const resolution = deferred<PermissionResult>();
    let resolveCalls = 0;
    const fixture = createFixture({
      interactionPrepare: async ({ toolInput }) => ({
        kind: 'approval',
        presentationRef: 'presentation-ref',
        responseIds: ['allow-once', 'deny-once'],
        providerResolvedResponseId: 'deny-once',
        resolve: async () => {
          resolveCalls += 1;
          return resolution.promise;
        },
        cancel: async () => ({ behavior: 'deny', message: 'Cancelled.' }),
      }),
    });
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1', 'default'));
    await waitFor(() => fixture.query.received.length === 1);
    const permission = fixture.factory.inputs[0].canUseTool(
      'Write',
      { file_path: 'note.md' },
      {
        signal: new AbortController().signal,
        requestId: 'request-idempotent',
        toolUseId: 'tool-idempotent',
      },
    );
    await waitFor(() => observed.some(event => event.event.kind === 'interaction-opened'));
    const opened = observed.find(event => event.event.kind === 'interaction-opened');
    if (!opened || opened.event.kind !== 'interaction-opened') throw new Error('No interaction.');
    const durableResolution = {
      interactionId: opened.event.interaction.interactionId,
      responseId: 'allow-once',
      resolvedAt: 1,
    };
    const first = fixture.backend.resolve(durableResolution);
    const concurrent = fixture.backend.resolve(durableResolution);
    await waitFor(() => resolveCalls === 1);
    resolution.resolve({ behavior: 'allow', updatedInput: { file_path: 'note.md' } });
    await Promise.all([first, concurrent]);
    await expect(fixture.backend.resolve(durableResolution)).resolves.toBeUndefined();
    await expect(permission).resolves.toEqual(expect.objectContaining({ behavior: 'allow' }));
    expect(resolveCalls).toBe(1);
  });

  it('preserves approval, question, and plan-exit interaction kinds as independent durable requests', async () => {
    const kinds = new Map([
      ['Write', 'approval' as const],
      ['AskUserQuestion', 'question' as const],
      ['ExitPlanMode', 'plan-decision' as const],
    ]);
    const fixture = createFixture({
      interactionPrepare: async ({ toolName, toolInput }) => ({
        kind: kinds.get(toolName) ?? 'approval',
        presentationRef: `presentation-${toolName.toLowerCase()}`,
        responseIds: ['allow-once', 'deny-once'],
        providerResolvedResponseId: 'deny-once',
        resolve: async () => ({ behavior: 'allow', updatedInput: { ...toolInput } }),
        cancel: async () => ({ behavior: 'deny', message: 'Cancelled.' }),
      }),
    });
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1', 'default'));
    await waitFor(() => fixture.query.received.length === 1);
    const permissions = [...kinds.keys()].map((toolName, index) =>
      fixture.factory.inputs[0].canUseTool(toolName, {}, {
        signal: new AbortController().signal,
        requestId: `request-kind-${index}`,
        toolUseId: `tool-kind-${index}`,
      }));
    await waitFor(() => observed.filter(event => event.event.kind === 'interaction-opened').length === 3);
    const opened = observed.filter(event => event.event.kind === 'interaction-opened');
    expect(opened.map(event => event.event.kind === 'interaction-opened'
      ? event.event.interaction.kind
      : '')).toEqual(['approval', 'question', 'plan-decision']);
    await Promise.all(opened.map(event => {
      if (event.event.kind !== 'interaction-opened') throw new Error('Expected interaction.');
      return fixture.backend.resolve({
        interactionId: event.event.interaction.interactionId,
        responseId: 'allow-once',
        resolvedAt: 1,
      });
    }));
    await expect(Promise.all(permissions)).resolves.toHaveLength(3);
    expect([
      ...opened.map(event => event.event.kind === 'interaction-opened'
        ? `interaction-opened:${event.event.interaction.kind}`
        : ''),
      ...observed
        .filter(event => event.event.kind === 'interaction-resolved')
        .map(event => event.event.kind === 'interaction-resolved'
          ? `interaction-resolved:${event.event.responseId}`
          : ''),
    ]).toEqual(trace.cases.interactions);
  });

  it('cancels a permission prepared after its owning run already terminated', async () => {
    const preparation = deferred<Awaited<ReturnType<ClaudeExecutionBackendContext['interactionBridge']['prepare']>>>();
    const cancelPrepared = jest.fn(async () => ({
      behavior: 'deny' as const,
      message: 'Cancelled after preparation.',
    }));
    const fixture = createFixture({ interactionPrepare: () => preparation.promise });
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const run = session.createRun(request('1', 'default'));
    const events = collectEvents(run);
    await waitFor(() => fixture.query.received.length === 1);
    const permission = fixture.factory.inputs[0].canUseTool(
      'Write',
      {},
      {
        signal: new AbortController().signal,
        requestId: 'request-delayed',
        toolUseId: 'tool-delayed',
      },
    );
    await run.cancel();
    preparation.resolve({
      kind: 'approval',
      presentationRef: 'presentation-ref',
      responseIds: ['allow-once', 'deny-once'],
      providerResolvedResponseId: 'deny-once',
      resolve: async () => ({ behavior: 'allow', updatedInput: {} }),
      cancel: cancelPrepared,
    });
    await expect(permission).resolves.toEqual(expect.objectContaining({ behavior: 'deny' }));
    expect(cancelPrepared).toHaveBeenCalledTimes(1);
    expect(observed.some(event => event.event.kind === 'interaction-opened')).toBe(false);
    expectTerminal(await events, 'cancelled', 'cancellation-confirmed');
  });

  it('fails an independently aborted interaction closed when native cancellation rejects', async () => {
    const cancelPrepared = jest.fn(async (): Promise<PermissionResult> => {
      throw new Error('native permission cancellation failed');
    });
    const fixture = createFixture({
      interactionPrepare: async () => ({
        kind: 'approval',
        presentationRef: 'presentation-abort',
        responseIds: ['allow-once', 'deny-once'],
        providerResolvedResponseId: 'deny-once',
        resolve: async () => ({ behavior: 'allow', updatedInput: {} }),
        cancel: cancelPrepared,
      }),
    });
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const run = session.createRun(request('1', 'default'));
    await waitFor(() => fixture.query.received.length === 1);
    const abort = new AbortController();
    const permission = fixture.factory.inputs[0].canUseTool(
      'Write',
      {},
      {
        signal: abort.signal,
        requestId: 'request-abort-rejection',
        toolUseId: 'tool-abort-rejection',
      },
    );
    await waitFor(() => observed.some(event => event.event.kind === 'interaction-opened'));

    abort.abort(new Error('SDK permission aborted'));

    await expect(permission).resolves.toEqual({
      behavior: 'deny',
      message: 'Claude interaction settlement was not confirmed.',
      interrupt: true,
    });
    expect(cancelPrepared).toHaveBeenCalledTimes(1);
    expect(observed).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        kind: 'interaction-resolved',
        responseId: 'deny-once',
      }),
    }));
    await run.cancel();
  });

  it('fails a never-settling interaction closed without hanging cancel or backend disposal', async () => {
    const never = new Promise<PermissionResult>(() => undefined);
    const fixture = createFixture({
      interactionPrepare: async () => ({
        kind: 'approval',
        presentationRef: 'presentation-never',
        responseIds: ['allow-once', 'deny-once'],
        providerResolvedResponseId: 'deny-once',
        resolve: () => never,
        cancel: async () => ({ behavior: 'deny', message: 'Cancelled.' }),
      }),
    });
    const session = await createSession(fixture.backend);
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1', 'default'));
    await waitFor(() => fixture.query.received.length === 1);
    const permission = fixture.factory.inputs[0].canUseTool('Write', {}, {
      signal: new AbortController().signal,
      requestId: 'request-never',
      toolUseId: 'tool-never',
    });
    await waitFor(() => observed.some(event => event.event.kind === 'interaction-opened'));
    const opened = observed.find(event => event.event.kind === 'interaction-opened');
    if (!opened || opened.event.kind !== 'interaction-opened') throw new Error('No interaction.');
    const settlement = fixture.backend.resolve({
      interactionId: opened.event.interaction.interactionId,
      responseId: 'allow-once',
      resolvedAt: 1,
    });
    fixture.scheduler.fireLast();
    await expect(settlement).rejects.toThrow('did not complete safely');
    await expect(permission).resolves.toEqual(expect.objectContaining({
      behavior: 'deny',
      interrupt: true,
    }));
    await expect(fixture.backend.cancel(opened.event.interaction.interactionId))
      .resolves.toBeUndefined();
    await expect(Promise.all([fixture.backend.dispose(), fixture.backend.dispose()]))
      .resolves.toHaveLength(2);
  });

  it('routes persistent-query permission callbacks to the current turn, not the first turn', async () => {
    const fixture = createFixture({
      invocations: {
        first: invocation('message-1'),
        second: invocation('message-2'),
      },
    });
    const session = await createSession(fixture.backend, 'native-session');
    const first = collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(resultMessage('message-1', 'first done', 'result-1'));
    await first;

    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('2', 'second'));
    await waitFor(() => fixture.query.received.length === 2);
    const permission = fixture.factory.inputs[0].canUseTool(
      'Read',
      { file_path: 'note.md' },
      {
        signal: new AbortController().signal,
        requestId: 'request-2',
        toolUseId: 'tool-use-2',
      },
    );
    await waitFor(() => observed.some(event => event.event.kind === 'interaction-opened'));
    const opened = observed.find(event => event.event.kind === 'interaction-opened');
    if (!opened || opened.event.kind !== 'interaction-opened') {
      throw new Error('Expected the second turn interaction.');
    }
    expect(opened.event.interaction.runId).toBe(request('2', 'second').runId);
    await fixture.backend.resolve({
      interactionId: opened.event.interaction.interactionId,
      responseId: 'allow-once',
      resolvedAt: 2,
    });
    await expect(permission).resolves.toEqual(expect.objectContaining({ behavior: 'allow' }));
  });

  it('passes fork identity to a new SDK query and rotates to the observed fork session', async () => {
    const fork = invocation('message-1');
    const fixture = createFixture({
      invocations: {
        default: {
          ...fork,
          session: {
            kind: 'fork',
            sourceSessionId: 'source-session',
            resumeAt: 'assistant-checkpoint',
          },
        },
      },
    });
    const session = await createSession(fixture.backend, 'source-session');
    const events = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.factory.inputs.length === 1);

    expect(fixture.factory.inputs[0]).toEqual(expect.objectContaining({
      nativeSessionRef: 'source-session',
      resumeAt: 'assistant-checkpoint',
      forkSession: true,
    }));
    expect(
      `fork:${fixture.factory.inputs[0].nativeSessionRef}:${fixture.factory.inputs[0].resumeAt}`,
    ).toBe(trace.cases.resumeForkRewind[1]);
    fixture.query.emit(initMessage('forked-session'));
    fixture.query.emit(resultMessage('message-1', 'fork result', 'result-1', 'forked-session'));
    expectTerminal(await events, 'succeeded', 'completed');
    expect(session.getSnapshot().nativeSessionRef).toBe('forked-session');
  });

  it('rejects resume and fork sessions whose SDK init identity violates the request', async () => {
    const resumeFixture = createFixture({ suppressAutomaticInit: true });
    const resumed = await createSession(resumeFixture.backend, 'expected-session');
    const resumeEvents = collectEvents(resumed.createRun(request('1', 'default')));
    await waitFor(() => resumeFixture.query.received.length === 1);
    resumeFixture.query.emit(initMessage('wrong-session'));
    expectTerminal(await resumeEvents, 'indeterminate', 'effects-unknown');
    expect(resumed.getSnapshot().nativeSessionRef).toBe('expected-session');

    const forkFixture = createFixture({
      invocations: {
        default: {
          ...invocation('message-1'),
          session: {
            kind: 'fork',
            sourceSessionId: 'source-session',
            resumeAt: 'checkpoint',
          },
        },
      },
    });
    const forked = await createSession(forkFixture.backend, 'source-session');
    const forkEvents = collectEvents(forked.createRun(request('1', 'default')));
    await waitFor(() => forkFixture.query.received.length === 1);
    forkFixture.query.emit(initMessage('source-session'));
    expectTerminal(await forkEvents, 'indeterminate', 'effects-unknown');
    expect(forked.getSnapshot().nativeSessionRef).toBe('source-session');
  });

  it('rewinds files while quiescent and resumes the next query at the assistant checkpoint', async () => {
    const fixture = createFixture({
      invocations: {
        first: invocation('message-1'),
        second: invocation('message-2'),
      },
    });
    fixture.query.rewindFiles
      .mockResolvedValueOnce({ canRewind: true, filesChanged: ['note.md'] })
      .mockResolvedValueOnce({ canRewind: true });
    const session = await createSession(fixture.backend, 'native-session');
    const first = collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(resultMessage('message-1', 'done', 'result-1'));
    await first;

    await expect(fixture.backend.rewind({
      executionSessionId: String(session.executionSessionId),
      userMessageId: 'user-checkpoint',
      assistantMessageId: 'assistant-checkpoint',
      mode: 'code-and-conversation',
    })).resolves.toEqual({ canRewind: true, filesChanged: ['note.md'] });
    expect(fixture.query.rewindFiles).toHaveBeenNthCalledWith(1, 'user-checkpoint', { dryRun: true });
    expect(fixture.query.rewindFiles).toHaveBeenNthCalledWith(2, 'user-checkpoint');

    const nextQuery = new FakeQuery();
    fixture.factory.nextQuery = nextQuery;
    session.createRun(request('2', 'second'));
    await waitFor(() => fixture.factory.inputs.length === 2);
    expect(fixture.factory.inputs[1]).toEqual(expect.objectContaining({
      nativeSessionRef: 'native-session',
      resumeAt: 'assistant-checkpoint',
      forkSession: false,
    }));
    expect([
      `resume:${fixture.factory.inputs[0].nativeSessionRef}`,
      'rewindFiles:dry-run',
      'rewindFiles:apply',
      `resumeAt:${fixture.factory.inputs[1].resumeAt}`,
    ]).toEqual([
      trace.cases.resumeForkRewind[0],
      ...trace.cases.resumeForkRewind.slice(2),
    ]);
  });

  it('does not redispatch after connection loss and uses authoritative reconciliation', async () => {
    const fixture = createFixture({
      reconciliation: {
        kind: 'terminal',
        terminal: {
          kind: 'succeeded',
          reason: 'completed',
          occurredAt: 10,
          resultRef: { resultId: 'recovered-result', storage: 'provider-native' },
        },
      },
    });
    const session = await createSession(fixture.backend, 'native-session');
    const events = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.loseConnection();

    const captured = await events;
    expect(captured.map(event => event.event.kind)).toContain('connection-lost');
    expect(captured.map(event => event.event.kind)).toContain('recovery-started');
    expectTerminal(captured, 'succeeded', 'completed');
    expect(fixture.query.received).toHaveLength(1);
    expect(fixture.factory.inputs).toHaveLength(1);
  });

  it('does not claim a lost non-reattachable SDK query is still running', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend, 'native-session');
    const events = collectEvents(session.createRun(request('1', 'default')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.loseConnection();
    const captured = await events;
    expect(captured.some(event => event.event.kind === 'connection-lost')).toBe(true);
    expectTerminal(captured, 'indeterminate', 'effects-unknown');
    expect(summarizeEvents(captured)).toEqual(trace.eventCases.sessionRecovery);
    expect(summarizeEvents(captured)).toEqual(trace.cases.sessionRecovery);
  });

  it('requires exact turn correlation for terminal results and suppresses late duplicates', async () => {
    const fixture = createFixture({
      invocations: {
        first: invocation('message-1'),
        second: invocation('message-2'),
      },
    });
    const session = await createSession(fixture.backend, 'native-session');
    const first = collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(resultMessage('message-1', 'first', 'result-1'));
    await first;

    const second = collectEvents(session.createRun(request('2', 'second')));
    await waitFor(() => fixture.query.received.length === 2);
    fixture.query.emit(resultMessage('message-1', 'late duplicate', 'result-1'));
    fixture.query.emit(resultMessage('message-2', 'second', 'result-2'));
    expectTerminal(await second, 'succeeded', 'completed');
    expect(fixture.stored.map(entry => entry.output)).toEqual(['first', 'second']);

    const thirdFixture = createFixture();
    const thirdSession = await createSession(thirdFixture.backend, 'native-session');
    const uncorrelated = collectEvents(thirdSession.createRun(request('1', 'default')));
    await waitFor(() => thirdFixture.query.received.length === 1);
    thirdFixture.query.emit(uncorrelatedResultMessage('ambiguous-result'));
    expectTerminal(await uncorrelated, 'indeterminate', 'effects-unknown');
    expect(thirdFixture.stored).toHaveLength(0);
  });

  it('treats background task levels as unowned process state until an edge establishes identity', async () => {
    const fixture = createFixture({
      invocations: {
        first: invocation('message-1'),
        changed: { ...invocation('message-2'), restartFingerprint: 'startup-v2' },
      },
    });
    const session = await createSession(fixture.backend, 'native-session');
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    const first = collectEvents(session.createRun(request('1', 'first')));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(backgroundTasksChanged(['task-level-only']));
    await flushPromises();
    expect(observed.filter(event => event.scope.kind === 'agent')).toHaveLength(0);
    fixture.query.emit(resultMessage('message-1', 'done', 'result-1'));
    await first;

    const rejected = await collectEvents(session.createRun(request('2', 'changed')));
    expectTerminal(rejected, 'invalidated', 'pre-dispatch-rejected');
    fixture.query.emit(backgroundTasksChanged([]));
    const nextQuery = new FakeQuery();
    fixture.factory.nextQuery = nextQuery;
    const restarted = collectEvents(session.createRun(request('3', 'changed')));
    await waitFor(() => fixture.factory.inputs.length === 2);
    nextQuery.emit(initMessage('native-session'));
    await waitFor(() => nextQuery.received.length === 1);
    nextQuery.emit(resultMessage('message-2', 'restarted', 'result-2'));
    expectTerminal(await restarted, 'succeeded', 'completed');
    expect([
      ...Array.from({ length: fixture.query.close.mock.calls.length }, () => 'query/close'),
      ...(fixture.factory.inputs[1].nativeSessionRef ? ['query/start:resume'] : []),
    ]).toEqual(trace.cases.restartConfiguration);
  });

  it('exposes targetable native task cancellation only for an owned live task', async () => {
    const fixture = createFixture();
    const session = await createSession(fixture.backend, 'native-session');
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1', 'default'));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(taskStarted('task-1', 'tool-task-1'));
    await waitFor(() => observed.some(event => event.event.kind === 'native-agent-observed'));
    const firstCancellation = fixture.backend.cancelNativeTask({
      executionSessionId: String(session.executionSessionId),
      taskId: 'task-1',
    });
    const concurrentCancellation = fixture.backend.cancelNativeTask({
      executionSessionId: String(session.executionSessionId),
      taskId: 'task-1',
    });
    await waitFor(() => fixture.query.stopTask.mock.calls.length === 1);
    expect(observed).not.toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        kind: 'native-agent-status',
        nativeAgentKey: 'task-1',
        status: 'closed',
      }),
    }));
    fixture.query.emit(taskNotification('task-1', 'stopped', 'tool-task-1'));
    await Promise.all([firstCancellation, concurrentCancellation]);
    expect(fixture.query.stopTask).toHaveBeenCalledWith('task-1');
    expect(fixture.query.stopTask).toHaveBeenCalledTimes(1);
    expect(observed).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        kind: 'native-agent-status',
        nativeAgentKey: 'task-1',
        status: 'closed',
      }),
    }));
    await expect(fixture.backend.cancelNativeTask({
      executionSessionId: String(session.executionSessionId),
      taskId: 'task-1',
    })).rejects.toThrow('not owned');
  });

  it('retains an authoritative completed task result that wins after cancel RPC acknowledgement', async () => {
    const fixture = createFixture({ taskOutput: 'completed before cancellation' });
    const session = await createSession(fixture.backend, 'native-session');
    const observed: ProviderExecutionEvent[] = [];
    session.subscribe(event => observed.push(event));
    session.createRun(request('1', 'default'));
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(taskStarted('task-1', 'tool-task-1'));
    await waitFor(() => observed.some(event => event.event.kind === 'native-agent-observed'));
    const cancellation = fixture.backend.cancelNativeTask({
      executionSessionId: String(session.executionSessionId),
      taskId: 'task-1',
    });
    await waitFor(() => fixture.query.stopTask.mock.calls.length === 1);
    fixture.query.emit(taskNotification('task-1', 'completed', 'tool-task-1'));
    await cancellation;
    await waitFor(() => observed.some(event =>
      event.event.kind === 'native-agent-result'
      && event.event.nativeAgentKey === 'task-1'));
    expect(fixture.stored).toContainEqual(expect.objectContaining({
      source: 'native-agent',
      nativeAgentKey: 'task-1',
      output: 'completed before cancellation',
    }));
    expect(observed).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        kind: 'native-agent-status',
        nativeAgentKey: 'task-1',
        status: 'completed',
      }),
    }));
  });

  it('arbitrates provider completion before cancellation without issuing an interrupt', async () => {
    const commit = deferred<ResultCommitOutcome>();
    const fixture = createFixture({ resultStore: async () => commit.promise });
    const session = await createSession(fixture.backend, 'native-session');
    const run = session.createRun(request('1', 'default'));
    const events = collectEvents(run);
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(resultMessage('message-1', 'committed result', 'result-1'));
    await flushPromises();
    const cancellation = run.cancel();
    expect(fixture.query.interrupt).not.toHaveBeenCalled();
    commit.resolve({
      kind: 'committed',
      result: { resultId: 'committed-result', storage: 'projection' },
    });
    await cancellation;
    expectTerminal(await events, 'succeeded', 'completed');
  });

  it('freezes an indeterminate terminal when a signal-ignoring result commit misses its bound', async () => {
    const commit = deferred<ResultCommitOutcome>();
    const fixture = createFixture({ resultStore: async () => commit.promise });
    const session = await createSession(fixture.backend, 'native-session');
    const run = session.createRun(request('1', 'default'));
    const events = collectEvents(run);
    await waitFor(() => fixture.query.received.length === 1);
    fixture.query.emit(resultMessage('message-1', 'possibly committed', 'result-1'));
    await flushPromises();
    fixture.scheduler.fireNext();
    const captured = await events;
    expectTerminal(captured, 'indeterminate', 'effects-unknown');
    await run.cancel();
    commit.resolve({
      kind: 'committed',
      result: { resultId: 'late-result', storage: 'projection' },
    });
    await flushPromises();
    expect(captured.filter(event => event.event.kind === 'terminal')).toHaveLength(1);
    expect(captured.some(event => event.event.kind === 'result')).toBe(false);
    expect(fixture.query.interrupt).not.toHaveBeenCalled();
  });

  it('keeps cancellation and timeout authoritative when their intent arrives first', async () => {
    const interrupt = deferred<void>();
    const cancelledFixture = createFixture();
    cancelledFixture.query.interrupt.mockImplementationOnce(() => interrupt.promise);
    const cancelledSession = await createSession(cancelledFixture.backend, 'native-session');
    const cancelledRun = cancelledSession.createRun(request('1', 'default'));
    const cancelledEvents = collectEvents(cancelledRun);
    await waitFor(() => cancelledFixture.query.received.length === 1);
    const cancellation = cancelledRun.cancel();
    cancelledFixture.query.emit(resultMessage('message-1', 'too late', 'result-1'));
    interrupt.resolve();
    await cancellation;
    const cancelledCaptured = await cancelledEvents;
    expectTerminal(cancelledCaptured, 'cancelled', 'cancellation-confirmed');
    expect(summarizeEvents(cancelledCaptured)).toEqual(trace.eventCases.interruptCancellation);
    expect([
      'run-started',
      ...Array.from(
        { length: cancelledFixture.query.interrupt.mock.calls.length },
        () => 'interrupt',
      ),
      ...summarizeEvents(cancelledCaptured).slice(1),
    ]).toEqual(trace.cases.interruptCancellation);
    expect(cancelledFixture.stored).toHaveLength(0);

    const timeoutFixture = createFixture();
    const timeoutSession = await createSession(timeoutFixture.backend, 'native-session');
    const timeoutEvents = collectEvents(timeoutSession.createRun(request('1', 'default')));
    await waitFor(() => timeoutFixture.query.received.length === 1);
    timeoutFixture.scheduler.fireNext();
    await flushPromises();
    timeoutFixture.query.emit(resultMessage('message-1', 'too late', 'result-1'));
    expectTerminal(await timeoutEvents, 'failed', 'timeout');
    expect(timeoutFixture.stored).toHaveLength(0);
  });

  it('keeps the persistent query usable for the next turn after an acknowledged interrupt', async () => {
    const fixture = createFixture({
      invocations: {
        first: invocation('message-1'),
        second: invocation('message-2'),
      },
    });
    const session = await createSession(fixture.backend, 'native-session');
    const firstRun = session.createRun(request('1', 'first'));
    const firstEvents = collectEvents(firstRun);
    await waitFor(() => fixture.query.received.length === 1);
    await firstRun.cancel();
    expectTerminal(await firstEvents, 'cancelled', 'cancellation-confirmed');

    const secondEvents = collectEvents(session.createRun(request('2', 'second')));
    await waitFor(() => fixture.query.received.length === 2);
    fixture.query.emit(resultMessage('message-2', 'next turn', 'result-2'));
    expectTerminal(await secondEvents, 'succeeded', 'completed');
    expect(fixture.factory.inputs).toHaveLength(1);
    expect(fixture.query.interrupt).toHaveBeenCalledTimes(1);
  });

  it('runs auxiliary work through the isolated auxiliary port', async () => {
    const fixture = createFixture();
    await expect(fixture.backend.runAuxiliaryQuery('aux-ref')).resolves.toBe('aux-result');
    expect(fixture.auxiliaryRefs).toEqual(['aux-ref']);
    expect(fixture.factory.inputs).toHaveLength(0);
  });

  it('owns auxiliary admission and aborts active work during backend disposal', async () => {
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
    const task = fixture.backend.runAuxiliaryQuery('aux-ref');
    await waitFor(() => observedSignal !== undefined);
    await fixture.backend.dispose();
    await expect(task).rejects.toThrow('auxiliary aborted');
    expect(observedSignal?.aborted).toBe(true);
    await expect(fixture.backend.runAuxiliaryQuery('after-dispose')).rejects.toThrow('disposing');
  });
});

function createFixture(options: {
  readonly invocations?: Readonly<Record<string, ClaudeExecutionInvocation>>;
  readonly taskOutput?: string | null;
  readonly taskResultLoad?: ClaudeExecutionBackendContext['taskResultLoader']['load'];
  readonly reconciliation?: Awaited<ReturnType<ClaudeExecutionBackendContext['reconciler']['reconcile']>>;
  readonly resultStore?: ClaudeExecutionBackendContext['resultSink']['storeResult'];
  readonly interactionPrepare?: ClaudeExecutionBackendContext['interactionBridge']['prepare'];
  readonly auxiliaryExecute?: ClaudeExecutionBackendContext['auxiliaryQueries']['execute'];
  readonly suppressAutomaticInit?: boolean;
} = {}) {
  const query = new FakeQuery();
  const factory = new FakeQueryFactory(query, options.suppressAutomaticInit ?? false);
  const stored: Array<{
    output: string;
    source: 'assistant' | 'native-agent';
    nativeAgentKey?: string;
  }> = [];
  const taskLoads: Array<{ taskId: string; outputFile: string }> = [];
  const auxiliaryRefs: string[] = [];
  let resultSequence = 0;
  let interactionSequence = 0;
  const invocations = options.invocations ?? { default: invocation('message-1') };
  const scheduler = new FakeScheduler();
  const backend = new ClaudeExecutionBackend({
    queryFactory: factory,
    requestResolver: {
      resolve: async requestRef => {
        const resolved = invocations[requestRef];
        if (!resolved) {
          throw new Error('Unknown request.');
        }
        return resolved;
      },
    },
    interactionBridge: {
      prepare: options.interactionPrepare ?? (async ({ toolName, toolInput }) => ({
        kind: toolName === 'AskUserQuestion' ? 'question' : 'approval',
        presentationRef: 'presentation-ref',
        responseIds: ['allow-once', 'deny-once'],
        providerResolvedResponseId: 'deny-once',
        resolve: async responseId => responseId === 'allow-once'
          ? { behavior: 'allow', updatedInput: { ...toolInput } }
          : { behavior: 'deny', message: 'Denied.' },
        cancel: async () => ({ behavior: 'deny', message: 'Cancelled.', interrupt: true }),
      })),
    },
    resultSink: {
      storeResult: options.resultStore ?? (async input => {
        stored.push({
          output: input.output,
          source: input.source,
          ...(input.nativeAgentKey ? { nativeAgentKey: input.nativeAgentKey } : {}),
        });
        return {
          kind: 'committed',
          result: { resultId: `result-${++resultSequence}`, storage: 'projection' },
        };
      }),
    },
    taskResultLoader: {
      load: options.taskResultLoad ?? (async input => {
        taskLoads.push({ taskId: input.taskId, outputFile: input.outputFile });
        return options.taskOutput ?? null;
      }),
    },
    reconciler: {
      reconcile: async () => options.reconciliation
        ?? { kind: 'unknown', effectsPossible: true },
    },
    auxiliaryQueries: {
      execute: options.auxiliaryExecute ?? (async requestRef => {
        auxiliaryRefs.push(requestRef);
        return 'aux-result';
      }),
    },
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'a'.repeat(32)}`),
    interactionIdFactory: () => interactionId(
      `ix-${String(++interactionSequence).padStart(32, '0')}`,
    ),
    now: () => 100,
    runTimeoutMs: 60_000,
    resultCommitTimeoutMs: 1_000,
    recoveryTimeoutMs: 1_000,
    maxResultBytes: 1024,
    maxTaskResultBytes: 1024,
  });
  return {
    backend,
    query,
    factory,
    stored,
    taskLoads,
    auxiliaryRefs,
    scheduler,
  };
}

class FakeQueryFactory {
  readonly inputs: ClaudeExecutionQueryFactoryInput[] = [];
  nextQuery: FakeQuery | undefined;

  constructor(
    private readonly initialQuery: FakeQuery,
    private readonly suppressAutomaticInit: boolean,
  ) {}

  async create(input: ClaudeExecutionQueryFactoryInput): Promise<FakeQuery> {
    this.inputs.push(input);
    const query = this.nextQuery ?? this.initialQuery;
    this.nextQuery = undefined;
    query.consumeInput(input.messages);
    if (!this.suppressAutomaticInit && !input.forkSession) {
      query.emit(initMessage(input.nativeSessionRef ?? 'native-session'));
    }
    return query;
  }
}

class FakeQuery implements ClaudeExecutionQuery {
  readonly received: SDKUserMessage[] = [];
  readonly controlTrace: string[] = [];
  readonly setPermissionMode = jest.fn<Promise<void>, [PermissionMode]>(async () => {
    this.controlTrace.push('setPermissionMode');
  });
  readonly setModel = jest.fn<Promise<void>, [string?]>(async () => {
    this.controlTrace.push('setModel');
  });
  readonly applyFlagSettings = jest.fn<Promise<void>, [{ effortLevel: unknown }]>(async () => {
    this.controlTrace.push('applyFlagSettings');
  });
  readonly setMcpServers = jest.fn<Promise<void>, [Record<string, unknown>]>(async () => {
    this.controlTrace.push('setMcpServers');
  });
  readonly rewindFiles = jest.fn<Promise<RewindFilesResult>, [string, { dryRun?: boolean }?]>(
    async () => ({ canRewind: true }),
  );
  readonly stopTask = jest.fn<Promise<void>, [string]>(async () => {});
  readonly interrupt = jest.fn<Promise<void>, []>(async () => {});
  readonly close = jest.fn<void, []>(() => { this.output.close(); });
  private readonly output = new ExecutionEventQueue<SDKMessage>();
  private readonly lossListeners = new Set<(error?: Error) => void>();

  consumeInput(messages: AsyncIterable<SDKUserMessage>): void {
    void (async () => {
      for await (const message of messages) {
        this.received.push(message);
      }
    })();
  }

  emit(message: SDKMessage): void {
    this.output.push(message);
  }

  loseConnection(): void {
    for (const listener of this.lossListeners) {
      listener(new Error('pipe lost'));
    }
  }

  onConnectionLost(listener: (error?: Error) => void) {
    this.lossListeners.add(listener);
    return () => this.lossListeners.delete(listener);
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.output[Symbol.asyncIterator]();
  }
}

class FakeScheduler implements ClaudeExecutionScheduler {
  private readonly tasks = new Map<object, () => void>();

  setTimeout(callback: () => void): object {
    const handle = {};
    this.tasks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) {
      this.tasks.delete(handle);
    }
  }

  fireNext(): void {
    const entry = this.tasks.entries().next().value;
    if (!entry) throw new Error('No timer was scheduled.');
    this.tasks.delete(entry[0]);
    entry[1]();
  }

  fireLast(): void {
    const entry = [...this.tasks.entries()].at(-1);
    if (!entry) throw new Error('No timer was scheduled.');
    this.tasks.delete(entry[0]);
    entry[1]();
  }
}

async function createSession(backend: ClaudeExecutionBackend, nativeSessionRef?: string) {
  return backend.createSession({
    executionSessionId: executionSessionId(`es-${'d'.repeat(32)}`),
    owner: { kind: 'conversation', ownerId: 'claude-tests' },
    backendGeneration: 1,
    ...(nativeSessionRef ? { nativeSessionRef } : {}),
  });
}

function request(suffix: string, requestRef: string) {
  return {
    runId: runId(`run-${suffix.repeat(32)}`),
    owner: { kind: 'conversation' as const, ownerId: 'claude-tests' },
    resultExpectation: 'required' as const,
    requestRef,
  };
}

function invocation(
  messageId: string,
  dynamic?: ClaudeExecutionInvocation['dynamic'],
): ClaudeExecutionInvocation {
  return {
    startupRef: 'startup-ref',
    restartFingerprint: 'startup-v1',
    message: userMessage(messageId),
    ...(dynamic ? { dynamic } : {}),
  };
}

function userMessage(uuid: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: 'Do the work' },
    parent_tool_use_id: null,
    session_id: '',
    uuid,
  } as SDKUserMessage;
}

function textDeltaMessage(text: string, sessionId = 'native-session'): SDKMessage {
  return {
    type: 'stream_event',
    session_id: sessionId,
    uuid: `delta-${text}`,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
  } as unknown as SDKMessage;
}

function initMessage(sessionId: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    uuid: `init-${sessionId}`,
  } as unknown as SDKMessage;
}

function resultMessage(
  userMessageId: string,
  result: string,
  uuid: string,
  sessionId = 'native-session',
): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    user_message_uuid: userMessageId,
    uuid,
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function uncorrelatedResultMessage(result: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    uuid: 'uncorrelated-result',
    session_id: 'native-session',
  } as unknown as SDKMessage;
}

function backgroundTasksChanged(taskIds: readonly string[]): SDKMessage {
  return {
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: taskIds.map(taskId => ({
      task_id: taskId,
      task_type: 'agent',
      description: 'Background task',
    })),
    uuid: `background-${taskIds.join('-') || 'empty'}`,
    session_id: 'native-session',
  } as unknown as SDKMessage;
}

function taskStarted(taskId: string, toolUseId: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: taskId,
    tool_use_id: toolUseId,
    description: 'Background task',
    uuid: `started-${taskId}`,
    session_id: 'native-session',
  } as unknown as SDKMessage;
}

function taskNotification(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  toolUseId: string,
): SDKMessage {
  return {
    type: 'system',
    subtype: 'task_notification',
    task_id: taskId,
    tool_use_id: toolUseId,
    status,
    output_file: `/sdk/${taskId}.out`,
    summary: 'summary result',
    uuid: `notification-${taskId}`,
    session_id: 'native-session',
  } as unknown as SDKMessage;
}

function assistantToolMessage(toolCallId: string, toolName: string): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      content: [{ type: 'tool_use', id: toolCallId, name: toolName, input: { file_path: 'a.md' } }],
    },
    uuid: `assistant-${toolCallId}`,
    session_id: 'native-session',
  } as unknown as SDKMessage;
}

function subagentToolMessage(
  parentToolUseId: string,
  toolCallId: string,
  toolName = 'Read',
): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: parentToolUseId,
    message: {
      content: [{ type: 'tool_use', id: toolCallId, name: toolName, input: {} }],
    },
    uuid: `assistant-${toolCallId}`,
    session_id: 'native-session',
  } as unknown as SDKMessage;
}

async function collectEvents(run: { readonly events: AsyncIterable<ProviderExecutionEvent> }) {
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
  return events.flatMap(({ event, scope }) => {
    if (scope.kind === 'agent') {
      if (event.kind === 'native-agent-observed') {
        return [`agent:observed:${event.nativeAgentKey}`];
      }
      if (event.kind === 'native-agent-status') {
        return [`agent:status:${event.nativeAgentKey}:${event.status}`];
      }
      if (event.kind === 'native-agent-result') {
        return [`agent:result:${event.nativeAgentKey}:${event.result.storage}`];
      }
      if (event.kind === 'tool-activity') {
        return [`agent:tool:${event.toolCallId}`];
      }
      return [];
    }
    if (event.kind === 'run-started'
      || event.kind === 'output-delta'
      || event.kind === 'cancellation-acknowledged'
      || event.kind === 'connection-lost'
      || event.kind === 'recovery-started') {
      // Streamed output is a recorded semantic. This summarizer drops what it
      // does not name, so omitting it would keep the trace silent about whether
      // a turn was readable while it ran.
      return [event.kind];
    }
    if (event.kind === 'result') {
      return [`result:${event.result.storage}`];
    }
    if (event.kind === 'terminal') {
      return [`terminal:${event.terminal}:${event.reason}`];
    }
    return [];
  });
}

function summarizeBackgroundAgentCase(
  events: readonly ProviderExecutionEvent[],
  taskLoads: readonly { readonly taskId: string }[],
): string[] {
  const agentEvents = events.filter(event => event.scope.kind === 'agent');
  const observed = agentEvents.find(event => event.event.kind === 'native-agent-observed');
  const running = agentEvents.find(event =>
    event.event.kind === 'native-agent-status' && event.event.status === 'running');
  const tool = agentEvents.find(event => event.event.kind === 'tool-activity');
  const result = agentEvents.find(event => event.event.kind === 'native-agent-result');
  const completed = agentEvents.find(event =>
    event.event.kind === 'native-agent-status' && event.event.status === 'completed');
  const terminal = events.find(event => event.event.kind === 'terminal');
  const parentResult = events.find(event =>
    event.scope.kind === 'run' && event.event.kind === 'result');
  if (!observed || observed.event.kind !== 'native-agent-observed'
    || !running || running.event.kind !== 'native-agent-status'
    || !tool || tool.event.kind !== 'tool-activity'
    || !result || result.event.kind !== 'native-agent-result'
    || !completed || completed.event.kind !== 'native-agent-status'
    || !terminal || terminal.event.kind !== 'terminal'
    || !parentResult || parentResult.event.kind !== 'result'
    || taskLoads.length !== 1) {
    throw new Error('Incomplete background-agent trace evidence.');
  }
  return [
    `native-agent-observed:${observed.event.nativeAgentKey}`,
    `native-agent-status:${running.event.nativeAgentKey}:${running.event.status}`,
    `tool-activity:${tool.event.toolCallId}`,
    'result:parent',
    `terminal:${terminal.event.terminal}:${terminal.event.reason}`,
    `sidecar:hydrate:${taskLoads[0].taskId}`,
    `native-agent-result:${result.event.nativeAgentKey}:${result.event.result.storage}`,
    `native-agent-status:${completed.event.nativeAgentKey}:${completed.event.status}`,
  ];
}

async function waitFor(predicate: () => boolean, attempts = 80): Promise<void> {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
