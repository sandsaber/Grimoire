import { agentInstanceId, agentResultId, agentRunId } from '../agents/AgentIds';
import type { ExecutionOwner } from '../execution/ExecutionContracts';
import type { RecordSchema } from '../persistence/VersionedRecord';
import type {
  WorkGraphExecution,
  WorkGraphRevision,
  WorkNode,
  WorkNodeAssignment,
  WorkNodeExecutionState,
} from './WorkGraph';
import { validateWorkGraph } from './WorkGraph';
import {
  workGraphExecutionId,
  workGraphId,
  workGraphRevisionId,
  workNodeId,
} from './WorkIds';

const MAX_NODES = 512;

export const workGraphRevisionSchema: RecordSchema<WorkGraphRevision> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'workGraphRevisionId', 'workGraphId', 'revision', 'previousRevisionId', 'owner', 'nodes',
      'maxParallel', 'failurePolicy', 'synthesisPolicy', 'synthesisNodeId', 'createdAt',
    ], 'work graph revision');
    const revisionRecord: WorkGraphRevision = {
      workGraphRevisionId: workGraphRevisionId(requireString(record.workGraphRevisionId, 'work graph revision id')),
      workGraphId: workGraphId(requireString(record.workGraphId, 'work graph id')),
      revision: requirePositiveInteger(record.revision, 'graph revision'),
      ...(record.previousRevisionId === undefined ? {} : {
        previousRevisionId: workGraphRevisionId(requireString(record.previousRevisionId, 'previous graph revision id')),
      }),
      owner: decodeOwner(record.owner),
      nodes: decodeArray(record.nodes, 'work graph nodes', decodeNode),
      maxParallel: requirePositiveInteger(record.maxParallel, 'maxParallel'),
      failurePolicy: oneOf(record.failurePolicy, ['fail-fast', 'continue-independent'], 'failure policy'),
      synthesisPolicy: oneOf(record.synthesisPolicy, ['require-all', 'allow-partial'], 'synthesis policy'),
      ...(record.synthesisNodeId === undefined ? {} : {
        synthesisNodeId: workNodeId(requireString(record.synthesisNodeId, 'synthesis node id')),
      }),
      createdAt: requireTimestamp(record.createdAt, 'createdAt'),
    };
    if ((revisionRecord.revision === 1) !== (revisionRecord.previousRevisionId === undefined)) {
      throw new Error('Only the first graph revision omits previousRevisionId.');
    }
    validateWorkGraph(revisionRecord);
    return revisionRecord;
  },
};

export const workGraphExecutionSchema: RecordSchema<WorkGraphExecution> = {
  currentVersion: 1,
  decode(payload) {
    const record = exactRecord(payload, [
      'workGraphExecutionId', 'workGraphId', 'workGraphRevisionId', 'graphRevision', 'status',
      'nodeStates', 'createdAt', 'updatedAt',
    ], 'work graph execution');
    const nodeStates = decodeArray(record.nodeStates, 'work node states', decodeNodeState);
    if (new Set(nodeStates.map(state => state.workNodeId)).size !== nodeStates.length) {
      throw new Error('Work graph execution contains duplicate node states.');
    }
    return {
      workGraphExecutionId: workGraphExecutionId(requireString(record.workGraphExecutionId, 'work graph execution id')),
      workGraphId: workGraphId(requireString(record.workGraphId, 'work graph id')),
      workGraphRevisionId: workGraphRevisionId(requireString(record.workGraphRevisionId, 'work graph revision id')),
      graphRevision: requirePositiveInteger(record.graphRevision, 'graph revision'),
      status: oneOf(record.status, ['active', 'succeeded', 'failed', 'cancelled', 'indeterminate'], 'graph status'),
      nodeStates,
      createdAt: requireTimestamp(record.createdAt, 'createdAt'),
      updatedAt: requireTimestamp(record.updatedAt, 'updatedAt'),
    };
  },
};

function decodeNode(value: unknown): WorkNode {
  const record = exactRecord(value, [
    'workNodeId', 'kind', 'goalRef', 'dependencyNodeIds', 'assignment',
    'synthesisInputResultIds',
  ], 'work node');
  return {
    workNodeId: workNodeId(requireString(record.workNodeId, 'work node id')),
    kind: oneOf(record.kind, ['agent', 'synthesis'], 'work node kind'),
    goalRef: requireIdentifier(record.goalRef, 'goal ref'),
    dependencyNodeIds: decodeArray(record.dependencyNodeIds, 'dependency node ids', entry => (
      workNodeId(requireString(entry, 'dependency node id'))
    )),
    assignment: decodeAssignment(record.assignment),
    synthesisInputResultIds: decodeArray(record.synthesisInputResultIds, 'synthesis input result ids', entry => (
      agentResultId(requireString(entry, 'synthesis input result id'))
    )),
  };
}

function decodeAssignment(value: unknown): WorkNodeAssignment {
  const record = value as Record<string, unknown> | null;
  if (record?.kind === 'agent-instance') {
    const exact = exactRecord(value, ['kind', 'agentInstanceId'], 'agent assignment');
    return {
      kind: 'agent-instance',
      agentInstanceId: agentInstanceId(requireString(exact.agentInstanceId, 'assigned agent instance id')),
    };
  }
  const exact = exactRecord(value, ['kind', 'providerId'], 'managed provider assignment');
  if (exact.kind !== 'managed-provider') throw new Error('Work node assignment kind is invalid.');
  return {
    kind: 'managed-provider',
    providerId: requireIdentifier(exact.providerId, 'assigned provider id'),
  };
}

function decodeNodeState(value: unknown): WorkNodeExecutionState {
  const record = exactRecord(value, [
    'workNodeId', 'state', 'attempt', 'agentRunId', 'resultIds', 'terminalCode', 'updatedAt',
  ], 'work node state');
  const state = oneOf(record.state, [
    'pending', 'preparing', 'running', 'succeeded', 'failed', 'cancelled', 'blocked',
    'indeterminate',
  ], 'work node state');
  const terminalCode = optionalIdentifier(record.terminalCode, 'node terminal code');
  if (['pending', 'preparing', 'running'].includes(state) && terminalCode) {
    throw new Error('Nonterminal work node cannot carry a terminal code.');
  }
  const agentRun = record.agentRunId === undefined
    ? undefined
    : agentRunId(requireString(record.agentRunId, 'agent run id'));
  const attempt = requireNonNegativeInteger(record.attempt, 'node attempt');
  if ((state === 'preparing' || state === 'running') && (!agentRun || attempt < 1)) {
    throw new Error('Prepared or running work node requires an agent run attempt.');
  }
  if (state === 'pending' && (agentRun || attempt !== 0)) {
    throw new Error('Pending work node cannot carry an agent run attempt.');
  }
  return {
    workNodeId: workNodeId(requireString(record.workNodeId, 'work node id')),
    state,
    attempt,
    ...(agentRun ? { agentRunId: agentRun } : {}),
    resultIds: decodeArray(record.resultIds, 'node result ids', entry => (
      agentResultId(requireString(entry, 'node result id'))
    )),
    ...(terminalCode ? { terminalCode } : {}),
    updatedAt: requireTimestamp(record.updatedAt, 'updatedAt'),
  };
}

function decodeOwner(value: unknown): ExecutionOwner {
  const record = exactRecord(value, ['kind', 'ownerId'], 'work graph owner');
  const kind = oneOf(record.kind, ['conversation', 'work-graph'], 'work graph owner kind');
  return { kind, ownerId: requireIdentifier(record.ownerId, 'work graph owner id') };
}

function decodeArray<T>(value: unknown, label: string, decode: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > MAX_NODES) {
    throw new Error(`${label} must be an array with at most ${MAX_NODES} entries.`);
  }
  return value.map(decode);
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

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be positive.`);
  return value as number;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be non-negative.`);
  return value as number;
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative timestamp.`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${label} is invalid.`);
  return value;
}
