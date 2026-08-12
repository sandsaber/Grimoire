import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '@/core/execution/ExecutionControlRecords';
import { executionSessionId, runId } from '@/core/execution/ExecutionIds';
import type {
  ExecutionLifecycleListener,
  ExecutionLifecycleNotification,
} from '@/core/execution/ExecutionLifecycleRegistry';
import { AuxiliaryExecutionCoordinator } from '@/features/chat/application/AuxiliaryExecutionCoordinator';

const BACKEND_ID = executionBackendId('provider-codex');
const SESSION_ID = executionSessionId(`es-${'4'.repeat(32)}`);
const RUN_ID = runId(`run-${'5'.repeat(32)}`);
const SESSION_ID_2 = executionSessionId(`es-${'a'.repeat(32)}`);
const RUN_ID_2 = runId(`run-${'b'.repeat(32)}`);

describe('AuxiliaryExecutionCoordinator', () => {
  it('owns an isolated required-result session outside the conversation owner', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const forget = jest.fn();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle, { forget });

    const started = await coordinator.start(command());

    expect(started).toMatchObject({
      operationId: 'aux-operation-1',
      kind: 'inline-edit',
      owner: { kind: 'auxiliary-operation', ownerId: 'aux.inline-edit:aux-operation-1' },
      state: 'running',
    });
    expect(lifecycle.created[0]).toMatchObject({
      owner: { kind: 'auxiliary-operation', ownerId: 'aux.inline-edit:aux-operation-1' },
    });
    expect(lifecycle.started[0]).toMatchObject({
      request: {
        owner: { kind: 'auxiliary-operation', ownerId: 'aux.inline-edit:aux-operation-1' },
        resultExpectation: 'required',
        requestRef: 'aux-request-1',
      },
    });
  });

  it('joins concurrent replay of one operation without acknowledging duplicate dispatch', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle);

    const first = coordinator.start(command());
    const replay = coordinator.start(command());
    const [firstProjection, replayProjection] = await Promise.all([first, replay]);

    expect(replayProjection).toEqual(firstProjection);
    expect(lifecycle.created).toHaveLength(1);
    expect(lifecycle.started).toHaveLength(1);
    lifecycle.succeed();
    await coordinator.waitForIdle();
    coordinator.dispose();
  });

  it('retains ownership when run admission is durable but its acknowledgement is lost', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    lifecycle.throwAfterStart = true;
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle);

    await expect(coordinator.start(command())).resolves.toMatchObject({ state: 'running' });
    expect(coordinator.get('aux-operation-1')).toMatchObject({ runId: RUN_ID });
    lifecycle.succeed();
    await coordinator.waitForIdle();
    coordinator.dispose();
  });

  it('latches cancellation until deferred run admission establishes durable ownership', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const release = lifecycle.delaySessionCreation();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle);

    const start = coordinator.start(command());
    const cancellation = coordinator.cancel('aux-operation-1');
    expect(lifecycle.cancelled).toEqual([]);

    release();
    await start;
    await cancellation;
    expect(lifecycle.cancelled).toEqual([RUN_ID]);
    lifecycle.succeed();
    await coordinator.waitForIdle();
    coordinator.dispose();
  });

  it('keeps the result projection after detach and disposes its isolated session at terminal', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const forget = jest.fn();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle, { forget });
    await coordinator.start(command());
    const listener = jest.fn();
    const detach = coordinator.attach('aux-operation-1', listener);
    detach();

    lifecycle.succeed();
    await coordinator.waitForIdle();

    expect(coordinator.get('aux-operation-1')).toMatchObject({
      state: 'succeeded',
      result: { resultId: 'aux-result-1', storage: 'projection' },
      terminal: {
        kind: 'succeeded',
        reason: 'completed',
        resultRef: { resultId: 'aux-result-1', storage: 'projection' },
      },
    });
    expect(forget).toHaveBeenCalledWith('aux-request-1');
    expect(lifecycle.disposedSessions).toEqual([SESSION_ID]);
    expect(listener).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('does not consume conversation-run lifecycle notifications', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle);
    await coordinator.start(command());

    lifecycle.emitConversationRun();

    expect(coordinator.get('aux-operation-1')).toMatchObject({ state: 'running' });
    expect(coordinator.get('aux-operation-1')).not.toHaveProperty('result');
  });

  it('retries session cleanup after terminal interaction hooks close ownership', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle);
    await coordinator.start(command());
    lifecycle.blockDisposal = true;

    lifecycle.succeed();
    await coordinator.waitForIdle();
    expect(lifecycle.disposedSessions).toEqual([]);
    expect(() => coordinator.dispose()).toThrow('cleanup must settle');

    lifecycle.closeInteraction();
    await coordinator.waitForIdle();
    expect(lifecycle.disposedSessions).toEqual([SESSION_ID]);
    coordinator.dispose();
  });

  it('shows later reconciliation without rewriting the immutable indeterminate terminal', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle);
    await coordinator.start(command());

    lifecycle.indeterminate();
    lifecycle.reconcile();

    expect(coordinator.get('aux-operation-1')).toMatchObject({
      terminal: { kind: 'indeterminate', reason: 'effects-unknown' },
      reconciledOutcomes: [{
        reconciliationId: 'rec-aux-1',
        observedOutcome: 'succeeded',
        observedResult: { resultId: 'aux-result-late', storage: 'provider-native' },
        evidence: { kind: 'status-query', evidenceRef: 'aux-status-1' },
      }],
    });
    await coordinator.waitForIdle();
    coordinator.dispose();

    const recovered = new AuxiliaryExecutionCoordinator(lifecycle);
    await recovered.recover();
    expect(recovered.get('aux-operation-1')).toMatchObject({
      terminal: { kind: 'indeterminate' },
      reconciledOutcomes: [expect.objectContaining({
        reconciliationId: 'rec-aux-1',
        observedOutcome: 'succeeded',
      })],
    });
    recovered.dispose();
  });

  it('recovers a durable terminal result after its native session was already disposed', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const original = new AuxiliaryExecutionCoordinator(lifecycle);
    await original.start(command());
    lifecycle.succeed();
    await original.waitForIdle();
    original.dispose();

    const recovered = new AuxiliaryExecutionCoordinator(lifecycle);
    await recovered.recover();

    expect(lifecycle.getSessions()).toEqual([]);
    expect(recovered.get('aux-operation-1')).toMatchObject({
      kind: 'inline-edit',
      state: 'succeeded',
      result: { resultId: 'aux-result-1', storage: 'projection' },
      owner: { kind: 'auxiliary-operation', ownerId: 'aux.inline-edit:aux-operation-1' },
    });
    recovered.dispose();
  });

  it('disposes a crash-left preparation session with no admitted run', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    lifecycle.seedEmptySession({
      kind: 'auxiliary-operation',
      ownerId: 'aux.inline-edit:aux-operation-1',
    });
    const recovered = new AuxiliaryExecutionCoordinator(lifecycle);

    await recovered.recover();

    expect(lifecycle.disposedSessions).toEqual([SESSION_ID]);
    expect(recovered.get('aux-operation-1')).toBeNull();
    recovered.dispose();
  });

  it('does not let one successful cleanup hide another run failure and retries by run', async () => {
    const lifecycle = new FakeAuxiliaryLifecycle();
    const coordinator = new AuxiliaryExecutionCoordinator(lifecycle);
    await Promise.all([
      coordinator.start(command()),
      coordinator.start(command({
        operationId: 'aux-operation-2',
        executionSessionId: SESSION_ID_2,
        runId: RUN_ID_2,
        requestRef: 'aux-request-2',
      })),
    ]);
    lifecycle.failNextDisposal(SESSION_ID);

    lifecycle.terminate(RUN_ID);
    lifecycle.terminate(RUN_ID_2);

    await expect(coordinator.waitForIdle()).rejects.toThrow(
      '1 auxiliary session cleanup operation(s) failed',
    );
    expect(lifecycle.disposedSessions).toEqual([SESSION_ID_2]);
    await expect(coordinator.waitForIdle()).resolves.toBeUndefined();
    expect(lifecycle.disposedSessions).toEqual([SESSION_ID_2, SESSION_ID]);
    coordinator.dispose();
  });
});

function command(overrides: Partial<ReturnType<typeof baseCommand>> = {}) {
  return { ...baseCommand(), ...overrides };
}

function baseCommand() {
  return {
    operationId: 'aux-operation-1',
    kind: 'inline-edit' as const,
    backendId: BACKEND_ID,
    executionSessionId: SESSION_ID,
    runId: RUN_ID,
    requestRef: 'aux-request-1',
    resultExpectation: 'required' as const,
    createdAt: 1,
  };
}

class FakeAuxiliaryLifecycle {
  readonly created: unknown[] = [];
  readonly started: unknown[] = [];
  readonly cancelled: unknown[] = [];
  readonly disposedSessions: unknown[] = [];
  blockDisposal = false;
  throwAfterStart = false;
  private readonly listeners = new Set<ExecutionLifecycleListener>();
  private readonly sessions = new Map<string, ExecutionSessionRecord>();
  private readonly runs = new Map<string, { record: ExecutionRunRecord; revision: number }>();
  private readonly reconciliations: ExecutionReconciliationRecord[] = [];
  private readonly disposalFailures = new Map<string, number>();
  private sessionCreationBarrier?: ReturnType<typeof deferred<void>>;

  async createSession(input: {
    backendId: typeof BACKEND_ID;
    executionSessionId: typeof SESSION_ID;
    owner: ExecutionSessionRecord['owner'];
  }) {
    this.created.push(input);
    await this.sessionCreationBarrier?.promise;
    this.sessions.set(input.executionSessionId, {
      executionSessionId: input.executionSessionId,
      sessionInstanceId: `si-${'6'.repeat(32)}`,
      backendId: input.backendId,
      backendGeneration: 1,
      owner: input.owner,
      status: 'active',
      runIds: [],
      lastSequence: 0,
      acceptedEventIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    return input.executionSessionId;
  }

  async startRun(executionSessionRecordId: typeof SESSION_ID, request: {
    runId: typeof RUN_ID;
    owner: ExecutionRunRecord['owner'];
    resultExpectation: 'required';
    requestRef: string;
  }) {
    this.started.push({ executionSessionId: executionSessionRecordId, request });
    const record: ExecutionRunRecord = {
      runId: request.runId,
      executionSessionId: executionSessionRecordId,
      owner: request.owner,
      resultExpectation: request.resultExpectation,
      state: 'running',
      dispatchState: 'accepted',
      cancellationRequested: false,
      openInteractionIds: [],
      lastSequence: 1,
      createdAt: 1,
      updatedAt: 2,
    };
    this.runs.set(request.runId, { record, revision: 1 });
    const session = this.sessions.get(executionSessionRecordId)!;
    this.sessions.set(executionSessionRecordId, { ...session, runIds: [request.runId] });
    this.emit({ kind: 'run-updated', run: record, revision: 1 });
    if (this.throwAfterStart) throw new Error('lost start acknowledgement');
    return request.runId;
  }

  async cancelRun(runRecordId: typeof RUN_ID) {
    this.cancelled.push(runRecordId);
  }

  canDisposeSession(sessionId: typeof SESSION_ID) {
    if (this.blockDisposal) return false;
    const session = this.sessions.get(sessionId);
    return session?.runIds.every(id => this.runs.get(id)?.record.terminal) ?? false;
  }

  async disposeSession(sessionId: typeof SESSION_ID) {
    const failures = this.disposalFailures.get(sessionId) ?? 0;
    if (failures > 0) {
      this.disposalFailures.set(sessionId, failures - 1);
      throw new Error('controlled auxiliary cleanup failure');
    }
    this.disposedSessions.push(sessionId);
    this.sessions.delete(sessionId);
  }

  getRunSnapshot(runRecordId: typeof RUN_ID) {
    return this.runs.get(runRecordId) ?? null;
  }

  getRunSnapshots() {
    return [...this.runs.values()];
  }

  getReconciliationsForRun(runRecordId: typeof RUN_ID) {
    return this.reconciliations.filter(record => record.runId === runRecordId);
  }

  getSessions() {
    return [...this.sessions.values()];
  }

  delaySessionCreation(): () => void {
    const barrier = deferred<void>();
    this.sessionCreationBarrier = barrier;
    return () => barrier.resolve();
  }

  seedEmptySession(owner: ExecutionSessionRecord['owner']) {
    this.sessions.set(SESSION_ID, {
      executionSessionId: SESSION_ID,
      sessionInstanceId: `si-${'6'.repeat(32)}`,
      backendId: BACKEND_ID,
      backendGeneration: 1,
      owner,
      status: 'active',
      runIds: [],
      lastSequence: 0,
      acceptedEventIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
  }

  failNextDisposal(sessionId: typeof SESSION_ID) {
    this.disposalFailures.set(sessionId, 1);
  }

  subscribe(listener: ExecutionLifecycleListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  succeed() {
    const current = this.runs.get(RUN_ID)!;
    const resultRef = { resultId: 'aux-result-1', storage: 'projection' as const };
    const record: ExecutionRunRecord = {
      ...current.record,
      state: 'succeeded',
      resultRef,
      terminal: { kind: 'succeeded', reason: 'completed', occurredAt: 3, resultRef },
      updatedAt: 3,
    };
    this.runs.set(RUN_ID, { record, revision: 2 });
    this.emit({ kind: 'run-updated', run: record, revision: 2 });
  }

  indeterminate() {
    const current = this.runs.get(RUN_ID)!;
    const record: ExecutionRunRecord = {
      ...current.record,
      state: 'indeterminate',
      terminal: { kind: 'indeterminate', reason: 'effects-unknown', occurredAt: 3 },
      updatedAt: 3,
    };
    this.runs.set(RUN_ID, { record, revision: 2 });
    this.emit({ kind: 'run-updated', run: record, revision: 2 });
  }

  terminate(runRecordId: typeof RUN_ID) {
    const current = this.runs.get(runRecordId)!;
    const record: ExecutionRunRecord = {
      ...current.record,
      state: 'indeterminate',
      terminal: { kind: 'indeterminate', reason: 'effects-unknown', occurredAt: 3 },
      updatedAt: 3,
    };
    this.runs.set(runRecordId, { record, revision: 2 });
    this.emit({ kind: 'run-updated', run: record, revision: 2 });
  }

  reconcile() {
    const record: ExecutionReconciliationRecord = {
      reconciliationId: 'rec-aux-1',
      runId: RUN_ID,
      originalTerminal: 'indeterminate',
      observedOutcome: 'succeeded',
      observedResult: { resultId: 'aux-result-late', storage: 'provider-native' },
      evidence: { kind: 'status-query', evidenceRef: 'aux-status-1' },
      recordedAt: 4,
    };
    this.reconciliations.push(record);
    this.emit({ kind: 'reconciliation-appended', reconciliation: record });
  }

  emitConversationRun() {
    this.emit({
      kind: 'run-updated',
      run: {
        runId: `run-${'7'.repeat(32)}`,
        executionSessionId: `es-${'8'.repeat(32)}`,
        owner: { kind: 'conversation', ownerId: 'conversation-1' },
        resultExpectation: 'required',
        state: 'succeeded',
        dispatchState: 'accepted',
        cancellationRequested: false,
        resultRef: { resultId: 'conversation-result', storage: 'projection' },
        terminal: { kind: 'succeeded', reason: 'completed', occurredAt: 4 },
        openInteractionIds: [],
        lastSequence: 2,
        createdAt: 1,
        updatedAt: 4,
      },
      revision: 2,
    });
  }

  closeInteraction() {
    this.blockDisposal = false;
    this.emit({
      kind: 'interaction-updated',
      interaction: {
        interactionId: `ix-${'9'.repeat(32)}`,
        runId: RUN_ID,
        kind: 'approval',
        presentationRef: 'approval-1',
        responseIds: ['allow', 'deny'],
        status: 'cancelled',
        createdAt: 2,
        updatedAt: 4,
      },
      revision: 2,
    });
  }

  private emit(notification: ExecutionLifecycleNotification) {
    for (const listener of this.listeners) listener(notification);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}
