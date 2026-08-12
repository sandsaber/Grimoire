import {
  type ExecutionBackendId,
  executionBackendId,
} from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionOwner,
  InteractionResolution,
  ResultExpectation,
  ResultRef,
} from '../../../core/execution/ExecutionContracts';
import type {
  ExecutionInteractionRecord,
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '../../../core/execution/ExecutionControlRecords';
import {
  type ExecutionSessionId,
  executionSessionId,
  type LifecycleLeaseId,
  type RunId,
  runId,
} from '../../../core/execution/ExecutionIds';
import type {
  ExecutionLifecycleListener,
  ExecutionLifecycleNotification,
  ExecutionRunSnapshot,
  LifecycleLease,
} from '../../../core/execution/ExecutionLifecycleRegistry';
import type { ConversationRepository } from '../../../core/persistence/ConversationRepository';
import type { VersionedRecord } from '../../../core/persistence/VersionedRecord';
import { RevisionConflictError } from '../../../core/persistence/VersionedRepository';
import type { ChatMessage, Conversation } from '../../../core/types';
import {
  type ChatProjection,
  type ChatProjectionEvent,
  createChatProjection,
  type MaterializedChatResult,
  reduceChatProjection,
} from '../projections/ChatProjection';

export interface ChatExecutionLifecyclePort {
  createSession(command: {
    readonly backendId: ExecutionBackendId;
    readonly executionSessionId: ExecutionSessionId;
    readonly owner: ExecutionOwner;
  }): Promise<ExecutionSessionId>;
  startRun(
    executionSessionId: ExecutionSessionId,
    request: {
      readonly runId: RunId;
      readonly owner: ExecutionOwner;
      readonly resultExpectation: ResultExpectation;
      readonly requestRef: string;
    },
  ): Promise<RunId>;
  cancelRun(runId: RunId, reason?: CancellationReason): Promise<void>;
  resolveInteraction(resolution: InteractionResolution): Promise<void>;
  acquireLease(
    leaseId: LifecycleLeaseId,
    executionSessionId: ExecutionSessionId,
    purpose: LifecycleLease['purpose'],
  ): LifecycleLease;
  getRun(runId: RunId): Readonly<ExecutionRunRecord> | null;
  getRunSnapshot(runId: RunId): ExecutionRunSnapshot | null;
  getSession(executionSessionId: ExecutionSessionId): Readonly<ExecutionSessionRecord> | null;
  getRunsForOwner(owner: ExecutionOwner): readonly ExecutionRunSnapshot[];
  getSessionsForOwner(owner: ExecutionOwner): readonly Readonly<ExecutionSessionRecord>[];
  getInteractionsForRun(
    runId: RunId,
  ): readonly Readonly<ExecutionInteractionRecord>[];
  getReconciliationsForRun(
    runId: RunId,
  ): readonly Readonly<ExecutionReconciliationRecord>[];
  subscribe(listener: ExecutionLifecycleListener): () => void;
}

export interface ChatResultMaterializer {
  materialize(resultRef: ResultRef): Promise<MaterializedChatResult>;
}

export interface ChatConversationPersistencePort {
  read: ConversationRepository['read'];
  update: ConversationRepository['update'];
}

export interface ChatExecutionRequestPort {
  forget(requestRef: string): void;
}

export interface SubmitChatTurnCommand {
  readonly commandId: string;
  readonly conversationId: string;
  readonly backendId: ExecutionBackendId;
  readonly requestRef: string;
  readonly resultExpectation: ResultExpectation;
  readonly userMessage: ChatMessage;
}

export interface StartedChatTurn {
  readonly commandId: string;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
}

export interface CompletedChatTurn extends StartedChatTurn {
  readonly terminal: NonNullable<ExecutionRunRecord['terminal']>;
  readonly result?: MaterializedChatResult;
}

export interface ChatTurnTicket {
  readonly commandId: string;
  readonly admission: 'started' | 'queued';
  readonly started: Promise<StartedChatTurn>;
  readonly completion: Promise<CompletedChatTurn>;
}

export interface ChatExecutionCoordinatorOptions {
  readonly lifecycle: ChatExecutionLifecyclePort;
  readonly conversations: ChatConversationPersistencePort;
  readonly results: ChatResultMaterializer;
  readonly nextExecutionSessionId: () => ExecutionSessionId;
  readonly nextRunId: () => RunId;
  readonly nextLeaseId: () => LifecycleLeaseId;
  readonly assistantMessageIdForRun: (runId: RunId) => string;
  readonly requests?: ChatExecutionRequestPort;
  readonly now?: () => number;
  readonly maxConversationWriteAttempts?: number;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface PendingTurn {
  readonly command: SubmitChatTurnCommand;
  readonly started: Deferred<StartedChatTurn>;
  readonly completion: Deferred<CompletedChatTurn>;
}

interface ActiveTurn {
  readonly pending: PendingTurn;
  readonly admissionGeneration: number;
  executionSessionId?: ExecutionSessionId;
  runId?: RunId;
  started: boolean;
  dispatching: boolean;
  finalization?: Promise<void>;
}

interface ConversationEntry {
  projection: ChatProjection;
  backendId?: ExecutionBackendId;
  sessionId?: ExecutionSessionId;
  active?: ActiveTurn;
  readonly queue: PendingTurn[];
  readonly listeners: Set<(projection: ChatProjection) => void>;
}

export class ChatExecutionCoordinator {
  private readonly lifecycle: ChatExecutionLifecyclePort;
  private readonly conversations: ChatConversationPersistencePort;
  private readonly results: ChatResultMaterializer;
  private readonly nextExecutionSessionId: () => ExecutionSessionId;
  private readonly nextRunId: () => RunId;
  private readonly nextLeaseId: () => LifecycleLeaseId;
  private readonly assistantMessageIdForRun: (runId: RunId) => string;
  private readonly requests?: ChatExecutionRequestPort;
  private readonly now: () => number;
  private readonly maxConversationWriteAttempts: number;
  private readonly entries = new Map<string, ConversationEntry>();
  private readonly loads = new Map<string, Promise<ConversationEntry>>();
  private readonly runOwners = new Map<RunId, string>();
  private readonly sessionOwners = new Map<ExecutionSessionId, string>();
  private readonly unsubscribeLifecycle: () => void;
  private admissionGeneration = 0;
  private disposed = false;

  constructor(options: ChatExecutionCoordinatorOptions) {
    this.lifecycle = options.lifecycle;
    this.conversations = options.conversations;
    this.results = options.results;
    this.nextExecutionSessionId = options.nextExecutionSessionId;
    this.nextRunId = options.nextRunId;
    this.nextLeaseId = options.nextLeaseId;
    this.assistantMessageIdForRun = options.assistantMessageIdForRun;
    this.requests = options.requests;
    this.now = options.now ?? Date.now;
    this.maxConversationWriteAttempts = options.maxConversationWriteAttempts ?? 4;
    if (!Number.isSafeInteger(this.maxConversationWriteAttempts)
      || this.maxConversationWriteAttempts < 1) {
      throw new Error('Conversation write attempts must be a positive safe integer.');
    }
    this.unsubscribeLifecycle = this.lifecycle.subscribe(notification => {
      this.handleLifecycleNotification(notification);
    });
  }

  async loadConversation(conversationId: string): Promise<ChatProjection> {
    return (await this.requireEntry(conversationId)).projection;
  }

  async attach(
    conversationId: string,
    listener: (projection: ChatProjection) => void,
  ): Promise<() => void> {
    const entry = await this.requireEntry(conversationId);
    entry.listeners.add(listener);
    listener(entry.projection);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  getProjection(conversationId: string): ChatProjection | null {
    return this.entries.get(conversationId)?.projection ?? null;
  }

  async submitTurn(command: SubmitChatTurnCommand): Promise<ChatTurnTicket> {
    let admissionGeneration: number;
    let entry: ConversationEntry;
    try {
      admissionGeneration = this.beginAdmission();
      validateTurnCommand(command);
      entry = await this.requireEntry(command.conversationId, admissionGeneration);
      this.requireAdmission(admissionGeneration);
    } catch (error) {
      this.forgetRequest(command.requestRef);
      throw error;
    }
    const admission = entry.active || entry.queue.length > 0 ? 'queued' : 'started';
    const pending: PendingTurn = {
      command,
      started: deferred<StartedChatTurn>(),
      completion: deferred<CompletedChatTurn>(),
    };
    entry.queue.push(pending);
    this.apply(entry, { kind: 'command-queued', commandId: command.commandId });
    this.startNext(entry, admissionGeneration);
    return {
      commandId: command.commandId,
      admission,
      started: pending.started.promise,
      completion: pending.completion.promise,
    };
  }

  async cancelActive(
    conversationId: string,
    reason: CancellationReason = { code: 'user' },
  ): Promise<void> {
    const entry = await this.requireEntry(conversationId);
    const runId = entry.active?.runId;
    if (!runId) return;
    await this.lifecycle.cancelRun(runId, reason);
  }

  resolveInteraction(resolution: InteractionResolution): Promise<void> {
    this.requireOpen();
    return this.lifecycle.resolveInteraction(resolution);
  }

  async retryPersistence(conversationId: string): Promise<void> {
    const entry = await this.requireEntry(conversationId);
    const active = entry.active;
    if (!active?.runId || active.finalization) return;
    const run = this.lifecycle.getRun(active.runId);
    if (!run?.terminal) return;
    await this.scheduleFinalization(entry, active, run);
  }

  async waitForIdle(): Promise<void> {
    while (true) {
      const tasks: Promise<unknown>[] = [...this.loads.values()];
      for (const entry of this.entries.values()) {
        if (entry.active?.finalization) tasks.push(entry.active.finalization);
      }
      if (tasks.length === 0) return;
      await Promise.allSettled(tasks);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.admissionGeneration += 1;
    this.unsubscribeLifecycle();
    for (const entry of this.entries.values()) {
      const active = entry.active;
      if (active) {
        const error = new Error(active.started || active.dispatching
          ? 'Chat execution coordinator detached while the durable turn continues.'
          : 'Chat execution coordinator was disposed before turn admission.');
        if (!active.started && !active.dispatching) {
          this.forgetRequest(active.pending.command.requestRef);
          active.pending.started.reject(error);
          entry.active = undefined;
        }
        active.pending.completion.reject(error);
      }
      for (const pending of entry.queue) {
        this.forgetRequest(pending.command.requestRef);
        const error = new Error('Chat execution coordinator was disposed before turn admission.');
        pending.started.reject(error);
        pending.completion.reject(error);
      }
      entry.queue.splice(0);
      entry.listeners.clear();
    }
  }

  private async requireEntry(
    conversationId: string,
    admissionGeneration = this.beginAdmission(),
  ): Promise<ConversationEntry> {
    this.requireAdmission(admissionGeneration);
    const existing = this.entries.get(conversationId);
    if (existing) return existing;
    const loading = this.loads.get(conversationId);
    if (loading) return loading;
    const task = this.loadEntry(conversationId, admissionGeneration).finally(() => {
      this.loads.delete(conversationId);
    });
    this.loads.set(conversationId, task);
    return task;
  }

  private async loadEntry(
    conversationId: string,
    admissionGeneration: number,
  ): Promise<ConversationEntry> {
    const current = await requireConversation(
      this.conversations.read(conversationId),
      conversationId,
    );
    this.requireAdmission(admissionGeneration);
    const entry: ConversationEntry = {
      projection: createChatProjection(current.payload, current.revision),
      queue: [],
      listeners: new Set(),
    };
    this.entries.set(conversationId, entry);
    this.restoreLifecycleProjection(entry, current.payload);
    return entry;
  }

  private restoreLifecycleProjection(
    entry: ConversationEntry,
    conversation: Conversation,
  ): void {
    const owner: ExecutionOwner = { kind: 'conversation', ownerId: conversation.id };
    const sessions = this.lifecycle.getSessionsForOwner(owner);
    const latestSession = sessions.at(-1);
    if (latestSession) {
      entry.sessionId = executionSessionId(latestSession.executionSessionId);
      entry.backendId = executionBackendId(latestSession.backendId);
    }
    for (const session of sessions) {
      this.sessionOwners.set(
        executionSessionId(session.executionSessionId),
        conversation.id,
      );
    }

    let recoveryCandidate: Readonly<ExecutionRunRecord> | undefined;
    for (const snapshot of this.lifecycle.getRunsForOwner(owner)) {
      const record = snapshot.record;
      const typedRunId = runId(record.runId);
      const typedSessionId = executionSessionId(record.executionSessionId);
      const commandId = `restored:${record.runId}`;
      this.runOwners.set(typedRunId, conversation.id);
      this.apply(entry, {
        kind: 'turn-started',
        commandId,
        executionSessionId: typedSessionId,
        runId: typedRunId,
        resultExpectation: record.resultExpectation,
        startedAt: record.createdAt,
      });
      this.apply(entry, { kind: 'run-record', record, revision: snapshot.revision });
      for (const interaction of this.lifecycle.getInteractionsForRun(typedRunId)) {
        this.apply(entry, { kind: 'interaction-record', record: interaction });
      }
      for (const reconciliation of this.lifecycle.getReconciliationsForRun(typedRunId)) {
        this.apply(entry, { kind: 'reconciliation-record', record: reconciliation });
        if (reconciliation.observedResult) {
          void this.materializeReconciledResult(entry, typedRunId, reconciliation);
        }
      }
      if (record.terminal && isConversationCompletionPersisted(
        conversation,
        typedRunId,
        record.terminal.kind,
      )) {
        this.apply(entry, {
          kind: 'turn-completed',
          runId: typedRunId,
          conversation,
          revision: entry.projection.conversationRevision,
          completedAt: record.terminal.occurredAt,
          ...(conversation.messages.some(message => (
            message.id === this.assistantMessageIdForRun(typedRunId)
          )) ? { assistantMessageId: this.assistantMessageIdForRun(typedRunId) } : {}),
        });
      } else {
        recoveryCandidate = record;
      }
    }
    if (recoveryCandidate) {
      this.restoreActiveTurn(entry, recoveryCandidate, conversation);
    }
  }

  private restoreActiveTurn(
    entry: ConversationEntry,
    record: Readonly<ExecutionRunRecord>,
    conversation: Conversation,
  ): void {
    const typedRunId = runId(record.runId);
    const typedSessionId = executionSessionId(record.executionSessionId);
    const commandId = `restored:${record.runId}`;
    const pending: PendingTurn = {
      command: {
        commandId,
        conversationId: conversation.id,
        backendId: entry.backendId ?? executionBackendId('internal-restored-chat'),
        requestRef: `restored:${record.runId}`,
        resultExpectation: record.resultExpectation,
        userMessage: {
          id: `restored:${record.runId}`,
          role: 'user',
          content: '',
          timestamp: record.createdAt,
        },
      },
      started: deferred<StartedChatTurn>(),
      completion: deferred<CompletedChatTurn>(),
    };
    const active: ActiveTurn = {
      pending,
      admissionGeneration: this.admissionGeneration,
      executionSessionId: typedSessionId,
      runId: typedRunId,
      started: true,
      dispatching: false,
    };
    pending.started.resolve({
      commandId,
      executionSessionId: typedSessionId,
      runId: typedRunId,
    });
    entry.active = active;
    if (record.terminal) void this.scheduleFinalization(entry, active, record);
  }

  private startNext(
    entry: ConversationEntry,
    admissionGeneration = this.admissionGeneration,
  ): void {
    if (this.disposed || entry.active || entry.queue.length === 0) return;
    const pending = entry.queue.shift();
    if (!pending) return;
    const active: ActiveTurn = {
      pending,
      admissionGeneration,
      started: false,
      dispatching: false,
    };
    entry.active = active;
    void this.startActive(entry, active);
  }

  private async startActive(entry: ConversationEntry, active: ActiveTurn): Promise<void> {
    const command = active.pending.command;
    try {
      this.requireAdmission(active.admissionGeneration);
      if (entry.backendId && entry.backendId !== command.backendId) {
        throw new Error('A conversation execution session cannot change backends.');
      }
      const userConversation = await this.mutateConversation(
        command.conversationId,
        conversation => appendUserMessage(conversation, command.userMessage, this.now()),
      );
      this.requireAdmission(active.admissionGeneration);
      this.apply(entry, {
        kind: 'conversation-loaded',
        conversation: userConversation.payload,
        revision: userConversation.revision,
      });

      const owner: ExecutionOwner = {
        kind: 'conversation',
        ownerId: command.conversationId,
      };
      let sessionId = entry.sessionId;
      if (!sessionId) {
        sessionId = this.nextExecutionSessionId();
        await this.lifecycle.createSession({
          backendId: command.backendId,
          executionSessionId: sessionId,
          owner,
        });
        this.requireAdmission(active.admissionGeneration);
        entry.backendId = command.backendId;
        entry.sessionId = sessionId;
        this.sessionOwners.set(sessionId, command.conversationId);
      }
      const runId = this.nextRunId();
      active.executionSessionId = sessionId;
      active.runId = runId;
      this.runOwners.set(runId, command.conversationId);
      this.requireAdmission(active.admissionGeneration);
      active.dispatching = true;
      await this.lifecycle.startRun(sessionId, {
        runId,
        owner,
        resultExpectation: command.resultExpectation,
        requestRef: command.requestRef,
      });
      active.dispatching = false;
      const snapshot = this.lifecycle.getRunSnapshot(runId);
      if (!snapshot) {
        throw new Error('Lifecycle registry did not retain the started chat run.');
      }
      this.establishStartedTurn(entry, active, snapshot);
    } catch (error) {
      active.dispatching = false;
      const retainedRun = active.runId ? this.lifecycle.getRunSnapshot(active.runId) : null;
      if (retainedRun && active.executionSessionId) {
        this.establishStartedTurn(entry, active, retainedRun);
        return;
      }
      if (!this.disposed) {
        this.apply(entry, {
          kind: 'command-rejected',
          commandId: command.commandId,
        });
      }
      active.pending.started.reject(error);
      active.pending.completion.reject(error);
      this.forgetRequest(command.requestRef);
      if (active.runId) this.runOwners.delete(active.runId);
      if (entry.active === active) entry.active = undefined;
      if (!this.disposed) this.startNext(entry);
    }
  }

  private establishStartedTurn(
    entry: ConversationEntry,
    active: ActiveTurn,
    snapshot: ExecutionRunSnapshot,
  ): void {
    const record = snapshot.record;
    if (!active.runId || !active.executionSessionId) {
      throw new Error('A retained chat run requires execution identities.');
    }
    active.dispatching = false;
    active.started = true;
    active.pending.started.resolve({
      commandId: active.pending.command.commandId,
      executionSessionId: active.executionSessionId,
      runId: active.runId,
    });
    if (this.disposed || entry.active !== active) {
      active.pending.completion.reject(
        new Error('Chat execution coordinator detached while the durable turn continues.'),
      );
      if (entry.active === active) entry.active = undefined;
      return;
    }
    this.apply(entry, {
      kind: 'turn-started',
      commandId: active.pending.command.commandId,
      executionSessionId: active.executionSessionId,
      runId: active.runId,
      resultExpectation: active.pending.command.resultExpectation,
      startedAt: this.now(),
    });
    this.apply(entry, { kind: 'run-record', record, revision: snapshot.revision });
    if (record.terminal) void this.scheduleFinalization(entry, active, record);
  }

  private handleLifecycleNotification(notification: ExecutionLifecycleNotification): void {
    if (this.disposed) return;
    const conversationId = this.conversationIdForNotification(notification);
    if (!conversationId) return;
    const entry = this.entries.get(conversationId);
    if (!entry) return;
    switch (notification.kind) {
      case 'run-updated': {
        this.apply(entry, {
          kind: 'run-record',
          record: notification.run,
          revision: notification.revision,
        });
        const active = entry.active;
        if (active?.started && active.runId === notification.run.runId
          && notification.run.terminal) {
          void this.scheduleFinalization(entry, active, notification.run);
        }
        break;
      }
      case 'interaction-updated':
        this.apply(entry, { kind: 'interaction-record', record: notification.interaction });
        break;
      case 'envelope-accepted':
        this.apply(entry, { kind: 'run-envelope', envelope: notification.envelope });
        break;
      case 'reconciliation-appended':
        this.apply(entry, {
          kind: 'reconciliation-record',
          record: notification.reconciliation,
        });
        if (notification.reconciliation.observedResult) {
          void this.materializeReconciledResult(
            entry,
            runId(notification.reconciliation.runId),
            notification.reconciliation,
          );
        }
        break;
    }
  }

  private conversationIdForNotification(
    notification: ExecutionLifecycleNotification,
  ): string | undefined {
    switch (notification.kind) {
      case 'run-updated':
        return this.runOwners.get(notification.run.runId as RunId);
      case 'interaction-updated':
        return this.runOwners.get(notification.interaction.runId as RunId);
      case 'reconciliation-appended':
        return this.runOwners.get(notification.reconciliation.runId as RunId);
      case 'envelope-accepted':
        return notification.envelope.scope.kind === 'session'
          ? this.sessionOwners.get(notification.envelope.executionSessionId)
          : this.runOwners.get(notification.envelope.scope.runId);
    }
  }

  private scheduleFinalization(
    entry: ConversationEntry,
    active: ActiveTurn,
    run: Readonly<ExecutionRunRecord>,
  ): Promise<void> {
    if (active.finalization) return active.finalization;
    active.finalization = this.finalizeTurn(entry, active, run).finally(() => {
      active.finalization = undefined;
    });
    return active.finalization;
  }

  private async finalizeTurn(
    entry: ConversationEntry,
    active: ActiveTurn,
    run: Readonly<ExecutionRunRecord>,
  ): Promise<void> {
    if (!run.terminal || !active.runId || !active.executionSessionId) return;
    const activeRunId = active.runId;
    const activeSessionId = active.executionSessionId;
    const terminal = run.terminal;
    this.apply(entry, { kind: 'persistence-started', runId: activeRunId });
    let lease: LifecycleLease | undefined;
    try {
      lease = this.lifecycle.getSession(activeSessionId)
        ? this.lifecycle.acquireLease(
          this.nextLeaseId(),
          activeSessionId,
          'persistence',
        )
        : undefined;
      const materialized = run.resultRef
        ? await this.materializeResult(run.resultRef)
        : undefined;
      if (materialized) {
        this.apply(entry, {
          kind: 'result-materialized',
          runId: activeRunId,
          result: materialized,
        });
      }
      const completedAt = this.now();
      const assistantMessage = createAssistantMessage(
        this.assistantMessageIdForRun(activeRunId),
        materialized,
        completedAt,
      );
      const conversation = await this.mutateConversation(
        active.pending.command.conversationId,
        current => completeConversation(
          current,
          activeRunId,
          terminal,
          assistantMessage,
          completedAt,
        ),
      );
      this.apply(entry, {
        kind: 'turn-completed',
        runId: activeRunId,
        conversation: conversation.payload,
        revision: conversation.revision,
        completedAt,
        ...(assistantMessage ? { assistantMessageId: assistantMessage.id } : {}),
      });
      active.pending.completion.resolve({
        commandId: active.pending.command.commandId,
        executionSessionId: activeSessionId,
        runId: activeRunId,
        terminal,
        ...(materialized ? { result: materialized } : {}),
      });
      entry.active = undefined;
      this.startNext(entry);
    } catch {
      this.apply(entry, {
        kind: 'persistence-failed',
        runId: activeRunId,
        errorCode: 'conversation-persistence-failed',
      });
    } finally {
      lease?.release();
    }
  }

  private async materializeResult(resultRef: ResultRef): Promise<MaterializedChatResult> {
    const result = await this.results.materialize(resultRef);
    if (result.resultRef.resultId !== resultRef.resultId
      || result.resultRef.storage !== resultRef.storage) {
      throw new Error('Materialized chat result does not match its lifecycle reference.');
    }
    return result;
  }

  private async materializeReconciledResult(
    entry: ConversationEntry,
    targetRunId: RunId,
    reconciliation: Readonly<ExecutionReconciliationRecord>,
  ): Promise<void> {
    const resultRef = reconciliation.observedResult;
    if (!resultRef) return;
    const turn = entry.projection.turns.find(candidate => candidate.runId === targetRunId);
    if (!turn || turn.observedResults.some(item => (
      item.reconciliationId === reconciliation.reconciliationId
    ))) {
      return;
    }
    let lease: LifecycleLease | undefined;
    try {
      lease = this.lifecycle.getSession(turn.executionSessionId)
        ? this.lifecycle.acquireLease(
          this.nextLeaseId(),
          turn.executionSessionId,
          'projection',
        )
        : undefined;
      const result = await this.materializeResult(resultRef);
      this.apply(entry, {
        kind: 'reconciled-result-materialized',
        runId: targetRunId,
        reconciliationId: reconciliation.reconciliationId,
        result,
      });
    } catch {
      // The immutable reconciliation and result reference remain visible for a later retry.
    } finally {
      lease?.release();
    }
  }

  private async mutateConversation(
    conversationId: string,
    mutation: (conversation: Conversation) => Conversation,
  ): Promise<VersionedRecord<Conversation>> {
    let lastConflict: RevisionConflictError | undefined;
    for (let attempt = 0; attempt < this.maxConversationWriteAttempts; attempt += 1) {
      const current = await requireConversation(
        this.conversations.read(conversationId),
        conversationId,
      );
      try {
        return await this.conversations.update(conversationId, current.revision, mutation);
      } catch (error) {
        if (!(error instanceof RevisionConflictError)) throw error;
        lastConflict = error;
      }
    }
    throw lastConflict ?? new Error('Conversation mutation did not reach durable storage.');
  }

  private apply(entry: ConversationEntry, event: ChatProjectionEvent): void {
    const next = reduceChatProjection(entry.projection, event);
    if (next === entry.projection) return;
    entry.projection = next;
    for (const listener of entry.listeners) {
      try {
        listener(next);
      } catch {
        // Attachments are read-only observers and cannot affect command progress.
      }
    }
  }

  private requireOpen(): void {
    if (this.disposed) throw new Error('Chat execution coordinator is disposed.');
  }

  private beginAdmission(): number {
    this.requireOpen();
    return this.admissionGeneration;
  }

  private requireAdmission(generation: number): void {
    if (this.disposed || generation !== this.admissionGeneration) {
      throw new Error('Chat execution coordinator was disposed before turn admission.');
    }
  }

  private forgetRequest(requestRef: string): void {
    try {
      this.requests?.forget(requestRef);
    } catch {
      // Invalid command input must retain its original validation failure.
    }
  }
}

function validateTurnCommand(command: SubmitChatTurnCommand): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.commandId)) {
    throw new Error('Chat command id must be a constrained identifier.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.requestRef)) {
    throw new Error('Chat request ref must be a constrained identifier.');
  }
  if (command.userMessage.role !== 'user') {
    throw new Error('Chat turn input must contain a user message.');
  }
}

function appendUserMessage(
  conversation: Conversation,
  message: ChatMessage,
  updatedAt: number,
): Conversation {
  const existing = conversation.messages.find(candidate => candidate.id === message.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(message)) {
      throw new Error(`Chat message "${message.id}" conflicts with the durable conversation.`);
    }
    return conversation;
  }
  return {
    ...conversation,
    messages: [...conversation.messages, message],
    updatedAt,
  };
}

function createAssistantMessage(
  messageId: string,
  result: MaterializedChatResult | undefined,
  completedAt: number,
): ChatMessage | undefined {
  const content = result?.finalAssistantText ?? result?.partialAssistantText;
  if (content === undefined) return undefined;
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: completedAt,
    completedAt,
  };
}

function completeConversation(
  conversation: Conversation,
  completedRunId: RunId,
  terminal: NonNullable<ExecutionRunRecord['terminal']>,
  assistantMessage: ChatMessage | undefined,
  completedAt: number,
): Conversation {
  const messages = assistantMessage && !conversation.messages.some(message => (
    message.id === assistantMessage.id
  ))
    ? [...conversation.messages, assistantMessage]
    : conversation.messages;
  const completion = {
    runId: completedRunId,
    terminalKind: terminal.kind,
    completedAt,
    ...(assistantMessage ? { assistantMessageId: assistantMessage.id } : {}),
  };
  const completionIndex = conversation.executionCompletions?.findIndex(candidate => (
    candidate.runId === completedRunId
  )) ?? -1;
  const executionCompletions = completionIndex < 0
    ? [...(conversation.executionCompletions ?? []), completion]
    : conversation.executionCompletions?.map((candidate, index) => (
      index === completionIndex && candidate.terminalKind !== terminal.kind
        ? completion
        : candidate
    ));
  return {
    ...conversation,
    messages,
    executionCompletions,
    lastResponseAt: Math.max(conversation.lastResponseAt ?? 0, completedAt),
    updatedAt: Math.max(conversation.updatedAt, completedAt),
  };
}

function isConversationCompletionPersisted(
  conversation: Conversation,
  completedRunId: RunId,
  terminalKind: NonNullable<ExecutionRunRecord['terminal']>['kind'],
): boolean {
  return conversation.executionCompletions?.some(completion => (
    completion.runId === completedRunId && completion.terminalKind === terminalKind
  )) ?? false;
}

async function requireConversation(
  read: ReturnType<ChatConversationPersistencePort['read']>,
  conversationId: string,
): Promise<VersionedRecord<Conversation>> {
  const result = await read;
  if (result.kind === 'current' || result.kind === 'migrated') return result.record;
  throw new Error(`Conversation "${conversationId}" is unavailable (${result.kind}).`);
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
