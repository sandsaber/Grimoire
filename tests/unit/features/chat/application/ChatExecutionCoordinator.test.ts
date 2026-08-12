import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import {
  executionSessionId,
  interactionId,
  lifecycleLeaseId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import { ConversationRepository } from '@/core/persistence/ConversationRepository';
import type { VersionedRecord } from '@/core/persistence/VersionedRecord';
import type { Conversation } from '@/core/types';
import {
  type ChatConversationPersistencePort,
  ChatExecutionCoordinator,
  type ChatExecutionLifecyclePort,
} from '@/features/chat/application/ChatExecutionCoordinator';

describe('ChatExecutionCoordinator', () => {
  it('rejects admission when disposal wins a deferred conversation load', async () => {
    const fixture = await createFixture(false);
    fixture.conversations.gateNextRead();
    const submission = fixture.coordinator.submitTurn(command(1, 'none'));
    await fixture.conversations.waitUntilReadBlocked();

    fixture.coordinator.dispose();
    fixture.conversations.releaseRead();

    await expect(submission).rejects.toThrow('disposed before turn admission');
    expect(fixture.coordinator.getProjection('conversation-1')).toBeNull();
    expect(fixture.registry.getSessionsForOwner({
      kind: 'conversation',
      ownerId: 'conversation-1',
    })).toEqual([]);
  });

  it('does not dispatch after disposal wins a deferred user-message write', async () => {
    const fixture = await createFixture(false, 1);
    const ticket = await fixture.coordinator.submitTurn(command(1, 'none'));
    const startedOutcome = ticket.started.then(
      () => 'started',
      error => error instanceof Error ? error.message : String(error),
    );
    const completionOutcome = ticket.completion.then(
      () => 'completed',
      error => error instanceof Error ? error.message : String(error),
    );
    await fixture.conversations.waitUntilBlocked();

    fixture.coordinator.dispose();
    fixture.conversations.release();

    await expect(startedOutcome).resolves.toContain('disposed before turn admission');
    await expect(completionOutcome).resolves.toContain('disposed before turn admission');
    await waitUntil(async () => (
      (await currentConversation(fixture.repository, 'conversation-1')).payload.messages.length === 1
    ));
    expect(fixture.registry.getSessionsForOwner({
      kind: 'conversation',
      ownerId: 'conversation-1',
    })).toEqual([]);
  });

  it('releases queued input only after the terminal result crosses the persistence barrier', async () => {
    const fixture = await createFixture(true);
    const first = await fixture.coordinator.submitTurn(command(1, 'required'));
    const second = await fixture.coordinator.submitTurn(command(2, 'none'));

    expect(first.admission).toBe('started');
    expect(second.admission).toBe('queued');
    const firstStarted = await first.started;
    let secondStarted = false;
    void second.started.then(() => { secondStarted = true; });

    fixture.backend.emit(firstStarted.runId, {
      kind: 'thinking-activity',
    });
    fixture.backend.emit(firstStarted.runId, {
      kind: 'result',
      result: { resultId: 'result-1', storage: 'projection' },
    });
    fixture.backend.emit(firstStarted.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await fixture.conversations.waitUntilBlocked();

    expect(secondStarted).toBe(false);
    expect(fixture.coordinator.getProjection('conversation-1')).toMatchObject({
      activeRunId: firstStarted.runId,
      queuedCommandIds: ['command-2'],
      turns: [{
        run: { sawThinking: true, state: 'succeeded' },
        persistence: 'saving',
        result: { finalAssistantText: 'final result' },
      }],
    });

    fixture.conversations.release();
    await expect(first.completion).resolves.toMatchObject({
      runId: firstStarted.runId,
      terminal: { kind: 'succeeded', reason: 'completed' },
    });
    const secondTurn = await second.started;
    expect(secondStarted).toBe(true);

    fixture.backend.emit(secondTurn.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await expect(second.completion).resolves.toMatchObject({
      runId: secondTurn.runId,
      terminal: { kind: 'succeeded' },
    });

    const conversation = await currentConversation(fixture.repository, 'conversation-1');
    expect(conversation.payload.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'first'],
      ['assistant', 'final result'],
      ['user', 'second'],
    ]);
    expect(fixture.coordinator.getProjection('conversation-1')).toMatchObject({
      activeRunId: undefined,
      queuedCommandIds: [],
      turns: [
        { persistence: 'saved', assistantMessageId: `assistant-${firstStarted.runId}` },
        { persistence: 'saved' },
      ],
    });
  });

  it('keeps a failed persistence barrier visible and retries without redispatch', async () => {
    const fixture = await createFixture(false);
    fixture.conversations.failCompletion = true;
    const ticket = await fixture.coordinator.submitTurn(command(1, 'required'));
    const started = await ticket.started;
    fixture.backend.emit(started.runId, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: interactionId(`ix-${'e'.repeat(32)}`),
        runId: started.runId,
        kind: 'approval',
        presentationRef: 'approval-1',
        responseIds: ['allow', 'deny'],
      },
    });
    await fixture.registry.waitForIdle();

    fixture.backend.emit(started.runId, {
      kind: 'result',
      result: { resultId: 'result-1', storage: 'projection' },
    });
    fixture.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await fixture.registry.waitForIdle();
    await waitUntil(() => (
      fixture.coordinator.getProjection('conversation-1')?.turns[0]?.persistence === 'failed'
    ));

    expect(fixture.backend.dispatchAttempts.get(started.runId)).toBe(1);
    expect(fixture.coordinator.getProjection('conversation-1')?.activeRunId).toBe(started.runId);

    fixture.conversations.failCompletion = false;
    await fixture.coordinator.retryPersistence('conversation-1');
    await expect(ticket.completion).resolves.toMatchObject({ runId: started.runId });
    expect(fixture.backend.dispatchAttempts.get(started.runId)).toBe(1);
  });

  it('represents lease acquisition failure and retries without an unhandled rejection', async () => {
    const fixture = await createFixture(false);
    const ticket = await fixture.coordinator.submitTurn(command(1, 'none'));
    const started = await ticket.started;
    fixture.failNextLease();

    fixture.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await waitUntil(() => (
      fixture.coordinator.getProjection('conversation-1')?.turns[0]?.persistence === 'failed'
    ));

    await fixture.coordinator.retryPersistence('conversation-1');
    await expect(ticket.completion).resolves.toMatchObject({ runId: started.runId });
  });

  it('detaches projection listeners without cancelling application-owned work', async () => {
    const fixture = await createFixture(false);
    const snapshots: number[] = [];
    const detach = await fixture.coordinator.attach('conversation-1', projection => {
      snapshots.push(projection.turns.length);
    });
    const ticket = await fixture.coordinator.submitTurn(command(1, 'none'));
    const started = await ticket.started;
    detach();

    fixture.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await expect(ticket.completion).resolves.toMatchObject({ runId: started.runId });

    expect(fixture.backend.getRun(started.runId)?.cancellationReasons).toEqual([]);
    expect(snapshots.length).toBeGreaterThan(1);
  });

  it('keeps the immutable terminal visible when later reconciliation arrives', async () => {
    const fixture = await createFixture(false);
    const ticket = await fixture.coordinator.submitTurn(command(1, 'none'));
    const started = await ticket.started;
    fixture.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'indeterminate',
      reason: 'effects-unknown',
    });
    await ticket.completion;
    await fixture.registry.waitForIdle();

    await fixture.registry.appendReconciliation({
      reconciliationId: `rec-${'a'.repeat(32)}`,
      runId: started.runId,
      originalTerminal: 'indeterminate',
      observedOutcome: 'succeeded',
      observedResult: { resultId: 'observed-result-1', storage: 'provider-native' },
      evidence: { kind: 'native-history', evidenceRef: 'history-1' },
      recordedAt: 100,
    });
    await waitUntil(() => (
      fixture.coordinator.getProjection('conversation-1')?.turns[0]
        ?.observedResults.length === 1
    ));

    expect(fixture.coordinator.getProjection('conversation-1')?.turns[0]).toMatchObject({
      run: {
        terminal: { kind: 'indeterminate', reason: 'effects-unknown' },
        reconciledOutcomes: [{
          observedOutcome: 'succeeded',
          observedResult: { resultId: 'observed-result-1' },
        }],
      },
      observedResults: [{ result: { finalAssistantText: 'final result' } }],
    });
  });

  it('restores durable run, interaction, and reconciliation projections after coordinator restart', async () => {
    const fixture = await createFixture(false);
    const ticket = await fixture.coordinator.submitTurn(command(1, 'required'));
    const started = await ticket.started;
    fixture.backend.emit(started.runId, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: interactionId(`ix-${'e'.repeat(32)}`),
        runId: started.runId,
        kind: 'approval',
        presentationRef: 'approval-1',
        responseIds: ['allow', 'deny'],
      },
    });
    await fixture.registry.waitForIdle();
    fixture.backend.emit(started.runId, {
      kind: 'result',
      result: { resultId: 'result-1', storage: 'projection' },
    });
    fixture.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'indeterminate',
      reason: 'effects-unknown',
    });
    await ticket.completion;
    await fixture.registry.waitForIdle();
    await fixture.registry.appendReconciliation({
      reconciliationId: `rec-${'b'.repeat(32)}`,
      runId: started.runId,
      originalTerminal: 'indeterminate',
      observedOutcome: 'succeeded',
      evidence: { kind: 'status-query', evidenceRef: 'status-1' },
      recordedAt: 100,
    });
    fixture.coordinator.dispose();
    await fixture.registry.shutdown(`sd-${'d'.repeat(32)}`);

    const restarted = await fixture.restartLifecycle();
    const restored = fixture.createCoordinator(restarted.registry);
    const projection = await restored.loadConversation('conversation-1');

    expect(projection).toMatchObject({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'final result' },
      ],
      turns: [{
        runId: started.runId,
        persistence: 'saved',
        run: {
          terminal: { kind: 'indeterminate' },
          reconciledOutcomes: [{ observedOutcome: 'succeeded' }],
        },
      }],
      interactions: [{ status: 'cancelled', presentationRef: 'approval-1' }],
    });
  });

  it('requires a run-specific completion marker instead of trusting a newer response timestamp', async () => {
    const fixture = await createFixture(false);
    const current = await currentConversation(fixture.repository, 'conversation-1');
    await fixture.repository.update('conversation-1', current.revision, conversation => ({
      ...conversation,
      lastResponseAt: 10_000,
      updatedAt: 10_000,
    }));
    fixture.conversations.failCompletion = true;
    const ticket = await fixture.coordinator.submitTurn(command(1, 'none'));
    const started = await ticket.started;
    fixture.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await waitUntil(() => (
      fixture.coordinator.getProjection('conversation-1')?.turns[0]?.persistence === 'failed'
    ));
    expect((await currentConversation(fixture.repository, 'conversation-1'))
      .payload.executionCompletions).toBeUndefined();

    fixture.conversations.failCompletion = false;
    fixture.coordinator.dispose();
    await fixture.registry.shutdown(`sd-${'c'.repeat(32)}`);
    const restarted = await fixture.restartLifecycle();
    const restored = fixture.createCoordinator(restarted.registry);
    await restored.loadConversation('conversation-1');
    await waitUntil(async () => {
      const conversation = await currentConversation(fixture.repository, 'conversation-1');
      return conversation.payload.executionCompletions?.some(completion => (
        completion.runId === started.runId
      )) ?? false;
    });

    const persisted = await currentConversation(fixture.repository, 'conversation-1');
    expect(persisted.payload.lastResponseAt).toBe(10_000);
    expect(persisted.payload.executionCompletions).toEqual([
      expect.objectContaining({ runId: started.runId, terminalKind: 'succeeded' }),
    ]);
  });

  it('repairs a completion marker whose terminal kind disagrees with the durable run', async () => {
    const fixture = await createFixture(false);
    const ticket = await fixture.coordinator.submitTurn(command(1, 'none'));
    const started = await ticket.started;
    fixture.backend.emit(started.runId, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await ticket.completion;
    const current = await currentConversation(fixture.repository, 'conversation-1');
    await fixture.repository.update('conversation-1', current.revision, conversation => ({
      ...conversation,
      executionCompletions: conversation.executionCompletions?.map(completion => ({
        ...completion,
        terminalKind: 'failed',
      })),
    }));

    fixture.coordinator.dispose();
    await fixture.registry.shutdown(`sd-${'e'.repeat(32)}`);
    const restarted = await fixture.restartLifecycle();
    const restored = fixture.createCoordinator(restarted.registry);
    await restored.loadConversation('conversation-1');
    await waitUntil(async () => {
      const markerRepaired = (await currentConversation(fixture.repository, 'conversation-1'))
        .payload.executionCompletions?.some(completion => (
          completion.runId === started.runId && completion.terminalKind === 'succeeded'
        )) ?? false;
      return markerRepaired
        && restored.getProjection('conversation-1')?.turns[0]?.persistence === 'saved';
    });

    expect(restored.getProjection('conversation-1')?.turns[0]).toMatchObject({
      persistence: 'saved',
      run: { terminal: { kind: 'succeeded' } },
    });
  });
});

async function createFixture(gateCompletion: boolean, gateUpdate?: number) {
  const storage = new TestDurableStorage();
  let clock = 1;
  const now = () => clock++;
  const repository = new ConversationRepository(storage, { now });
  await repository.create({
    id: 'conversation-1',
    providerId: 'provider-1',
    title: 'Coordinator test',
    createdAt: now(),
    updatedAt: now(),
    sessionId: null,
    messages: [],
  });
  const conversations = new GatedConversationPort(
    repository,
    gateUpdate ?? (gateCompletion ? 2 : null),
  );
  let instanceOrdinal = 0;
  let transactionOrdinal = 0;
  const createBackend = () => new DeterministicFakeBackend({
    now,
    sessionInstanceIdFactory: () => sessionInstanceId(
      `si-${(++instanceOrdinal).toString(16).padStart(32, '0')}`,
    ),
  });
  const createLifecycle = (backend: DeterministicFakeBackend) => {
    const controls = new ExecutionControlRepositories(storage, now);
    const transactions = new ExecutionControlTransactionCoordinator(storage, controls, { now });
    const registry = new ExecutionLifecycleRegistry({
      repositories: controls,
      controlTransactions: transactions,
      nextTransactionId: () => `tx-${(++transactionOrdinal).toString(16).padStart(32, '0')}`,
      now,
      scheduler: new PassiveScheduler(),
    });
    registry.registerBackend({
      backend,
      recovery: backend.nativeStatusRecovery,
      interactions: backend,
    });
    return registry;
  };
  const backend = createBackend();
  const registry = createLifecycle(backend);
  await registry.start();
  let sessionOrdinal = 0;
  let runOrdinal = 0;
  let leaseOrdinal = 0;
  let leaseFailures = 0;
  const createCoordinator = (
    lifecycle: ExecutionLifecycleRegistry = registry,
  ) => new ChatExecutionCoordinator({
      lifecycle: withLeaseFault(lifecycle, () => {
        if (leaseFailures < 1) return false;
        leaseFailures -= 1;
        return true;
      }),
      conversations,
      results: {
        materialize: async resultRef => ({ resultRef, finalAssistantText: 'final result' }),
      },
      nextExecutionSessionId: () => executionSessionId(
        `es-${(++sessionOrdinal).toString(16).padStart(32, '0')}`,
      ),
      nextRunId: () => runId(`run-${(++runOrdinal).toString(16).padStart(32, '0')}`),
      nextLeaseId: () => lifecycleLeaseId(
        `lease-${(++leaseOrdinal).toString(16).padStart(32, '0')}`,
      ),
      assistantMessageIdForRun: id => `assistant-${id}`,
      now,
    });
  const coordinator = createCoordinator();
  const restartLifecycle = async () => {
    const nextBackend = createBackend();
    const nextRegistry = createLifecycle(nextBackend);
    await nextRegistry.start();
    return { backend: nextBackend, registry: nextRegistry };
  };
  return {
    repository,
    conversations,
    backend,
    registry,
    coordinator,
    createCoordinator,
    restartLifecycle,
    failNextLease: () => { leaseFailures += 1; },
  };
}

function command(ordinal: number, resultExpectation: 'required' | 'none') {
  return {
    commandId: `command-${ordinal}`,
    conversationId: 'conversation-1',
    backendId: new DeterministicFakeBackend({
      sessionInstanceIdFactory: () => sessionInstanceId(`si-${'f'.repeat(32)}`),
    }).descriptor.backendId,
    requestRef: `request-${ordinal}`,
    resultExpectation,
    userMessage: {
      id: `user-${ordinal}`,
      role: 'user' as const,
      content: ordinal === 1 ? 'first' : 'second',
      timestamp: ordinal,
    },
  };
}

class GatedConversationPort implements ChatConversationPersistencePort {
  private readonly blocked = deferred<void>();
  private readonly released = deferred<void>();
  private readonly readBlocked = deferred<void>();
  private readonly readReleased = deferred<void>();
  private updateCount = 0;
  private shouldGateRead = false;
  failCompletion = false;

  constructor(
    private readonly delegate: ConversationRepository,
    private readonly gateUpdate: number | null,
  ) {}

  async read(conversationId: string) {
    if (this.shouldGateRead) {
      this.shouldGateRead = false;
      this.readBlocked.resolve();
      await this.readReleased.promise;
    }
    return this.delegate.read(conversationId);
  }

  async update(
    conversationId: string,
    expectedRevision: number,
    mutation: (conversation: Conversation) => Conversation,
  ) {
    this.updateCount += 1;
    if (this.gateUpdate === this.updateCount) {
      this.blocked.resolve();
      await this.released.promise;
    }
    if (this.failCompletion && this.updateCount > 1) {
      throw new Error('injected completion persistence failure');
    }
    return this.delegate.update(conversationId, expectedRevision, mutation);
  }

  waitUntilBlocked(): Promise<void> {
    return this.blocked.promise;
  }

  release(): void {
    this.released.resolve();
  }

  gateNextRead(): void {
    this.shouldGateRead = true;
  }

  waitUntilReadBlocked(): Promise<void> {
    return this.readBlocked.promise;
  }

  releaseRead(): void {
    this.readReleased.resolve();
  }
}

class PassiveScheduler implements ExecutionLifecycleScheduler {
  setTimeout(callback: () => void): unknown {
    return callback;
  }

  clearTimeout(): void {}
}

function withLeaseFault(
  lifecycle: ExecutionLifecycleRegistry,
  shouldFail: () => boolean,
): ChatExecutionLifecyclePort {
  return new Proxy(lifecycle, {
    get(target, property, receiver) {
      if (property === 'acquireLease') {
        return (...args: Parameters<ExecutionLifecycleRegistry['acquireLease']>) => {
          if (shouldFail()) throw new Error('injected lease acquisition failure');
          return target.acquireLease(...args);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function currentConversation(
  repository: ConversationRepository,
  conversationId: string,
): Promise<VersionedRecord<Conversation>> {
  const result = await repository.read(conversationId);
  if (result.kind !== 'current' && result.kind !== 'migrated') {
    throw new Error(`Expected current conversation, received ${result.kind}.`);
  }
  return result.record;
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let turn = 0; turn < 1_000; turn += 1) {
    if (await predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition did not become true.');
}
