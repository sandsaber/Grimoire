import type {
  AgentCancellationRecoveryPort,
  AgentDispatchPort,
  AgentDispatchRecoveryPort,
  AgentResultRecord,
  AgentRunRecord,
  AgentRunRecoveryPort,
} from '../agents/AgentContracts';
import type {
  PrepareAgentDispatchCommand,
  RetryAgentCommand,
} from '../agents/AgentCoordinator';
import type { AgentCoordinator } from '../agents/AgentCoordinator';
import type { VersionedRecord, VersionedRecordReadResult } from '../persistence/VersionedRecord';
import { RevisionConflictError } from '../persistence/VersionedRepository';
import type { WorkGraphExecution, WorkGraphRevision, WorkNode } from './WorkGraph';
import type { WorkGraphRepository } from './WorkGraphRepository';
import { workNodeId } from './WorkIds';
import {
  claimWorkNode,
  finalizeWorkGraph,
  markWorkNodeRunning,
  markWorkNodesBlocked,
  planWork,
  requireSynthesisInputs,
} from './WorkScheduler';

export type WorkNodeAgentDispatch =
  | { readonly kind: 'new-instance'; readonly command: PrepareAgentDispatchCommand }
  | { readonly kind: 'retry-instance'; readonly command: RetryAgentCommand };

export interface WorkNodeDispatchFactory {
  /** Must return the same durable identities for the same execution, node, and attempt. */
  create(input: {
    readonly graph: WorkGraphRevision;
    readonly execution: WorkGraphExecution;
    readonly node: WorkNode;
    readonly attempt: number;
    readonly inputResultIds: readonly AgentResultRecord['agentResultId'][];
  }): WorkNodeAgentDispatch;
}

export interface WorkRecoveryPorts {
  readonly dispatch: AgentDispatchPort;
  readonly dispatchRecovery: AgentDispatchRecoveryPort;
  readonly runRecovery: AgentRunRecoveryPort;
  readonly cancellationRecovery: AgentCancellationRecoveryPort;
}

export interface WorkCoordinatorNotification {
  readonly kind: 'execution-updated';
  readonly execution: Readonly<WorkGraphExecution>;
}

export type WorkCoordinatorListener = (notification: WorkCoordinatorNotification) => void;

export class WorkCoordinator {
  private readonly executionQueues = new Map<string, Promise<void>>();
  private readonly listeners = new Set<WorkCoordinatorListener>();

  constructor(
    readonly graphs: WorkGraphRepository,
    readonly agents: AgentCoordinator,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe(listener: WorkCoordinatorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispatchReady(
    executionId: string,
    factory: WorkNodeDispatchFactory,
    dispatchPort: AgentDispatchPort,
  ): Promise<WorkGraphExecution> {
    const execution = await this.enqueueExecution(executionId, async () => {
    while (true) {
      let execution = await requireCurrent(this.graphs.readExecution(executionId));
      const graph = await requireCurrent(
        this.graphs.readRevision(execution.payload.workGraphRevisionId),
      );
      const plan = planWork(graph.payload, execution.payload);
      if (plan.blockedNodeIds.length > 0) {
        execution = await this.graphs.updateExecution(
          execution.recordId,
          execution.revision,
          current => markWorkNodesBlocked(current, plan.blockedNodeIds, this.now()),
        );
        this.notify(execution.payload);
        continue;
      }
      const nodeId = plan.readyNodeIds[0];
      if (!nodeId) return (await this.finalize(graph.payload, execution)).payload;
      const node = requireNode(graph.payload, nodeId);
      const inputResultIds = node.kind === 'synthesis'
        ? requireSynthesisInputs(graph.payload, execution.payload, nodeId)
        : [];
      const dispatch = factory.create({
        graph: graph.payload,
        execution: execution.payload,
        node,
        attempt: requireNodeState(execution.payload, nodeId).attempt + 1,
        inputResultIds,
      });
      validateDispatchBinding(graph.payload, execution.payload, node, dispatch, inputResultIds);
      const command = dispatch.command;
      execution = await this.graphs.updateExecution(
        execution.recordId,
        execution.revision,
        current => claimWorkNode(
          graph.payload,
          current,
          nodeId,
          command.agentRunId,
          this.now(),
        ),
      );
      this.notify(execution.payload);
      try {
        if (dispatch.kind === 'new-instance') {
          await this.agents.prepareDispatch(dispatch.command);
        } else {
          await this.agents.prepareRetry(dispatch.command);
        }
      } catch (error) {
        if (error instanceof RevisionConflictError) throw error;
        execution = await this.failPreparingNode(
          execution,
          nodeId,
          'dispatch-preparation-failed',
        );
        this.notify(execution.payload);
        continue;
      }
      execution = await this.graphs.updateExecution(
        execution.recordId,
        execution.revision,
        current => markWorkNodeRunning(current, nodeId, this.now()),
      );
      this.notify(execution.payload);
      const run = await this.agents.dispatchPrepared(command.agentRunId, dispatchPort);
      execution = await this.syncNode(execution, nodeId, run);
      this.notify(execution.payload);
    }
    });
    this.notify(execution);
    return execution;
  }

  async recoverAll(
    factory: WorkNodeDispatchFactory,
    ports: WorkRecoveryPorts,
  ): Promise<readonly WorkGraphExecution[]> {
    await this.agents.recoverResultLinks();
    await this.agents.recoverPendingDispatches(ports.dispatchRecovery);
    await this.agents.recoverActiveRuns(ports.runRecovery, ports.cancellationRecovery);
    const recovered: WorkGraphExecution[] = [];
    for (const executionId of await this.graphs.listExecutionIds()) {
      recovered.push(await this.enqueueExecution(executionId, async () => {
        const execution = await requireCurrent(this.graphs.readExecution(executionId));
        return execution.payload.status === 'active'
          ? this.recoverExecution(execution, factory, ports.dispatch)
          : this.synchronizePersistedExecution(execution);
      }));
    }
    recovered.forEach(execution => this.notify(execution));
    return recovered;
  }

  /** Live bridge used by the application coordinator after any durable agent-run change. */
  async synchronizeAgentRun(run: AgentRunRecord): Promise<WorkGraphExecution | null> {
    if (!run.workGraphExecutionRef || !run.workNodeRef) return null;
    const execution = await this.enqueueExecution(run.workGraphExecutionRef, () => (
      this.synchronizeAgentRunWithRetry(run)
    ));
    this.notify(execution);
    return execution;
  }

  async synchronizeExecution(executionId: string): Promise<WorkGraphExecution> {
    const execution = await this.enqueueExecution(executionId, async () => {
      const execution = await requireCurrent(this.graphs.readExecution(executionId));
      return this.synchronizePersistedExecution(execution);
    });
    this.notify(execution);
    return execution;
  }

  private async synchronizeAgentRunWithRetry(run: AgentRunRecord): Promise<WorkGraphExecution> {
    const nodeId = workNodeId(run.workNodeRef!);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const authoritativeRun = await requireCurrent(
          this.agents.repositories.runs.read(run.agentRunId),
        );
        let execution = await requireCurrent(
          this.graphs.readExecution(run.workGraphExecutionRef!),
        );
        validateRunBinding(execution.payload, nodeId, authoritativeRun.payload);
        execution = await this.syncNode(execution, nodeId, authoritativeRun.payload);
        const graph = await requireCurrent(
          this.graphs.readRevision(execution.payload.workGraphRevisionId),
        );
        const plan = planWork(graph.payload, execution.payload);
        if (plan.blockedNodeIds.length > 0) {
          execution = await this.graphs.updateExecution(
            execution.recordId,
            execution.revision,
            current => markWorkNodesBlocked(current, plan.blockedNodeIds, this.now()),
          );
        }
        return (await this.finalize(graph.payload, execution)).payload;
      } catch (error) {
        if (!(error instanceof RevisionConflictError) || attempt >= 7) throw error;
      }
    }
  }

  private async recoverExecution(
    initial: VersionedRecord<WorkGraphExecution>,
    factory: WorkNodeDispatchFactory,
    dispatchPort: AgentDispatchPort,
  ): Promise<WorkGraphExecution> {
    let execution = initial;
    const graph = await requireCurrent(this.graphs.readRevision(execution.payload.workGraphRevisionId));
    for (const state of execution.payload.nodeStates) {
      if (state.state !== 'preparing' && state.state !== 'running') continue;
      if (!state.agentRunId) {
        execution = await this.failPreparingNode(execution, state.workNodeId, 'dispatch-record-missing');
        continue;
      }
      let runRead = await this.agents.repositories.runs.read(state.agentRunId);
      if (state.state === 'preparing' && runRead.kind === 'absent') {
        const node = requireNode(graph.payload, state.workNodeId);
        const dispatch = factory.create({
          graph: graph.payload,
          execution: execution.payload,
          node,
          attempt: state.attempt,
          inputResultIds: state.inputResultIds ?? [],
        });
        validateDispatchBinding(
          graph.payload,
          execution.payload,
          node,
          dispatch,
          state.inputResultIds ?? [],
        );
        if (dispatch.command.agentRunId !== state.agentRunId) {
          execution = await this.failPreparingNode(
            execution,
            state.workNodeId,
            'dispatch-identity-mismatch',
          );
          continue;
        }
        if (dispatch.kind === 'new-instance') {
          await this.agents.prepareDispatch(dispatch.command);
        } else {
          await this.agents.prepareRetry(dispatch.command);
        }
        runRead = await this.agents.repositories.runs.read(state.agentRunId);
      }
      if (runRead.kind === 'absent') {
        execution = await this.failPreparingNode(
          execution,
          state.workNodeId,
          'dispatch-record-missing',
        );
        continue;
      }
      const run = await requireCurrent(Promise.resolve(runRead));
      validateRunBinding(execution.payload, state.workNodeId, run.payload);
      if (state.state === 'preparing') {
        execution = await this.graphs.updateExecution(
          execution.recordId,
          execution.revision,
          current => markWorkNodeRunning(current, state.workNodeId, this.now()),
        );
      }
      let currentRun = run.payload;
      if (currentRun.state === 'dispatching' && currentRun.dispatchToken) {
        const intent = await requireCurrent(
          this.agents.repositories.dispatchIntents.read(currentRun.dispatchToken),
        );
        if (intent.payload.status === 'prepared') {
          currentRun = await this.agents.dispatchPrepared(currentRun.agentRunId, dispatchPort);
        }
      }
      execution = await this.syncNode(execution, state.workNodeId, currentRun);
    }
    const plan = planWork(graph.payload, execution.payload);
    if (plan.blockedNodeIds.length > 0) {
      execution = await this.graphs.updateExecution(
        execution.recordId,
        execution.revision,
        current => markWorkNodesBlocked(current, plan.blockedNodeIds, this.now()),
      );
    }
    return (await this.finalize(graph.payload, execution)).payload;
  }

  private async synchronizePersistedExecution(
    initial: VersionedRecord<WorkGraphExecution>,
  ): Promise<WorkGraphExecution> {
    let execution = initial;
    for (const state of initial.payload.nodeStates) {
      if (!state.agentRunId) continue;
      const run = await this.agents.repositories.runs.read(state.agentRunId);
      if (run.kind === 'current' || run.kind === 'migrated') {
        validateRunBinding(execution.payload, state.workNodeId, run.record.payload);
        execution = await this.syncNode(execution, state.workNodeId, run.record.payload);
      }
    }
    const graph = await requireCurrent(
      this.graphs.readRevision(execution.payload.workGraphRevisionId),
    );
    return (await this.finalize(graph.payload, execution)).payload;
  }

  private async syncNode(
    execution: VersionedRecord<WorkGraphExecution>,
    nodeId: WorkNode['workNodeId'],
    run: AgentRunRecord,
  ): Promise<VersionedRecord<WorkGraphExecution>> {
    const terminal = mapRunTerminal(run);
    const resultIds = [...run.resultIds, ...run.observedResultIds];
    if (!terminal) {
      return this.graphs.updateExecution(execution.recordId, execution.revision, current => ({
        ...current,
        nodeStates: current.nodeStates.map(state => state.workNodeId === nodeId
          ? { ...state, resultIds, updatedAt: this.now() }
          : state),
        updatedAt: this.now(),
      }));
    }
    return this.graphs.updateExecution(execution.recordId, execution.revision, current => ({
      ...current,
      nodeStates: current.nodeStates.map(state => state.workNodeId === nodeId
        ? {
          ...state,
          state: terminal.state,
          resultIds,
          terminalCode: terminal.code,
          updatedAt: this.now(),
        }
        : state),
      updatedAt: this.now(),
    }));
  }

  private failPreparingNode(
    execution: VersionedRecord<WorkGraphExecution>,
    nodeId: WorkNode['workNodeId'],
    terminalCode: string,
  ): Promise<VersionedRecord<WorkGraphExecution>> {
    return this.graphs.updateExecution(execution.recordId, execution.revision, current => ({
      ...current,
      nodeStates: current.nodeStates.map(state => state.workNodeId === nodeId
        ? { ...state, state: 'indeterminate', terminalCode, updatedAt: this.now() }
        : state),
      updatedAt: this.now(),
    }));
  }

  private async finalize(
    graph: WorkGraphRevision,
    execution: VersionedRecord<WorkGraphExecution>,
  ): Promise<VersionedRecord<WorkGraphExecution>> {
    const finalized = finalizeWorkGraph(graph, execution.payload, this.now());
    if (finalized === execution.payload) return execution;
    return this.graphs.updateExecution(
      execution.recordId,
      execution.revision,
      () => finalized,
    );
  }

  private enqueueExecution<T>(executionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.executionQueues.get(executionId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    this.executionQueues.set(executionId, tail);
    return operation.finally(() => {
      if (this.executionQueues.get(executionId) === tail) {
        this.executionQueues.delete(executionId);
      }
    });
  }

  private notify(execution: WorkGraphExecution): void {
    const notification: WorkCoordinatorNotification = {
      kind: 'execution-updated',
      execution,
    };
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
        // Durable scheduling cannot depend on a projection listener.
      }
    }
  }
}

function validateDispatchBinding(
  graph: WorkGraphRevision,
  execution: WorkGraphExecution,
  node: WorkNode,
  dispatch: WorkNodeAgentDispatch,
  inputResultIds: readonly AgentResultRecord['agentResultId'][],
): void {
  const work = dispatch.command.work;
  if (!work
    || work.workGraphRef !== graph.workGraphId
    || work.workGraphExecutionRef !== execution.workGraphExecutionId
    || work.workNodeRef !== node.workNodeId
    || dispatch.command.goalRef !== node.goalRef
    || !sameIds(work.inputResultIds ?? [], inputResultIds)
    || (dispatch.kind === 'new-instance'
      && (dispatch.command.rootOwner.kind !== 'work-graph'
        || dispatch.command.rootOwner.ownerId !== graph.workGraphId))) {
    throw new Error('Agent dispatch is not durably bound to its work node and graph owner.');
  }
  if (node.assignment.kind === 'managed-provider') {
    if (dispatch.kind !== 'new-instance'
      || dispatch.command.providerId !== node.assignment.providerId) {
      throw new Error('Managed-provider node requires a matching new agent instance dispatch.');
    }
  } else if (dispatch.kind !== 'retry-instance'
    || dispatch.command.agentInstanceId !== node.assignment.agentInstanceId) {
    throw new Error('Agent-instance node requires a retry of the assigned durable instance.');
  }
}

function validateRunBinding(
  execution: WorkGraphExecution,
  nodeId: WorkNode['workNodeId'],
  run: AgentRunRecord,
): void {
  if (run.workGraphExecutionRef !== execution.workGraphExecutionId
    || run.workGraphRef !== execution.workGraphId
    || run.workNodeRef !== nodeId
    || !sameIds(
      run.inputResultIds ?? [],
      requireNodeState(execution, nodeId).inputResultIds ?? [],
    )) {
    throw new Error('Agent run is bound to a different work node.');
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireNode(graph: WorkGraphRevision, nodeId: WorkNode['workNodeId']): WorkNode {
  const node = graph.nodes.find(candidate => candidate.workNodeId === nodeId);
  if (!node) throw new Error(`Work graph node "${nodeId}" is absent.`);
  return node;
}

function requireNodeState(execution: WorkGraphExecution, nodeId: WorkNode['workNodeId']) {
  const state = execution.nodeStates.find(candidate => candidate.workNodeId === nodeId);
  if (!state) throw new Error(`Work execution node "${nodeId}" is absent.`);
  return state;
}

function mapRunTerminal(run: AgentRunRecord): {
  readonly state: 'succeeded' | 'failed' | 'cancelled' | 'indeterminate';
  readonly code: string;
} | null {
  if (!run.terminal) return null;
  if (run.state === 'succeeded') return { state: 'succeeded', code: run.terminal.reason };
  if (run.state === 'cancelled') return { state: 'cancelled', code: run.terminal.reason };
  if (run.state === 'indeterminate') return { state: 'indeterminate', code: run.terminal.reason };
  return { state: 'failed', code: run.terminal.reason };
}

async function requireCurrent<T>(
  read: Promise<VersionedRecordReadResult<T>>,
): Promise<VersionedRecord<T>> {
  const result = await read;
  if (result.kind === 'current' || result.kind === 'migrated') return result.record;
  if (result.kind === 'future') throw new Error(`Record "${result.recordId}" requires migration.`);
  if (result.kind === 'corrupt') throw new Error(`Record "${result.recordId}" is corrupt: ${result.error}`);
  throw new Error('Required durable work record is absent.');
}
