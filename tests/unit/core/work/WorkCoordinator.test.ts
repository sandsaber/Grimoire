import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type { AgentResultRecord } from '@/core/agents/AgentContracts';
import type {
  AgentCoordinatorScheduler,
  PrepareAgentDispatchCommand,
} from '@/core/agents/AgentCoordinator';
import { AgentCoordinator } from '@/core/agents/AgentCoordinator';
import {
  agentDispatchToken,
  agentInstanceId,
  agentResultId,
  agentRunId,
} from '@/core/agents/AgentIds';
import { executionSessionId, runId } from '@/core/execution/ExecutionIds';
import { WorkCoordinator, type WorkNodeDispatchFactory } from '@/core/work/WorkCoordinator';
import type { WorkGraphRevision, WorkNode } from '@/core/work/WorkGraph';
import { WorkGraphRepository } from '@/core/work/WorkGraphRepository';
import {
  workGraphExecutionId,
  workGraphId,
  workGraphRevisionId,
  workNodeId,
} from '@/core/work/WorkIds';
import { claimWorkNode,createWorkGraphExecution } from '@/core/work/WorkScheduler';

const GRAPH_ID = workGraphId(`wg-${'1'.repeat(32)}`);
const REVISION_ID = workGraphRevisionId(`wgr-${'2'.repeat(32)}`);
const EXECUTION_ID = workGraphExecutionId(`wge-${'3'.repeat(32)}`);
const NODE_A = workNodeId(`wn-${'a'.repeat(32)}`);
const NODE_B = workNodeId(`wn-${'b'.repeat(32)}`);

describe('WorkCoordinator', () => {
  it('publishes only a committed execution snapshot and isolates projection listeners', async () => {
    const fixture = await createFixture();
    const observed = jest.fn();
    fixture.work.subscribe(observed);
    fixture.work.subscribe(() => { throw new Error('projection listener failed'); });

    const execution = await fixture.work.dispatchReady(
      EXECUTION_ID,
      fixture.factory,
      { dispatch: async () => ({ kind: 'accepted' }) },
    );

    expect(observed).toHaveBeenCalledWith({
      kind: 'execution-updated',
      execution,
    });
    expect(execution.nodeStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: NODE_A, state: 'running' }),
    ]));
  });

  it('projects live agent completion and dispatches a newly unblocked dependency', async () => {
    const fixture = await createFixture();
    const dispatch = jest.fn(async () => ({ kind: 'accepted' as const }));

    let execution = await fixture.work.dispatchReady(EXECUTION_ID, fixture.factory, { dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(execution.nodeStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: NODE_A, state: 'running' }),
      expect.objectContaining({ workNodeId: NODE_B, state: 'pending' }),
    ]));

    const commandA = commandFor(NODE_A);
    const result = resultFor(commandA);
    const completedRun = await fixture.agents.appendResult(result);
    execution = (await fixture.work.synchronizeAgentRun(completedRun))!;
    expect(execution.nodeStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: NODE_A, state: 'succeeded' }),
    ]));

    execution = await fixture.work.dispatchReady(EXECUTION_ID, fixture.factory, { dispatch });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(execution.nodeStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: NODE_B, state: 'running' }),
    ]));
  });

  it('recovers a preparing node with deterministic identities and dispatches once', async () => {
    const fixture = await createFixture();
    const commandA = commandFor(NODE_A);
    const execution = await requireExecution(fixture.graphs, EXECUTION_ID);
    await fixture.graphs.updateExecution(execution.recordId, execution.revision, current => (
      claimWorkNode(fixture.graph, current, NODE_A, commandA.agentRunId, 2)
    ));
    const dispatch = jest.fn(async () => ({ kind: 'accepted' as const }));
    const dispatchRecovery = jest.fn(async () => ({
      kind: 'unknown' as const,
      effectsPossible: true,
    }));
    const runRecovery = jest.fn(async () => ({
      kind: 'unknown' as const,
      effectsPossible: true,
    }));
    const reconcileCancellation = jest.fn(async () => ({ kind: 'unknown' as const }));

    const recovered = await fixture.work.recoverAll(fixture.factory, {
      dispatch: { dispatch },
      dispatchRecovery: { reconcile: dispatchRecovery },
      runRecovery: { reconcile: runRecovery },
      cancellationRecovery: { reconcileCancellation },
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatchRecovery).not.toHaveBeenCalled();
    expect(runRecovery).not.toHaveBeenCalled();
    expect(reconcileCancellation).not.toHaveBeenCalled();
    expect(recovered[0]).toMatchObject({
      nodeStates: expect.arrayContaining([
        expect.objectContaining({ workNodeId: NODE_A, state: 'running' }),
      ]),
    });
  });

  it('links a committed result before run and graph recovery after restart', async () => {
    const fixture = await createFixture();
    await fixture.work.dispatchReady(EXECUTION_ID, fixture.factory, {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    const result = resultFor(commandFor(NODE_A));
    await fixture.agents.repositories.results.append(result.agentResultId, result);
    const agents = new AgentCoordinator(fixture.storage, {
      now: fixture.clock,
      scheduler: inertScheduler(),
    });
    const work = new WorkCoordinator(fixture.graphs, agents, fixture.clock);
    const runRecovery = jest.fn();

    const recovered = await work.recoverAll(fixture.factory, {
      dispatch: { dispatch: jest.fn() },
      dispatchRecovery: { reconcile: jest.fn() },
      runRecovery: { reconcile: runRecovery },
      cancellationRecovery: { reconcileCancellation: jest.fn() },
    });

    expect(runRecovery).not.toHaveBeenCalled();
    expect(recovered[0]).toMatchObject({
      nodeStates: expect.arrayContaining([
        expect.objectContaining({
          workNodeId: NODE_A,
          state: 'succeeded',
          resultIds: [result.agentResultId],
        }),
      ]),
    });
  });

  it('uses a committed result to arbitrate lost dispatch acknowledgement before recovery', async () => {
    const fixture = await createFixture();
    let markDispatched!: () => void;
    const dispatched = new Promise<void>(resolve => { markDispatched = resolve; });
    const abandoned = fixture.work.dispatchReady(EXECUTION_ID, fixture.factory, {
      dispatch: async () => {
        markDispatched();
        return new Promise(() => undefined);
      },
    });
    void abandoned.catch(() => undefined);
    await dispatched;
    const command = commandFor(NODE_A);
    const nativeSessionId = executionSessionId(`es-${'e'.repeat(32)}`);
    const nativeRunId = runId(`run-${'f'.repeat(32)}`);
    const result = resultFor(command, { nativeSessionId, nativeRunId });
    await fixture.agents.repositories.results.append(result.agentResultId, result);

    const agents = new AgentCoordinator(fixture.storage, {
      now: fixture.clock,
      scheduler: inertScheduler(),
    });
    const work = new WorkCoordinator(fixture.graphs, agents, fixture.clock);
    const recovered = await work.recoverAll(fixture.factory, {
      dispatch: { dispatch: jest.fn() },
      dispatchRecovery: {
        reconcile: async () => ({ kind: 'unknown', effectsPossible: true }),
      },
      runRecovery: { reconcile: jest.fn() },
      cancellationRecovery: { reconcileCancellation: jest.fn() },
    });

    expect(await agents.repositories.dispatchIntents.read(command.dispatchToken)).toMatchObject({
      kind: 'current',
      record: { payload: { status: 'accepted' } },
    });
    expect(await agents.repositories.runs.read(command.agentRunId)).toMatchObject({
      kind: 'current',
      record: {
        payload: {
          state: 'succeeded',
          resultIds: [result.agentResultId],
          executionSessionId: nativeSessionId,
          executionRunId: nativeRunId,
        },
      },
    });
    expect(recovered[0]).toMatchObject({
      nodeStates: expect.arrayContaining([
        expect.objectContaining({
          workNodeId: NODE_A,
          state: 'succeeded',
          resultIds: [result.agentResultId],
        }),
      ]),
    });
  });

  it('serializes simultaneous sibling completions without losing either node result', async () => {
    const fixture = await createFixture(graphDefinition({
      nodes: [node(NODE_A), node(NODE_B)],
      maxParallel: 2,
    }));
    await fixture.work.dispatchReady(EXECUTION_ID, fixture.factory, {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    const [runA, runB] = await Promise.all([
      fixture.agents.appendResult(resultFor(commandFor(NODE_A))),
      fixture.agents.appendResult(resultFor(commandFor(NODE_B))),
    ]);

    await Promise.all([
      fixture.work.synchronizeAgentRun(runA),
      fixture.work.synchronizeAgentRun(runB),
    ]);
    const execution = await fixture.work.synchronizeExecution(EXECUTION_ID);

    expect(execution.nodeStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: NODE_A, state: 'succeeded', resultIds: runA.resultIds }),
      expect.objectContaining({ workNodeId: NODE_B, state: 'succeeded', resultIds: runB.resultIds }),
    ]));
  });
});

async function createFixture(graph = graphDefinition()) {
  const storage = new TestDurableStorage();
  const clock = monotonicClock();
  const graphs = new WorkGraphRepository(storage, clock);
  await graphs.appendRevision(graph);
  await graphs.createExecution(createWorkGraphExecution(graph, EXECUTION_ID, clock()));
  const agents = new AgentCoordinator(storage, { now: clock, scheduler: inertScheduler() });
  const factory: WorkNodeDispatchFactory = {
    create: ({ node }) => ({ kind: 'new-instance', command: commandFor(node.workNodeId) }),
  };
  return {
    graph,
    storage,
    clock,
    graphs,
    agents,
    factory,
    work: new WorkCoordinator(graphs, agents, clock),
  };
}

function graphDefinition(overrides: Partial<WorkGraphRevision> = {}): WorkGraphRevision {
  return {
    workGraphRevisionId: REVISION_ID,
    workGraphId: GRAPH_ID,
    revision: 1,
    owner: { kind: 'conversation', ownerId: 'conversation-1' },
    nodes: [node(NODE_A), node(NODE_B, [NODE_A])],
    maxParallel: 1,
    failurePolicy: 'continue-independent',
    synthesisPolicy: 'require-all',
    createdAt: 1,
    ...overrides,
  };
}

function node(id: WorkNode['workNodeId'], dependencies: readonly WorkNode['workNodeId'][] = []): WorkNode {
  return {
    workNodeId: id,
    kind: 'agent',
    goalRef: `goal-${id.slice(-1)}`,
    dependencyNodeIds: dependencies,
    assignment: { kind: 'managed-provider', providerId: 'codex' },
    synthesisInputResultIds: [],
  };
}

function commandFor(nodeId: WorkNode['workNodeId']): PrepareAgentDispatchCommand {
  const isA = nodeId === NODE_A;
  const hex = isA ? 'a' : 'b';
  const transactionHexes = isA ? ['1', '2', '3', '4'] : ['5', '6', '7', '8'];
  return {
    prepareTransactionId: tx(transactionHexes[0]),
    dispatchStartTransactionId: tx(transactionHexes[1]),
    settlementTransactionId: tx(transactionHexes[2]),
    terminalTransactionId: tx(transactionHexes[3]),
    agentInstanceId: agentInstanceId(`agi-${hex.repeat(32)}`),
    agentRunId: agentRunId(`agr-${hex.repeat(32)}`),
    dispatchToken: agentDispatchToken(`adt-${hex.repeat(32)}`),
    providerId: 'codex',
    definition: {
      definitionId: `worker-${hex}`,
      revisionDigest: hex.repeat(64),
      source: 'grimoire',
    },
    executionMode: 'grimoire-managed',
    rootOwner: { kind: 'work-graph', ownerId: GRAPH_ID },
    attachment: 'detached',
    observation: 'none',
    goalRef: `goal-${hex}`,
    policyInputs: {
      provider: { granted: ['read'], approvable: [] },
      workspace: { granted: ['read'], approvable: [] },
      root: { granted: ['read'], approvable: [] },
      definition: { requested: ['read'], approvable: [] },
    },
    idempotency: 'none',
    work: {
      workGraphRef: GRAPH_ID,
      workGraphExecutionRef: EXECUTION_ID,
      workNodeRef: nodeId,
    },
  };
}

function resultFor(
  command: PrepareAgentDispatchCommand,
  identity?: {
    readonly nativeSessionId: AgentResultRecord['provenance']['executionSessionId'];
    readonly nativeRunId: AgentResultRecord['provenance']['executionRunId'];
  },
): AgentResultRecord {
  const resultHex = command.work?.workNodeRef === NODE_A ? 'c' : 'd';
  return {
    agentResultId: agentResultId(`ares-${resultHex.repeat(32)}`),
    agentInstanceId: command.agentInstanceId,
    agentRunId: command.agentRunId,
    status: 'succeeded',
    finalText: 'Worker result',
    artifacts: [],
    changedFiles: [],
    citations: [],
    childResultIds: [],
    provenance: {
      kind: 'grimoire-managed',
      providerId: 'codex',
      ...(identity
        ? {
          executionSessionId: identity.nativeSessionId,
          executionRunId: identity.nativeRunId,
        }
        : {}),
      observedAt: 10,
    },
    completedAt: 10,
  };
}

async function requireExecution(graphs: WorkGraphRepository, executionId: string) {
  const read = await graphs.readExecution(executionId);
  if (read.kind !== 'current' && read.kind !== 'migrated') throw new Error('Execution absent.');
  return read.record;
}

function tx(hex: string): string {
  return `tx-${hex.repeat(32)}`;
}

function monotonicClock(): () => number {
  let value = 1;
  return () => value++;
}

function inertScheduler(): AgentCoordinatorScheduler {
  return {
    setTimeout: () => 'inert-timer',
    clearTimeout: jest.fn(),
  };
}
