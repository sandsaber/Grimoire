import type {
  ExecutionOwner,
  RunTerminalReason,
} from '../execution/ExecutionContracts';
import type { ExecutionSessionId, RunId } from '../execution/ExecutionIds';
import type { ProviderId } from '../types/provider';
import type {
  AgentDispatchToken,
  AgentInstanceId,
  AgentResultId,
  AgentRunId,
  NativeAgentAdoptionKey,
} from './AgentIds';

export type AgentExecutionMode = 'provider-native' | 'grimoire-managed';
export type AgentOrigin = 'grimoire-dispatched' | 'observed-native';
export type AgentAttachmentPolicy = 'attached' | 'detached';
export type AgentObservationFidelity = 'full' | 'aggregate' | 'terminal-only' | 'opaque' | 'none';

export interface AgentDefinitionSnapshot {
  readonly definitionId: string;
  readonly revisionDigest: string;
  readonly source: 'provider-native' | 'provider-files' | 'grimoire';
}

export interface PermissionBoundary {
  readonly granted: readonly string[];
  readonly approvable: readonly string[];
}

export interface AgentPermissionRequest {
  readonly requested: readonly string[];
  readonly approvable: readonly string[];
}

export interface EffectiveAgentPolicy {
  readonly granted: readonly string[];
  readonly approvable: readonly string[];
  readonly denied: readonly string[];
}

export interface AgentInstanceRecord {
  readonly agentInstanceId: AgentInstanceId;
  readonly providerId: ProviderId;
  readonly definition: AgentDefinitionSnapshot;
  readonly executionMode: AgentExecutionMode;
  readonly origin: AgentOrigin;
  readonly rootOwner: ExecutionOwner;
  readonly parentAgentInstanceId?: AgentInstanceId;
  readonly parentAgentRunId?: AgentRunId;
  readonly attachment: AgentAttachmentPolicy;
  readonly observation: AgentObservationFidelity;
  readonly nativeAdoptionKey?: NativeAgentAdoptionKey;
  readonly nativeAgentRef?: string;
  readonly runIds: readonly AgentRunId[];
  readonly status: 'active' | 'terminal';
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type AgentRunState =
  | 'dispatching'
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'invalidated'
  | 'indeterminate';

export interface AgentRunTerminal {
  readonly kind: Extract<AgentRunState,
  'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'invalidated' | 'indeterminate'>;
  readonly reason: RunTerminalReason;
  readonly occurredAt: number;
}

export interface AgentRunRecord {
  readonly agentRunId: AgentRunId;
  readonly agentInstanceId: AgentInstanceId;
  readonly attempt: number;
  readonly goalRef: string;
  readonly policy: EffectiveAgentPolicy;
  readonly terminalTransactionId: string;
  readonly workGraphRef?: string;
  readonly workGraphExecutionRef?: string;
  readonly workNodeRef?: string;
  readonly inputResultIds?: readonly AgentResultId[];
  readonly dispatchToken?: AgentDispatchToken;
  readonly executionSessionId?: ExecutionSessionId;
  readonly executionRunId?: RunId;
  readonly nativeAgentRef?: string;
  readonly state: AgentRunState;
  readonly resultIds: readonly AgentResultId[];
  readonly observedResultIds: readonly AgentResultId[];
  readonly terminal?: AgentRunTerminal;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AgentDispatchIntentRecord {
  readonly dispatchToken: AgentDispatchToken;
  readonly dispatchStartTransactionId: string;
  readonly settlementTransactionId: string;
  readonly agentRunId: AgentRunId;
  readonly idempotency: 'provider-key' | 'none';
  readonly status: 'prepared' | 'dispatching' | 'accepted' | 'rejected' | 'unknown';
  readonly nativeAgentRef?: string;
  readonly rejectionCode?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type AgentTerminalStatus =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'indeterminate';
export type AgentResultStatus = 'partial' | AgentTerminalStatus;

export interface AgentArtifactRef {
  readonly artifactId: string;
  readonly kind: 'file' | 'diff' | 'attachment' | 'provider-native';
  readonly digest?: string;
}

export interface ChangedFileRef {
  readonly fileRef: string;
  readonly change: 'created' | 'modified' | 'deleted' | 'renamed';
}

export interface CitationRef {
  readonly citationId: string;
  readonly sourceRef: string;
}

export interface AgentUsageSummary {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  readonly costMicros?: number;
}

export interface AgentErrorSummary {
  readonly code: string;
  readonly retryable: boolean;
}

export interface AgentResultProvenance {
  readonly kind: 'provider-native' | 'grimoire-managed' | 'reconciled';
  readonly providerId: ProviderId;
  readonly executionSessionId?: ExecutionSessionId;
  readonly executionRunId?: RunId;
  readonly nativeResultRef?: string;
  readonly observedAt: number;
}

export interface AgentResultRecord {
  readonly agentResultId: AgentResultId;
  readonly agentInstanceId: AgentInstanceId;
  readonly agentRunId: AgentRunId;
  readonly status: AgentResultStatus;
  readonly summary?: string;
  readonly finalText?: string;
  readonly partialText?: string;
  readonly artifacts: readonly AgentArtifactRef[];
  readonly changedFiles: readonly ChangedFileRef[];
  readonly citations: readonly CitationRef[];
  readonly childResultIds: readonly AgentResultId[];
  readonly usage?: AgentUsageSummary;
  readonly error?: AgentErrorSummary;
  readonly provenance: AgentResultProvenance;
  readonly completedAt: number;
}

export type AgentDispatchOutcome =
  | {
    readonly kind: 'accepted';
    readonly nativeAgentRef?: string;
    readonly executionSessionId?: ExecutionSessionId;
    readonly executionRunId?: RunId;
  }
  | { readonly kind: 'rejected'; readonly code: string; readonly sideEffectFree: true };

export interface AgentDispatchRequest {
  readonly agentInstanceId: AgentInstanceId;
  readonly agentRunId: AgentRunId;
  readonly dispatchToken: AgentDispatchToken;
  readonly providerId: ProviderId;
  readonly executionMode: AgentExecutionMode;
  readonly goalRef: string;
  readonly policy: EffectiveAgentPolicy;
  readonly idempotency: 'provider-key' | 'none';
}

export interface AgentDispatchPort {
  dispatch(request: AgentDispatchRequest): Promise<AgentDispatchOutcome>;
}

export type AgentDispatchRecoveryEvidence =
  | {
    readonly kind: 'accepted';
    readonly nativeAgentRef?: string;
    readonly executionSessionId?: ExecutionSessionId;
    readonly executionRunId?: RunId;
  }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'unknown'; readonly effectsPossible: boolean };

export interface AgentDispatchRecoveryPort {
  reconcile(intent: AgentDispatchIntentRecord): Promise<AgentDispatchRecoveryEvidence>;
}

export interface AgentRunRecoveryQuery {
  readonly instance: AgentInstanceRecord;
  readonly run: AgentRunRecord;
}

export type AgentRunRecoveryEvidence =
  | { readonly kind: 'running'; readonly nativeAgentRef?: string }
  | {
    readonly kind: 'terminal';
    readonly status: AgentTerminalStatus;
    readonly reason: RunTerminalReason;
  }
  | { readonly kind: 'unknown'; readonly effectsPossible: boolean };

export interface AgentRunRecoveryPort {
  reconcile(query: AgentRunRecoveryQuery): Promise<AgentRunRecoveryEvidence>;
}

export type AgentCancellationEvidence =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'terminal'; readonly status: AgentTerminalStatus }
  | { readonly kind: 'unknown' };

export interface AgentCancellationPort {
  /** Must be idempotent for the same agent attempt. */
  cancel(query: AgentRunRecoveryQuery): Promise<AgentCancellationEvidence>;
}

export interface AgentCancellationRecoveryPort {
  reconcileCancellation(query: AgentRunRecoveryQuery): Promise<AgentCancellationEvidence>;
}

export interface AgentResultLinkRecoveryIssue {
  readonly agentResultId: string;
  readonly code: 'invalid-result-reference' | 'result-link-conflict';
}

export interface AgentResultLinkRecoveryReport {
  readonly linkedRuns: readonly AgentRunRecord[];
  readonly issues: readonly AgentResultLinkRecoveryIssue[];
}
