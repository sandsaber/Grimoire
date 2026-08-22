import type { ExecutionBackendId } from '../../execution/ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionOwner,
  InteractionRequest,
  RunTerminalReason,
} from '../../execution/ExecutionContracts';
import type {
  ExecutionEvent,
  ExecutionEventEnvelope,
} from '../../execution/ExecutionEvents';
import type {
  ExecutionSessionId,
  RunId,
} from '../../execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '../../execution/ExecutionLifecycleRegistry';
import type {
  CapabilitySupport,
  ProviderCapabilityDescriptor,
  ProviderFeatureContributions,
  ProviderWorkspaceSlots,
} from '../../providers/ProviderModule';
import type { ProviderCapabilities } from '../../providers/types';
import type { ChatMessage, StreamChunk } from '../../types/chat';
import type { ProviderId } from '../../types/provider';
import type { SlashCommand } from '../../types/settings';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../types';

/**
 * The presentation adapter: one `ChatRuntime`-shaped view of the execution
 * kernel, built as a **client of the lifecycle registry**.
 *
 * It acquires sessions and runs only through the registry and never drives a
 * backend, because ingestion, deduplication, ordering, and terminal policy are
 * the registry's job and a second opinion about any of them is how the two
 * disagree in production. Its whole contribution is translation: envelopes in,
 * `StreamChunk`s out.
 *
 * Two behaviours here differ from the runtime it replaces, both deliberately,
 * both specified in `docs/provider-execution-adapter-contract.md`:
 *
 * - **the generator closes on a terminal fact, never on the provider going
 *   quiet.** Today an iterator that ends renders as a completed turn, which is
 *   how a dropped connection can be shown as a finished answer;
 * - **`cancel()` dispatches and returns.** Whether the run stopped, and whether
 *   it had already had effects, is the run's answer to give — asynchronously,
 *   as `cancelled` or `indeterminate`.
 *
 * In production for Antigravity since the first provider flip; every other
 * provider still runs its legacy runtime until its own flip.
 */

/** What the adapter needs from its host to serve one conversation. */
export interface ExecutionChatRuntimeAdapterContext {
  readonly registry: ExecutionLifecycleRegistry;
  readonly backendId: ExecutionBackendId;
  readonly capabilities: ProviderCapabilityDescriptor;
  /**
   * Who owns the control records this tab's session writes.
   *
   * A function because a tab is built before it knows which conversation it is
   * showing: an owner captured at construction is the tab's identity, and a
   * record keyed that way cannot be found when the conversation it belonged to
   * is deleted (D4). Read when a session is established, and again when a run
   * starts.
   */
  readonly owner: () => ExecutionOwner;
  nextExecutionSessionId(): ExecutionSessionId;
  nextRunId(): RunId;
}

export interface ExecutionRunRequestSpec {
  /** Opaque to core: the provider resolves it back into its own invocation. */
  readonly requestRef: string;
  readonly resultExpectation?: 'required' | 'optional' | 'none';
}

/**
 * Provider wording for a classified failure, where the provider has a better
 * sentence than the neutral one and returning `undefined` where it does not.
 *
 * Not a channel for provider error text — the kernel refuses to forward that,
 * and D7 would have to redact it. What travels here is a translation of a
 * *classification* the kernel already made, which is why a provider can
 * localize it and name the setting the neutral sentence cannot.
 */
export type FailurePresenter = (reason: RunTerminalReason) => string | undefined;

/**
 * What the adapter knows about the conversation a runtime serves.
 *
 * `providerState` stays `unknown`-shaped on purpose: core carries it without
 * reading it, and only the provider's own host code knows what is inside.
 */
export interface BoundConversation {
  readonly id?: string;
  readonly sessionId?: string | null;
  readonly providerState?: Record<string, unknown>;
}

/** How long a tab close waits for its run to settle before giving up on it. */
/** How often a closing tab looks again at a run it is waiting on. */
const TERMINAL_POLL_INTERVAL_MS = 10;

const CLEANUP_TERMINAL_WAIT_MS = 2_000;

type RunOutcome =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'invalidated'
  | 'indeterminate';

/**
 * One turn's view of a run.
 *
 * Separate from the adapter because the twelve assertions in
 * `adapterContractTarget.test.ts` are all about this object's lifetime, and a
 * turn is the only thing in the adapter with a lifetime of its own.
 */
export class ExecutionRunStream {
  private readonly pending: StreamChunk[] = [];
  private terminal: RunOutcome | null = null;
  private terminalError: string | undefined;
  private cancelRequested = false;
  private metadataConsumed = false;
  private nativeRunRef: string | undefined;
  private assistantMessageId: string | undefined;
  private planCompleted = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly runId: RunId,
    private readonly describeProviderFailure?: FailurePresenter,
    /**
     * Turns one provider content item into chunks the surface renders.
     *
     * Absent for a provider whose surface is text: the item is then dropped
     * rather than guessed at, which is the same answer core gives for every
     * other payload it does not read.
     */
    private readonly presentProviderContent?: ProviderContentPresenter,
  ) {}

  /** Feeds one accepted envelope in. Anything after a terminal is dropped. */
  accept(envelope: ExecutionEventEnvelope): void {
    if (this.terminal !== null || !this.belongsHere(envelope)) {
      return;
    }
    const event = envelope.event;
    if (envelope.scope.kind === 'run' && envelope.scope.nativeRunRef) {
      // Carried on every run-scoped envelope, so the identity survives even if
      // the turn ends on a path that emits nothing else.
      this.nativeRunRef = envelope.scope.nativeRunRef;
    }
    if (event.kind === 'result') {
      this.assistantMessageId = event.result.resultId;
    }
    if (event.kind === 'interaction-resolved') {
      this.planCompleted = this.planCompleted || event.responseId.includes('plan');
    }
    if (event.kind === 'output-delta') {
      this.push(event.channel === 'reasoning'
        ? { type: 'thinking', content: event.text }
        : { type: 'text', content: event.text });
      return;
    }
    if (event.kind === 'provider-content') {
      for (const chunk of this.presentProviderContent?.(event.payload) ?? []) {
        this.push(chunk);
      }
      return;
    }
    if (event.kind === 'cancellation-acknowledged') {
      // A terminal in everything but name. The registry accepts this only for a
      // run whose cancellation it requested, and reduces it to `cancelled` —
      // after which the explicit `terminal` the backend sends next is dropped as
      // post-terminal. A stream waiting only for `terminal` therefore waits
      // forever, and the turn never ends. No chunk: the controller's cancel path
      // renders "Interrupted" already.
      this.terminal = 'cancelled';
      this.notify();
      return;
    }
    // Transport loss is not a terminal. The turn stays open while status query,
    // reattachment, or checkpoint recovery is still possible — the alternative
    // is rendering a dropped connection as a finished answer.
    if (event.kind !== 'terminal') {
      return;
    }
    this.terminal = event.terminal;
    // `invalidated` renders too. It means the turn never reached the provider —
    // a rejected permission mode, a session the provider no longer has — and
    // saying nothing about that leaves an empty assistant message where an
    // explanation belongs, which is the same silent-empty-answer defect this
    // adapter exists to fix, one terminal over.
    if (event.terminal === 'failed' || event.terminal === 'invalidated') {
      this.terminalError = event.reason;
      this.push({ type: 'error', content: this.describe(event.reason) });
    } else if (event.terminal === 'indeterminate') {
      this.push({
        type: 'notice',
        level: 'warning',
        content: 'Grimoire could not establish whether this run completed.',
      });
    }
    this.notify();
  }

  /**
   * The sentence for a failure, with the provider's wording where it has one.
   *
   * The provider's presenter reads live settings, so it can throw, and this is
   * the one call in `accept` that runs while a terminal is being recorded. A
   * throw here would abandon the terminal mid-flight and leave the generator
   * open forever — the turn never ends, which is worse than any wording.
   */
  private describe(reason: RunTerminalReason): string {
    try {
      return this.describeProviderFailure?.(reason) ?? describeFailure(reason);
    } catch {
      return describeFailure(reason);
    }
  }

  /** Records the intent. The run decides when, and whether, it stopped. */
  requestCancel(): void {
    this.cancelRequested = true;
  }

  /**
   * Ends the stream because nobody is reading it any more.
   *
   * Not a terminal the run reported — the run may still be going. This is the
   * reader giving up, and it exists because `chunks()` waits forever for a
   * terminal that an unsubscribed adapter will never deliver. Whoever awaited
   * it is expected to check that the stream is still the one it registered
   * before doing anything with what it collected.
   */
  abandon(): void {
    if (this.terminal !== null) {
      return;
    }
    this.terminal = 'cancelled';
    this.notify();
  }

  cancelDispatched(): boolean {
    return this.cancelRequested;
  }

  settled(): boolean {
    return this.terminal !== null;
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    if (this.metadataConsumed) {
      return {};
    }
    this.metadataConsumed = true;
    return {
      // `invalidated` is the one terminal that means the turn never reached the
      // provider, so it is the one that must not be reported as sent.
      wasSent: this.terminal !== null && this.terminal !== 'invalidated',
      // The native message identities the run was addressed by. The controller
      // copies these onto the messages, and rewind refuses to run without the
      // user one — so omitting them degrades rewind and resume silently, which
      // is worse than failing, because the turn still looks complete.
      ...(this.nativeRunRef ? { userMessageId: this.nativeRunRef } : {}),
      ...(this.assistantMessageId ? { assistantMessageId: this.assistantMessageId } : {}),
      ...(this.planCompleted ? { planCompleted: true } : {}),
    };
  }

  failureReason(): string | undefined {
    return this.terminalError;
  }

  async *chunks(): AsyncGenerator<StreamChunk> {
    for (;;) {
      while (this.pending.length > 0) {
        yield this.pending.shift() as StreamChunk;
      }
      if (this.terminal !== null) {
        return;
      }
      await new Promise<void>(resolve => {
        this.wake = resolve;
      });
    }
  }

  private belongsHere(envelope: ExecutionEventEnvelope): boolean {
    const scope = envelope.scope;
    return scope.kind !== 'session' && scope.runId === this.runId;
  }

  private push(chunk: StreamChunk): void {
    this.pending.push(chunk);
    this.notify();
  }

  private notify(): void {
    this.wake?.();
    this.wake = null;
  }
}

/**
 * Projects the descriptor onto the capability record the UI reads today.
 *
 * Exists only until M3 moves the gating onto the descriptor. Every field is
 * derived from something the descriptor states, so a missing answer is a
 * missing descriptor field rather than an invented default.
 */
export function toLegacyCapabilities(
  descriptor: ProviderCapabilityDescriptor,
  reasoningControl: ProviderCapabilities['reasoningControl'],
): Readonly<ProviderCapabilities> {
  const supported = (support: CapabilitySupport): boolean => support !== 'unsupported';
  return Object.freeze({
    providerId: descriptor.providerId,
    supportsPersistentRuntime: descriptor.process.topology !== 'process-per-run',
    supportsNativeHistory: descriptor.history.ownership === 'provider-native',
    supportsPlanMode: supported(descriptor.interactions.planMode),
    supportsRewind: supported(descriptor.conversation.rewind),
    supportsFork: supported(descriptor.conversation.fork),
    // From the chat surface, not from discovery: Codex can list its commands
    // and the chat input does not ask, and mapping from discovery would turn
    // that on at its flip without anyone deciding to.
    supportsProviderCommands: supported(descriptor.commands.chatSurface),
    supportsImageAttachments: supported(descriptor.input.imageAttachments),
    supportsInstructionMode: supported(descriptor.input.instructionMode),
    // The boolean the UI reads gates the per-run server selector and nothing
    // else, which is why it maps from that field rather than from ownership —
    // OpenCode owns Grimoire-managed MCP and still has no selector.
    supportsMcpTools: supported(descriptor.mcp.perRunSelection),
    supportsTurnSteer: supported(descriptor.conversation.steering),
    reasoningControl,
    ...(descriptor.interactions.planArtifactPrefix
      ? { planPathPrefix: descriptor.interactions.planArtifactPrefix }
      : {}),
  });
}

/**
 * What each failure reason means, in a sentence a user can act on.
 *
 * The kernel classifies a failure rather than forwarding the provider's error
 * text, and the adapter has no other source: `RunTerminalReason` is a closed
 * set of sixteen causes. That is a deliberate trade. A classified cause can be
 * rendered, counted, and reasoned about, where a raw provider string is
 * diagnostic content — often a stack trace — that D7 would have to redact
 * before it could be shown.
 *
 * Every failure-capable reason is listed, so a new one is a compile error here
 * rather than a run that fails with no explanation.
 */
const FAILURE_MESSAGES: Readonly<Record<RunTerminalReason, string>> = {
  completed: 'The run completed.',
  'provider-failure': 'The provider reported an error while running this turn.',
  // The defect this migration exists to fix, stated where a user can read it:
  // a run that produced nothing is a failure, not an empty answer.
  'missing-required-result': 'The provider ended the turn without producing a result.',
  'cancellation-confirmed': 'The run was cancelled.',
  'pre-dispatch-rejected': 'The turn was rejected before it started, so nothing ran.',
  'side-effect-free-rejection': 'The turn was rejected before it could take any action.',
  'spawn-failed': 'Grimoire could not start the provider process.',
  'nonzero-exit': 'The provider process exited with an error.',
  timeout: 'The run exceeded its time limit and was stopped.',
  'output-limit': 'The response exceeded its size limit and was stopped.',
  'known-process-exit': 'The provider process ended before the turn finished.',
  'recovery-exhausted-safe': 'Recovery attempts were exhausted; nothing was left running.',
  'dispatch-unknown': 'Grimoire could not establish whether this turn was dispatched.',
  'cancellation-unknown': 'Grimoire could not establish whether the cancellation took effect.',
  'effects-unknown': 'Grimoire could not establish what this run changed.',
  'shutdown-unknown': 'Grimoire shut down before this run could be settled.',
};

/** The run an envelope is about, where it is about one. */
function scopedRunId(envelope: ExecutionEventEnvelope): string | null {
  return envelope.scope.kind === 'session' ? null : String(envelope.scope.runId);
}

function describeFailure(reason: RunTerminalReason): string {
  return FAILURE_MESSAGES[reason];
}

/**
 * The per-conversation state the five remaining `ChatRuntime` members need.
 *
 * They were paper mappings in the M0a contract — named with a verdict, never
 * executed. Each one here has the behaviour the mapping table specifies, and a
 * test, because a mapping nobody ran is a mapping nobody has checked.
 */
export class ExecutionAdapterSession {
  private resumeCheckpoint: string | undefined;
  private invalidated = false;

  constructor(private readonly capabilities: ProviderCapabilityDescriptor) {}

  /** Held until the next dispatch, then cleared. Mapping row 5. */
  setResumeCheckpoint(checkpointId: string | undefined): void {
    this.resumeCheckpoint = checkpointId;
  }

  /**
   * Takes the checkpoint for a dispatch that is about to happen.
   *
   * Cleared by `confirmDispatched` rather than here: a dispatch that throws has
   * not resumed anything, and dropping the checkpoint would silently turn the
   * retry into a fresh conversation.
   */
  pendingResumeCheckpoint(): string | undefined {
    return this.resumeCheckpoint;
  }

  confirmDispatched(): void {
    this.resumeCheckpoint = undefined;
  }

  /** Set when a generation fence invalidates this conversation's session. */
  markInvalidated(): void {
    this.invalidated = true;
  }

  /** One-shot: the caller that reads it owns the consequence. Mapping row 15. */
  consumeSessionInvalidation(): boolean {
    const invalidated = this.invalidated;
    this.invalidated = false;
    return invalidated;
  }

  /**
   * Whether this provider exposes steering at all.
   *
   * The contract is explicit that `steer` is **absent** when unsupported rather
   * than present and returning `false`: an optional member the UI can test for
   * is a capability, while a member that always fails is a capability the UI
   * cannot tell from a broken one.
   */
  supportsSteering(): boolean {
    return this.capabilities.conversation.steering !== 'unsupported';
  }
}

/**
 * Starts one turn and returns its stream.
 *
 * Observation is established **before** the run starts, because a run that
 * dispatches quickly can emit before `startRun` resolves, and an event observed
 * one line too late is indistinguishable from an event that never happened.
 */
export async function startExecutionRun(
  context: ExecutionChatRuntimeAdapterContext,
  executionSessionId: ExecutionSessionId,
  spec: ExecutionRunRequestSpec,
  session?: ExecutionAdapterSession,
  describeProviderFailure?: FailurePresenter,
  presentProviderContent?: ProviderContentPresenter,
  /**
   * Told the run's id at the moment it is minted, before anything is awaited.
   *
   * The caller cannot learn it from the return value in time: this function
   * emits before `startRun` resolves, so a caller that recognises its own run
   * only once this resolves does not recognise the `run-started` for it.
   */
  claimRunId?: (runId: RunId) => void,
): Promise<{ runId: RunId; stream: ExecutionRunStream; release: () => void }> {
  const runId = context.nextRunId();
  claimRunId?.(runId);
  const stream = new ExecutionRunStream(runId, describeProviderFailure, presentProviderContent);
  const unsubscribe = context.registry.observe(executionSessionId, envelope => {
    stream.accept(envelope);
  });
  const resumeCheckpoint = session?.pendingResumeCheckpoint();
  try {
    await context.registry.startRun(executionSessionId, {
      runId,
      owner: context.owner(),
      resultExpectation: spec.resultExpectation ?? 'required',
      requestRef: spec.requestRef,
      ...(resumeCheckpoint ? { resumeCheckpoint } : {}),
    });
  } catch (error) {
    unsubscribe();
    throw error;
  }
  session?.confirmDispatched();
  return { runId, stream, release: unsubscribe };
}

/** Dispatches a cancellation without waiting for the run to settle. */
export function dispatchCancellation(
  context: ExecutionChatRuntimeAdapterContext,
  runId: RunId,
  stream: ExecutionRunStream,
  reason: CancellationReason = { code: 'user' },
): void {
  stream.requestCancel();
  void context.registry.cancelRun(runId, reason).catch(() => {
    // A cancellation that cannot be delivered is not a presentation failure:
    // the run still owes a terminal, and it will be `indeterminate` if nobody
    // can prove otherwise.
  });
}

/**
 * What the adapter needs that no `ProviderModule` slot carries yet.
 *
 * `prepareTurn` is mapped in the adapter contract as a **module contribution**,
 * and `ProviderModule` has no slot for it — the fifth gap the contract has shown
 * since the proofs began. It is routed through the host rather than invented
 * here, because prompt encoding is real provider behaviour that lives in the
 * legacy runtimes today: giving it a slot means moving four encoders, which is
 * M3 work, not a line in this file. Recorded so the slot is added deliberately
 * rather than discovered missing again at the flip.
 */
export interface ExecutionChatRuntimeHostPorts {
  prepareTurn(request: ChatTurnRequest): PreparedChatTurn;
  /**
   * Encodes a prepared turn into the opaque reference the backend resolves.
   *
   * Core never learns what is inside it; that is the whole point of
   * `requestRef` being a string the provider round-trips.
   *
   * It must be a constrained identifier — `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`,
   * enforced by the registry — so it is a minted id with the turn kept in a
   * store, never the prompt in a wrapper: a message with a space in it is not
   * an identifier, and every real message has one.
   */
  encodeRequestRef(
    turn: PreparedChatTurn,
    history?: ChatMessage[],
    options?: ChatRuntimeQueryOptions,
  ): string;
  /**
   * Encodes input for a run that is already going.
   *
   * Absent for a provider that cannot take it, which is what makes `steer`
   * absent too — a capability the UI can test for, rather than one that is
   * present and always fails.
   *
   * Minted under the same rule as `encodeRequestRef`, and for a sharper reason:
   * a reference the registry refuses throws out of `steerRun`, and the input
   * controller reads a throw as a failure notice rather than as the documented
   * "not accepted, put it back in the queue".
   *
   * Declared as a property rather than a method because the adapter captures it
   * once, at the point where it decides whether `steer` exists at all.
   */
  readonly encodeSteerRef?: (turn: PreparedChatTurn) => string;
  readonly reasoningControl: ProviderCapabilities['reasoningControl'];
  /** Provider-native session id, read from the session snapshot at M3. */
  currentSessionId(): string | null;
  /**
   * The conversation this runtime is now bound to, as the caller supplied it.
   *
   * Absent for a provider with nothing per-conversation to track. Present for
   * one whose next dispatch depends on what the conversation remembers, since
   * `providerState` is opaque to core and `currentSessionId` cannot express a
   * pending fork or a thread that is bound but not yet loaded.
   */
  syncConversation?(conversation: BoundConversation | null): void;
  /**
   * Renders one provider content item into the chunks the surface reads.
   *
   * Absent for a provider whose turn is text and reasoning; present for one
   * whose surface shows tool calls, their results, plan updates, or a
   * compaction boundary — none of which core models, and all of which the
   * provider's own normalization already produces.
   */
  readonly presentProviderContent?: ProviderContentPresenter;
  /**
   * What this turn is expected to produce, where that is not an answer.
   *
   * For the provider-specific cases only: a compaction is handled here, because
   * `isCompact` is a property of any prepared turn and every provider that
   * flips would otherwise rediscover the same failure notice for a turn that
   * did exactly what was asked.
   */
  resultExpectation?(turn: PreparedChatTurn): 'required' | 'optional' | 'none';
  /**
   * What the provider knows about the turn that just ended.
   *
   * Merged over what the adapter derives, because some of it the kernel cannot
   * know: the native identity of the answer is the id the provider's own fork
   * and rewind address, and a result reference minted here names nothing the
   * provider can act on.
   */
  consumeProviderTurnMetadata?(): ChatTurnMetadata;
  /** Reports a cleanup that could not complete; never rethrown to the caller. */
  reportCleanupFailure?(error: unknown): void;
  /**
   * Provider wording for a classified failure. Absent, or `undefined` for a
   * given reason, leaves the neutral sentence in place.
   */
  readonly describeFailure?: FailurePresenter;
  now?(): number;
  /**
   * Waits, without core owning a timer.
   *
   * Required, and it is the one port here that is. The adapter is
   * provider-neutral core and must not reach for the browser's global object —
   * the boundary gate holds it to that, prose included — while Obsidian's own
   * review wants the browser's timer, so that one scheduled from a popped-out
   * view belongs to the window it runs in. Both rules hold at once only if the
   * browser call sits on the host's side of this port, which is why there is no
   * fallback here to fall back to. See `src/app/execution/hostTimers.ts`.
   */
  delay(milliseconds: number): Promise<void>;
  /**
   * Renders an opened interaction and returns the chosen response id.
   *
   * Absent means the host installed no presenter yet, in which case
   * interactions are left for the provider to time out — never auto-answered.
   */
  readonly interactionPresenter?: ExecutionInteractionPresenter;
}

/**
 * The provider-neutral `ChatRuntime` over the execution kernel.
 *
 * Every member either delegates to the registry, to a module contribution, or
 * to a host port. It holds no protocol knowledge of its own, and the members it
 * cannot serve are **absent** rather than present and inert — an optional member
 * the UI can test for is a capability, while one that always fails is a
 * capability the UI cannot tell from a defect.
 */
export class ExecutionChatRuntimeAdapter<TSettings extends object = Record<string, unknown>> {
  private readonly session: ExecutionAdapterSession;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private executionSessionId: ExecutionSessionId | null = null;
  private boundSessionId: string | null | undefined;
  /** Which conversation this tab is showing, so a move to another is visible. */
  private boundConversationId: string | null | undefined;
  /**
   * What the surface installed, by the names the presenter reads back.
   *
   * Typed on the storing side as well as the reading one: the setters take
   * `unknown` and write by key, so a name that only one of the two knows
   * compiles cleanly and every approval then answers itself.
   */
  private readonly callbacks: MutableInteractionCallbacks = {};
  private sideChannels: (() => void) | null = null;
  /** Turns the backend started on its own, until each of them settles. */
  private readonly backendRuns = new Map<string, ExecutionRunStream>();
  private establishing: Promise<boolean> | undefined;
  private active: { runId: RunId; stream: ExecutionRunStream; release: () => void } | null = null;
  /** The run this tab has minted but not yet finished starting; see `ownsRun`. */
  private claimedRunId: RunId | null = null;
  private lastCompleted: ExecutionRunStream | null = null;

  constructor(
    private readonly context: ExecutionChatRuntimeAdapterContext,
    private readonly ports: ExecutionChatRuntimeHostPorts,
    private readonly features: ProviderFeatureContributions<TSettings>,
    private readonly workspace?: ProviderWorkspaceSlots,
  ) {
    this.session = new ExecutionAdapterSession(context.capabilities);
  }

  get providerId(): ProviderId {
    return this.context.capabilities.providerId;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return toLegacyCapabilities(this.context.capabilities, this.ports.reasoningControl);
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    // Synchronous on purpose: the controller writes the prepared content onto
    // the user message before sending, so turning this into a lifecycle
    // round-trip would reorder the UI against the run.
    return this.ports.prepareTurn(request);
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  setResumeCheckpoint(checkpointId: string | undefined): void {
    this.session.setResumeCheckpoint(checkpointId);
  }

  async ensureReady(): Promise<boolean> {
    if (this.executionSessionId) {
      return true;
    }
    // Held in flight, not just checked on entry: two overlapping calls would
    // each see no session, each mint an id, and the first session would be
    // orphaned with nothing left holding its id to dispose it.
    this.establishing ??= this.establish();
    try {
      return await this.establishing;
    } finally {
      this.establishing = undefined;
    }
  }

  private async establish(): Promise<boolean> {
    const executionSessionId = this.context.nextExecutionSessionId();
    // The provider-native session this conversation is on, carried into the
    // session the backend opens. Without it a backend that resumes through its
    // session — rather than through the turn's own reference, as the first
    // three flipped providers do — has nothing to load, and every reload starts
    // a new one with the conversation left behind. Found by a live run.
    const nativeSessionRef = this.ports.currentSessionId();
    await this.context.registry.createSession({
      backendId: this.context.backendId,
      executionSessionId,
      owner: this.context.owner(),
      ...(nativeSessionRef ? { nativeSessionRef } : {}),
    });
    this.executionSessionId = executionSessionId;
    // Attached here rather than only when this tab starts a run: an interaction
    // or a turn the backend began on its own belongs to the conversation, and
    // a tab that has not sent anything yet is exactly when one arrives
    // unasked-for. Idempotent, so the run path's call still stands.
    this.attachSideChannels(executionSessionId);
    this.announceReady(true);
    return true;
  }

  isReady(): boolean {
    return this.executionSessionId !== null;
  }

  getSessionId(): string | null {
    return this.ports.currentSessionId();
  }

  consumeSessionInvalidation(): boolean {
    return this.session.consumeSessionInvalidation();
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    await this.ensureReady();
    const executionSessionId = this.executionSessionId;
    if (!executionSessionId) {
      throw new Error('Execution session is not established.');
    }
    const started = await startExecutionRun(
      this.context,
      executionSessionId,
      {
        requestRef: this.ports.encodeRequestRef(turn, conversationHistory, queryOptions),
        // A compaction answers nothing anywhere, so the neutral rule is here
        // rather than in each provider that flips.
        resultExpectation: turn.isCompact
          ? 'none'
          : this.ports.resultExpectation?.(turn) ?? 'required',
      },
      this.session,
      this.ports.describeFailure,
      this.ports.presentProviderContent,
      runId => { this.claimedRunId = runId; },
    );
    this.active = started;
    // Interactions and backend-initiated turns arrive on the same stream as the
    // content, so they are routed here rather than through a second
    // subscription that could disagree about ordering. Storing the callbacks
    // without ever consuming them is how approvals and auto-turns would have
    // silently stopped working at a flip.
    this.attachSideChannels(executionSessionId);
    try {
      yield* started.stream.chunks();
    } finally {
      started.release();
      this.lastCompleted = started.stream;
      // Only its own. A conversation switch cancels this run and clears both
      // fields, and the next turn may already have claimed them by the time
      // this generator's `finally` runs — nulling them then would leave the
      // live turn unrecognised by `cancel()` and by `ownsRun()`.
      if (this.active === started) {
        this.active = null;
      }
      if (this.claimedRunId === started.runId) {
        this.claimedRunId = null;
      }
    }
  }

  cancel(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    dispatchCancellation(this.context, active.runId, active.stream);
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    // Read after the generator closed, from `finally` in the controller, which
    // is why the finished turn is kept rather than the active one.
    const observed = (this.active?.stream ?? this.lastCompleted)?.consumeTurnMetadata() ?? {};
    // The provider's own reading wins where it has one: `wasSent` is the
    // kernel's to answer, and the native identities are not.
    return { ...observed, ...this.ports.consumeProviderTurnMetadata?.() };
  }

  /** Present only where the provider can steer; absent otherwise, by contract. */
  get steer(): ((turn: PreparedChatTurn) => Promise<boolean>) | undefined {
    // Absent unless the provider declares it *and* the host can encode an
    // input for it. Present-but-failing would read to the UI as a capability,
    // since it tests for the member's existence to offer the affordance.
    const encodeSteerRef = this.ports.encodeSteerRef;
    if (!this.session.supportsSteering() || !encodeSteerRef) {
      return undefined;
    }
    return async (turn: PreparedChatTurn) => {
      const active = this.active;
      if (!active) {
        // Nothing is running, so there is nothing to steer. The controller
        // falls back to queueing the message, which is what the user wants.
        return false;
      }
      // The encoder is captured above rather than re-read here: read through
      // the port it needs a fallback, and the only value a fallback could
      // supply — an empty string — is one the registry refuses.
      return this.context.registry.steerRun(active.runId, encodeSteerRef(turn));
    };
  }

  /**
   * Closes the tab's work, in that order: cancel, wait, dispose.
   *
   * `disposeSession` refuses a session with a live run, and a tab is closed
   * mid-turn all the time — today's `destroyTab` sets a flag, calls `cancel()`
   * fire-and-forget, and calls `cleanup()` immediately, with the legacy
   * runtimes cancelling inside `cleanup`. An adapter that only disposed would
   * therefore reject on the common path, leak the session, and — since
   * `ChatRuntime.cleanup()` returns void — do it as an unhandled rejection.
   *
   * Failures are reported, never thrown: a tab that cannot be closed is worse
   * than a session that outlives it, and the shutdown path terminalizes what is
   * left.
   */
  async cleanup(): Promise<void> {
    const executionSessionId = this.executionSessionId;
    this.executionSessionId = null;
    this.announceReady(false);
    this.detachSideChannels();
    if (!executionSessionId) {
      return;
    }
    const active = this.active;
    try {
      if (active) {
        dispatchCancellation(this.context, active.runId, active.stream);
        await this.awaitTerminal(active.stream);
      }
      await this.context.registry.disposeSession(executionSessionId);
    } catch (error) {
      // Total by contract. `ChatRuntime.cleanup()` returns void, so every
      // caller discards what this returns — a rejection from anywhere in here,
      // the bounded wait included, would surface as an unhandled one with a
      // tab already gone from the screen.
      this.ports.reportCleanupFailure?.(error);
    }
  }

  /**
   * Waits for the run to settle, with a bound.
   *
   * Unbounded would make closing a tab depend on a provider answering, which is
   * exactly the coupling cancellation is meant to break. On timeout the session
   * is left to the shutdown path, which terminalizes before disposing.
   */
  private async awaitTerminal(stream: ExecutionRunStream): Promise<void> {
    const deadline = (this.ports.now?.() ?? Date.now()) + CLEANUP_TERMINAL_WAIT_MS;
    while (!stream.settled() && (this.ports.now?.() ?? Date.now()) < deadline) {
      await this.ports.delay(TERMINAL_POLL_INTERVAL_MS);
    }
  }

  /**
   * Session configuration changed.
   *
   * A change to what the provider was launched with fences the backend
   * generation, which is the registry's job; the adapter's job is to notice
   * that the conversation's native binding no longer matches and say so once
   * through `consumeSessionInvalidation`.
   */
  syncConversationState(state: BoundConversation | null): void {
    const next = state?.sessionId ?? null;
    const nextConversationId = state?.id ?? null;
    // Two cases, and the second was missing. A tab moving between conversations
    // must not carry the first one's session into the second — that puts one
    // conversation's runs under another's name. And a tab that established a
    // session *before* any conversation was bound holds one owned by the tab,
    // not by a conversation: carrying that one forward means a session whose
    // records name an owner no conversation deletion will ever look for, so
    // they outlive the chat that produced them with nothing able to remove
    // them (D4). Both are answered the same way — let it go, and let the next
    // turn establish one under the right owner.
    const movedBetweenConversations = this.boundConversationId !== undefined
      && this.boundConversationId !== nextConversationId;
    const boundItsFirstConversation = this.boundConversationId === undefined
      && nextConversationId !== null
      && this.executionSessionId !== null;
    if (movedBetweenConversations || boundItsFirstConversation) {
      this.resetSession();
    }
    this.boundConversationId = nextConversationId;
    if (this.boundSessionId !== undefined && this.boundSessionId !== next) {
      this.session.markInvalidated();
    }
    this.boundSessionId = next;
    // Forwarded rather than absorbed: a provider whose next dispatch depends on
    // what the conversation remembers — a native thread to resume, a fork to
    // complete — cannot read that from `currentSessionId` alone, and core is not
    // the place to learn what a provider keeps in `providerState`.
    this.ports.syncConversation?.(state);
  }

  /**
   * Drops the session so the next turn establishes a fresh one.
   *
   * The coverage gate listed this as absent with "no production call site",
   * which was simply false — `main.ts` calls it when settings change. Written
   * out, and synchronous like the contract, so the disposal it triggers cannot
   * make a settings change wait on a provider.
   */
  /**
   * The provider says the session this conversation names cannot be used.
   *
   * Distinct from `resetSession`, which drops the kernel session and keeps the
   * conversation's binding: this also tells the surface to let that binding go,
   * through the one-shot the save path already reads. Without it a provider
   * that refuses a resume refuses it again on the next turn, and the next, from
   * the same stored id — a conversation that cannot take another turn rather
   * than one that lost its context.
   */
  noteSessionUnusable(): void {
    this.session.markInvalidated();
    this.resetSession();
  }

  resetSession(): void {
    const executionSessionId = this.executionSessionId;
    this.executionSessionId = null;
    this.boundSessionId = undefined;
    this.boundConversationId = undefined;
    // The run goes with the session. `cleanup()` always cancelled first and
    // waited for the terminal before disposing; this path did neither, and the
    // conversation-switch case made it the common one — the registry refuses to
    // dispose a session with a live run, the rejection is swallowed into
    // `reportCleanupFailure`, and the kernel session and its provider process
    // are left with nothing holding a reference to them. The tab meanwhile
    // still has the previous conversation's answer streaming into it.
    const active = this.active;
    this.active = null;
    this.claimedRunId = null;
    if (active) {
      dispatchCancellation(this.context, active.runId, active.stream);
    }
    this.announceReady(false);
    // The observer is bound to the session being dropped, and
    // `attachSideChannels` installs at most one — so leaving it attached means
    // the next session's interactions and backend-initiated turns reach
    // nothing, while its content still streams through the per-run observer.
    // The tab then renders an answer and never renders the approval the turn is
    // blocked on. `cleanup()` always did this; the conversation-switch path
    // made it the common one.
    this.detachSideChannels();
    if (!executionSessionId) {
      return;
    }
    // Synchronous by contract — `main.ts` calls this when settings change and
    // must not wait on a provider — so the wait for the run to settle happens
    // beside the caller rather than in front of it. Bounded like `cleanup()`'s:
    // a provider that never answers leaves the session to the shutdown path,
    // which terminalizes before disposing.
    void (async () => {
      if (active) {
        await this.awaitTerminal(active.stream);
      }
      await this.context.registry.disposeSession(executionSessionId);
    })().catch(error => this.ports.reportCleanupFailure?.(error));
  }

  /** Drops the session observer, and whatever it was still following. */
  private detachSideChannels(): void {
    this.sideChannels?.();
    this.sideChannels = null;
    for (const stream of this.backendRuns.values()) {
      stream.abandon();
    }
    this.backendRuns.clear();
  }

  async reloadMcpServers(): Promise<void> {
    const mcp = this.workspace?.mcp;
    if (!mcp) {
      // Absent, not silent: a provider without Grimoire-owned MCP has nothing
      // to reload, and pretending otherwise would hide a missing contribution.
      return;
    }
    await mcp.loadServers();
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    if (this.context.capabilities.commands.chatSurface === 'unsupported') {
      // The provider may well discover commands; this asks whether the chat
      // input surfaces them, which for Codex is no.
      return [];
    }
    const sessionId = this.ports.currentSessionId();
    const runtime = sessionId ? this.workspace?.runtimeCommands : undefined;
    const fromSession = runtime ? await runtime.listForSession(sessionId as string) : [];
    const fromCatalog = this.workspace?.commands ? await this.workspace.commands.list() : [];
    // Translated at the boundary: the caller wants slash commands, which carry
    // an id and a prompt template the port's descriptor does not have. An empty
    // template is the honest value — the provider owns the expansion.
    return [...fromCatalog, ...fromSession].map(descriptor => ({
      id: `${this.context.capabilities.providerId}:${descriptor.name}`,
      name: descriptor.name,
      content: '',
      ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
    }));
  }

  /**
   * Rewinds through the capability port, in the contract's own signature.
   *
   * A getter returning the port satisfied the member-coverage gate by name
   * while having the wrong shape entirely — the gate compares names, so a
   * property called `rewind` looked like an implementation of
   * `rewind(userId, assistantId, mode)`. Written out so the two agree.
   */
  async rewind(
    userMessageId: string,
    assistantMessageId: string,
    mode: ChatRewindMode = 'conversation',
  ): Promise<ChatRewindResult> {
    const port = this.features.rewind;
    if (!port) {
      return { canRewind: false, error: 'This provider cannot rewind a conversation.' };
    }
    const outcome = await port.rewind({
      executionSessionId: this.executionSessionId ?? '',
      userMessageId,
      assistantMessageId,
      mode,
    });
    // Translated at the boundary rather than leaked: the caller reads
    // `canRewind` and `error`, so returning the richer outcome verbatim made a
    // successful rewind read as "this provider cannot rewind".
    return outcome.outcome === 'rewound'
      ? { canRewind: true, filesChanged: [...outcome.filesChanged],
        ...(outcome.insertions === undefined ? {} : { insertions: outcome.insertions }),
        ...(outcome.deletions === undefined ? {} : { deletions: outcome.deletions }) }
      : { canRewind: false, error: outcome.reason };
  }

  buildSessionUpdates(params: {
    conversation: { id: string } | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const history = this.features.history;
    if (!history || !params.conversation) {
      // No native history means no binding to patch, and inventing one would
      // write a session id the provider will not recognize.
      return { updates: {} };
    }
    const patch = history.buildSessionPatch({
      conversationId: params.conversation.id,
      sessionInvalidated: params.sessionInvalidated,
      nativeSessionRef: this.ports.currentSessionId(),
    });
    // The caller applies `updates` to the conversation, so the patch is named
    // there rather than returned in the port's own shape.
    return {
      updates: {
        sessionId: patch.sessionId,
        ...(patch.providerState === undefined ? {} : { providerState: patch.providerState }),
      },
    } as SessionUpdateResult;
  }

  resolveSessionIdForFork(conversation: { id: string } | null): string | null {
    return conversation
      ? this.features.history?.resolveSessionId(conversation.id) ?? null
      : null;
  }

  // The five interaction callbacks and the two observation hooks are stored
  // rather than acted on: the kernel carries an interaction as an opaque
  // presentation reference, so turning one into an approval prompt needs the
  // provider-owned presenter the host builds from exactly these.
  setApprovalCallback(callback: unknown): void {
    this.callbacks.approval = callback as ApprovalCallback;
  }

  setApprovalDismisser(dismisser: unknown): void {
    this.callbacks.approvalDismisser = dismisser as () => void;
  }

  setAskUserQuestionCallback(callback: unknown): void {
    this.callbacks.question = callback as AskUserQuestionCallback;
  }

  setExitPlanModeCallback(callback: unknown): void {
    this.callbacks.planDecision = callback as ExitPlanModeCallback;
  }

  setPermissionModeSyncCallback(callback: unknown): void {
    this.callbacks.permissionModeSync = callback;
  }

  setSubagentHookProvider(getState: unknown): void {
    this.callbacks.subagentState = getState;
  }

  setAutoTurnCallback(callback: unknown): void {
    // Cast to the field's own type, not to the shape this callback used to
    // have: `(runId: unknown) => void` was what K1 corrected, and a cast that
    // still names it reintroduces the mismatch at the one place the two
    // modules meet.
    this.callbacks.autoTurn = callback as AutoTurnCallback | undefined;
  }

  /** What the host presenter needs, in one place rather than seven getters. */
  interactionCallbacks(): Readonly<Record<string, unknown>> {
    return { ...this.callbacks };
  }

  /**
   * Routes the run's non-content events to the callbacks the host installed.
   *
   * One subscription per session, established once: an interaction opened
   * during turn three must reach the same presenter as one opened during turn
   * one, and a backend-initiated turn belongs to the conversation rather than
   * to any turn in it.
   */
  private attachSideChannels(executionSessionId: ExecutionSessionId): void {
    if (this.sideChannels) {
      return;
    }
    const presenter = this.ports.interactionPresenter;
    const bridge = presenter
      // Wrapped rather than passed by reference: the host's clock is a method
      // on its own object, and handing it over bare would rebind `this`.
      ? new ExecutionInteractionBridge(
        this.context.registry,
        presenter,
        () => this.ports.now?.() ?? Date.now(),
      )
      : null;
    this.sideChannels = this.context.registry.observe(executionSessionId, envelope => {
      bridge?.accept(envelope);
      if (envelope.event.kind === 'run-started' && !this.ownsRun(envelope)) {
        // A run this adapter did not start, owned by this conversation: the
        // backend began a turn of its own, which the UI has to be told about
        // because nothing in it asked for one.
        this.followBackendRun(envelope);
      }
      const runId = scopedRunId(envelope);
      if (runId) {
        this.backendRuns.get(runId)?.accept(envelope);
      }
    });
  }

  /**
   * Collects a turn the backend started, and hands it over as a turn.
   *
   * The surface renders one from its chunks — that is what `AutoTurnResult` is
   * — so reporting a run id would be reporting something the only consumer
   * cannot read. Streamed here because the adapter is what knows how an
   * envelope becomes a chunk, and dropped as soon as it settles: an
   * unanswered stream is a closure held per turn nobody asked for.
   */
  private followBackendRun(envelope: ExecutionEventEnvelope): void {
    const id = scopedRunId(envelope);
    if (!id || !this.callbacks.autoTurn || this.backendRuns.has(id)) {
      return;
    }
    const stream = new ExecutionRunStream(
      id as RunId,
      this.ports.describeFailure,
      this.ports.presentProviderContent,
    );
    this.backendRuns.set(id, stream);
    void (async () => {
      const chunks: StreamChunk[] = [];
      try {
        for await (const chunk of stream.chunks()) {
          chunks.push(chunk);
        }
        if (this.backendRuns.get(id) !== stream) {
          // Abandoned: the conversation moved on while this ran. Rendering it
          // now would put one conversation's turn into another's transcript.
          return;
        }
        await this.callbacks.autoTurn?.({
          chunks,
          metadata: {
            ...stream.consumeTurnMetadata(),
            // The provider's port is per tab, not per run, and consuming is
            // destructive: reading it here while the tab's own turn is in
            // flight hands that turn's native ids to this one and leaves the
            // turn the user asked for without them. A backend turn running
            // alone is the only one that can safely claim what the port holds.
            ...(this.active ? {} : this.ports.consumeProviderTurnMetadata?.()),
          },
        });
      } catch (error) {
        this.ports.reportCleanupFailure?.(error);
      } finally {
        if (this.backendRuns.get(id) === stream) {
          this.backendRuns.delete(id);
        }
      }
    })();
  }

  /**
   * Whether an envelope belongs to the run this tab is running.
   *
   * `active` is only assigned once `startExecutionRun` resolves, and that
   * function emits before `startRun` does — so for the width of one dispatch
   * the tab's *own* `run-started` did not look like its own, and
   * `followBackendRun` opened a second stream for it. The surface then rendered
   * the turn twice: once from the generator, once as an auto-turn.
   *
   * `claimedRunId` closes that window: it is set at the moment the id is
   * minted, before anything is awaited, and cleared when the turn ends.
   */
  private ownsRun(envelope: ExecutionEventEnvelope): boolean {
    if (envelope.scope.kind === 'session') {
      return false;
    }
    return envelope.scope.runId === this.active?.runId
      || envelope.scope.runId === this.claimedRunId;
  }

  private announceReady(ready: boolean): void {
    for (const listener of [...this.readyListeners]) {
      listener(ready);
    }
  }
}

/** Turns one provider content item into the chunks a surface renders. */
export type ProviderContentPresenter = (payload: unknown) => readonly StreamChunk[];

/**
 * The callbacks a surface installs, as the presenter reads them back.
 *
 * Named rather than a bare record because this is a join between two modules:
 * the setters take `unknown` and store by key, so without a shared shape a
 * renamed or mistyped key compiles on both sides and every approval silently
 * answers itself.
 */
export interface ExecutionInteractionCallbacks {
  readonly approval?: ApprovalCallback;
  readonly approvalDismisser?: () => void;
  readonly question?: AskUserQuestionCallback;
  readonly planDecision?: ExitPlanModeCallback;
  readonly autoTurn?: AutoTurnCallback;
  /**
   * Installed by the surface and read by nothing yet.
   *
   * Declared because the store is typed: a key only the setter knows is a key
   * the presenter can never find, and leaving these two out was how typing the
   * store found them.
   */
  readonly permissionModeSync?: unknown;
  readonly subagentState?: unknown;
}

/** The same names, writable, for the one object that owns them. */
type MutableInteractionCallbacks = {
  -readonly [K in keyof ExecutionInteractionCallbacks]: ExecutionInteractionCallbacks[K];
};

export interface ExecutionInteractionPresenter {
  present(request: InteractionRequest): Promise<string | null>;
}

/**
 * Routes opened interactions to the presenter and resolves them exactly once.
 *
 * Idempotence lives in the registry, which owns interaction ownership and
 * resolution; this only has to avoid presenting the same interaction twice
 * after a redelivery, which is why the seen set exists.
 */
export class ExecutionInteractionBridge {
  /**
   * Bounded for the same reason the ingestor's delivery-id set is: this lives
   * as long as a conversation, and an unbounded set of interaction ids would
   * grow for every approval a long session ever showed. The window only has to
   * outlast redelivery, not the conversation.
   */
  private static readonly MAX_REMEMBERED = 256;
  private readonly presented = new Set<string>();
  private readonly presentedOrder: string[] = [];

  constructor(
    private readonly registry: ExecutionLifecycleRegistry,
    private readonly presenter: ExecutionInteractionPresenter,
    private readonly now: () => number = Date.now,
  ) {}

  accept(envelope: ExecutionEventEnvelope): void {
    const event = envelope.event;
    if (event.kind !== 'interaction-opened') {
      return;
    }
    const request = event.interaction;
    if (this.presented.has(request.interactionId)) {
      return;
    }
    this.remember(request.interactionId);
    void this.settle(request);
  }

  private remember(interactionId: string): void {
    this.presented.add(interactionId);
    this.presentedOrder.push(interactionId);
    while (this.presentedOrder.length > ExecutionInteractionBridge.MAX_REMEMBERED) {
      const evicted = this.presentedOrder.shift();
      if (evicted) {
        this.presented.delete(evicted);
      }
    }
  }

  private async settle(request: InteractionRequest): Promise<void> {
    const responseId = await this.presenter.present(request).catch(() => null);
    if (responseId === null) {
      // A dismissal is the provider's problem to time out or cancel. Resolving
      // it with an invented answer would be the UI deciding on the user's
      // behalf, which is the one thing an approval prompt must never do.
      return;
    }
    await this.registry.resolveInteraction({
      interactionId: request.interactionId,
      responseId,
      resolvedAt: this.now(),
    }).catch(() => {
      // Already resolved, expired, or fenced: the registry is the authority on
      // which of those happened, and it has already recorded it.
    });
  }
}

/**
 * What the adapter does with each kind of event.
 *
 * Exported so the classification is checkable rather than implied by a switch.
 * `ignored` is a decision, not a gap: most kernel events are facts about a run
 * that the current chat UI has no surface for, and saying so in a list is what
 * keeps "we do not render this" distinguishable from "we forgot this".
 */
export type ExecutionEventPresentation = 'chunk' | 'terminal' | 'ignored';

export function classifyForPresentation(kind: ExecutionEvent['kind']): ExecutionEventPresentation {
  switch (kind) {
    case 'output-delta':
    case 'provider-content':
      return 'chunk';
    // `cancellation-acknowledged` counts, because the registry has already
    // reduced it to a terminal and drops the explicit one that follows as
    // post-terminal. Classifying it apart from `terminal` would put this
    // function at odds with `accept`, and a refactor trusting it would bring
    // back a turn that never ends.
    case 'terminal':
    case 'cancellation-acknowledged':
      return 'terminal';
    case 'run-started':
    case 'thinking-activity':
    case 'tool-activity':
    case 'progress':
    case 'result':
    case 'interaction-opened':
    case 'interaction-resolved':
    case 'connection-lost':
    case 'recovery-started':
    case 'recovered':
    case 'native-agent-observed':
    case 'native-agent-result':
    case 'native-agent-activity':
    case 'native-agent-status':
      // Facts, not content. Tool and native-agent rendering needs the provider
      // payload the kernel deliberately does not carry, so those surfaces move
      // with the chat projections at M5 rather than being guessed at here.
      return 'ignored';
  }
}
