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
   * One of the two content-bearing events, which are also the two transient
   * ones — the other is `provider-content`, for the items a surface renders as
   * something other than text. Every remaining variant states a fact about the
   * run; these two carry what the provider is saying, because the presentation
   * adapter has to render a turn while it is still running and the committed
   * `result` arrives only at the end.
   *
   * Transient means: never persisted, never reduced into a projection, and
   * deduplicated in a set of its own — see `isTransientExecutionEvent`. The
   * durable copy of the answer is the committed result; this is the live view
   * of it.
   */
  | {
    readonly kind: 'output-delta';
    readonly channel: 'assistant' | 'reasoning';
    readonly text: string;
  }
  /**
   * Provider content the surface renders, carried without being read.
   *
   * Transient for the same reasons as `output-delta`, and opaque for the same
   * reason as `requestRef`: a tool call, its result, a plan update and a
   * compaction boundary are what the provider is *saying*, and only the
   * provider's own host code knows what one of its items looks like. Core
   * carries it to the presenter and never interprets it.
   *
   * It exists because `output-delta` is a string, and the second provider to
   * flip renders four things that are not one.
   */
  | { readonly kind: 'provider-content'; readonly payload: unknown }
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
 * - **the durable id and sequence space**, because recovery replays facts, not
 *   text: a turn's worth of token-rate traffic would evict the bounded set that
 *   protects the events which do need it. Content is still deduplicated — a
 *   backend delivers the same event on the run stream and the session stream —
 *   but in a set of its own, where an id is retired by the twin that proves
 *   both streams have delivered it.
 *
 * Ordering is still the ingestor's, so text stays interleaved with tool and
 * interaction events exactly as the provider produced it. That single ordering
 * authority is why this travels the normal delivery path instead of a second
 * channel beside it.
 */
export type TransientExecutionEvent = Extract<
ExecutionEvent,
{ kind: 'output-delta' | 'provider-content' }
>;

export function isTransientExecutionEvent(
  event: ExecutionEvent,
): event is TransientExecutionEvent {
  return event.kind === 'output-delta' || event.kind === 'provider-content';
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
  /**
   * Stated by the registry rather than delivered by a backend.
   *
   * The one case is a terminal the registry reaches on its own — a pre-dispatch
   * rejection, a recovery, a cancellation the provider never acknowledged.
   * Nothing published it, so the registry does, and it has no sequence of its
   * own to carry: the ingestor never saw it, and inventing one would claim a
   * position in a space the ingestor owns. It carries the position it follows
   * instead, which a consumer's ordering guard reads as a replay unless it is
   * told — the same shape as a transient envelope, and told the same way.
   */
  readonly synthesized?: true;
}

export interface ExecutionGapDiagnostic {
  readonly streamId: string;
  readonly expectedCausalSequence: number;
  readonly firstObservedCausalSequence: number;
  readonly affectedRunIds: readonly RunId[];
}
