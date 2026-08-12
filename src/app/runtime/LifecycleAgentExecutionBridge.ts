import type {
  AgentCancellationEvidence,
  AgentCancellationPort,
  AgentCancellationRecoveryPort,
  AgentDispatchIntentRecord,
  AgentDispatchOutcome,
  AgentDispatchPort,
  AgentDispatchRecoveryEvidence,
  AgentDispatchRecoveryPort,
  AgentDispatchRequest,
  AgentRunRecoveryEvidence,
  AgentRunRecoveryPort,
  AgentRunRecoveryQuery,
  AgentTerminalStatus,
} from '../../core/agents/AgentContracts';
import {
  type ExecutionBackendId,
  executionBackendId,
} from '../../core/execution/ExecutionBackendDescriptor';
import type {
  CancellationReason,
  ExecutionOwner,
  ResultExpectation,
} from '../../core/execution/ExecutionContracts';
import type {
  ExecutionRunRecord,
  ExecutionSessionRecord,
} from '../../core/execution/ExecutionControlRecords';
import {
  type ExecutionSessionId,
  executionSessionId,
  type RunId,
  runId,
} from '../../core/execution/ExecutionIds';
import type { ProviderId } from '../../core/types/provider';

export interface AgentExecutionLifecyclePort {
  createSession(command: {
    readonly backendId: ExecutionBackendId;
    readonly executionSessionId: ExecutionSessionId;
    readonly owner: ExecutionOwner;
  }): Promise<ExecutionSessionId>;
  startRun(
    executionSessionId: ExecutionSessionId,
    request: {
      readonly runId: RunId;
      readonly owner: ExecutionOwner;
      readonly resultExpectation: ResultExpectation;
      readonly requestRef: string;
    },
  ): Promise<RunId>;
  cancelRun(runId: RunId, reason?: CancellationReason): Promise<void>;
  disposeSession(executionSessionId: ExecutionSessionId): Promise<void>;
  getSession(executionSessionId: ExecutionSessionId): Readonly<ExecutionSessionRecord> | null;
  getRun(runId: RunId): Readonly<ExecutionRunRecord> | null;
}

export interface AgentExecutionProviderPort {
  backendId(providerId: ProviderId): ExecutionBackendId;
  cancelNativeAgent?(query: AgentRunRecoveryQuery): Promise<AgentCancellationEvidence>;
  reconcileNativeAgentCancellation?(
    query: AgentRunRecoveryQuery,
  ): Promise<AgentCancellationEvidence>;
}

/**
 * Makes Grimoire-managed agents ordinary durable execution owners. Dispatch
 * identity is derived from the durable dispatch token, so lost acknowledgements
 * reconcile without sending a second provider request.
 */
export class LifecycleAgentExecutionBridge implements
AgentDispatchPort,
AgentDispatchRecoveryPort,
AgentRunRecoveryPort,
AgentCancellationPort,
AgentCancellationRecoveryPort {
  constructor(
    private readonly lifecycle: AgentExecutionLifecyclePort,
    private readonly providers: AgentExecutionProviderPort,
  ) {}

  async dispatch(request: AgentDispatchRequest): Promise<AgentDispatchOutcome> {
    if (request.executionMode !== 'grimoire-managed') {
      return { kind: 'rejected', code: 'native-dispatch-unsupported', sideEffectFree: true };
    }
    const identities = dispatchIdentities(request.dispatchToken);
    const owner: ExecutionOwner = {
      kind: 'agent-instance',
      ownerId: request.agentInstanceId,
    };
    let run = this.lifecycle.getRun(identities.runId);
    if (!run) {
      let session = this.lifecycle.getSession(identities.executionSessionId);
      if (!session) {
        try {
        await this.lifecycle.createSession({
          backendId: this.providers.backendId(request.providerId),
          executionSessionId: identities.executionSessionId,
          owner,
        });
        } catch (error) {
          session = this.lifecycle.getSession(identities.executionSessionId);
          if (!session) throw error;
        }
        session = this.lifecycle.getSession(identities.executionSessionId);
      }
      requireDispatchSession(session, this.providers.backendId(request.providerId), owner);
      try {
        await this.lifecycle.startRun(identities.executionSessionId, {
          runId: identities.runId,
          owner,
          resultExpectation: 'required',
          requestRef: request.goalRef,
        });
        run = this.lifecycle.getRun(identities.runId);
      } catch (error) {
        run = this.lifecycle.getRun(identities.runId);
        if (!run) throw error;
      }
    }
    if (!run) throw new Error('Agent execution dispatch was not retained by the lifecycle registry.');
    requireDispatchIdentity(
      run,
      this.lifecycle.getSession(identities.executionSessionId),
      identities,
      this.providers.backendId(request.providerId),
      owner,
    );
    if (run.dispatchState === 'rejected') {
      return { kind: 'rejected', code: 'execution-dispatch-rejected', sideEffectFree: true };
    }
    if (run.dispatchState !== 'accepted') {
      throw new Error('Agent execution dispatch acceptance is not yet durable.');
    }
    return accepted(identities.executionSessionId, identities.runId, run.nativeRunRef);
  }

  reconcileRun(query: AgentRunRecoveryQuery): AgentRunRecoveryEvidence {
    const executionRunId = query.run.executionRunId;
    if (!executionRunId) return { kind: 'unknown', effectsPossible: false };
    const run = this.lifecycle.getRun(executionRunId);
    if (!run) return { kind: 'unknown', effectsPossible: true };
    if (!query.run.executionSessionId) return { kind: 'unknown', effectsPossible: true };
    const identities = {
      executionSessionId: query.run.executionSessionId,
      runId: executionRunId,
    };
    try {
      requireDispatchIdentity(
        run,
        this.lifecycle.getSession(query.run.executionSessionId),
        identities,
        this.providers.backendId(query.instance.providerId),
        { kind: 'agent-instance', ownerId: query.instance.agentInstanceId },
      );
    } catch {
      return { kind: 'unknown', effectsPossible: true };
    }
    if (!run.terminal) {
      return { kind: 'running', ...(run.nativeRunRef ? { nativeAgentRef: run.nativeRunRef } : {}) };
    }
    return {
      kind: 'terminal',
      status: terminalStatus(run.terminal.kind),
      reason: run.terminal.reason,
    };
  }

  reconcile(query: AgentRunRecoveryQuery): Promise<AgentRunRecoveryEvidence>;
  reconcile(input: {
    readonly intent: AgentDispatchIntentRecord;
    readonly instance: AgentRunRecoveryQuery['instance'];
    readonly run: AgentRunRecoveryQuery['run'];
  }): Promise<AgentDispatchRecoveryEvidence>;
  async reconcile(
    input: AgentRunRecoveryQuery | {
      readonly intent: AgentDispatchIntentRecord;
      readonly instance: AgentRunRecoveryQuery['instance'];
      readonly run: AgentRunRecoveryQuery['run'];
    },
  ): Promise<AgentRunRecoveryEvidence | AgentDispatchRecoveryEvidence> {
    if (!('intent' in input)) return this.reconcileRun(input);
    const identities = dispatchIdentities(input.intent.dispatchToken);
    const owner = { kind: 'agent-instance' as const, ownerId: input.instance.agentInstanceId };
    if (input.run.agentRunId !== input.intent.agentRunId
      || input.run.agentInstanceId !== input.instance.agentInstanceId) {
      return { kind: 'unknown', effectsPossible: true };
    }
    const run = this.lifecycle.getRun(identities.runId);
    if (!run) {
      const session = this.lifecycle.getSession(identities.executionSessionId);
      if (session) {
        try {
          requireDispatchSession(
            session,
            this.providers.backendId(input.instance.providerId),
            owner,
          );
        } catch {
          return { kind: 'unknown', effectsPossible: true };
        }
      }
      if (session && session.runIds.length > 0) {
        return { kind: 'unknown', effectsPossible: true };
      }
      if (session) await this.lifecycle.disposeSession(identities.executionSessionId);
      return { kind: 'rejected', code: 'recovery-safe' };
    }
    if (run.dispatchState === 'rejected') {
      return { kind: 'rejected', code: 'execution-dispatch-rejected' };
    }
    if (run.dispatchState !== 'accepted') {
      return { kind: 'unknown', effectsPossible: true };
    }
    try {
      requireDispatchIdentity(
        run,
        this.lifecycle.getSession(identities.executionSessionId),
        identities,
        this.providers.backendId(input.instance.providerId),
        owner,
      );
    } catch {
      return { kind: 'unknown', effectsPossible: true };
    }
    return accepted(
      identities.executionSessionId,
      identities.runId,
      run.nativeRunRef,
    );
  }

  async cancel(query: AgentRunRecoveryQuery): Promise<AgentCancellationEvidence> {
    if (query.instance.executionMode === 'provider-native') {
      return this.providers.cancelNativeAgent?.(query) ?? { kind: 'unknown' };
    }
    if (!query.run.executionSessionId || !query.run.executionRunId) return { kind: 'unknown' };
    const lifecycleRun = this.lifecycle.getRun(query.run.executionRunId);
    try {
      if (!lifecycleRun) return { kind: 'unknown' };
      requireDispatchIdentity(
        lifecycleRun,
        this.lifecycle.getSession(query.run.executionSessionId),
        {
          executionSessionId: query.run.executionSessionId,
          runId: query.run.executionRunId,
        },
        this.providers.backendId(query.instance.providerId),
        { kind: 'agent-instance', ownerId: query.instance.agentInstanceId },
      );
    } catch {
      return { kind: 'unknown' };
    }
    await this.lifecycle.cancelRun(query.run.executionRunId, { code: 'parent-cancelled' });
    return cancellationEvidence(this.lifecycle.getRun(query.run.executionRunId));
  }

  reconcileCancellation(query: AgentRunRecoveryQuery): Promise<AgentCancellationEvidence> {
    if (query.instance.executionMode === 'provider-native') {
      return this.providers.reconcileNativeAgentCancellation?.(query)
        ?? Promise.resolve({ kind: 'unknown' });
    }
    return Promise.resolve(cancellationEvidenceForManagedRun(
      query,
      this.lifecycle,
      this.providers,
    ));
  }
}

function cancellationEvidenceForManagedRun(
  query: AgentRunRecoveryQuery,
  lifecycle: AgentExecutionLifecyclePort,
  providers: AgentExecutionProviderPort,
): AgentCancellationEvidence {
  if (!query.run.executionSessionId || !query.run.executionRunId) return { kind: 'unknown' };
  const lifecycleRun = lifecycle.getRun(query.run.executionRunId);
  if (!lifecycleRun) return { kind: 'unknown' };
  try {
    requireDispatchIdentity(
      lifecycleRun,
      lifecycle.getSession(query.run.executionSessionId),
      {
        executionSessionId: query.run.executionSessionId,
        runId: query.run.executionRunId,
      },
      providers.backendId(query.instance.providerId),
      { kind: 'agent-instance', ownerId: query.instance.agentInstanceId },
    );
  } catch {
    return { kind: 'unknown' };
  }
  return cancellationEvidence(lifecycleRun);
}

function requireDispatchSession(
  session: Readonly<ExecutionSessionRecord> | null,
  backendId: ExecutionBackendId,
  owner: ExecutionOwner,
): void {
  if (!session
    || session.backendId !== backendId
    || session.status !== 'active'
    || session.owner.kind !== owner.kind
    || session.owner.ownerId !== owner.ownerId) {
    throw new Error('Agent execution session identity conflicts with durable ownership.');
  }
}

function requireDispatchIdentity(
  run: Readonly<ExecutionRunRecord>,
  session: Readonly<ExecutionSessionRecord> | null,
  identities: { readonly executionSessionId: ExecutionSessionId; readonly runId: RunId },
  backendId: ExecutionBackendId,
  owner: ExecutionOwner,
): void {
  requireDispatchSession(session, backendId, owner);
  if (run.runId !== identities.runId
    || run.executionSessionId !== identities.executionSessionId
    || run.owner.kind !== owner.kind
    || run.owner.ownerId !== owner.ownerId
    || !session?.runIds.includes(identities.runId)) {
    throw new Error('Agent execution run identity conflicts with durable ownership.');
  }
}

function dispatchIdentities(dispatchToken: string): {
  readonly executionSessionId: ExecutionSessionId;
  readonly runId: RunId;
} {
  const hex = /^adt-([0-9a-f]{32})$/.exec(dispatchToken)?.[1];
  if (!hex) throw new Error('Agent dispatch token cannot derive execution identity.');
  return {
    executionSessionId: executionSessionId(`es-${hex}`),
    runId: runId(`run-${hex}`),
  };
}

function accepted(
  sessionId: ExecutionSessionId,
  executionRunId: RunId,
  nativeAgentRef?: string,
): Extract<AgentDispatchOutcome, { readonly kind: 'accepted' }> {
  return {
    kind: 'accepted',
    executionSessionId: sessionId,
    executionRunId,
    ...(nativeAgentRef ? { nativeAgentRef } : {}),
  };
}

function cancellationEvidence(
  run: Readonly<ExecutionRunRecord> | null,
): AgentCancellationEvidence {
  if (!run?.terminal) return { kind: 'unknown' };
  if (run.terminal.kind === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'terminal', status: terminalStatus(run.terminal.kind) };
}

function terminalStatus(status: ExecutionRunRecord['state']): AgentTerminalStatus {
  if (status === 'succeeded'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted'
    || status === 'invalidated'
    || status === 'indeterminate') {
    return status;
  }
  throw new Error('Nonterminal execution state cannot terminalize an agent run.');
}

export function catalogAgentExecutionProviderPort(
  input: {
    require(providerId: ProviderId): {
      readonly execution: { readonly descriptor: { readonly backendId: ExecutionBackendId } };
      readonly capabilities: {
        readonly agents: { readonly cancellation: 'native' | 'grimoire' | 'unsupported' };
      };
      readonly features: {
        readonly ports: {
          readonly agents?: {
            cancel(
              backend: unknown,
              input: { readonly executionSessionId: string; readonly taskId: string },
            ): Promise<
              | { readonly kind: 'cancelled' }
              | {
                readonly kind: 'terminal';
                readonly status: 'completed' | 'failed' | 'stopped';
              }
            >;
          };
        };
      };
    };
  },
  native?: {
    readonly backends: { getBackend(providerId: ProviderId): unknown };
    /** Waits for lifecycle ingestion and native-agent result materialization. */
    waitForSettlement(): Promise<void>;
  },
): AgentExecutionProviderPort {
  return {
    backendId: providerId => executionBackendId(
      input.require(providerId).execution.descriptor.backendId,
    ),
    ...(native ? {
      cancelNativeAgent: async (query: AgentRunRecoveryQuery) => {
        const module = input.require(query.instance.providerId);
        const control = module.features.ports.agents;
        if (module.capabilities.agents.cancellation !== 'native'
          || !control
          || !query.run.executionSessionId
          || !query.run.nativeAgentRef) {
          return { kind: 'unknown' as const };
        }
        const outcome = await control.cancel(
          native.backends.getBackend(query.instance.providerId),
          {
          executionSessionId: query.run.executionSessionId,
          taskId: query.run.nativeAgentRef,
          },
        );
        await native.waitForSettlement();
        if (outcome.kind === 'cancelled') {
          return { kind: 'cancelled' as const };
        }
        return {
          kind: 'terminal' as const,
          status: outcome.status === 'completed'
            ? 'succeeded' as const
            : outcome.status === 'failed'
              ? 'failed' as const
              : 'interrupted' as const,
        };
      },
      reconcileNativeAgentCancellation: async () => ({ kind: 'unknown' as const }),
    } : {}),
  };
}
