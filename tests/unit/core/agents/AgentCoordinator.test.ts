import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type {
  AgentCancellationPort,
  AgentDispatchPort,
  AgentResultRecord,
} from '@/core/agents/AgentContracts';
import { AgentControlTransactionCoordinator } from '@/core/agents/AgentControlTransactionCoordinator';
import {
  type AdoptNativeAgentCommand,
  AgentCoordinator,
  type AgentCoordinatorScheduler,
  type PrepareAgentDispatchCommand,
} from '@/core/agents/AgentCoordinator';
import {
  adoptedAgentInstanceId,
  agentDispatchToken,
  agentInstanceId,
  agentResultId,
  agentRunId,
  nativeAgentAdoptionKey,
} from '@/core/agents/AgentIds';
import { AgentRepositories } from '@/core/agents/AgentRepositories';

const ROOT_INSTANCE_ID = agentInstanceId(`agi-${'1'.repeat(32)}`);
const ROOT_RUN_ID = agentRunId(`agr-${'2'.repeat(32)}`);
const ROOT_TOKEN = agentDispatchToken(`adt-${'3'.repeat(32)}`);
const DEFINITION = {
  definitionId: 'researcher',
  revisionDigest: 'a'.repeat(64),
  source: 'provider-files' as const,
};
const POLICY_INPUTS = {
  provider: { granted: ['read'], approvable: ['write'] },
  workspace: { granted: ['read'], approvable: ['write'] },
  root: { granted: ['read'], approvable: ['write'] },
  definition: { requested: ['read', 'write'], approvable: ['write'] },
};

describe('AgentCoordinator', () => {
  it('persists dispatch before side effects, records results, and preserves retry attempts', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    const dispatch: AgentDispatchPort['dispatch'] = jest.fn(async () => ({
      kind: 'accepted' as const,
      nativeAgentRef: 'native-agent-1',
    }));

    const first = await coordinator.prepareAndDispatch(rootCommand(), { dispatch });
    expect(first).toMatchObject({ attempt: 1, state: 'running', nativeAgentRef: 'native-agent-1' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await coordinator.repositories.dispatchIntents.read(ROOT_TOKEN)).toMatchObject({
      kind: 'current',
      record: { payload: { status: 'accepted' } },
    });

    const partialResultId = agentResultId(`ares-${'0'.repeat(32)}`);
    const partial = await coordinator.appendResult(resultRecord({
      agentResultId: partialResultId,
      status: 'partial',
      partialText: 'Checkpointed partial result',
    }));
    expect(partial).toMatchObject({ state: 'running', resultIds: [partialResultId] });

    const completed = await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'4'.repeat(32)}`),
      status: 'succeeded',
      finalText: 'Durable final result',
    }));
    expect(completed).toMatchObject({
      state: 'succeeded',
      resultIds: [partialResultId, `ares-${'4'.repeat(32)}`],
    });

    const retryRunId = agentRunId(`agr-${'5'.repeat(32)}`);
    const retry = await coordinator.retry({
      prepareTransactionId: tx('5'),
      dispatchStartTransactionId: tx('6'),
      settlementTransactionId: tx('7'),
      terminalTransactionId: tx('8'),
      agentInstanceId: ROOT_INSTANCE_ID,
      agentRunId: retryRunId,
      dispatchToken: agentDispatchToken(`adt-${'6'.repeat(32)}`),
      goalRef: 'goal-retry',
      policyInputs: POLICY_INPUTS,
      idempotency: 'provider-key',
    }, { dispatch });

    expect(retry).toMatchObject({ attempt: 2, state: 'running' });
    expect(await coordinator.repositories.runs.read(ROOT_RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'succeeded' } },
    });
    await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'d'.repeat(32)}`),
      status: 'succeeded',
      finalText: 'Late duplicate terminal evidence for attempt one',
    }));
    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    await restarted.recoverResultLinks();
    expect(await restarted.repositories.instances.read(ROOT_INSTANCE_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { status: 'active', runIds: [ROOT_RUN_ID, retryRunId] } },
    });
  });

  it('safely resumes a prepared dispatch after a crash before provider side effects', async () => {
    const storage = new TestDurableStorage();
    const repositories = new AgentRepositories(storage, monotonicClock());
    let injected = false;
    const transactions = new AgentControlTransactionCoordinator(storage, repositories, {
      now: monotonicClock(),
      crashInjector(point) {
        if (!injected && point === 'after-step-effect:step-2') {
          injected = true;
          throw new Error('simulated crash');
        }
      },
    });
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      transactions,
      scheduler: inertScheduler(),
    });
    const dispatch = jest.fn();

    await expect(coordinator.prepareAndDispatch(rootCommand(), { dispatch }))
      .rejects.toThrow('simulated crash');
    expect(dispatch).not.toHaveBeenCalled();

    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    const resumedDispatch = jest.fn(async () => ({
      kind: 'accepted' as const,
      nativeAgentRef: 'native-agent-recovered',
    }));
    const recovered = await restarted.dispatchPrepared(ROOT_RUN_ID, {
      dispatch: resumedDispatch,
    });

    expect(resumedDispatch).toHaveBeenCalledTimes(1);
    expect(recovered).toMatchObject({ state: 'running', nativeAgentRef: 'native-agent-recovered' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('adopts duplicate provider-native child evidence exactly once', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    const command = adoptionCommand('7', '8', 'child-native-1', '6');

    const first = await coordinator.adoptNativeAgent(command);
    const duplicate = await coordinator.adoptNativeAgent(command);

    expect(first.agentInstanceId).toBe(adoptedAgentInstanceId(command.adoptionKey));
    expect(duplicate).toEqual(first);
    expect(await coordinator.repositories.instances.listRecordIds()).toHaveLength(2);
    await expect(coordinator.adoptNativeAgent({
      ...command,
      nativeAgentRef: 'conflicting-native-child',
    })).rejects.toThrow('conflicts with an existing instance');
  });

  it('reconciles a dispatching attempt after acceptance may have occurred without relaunch', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareDispatch(rootCommand());
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const abandoned = coordinator.dispatchPrepared(ROOT_RUN_ID, {
      dispatch: async () => {
        markStarted();
        return new Promise(() => undefined);
      },
    });
    void abandoned.catch(() => undefined);
    await started;

    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    const reconcile = jest.fn(async () => ({
      kind: 'accepted' as const,
      nativeAgentRef: 'native-agent-after-restart',
    }));
    const recovered = await restarted.recoverPendingDispatches({ reconcile });

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(recovered).toEqual([
      expect.objectContaining({ state: 'running', nativeAgentRef: 'native-agent-after-restart' }),
    ]);
  });

  it('bounds dispatch recovery outside the instance queue and accepts concurrent result evidence', async () => {
    const storage = new TestDurableStorage();
    const original = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    await original.prepareDispatch(rootCommand());
    let markDispatchStarted!: () => void;
    const dispatchStarted = new Promise<void>(resolve => { markDispatchStarted = resolve; });
    const abandoned = original.dispatchPrepared(ROOT_RUN_ID, {
      dispatch: async () => {
        markDispatchStarted();
        return new Promise(() => undefined);
      },
    });
    void abandoned.catch(() => undefined);
    await dispatchStarted;

    let fireTimeout!: () => void;
    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      controlTimeoutMs: 10,
      scheduler: {
        setTimeout(callback) {
          fireTimeout = callback;
          return 'timer';
        },
        clearTimeout: jest.fn(),
      },
    });
    let markReconcileStarted!: () => void;
    const reconcileStarted = new Promise<void>(resolve => { markReconcileStarted = resolve; });
    const recovery = restarted.recoverPendingDispatches({
      reconcile: async () => {
        markReconcileStarted();
        return new Promise(() => undefined);
      },
    });
    await reconcileStarted;

    const completed = await restarted.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'a'.repeat(32)}`),
      status: 'succeeded',
      finalText: 'Provider result proves dispatch acceptance',
    }));
    expect(completed.state).toBe('succeeded');
    fireTimeout();
    await expect(recovery).resolves.toEqual([
      expect.objectContaining({ state: 'succeeded' }),
    ]);
    expect(await restarted.repositories.dispatchIntents.read(ROOT_TOKEN)).toMatchObject({
      kind: 'current',
      record: { payload: { status: 'accepted' } },
    });
  });

  it('keeps an indeterminate terminal immutable while materializing a reconciled result', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    const run = await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => { throw new Error('ack lost'); },
    });
    expect(run).toMatchObject({ state: 'indeterminate', terminal: { reason: 'dispatch-unknown' } });

    const observedResultId = agentResultId(`ares-${'9'.repeat(32)}`);
    const materialized = await coordinator.appendResult(resultRecord({
      agentResultId: observedResultId,
      status: 'succeeded',
      finalText: 'Observed later from native history',
      provenanceKind: 'reconciled',
    }));

    expect(materialized).toMatchObject({
      state: 'indeterminate',
      terminal: { reason: 'dispatch-unknown' },
      resultIds: [],
      observedResultIds: [observedResultId],
    });
  });

  it('recovers a committed result whose run link was interrupted', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    const result = resultRecord({
      agentResultId: agentResultId(`ares-${'b'.repeat(32)}`),
      status: 'failed',
      partialText: 'Useful partial result',
    });
    await coordinator.repositories.results.append(result.agentResultId, result);

    const restarted = new AgentCoordinator(storage, { now: monotonicClock() });
    const linked = await restarted.recoverResultLinks();

    expect(linked).toEqual({
      linkedRuns: [
        expect.objectContaining({ state: 'failed', resultIds: [result.agentResultId] }),
      ],
      issues: [],
    });
  });

  it('does not strand a run when the provider answers half an execution identity', async () => {
    // **The side effect has already happened by the time this is written.** The
    // two identities were independent optionals on the port contract and a
    // required pair in the record, so a provider that knew its run id and not a
    // session id produced an outcome that was legal to return and impossible to
    // write — the run stayed `dispatching`, and recovery funnelled the same
    // evidence through the same refusal. The contract pairs them now, so this
    // is the shape that remains: neither.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });

    const run = await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted', nativeAgentRef: 'native-1' }),
    });

    expect(run).toMatchObject({ state: 'running' });
    expect(run.executionRunId).toBeUndefined();
    expect(run.executionSessionId).toBeUndefined();
  });

  it('files recovery that found no possible effect as interrupted, not rejected', async () => {
    // Recovery answering "nothing could have happened" is **not** the provider
    // saying it refused. It used to be written as a rejection with a fabricated
    // `recovery-safe` code — a durable claim about a provider that nobody could
    // support. `recoverActiveRuns` already had the honest pair for the same
    // evidence, and this now uses it.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareDispatch(rootCommand());
    // Abandoned mid-dispatch, which is what leaves an intent at `dispatching`
    // for recovery to find — the same shape the reconciliation row above sets
    // up, and the one a crash actually produces.
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const abandoned = coordinator.dispatchPrepared(ROOT_RUN_ID, {
      dispatch: async () => {
        markStarted();
        return new Promise(() => undefined);
      },
    });
    void abandoned.catch(() => undefined);
    await started;

    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    const recovered = await restarted.recoverPendingDispatches({
      reconcile: async () => ({ kind: 'unknown', effectsPossible: false }),
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      state: 'interrupted',
      terminal: { kind: 'interrupted', reason: 'recovery-exhausted-safe' },
    });
    const intent = await restarted.repositories.dispatchIntents.read(
      recovered[0].dispatchToken as string,
    );
    expect(intent.kind === 'current' && intent.record.payload.rejectionCode).toBeFalsy();
  });

  it('adopts a native agent that a conversation started, with no parent agent', async () => {
    // **The shape Grimoire actually has.** A provider launching a background
    // subagent from a chat turn has no parent *agent* — its root is the
    // conversation. The harvest required a parent, because there every observed
    // agent was already the child of one, so such an agent could only be
    // recorded by inventing a parent for it.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });

    const adopted = await coordinator.adoptNativeAgent({
      transactionId: tx('1'),
      terminalTransactionId: tx('2'),
      adoptionKey: nativeAgentAdoptionKey(`nad-${'9'.repeat(32)}`),
      agentRunId: agentRunId(`agr-${'9'.repeat(32)}`),
      providerId: 'claude',
      definition: DEFINITION,
      rootOwner: { kind: 'conversation', ownerId: 'conv-1' },
      attachment: 'detached',
      observation: 'aggregate',
      nativeAgentRef: 'native-background-1',
      goalRef: 'goal-background',
      policyInputs: POLICY_INPUTS,
    });

    expect(adopted).toMatchObject({
      origin: 'observed-native',
      rootOwner: { kind: 'conversation', ownerId: 'conv-1' },
      status: 'active',
    });
    expect(adopted.parentAgentInstanceId).toBeUndefined();
    // Nothing above it to cascade from, so it runs.
    const run = await coordinator.repositories.runs.read(adopted.runIds[0]);
    expect(run.kind === 'current' && run.record.payload.state).toBe('running');
  });

  it('lists a conversation\'s agents from the records, not from anything live', async () => {
    // **The whole reason the records exist.** A subagent launched in a tab that
    // has since closed is in no live map anywhere, and it is exactly the work a
    // person needs to find again.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    await coordinator.adoptNativeAgent({
      transactionId: tx('e'),
      terminalTransactionId: tx('f'),
      adoptionKey: nativeAgentAdoptionKey(`nad-${'e'.repeat(32)}`),
      agentRunId: agentRunId(`agr-${'e'.repeat(32)}`),
      providerId: 'claude',
      definition: DEFINITION,
      rootOwner: { kind: 'conversation', ownerId: 'conv-other' },
      attachment: 'detached',
      observation: 'aggregate',
      nativeAgentRef: 'native-other',
      goalRef: 'goal-other',
      policyInputs: POLICY_INPUTS,
    });

    const listed = await coordinator.listOwnedAgents({
      kind: 'conversation',
      ownerId: 'conversation-1',
    });

    // Only this conversation's, and carrying no text: a goal *reference*, not
    // the goal, and no result — a card shows that work exists and how it ended.
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ state: 'running', attempt: 1 });
    expect(listed[0]).not.toHaveProperty('finalText');
  });

  it('does not read the store again for a listing nothing changed', async () => {
    // **Why the cache is there.** Every background-subagent state change asks
    // the tab for a card refresh, and a refresh listed every instance record in
    // the vault and then a run record for each. A sidecar hydration retry
    // produces a burst of them, so that was the store walked once per event.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    const owner = { kind: 'conversation' as const, ownerId: 'conversation-1' };
    await coordinator.listOwnedAgents(owner);

    let reads = 0;
    const underlying = storage.read.bind(storage);
    storage.read = async (path: string) => {
      reads += 1;
      return await underlying(path);
    };
    const again = await coordinator.listOwnedAgents(owner);

    // The listing still answers, and it answered without opening a file.
    expect(again).toHaveLength(1);
    expect(reads).toBe(0);
  });

  it('says nothing about an owner it has never listed', () => {
    // The `Stop` hook's caller must be able to tell "no agents running" from "I
    // have not looked", because it decides whether a turn may end.
    const coordinator = new AgentCoordinator(new TestDurableStorage(), { now: monotonicClock() });

    expect(coordinator.runningOwnedAgents({ kind: 'conversation', ownerId: 'conversation-1' }))
      .toBeUndefined();
  });

  it('answers `true` for a running agent before anything has listed its owner', async () => {
    // **The two answers need different amounts of knowledge.** This copy is a
    // subset of the store, so one running agent in it settles the question
    // whatever else is unread; "nothing is running" is the claim that needs the
    // whole picture. Gating both on a listing lost the positive — a subagent
    // adopted a moment ago, in a conversation nothing had listed yet, read as
    // "not running", which is the answer the `Stop` hook must never be given
    // wrongly: it ends the turn on top of work that has just started.
    const coordinator = new AgentCoordinator(new TestDurableStorage(), { now: monotonicClock() });
    const owner = { kind: 'conversation' as const, ownerId: 'conversation-1' };

    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted' }),
    });

    expect(coordinator.runningOwnedAgents(owner)).toBe(true);
  });

  it('answers whether an agent is running without waiting, once it has listed', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    const owner = { kind: 'conversation' as const, ownerId: 'conversation-1' };
    await coordinator.listOwnedAgents(owner);

    expect(coordinator.runningOwnedAgents(owner)).toBe(true);

    // Settled through the same write funnel that keeps the copy current, so the
    // answer changes without anything going back to the store.
    await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'7'.repeat(32)}`),
      status: 'succeeded',
      finalText: 'done',
    }));
    let reads = 0;
    const underlying = storage.read.bind(storage);
    storage.read = async (path: string) => {
      reads += 1;
      return await underlying(path);
    };

    expect(coordinator.runningOwnedAgents(owner)).toBe(false);
    expect(reads).toBe(0);
  });

  it('is up to date the moment a write finishes, without going back to the store', async () => {
    // **The window this closes.** A cache told only *that* something changed has
    // to go and look, and until it does the honest answer is "I do not know" —
    // which is the answer that cannot be given to the `Stop` hook, because both
    // ways of guessing are wrong: assume running and turns that should have
    // ended block, assume idle and a turn ends on top of an agent that has just
    // started. So the write carries the record and the reader is current when it
    // returns.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'rejected', code: 'refused', sideEffectFree: true }),
    });
    const owner = { kind: 'conversation' as const, ownerId: 'conversation-1' };
    await coordinator.listOwnedAgents(owner);

    await coordinator.retry({
      prepareTransactionId: tx('8'),
      dispatchStartTransactionId: tx('9'),
      settlementTransactionId: tx('a'),
      terminalTransactionId: tx('b'),
      agentInstanceId: ROOT_INSTANCE_ID,
      agentRunId: agentRunId(`agr-${'c'.repeat(32)}`),
      dispatchToken: agentDispatchToken(`adt-${'d'.repeat(32)}`),
      goalRef: 'second-attempt',
      policyInputs: POLICY_INPUTS,
      idempotency: 'provider-key',
    }, { dispatch: async () => ({ kind: 'accepted' }) });

    let reads = 0;
    const underlying = storage.read.bind(storage);
    storage.read = async (path: string) => {
      reads += 1;
      return await underlying(path);
    };
    const listed = await coordinator.listOwnedAgents(owner);

    // The new attempt, from what the write left behind rather than from a file.
    expect(listed).toMatchObject([{ attempt: 2, goalRef: 'second-attempt' }]);
    expect(reads).toBe(0);
  });

  it('sees a record that changed after it was last read', async () => {
    // **The cache behind `listOwnedAgents` has to be evicted, and this is what
    // says so.** Reading the whole store on every call was the previous
    // behaviour and could not go stale; a process-local copy can. Listing
    // before the retry warms both caches — the instance, whose `runIds` gains
    // one, and the run, whose attempt is superseded — so a missing eviction
    // answers the second call with the first call's attempt.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'rejected', code: 'refused', sideEffectFree: true }),
    });
    const owner = { kind: 'conversation' as const, ownerId: 'conversation-1' };
    const before = await coordinator.listOwnedAgents(owner);
    expect(before[0]).toMatchObject({ attempt: 1 });

    await coordinator.retry({
      prepareTransactionId: tx('8'),
      dispatchStartTransactionId: tx('9'),
      settlementTransactionId: tx('a'),
      terminalTransactionId: tx('b'),
      agentInstanceId: ROOT_INSTANCE_ID,
      agentRunId: agentRunId(`agr-${'c'.repeat(32)}`),
      dispatchToken: agentDispatchToken(`adt-${'d'.repeat(32)}`),
      goalRef: 'second-attempt',
      policyInputs: POLICY_INPUTS,
      idempotency: 'provider-key',
    }, { dispatch: async () => ({ kind: 'accepted' }) });

    expect(await coordinator.listOwnedAgents(owner)).toMatchObject([
      { attempt: 2, goalRef: 'second-attempt' },
    ]);
  });

  it('lists the attempt that is happening, not the ones before it', async () => {
    // A retry keeps its predecessors and they are history; a card showing three
    // attempts of one agent is showing one agent.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'rejected', code: 'refused', sideEffectFree: true }),
    });
    await coordinator.retry({
      prepareTransactionId: tx('8'),
      dispatchStartTransactionId: tx('9'),
      settlementTransactionId: tx('a'),
      terminalTransactionId: tx('b'),
      agentInstanceId: ROOT_INSTANCE_ID,
      agentRunId: agentRunId(`agr-${'c'.repeat(32)}`),
      dispatchToken: agentDispatchToken(`adt-${'d'.repeat(32)}`),
      goalRef: 'second-attempt',
      policyInputs: POLICY_INPUTS,
      idempotency: 'provider-key',
    }, { dispatch: async () => ({ kind: 'accepted' }) });

    const listed = await coordinator.listOwnedAgents({
      kind: 'conversation',
      ownerId: 'conversation-1',
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ attempt: 2, goalRef: 'second-attempt', state: 'running' });
  });

  it('deletes every record a conversation owns, and nothing another owns', async () => {
    // **D3 decided this and nothing did it.** An agent instance and its
    // attempts are kept until the owning conversation is deleted, deliberately,
    // so "deleting the chat deletes its traces" stays true without a second
    // retention concept. `deleteOwnedRecords` on the lifecycle registry removes
    // sessions, runs, interactions and reconciliations — and knows nothing
    // about this domain, which is right, so the deletion had to be here and was
    // not.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    const other = await coordinator.adoptNativeAgent({
      transactionId: tx('e'),
      terminalTransactionId: tx('f'),
      adoptionKey: nativeAgentAdoptionKey(`nad-${'e'.repeat(32)}`),
      agentRunId: agentRunId(`agr-${'e'.repeat(32)}`),
      providerId: 'claude',
      definition: DEFINITION,
      rootOwner: { kind: 'conversation', ownerId: 'conv-other' },
      attachment: 'detached',
      observation: 'aggregate',
      nativeAgentRef: 'native-other',
      goalRef: 'goal-other',
      policyInputs: POLICY_INPUTS,
    });

    await coordinator.deleteOwnedRecords(
      { kind: 'conversation', ownerId: 'conversation-1' },
      tx('9'),
    );

    expect(await coordinator.repositories.instances.listRecordIds()).toEqual([
      other.agentInstanceId,
    ]);
    expect(await coordinator.repositories.dispatchIntents.listRecordIds()).toEqual([]);
    // The other conversation's run is untouched.
    expect(await coordinator.repositories.runs.listRecordIds()).toEqual(other.runIds);
  });

  it('refuses a retry on an instance with no attempt to retry', async () => {
    // The schema permits `runIds: []`, and a record in the field can have one —
    // half-written, or hand-edited. It used to raise `Reduce of empty array
    // with no initial value` and compute `-Infinity` for the attempt number.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    const instanceId = ROOT_INSTANCE_ID;
    const read = await coordinator.repositories.instances.read(instanceId);
    if (read.kind !== 'current') throw new Error('Expected the adopted instance.');
    await coordinator.repositories.instances.update(
      instanceId,
      read.record.revision,
      current => ({ ...current, runIds: [] }),
    );

    await expect(coordinator.prepareRetry({
      prepareTransactionId: tx('8'),
      dispatchStartTransactionId: tx('9'),
      settlementTransactionId: tx('a'),
      terminalTransactionId: tx('b'),
      agentInstanceId: instanceId,
      agentRunId: agentRunId(`agr-${'c'.repeat(32)}`),
      dispatchToken: agentDispatchToken(`adt-${'d'.repeat(32)}`),
      goalRef: 'retry-with-no-attempts',
      policyInputs: POLICY_INPUTS,
      idempotency: 'provider-key',
    })).rejects.toThrow('requires a prior attempt');
  });

  it('recovers the runs it can when one of them answers badly', async () => {
    // **`listRecordIds` is sorted**, so a record that throws throws first on
    // every restart and nothing after it is ever recovered — one malformed
    // answer stalls the whole domain, permanently. `recoverResultLinks` already
    // collected per record; these two did not.
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      dispatch: async () => ({ kind: 'accepted' }),
    });
    const second = adoptionCommand('7', '8', 'child-native-1', '6');
    await coordinator.adoptNativeAgent(second);

    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    let asked = 0;
    const recovered = await restarted.recoverActiveRuns(
      {
        // The first is answered with a status and a reason the terminal policy
        // refuses together — an ordinary port-contract slip, since the evidence
        // type pairs them freely and only the write rejects it.
        reconcile: async () => (++asked === 1
          ? { kind: 'terminal' as const, status: 'succeeded' as const, reason: 'timeout' as const }
          : { kind: 'terminal' as const, status: 'succeeded' as const, reason: 'completed' as const }),
      },
      { reconcileCancellation: async () => ({ kind: 'unknown' as const, effectsPossible: false }) },
    );

    expect(asked).toBe(2);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ state: 'succeeded' });
  });

  it('validates result ownership and provenance before append-only persistence', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), {
      // The pair, together: a run identity without its session is a shape the
      // record refuses, so the port cannot return one either.
      dispatch: async () => ({
        kind: 'accepted',
        execution: {
          executionSessionId: `es-${'2'.repeat(32)}` as NonNullable<AgentResultRecord['provenance']['executionSessionId']>,
          executionRunId: `run-${'2'.repeat(32)}` as NonNullable<AgentResultRecord['provenance']['executionRunId']>,
        },
      }),
    });
    const child = adoptionCommand('7', '8', 'child-native-1', '6');
    await coordinator.adoptNativeAgent(child);

    const wrongProvider = resultRecord({
      agentResultId: agentResultId(`ares-${'1'.repeat(32)}`),
      status: 'succeeded',
      providerId: 'claude',
    });
    await expect(coordinator.appendResult(wrongProvider))
      .rejects.toThrow('provider does not own');
    expect(await coordinator.repositories.results.read(wrongProvider.agentResultId))
      .toMatchObject({ kind: 'absent' });

    const wrongRun = resultRecord({
      agentResultId: agentResultId(`ares-${'2'.repeat(32)}`),
      status: 'succeeded',
      agentInstanceId: adoptedAgentInstanceId(child.adoptionKey),
      agentRunId: ROOT_RUN_ID,
    });
    await expect(coordinator.appendResult(wrongRun))
      .rejects.toThrow('instance does not own');
    expect(await coordinator.repositories.results.read(wrongRun.agentResultId))
      .toMatchObject({ kind: 'absent' });

    const wrongExecutionRun = resultRecord({
      agentResultId: agentResultId(`ares-${'3'.repeat(32)}`),
      status: 'succeeded',
      executionSessionId: `es-${'1'.repeat(32)}` as AgentResultRecord['provenance']['executionSessionId'],
      executionRunId: `run-${'1'.repeat(32)}` as AgentResultRecord['provenance']['executionRunId'],
    });
    await expect(coordinator.appendResult(wrongExecutionRun))
      .rejects.toThrow('execution identity does not own');
    expect(await coordinator.repositories.results.read(wrongExecutionRun.agentResultId))
      .toMatchObject({ kind: 'absent' });

    await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'4'.repeat(32)}`),
      status: 'succeeded',
    }));
    const conflictingTerminal = resultRecord({
      agentResultId: agentResultId(`ares-${'a'.repeat(32)}`),
      status: 'failed',
    });
    await expect(coordinator.appendResult(conflictingTerminal))
      .rejects.toThrow('conflicts with the immutable agent terminal');
    expect(await coordinator.repositories.results.read(conflictingTerminal.agentResultId))
      .toMatchObject({ kind: 'absent' });
  });

  it('accepts only descendant child results and isolates poisoned recovery records', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    const firstChild = adoptionCommand('7', '8', 'first-child', '6');
    const secondChild = adoptionCommand('9', 'a', 'second-child', 'b');
    const firstInstanceId = adoptedAgentInstanceId(firstChild.adoptionKey);
    const secondInstanceId = adoptedAgentInstanceId(secondChild.adoptionKey);
    await coordinator.adoptNativeAgent(firstChild);
    await coordinator.adoptNativeAgent(secondChild);
    const childResult = resultRecord({
      agentResultId: agentResultId(`ares-${'5'.repeat(32)}`),
      status: 'succeeded',
      agentInstanceId: firstInstanceId,
      agentRunId: firstChild.agentRunId,
    });
    await coordinator.appendResult(childResult);

    const siblingClaim = resultRecord({
      agentResultId: agentResultId(`ares-${'6'.repeat(32)}`),
      status: 'succeeded',
      agentInstanceId: secondInstanceId,
      agentRunId: secondChild.agentRunId,
      childResultIds: [childResult.agentResultId],
    });
    await expect(coordinator.appendResult(siblingClaim))
      .rejects.toThrow('not owned by a descendant');

    const poisoned = resultRecord({
      agentResultId: agentResultId(`ares-${'0'.repeat(32)}`),
      status: 'succeeded',
      providerId: 'claude',
    });
    const recoverable = resultRecord({
      agentResultId: agentResultId(`ares-${'f'.repeat(32)}`),
      status: 'failed',
    });
    await coordinator.repositories.results.append(poisoned.agentResultId, poisoned);
    await coordinator.repositories.results.append(recoverable.agentResultId, recoverable);

    const report = await new AgentCoordinator(storage, { now: monotonicClock() })
      .recoverResultLinks();

    expect(report.issues).toContainEqual({
      agentResultId: poisoned.agentResultId,
      code: 'invalid-result-reference',
    });
    expect(report.linkedRuns).toContainEqual(expect.objectContaining({
      agentRunId: ROOT_RUN_ID,
      state: 'failed',
      resultIds: [recoverable.agentResultId],
    }));
  });

  it('derives child and retry permission ceilings from durable ancestor policy', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, { now: monotonicClock() });
    await coordinator.prepareAndDispatch(rootCommand({
      policyInputs: {
        provider: { granted: ['read'], approvable: [] },
        workspace: { granted: ['read'], approvable: [] },
        root: { granted: ['read'], approvable: [] },
        definition: { requested: ['read', 'write'], approvable: ['write'] },
      },
    }), acceptedPort());

    const preparedChild = await coordinator.prepareDispatch(managedChildCommand());
    expect(preparedChild.policy).toEqual({
      granted: ['read'],
      approvable: [],
      denied: ['write'],
    });

    await expect(coordinator.prepareDispatch({
      ...managedChildCommand('e'),
      policyInputs: {
        ...POLICY_INPUTS,
        parent: { granted: ['read', 'write'], approvable: [] },
      },
    } as unknown as PrepareAgentDispatchCommand))
      .rejects.toThrow('derived from durable agent state');

    await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'7'.repeat(32)}`),
      status: 'succeeded',
    }));
    const retry = await coordinator.prepareRetry({
      prepareTransactionId: tx('8'),
      dispatchStartTransactionId: tx('9'),
      settlementTransactionId: tx('a'),
      terminalTransactionId: tx('b'),
      agentInstanceId: ROOT_INSTANCE_ID,
      agentRunId: agentRunId(`agr-${'c'.repeat(32)}`),
      dispatchToken: agentDispatchToken(`adt-${'d'.repeat(32)}`),
      goalRef: 'retry-with-expanded-request',
      policyInputs: POLICY_INPUTS,
      idempotency: 'provider-key',
    });
    expect(retry.policy).toEqual({
      granted: ['read'],
      approvable: [],
      denied: ['write'],
    });
  });

  it('cancels attached descendants but leaves detached work owned durably', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    const attached = adoptionCommand('c', 'd', 'attached-native', '7');
    const detached = { ...adoptionCommand('e', 'f', 'detached-native', '8'), attachment: 'detached' as const };
    await coordinator.adoptNativeAgent(attached);
    await coordinator.adoptNativeAgent(detached);
    const cancel = jest.fn<ReturnType<AgentCancellationPort['cancel']>, Parameters<AgentCancellationPort['cancel']>>(
      async () => ({ kind: 'cancelled' }),
    );

    const cancelled = await coordinator.cancelAttachedTree({
      transactionId: tx('9'),
      rootAgentInstanceId: ROOT_INSTANCE_ID,
    }, { cancel });

    expect(cancelled).toHaveLength(2);
    expect(cancel.mock.calls.map(([query]) => query.instance.agentInstanceId)).toEqual([
      adoptedAgentInstanceId(attached.adoptionKey),
      ROOT_INSTANCE_ID,
    ]);
    expect(await coordinator.repositories.runs.read(detached.agentRunId)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'running' } },
    });
  });

  it('persists cancellation intent before the native side effect and reconciles it after restart', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const abandoned = coordinator.cancelAttachedTree({
      transactionId: tx('9'),
      rootAgentInstanceId: ROOT_INSTANCE_ID,
    }, {
      cancel: async () => {
        markStarted();
        return new Promise(() => undefined);
      },
    });
    void abandoned.catch(() => undefined);
    await started;
    expect(await coordinator.repositories.runs.read(ROOT_RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'cancelling' } },
    });

    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    const reconcile = jest.fn();
    const reconcileCancellation = jest.fn(async () => ({ kind: 'cancelled' as const }));
    const recovered = await restarted.recoverActiveRuns(
      { reconcile },
      { reconcileCancellation },
    );

    expect(reconcile).not.toHaveBeenCalled();
    expect(reconcileCancellation).toHaveBeenCalledTimes(1);
    expect(recovered).toEqual([
      expect.objectContaining({
        state: 'cancelled',
        terminal: expect.objectContaining({ reason: 'cancellation-confirmed' }),
      }),
    ]);
  });

  it('durably fences the complete attached tree before the first native cancellation', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    const child = adoptionCommand('c', 'd', 'attached-native', '7');
    await coordinator.adoptNativeAgent(child);
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const abandoned = coordinator.cancelAttachedTree({
      transactionId: tx('9'),
      rootAgentInstanceId: ROOT_INSTANCE_ID,
    }, {
      cancel: async () => {
        markStarted();
        return new Promise(() => undefined);
      },
    });
    void abandoned.catch(() => undefined);
    await started;

    expect(await coordinator.repositories.runs.read(child.agentRunId)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'cancelling' } },
    });
    expect(await coordinator.repositories.runs.read(ROOT_RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'cancelling' } },
    });
  });

  it('recovers the full tree fence after a crash between child and parent writes', async () => {
    const storage = new TestDurableStorage();
    const setup = new AgentCoordinator(storage, { now: monotonicClock() });
    await setup.prepareAndDispatch(rootCommand(), acceptedPort());
    const child = adoptionCommand('c', 'd', 'attached-native', '7');
    await setup.adoptNativeAgent(child);
    const repositories = new AgentRepositories(storage, monotonicClock());
    let injected = false;
    const transactions = new AgentControlTransactionCoordinator(storage, repositories, {
      now: monotonicClock(),
      crashInjector(point) {
        if (!injected && point === 'after-step-effect:step-0') {
          injected = true;
          throw new Error('simulated cancellation crash');
        }
      },
    });
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      transactions,
      scheduler: inertScheduler(),
    });
    const cancel = jest.fn();

    await expect(coordinator.cancelAttachedTree({
      transactionId: tx('9'),
      rootAgentInstanceId: ROOT_INSTANCE_ID,
    }, { cancel })).rejects.toThrow('simulated cancellation crash');
    expect(cancel).not.toHaveBeenCalled();

    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    const reconcileCancellation = jest.fn(async () => ({ kind: 'cancelled' as const }));
    const recovered = await restarted.recoverActiveRuns(
      { reconcile: jest.fn() },
      { reconcileCancellation },
    );
    expect(reconcileCancellation).toHaveBeenCalledTimes(2);
    expect(recovered).toHaveLength(2);
    expect(recovered.every(run => run.state === 'cancelled')).toBe(true);
  });

  it('does not block an authoritative result behind a never-settling native cancellation', async () => {
    const storage = new TestDurableStorage();
    let fireTimeout!: () => void;
    const scheduler: AgentCoordinatorScheduler = {
      setTimeout(callback) {
        fireTimeout = callback;
        return 'timer';
      },
      clearTimeout: jest.fn(),
    };
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      controlTimeoutMs: 10,
      scheduler,
    });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const cancellation = coordinator.cancelAttachedTree({
      transactionId: tx('9'),
      rootAgentInstanceId: ROOT_INSTANCE_ID,
    }, {
      cancel: async () => {
        markStarted();
        return new Promise(() => undefined);
      },
    });
    await started;

    const completed = await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'e'.repeat(32)}`),
      status: 'succeeded',
      finalText: 'Provider completed while cancellation was unresolved',
    }));
    expect(completed.state).toBe('succeeded');
    fireTimeout();
    await expect(cancellation).resolves.toEqual([
      expect.objectContaining({ state: 'succeeded' }),
    ]);
  });

  it('bounds restart cancellation outside the instance queue and preserves a concurrent result', async () => {
    const storage = new TestDurableStorage();
    let fireTimeout!: () => void;
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      controlTimeoutMs: 10,
      scheduler: {
        setTimeout(callback) {
          fireTimeout = callback;
          return 'timer';
        },
        clearTimeout: jest.fn(),
      },
    });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    const current = await coordinator.repositories.runs.read(ROOT_RUN_ID);
    if (current.kind !== 'current' && current.kind !== 'migrated') {
      throw new Error('Expected current agent run.');
    }
    await coordinator.repositories.runs.update(current.record.recordId, current.record.revision, run => ({
      ...run,
      state: 'cancelling',
      updatedAt: 30,
    }));
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const recovery = coordinator.recoverActiveRuns(
      { reconcile: jest.fn() },
      {
        reconcileCancellation: async () => {
          markStarted();
          return new Promise(() => undefined);
        },
      },
    );
    await started;

    const completed = await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'8'.repeat(32)}`),
      status: 'succeeded',
      finalText: 'Recovered provider result',
    }));
    expect(completed.state).toBe('succeeded');
    fireTimeout();
    await expect(recovery).resolves.toEqual([
      expect.objectContaining({ state: 'succeeded' }),
    ]);
  });

  it('adopts a missed attached child under a cancelled parent into cancellation recovery', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    await coordinator.cancelAttachedTree({
      transactionId: tx('9'),
      rootAgentInstanceId: ROOT_INSTANCE_ID,
    }, { cancel: async () => ({ kind: 'cancelled' }) });

    const restarted = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    const child = adoptionCommand('c', 'd', 'missed-attached-child', '7');
    const adopted = await restarted.adoptNativeAgent(child);
    expect(await restarted.repositories.runs.read(adopted.runIds[0])).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'cancelling' } },
    });

    const recovered = await restarted.recoverActiveRuns(
      { reconcile: jest.fn() },
      { reconcileCancellation: async () => ({ kind: 'cancelled' }) },
    );
    expect(recovered).toEqual([
      expect.objectContaining({ agentRunId: child.agentRunId, state: 'cancelled' }),
    ]);
  });

  it('binds late child evidence to the cancelled parent attempt rather than its active retry', async () => {
    const storage = new TestDurableStorage();
    const coordinator = new AgentCoordinator(storage, {
      now: monotonicClock(),
      scheduler: inertScheduler(),
    });
    await coordinator.prepareAndDispatch(rootCommand(), acceptedPort());
    await coordinator.appendResult(resultRecord({
      agentResultId: agentResultId(`ares-${'9'.repeat(32)}`),
      status: 'cancelled',
    }));
    const retryRunId = agentRunId(`agr-${'e'.repeat(32)}`);
    await coordinator.retry({
      prepareTransactionId: tx('8'),
      dispatchStartTransactionId: tx('9'),
      settlementTransactionId: tx('a'),
      terminalTransactionId: tx('b'),
      agentInstanceId: ROOT_INSTANCE_ID,
      agentRunId: retryRunId,
      dispatchToken: agentDispatchToken(`adt-${'e'.repeat(32)}`),
      goalRef: 'active-parent-retry',
      policyInputs: POLICY_INPUTS,
      idempotency: 'provider-key',
    }, acceptedPort());

    const child = adoptionCommand('c', 'd', 'late-prior-attempt-child', '7');
    const adopted = await coordinator.adoptNativeAgent(child);
    expect(adopted.parentAgentRunId).toBe(ROOT_RUN_ID);
    expect(await coordinator.repositories.runs.read(child.agentRunId)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'cancelling' } },
    });
    expect(await coordinator.repositories.runs.read(retryRunId)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'running' } },
    });
  });
});

function rootCommand(
  overrides: Partial<PrepareAgentDispatchCommand> = {},
): PrepareAgentDispatchCommand {
  return {
    prepareTransactionId: tx('1'),
    dispatchStartTransactionId: tx('2'),
    settlementTransactionId: tx('3'),
    terminalTransactionId: tx('4'),
    agentInstanceId: ROOT_INSTANCE_ID,
    agentRunId: ROOT_RUN_ID,
    dispatchToken: ROOT_TOKEN,
    providerId: 'codex',
    definition: DEFINITION,
    executionMode: 'provider-native',
    rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
    attachment: 'attached',
    observation: 'full',
    goalRef: 'goal-root',
    policyInputs: POLICY_INPUTS,
    idempotency: 'provider-key',
    ...overrides,
  };
}

function managedChildCommand(hex = 'a'): PrepareAgentDispatchCommand {
  return {
    prepareTransactionId: tx(hex),
    dispatchStartTransactionId: tx('b'),
    settlementTransactionId: tx('c'),
    terminalTransactionId: tx('d'),
    agentInstanceId: agentInstanceId(`agi-${hex.repeat(32)}`),
    agentRunId: agentRunId(`agr-${hex.repeat(32)}`),
    dispatchToken: agentDispatchToken(`adt-${hex.repeat(32)}`),
    providerId: 'codex',
    definition: DEFINITION,
    executionMode: 'grimoire-managed',
    rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
    parentAgentInstanceId: ROOT_INSTANCE_ID,
    attachment: 'attached',
    observation: 'none',
    goalRef: `goal-child-${hex}`,
    policyInputs: POLICY_INPUTS,
    idempotency: 'provider-key',
  };
}

function adoptionCommand(
  adoptionHex: string,
  runHex: string,
  nativeAgentRef: string,
  transactionHex: string,
): AdoptNativeAgentCommand {
  return {
    transactionId: tx(transactionHex),
    terminalTransactionId: tx(adoptionHex),
    adoptionKey: nativeAgentAdoptionKey(`nad-${adoptionHex.repeat(32)}`),
    agentRunId: agentRunId(`agr-${runHex.repeat(32)}`),
    providerId: 'codex',
    definition: DEFINITION,
    rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
    parentAgentInstanceId: ROOT_INSTANCE_ID,
    parentAgentRunId: ROOT_RUN_ID,
    attachment: 'attached',
    observation: 'full',
    nativeAgentRef,
    goalRef: `goal-${adoptionHex}`,
    policyInputs: POLICY_INPUTS,
  };
}

function resultRecord(input: {
  agentResultId: AgentResultRecord['agentResultId'];
  status: AgentResultRecord['status'];
  finalText?: string;
  partialText?: string;
  provenanceKind?: AgentResultRecord['provenance']['kind'];
  providerId?: string;
  executionSessionId?: AgentResultRecord['provenance']['executionSessionId'];
  executionRunId?: AgentResultRecord['provenance']['executionRunId'];
  agentInstanceId?: AgentResultRecord['agentInstanceId'];
  agentRunId?: AgentResultRecord['agentRunId'];
  childResultIds?: AgentResultRecord['childResultIds'];
}): AgentResultRecord {
  return {
    agentResultId: input.agentResultId,
    agentInstanceId: input.agentInstanceId ?? ROOT_INSTANCE_ID,
    agentRunId: input.agentRunId ?? ROOT_RUN_ID,
    status: input.status,
    ...(input.finalText ? { finalText: input.finalText } : {}),
    ...(input.partialText ? { partialText: input.partialText } : {}),
    artifacts: [],
    changedFiles: [],
    citations: [],
    childResultIds: input.childResultIds ?? [],
    provenance: {
      kind: input.provenanceKind ?? 'provider-native',
      providerId: input.providerId ?? 'codex',
      ...(input.executionSessionId ? { executionSessionId: input.executionSessionId } : {}),
      ...(input.executionRunId ? { executionRunId: input.executionRunId } : {}),
      observedAt: 20,
    },
    completedAt: 20,
  };
}

function acceptedPort(): AgentDispatchPort {
  return { dispatch: async () => ({ kind: 'accepted', nativeAgentRef: 'native-agent-1' }) };
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
