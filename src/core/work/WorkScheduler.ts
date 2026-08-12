import type { AgentResultId } from '../agents/AgentIds';
import type { AgentRunId } from '../agents/AgentIds';
import type {
  WorkGraphExecution,
  WorkGraphRevision,
  WorkNodeExecutionState,
  WorkNodeState,
} from './WorkGraph';
import { validateWorkGraph } from './WorkGraph';
import type { WorkNodeId } from './WorkIds';

const TERMINAL_NODE_STATES = new Set<WorkNodeState>([
  'succeeded', 'failed', 'cancelled', 'blocked', 'indeterminate',
]);

export interface WorkSchedulePlan {
  readonly readyNodeIds: readonly WorkNodeId[];
  readonly blockedNodeIds: readonly WorkNodeId[];
}

export function createWorkGraphExecution(
  graph: WorkGraphRevision,
  workGraphExecutionId: WorkGraphExecution['workGraphExecutionId'],
  now: number,
): WorkGraphExecution {
  validateWorkGraph(graph);
  return {
    workGraphExecutionId,
    workGraphId: graph.workGraphId,
    workGraphRevisionId: graph.workGraphRevisionId,
    graphRevision: graph.revision,
    status: 'active',
    nodeStates: graph.nodes.map(node => ({
      workNodeId: node.workNodeId,
      state: 'pending',
      attempt: 0,
      resultIds: [],
      updatedAt: now,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function planWork(
  graph: WorkGraphRevision,
  execution: WorkGraphExecution,
): WorkSchedulePlan {
  validateExecutionBinding(graph, execution);
  const states = stateMap(execution);
  const runningCount = execution.nodeStates.filter(state => (
    state.state === 'preparing' || state.state === 'running'
  )).length;
  const blocked = new Set<WorkNodeId>();
  const failFastTriggered = graph.failurePolicy === 'fail-fast'
    && execution.nodeStates.some(state => (
      state.state === 'failed' || state.state === 'cancelled' || state.state === 'indeterminate'
    ));
  const candidates: WorkNodeId[] = [];

  for (const node of graph.nodes) {
    const ownState = states.get(node.workNodeId);
    if (ownState?.state !== 'pending') continue;
    if (failFastTriggered) {
      blocked.add(node.workNodeId);
      continue;
    }
    const dependencies = node.dependencyNodeIds.map(id => requireNodeState(states, id));
    if (node.kind === 'synthesis' && graph.synthesisPolicy === 'allow-partial') {
      if (dependencies.every(dependency => TERMINAL_NODE_STATES.has(dependency.state))
        && dependencies.some(dependency => dependency.resultIds.length > 0)) {
        requireSynthesisInputs(graph, execution, node.workNodeId);
        candidates.push(node.workNodeId);
      }
      continue;
    }
    if (dependencies.some(dependency => (
      dependency.state === 'failed'
      || dependency.state === 'cancelled'
      || dependency.state === 'blocked'
      || dependency.state === 'indeterminate'
    ))) {
      blocked.add(node.workNodeId);
      continue;
    }
    if (dependencies.every(dependency => dependency.state === 'succeeded')) {
      if (node.kind === 'synthesis') {
        requireSynthesisInputs(graph, execution, node.workNodeId);
      }
      candidates.push(node.workNodeId);
    }
  }

  return {
    readyNodeIds: candidates.slice(0, Math.max(0, graph.maxParallel - runningCount)),
    blockedNodeIds: [...blocked],
  };
}

export function markWorkNodesBlocked(
  execution: WorkGraphExecution,
  nodeIds: readonly WorkNodeId[],
  now: number,
): WorkGraphExecution {
  const blocked = new Set(nodeIds);
  return updateExecution(execution, state => (
    blocked.has(state.workNodeId) && state.state === 'pending'
      ? { ...state, state: 'blocked', terminalCode: 'dependency-unsatisfied', updatedAt: now }
      : state
  ), now);
}

export function startWorkNode(
  graph: WorkGraphRevision,
  execution: WorkGraphExecution,
  nodeId: WorkNodeId,
  agentRunId: AgentRunId,
  now: number,
): WorkGraphExecution {
  return markWorkNodeRunning(
    claimWorkNode(graph, execution, nodeId, agentRunId, now),
    nodeId,
    now,
  );
}

export function claimWorkNode(
  graph: WorkGraphRevision,
  execution: WorkGraphExecution,
  nodeId: WorkNodeId,
  agentRunId: AgentRunId,
  now: number,
): WorkGraphExecution {
  if (!planWork(graph, execution).readyNodeIds.includes(nodeId)) {
    throw new Error(`Work node "${nodeId}" is not ready.`);
  }
  const node = graph.nodes.find(candidate => candidate.workNodeId === nodeId);
  if (!node) throw new Error(`Work node "${nodeId}" is absent.`);
  const inputResultIds = node.kind === 'synthesis'
    ? requireSynthesisInputs(graph, execution, nodeId)
    : undefined;
  return updateExecution(execution, state => state.workNodeId === nodeId
    ? {
      ...state,
      state: 'preparing',
      attempt: state.attempt + 1,
      agentRunId,
      ...(inputResultIds ? { inputResultIds } : {}),
      terminalCode: undefined,
      updatedAt: now,
    }
    : state, now);
}

export function markWorkNodeRunning(
  execution: WorkGraphExecution,
  nodeId: WorkNodeId,
  now: number,
): WorkGraphExecution {
  const current = requireNodeState(stateMap(execution), nodeId);
  if (current.state !== 'preparing') {
    throw new Error(`Work node "${nodeId}" is not preparing.`);
  }
  return updateExecution(execution, state => state.workNodeId === nodeId
    ? { ...state, state: 'running', updatedAt: now }
    : state, now);
}

export function completeWorkNode(
  execution: WorkGraphExecution,
  nodeId: WorkNodeId,
  terminal: Exclude<WorkNodeState, 'pending' | 'preparing' | 'running' | 'blocked'>,
  resultIds: readonly AgentResultId[],
  terminalCode: string,
  now: number,
): WorkGraphExecution {
  const current = requireNodeState(stateMap(execution), nodeId);
  if (current.state !== 'running') throw new Error(`Work node "${nodeId}" is not running.`);
  return updateExecution(execution, state => state.workNodeId === nodeId
    ? { ...state, state: terminal, resultIds: [...resultIds], terminalCode, updatedAt: now }
    : state, now);
}

export function finalizeWorkGraph(
  graph: WorkGraphRevision,
  execution: WorkGraphExecution,
  now: number,
): WorkGraphExecution {
  validateExecutionBinding(graph, execution);
  if (!execution.nodeStates.every(state => TERMINAL_NODE_STATES.has(state.state))) {
    return execution;
  }
  const synthesis = graph.synthesisNodeId
    ? requireNodeState(stateMap(execution), graph.synthesisNodeId)
    : undefined;
  const status = synthesis
    ? graphStatusFromNode(synthesis.state)
    : aggregateGraphStatus(execution.nodeStates);
  return { ...execution, status, updatedAt: now };
}

export function requireSynthesisInputs(
  graph: WorkGraphRevision,
  execution: WorkGraphExecution,
  synthesisNodeId: WorkNodeId,
): readonly AgentResultId[] {
  validateExecutionBinding(graph, execution);
  const node = graph.nodes.find(candidate => candidate.workNodeId === synthesisNodeId);
  if (!node || node.kind !== 'synthesis') throw new Error('Requested node is not synthesis.');
  const states = stateMap(execution);
  const dependencies = node.dependencyNodeIds.map(id => requireNodeState(states, id));
  if (!dependencies.every(dependency => TERMINAL_NODE_STATES.has(dependency.state))) {
    throw new Error('Synthesis dependencies are not terminal.');
  }
  if (graph.synthesisPolicy === 'require-all'
    && dependencies.some(dependency => dependency.state !== 'succeeded')) {
    throw new Error('Synthesis requires every dependency to succeed.');
  }
  const availableIds = dependencies.flatMap(dependency => dependency.resultIds);
  const available = new Set(availableIds);
  const selected = node.synthesisInputResultIds.length === 0
    ? availableIds
    : node.synthesisInputResultIds;
  if (selected.length === 0 || selected.some(resultId => !available.has(resultId))) {
    throw new Error('Synthesis inputs must reference exact dependency results.');
  }
  return [...new Set(selected)];
}

function validateExecutionBinding(graph: WorkGraphRevision, execution: WorkGraphExecution): void {
  validateWorkGraph(graph);
  if (execution.workGraphId !== graph.workGraphId
    || execution.workGraphRevisionId !== graph.workGraphRevisionId
    || execution.graphRevision !== graph.revision) {
    throw new Error('Work graph execution is bound to a different graph revision.');
  }
  const graphIds = graph.nodes.map(node => node.workNodeId).sort();
  const stateIds = execution.nodeStates.map(state => state.workNodeId).sort();
  if (JSON.stringify(graphIds) !== JSON.stringify(stateIds)) {
    throw new Error('Work graph execution state does not match graph nodes.');
  }
}

function stateMap(execution: WorkGraphExecution): Map<WorkNodeId, WorkNodeExecutionState> {
  return new Map(execution.nodeStates.map(state => [state.workNodeId, state]));
}

function requireNodeState(
  states: ReadonlyMap<WorkNodeId, WorkNodeExecutionState>,
  nodeId: WorkNodeId,
): WorkNodeExecutionState {
  const state = states.get(nodeId);
  if (!state) throw new Error(`Missing execution state for work node "${nodeId}".`);
  return state;
}

function updateExecution(
  execution: WorkGraphExecution,
  mutation: (state: WorkNodeExecutionState) => WorkNodeExecutionState,
  now: number,
): WorkGraphExecution {
  return { ...execution, nodeStates: execution.nodeStates.map(mutation), updatedAt: now };
}

function aggregateGraphStatus(
  states: readonly WorkNodeExecutionState[],
): WorkGraphExecution['status'] {
  if (states.some(state => state.state === 'indeterminate')) return 'indeterminate';
  if (states.some(state => state.state === 'failed' || state.state === 'blocked')) return 'failed';
  if (states.some(state => state.state === 'cancelled')) return 'cancelled';
  return 'succeeded';
}

function graphStatusFromNode(state: WorkNodeState): WorkGraphExecution['status'] {
  if (state === 'succeeded') return 'succeeded';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'indeterminate') return 'indeterminate';
  return 'failed';
}
