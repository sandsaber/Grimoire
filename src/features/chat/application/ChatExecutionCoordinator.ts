import {
  type ExecutionBackendId,
  executionBackendId,
} from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionOwner,
  ExecutionRequest,
  InteractionResolution,
  ResultExpectation,
  ResultRef,
  RunTerminal,
} from '../../../core/execution/ExecutionContracts';
import type {
  ExecutionInteractionRecord,
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '../../../core/execution/ExecutionControlRecords';
import type {
  ExecutionEventEnvelope,
  ExecutionEventScope,
} from '../../../core/execution/ExecutionEvents';
import {
  type ExecutionSessionId,
  executionSessionId as toExecutionSessionId,
  type InteractionId,
  interactionId as toInteractionId,
  type LifecycleLeaseId,
  type RunId,
  runId as toRunId,
} from '../../../core/execution/ExecutionIds';
import type {
  CreateExecutionSessionCommand,
  ExecutionEnvelopeObserver,
  ExecutionReconciliationObserver,
  LifecycleLease,
} from '../../../core/execution/ExecutionLifecycleRegistry';
import {
  ExecutionInteractionBridge,
  type ExecutionInteractionPresenter,
} from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatRuntimeConversationState } from '../../../core/runtime/types';
import type { ChatMessage, Conversation, UsageInfo } from '../../../core/types';
import {
  type ChatProjection,
  type ChatProjectionEvent,
  type ChatTurnProjection,
  createChatProjection,
  liveAssistantText,
  type MaterializedChatResult,
  reduceChatProjection,
} from '../projections/ChatProjection';

/**
 * Turn acceptance, dispatch, the persistence barrier, and queued-input release.
 *
 * The projection's first consumer, and the half of M5's chat step that the
 * reducer cannot do for itself: a reducer is told what happened, and this is
 * the thing that makes it happen and then tells it. Harvested from the first
 * attempt's Phase 7 as material and rebuilt against this branch's contracts,
 * which differ from that attempt's in three ways worth naming, because each one
 * removed a slot the harvest would otherwise have carried in empty:
 *
 * - **the kernel publishes envelopes, not record notifications.** `observe` is
 *   a real subscription on this branch, so a run's state is derived from the
 *   envelopes the ingestor committed rather than from a run record delivered
 *   beside them. That is why no `run-record` event is fed to the projection
 *   here: its producer is startup restore, which this step does not do;
 * - **there is no result materializer to inject.** A `ResultRef` on this branch
 *   is a *reference* — every provider's sink commits one without writing the
 *   answer, because D2 forbids a second copy of a provider transcript — so
 *   nothing can resolve one back to text. The answer this coordinator persists
 *   is the one it watched arrive: the projection folds the run's own
 *   `output-delta` envelopes into the turn, and the barrier reads the turn.
 *   Accumulating it here as well would be a second copy that can disagree with
 *   the one a surface is rendering;
 * - **a conversation write applies a change rather than a copy.** M4's record
 *   store settles the concurrent-writer problem the first attempt solved with a
 *   revision-conflict retry loop, so the barrier below has neither.
 *
 * Constructed once per plugin load, beside the kernel. Every tab submits
 * through it: the per-provider switch that gated this is deleted.
 */

/** The kernel, as a chat turn needs it. `ExecutionLifecycleRegistry` satisfies it. */
export interface ChatExecutionLifecyclePort {
  createSession(command: CreateExecutionSessionCommand): Promise<ExecutionSessionId>;
  startRun(
    executionSessionId: ExecutionSessionId,
    request: ExecutionRequest,
  ): Promise<RunId>;
  cancelRun(runId: RunId, reason?: CancellationReason): Promise<void>;
  steerRun(runId: RunId, requestRef: string): Promise<boolean>;
  resolveInteraction(resolution: InteractionResolution): Promise<void>;
  observe(
    executionSessionId: ExecutionSessionId,
    observer: ExecutionEnvelopeObserver,
  ): () => void;
  observeReconciliations(
    executionSessionId: ExecutionSessionId,
    observer: ExecutionReconciliationObserver,
  ): () => void;
  getRun(runId: RunId): Readonly<ExecutionRunRecord> | null;
  getSession(executionSessionId: ExecutionSessionId): Readonly<ExecutionSessionRecord> | null;
  getSessionsForOwner(owner: ExecutionOwner): readonly Readonly<ExecutionSessionRecord>[];
  getRunsForOwner(owner: ExecutionOwner): readonly Readonly<ExecutionRunRecord>[];
  getInteraction(interactionId: InteractionId): Readonly<ExecutionInteractionRecord> | null;
  acquireLease(
    leaseId: LifecycleLeaseId,
    executionSessionId: ExecutionSessionId,
    purpose: LifecycleLease['purpose'],
  ): LifecycleLease;
}

export type ChatConversationRead =
  | { readonly kind: 'present'; readonly conversation: Conversation; readonly revision: number }
  | { readonly kind: 'absent' }
  | {
    readonly kind: 'unreadable';
    readonly reason: 'future' | 'corrupt';
    readonly detail: string;
  };

/**
 * The conversation store, as the persistence barrier needs it.
 *
 * `unreadable` is a state of its own rather than an absence, because a record
 * this build cannot read is D5's read-only case and reporting it as "no
 * conversation" is a recorded defect of the legacy reader, not a shape to copy.
 *
 * `apply` takes a change and not a copy: the store hands the current
 * conversation to the callback and writes what comes back, inside the same slot
 * it read in. That is what lets a title generated in the background and an
 * assistant message appended here compose instead of reverting each other.
 */
export interface ChatConversationPort {
  read(conversationId: string): Promise<ChatConversationRead>;
  apply(
    conversationId: string,
    change: (current: Conversation) => Conversation,
  ): Promise<{ readonly conversation: Conversation; readonly revision: number }>;
}

export interface SubmitChatTurnCommand {
  readonly commandId: string;
  readonly conversationId: string;
  readonly backendId: ExecutionBackendId;
  /** The provider's reference to the prompt. Opaque here, as everywhere. */
  readonly requestRef: string;
  readonly resultExpectation: ResultExpectation;
  readonly userMessage: ChatMessage;
  readonly resumeCheckpoint?: string;
  /** The provider-native session this conversation continues, where it has one. */
  readonly nativeSessionRef?: string;
  /**
   * What the conversation's provider binding is once this turn has ended.
   *
   * The symmetric half of `nativeSessionRef`: that says which session the turn
   * continues, this says which one it left the conversation on. Asked at the
   * barrier rather than carried from submit, because the session a turn ends on
   * is not always the one it started on — a provider that refused a resume
   * opens a new one mid-turn, and the point of writing it here is that the
   * refusal is durable before the next turn tries the dead session again.
   *
   * Optional, and absent for a run this coordinator adopted rather than
   * dispatched: an adopted run belongs to a process that is gone, and there is
   * no provider adapter here to ask.
   */
  readonly sessionBinding?: () => ChatSessionBinding | null;
}

/**
 * A conversation's provider session, as the barrier writes it.
 *
 * Two fields and no more. `sessionId` is present-and-undefined when a provider
 * refused to resume — the write has to *clear* the binding, and an absent key
 * would leave the dead session id in the vault — so a caller building one
 * distinguishes "no opinion" (return `null`) from "no session" (`sessionId:
 * undefined`).
 */
export type ChatSessionBinding = ChatRuntimeConversationState;

export interface StartedChatTurn {
  readonly commandId: string;
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
}

export interface CompletedChatTurn extends StartedChatTurn {
  readonly terminal: RunTerminal;
  readonly result?: MaterializedChatResult;
  readonly assistantMessageId?: string;
  /**
   * Whether a plan decision was answered during this turn.
   *
   * The surface asks a plan turn what to do with its plan once the turn ends,
   * and it has to know that a plan is what ended. Derived from the turn's own
   * interactions rather than watched for, which is the difference between this
   * and the legacy path: the resolutions are on the projection, so the answer
   * survives the surface that was watching going away mid-turn.
   */
  readonly planCompleted?: boolean;
  /**
   * The provider's own reference for the message this turn answered.
   *
   * **Rewind refuses to run without it.** It came off `ChatRuntime` until the
   * seam deletion — the turn-metadata member read the same `nativeRunRef` this
   * does, from the same envelopes, one object further out. Carried here so a
   * surface that has the completion has everything the turn was addressed by,
   * rather than having to ask a runtime for the half the projection did not
   * bring.
   */
  readonly userMessageId?: string;
}

export interface ChatTurnTicket {
  readonly commandId: string;
  readonly admission: 'started' | 'queued';
  readonly started: Promise<StartedChatTurn>;
  readonly completion: Promise<CompletedChatTurn>;
}

export interface ChatExecutionCoordinatorOptions {
  readonly lifecycle: ChatExecutionLifecyclePort;
  readonly conversations: ChatConversationPort;
  readonly nextExecutionSessionId: () => ExecutionSessionId;
  readonly nextRunId: () => RunId;
  readonly nextLeaseId: () => LifecycleLeaseId;
  /**
   * The message id for a run that committed no result of its own.
   *
   * A run that did commit one is identified by the provider's own result id,
   * which is what the presentation adapter reports today and what rewind and
   * fork address a checkpoint by. Preserving that is the point of the fallback
   * being a fallback.
   */
  readonly assistantMessageIdForRun: (runId: RunId) => string;
  readonly now?: () => number;
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
  readonly commandId: string;
  readonly conversationId: string;
  readonly resultExpectation: ResultExpectation;
  readonly started: Deferred<StartedChatTurn>;
  readonly completion: Deferred<CompletedChatTurn>;
  /**
   * The command this turn was submitted as, absent for a run adopted from the
   * kernel.
   *
   * The identity above is flat because of that absence: an adopted run has a
   * conversation, a command id and a result expectation, and no user message,
   * no request ref and no backend choice — those belong to a turn somebody
   * asked for. Carrying a whole command for it would have meant inventing the
   * three fields that are not true.
   */
  readonly submitted?: SubmitChatTurnCommand;
  executionSessionId?: ExecutionSessionId;
  runId?: RunId;
  dispatched: boolean;
  /**
   * Envelopes accepted between dispatch and the turn reaching the projection.
   *
   * A provider that answers inside `startRun`'s own await — every fake does,
   * and a warm CLI does too — publishes its first envelopes before this
   * coordinator has a run id to attribute them to. The projection drops an
   * envelope for a turn it does not have, so without this the opening tokens of
   * a fast turn were silently gone.
   */
  readonly buffered: ExecutionEventEnvelope[];
  /**
   * The provider's reference for this run, from the envelope scope.
   *
   * Carried on every run-scoped envelope, so the identity survives a turn that
   * ends on a path emitting nothing else — which is why it is read here rather
   * than off the terminal.
   */
  nativeRunRef?: string;
  /** The turn's token usage, as the surface last reported it. */
  usage?: UsageInfo | null;
  finalization?: Promise<void>;
  finalized: boolean;
}

/** One surface's offer to answer a conversation's questions. */
interface InteractionSurface {
  readonly bridge: ExecutionInteractionBridge;
}

interface ConversationEntry {
  projection: ChatProjection;
  backendId?: ExecutionBackendId;
  sessionId?: ExecutionSessionId;
  unobserve?: () => void;
  unobserveReconciliations?: () => void;
  active?: ActiveTurn;
  readonly queue: PendingTurn[];
  readonly listeners: Set<(projection: ChatProjection) => void>;
}

export class ChatExecutionCoordinator {
  private readonly lifecycle: ChatExecutionLifecyclePort;
  private readonly conversations: ChatConversationPort;
  private readonly nextExecutionSessionId: () => ExecutionSessionId;
  private readonly nextRunId: () => RunId;
  private readonly nextLeaseId: () => LifecycleLeaseId;
  private readonly assistantMessageIdForRun: (runId: RunId) => string;
  private readonly now: () => number;
  private readonly entries = new Map<string, ConversationEntry>();
  /**
   * Who answers a conversation's questions, in the order they offered to.
   *
   * Keyed by conversation and not by surface, for the reason the coordinator
   * itself is: two tabs open on one chat must show one approval rather than two
   * racing to resolve it. Held outside `entries` because a tab attaches before
   * the conversation has been read, and an entry that does not exist yet is not
   * a reason to lose the first question of a turn.
   *
   * A **list**, and the head presents. The first version kept one bridge and
   * dropped every later attach on the floor, which made its own doc comment
   * false in the way that matters: a split view whose *first* surface closed
   * left the conversation with no presenter at all, and the second surface —
   * still open, still visible — hung on its next approval.
   */
  private readonly interactionSurfaces = new Map<string, InteractionSurface[]>();
  private readonly loads = new Map<string, Promise<ConversationEntry>>();
  private disposed = false;

  constructor(options: ChatExecutionCoordinatorOptions) {
    this.lifecycle = options.lifecycle;
    this.conversations = options.conversations;
    this.nextExecutionSessionId = options.nextExecutionSessionId;
    this.nextRunId = options.nextRunId;
    this.nextLeaseId = options.nextLeaseId;
    this.assistantMessageIdForRun = options.assistantMessageIdForRun;
    this.now = options.now ?? Date.now;
  }

  /** The conversation as a projection, loading it from the store on first ask. */
  async loadConversation(conversationId: string): Promise<ChatProjection> {
    return (await this.requireEntry(conversationId)).projection;
  }

  /**
   * The conversation as the store has it *now*.
   *
   * This coordinator is not the only writer. A surface saves what it drew — with
   * the tool calls and content blocks the barrier does not carry — and a title
   * is generated in the background; neither reaches a projection that was built
   * from an earlier read. A caller that is about to encode a turn's history from
   * this projection would then send the provider a poorer transcript than the
   * one on screen, which is a difference the user can see in the answer.
   */
  async reloadConversation(conversationId: string): Promise<ChatProjection> {
    const entry = await this.requireEntry(conversationId);
    const read = await this.conversations.read(conversationId);
    if (read.kind === 'present') {
      this.apply(entry, {
        kind: 'conversation-loaded',
        conversation: read.conversation,
        revision: read.revision,
      });
    }
    return entry.projection;
  }

  /**
   * Subscribes to a conversation's projection, current value first.
   *
   * The listener is called with what is already known before anything else
   * happens, so an attaching surface never has to ask twice — once for the
   * state and once for the updates — and cannot miss what lands between.
   */
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

  /**
   * Accepts a turn, and says whether it went straight out or joined the queue.
   *
   * The ticket's two promises are the whole contract a caller needs: `started`
   * settles when the kernel owns the run, `completion` when the answer is
   * durable. A caller that only wants to know the turn was taken can ignore
   * both — the projection says the same thing.
   */
  async submitTurn(command: SubmitChatTurnCommand): Promise<ChatTurnTicket> {
    this.requireOpen();
    validateTurnCommand(command);
    const entry = await this.requireEntry(command.conversationId);
    this.requireOpen();
    const admission = entry.active || entry.queue.length > 0 ? 'queued' : 'started';
    const pending: PendingTurn = {
      command,
      started: deferred<StartedChatTurn>(),
      completion: deferred<CompletedChatTurn>(),
    };
    entry.queue.push(pending);
    this.apply(entry, { kind: 'command-queued', commandId: command.commandId });
    this.startNext(entry);
    return {
      commandId: command.commandId,
      admission,
      started: pending.started.promise,
      completion: pending.completion.promise,
    };
  }

  /** Asks the kernel to stop the running turn. A conversation with none is a no-op. */
  async cancelActive(
    conversationId: string,
    reason: CancellationReason = { code: 'user' },
  ): Promise<void> {
    const activeRunId = this.entries.get(conversationId)?.active?.runId;
    if (!activeRunId) {
      return;
    }
    await this.lifecycle.cancelRun(activeRunId, reason);
  }

  /**
   * The execution session this conversation's turns run in, if it has one.
   *
   * Asked by anything keyed by that session rather than by a run — rewind, so
   * far. The runtime opens a session of its own when a tab is primed and it
   * holds no runs; this is the one that does.
   */
  executionSessionFor(conversationId: string): ExecutionSessionId | null {
    return this.entries.get(conversationId)?.sessionId ?? null;
  }

  /**
   * Sends input into the turn this conversation already has running.
   *
   * **The controller reaches the kernel here rather than through the runtime**,
   * and that is the whole reason this exists: the adapter's `steer` acts on the
   * run *it* started, and on this path the run was started by the coordinator.
   * Asked of the adapter, a steer answered `false` for every provider on this
   * list — which the controller reads as "no turn to join" and puts the message
   * back in the queue, so the feature disappeared without a failure.
   *
   * `false` when nothing is running, which is the same answer and the right one:
   * a queued message belongs in the queue.
   */
  async steerActive(
    conversationId: string,
    requestRef: string,
    userMessage: ChatMessage,
  ): Promise<boolean> {
    const entry = this.entries.get(conversationId);
    const activeRunId = entry?.active?.runId;
    if (!entry || !activeRunId) {
      return false;
    }
    const accepted = await this.lifecycle.steerRun(activeRunId, requestRef);
    if (!accepted) {
      // Nothing is written for input the provider did not take. A message in
      // the transcript that never reached the turn reads as one that was sent
      // and ignored, and the caller is about to put it back in the queue.
      return false;
    }
    // Written for the same reason a first message is, and it has to be written
    // *here*: the provider echoes steered input back as its own user message,
    // which is how the legacy path drew it — and this path filters that echo
    // out as turn framing, so without this the question an answer refers to is
    // one nobody can see.
    //
    // **A write that fails does not un-send the input.** The provider has it;
    // reporting failure would have the caller put the message back in the queue
    // and the person send it again, and the model would receive it twice mid
    // turn. So the write is best-effort and the answer stays `true` — the turn
    // is what it is, and a conversation missing one of its questions is the
    // smaller wrong.
    try {
      const withUser = await this.conversations.apply(
        conversationId,
        current => appendUserMessage(current, userMessage, this.now()),
      );
      this.apply(entry, {
        kind: 'conversation-loaded',
        conversation: withUser.conversation,
        revision: withUser.revision,
      });
    } catch {
      this.apply(entry, {
        kind: 'persistence-failed',
        runId: activeRunId,
        errorCode: 'steer-question-not-stored',
      });
    }
    return true;
  }

  /**
   * Registers who puts this conversation's questions on screen.
   *
   * **The turn stops without one.** A provider that asks before it writes waits
   * for an answer, and on this path the thing that presents an interaction and
   * sends the answer back is attached here rather than by the runtime: the
   * adapter builds its bridge when *it* opens a session, and here the
   * coordinator opened one. A Claude turn that asked to write a file hung for
   * five minutes before this existed.
   *
   * **The first presenter presents, and later ones queue behind it.** Two tabs
   * on one conversation are two runtimes with two presenters, and both
   * presenting means one approval on screen twice with two answers racing to
   * resolve it. Releasing the head promotes the next, which is what closing one
   * of two split tabs does — an earlier version kept only the first and
   * discarded the rest, so closing it left the surviving tab unable to answer
   * anything.
   *
   * **The presenter is a function, read per question rather than captured.** A
   * tab's runtime is rebuilt whenever the warm-runtime cap evicts it, and the
   * presenter goes with it; a captured one answers `null` for every request the
   * new runtime raised, which is indistinguishable from nobody being there.
   *
   * Releasing the last one leaves an open interaction open. That is deliberate:
   * a dismissal is the provider's to time out, and answering for someone who is
   * no longer there is the one thing an approval prompt must never do.
   */
  attachInteractionPresenter(
    conversationId: string,
    presenter: () => ExecutionInteractionPresenter | null,
  ): () => void {
    const surface: InteractionSurface = {
      bridge: new ExecutionInteractionBridge(
        this.lifecycle,
        // Read per question, not captured. A tab's runtime is rebuilt whenever
        // the warm-runtime cap evicts it, and the presenter goes with it: a
        // captured one then answers `null` for every request the *new* runtime
        // raised, which the bridge correctly treats as "nobody answered" and
        // the turn waits forever — the same hang this seam exists to fix,
        // arriving a tab switch later.
        { present: request => (presenter()?.present(request) ?? Promise.resolve(null)) },
        this.now,
      ),
    };
    const surfaces = this.interactionSurfaces.get(conversationId) ?? [];
    surfaces.push(surface);
    this.interactionSurfaces.set(conversationId, surfaces);
    return () => {
      const current = this.interactionSurfaces.get(conversationId);
      if (!current) {
        return;
      }
      const index = current.indexOf(surface);
      if (index >= 0) {
        current.splice(index, 1);
      }
      if (current.length === 0) {
        this.interactionSurfaces.delete(conversationId);
      }
    };
  }

  /**
   * Answers an open interaction, and shows the answer without waiting.
   *
   * The kernel commits the resolution and tells the provider; it publishes no
   * envelope for it, because the provider is the one that reports its own
   * interaction closing. Most do, but the person who clicked has already
   * answered — so the committed record is read back here and shown, rather
   * than leaving a resolved question on screen until a provider mentions it.
   */
  async resolveInteraction(resolution: InteractionResolution): Promise<void> {
    this.requireOpen();
    await this.lifecycle.resolveInteraction(resolution);
    const record = this.lifecycle.getInteraction(resolution.interactionId);
    const entry = record ? this.entryForRun(record.runId) : undefined;
    if (record && entry) {
      this.apply(entry, { kind: 'interaction-record', record });
    }
  }

  /**
   * Records what a turn cost, for the barrier to persist with it.
   *
   * Token counts reach the surface as provider content and reach nothing else:
   * the kernel carries none, so the conversation's own usage — which the legacy
   * save wrote and every context meter reads — would otherwise be lost the
   * moment the surface that saw it went away. A run this coordinator is not
   * running is ignored rather than refused; a stale report from a turn that has
   * ended is not worth an error.
   */
  recordTurnUsage(targetRunId: RunId, usage: UsageInfo | null): void {
    const entry = this.entryForRun(targetRunId);
    const active = entry?.active;
    if (active?.runId === targetRunId) {
      active.usage = usage;
    }
  }

  /**
   * Runs the persistence barrier again for a turn whose write failed.
   *
   * The run is finished either way — the kernel recorded that — so what failed
   * is the conversation write, and retrying it is the only thing that can move
   * the turn from `failed` to `saved`. Without this a vault write that failed
   * once left the answer on screen and nowhere else.
   */
  async retryPersistence(conversationId: string): Promise<void> {
    const entry = this.entries.get(conversationId);
    const active = entry?.active;
    if (!entry || !active?.runId || active.finalization) {
      return;
    }
    const turn = findTurn(entry.projection, active.runId);
    if (!turn?.run.terminal) {
      return;
    }
    await this.scheduleFinalization(entry, active, turn.run.terminal);
  }

  /**
   * Detaches from every conversation. The kernel keeps whatever it owns.
   *
   * A dispatched turn is deliberately *not* cancelled here: the run is durable
   * and belongs to the kernel, so ending this coordinator ends the view of it,
   * not the work. The waiter is told which of the two happened, because
   * "detached" and "never started" are different answers for a caller deciding
   * whether to re-send.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.unobserve?.();
      entry.unobserve = undefined;
      entry.unobserveReconciliations?.();
      entry.unobserveReconciliations = undefined;
      const active = entry.active;
      if (active) {
        active.completion.reject(new Error(active.dispatched
          ? 'Chat execution coordinator detached while the durable turn continues.'
          : 'Chat execution coordinator was disposed before turn admission.'));
        if (!active.dispatched) {
          active.started.reject(
            new Error('Chat execution coordinator was disposed before turn admission.'),
          );
        }
      }
      for (const pending of entry.queue.splice(0)) {
        const error = new Error('Chat execution coordinator was disposed before turn admission.');
        pending.started.reject(error);
        pending.completion.reject(error);
      }
      entry.listeners.clear();
    }
  }

  private async requireEntry(conversationId: string): Promise<ConversationEntry> {
    const existing = this.entries.get(conversationId);
    if (existing) {
      return existing;
    }
    // Two tabs opening one conversation at once must not each build a
    // projection of it: the second would replace the first, and every listener
    // the first had would then be attached to an object nothing updates.
    const loading = this.loads.get(conversationId) ?? this.loadEntry(conversationId);
    this.loads.set(conversationId, loading);
    try {
      return await loading;
    } finally {
      this.loads.delete(conversationId);
    }
  }

  private async loadEntry(conversationId: string): Promise<ConversationEntry> {
    const read = await this.conversations.read(conversationId);
    if (read.kind === 'unreadable') {
      throw new Error(
        `Conversation "${conversationId}" cannot be read (${read.reason}): ${read.detail}`,
      );
    }
    if (read.kind === 'absent') {
      throw new Error(`Conversation "${conversationId}" does not exist.`);
    }
    const entry: ConversationEntry = {
      projection: createChatProjection(read.conversation, read.revision),
      queue: [],
      listeners: new Set(),
    };
    this.entries.set(conversationId, entry);
    this.adoptOwnedWork(entry, conversationId);
    return entry;
  }

  /**
   * Takes over the work the kernel is already doing for this conversation.
   *
   * A run is durable and the surface watching it is not: a reload, a reopened
   * tab, a second window all arrive at a conversation whose turn is still
   * going inside the kernel. Without this the turn is orphaned — nothing
   * renders it, nothing runs its persistence barrier, and the answer it is
   * still producing is written nowhere.
   *
   * **Only runs that have not finished.** A terminal run this process still
   * holds is finished work: its events were delivered to whoever was listening
   * at the time and the control store keeps facts rather than a transcript, so
   * adopting one would add a turn whose answer this coordinator can never
   * supply. What it said is in the conversation already, or in the provider's
   * own history where hydration reads it.
   *
   * More than one unfinished run is not expected and is adopted anyway, newest
   * active: two of them means a previous process left one behind, and showing
   * the conversation as idle would be the less honest of the two answers.
   */
  private adoptOwnedWork(entry: ConversationEntry, conversationId: string): void {
    const owner: ExecutionOwner = { kind: 'conversation', ownerId: conversationId };
    const unfinished = this.lifecycle.getRunsForOwner(owner).filter(run => !run.terminal);
    const sessions = this.lifecycle.getSessionsForOwner(owner);
    const latest = unfinished.at(-1);
    const session = latest
      ? sessions.find(candidate => candidate.executionSessionId === latest.executionSessionId)
      : sessions.filter(candidate => candidate.status !== 'disposed').at(-1);
    if (!session) {
      return;
    }
    entry.sessionId = toExecutionSessionId(session.executionSessionId);
    entry.backendId = executionBackendId(session.backendId);
    this.observeSession(entry, entry.sessionId);
    for (const record of unfinished) {
      this.adoptRun(entry, conversationId, record);
    }
  }

  private adoptRun(
    entry: ConversationEntry,
    conversationId: string,
    record: Readonly<ExecutionRunRecord>,
  ): void {
    const adoptedRunId = toRunId(record.runId);
    const adoptedSessionId = toExecutionSessionId(record.executionSessionId);
    const commandId = `adopted:${record.runId}`;
    this.apply(entry, {
      kind: 'turn-started',
      commandId,
      executionSessionId: adoptedSessionId,
      runId: adoptedRunId,
      resultExpectation: record.resultExpectation,
      assistantMessageId: this.assistantMessageIdForRun(adoptedRunId),
      startedAt: record.createdAt,
    });
    // The record rather than the events, because the events are gone. It
    // carries the position they reached, so the envelopes still to come are
    // taken and the ones already accounted for cannot be replayed.
    this.apply(entry, { kind: 'run-record', record });
    for (const openInteractionId of record.openInteractionIds) {
      const interaction = this.readInteraction(openInteractionId);
      if (interaction) {
        this.apply(entry, { kind: 'interaction-record', record: interaction });
      }
    }
    const active: ActiveTurn = {
      commandId,
      conversationId,
      resultExpectation: record.resultExpectation,
      started: deferred<StartedChatTurn>(),
      completion: deferred<CompletedChatTurn>(),
      executionSessionId: adoptedSessionId,
      runId: adoptedRunId,
      dispatched: true,
      buffered: [],
      finalized: false,
    };
    active.started.resolve({
      commandId,
      executionSessionId: adoptedSessionId,
      runId: adoptedRunId,
    });
    entry.active = active;
  }

  private startNext(entry: ConversationEntry): void {
    if (this.disposed || entry.active || entry.queue.length === 0) {
      return;
    }
    const pending = entry.queue.shift();
    if (!pending) {
      return;
    }
    const active: ActiveTurn = {
      commandId: pending.command.commandId,
      conversationId: pending.command.conversationId,
      resultExpectation: pending.command.resultExpectation,
      started: pending.started,
      completion: pending.completion,
      submitted: pending.command,
      dispatched: false,
      buffered: [],
      finalized: false,
    };
    entry.active = active;
    void this.startActive(entry, active, pending.command);
  }

  private async startActive(
    entry: ConversationEntry,
    active: ActiveTurn,
    command: SubmitChatTurnCommand,
  ): Promise<void> {
    try {
      if (entry.backendId && entry.backendId !== command.backendId) {
        // One conversation, one backend. A second backend over the same
        // conversation would own runs the first one's session does not know
        // about, and the provider would be resumed into a transcript it never
        // wrote.
        throw new Error('A conversation execution session cannot change backends.');
      }
      const withUser = await this.conversations.apply(
        command.conversationId,
        current => appendUserMessage(current, command.userMessage, this.now()),
      );
      this.requireOpen();
      this.apply(entry, {
        kind: 'conversation-loaded',
        conversation: withUser.conversation,
        revision: withUser.revision,
      });

      const owner: ExecutionOwner = { kind: 'conversation', ownerId: command.conversationId };
      const sessionId = entry.sessionId ?? await this.openSession(entry, command, owner);
      this.requireOpen();
      const nextRunId = this.nextRunId();
      active.executionSessionId = sessionId;
      active.runId = nextRunId;
      await this.lifecycle.startRun(sessionId, {
        runId: nextRunId,
        owner,
        resultExpectation: command.resultExpectation,
        requestRef: command.requestRef,
        ...(command.resumeCheckpoint ? { resumeCheckpoint: command.resumeCheckpoint } : {}),
      });
      this.establishStartedTurn(entry, active, sessionId, nextRunId);
    } catch (error) {
      this.abandonTurn(entry, active, error);
    }
  }

  private async openSession(
    entry: ConversationEntry,
    command: SubmitChatTurnCommand,
    owner: ExecutionOwner,
  ): Promise<ExecutionSessionId> {
    const sessionId = this.nextExecutionSessionId();
    await this.lifecycle.createSession({
      backendId: command.backendId,
      executionSessionId: sessionId,
      owner,
      ...(command.nativeSessionRef ? { nativeSessionRef: command.nativeSessionRef } : {}),
    });
    entry.backendId = command.backendId;
    entry.sessionId = sessionId;
    this.observeSession(entry, sessionId);
    return sessionId;
  }

  /**
   * Both of the session's channels, subscribed before the first run starts.
   *
   * Envelopes say what a run did; reconciliations say what was later
   * established about one that could not say. Nothing this session emits can
   * arrive before there is somewhere to put it, which is why this happens at
   * the session rather than at the run.
   */
  private observeSession(entry: ConversationEntry, sessionId: ExecutionSessionId): void {
    entry.unobserve?.();
    entry.unobserveReconciliations?.();
    entry.unobserve = this.lifecycle.observe(sessionId, envelope => {
      this.onEnvelope(entry, envelope);
    });
    entry.unobserveReconciliations = this.lifecycle.observeReconciliations(sessionId, record => {
      this.onReconciliation(entry, record);
    });
  }

  private onReconciliation(
    entry: ConversationEntry,
    record: Readonly<ExecutionReconciliationRecord>,
  ): void {
    if (this.disposed) {
      return;
    }
    this.apply(entry, { kind: 'reconciliation-record', record });
  }

  private establishStartedTurn(
    entry: ConversationEntry,
    active: ActiveTurn,
    executionSessionId: ExecutionSessionId,
    startedRunId: RunId,
  ): void {
    active.dispatched = true;
    this.apply(entry, {
      kind: 'turn-started',
      commandId: active.commandId,
      executionSessionId,
      runId: startedRunId,
      resultExpectation: active.resultExpectation,
      assistantMessageId: this.assistantMessageIdForRun(startedRunId),
      startedAt: this.now(),
    });
    active.started.resolve({
      commandId: active.commandId,
      executionSessionId,
      runId: startedRunId,
    });
    for (const envelope of active.buffered.splice(0)) {
      this.acceptEnvelope(entry, envelope);
    }
    // A turn can be over before dispatch returns — a provider that refuses,
    // and every fake that answers synchronously. The terminal is already in the
    // projection by now, and nothing else will arrive to trigger the barrier.
    this.settleIfTerminal(entry, startedRunId);
  }

  private abandonTurn(
    entry: ConversationEntry,
    active: ActiveTurn,
    error: unknown,
  ): void {
    active.buffered.splice(0);
    if (entry.active === active) {
      entry.active = undefined;
    }
    if (!this.disposed) {
      this.apply(entry, {
        kind: 'command-rejected',
        commandId: active.commandId,
      });
    }
    active.started.reject(error);
    active.completion.reject(error);
    this.startNext(entry);
  }

  private onEnvelope(entry: ConversationEntry, envelope: ExecutionEventEnvelope): void {
    if (this.disposed) {
      return;
    }
    const active = entry.active;
    if (active && !active.dispatched) {
      active.buffered.push(envelope);
      return;
    }
    this.acceptEnvelope(entry, envelope);
  }

  private acceptEnvelope(entry: ConversationEntry, envelope: ExecutionEventEnvelope): void {
    const targetRunId = scopedRunId(envelope.scope) ?? entry.projection.activeRunId;
    if (envelope.scope.kind === 'run' && envelope.scope.nativeRunRef && entry.active) {
      entry.active.nativeRunRef = envelope.scope.nativeRunRef;
    }
    this.apply(entry, { kind: 'run-envelope', envelope });
    // Beside the projection's own reading of it, not instead of it: the surface
    // draws that an approval is open, and this is what puts it on screen and
    // sends the answer back. Nothing else on this path does — the adapter's
    // bridge is attached when the *adapter* opens a session, and here the
    // coordinator opened it, so a provider that stopped to ask waited forever.
    this.interactionSurfaces.get(entry.projection.conversationId)?.[0]?.bridge.accept(envelope);
    this.trackInteraction(entry, envelope);
    if (targetRunId) {
      this.settleIfTerminal(entry, targetRunId);
    }
  }

  /**
   * Reads the interaction the envelope announced, rather than rebuilding it.
   *
   * The record is committed before the envelope is published, so the kernel can
   * always answer — and its answer carries the status and the selected response
   * that an event alone does not. Synthesizing one from the event would be a
   * second opinion about a record that already exists.
   */
  private trackInteraction(entry: ConversationEntry, envelope: ExecutionEventEnvelope): void {
    const event = envelope.event;
    if (event.kind !== 'interaction-opened' && event.kind !== 'interaction-resolved') {
      return;
    }
    const record = this.readInteraction(event.kind === 'interaction-opened'
      ? event.interaction.interactionId
      : event.interactionId);
    if (record) {
      this.apply(entry, { kind: 'interaction-record', record });
    }
  }

  private readInteraction(value: string): Readonly<ExecutionInteractionRecord> | null {
    try {
      return this.lifecycle.getInteraction(toInteractionId(value));
    } catch {
      // A malformed identifier is the kernel's to refuse, not this observer's
      // to throw over: raising here would abandon the rest of the envelope.
      return null;
    }
  }

  private settleIfTerminal(entry: ConversationEntry, targetRunId: RunId): void {
    const active = entry.active;
    if (!active?.dispatched || active.runId !== targetRunId || active.finalized) {
      return;
    }
    const terminal = findTurn(entry.projection, targetRunId)?.run.terminal;
    if (terminal) {
      void this.scheduleFinalization(entry, active, terminal);
    }
  }

  private scheduleFinalization(
    entry: ConversationEntry,
    active: ActiveTurn,
    terminal: RunTerminal,
  ): Promise<void> {
    active.finalization ??= this.finalizeTurn(entry, active, terminal).finally(() => {
      active.finalization = undefined;
    });
    return active.finalization;
  }

  /**
   * The persistence barrier: the turn is over, so make its answer durable.
   *
   * A lease is held across the write for the reason leases exist — a session
   * disposed mid-write would take the run record this conversation is about to
   * refer to. A failure leaves the turn active and marked `failed` rather than
   * releasing the queue: the next turn would append its own messages over an
   * answer that never reached the vault.
   */
  private async finalizeTurn(
    entry: ConversationEntry,
    active: ActiveTurn,
    terminal: RunTerminal,
  ): Promise<void> {
    const activeRunId = active.runId;
    const sessionId = active.executionSessionId;
    if (!activeRunId || !sessionId) {
      return;
    }
    this.apply(entry, { kind: 'persistence-started', runId: activeRunId });
    let lease: LifecycleLease | undefined;
    try {
      lease = this.lifecycle.getSession(sessionId)
        ? this.lifecycle.acquireLease(this.nextLeaseId(), sessionId, 'persistence')
        : undefined;
      const turn = findTurn(entry.projection, activeRunId);
      const streamed = turn ? liveAssistantText(turn) : undefined;
      const resultRef = turn?.run.result ?? terminal.resultRef;
      const materialized = materializeResult(resultRef, terminal, streamed);
      if (materialized) {
        this.apply(entry, {
          kind: 'result-materialized',
          runId: activeRunId,
          result: materialized,
        });
      }
      const completedAt = this.now();
      const assistantMessage = createAssistantMessage(
        // The identity the turn was given when it started, not one minted here:
        // a surface has been drawing this answer under that id since the first
        // token, and a second identity at the barrier makes the drawn answer
        // and the stored answer two different messages.
        turn?.assistantMessageId ?? this.assistantMessageIdForRun(activeRunId),
        resultRef,
        streamed,
        completedAt,
      );
      // **Read here, and inside the same write as the answer.** The session a
      // turn ends on and the answer it produced are one fact about the
      // conversation, and the surface used to write them separately — the
      // barrier stored the message, then `save()` stored the binding, and a
      // plan turn whose approval was invalidated skipped that second write
      // entirely and left the conversation bound to a session it had left.
      const binding = active.submitted?.sessionBinding?.();
      const saved = await this.conversations.apply(
        active.conversationId,
        current => {
          const completed = completeConversation(
            current, assistantMessage, active.usage, completedAt,
          );
          // Spread whole rather than field by field: `sessionId: undefined` is
          // how an invalidated binding is cleared, and skipping undefined keys
          // would leave the dead session id behind.
          return binding ? { ...completed, ...binding } : completed;
        },
      );
      active.finalized = true;
      this.apply(entry, {
        kind: 'turn-completed',
        runId: activeRunId,
        conversation: saved.conversation,
        revision: saved.revision,
        completedAt,
      });
      if (entry.active === active) {
        entry.active = undefined;
      }
      active.completion.resolve({
        commandId: active.commandId,
        executionSessionId: sessionId,
        runId: activeRunId,
        terminal,
        ...(materialized ? { result: materialized } : {}),
        ...(assistantMessage ? { assistantMessageId: assistantMessage.id } : {}),
        ...(answeredAPlan(entry.projection, activeRunId) ? { planCompleted: true } : {}),
        ...(active.nativeRunRef ? { userMessageId: active.nativeRunRef } : {}),
      });
      this.startNext(entry);
    } catch (error) {
      this.apply(entry, {
        kind: 'persistence-failed',
        runId: activeRunId,
        errorCode: persistenceErrorCode(error),
      });
    } finally {
      lease?.release();
    }
  }

  private entryForRun(targetRunId: string): ConversationEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.projection.turns.some(turn => turn.runId === targetRunId)) {
        return entry;
      }
    }
    return undefined;
  }

  private apply(entry: ConversationEntry, event: ChatProjectionEvent): void {
    const next = reduceChatProjection(entry.projection, event);
    if (next === entry.projection) {
      return;
    }
    entry.projection = next;
    for (const listener of [...entry.listeners]) {
      try {
        listener(next);
      } catch {
        // A surface is a reader. One that throws must not stop the turn it is
        // reading, nor the other surfaces reading beside it.
      }
    }
  }

  private requireOpen(): void {
    if (this.disposed) {
      throw new Error('Chat execution coordinator is disposed.');
    }
  }
}

function validateTurnCommand(command: SubmitChatTurnCommand): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.commandId)) {
    throw new Error('Chat command id must be a constrained identifier.');
  }
  if (command.userMessage.role !== 'user') {
    throw new Error('Chat turn input must contain a user message.');
  }
  // `requestRef`, the owner id and the opaque identities are the kernel's to
  // validate, and it does. Re-checking them here would be a second copy of a
  // rule that can then disagree with the first.
}

function appendUserMessage(
  conversation: Conversation,
  message: ChatMessage,
  updatedAt: number,
): Conversation {
  const existing = conversation.messages.find(candidate => candidate.id === message.id);
  if (existing) {
    // A resubmitted command is idempotent; a different message under an id the
    // conversation already holds is a caller bug, and writing it would replace
    // what the user actually sent.
    if (JSON.stringify(existing) !== JSON.stringify(message)) {
      throw new Error(`Chat message "${message.id}" conflicts with the stored conversation.`);
    }
    return conversation;
  }
  return {
    ...conversation,
    messages: [...conversation.messages, message],
    updatedAt,
  };
}

function completeConversation(
  conversation: Conversation,
  assistantMessage: ChatMessage | undefined,
  usage: UsageInfo | null | undefined,
  completedAt: number,
): Conversation {
  const alreadyPresent = assistantMessage
    && conversation.messages.some(message => message.id === assistantMessage.id);
  return {
    ...conversation,
    messages: assistantMessage && !alreadyPresent
      ? [...conversation.messages, assistantMessage]
      : conversation.messages,
    // Absent rather than null when the turn reported none: a turn whose
    // provider says nothing about tokens must not erase what the last one did.
    ...(usage ? { usage } : {}),
    lastResponseAt: Math.max(conversation.lastResponseAt ?? 0, completedAt),
    updatedAt: Math.max(conversation.updatedAt, completedAt),
  };
}

/**
 * What the run answered, paired with the reference the kernel committed.
 *
 * `final` only for a run that succeeded: text from a turn that failed, was
 * cancelled or ended indeterminate is what had arrived by then, and calling
 * that the answer would present an interrupted turn as a finished one.
 */
function materializeResult(
  resultRef: ResultRef | undefined,
  terminal: RunTerminal,
  streamed: string | undefined,
): MaterializedChatResult | undefined {
  if (!resultRef) {
    return undefined;
  }
  if (streamed === undefined) {
    return { resultRef };
  }
  return terminal.kind === 'succeeded'
    ? { resultRef, finalAssistantText: streamed }
    : { resultRef, partialAssistantText: streamed };
}

function createAssistantMessage(
  messageId: string,
  resultRef: ResultRef | undefined,
  streamed: string | undefined,
  completedAt: number,
): ChatMessage | undefined {
  if (streamed === undefined || streamed.length === 0) {
    // A turn that said nothing gets no message. An empty assistant bubble is
    // the silent-empty-answer defect, and the terminal is what the surface
    // renders instead.
    return undefined;
  }
  return {
    id: messageId,
    role: 'assistant',
    content: streamed,
    timestamp: completedAt,
    completedAt,
    // Two fields because they answer two questions. `id` names the message in
    // this conversation, and this names the answer in the provider's own terms
    // — which is what a rewind or a fork asks it to resume at. Conflating them
    // was what made the drawn message and the stored one differ.
    ...(resultRef ? { assistantMessageId: resultRef.resultId } : {}),
  };
}

function persistenceErrorCode(error: unknown): string {
  return error instanceof Error && error.name === 'RevisionConflictError'
    ? 'conversation-revision-conflict'
    : 'conversation-persistence-failed';
}

/**
 * Whether this run answered a plan decision.
 *
 * The same reading the presentation adapter does — a response id that names a
 * plan — kept identical rather than improved, because the ids are the
 * providers' and a stricter rule here would silently stop raising the approval
 * for one of them. Read from the projection, so it is still true for a turn
 * whose surface went away while the question was open.
 */
function answeredAPlan(projection: ChatProjection, targetRunId: RunId): boolean {
  return projection.interactions.some(interaction => (
    interaction.runId === targetRunId
    && interaction.status === 'resolved'
    && interaction.selectedResponseId?.includes('plan') === true
  ));
}

function findTurn(
  projection: ChatProjection,
  targetRunId: RunId,
): ChatTurnProjection | undefined {
  return projection.turns.find(turn => turn.runId === targetRunId);
}

function scopedRunId(scope: ExecutionEventScope): RunId | undefined {
  return scope.kind === 'session' ? undefined : scope.runId;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // A ticket half nobody awaits must not become an unhandled rejection: a
  // caller that only wants `started` is a caller this contract allows.
  void promise.catch(() => undefined);
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
