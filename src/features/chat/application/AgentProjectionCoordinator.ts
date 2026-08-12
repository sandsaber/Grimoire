import type {
  AgentInstanceRecord,
  AgentResultRecord,
  AgentRunRecord,
} from '../../../core/agents/AgentContracts';
import type {
  AgentCoordinatorListener,
  AgentCoordinatorNotification,
} from '../../../core/agents/AgentCoordinator';
import type { AgentFidelityProfile } from '../../../core/agents/AgentFidelity';
import type { AgentRepositories } from '../../../core/agents/AgentRepositories';
import type { ExecutionOwner } from '../../../core/execution/ExecutionContracts';
import type { RunId } from '../../../core/execution/ExecutionIds';
import type {
  ExecutionInteractionSnapshot,
  ExecutionLifecycleListener,
} from '../../../core/execution/ExecutionLifecycleRegistry';
import type { VersionedRecord, VersionedRecordReadResult } from '../../../core/persistence/VersionedRecord';
import type { ProviderId } from '../../../core/types/provider';
import type { WorkCoordinatorListener } from '../../../core/work/WorkCoordinator';
import type { WorkGraphExecution, WorkGraphRevision } from '../../../core/work/WorkGraph';
import type { WorkGraphRepository } from '../../../core/work/WorkGraphRepository';
import {
  type AgentProjection,
  type AgentWorkProjectionView,
  createAgentProjection,
  reduceAgentProjection,
  selectAgentWorkProjection,
} from '../projections/AgentProjection';

export interface AgentProjectionRepositoryPort {
  readonly instances: Pick<AgentRepositories['instances'], 'listRecordIds' | 'read'>;
  readonly runs: Pick<AgentRepositories['runs'], 'read'>;
  readonly results: Pick<AgentRepositories['results'], 'read'>;
}

export interface WorkProjectionRepositoryPort {
  listExecutionIds: WorkGraphRepository['listExecutionIds'];
  readExecution: WorkGraphRepository['readExecution'];
  readRevision: WorkGraphRepository['readRevision'];
}

export interface AgentProjectionChangeSource {
  subscribe(listener: AgentCoordinatorListener): () => void;
}

export interface WorkProjectionChangeSource {
  subscribe(listener: WorkCoordinatorListener): () => void;
}

export interface AgentExecutionProjectionPort {
  getInteractionSnapshotsForRun(runId: RunId): readonly ExecutionInteractionSnapshot[];
  subscribe(listener: ExecutionLifecycleListener): () => void;
}

export interface AgentProjectionCoordinatorOptions {
  readonly agents: AgentProjectionRepositoryPort;
  readonly work: WorkProjectionRepositoryPort;
  readonly agentChanges: AgentProjectionChangeSource;
  readonly workChanges: WorkProjectionChangeSource;
  readonly execution: AgentExecutionProjectionPort;
  readonly fidelityForProvider: (providerId: ProviderId) => AgentFidelityProfile;
}

interface ProjectionEntry {
  projection: AgentProjection;
  readonly listeners: Set<(view: AgentWorkProjectionView) => void>;
}

export class AgentProjectionCoordinator {
  private readonly agents: AgentProjectionRepositoryPort;
  private readonly work: WorkProjectionRepositoryPort;
  private readonly fidelityForProvider: (providerId: ProviderId) => AgentFidelityProfile;
  private readonly execution: AgentExecutionProjectionPort;
  private readonly entries = new Map<string, ProjectionEntry>();
  private readonly loads = new Map<string, Promise<ProjectionEntry>>();
  private readonly unsubscribeAgentChanges: () => void;
  private readonly unsubscribeWorkChanges: () => void;
  private readonly unsubscribeExecutionChanges: () => void;
  private refreshTail: Promise<void> = Promise.resolve();
  private changeSequence = 0;
  private generation = 0;
  private disposed = false;

  constructor(options: AgentProjectionCoordinatorOptions) {
    this.agents = options.agents;
    this.work = options.work;
    this.fidelityForProvider = options.fidelityForProvider;
    this.execution = options.execution;
    this.unsubscribeAgentChanges = options.agentChanges.subscribe(notification => {
      this.handleAgentChange(notification);
    });
    this.unsubscribeWorkChanges = options.workChanges.subscribe(() => {
      this.changeSequence += 1;
      this.enqueueRefreshAll();
    });
    this.unsubscribeExecutionChanges = options.execution.subscribe(notification => {
      if (notification.kind === 'interaction-updated') {
        this.changeSequence += 1;
        this.enqueueRefreshAll();
      }
    });
  }

  async load(owner: ExecutionOwner): Promise<AgentWorkProjectionView> {
    const entry = await this.requireEntry(owner);
    this.requireOpen();
    return selectAgentWorkProjection(entry.projection);
  }

  async attach(
    owner: ExecutionOwner,
    listener: (view: AgentWorkProjectionView) => void,
  ): Promise<() => void> {
    const entry = await this.requireEntry(owner);
    this.requireOpen();
    entry.listeners.add(listener);
    listener(selectAgentWorkProjection(entry.projection));
    return () => {
      entry.listeners.delete(listener);
    };
  }

  setExpanded(owner: ExecutionOwner, agentInstanceId: AgentInstanceRecord['agentInstanceId'], expanded: boolean): void {
    this.requireOpen();
    const entry = this.entries.get(ownerKey(owner));
    if (!entry) return;
    const next = reduceAgentProjection(entry.projection, {
      kind: 'agent-expansion-changed',
      agentInstanceId,
      expanded,
    });
    this.publish(entry, next);
  }

  getProjection(owner: ExecutionOwner): AgentProjection | null {
    return this.entries.get(ownerKey(owner))?.projection ?? null;
  }

  waitForIdle(): Promise<void> {
    return this.refreshTail;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.unsubscribeAgentChanges();
    this.unsubscribeWorkChanges();
    this.unsubscribeExecutionChanges();
    for (const entry of this.entries.values()) entry.listeners.clear();
  }

  private async requireEntry(owner: ExecutionOwner): Promise<ProjectionEntry> {
    this.requireOpen();
    const key = ownerKey(owner);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const loading = this.loads.get(key);
    if (loading) return loading;
    const generation = this.generation;
    const task = this.loadEntry(owner, key, generation).finally(() => {
      if (this.loads.get(key) === task) this.loads.delete(key);
    });
    this.loads.set(key, task);
    return task;
  }

  private async loadEntry(
    owner: ExecutionOwner,
    key: string,
    generation: number,
  ): Promise<ProjectionEntry> {
    const entry: ProjectionEntry = {
      projection: createAgentProjection(owner),
      listeners: new Set(),
    };
    let stable = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sequence = this.changeSequence;
      await this.refreshEntry(entry, generation);
      if (sequence === this.changeSequence) {
        stable = true;
        break;
      }
    }
    this.requireGeneration(generation);
    this.entries.set(key, entry);
    if (!stable) this.enqueueRefreshAll();
    return entry;
  }

  private handleAgentChange(notification: AgentCoordinatorNotification): void {
    this.changeSequence += 1;
    if (this.disposed || this.entries.size === 0) return;
    const generation = this.generation;
    const operation = this.refreshTail.catch(() => undefined).then(async () => {
      for (const instanceId of notification.agentInstanceIds) {
        const instance = await requireRecord<AgentInstanceRecord>(
          this.agents.instances.read(instanceId),
        );
        for (const entry of this.entries.values()) {
          if (!belongsToProjection(instance.payload, entry.projection)) continue;
          const next = await this.applyInstance(entry.projection, instance);
          this.requireGeneration(generation);
          this.publish(entry, next, true);
        }
      }
    });
    this.refreshTail = operation.catch(() => undefined);
  }

  private enqueueRefreshAll(): void {
    if (this.disposed || this.entries.size === 0) return;
    const generation = this.generation;
    const operation = this.refreshTail.catch(() => undefined).then(async () => {
      for (const entry of this.entries.values()) {
        await this.refreshEntry(entry, generation);
      }
    });
    this.refreshTail = operation.catch(() => undefined);
  }

  private async refreshEntry(entry: ProjectionEntry, generation: number): Promise<void> {
    let projection = entry.projection;
    const includedWorkGraphIds = new Set<string>();
    for (const executionId of await this.work.listExecutionIds()) {
      const execution = await requireRecord<WorkGraphExecution>(
        this.work.readExecution(executionId),
      );
      const graph = await requireRecord<WorkGraphRevision>(
        this.work.readRevision(execution.payload.workGraphRevisionId),
      );
      if (!sameOwner(graph.payload.owner, projection.owner)) continue;
      includedWorkGraphIds.add(graph.payload.workGraphId);
      projection = reduceAgentProjection(projection, {
        kind: 'work-graph-record',
        record: graph,
      });
      projection = reduceAgentProjection(projection, {
        kind: 'work-execution-record',
        record: execution,
      });
    }

    for (const instanceId of await this.agents.instances.listRecordIds()) {
      const instance = await requireRecord<AgentInstanceRecord>(
        this.agents.instances.read(instanceId),
      );
      if (!sameOwner(instance.payload.rootOwner, projection.owner)
        && !(instance.payload.rootOwner.kind === 'work-graph'
          && includedWorkGraphIds.has(instance.payload.rootOwner.ownerId))) {
        continue;
      }
      projection = await this.applyInstance(projection, instance);
    }
    this.requireGeneration(generation);
    this.publish(entry, projection, true);
  }

  private async applyInstance(
    initial: AgentProjection,
    instance: VersionedRecord<AgentInstanceRecord>,
  ): Promise<AgentProjection> {
    let projection = reduceAgentProjection(initial, {
      kind: 'instance-record',
      record: instance,
    });
    projection = reduceAgentProjection(projection, {
      kind: 'fidelity-profile',
      providerId: instance.payload.providerId,
      profile: this.fidelityForProvider(instance.payload.providerId),
    });
    for (const runId of instance.payload.runIds) {
      const run = await requireRecord<AgentRunRecord>(this.agents.runs.read(runId));
      projection = reduceAgentProjection(projection, { kind: 'run-record', record: run });
      if (run.payload.executionRunId) {
        for (const interaction of this.execution.getInteractionSnapshotsForRun(
          run.payload.executionRunId,
        )) {
          projection = reduceAgentProjection(projection, {
            kind: 'interaction-record',
            record: interaction.record,
            revision: interaction.revision,
          });
        }
      }
      for (const resultId of [...run.payload.resultIds, ...run.payload.observedResultIds]) {
        const result = await readOptionalRecord<AgentResultRecord>(
          this.agents.results.read(resultId),
        );
        if (!result) continue;
        projection = reduceAgentProjection(projection, {
          kind: 'result-record',
          record: result.payload,
        });
      }
    }
    return projection;
  }

  private publish(
    entry: ProjectionEntry,
    projection: AgentProjection,
    preserveExpansion = false,
  ): void {
    if (preserveExpansion
      && projection.expandedAgentIds !== entry.projection.expandedAgentIds) {
      projection = {
        ...projection,
        expandedAgentIds: entry.projection.expandedAgentIds,
      };
    }
    if (projection === entry.projection) return;
    entry.projection = projection;
    const view = selectAgentWorkProjection(projection);
    for (const listener of entry.listeners) {
      try {
        listener(view);
      } catch {
        // Read-only projection listeners cannot affect durable agent work.
      }
    }
  }

  private requireOpen(): void {
    if (this.disposed) throw new Error('Agent projection coordinator is disposed.');
  }

  private requireGeneration(generation: number): void {
    if (this.disposed || generation !== this.generation) {
      throw new Error('Agent projection coordinator was disposed during refresh.');
    }
  }
}

async function requireRecord<TRecord>(
  read: Promise<VersionedRecordReadResult<TRecord>>,
): Promise<VersionedRecord<TRecord>> {
  const result = await read;
  if (result.kind === 'current' || result.kind === 'migrated') return result.record;
  if (result.kind === 'future') {
    throw new Error(`Projection record "${result.recordId}" requires migration.`);
  }
  if (result.kind === 'corrupt') {
    throw new Error(`Projection record "${result.recordId}" is corrupt: ${result.error}`);
  }
  throw new Error('Required projection record is absent.');
}

async function readOptionalRecord<TRecord>(
  read: Promise<VersionedRecordReadResult<TRecord>>,
): Promise<VersionedRecord<TRecord> | null> {
  const result = await read;
  return result.kind === 'current' || result.kind === 'migrated' ? result.record : null;
}

function belongsToProjection(
  instance: AgentInstanceRecord,
  projection: AgentProjection,
): boolean {
  return sameOwner(instance.rootOwner, projection.owner)
    || (instance.rootOwner.kind === 'work-graph'
      && projection.workGraphRevisions.some(entry => (
        entry.record.workGraphId === instance.rootOwner.ownerId
      )));
}

function sameOwner(left: ExecutionOwner, right: ExecutionOwner): boolean {
  return left.kind === right.kind && left.ownerId === right.ownerId;
}

function ownerKey(owner: ExecutionOwner): string {
  return `${owner.kind}:${owner.ownerId}`;
}
