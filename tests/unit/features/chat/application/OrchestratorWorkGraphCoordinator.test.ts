import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type { WorkNodeDispatchFactory } from '@/core/work/WorkCoordinator';
import { WorkGraphRepository } from '@/core/work/WorkGraphRepository';
import {
  workGraphExecutionId,
  workGraphId,
  workGraphRevisionId,
  workNodeId,
} from '@/core/work/WorkIds';
import {
  OrchestratorWorkGraphCoordinator,
  type OrchestratorWorkPlanCommand,
} from '@/features/chat/application/OrchestratorWorkGraphCoordinator';

describe('OrchestratorWorkGraphCoordinator', () => {
  it('persists dependencies and an explicit synthesis node before dispatch', async () => {
    const graphs = new WorkGraphRepository(new TestDurableStorage(), () => 10);
    const dispatchReady = jest.fn(async (_executionId, _factory, _port) => {
      const execution = await graphs.readExecution(EXECUTION_ID);
      if (execution.kind !== 'current') throw new Error('Expected durable execution.');
      return execution.record.payload;
    });
    const coordinator = createCoordinator(graphs, dispatchReady);

    const created = await coordinator.createAndDispatch(command());

    expect(dispatchReady).toHaveBeenCalledWith(EXECUTION_ID, FACTORY, DISPATCH_PORT);
    expect(created.graph).toMatchObject({
      workGraphId: GRAPH_ID,
      synthesisNodeId: NODE_SYNTHESIS,
      nodes: [
        expect.objectContaining({ workNodeId: NODE_RESEARCH, dependencyNodeIds: [] }),
        expect.objectContaining({
          workNodeId: NODE_REVIEW,
          dependencyNodeIds: [NODE_RESEARCH],
        }),
        expect.objectContaining({
          workNodeId: NODE_SYNTHESIS,
          kind: 'synthesis',
          dependencyNodeIds: [NODE_RESEARCH, NODE_REVIEW],
        }),
      ],
    });
    expect(created.execution.nodeStates).toEqual([
      expect.objectContaining({ workNodeId: NODE_RESEARCH, state: 'pending' }),
      expect.objectContaining({ workNodeId: NODE_REVIEW, state: 'pending' }),
      expect.objectContaining({ workNodeId: NODE_SYNTHESIS, state: 'pending' }),
    ]);
  });

  it('is replay-safe for the same stable plan identity and rejects semantic conflicts', async () => {
    const graphs = new WorkGraphRepository(new TestDurableStorage(), () => 10);
    const coordinator = createCoordinator(graphs, jest.fn());

    const first = await coordinator.create(command());
    const replay = await coordinator.create(command());

    expect(replay).toEqual(first);
    const current = await graphs.readExecution(EXECUTION_ID);
    if (current.kind !== 'current') throw new Error('Expected current execution.');
    await graphs.updateExecution(EXECUTION_ID, current.record.revision, execution => ({
      ...execution,
      updatedAt: 11,
    }));
    const progressedReplay = await coordinator.create(command());
    expect(progressedReplay.execution.updatedAt).toBe(11);
    await expect(coordinator.create({
      ...command(),
      maxParallel: 1,
    })).rejects.toThrow();
  });

  it('joins concurrent admission of the same stable plan identity', async () => {
    const graphs = new WorkGraphRepository(new TestDurableStorage(), () => 10);
    const coordinator = createCoordinator(graphs, jest.fn());

    const [first, replay] = await Promise.all([
      coordinator.create(command()),
      coordinator.create(command()),
    ]);

    expect(replay).toEqual(first);
    await expect(graphs.listExecutionIds()).resolves.toEqual([EXECUTION_ID]);
  });

  it('fails before persistence on cycles, unknown dependencies, and incomplete identity maps', async () => {
    const storage = new TestDurableStorage();
    const graphs = new WorkGraphRepository(storage, () => 10);
    const coordinator = createCoordinator(graphs, jest.fn());

    await expect(coordinator.create({
      ...command(),
      tasks: [
        { ...command().tasks[0], dependencyTaskIds: ['review'] },
        { ...command().tasks[1], dependencyTaskIds: ['research'] },
      ],
    })).rejects.toThrow('cycle');
    await expect(coordinator.create({
      ...command(),
      tasks: [{ ...command().tasks[0], dependencyTaskIds: ['missing'] }],
      synthesis: undefined,
    })).rejects.toThrow('unknown dependency');

    const incomplete = new OrchestratorWorkGraphCoordinator({
      graphs,
      work: { dispatchReady: jest.fn() },
      identities: {
        create: () => ({
          workGraphId: GRAPH_ID,
          workGraphRevisionId: REVISION_ID,
          workGraphExecutionId: EXECUTION_ID,
          nodeIds: { research: NODE_RESEARCH },
        }),
      },
      dispatchFactory: FACTORY,
      dispatchPort: DISPATCH_PORT,
    });
    await expect(incomplete.create(command())).rejects.toThrow('cover every task');
    await expect(graphs.listExecutionIds()).resolves.toEqual([]);
  });
});

const GRAPH_ID = workGraphId(`wg-${'1'.repeat(32)}`);
const REVISION_ID = workGraphRevisionId(`wgr-${'2'.repeat(32)}`);
const EXECUTION_ID = workGraphExecutionId(`wge-${'3'.repeat(32)}`);
const NODE_RESEARCH = workNodeId(`wn-${'a'.repeat(32)}`);
const NODE_REVIEW = workNodeId(`wn-${'b'.repeat(32)}`);
const NODE_SYNTHESIS = workNodeId(`wn-${'c'.repeat(32)}`);
const FACTORY = { create: jest.fn() } as unknown as WorkNodeDispatchFactory;
const DISPATCH_PORT = { dispatch: jest.fn() };

function createCoordinator(
  graphs: WorkGraphRepository,
  dispatchReady: jest.Mock,
): OrchestratorWorkGraphCoordinator {
  return new OrchestratorWorkGraphCoordinator({
    graphs,
    work: { dispatchReady },
    identities: {
      create: () => ({
        workGraphId: GRAPH_ID,
        workGraphRevisionId: REVISION_ID,
        workGraphExecutionId: EXECUTION_ID,
        nodeIds: {
          research: NODE_RESEARCH,
          review: NODE_REVIEW,
          synthesis: NODE_SYNTHESIS,
        },
      }),
    },
    dispatchFactory: FACTORY,
    dispatchPort: DISPATCH_PORT,
  });
}

function command(): OrchestratorWorkPlanCommand {
  return {
    planId: 'plan-1',
    owner: { kind: 'conversation', ownerId: 'conversation-1' },
    tasks: [{
      taskId: 'research',
      goalRef: 'goal-research',
      dependencyTaskIds: [],
      assignment: { kind: 'managed-provider', providerId: 'codex' },
    }, {
      taskId: 'review',
      goalRef: 'goal-review',
      dependencyTaskIds: ['research'],
      assignment: { kind: 'managed-provider', providerId: 'claude' },
    }],
    synthesis: {
      kind: 'synthesis',
      taskId: 'synthesis',
      goalRef: 'goal-synthesis',
      dependencyTaskIds: [],
      assignment: { kind: 'managed-provider', providerId: 'codex' },
    },
    maxParallel: 2,
    failurePolicy: 'continue-independent',
    synthesisPolicy: 'allow-partial',
    createdAt: 10,
  };
}
