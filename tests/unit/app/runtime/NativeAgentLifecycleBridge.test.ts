import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import {
  NativeAgentLifecycleBridge,
  type NativeAgentLifecyclePort,
} from '@/app/runtime/NativeAgentLifecycleBridge';
import {
  AgentCoordinator,
  type AgentCoordinatorScheduler,
} from '@/core/agents/AgentCoordinator';
import {
  agentDispatchToken,
  agentInstanceId,
  agentRunId,
} from '@/core/agents/AgentIds';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '@/core/execution/ExecutionControlRecords';
import {
  executionSessionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type {
  ExecutionLifecycleListener,
  ExecutionLifecycleNotification,
  ExecutionRunSnapshot,
} from '@/core/execution/ExecutionLifecycleRegistry';

const SESSION_ID = executionSessionId(`es-${'1'.repeat(32)}`);
const EXECUTION_RUN_ID = runId(`run-${'2'.repeat(32)}`);
const BACKEND_ID = executionBackendId('provider-claude');

describe('NativeAgentLifecycleBridge', () => {
  it('recovers a native agent tree and materializes exact durable child results', async () => {
    const fixture = createFixture(executionRecord({
      state: 'succeeded',
      terminal: { kind: 'succeeded', reason: 'completed', occurredAt: 20 },
      nativeAgentEvidence: [
        {
          nativeAgentKey: 'child-task',
          parentNativeAgentKey: 'parent-task',
          attachment: 'detached',
          resultRef: { resultId: 'result-child', storage: 'projection' },
          status: 'completed',
          activities: ['wait-observed'],
          observedAt: 12,
          updatedAt: 19,
        },
        {
          nativeAgentKey: 'parent-task',
          attachment: 'attached',
          status: 'waiting',
          activities: [],
          observedAt: 10,
          updatedAt: 11,
        },
      ],
    }));

    await fixture.bridge.recover();

    const instanceIds = await fixture.agents.repositories.instances.listRecordIds();
    expect(instanceIds).toHaveLength(2);
    const instances = await Promise.all(instanceIds.map(async id => (
      (await requireCurrent(fixture.agents.repositories.instances.read(id))).payload
    )));
    const parent = instances.find(instance => instance.nativeAgentRef === 'parent-task');
    const child = instances.find(instance => instance.nativeAgentRef === 'child-task');
    expect(parent).toMatchObject({
      rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
      status: 'active',
    });
    expect(child).toMatchObject({
      parentAgentInstanceId: parent?.agentInstanceId,
      parentAgentRunId: parent?.runIds[0],
      attachment: 'detached',
      status: 'terminal',
    });
    const childRun = await requireCurrent(
      fixture.agents.repositories.runs.read(child!.runIds[0]),
    );
    expect(childRun.payload).toMatchObject({
      executionSessionId: SESSION_ID,
      executionRunId: EXECUTION_RUN_ID,
      state: 'succeeded',
      resultIds: [expect.stringMatching(/^ares-[0-9a-f]{32}$/)],
    });
    const result = await requireCurrent(
      fixture.agents.repositories.results.read(childRun.payload.resultIds[0]),
    );
    expect(result.payload).toMatchObject({
      finalText: 'materialized:result-child',
      provenance: {
        kind: 'provider-native',
        providerId: 'claude',
        executionSessionId: SESSION_ID,
        executionRunId: EXECUTION_RUN_ID,
        nativeResultRef: 'result-child',
      },
    });
    expect(fixture.work.synchronizeAgentRun).toHaveBeenCalled();
  });

  it('projects a managed agent terminal result from its lifecycle run', async () => {
    const fixture = createFixture(executionRecord());
    const instanceId = agentInstanceId(`agi-${'3'.repeat(32)}`);
    const agentRun = agentRunId(`agr-${'4'.repeat(32)}`);
    await fixture.agents.prepareAndDispatch({
      prepareTransactionId: tx('1'),
      dispatchStartTransactionId: tx('2'),
      settlementTransactionId: tx('3'),
      terminalTransactionId: tx('4'),
      agentInstanceId: instanceId,
      agentRunId: agentRun,
      dispatchToken: agentDispatchToken(`adt-${'5'.repeat(32)}`),
      providerId: 'claude',
      definition: { definitionId: 'worker', revisionDigest: 'a'.repeat(64), source: 'grimoire' },
      executionMode: 'grimoire-managed',
      rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
      attachment: 'attached',
      observation: 'full',
      goalRef: `req-${'6'.repeat(32)}`,
      policyInputs: emptyPolicyInputs(),
      idempotency: 'provider-key',
    }, {
      dispatch: async () => ({
        kind: 'accepted',
        executionSessionId: SESSION_ID,
        executionRunId: EXECUTION_RUN_ID,
      }),
    });
    fixture.lifecycle.setRun(executionRecord({
      state: 'succeeded',
      resultRef: { resultId: 'result-managed', storage: 'projection' },
      terminal: {
        kind: 'succeeded',
        reason: 'completed',
        occurredAt: 30,
        resultRef: { resultId: 'result-managed', storage: 'projection' },
      },
    }));

    await fixture.bridge.waitForIdle();

    const durable = await requireCurrent(fixture.agents.repositories.runs.read(agentRun));
    expect(durable.payload).toMatchObject({
      state: 'succeeded',
      resultIds: [expect.stringMatching(/^ares-[0-9a-f]{32}$/)],
    });
    const result = await requireCurrent(
      fixture.agents.repositories.results.read(durable.payload.resultIds[0]),
    );
    expect(result.payload.provenance.kind).toBe('grimoire-managed');
  });

  it('materializes a terminal lifecycle result after lost dispatch acknowledgement is rebound', async () => {
    const fixture = createFixture(executionRecord({
      state: 'succeeded',
      owner: { kind: 'agent-instance', ownerId: `agi-${'c'.repeat(32)}` },
      resultRef: { resultId: 'result-lost-ack', storage: 'projection' },
      terminal: {
        kind: 'succeeded',
        reason: 'completed',
        occurredAt: 30,
        resultRef: { resultId: 'result-lost-ack', storage: 'projection' },
      },
      nativeAgentEvidence: [{
        nativeAgentKey: 'lost-ack-child',
        attachment: 'attached',
        status: 'completed',
        resultRef: { resultId: 'result-lost-ack-child', storage: 'projection' },
        activities: [],
        observedAt: 20,
        updatedAt: 29,
      }],
    }));
    const instanceId = agentInstanceId(`agi-${'c'.repeat(32)}`);
    const managedRunId = agentRunId(`agr-${'d'.repeat(32)}`);
    const token = agentDispatchToken(`adt-${'e'.repeat(32)}`);
    const command = {
      prepareTransactionId: tx('9'),
      dispatchStartTransactionId: tx('a'),
      settlementTransactionId: tx('b'),
      terminalTransactionId: tx('c'),
      agentInstanceId: instanceId,
      agentRunId: managedRunId,
      dispatchToken: token,
      providerId: 'claude' as const,
      definition: {
        definitionId: 'worker',
        revisionDigest: 'c'.repeat(64),
        source: 'grimoire' as const,
      },
      executionMode: 'grimoire-managed' as const,
      rootOwner: { kind: 'conversation' as const, ownerId: 'conversation-1' },
      attachment: 'attached' as const,
      observation: 'full' as const,
      goalRef: `req-${'d'.repeat(32)}`,
      policyInputs: emptyPolicyInputs(),
      idempotency: 'provider-key' as const,
    };
    await fixture.agents.prepareDispatch(command);
    let dispatchEntered!: () => void;
    const entered = new Promise<void>(resolve => { dispatchEntered = resolve; });
    const abandoned = fixture.agents.dispatchPrepared(managedRunId, {
      dispatch: async () => {
        dispatchEntered();
        return new Promise(() => undefined);
      },
    });
    void abandoned.catch(() => undefined);
    await entered;

    await fixture.bridge.recover();
    expect(await fixture.agents.repositories.runs.read(managedRunId)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'dispatching', resultIds: [] } },
    });
    await expect(fixture.agents.repositories.instances.listRecordIds()).resolves.toEqual([instanceId]);

    const restartedAgents = new AgentCoordinator(fixture.storage, {
      now: monotonicClock(),
      scheduler: passiveScheduler(),
    });
    const restartedBridge = createBridge(fixture.lifecycle, restartedAgents, fixture.work);
    await restartedAgents.recoverPendingDispatches({
      reconcile: async () => ({
        kind: 'accepted',
        executionSessionId: SESSION_ID,
        executionRunId: EXECUTION_RUN_ID,
      }),
    });
    await restartedBridge.recover();

    expect(await restartedAgents.repositories.dispatchIntents.read(token)).toMatchObject({
      kind: 'current',
      record: { payload: { status: 'accepted' } },
    });
    expect(await restartedAgents.repositories.runs.read(managedRunId)).toMatchObject({
      kind: 'current',
      record: {
        payload: {
          state: 'succeeded',
          executionSessionId: SESSION_ID,
          executionRunId: EXECUTION_RUN_ID,
          resultIds: [expect.stringMatching(/^ares-[0-9a-f]{32}$/)],
        },
      },
    });
    const instances = await Promise.all(
      (await restartedAgents.repositories.instances.listRecordIds()).map(async id => (
        await requireCurrent(restartedAgents.repositories.instances.read(id))
      )),
    );
    expect(instances.find(record => record.payload.nativeAgentRef === 'lost-ack-child')?.payload)
      .toMatchObject({
        parentAgentInstanceId: instanceId,
        parentAgentRunId: managedRunId,
        status: 'terminal',
      });
  });

  it('keeps live evidence serialized and fails closed on undeclared observation', async () => {
    const fixture = createFixture(executionRecord(), 'none');
    fixture.lifecycle.setRun(executionRecord({
      nativeAgentEvidence: [{
        nativeAgentKey: 'unexpected-task',
        attachment: 'attached',
        status: 'running',
        activities: [],
        observedAt: 1,
        updatedAt: 1,
      }],
    }));

    await expect(fixture.bridge.waitForIdle()).rejects.toThrow('declared observation');
    expect(await fixture.agents.repositories.instances.listRecordIds()).toEqual([]);
  });

  it('does not leave a late attached root agent active after parent cancellation', async () => {
    const fixture = createFixture(executionRecord({
      state: 'cancelled',
      cancellationRequested: true,
      terminal: {
        kind: 'cancelled',
        reason: 'cancellation-confirmed',
        occurredAt: 20,
      },
      nativeAgentEvidence: [{
        nativeAgentKey: 'late-attached-task',
        attachment: 'attached',
        status: 'running',
        activities: [],
        observedAt: 19,
        updatedAt: 21,
      }],
    }));

    await fixture.bridge.recover();

    const [instanceId] = await fixture.agents.repositories.instances.listRecordIds();
    const instance = await requireCurrent(fixture.agents.repositories.instances.read(instanceId));
    const run = await requireCurrent(
      fixture.agents.repositories.runs.read(instance.payload.runIds[0]),
    );
    expect(instance.payload.status).toBe('terminal');
    expect(run.payload).toMatchObject({
      state: 'indeterminate',
      terminal: { kind: 'indeterminate', reason: 'cancellation-unknown' },
    });
  });

  it('retries a transient child-before-parent projection on the next durable snapshot', async () => {
    const child = {
      nativeAgentKey: 'child-task',
      parentNativeAgentKey: 'parent-task',
      attachment: 'attached' as const,
      status: 'running' as const,
      activities: [],
      observedAt: 10,
      updatedAt: 10,
    };
    const fixture = createFixture(executionRecord({ nativeAgentEvidence: [child] }));

    await expect(fixture.bridge.recover()).rejects.toThrow('without its durable parent');

    fixture.lifecycle.setRun(executionRecord({
      nativeAgentEvidence: [
        {
          nativeAgentKey: 'parent-task',
          attachment: 'attached',
          status: 'running',
          activities: [],
          observedAt: 9,
          updatedAt: 9,
        },
        child,
      ],
    }));

    await expect(fixture.bridge.waitForIdle()).resolves.toBeUndefined();
    await expect(fixture.agents.repositories.instances.listRecordIds()).resolves.toHaveLength(2);
  });

  it('does not leave an attached native child active after its managed parent is cancelled', async () => {
    const fixture = createFixture(executionRecord({
      state: 'cancelled',
      cancellationRequested: true,
      terminal: { kind: 'cancelled', reason: 'cancellation-confirmed', occurredAt: 30 },
      nativeAgentEvidence: [{
        nativeAgentKey: 'managed-child',
        attachment: 'attached',
        status: 'running',
        activities: [],
        observedAt: 20,
        updatedAt: 31,
      }],
    }));
    const parentInstanceId = agentInstanceId(`agi-${'8'.repeat(32)}`);
    const parentRunId = agentRunId(`agr-${'9'.repeat(32)}`);
    await fixture.agents.prepareAndDispatch({
      prepareTransactionId: tx('5'),
      dispatchStartTransactionId: tx('6'),
      settlementTransactionId: tx('7'),
      terminalTransactionId: tx('8'),
      agentInstanceId: parentInstanceId,
      agentRunId: parentRunId,
      dispatchToken: agentDispatchToken(`adt-${'a'.repeat(32)}`),
      providerId: 'claude',
      definition: { definitionId: 'worker', revisionDigest: 'b'.repeat(64), source: 'grimoire' },
      executionMode: 'grimoire-managed',
      rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
      attachment: 'attached',
      observation: 'full',
      goalRef: `req-${'b'.repeat(32)}`,
      policyInputs: emptyPolicyInputs(),
      idempotency: 'provider-key',
    }, {
      dispatch: async () => ({
        kind: 'accepted',
        executionSessionId: SESSION_ID,
        executionRunId: EXECUTION_RUN_ID,
      }),
    });

    await fixture.bridge.recover();

    const child = (await Promise.all(
      (await fixture.agents.repositories.instances.listRecordIds()).map(async id => (
        await requireCurrent(fixture.agents.repositories.instances.read(id))
      )),
    )).find(record => record.payload.nativeAgentRef === 'managed-child');
    const childRun = await requireCurrent(
      fixture.agents.repositories.runs.read(child!.payload.runIds[0]),
    );
    expect(childRun.payload.terminal).toEqual({
      kind: 'indeterminate',
      reason: 'cancellation-unknown',
      occurredAt: expect.any(Number),
    });
  });

  it('settles queued terminal evidence after lifecycle shutdown removes its session', async () => {
    const fixture = createFixture(executionRecord({
      nativeAgentEvidence: [{
        nativeAgentKey: 'shutdown-child',
        attachment: 'attached',
        status: 'running',
        activities: [],
        observedAt: 10,
        updatedAt: 10,
      }],
    }));
    const blocked = deferred();
    const release = deferred();
    fixture.work.synchronizeAgentRun.mockImplementationOnce(async () => {
      blocked.resolve();
      await release.promise;
    });

    const initialRecovery = fixture.bridge.recover();
    await blocked.promise;
    fixture.lifecycle.setRun(executionRecord({
      state: 'cancelled',
      cancellationRequested: true,
      terminal: { kind: 'cancelled', reason: 'cancellation-confirmed', occurredAt: 30 },
      nativeAgentEvidence: [{
        nativeAgentKey: 'shutdown-child',
        attachment: 'attached',
        status: 'running',
        activities: [],
        observedAt: 10,
        updatedAt: 30,
      }],
    }));
    fixture.lifecycle.removeSession();
    release.resolve();

    await initialRecovery;
    await fixture.bridge.waitForIdle();
    const child = (await Promise.all(
      (await fixture.agents.repositories.instances.listRecordIds()).map(async id => (
        await requireCurrent(fixture.agents.repositories.instances.read(id))
      )),
    )).find(record => record.payload.nativeAgentRef === 'shutdown-child');
    const childRun = await requireCurrent(
      fixture.agents.repositories.runs.read(child!.payload.runIds[0]),
    );
    expect(childRun.payload.terminal).toMatchObject({
      kind: 'indeterminate',
      reason: 'cancellation-unknown',
    });
  });
});

function createFixture(
  initialRun: ExecutionRunRecord,
  observation: 'full' | 'none' = 'full',
) {
  const lifecycle = new FakeLifecycle(initialRun);
  const storage = new TestDurableStorage();
  const agents = new AgentCoordinator(storage, {
    now: monotonicClock(),
    scheduler: passiveScheduler(),
  });
  const work = { synchronizeAgentRun: jest.fn(async () => undefined) };
  const bridge = createBridge(lifecycle, agents, work, observation);
  return { lifecycle, storage, agents, work, bridge };
}

function createBridge(
  lifecycle: FakeLifecycle,
  agents: AgentCoordinator,
  work: { synchronizeAgentRun: jest.Mock },
  observation: 'full' | 'none' = 'full',
): NativeAgentLifecycleBridge {
  return new NativeAgentLifecycleBridge({
    lifecycle,
    agents,
    results: {
      materialize: async resultRef => ({
        resultRef,
        finalAssistantText: `materialized:${resultRef.resultId}`,
      }),
    },
    providers: {
      forBackend: backendId => backendId === BACKEND_ID
        ? { providerId: 'claude', observation }
        : null,
    },
    work,
  });
}

class FakeLifecycle implements NativeAgentLifecyclePort {
  private readonly listeners = new Set<ExecutionLifecycleListener>();
  private run: ExecutionRunRecord;
  private sessionAvailable = true;

  constructor(run: ExecutionRunRecord) {
    this.run = run;
  }

  getSession(): Readonly<ExecutionSessionRecord> | null {
    if (!this.sessionAvailable) return null;
    return {
      executionSessionId: SESSION_ID,
      sessionInstanceId: sessionInstanceId(`si-${'7'.repeat(32)}`),
      backendId: BACKEND_ID,
      backendGeneration: 1,
      owner: { kind: 'conversation', ownerId: 'conversation-1' },
      status: 'active',
      runIds: [EXECUTION_RUN_ID],
      lastSequence: this.run.lastSequence,
      acceptedEventIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
  }

  getRunSnapshots(): readonly ExecutionRunSnapshot[] {
    return [{ record: this.run, revision: 1 }];
  }

  subscribe(listener: ExecutionLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setRun(run: ExecutionRunRecord): void {
    this.run = run;
    const notification: ExecutionLifecycleNotification = {
      kind: 'run-updated',
      run,
      revision: 2,
    };
    this.listeners.forEach(listener => listener(notification));
  }

  removeSession(): void {
    this.sessionAvailable = false;
  }
}

function executionRecord(overrides: Partial<ExecutionRunRecord> = {}): ExecutionRunRecord {
  return {
    runId: EXECUTION_RUN_ID,
    executionSessionId: SESSION_ID,
    owner: { kind: 'conversation', ownerId: 'conversation-1' },
    resultExpectation: 'optional',
    state: 'running',
    dispatchState: 'accepted',
    cancellationRequested: false,
    openInteractionIds: [],
    lastSequence: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function emptyPolicyInputs() {
  return {
    provider: { granted: [], approvable: [] },
    workspace: { granted: [], approvable: [] },
    root: { granted: [], approvable: [] },
    definition: { requested: [], approvable: [] },
  };
}

function tx(hex: string): string {
  return `tx-${hex.repeat(32)}`;
}

function monotonicClock(): () => number {
  let value = 100;
  return () => value++;
}

function passiveScheduler(): AgentCoordinatorScheduler {
  return {
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(settle => { resolve = settle; });
  return { promise, resolve };
}

async function requireCurrent<T>(read: Promise<{
  readonly kind: string;
  readonly record?: { readonly payload: T };
}>): Promise<{ readonly payload: T }> {
  const result = await read;
  if ((result.kind !== 'current' && result.kind !== 'migrated') || !result.record) {
    throw new Error(`Expected current record, received ${result.kind}.`);
  }
  return result.record;
}
