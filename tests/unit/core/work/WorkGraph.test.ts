import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { agentResultId, agentRunId } from '@/core/agents/AgentIds';
import type { WorkGraphRevision, WorkNode } from '@/core/work/WorkGraph';
import { validateWorkGraph, WorkGraphValidationError } from '@/core/work/WorkGraph';
import { WorkGraphRepository } from '@/core/work/WorkGraphRepository';
import {
  workGraphExecutionId,
  workGraphId,
  workGraphRevisionId,
  workNodeId,
} from '@/core/work/WorkIds';
import {
  completeWorkNode,
  createWorkGraphExecution,
  finalizeWorkGraph,
  planWork,
  requireSynthesisInputs,
  startWorkNode,
} from '@/core/work/WorkScheduler';

const GRAPH_ID = workGraphId(`wg-${'1'.repeat(32)}`);
const REVISION_ID = workGraphRevisionId(`wgr-${'2'.repeat(32)}`);
const EXECUTION_ID = workGraphExecutionId(`wge-${'3'.repeat(32)}`);
const NODE_A = workNodeId(`wn-${'a'.repeat(32)}`);
const NODE_B = workNodeId(`wn-${'b'.repeat(32)}`);
const NODE_S = workNodeId(`wn-${'c'.repeat(32)}`);
const RESULT_A = agentResultId(`ares-${'4'.repeat(32)}`);
const RESULT_B = agentResultId(`ares-${'5'.repeat(32)}`);

describe('WorkGraph', () => {
  it('rejects missing dependencies and cycles before any scheduling decision', () => {
    const missing = graph([
      node(NODE_A, [workNodeId(`wn-${'d'.repeat(32)}`)]),
    ]);
    expect(() => validateWorkGraph(missing)).toThrow(WorkGraphValidationError);
    expect(() => validateWorkGraph(missing)).toThrow('depends on missing node');

    const cycle = graph([
      node(NODE_A, [NODE_B]),
      node(NODE_B, [NODE_A]),
    ]);
    expect(() => validateWorkGraph(cycle)).toThrow('contains a cycle');
  });

  it('stores immutable graph revisions that can only add new nodes', async () => {
    const repository = new WorkGraphRepository(new TestDurableStorage(), () => 10);
    const first = graph([node(NODE_A)], { synthesisNodeId: undefined });
    await repository.appendRevision(first);
    const execution = await repository.createExecution(
      createWorkGraphExecution(first, EXECUTION_ID, 1),
    );
    const second: WorkGraphRevision = {
      ...first,
      workGraphRevisionId: workGraphRevisionId(`wgr-${'6'.repeat(32)}`),
      revision: 2,
      previousRevisionId: first.workGraphRevisionId,
      nodes: [...first.nodes, node(NODE_B, [NODE_A])],
      createdAt: 2,
    };

    await expect(repository.appendRevision(second)).resolves.toMatchObject({ revision: 1 });
    await expect(repository.readLatestRevision(GRAPH_ID)).resolves.toMatchObject({
      payload: { workGraphRevisionId: second.workGraphRevisionId, revision: 2 },
    });
    await expect(repository.advanceExecutionRevision(
      EXECUTION_ID,
      execution.revision,
      second.workGraphRevisionId,
    )).resolves.toMatchObject({
      payload: {
        graphRevision: 2,
        nodeStates: [
          expect.objectContaining({ workNodeId: NODE_A, state: 'pending' }),
          expect.objectContaining({ workNodeId: NODE_B, state: 'pending' }),
        ],
      },
    });
    await expect(repository.appendRevision({
      ...second,
      workGraphRevisionId: workGraphRevisionId(`wgr-${'8'.repeat(32)}`),
    })).rejects.toThrow('does not extend the authoritative head');
    await expect(repository.appendRevision({
      ...second,
      workGraphRevisionId: workGraphRevisionId(`wgr-${'7'.repeat(32)}`),
      revision: 3,
      previousRevisionId: second.workGraphRevisionId,
      nodes: [
        { ...first.nodes[0], goalRef: 'changed-goal' },
        second.nodes[1],
      ],
      createdAt: 3,
    })).rejects.toThrow('changed across revisions');
  });

  it('retains sibling evidence and runs explicit partial synthesis with exact result IDs', () => {
    const definition = graph([
      node(NODE_A),
      node(NODE_B),
      {
        ...node(NODE_S, [NODE_A, NODE_B]),
        kind: 'synthesis',
        synthesisInputResultIds: [RESULT_A, RESULT_B],
      },
    ], { synthesisNodeId: NODE_S, synthesisPolicy: 'allow-partial', maxParallel: 2 });
    let execution = createWorkGraphExecution(definition, EXECUTION_ID, 1);
    expect(planWork(definition, execution).readyNodeIds).toEqual([NODE_A, NODE_B]);

    execution = startWorkNode(
      definition,
      execution,
      NODE_A,
      agentRunId(`agr-${'8'.repeat(32)}`),
      2,
    );
    execution = startWorkNode(
      definition,
      execution,
      NODE_B,
      agentRunId(`agr-${'9'.repeat(32)}`),
      3,
    );
    execution = completeWorkNode(execution, NODE_A, 'succeeded', [RESULT_A], 'completed', 4);
    execution = completeWorkNode(execution, NODE_B, 'failed', [RESULT_B], 'provider-failure', 5);

    expect(planWork(definition, execution).readyNodeIds).toEqual([NODE_S]);
    expect(requireSynthesisInputs(definition, execution, NODE_S)).toEqual([RESULT_A, RESULT_B]);
    execution = startWorkNode(
      definition,
      execution,
      NODE_S,
      agentRunId(`agr-${'d'.repeat(32)}`),
      6,
    );
    execution = completeWorkNode(execution, NODE_S, 'failed', [], 'synthesis-failure', 7);
    execution = finalizeWorkGraph(definition, execution, 8);

    expect(execution.status).toBe('failed');
    expect(execution.nodeStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: NODE_A, state: 'succeeded', resultIds: [RESULT_A] }),
      expect.objectContaining({ workNodeId: NODE_B, state: 'failed', resultIds: [RESULT_B] }),
    ]));
  });

  it('fails closed when synthesis references a result not produced by its dependencies', () => {
    const unknown = agentResultId(`ares-${'e'.repeat(32)}`);
    const definition = graph([
      node(NODE_A),
      {
        ...node(NODE_S, [NODE_A]),
        kind: 'synthesis',
        synthesisInputResultIds: [unknown],
      },
    ], { synthesisNodeId: NODE_S });
    let execution = createWorkGraphExecution(definition, EXECUTION_ID, 1);
    execution = startWorkNode(
      definition,
      execution,
      NODE_A,
      agentRunId(`agr-${'f'.repeat(32)}`),
      2,
    );
    execution = completeWorkNode(execution, NODE_A, 'succeeded', [RESULT_A], 'completed', 3);

    expect(() => planWork(definition, execution)).toThrow(
      'Synthesis inputs must reference exact dependency results',
    );
  });

  it('keeps independent siblings runnable after failure under continue-independent policy', () => {
    const definition = graph([node(NODE_A), node(NODE_B)], {
      synthesisNodeId: undefined,
      maxParallel: 1,
      failurePolicy: 'continue-independent',
    });
    let execution = createWorkGraphExecution(definition, EXECUTION_ID, 1);
    execution = startWorkNode(
      definition,
      execution,
      NODE_A,
      agentRunId(`agr-${'a'.repeat(32)}`),
      2,
    );
    execution = completeWorkNode(execution, NODE_A, 'failed', [RESULT_A], 'provider-failure', 3);

    expect(planWork(definition, execution)).toEqual({ readyNodeIds: [NODE_B], blockedNodeIds: [] });
  });
});

function graph(
  nodes: readonly WorkNode[],
  overrides: Partial<WorkGraphRevision> = {},
): WorkGraphRevision {
  return {
    workGraphRevisionId: REVISION_ID,
    workGraphId: GRAPH_ID,
    revision: 1,
    owner: { kind: 'conversation', ownerId: 'conversation-1' },
    nodes,
    maxParallel: 4,
    failurePolicy: 'continue-independent',
    synthesisPolicy: 'require-all',
    synthesisNodeId: NODE_S,
    createdAt: 1,
    ...overrides,
  };
}

function node(workNodeIdValue: WorkNode['workNodeId'], dependencies: readonly WorkNode['workNodeId'][] = []): WorkNode {
  return {
    workNodeId: workNodeIdValue,
    kind: 'agent',
    goalRef: `goal-${workNodeIdValue.slice(-1)}`,
    dependencyNodeIds: dependencies,
    assignment: { kind: 'managed-provider', providerId: 'codex' },
    synthesisInputResultIds: [],
  };
}
