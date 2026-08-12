import type {
  AgentInstanceRecord,
  AgentResultRecord,
  AgentRunRecord,
} from '@/core/agents/AgentContracts';
import type { AgentFidelityProfile } from '@/core/agents/AgentFidelity';
import {
  agentInstanceId,
  agentResultId,
  agentRunId,
} from '@/core/agents/AgentIds';
import { interactionId, runId } from '@/core/execution/ExecutionIds';
import type { VersionedRecord } from '@/core/persistence/VersionedRecord';
import type { WorkGraphExecution, WorkGraphRevision } from '@/core/work/WorkGraph';
import {
  workGraphExecutionId,
  workGraphId,
  workGraphRevisionId,
  workNodeId,
} from '@/core/work/WorkIds';
import {
  createAgentProjection,
  reduceAgentProjection,
  selectAgentWorkCards,
  selectAgentWorkProjection,
} from '@/features/chat/projections/AgentProjection';

const ROOT_ID = agentInstanceId(`agi-${'1'.repeat(32)}`);
const CHILD_ID = agentInstanceId(`agi-${'2'.repeat(32)}`);
const ROOT_RUN = agentRunId(`agr-${'3'.repeat(32)}`);
const CHILD_RUN = agentRunId(`agr-${'4'.repeat(32)}`);
const RETRY_RUN = agentRunId(`agr-${'5'.repeat(32)}`);
const RESULT_ID = agentResultId(`ares-${'6'.repeat(32)}`);
const OBSERVED_ID = agentResultId(`ares-${'7'.repeat(32)}`);
const MISSING_ID = agentResultId(`ares-${'8'.repeat(32)}`);
const GRAPH_ID = workGraphId(`wg-${'9'.repeat(32)}`);
const GRAPH_REVISION_ID = workGraphRevisionId(`wgr-${'a'.repeat(32)}`);
const EXECUTION_ID = workGraphExecutionId(`wge-${'b'.repeat(32)}`);
const NODE_ID = workNodeId(`wn-${'c'.repeat(32)}`);
const EXECUTION_RUN_ID = runId(`run-${'d'.repeat(32)}`);
const PENDING_NODE_ID = workNodeId(`wn-${'1'.repeat(32)}`);
const BLOCKED_NODE_ID = workNodeId(`wn-${'2'.repeat(32)}`);
const FAILED_NODE_ID = workNodeId(`wn-${'3'.repeat(32)}`);
const PREPARATION_FAILED_NODE_ID = workNodeId(`wn-${'4'.repeat(32)}`);

describe('AgentProjection', () => {
  it('builds an honest hierarchy with attempt history, work state, results, and actions', () => {
    let projection = createAgentProjection({ kind: 'conversation', ownerId: 'conversation-1' });
    projection = reduceAgentProjection(projection, {
      kind: 'result-record',
      record: result(ROOT_ID, ROOT_RUN, RESULT_ID, 'succeeded'),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'result-record',
      record: result(ROOT_ID, ROOT_RUN, OBSERVED_ID, 'succeeded', 'reconciled'),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'run-record',
      record: versioned(run(ROOT_ID, ROOT_RUN, 1, 'indeterminate', {
        resultIds: [RESULT_ID, MISSING_ID],
        observedResultIds: [OBSERVED_ID],
        workGraphExecutionRef: EXECUTION_ID,
        workNodeRef: NODE_ID,
        executionRunId: EXECUTION_RUN_ID,
      }), 2),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'interaction-record',
      record: {
        interactionId: interactionId(`ix-${'e'.repeat(32)}`),
        runId: EXECUTION_RUN_ID,
        kind: 'approval',
        presentationRef: 'approval-1',
        responseIds: ['allow', 'deny'],
        status: 'open',
        createdAt: 5,
        updatedAt: 5,
      },
      revision: 1,
    });
    projection = reduceAgentProjection(projection, {
      kind: 'run-record',
      record: versioned(run(ROOT_ID, RETRY_RUN, 2, 'running'), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'instance-record',
      record: versioned(instance(ROOT_ID, [ROOT_RUN, RETRY_RUN]), 2),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'instance-record',
      record: versioned(instance(CHILD_ID, [CHILD_RUN], {
        parentAgentInstanceId: ROOT_ID,
        origin: 'observed-native',
        executionMode: 'provider-native',
        observation: 'terminal-only',
      }), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'run-record',
      record: versioned(run(CHILD_ID, CHILD_RUN, 1, 'running'), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'fidelity-profile',
      providerId: 'provider-1',
      profile: fidelity({ cancellation: 'unsupported' }),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'work-graph-record',
      record: versioned(graph(), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'work-execution-record',
      record: versioned(execution(), 3),
    });

    const cards = selectAgentWorkCards(projection);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      agentInstanceId: ROOT_ID,
      observationConfidence: 'exact',
      actions: ['focus', 'expand-children', 'inspect-results', 'cancel'],
      attempts: [
        {
          agentRunId: ROOT_RUN,
          state: 'indeterminate',
          results: [{
            agentResultId: RESULT_ID,
            finalText: 'final text',
            artifacts: [{ artifactId: 'artifact-1', kind: 'file' }],
            changedFiles: [{ fileRef: 'file-1', change: 'modified' }],
            citations: [{ citationId: 'citation-1', sourceRef: 'source-1' }],
          }],
          observedResults: [{ agentResultId: OBSERVED_ID }],
          missingResultIds: [MISSING_ID],
          work: {
            workNodeId: NODE_ID,
            dependencyNodeIds: [],
            state: 'succeeded',
            resultIds: [RESULT_ID],
          },
          interactions: [{
            kind: 'approval',
            presentationRef: 'approval-1',
            responseIds: ['allow', 'deny'],
            status: 'open',
          }],
        },
        { agentRunId: RETRY_RUN, attempt: 2, state: 'running' },
      ],
      children: [{
        agentInstanceId: CHILD_ID,
        observationConfidence: 'terminal-only',
        actions: ['focus'],
      }],
    });
  });

  it('keeps newer durable revisions and expands hierarchy without changing lifecycle state', () => {
    let projection = createAgentProjection({ kind: 'conversation', ownerId: 'conversation-1' });
    projection = reduceAgentProjection(projection, {
      kind: 'instance-record',
      record: versioned(instance(ROOT_ID, [ROOT_RUN], { status: 'terminal' }), 2),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'instance-record',
      record: versioned(instance(ROOT_ID, [ROOT_RUN], { status: 'active' }), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'instance-record',
      record: versioned(instance(CHILD_ID, [CHILD_RUN], { parentAgentInstanceId: ROOT_ID }), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'run-record',
      record: versioned(run(ROOT_ID, ROOT_RUN, 1, 'succeeded'), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'run-record',
      record: versioned(run(CHILD_ID, CHILD_RUN, 1, 'running'), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'agent-expansion-changed',
      agentInstanceId: ROOT_ID,
      expanded: true,
    });

    expect(selectAgentWorkCards(projection)[0]).toMatchObject({
      status: 'terminal',
      expanded: true,
      actions: ['focus', 'collapse-children', 'retry'],
    });
  });

  it('never renders provider-native fidelity above the immutable provider capability ceiling', () => {
    let projection = createAgentProjection({ kind: 'conversation', ownerId: 'conversation-1' });
    projection = reduceAgentProjection(projection, {
      kind: 'instance-record',
      record: versioned(instance(ROOT_ID, [ROOT_RUN], {
        executionMode: 'provider-native',
        observation: 'full',
        nativeAgentRef: 'native-agent-1',
      }), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'run-record',
      record: versioned(run(ROOT_ID, ROOT_RUN, 1, 'running'), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'fidelity-profile',
      providerId: 'provider-1',
      profile: fidelity({
        stableIdentity: false,
        observation: 'opaque',
        cancellation: 'unsupported',
      }),
    });

    const card = selectAgentWorkCards(projection)[0];
    expect(card).toMatchObject({
      observation: 'opaque',
      observationConfidence: 'opaque',
      actions: ['focus'],
    });
    expect(card).not.toHaveProperty('nativeAgentRef');
  });

  it('uses durable interaction revisions when timestamps are equal', () => {
    let projection = createAgentProjection({ kind: 'conversation', ownerId: 'conversation-1' });
    projection = reduceAgentProjection(projection, {
      kind: 'instance-record',
      record: versioned(instance(ROOT_ID, [ROOT_RUN]), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'run-record',
      record: versioned(run(ROOT_ID, ROOT_RUN, 1, 'waiting', {
        executionRunId: EXECUTION_RUN_ID,
      }), 1),
    });
    const open = {
      interactionId: interactionId(`ix-${'f'.repeat(32)}`),
      runId: EXECUTION_RUN_ID,
      kind: 'question' as const,
      presentationRef: 'question-1',
      responseIds: ['answer-1'],
      status: 'open' as const,
      createdAt: 5,
      updatedAt: 5,
    };
    projection = reduceAgentProjection(projection, {
      kind: 'interaction-record',
      record: open,
      revision: 1,
    });
    projection = reduceAgentProjection(projection, {
      kind: 'interaction-record',
      record: { ...open, status: 'resolved', selectedResponseId: 'answer-1' },
      revision: 2,
    });

    expect(selectAgentWorkCards(projection)[0]?.attempts[0]?.interactions).toEqual([
      expect.objectContaining({
        status: 'resolved',
        selectedResponseId: 'answer-1',
        updatedAt: 5,
      }),
    ]);
  });

  it('projects pending, blocked, and preparation-failed work without agent instances', () => {
    let projection = createAgentProjection({ kind: 'conversation', ownerId: 'conversation-1' });
    projection = reduceAgentProjection(projection, {
      kind: 'work-graph-record',
      record: versioned(graph({
        nodes: [
          workNode(FAILED_NODE_ID),
          workNode(PENDING_NODE_ID),
          workNode(BLOCKED_NODE_ID, [FAILED_NODE_ID]),
          workNode(PREPARATION_FAILED_NODE_ID),
        ],
      }), 1),
    });
    projection = reduceAgentProjection(projection, {
      kind: 'work-execution-record',
      record: versioned(execution({
        status: 'indeterminate',
        nodeStates: [
          workState(FAILED_NODE_ID, 'failed', 'provider-failure'),
          workState(PENDING_NODE_ID, 'pending'),
          workState(BLOCKED_NODE_ID, 'blocked', 'dependency-failed'),
          workState(
            PREPARATION_FAILED_NODE_ID,
            'indeterminate',
            'dispatch-preparation-failed',
          ),
        ],
      }), 2),
    });

    const view = selectAgentWorkProjection(projection);

    expect(view.agentCards).toEqual([]);
    expect(view.workNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: PENDING_NODE_ID, state: 'pending' }),
      expect.objectContaining({
        workNodeId: BLOCKED_NODE_ID,
        state: 'blocked',
        blockedByNodeIds: [FAILED_NODE_ID],
      }),
      expect.objectContaining({
        workNodeId: PREPARATION_FAILED_NODE_ID,
        state: 'indeterminate',
        terminalCode: 'dispatch-preparation-failed',
      }),
    ]));
  });
});

function instance(
  id: AgentInstanceRecord['agentInstanceId'],
  runIds: AgentInstanceRecord['runIds'],
  overrides: Partial<AgentInstanceRecord> = {},
): AgentInstanceRecord {
  return {
    agentInstanceId: id,
    providerId: 'provider-1',
    definition: { definitionId: `definition-${id}`, revisionDigest: 'digest', source: 'grimoire' },
    executionMode: 'grimoire-managed',
    origin: 'grimoire-dispatched',
    rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
    attachment: 'attached',
    observation: 'full',
    runIds,
    status: 'active',
    createdAt: id === ROOT_ID ? 1 : 2,
    updatedAt: 2,
    ...overrides,
  };
}

function run(
  instanceId: AgentRunRecord['agentInstanceId'],
  id: AgentRunRecord['agentRunId'],
  attempt: number,
  state: AgentRunRecord['state'],
  overrides: Partial<AgentRunRecord> = {},
): AgentRunRecord {
  const terminal = ['succeeded', 'failed', 'cancelled', 'interrupted', 'invalidated', 'indeterminate']
    .includes(state)
    ? { kind: state as NonNullable<AgentRunRecord['terminal']>['kind'], reason: state === 'succeeded' ? 'completed' as const : 'effects-unknown' as const, occurredAt: 10 }
    : undefined;
  return {
    agentRunId: id,
    agentInstanceId: instanceId,
    attempt,
    goalRef: `goal-${attempt}`,
    policy: { granted: [], approvable: [], denied: [] },
    terminalTransactionId: `terminal-${attempt}`,
    state,
    resultIds: [],
    observedResultIds: [],
    ...(terminal ? { terminal } : {}),
    createdAt: attempt,
    updatedAt: 10,
    ...overrides,
  };
}

function result(
  instanceId: AgentResultRecord['agentInstanceId'],
  runRecordId: AgentResultRecord['agentRunId'],
  id: AgentResultRecord['agentResultId'],
  status: AgentResultRecord['status'],
  provenance: AgentResultRecord['provenance']['kind'] = 'grimoire-managed',
): AgentResultRecord {
  return {
    agentResultId: id,
    agentInstanceId: instanceId,
    agentRunId: runRecordId,
    status,
    summary: 'summary',
    finalText: 'final text',
    artifacts: [{ artifactId: 'artifact-1', kind: 'file' }],
    changedFiles: [{ fileRef: 'file-1', change: 'modified' }],
    citations: [{ citationId: 'citation-1', sourceRef: 'source-1' }],
    childResultIds: [],
    usage: { inputTokens: 1, outputTokens: 2 },
    provenance: { kind: provenance, providerId: 'provider-1', observedAt: 10 },
    completedAt: 10,
  };
}

function graph(overrides: Partial<WorkGraphRevision> = {}): WorkGraphRevision {
  return {
    workGraphRevisionId: GRAPH_REVISION_ID,
    workGraphId: GRAPH_ID,
    revision: 1,
    owner: { kind: 'conversation', ownerId: 'conversation-1' },
    nodes: [{
      workNodeId: NODE_ID,
      kind: 'agent',
      goalRef: 'goal-1',
      dependencyNodeIds: [],
      assignment: { kind: 'managed-provider', providerId: 'provider-1' },
      synthesisInputResultIds: [],
    }],
    maxParallel: 1,
    failurePolicy: 'fail-fast',
    synthesisPolicy: 'require-all',
    createdAt: 1,
    ...overrides,
  };
}

function execution(overrides: Partial<WorkGraphExecution> = {}): WorkGraphExecution {
  return {
    workGraphExecutionId: EXECUTION_ID,
    workGraphId: GRAPH_ID,
    workGraphRevisionId: GRAPH_REVISION_ID,
    graphRevision: 1,
    status: 'succeeded',
    nodeStates: [{
      workNodeId: NODE_ID,
      state: 'succeeded',
      attempt: 1,
      agentRunId: ROOT_RUN,
      resultIds: [RESULT_ID],
      updatedAt: 10,
    }],
    createdAt: 1,
    updatedAt: 10,
    ...overrides,
  };
}

function workNode(
  id: WorkGraphRevision['nodes'][number]['workNodeId'],
  dependencyNodeIds: WorkGraphRevision['nodes'][number]['dependencyNodeIds'] = [],
): WorkGraphRevision['nodes'][number] {
  return {
    workNodeId: id,
    kind: 'agent',
    goalRef: `goal-${id}`,
    dependencyNodeIds,
    assignment: { kind: 'managed-provider', providerId: 'provider-1' },
    synthesisInputResultIds: [],
  };
}

function workState(
  id: WorkGraphExecution['nodeStates'][number]['workNodeId'],
  state: WorkGraphExecution['nodeStates'][number]['state'],
  terminalCode?: string,
): WorkGraphExecution['nodeStates'][number] {
  return {
    workNodeId: id,
    state,
    attempt: 0,
    resultIds: [],
    ...(terminalCode ? { terminalCode } : {}),
    updatedAt: 10,
  };
}

function fidelity(overrides: Partial<AgentFidelityProfile> = {}): AgentFidelityProfile {
  return {
    definitionInventory: 'native',
    nativeSpawn: true,
    stableIdentity: true,
    observation: 'full',
    resultExtraction: 'native',
    cancellation: 'native',
    statusQuery: 'native',
    reattachment: 'native',
    ...overrides,
  };
}

function versioned<T>(payload: T, revision: number): VersionedRecord<T> {
  return {
    schemaVersion: 1,
    recordId: String(Object.values(payload as object)[0]),
    revision,
    updatedAt: revision,
    payload,
  };
}
