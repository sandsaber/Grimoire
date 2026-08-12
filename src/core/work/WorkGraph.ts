import type { AgentInstanceId, AgentResultId, AgentRunId } from '../agents/AgentIds';
import type { ExecutionOwner } from '../execution/ExecutionContracts';
import type { ProviderId } from '../types/provider';
import type {
  WorkGraphExecutionId,
  WorkGraphId,
  WorkGraphRevisionId,
  WorkNodeId,
} from './WorkIds';

export type WorkNodeAssignment =
  | { readonly kind: 'agent-instance'; readonly agentInstanceId: AgentInstanceId }
  | { readonly kind: 'managed-provider'; readonly providerId: ProviderId };

export type WorkNodeKind = 'agent' | 'synthesis';

export interface WorkNode {
  readonly workNodeId: WorkNodeId;
  readonly kind: WorkNodeKind;
  readonly goalRef: string;
  readonly dependencyNodeIds: readonly WorkNodeId[];
  readonly assignment: WorkNodeAssignment;
  readonly synthesisInputResultIds: readonly AgentResultId[];
}

export interface WorkGraphRevision {
  readonly workGraphRevisionId: WorkGraphRevisionId;
  readonly workGraphId: WorkGraphId;
  readonly revision: number;
  readonly previousRevisionId?: WorkGraphRevisionId;
  readonly owner: ExecutionOwner;
  readonly nodes: readonly WorkNode[];
  readonly maxParallel: number;
  readonly failurePolicy: 'fail-fast' | 'continue-independent';
  readonly synthesisPolicy: 'require-all' | 'allow-partial';
  readonly synthesisNodeId?: WorkNodeId;
  readonly createdAt: number;
}

export type WorkNodeState =
  | 'pending'
  | 'preparing'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'indeterminate';

export interface WorkNodeExecutionState {
  readonly workNodeId: WorkNodeId;
  readonly state: WorkNodeState;
  readonly attempt: number;
  readonly agentRunId?: AgentRunId;
  /** Exact dependency results admitted to a synthesis attempt. */
  readonly inputResultIds?: readonly AgentResultId[];
  readonly resultIds: readonly AgentResultId[];
  readonly terminalCode?: string;
  readonly updatedAt: number;
}

export interface WorkGraphExecution {
  readonly workGraphExecutionId: WorkGraphExecutionId;
  readonly workGraphId: WorkGraphId;
  readonly workGraphRevisionId: WorkGraphRevisionId;
  readonly graphRevision: number;
  readonly status: 'active' | 'succeeded' | 'failed' | 'cancelled' | 'indeterminate';
  readonly nodeStates: readonly WorkNodeExecutionState[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class WorkGraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkGraphValidationError';
  }
}

export function validateWorkGraph(graph: WorkGraphRevision): void {
  const nodes = new Map(graph.nodes.map(node => [node.workNodeId, node]));
  if (nodes.size !== graph.nodes.length || graph.nodes.length === 0 || graph.nodes.length > 512) {
    throw new WorkGraphValidationError('Work graph must contain unique nodes.');
  }
  for (const node of graph.nodes) {
    if (new Set(node.dependencyNodeIds).size !== node.dependencyNodeIds.length) {
      throw new WorkGraphValidationError(`Node "${node.workNodeId}" has duplicate dependencies.`);
    }
    for (const dependencyId of node.dependencyNodeIds) {
      if (!nodes.has(dependencyId)) {
        throw new WorkGraphValidationError(
          `Node "${node.workNodeId}" depends on missing node "${dependencyId}".`,
        );
      }
      if (dependencyId === node.workNodeId) {
        throw new WorkGraphValidationError(`Node "${node.workNodeId}" depends on itself.`);
      }
    }
    if (node.kind === 'agent' && node.synthesisInputResultIds.length > 0) {
      throw new WorkGraphValidationError('Only synthesis nodes may declare synthesis inputs.');
    }
    if (new Set(node.synthesisInputResultIds).size !== node.synthesisInputResultIds.length) {
      throw new WorkGraphValidationError('Synthesis result inputs must not contain duplicates.');
    }
  }
  detectCycles(graph.nodes, nodes);

  const synthesisNodes = graph.nodes.filter(node => node.kind === 'synthesis');
  if (synthesisNodes.length > 1) {
    throw new WorkGraphValidationError('Work graph may contain at most one synthesis node.');
  }
  if ((graph.synthesisNodeId === undefined) !== (synthesisNodes.length === 0)
    || (graph.synthesisNodeId && synthesisNodes[0]?.workNodeId !== graph.synthesisNodeId)) {
    throw new WorkGraphValidationError('Synthesis node identity must match the declared node.');
  }
  if (synthesisNodes[0]?.dependencyNodeIds.length === 0) {
    throw new WorkGraphValidationError('Synthesis node requires at least one dependency.');
  }
}

function detectCycles(
  entries: readonly WorkNode[],
  nodes: ReadonlyMap<WorkNodeId, WorkNode>,
): void {
  const visiting = new Set<WorkNodeId>();
  const visited = new Set<WorkNodeId>();
  const visit = (nodeId: WorkNodeId): void => {
    if (visiting.has(nodeId)) {
      throw new WorkGraphValidationError(`Work graph contains a cycle at "${nodeId}".`);
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependencyId of nodes.get(nodeId)?.dependencyNodeIds ?? []) visit(dependencyId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  entries.forEach(node => visit(node.workNodeId));
}
