import type { ExecutionBackendId } from '../../execution/ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionOwner,
  RunTerminalReason,
} from '../../execution/ExecutionContracts';
import type { ExecutionEventEnvelope } from '../../execution/ExecutionEvents';
import type {
  ExecutionSessionId,
  RunId,
} from '../../execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '../../execution/ExecutionLifecycleRegistry';
import type {
  CapabilitySupport,
  ProviderCapabilityDescriptor,
} from '../../providers/ProviderModule';
import type { ProviderCapabilities } from '../../providers/types';
import type { StreamChunk } from '../../types/chat';
import type { ChatTurnMetadata } from '../types';

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
  private wake: (() => void) | null = null;

  constructor(private readonly runId: RunId) {}

  /** Feeds one accepted envelope in. Anything after a terminal is dropped. */
  accept(envelope: ExecutionEventEnvelope): void {
    if (this.terminal !== null || !this.belongsHere(envelope)) {
      return;
    }
    const event = envelope.event;
    if (event.kind === 'output-delta') {
      this.push(event.channel === 'reasoning'
        ? { type: 'thinking', content: event.text }
        : { type: 'text', content: event.text });
      return;
    }
    // Transport loss is not a terminal. The turn stays open while status query,
    // reattachment, or checkpoint recovery is still possible — the alternative
    // is rendering a dropped connection as a finished answer.
    if (event.kind !== 'terminal') {
      return;
    }
    this.terminal = event.terminal;
    if (event.terminal === 'failed') {
      this.terminalError = event.reason;
      this.push({ type: 'error', content: describeFailure(event.reason) });
    } else if (event.terminal === 'indeterminate') {
      this.push({
        type: 'notice',
        level: 'warning',
        content: 'Grimoire could not establish whether this run completed.',
      });
    }
    this.notify();
  }

  /** Records the intent. The run decides when, and whether, it stopped. */
  requestCancel(): void {
    this.cancelRequested = true;
  }

  cancelDispatched(): boolean {
    return this.cancelRequested;
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    if (this.metadataConsumed) {
      return {};
    }
    this.metadataConsumed = true;
    // `invalidated` is the one terminal that means the turn never reached the
    // provider, so it is the one that must not be reported as sent.
    return { wasSent: this.terminal !== null && this.terminal !== 'invalidated' };
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
 * derived from something the descriptor states, which is what forced `input`
 * and `planArtifactPrefix` onto it: without them the adapter would have had to
 * invent two answers and quietly disable an image button.
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
    supportsProviderCommands: descriptor.commands.discovery !== 'unsupported',
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
): Promise<{ runId: RunId; stream: ExecutionRunStream; release: () => void }> {
  const runId = context.nextRunId();
  const stream = new ExecutionRunStream(runId);
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
