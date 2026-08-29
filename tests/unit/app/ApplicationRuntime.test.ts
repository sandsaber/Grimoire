import '@/providers';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { ApplicationRuntime } from '@/app/ApplicationRuntime';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import {
  AGENT_DISPATCH_INTENTS_PATH,
  AGENT_INSTANCES_PATH,
} from '@/core/agents/AgentControlPaths';
import { AgentControlTransactionCoordinator } from '@/core/agents/AgentControlTransactionCoordinator';
import { AgentCoordinator } from '@/core/agents/AgentCoordinator';
import {
  agentDispatchToken,
  agentInstanceId,
  agentRunId,
  nativeAgentAdoptionKey,
} from '@/core/agents/AgentIds';
import { AgentRepositories } from '@/core/agents/AgentRepositories';
import { SessionStorage } from '@/core/bootstrap/SessionStorage';
import { providerCatalog } from '@/core/providers/ProviderCatalog';
import type GrimoirePlugin from '@/main';

/**
 * The composition root, and the one question only it can answer.
 *
 * Each provider composition has its own tests and the kernel has its own; what
 * neither can see is whether the application actually *builds* them. A provider
 * added to the catalog and never registered here has a settings tab, a model
 * list and a chat tab, and refuses every turn with "no backend for this
 * provider" — which reads as a kernel defect and is a missing line in one file.
 */
describe('application runtime', () => {
  function createPlugin(): GrimoirePlugin {
    return {
      settings: { providerConfigs: {} },
      app: { vault: { adapter: { basePath: '/vault' } } },
      manifest: { version: '0.0.0-test' },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => null,
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
      saveSettings: async () => undefined,
    } as unknown as GrimoirePlugin;
  }

  function createRuntime(
    report: jest.Mock = jest.fn(),
    adapter = createDurableInMemoryVaultAdapter(),
  ) {
    const sessions = new SessionStorage(adapter, new VaultDurableStorage(adapter));
    return new ApplicationRuntime({
      plugin: createPlugin(),
      adapter,
      sessions,
      defaultProviderId: 'claude',
      resolveTitleProviderId: () => 'codex',
      report,
    });
  }

  it('registers a backend for every provider the catalog declares', async () => {
    const runtime = createRuntime();

    // Asked of the kernel rather than counted here: the registry refuses a
    // duplicate id and refuses registration after startup, so a backend that
    // answers a generation is one it actually holds.
    const missing = providerCatalog().ids().filter(providerId => (
      runtime.kernel.registry.getBackendGeneration(
        providerCatalog().get(providerId)!.execution.descriptor.backendId,
      ) === null
    ));

    expect(missing).toEqual([]);
    // Guards the reader: a catalog that answered nothing would report no
    // missing providers for the same reason a complete composition does.
    expect(providerCatalog().ids()).toHaveLength(9);
    runtime.dispose();
  });

  it('registers the shell the application owns, beside the providers', async () => {
    // Bang-bash is a run the kernel owns, which is what makes shutdown cancel
    // it rather than leave a process behind the plugin that started it.
    const runtime = createRuntime();

    expect(runtime.kernel.registry.getBackendGeneration(
      runtime.localShell.createBackend().descriptor.backendId,
    )).not.toBeNull();
    runtime.dispose();
  });

  it('finishes an agent control transaction the last process died half-way through', async () => {
    // The kernel recovers its own store when its gate opens. The agent domain
    // has the same machinery and nothing was calling it, so a batch interrupted
    // by a quit stayed half-applied for the life of the vault: here, an
    // instance naming a run that has no record — and, for the write that
    // records a background agent's result, a run left running forever, because
    // the durable records are now the only source of "is one running".
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new VaultDurableStorage(adapter);
    const repositories = new AgentRepositories(storage, monotonicClock());
    let crashed = false;
    const crashing = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      transactions: new AgentControlTransactionCoordinator(storage, repositories, {
        now: monotonicClock(),
        crashInjector(point) {
          if (!crashed && point === 'after-step-effect:step-0') {
            crashed = true;
            throw new Error('simulated quit');
          }
        },
      }),
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    });

    await expect(crashing.prepareDispatch(dispatchCommand())).rejects.toThrow('simulated quit');
    expect(await repositories.instances.read(INSTANCE_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { runIds: [RUN_ID] } },
    });
    expect(await repositories.runs.read(RUN_ID)).toMatchObject({ kind: 'absent' });

    const runtime = createRuntime(jest.fn(), adapter);
    await runtime.start();

    // Both halves: the batch the crash left owed is finished, and the run it
    // wrote is then classified rather than left `dispatching`. The intent is
    // still `prepared`, which is proof the provider was never called — so the
    // honest ending is the side-effect-free one.
    expect(await repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: {
        payload: {
          agentInstanceId: INSTANCE_ID,
          state: 'interrupted',
          terminal: { kind: 'interrupted', reason: 'recovery-exhausted-safe' },
        },
      },
    });
    runtime.dispose();
  });

  it('ends a dispatch that was written down and never sent', async () => {
    // The state no sweep reached: `prepareDispatch` succeeded and the process
    // went away before `dispatchPrepared`. `recoverPendingDispatches` looked
    // only at intents already `dispatching` and `recoverActiveRuns` only at
    // runs already `running`, so this run stayed non-terminal for the life of
    // the vault — and a conversation with a non-terminal agent is one that
    // never stops reporting an agent as running.
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new VaultDurableStorage(adapter);
    const repositories = new AgentRepositories(storage, monotonicClock());
    const before = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    });
    await before.prepareDispatch(dispatchCommand());
    expect(await repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'dispatching' } },
    });

    const runtime = createRuntime(jest.fn(), adapter);
    await runtime.start();

    expect(await repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: {
        payload: {
          state: 'interrupted',
          terminal: { kind: 'interrupted', reason: 'recovery-exhausted-safe' },
        },
      },
    });
    // And the conversation stops reporting an agent that never started, read
    // with the predicate the tab uses: a non-terminal owned agent is what
    // `hasRunningDurableSubagents` answers `true` from.
    const owned = await runtime.agents.listOwnedAgents({
      kind: 'conversation',
      ownerId: 'conversation-1',
    });
    expect(owned).toHaveLength(1);
    expect(owned.filter(agent => !agent.terminal)).toEqual([]);
    runtime.dispose();
  });

  it('classifies an agent that was running when the process went away', async () => {
    // M5's exit gate says agents survive restart with honest classification.
    // The coordinator's tests prove it and the composition did not: nothing
    // reconciled a run left `running`, so a background agent whose process died
    // with the plugin kept claiming to run for the life of the vault.
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new VaultDurableStorage(adapter);
    const repositories = new AgentRepositories(storage, monotonicClock());
    const before = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    });
    await before.prepareAndDispatch(dispatchCommand(), {
      dispatch: async () => ({ kind: 'accepted', nativeAgentRef: 'native-agent-1' }),
    });
    expect(await repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'running' } },
    });

    const runtime = createRuntime(jest.fn(), adapter);
    await runtime.start();

    // Indeterminate rather than interrupted: the agent may have written
    // something before its process went away, and nothing here can say it did
    // not. The same pair the execution registry gives a run whose session did
    // not reopen.
    expect(await repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: {
        payload: {
          state: 'indeterminate',
          terminal: { kind: 'indeterminate', reason: 'effects-unknown' },
        },
      },
    });
    runtime.dispose();
  });

  it('recovers the agent store even when the kernel cannot start', async () => {
    // The two stores fail independently. Putting agent recovery behind the
    // kernel's early return meant the load that deliberately survives a dead
    // kernel — so the user has a settings tab to fix it from — was also the one
    // that would never finish an agent batch again.
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new VaultDurableStorage(adapter);
    const repositories = new AgentRepositories(storage, monotonicClock());
    const before = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    });
    await before.prepareDispatch(dispatchCommand());

    const report = jest.fn();
    const runtime = createRuntime(report, adapter);
    jest.spyOn(runtime.kernel, 'start').mockRejectedValue(new Error('startup recovery failed'));

    await runtime.start();

    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      event: 'execution.start.failed',
    }));
    expect(await repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { terminal: { kind: 'interrupted' } } },
    });
    runtime.dispose();
  });

  it('names a record a sweep could not read instead of reporting a clean recovery', async () => {
    // Both sweeps collect per record so one bad record cannot stall every later
    // one on every restart — and both threw only when *nothing* came back, so a
    // store with one unfinishable record beside one finishable one recovered
    // "successfully" and said nothing, on every load.
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new VaultDurableStorage(adapter);
    const repositories = new AgentRepositories(storage, monotonicClock());
    const before = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    });
    await before.prepareDispatch(dispatchCommand());
    // A half-applied deletion, which is a state the store can really be in: the
    // run and its intent are there and the instance that owns them is not.
    await storage.remove(`${AGENT_INSTANCES_PATH}/${INSTANCE_ID}.json`);

    const report = jest.fn();
    const runtime = createRuntime(report, adapter);
    await runtime.start();

    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      event: 'agents.recovery.recordSkipped',
      data: { phase: 'pending-dispatches' },
    }));
    // And the load carried on: a record nothing could finish is not a store
    // nothing can read.
    expect(report).not.toHaveBeenCalledWith(expect.objectContaining({
      event: 'agents.migrationRequired',
    }));
    runtime.dispose();
  });

  it('stops sweeping a store this build cannot read, rather than rewriting it', async () => {
    // D5, on the agent store. The execution store has answered this way since
    // the kernel landed — an unreadable record opens the store read-only and is
    // reported — and the agent half was unreachable, because its own
    // `requireCurrent` raised a plain error that the composition filed as an
    // ordinary per-record failure. The sweep then carried on terminalizing
    // every record it *could* read, in a store a newer build wrote.
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new VaultDurableStorage(adapter);
    const repositories = new AgentRepositories(storage, monotonicClock());
    const before = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    });
    await before.prepareDispatch(dispatchCommand());
    // Sorted first, so the sweep meets it before the record it would otherwise
    // rewrite — which is the whole assertion.
    await storage.writeAtomic(
      `${AGENT_DISPATCH_INTENTS_PATH}/adt-${'0'.repeat(32)}.json`,
      JSON.stringify({
        schemaVersion: 9_999,
        recordId: `adt-${'0'.repeat(32)}`,
        revision: 1,
        updatedAt: 1,
        payload: {},
      }),
    );

    const report = jest.fn();
    const runtime = createRuntime(report, adapter);
    await runtime.start();

    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      event: 'agents.migrationRequired',
      data: { phase: 'pending-dispatches', recordKind: 'future' },
    }));
    // Untouched: the run this build understands is left exactly as the build
    // that wrote it left it.
    const untouched = await repositories.runs.read(RUN_ID);
    expect(untouched).toMatchObject({
      kind: 'current',
      record: { payload: { state: 'dispatching' } },
    });
    expect((untouched as { record: { payload: { terminal?: unknown } } }).record.payload.terminal)
      .toBeUndefined();
    runtime.dispose();
  });

  it('refuses a live write to a store it has declared read-only', async () => {
    // **The half a per-sweep rethrow could not deliver.** D5 says the store
    // opens read-only, and three stages that each decline to sweep leave the
    // ordinary path untouched: a background agent observed during a turn writes
    // an instance, a run and a result through the recorder, into the store the
    // load just declared unreadable. The latch is on the repositories, so a
    // write consults the same answer a sweep does.
    const adapter = createDurableInMemoryVaultAdapter();
    const storage = new VaultDurableStorage(adapter);
    const repositories = new AgentRepositories(storage, monotonicClock());
    const before = new AgentCoordinator(storage, {
      now: monotonicClock(),
      repositories,
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    });
    await before.prepareDispatch(dispatchCommand());
    await storage.writeAtomic(
      `${AGENT_DISPATCH_INTENTS_PATH}/adt-${'0'.repeat(32)}.json`,
      JSON.stringify({
        schemaVersion: 9_999,
        recordId: `adt-${'0'.repeat(32)}`,
        revision: 1,
        updatedAt: 1,
        payload: {},
      }),
    );

    const runtime = createRuntime(jest.fn(), adapter);
    await runtime.start();

    expect(runtime.agents.migrationRequirement()).not.toBeNull();
    // The write the recorder makes on the ordinary chat path, refused.
    await expect(runtime.agents.adoptNativeAgent({
      transactionId: `tx-${'9'.repeat(32)}`,
      terminalTransactionId: `tx-${'a'.repeat(32)}`,
      adoptionKey: nativeAgentAdoptionKey(`nad-${'b'.repeat(32)}`),
      agentRunId: agentRunId(`agr-${'c'.repeat(32)}`),
      providerId: 'claude',
      definition: {
        definitionId: 'claude-subagent',
        revisionDigest: '0'.repeat(64),
        source: 'provider-native',
      },
      rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
      attachment: 'detached',
      observation: 'terminal-only',
      nativeAgentRef: 'native-1',
      goalRef: 'goal-observed',
      policyInputs: {
        provider: { granted: [], approvable: [] },
        workspace: { granted: [], approvable: [] },
        root: { granted: [], approvable: [] },
        definition: { requested: [], approvable: [] },
      },
    })).rejects.toThrow(/unreadable/i);
    runtime.dispose();
  });

  it('builds no provider workspace that nothing has asked for', async () => {
    // The plan asks M6 to confirm lazy provider initialization, and nothing
    // measured it. A provider the user never opens must cost nothing at load,
    // and `builtWorkspaceFor` is what can say so without building one.
    const runtime = createRuntime();

    await runtime.start();

    const built = providerCatalog().ids()
      .filter(providerId => runtime.builtWorkspaceFor(providerId) !== null);
    // Codex is the one declared exception — `start` initializes its workspace
    // because a synchronous `createRuntime` needs the slots to already exist —
    // and it is excluded by name rather than by an empty expectation, so a
    // second provider becoming eager fails here. Whether Codex's build has
    // finished by the time `start` resolves is deliberately not asserted: it is
    // dispatched without being awaited, and pinning that would test the
    // scheduler rather than the laziness.
    expect(built.filter(providerId => providerId !== 'codex')).toEqual([]);

    // And the other half of the claim: asking builds it. Without this the
    // assertion above would pass just as well for a lookup that never works.
    await runtime.workspaceFor('claude');
    expect(runtime.builtWorkspaceFor('claude')).not.toBeNull();
    runtime.dispose();
  });

  it('keeps the load alive when the kernel cannot start', async () => {
    // Every provider runs through the kernel, so a load that failed with it
    // would leave the user no settings tab to fix it from.
    const report = jest.fn();
    const runtime = createRuntime(report);
    const failure = new Error('startup recovery failed');
    jest.spyOn(runtime.kernel, 'start').mockRejectedValue(failure);

    await expect(runtime.start()).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      error: failure,
      event: 'execution.start.failed',
      level: 'error',
    }));
    runtime.dispose();
  });
});

const INSTANCE_ID = agentInstanceId(`agi-${'1'.repeat(32)}`);
const RUN_ID = agentRunId(`agr-${'2'.repeat(32)}`);

function dispatchCommand() {
  return {
    prepareTransactionId: `tx-${'1'.repeat(32)}`,
    dispatchStartTransactionId: `tx-${'2'.repeat(32)}`,
    settlementTransactionId: `tx-${'3'.repeat(32)}`,
    terminalTransactionId: `tx-${'4'.repeat(32)}`,
    agentInstanceId: INSTANCE_ID,
    agentRunId: RUN_ID,
    dispatchToken: agentDispatchToken(`adt-${'3'.repeat(32)}`),
    providerId: 'claude',
    definition: {
      definitionId: 'claude-subagent',
      revisionDigest: '0'.repeat(64),
      source: 'provider-native' as const,
    },
    executionMode: 'provider-native' as const,
    rootOwner: { kind: 'conversation' as const, ownerId: 'conversation-1' },
    attachment: 'attached' as const,
    observation: 'full' as const,
    goalRef: 'goal-root',
    policyInputs: {
      provider: { granted: [], approvable: [] },
      workspace: { granted: [], approvable: [] },
      root: { granted: [], approvable: [] },
      definition: { requested: [], approvable: [] },
    },
    idempotency: 'provider-key' as const,
  };
}

function monotonicClock(): () => number {
  let value = 1;
  return () => value++;
}
