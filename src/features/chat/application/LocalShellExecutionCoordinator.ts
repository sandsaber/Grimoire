import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionOwner,
} from '../../../core/execution/ExecutionContracts';
import type {
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '../../../core/execution/ExecutionControlRecords';
import type {
  ExecutionSessionId,
  RunId,
} from '../../../core/execution/ExecutionIds';
import type {
  ExecutionLifecycleListener,
} from '../../../core/execution/ExecutionLifecycleRegistry';
import type { LocalShellInvocation } from '../../../core/execution/local/LocalShellBackend';
import type { LocalShellProjection } from '../projections/LocalShellProjection';
import type { LocalShellOutputProjectionStore } from './LocalShellOutputProjectionStore';

export interface LocalShellLifecyclePort {
  createSession(command: {
    readonly backendId: ExecutionBackendId;
    readonly executionSessionId: ExecutionSessionId;
    readonly owner: ExecutionOwner;
  }): Promise<ExecutionSessionId>;
  startRun(executionSessionId: ExecutionSessionId, request: {
    readonly runId: RunId;
    readonly owner: ExecutionOwner;
    readonly resultExpectation: 'none';
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
  getSessions(): readonly Readonly<ExecutionSessionRecord>[];
  getReconciliationsForRun(runId: RunId): readonly Readonly<ExecutionReconciliationRecord>[];
  subscribe(listener: ExecutionLifecycleListener): () => void;
}

export interface LocalShellRequestRegistrationPort {
  register(requestRef: string, invocation: LocalShellInvocation): void;
  forget(requestRef: string): void;
}

export interface LocalShellOperationCommand {
  readonly operationId: string;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
  readonly requestRef: string;
  readonly displayLabel: string;
  readonly invocation: LocalShellInvocation;
  readonly createdAt: number;
}

export interface LocalShellExecutionCoordinatorOptions {
  readonly backendId: ExecutionBackendId;
  readonly lifecycle: LocalShellLifecyclePort;
  readonly requests: LocalShellRequestRegistrationPort;
  readonly output: LocalShellOutputProjectionStore;
}

const LOCAL_SHELL_OWNER_PREFIX = 'shell:';

/** Application-owned shell lifecycle. Views only attach to projections or issue commands here. */
export class LocalShellExecutionCoordinator {
  private readonly operationRuns = new Map<string, RunId>();
  private readonly operationIdentities = new Map<string, Pick<LocalShellOperationCommand,
  'executionSessionId' | 'runId' | 'requestRef' | 'displayLabel' | 'createdAt'>>();
  private readonly startTasks = new Map<string, Promise<LocalShellProjection>>();
  private readonly runSessions = new Map<RunId, ExecutionSessionId>();
  private readonly requestRefs = new Map<RunId, string>();
  private readonly cleanupTasks = new Set<Promise<void>>();
  private readonly cleanupScheduled = new Set<RunId>();
  private readonly cleanupFailures = new Map<RunId, Error>();
  private readonly cancellationTasks = new Map<string, Promise<void>>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly options: LocalShellExecutionCoordinatorOptions) {
    this.unsubscribe = options.lifecycle.subscribe(notification => {
      if (notification.kind === 'run-updated') {
        this.observeRun(notification.run, notification.revision);
      } else if (notification.kind === 'reconciliation-appended') {
        this.options.output.applyReconciliation(notification.reconciliation);
      } else if (notification.kind === 'interaction-updated') {
        this.scheduleCleanup(notification.interaction.runId as RunId);
      }
    });
  }

  async recover(): Promise<void> {
    this.requireOpen();
    const activeSessions = new Map(this.options.lifecycle.getSessions().map(session => [
      session.executionSessionId,
      session,
    ]));
    for (const session of activeSessions.values()) {
      if (session.backendId !== this.options.backendId
        || session.owner.kind !== 'internal-service'
        || !session.owner.ownerId.startsWith(LOCAL_SHELL_OWNER_PREFIX)) {
        continue;
      }
      const operationId = session.owner.ownerId.slice(LOCAL_SHELL_OWNER_PREFIX.length);
      if (operationId.length === 0) continue;
      if (session.runIds.length === 0) {
        const sessionId = session.executionSessionId as ExecutionSessionId;
        if (!this.options.lifecycle.canDisposeSession(sessionId)) {
          throw new Error('An empty local shell preparation session is not disposable.');
        }
        await this.options.lifecycle.disposeSession(sessionId);
        activeSessions.delete(session.executionSessionId);
        continue;
      }
      if (session.runIds.length > 1) {
        throw new Error('A local shell session must own exactly one run.');
      }
    }
    for (const snapshot of this.options.lifecycle.getRunSnapshots()) {
      const owner = snapshot.record.owner;
      if (owner.kind !== 'internal-service'
        || !owner.ownerId.startsWith(LOCAL_SHELL_OWNER_PREFIX)) {
        continue;
      }
      const operationId = owner.ownerId.slice(LOCAL_SHELL_OWNER_PREFIX.length);
      if (operationId.length === 0) continue;
      const runId = snapshot.record.runId as RunId;
      const executionSessionId = snapshot.record.executionSessionId as ExecutionSessionId;
      const activeSession = activeSessions.get(executionSessionId);
      if (activeSession && (activeSession.backendId !== this.options.backendId
        || activeSession.owner.ownerId !== owner.ownerId
        || activeSession.runIds.length !== 1
        || activeSession.runIds[0] !== runId)) {
        throw new Error('Local shell run conflicts with its active session ownership.');
      }
      const existingRunId = this.operationRuns.get(operationId);
      if (existingRunId && existingRunId !== runId) {
        throw new Error('Local shell operation identity owns conflicting durable runs.');
      }
      this.operationRuns.set(operationId, runId);
      if (activeSession) this.runSessions.set(runId, executionSessionId);
      if (!this.options.output.get(runId)) {
        this.options.output.open({
          operationId,
          owner,
          executionSessionId,
          runId,
          displayLabel: 'Shell operation',
          outputHistory: 'partial-after-restart',
          createdAt: snapshot.record.createdAt,
        });
      }
      this.options.output.applyRun(snapshot.record, snapshot.revision);
      for (const reconciliation of this.options.lifecycle.getReconciliationsForRun(runId)) {
        this.options.output.applyReconciliation(reconciliation);
      }
      if (snapshot.record.terminal && activeSession) this.scheduleCleanup(runId);
    }
  }

  start(command: LocalShellOperationCommand): Promise<LocalShellProjection> {
    this.requireOpen();
    requireOperation(command);
    const existingRunId = this.operationRuns.get(command.operationId);
    if (existingRunId) {
      const existing = this.requireProjection(existingRunId);
      const identity = this.operationIdentities.get(command.operationId);
      if (existing.runId === command.runId
        && existing.executionSessionId === command.executionSessionId
        && (!identity || sameShellIdentity(identity, command))) {
        return this.startTasks.get(command.operationId) ?? Promise.resolve(existing);
      }
      return Promise.reject(new Error(
        'Local shell operation id conflicts with an existing operation.',
      ));
    }
    const owner: ExecutionOwner = {
      kind: 'internal-service',
      ownerId: localShellOwnerId(command.operationId),
    };
    this.options.requests.register(command.requestRef, command.invocation);
    try {
      this.options.output.open({
        operationId: command.operationId,
        owner,
        executionSessionId: command.executionSessionId,
        runId: command.runId,
        displayLabel: command.displayLabel,
        outputHistory: 'complete',
        createdAt: command.createdAt,
      });
    } catch (error) {
      this.options.requests.forget(command.requestRef);
      throw error;
    }
    this.operationRuns.set(command.operationId, command.runId);
    this.operationIdentities.set(command.operationId, command);
    this.runSessions.set(command.runId, command.executionSessionId);
    this.requestRefs.set(command.runId, command.requestRef);
    const task = this.startOperation(command, owner);
    this.startTasks.set(command.operationId, task);
    return task;
  }

  private async startOperation(
    command: LocalShellOperationCommand,
    owner: ExecutionOwner,
  ): Promise<LocalShellProjection> {
    let sessionCreated = false;
    try {
      await this.options.lifecycle.createSession({
        backendId: this.options.backendId,
        executionSessionId: command.executionSessionId,
        owner,
      });
      sessionCreated = true;
      await this.options.lifecycle.startRun(command.executionSessionId, {
        runId: command.runId,
        owner,
        resultExpectation: 'none',
        requestRef: command.requestRef,
      });
      const snapshot = this.options.lifecycle.getRunSnapshot(command.runId);
      if (snapshot) this.options.output.applyRun(snapshot.record, snapshot.revision);
      this.startTasks.delete(command.operationId);
      return this.requireProjection(command.runId);
    } catch (error) {
      const retained = this.options.lifecycle.getRunSnapshot(command.runId);
      if (retained
        && retained.record.executionSessionId === command.executionSessionId
        && retained.record.owner.kind === owner.kind
        && retained.record.owner.ownerId === owner.ownerId) {
        this.options.output.applyRun(retained.record, retained.revision);
        this.startTasks.delete(command.operationId);
        return this.requireProjection(command.runId);
      }
      this.options.requests.forget(command.requestRef);
      this.requestRefs.delete(command.runId);
      try {
        if (sessionCreated && this.options.lifecycle.canDisposeSession(command.executionSessionId)) {
          await this.options.lifecycle.disposeSession(command.executionSessionId);
        }
      } finally {
        this.operationRuns.delete(command.operationId);
        this.operationIdentities.delete(command.operationId);
        this.startTasks.delete(command.operationId);
        this.runSessions.delete(command.runId);
        this.options.output.remove(command.runId);
      }
      throw error;
    }
  }

  attach(operationId: string, listener: (projection: LocalShellProjection) => void): () => void {
    this.requireOpen();
    const runId = this.operationRuns.get(operationId);
    if (!runId) throw new Error('Local shell operation is absent.');
    return this.options.output.attach(runId, listener);
  }

  get(operationId: string): LocalShellProjection | null {
    const runId = this.operationRuns.get(operationId);
    return runId ? this.options.output.get(runId) : null;
  }

  waitForCompletion(operationId: string): Promise<LocalShellProjection> {
    this.requireOpen();
    const current = this.get(operationId);
    if (!current) return Promise.reject(new Error('Local shell operation is absent.'));
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
    const runId = this.operationRuns.get(operationId);
    if (!runId) throw new Error('Local shell operation is absent.');
    const existing = this.cancellationTasks.get(operationId);
    if (existing) return existing;
    const task = this.cancelAfterAdmission(operationId, runId).finally(() => {
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
        `${this.cleanupFailures.size} local shell session cleanup operation(s) failed.`,
        { cause: this.cleanupFailures.values().next().value },
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    const active = [...this.operationRuns.values()].some(runId => (
      !this.options.output.get(runId)?.terminal
    ));
    if (active) {
      throw new Error('Application lifecycle must terminate local shell work before disposal.');
    }
    if (this.cleanupTasks.size > 0
      || this.cleanupFailures.size > 0
      || this.runSessions.size > 0) {
      throw new Error('Local shell cleanup must settle before application disposal.');
    }
    this.disposed = true;
    this.unsubscribe();
    this.startTasks.clear();
    this.cancellationTasks.clear();
    this.options.output.dispose();
  }

  private observeRun(record: Readonly<ExecutionRunRecord>, revision: number): void {
    const runId = record.runId as RunId;
    if (!this.runSessions.has(runId)) return;
    this.options.output.applyRun(record, revision);
    if (record.terminal) this.scheduleCleanup(runId);
  }

  private async cancelAfterAdmission(operationId: string, runId: RunId): Promise<void> {
    try {
      await this.startTasks.get(operationId);
    } catch {
      // A failed admission without a retained run has no native work to cancel.
    }
    const projection = this.options.output.get(runId);
    if (!projection || projection.terminal) return;
    await this.options.lifecycle.cancelRun(runId, { code: 'user' });
  }

  private scheduleCleanup(runId: RunId): void {
    if (this.cleanupScheduled.has(runId)) return;
    this.cleanupScheduled.add(runId);
    let cleaned = false;
    const task = Promise.resolve().then(async () => {
      const requestRef = this.requestRefs.get(runId);
      if (requestRef) this.options.requests.forget(requestRef);
      this.requestRefs.delete(runId);
      const sessionId = this.runSessions.get(runId);
      const sessionActive = sessionId && this.options.lifecycle.getSessions().some(session => (
        session.executionSessionId === sessionId
      ));
      if (sessionId && !sessionActive) {
        cleaned = true;
        this.runSessions.delete(runId);
        this.cleanupFailures.delete(runId);
      } else if (sessionId && this.options.lifecycle.canDisposeSession(sessionId)) {
        await this.options.lifecycle.disposeSession(sessionId);
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

  private requireProjection(runId: RunId): LocalShellProjection {
    const projection = this.options.output.get(runId);
    if (!projection) throw new Error('Local shell projection is absent.');
    return projection;
  }

  private requireOpen(): void {
    if (this.disposed) throw new Error('Local shell execution coordinator is disposed.');
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Local shell cleanup failed.');
}

function requireOperation(command: LocalShellOperationCommand): void {
  requireIdentifier(command.operationId, 'Local shell operation id');
  requireIdentifier(command.requestRef, 'Local shell request ref');
  if (command.displayLabel.trim().length === 0 || command.displayLabel.length > 256) {
    throw new Error('Local shell display label must be between 1 and 256 characters.');
  }
  if (!Number.isFinite(command.createdAt) || command.createdAt < 0) {
    throw new Error('Local shell createdAt must be a non-negative timestamp.');
  }
}

function localShellOwnerId(operationId: string): string {
  const ownerId = `${LOCAL_SHELL_OWNER_PREFIX}${operationId}`;
  if (ownerId.length > 128) {
    throw new Error('Local shell operation identity exceeds the durable owner limit.');
  }
  return ownerId;
}

function sameShellIdentity(
  identity: Readonly<Pick<LocalShellOperationCommand,
  'executionSessionId' | 'runId' | 'requestRef' | 'displayLabel' | 'createdAt'>>,
  command: LocalShellOperationCommand,
): boolean {
  return identity.executionSessionId === command.executionSessionId
    && identity.runId === command.runId
    && identity.requestRef === command.requestRef
    && identity.displayLabel === command.displayLabel
    && identity.createdAt === command.createdAt;
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a constrained identifier.`);
  }
}
