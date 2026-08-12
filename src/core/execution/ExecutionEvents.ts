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
    readonly attachment: 'attached' | 'detached';
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
