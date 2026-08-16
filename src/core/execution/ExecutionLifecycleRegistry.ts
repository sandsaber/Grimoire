import type { VersionedRecord } from '../persistence/VersionedRecord';
import { type ExecutionBackendId,executionBackendId } from './ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionBackend,
  ExecutionOwner,
  ExecutionRecoveryPort,
  ExecutionRequest,
  ExecutionRun,
  ExecutionSession,
  InteractionPort,
  InteractionResolution,
  ResultRef,
  RunRecoveryEvidence,
  RunTerminal,
  RunTerminalKind,
  RunTerminalReason,
} from './ExecutionContracts';
import { ExecutionDispatchError } from './ExecutionContracts';
import type {
  ExecutionInteractionRecord,
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
  SettingsTransitionRecord,
  ShutdownCheckpointRecord,
} from './ExecutionControlRecords';
import type { ExecutionControlRepositories } from './ExecutionControlRepositories';
import type {
  ExecutionControlTransactionCoordinator,
  ExecutionControlWrite,
} from './ExecutionControlTransactionCoordinator';
import {
  ExecutionEventIngestor,
  type ExecutionEventIngestorCheckpoint,
  type IngestResult,
} from './ExecutionEventIngestor';
import {
  type ExecutionEvent,
  type ExecutionEventEnvelope,
  type ExecutionGapDiagnostic,
  isTransientExecutionEvent,
  type ProviderExecutionEvent,
} from './ExecutionEvents';
import type {
  ExecutionSessionId,
  InteractionId,
  LifecycleLeaseId,
  RunId,
} from './ExecutionIds';
import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from './ExecutionIds';
import {
  isTerminalReasonAllowed,
  requireTerminalReason,
} from './ExecutionTerminalPolicy';

type RegistryState =
  | 'initializing'
  | 'accepting'
  | 'quiescing'
  | 'closed'
  /**
   * Startup found a control record this build cannot read — a newer
   * `schemaVersion`, or one that failed to decode. Persistence decision D5:
   * such a record opens read-only and surfaces a migration-required state; it
   * is never guessed at, downgraded, or discarded. The registry therefore
   * starts, refuses new work, and leaves the store untouched, which is what
   * makes reverting to an older build after a flip survivable.
   */
  | 'migration-required';
type BackendState = 'stable' | 'draining' | 'disposed';

export interface BackendLifecycleRegistration {
  readonly backend: ExecutionBackend;
  readonly initialGeneration?: number;
  readonly recovery?: ExecutionRecoveryPort;
  readonly interactions?: InteractionPort;
}

export interface ExecutionLifecycleRegistryOptions {
  readonly repositories: ExecutionControlRepositories;
  readonly controlTransactions: ExecutionControlTransactionCoordinator;
  readonly nextTransactionId: () => string;
  readonly now?: () => number;
  readonly maxReorderDistance?: number;
  readonly recoveryTimeoutMs?: number;
  readonly shutdownGracePeriodMs?: number;
  readonly scheduler: ExecutionLifecycleScheduler;
}

export interface ExecutionLifecycleScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CreateExecutionSessionCommand {
  readonly backendId: ExecutionBackendId;
  readonly executionSessionId: ExecutionSessionId;
  readonly owner: ExecutionOwner;
}

export interface BeginSettingsTransitionCommand {
  readonly transitionId: string;
  readonly backendId: ExecutionBackendId;
  readonly settingsFingerprint: string;
}

export interface LifecycleLease {
  readonly leaseId: LifecycleLeaseId;
  readonly executionSessionId: ExecutionSessionId;
  readonly purpose:
    | 'projection'
    | 'active-work'
    | 'interaction'
    | 'persistence'
    | 'recovery'
    | 'settings-transition';
  release(): void;
}

export type RegistryIngestResult =
  | IngestResult
  | { readonly kind: 'unknown-session' }
  | { readonly kind: 'unknown-run' }
  | { readonly kind: 'ignored-post-terminal' }
  | { readonly kind: 'ignored-invalid-scope' };

interface BackendEntry {
  readonly backend: ExecutionBackend;
  readonly recovery?: ExecutionRecoveryPort;
  readonly interactions?: InteractionPort;
  generation: number;
  state: BackendState;
  disposed: boolean;
}

/** Receives every accepted envelope for a session, durable and transient alike. */
export type ExecutionEnvelopeObserver = (envelope: ExecutionEventEnvelope) => void;

interface SessionEntry {
  readonly session: ExecutionSession;
  readonly backend: BackendEntry;
  readonly owner: ExecutionOwner;
  readonly ingestor: ExecutionEventIngestor;
  record: ExecutionSessionRecord;
  revision: number;
  unsubscribe: () => void;
  blockedIngestion?: {
    readonly checkpoint: ExecutionEventIngestorCheckpoint;
    readonly envelope: ExecutionEventEnvelope;
    readonly interactionIds: readonly InteractionId[];
  };
  readonly pendingGapStreams: Map<string, {
    readonly nextCausalSequence: number;
    readonly runIds: Set<RunId>;
  }>;
}

interface RunEntry {
  executionRun?: ExecutionRun;
  cancellationTask?: Promise<void>;
  record: ExecutionRunRecord;
  revision: number;
  streamTask?: Promise<void>;
}

interface InteractionEntry {
  record: ExecutionInteractionRecord;
  revision: number;
}

interface LeaseEntry {
  readonly leaseId: LifecycleLeaseId;
  readonly executionSessionId: ExecutionSessionId;
  readonly purpose: LifecycleLease['purpose'];
  released: boolean;
}

export class ExecutionLifecycleRegistry {
  private readonly repositories: ExecutionControlRepositories;
  private readonly controlTransactions: ExecutionControlTransactionCoordinator;
  private readonly nextTransactionId: () => string;
  private readonly now: () => number;
  private readonly maxReorderDistance: number;
  private readonly recoveryTimeoutMs: number;
  private readonly shutdownGracePeriodMs: number;
  private readonly scheduler: ExecutionLifecycleScheduler;
  private readonly backends = new Map<ExecutionBackendId, BackendEntry>();
  private readonly sessions = new Map<ExecutionSessionId, SessionEntry>();
  private readonly runs = new Map<RunId, RunEntry>();
  private readonly interactions = new Map<InteractionId, InteractionEntry>();
  private readonly leases = new Map<LifecycleLeaseId, LeaseEntry>();
  private readonly sessionQueues = new Map<ExecutionSessionId, Promise<void>>();
  private readonly envelopeObservers = new Map<
  ExecutionSessionId,
  Set<ExecutionEnvelopeObserver>
  >();
  private readonly eventTasks = new Set<Promise<void>>();
  private readonly admissionWaiters = new Set<() => void>();
  private state: RegistryState = 'initializing';
  private migrationRequired: UnreadableControlRecordError | null = null;
  private activeAdmissions = 0;

  constructor(options: ExecutionLifecycleRegistryOptions) {
    this.repositories = options.repositories;
    this.controlTransactions = options.controlTransactions;
    this.nextTransactionId = options.nextTransactionId;
    this.now = options.now ?? Date.now;
    this.maxReorderDistance = options.maxReorderDistance ?? 16;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 10_000;
    this.shutdownGracePeriodMs = options.shutdownGracePeriodMs ?? 2_000;
    if (!Number.isSafeInteger(this.recoveryTimeoutMs) || this.recoveryTimeoutMs < 1) {
      throw new Error('Recovery timeout must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(this.shutdownGracePeriodMs) || this.shutdownGracePeriodMs < 1) {
      throw new Error('Shutdown grace period must be a positive safe integer.');
    }
    this.scheduler = options.scheduler;
  }

  registerBackend(registration: BackendLifecycleRegistration): void {
    if (this.state !== 'initializing') {
      throw new Error('Execution backends must be registered before startup recovery.');
    }
    const backendId = registration.backend.descriptor.backendId;
    if (this.backends.has(backendId)) {
      throw new Error(`Execution backend "${backendId}" is already registered.`);
    }
    const generation = registration.initialGeneration ?? 1;
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new Error('Initial backend generation must be a non-negative safe integer.');
    }
    this.backends.set(backendId, {
      backend: registration.backend,
      recovery: registration.recovery,
      interactions: registration.interactions,
      generation,
      state: 'stable',
      disposed: false,
    });
  }

  async start(): Promise<void> {
    if (this.state !== 'initializing') {
      throw new Error('Execution lifecycle registry can only be started once.');
    }
    try {
      await this.controlTransactions.recoverPending();
      await this.loadPersistedControls();
      await this.recoverPersistedInteractions();
      await this.recoverPersistedRuns();
      await this.completeRecoveredShutdownCheckpoints();
    } catch (error) {
      // Only unreadable records take this path. Anything else is a real defect
      // and must keep propagating rather than being disguised as a migration.
      if (!(error instanceof UnreadableControlRecordError)) {
        throw error;
      }
      this.migrationRequired = error;
      this.state = 'migration-required';
      return;
    }
    this.state = 'accepting';
  }

  /**
   * The record that made startup stop, or `null` when the store is readable.
   * The host presents this instead of the registry failing to construct.
   */
  getMigrationRequirement(): UnreadableControlRecordError | null {
    return this.migrationRequired;
  }

  async createSession(command: CreateExecutionSessionCommand): Promise<ExecutionSessionId> {
    const releaseAdmission = this.beginAdmission();
    try {
      const backend = this.requireBackend(command.backendId);
      if (backend.state !== 'stable') {
        throw new Error(`Execution backend "${command.backendId}" is not accepting sessions.`);
      }
      if (this.sessions.has(command.executionSessionId)) {
        throw new Error(`Execution session "${command.executionSessionId}" already exists.`);
      }
      requireOwner(command.owner);
      const session = await backend.backend.createSession({
        executionSessionId: command.executionSessionId,
        owner: command.owner,
        backendGeneration: backend.generation,
      });
      try {
        if (session.executionSessionId !== command.executionSessionId) {
          throw new Error('Backend returned the wrong logical execution session id.');
        }
        const timestamp = this.now();
        const snapshot = session.getSnapshot();
        const created = await this.repositories.sessions.create(command.executionSessionId, {
          executionSessionId: command.executionSessionId,
          sessionInstanceId: session.sessionInstanceId,
          backendId: command.backendId,
          backendGeneration: backend.generation,
          owner: command.owner,
          status: 'active',
          runIds: [],
          lastSequence: 0,
          acceptedEventIds: [],
          ...(snapshot.nativeSessionRef ? { nativeSessionRef: snapshot.nativeSessionRef } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        const ingestor = new ExecutionEventIngestor({
          backendId: command.backendId,
          backendGeneration: backend.generation,
          executionSessionId: command.executionSessionId,
          sessionInstanceId: session.sessionInstanceId,
          maxReorderDistance: this.maxReorderDistance,
        });
        const entry: SessionEntry = {
          session,
          backend,
          owner: command.owner,
          ingestor,
          record: created.payload,
          revision: created.revision,
          unsubscribe: () => undefined,
          pendingGapStreams: new Map(),
        };
        entry.unsubscribe = session.subscribe(event => {
          this.trackEventTask(this.ingest(event).then(() => undefined));
        });
        this.sessions.set(command.executionSessionId, entry);
        return command.executionSessionId;
      } catch (error) {
        this.sessions.delete(command.executionSessionId);
        await this.settleWithin([session.dispose()]);
        throw error;
      }
    } finally {
      releaseAdmission();
    }
  }

  async startRun(
    executionSessionId: ExecutionSessionId,
    request: ExecutionRequest,
  ): Promise<RunId> {
    const releaseAdmission = this.beginAdmission();
    try {
      return await this.enqueueSession(executionSessionId, async () => {
        const session = this.requireSession(executionSessionId);
        if (session.backend.state !== 'stable') {
          throw new Error(`Execution backend "${session.record.backendId}" is draining.`);
        }
        if (this.runs.has(request.runId) || session.record.runIds.includes(request.runId)) {
          throw new Error(`Execution run "${request.runId}" already exists.`);
        }
        requireOwner(request.owner);
        if (!sameOwner(request.owner, session.owner)) {
          throw new Error('Execution run owner must match its session owner.');
        }
        requireIdentifier(request.requestRef, 'request ref');
        const timestamp = this.now();
        const runRecord: ExecutionRunRecord = {
          runId: request.runId,
          executionSessionId,
          owner: request.owner,
          resultExpectation: request.resultExpectation,
          state: 'queued',
          dispatchState: 'pending',
          cancellationRequested: false,
          openInteractionIds: [],
          lastSequence: session.record.lastSequence,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const nextSessionRecord: ExecutionSessionRecord = {
          ...session.record,
          runIds: [...session.record.runIds, request.runId],
          updatedAt: timestamp,
        };
        await this.commitWrites([
          write('sessions', executionSessionId, session.revision, nextSessionRecord),
          write('runs', request.runId, null, runRecord),
        ]);
        await this.refreshSession(session);
        const createdRun = await requireCurrent(this.repositories.runs.read(request.runId));
        const runEntry: RunEntry = {
          record: createdRun.payload,
          revision: createdRun.revision,
        };
        this.runs.set(request.runId, runEntry);

        let executionRun: ExecutionRun;
        try {
          executionRun = session.session.createRun(request);
        } catch (error) {
          const sideEffectFree = error instanceof ExecutionDispatchError && error.sideEffectFree;
          await this.terminalizeRun(
            runEntry,
            sideEffectFree ? 'invalidated' : 'indeterminate',
            sideEffectFree ? 'pre-dispatch-rejected' : 'dispatch-unknown',
            timestamp,
            sideEffectFree ? 'rejected' : 'unknown',
          );
          return request.runId;
        }
        if (executionRun.runId !== request.runId) {
          this.trackEventTask(
            executionRun.cancel({ code: 'shutdown' }).catch(() => undefined),
          );
          await this.terminalizeRun(
            runEntry,
            'indeterminate',
            'dispatch-unknown',
            timestamp,
            'unknown',
          );
          return request.runId;
        }
        runEntry.executionRun = executionRun;
        runEntry.streamTask = this.consumeRunEvents(session, runEntry, executionRun);
        try {
          await this.updateRunRecord(runEntry, {
            ...runEntry.record,
            state: 'preparing',
            dispatchState: 'accepted',
            updatedAt: this.now(),
          });
        } catch {
          this.trackEventTask(
            executionRun.cancel({ code: 'shutdown' }).catch(() => undefined),
          );
          await this.terminalizeRun(
            runEntry,
            'indeterminate',
            'dispatch-unknown',
            this.now(),
            'unknown',
          );
        }
        return request.runId;
      });
    } finally {
      releaseAdmission();
    }
  }

  ingest(event: ProviderExecutionEvent): Promise<RegistryIngestResult> {
    const session = this.sessions.get(event.executionSessionId);
    if (!session) {
      return Promise.resolve({ kind: 'unknown-session' });
    }
    return this.enqueueSession(event.executionSessionId, async () => {
      const checkpoint = session.ingestor.createCheckpoint();
      const result = session.ingestor.ingest(event);
      if (result.kind === 'gap' || result.kind === 'causal-conflict') {
        await this.applyGap(session, result.diagnostic);
        return result;
      }
      if (result.kind !== 'accepted') {
        return result;
      }
      const accepted: ExecutionEventEnvelope[] = [];
      let currentCheckpoint = checkpoint;
      let envelope: ExecutionEventEnvelope | undefined = result.envelopes[0];
      while (envelope) {
        // Transient content goes straight to observers. It writes no control
        // record, advances no state machine, and runs no post-commit hook —
        // there is nothing about it to commit, and a transaction per token
        // would be the cost of persisting a transcript nobody may keep.
        if (isTransientExecutionEvent(envelope.event)) {
          this.publishEnvelope(session, envelope);
          accepted.push(envelope);
          currentCheckpoint = session.ingestor.createCheckpoint();
          envelope = session.ingestor.drainReady() ?? undefined;
          continue;
        }
        const applied = await this.applyAcceptedEnvelope(
          session,
          envelope,
          currentCheckpoint,
        );
        if (applied.kind !== 'accepted') {
          return applied;
        }
        // Durable envelopes reach observers only after they are committed, so
        // nothing is rendered that a failed commit would have to take back.
        this.publishEnvelope(session, envelope);
        accepted.push(envelope);
        currentCheckpoint = session.ingestor.createCheckpoint();
        envelope = session.ingestor.drainReady() ?? undefined;
      }
      return { kind: 'accepted', envelopes: accepted };
    });
  }

  /**
   * Observes accepted envelopes for one session, in the order they were
   * accepted.
   *
   * This is what makes a presentation adapter a client of the registry rather
   * than of a backend: without it the only way to see a run's events would be
   * to subscribe to the session the registry owns, which would mean two
   * consumers of one stream and two opinions about ordering.
   */
  observe(
    executionSessionId: ExecutionSessionId,
    observer: ExecutionEnvelopeObserver,
  ): () => void {
    const observers = this.envelopeObservers.get(executionSessionId)
      ?? new Set<ExecutionEnvelopeObserver>();
    observers.add(observer);
    this.envelopeObservers.set(executionSessionId, observers);
    return () => {
      const current = this.envelopeObservers.get(executionSessionId);
      if (!current) {
        return;
      }
      current.delete(observer);
      if (current.size === 0) {
        this.envelopeObservers.delete(executionSessionId);
      }
    };
  }

  private publishEnvelope(session: SessionEntry, envelope: ExecutionEventEnvelope): void {
    const observers = this.envelopeObservers.get(
      executionSessionId(session.record.executionSessionId),
    );
    if (!observers) {
      return;
    }
    for (const observer of [...observers]) {
      // One failing observer must not stop the others, and must never fail
      // ingestion: presentation is downstream of the record, not part of it.
      try {
        observer(envelope);
      } catch {
        // Deliberately swallowed; a presentation fault is not a control fault.
      }
    }
  }

  async flushGaps(executionSessionId: ExecutionSessionId): Promise<ExecutionGapDiagnostic[]> {
    return this.enqueueSession(executionSessionId, async () => {
      const session = this.requireSession(executionSessionId);
      const diagnostics = session.ingestor.flushGaps();
      for (const diagnostic of diagnostics) {
        await this.applyGap(session, diagnostic);
      }
      return diagnostics;
    });
  }

  async cancelRun(runId: RunId, reason: CancellationReason = { code: 'user' }): Promise<void> {
    const run = this.requireRun(runId);
    const sessionId = executionSessionId(run.record.executionSessionId);
    let cancellationTask: Promise<void> | undefined;
    await this.enqueueSession(sessionId, async () => {
      const current = this.requireRun(runId);
      if (current.record.terminal) {
        return;
      }
      if (current.record.cancellationRequested) {
        cancellationTask = current.cancellationTask;
        return;
      }
      await this.updateRunRecord(current, {
        ...current.record,
        cancellationRequested: true,
        state: current.record.state === 'queued' ? 'cancelled' : 'cancelling',
        ...(current.record.state === 'queued' ? {
          terminal: {
            kind: 'cancelled' as const,
            reason: 'cancellation-confirmed' as const,
            occurredAt: this.now(),
          },
        } : {}),
        updatedAt: this.now(),
      });
      if (!current.record.terminal && current.executionRun) {
        cancellationTask = Promise.resolve().then(() => current.executionRun?.cancel(reason));
        current.cancellationTask = cancellationTask;
      }
    });
    if (cancellationTask) {
      try {
        await cancellationTask;
      } catch {
        await this.enqueueSession(sessionId, async () => {
          const current = this.requireRun(runId);
          if (current.record.terminal) {
            return;
          }
          await this.updateRunRecord(current, {
            ...current.record,
            state: 'disconnected',
            updatedAt: this.now(),
          });
          this.trackEventTask(this.recoverRun(runId));
        });
      }
    }
  }

  async resolveInteraction(resolution: InteractionResolution): Promise<void> {
    const interaction = this.requireInteraction(resolution.interactionId);
    const run = this.requireRun(runId(interaction.record.runId));
    const sessionId = executionSessionId(run.record.executionSessionId);
    let interactionPort: InteractionPort | undefined;
    let alreadyResolved = false;
    await this.enqueueSession(sessionId, async () => {
      const currentRun = this.requireRun(runId(run.record.runId));
      const currentInteraction = this.requireInteraction(resolution.interactionId);
      if (currentRun.record.terminal) {
        throw new Error('Cannot resolve an interaction after its run is terminal.');
      }
      if (currentInteraction.record.status === 'resolved') {
        if (currentInteraction.record.selectedResponseId !== resolution.responseId) {
          throw new Error('Interaction was already resolved with another response.');
        }
        alreadyResolved = true;
        return;
      }
      if (!currentInteraction.record.responseIds.includes(resolution.responseId)
        || (currentInteraction.record.status !== 'open'
          && currentInteraction.record.status !== 'resolving')) {
        throw new Error('Interaction response is not allowed.');
      }
      if (currentInteraction.record.status === 'resolving'
        && currentInteraction.record.selectedResponseId !== resolution.responseId) {
        throw new Error('Interaction is already resolving another response.');
      }
      const session = this.requireSession(
        executionSessionId(currentRun.record.executionSessionId),
      );
      if (!session.backend.interactions) {
        throw new Error('Execution backend has no interaction resolution port.');
      }
      interactionPort = session.backend.interactions;
      if (currentInteraction.record.status === 'open') {
        const updated = await this.repositories.interactions.update(
          currentInteraction.record.interactionId,
          currentInteraction.revision,
          record => ({
            ...record,
            status: 'resolving',
            selectedResponseId: resolution.responseId,
            updatedAt: resolution.resolvedAt,
          }),
        );
        currentInteraction.record = updated.payload;
        currentInteraction.revision = updated.revision;
      }
    });
    if (alreadyResolved) {
      return;
    }
    if (!interactionPort) {
      throw new Error('Interaction resolution port was not retained.');
    }
    await interactionPort.resolve(resolution);
    await this.enqueueSession(sessionId, async () => {
      const currentRun = this.requireRun(runId(run.record.runId));
      const currentInteraction = this.requireInteraction(resolution.interactionId);
      if (currentRun.record.terminal) {
        throw new Error('Interaction run became terminal while resolving.');
      }
      if (currentInteraction.record.status === 'resolved') {
        return;
      }
      if (currentInteraction.record.status !== 'resolving'
        || currentInteraction.record.selectedResponseId !== resolution.responseId) {
        throw new Error('Interaction resolution is no longer active.');
      }
      await this.commitInteractionResolution(
        currentRun,
        currentInteraction,
        resolution.responseId,
        resolution.resolvedAt,
      );
    });
  }

  async recoverRun(runId: RunId): Promise<void> {
    const run = this.requireRun(runId);
    const sessionId = executionSessionId(run.record.executionSessionId);
    let recoveryRequest: {
      readonly port: ExecutionRecoveryPort;
      readonly query: Parameters<ExecutionRecoveryPort['reconcile']>[0];
    } | undefined;
    await this.enqueueSession(sessionId, async () => {
      const current = this.requireRun(runId);
      if (current.record.terminal) {
        return;
      }
      const session = this.requireSession(
        executionSessionId(current.record.executionSessionId),
      );
      await this.updateRunRecord(current, {
        ...current.record,
        state: 'recovering',
        updatedAt: this.now(),
      });
      if (!session.backend.recovery) {
        await this.terminalizeRun(
          current,
          'indeterminate',
          current.record.cancellationRequested ? 'cancellation-unknown' : 'effects-unknown',
          this.now(),
        );
        return;
      }
      recoveryRequest = {
        port: session.backend.recovery,
        query: {
          backendId: session.backend.backend.descriptor.backendId,
          backendGeneration: session.record.backendGeneration,
          executionSessionId: executionSessionId(session.record.executionSessionId),
          sessionInstanceId: sessionInstanceId(session.record.sessionInstanceId),
          runId,
          ...(session.record.nativeSessionRef
            ? { nativeSessionRef: session.record.nativeSessionRef }
            : {}),
          ...(current.record.nativeRunRef
            ? { nativeRunRef: current.record.nativeRunRef }
            : {}),
          cancellationRequested: current.record.cancellationRequested,
          resultExpectation: current.record.resultExpectation,
        },
      };
    });
    if (!recoveryRequest) {
      return;
    }
    const request = recoveryRequest;
    const evidence = await this.reconcileWithinDeadline(request.port, request.query);
    await this.enqueueSession(sessionId, async () => {
      const current = this.runs.get(runId);
      const session = this.sessions.get(sessionId);
      if (!current || !session || current.record.terminal) {
        return;
      }
      await this.applyRecoveryEvidence(session, current, evidence);
      this.resolveGapStreamsForRun(session, runId);
    });
  }

  async appendReconciliation(record: ExecutionReconciliationRecord): Promise<void> {
    const run = this.requireRun(runId(record.runId));
    const sessionId = executionSessionId(run.record.executionSessionId);
    await this.enqueueSession(sessionId, async () => {
      const current = this.requireRun(runId(record.runId));
      if (current.record.terminal?.kind !== 'indeterminate') {
        throw new Error('Only an indeterminate run can receive reconciliation evidence.');
      }
      await this.commitWrites([
        write('reconciliations', record.reconciliationId, null, record),
      ]);
    });
  }

  async beginSettingsTransition(command: BeginSettingsTransitionCommand): Promise<void> {
    const releaseAdmission = this.beginAdmission();
    try {
      requireOpaqueRecordId(command.transitionId, 'st', 'settings transition id');
      if (!/^[0-9a-f]{64}$/.test(command.settingsFingerprint)) {
        throw new Error('Settings fingerprint must be canonical SHA-256.');
      }
      const backend = this.requireBackend(command.backendId);
      await this.fenceBackendSessions(backend);
      if (backend.state !== 'stable') {
        throw new Error(`Execution backend "${command.backendId}" already has a transition.`);
      }
      backend.state = 'draining';
      const timestamp = this.now();
      try {
        await this.repositories.settingsTransitions.create(command.transitionId, {
          transitionId: command.transitionId,
          backendId: command.backendId,
          fromGeneration: backend.generation,
          toGeneration: backend.generation + 1,
          status: 'draining',
          settingsFingerprint: command.settingsFingerprint,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } catch (error) {
        backend.state = 'stable';
        throw error;
      }
      await this.markTransitionQuiescentIfReady(command.transitionId);
    } finally {
      releaseAdmission();
    }
  }

  async markSettingsTransitionApplying(transitionId: string): Promise<void> {
    const releaseAdmission = this.beginAdmission();
    try {
      requireOpaqueRecordId(transitionId, 'st', 'settings transition id');
      const current = await requireCurrent(this.repositories.settingsTransitions.read(transitionId));
      const backend = this.requireBackend(executionBackendId(current.payload.backendId));
      await this.fenceBackendSessions(backend);
      await this.markTransitionQuiescentIfReady(transitionId);
      const refreshed = await requireCurrent(
        this.repositories.settingsTransitions.read(transitionId),
      );
      if (refreshed.payload.status === 'applying' || refreshed.payload.status === 'completed') {
        return;
      }
      if (refreshed.payload.status !== 'quiescent') {
        throw new Error('Settings transition cannot apply before lifecycle quiescence.');
      }
      await this.repositories.settingsTransitions.update(
        transitionId,
        refreshed.revision,
        record => ({ ...record, status: 'applying', updatedAt: this.now() }),
      );
    } finally {
      releaseAdmission();
    }
  }

  async completeSettingsTransition(transitionId: string): Promise<void> {
    const releaseAdmission = this.beginAdmission();
    try {
      requireOpaqueRecordId(transitionId, 'st', 'settings transition id');
      const current = await requireCurrent(this.repositories.settingsTransitions.read(transitionId));
      const backend = this.requireBackend(executionBackendId(current.payload.backendId));
      await this.fenceBackendSessions(backend);
      const refreshed = await requireCurrent(
        this.repositories.settingsTransitions.read(transitionId),
      );
      if (refreshed.payload.status === 'completed') {
        backend.generation = Math.max(backend.generation, refreshed.payload.toGeneration);
        backend.state = 'stable';
        return;
      }
      if (refreshed.payload.status !== 'applying' || this.hasActiveRunsForBackend(backend)) {
        throw new Error('Settings transition cannot complete before apply and terminal classification.');
      }
      const sessions = [...this.sessions.values()].filter(session => session.backend === backend);
      const disposals = sessions.map(session => this.enqueueSession(
        executionSessionId(session.record.executionSessionId),
        () => this.disposeSessionForShutdown(session),
      ));
      const settled = await this.settleWithin(disposals);
      if (!settled) {
        const latest = await requireCurrent(this.repositories.settingsTransitions.read(transitionId));
        await this.repositories.settingsTransitions.update(
          transitionId,
          latest.revision,
          record => ({ ...record, status: 'restart-required', updatedAt: this.now() }),
        );
        return;
      }
      const latest = await requireCurrent(this.repositories.settingsTransitions.read(transitionId));
      await this.repositories.settingsTransitions.update(
        transitionId,
        latest.revision,
        record => ({ ...record, status: 'completed', updatedAt: this.now() }),
      );
      backend.generation = refreshed.payload.toGeneration;
      backend.state = 'stable';
    } finally {
      releaseAdmission();
    }
  }

  getBackendGeneration(backendId: ExecutionBackendId): number | null {
    return this.backends.get(backendId)?.generation ?? null;
  }

  acquireLease(
    leaseId: LifecycleLeaseId,
    executionSessionId: ExecutionSessionId,
    purpose: LifecycleLease['purpose'],
  ): LifecycleLease {
    const session = this.requireSession(executionSessionId);
    if (session.blockedIngestion) {
      throw new Error(`Execution session "${executionSessionId}" has an unresolved durable event.`);
    }
    if (this.leases.has(leaseId)) {
      throw new Error(`Lifecycle lease "${leaseId}" already exists.`);
    }
    const entry: LeaseEntry = { leaseId, executionSessionId, purpose, released: false };
    this.leases.set(leaseId, entry);
    return {
      leaseId,
      executionSessionId,
      purpose,
      release: () => {
        if (!entry.released) {
          entry.released = true;
          this.leases.delete(leaseId);
        }
      },
    };
  }

  canDisposeSession(executionSessionId: ExecutionSessionId): boolean {
    const session = this.requireSession(executionSessionId);
    if (session.blockedIngestion) {
      return false;
    }
    const hasLease = [...this.leases.values()].some(lease => (
      !lease.released && lease.executionSessionId === executionSessionId
    ));
    const hasLiveRun = session.record.runIds.some(id => {
      const run = this.runs.get(runId(id));
      return run !== undefined && !run.record.terminal;
    });
    const sessionRunIds = new Set(session.record.runIds);
    const hasOpenInteraction = [...this.interactions.values()].some(interaction => (
      sessionRunIds.has(interaction.record.runId)
      && isActiveInteraction(interaction.record.status)
    ));
    return !hasLease && !hasLiveRun && !hasOpenInteraction;
  }

  async disposeSession(executionSessionId: ExecutionSessionId): Promise<void> {
    await this.enqueueSession(executionSessionId, async () => {
      const session = this.requireSession(executionSessionId);
      if (!this.canDisposeSession(executionSessionId)) {
        throw new Error(`Execution session "${executionSessionId}" still has lifecycle owners.`);
      }
      session.unsubscribe();
      await session.session.dispose();
      const updated = await this.repositories.sessions.update(
        executionSessionId,
        session.revision,
        record => ({ ...record, status: 'disposed', updatedAt: this.now() }),
      );
      session.record = updated.payload;
      session.revision = updated.revision;
      this.sessions.delete(executionSessionId);
      // Observers go with the session they were watching. Leaving them would
      // hold a closure per disposed conversation for the life of the process,
      // and a session id is never reused for a different session.
      this.envelopeObservers.delete(executionSessionId);
    });
  }

  async shutdown(checkpointId: string): Promise<void> {
    if (this.state !== 'accepting') {
      throw new Error('Execution lifecycle registry is not accepting shutdown.');
    }
    requireOpaqueRecordId(checkpointId, 'sd', 'shutdown checkpoint id');
    this.state = 'quiescing';
    await this.waitForAdmissions();

    const activeRuns = [...this.runs.values()].filter(run => !run.record.terminal);
    const timestamp = this.now();
    const checkpoint: ShutdownCheckpointRecord = {
      checkpointId,
      status: 'started',
      sessionIds: [...this.sessions.keys()],
      runIds: activeRuns.map(run => run.record.runId),
      unresolvedRunIds: activeRuns.map(run => run.record.runId),
      startedAt: timestamp,
    };
    await this.repositories.shutdownCheckpoints.create(checkpointId, checkpoint);
    await this.settleWithin([...this.eventTasks]);
    for (const run of activeRuns) {
      await this.enqueueSession(executionSessionId(run.record.executionSessionId), async () => {
        if (run.record.terminal) {
          return;
        }
        await this.updateRunRecord(run, {
          ...run.record,
          cancellationRequested: true,
          state: 'cancelling',
          updatedAt: timestamp,
        });
      });
    }

    const cancellations = activeRuns.map(run => (
      run.executionRun?.cancel({ code: 'shutdown' }) ?? Promise.resolve()
    ));
    await this.settleWithin(cancellations);
    await this.settleWithin([...this.eventTasks]);

    const unresolvedRunIds: string[] = [];
    for (const run of activeRuns) {
      if (run.record.terminal) {
        continue;
      }
      await this.enqueueSession(executionSessionId(run.record.executionSessionId), async () => {
        if (!run.record.terminal) {
          unresolvedRunIds.push(run.record.runId);
          await this.terminalizeRun(
            run,
            'indeterminate',
            'shutdown-unknown',
            this.now(),
          );
        }
      });
    }

    const sessionDisposals = [...this.sessions.values()].map(session => (
      this.enqueueSession(
        executionSessionId(session.record.executionSessionId),
        () => this.disposeSessionForShutdown(session),
      )
    ));
    await this.settleWithin(sessionDisposals);
    const backendDisposals = [...this.backends.values()].map(backend => (
      this.disposeBackendOnce(backend)
    ));
    await this.settleWithin(backendDisposals);

    const currentCheckpoint = await requireCurrent(
      this.repositories.shutdownCheckpoints.read(checkpointId),
    );
    await this.repositories.shutdownCheckpoints.update(
      checkpointId,
      currentCheckpoint.revision,
      record => ({
        ...record,
        status: 'completed',
        unresolvedRunIds,
        completedAt: this.now(),
      }),
    );
    this.state = 'closed';
  }

  getRun(runId: RunId): Readonly<ExecutionRunRecord> | null {
    return this.runs.get(runId)?.record ?? null;
  }

  getSession(executionSessionId: ExecutionSessionId): Readonly<ExecutionSessionRecord> | null {
    return this.sessions.get(executionSessionId)?.record ?? null;
  }

  getInteraction(interactionId: InteractionId): Readonly<ExecutionInteractionRecord> | null {
    return this.interactions.get(interactionId)?.record ?? null;
  }

  async waitForRunStream(runId: RunId): Promise<void> {
    await this.runs.get(runId)?.streamTask;
    await this.waitForIdle();
  }

  async waitForIdle(): Promise<void> {
    while (this.eventTasks.size > 0) {
      await Promise.allSettled([...this.eventTasks]);
    }
  }

  private async loadPersistedControls(): Promise<void> {
    await this.loadPersistedSettingsTransitions();
    for (const id of await this.repositories.interactions.listRecordIds()) {
      const current = await requireCurrent(this.repositories.interactions.read(id));
      const typedId = interactionId(current.payload.interactionId);
      this.interactions.set(typedId, {
        record: current.payload,
        revision: current.revision,
      });
    }
    for (const id of await this.repositories.runs.listRecordIds()) {
      const current = await requireCurrent(this.repositories.runs.read(id));
      const typedId = runId(current.payload.runId);
      this.runs.set(typedId, {
        record: current.payload,
        revision: current.revision,
      });
    }
    for (const id of await this.repositories.sessions.listRecordIds()) {
      const current = await requireCurrent(this.repositories.sessions.read(id));
      if (current.payload.status === 'disposed') {
        continue;
      }
      const typedSessionId = executionSessionId(current.payload.executionSessionId);
      const backend = this.backends.get(executionBackendId(current.payload.backendId));
      if (!backend || backend.disposed || backend.generation !== current.payload.backendGeneration) {
        continue;
      }
      let executionSession: ExecutionSession;
      try {
        executionSession = await backend.backend.createSession({
          executionSessionId: typedSessionId,
          owner: current.payload.owner,
          backendGeneration: current.payload.backendGeneration,
          ...(current.payload.nativeSessionRef
            ? { nativeSessionRef: current.payload.nativeSessionRef }
            : {}),
        });
      } catch {
        continue;
      }
      if (executionSession.executionSessionId !== typedSessionId) {
        await executionSession.dispose();
        continue;
      }
      const snapshot = executionSession.getSnapshot();
      const updated = await this.repositories.sessions.update(
        typedSessionId,
        current.revision,
        record => ({
          ...record,
          sessionInstanceId: executionSession.sessionInstanceId,
          status: 'recovering',
          ...(snapshot.nativeSessionRef ? { nativeSessionRef: snapshot.nativeSessionRef } : {}),
          updatedAt: this.now(),
        }),
      );
      const ingestor = new ExecutionEventIngestor({
        backendId: executionBackendId(updated.payload.backendId),
        backendGeneration: updated.payload.backendGeneration,
        executionSessionId: typedSessionId,
        sessionInstanceId: executionSession.sessionInstanceId,
        nextSequence: updated.payload.lastSequence + 1,
        seenDeliveryIds: updated.payload.acceptedEventIds,
        maxReorderDistance: this.maxReorderDistance,
      });
      const entry: SessionEntry = {
        session: executionSession,
        backend,
        owner: updated.payload.owner,
        ingestor,
        record: updated.payload,
        revision: updated.revision,
        unsubscribe: () => undefined,
        pendingGapStreams: new Map(),
      };
      entry.unsubscribe = executionSession.subscribe(event => {
        this.trackEventTask(this.ingest(event).then(() => undefined));
      });
      this.sessions.set(typedSessionId, entry);
    }
  }

  private async loadPersistedSettingsTransitions(): Promise<void> {
    for (const id of await this.repositories.settingsTransitions.listRecordIds()) {
      const current = await requireCurrent(this.repositories.settingsTransitions.read(id));
      const backend = this.backends.get(executionBackendId(current.payload.backendId));
      if (!backend) {
        continue;
      }
      if (current.payload.status === 'completed') {
        backend.generation = Math.max(backend.generation, current.payload.toGeneration);
      } else {
        backend.state = 'draining';
        if (current.payload.status === 'applying') {
          await this.repositories.settingsTransitions.update(
            id,
            current.revision,
            record => ({ ...record, status: 'restart-required', updatedAt: this.now() }),
          );
        }
      }
    }
  }

  private async recoverPersistedRuns(): Promise<void> {
    for (const run of this.runs.values()) {
      if (run.record.terminal) {
        continue;
      }
      const sessionId = executionSessionId(run.record.executionSessionId);
      const session = this.sessions.get(sessionId);
      if (session) {
        await this.recoverRun(runId(run.record.runId));
        continue;
      }
      await this.terminalizeRun(
        run,
        'indeterminate',
        run.record.cancellationRequested ? 'cancellation-unknown' : 'effects-unknown',
        this.now(),
      );
    }
    for (const session of this.sessions.values()) {
      if (session.record.status !== 'recovering') {
        continue;
      }
      const updated = await this.repositories.sessions.update(
        session.record.executionSessionId,
        session.revision,
        record => ({ ...record, status: 'active', updatedAt: this.now() }),
      );
      session.record = updated.payload;
      session.revision = updated.revision;
    }
  }

  private async recoverPersistedInteractions(): Promise<void> {
    for (const [id, interaction] of this.interactions) {
      if (interaction.record.status === 'resolving'
        && interaction.record.selectedResponseId) {
        await this.resolveInteraction({
          interactionId: id,
          responseId: interaction.record.selectedResponseId,
          resolvedAt: interaction.record.updatedAt,
        }).catch(() => undefined);
      } else if (interaction.record.status === 'cancelling') {
        await this.cancelInteraction(id);
      }
    }
  }

  private async completeRecoveredShutdownCheckpoints(): Promise<void> {
    for (const id of await this.repositories.shutdownCheckpoints.listRecordIds()) {
      const current = await requireCurrent(this.repositories.shutdownCheckpoints.read(id));
      if (current.payload.status === 'completed') {
        continue;
      }
      const unresolvedRunIds = current.payload.runIds.filter(id => (
        !this.runs.get(runId(id))?.record.terminal
      ));
      await this.repositories.shutdownCheckpoints.update(
        id,
        current.revision,
        record => ({
          ...record,
          status: 'completed',
          unresolvedRunIds,
          completedAt: this.now(),
        }),
      );
    }
  }

  private async consumeRunEvents(
    session: SessionEntry,
    run: RunEntry,
    executionRun: ExecutionRun,
  ): Promise<void> {
    try {
      for await (const event of executionRun.events) {
        await this.ingest(event);
      }
    } catch {
      // Iterator failures are transport evidence, not a terminal outcome.
    } finally {
      await this.handleRunStreamEnd(session, run);
    }
  }

  private async handleRunStreamEnd(session: SessionEntry, run: RunEntry): Promise<void> {
    await this.enqueueSession(
      executionSessionId(session.record.executionSessionId),
      async () => {
        if (run.record.terminal) {
          return;
        }
        await this.updateRunRecord(run, {
          ...run.record,
          state: 'disconnected',
          updatedAt: this.now(),
        });
      },
    );
    if (!run.record.terminal) {
      await this.recoverRun(runId(run.record.runId));
    }
  }

  private async applyEnvelope(
    session: SessionEntry,
    envelope: ExecutionEventEnvelope,
  ): Promise<RegistryIngestResult> {
    if (envelope.scope.kind === 'session') {
      return this.applySessionEnvelope(session, envelope);
    }
    const run = this.runs.get(envelope.scope.runId);
    if (!run) {
      return { kind: 'unknown-run' };
    }
    if (run.record.terminal) {
      return { kind: 'ignored-post-terminal' };
    }
    const nativeRunRef = envelope.scope.kind === 'run'
      ? envelope.scope.nativeRunRef
      : undefined;
    if (nativeRunRef
      && run.record.nativeRunRef
      && nativeRunRef !== run.record.nativeRunRef) {
      return { kind: 'ignored-invalid-scope' };
    }
    const reduced = reduceRun(run.record, envelope.event, envelope.occurredAt);
    if (!reduced) {
      return { kind: 'ignored-invalid-scope' };
    }
    const currentSnapshot = session.session.getSnapshot();
    const desiredSession: ExecutionSessionRecord = {
      ...session.record,
      ...(currentSnapshot.nativeSessionRef
        ? { nativeSessionRef: currentSnapshot.nativeSessionRef }
        : {}),
      status: sessionStatusForEvent(session.record.status, envelope.event),
      lastSequence: envelope.sequence,
      acceptedEventIds: [...session.ingestor.getRecentDeliveryIds()],
      updatedAt: this.now(),
    };
    const desiredRun: ExecutionRunRecord = {
      ...reduced,
      ...(nativeRunRef ? { nativeRunRef } : {}),
      lastSequence: envelope.sequence,
      updatedAt: this.now(),
    };
    const writes: ExecutionControlWrite[] = [
      write('sessions', session.record.executionSessionId, session.revision, desiredSession),
      write('runs', run.record.runId, run.revision, desiredRun),
    ];
    const interactionChanges = this.collectInteractionChanges(run, desiredRun, envelope.event);
    writes.push(...interactionChanges.writes);
    await this.commitWrites(writes);
    await this.refreshSession(session);
    await this.refreshRun(run);
    await this.refreshInteractions(interactionChanges.ids);
    return { kind: 'accepted', envelopes: [envelope] };
  }

  private async applyAcceptedEnvelope(
    session: SessionEntry,
    envelope: ExecutionEventEnvelope,
    checkpoint: ExecutionEventIngestorCheckpoint,
  ): Promise<RegistryIngestResult> {
    const interactionIds = this.interactionIdsForEnvelope(envelope);
    let result: RegistryIngestResult;
    try {
      result = await this.applyEnvelope(session, envelope);
    } catch (error) {
      try {
        await this.controlTransactions.recoverPending();
      } catch {
        session.blockedIngestion = { checkpoint, envelope, interactionIds };
        this.scheduleBlockedIngestionRecovery(session);
        throw error;
      }
      const committed = await this.isEnvelopeDurable(session, envelope, interactionIds);
      if (!committed) {
        session.ingestor.restoreCheckpoint(checkpoint);
        throw error;
      }
      await this.refreshSessionAggregate(session, interactionIds);
      result = { kind: 'accepted', envelopes: [envelope] };
    }
    if (result.kind !== 'accepted') {
      session.ingestor.restoreCheckpoint(checkpoint);
      return result;
    }
    try {
      await this.runEnvelopePostCommitHooks(session, envelope, interactionIds);
    } catch (error) {
      session.blockedIngestion = { checkpoint, envelope, interactionIds };
      this.scheduleBlockedIngestionRecovery(session);
      throw error;
    }
    return result;
  }

  private async recoverBlockedIngestion(session: SessionEntry): Promise<void> {
    const blocked = session.blockedIngestion;
    if (!blocked) {
      return;
    }
    await this.controlTransactions.recoverPending();
    const committed = await this.isEnvelopeDurable(
      session,
      blocked.envelope,
      blocked.interactionIds,
    );
    if (committed) {
      await this.refreshSessionAggregate(session, blocked.interactionIds);
    } else {
      session.ingestor.restoreCheckpoint(blocked.checkpoint);
    }
    session.blockedIngestion = undefined;
    if (committed) {
      // Published here too, and for the same reason as on the normal path: an
      // envelope that reaches a record must reach the observers watching that
      // run. Without this, an envelope blocked by a storage fault and later
      // recovered would update every record and be invisible to the
      // presentation adapter — and if the blocked envelope were the terminal,
      // the turn's generator would stay open forever.
      this.publishEnvelope(session, blocked.envelope);
      try {
        await this.runEnvelopePostCommitHooks(
          session,
          blocked.envelope,
          blocked.interactionIds,
        );
      } catch (error) {
        session.blockedIngestion = blocked;
        throw error;
      }
    }
  }

  private scheduleBlockedIngestionRecovery(session: SessionEntry): void {
    this.trackEventTask(this.enqueueSession(
      executionSessionId(session.record.executionSessionId),
      async () => undefined,
    ));
  }

  private async runEnvelopePostCommitHooks(
    session: SessionEntry,
    envelope: ExecutionEventEnvelope,
    interactionIds: readonly InteractionId[],
  ): Promise<void> {
    if (envelope.scope.kind === 'run' || envelope.scope.kind === 'agent') {
      const run = this.runs.get(envelope.scope.runId);
      if (!run) {
        return;
      }
      if (run.record.terminal) {
        this.scheduleInteractionCancellations(interactionIds);
        await this.markBackendTransitionsQuiescent(session.backend);
      } else if (envelope.event.kind === 'connection-lost') {
        this.trackEventTask(this.recoverRun(runId(run.record.runId)));
      }
      return;
    }
    if (envelope.event.kind === 'connection-lost') {
      for (const runIdValue of session.record.runIds) {
        const run = this.runs.get(runId(runIdValue));
        if (run && !run.record.terminal) {
          this.trackEventTask(this.recoverRun(runId(run.record.runId)));
        }
      }
    }
  }

  private interactionIdsForEnvelope(envelope: ExecutionEventEnvelope): InteractionId[] {
    if (envelope.event.kind === 'interaction-opened') {
      return [envelope.event.interaction.interactionId];
    }
    if (envelope.event.kind === 'interaction-resolved') {
      return [interactionIdFromRecord(envelope.event.interactionId)];
    }
    if (envelope.event.kind !== 'terminal'
      || (envelope.scope.kind !== 'run' && envelope.scope.kind !== 'agent')) {
      return [];
    }
    const run = this.runs.get(envelope.scope.runId);
    return run?.record.openInteractionIds.map(interactionIdFromRecord) ?? [];
  }

  private async isEnvelopeDurable(
    session: SessionEntry,
    envelope: ExecutionEventEnvelope,
    interactionIds: readonly InteractionId[],
  ): Promise<boolean> {
    const persistedSession = await this.repositories.sessions.read(
      session.record.executionSessionId,
    );
    if ((persistedSession.kind !== 'current' && persistedSession.kind !== 'migrated')
      || persistedSession.record.payload.lastSequence < envelope.sequence
      || !persistedSession.record.payload.acceptedEventIds.includes(envelope.eventId)) {
      return false;
    }
    if (envelope.scope.kind === 'run' || envelope.scope.kind === 'agent') {
      const persistedRun = await this.repositories.runs.read(envelope.scope.runId);
      if ((persistedRun.kind !== 'current' && persistedRun.kind !== 'migrated')
        || persistedRun.record.payload.lastSequence < envelope.sequence) {
        return false;
      }
    }
    for (const id of interactionIds) {
      const interaction = await this.repositories.interactions.read(id);
      if (interaction.kind !== 'current' && interaction.kind !== 'migrated') {
        return false;
      }
    }
    return true;
  }

  private async refreshSessionAggregate(
    session: SessionEntry,
    additionalInteractionIds: readonly InteractionId[],
  ): Promise<void> {
    await this.refreshSession(session);
    for (const runIdValue of session.record.runIds) {
      const run = this.runs.get(runId(runIdValue));
      if (run) {
        await this.refreshRun(run);
      }
    }
    const interactionIds = new Set<InteractionId>(additionalInteractionIds);
    for (const [id, interaction] of this.interactions) {
      if (session.record.runIds.includes(interaction.record.runId)) {
        interactionIds.add(id);
      }
    }
    await this.refreshInteractions([...interactionIds]);
  }

  private async applySessionEnvelope(
    session: SessionEntry,
    envelope: ExecutionEventEnvelope,
  ): Promise<RegistryIngestResult> {
    if (!isSessionScopedEvent(envelope.event)) {
      return { kind: 'ignored-invalid-scope' };
    }
    const activeRuns = session.record.runIds
      .map(id => this.runs.get(runId(id)))
      .filter((run): run is RunEntry => run !== undefined && !run.record.terminal);
    const currentSnapshot = session.session.getSnapshot();
    const desiredSession: ExecutionSessionRecord = {
      ...session.record,
      ...(currentSnapshot.nativeSessionRef
        ? { nativeSessionRef: currentSnapshot.nativeSessionRef }
        : {}),
      status: sessionStatusForEvent(session.record.status, envelope.event),
      lastSequence: envelope.sequence,
      acceptedEventIds: [...session.ingestor.getRecentDeliveryIds()],
      updatedAt: this.now(),
    };
    const writes: ExecutionControlWrite[] = [
      write('sessions', session.record.executionSessionId, session.revision, desiredSession),
    ];
    for (const run of activeRuns) {
      const reduced = reduceRun(run.record, envelope.event, envelope.occurredAt);
      if (reduced) {
        writes.push(write('runs', run.record.runId, run.revision, {
          ...reduced,
          lastSequence: envelope.sequence,
          updatedAt: this.now(),
        }));
      }
    }
    await this.commitWrites(writes);
    await this.refreshSession(session);
    for (const run of activeRuns) {
      await this.refreshRun(run);
    }
    return { kind: 'accepted', envelopes: [envelope] };
  }

  private collectInteractionChanges(
    previousRun: RunEntry,
    desiredRun: ExecutionRunRecord,
    event: ExecutionEvent,
  ): { writes: ExecutionControlWrite[]; ids: InteractionId[] } {
    const writes: ExecutionControlWrite[] = [];
    const ids: InteractionId[] = [];
    if (event.kind === 'interaction-opened') {
      const interaction = event.interaction;
      const timestamp = this.now();
      const record: ExecutionInteractionRecord = {
        interactionId: interaction.interactionId,
        runId: previousRun.record.runId,
        kind: interaction.kind,
        presentationRef: interaction.presentationRef,
        responseIds: [...interaction.responseIds],
        status: 'open',
        ...(interaction.expiresAt !== undefined ? { expiresAt: interaction.expiresAt } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      writes.push(write('interactions', interaction.interactionId, null, record));
      ids.push(interaction.interactionId);
    }
    if (event.kind === 'interaction-resolved') {
      const id = interactionIdFromRecord(event.interactionId);
      const current = this.requireInteraction(id);
      writes.push(write('interactions', id, current.revision, {
        ...current.record,
        status: 'resolved',
        selectedResponseId: event.responseId,
        updatedAt: this.now(),
      }));
      ids.push(id);
    }
    if (desiredRun.terminal) {
      for (const interactionId of previousRun.record.openInteractionIds) {
        const id = interactionIdFromRecord(interactionId);
        const current = this.interactions.get(id);
        if (current && isActiveInteraction(current.record.status)) {
          writes.push(write('interactions', interactionId, current.revision, {
            ...current.record,
            status: 'cancelling',
            updatedAt: this.now(),
          }));
          ids.push(id);
        }
      }
    }
    return { writes, ids };
  }

  private async applyGap(
    session: SessionEntry,
    diagnostic: ExecutionGapDiagnostic,
  ): Promise<void> {
    const affectedRuns = diagnostic.affectedRunIds
      .map(id => this.runs.get(id))
      .filter((run): run is RunEntry => run !== undefined && !run.record.terminal);
    if (affectedRuns.length > 0) {
      session.pendingGapStreams.set(diagnostic.streamId, {
        nextCausalSequence: diagnostic.expectedCausalSequence,
        runIds: new Set(affectedRuns.map(run => runId(run.record.runId))),
      });
    }
    if (affectedRuns.length === 0) {
      return;
    }
    const writes: ExecutionControlWrite[] = [
      write('sessions', session.record.executionSessionId, session.revision, {
        ...session.record,
        status: 'recovering',
        updatedAt: this.now(),
      }),
      ...affectedRuns.map(run => write('runs', run.record.runId, run.revision, {
        ...run.record,
        state: 'recovering',
        updatedAt: this.now(),
      })),
    ];
    await this.commitWrites(writes);
    await this.refreshSession(session);
    for (const run of affectedRuns) {
      await this.refreshRun(run);
      this.trackEventTask(this.recoverRun(runId(run.record.runId)));
    }
  }

  private resolveGapStreamsForRun(session: SessionEntry, recoveredRunId: RunId): void {
    for (const [streamId, gap] of session.pendingGapStreams) {
      gap.runIds.delete(recoveredRunId);
      if (gap.runIds.size > 0) {
        continue;
      }
      session.ingestor.rebaseCausalStream(streamId, gap.nextCausalSequence);
      session.pendingGapStreams.delete(streamId);
    }
  }

  private async applyRecoveryEvidence(
    session: SessionEntry,
    run: RunEntry,
    evidence: RunRecoveryEvidence,
  ): Promise<void> {
    switch (evidence.kind) {
      case 'running':
        session.ingestor.rotateSessionInstance(evidence.sessionInstanceId);
        session.pendingGapStreams.clear();
        await this.updateSessionAndRun(session, run, {
          ...session.record,
          sessionInstanceId: evidence.sessionInstanceId,
          status: 'active',
          updatedAt: this.now(),
        }, {
          ...run.record,
          state: run.record.cancellationRequested ? 'cancelling' : 'running',
          updatedAt: this.now(),
        });
        return;
      case 'waiting-interaction':
        await this.updateRunRecord(run, {
          ...run.record,
          state: run.record.cancellationRequested ? 'cancelling' : 'waiting-interaction',
          updatedAt: this.now(),
        });
        return;
      case 'stopped-safe':
        await this.terminalizeRun(
          run,
          'interrupted',
          'recovery-exhausted-safe',
          this.now(),
        );
        return;
      case 'terminal':
        await this.terminalizeFromEvidence(run, evidence.terminal);
        return;
      case 'unknown': {
        const reason = run.record.cancellationRequested
          ? 'cancellation-unknown'
          : evidence.effectsPossible
            ? 'effects-unknown'
            : 'recovery-exhausted-safe';
        await this.terminalizeRun(
          run,
          run.record.cancellationRequested || evidence.effectsPossible
            ? 'indeterminate'
            : 'interrupted',
          reason,
          this.now(),
        );
        return;
      }
    }
  }

  private async terminalizeFromEvidence(
    run: RunEntry,
    terminal: RunTerminal,
  ): Promise<void> {
    if (terminal.kind === 'succeeded'
      && run.record.resultExpectation === 'required'
      && !run.record.resultRef
      && !terminal.resultRef) {
      await this.terminalizeRun(
        run,
        'failed',
        'missing-required-result',
        terminal.occurredAt,
      );
      return;
    }
    await this.terminalizeRun(
      run,
      terminal.kind,
      terminal.reason,
      terminal.occurredAt,
      undefined,
      terminal.resultRef,
    );
  }

  private async terminalizeRun(
    run: RunEntry,
    kind: RunTerminalKind,
    reason: RunTerminalReason,
    occurredAt: number,
    dispatchState: ExecutionRunRecord['dispatchState'] = run.record.dispatchState,
    resultRef: ResultRef | undefined = run.record.resultRef,
  ): Promise<void> {
    if (run.record.terminal) {
      return;
    }
    requireTerminalReason(kind, reason);
    const timestamp = this.now();
    const interactionIds: InteractionId[] = [];
    const writes: ExecutionControlWrite[] = [write('runs', run.record.runId, run.revision, {
      ...run.record,
      state: kind,
      dispatchState,
      ...(resultRef ? { resultRef } : {}),
      terminal: {
        kind,
        reason,
        occurredAt,
        ...(resultRef ? { resultRef } : {}),
      },
      openInteractionIds: [],
      updatedAt: timestamp,
    })];
    for (const interactionIdValue of run.record.openInteractionIds) {
      const id = interactionIdFromRecord(interactionIdValue);
      const interaction = this.interactions.get(id);
      if (!interaction || !isActiveInteraction(interaction.record.status)) {
        continue;
      }
      interactionIds.push(id);
      writes.push(write('interactions', id, interaction.revision, {
        ...interaction.record,
        status: 'cancelling',
        updatedAt: timestamp,
      }));
    }
    await this.commitWrites(writes);
    await this.refreshRun(run);
    await this.refreshInteractions(interactionIds);
    this.scheduleInteractionCancellations(interactionIds);
    const session = this.sessions.get(executionSessionId(run.record.executionSessionId));
    if (session) {
      // A terminal reached from this side - pre-dispatch rejection, recovery,
      // shutdown - never passed through the ingestor, so nothing published it.
      // Observers close a turn on the terminal and on nothing else, so without
      // this the control store holds a settled run while the reader waits for
      // it forever. Synthesized rather than ingested, and marked as such.
      this.publishEnvelope(session, {
        schemaVersion: 1,
        backendId: session.backend.backend.descriptor.backendId,
        backendGeneration: session.record.backendGeneration,
        executionSessionId: executionSessionId(session.record.executionSessionId),
        sessionInstanceId: sessionInstanceId(session.record.sessionInstanceId),
        eventId: `terminalized:${run.record.runId}`,
        sequence: run.record.lastSequence,
        occurredAt,
        scope: { kind: 'run', runId: runId(run.record.runId) },
        event: { kind: 'terminal', terminal: kind, reason },
      });
      await this.markBackendTransitionsQuiescent(session.backend);
    }
  }

  private async commitInteractionResolution(
    run: RunEntry,
    interaction: InteractionEntry,
    responseId: string,
    resolvedAt: number,
  ): Promise<void> {
    await this.commitWrites([
      write('runs', run.record.runId, run.revision, {
        ...run.record,
        state: run.record.cancellationRequested ? 'cancelling' : 'running',
        openInteractionIds: run.record.openInteractionIds.filter(id => (
          id !== interaction.record.interactionId
        )),
        updatedAt: resolvedAt,
      }),
      write('interactions', interaction.record.interactionId, interaction.revision, {
        ...interaction.record,
        status: 'resolved',
        selectedResponseId: responseId,
        updatedAt: resolvedAt,
      }),
    ]);
    await this.refreshRun(run);
    await this.refreshInteraction(interaction);
  }

  private scheduleInteractionCancellations(interactionIds: readonly InteractionId[]): void {
    for (const id of interactionIds) {
      this.trackEventTask(this.cancelInteraction(id));
    }
  }

  private async cancelInteraction(id: InteractionId): Promise<void> {
    const interaction = this.interactions.get(id);
    if (!interaction || interaction.record.status !== 'cancelling') {
      return;
    }
    const run = this.runs.get(runId(interaction.record.runId));
    if (!run) {
      return;
    }
    const sessionId = executionSessionId(run.record.executionSessionId);
    const session = this.sessions.get(sessionId);
    const interactionPort = session?.backend.interactions;
    if (!interactionPort) {
      return;
    }
    try {
      await interactionPort.cancel(id);
    } catch {
      return;
    }
    await this.enqueueSession(sessionId, async () => {
      const current = this.interactions.get(id);
      if (!current || current.record.status !== 'cancelling') {
        return;
      }
      const updated = await this.repositories.interactions.update(
        current.record.interactionId,
        current.revision,
        record => ({ ...record, status: 'cancelled', updatedAt: this.now() }),
      );
      current.record = updated.payload;
      current.revision = updated.revision;
    });
  }

  private async updateSessionAndRun(
    session: SessionEntry,
    run: RunEntry,
    sessionRecord: ExecutionSessionRecord,
    runRecord: ExecutionRunRecord,
  ): Promise<void> {
    await this.commitWrites([
      write('sessions', session.record.executionSessionId, session.revision, sessionRecord),
      write('runs', run.record.runId, run.revision, runRecord),
    ]);
    await this.refreshSession(session);
    await this.refreshRun(run);
  }

  private async updateRunRecord(
    run: RunEntry,
    record: ExecutionRunRecord,
  ): Promise<void> {
    const updated = await this.repositories.runs.update(
      run.record.runId,
      run.revision,
      () => record,
    );
    run.record = updated.payload;
    run.revision = updated.revision;
  }

  private async commitWrites(writes: readonly ExecutionControlWrite[]): Promise<void> {
    await this.controlTransactions.execute(this.nextTransactionId(), writes);
  }

  private async refreshSession(session: SessionEntry): Promise<void> {
    const current = await requireCurrent(
      this.repositories.sessions.read(session.record.executionSessionId),
    );
    session.record = current.payload;
    session.revision = current.revision;
  }

  private async refreshRun(run: RunEntry): Promise<void> {
    const current = await requireCurrent(this.repositories.runs.read(run.record.runId));
    run.record = current.payload;
    run.revision = current.revision;
  }

  private async refreshInteraction(interaction: InteractionEntry): Promise<void> {
    const current = await requireCurrent(
      this.repositories.interactions.read(interaction.record.interactionId),
    );
    interaction.record = current.payload;
    interaction.revision = current.revision;
  }

  private async refreshInteractions(interactionIds: readonly InteractionId[]): Promise<void> {
    for (const interactionId of interactionIds) {
      const current = await requireCurrent(this.repositories.interactions.read(interactionId));
      const existing = this.interactions.get(interactionId);
      if (existing) {
        existing.record = current.payload;
        existing.revision = current.revision;
      } else {
        this.interactions.set(interactionId, {
          record: current.payload,
          revision: current.revision,
        });
      }
    }
  }

  private requireBackend(backendId: ExecutionBackendId): BackendEntry {
    const backend = this.backends.get(backendId);
    if (!backend || backend.disposed) {
      throw new Error(`Unknown execution backend "${backendId}".`);
    }
    return backend;
  }

  private requireSession(executionSessionId: ExecutionSessionId): SessionEntry {
    const session = this.sessions.get(executionSessionId);
    if (!session) {
      throw new Error(`Unknown execution session "${executionSessionId}".`);
    }
    return session;
  }

  private requireRun(runId: RunId): RunEntry {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown execution run "${runId}".`);
    }
    return run;
  }

  private requireInteraction(interactionId: InteractionId): InteractionEntry {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) {
      throw new Error(`Unknown execution interaction "${interactionId}".`);
    }
    return interaction;
  }

  private requireAccepting(): void {
    if (this.state === 'migration-required') {
      throw new Error(
        'Execution control store requires migration; the registry is read-only.',
      );
    }
    if (this.state !== 'accepting') {
      throw new Error('Execution lifecycle registry is not accepting new work.');
    }
  }

  private beginAdmission(): () => void {
    this.requireAccepting();
    this.activeAdmissions += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeAdmissions -= 1;
      if (this.activeAdmissions === 0) {
        for (const resolve of this.admissionWaiters) {
          resolve();
        }
        this.admissionWaiters.clear();
      }
    };
  }

  private waitForAdmissions(): Promise<void> {
    if (this.activeAdmissions === 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => this.admissionWaiters.add(resolve));
  }

  private async settleWithin(
    tasks: readonly Promise<unknown>[],
    timeoutMs = this.shutdownGracePeriodMs,
  ): Promise<boolean> {
    if (tasks.length === 0) {
      return true;
    }
    let timeoutHandle: unknown;
    const settled = Promise.allSettled(tasks).then(results => (
      results.every(result => result.status === 'fulfilled')
    ));
    const timeout = new Promise<false>(resolve => {
      timeoutHandle = this.scheduler.setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([settled, timeout]);
    if (result && timeoutHandle !== undefined) {
      this.scheduler.clearTimeout(timeoutHandle);
    }
    return result;
  }

  private async reconcileWithinDeadline(
    port: ExecutionRecoveryPort,
    query: Parameters<ExecutionRecoveryPort['reconcile']>[0],
  ): Promise<RunRecoveryEvidence> {
    let evidence: RunRecoveryEvidence | undefined;
    const task = Promise.resolve()
      .then(() => port.reconcile(query))
      .then(value => { evidence = value; });
    const settled = await this.settleWithin([task], this.recoveryTimeoutMs);
    return settled && evidence
      ? evidence
      : { kind: 'unknown', effectsPossible: true };
  }

  private hasActiveRunsForBackend(backend: BackendEntry): boolean {
    return [...this.sessions.values()]
      .filter(session => session.backend === backend)
      .some(session => session.record.runIds.some(id => (
        !this.runs.get(runId(id))?.record.terminal
      )));
  }

  private async markBackendTransitionsQuiescent(backend: BackendEntry): Promise<void> {
    if (backend.state !== 'draining' || this.hasActiveRunsForBackend(backend)) {
      return;
    }
    for (const id of await this.repositories.settingsTransitions.listRecordIds()) {
      const current = await requireCurrent(this.repositories.settingsTransitions.read(id));
      if (current.payload.backendId === backend.backend.descriptor.backendId
        && current.payload.status === 'draining') {
        await this.repositories.settingsTransitions.update(
          id,
          current.revision,
          record => ({ ...record, status: 'quiescent', updatedAt: this.now() }),
        );
      }
    }
  }

  private async fenceBackendSessions(backend: BackendEntry): Promise<void> {
    await Promise.all([...this.sessions.values()]
      .filter(session => session.backend === backend)
      .map(session => this.enqueueSession(
        executionSessionId(session.record.executionSessionId),
        async () => undefined,
      )));
  }

  private async markTransitionQuiescentIfReady(transitionId: string): Promise<void> {
    const current = await requireCurrent(this.repositories.settingsTransitions.read(transitionId));
    if (current.payload.status !== 'draining') {
      return;
    }
    const backend = this.requireBackend(executionBackendId(current.payload.backendId));
    if (this.hasActiveRunsForBackend(backend)) {
      return;
    }
    await this.repositories.settingsTransitions.update(
      transitionId,
      current.revision,
      record => ({ ...record, status: 'quiescent', updatedAt: this.now() }),
    );
  }

  private async disposeSessionForShutdown(session: SessionEntry): Promise<void> {
    session.unsubscribe();
    const updated = await this.repositories.sessions.update(
      session.record.executionSessionId,
      session.revision,
      record => ({ ...record, status: 'disposed', updatedAt: this.now() }),
    );
    session.record = updated.payload;
    session.revision = updated.revision;
    this.sessions.delete(executionSessionId(session.record.executionSessionId));
    this.envelopeObservers.delete(executionSessionId(session.record.executionSessionId));
    for (const [leaseId, lease] of this.leases) {
      if (lease.executionSessionId === session.record.executionSessionId) {
        lease.released = true;
        this.leases.delete(leaseId);
      }
    }
    await session.session.dispose();
  }

  private async disposeBackendOnce(backend: BackendEntry): Promise<void> {
    if (backend.disposed) {
      return;
    }
    backend.disposed = true;
    backend.state = 'disposed';
    await backend.backend.dispose();
  }

  private enqueueSession<TResult>(
    executionSessionId: ExecutionSessionId,
    task: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.sessionQueues.get(executionSessionId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const session = this.sessions.get(executionSessionId);
      if (session?.blockedIngestion) {
        await this.recoverBlockedIngestion(session);
      }
      return task();
    });
    const tail = operation.then(() => undefined, () => undefined);
    this.sessionQueues.set(executionSessionId, tail);
    return operation.finally(() => {
      if (this.sessionQueues.get(executionSessionId) === tail) {
        this.sessionQueues.delete(executionSessionId);
      }
    });
  }

  private trackEventTask(task: Promise<void>): void {
    this.eventTasks.add(task);
    void task.then(
      () => this.eventTasks.delete(task),
      () => this.eventTasks.delete(task),
    );
  }
}

function reduceRun(
  record: ExecutionRunRecord,
  event: ExecutionEvent,
  occurredAt: number,
): ExecutionRunRecord | null {
  if (record.terminal) {
    return null;
  }
  if (isTransientExecutionEvent(event)) {
    // Unreachable in practice — the ingest loop routes transient content to
    // observers without reaching a record — and stated anyway so the switch
    // below stays exhaustive rather than acquiring a default that would
    // swallow the next event kind someone adds.
    return null;
  }
  switch (event.kind) {
    case 'run-started':
    case 'thinking-activity':
    case 'tool-activity':
    case 'progress':
      return { ...record, state: record.cancellationRequested ? 'cancelling' : 'running' };
    case 'result':
      return {
        ...record,
        state: record.cancellationRequested ? 'cancelling' : 'running',
        resultRef: event.result,
      };
    case 'interaction-opened':
      if (event.interaction.runId !== record.runId
        || record.openInteractionIds.includes(event.interaction.interactionId)) {
        return null;
      }
      return {
        ...record,
        state: record.cancellationRequested ? 'cancelling' : 'waiting-interaction',
        openInteractionIds: [...record.openInteractionIds, event.interaction.interactionId],
      };
    case 'interaction-resolved':
      if (!record.openInteractionIds.includes(event.interactionId)) {
        return null;
      }
      return {
        ...record,
        state: record.cancellationRequested ? 'cancelling' : 'running',
        openInteractionIds: record.openInteractionIds.filter(id => id !== event.interactionId),
      };
    case 'connection-lost':
      return { ...record, state: 'disconnected' };
    case 'recovery-started':
      return { ...record, state: 'recovering' };
    case 'recovered':
      return {
        ...record,
        state: record.cancellationRequested ? 'cancelling' : event.state,
      };
    case 'cancellation-acknowledged':
      if (!record.cancellationRequested) {
        return null;
      }
      return withTerminal(record, 'cancelled', 'cancellation-confirmed', occurredAt);
    case 'terminal':
      return reduceTerminal(record, event, occurredAt);
    case 'native-agent-observed':
    case 'native-agent-result':
    case 'native-agent-activity':
    case 'native-agent-status':
      return record;
  }
}

function reduceTerminal(
  record: ExecutionRunRecord,
  event: Extract<ExecutionEvent, { readonly kind: 'terminal' }>,
  occurredAt: number,
): ExecutionRunRecord | null {
  if (!isTerminalReasonAllowed(event.terminal, event.reason)) {
    return null;
  }
  if (event.terminal === 'succeeded'
    && record.resultExpectation === 'required'
    && !record.resultRef) {
    return withTerminal(record, 'failed', 'missing-required-result', occurredAt);
  }
  if (event.terminal === 'cancelled' && !record.cancellationRequested) {
    return null;
  }
  if (event.terminal === 'invalidated'
    && (event.sideEffectFree !== true
      || (record.state !== 'queued' && record.state !== 'preparing'))) {
    return null;
  }
  return withTerminal(record, event.terminal, event.reason, occurredAt);
}

function withTerminal(
  record: ExecutionRunRecord,
  kind: RunTerminalKind,
  reason: RunTerminalReason,
  occurredAt: number,
): ExecutionRunRecord {
  return {
    ...record,
    state: kind,
    terminal: {
      kind,
      reason,
      occurredAt,
      ...(record.resultRef ? { resultRef: record.resultRef } : {}),
    },
    openInteractionIds: [],
  };
}

function sessionStatusForEvent(
  current: ExecutionSessionRecord['status'],
  event: ExecutionEvent,
): ExecutionSessionRecord['status'] {
  switch (event.kind) {
    case 'connection-lost':
      return 'disconnected';
    case 'recovery-started':
      return 'recovering';
    case 'recovered':
      return 'active';
    default:
      return current;
  }
}

function isSessionScopedEvent(event: ExecutionEvent): boolean {
  return event.kind === 'connection-lost'
    || event.kind === 'recovery-started'
    || event.kind === 'recovered';
}

function write(
  repository: ExecutionControlWrite['repository'],
  recordId: string,
  expectedRevision: number | null,
  record:
    | ExecutionSessionRecord
    | ExecutionRunRecord
    | ExecutionInteractionRecord
    | ExecutionReconciliationRecord
    | SettingsTransitionRecord
    | ShutdownCheckpointRecord,
): ExecutionControlWrite {
  return {
    repository,
    recordId,
    expectedRevision,
    record: record as unknown as Record<string, unknown>,
  };
}

/**
 * A control record this build cannot read: written by a newer schema version,
 * or undecodable. Distinct from a programming error so startup can fail closed
 * on it without swallowing real defects.
 */
export class UnreadableControlRecordError extends Error {
  constructor(readonly recordKind: 'future' | 'corrupt', readonly detail: string) {
    super(`Control record is unreadable (${recordKind}): ${detail}`);
    this.name = 'UnreadableControlRecordError';
  }
}

async function requireCurrent<TRecord>(
  read: Promise<
    | { readonly kind: 'absent' }
    | { readonly kind: 'current'; readonly record: VersionedRecord<TRecord>; readonly raw: string }
    | {
      readonly kind: 'migrated';
      readonly fromSchemaVersion: number;
      readonly record: VersionedRecord<TRecord>;
      readonly raw: string;
    }
    | { readonly kind: 'future'; readonly schemaVersion: number }
    | { readonly kind: 'corrupt'; readonly error: string }
  >,
): Promise<VersionedRecord<TRecord>> {
  const result = await read;
  if (result.kind === 'current' || result.kind === 'migrated') {
    return result.record;
  }
  if (result.kind === 'future') {
    throw new UnreadableControlRecordError('future', `schemaVersion ${result.schemaVersion}`);
  }
  if (result.kind === 'corrupt') {
    throw new UnreadableControlRecordError('corrupt', result.error);
  }
  throw new Error(`Expected current control record, received ${result.kind}.`);
}

function requireOwner(owner: ExecutionOwner): void {
  if (!owner || typeof owner !== 'object') {
    throw new Error('Execution owner is required.');
  }
  // No `work-graph` owner: harvest ban 2 keeps the dependency graph out of this
  // migration, so accepting the kind here would admit a durable owner nothing
  // can resolve.
  if (owner.kind !== 'conversation'
    && owner.kind !== 'agent-instance'
    && owner.kind !== 'auxiliary-operation'
    && owner.kind !== 'internal-service') {
    throw new Error('Execution owner kind is invalid.');
  }
  requireIdentifier(owner.ownerId, 'owner id');
}

function sameOwner(first: ExecutionOwner, second: ExecutionOwner): boolean {
  return first.kind === second.kind && first.ownerId === second.ownerId;
}

function isActiveInteraction(
  status: ExecutionInteractionRecord['status'] | undefined,
): boolean {
  return status === 'open' || status === 'resolving' || status === 'cancelling';
}

function interactionIdFromRecord(value: string): InteractionId {
  return interactionId(value);
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a constrained identifier.`);
  }
}

function requireOpaqueRecordId(value: string, prefix: string, label: string): void {
  if (!new RegExp(`^${prefix}-[0-9a-f]{32}$`).test(value)) {
    throw new Error(`${label} must be an opaque identifier.`);
  }
}
