import type { ExecutionOwner } from '../execution/ExecutionContracts';
import {
  executionSessionId,
  runId,
} from '../execution/ExecutionIds';
import { requireTerminalReason } from '../execution/ExecutionTerminalPolicy';
import type { RecordSchema } from '../persistence/VersionedRecord';
import type {
  AgentArtifactRef,
  AgentDefinitionSnapshot,
  AgentDispatchIntentRecord,
  AgentErrorSummary,
  AgentInstanceRecord,
  AgentPermissionRequest,
  AgentResultProvenance,
  AgentResultRecord,
  AgentRunRecord,
  AgentRunTerminal,
  AgentUsageSummary,
  ChangedFileRef,
  CitationRef,
  EffectiveAgentPolicy,
  PermissionBoundary,
} from './AgentContracts';
import {
  agentDispatchToken,
  agentInstanceId,
  agentResultId,
  agentRunId,
  nativeAgentAdoptionKey,
} from './AgentIds';

const MAX_REFS = 256;
const MAX_SUMMARY_BYTES = 16 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

export const agentInstanceRecordSchema: RecordSchema<AgentInstanceRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'agentInstanceId', 'providerId', 'definition', 'executionMode', 'origin', 'rootOwner',
      'parentAgentInstanceId', 'parentAgentRunId', 'attachment', 'observation',
      'nativeAdoptionKey', 'nativeAgentRef',
      'runIds', 'status', 'createdAt', 'updatedAt',
    ], 'agent instance');
    const id = agentInstanceId(requireString(record.agentInstanceId, 'agent instance id'));
    const providerId = requireIdentifier(record.providerId, 'provider id');
    const definition = decodeDefinition(record.definition);
    const executionMode = oneOf(record.executionMode, ['provider-native', 'grimoire-managed'], 'execution mode');
    const origin = oneOf(record.origin, ['grimoire-dispatched', 'observed-native'], 'agent origin');
    const rootOwner = decodeOwner(record.rootOwner);
    const parentAgentInstanceId = record.parentAgentInstanceId === undefined
      ? undefined
      : agentInstanceId(requireString(record.parentAgentInstanceId, 'parent agent instance id'));
    if (parentAgentInstanceId === id) throw new Error('Agent instance cannot parent itself.');
    const parentAgentRunId = record.parentAgentRunId === undefined
      ? undefined
      : agentRunId(requireString(record.parentAgentRunId, 'parent agent run id'));
    if ((parentAgentInstanceId === undefined) !== (parentAgentRunId === undefined)) {
      throw new Error('Parent agent instance and run identity must be present together.');
    }
    const attachment = oneOf(record.attachment, ['attached', 'detached'], 'attachment policy');
    const observation = oneOf(record.observation, [
      'full', 'aggregate', 'terminal-only', 'opaque', 'none',
    ], 'agent observation');
    const nativeAdoptionKey = record.nativeAdoptionKey === undefined
      ? undefined
      : nativeAgentAdoptionKey(requireString(record.nativeAdoptionKey, 'native adoption key'));
    const nativeAgentRef = optionalIdentifier(record.nativeAgentRef, 'native agent ref');
    if (origin === 'observed-native' && (!nativeAdoptionKey || !nativeAgentRef)) {
      throw new Error('Observed native agent requires adoption key and native identity.');
    }
    if (origin === 'grimoire-dispatched' && nativeAdoptionKey) {
      throw new Error('Grimoire-dispatched agent cannot carry a native adoption key.');
    }
    const runIds = decodeUniqueArray(record.runIds, 'agent run ids', value => (
      agentRunId(requireString(value, 'agent run id'))
    ));
    const status = oneOf(record.status, ['active', 'terminal'], 'agent instance status');
    const createdAt = requireTimestamp(record.createdAt, 'createdAt');
    const updatedAt = requireTimestamp(record.updatedAt, 'updatedAt');
    return {
      agentInstanceId: id,
      providerId,
      definition,
      executionMode,
      origin,
      rootOwner,
      ...(parentAgentInstanceId ? { parentAgentInstanceId } : {}),
      ...(parentAgentRunId ? { parentAgentRunId } : {}),
      attachment,
      observation,
      ...(nativeAdoptionKey ? { nativeAdoptionKey } : {}),
      ...(nativeAgentRef ? { nativeAgentRef } : {}),
      runIds,
      status,
      createdAt,
      updatedAt,
    };
  },
};

export const agentRunRecordSchema: RecordSchema<AgentRunRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'agentRunId', 'agentInstanceId', 'attempt', 'goalRef', 'policy', 'dispatchToken',
      'executionSessionId', 'executionRunId', 'nativeAgentRef', 'state', 'resultIds', 'terminal',
      'terminalTransactionId', 'workGraphRef', 'workGraphExecutionRef', 'workNodeRef',
      'observedResultIds',
      'createdAt', 'updatedAt',
    ], 'agent run');
    const id = agentRunId(requireString(record.agentRunId, 'agent run id'));
    const instanceId = agentInstanceId(requireString(record.agentInstanceId, 'agent instance id'));
    const attempt = requirePositiveInteger(record.attempt, 'agent attempt');
    const goalRef = requireIdentifier(record.goalRef, 'goal ref');
    const policy = decodeEffectivePolicy(record.policy);
    const terminalTransactionId = requireOpaqueTransactionId(record.terminalTransactionId);
    const workGraphRef = optionalOpaqueRef(record.workGraphRef, 'wg', 'work graph ref');
    const workGraphExecutionRef = optionalOpaqueRef(record.workGraphExecutionRef, 'wge', 'work graph execution ref');
    const workNodeRef = optionalOpaqueRef(record.workNodeRef, 'wn', 'work node ref');
    if ([workGraphRef, workGraphExecutionRef, workNodeRef].filter(Boolean).length !== 0
      && [workGraphRef, workGraphExecutionRef, workNodeRef].filter(Boolean).length !== 3) {
      throw new Error('Work graph, execution, and node refs must be present together.');
    }
    const dispatchToken = record.dispatchToken === undefined
      ? undefined
      : agentDispatchToken(requireString(record.dispatchToken, 'dispatch token'));
    const executionSession = record.executionSessionId === undefined
      ? undefined
      : executionSessionId(requireString(record.executionSessionId, 'execution session id'));
    const executionRun = record.executionRunId === undefined
      ? undefined
      : runId(requireString(record.executionRunId, 'execution run id'));
    if (executionRun && !executionSession) {
      throw new Error('Execution run identity requires an execution session identity.');
    }
    const nativeAgentRef = optionalIdentifier(record.nativeAgentRef, 'native agent ref');
    const state = oneOf(record.state, [
      'dispatching', 'running', 'waiting', 'cancelling', 'succeeded', 'failed', 'cancelled',
      'interrupted', 'invalidated', 'indeterminate',
    ], 'agent run state');
    const resultIds = decodeUniqueArray(record.resultIds, 'agent result ids', value => (
      agentResultId(requireString(value, 'agent result id'))
    ));
    const observedResultIds = decodeUniqueArray(
      record.observedResultIds,
      'observed agent result ids',
      value => agentResultId(requireString(value, 'observed agent result id')),
    );
    if (observedResultIds.some(resultId => resultIds.includes(resultId))) {
      throw new Error('Original and observed result ids must be disjoint.');
    }
    const terminal = record.terminal === undefined ? undefined : decodeTerminal(record.terminal);
    const isTerminal = ['succeeded', 'failed', 'cancelled', 'interrupted', 'invalidated', 'indeterminate']
      .includes(state);
    if (isTerminal !== (terminal !== undefined) || (terminal && terminal.kind !== state)) {
      throw new Error('Agent run terminal must match terminal state exactly.');
    }
    if (state === 'dispatching' && !dispatchToken) {
      throw new Error('Dispatching agent run requires a dispatch token.');
    }
    const createdAt = requireTimestamp(record.createdAt, 'createdAt');
    const updatedAt = requireTimestamp(record.updatedAt, 'updatedAt');
    return {
      agentRunId: id,
      agentInstanceId: instanceId,
      attempt,
      goalRef,
      policy,
      terminalTransactionId,
      ...(workGraphRef ? { workGraphRef } : {}),
      ...(workGraphExecutionRef ? { workGraphExecutionRef } : {}),
      ...(workNodeRef ? { workNodeRef } : {}),
      ...(dispatchToken ? { dispatchToken } : {}),
      ...(executionSession ? { executionSessionId: executionSession } : {}),
      ...(executionRun ? { executionRunId: executionRun } : {}),
      ...(nativeAgentRef ? { nativeAgentRef } : {}),
      state,
      resultIds,
      observedResultIds,
      ...(terminal ? { terminal } : {}),
      createdAt,
      updatedAt,
    };
  },
};

export const agentDispatchIntentRecordSchema: RecordSchema<AgentDispatchIntentRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'dispatchToken', 'dispatchStartTransactionId', 'settlementTransactionId', 'agentRunId',
      'idempotency', 'status', 'nativeAgentRef', 'rejectionCode', 'createdAt', 'updatedAt',
    ], 'agent dispatch intent');
    const token = agentDispatchToken(requireString(record.dispatchToken, 'dispatch token'));
    const dispatchStartTransactionId = requireOpaqueTransactionId(record.dispatchStartTransactionId);
    const settlementTransactionId = requireOpaqueTransactionId(record.settlementTransactionId);
    const run = agentRunId(requireString(record.agentRunId, 'agent run id'));
    const idempotency = oneOf(record.idempotency, ['provider-key', 'none'], 'dispatch idempotency');
    const status = oneOf(record.status, [
      'prepared', 'dispatching', 'accepted', 'rejected', 'unknown',
    ], 'dispatch status');
    const nativeAgentRef = optionalIdentifier(record.nativeAgentRef, 'native agent ref');
    const rejectionCode = optionalIdentifier(record.rejectionCode, 'dispatch rejection code');
    if ((status === 'rejected') !== (rejectionCode !== undefined)) {
      throw new Error('Rejected dispatch requires exactly one rejection code.');
    }
    if (status !== 'accepted' && nativeAgentRef) {
      throw new Error('Only accepted dispatch may carry native agent identity.');
    }
    const createdAt = requireTimestamp(record.createdAt, 'createdAt');
    const updatedAt = requireTimestamp(record.updatedAt, 'updatedAt');
    return {
      dispatchToken: token,
      dispatchStartTransactionId,
      settlementTransactionId,
      agentRunId: run,
      idempotency,
      status,
      ...(nativeAgentRef ? { nativeAgentRef } : {}),
      ...(rejectionCode ? { rejectionCode } : {}),
      createdAt,
      updatedAt,
    };
  },
};

export const agentResultRecordSchema: RecordSchema<AgentResultRecord> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'agentResultId', 'agentInstanceId', 'agentRunId', 'status', 'summary', 'finalText',
      'partialText', 'artifacts', 'changedFiles', 'citations', 'childResultIds', 'usage', 'error',
      'provenance', 'completedAt',
    ], 'agent result');
    const id = agentResultId(requireString(record.agentResultId, 'agent result id'));
    const instanceId = agentInstanceId(requireString(record.agentInstanceId, 'agent instance id'));
    const run = agentRunId(requireString(record.agentRunId, 'agent run id'));
    const status = oneOf(record.status, [
      'partial', 'succeeded', 'failed', 'cancelled', 'interrupted', 'indeterminate',
    ], 'agent result status');
    const summary = optionalBoundedText(record.summary, MAX_SUMMARY_BYTES, 'summary');
    const finalText = optionalBoundedText(record.finalText, MAX_TEXT_BYTES, 'finalText');
    const partialText = optionalBoundedText(record.partialText, MAX_TEXT_BYTES, 'partialText');
    if (status === 'partial' && partialText === undefined) {
      throw new Error('Partial agent result requires partialText.');
    }
    const artifacts = decodeUniqueArray(record.artifacts, 'artifacts', decodeArtifact, item => item.artifactId);
    const changedFiles = decodeUniqueArray(record.changedFiles, 'changed files', decodeChangedFile, item => item.fileRef);
    const citations = decodeUniqueArray(record.citations, 'citations', decodeCitation, item => item.citationId);
    const childResultIds = decodeUniqueArray(record.childResultIds, 'child result ids', value => (
      agentResultId(requireString(value, 'child result id'))
    ));
    if (childResultIds.includes(id)) {
      throw new Error('Agent result cannot reference itself as a child result.');
    }
    const usage = record.usage === undefined ? undefined : decodeUsage(record.usage);
    const error = record.error === undefined ? undefined : decodeError(record.error);
    const provenance = decodeProvenance(record.provenance);
    const completedAt = requireTimestamp(record.completedAt, 'completedAt');
    return {
      agentResultId: id,
      agentInstanceId: instanceId,
      agentRunId: run,
      status,
      ...(summary !== undefined ? { summary } : {}),
      ...(finalText !== undefined ? { finalText } : {}),
      ...(partialText !== undefined ? { partialText } : {}),
      artifacts,
      changedFiles,
      citations,
      childResultIds,
      ...(usage ? { usage } : {}),
      ...(error ? { error } : {}),
      provenance,
      completedAt,
    };
  },
};

export function decodePermissionBoundary(value: unknown): PermissionBoundary {
  const record = exactRecord(value, ['granted', 'approvable'], 'permission boundary');
  const granted = decodePermissions(record.granted, 'granted permissions');
  const approvable = decodePermissions(record.approvable, 'approvable permissions');
  ensureDisjoint(granted, approvable, 'Permission boundary');
  return { granted, approvable };
}

export function decodePermissionRequest(value: unknown): AgentPermissionRequest {
  const record = exactRecord(value, ['requested', 'approvable'], 'permission request');
  const requested = decodePermissions(record.requested, 'requested permissions');
  const approvable = decodePermissions(record.approvable, 'definition approvable permissions');
  if (approvable.some(permission => !requested.includes(permission))) {
    throw new Error('Definition approvable permissions must be requested.');
  }
  return { requested, approvable };
}

function decodeDefinition(value: unknown): AgentDefinitionSnapshot {
  const record = exactRecord(value, ['definitionId', 'revisionDigest', 'source'], 'definition snapshot');
  const definitionId = requireIdentifier(record.definitionId, 'definition id');
  const revisionDigest = requireDigest(record.revisionDigest, 'definition revision digest');
  const source = oneOf(record.source, ['provider-native', 'provider-files', 'grimoire'], 'definition source');
  return { definitionId, revisionDigest, source };
}

function decodeEffectivePolicy(value: unknown): EffectiveAgentPolicy {
  const record = exactRecord(value, ['granted', 'approvable', 'denied'], 'effective agent policy');
  const granted = decodePermissions(record.granted, 'granted permissions');
  const approvable = decodePermissions(record.approvable, 'approvable permissions');
  const denied = decodePermissions(record.denied, 'denied permissions');
  ensureDisjoint(granted, approvable, 'Effective policy');
  ensureDisjoint([...granted, ...approvable], denied, 'Effective policy');
  return { granted, approvable, denied };
}

function decodeOwner(value: unknown): ExecutionOwner {
  const record = exactRecord(value, ['kind', 'ownerId'], 'agent root owner');
  const kind = oneOf(record.kind, ['conversation', 'work-graph'], 'agent root owner kind');
  return { kind, ownerId: requireIdentifier(record.ownerId, 'agent root owner id') };
}

function decodeTerminal(value: unknown): AgentRunTerminal {
  const record = exactRecord(value, ['kind', 'reason', 'occurredAt'], 'agent run terminal');
  const kind = oneOf(record.kind, [
    'succeeded', 'failed', 'cancelled', 'interrupted', 'indeterminate',
    'invalidated',
  ], 'agent terminal kind');
  const reason = oneOf(record.reason, [
    'completed', 'provider-failure', 'missing-required-result', 'cancellation-confirmed',
    'pre-dispatch-rejected', 'side-effect-free-rejection', 'spawn-failed', 'nonzero-exit',
    'timeout', 'output-limit', 'known-process-exit', 'recovery-exhausted-safe',
    'dispatch-unknown', 'cancellation-unknown', 'effects-unknown', 'shutdown-unknown',
  ], 'agent terminal reason');
  requireTerminalReason(kind, reason);
  return { kind, reason, occurredAt: requireTimestamp(record.occurredAt, 'terminal occurredAt') };
}

function decodeArtifact(value: unknown): AgentArtifactRef {
  const record = exactRecord(value, ['artifactId', 'kind', 'digest'], 'artifact ref');
  const artifactId = requireIdentifier(record.artifactId, 'artifact id');
  const kind = oneOf(record.kind, ['file', 'diff', 'attachment', 'provider-native'], 'artifact kind');
  const digest = record.digest === undefined ? undefined : requireDigest(record.digest, 'artifact digest');
  return { artifactId, kind, ...(digest ? { digest } : {}) };
}

function decodeChangedFile(value: unknown): ChangedFileRef {
  const record = exactRecord(value, ['fileRef', 'change'], 'changed file ref');
  return {
    fileRef: requireBoundedString(record.fileRef, 4096, 'file ref'),
    change: oneOf(record.change, ['created', 'modified', 'deleted', 'renamed'], 'file change'),
  };
}

function decodeCitation(value: unknown): CitationRef {
  const record = exactRecord(value, ['citationId', 'sourceRef'], 'citation ref');
  return {
    citationId: requireIdentifier(record.citationId, 'citation id'),
    sourceRef: requireBoundedString(record.sourceRef, 8192, 'citation source ref'),
  };
}

function decodeUsage(value: unknown): AgentUsageSummary {
  const record = exactRecord(value, ['inputTokens', 'outputTokens', 'cachedTokens', 'costMicros'], 'usage summary');
  const entries = Object.entries(record).flatMap(([key, raw]) => (
    raw === undefined ? [] : [[key, requireNonNegativeInteger(raw, key)] as const]
  ));
  return Object.fromEntries(entries);
}

function decodeError(value: unknown): AgentErrorSummary {
  const record = exactRecord(value, ['code', 'retryable'], 'agent error summary');
  if (typeof record.retryable !== 'boolean') throw new Error('Agent error retryable must be boolean.');
  return { code: requireIdentifier(record.code, 'agent error code'), retryable: record.retryable };
}

function decodeProvenance(value: unknown): AgentResultProvenance {
  const record = exactRecord(value, [
    'kind', 'providerId', 'executionSessionId', 'executionRunId', 'nativeResultRef', 'observedAt',
  ], 'agent result provenance');
  const kind = oneOf(record.kind, ['provider-native', 'grimoire-managed', 'reconciled'], 'result provenance kind');
  const providerId = requireIdentifier(record.providerId, 'provider id');
  const executionSession = record.executionSessionId === undefined
    ? undefined
    : executionSessionId(requireString(record.executionSessionId, 'execution session id'));
  const executionRun = record.executionRunId === undefined
    ? undefined
    : runId(requireString(record.executionRunId, 'execution run id'));
  if ((executionSession === undefined) !== (executionRun === undefined)) {
    throw new Error('Result execution session and run identity must be present together.');
  }
  const nativeResultRef = optionalIdentifier(record.nativeResultRef, 'native result ref');
  return {
    kind,
    providerId,
    ...(executionSession ? { executionSessionId: executionSession } : {}),
    ...(executionRun ? { executionRunId: executionRun } : {}),
    ...(nativeResultRef ? { nativeResultRef } : {}),
    observedAt: requireTimestamp(record.observedAt, 'result observedAt'),
  };
}

function decodePermissions(value: unknown, label: string): string[] {
  return decodeUniqueArray(value, label, entry => {
    const permission = requireString(entry, label);
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(permission)) {
      throw new Error(`${label} contains an invalid permission.`);
    }
    return permission;
  }).sort();
}

function decodeUniqueArray<T>(
  value: unknown,
  label: string,
  decode: (entry: unknown) => T,
  identity: (entry: T) => unknown = entry => entry,
): T[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) {
    throw new Error(`${label} must be an array with at most ${MAX_REFS} entries.`);
  }
  const result = value.map(decode);
  if (new Set(result.map(identity)).size !== result.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return result;
}

function exactRecord(value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> {
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a constrained identifier.`);
  }
  return value;
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireIdentifier(value, label);
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be canonical SHA-256.`);
  }
  return value;
}

function requireOpaqueTransactionId(value: unknown): string {
  if (typeof value !== 'string' || !/^tx-[0-9a-f]{32}$/.test(value)) {
    throw new Error('Settlement transaction id must be an opaque tx identifier.');
  }
  return value;
}

function optionalOpaqueRef(value: unknown, prefix: string, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[0-9a-f]{32}$`).test(value)) {
    throw new Error(`${label} must be an opaque identifier.`);
  }
  return value;
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative timestamp.`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function optionalBoundedText(value: unknown, maxBytes: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireBoundedString(value, maxBytes, label);
}

function requireBoundedString(value: unknown, maxBytes: number, label: string): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error(`${label} must be a string no larger than ${maxBytes} UTF-8 bytes.`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function ensureDisjoint(left: readonly string[], right: readonly string[], label: string): void {
  const leftSet = new Set(left);
  if (right.some(entry => leftSet.has(entry))) {
    throw new Error(`${label} permission sets must be disjoint.`);
  }
}
