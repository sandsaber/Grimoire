import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionOwner,
  ResultExpectation,
} from '../../../core/execution/ExecutionContracts';
import type {
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '../../../core/execution/ExecutionControlRecords';
import type { ExecutionSessionId, RunId } from '../../../core/execution/ExecutionIds';
import type { ExecutionLifecycleListener } from '../../../core/execution/ExecutionLifecycleRegistry';
import {
  applyAuxiliaryReconciliation,
  applyAuxiliaryRunRecord,
  type AuxiliaryOperationKind,
  type AuxiliaryOperationProjection,
  createAuxiliaryOperationProjection,
  parseAuxiliaryOperationOwner,
} from '../projections/AuxiliaryOperationProjection';

export interface AuxiliaryLifecyclePort {
  createSession(command: {
    readonly backendId: ExecutionBackendId;
    readonly executionSessionId: ExecutionSessionId;
    readonly owner: ExecutionOwner;
  }): Promise<ExecutionSessionId>;
  startRun(executionSessionId: ExecutionSessionId, request: {
    readonly runId: RunId;
    readonly owner: ExecutionOwner;
    readonly resultExpectation: ResultExpectation;
    readonly requestRef: string;
  }): Promise<RunId>;
  cancelRun(runId: RunId, reason?: CancellationReason): Promise<void>;
  canDisposeSession(executionSessionId: ExecutionSessionId): boolean;
  disposeSession(executionSessionId: ExecutionSessionId): Promise<void>;
  getRunSnapshot(runId: RunId): {
    readonly record: Readonly<ExecutionRunRecord>;
    readonly revision: number;
  } | null;
  getRunSnapshots(): readonly {
    readonly record: Readonly<ExecutionRunRecord>;
    readonly revision: number;
  }[];
  getReconciliationsForRun(runId: RunId): readonly Readonly<ExecutionReconciliationRecord>[];
  getSessions(): readonly Readonly<ExecutionSessionRecord>[];
  subscribe(listener: ExecutionLifecycleListener): () => void;
}

export interface AuxiliaryRequestCleanupPort {
  forget(requestRef: string): void;
}

export interface AuxiliaryOperationCommand {
  readonly operationId: string;
  readonly kind: AuxiliaryOperationKind;
  readonly backendId: ExecutionBackendId;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
  readonly requestRef: string;
  readonly resultExpectation: ResultExpectation;
  readonly createdAt: number;
}

interface AuxiliaryEntry {
  projection: AuxiliaryOperationProjection;
  readonly listeners: Set<(projection: AuxiliaryOperationProjection) => void>;
  readonly identity?: Pick<AuxiliaryOperationCommand,
  'backendId' | 'requestRef' | 'resultExpectation' | 'createdAt'>;
  startTask?: Promise<AuxiliaryOperationProjection>;
  requestRef?: string;
}

export class AuxiliaryExecutionCoordinator {
  private readonly entries = new Map<string, AuxiliaryEntry>();
  private readonly runOwners = new Map<RunId, string>();
  private readonly runSessions = new Map<RunId, ExecutionSessionId>();
  private readonly cleanupTasks = new Set<Promise<void>>();
  private readonly cleanupScheduled = new Set<RunId>();
  private readonly cleanupFailures = new Map<RunId, Error>();
  private readonly cancellationTasks = new Map<string, Promise<void>>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    private readonly lifecycle: AuxiliaryLifecyclePort,
    private readonly requests?: AuxiliaryRequestCleanupPort,
  ) {
    this.unsubscribe = lifecycle.subscribe(notification => {
      if (notification.kind === 'run-updated') {
        this.observeRun(notification.run, notification.revision);
      } else if (notification.kind === 'reconciliation-appended') {
        this.observeReconciliation(notification.reconciliation);
      } else if (notification.kind === 'interaction-updated') {
        this.scheduleCleanup(notification.interaction.runId as RunId);
      }
    });
  }

  async recover(): Promise<void> {
    this.requireOpen();
    const activeSessions = new Map(this.lifecycle.getSessions().map(session => [
      session.executionSessionId,
      session,
    ]));
    for (const session of activeSessions.values()) {
      if (!parseAuxiliaryOperationOwner(session.owner)) continue;
      if (session.runIds.length === 0) {
        if (!this.lifecycle.canDisposeSession(
          session.executionSessionId as ExecutionSessionId,
        )) {
          throw new Error('An empty auxiliary preparation session is not disposable.');
        }
        await this.lifecycle.disposeSession(session.executionSessionId as ExecutionSessionId);
        activeSessions.delete(session.executionSessionId);
        continue;
      }
      if (session.runIds.length > 1) {
        throw new Error('An auxiliary session must own exactly one run.');
      }
    }
    for (const snapshot of this.lifecycle.getRunSnapshots()) {
      const owner = parseAuxiliaryOperationOwner(snapshot.record.owner);
      if (!owner) continue;
      const runId = snapshot.record.runId as RunId;
      const { operationId, kind } = owner;
      const executionSessionId = snapshot.record.executionSessionId as ExecutionSessionId;
      const existing = this.entries.get(operationId);
      if (existing && existing.projection.runId !== runId) {
        throw new Error('Auxiliary operation identity owns conflicting durable runs.');
      }
      const entry = existing ?? {
        projection: createAuxiliaryOperationProjection({
          operationId,
          kind,
          executionSessionId,
          runId,
          resultExpectation: snapshot.record.resultExpectation,
          createdAt: snapshot.record.createdAt,
        }),
        listeners: new Set(),
      };
      entry.projection = applyAuxiliaryRunRecord(
        entry.projection,
        snapshot.record,
        snapshot.revision,
      );
      for (const reconciliation of this.lifecycle.getReconciliationsForRun(runId)) {
        entry.projection = applyAuxiliaryReconciliation(entry.projection, reconciliation);
      }
      this.entries.set(operationId, entry);
      this.runOwners.set(runId, operationId);
      const activeSession = activeSessions.get(executionSessionId);
      if (activeSession) {
        if (activeSession.owner.ownerId !== snapshot.record.owner.ownerId
          || activeSession.runIds[0] !== runId) {
          throw new Error('Auxiliary run conflicts with its active session ownership.');
        }
        this.runSessions.set(runId, executionSessionId);
      }
      if (snapshot.record.terminal && activeSession) {
        this.scheduleCleanup(runId);
      }
    }
  }

  start(command: AuxiliaryOperationCommand): Promise<AuxiliaryOperationProjection> {
    this.requireOpen();
    validateCommand(command);
    const existing = this.entries.get(command.operationId);
    if (existing) {
      if (existing.projection.runId === command.runId
        && existing.projection.executionSessionId === command.executionSessionId
        && existing.projection.kind === command.kind
        && (!existing.identity || sameAuxiliaryIdentity(existing.identity, command))) {
        return existing.startTask ?? Promise.resolve(existing.projection);
      }
      return Promise.reject(new Error(
        'Auxiliary operation id conflicts with an existing operation.',
      ));
    }
    const projection = createAuxiliaryOperationProjection(command);
    const existingRunOwner = this.runOwners.get(command.runId);
    if (existingRunOwner) {
      return Promise.reject(new Error('Auxiliary run id already belongs to another operation.'));
    }
    const entry: AuxiliaryEntry = {
      projection,
      listeners: new Set(),
      identity: command,
      requestRef: command.requestRef,
    };
    this.entries.set(command.operationId, entry);
    this.runOwners.set(command.runId, command.operationId);
    this.runSessions.set(command.runId, command.executionSessionId);
    const task = this.startEntry(command, entry);
    entry.startTask = task;
    return task;
  }

  private async startEntry(
    command: AuxiliaryOperationCommand,
    entry: AuxiliaryEntry,
  ): Promise<AuxiliaryOperationProjection> {
    const owner = entry.projection.owner;
    let sessionCreated = false;
    try {
      await this.lifecycle.createSession({
        backendId: command.backendId,
        executionSessionId: command.executionSessionId,
        owner,
      });
      sessionCreated = true;
      await this.lifecycle.startRun(command.executionSessionId, {
        runId: command.runId,
        owner,
        resultExpectation: command.resultExpectation,
        requestRef: command.requestRef,
      });
      const snapshot = this.lifecycle.getRunSnapshot(command.runId);
      if (snapshot) this.observeRun(snapshot.record, snapshot.revision);
      entry.startTask = undefined;
      return entry.projection;
    } catch (error) {
      const retained = this.lifecycle.getRunSnapshot(command.runId);
      if (retained
        && retained.record.executionSessionId === command.executionSessionId
        && retained.record.owner.kind === owner.kind
        && retained.record.owner.ownerId === owner.ownerId) {
        this.observeRun(retained.record, retained.revision);
        entry.startTask = undefined;
        return entry.projection;
      }
      this.requests?.forget(command.requestRef);
      entry.requestRef = undefined;
      try {
        if (sessionCreated && this.lifecycle.canDisposeSession(command.executionSessionId)) {
          await this.lifecycle.disposeSession(command.executionSessionId);
        }
      } finally {
        this.entries.delete(command.operationId);
        this.runOwners.delete(command.runId);
        this.runSessions.delete(command.runId);
        entry.startTask = undefined;
      }
      throw error;
    }
  }

  attach(
    operationId: string,
    listener: (projection: AuxiliaryOperationProjection) => void,
  ): () => void {
    this.requireOpen();
    const entry = this.requireEntry(operationId);
    entry.listeners.add(listener);
    listener(entry.projection);
    return () => entry.listeners.delete(listener);
  }

  get(operationId: string): AuxiliaryOperationProjection | null {
    return this.entries.get(operationId)?.projection ?? null;
  }

  waitForCompletion(operationId: string): Promise<AuxiliaryOperationProjection> {
    this.requireOpen();
    const current = this.get(operationId);
    if (!current) return Promise.reject(new Error('Auxiliary operation is absent.'));
    if (current.terminal) return Promise.resolve(current);
    return new Promise(resolve => {
      const detach = this.attach(operationId, projection => {
        if (!projection.terminal) return;
        detach();
        resolve(projection);
      });
    });
  }

  cancel(operationId: string): Promise<void> {
    this.requireOpen();
    const entry = this.requireEntry(operationId);
    const existing = this.cancellationTasks.get(operationId);
    if (existing) return existing;
    const task = this.cancelAfterAdmission(operationId, entry).finally(() => {
      this.cancellationTasks.delete(operationId);
    });
    this.cancellationTasks.set(operationId, task);
    return task;
  }

  async waitForIdle(): Promise<void> {
    for (const runId of this.cleanupFailures.keys()) this.scheduleCleanup(runId);
    while (this.cleanupTasks.size > 0) {
      await Promise.allSettled([...this.cleanupTasks]);
    }
    if (this.cleanupFailures.size > 0) {
      throw new Error(
        `${this.cleanupFailures.size} auxiliary session cleanup operation(s) failed.`,
        { cause: this.cleanupFailures.values().next().value },
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    if ([...this.entries.values()].some(entry => !entry.projection.terminal)) {
      throw new Error('Application lifecycle must terminate auxiliary work before disposal.');
    }
    if (this.cleanupTasks.size > 0
      || this.cleanupFailures.size > 0
      || this.runSessions.size > 0) {
      throw new Error('Auxiliary cleanup must settle before application disposal.');
    }
    this.disposed = true;
    this.unsubscribe();
    this.cancellationTasks.clear();
    for (const entry of this.entries.values()) entry.listeners.clear();
  }

  private observeRun(record: Readonly<ExecutionRunRecord>, revision: number): void {
    const parsedOwner = parseAuxiliaryOperationOwner(record.owner);
    if (!parsedOwner) return;
    const operationId = this.runOwners.get(record.runId as RunId) ?? parsedOwner.operationId;
    const entry = this.entries.get(operationId);
    if (!entry) return;
    const projection = applyAuxiliaryRunRecord(entry.projection, record, revision);
    if (projection !== entry.projection) {
      entry.projection = projection;
      this.publish(entry);
    }
    const runId = record.runId as RunId;
    if (record.terminal) this.scheduleCleanup(runId);
  }

  private observeReconciliation(record: Readonly<ExecutionReconciliationRecord>): void {
    const operationId = this.runOwners.get(record.runId as RunId);
    if (!operationId) return;
    const entry = this.entries.get(operationId);
    if (!entry) return;
    const projection = applyAuxiliaryReconciliation(entry.projection, record);
    if (projection === entry.projection) return;
    entry.projection = projection;
    this.publish(entry);
  }

  private publish(entry: AuxiliaryEntry): void {
    for (const listener of entry.listeners) {
      try {
        listener(entry.projection);
      } catch {
        // An auxiliary UI cannot change application-owned operation lifecycle.
      }
    }
  }

  private async cancelAfterAdmission(operationId: string, entry: AuxiliaryEntry): Promise<void> {
    try {
      await entry.startTask;
    } catch {
      // A failed admission without a retained run has no native work to cancel.
    }
    const current = this.entries.get(operationId);
    if (!current || current.projection.terminal) return;
    await this.lifecycle.cancelRun(current.projection.runId, { code: 'user' });
  }

  private scheduleCleanup(runId: RunId): void {
    const operationId = this.runOwners.get(runId);
    if (!operationId || this.cleanupScheduled.has(runId)) return;
    const entry = this.entries.get(operationId);
    if (!entry?.projection.terminal) return;
    this.cleanupScheduled.add(runId);
    let cleaned = false;
    const task = Promise.resolve().then(async () => {
      if (entry.requestRef) this.requests?.forget(entry.requestRef);
      entry.requestRef = undefined;
      const sessionId = this.runSessions.get(runId);
      const sessionActive = sessionId && this.lifecycle.getSessions().some(session => (
        session.executionSessionId === sessionId
      ));
      if (sessionId && !sessionActive) {
        cleaned = true;
        this.runSessions.delete(runId);
        this.cleanupFailures.delete(runId);
      } else if (sessionId && this.lifecycle.canDisposeSession(sessionId)) {
        await this.lifecycle.disposeSession(sessionId);
        cleaned = true;
        this.runSessions.delete(runId);
        this.cleanupFailures.delete(runId);
      }
    }).catch(error => {
      this.cleanupFailures.set(runId, toError(error));
    }).finally(() => {
      this.cleanupTasks.delete(task);
      if (!cleaned) this.cleanupScheduled.delete(runId);
    });
    this.cleanupTasks.add(task);
  }

  private requireEntry(operationId: string): AuxiliaryEntry {
    const entry = this.entries.get(operationId);
    if (!entry) throw new Error('Auxiliary operation is absent.');
    return entry;
  }

  private requireOpen(): void {
    if (this.disposed) throw new Error('Auxiliary execution coordinator is disposed.');
  }
}

function sameAuxiliaryIdentity(
  identity: NonNullable<AuxiliaryEntry['identity']>,
  command: AuxiliaryOperationCommand,
): boolean {
  return identity.backendId === command.backendId
    && identity.requestRef === command.requestRef
    && identity.resultExpectation === command.resultExpectation
    && identity.createdAt === command.createdAt;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Auxiliary operation cleanup failed.');
}

function validateCommand(command: AuxiliaryOperationCommand): void {
  requireIdentifier(command.operationId, 'Auxiliary operation id');
  requireIdentifier(command.requestRef, 'Auxiliary request ref');
  if (!Number.isFinite(command.createdAt) || command.createdAt < 0) {
    throw new Error('Auxiliary createdAt must be a non-negative timestamp.');
  }
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a constrained identifier.`);
  }
}
