import type { RecordSchema } from '../persistence/VersionedRecord';
import type {
  ExecutionOwner,
  ResultRef,
  RunState,
  RunTerminal,
  RunTerminalKind,
  RunTerminalReason,
} from './ExecutionContracts';
import type {
  ExecutionInteractionRecord,
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
  ExecutionSessionRecord,
  ReconciliationEvidenceRecord,
  SettingsTransitionRecord,
  ShutdownCheckpointRecord,
} from './ExecutionControlRecords';
import { requireTerminalReason } from './ExecutionTerminalPolicy';

/** Mirrors `ExecutionOwnerKind`; `work-graph` is excluded per harvest ban 2. */
const OWNER_KINDS = new Set([
  'conversation',
  'agent-instance',
  'auxiliary-operation',
  'internal-service',
]);
const RUN_STATES = new Set([
  'queued',
  'preparing',
  'running',
  'waiting-interaction',
  'waiting-children',
  'cancelling',
  'disconnected',
  'recovering',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'invalidated',
  'indeterminate',
]);
const TERMINAL_KINDS = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'invalidated',
  'indeterminate',
]);
const TERMINAL_REASONS = new Set([
  'completed',
  'provider-failure',
  'missing-required-result',
  'cancellation-confirmed',
  'pre-dispatch-rejected',
  'side-effect-free-rejection',
  'spawn-failed',
  'nonzero-exit',
  'timeout',
  'output-limit',
  'known-process-exit',
  'recovery-exhausted-safe',
  'dispatch-unknown',
  'cancellation-unknown',
  'effects-unknown',
  'shutdown-unknown',
]);

export const executionSessionRecordSchema: RecordSchema<ExecutionSessionRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'executionSessionId',
      'sessionInstanceId',
      'backendId',
      'backendGeneration',
      'owner',
      'status',
      'runIds',
      'lastSequence',
      'acceptedEventIds',
      'nativeSessionRef',
      'createdAt',
      'updatedAt',
    ], 'execution session');
    requireOpaque(record.executionSessionId, 'es', 'execution session id');
    requireOpaque(record.sessionInstanceId, 'si', 'session instance id');
    requireIdentifier(record.backendId, 'backend id');
    requireNonNegativeInteger(record.backendGeneration, 'backend generation');
    const owner = decodeOwner(record.owner);
    if (!isOneOf(record.status, ['active', 'disconnected', 'recovering', 'disposed'])) {
      throw new Error('Execution session status is invalid.');
    }
    const runIds = decodeOpaqueIdArray(record.runIds, 'run', 'run ids');
    requireNonNegativeInteger(record.lastSequence, 'last sequence');
    const acceptedEventIds = decodeIdentifierArray(record.acceptedEventIds, 'accepted event ids');
    if (acceptedEventIds.length > 256) {
      throw new Error('Execution session may retain at most 256 event ids.');
    }
    const nativeSessionRef = optionalIdentifier(record.nativeSessionRef, 'native session ref');
    requireTimestamp(record.createdAt, 'createdAt');
    requireTimestamp(record.updatedAt, 'updatedAt');
    return {
      executionSessionId: record.executionSessionId,
      sessionInstanceId: record.sessionInstanceId,
      backendId: record.backendId,
      backendGeneration: record.backendGeneration,
      owner,
      status: record.status,
      runIds,
      lastSequence: record.lastSequence,
      acceptedEventIds,
      ...(nativeSessionRef ? { nativeSessionRef } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },
};

export const executionRunRecordSchema: RecordSchema<ExecutionRunRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'runId',
      'executionSessionId',
      'owner',
      'resultExpectation',
      'state',
      'dispatchState',
      'cancellationRequested',
      'resultRef',
      'terminal',
      'openInteractionIds',
      'lastSequence',
      'createdAt',
      'updatedAt',
    ], 'execution run');
    requireOpaque(record.runId, 'run', 'run id');
    requireOpaque(record.executionSessionId, 'es', 'execution session id');
    const owner = decodeOwner(record.owner);
    if (!isOneOf(record.resultExpectation, ['required', 'optional', 'none'])) {
      throw new Error('Run result expectation is invalid.');
    }
    if (typeof record.state !== 'string' || !RUN_STATES.has(record.state)) {
      throw new Error('Run state is invalid.');
    }
    if (!isOneOf(record.dispatchState, ['pending', 'accepted', 'rejected', 'unknown'])) {
      throw new Error('Run dispatch state is invalid.');
    }
    if (typeof record.cancellationRequested !== 'boolean') {
      throw new Error('Run cancellationRequested must be boolean.');
    }
    const resultRef = record.resultRef === undefined
      ? undefined
      : decodeResultRef(record.resultRef);
    const terminal = record.terminal === undefined
      ? undefined
      : decodeTerminal(record.terminal);
    const terminalState = TERMINAL_KINDS.has(record.state);
    if (terminalState !== (terminal !== undefined) || (terminal && terminal.kind !== record.state)) {
      throw new Error('Run terminal must match terminal state exactly.');
    }
    const openInteractionIds = decodeOpaqueIdArray(
      record.openInteractionIds,
      'ix',
      'interaction ids',
    );
    requireNonNegativeInteger(record.lastSequence, 'last sequence');
    requireTimestamp(record.createdAt, 'createdAt');
    requireTimestamp(record.updatedAt, 'updatedAt');
    return {
      runId: record.runId,
      executionSessionId: record.executionSessionId,
      owner,
      resultExpectation: record.resultExpectation,
      state: record.state as RunState,
      dispatchState: record.dispatchState,
      cancellationRequested: record.cancellationRequested,
      ...(resultRef ? { resultRef } : {}),
      ...(terminal ? { terminal } : {}),
      openInteractionIds,
      lastSequence: record.lastSequence,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },
};

export const executionInteractionRecordSchema: RecordSchema<ExecutionInteractionRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'interactionId',
      'runId',
      'kind',
      'presentationRef',
      'responseIds',
      'status',
      'selectedResponseId',
      'expiresAt',
      'createdAt',
      'updatedAt',
    ], 'execution interaction');
    requireOpaque(record.interactionId, 'ix', 'interaction id');
    requireOpaque(record.runId, 'run', 'run id');
    if (!isOneOf(record.kind, ['approval', 'question', 'plan-decision'])) {
      throw new Error('Interaction kind is invalid.');
    }
    requireIdentifier(record.presentationRef, 'interaction presentation ref');
    const responseIds = decodeIdentifierArray(record.responseIds, 'response ids');
    if (responseIds.length === 0) {
      throw new Error('Interaction must declare at least one response id.');
    }
    if (!isOneOf(record.status, [
      'open',
      'resolving',
      'cancelling',
      'resolved',
      'cancelled',
      'expired',
    ])) {
      throw new Error('Interaction status is invalid.');
    }
    const selectedResponseId = optionalIdentifier(record.selectedResponseId, 'selected response id');
    const requiresSelection = record.status === 'resolving' || record.status === 'resolved';
    const forbidsSelection = record.status === 'open' || record.status === 'expired';
    if ((requiresSelection && selectedResponseId === undefined)
      || (forbidsSelection && selectedResponseId !== undefined)
      || (selectedResponseId && !responseIds.includes(selectedResponseId))) {
      throw new Error('Resolving or resolved interaction must select a declared response id.');
    }
    if (record.expiresAt !== undefined) {
      requireTimestamp(record.expiresAt, 'expiresAt');
    }
    requireTimestamp(record.createdAt, 'createdAt');
    requireTimestamp(record.updatedAt, 'updatedAt');
    return {
      interactionId: record.interactionId,
      runId: record.runId,
      kind: record.kind,
      presentationRef: record.presentationRef,
      responseIds,
      status: record.status,
      ...(selectedResponseId ? { selectedResponseId } : {}),
      ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },
};

export const executionReconciliationRecordSchema: RecordSchema<ExecutionReconciliationRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'reconciliationId',
      'runId',
      'originalTerminal',
      'observedOutcome',
      'observedResult',
      'evidence',
      'recordedAt',
    ], 'execution reconciliation');
    requireOpaque(record.reconciliationId, 'rec', 'reconciliation id');
    requireOpaque(record.runId, 'run', 'run id');
    if (record.originalTerminal !== 'indeterminate') {
      throw new Error('Reconciliation original terminal must be indeterminate.');
    }
    if (!isOneOf(record.observedOutcome, [
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ])) {
      throw new Error('Reconciliation observed outcome is invalid.');
    }
    const observedResult = record.observedResult === undefined
      ? undefined
      : decodeResultRef(record.observedResult);
    const evidence = decodeEvidence(record.evidence);
    requireTimestamp(record.recordedAt, 'recordedAt');
    return {
      reconciliationId: record.reconciliationId,
      runId: record.runId,
      originalTerminal: 'indeterminate',
      observedOutcome: record.observedOutcome,
      ...(observedResult ? { observedResult } : {}),
      evidence,
      recordedAt: record.recordedAt,
    };
  },
};

export const settingsTransitionRecordSchema: RecordSchema<SettingsTransitionRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'transitionId',
      'backendId',
      'fromGeneration',
      'toGeneration',
      'status',
      'settingsFingerprint',
      'createdAt',
      'updatedAt',
    ], 'settings transition');
    requireOpaque(record.transitionId, 'st', 'settings transition id');
    requireIdentifier(record.backendId, 'backend id');
    requireNonNegativeInteger(record.fromGeneration, 'from generation');
    requireNonNegativeInteger(record.toGeneration, 'to generation');
    if (record.toGeneration !== record.fromGeneration + 1) {
      throw new Error('Settings transition generation must advance by one.');
    }
    if (!isOneOf(record.status, [
      'draining',
      'quiescent',
      'applying',
      'completed',
      'restart-required',
    ])) {
      throw new Error('Settings transition status is invalid.');
    }
    if (typeof record.settingsFingerprint !== 'string'
      || !/^[0-9a-f]{64}$/.test(record.settingsFingerprint)) {
      throw new Error('Settings fingerprint must be canonical SHA-256.');
    }
    requireTimestamp(record.createdAt, 'createdAt');
    requireTimestamp(record.updatedAt, 'updatedAt');
    return {
      transitionId: record.transitionId,
      backendId: record.backendId,
      fromGeneration: record.fromGeneration,
      toGeneration: record.toGeneration,
      status: record.status,
      settingsFingerprint: record.settingsFingerprint,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },
};

export const shutdownCheckpointRecordSchema: RecordSchema<ShutdownCheckpointRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'checkpointId',
      'status',
      'sessionIds',
      'runIds',
      'unresolvedRunIds',
      'startedAt',
      'completedAt',
    ], 'shutdown checkpoint');
    requireOpaque(record.checkpointId, 'sd', 'shutdown checkpoint id');
    if (!isOneOf(record.status, ['started', 'completed'])) {
      throw new Error('Shutdown checkpoint status is invalid.');
    }
    const sessionIds = decodeOpaqueIdArray(record.sessionIds, 'es', 'session ids');
    const runIds = decodeOpaqueIdArray(record.runIds, 'run', 'run ids');
    const unresolvedRunIds = decodeOpaqueIdArray(
      record.unresolvedRunIds,
      'run',
      'unresolved run ids',
    );
    if (unresolvedRunIds.some(runId => !runIds.includes(runId))) {
      throw new Error('Unresolved shutdown run must be included in runIds.');
    }
    requireTimestamp(record.startedAt, 'startedAt');
    if (record.completedAt !== undefined) {
      requireTimestamp(record.completedAt, 'completedAt');
    }
    if ((record.status === 'completed') !== (record.completedAt !== undefined)) {
      throw new Error('Completed shutdown checkpoint requires completedAt.');
    }
    return {
      checkpointId: record.checkpointId,
      status: record.status,
      sessionIds,
      runIds,
      unresolvedRunIds,
      startedAt: record.startedAt,
      ...(record.completedAt !== undefined ? { completedAt: record.completedAt } : {}),
    };
  },
};

function decodeOwner(value: unknown): ExecutionOwner {
  const record = exactRecord(value, ['kind', 'ownerId'], 'execution owner');
  if (typeof record.kind !== 'string' || !OWNER_KINDS.has(record.kind)) {
    throw new Error('Execution owner kind is invalid.');
  }
  requireIdentifier(record.ownerId, 'owner id');
  return { kind: record.kind as ExecutionOwner['kind'], ownerId: record.ownerId };
}

function decodeResultRef(value: unknown): ResultRef {
  const record = exactRecord(value, ['resultId', 'storage', 'digest'], 'result ref');
  requireIdentifier(record.resultId, 'result id');
  if (!isOneOf(record.storage, ['projection', 'artifact', 'provider-native'])) {
    throw new Error('Result storage kind is invalid.');
  }
  if (record.digest !== undefined
    && (typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.digest))) {
    throw new Error('Result digest must be canonical SHA-256.');
  }
  return {
    resultId: record.resultId,
    storage: record.storage,
    ...(typeof record.digest === 'string' ? { digest: record.digest } : {}),
  };
}

function decodeTerminal(value: unknown): RunTerminal {
  const record = exactRecord(value, ['kind', 'reason', 'occurredAt', 'resultRef'], 'run terminal');
  if (typeof record.kind !== 'string' || !TERMINAL_KINDS.has(record.kind)) {
    throw new Error('Run terminal kind is invalid.');
  }
  if (typeof record.reason !== 'string' || !TERMINAL_REASONS.has(record.reason)) {
    throw new Error('Run terminal reason is invalid.');
  }
  requireTerminalReason(
    record.kind as RunTerminalKind,
    record.reason as RunTerminalReason,
  );
  requireTimestamp(record.occurredAt, 'terminal occurredAt');
  const resultRef = record.resultRef === undefined
    ? undefined
    : decodeResultRef(record.resultRef);
  return {
    kind: record.kind as RunTerminalKind,
    reason: record.reason as RunTerminalReason,
    occurredAt: record.occurredAt,
    ...(resultRef ? { resultRef } : {}),
  };
}

function decodeEvidence(value: unknown): ReconciliationEvidenceRecord {
  const record = exactRecord(value, ['kind', 'evidenceRef'], 'reconciliation evidence');
  if (!isOneOf(record.kind, [
    'status-query',
    'native-history',
    'session-snapshot',
    'operator',
  ])) {
    throw new Error('Reconciliation evidence kind is invalid.');
  }
  requireIdentifier(record.evidenceRef, 'evidence ref');
  return { kind: record.kind, evidenceRef: record.evidenceRef };
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some(key => !allowed.has(key))) {
    throw new Error(`${label} contains unknown fields.`);
  }
  return record;
}

function decodeOpaqueIdArray(value: unknown, prefix: string, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const result = value.map(entry => {
    requireOpaque(entry, prefix, label);
    return entry;
  });
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return result;
}

function decodeIdentifierArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const result = value.map(entry => {
    requireIdentifier(entry, label);
    return entry;
  });
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return result;
}

function requireOpaque(
  value: unknown,
  prefix: string,
  label: string,
): asserts value is string {
  if (typeof value !== 'string'
    || !new RegExp(`^${prefix}-[0-9a-f]{32}$`).test(value)) {
    throw new Error(`${label} must be an opaque identifier.`);
  }
}

function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a constrained identifier.`);
  }
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  requireIdentifier(value, label);
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function requireTimestamp(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative timestamp.`);
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}
