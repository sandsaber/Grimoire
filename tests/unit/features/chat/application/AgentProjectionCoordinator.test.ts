import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type { AgentResultRecord } from '@/core/agents/AgentContracts';
import {
  AgentCoordinator,
  type PrepareAgentDispatchCommand,
} from '@/core/agents/AgentCoordinator';
import type { AgentFidelityProfile } from '@/core/agents/AgentFidelity';
import {
  agentDispatchToken,
  agentInstanceId,
  agentResultId,
  agentRunId,
} from '@/core/agents/AgentIds';
import type { ExecutionInteractionRecord } from '@/core/execution/ExecutionControlRecords';
import { executionSessionId, interactionId, runId } from '@/core/execution/ExecutionIds';
import type { VersionedRecord, VersionedRecordReadResult } from '@/core/persistence/VersionedRecord';
import type { WorkCoordinatorListener } from '@/core/work/WorkCoordinator';
import { WorkCoordinator } from '@/core/work/WorkCoordinator';
import type { WorkGraphExecution, WorkGraphRevision } from '@/core/work/WorkGraph';
import { WorkGraphRepository } from '@/core/work/WorkGraphRepository';
import {
  workGraphExecutionId,
  workGraphId,
  workGraphRevisionId,
  workNodeId,
} from '@/core/work/WorkIds';
import { AgentProjectionCoordinator } from '@/features/chat/application/AgentProjectionCoordinator';

const INSTANCE_ID = agentInstanceId(`agi-${'1'.repeat(32)}`);
const RUN_ID = agentRunId(`agr-${'2'.repeat(32)}`);
const EXECUTION_SESSION_ID = executionSessionId(`es-${'7'.repeat(32)}`);
const EXECUTION_RUN_ID = runId(`run-${'8'.repeat(32)}`);
const MISSING_RESULT_ID = agentResultId(`ares-${'a'.repeat(32)}`);
const WORK_GRAPH_ID = workGraphId(`wg-${'b'.repeat(32)}`);
const WORK_GRAPH_REVISION_ID = workGraphRevisionId(`wgr-${'c'.repeat(32)}`);
const WORK_EXECUTION_ID = workGraphExecutionId(`wge-${'d'.repeat(32)}`);
const FAILED_WORK_NODE_ID = workNodeId(`wn-${'e'.repeat(32)}`);
const BLOCKED_WORK_NODE_ID = workNodeId(`wn-${'f'.repeat(32)}`);
const PENDING_WORK_NODE_ID = workNodeId(`wn-${'0'.repeat(32)}`);
const PREPARATION_FAILED_WORK_NODE_ID = workNodeId(`wn-${'9'.repeat(32)}`);

describe('AgentProjectionCoordinator', () => {
  it('shares one initial load across concurrent attachments', async () => {
    const gate = deferred<void>();
    const fixture = createFixture(gate.promise);
    const first = jest.fn();
    const second = jest.fn();

    const firstAttachment = fixture.projections.attach(fixture.owner, first);
    const secondAttachment = fixture.projections.attach(fixture.owner, second);
    gate.resolve();
    await Promise.all([firstAttachment, secondAttachment]);
    await fixture.agents.prepareDispatch(command());
    await fixture.projections.waitForIdle();

    expect(first).toHaveBeenLastCalledWith({
      agentCards: [expect.objectContaining({ agentInstanceId: INSTANCE_ID })],
      workNodes: [],
    });
    expect(second).toHaveBeenLastCalledWith({
      agentCards: [expect.objectContaining({ agentInstanceId: INSTANCE_ID })],
      workNodes: [],
    });
  });

  it('hydrates durable agents and refreshes attached cards after committed notifications', async () => {
    const fixture = createFixture();
    const snapshots: string[][] = [];
    const detach = await fixture.projections.attach(fixture.owner, view => {
      snapshots.push(view.agentCards.map(card => card.status));
    });

    await fixture.agents.prepareDispatch(command());
    await fixture.projections.waitForIdle();
    expect(fixture.projections.getProjection(fixture.owner)?.instances).toHaveLength(1);

    await fixture.agents.appendResult(result());
    await fixture.projections.waitForIdle();

    const view = await fixture.projections.load(fixture.owner);
    expect(view.agentCards).toEqual([
      expect.objectContaining({
        agentInstanceId: INSTANCE_ID,
        status: 'terminal',
        actions: ['focus', 'inspect-results', 'retry'],
        attempts: [expect.objectContaining({
          state: 'succeeded',
          results: [expect.objectContaining({
            finalText: 'durable result',
            provenance: { kind: 'grimoire-managed', providerId: 'provider-1', observedAt: 20 },
          })],
        })],
      }),
    ]);
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    detach();
  });

  it('binds interactions to the exact execution run owned by an agent attempt', async () => {
    const fixture = createFixture();
    await fixture.projections.load(fixture.owner);
    await fixture.agents.prepareAndDispatch(command(), {
      dispatch: async () => ({
        kind: 'accepted',
        executionSessionId: EXECUTION_SESSION_ID,
        executionRunId: EXECUTION_RUN_ID,
      }),
    });
    fixture.interactions.push({
      interactionId: interactionId(`ix-${'9'.repeat(32)}`),
      runId: EXECUTION_RUN_ID,
      kind: 'question',
      presentationRef: 'question-1',
      responseIds: ['answer-1'],
      status: 'open',
      createdAt: 10,
      updatedAt: 10,
    });
    await fixture.agents.appendResult(result({
      status: 'partial',
      executionSessionId: EXECUTION_SESSION_ID,
      executionRunId: EXECUTION_RUN_ID,
    }));
    await fixture.projections.waitForIdle();

    expect((await fixture.projections.load(fixture.owner)).agentCards[0]
      ?.attempts[0]?.interactions).toEqual([
      expect.objectContaining({
        kind: 'question',
        presentationRef: 'question-1',
        status: 'open',
      }),
    ]);
  });

  it('detaches UI listeners without cancelling or disposing agent ownership', async () => {
    const fixture = createFixture();
    const listener = jest.fn();
    const detach = await fixture.projections.attach(fixture.owner, listener);
    detach();

    await fixture.agents.prepareDispatch(command());
    await fixture.projections.waitForIdle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(await fixture.agents.repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'dispatching' } },
    });
  });

  it('stops publishing after disposal while durable changes continue', async () => {
    const fixture = createFixture();
    const listener = jest.fn();
    await fixture.projections.attach(fixture.owner, listener);
    fixture.projections.dispose();

    await fixture.agents.prepareDispatch(command());
    await fixture.projections.waitForIdle();

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(fixture.projections.load(fixture.owner)).rejects.toThrow('disposed');
    expect(await fixture.agents.repositories.runs.read(RUN_ID)).toMatchObject({ kind: 'current' });
  });

  it('publishes missing durable result references instead of dropping the agent card', async () => {
    const fixture = createFixture();
    await fixture.agents.prepareDispatch(command());
    const run = await requireCurrent(fixture.agents.repositories.runs.read(RUN_ID));
    await fixture.agents.repositories.runs.update(RUN_ID, run.revision, current => ({
      ...current,
      resultIds: [MISSING_RESULT_ID],
      updatedAt: 30,
    }));

    const view = await fixture.projections.load(fixture.owner);

    expect(view.agentCards[0]?.attempts[0]).toMatchObject({
      results: [],
      missingResultIds: [MISSING_RESULT_ID],
    });
  });

  it('retries initial hydration when a committed notification arrives after its snapshot', async () => {
    const snapshotCaptured = deferred<void>();
    const releaseSnapshot = deferred<void>();
    const fixture = createFixture(releaseSnapshot.promise, snapshotCaptured.resolve);

    const loading = fixture.projections.load(fixture.owner);
    await snapshotCaptured.promise;
    await fixture.agents.prepareDispatch(command());
    releaseSnapshot.resolve();

    await expect(loading).resolves.toMatchObject({
      agentCards: [expect.objectContaining({ agentInstanceId: INSTANCE_ID })],
    });
  });

  it('preserves a UI expansion change made during a durable refresh', async () => {
    const fixture = createFixture();
    await fixture.agents.prepareDispatch(command());
    await fixture.projections.load(fixture.owner);
    const snapshotCaptured = deferred<void>();
    const releaseSnapshot = deferred<void>();
    fixture.blockNextInstanceList(releaseSnapshot.promise, snapshotCaptured.resolve);

    fixture.emitWorkChange();
    await snapshotCaptured.promise;
    fixture.projections.setExpanded(fixture.owner, INSTANCE_ID, true);
    releaseSnapshot.resolve();
    await fixture.projections.waitForIdle();

    expect((await fixture.projections.load(fixture.owner)).agentCards[0]?.expanded).toBe(true);
  });

  it('hydrates work nodes that have no agent instance or run', async () => {
    const fixture = createFixture();
    await fixture.graphs.appendRevision(workGraph());
    await fixture.graphs.createExecution(workExecution());

    const view = await fixture.projections.load(fixture.owner);

    expect(view.agentCards).toEqual([]);
    expect(view.workNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ workNodeId: PENDING_WORK_NODE_ID, state: 'pending' }),
      expect.objectContaining({
        workNodeId: BLOCKED_WORK_NODE_ID,
        state: 'blocked',
        blockedByNodeIds: [FAILED_WORK_NODE_ID],
      }),
      expect.objectContaining({
        workNodeId: PREPARATION_FAILED_WORK_NODE_ID,
        state: 'indeterminate',
        terminalCode: 'dispatch-preparation-failed',
      }),
    ]));
  });
});

function createFixture(
  initialInstanceListGate: Promise<void> = Promise.resolve(),
  initialSnapshotCaptured: () => void = () => undefined,
) {
  const storage = new TestDurableStorage();
  let time = 1;
  const now = () => time++;
  const agents = new AgentCoordinator(storage, { now });
  const graphs = new WorkGraphRepository(storage, now);
  const work = new WorkCoordinator(graphs, agents, now);
  const interactions: ExecutionInteractionRecord[] = [];
  const workListeners = new Set<WorkCoordinatorListener>();
  let nextInstanceListGate = initialInstanceListGate;
  let snapshotCaptured = initialSnapshotCaptured;
  const projections = new AgentProjectionCoordinator({
    agents: {
      instances: {
        listRecordIds: async () => {
          const ids = await agents.repositories.instances.listRecordIds();
          const gate = nextInstanceListGate;
          const captured = snapshotCaptured;
          nextInstanceListGate = Promise.resolve();
          snapshotCaptured = () => undefined;
          captured();
          await gate;
          return ids;
        },
        read: id => agents.repositories.instances.read(id),
      },
      runs: agents.repositories.runs,
      results: agents.repositories.results,
    },
    work: graphs,
    agentChanges: agents,
    workChanges: {
      subscribe: listener => {
        workListeners.add(listener);
        const unsubscribe = work.subscribe(listener);
        return () => {
          workListeners.delete(listener);
          unsubscribe();
        };
      },
    },
    execution: {
      getInteractionSnapshotsForRun: targetRunId => interactions
        .filter(interaction => interaction.runId === targetRunId)
        .map((record, index) => ({ record, revision: index + 1 })),
      subscribe: () => () => undefined,
    },
    fidelityForProvider: () => fidelity(),
  });
  return {
    agents,
    graphs,
    projections,
    interactions,
    blockNextInstanceList: (gate: Promise<void>, captured: () => void) => {
      nextInstanceListGate = gate;
      snapshotCaptured = captured;
    },
    emitWorkChange: () => {
      const notification = {
        kind: 'execution-updated' as const,
        execution: workExecution(),
      };
      for (const listener of workListeners) listener(notification);
    },
    owner: { kind: 'conversation' as const, ownerId: 'conversation-1' },
  };
}

function command(): PrepareAgentDispatchCommand {
  return {
    prepareTransactionId: `tx-${'1'.repeat(32)}`,
    dispatchStartTransactionId: `tx-${'2'.repeat(32)}`,
    settlementTransactionId: `tx-${'3'.repeat(32)}`,
    terminalTransactionId: `tx-${'4'.repeat(32)}`,
    agentInstanceId: INSTANCE_ID,
    agentRunId: RUN_ID,
    dispatchToken: agentDispatchToken(`adt-${'5'.repeat(32)}`),
    providerId: 'provider-1',
    definition: {
      definitionId: 'reviewer',
      revisionDigest: 'a'.repeat(64),
      source: 'grimoire',
    },
    executionMode: 'grimoire-managed',
    rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
    attachment: 'attached',
    observation: 'full',
    goalRef: 'review-result',
    policyInputs: {
      provider: { granted: [], approvable: [] },
      workspace: { granted: [], approvable: [] },
      root: { granted: [], approvable: [] },
      definition: { requested: [], approvable: [] },
    },
    idempotency: 'provider-key',
  };
}

function result(overrides: {
  status?: AgentResultRecord['status'];
  executionSessionId?: AgentResultRecord['provenance']['executionSessionId'];
  executionRunId?: AgentResultRecord['provenance']['executionRunId'];
} = {}): AgentResultRecord {
  return {
    agentResultId: agentResultId(`ares-${'6'.repeat(32)}`),
    agentInstanceId: INSTANCE_ID,
    agentRunId: RUN_ID,
    status: overrides.status ?? 'succeeded',
    ...(overrides.status === 'partial'
      ? { partialText: 'durable partial result' }
      : { finalText: 'durable result' }),
    artifacts: [],
    changedFiles: [],
    citations: [],
    childResultIds: [],
    provenance: {
      kind: 'grimoire-managed',
      providerId: 'provider-1',
      ...(overrides.executionSessionId
        ? { executionSessionId: overrides.executionSessionId }
        : {}),
      ...(overrides.executionRunId ? { executionRunId: overrides.executionRunId } : {}),
      observedAt: 20,
    },
    completedAt: 20,
  };
}

function workGraph(): WorkGraphRevision {
  const node = (
    workNodeRecordId: WorkGraphRevision['nodes'][number]['workNodeId'],
    dependencyNodeIds: WorkGraphRevision['nodes'][number]['dependencyNodeIds'] = [],
  ): WorkGraphRevision['nodes'][number] => ({
    workNodeId: workNodeRecordId,
    kind: 'agent',
    goalRef: `goal-${workNodeRecordId}`,
    dependencyNodeIds,
    assignment: { kind: 'managed-provider', providerId: 'provider-1' },
    synthesisInputResultIds: [],
  });
  return {
    workGraphRevisionId: WORK_GRAPH_REVISION_ID,
    workGraphId: WORK_GRAPH_ID,
    revision: 1,
    owner: { kind: 'conversation', ownerId: 'conversation-1' },
    nodes: [
      node(FAILED_WORK_NODE_ID),
      node(PENDING_WORK_NODE_ID),
      node(BLOCKED_WORK_NODE_ID, [FAILED_WORK_NODE_ID]),
      node(PREPARATION_FAILED_WORK_NODE_ID),
    ],
    maxParallel: 2,
    failurePolicy: 'continue-independent',
    synthesisPolicy: 'allow-partial',
    createdAt: 1,
  };
}

function workExecution(): WorkGraphExecution {
  const state = (
    workNodeRecordId: WorkGraphExecution['nodeStates'][number]['workNodeId'],
    workNodeState: WorkGraphExecution['nodeStates'][number]['state'],
    terminalCode?: string,
  ): WorkGraphExecution['nodeStates'][number] => ({
    workNodeId: workNodeRecordId,
    state: workNodeState,
    attempt: 0,
    resultIds: [],
    ...(terminalCode ? { terminalCode } : {}),
    updatedAt: 5,
  });
  return {
    workGraphExecutionId: WORK_EXECUTION_ID,
    workGraphId: WORK_GRAPH_ID,
    workGraphRevisionId: WORK_GRAPH_REVISION_ID,
    graphRevision: 1,
    status: 'indeterminate',
    nodeStates: [
      state(FAILED_WORK_NODE_ID, 'failed', 'provider-failure'),
      state(PENDING_WORK_NODE_ID, 'pending'),
      state(BLOCKED_WORK_NODE_ID, 'blocked', 'dependency-failed'),
      state(PREPARATION_FAILED_WORK_NODE_ID, 'indeterminate', 'dispatch-preparation-failed'),
    ],
    createdAt: 1,
    updatedAt: 5,
  };
}

async function requireCurrent<TRecord>(
  read: Promise<VersionedRecordReadResult<TRecord>>,
): Promise<VersionedRecord<TRecord>> {
  const resultRecord = await read;
  if (resultRecord.kind === 'current' || resultRecord.kind === 'migrated') {
    return resultRecord.record;
  }
  throw new Error('Expected current record.');
}

function fidelity(): AgentFidelityProfile {
  return {
    definitionInventory: 'provider-files',
    nativeSpawn: false,
    stableIdentity: true,
    observation: 'full',
    resultExtraction: 'grimoire',
    cancellation: 'grimoire',
    statusQuery: 'grimoire',
    reattachment: 'grimoire',
  };
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
