import type {
  ExecutionOwner,
  ResultExpectation,
  ResultRef,
  RunState,
  RunTerminal,
  RunTerminalKind,
} from './ExecutionContracts';

export interface ExecutionSessionRecord {
  executionSessionId: string;
  sessionInstanceId: string;
  backendId: string;
  backendGeneration: number;
  owner: ExecutionOwner;
  status: 'active' | 'disconnected' | 'recovering' | 'disposed';
  runIds: string[];
  lastSequence: number;
  acceptedEventIds: string[];
  nativeSessionRef?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionRunRecord {
  runId: string;
  executionSessionId: string;
  owner: ExecutionOwner;
  resultExpectation: ResultExpectation;
  state: RunState;
  dispatchState: 'pending' | 'accepted' | 'rejected' | 'unknown';
  cancellationRequested: boolean;
  resultRef?: ResultRef;
  nativeRunRef?: string;
  terminal?: RunTerminal;
  openInteractionIds: string[];
  lastSequence: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionInteractionRecord {
  interactionId: string;
  runId: string;
  kind: 'approval' | 'question' | 'plan-decision';
  presentationRef: string;
  responseIds: string[];
  status: 'open' | 'resolving' | 'cancelling' | 'resolved' | 'cancelled' | 'expired';
  selectedResponseId?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReconciliationEvidenceRecord {
  kind: 'status-query' | 'native-history' | 'session-snapshot' | 'operator';
  evidenceRef: string;
}

export interface ExecutionReconciliationRecord {
  reconciliationId: string;
  runId: string;
  originalTerminal: 'indeterminate';
  observedOutcome: Exclude<RunTerminalKind, 'indeterminate' | 'invalidated'>;
  observedResult?: ResultRef;
  evidence: ReconciliationEvidenceRecord;
  recordedAt: number;
}

export interface SettingsTransitionRecord {
  transitionId: string;
  backendId: string;
  fromGeneration: number;
  toGeneration: number;
  status: 'draining' | 'quiescent' | 'applying' | 'completed' | 'restart-required';
  settingsFingerprint: string;
  createdAt: number;
  updatedAt: number;
}

export interface ShutdownCheckpointRecord {
  checkpointId: string;
  status: 'started' | 'completed';
  sessionIds: string[];
  runIds: string[];
  unresolvedRunIds: string[];
  startedAt: number;
  completedAt?: number;
}
