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
 * The v1 kernel also had a `work-graph` owner. It is deliberately absent here:
 * the dependency graph and synthesis runs are a post-migration extension, not a
 * migration contract, and harvesting the owner kind now would create a state
 * nothing in this migration can produce or resolve.
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
