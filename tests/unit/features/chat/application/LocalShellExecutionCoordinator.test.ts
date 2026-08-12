import { EphemeralLocalShellRequestStore } from '@/app/execution/local/EphemeralLocalShellRequestStore';
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
import { LocalShellExecutionCoordinator } from '@/features/chat/application/LocalShellExecutionCoordinator';
import { LocalShellOutputProjectionStore } from '@/features/chat/application/LocalShellOutputProjectionStore';

const BACKEND_ID = executionBackendId('internal-local-shell');
const SESSION_ID = executionSessionId(`es-${'1'.repeat(32)}`);
const RUN_ID = runId(`run-${'2'.repeat(32)}`);
const SESSION_ID_2 = executionSessionId(`es-${'4'.repeat(32)}`);
const RUN_ID_2 = runId(`run-${'5'.repeat(32)}`);

describe('LocalShellExecutionCoordinator', () => {
  it('stores only an opaque request ref in lifecycle commands and preserves output order', async () => {
    const lifecycle = new FakeShellLifecycle();
    const requests = new EphemeralLocalShellRequestStore();
    const output = new LocalShellOutputProjectionStore();
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests,
      output,
    });
    const snapshots: string[][] = [];

    await coordinator.start(command());
    const detach = coordinator.attach('shell-operation-1', projection => {
      snapshots.push(projection.output.map(entry => `${entry.channel}:${entry.text}`));
    });
    output.onStdout(RUN_ID, new TextEncoder().encode('first'));
    output.onStderr(RUN_ID, new TextEncoder().encode('second'));
    output.onStdout(RUN_ID, Uint8Array.of(0xe2));
    output.onStdout(RUN_ID, Uint8Array.of(0x82, 0xac));

    expect(lifecycle.created[0]).toEqual({
      backendId: BACKEND_ID,
      executionSessionId: SESSION_ID,
      owner: { kind: 'internal-service', ownerId: 'shell:shell-operation-1' },
    });
    expect(lifecycle.started[0]).toMatchObject({
      executionSessionId: SESSION_ID,
      request: { requestRef: 'shell-request-1', resultExpectation: 'none' },
    });
    const controlPayload = JSON.stringify({ lifecycle: lifecycle.created, runs: lifecycle.started });
    expect(controlPayload).not.toContain('printf private');
    expect(controlPayload).not.toContain('/private/workspace');
    expect(controlPayload).not.toContain('secret-value');
    expect(coordinator.get('shell-operation-1')?.output).toEqual([
      expect.objectContaining({ channel: 'stdout', text: 'first' }),
      expect.objectContaining({ channel: 'stderr', text: 'second' }),
      expect.objectContaining({ channel: 'stdout', text: '€' }),
    ]);
    expect(coordinator.get('shell-operation-1')?.outputBytes).toBe(14);

    detach();
    expect(lifecycle.cancelled).toEqual([]);
    expect(snapshots.length).toBeGreaterThanOrEqual(5);
  });

  it('joins concurrent replay without launching the same shell operation twice', async () => {
    const lifecycle = new FakeShellLifecycle();
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });

    const first = coordinator.start(command());
    const replay = coordinator.start(command());
    const [firstProjection, replayProjection] = await Promise.all([first, replay]);

    expect(replayProjection).toEqual(firstProjection);
    expect(lifecycle.created).toHaveLength(1);
    expect(lifecycle.started).toHaveLength(1);
    lifecycle.terminal('cancelled', 'cancellation-confirmed');
    await coordinator.waitForIdle();
    coordinator.dispose();
  });

  it('retains ownership when shell admission is durable but its acknowledgement is lost', async () => {
    const lifecycle = new FakeShellLifecycle();
    lifecycle.throwAfterStart = true;
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });

    await expect(coordinator.start(command())).resolves.toMatchObject({ state: 'running' });
    expect(coordinator.get('shell-operation-1')).toMatchObject({ runId: RUN_ID });
    lifecycle.terminal('cancelled', 'cancellation-confirmed');
    await coordinator.waitForIdle();
    coordinator.dispose();
  });

  it('latches cancellation until deferred shell admission establishes durable ownership', async () => {
    const lifecycle = new FakeShellLifecycle();
    const release = lifecycle.delaySessionCreation();
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });

    const start = coordinator.start(command());
    const cancellation = coordinator.cancel('shell-operation-1');
    expect(lifecycle.cancelled).toEqual([]);

    release();
    await start;
    await cancellation;
    expect(lifecycle.cancelled).toEqual([RUN_ID]);
    lifecycle.terminal('cancelled', 'cancellation-confirmed');
    await coordinator.waitForIdle();
    coordinator.dispose();
  });

  it('keeps lifecycle ownership after detach and disposes only after one durable terminal', async () => {
    const lifecycle = new FakeShellLifecycle();
    const requests = new EphemeralLocalShellRequestStore();
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests,
      output: new LocalShellOutputProjectionStore(),
    });
    await coordinator.start(command());
    const detachedListener = jest.fn();
    const detach = coordinator.attach('shell-operation-1', detachedListener);
    detach();

    await coordinator.cancel('shell-operation-1');
    expect(lifecycle.cancelled).toEqual([RUN_ID]);
    expect(() => coordinator.dispose()).toThrow('terminate local shell work');

    lifecycle.terminal('cancelled', 'cancellation-confirmed');
    await coordinator.waitForIdle();
    expect(coordinator.get('shell-operation-1')?.terminal).toMatchObject({
      kind: 'cancelled',
      reason: 'cancellation-confirmed',
    });
    expect(lifecycle.disposedSessions).toEqual([SESSION_ID]);
    expect(detachedListener).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('refuses application disposal while a terminal shell session still has an owner', async () => {
    const lifecycle = new FakeShellLifecycle();
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });
    await coordinator.start(command());
    lifecycle.blockDisposal = true;

    lifecycle.terminal('cancelled', 'cancellation-confirmed');
    await coordinator.waitForIdle();

    expect(lifecycle.disposedSessions).toEqual([]);
    expect(() => coordinator.dispose()).toThrow('cleanup must settle');
    lifecycle.blockDisposal = false;
    lifecycle.closeInteraction();
    await coordinator.waitForIdle();
    expect(lifecycle.disposedSessions).toEqual([SESSION_ID]);
    coordinator.dispose();
  });

  it('recovers only namespaced shell owners and leaves other internal services untouched', async () => {
    const foreignLifecycle = new FakeShellLifecycle();
    foreignLifecycle.seedTerminalSession('indexer:operation-1');
    const foreign = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle: foreignLifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });
    await foreign.recover();
    expect(foreign.get('operation-1')).toBeNull();
    foreign.dispose();

    const shellLifecycle = new FakeShellLifecycle();
    shellLifecycle.seedTerminalSession('shell:shell-operation-1');
    const shell = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle: shellLifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });
    await shell.recover();
    await shell.waitForIdle();
    expect(shell.get('shell-operation-1')).toMatchObject({
      state: 'succeeded',
      outputHistory: 'partial-after-restart',
      terminal: { kind: 'succeeded', reason: 'completed' },
    });
    expect(shellLifecycle.disposedSessions).toEqual([SESSION_ID]);
    shell.dispose();

    const restarted = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle: shellLifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });
    await restarted.recover();
    expect(restarted.get('shell-operation-1')).toMatchObject({
      state: 'succeeded',
      outputHistory: 'partial-after-restart',
    });
    restarted.dispose();
  });

  it('disposes a crash-left shell preparation session with no admitted run', async () => {
    const lifecycle = new FakeShellLifecycle();
    lifecycle.seedEmptySession('shell:shell-operation-1');
    const recovered = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });

    await recovered.recover();

    expect(lifecycle.disposedSessions).toEqual([SESSION_ID]);
    expect(recovered.get('shell-operation-1')).toBeNull();
    recovered.dispose();
  });

  it('keeps the original shell terminal immutable when reconciliation arrives later', async () => {
    const lifecycle = new FakeShellLifecycle();
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });
    await coordinator.start(command());

    lifecycle.indeterminate();
    lifecycle.reconcile();

    expect(coordinator.get('shell-operation-1')).toMatchObject({
      terminal: { kind: 'indeterminate', reason: 'effects-unknown' },
      reconciledOutcomes: [{
        reconciliationId: 'rec-shell-1',
        observedOutcome: 'succeeded',
        evidence: { kind: 'status-query', evidenceRef: 'shell-status-1' },
      }],
    });
    await coordinator.waitForIdle();
    coordinator.dispose();
  });

  it('does not let one successful shell cleanup hide another run failure', async () => {
    const lifecycle = new FakeShellLifecycle();
    const coordinator = new LocalShellExecutionCoordinator({
      backendId: BACKEND_ID,
      lifecycle,
      requests: new EphemeralLocalShellRequestStore(),
      output: new LocalShellOutputProjectionStore(),
    });
    await Promise.all([
      coordinator.start(command()),
      coordinator.start(command({
        operationId: 'shell-operation-2',
        executionSessionId: SESSION_ID_2,
        runId: RUN_ID_2,
        requestRef: 'shell-request-2',
      })),
    ]);
    lifecycle.failNextDisposal(SESSION_ID);

    lifecycle.terminate(RUN_ID);
    lifecycle.terminate(RUN_ID_2);

    await expect(coordinator.waitForIdle()).rejects.toThrow(
      '1 local shell session cleanup operation(s) failed',
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
    operationId: 'shell-operation-1',
    executionSessionId: SESSION_ID,
    runId: RUN_ID,
    requestRef: 'shell-request-1',
    displayLabel: 'Local command',
    invocation: {
      command: 'printf private',
      cwd: '/private/workspace',
      environment: { TOKEN: 'secret-value' },
    },
    createdAt: 1,
  };
}

class FakeShellLifecycle {
  readonly created: unknown[] = [];
  readonly started: unknown[] = [];
  readonly cancelled: unknown[] = [];
  readonly disposedSessions: unknown[] = [];
  throwAfterStart = false;
  blockDisposal = false;
  private readonly listeners = new Set<ExecutionLifecycleListener>();
  private readonly sessions = new Map<string, ExecutionSessionRecord>();
  private readonly runs = new Map<string, { record: ExecutionRunRecord; revision: number }>();
  private readonly reconciliations: ExecutionReconciliationRecord[] = [];
  private readonly disposalFailures = new Map<string, number>();
  private sessionCreationBarrier?: ReturnType<typeof deferred<void>>;

  async createSession(commandRecord: Parameters<LocalShellExecutionCoordinator['start']>[0] extends never
    ? never
    : { backendId: typeof BACKEND_ID; executionSessionId: typeof SESSION_ID; owner: ExecutionSessionRecord['owner'] }) {
    this.created.push(commandRecord);
    await this.sessionCreationBarrier?.promise;
    this.sessions.set(commandRecord.executionSessionId, {
      executionSessionId: commandRecord.executionSessionId,
      sessionInstanceId: `si-${'3'.repeat(32)}`,
      backendId: commandRecord.backendId,
      backendGeneration: 1,
      owner: commandRecord.owner,
      status: 'active',
      runIds: [],
      lastSequence: 0,
      acceptedEventIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    return commandRecord.executionSessionId;
  }

  async startRun(executionSessionRecordId: typeof SESSION_ID, request: {
    runId: typeof RUN_ID;
    owner: ExecutionRunRecord['owner'];
    resultExpectation: 'none';
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
      throw new Error('controlled shell cleanup failure');
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

  seedTerminalSession(ownerId: string) {
    const owner = { kind: 'internal-service' as const, ownerId };
    this.sessions.set(SESSION_ID, {
      executionSessionId: SESSION_ID,
      sessionInstanceId: `si-${'3'.repeat(32)}`,
      backendId: BACKEND_ID,
      backendGeneration: 1,
      owner,
      status: 'active',
      runIds: [RUN_ID],
      lastSequence: 2,
      acceptedEventIds: [],
      createdAt: 1,
      updatedAt: 3,
    });
    this.runs.set(RUN_ID, {
      record: {
        runId: RUN_ID,
        executionSessionId: SESSION_ID,
        owner,
        resultExpectation: 'none',
        state: 'succeeded',
        dispatchState: 'accepted',
        cancellationRequested: false,
        terminal: { kind: 'succeeded', reason: 'completed', occurredAt: 3 },
        openInteractionIds: [],
        lastSequence: 2,
        createdAt: 1,
        updatedAt: 3,
      },
      revision: 2,
    });
  }

  delaySessionCreation(): () => void {
    const barrier = deferred<void>();
    this.sessionCreationBarrier = barrier;
    return () => barrier.resolve();
  }

  seedEmptySession(ownerId: string) {
    this.sessions.set(SESSION_ID, {
      executionSessionId: SESSION_ID,
      sessionInstanceId: `si-${'3'.repeat(32)}`,
      backendId: BACKEND_ID,
      backendGeneration: 1,
      owner: { kind: 'internal-service', ownerId },
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

  terminal(kind: 'cancelled', reason: 'cancellation-confirmed') {
    const current = this.runs.get(RUN_ID)!;
    const record: ExecutionRunRecord = {
      ...current.record,
      state: kind,
      cancellationRequested: true,
      terminal: { kind, reason, occurredAt: 3 },
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
      reconciliationId: 'rec-shell-1',
      runId: RUN_ID,
      originalTerminal: 'indeterminate',
      observedOutcome: 'succeeded',
      evidence: { kind: 'status-query', evidenceRef: 'shell-status-1' },
      recordedAt: 4,
    };
    this.reconciliations.push(record);
    this.emit({ kind: 'reconciliation-appended', reconciliation: record });
  }

  closeInteraction() {
    this.emit({
      kind: 'interaction-updated',
      interaction: {
        interactionId: `ix-${'8'.repeat(32)}`,
        runId: RUN_ID,
        kind: 'approval',
        presentationRef: 'shell-approval-1',
        responseIds: ['deny'],
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
