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
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
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
 * Dark: nothing constructs this. It becomes reachable at the first provider
 * flip, which is also when the kernel enters production.
 */

/** What the adapter needs from its host to serve one conversation. */
export interface ExecutionChatRuntimeAdapterContext {
  readonly registry: ExecutionLifecycleRegistry;
  readonly backendId: ExecutionBackendId;
  readonly capabilities: ProviderCapabilityDescriptor;
  readonly owner: ExecutionOwner;
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
 * Not a channel for provider error text — that is exactly what the kernel
 * refuses to forward, and D7 would have to redact it. What travels here is a
 * translation of a *classification* the kernel already made, which is why the
 * provider can localize it and say what to do about it. Print mode is the case
 * that forced it: `pre-dispatch-rejected` is the terminal a user in the default
 * permission mode sees on their very first turn, and the neutral sentence for
 * it cannot mention the setting they need to change.
 */
export type FailurePresenter = (reason: RunTerminalReason) => string | undefined;

/** How long a tab close waits for its run to settle before giving up on it. */
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
): Promise<{ runId: RunId; stream: ExecutionRunStream; release: () => void }> {
  const runId = context.nextRunId();
  const stream = new ExecutionRunStream(runId, describeProviderFailure);
  const unsubscribe = context.registry.observe(executionSessionId, envelope => {
    stream.accept(envelope);
  });
  const resumeCheckpoint = session?.pendingResumeCheckpoint();
  try {
    await context.registry.startRun(executionSessionId, {
      runId,
      owner: context.owner,
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
   */
  encodeRequestRef(
    turn: PreparedChatTurn,
    history?: ChatMessage[],
    options?: ChatRuntimeQueryOptions,
  ): string;
  readonly reasoningControl: ProviderCapabilities['reasoningControl'];
  /** Provider-native session id, read from the session snapshot at M3. */
  currentSessionId(): string | null;
  /** Reports a cleanup that could not complete; never rethrown to the caller. */
  reportCleanupFailure?(error: unknown): void;
  /**
   * Provider wording for a classified failure. Absent, or `undefined` for a
   * given reason, leaves the neutral sentence in place.
   */
  readonly describeFailure?: FailurePresenter;
  now?(): number;
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
  private readonly callbacks: { autoTurn?: (runId: unknown) => void } & Record<string, unknown> = {};
  private sideChannels: (() => void) | null = null;
  private establishing: Promise<boolean> | undefined;
  private active: { runId: RunId; stream: ExecutionRunStream; release: () => void } | null = null;
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
    await this.context.registry.createSession({
      backendId: this.context.backendId,
      executionSessionId,
      owner: this.context.owner,
    });
    this.executionSessionId = executionSessionId;
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
      { requestRef: this.ports.encodeRequestRef(turn, conversationHistory, queryOptions) },
      this.session,
      this.ports.describeFailure,
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
      this.active = null;
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
    return (this.active?.stream ?? this.lastCompleted)?.consumeTurnMetadata() ?? {};
  }

  /** Present only where the provider can steer; absent otherwise, by contract. */
  get steer(): ((turn: PreparedChatTurn) => Promise<boolean>) | undefined {
    return this.session.supportsSteering()
      ? async () => {
        throw new Error('Steering dispatch arrives with the provider request resolver at M3.');
      }
      : undefined;
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
    this.sideChannels?.();
    this.sideChannels = null;
    if (!executionSessionId) {
      return;
    }
    const active = this.active;
    if (active) {
      dispatchCancellation(this.context, active.runId, active.stream);
      await this.awaitTerminal(active.stream);
    }
    try {
      await this.context.registry.disposeSession(executionSessionId);
    } catch (error) {
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
      await new Promise<void>(resolve => {
        window.setTimeout(resolve, 10);
      });
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
  syncConversationState(state: { sessionId?: string | null } | null): void {
    const next = state?.sessionId ?? null;
    if (this.boundSessionId !== undefined && this.boundSessionId !== next) {
      this.session.markInvalidated();
    }
    this.boundSessionId = next;
  }

  /**
   * Drops the session so the next turn establishes a fresh one.
   *
   * The coverage gate listed this as absent with "no production call site",
   * which was simply false — `main.ts` calls it when settings change. Written
   * out, and synchronous like the contract, so the disposal it triggers cannot
   * make a settings change wait on a provider.
   */
  resetSession(): void {
    const executionSessionId = this.executionSessionId;
    this.executionSessionId = null;
    this.boundSessionId = undefined;
    this.announceReady(false);
    if (executionSessionId) {
      void this.context.registry.disposeSession(executionSessionId)
        .catch(error => this.ports.reportCleanupFailure?.(error));
    }
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
    this.callbacks.approval = callback;
  }

  setApprovalDismisser(dismisser: unknown): void {
    this.callbacks.approvalDismisser = dismisser;
  }

  setAskUserQuestionCallback(callback: unknown): void {
    this.callbacks.question = callback;
  }

  setExitPlanModeCallback(callback: unknown): void {
    this.callbacks.planDecision = callback;
  }

  setPermissionModeSyncCallback(callback: unknown): void {
    this.callbacks.permissionModeSync = callback;
  }

  setSubagentHookProvider(getState: unknown): void {
    this.callbacks.subagentState = getState;
  }

  setAutoTurnCallback(callback: unknown): void {
    this.callbacks.autoTurn = callback as ((runId: unknown) => void) | undefined;
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
        this.callbacks.autoTurn?.(envelope.scope.kind === 'session' ? null : envelope.scope.runId);
      }
    });
  }

  private ownsRun(envelope: ExecutionEventEnvelope): boolean {
    return envelope.scope.kind !== 'session' && envelope.scope.runId === this.active?.runId;
  }

  private announceReady(ready: boolean): void {
    for (const listener of [...this.readyListeners]) {
      listener(ready);
    }
  }
}

/**
 * Turns an opened interaction into the UI's answer.
 *
 * The kernel carries an interaction as identity plus an opaque
 * `presentationRef` and a set of response ids — never the tool name, input, or
 * description the approval callback expects, because those are provider payload
 * and core does not decode payload. Rendering therefore needs a provider-owned
 * presenter, and the adapter's whole part is: ask, then resolve through the
 * registry with the chosen response id.
 *
 * Returning `null` means the user dismissed it without choosing, which is not
 * the same as choosing the first option and must not be flattened into one.
 */
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
      return 'chunk';
    case 'terminal':
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
    case 'cancellation-acknowledged':
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
