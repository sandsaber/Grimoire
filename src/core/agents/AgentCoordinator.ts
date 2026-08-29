import type { ExecutionOwner, RunTerminalReason } from '../execution/ExecutionContracts';
import type { DurableStorage } from '../persistence/DurableStorage';
import type { VersionedRecord, VersionedRecordReadResult } from '../persistence/VersionedRecord';
import { RevisionConflictError } from '../persistence/VersionedRepository';
import type { ProviderId } from '../types/provider';
import type {
  AgentAttachmentPolicy,
  AgentCancellationEvidence,
  AgentCancellationPort,
  AgentCancellationRecoveryPort,
  AgentDefinitionSnapshot,
  AgentDispatchIntentRecord,
  AgentDispatchPort,
  AgentDispatchRecoveryPort,
  AgentExecutionMode,
  AgentInstanceRecord,
  AgentObservationFidelity,
  AgentResultLinkRecoveryReport,
  AgentResultRecord,
  AgentRunRecord,
  AgentRunRecoveryPort,
  AgentRunState,
  AgentRunTerminal,
  AgentTerminalStatus,
} from './AgentContracts';
import {
  type AgentControlRemoval,
  AgentControlTransactionCoordinator,
} from './AgentControlTransactionCoordinator';
import type {
  AgentDispatchToken,
  AgentInstanceId,
  AgentRunId,
  NativeAgentAdoptionKey,
} from './AgentIds';
import { adoptedAgentInstanceId } from './AgentIds';
import type { AgentPolicyInputs } from './AgentPolicy';
import { resolveEffectiveAgentPolicy } from './AgentPolicy';
import { AgentRepositories } from './AgentRepositories';
import { agentResultRecordSchema } from './AgentSchemas';

export interface PrepareAgentDispatchCommand {
  readonly prepareTransactionId: string;
  readonly dispatchStartTransactionId: string;
  readonly settlementTransactionId: string;
  readonly terminalTransactionId: string;
  readonly agentInstanceId: AgentInstanceId;
  readonly agentRunId: AgentRunId;
  readonly dispatchToken: AgentDispatchToken;
  readonly providerId: ProviderId;
  readonly definition: AgentDefinitionSnapshot;
  readonly executionMode: AgentExecutionMode;
  readonly rootOwner: ExecutionOwner;
  /**
   * The conversation this run's turn writes into, where it is not the owner's.
   *
   * Two conversations, on purpose — D10. `rootOwner` is the one a person is
   * looking at, so the work card can list what it started; this is the one the
   * turn writes into, because a conversation runs one turn at a time and two
   * dispatched runs cannot share one.
   */
  readonly conversationId?: string;
  readonly parentAgentInstanceId?: AgentInstanceId;
  readonly attachment: AgentAttachmentPolicy;
  readonly observation: AgentObservationFidelity;
  readonly goalRef: string;
  readonly policyInputs: AgentDispatchPolicyInputs;
  readonly idempotency: 'provider-key' | 'none';
}

export interface AdoptNativeAgentCommand {
  readonly transactionId: string;
  readonly terminalTransactionId: string;
  readonly adoptionKey: NativeAgentAdoptionKey;
  readonly agentRunId: AgentRunId;
  readonly providerId: ProviderId;
  readonly definition: AgentDefinitionSnapshot;
  readonly rootOwner: ExecutionOwner;
  /**
   * The agent that spawned this one, where an agent did.
   *
   * **Optional, and that is the shape Grimoire actually needs.** The harvest
   * required a parent, because there every observed agent was a child of one
   * already known. A provider launching a background subagent from a *chat
   * turn* has no parent agent at all — its root is the conversation, which is
   * exactly what `rootOwner` says. Required, such an agent could only be
   * recorded by inventing a parent for it.
   *
   * The parent answers two questions when it is there: the permission ceiling a
   * child may not exceed, and whether a cancelling parent takes an attached
   * child with it. Without one the ceiling is what the command asks for and
   * nothing cascades — there is nothing above it to cascade from.
   */
  readonly parentAgentInstanceId?: AgentInstanceId;
  readonly parentAgentRunId?: AgentRunId;
  readonly attachment: AgentAttachmentPolicy;
  readonly observation: Exclude<AgentObservationFidelity, 'opaque' | 'none'>;
  readonly nativeAgentRef: string;
  readonly goalRef: string;
  readonly policyInputs: AgentDispatchPolicyInputs;
}

export interface RetryAgentCommand {
  readonly prepareTransactionId: string;
  readonly dispatchStartTransactionId: string;
  readonly settlementTransactionId: string;
  readonly terminalTransactionId: string;
  readonly agentInstanceId: AgentInstanceId;
  readonly agentRunId: AgentRunId;
  readonly dispatchToken: AgentDispatchToken;
  readonly goalRef: string;
  readonly policyInputs: AgentDispatchPolicyInputs;
  readonly idempotency: 'provider-key' | 'none';
}

export type AgentDispatchPolicyInputs = Omit<AgentPolicyInputs, 'parent'> & {
  readonly parent?: never;
};

/**
 * One agent, as a surface needs it.
 *
 * Carries no text: a goal *reference*, not the goal, and no result — a card
 * shows that work exists and how it ended, and what it said is read from the
 * result store when someone opens it. Everything here comes from a record, so
 * the answer is the same whether the tab that started it is still open.
 */
export interface OwnedAgentSummary {
  readonly agentInstanceId: AgentInstanceId;
  readonly agentRunId: AgentRunId;
  readonly providerId: ProviderId;
  readonly goalRef: string;
  readonly nativeAgentRef?: string;
  readonly state: AgentRunState;
  readonly terminal?: AgentRunTerminal;
  readonly attempt: number;
  /** How much of this agent's progress the provider lets anyone see. */
  readonly observation: AgentObservationFidelity;
  readonly startedAt: number;
  readonly updatedAt: number;
}

export interface CancelAttachedAgentTreeCommand {
  readonly transactionId: string;
  readonly rootAgentInstanceId: AgentInstanceId;
}

export interface AgentCoordinatorScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AgentCoordinatorOptions {
  readonly now?: () => number;
  readonly repositories?: AgentRepositories;
  readonly transactions?: AgentControlTransactionCoordinator;
  readonly controlTimeoutMs?: number;
  readonly scheduler?: AgentCoordinatorScheduler;
}

export class AgentCoordinator {
  readonly repositories: AgentRepositories;
  private readonly transactions: AgentControlTransactionCoordinator;
  private readonly now: () => number;
  private readonly controlTimeoutMs: number;
  private readonly scheduler?: AgentCoordinatorScheduler;
  private readonly instanceQueues = new Map<string, Promise<void>>();
  private topologyQueue: Promise<void> = Promise.resolve();

  constructor(storage: DurableStorage, options: AgentCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.repositories = options.repositories ?? new AgentRepositories(storage, this.now);
    this.transactions = options.transactions ?? new AgentControlTransactionCoordinator(
      storage,
      this.repositories,
      { now: this.now },
    );
    this.controlTimeoutMs = options.controlTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.controlTimeoutMs) || this.controlTimeoutMs < 1) {
      throw new Error('Agent control timeout must be a positive safe integer.');
    }
    this.scheduler = options.scheduler;
    // Updated *by* the write rather than invalidated after it, so there is no
    // window in which this process has to answer "I do not know yet" — see
    // `onChanged`. A removal carries no record and drops the entry.
    this.repositories.instances.onChanged((id, record) => {
      applyRecordChange(this.instanceRecords, id, record);
    });
    this.repositories.runs.onChanged((id, record) => {
      applyRecordChange(this.runRecords, id, record);
    });
  }

  /**
   * Records this process has already read, by id.
   *
   * **`listOwnedAgents` re-read the whole store on every call**, and every
   * background-subagent state change asks for one: the tab's card refresh reads
   * every instance record in the vault to find the handful its conversation
   * owns, then a run record for each. During a burst — a sidecar hydration
   * retry produces one — that is the store walked once per event.
   *
   * Process-local on purpose, and correct because it is maintained by the only
   * funnel writes pass through — the write brings it up to date rather than
   * marking it unknown. It is not a cross-process cache: another window writing
   * these records would not update it. Nothing does that — a vault is opened
   * once and these records are Grimoire's own — and the alternative, re-reading
   * everything forever, is what this replaces.
   */
  private readonly instanceRecords = new Map<string, AgentInstanceRecord>();
  private readonly runRecords = new Map<string, AgentRunRecord>();
  /** Owners this process has listed at least once, so its copy of them is whole. */
  private readonly listedOwners = new Set<string>();

  /**
   * Whether this owner has an agent still running, answered without waiting.
   *
   * **`undefined` means unknown, and the caller must not guess.** The one thing
   * that asks is Claude's `Stop` hook, which decides whether a turn may end
   * while a background subagent is going, and both guesses are wrong there:
   * assume running and turns that should have ended block, assume idle and a
   * turn ends on top of an agent that has just started.
   *
   * It is answerable at all because the records this process has read are kept
   * current *by* each write rather than invalidated after it, so there is no
   * window where the copy is behind the store.
   *
   * **The two answers need different amounts of knowledge, and treating them
   * the same lost information.** This copy is a subset of the store, so one
   * running agent in it establishes `true` however much else is unread — an
   * agent adopted a moment ago answers for its owner before anything has listed
   * that owner. `false` is the claim that needs the whole picture, so it is the
   * only one a listing gates. Unknown is what is left: an owner nothing has
   * listed and nothing running in it, or a listing whose cached run has since
   * been dropped.
   */
  runningOwnedAgents(owner: ExecutionOwner): boolean | undefined {
    const ownerKey = stableSerialize(owner);
    const listed = this.listedOwners.has(ownerKey);
    let running = false;
    let incomplete = false;
    for (const instance of this.instanceRecords.values()) {
      if (stableSerialize(instance.rootOwner) !== ownerKey) continue;
      const latestRunId = instance.runIds.at(-1);
      if (!latestRunId) continue;
      const run = this.runRecords.get(latestRunId);
      if (!run) {
        // **Noted, not returned.** What this copy holds is a subset of the
        // store, so a gap in it cannot disprove a run that is visibly going —
        // and returning early on the first gap threw away a `true` this loop
        // had already established, which the caller reads as "nothing is
        // running". Only the negative answer needs a complete picture.
        incomplete = true;
        continue;
      }
      if (!run.terminal) {
        running = true;
      }
    }
    // A known running agent is an answer whatever else is unread: this copy is
    // a subset, and a subset can establish a positive. "Nothing is running"
    // needs the whole picture, which is what a listing gives.
    if (running) {
      return true;
    }
    return listed && !incomplete ? false : undefined;
  }

  /** One instance record, from this process's copy when it has a current one. */
  private async readInstanceRecord(instanceId: string): Promise<AgentInstanceRecord | null> {
    const cached = this.instanceRecords.get(instanceId);
    if (cached) {
      return cached;
    }
    const read = await this.repositories.instances.read(instanceId);
    if (read.kind !== 'current' && read.kind !== 'migrated') {
      return null;
    }
    this.instanceRecords.set(instanceId, read.record.payload);
    return read.record.payload;
  }

  /** One run record, on the same terms. */
  private async readRunRecord(agentRunId: string): Promise<AgentRunRecord | null> {
    const cached = this.runRecords.get(agentRunId);
    if (cached) {
      return cached;
    }
    const read = await this.repositories.runs.read(agentRunId);
    if (read.kind !== 'current' && read.kind !== 'migrated') {
      return null;
    }
    this.runRecords.set(agentRunId, read.record.payload);
    return read.record.payload;
  }

  async prepareAndDispatch(
    command: PrepareAgentDispatchCommand,
    port: AgentDispatchPort,
  ): Promise<AgentRunRecord> {
    const prepared = await this.prepareDispatch(command);
    return this.dispatchPrepared(prepared.agentRunId, port);
  }

  async prepareDispatch(command: PrepareAgentDispatchCommand): Promise<AgentRunRecord> {
    requireDistinctTransactionIds([
      command.prepareTransactionId,
      command.dispatchStartTransactionId,
      command.settlementTransactionId,
      command.terminalTransactionId,
    ]);
    return this.enqueueTopology(() => this.enqueue(command.agentInstanceId, async () => {
      const parent = await this.requireParent(command.parentAgentInstanceId, command.rootOwner);
      const parentRun = parent ? await this.requireParentRun(parent) : undefined;
      const timestamp = this.now();
      const policy = await this.resolveCommandPolicy(
        command.policyInputs,
        parentRun ? [effectivePolicyBoundary(parentRun.policy)] : [],
      );
      const instance: AgentInstanceRecord = {
        agentInstanceId: command.agentInstanceId,
        providerId: command.providerId,
        definition: command.definition,
        executionMode: command.executionMode,
        origin: 'grimoire-dispatched',
        rootOwner: command.rootOwner,
        ...(command.parentAgentInstanceId
          ? {
            parentAgentInstanceId: command.parentAgentInstanceId,
            parentAgentRunId: parentRun!.agentRunId,
          }
          : {}),
        attachment: command.attachment,
        observation: command.observation,
        runIds: [command.agentRunId],
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const run: AgentRunRecord = {
        agentRunId: command.agentRunId,
        agentInstanceId: command.agentInstanceId,
        attempt: 1,
        goalRef: command.goalRef,
        policy,
        terminalTransactionId: command.terminalTransactionId,
        dispatchToken: command.dispatchToken,
        ...(command.conversationId ? { conversationId: command.conversationId } : {}),
        state: 'dispatching',
        resultIds: [],
        observedResultIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const intent = createIntent(command, timestamp);
      await this.transactions.execute(command.prepareTransactionId, [
        write('instances', instance.agentInstanceId, null, instance),
        write('runs', run.agentRunId, null, run),
        write('dispatch-intents', intent.dispatchToken, null, intent),
      ]);
      return run;
    }));
  }

  async retry(command: RetryAgentCommand, port: AgentDispatchPort): Promise<AgentRunRecord> {
    const prepared = await this.prepareRetry(command);
    return this.dispatchPrepared(prepared.agentRunId, port);
  }

  async prepareRetry(command: RetryAgentCommand): Promise<AgentRunRecord> {
    requireDistinctTransactionIds([
      command.prepareTransactionId,
      command.dispatchStartTransactionId,
      command.settlementTransactionId,
      command.terminalTransactionId,
    ]);
    return this.enqueueTopology(() => this.enqueue(command.agentInstanceId, async () => {
      const currentInstance = await requireCurrent(
        this.repositories.instances.read(command.agentInstanceId),
      );
      const priorRuns = await Promise.all(currentInstance.payload.runIds.map(async id => (
        requireCurrent(this.repositories.runs.read(id))
      )));
      if (priorRuns.length === 0) {
        // The schema permits an instance with no runs, and a record in the
        // field can have one — half-written, or hand-edited. Without this the
        // reduce below raises `Reduce of empty array with no initial value` and
        // the attempt number below it is `-Infinity`.
        throw new Error('Agent retry requires a prior attempt to retry.');
      }
      if (priorRuns.some(record => !record.payload.terminal)) {
        throw new Error('Agent retry requires every prior attempt to be terminal.');
      }
      const timestamp = this.now();
      const latestRun = priorRuns.reduce((latest, candidate) => (
        candidate.payload.attempt > latest.payload.attempt ? candidate : latest
      ));
      const durableBoundaries = [effectivePolicyBoundary(latestRun.payload.policy)];
      if (currentInstance.payload.parentAgentInstanceId) {
        const parent = await this.requireParent(
          currentInstance.payload.parentAgentInstanceId,
          currentInstance.payload.rootOwner,
          true,
          currentInstance.payload.attachment === 'detached',
        );
        if (parent) {
          const parentRun = await this.requireParentRun(
            parent,
            currentInstance.payload.parentAgentRunId,
          );
          if (currentInstance.payload.attachment === 'attached'
            && hasCancellationCascade(parentRun)) {
            throw new Error('Attached agent cannot retry under a cancelled parent.');
          }
          durableBoundaries.push(effectivePolicyBoundary(parentRun.policy));
        }
      }
      const run: AgentRunRecord = {
        agentRunId: command.agentRunId,
        agentInstanceId: command.agentInstanceId,
        attempt: Math.max(...priorRuns.map(record => record.payload.attempt)) + 1,
        goalRef: command.goalRef,
        policy: await this.resolveCommandPolicy(command.policyInputs, durableBoundaries),
        terminalTransactionId: command.terminalTransactionId,
        dispatchToken: command.dispatchToken,
        state: 'dispatching',
        resultIds: [],
        observedResultIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const intent = createIntent(command, timestamp);
      const instance: AgentInstanceRecord = {
        ...currentInstance.payload,
        runIds: [...currentInstance.payload.runIds, run.agentRunId],
        status: 'active',
        updatedAt: timestamp,
      };
      await this.transactions.execute(command.prepareTransactionId, [
        write('instances', instance.agentInstanceId, currentInstance.revision, instance),
        write('runs', run.agentRunId, null, run),
        write('dispatch-intents', intent.dispatchToken, null, intent),
      ]);
      return run;
    }));
  }

  async adoptNativeAgent(command: AdoptNativeAgentCommand): Promise<AgentInstanceRecord> {
    requireDistinctTransactionIds([command.transactionId, command.terminalTransactionId]);
    const instanceId = adoptedAgentInstanceId(command.adoptionKey);
    return this.enqueueTopology(() => this.enqueue(instanceId, async () => {
      const parent = await this.requireParent(
        command.parentAgentInstanceId,
        command.rootOwner,
        true,
        true,
      );
      // An agent rooted in a conversation has no parent run to read a ceiling
      // or a cancellation from. Both are answered below rather than here.
      const parentRun = parent
        ? await this.requireParentRun(parent, command.parentAgentRunId)
        : undefined;
      const existing = await this.repositories.instances.read(instanceId);
      if (existing.kind === 'current' || existing.kind === 'migrated') {
        requireMatchingAdoption(existing.record.payload, command);
        return existing.record.payload;
      }
      if (existing.kind !== 'absent') await requireCurrent(Promise.resolve(existing));
      const timestamp = this.now();
      const inheritsCancellation = command.attachment === 'attached'
        && !!parentRun
        && hasCancellationCascade(parentRun);
      const instance: AgentInstanceRecord = {
        agentInstanceId: instanceId,
        providerId: command.providerId,
        definition: command.definition,
        executionMode: 'provider-native',
        origin: 'observed-native',
        rootOwner: command.rootOwner,
        // **Derived from the parent, not copied from the command**, the way
        // `prepareDispatch` above does it. Making the run id optional made a
        // command naming a parent instance and no run type-legal;
        // `requireParentRun` falls back to the parent's latest run and uses its
        // policy as the ceiling, but writing `undefined` here then failed at
        // the schema with a message about a pair — a confusing failure at the
        // wrong layer, rather than the right answer at this one.
        ...(parent && parentRun
          ? {
            parentAgentInstanceId: parent.agentInstanceId,
            parentAgentRunId: parentRun.agentRunId,
          }
          : {}),
        attachment: command.attachment,
        observation: command.observation,
        nativeAdoptionKey: command.adoptionKey,
        nativeAgentRef: command.nativeAgentRef,
        runIds: [command.agentRunId],
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const run: AgentRunRecord = {
        agentRunId: command.agentRunId,
        agentInstanceId: instanceId,
        attempt: 1,
        goalRef: command.goalRef,
        policy: await this.resolveCommandPolicy(
          command.policyInputs,
          // No parent, no ceiling from one: what the command asks for is what
          // the conversation was already allowed, and the policy resolver is
          // still what decides it.
          parentRun ? [effectivePolicyBoundary(parentRun.policy)] : [],
        ),
        terminalTransactionId: command.terminalTransactionId,
        nativeAgentRef: command.nativeAgentRef,
        state: inheritsCancellation ? 'cancelling' : 'running',
        resultIds: [],
        observedResultIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.transactions.execute(command.transactionId, [
        write('instances', instance.agentInstanceId, null, instance),
        write('runs', run.agentRunId, null, run),
      ]);
      return instance;
    }));
  }

  async recoverPendingDispatches(
    port: AgentDispatchRecoveryPort,
    options: AgentRecoverySweepOptions = {},
  ): Promise<AgentRunRecord[]> {
    this.requireControlScheduler();
    await this.transactions.recoverPending();
    const recovered: AgentRunRecord[] = [];
    // **One bad record must not strand every later one.** `listRecordIds` is
    // sorted, so a record that throws throws first on every restart and nothing
    // after it is ever recovered — a permanent stall from one malformed answer.
    // `recoverResultLinks` already collects per record; these two now match it.
    const failures: unknown[] = [];
    for (const intentId of await this.repositories.dispatchIntents.listRecordIds()) {
      try {
      const intentRecord = await requireCurrent(this.repositories.dispatchIntents.read(intentId));
      if (intentRecord.payload.status === 'prepared') {
        // **Prepared and never started.** `dispatchPrepared` writes
        // `dispatching` in a transaction of its own *before* it calls the
        // provider, and `recoverPending` above has already replayed any such
        // write that was owed — so an intent still at `prepared` is proof that
        // nothing was dispatched. Nothing to ask the port about, and nothing to
        // resume: a dispatch the user requested in a process that is gone is
        // not one to launch behind their back at the next start.
        //
        // Left alone it was the one non-terminal state no sweep reached, and
        // the run stayed `dispatching` for the life of the vault — which the
        // conversation reads as an agent still running, forever.
        const settled = await this.settlePreparedDispatch(intentRecord);
        if (settled) recovered.push(settled);
        continue;
      }
      if (intentRecord.payload.status !== 'dispatching') continue;
      const runRecord = await requireCurrent(this.repositories.runs.read(intentRecord.payload.agentRunId));
      const snapshot = await this.enqueue(runRecord.payload.agentInstanceId, async () => {
        const currentIntent = await requireCurrent(
          this.repositories.dispatchIntents.read(intentRecord.recordId),
        );
        if (currentIntent.payload.status !== 'dispatching') return undefined;
        const currentRun = await requireCurrent(
          this.repositories.runs.read(currentIntent.payload.agentRunId),
        );
        return { intent: currentIntent.payload, run: currentRun.payload };
      });
      if (!snapshot) continue;
      const evidence = await this.resolveControlWithinDeadline(
        () => port.reconcile(snapshot.intent),
        { kind: 'unknown' as const, effectsPossible: true },
      );
      const settled = await this.enqueue(snapshot.run.agentInstanceId, async () => {
        const currentIntent = await requireCurrent(
          this.repositories.dispatchIntents.read(snapshot.intent.dispatchToken),
        );
        const currentRun = await requireCurrent(
          this.repositories.runs.read(snapshot.run.agentRunId),
        );
        if (currentIntent.payload.status !== 'dispatching') return currentRun.payload;
        if (currentRun.payload.terminal) {
          return this.settleTerminalDispatchIntent(currentIntent, currentRun, evidence);
        }
        const instanceRecord = await requireCurrent(
          this.repositories.instances.read(currentRun.payload.agentInstanceId),
        );
        return this.settleDispatch(
          instanceRecord,
          currentRun,
          currentIntent,
          evidence.kind === 'accepted'
            ? {
              kind: 'accepted',
              nativeAgentRef: evidence.nativeAgentRef,
              // Paired or absent: the record refuses a run identity without its
              // session, and evidence that carries only one of the two is
              // evidence about neither.
              ...(evidence.executionSessionId && evidence.executionRunId
                ? {
                  execution: {
                    executionSessionId: evidence.executionSessionId,
                    executionRunId: evidence.executionRunId,
                  },
                }
                : {}),
            }
            : evidence.kind === 'rejected'
              ? { kind: 'rejected', code: evidence.code, sideEffectFree: true }
              : evidence.effectsPossible
                ? { kind: 'unknown-effects' }
                // **Not a rejection.** Recovery answering "no effects were
                // possible" is not the provider saying it refused, and writing
                // `rejected` made a durable claim nobody could support.
                // `recoverActiveRuns` already has the honest pair for exactly
                // this evidence.
                : { kind: 'recovered-safe' },
        );
      });
      if (settled) recovered.push(settled);
      } catch (error) {
        failures.push(error);
      }
    }
    reportSweepFailures(failures, recovered, options);
    return recovered;
  }

  async recoverActiveRuns(
    port: AgentRunRecoveryPort,
    cancellationPort: AgentCancellationRecoveryPort,
    options: AgentRecoverySweepOptions = {},
  ): Promise<AgentRunRecord[]> {
    this.requireControlScheduler();
    await this.transactions.recoverPending();
    const recovered: AgentRunRecord[] = [];
    // Per record, for the reason `recoverPendingDispatches` is: `listRecordIds`
    // is sorted, so one malformed answer stalls every later run on every
    // restart.
    const failures: unknown[] = [];
    for (const runId of await this.repositories.runs.listRecordIds()) {
      try {
      const run = await requireCurrent(this.repositories.runs.read(runId));
      if (run.payload.state !== 'running'
        && run.payload.state !== 'waiting'
        && run.payload.state !== 'cancelling') continue;
      const snapshot = await this.enqueue(run.payload.agentInstanceId, async () => {
        const currentRun = await requireCurrent(this.repositories.runs.read(run.recordId));
        if (currentRun.payload.terminal) return { kind: 'terminal', run: currentRun.payload } as const;
        if (currentRun.payload.state !== 'running'
          && currentRun.payload.state !== 'waiting'
          && currentRun.payload.state !== 'cancelling') {
          return { kind: 'terminal', run: currentRun.payload } as const;
        }
        const instance = await requireCurrent(
          this.repositories.instances.read(currentRun.payload.agentInstanceId),
        );
        return { kind: 'active', instance: instance.payload, run: currentRun.payload } as const;
      });
      if (snapshot.kind === 'terminal') {
        recovered.push(snapshot.run);
        continue;
      }
      const cancellation = snapshot.run.state === 'cancelling'
        ? await this.resolveControlWithinDeadline(
          () => cancellationPort.reconcileCancellation(snapshot),
          { kind: 'unknown' as const },
        )
        : undefined;
      const evidence = snapshot.run.state !== 'cancelling'
        ? await this.resolveControlWithinDeadline(
          () => port.reconcile(snapshot),
          { kind: 'unknown' as const, effectsPossible: true },
        )
        : undefined;
      const settled = await this.enqueue(snapshot.instance.agentInstanceId, async () => {
        const currentRun = await requireCurrent(this.repositories.runs.read(snapshot.run.agentRunId));
        if (currentRun.payload.terminal) return currentRun.payload;
        if (currentRun.payload.state === 'cancelling') {
          if (!cancellation) return currentRun.payload;
          return this.terminalizeRun(
            currentRun,
            cancellation.kind === 'cancelled'
              ? 'cancelled'
              : cancellation.kind === 'terminal'
                ? cancellation.status
                : 'indeterminate',
            cancellationReason(cancellation),
          );
        }
        if (!evidence || evidence.kind === 'running') return currentRun.payload;
        if (evidence.kind === 'terminal') {
          return this.terminalizeRun(currentRun, evidence.status, evidence.reason);
        }
        return this.terminalizeRun(
          currentRun,
          evidence.effectsPossible ? 'indeterminate' : 'interrupted',
          evidence.effectsPossible ? 'effects-unknown' : 'recovery-exhausted-safe',
        );
      });
      recovered.push(settled);
      } catch (error) {
        failures.push(error);
      }
    }
    reportSweepFailures(failures, recovered, options);
    return recovered;
  }

  async appendResult(result: AgentResultRecord): Promise<AgentRunRecord> {
    await this.transactions.recoverPending();
    const canonical = agentResultRecordSchema.decode(result);
    return this.enqueue(canonical.agentInstanceId, async () => {
      await this.validateResultReferences(canonical);
      try {
        await this.repositories.results.append(canonical.agentResultId, canonical);
      } catch (error) {
        if (!(error instanceof RevisionConflictError)) throw error;
        const existing = await requireCurrent(this.repositories.results.read(canonical.agentResultId));
        if (stableSerialize(existing.payload) !== stableSerialize(canonical)) throw error;
      }
      return this.linkResultUnlocked(canonical);
    });
  }

  /**
   * What a conversation's agents are doing, for a surface to draw.
   *
   * **Read from the records rather than from anything in memory**, which is the
   * whole reason they exist: a subagent launched in a tab that has since closed
   * is in no live map anywhere, and it is exactly the work a person needs to
   * find. Latest run per instance, because that is the attempt that is
   * happening — a retry keeps its predecessors and they are history.
   *
   * Ordered newest first, so a surface that shows three shows the three that
   * matter.
   */
  async listOwnedAgents(owner: ExecutionOwner): Promise<readonly OwnedAgentSummary[]> {
    const ownerKey = stableSerialize(owner);
    const summaries: OwnedAgentSummary[] = [];
    for (const instanceId of await this.repositories.instances.listRecordIds()) {
      const record = await this.readInstanceRecord(instanceId);
      if (!record) continue;
      if (stableSerialize(record.rootOwner) !== ownerKey) continue;
      const latestRunId = record.runIds.at(-1);
      if (!latestRunId) continue;
      const run = await this.readRunRecord(latestRunId);
      if (!run) continue;
      summaries.push({
        agentInstanceId: record.agentInstanceId,
        agentRunId: run.agentRunId,
        providerId: record.providerId,
        goalRef: run.goalRef,
        nativeAgentRef: record.nativeAgentRef,
        state: run.state,
        terminal: run.terminal,
        attempt: run.attempt,
        observation: record.observation,
        startedAt: run.createdAt,
        updatedAt: run.updatedAt,
      });
    }
    // Listed, so `runningOwnedAgents` may answer for this owner: every instance
    // it owns is in the copy above, and every write keeps it there.
    this.listedOwners.add(ownerKey);
    return summaries.sort((left, right) => right.startedAt - left.startedAt);
  }

  /**
   * Removes every agent record a conversation owns.
   *
   * **D3 decided this and nothing did it.** The persistence decisions say an
   * agent instance and its attempts are kept "until its owning conversation is
   * deleted", deliberately, so that "deleting the chat deletes its traces"
   * stays true without a second retention concept. `deleteOwnedRecords` on the
   * lifecycle registry removes sessions, runs, interactions and reconciliations
   * — and knows nothing about this domain, which is right, so the deletion had
   * to be here and was not. Written now, while nothing calls the recorder, so
   * the first conversation ever deleted with agent records already loses them.
   *
   * Deepest first: results, then runs and intents, then the instances. A
   * deletion interrupted half-way then leaves an instance whose parts are gone
   * rather than parts whose instance is gone, and only the first is recoverable
   * by reading the instance's own list.
   */
  async deleteOwnedRecords(owner: ExecutionOwner, transactionId: string): Promise<void> {
    const ownerKey = stableSerialize(owner);
    const removals: AgentControlRemoval[] = [];
    const runIds: string[] = [];
    for (const instanceId of await this.repositories.instances.listRecordIds()) {
      const instance = await this.repositories.instances.read(instanceId);
      if (instance.kind !== 'current' && instance.kind !== 'migrated') continue;
      if (stableSerialize(instance.record.payload.rootOwner) !== ownerKey) continue;
      runIds.push(...instance.record.payload.runIds);
      removals.push({ repository: 'instances', recordId: instanceId });
    }
    if (runIds.length === 0 && removals.length === 0) {
      return;
    }
    const owned = new Set(runIds);
    for (const resultId of await this.repositories.results.listRecordIds()) {
      const result = await this.repositories.results.read(resultId);
      if (result.kind !== 'current' && result.kind !== 'migrated') continue;
      if (!owned.has(result.record.payload.agentRunId)) continue;
      removals.unshift({ repository: 'results', recordId: resultId });
    }
    for (const runId of runIds) {
      const run = await this.repositories.runs.read(runId);
      const dispatchToken = (run.kind === 'current' || run.kind === 'migrated')
        ? run.record.payload.dispatchToken
        : undefined;
      // An adopted agent has no dispatch intent — Grimoire never dispatched it,
      // so there is nothing to remove for it.
      if (dispatchToken) {
        removals.unshift({ repository: 'dispatch-intents', recordId: dispatchToken });
      }
      removals.unshift({ repository: 'runs', recordId: runId });
    }
    await this.transactions.delete(transactionId, removals);
  }

  async recoverResultLinks(): Promise<AgentResultLinkRecoveryReport> {
    await this.transactions.recoverPending();
    const linked: AgentRunRecord[] = [];
    const issues: AgentResultLinkRecoveryReport['issues'][number][] = [];
    for (const resultId of await this.repositories.results.listRecordIds()) {
      try {
        const result = await requireCurrent(this.repositories.results.read(resultId));
        const linkedRun = await this.enqueue(result.payload.agentInstanceId, async () => {
          await this.validateResultReferences(result.payload);
          const run = await requireCurrent(this.repositories.runs.read(result.payload.agentRunId));
          const alreadyLinked = result.payload.provenance.kind === 'reconciled'
            ? run.payload.observedResultIds.includes(result.payload.agentResultId)
            : run.payload.resultIds.includes(result.payload.agentResultId);
          if (!alreadyLinked) return this.linkResultUnlocked(result.payload);
          if (result.payload.status !== 'partial') {
            await this.repairInstanceStatus(result.payload.agentInstanceId);
          }
          return undefined;
        });
        if (linkedRun) linked.push(linkedRun);
      } catch (error) {
        issues.push({
          agentResultId: resultId,
          code: isResultReferenceError(error)
            ? 'invalid-result-reference'
            : 'result-link-conflict',
        });
      }
    }
    return { linkedRuns: linked, issues };
  }

  async cancelAttachedTree(
    command: CancelAttachedAgentTreeCommand,
    port: AgentCancellationPort,
  ): Promise<readonly AgentRunRecord[]> {
    if (!this.scheduler) {
      throw new Error('Agent cancellation requires a bounded control scheduler.');
    }
    const cancellationTargets = await this.enqueueTopology(async () => {
      const instances = await this.loadInstances();
      if (!instances.has(command.rootAgentInstanceId)) {
        throw new Error('Root agent instance is absent.');
      }
      const ordered = collectAttachedPostOrder(command.rootAgentInstanceId, instances);
      return this.enqueueMany(ordered.map(instance => instance.agentInstanceId), async () => {
        const timestamp = this.now();
        const targets: Array<{ instance: AgentInstanceRecord; run: AgentRunRecord }> = [];
        const writes: ReturnType<typeof write>[] = [];
        for (const snapshot of ordered) {
          const instance = await requireCurrent(
            this.repositories.instances.read(snapshot.agentInstanceId),
          );
          const latestRunId = instance.payload.runIds.at(-1);
          if (!latestRunId) continue;
          const run = await requireCurrent(this.repositories.runs.read(latestRunId));
          if (run.payload.terminal) continue;
          const cancelling: AgentRunRecord = run.payload.state === 'cancelling'
            ? run.payload
            : { ...run.payload, state: 'cancelling', updatedAt: timestamp };
          targets.push({ instance: instance.payload, run: cancelling });
          if (run.payload.state !== 'cancelling') {
            writes.push(write('runs', run.recordId, run.revision, cancelling));
          }
        }
        if (writes.length > 0) await this.transactions.execute(command.transactionId, writes);
        return targets;
      });
    });
    const terminalized: AgentRunRecord[] = [];
    for (const target of cancellationTargets) {
      const evidence = await this.resolveCancellationWithinDeadline(port, target);
      const terminal = await this.enqueue(target.instance.agentInstanceId, async () => {
        const run = await requireCurrent(this.repositories.runs.read(target.run.agentRunId));
        if (run.payload.terminal) return run.payload;
        return this.terminalizeRun(
          run,
          evidence.kind === 'cancelled'
            ? 'cancelled'
            : evidence.kind === 'terminal'
              ? evidence.status
              : 'indeterminate',
          cancellationReason(evidence),
        );
      });
      terminalized.push(terminal);
    }
    return terminalized;
  }

  async dispatchPrepared(agentRunRecordId: AgentRunId, port: AgentDispatchPort): Promise<AgentRunRecord> {
    await this.transactions.recoverPending();
    const initialRun = await requireCurrent(this.repositories.runs.read(agentRunRecordId));
    return this.enqueue(initialRun.payload.agentInstanceId, async () => {
      const run = await requireCurrent(this.repositories.runs.read(agentRunRecordId));
      if (!run.payload.dispatchToken) throw new Error('Agent run has no Grimoire dispatch intent.');
      const intent = await requireCurrent(
        this.repositories.dispatchIntents.read(run.payload.dispatchToken),
      );
      if (intent.payload.status === 'accepted') return run.payload;
      if (intent.payload.status !== 'prepared') {
        throw new Error('Agent dispatch has already started and requires reconciliation.');
      }
      const timestamp = this.now();
      const startedIntent: AgentDispatchIntentRecord = {
        ...intent.payload,
        status: 'dispatching',
        updatedAt: timestamp,
      };
      await this.transactions.execute(intent.payload.dispatchStartTransactionId, [
        write('dispatch-intents', intent.recordId, intent.revision, startedIntent),
      ]);
      const instance = await requireCurrent(
        this.repositories.instances.read(run.payload.agentInstanceId),
      );
      const refreshedIntent = await requireCurrent(
        this.repositories.dispatchIntents.read(startedIntent.dispatchToken),
      );
      return this.dispatch(instance.payload, run.payload, refreshedIntent.payload, port);
    });
  }

  private async dispatch(
    instance: AgentInstanceRecord,
    run: AgentRunRecord,
    intent: AgentDispatchIntentRecord,
    port: AgentDispatchPort,
  ): Promise<AgentRunRecord> {
    let outcome: Awaited<ReturnType<AgentDispatchPort['dispatch']>> | { readonly kind: 'unknown-effects' };
    try {
      outcome = await port.dispatch({
        agentInstanceId: instance.agentInstanceId,
        agentRunId: run.agentRunId,
        dispatchToken: intent.dispatchToken,
        providerId: instance.providerId,
        executionMode: instance.executionMode,
        rootOwner: instance.rootOwner,
        ...(run.conversationId ? { conversationId: run.conversationId } : {}),
        goalRef: run.goalRef,
        policy: run.policy,
        idempotency: intent.idempotency,
      });
    } catch {
      outcome = { kind: 'unknown-effects' };
    }
    const currentInstance = await requireCurrent(this.repositories.instances.read(instance.agentInstanceId));
    const currentRun = await requireCurrent(this.repositories.runs.read(run.agentRunId));
    const currentIntent = await requireCurrent(this.repositories.dispatchIntents.read(intent.dispatchToken));
    return this.settleDispatch(currentInstance, currentRun, currentIntent, outcome);
  }

  /**
   * Ends a dispatch that was written down and never sent.
   *
   * `recovered-safe` rather than a rejection or an unknown, for the reason
   * `settleDispatch` gives: the provider never said anything, and the record
   * establishes that nothing could have happened. That is `interrupted` with
   * `recovery-exhausted-safe`, the same pair `recoverActiveRuns` writes for the
   * identical evidence.
   */
  private async settlePreparedDispatch(
    intentRecord: VersionedRecord<AgentDispatchIntentRecord>,
  ): Promise<AgentRunRecord | undefined> {
    const runRecord = await requireCurrent(
      this.repositories.runs.read(intentRecord.payload.agentRunId),
    );
    return this.enqueue(runRecord.payload.agentInstanceId, async () => {
      const currentIntent = await requireCurrent(
        this.repositories.dispatchIntents.read(intentRecord.recordId),
      );
      if (currentIntent.payload.status !== 'prepared') return undefined;
      const currentRun = await requireCurrent(
        this.repositories.runs.read(currentIntent.payload.agentRunId),
      );
      if (currentRun.payload.terminal) {
        return this.settleTerminalDispatchIntent(currentIntent, currentRun, {
          kind: 'unknown',
          effectsPossible: false,
        });
      }
      const instanceRecord = await requireCurrent(
        this.repositories.instances.read(currentRun.payload.agentInstanceId),
      );
      return this.settleDispatch(
        instanceRecord,
        currentRun,
        currentIntent,
        { kind: 'recovered-safe' },
      );
    });
  }

  private async settleDispatch(
    instanceRecord: VersionedRecord<AgentInstanceRecord>,
    runRecord: VersionedRecord<AgentRunRecord>,
    intentRecord: VersionedRecord<AgentDispatchIntentRecord>,
    outcome:
      | Awaited<ReturnType<AgentDispatchPort['dispatch']>>
      | { readonly kind: 'unknown-effects' }
      // Recovery establishing that no effect was possible. **Not a rejection**:
      // the provider never said it refused, and writing `rejected` for it made
      // a durable claim about the provider that nobody could support.
      | { readonly kind: 'recovered-safe' },
  ): Promise<AgentRunRecord> {
    const timestamp = this.now();
    const accepted = outcome.kind === 'accepted';
    const rejected = outcome.kind === 'rejected';
    const recoveredSafe = outcome.kind === 'recovered-safe';
    const cancellationPending = runRecord.payload.state === 'cancelling';
    const intent: AgentDispatchIntentRecord = {
      ...intentRecord.payload,
      status: accepted ? 'accepted' : rejected ? 'rejected' : 'unknown',
      ...(accepted && outcome.nativeAgentRef ? { nativeAgentRef: outcome.nativeAgentRef } : {}),
      ...(rejected ? { rejectionCode: outcome.code } : {}),
      updatedAt: timestamp,
    };
    // **Three endings, not two.** A rejection is the provider's own word and is
    // `invalidated`; an unknown is `indeterminate`; and recovery establishing
    // that nothing could have happened is `interrupted` with the reason the
    // terminal policy already has for it — the same pair `recoverActiveRuns`
    // writes for the identical evidence. It used to be filed as a rejection
    // with a fabricated code.
    const terminal = accepted
      ? undefined
      : {
        kind: rejected
          ? ('invalidated' as const)
          : recoveredSafe ? ('interrupted' as const) : ('indeterminate' as const),
        reason: rejected
          ? ('side-effect-free-rejection' as const)
          : recoveredSafe ? ('recovery-exhausted-safe' as const) : ('dispatch-unknown' as const),
        occurredAt: timestamp,
      };
    const run: AgentRunRecord = {
      ...runRecord.payload,
      // One field or neither: the schema refuses a run identity without its
      // session, and spreading the two independently made an outcome that is
      // legal by the port contract unwritable — after the side effect.
      ...(accepted && outcome.execution ? outcome.execution : {}),
      ...(accepted && outcome.nativeAgentRef ? { nativeAgentRef: outcome.nativeAgentRef } : {}),
      state: accepted
        ? cancellationPending ? 'cancelling' : 'running'
        : rejected ? 'invalidated' : recoveredSafe ? 'interrupted' : 'indeterminate',
      ...(terminal ? { terminal } : {}),
      updatedAt: timestamp,
    };
    const instance: AgentInstanceRecord = {
      ...instanceRecord.payload,
      ...(accepted && outcome.nativeAgentRef ? { nativeAgentRef: outcome.nativeAgentRef } : {}),
      status: accepted ? 'active' : 'terminal',
      updatedAt: timestamp,
    };
    await this.transactions.execute(intent.settlementTransactionId, [
      write('dispatch-intents', intent.dispatchToken, intentRecord.revision, intent),
      write('runs', run.agentRunId, runRecord.revision, run),
      write('instances', instance.agentInstanceId, instanceRecord.revision, instance),
    ]);
    return run;
  }

  private async settleTerminalDispatchIntent(
    intentRecord: VersionedRecord<AgentDispatchIntentRecord>,
    runRecord: VersionedRecord<AgentRunRecord>,
    evidence: Awaited<ReturnType<AgentDispatchRecoveryPort['reconcile']>>,
  ): Promise<AgentRunRecord> {
    const accepted = runRecord.payload.resultIds.length > 0 || evidence.kind === 'accepted';
    const rejected = !accepted && evidence.kind === 'rejected';
    const intent: AgentDispatchIntentRecord = {
      ...intentRecord.payload,
      status: accepted ? 'accepted' : rejected ? 'rejected' : 'unknown',
      ...(accepted && evidence.kind === 'accepted' && evidence.nativeAgentRef
        ? { nativeAgentRef: evidence.nativeAgentRef }
        : {}),
      ...(rejected ? { rejectionCode: evidence.code } : {}),
      updatedAt: this.now(),
    };
    await this.transactions.execute(intent.settlementTransactionId, [
      write('dispatch-intents', intent.dispatchToken, intentRecord.revision, intent),
    ]);
    return runRecord.payload;
  }

  private async linkResultUnlocked(result: AgentResultRecord): Promise<AgentRunRecord> {
      const run = await requireCurrent(this.repositories.runs.read(result.agentRunId));
      if (run.payload.resultIds.includes(result.agentResultId)) return run.payload;
      if (run.payload.observedResultIds.includes(result.agentResultId)) return run.payload;
      const timestamp = this.now();
      if (result.provenance.kind === 'reconciled') {
        if (run.payload.state !== 'indeterminate') {
          throw new Error('Observed reconciliation result requires an indeterminate original run.');
        }
        const observed = await this.repositories.runs.update(run.recordId, run.revision, current => ({
          ...current,
          observedResultIds: [...current.observedResultIds, result.agentResultId],
          updatedAt: timestamp,
        }));
        return observed.payload;
      }
      const resultExecutionIdentity = executionIdentityFromResult(result);
      if (result.status === 'partial') {
        const partial = await this.repositories.runs.update(run.recordId, run.revision, current => ({
          ...current,
          ...resultExecutionIdentity,
          resultIds: [...current.resultIds, result.agentResultId],
          updatedAt: timestamp,
        }));
        return partial.payload;
      }
      const terminalStatus: AgentTerminalStatus = result.status;
      if (run.payload.terminal) {
        if (run.payload.state !== terminalStatus) {
          throw new Error('Late result conflicts with the immutable agent terminal.');
        }
        const linked = await this.repositories.runs.update(run.recordId, run.revision, current => ({
          ...current,
          ...resultExecutionIdentity,
          resultIds: [...current.resultIds, result.agentResultId],
          updatedAt: timestamp,
        }));
        await this.repairInstanceStatus(result.agentInstanceId);
        return linked.payload;
      }
      const terminal = {
        kind: terminalStatus,
        reason: terminalStatus === 'succeeded' ? 'completed' as const
          : terminalStatus === 'cancelled' ? 'cancellation-confirmed' as const
            : terminalStatus === 'interrupted' ? 'known-process-exit' as const
              : terminalStatus === 'failed' ? 'provider-failure' as const
                : 'effects-unknown' as const,
        occurredAt: result.completedAt,
      };
      const instance = await requireCurrent(
        this.repositories.instances.read(result.agentInstanceId),
      );
      const updatedRun: AgentRunRecord = {
        ...run.payload,
        ...resultExecutionIdentity,
        state: terminalStatus,
        resultIds: [...run.payload.resultIds, result.agentResultId],
        terminal,
        updatedAt: timestamp,
      };
      const updatedInstance: AgentInstanceRecord = {
        ...instance.payload,
        status: instance.payload.runIds.at(-1) === run.payload.agentRunId
          ? 'terminal'
          : instance.payload.status,
        updatedAt: timestamp,
      };
      await this.transactions.execute(run.payload.terminalTransactionId, [
        write('runs', run.recordId, run.revision, updatedRun),
        write('instances', instance.recordId, instance.revision, updatedInstance),
      ]);
      return (await requireCurrent(this.repositories.runs.read(run.recordId))).payload;
  }

  private async terminalizeRun(
    run: VersionedRecord<AgentRunRecord>,
    status: AgentTerminalStatus,
    reason: RunTerminalReason,
  ): Promise<AgentRunRecord> {
    const timestamp = this.now();
    const instance = await requireCurrent(
      this.repositories.instances.read(run.payload.agentInstanceId),
    );
    const updatedRun: AgentRunRecord = {
      ...run.payload,
      state: status,
      terminal: { kind: status, reason, occurredAt: timestamp },
      updatedAt: timestamp,
    };
    const updatedInstance: AgentInstanceRecord = {
      ...instance.payload,
      status: instance.payload.runIds.at(-1) === run.payload.agentRunId
        ? 'terminal'
        : instance.payload.status,
      updatedAt: timestamp,
    };
    await this.transactions.execute(run.payload.terminalTransactionId, [
      write('runs', run.recordId, run.revision, updatedRun),
      write('instances', instance.recordId, instance.revision, updatedInstance),
    ]);
    return (await requireCurrent(this.repositories.runs.read(run.recordId))).payload;
  }

  private async requireParent(
    parentAgentInstanceId: AgentInstanceId | undefined,
    rootOwner: ExecutionOwner,
    allowTerminal = false,
    allowCancelling = false,
  ): Promise<AgentInstanceRecord | undefined> {
    if (!parentAgentInstanceId) return undefined;
    const parent = await requireCurrent(this.repositories.instances.read(parentAgentInstanceId));
    if (stableSerialize(parent.payload.rootOwner) !== stableSerialize(rootOwner)) {
      throw new Error('Child agent must retain its parent root owner.');
    }
    if (!allowTerminal && parent.payload.status !== 'active') {
      throw new Error('Child agent parent must be active.');
    }
    const latestRunId = parent.payload.runIds.at(-1);
    if (latestRunId) {
      const latestRun = await requireCurrent(this.repositories.runs.read(latestRunId));
      if (latestRun.payload.state === 'cancelling' && !allowCancelling) {
        throw new Error('Child agent parent is cancelling.');
      }
    }
    return parent.payload;
  }

  private async requireParentRun(
    instance: AgentInstanceRecord,
    expectedRunId?: AgentRunId,
  ): Promise<AgentRunRecord> {
    const runId = expectedRunId ?? instance.runIds.at(-1);
    if (!runId || !instance.runIds.includes(runId)) {
      throw new Error('Child agent parent attempt is not owned by its parent instance.');
    }
    const run = await requireCurrent(this.repositories.runs.read(runId));
    if (run.payload.agentInstanceId !== instance.agentInstanceId) {
      throw new Error('Child agent parent attempt ownership is invalid.');
    }
    return run.payload;
  }

  private async resolveCommandPolicy(
    inputs: AgentDispatchPolicyInputs,
    durableBoundaries: readonly ReturnType<typeof effectivePolicyBoundary>[],
  ) {
    if (Object.prototype.hasOwnProperty.call(inputs, 'parent')) {
      throw new Error('Parent permission boundary is derived from durable agent state.');
    }
    return resolveEffectiveAgentPolicy({
      ...inputs,
      ...(durableBoundaries.length > 0
        ? { parent: intersectPermissionBoundaries(durableBoundaries) }
        : {}),
    });
  }

  private async validateResultReferences(result: AgentResultRecord): Promise<void> {
    try {
      const instance = await requireCurrent(
        this.repositories.instances.read(result.agentInstanceId),
      );
      const run = await requireCurrent(this.repositories.runs.read(result.agentRunId));
      if (run.payload.agentInstanceId !== instance.payload.agentInstanceId) {
        throw new Error('Agent result instance does not own its run.');
      }
      if (result.provenance.providerId !== instance.payload.providerId) {
        throw new Error('Agent result provider does not own its instance.');
      }
      if ((result.provenance.executionSessionId
          && run.payload.executionSessionId
          && result.provenance.executionSessionId !== run.payload.executionSessionId)
        || (result.provenance.executionRunId
          && run.payload.executionRunId
          && result.provenance.executionRunId !== run.payload.executionRunId)) {
        throw new Error('Agent result execution identity does not own its agent run.');
      }
      if ((result.provenance.kind === 'provider-native'
          && instance.payload.executionMode !== 'provider-native')
        || (result.provenance.kind === 'grimoire-managed'
          && instance.payload.executionMode !== 'grimoire-managed')) {
        throw new Error('Agent result provenance conflicts with its execution mode.');
      }
      for (const childResultId of result.childResultIds) {
        const child = await requireCurrent(this.repositories.results.read(childResultId));
        const childInstance = await requireCurrent(
          this.repositories.instances.read(child.payload.agentInstanceId),
        );
        const childRun = await requireCurrent(this.repositories.runs.read(child.payload.agentRunId));
        if (childRun.payload.agentInstanceId !== childInstance.payload.agentInstanceId
          || child.payload.provenance.providerId !== childInstance.payload.providerId
          || !await this.isDescendant(
            childInstance.payload.agentInstanceId,
            instance.payload.agentInstanceId,
          )) {
          throw new Error('Agent child result is not owned by a descendant instance.');
        }
      }
      if (result.provenance.kind === 'reconciled' && run.payload.state !== 'indeterminate') {
        throw new AgentResultLinkConflictError(
          'Observed reconciliation result requires an indeterminate original run.',
        );
      }
      if (result.provenance.kind !== 'reconciled'
        && result.status !== 'partial'
        && run.payload.terminal
        && run.payload.state !== result.status) {
        throw new AgentResultLinkConflictError(
          'Agent result conflicts with the immutable agent terminal.',
        );
      }
    } catch (error) {
      if (error instanceof AgentResultLinkConflictError) throw error;
      throw new AgentResultReferenceError(error);
    }
  }

  private async isDescendant(
    candidateId: AgentInstanceId,
    ancestorId: AgentInstanceId,
  ): Promise<boolean> {
    const visited = new Set<AgentInstanceId>();
    let currentId: AgentInstanceId | undefined = candidateId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const current: VersionedRecord<AgentInstanceRecord> = await requireCurrent(
        this.repositories.instances.read(currentId),
      );
      const parentId: AgentInstanceId | undefined = current.payload.parentAgentInstanceId;
      if (parentId === ancestorId) return true;
      currentId = parentId;
    }
    return false;
  }

  private async resolveCancellationWithinDeadline(
    port: AgentCancellationPort,
    target: { readonly instance: AgentInstanceRecord; readonly run: AgentRunRecord },
  ): Promise<AgentCancellationEvidence> {
    return this.resolveControlWithinDeadline(
      () => port.cancel(target),
      { kind: 'unknown' },
    );
  }

  private async resolveControlWithinDeadline<T>(
    operation: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    const scheduler = this.requireControlScheduler();
    const pending = Promise.resolve().then(operation);
    let timeoutHandle: unknown;
    const settled: Promise<T> = pending.catch(() => fallback);
    const timeout = new Promise<T>(resolve => {
      timeoutHandle = scheduler.setTimeout(() => resolve(fallback), this.controlTimeoutMs);
    });
    const value = await Promise.race([settled, timeout]);
    if (timeoutHandle !== undefined) scheduler.clearTimeout(timeoutHandle);
    return value;
  }

  private requireControlScheduler(): AgentCoordinatorScheduler {
    if (!this.scheduler) {
      throw new Error('Agent cancellation and recovery require a bounded control scheduler.');
    }
    return this.scheduler;
  }

  private async repairInstanceStatus(agentInstanceId: AgentInstanceId): Promise<void> {
    const instance = await requireCurrent(this.repositories.instances.read(agentInstanceId));
    const latestRunId = instance.payload.runIds.at(-1);
    if (!latestRunId) return;
    const latestRun = await requireCurrent(this.repositories.runs.read(latestRunId));
    const desiredStatus = latestRun.payload.terminal ? 'terminal' : 'active';
    if (instance.payload.status === desiredStatus) return;
    await this.repositories.instances.update(instance.recordId, instance.revision, current => ({
      ...current,
      status: desiredStatus,
      updatedAt: this.now(),
    }));
  }

  private async loadInstances(): Promise<Map<AgentInstanceId, AgentInstanceRecord>> {
    const instances = new Map<AgentInstanceId, AgentInstanceRecord>();
    for (const id of await this.repositories.instances.listRecordIds()) {
      const record = await requireCurrent(this.repositories.instances.read(id));
      instances.set(record.payload.agentInstanceId, record.payload);
    }
    return instances;
  }

  private enqueue<T>(instanceId: AgentInstanceId, task: () => Promise<T>): Promise<T> {
    const previous = this.instanceQueues.get(instanceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    this.instanceQueues.set(instanceId, tail);
    return operation.finally(() => {
      if (this.instanceQueues.get(instanceId) === tail) this.instanceQueues.delete(instanceId);
    });
  }

  private enqueueMany<T>(instanceIds: readonly AgentInstanceId[], task: () => Promise<T>): Promise<T> {
    const unique = [...new Set(instanceIds)].sort();
    const previous = unique.map(id => this.instanceQueues.get(id) ?? Promise.resolve());
    const operation = Promise.all(previous.map(item => item.catch(() => undefined))).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    unique.forEach(id => this.instanceQueues.set(id, tail));
    return operation.finally(() => {
      unique.forEach(id => {
        if (this.instanceQueues.get(id) === tail) this.instanceQueues.delete(id);
      });
    });
  }

  private enqueueTopology<T>(task: () => Promise<T>): Promise<T> {
    const operation = this.topologyQueue.catch(() => undefined).then(task);
    this.topologyQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

class AgentResultReferenceError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Agent result references are invalid.');
    this.name = 'AgentResultReferenceError';
  }
}

class AgentResultLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentResultLinkConflictError';
  }
}

function isResultReferenceError(error: unknown): error is AgentResultReferenceError {
  return error instanceof AgentResultReferenceError;
}

function effectivePolicyBoundary(policy: AgentRunRecord['policy']) {
  return { granted: [...policy.granted], approvable: [...policy.approvable] };
}

function executionIdentityFromResult(result: AgentResultRecord) {
  return result.provenance.executionSessionId && result.provenance.executionRunId
    ? {
      executionSessionId: result.provenance.executionSessionId,
      executionRunId: result.provenance.executionRunId,
    }
    : {};
}

function hasCancellationCascade(run: AgentRunRecord): boolean {
  return run.state === 'cancelling'
    || run.state === 'cancelled'
    || (run.state === 'indeterminate'
      && run.terminal?.reason === 'cancellation-unknown');
}

function intersectPermissionBoundaries(
  boundaries: readonly ReturnType<typeof effectivePolicyBoundary>[],
) {
  const candidates = new Set(boundaries.flatMap(boundary => [
    ...boundary.granted,
    ...boundary.approvable,
  ]));
  const granted = [...candidates].filter(permission => (
    boundaries.every(boundary => boundary.granted.includes(permission))
  )).sort();
  const approvable = [...candidates].filter(permission => (
    !granted.includes(permission)
    && boundaries.every(boundary => (
      boundary.granted.includes(permission) || boundary.approvable.includes(permission)
    ))
  )).sort();
  return { granted, approvable };
}


/**
 * How a sweep says a record it could not read was skipped.
 *
 * The two sweeps collect per record on purpose — `listRecordIds` is sorted, so
 * throwing on the first bad one stalls every later one on every restart,
 * permanently. What that left was worse in a different way: a store with one
 * unreadable record and one readable one recovered "successfully" and said
 * nothing, forever, because the throw only fires when *nothing* came back.
 */
export interface AgentRecoverySweepOptions {
  readonly onFailure?: (error: unknown) => void;
}

function reportSweepFailures(
  failures: readonly unknown[],
  recovered: readonly AgentRunRecord[],
  options: AgentRecoverySweepOptions,
): void {
  if (failures.length === 0) {
    return;
  }
  if (options.onFailure) {
    for (const failure of failures) {
      options.onFailure(failure);
    }
    return;
  }
  if (recovered.length === 0) {
    // No reporter and nothing came back: the caller learns why rather than
    // being told there was nothing to recover. Kept for the callers that pass
    // no reporter, which is every test that predates one.
    throw failures[0];
  }
}

function createIntent(
  command: Pick<PrepareAgentDispatchCommand,
  'dispatchStartTransactionId' | 'settlementTransactionId' | 'dispatchToken' | 'agentRunId' | 'idempotency'>,
  timestamp: number,
): AgentDispatchIntentRecord {
  return {
    dispatchToken: command.dispatchToken,
    dispatchStartTransactionId: command.dispatchStartTransactionId,
    settlementTransactionId: command.settlementTransactionId,
    agentRunId: command.agentRunId,
    idempotency: command.idempotency,
    status: 'prepared',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function write(
  repository: 'instances' | 'runs' | 'dispatch-intents',
  recordId: string,
  expectedRevision: number | null,
  record: AgentInstanceRecord | AgentRunRecord | AgentDispatchIntentRecord,
) {
  return {
    repository,
    recordId,
    expectedRevision,
    record: record as unknown as Readonly<Record<string, unknown>>,
  } as const;
}

async function requireCurrent<T>(
  read: Promise<VersionedRecordReadResult<T>>,
): Promise<VersionedRecord<T>> {
  const result = await read;
  if (result.kind === 'current' || result.kind === 'migrated') return result.record;
  if (result.kind === 'future') throw new Error(`Record "${result.recordId}" requires migration.`);
  if (result.kind === 'corrupt') throw new Error(`Record "${result.recordId}" is corrupt: ${result.error}`);
  throw new Error('Required agent record is absent.');
}

function requireMatchingAdoption(
  existing: AgentInstanceRecord,
  command: AdoptNativeAgentCommand,
): void {
  if (existing.nativeAdoptionKey !== command.adoptionKey
    || existing.nativeAgentRef !== command.nativeAgentRef
    || existing.parentAgentInstanceId !== command.parentAgentInstanceId
    || existing.parentAgentRunId !== command.parentAgentRunId
    || existing.providerId !== command.providerId
    || existing.executionMode !== 'provider-native'
    || existing.origin !== 'observed-native'
    || existing.attachment !== command.attachment
    || existing.observation !== command.observation
    || existing.runIds.length !== 1
    || existing.runIds[0] !== command.agentRunId
    || stableSerialize(existing.rootOwner) !== stableSerialize(command.rootOwner)
    || stableSerialize(existing.definition) !== stableSerialize(command.definition)) {
    throw new Error('Native agent adoption key conflicts with an existing instance.');
  }
}

/**
 * Cancels a tree deepest-first, and refuses to walk a cycle to do it.
 *
 * The instance schema forbids an instance parenting *itself* and nothing more,
 * so a longer cycle among records in the field — hand-edited, or half-written —
 * recursed until the stack gave out and took the cancellation with it.
 * `isDescendant` already guards exactly this with a visited set.
 */
function collectAttachedPostOrder(
  rootId: AgentInstanceId,
  instances: ReadonlyMap<AgentInstanceId, AgentInstanceRecord>,
): AgentInstanceRecord[] {
  const children = new Map<AgentInstanceId, AgentInstanceRecord[]>();
  for (const instance of instances.values()) {
    if (!instance.parentAgentInstanceId) continue;
    const entries = children.get(instance.parentAgentInstanceId) ?? [];
    entries.push(instance);
    children.set(instance.parentAgentInstanceId, entries);
  }
  const result: AgentInstanceRecord[] = [];
  const seen = new Set<AgentInstanceId>();
  const visit = (id: AgentInstanceId, root: boolean): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const instance = instances.get(id);
    if (!instance || (!root && instance.attachment === 'detached')) return;
    for (const child of children.get(id) ?? []) visit(child.agentInstanceId, false);
    result.push(instance);
  };
  visit(rootId, true);
  return result;
}

function cancellationReason(evidence: AgentCancellationEvidence): RunTerminalReason {
  if (evidence.kind === 'unknown') return 'cancellation-unknown';
  if (evidence.kind === 'cancelled' || evidence.status === 'cancelled') {
    return 'cancellation-confirmed';
  }
  if (evidence.status === 'succeeded') return 'completed';
  if (evidence.status === 'failed') return 'provider-failure';
  if (evidence.status === 'interrupted') return 'known-process-exit';
  return 'effects-unknown';
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireDistinctTransactionIds(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error('Agent lifecycle transaction ids must be distinct.');
  }
}

/** A write's effect on a cache of records: the new one, or gone. */
function applyRecordChange<TRecord>(
  cache: Map<string, TRecord>,
  recordId: string,
  record: TRecord | undefined,
): void {
  if (record === undefined) {
    cache.delete(recordId);
    return;
  }
  cache.set(recordId, record);
}
