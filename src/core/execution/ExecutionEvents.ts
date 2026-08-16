import type { ExecutionBackendId } from './ExecutionBackendDescriptor';
import type {
  InteractionRequest,
  ResultRef,
  RunTerminalKind,
  RunTerminalReason,
} from './ExecutionContracts';
import type {
  ExecutionSessionId,
  RunId,
  SessionInstanceId,
} from './ExecutionIds';

export interface CausalDeliveryPosition {
  readonly streamId: string;
  readonly sequence: number;
}

export type ExecutionEventScope =
  | { readonly kind: 'session' }
  | { readonly kind: 'run'; readonly runId: RunId; readonly nativeRunRef?: string }
  | {
    readonly kind: 'agent';
    readonly runId: RunId;
    readonly agentInstanceId: string;
    readonly agentRunId: string;
  };

export type ExecutionEvent =
  | { readonly kind: 'run-started' }
  /**
   * Streamed output, as it arrives.
   *
   * The only content-bearing event, and the only transient one. Every other
   * variant states a fact about the run; this one carries what the provider is
   * saying, because the presentation adapter has to render a turn while it is
   * still running and the committed `result` arrives only at the end.
   *
   * Transient means: never persisted, never reduced into a projection, and not
   * deduplicated — see `isTransientExecutionEvent`. The durable copy of the
   * answer is the committed result; this is the live view of it.
   */
  | {
    readonly kind: 'output-delta';
    readonly channel: 'assistant' | 'reasoning';
    readonly text: string;
  }
  | { readonly kind: 'thinking-activity' }
  | { readonly kind: 'tool-activity'; readonly toolCallId: string }
  | {
    readonly kind: 'progress';
    readonly progressId: string;
    readonly completed?: number;
    readonly total?: number;
  }
  | { readonly kind: 'result'; readonly result: ResultRef }
  | { readonly kind: 'interaction-opened'; readonly interaction: InteractionRequest }
  | {
    readonly kind: 'interaction-resolved';
    readonly interactionId: string;
    readonly responseId: string;
  }
  | { readonly kind: 'connection-lost' }
  | { readonly kind: 'recovery-started' }
  | { readonly kind: 'recovered'; readonly state: 'running' | 'waiting-interaction' }
  | { readonly kind: 'cancellation-acknowledged' }
  | {
    readonly kind: 'terminal';
    readonly terminal: RunTerminalKind;
    readonly reason: RunTerminalReason;
    readonly sideEffectFree?: boolean;
  }
  | {
    readonly kind: 'native-agent-observed';
    readonly nativeAgentKey: string;
    readonly parentNativeAgentKey?: string;
  }
  | {
    readonly kind: 'native-agent-result';
    readonly nativeAgentKey: string;
    readonly result: ResultRef;
  }
  | {
    readonly kind: 'native-agent-activity';
    readonly nativeAgentKey: string;
    readonly activity: 'input-sent' | 'wait-observed' | 'resume-observed' | 'close-observed';
  }
  | {
    readonly kind: 'native-agent-status';
    readonly nativeAgentKey: string;
    readonly status: 'running' | 'waiting' | 'completed' | 'failed' | 'closed';
  };

/**
 * Whether an event is live content rather than a durable fact.
 *
 * Transient events are excluded from three things, each for its own reason:
 *
 * - **persistence**, because D2 forbids a second copy of a provider transcript
 *   in the control store, and a stream of deltas is exactly that;
 * - **the run projection**, because a projection records what happened, and
 *   partial text is not a fact about the run — the committed result is;
 * - **deduplication and causal bookkeeping**, because a backend emits each
 *   delta once and never redelivers it. Recovery replays facts, not text. Were
 *   they deduplicated, a turn's worth of token-rate traffic would evict the
 *   bounded set that protects the events which do need it.
 *
 * Ordering is still the ingestor's, so text stays interleaved with tool and
 * interaction events exactly as the provider produced it. That single ordering
 * authority is why this travels the normal delivery path instead of a second
 * channel beside it.
 */
export type TransientExecutionEvent = Extract<ExecutionEvent, { kind: 'output-delta' }>;

export function isTransientExecutionEvent(
  event: ExecutionEvent,
): event is TransientExecutionEvent {
  return event.kind === 'output-delta';
}

/** Adapter-owned normalized event before core sequence assignment. */
export interface ProviderExecutionEvent {
  readonly backendId: ExecutionBackendId;
  readonly backendGeneration: number;
  readonly executionSessionId: ExecutionSessionId;
  readonly sessionInstanceId: SessionInstanceId;
  readonly deliveryId: string;
  readonly occurredAt: number;
  readonly scope: ExecutionEventScope;
  readonly causal?: CausalDeliveryPosition;
  readonly event: ExecutionEvent;
}

export interface ExecutionEventEnvelope {
  readonly schemaVersion: 1;
  readonly backendId: ExecutionBackendId;
  readonly backendGeneration: number;
  readonly executionSessionId: ExecutionSessionId;
  readonly sessionInstanceId: SessionInstanceId;
  readonly eventId: string;
  readonly sequence: number;
  readonly occurredAt: number;
  readonly scope: ExecutionEventScope;
  readonly event: ExecutionEvent;
}

export interface ExecutionGapDiagnostic {
  readonly streamId: string;
  readonly expectedCausalSequence: number;
  readonly firstObservedCausalSequence: number;
  readonly affectedRunIds: readonly RunId[];
}
