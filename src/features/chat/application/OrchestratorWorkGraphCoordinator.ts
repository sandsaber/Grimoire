import type { AgentDispatchPort } from '../../../core/agents/AgentContracts';
import type { ExecutionOwner } from '../../../core/execution/ExecutionContracts';
import type {
  WorkNodeDispatchFactory,
} from '../../../core/work/WorkCoordinator';
import type { WorkCoordinator } from '../../../core/work/WorkCoordinator';
import type {
  WorkGraphExecution,
  WorkGraphRevision,
  WorkNode,
  WorkNodeAssignment,
} from '../../../core/work/WorkGraph';
import type { WorkGraphRepository } from '../../../core/work/WorkGraphRepository';
import type {
  WorkGraphExecutionId,
  WorkGraphId,
  WorkGraphRevisionId,
  WorkNodeId,
} from '../../../core/work/WorkIds';
import { createWorkGraphExecution } from '../../../core/work/WorkScheduler';

export interface OrchestratorWorkTask {
  readonly taskId: string;
  readonly goalRef: string;
  readonly dependencyTaskIds: readonly string[];
  readonly assignment: WorkNodeAssignment;
}

export interface OrchestratorSynthesisTask extends OrchestratorWorkTask {
  readonly kind: 'synthesis';
}

export interface OrchestratorWorkPlanCommand {
  readonly planId: string;
  readonly owner: ExecutionOwner;
  readonly tasks: readonly OrchestratorWorkTask[];
  readonly synthesis?: OrchestratorSynthesisTask;
  readonly maxParallel: number;
  readonly failurePolicy: WorkGraphRevision['failurePolicy'];
  readonly synthesisPolicy: WorkGraphRevision['synthesisPolicy'];
  /** Stable across retries of the same plan command. */
  readonly createdAt: number;
}

export interface OrchestratorWorkIdentity {
  readonly workGraphId: WorkGraphId;
  readonly workGraphRevisionId: WorkGraphRevisionId;
  readonly workGraphExecutionId: WorkGraphExecutionId;
  readonly nodeIds: Readonly<Record<string, WorkNodeId>>;
}

export interface OrchestratorWorkIdentityFactory {
  /** Must return the same identity for every replay of the same plan id and task ids. */
  create(planId: string, taskIds: readonly string[]): OrchestratorWorkIdentity;
}

export interface OrchestratorWorkGraphResult {
  readonly graph: WorkGraphRevision;
  readonly execution: WorkGraphExecution;
}

export interface OrchestratorWorkGraphCoordinatorOptions {
  readonly graphs: Pick<WorkGraphRepository,
  'appendRevision' | 'createExecution' | 'readExecution'>;
  readonly work: Pick<WorkCoordinator, 'dispatchReady'>;
  readonly identities: OrchestratorWorkIdentityFactory;
  readonly dispatchFactory: WorkNodeDispatchFactory;
  readonly dispatchPort: AgentDispatchPort;
}

/**
 * Application command boundary for durable orchestration. It accepts opaque goal references only;
 * prompts and provider payloads remain in their owning request stores.
 */
export class OrchestratorWorkGraphCoordinator {
  constructor(private readonly options: OrchestratorWorkGraphCoordinatorOptions) {}

  async create(command: OrchestratorWorkPlanCommand): Promise<OrchestratorWorkGraphResult> {
    requirePlan(command);
    const taskIds = [
      ...command.tasks.map(task => task.taskId),
      ...(command.synthesis ? [command.synthesis.taskId] : []),
    ];
    const identity = this.options.identities.create(command.planId, taskIds);
    requireExactIdentity(identity, taskIds);
    const graph = compileGraph(command, identity, command.createdAt);
    const execution = createWorkGraphExecution(
      graph,
      identity.workGraphExecutionId,
      command.createdAt,
    );
    await this.options.graphs.appendRevision(graph);
    const existing = await this.options.graphs.readExecution(identity.workGraphExecutionId);
    if (existing.kind === 'current' || existing.kind === 'migrated') {
      requireExecutionIdentity(existing.record.payload, execution);
      return { graph, execution: existing.record.payload };
    }
    if (existing.kind !== 'absent') {
      throw new Error('Existing work graph execution is unreadable.');
    }
    const created = await this.options.graphs.createExecution(execution);
    return { graph, execution: created.payload };
  }

  async createAndDispatch(
    command: OrchestratorWorkPlanCommand,
  ): Promise<OrchestratorWorkGraphResult> {
    const created = await this.create(command);
    const execution = await this.options.work.dispatchReady(
      created.execution.workGraphExecutionId,
      this.options.dispatchFactory,
      this.options.dispatchPort,
    );
    return { graph: created.graph, execution };
  }
}

function compileGraph(
  command: OrchestratorWorkPlanCommand,
  identity: OrchestratorWorkIdentity,
  createdAt: number,
): WorkGraphRevision {
  const taskIds = new Set(command.tasks.map(task => task.taskId));
  const nodes = command.tasks.map(task => compileNode(task, identity.nodeIds, 'agent'));
  const synthesis = command.synthesis;
  if (synthesis) {
    const dependencyTaskIds = synthesis.dependencyTaskIds.length > 0
      ? synthesis.dependencyTaskIds
      : [...taskIds];
    nodes.push(compileNode(
      { ...synthesis, dependencyTaskIds },
      identity.nodeIds,
      'synthesis',
    ));
  }
  return {
    workGraphRevisionId: identity.workGraphRevisionId,
    workGraphId: identity.workGraphId,
    revision: 1,
    owner: command.owner,
    nodes,
    maxParallel: command.maxParallel,
    failurePolicy: command.failurePolicy,
    synthesisPolicy: command.synthesisPolicy,
    ...(synthesis ? { synthesisNodeId: identity.nodeIds[synthesis.taskId] } : {}),
    createdAt,
  };
}

function compileNode(
  task: OrchestratorWorkTask,
  nodeIds: Readonly<Record<string, WorkNodeId>>,
  kind: WorkNode['kind'],
): WorkNode {
  const workNodeId = nodeIds[task.taskId];
  if (!workNodeId) throw new Error(`Work identity omitted task "${task.taskId}".`);
  return {
    workNodeId,
    kind,
    goalRef: task.goalRef,
    dependencyNodeIds: task.dependencyTaskIds.map(taskId => {
      const dependency = nodeIds[taskId];
      if (!dependency) throw new Error(`Work task "${task.taskId}" has an unknown dependency.`);
      return dependency;
    }),
    assignment: task.assignment,
    synthesisInputResultIds: [],
  };
}

function requirePlan(command: OrchestratorWorkPlanCommand): void {
  requireIdentifier(command.planId, 'Orchestrator plan id');
  if (command.owner.kind !== 'conversation') {
    throw new Error('An orchestrator plan must be owned by a conversation.');
  }
  if (command.tasks.length === 0 || command.tasks.length > 512) {
    throw new Error('An orchestrator plan must contain between 1 and 512 tasks.');
  }
  if (!Number.isSafeInteger(command.maxParallel)
    || command.maxParallel < 1
    || command.maxParallel > 64) {
    throw new Error('Orchestrator maxParallel must be between 1 and 64.');
  }
  if (!Number.isFinite(command.createdAt) || command.createdAt < 0) {
    throw new Error('Orchestrator createdAt must be a non-negative timestamp.');
  }
  const taskIds = new Set<string>();
  for (const task of command.tasks) {
    requireTask(task);
    if (taskIds.has(task.taskId)) throw new Error('Orchestrator task ids must be unique.');
    taskIds.add(task.taskId);
  }
  if (command.synthesis) {
    requireTask(command.synthesis);
    if (taskIds.has(command.synthesis.taskId)) {
      throw new Error('The synthesis task id must be unique.');
    }
  }
  for (const task of command.tasks) {
    if (task.dependencyTaskIds.some(dependency => !taskIds.has(dependency))) {
      throw new Error(`Work task "${task.taskId}" has an unknown dependency.`);
    }
  }
  if (command.synthesis?.dependencyTaskIds.some(dependency => !taskIds.has(dependency))) {
    throw new Error(`Work task "${command.synthesis.taskId}" has an unknown dependency.`);
  }
}

function requireTask(task: OrchestratorWorkTask): void {
  requireIdentifier(task.taskId, 'Orchestrator task id');
  requireIdentifier(task.goalRef, 'Orchestrator goal ref');
  if (new Set(task.dependencyTaskIds).size !== task.dependencyTaskIds.length) {
    throw new Error(`Work task "${task.taskId}" has duplicate dependencies.`);
  }
  if (task.assignment.kind === 'managed-provider') {
    requireIdentifier(task.assignment.providerId, 'Assigned provider id');
  }
}

function requireExactIdentity(
  identity: OrchestratorWorkIdentity,
  taskIds: readonly string[],
): void {
  const actual = Object.keys(identity.nodeIds).sort();
  const expected = [...taskIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)
    || new Set(Object.values(identity.nodeIds)).size !== expected.length) {
    throw new Error('Orchestrator identity mapping must cover every task exactly once.');
  }
}

function requireExecutionIdentity(
  existing: WorkGraphExecution,
  initial: WorkGraphExecution,
): void {
  const existingNodeIds = existing.nodeStates.map(state => state.workNodeId).sort();
  const initialNodeIds = initial.nodeStates.map(state => state.workNodeId).sort();
  if (existing.workGraphId !== initial.workGraphId
    || existing.workGraphRevisionId !== initial.workGraphRevisionId
    || existing.graphRevision !== initial.graphRevision
    || existing.createdAt !== initial.createdAt
    || JSON.stringify(existingNodeIds) !== JSON.stringify(initialNodeIds)) {
    throw new Error('Work graph execution identity conflicts with the orchestrator plan.');
  }
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a constrained identifier.`);
  }
}
