import '@/providers';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { ApplicationRuntime } from '@/app/ApplicationRuntime';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { AgentControlTransactionCoordinator } from '@/core/agents/AgentControlTransactionCoordinator';
import { AgentCoordinator } from '@/core/agents/AgentCoordinator';
import { agentDispatchToken, agentInstanceId, agentRunId } from '@/core/agents/AgentIds';
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

    expect(await repositories.runs.read(RUN_ID)).toMatchObject({
      kind: 'current',
      record: { payload: { agentInstanceId: INSTANCE_ID, state: 'dispatching' } },
    });
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

  it('keeps the load alive when the kernel cannot start', async () => {
    // Every provider runs through the kernel, so a load that failed with it
    // would leave the user no settings tab to fix it from.
    const runtime = createRuntime();
    const failure = new Error('startup recovery failed');
    jest.spyOn(runtime.kernel, 'start').mockRejectedValue(failure);
    const report = jest.fn();
    (runtime as unknown as { options: { report: jest.Mock } }).options.report = report;

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
