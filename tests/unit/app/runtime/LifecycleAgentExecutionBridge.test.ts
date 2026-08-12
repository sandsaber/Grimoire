import {
  type AgentExecutionLifecyclePort,
  catalogAgentExecutionProviderPort,
  LifecycleAgentExecutionBridge,
} from '@/app/runtime/LifecycleAgentExecutionBridge';
import type {
  AgentDispatchIntentRecord,
  AgentRunRecoveryQuery,
} from '@/core/agents/AgentContracts';
import { agentDispatchToken, agentInstanceId, agentRunId } from '@/core/agents/AgentIds';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '@/core/execution/ExecutionControlRecords';
import { executionSessionId, runId } from '@/core/execution/ExecutionIds';

const TOKEN = agentDispatchToken(`adt-${'1'.repeat(32)}`);
const SESSION_ID = executionSessionId(`es-${'1'.repeat(32)}`);
const RUN_ID = runId(`run-${'1'.repeat(32)}`);

describe('LifecycleAgentExecutionBridge', () => {
  it('dispatches a managed agent with deterministic execution identity', async () => {
    const fixture = createFixture();

    const outcome = await fixture.bridge.dispatch(dispatchRequest());

    expect(outcome).toEqual({
      kind: 'accepted',
      executionSessionId: SESSION_ID,
      executionRunId: RUN_ID,
    });
    expect(fixture.lifecycle.createSession).toHaveBeenCalledWith({
      backendId: executionBackendId('provider-codex'),
      executionSessionId: SESSION_ID,
      owner: { kind: 'agent-instance', ownerId: `agi-${'2'.repeat(32)}` },
    });
    expect(fixture.lifecycle.startRun).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        runId: RUN_ID,
        requestRef: `req-${'4'.repeat(32)}`,
        resultExpectation: 'required',
      }),
    );
  });

  it('recovers a lost dispatch acknowledgement without redispatch', async () => {
    const fixture = createFixture();
    fixture.sessions.set(SESSION_ID, executionSessionRecord({ runIds: [RUN_ID] }));
    fixture.runs.set(RUN_ID, executionRecord());

    await expect(fixture.bridge.dispatch(dispatchRequest())).resolves.toMatchObject({
      kind: 'accepted',
      executionRunId: RUN_ID,
    });
    expect(fixture.lifecycle.createSession).not.toHaveBeenCalled();
    expect(fixture.lifecycle.startRun).not.toHaveBeenCalled();
  });

  it('resumes the zero-run session window without creating another native session', async () => {
    const fixture = createFixture();
    fixture.sessions.set(SESSION_ID, executionSessionRecord());

    await expect(fixture.bridge.dispatch(dispatchRequest())).resolves.toMatchObject({
      kind: 'accepted',
      executionRunId: RUN_ID,
    });
    expect(fixture.lifecycle.createSession).not.toHaveBeenCalled();
    expect(fixture.lifecycle.startRun).toHaveBeenCalledTimes(1);
  });

  it('does not report a pending lifecycle dispatch as accepted', async () => {
    const fixture = createFixture();
    fixture.runs.set(RUN_ID, executionRecord({ dispatchState: 'pending' }));

    await expect(fixture.bridge.reconcile(dispatchRecoveryInput())).resolves.toEqual({
      kind: 'unknown',
      effectsPossible: true,
    });
  });

  it('cleans a recovered zero-run session before rejecting the safe dispatch', async () => {
    const fixture = createFixture();
    fixture.sessions.set(SESSION_ID, executionSessionRecord());

    await expect(fixture.bridge.reconcile(dispatchRecoveryInput())).resolves.toEqual({
      kind: 'rejected',
      code: 'recovery-safe',
    });
    expect(fixture.lifecycle.disposeSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it('maps lifecycle terminal and cancellation evidence without inventing success', async () => {
    const fixture = createFixture();
    fixture.sessions.set(SESSION_ID, executionSessionRecord({ runIds: [RUN_ID] }));
    fixture.runs.set(RUN_ID, executionRecord({
      state: 'failed',
      terminal: { kind: 'failed', reason: 'provider-failure', occurredAt: 5 },
    }));
    const query = recoveryQuery();

    await expect(fixture.bridge.reconcile(query)).resolves.toEqual({
      kind: 'terminal',
      status: 'failed',
      reason: 'provider-failure',
    });
    await expect(fixture.bridge.cancel(query)).resolves.toEqual({
      kind: 'terminal',
      status: 'failed',
    });
  });

  it('rejects direct provider-native dispatch before side effects', async () => {
    const fixture = createFixture();
    await expect(fixture.bridge.dispatch({
      ...dispatchRequest(),
      executionMode: 'provider-native',
    })).resolves.toEqual({
      kind: 'rejected',
      code: 'native-dispatch-unsupported',
      sideEffectFree: true,
    });
    expect(fixture.lifecycle.createSession).not.toHaveBeenCalled();
  });

  it('uses a targetable native-agent control without cancelling its parent run', async () => {
    const lifecycle = createFixture().lifecycle;
    const cancelNativeAgent = jest.fn(async () => ({ kind: 'cancelled' as const }));
    const bridge = new LifecycleAgentExecutionBridge(lifecycle, {
      backendId: () => executionBackendId('provider-claude'),
      cancelNativeAgent,
    });
    const current = recoveryQuery();
    const query: AgentRunRecoveryQuery = {
      instance: { ...current.instance, executionMode: 'provider-native' },
      run: { ...current.run, nativeAgentRef: 'task-1' },
    };

    await expect(bridge.cancel(query)).resolves.toEqual({ kind: 'cancelled' });
    expect(cancelNativeAgent).toHaveBeenCalledWith(query);
    expect(lifecycle.cancelRun).not.toHaveBeenCalled();
  });

  it('uses the declared agent port and preserves completion that wins a cancellation race', async () => {
    const lifecycle = createFixture().lifecycle;
    const backend = {};
    const cancel = jest.fn(async () => ({
      kind: 'terminal' as const,
      status: 'completed' as const,
    }));
    const waitForSettlement = jest.fn(async () => undefined);
    const providers = catalogAgentExecutionProviderPort({
      require: () => ({
        execution: { descriptor: { backendId: executionBackendId('provider-claude') } },
        capabilities: { agents: { cancellation: 'native' } },
        features: { ports: { agents: { cancel } } },
      }),
    }, {
      backends: { getBackend: () => backend },
      waitForSettlement,
    });
    const bridge = new LifecycleAgentExecutionBridge(lifecycle, providers);
    const current = recoveryQuery();
    const query: AgentRunRecoveryQuery = {
      instance: { ...current.instance, executionMode: 'provider-native' },
      run: { ...current.run, nativeAgentRef: 'task-1' },
    };

    await expect(bridge.cancel(query)).resolves.toEqual({
      kind: 'terminal',
      status: 'succeeded',
    });
    expect(cancel).toHaveBeenCalledWith(backend, {
      executionSessionId: query.run.executionSessionId,
      taskId: 'task-1',
    });
    expect(waitForSettlement).toHaveBeenCalledTimes(1);
    expect(lifecycle.cancelRun).not.toHaveBeenCalled();
  });

  it('maps authoritative stopped evidence to the same interrupted terminal as the lifecycle bridge', async () => {
    const providers = catalogAgentExecutionProviderPort({
      require: () => ({
        execution: { descriptor: { backendId: executionBackendId('provider-claude') } },
        capabilities: { agents: { cancellation: 'native' } },
        features: {
          ports: {
            agents: {
              cancel: async () => ({ kind: 'terminal' as const, status: 'stopped' as const }),
            },
          },
        },
      }),
    }, {
      backends: { getBackend: () => ({}) },
      waitForSettlement: async () => undefined,
    });
    const current = recoveryQuery();

    await expect(providers.cancelNativeAgent?.({
      instance: { ...current.instance, executionMode: 'provider-native' },
      run: { ...current.run, nativeAgentRef: 'task-1' },
    })).resolves.toEqual({ kind: 'terminal', status: 'interrupted' });
  });

  it('does not structurally discover native cancellation when capability is unsupported', async () => {
    const cancelNativeTask = jest.fn(async () => 'stopped');
    const providers = catalogAgentExecutionProviderPort({
      require: () => ({
        execution: { descriptor: { backendId: executionBackendId('provider-claude') } },
        capabilities: { agents: { cancellation: 'unsupported' } },
        features: { ports: {} },
      }),
    }, {
      backends: { getBackend: () => ({ cancelNativeTask }) },
      waitForSettlement: async () => undefined,
    });
    const current = recoveryQuery();

    await expect(providers.cancelNativeAgent?.({
      instance: { ...current.instance, executionMode: 'provider-native' },
      run: { ...current.run, nativeAgentRef: 'task-1' },
    })).resolves.toEqual({ kind: 'unknown' });
    expect(cancelNativeTask).not.toHaveBeenCalled();
  });

  it('fails closed instead of binding or cancelling a run owned by another agent', async () => {
    const fixture = createFixture();
    fixture.sessions.set(SESSION_ID, executionSessionRecord({
      owner: { kind: 'agent-instance', ownerId: `agi-${'9'.repeat(32)}` },
      runIds: [RUN_ID],
    }));
    fixture.runs.set(RUN_ID, executionRecord({
      owner: { kind: 'agent-instance', ownerId: `agi-${'9'.repeat(32)}` },
    }));
    const query = recoveryQuery();

    await expect(fixture.bridge.dispatch(dispatchRequest())).rejects.toThrow('durable ownership');
    await expect(fixture.bridge.reconcile(query)).resolves.toEqual({
      kind: 'unknown',
      effectsPossible: true,
    });
    await expect(fixture.bridge.cancel(query)).resolves.toEqual({ kind: 'unknown' });
    expect(fixture.lifecycle.cancelRun).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const runs = new Map<string, ExecutionRunRecord>();
  const sessions = new Map<string, ExecutionSessionRecord>();
  const lifecycle: jest.Mocked<AgentExecutionLifecyclePort> = {
    createSession: jest.fn(async command => {
      sessions.set(command.executionSessionId, executionSessionRecord({
        backendId: command.backendId,
        owner: command.owner,
      }));
      return command.executionSessionId;
    }),
    startRun: jest.fn(async (sessionId, request) => {
      runs.set(request.runId, executionRecord({ executionSessionId: sessionId }));
      const session = sessions.get(sessionId);
      if (session) sessions.set(sessionId, { ...session, runIds: [request.runId] });
      return request.runId;
    }),
    cancelRun: jest.fn(async (_runId, _reason) => undefined),
    disposeSession: jest.fn(async id => { sessions.delete(id); }),
    getSession: jest.fn(id => sessions.get(id) ?? null),
    getRun: jest.fn(id => runs.get(id) ?? null),
  };
  return {
    bridge: new LifecycleAgentExecutionBridge(lifecycle, {
      backendId: () => executionBackendId('provider-codex'),
    }),
    lifecycle,
    runs,
    sessions,
  };
}

function dispatchRecoveryInput(): {
  readonly intent: AgentDispatchIntentRecord;
  readonly instance: AgentRunRecoveryQuery['instance'];
  readonly run: AgentRunRecoveryQuery['run'];
} {
  const query = recoveryQuery();
  return {
    intent: {
      dispatchToken: TOKEN,
      dispatchStartTransactionId: `tx-${'6'.repeat(32)}`,
      settlementTransactionId: `tx-${'7'.repeat(32)}`,
      agentRunId: query.run.agentRunId,
      idempotency: 'provider-key',
      status: 'dispatching',
      createdAt: 1,
      updatedAt: 1,
    },
    instance: query.instance,
    run: query.run,
  };
}

function executionSessionRecord(
  overrides: Partial<ExecutionSessionRecord> = {},
): ExecutionSessionRecord {
  return {
    executionSessionId: SESSION_ID,
    sessionInstanceId: `si-${'6'.repeat(32)}`,
    backendId: executionBackendId('provider-codex'),
    backendGeneration: 1,
    owner: { kind: 'agent-instance', ownerId: `agi-${'2'.repeat(32)}` },
    status: 'active',
    runIds: [],
    lastSequence: 0,
    acceptedEventIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function dispatchRequest() {
  return {
    agentInstanceId: agentInstanceId(`agi-${'2'.repeat(32)}`),
    agentRunId: agentRunId(`agr-${'3'.repeat(32)}`),
    dispatchToken: TOKEN,
    providerId: 'codex',
    executionMode: 'grimoire-managed' as const,
    goalRef: `req-${'4'.repeat(32)}`,
    policy: { granted: [], approvable: [], denied: [] },
    idempotency: 'provider-key' as const,
  };
}

function recoveryQuery(): AgentRunRecoveryQuery {
  return {
    instance: {
      agentInstanceId: agentInstanceId(`agi-${'2'.repeat(32)}`),
      providerId: 'codex',
      definition: { definitionId: 'worker', revisionDigest: 'a'.repeat(64), source: 'grimoire' },
      executionMode: 'grimoire-managed',
      origin: 'grimoire-dispatched',
      rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
      attachment: 'attached',
      observation: 'full',
      runIds: [agentRunId(`agr-${'3'.repeat(32)}`)],
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
    run: {
      agentRunId: agentRunId(`agr-${'3'.repeat(32)}`),
      agentInstanceId: agentInstanceId(`agi-${'2'.repeat(32)}`),
      attempt: 1,
      goalRef: `req-${'4'.repeat(32)}`,
      policy: { granted: [], approvable: [], denied: [] },
      terminalTransactionId: `tx-${'5'.repeat(32)}`,
      executionSessionId: SESSION_ID,
      executionRunId: RUN_ID,
      state: 'running',
      resultIds: [],
      observedResultIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function executionRecord(
  overrides: Partial<ExecutionRunRecord> = {},
): ExecutionRunRecord {
  return {
    runId: RUN_ID,
    executionSessionId: SESSION_ID,
    owner: { kind: 'agent-instance', ownerId: `agi-${'2'.repeat(32)}` },
    resultExpectation: 'required',
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
