import {
  WORK_GRAPH_EXECUTIONS_PATH,
  WORK_GRAPH_HEADS_PATH,
  WORK_GRAPH_REVISIONS_PATH,
} from '../bootstrap/StoragePaths';
import { validateControlRecordPayload } from '../persistence/ControlRecordPayloadPolicy';
import type { DurableStorage } from '../persistence/DurableStorage';
import type { VersionedRecord, VersionedRecordReadResult } from '../persistence/VersionedRecord';
import { RevisionConflictError, VersionedRepository } from '../persistence/VersionedRepository';
import type { WorkGraphExecution, WorkGraphRevision } from './WorkGraph';
import { workGraphExecutionSchema, workGraphRevisionSchema } from './WorkGraphSchemas';
import { workGraphId, workGraphRevisionId } from './WorkIds';

interface WorkGraphHead {
  readonly workGraphId: WorkGraphRevision['workGraphId'];
  readonly latestRevisionId: WorkGraphRevision['workGraphRevisionId'];
  readonly latestRevision: number;
  readonly updatedAt: number;
}

const workGraphHeadSchema = {
  currentVersion: 1,
  decode(payload: unknown): WorkGraphHead {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Work graph head must be an object.');
    }
    const record = payload as Record<string, unknown>;
    const allowed = new Set(['workGraphId', 'latestRevisionId', 'latestRevision', 'updatedAt']);
    if (Object.keys(record).some(key => !allowed.has(key))) {
      throw new Error('Work graph head contains unknown fields.');
    }
    if (!Number.isSafeInteger(record.latestRevision) || (record.latestRevision as number) < 1) {
      throw new Error('Latest work graph revision must be positive.');
    }
    if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)
      || record.updatedAt < 0) {
      throw new Error('Work graph head updatedAt must be non-negative.');
    }
    return {
      workGraphId: workGraphId(requireString(record.workGraphId, 'work graph id')),
      latestRevisionId: workGraphRevisionId(requireString(record.latestRevisionId, 'work graph revision id')),
      latestRevision: record.latestRevision as number,
      updatedAt: record.updatedAt,
    };
  },
};

export class WorkGraphRepository {
  private readonly revisions: VersionedRepository<WorkGraphRevision>;
  private readonly heads: VersionedRepository<WorkGraphHead>;
  private readonly executions: VersionedRepository<WorkGraphExecution>;
  private readonly now: () => number;

  constructor(storage: DurableStorage, now?: () => number) {
    this.now = now ?? Date.now;
    this.revisions = new VersionedRepository({
      storage,
      namespace: WORK_GRAPH_REVISIONS_PATH,
      schema: workGraphRevisionSchema,
      now,
      validatePayload: validateControlRecordPayload,
    });
    this.heads = new VersionedRepository({
      storage,
      namespace: WORK_GRAPH_HEADS_PATH,
      schema: workGraphHeadSchema,
      now: this.now,
      validatePayload: validateControlRecordPayload,
    });
    this.executions = new VersionedRepository({
      storage,
      namespace: WORK_GRAPH_EXECUTIONS_PATH,
      schema: workGraphExecutionSchema,
      now,
      validatePayload: validateControlRecordPayload,
    });
  }

  readRevision(recordId: string): Promise<VersionedRecordReadResult<WorkGraphRevision>> {
    return this.revisions.read(recordId);
  }

  readExecution(recordId: string): Promise<VersionedRecordReadResult<WorkGraphExecution>> {
    return this.executions.read(recordId);
  }

  listExecutionIds(): Promise<string[]> {
    return this.executions.listRecordIds();
  }

  async appendRevision(graph: WorkGraphRevision): Promise<VersionedRecord<WorkGraphRevision>> {
    const canonical = workGraphRevisionSchema.decode(graph);
    const currentHead = await this.heads.read(canonical.workGraphId);
    if (currentHead.kind === 'current' || currentHead.kind === 'migrated') {
      if (currentHead.record.payload.latestRevisionId === canonical.workGraphRevisionId) {
        const existing = await requireCurrent(this.revisions.read(canonical.workGraphRevisionId));
        if (stableSerialize(existing.payload) !== stableSerialize(canonical)) {
          throw new Error('Work graph revision identity conflicts with the authoritative record.');
        }
        return existing;
      }
    }
    if (canonical.revision === 1) {
      if (currentHead.kind !== 'absent') {
        throw new Error('Work graph already has an authoritative first revision.');
      }
    } else {
      const head = await requireCurrent(Promise.resolve(currentHead));
      if (head.payload.latestRevisionId !== canonical.previousRevisionId
        || head.payload.latestRevision !== canonical.revision - 1) {
        throw new Error('Work graph revision does not extend the authoritative head.');
      }
      if (!canonical.previousRevisionId) {
        throw new Error('Noninitial graph revision requires previousRevisionId.');
      }
      const previous = await requireCurrent(this.revisions.read(canonical.previousRevisionId));
      requireMonotonicRevision(previous.payload, canonical);
    }
    let revisionRecord: VersionedRecord<WorkGraphRevision>;
    try {
      revisionRecord = await this.revisions.save(canonical.workGraphRevisionId, canonical, null);
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      const existing = await requireCurrent(this.revisions.read(canonical.workGraphRevisionId));
      if (stableSerialize(existing.payload) !== stableSerialize(canonical)) throw error;
      revisionRecord = existing;
    }
    const nextHead: WorkGraphHead = {
      workGraphId: canonical.workGraphId,
      latestRevisionId: canonical.workGraphRevisionId,
      latestRevision: canonical.revision,
      updatedAt: this.now(),
    };
    if (currentHead.kind === 'absent') {
      await this.heads.save(canonical.workGraphId, nextHead, null);
    } else {
      const head = await requireCurrent(Promise.resolve(currentHead));
      await this.heads.save(canonical.workGraphId, nextHead, head.revision);
    }
    return revisionRecord;
  }

  async readLatestRevision(workGraphRecordId: string): Promise<VersionedRecord<WorkGraphRevision>> {
    const head = await requireCurrent(this.heads.read(workGraphRecordId));
    return requireCurrent(this.revisions.read(head.payload.latestRevisionId));
  }

  createExecution(execution: WorkGraphExecution): Promise<VersionedRecord<WorkGraphExecution>> {
    const canonical = workGraphExecutionSchema.decode(execution);
    return this.executions.save(canonical.workGraphExecutionId, canonical, null);
  }

  updateExecution(
    executionId: string,
    expectedRevision: number,
    mutation: (execution: WorkGraphExecution) => WorkGraphExecution,
  ): Promise<VersionedRecord<WorkGraphExecution>> {
    return this.executions.mutate(executionId, expectedRevision, current => {
      const next = workGraphExecutionSchema.decode(mutation(current));
      if (next.workGraphExecutionId !== current.workGraphExecutionId
        || next.workGraphId !== current.workGraphId
        || next.workGraphRevisionId !== current.workGraphRevisionId
        || next.graphRevision !== current.graphRevision
        || next.createdAt !== current.createdAt) {
        throw new Error('Work graph execution identity and graph binding are immutable.');
      }
      return next;
    });
  }

  async advanceExecutionRevision(
    executionId: string,
    expectedRevision: number,
    nextRevisionId: string,
  ): Promise<VersionedRecord<WorkGraphExecution>> {
    const nextGraph = await requireCurrent(this.revisions.read(nextRevisionId));
    return this.executions.mutate(executionId, expectedRevision, current => {
      if (nextGraph.payload.workGraphId !== current.workGraphId
        || nextGraph.payload.previousRevisionId !== current.workGraphRevisionId
        || nextGraph.payload.revision !== current.graphRevision + 1) {
        throw new Error('Execution may advance only to the next revision of the same graph.');
      }
      const existing = new Map(current.nodeStates.map(state => [state.workNodeId, state]));
      return workGraphExecutionSchema.decode({
        ...current,
        workGraphRevisionId: nextGraph.payload.workGraphRevisionId,
        graphRevision: nextGraph.payload.revision,
        status: 'active',
        nodeStates: nextGraph.payload.nodes.map(node => existing.get(node.workNodeId) ?? {
          workNodeId: node.workNodeId,
          state: 'pending',
          attempt: 0,
          resultIds: [],
          updatedAt: this.now(),
        }),
        updatedAt: this.now(),
      });
    });
  }
}

function requireMonotonicRevision(previous: WorkGraphRevision, next: WorkGraphRevision): void {
  if (next.workGraphId !== previous.workGraphId || next.revision !== previous.revision + 1) {
    throw new Error('Work graph revision must extend the immediately previous graph revision.');
  }
  if (stableSerialize(next.owner) !== stableSerialize(previous.owner)
    || next.maxParallel !== previous.maxParallel
    || next.failurePolicy !== previous.failurePolicy
    || next.synthesisPolicy !== previous.synthesisPolicy) {
    throw new Error('Work graph owner and scheduling policies are immutable across revisions.');
  }
  const nextNodes = new Map(next.nodes.map(node => [node.workNodeId, node]));
  for (const node of previous.nodes) {
    const candidate = nextNodes.get(node.workNodeId);
    if (!candidate || stableSerialize(candidate) !== stableSerialize(node)) {
      throw new Error(`Existing work node "${node.workNodeId}" changed across revisions.`);
    }
  }
  if (next.nodes.length === previous.nodes.length) {
    throw new Error('A new work graph revision must add at least one node.');
  }
}

async function requireCurrent<T>(
  read: Promise<VersionedRecordReadResult<T>>,
): Promise<VersionedRecord<T>> {
  const result = await read;
  if (result.kind === 'current' || result.kind === 'migrated') return result.record;
  if (result.kind === 'future') throw new Error(`Record "${result.recordId}" requires migration.`);
  if (result.kind === 'corrupt') throw new Error(`Record "${result.recordId}" is corrupt: ${result.error}`);
  throw new Error('Required work graph record is absent.');
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}
