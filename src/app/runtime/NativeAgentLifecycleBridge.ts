import { createHash } from 'node:crypto';

import type {
  AgentInstanceRecord,
  AgentObservationFidelity,
  AgentResultRecord,
  AgentRunRecord,
  AgentTerminalStatus,
} from '../../core/agents/AgentContracts';
import type {
  AgentCoordinator,
  AgentDispatchPolicyInputs,
} from '../../core/agents/AgentCoordinator';
import {
  adoptedAgentInstanceId,
  type AgentInstanceId,
  agentResultId,
  type AgentRunId,
  agentRunId,
  nativeAgentAdoptionKey,
} from '../../core/agents/AgentIds';
import type { ExecutionBackendId } from '../../core/execution/ExecutionBackendDescriptor';
import type {
  ExecutionOwner,
  ResultRef,
  RunTerminalKind,
} from '../../core/execution/ExecutionContracts';
import type {
  ExecutionRunRecord,
  ExecutionSessionRecord,
  NativeAgentEvidenceRecord,
} from '../../core/execution/ExecutionControlRecords';
import { executionSessionId, runId } from '../../core/execution/ExecutionIds';
import type {
  ExecutionLifecycleListener,
  ExecutionRunSnapshot,
} from '../../core/execution/ExecutionLifecycleRegistry';
import type { VersionedRecordReadResult } from '../../core/persistence/VersionedRecord';
import type { ProviderAgentObservation } from '../../core/providers/ProviderModule';
import type { ProviderId } from '../../core/types/provider';
import type { MaterializedChatResult } from '../../features/chat/projections/ChatProjection';

export interface NativeAgentLifecyclePort {
  getSession(executionSessionId: string): Readonly<ExecutionSessionRecord> | null;
  getRunSnapshots(): readonly ExecutionRunSnapshot[];
  subscribe(listener: ExecutionLifecycleListener): () => void;
}

export interface NativeAgentProviderProfile {
  readonly providerId: ProviderId;
  readonly observation: ProviderAgentObservation;
}

export interface NativeAgentProviderProfilePort {
  forBackend(backendId: ExecutionBackendId): NativeAgentProviderProfile | null;
}

export interface NativeAgentResultMaterializer {
  materialize(resultRef: ResultRef): Promise<MaterializedChatResult>;
}

export interface NativeAgentWorkPort {
  synchronizeAgentRun(run: AgentRunRecord): Promise<unknown>;
}

export interface NativeAgentRootPolicyPort {
  resolve(input: {
    readonly providerId: ProviderId;
    readonly owner: ExecutionOwner;
  }): Promise<AgentDispatchPolicyInputs>;
}

export interface NativeAgentLifecycleBridgeOptions {
  readonly lifecycle: NativeAgentLifecyclePort;
  readonly agents: AgentCoordinator;
  readonly results: NativeAgentResultMaterializer;
  readonly providers: NativeAgentProviderProfilePort;
  readonly work: NativeAgentWorkPort;
  readonly rootPolicy?: NativeAgentRootPolicyPort;
}

/** Materializes the durable execution agent ledger into durable Agent records. */
export class NativeAgentLifecycleBridge {
  private readonly unsubscribe: () => void;
  private tail: Promise<void> = Promise.resolve();
  private readonly failures = new Map<string, unknown>();
  private disposed = false;

  constructor(private readonly options: NativeAgentLifecycleBridgeOptions) {
    this.unsubscribe = options.lifecycle.subscribe(notification => {
      if (notification.kind !== 'run-updated') return;
      const profile = this.profileFor(notification.run);
      this.enqueue(notification.run.runId, () => this.syncRun(notification.run, profile));
    });
  }

  async recover(): Promise<void> {
    this.requireOpen();
    for (const snapshot of this.options.lifecycle.getRunSnapshots()) {
      const profile = this.profileFor(snapshot.record);
      this.enqueue(snapshot.record.runId, () => this.syncRun(snapshot.record, profile));
    }
    await this.waitForIdle();
  }

  async waitForIdle(): Promise<void> {
    await this.tail;
    const failure = this.failures.values().next().value;
    if (failure !== undefined) {
      throw failure instanceof Error
        ? failure
        : new Error('Native agent lifecycle synchronization failed.', { cause: failure });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
  }

  private enqueue(executionRunId: string, operation: () => Promise<void>): void {
    this.tail = this.tail
      .catch(() => undefined)
      .then(async () => {
        try {
          await operation();
          this.failures.delete(executionRunId);
        } catch (error) {
          this.failures.set(executionRunId, error);
        }
      });
  }

  private async syncRun(
    executionRun: Readonly<ExecutionRunRecord>,
    capturedProfile: NativeAgentProviderProfile | null,
  ): Promise<void> {
    await this.syncManagedAgent(executionRun);
    const profile = capturedProfile ?? this.profileFor(executionRun);
    if (!profile) return;
    const evidence = executionRun.nativeAgentEvidence ?? [];
    const byKey = new Map(evidence.map(entry => [entry.nativeAgentKey, entry]));
    const completed = new Set<string>();
    const visiting = new Set<string>();
    const syncEvidence = async (entry: NativeAgentEvidenceRecord): Promise<void> => {
      if (completed.has(entry.nativeAgentKey)) return;
      if (visiting.has(entry.nativeAgentKey)) {
        throw new Error('Native agent evidence contains a parent cycle.');
      }
      visiting.add(entry.nativeAgentKey);
      if (entry.parentNativeAgentKey) {
        const parent = byKey.get(entry.parentNativeAgentKey);
        if (parent) await syncEvidence(parent);
      }
      await this.syncNativeAgent(executionRun, profile, entry);
      visiting.delete(entry.nativeAgentKey);
      completed.add(entry.nativeAgentKey);
    };
    for (const entry of evidence) await syncEvidence(entry);
  }

  private profileFor(
    executionRun: Readonly<ExecutionRunRecord>,
  ): NativeAgentProviderProfile | null {
    const session = this.options.lifecycle.getSession(executionRun.executionSessionId);
    return session
      ? this.options.providers.forBackend(session.backendId as ExecutionBackendId)
      : null;
  }

  private async syncManagedAgent(executionRun: Readonly<ExecutionRunRecord>): Promise<void> {
    const owning = await this.findManagedAgentRun(executionRun.runId);
    if (!owning || !executionRun.terminal) return;
    const status = terminalStatus(executionRun.terminal.kind);
    const updated = executionRun.resultRef && status !== 'invalidated'
      ? await this.appendExecutionResult(
        owning.instance,
        owning.run,
        executionRun.resultRef,
        status,
        executionRun.terminal.occurredAt,
        'grimoire-managed',
      )
      : await this.options.agents.completeRun(
        owning.run.agentRunId,
        status,
        executionRun.terminal.reason,
      );
    await this.options.work.synchronizeAgentRun(updated);
  }

  private async syncNativeAgent(
    executionRun: Readonly<ExecutionRunRecord>,
    profile: NativeAgentProviderProfile,
    evidence: NativeAgentEvidenceRecord,
  ): Promise<void> {
    const observation = requireAdoptableObservation(profile.observation);
    const identity = nativeIdentity(
      profile.providerId,
      executionRun.executionSessionId,
      executionRun.runId,
      evidence.nativeAgentKey,
    );
    let parent: { readonly instance: AgentInstanceRecord; readonly run: AgentRunRecord } | undefined;
    if (evidence.parentNativeAgentKey) {
      const parentIdentity = nativeIdentity(
        profile.providerId,
        executionRun.executionSessionId,
        executionRun.runId,
        evidence.parentNativeAgentKey,
      );
      parent = await this.readAgent(parentIdentity.agentInstanceId, parentIdentity.agentRunId);
      if (!parent) throw new Error('Native child evidence arrived without its durable parent.');
    } else {
      parent = await this.findManagedAgentRun(executionRun.runId);
      if (!parent && executionRun.owner.kind === 'agent-instance') {
        // Lost dispatch acknowledgement can leave the managed AgentRun present
        // but not yet bound to this lifecycle run. Defer root evidence until
        // startup dispatch recovery restores that exact parent attempt.
        return;
      }
    }
    const rootOwner = parent?.instance.rootOwner ?? executionRun.owner;
    const existing = await this.readAgent(identity.agentInstanceId, identity.agentRunId);
    const instance = existing?.instance ?? await this.options.agents.adoptNativeAgent({
      transactionId: identity.adoptionTransactionId,
      terminalTransactionId: identity.terminalTransactionId,
      adoptionKey: identity.adoptionKey,
      agentRunId: identity.agentRunId,
      providerId: profile.providerId,
      definition: {
        definitionId: 'native-agent',
        revisionDigest: sha256(`native-agent-definition:${profile.providerId}:${observation}`),
        source: 'provider-native',
      },
      rootOwner,
      ...(parent ? {
        parentAgentInstanceId: parent.instance.agentInstanceId,
        parentAgentRunId: parent.run.agentRunId,
      } : {}),
      attachment: evidence.attachment,
      observation,
      nativeAgentRef: evidence.nativeAgentKey,
      goalRef: 'native-agent',
      executionSessionId: executionSessionId(executionRun.executionSessionId),
      executionRunId: runId(executionRun.runId),
      policyInputs: parent
        ? inheritedPolicyInputs(parent.run)
        : await (this.options.rootPolicy ?? denyAllRootPolicy).resolve({
          providerId: profile.providerId,
          owner: rootOwner,
        }),
    });
    const run = existing?.run ?? await requireCurrent(
      this.options.agents.repositories.runs.read(identity.agentRunId),
    );
    let updated = run;
    if (!parent
      && evidence.attachment === 'attached'
      && executionRun.cancellationRequested
      && !updated.terminal) {
      updated = await this.options.agents.updateRunState(run.agentRunId, 'cancelling');
    }
    const unresolvedParentTerminal = attachedParentTerminalReason(
      executionRun,
      evidence,
      parent,
    );
    if ((updated.state === 'cancelling' || unresolvedParentTerminal)
      && !isNativeTerminalEvidence(evidence.status)) {
      if (executionRun.terminal) {
        updated = await this.options.agents.completeRun(
          run.agentRunId,
          'indeterminate',
          unresolvedParentTerminal ?? 'cancellation-unknown',
        );
      }
    } else if (evidence.status === 'running') {
      updated = await this.options.agents.updateRunState(run.agentRunId, 'running');
    } else if (evidence.status === 'waiting') {
      updated = await this.options.agents.updateRunState(run.agentRunId, 'waiting');
    } else if (evidence.status === 'completed') {
      updated = evidence.resultRef
        ? await this.appendExecutionResult(
          instance,
          run,
          evidence.resultRef,
          'succeeded',
          evidence.updatedAt,
          'provider-native',
        )
        : await this.options.agents.completeRun(run.agentRunId, 'succeeded', 'completed');
    } else if (evidence.status === 'failed') {
      updated = evidence.resultRef
        ? await this.appendExecutionResult(
          instance,
          run,
          evidence.resultRef,
          'failed',
          evidence.updatedAt,
          'provider-native',
        )
        : await this.options.agents.completeRun(run.agentRunId, 'failed', 'provider-failure');
    } else if (evidence.status === 'closed') {
      updated = await this.options.agents.completeRun(
        run.agentRunId,
        'interrupted',
        'known-process-exit',
      );
    }
    await this.options.work.synchronizeAgentRun(updated);
  }

  private async appendExecutionResult(
    instance: AgentInstanceRecord,
    agentRun: AgentRunRecord,
    resultRef: ResultRef,
    status: Exclude<AgentTerminalStatus, 'invalidated'>,
    completedAt: number,
    provenanceKind: 'provider-native' | 'grimoire-managed',
  ): Promise<AgentRunRecord> {
    if (!agentRun.executionSessionId || !agentRun.executionRunId) {
      throw new Error('Agent result cannot be materialized without durable execution identity.');
    }
    const materialized = await this.options.results.materialize(resultRef);
    const result: AgentResultRecord = {
      agentResultId: agentResultId(`ares-${sha256([
        'agent-result',
        agentRun.agentRunId,
        resultRef.resultId,
        status,
      ].join(':')).slice(0, 32)}`),
      agentInstanceId: instance.agentInstanceId,
      agentRunId: agentRun.agentRunId,
      status,
      ...(materialized.finalAssistantText
        ? { finalText: materialized.finalAssistantText }
        : {}),
      ...(materialized.partialAssistantText
        ? { partialText: materialized.partialAssistantText }
        : {}),
      artifacts: [],
      changedFiles: [],
      citations: [],
      childResultIds: [],
      provenance: {
        kind: provenanceKind,
        providerId: instance.providerId,
        executionSessionId: executionSessionId(agentRun.executionSessionId),
        executionRunId: runId(agentRun.executionRunId),
        nativeResultRef: resultRef.resultId,
        observedAt: completedAt,
      },
      completedAt,
    };
    return this.options.agents.appendResult(result);
  }

  private async findManagedAgentRun(
    executionRunId: string,
  ): Promise<{ readonly instance: AgentInstanceRecord; readonly run: AgentRunRecord } | undefined> {
    for (const id of await this.options.agents.repositories.runs.listRecordIds()) {
      const run = await readCurrent(this.options.agents.repositories.runs.read(id));
      if (!run || run.executionRunId !== executionRunId) continue;
      const instance = await readCurrent(
        this.options.agents.repositories.instances.read(run.agentInstanceId),
      );
      if (instance?.origin === 'grimoire-dispatched') return { instance, run };
    }
    return undefined;
  }

  private async readAgent(
    instanceId: AgentInstanceId,
    runId: AgentRunId,
  ): Promise<{ readonly instance: AgentInstanceRecord; readonly run: AgentRunRecord } | undefined> {
    const instance = await readCurrent(this.options.agents.repositories.instances.read(instanceId));
    const run = await readCurrent(this.options.agents.repositories.runs.read(runId));
    return instance && run ? { instance, run } : undefined;
  }

  private requireOpen(): void {
    if (this.disposed) throw new Error('Native agent lifecycle bridge is disposed.');
  }
}

function attachedParentTerminalReason(
  executionRun: Readonly<ExecutionRunRecord>,
  evidence: NativeAgentEvidenceRecord,
  parent: { readonly instance: AgentInstanceRecord; readonly run: AgentRunRecord } | undefined,
): 'cancellation-unknown' | 'effects-unknown' | undefined {
  if (evidence.attachment !== 'attached') return undefined;
  const terminal = parent?.run.terminal ?? executionRun.terminal;
  if (!terminal) return undefined;
  if (terminal.kind === 'cancelled') return 'cancellation-unknown';
  if (terminal.kind === 'interrupted' || terminal.kind === 'indeterminate') {
    return 'effects-unknown';
  }
  return undefined;
}

function isNativeTerminalEvidence(
  status: NativeAgentEvidenceRecord['status'],
): boolean {
  return status === 'completed' || status === 'failed' || status === 'closed';
}

const denyAllRootPolicy: NativeAgentRootPolicyPort = {
  resolve: async () => ({
    provider: { granted: [], approvable: [] },
    workspace: { granted: [], approvable: [] },
    root: { granted: [], approvable: [] },
    definition: { requested: [], approvable: [] },
  }),
};

function inheritedPolicyInputs(run: AgentRunRecord): AgentDispatchPolicyInputs {
  const boundary = {
    granted: [...run.policy.granted],
    approvable: [...run.policy.approvable],
  };
  return {
    provider: boundary,
    workspace: boundary,
    root: boundary,
    definition: {
      requested: [...new Set([...run.policy.granted, ...run.policy.approvable])],
      approvable: [...run.policy.approvable],
    },
  };
}

function nativeIdentity(
  providerId: ProviderId,
  executionSessionId: string,
  executionRunId: string,
  nativeAgentKey: string,
) {
  const seed = `${providerId}:${executionSessionId}:${executionRunId}:${nativeAgentKey}`;
  const hex = sha256(seed).slice(0, 32);
  return {
    adoptionKey: nativeAgentAdoptionKey(`nad-${hex}`),
    agentInstanceId: adoptedAgentInstanceId(nativeAgentAdoptionKey(`nad-${hex}`)),
    agentRunId: agentRunId(`agr-${sha256(`run:${seed}`).slice(0, 32)}`),
    adoptionTransactionId: `tx-${sha256(`adopt:${seed}`).slice(0, 32)}`,
    terminalTransactionId: `tx-${sha256(`terminal:${seed}`).slice(0, 32)}`,
  };
}

function terminalStatus(kind: RunTerminalKind): AgentTerminalStatus {
  return kind;
}

function requireAdoptableObservation(
  observation: ProviderAgentObservation,
): Exclude<AgentObservationFidelity, 'opaque' | 'none'> {
  if (observation === 'full' || observation === 'aggregate' || observation === 'terminal-only') {
    return observation;
  }
  throw new Error('Provider emitted native-agent evidence outside its declared observation profile.');
}

async function readCurrent<T>(
  read: Promise<VersionedRecordReadResult<T>>,
): Promise<T | undefined> {
  const result = await read;
  if (result.kind === 'current' || result.kind === 'migrated') return result.record.payload;
  if (result.kind === 'absent') return undefined;
  throw new Error(`Agent record "${result.recordId}" is unavailable.`);
}

async function requireCurrent<T>(read: Promise<VersionedRecordReadResult<T>>): Promise<T> {
  const current = await readCurrent(read);
  if (!current) throw new Error('Required agent record is absent.');
  return current;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function catalogNativeAgentProviderProfiles(input: {
  list(): ReadonlyArray<{
    readonly execution: { readonly descriptor: { readonly backendId: ExecutionBackendId } };
    readonly manifest: { readonly id: ProviderId };
    readonly capabilities: { readonly agents: { readonly observation: ProviderAgentObservation } };
  }>;
}): NativeAgentProviderProfilePort {
  const profiles = new Map(input.list().map(module => [
    module.execution.descriptor.backendId,
    {
      providerId: module.manifest.id,
      observation: module.capabilities.agents.observation,
    },
  ]));
  return { forBackend: backendId => profiles.get(backendId) ?? null };
}
