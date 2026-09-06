import type {
  ExecutionBackendDescriptor,
  ExecutionBackendId,
} from './ExecutionBackendDescriptor';
import type { ProviderExecutionEvent } from './ExecutionEvents';
import type {
  ExecutionSessionId,
  InteractionId,
  RunId,
  SessionInstanceId,
} from './ExecutionIds';

export type ResultExpectation = 'required' | 'optional' | 'none';

/**
 * Every run has exactly one durable owner.
 *
 * A `work-graph` owner is deliberately absent: the dependency graph and
 * synthesis runs are a post-migration extension, so the kind would name a state
 * nothing here can produce or resolve.
 */
export type ExecutionOwnerKind =
  | 'conversation'
  | 'agent-instance'
  | 'auxiliary-operation'
  | 'internal-service';

export interface ExecutionOwner {
  readonly kind: ExecutionOwnerKind;
  readonly ownerId: string;
}

export interface ResultRef {
  readonly resultId: string;
  readonly storage: 'projection' | 'artifact' | 'provider-native';
  readonly digest?: string;
}

export type RunTerminalKind =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'invalidated'
  | 'indeterminate';

export type RunNonTerminalState =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waiting-interaction'
  | 'waiting-children'
  | 'cancelling'
  | 'disconnected'
  | 'recovering';

export type RunState = RunNonTerminalState | RunTerminalKind;

export type RunTerminalReason =
  | 'completed'
  | 'provider-failure'
  | 'missing-required-result'
  | 'cancellation-confirmed'
  | 'pre-dispatch-rejected'
  | 'side-effect-free-rejection'
  | 'spawn-failed'
  | 'nonzero-exit'
  | 'timeout'
  | 'output-limit'
  | 'known-process-exit'
  | 'recovery-exhausted-safe'
  | 'dispatch-unknown'
  | 'cancellation-unknown'
  | 'effects-unknown'
  | 'shutdown-unknown';

export interface RunTerminal {
  readonly kind: RunTerminalKind;
  readonly reason: RunTerminalReason;
  readonly occurredAt: number;
  readonly resultRef?: ResultRef;
}

export interface ExecutionRequest {
  readonly runId: RunId;
  readonly owner: ExecutionOwner;
  readonly resultExpectation: ResultExpectation;
  readonly requestRef: string;
  /**
   * Where the provider should resume this conversation from, when the caller
   * has a checkpoint to offer.
   *
   * Opaque to core, like `requestRef`: only the provider knows what one of its
   * checkpoints means.
   */
  readonly resumeCheckpoint?: string;
}

export interface CancellationReason {
  readonly code: 'user' | 'shutdown' | 'settings-transition' | 'parent-cancelled';
}

export interface ExecutionRun {
  readonly runId: RunId;
  readonly events: AsyncIterable<ProviderExecutionEvent>;
  cancel(reason?: CancellationReason): Promise<void>;
}

export interface ExecutionSessionSnapshot {
  readonly executionSessionId: ExecutionSessionId;
  readonly sessionInstanceId: SessionInstanceId;
  readonly nativeSessionRef?: string;
}

export type ExecutionIngressEventListener = (event: ProviderExecutionEvent) => void;
export type Unsubscribe = () => void;

export interface ExecutionSession {
  readonly executionSessionId: ExecutionSessionId;
  readonly sessionInstanceId: SessionInstanceId;
  createRun(request: ExecutionRequest): ExecutionRun;
  getSnapshot(): ExecutionSessionSnapshot;
  subscribe(listener: ExecutionIngressEventListener): Unsubscribe;
  dispose(): Promise<void>;
  /**
   * Adds input to whichever run of this session is still going.
   *
   * Absent where the provider cannot take input mid-turn, which is most of
   * them: a dispatched turn is normally closed. `false` means the provider
   * declined — no run was open, or it was past the point of accepting — and is
   * not an error.
   *
   * On the session rather than the run because the provider decides which run
   * an input belongs to; and opaque for the same reason `requestRef` is, since
   * only the provider knows what one of its inputs looks like.
   */
  steer?(requestRef: string): Promise<boolean>;
}

export interface ExecutionSessionConfig {
  readonly executionSessionId: ExecutionSessionId;
  readonly owner: ExecutionOwner;
  readonly backendGeneration: number;
  readonly nativeSessionRef?: string;
}

export interface ExecutionBackend {
  readonly descriptor: ExecutionBackendDescriptor;
  createSession(config: ExecutionSessionConfig): Promise<ExecutionSession>;
  dispose(): Promise<void>;
}

export class ExecutionDispatchError extends Error {
  constructor(
    message: string,
    readonly sideEffectFree: boolean,
  ) {
    super(message);
    this.name = 'ExecutionDispatchError';
  }
}

export interface InteractionRequest {
  readonly interactionId: InteractionId;
  readonly runId: RunId;
  readonly kind: 'approval' | 'question' | 'plan-decision';
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly expiresAt?: number;
}

export interface InteractionResolution {
  readonly interactionId: InteractionId;
  readonly responseId: string;
  readonly resolvedAt: number;
  /**
   * What the person answered, where choosing an option was not the whole answer.
   *
   * Opaque to core, like `requestRef` and `presentationRef`: only the provider
   * that opened the interaction knows what one of its own answers looks like.
   * Qwen is why it exists — it asks structured questions over the ACP permission
   * channel and its reply carries the answers beside the option id, and until
   * this field a response id was the only thing that could come back.
   *
   * **Never persisted, and that is a rule rather than an omission.** D2 forbids
   * a second copy of what the user typed in the control store, and answers are
   * exactly that. It travels from the surface to the provider and is gone — so a
   * resolution that has to be replayed after a restart cannot be replayed
   * faithfully, and `resolveInteraction` refuses to try: a question caught
   * mid-resolution by a reload is cancelled rather than completed with an answer
   * nobody gave.
   */
  readonly payload?: unknown;
}

export interface InteractionPort {
  /** Must be idempotent for the same interaction and response identifiers. */
  resolve(resolution: InteractionResolution): Promise<void>;
  cancel(interactionId: InteractionId): Promise<void>;
}

export interface RunRecoveryQuery {
  readonly backendId: ExecutionBackendId;
  readonly backendGeneration: number;
  readonly executionSessionId: ExecutionSessionId;
  readonly sessionInstanceId: SessionInstanceId;
  readonly runId: RunId;
  readonly nativeSessionRef?: string;
  readonly nativeRunRef?: string;
  readonly cancellationRequested: boolean;
  /**
   * The provider's own word for how the turn ended, when the turn answered.
   *
   * A protocol stop reason, never provider payload. It exists because
   * `cancellationRequested` says only that a stop was asked for; a backend that
   * heard the turn end has strictly more to offer, and reconciling without it
   * makes every stopped turn an unknown one.
   */
  readonly nativeStopReason?: string;
  readonly resultExpectation: ResultExpectation;
}

export type RunRecoveryEvidence =
  | { readonly kind: 'running'; readonly sessionInstanceId: SessionInstanceId }
  | { readonly kind: 'waiting-interaction'; readonly interactionId: InteractionId }
  | { readonly kind: 'stopped-safe' }
  | { readonly kind: 'terminal'; readonly terminal: RunTerminal }
  | { readonly kind: 'unknown'; readonly effectsPossible: boolean };

export interface ExecutionRecoveryPort {
  reconcile(query: RunRecoveryQuery): Promise<RunRecoveryEvidence>;
}
