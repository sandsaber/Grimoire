import '@/providers';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { ApplicationRuntime } from '@/app/ApplicationRuntime';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
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

  function createRuntime(report: jest.Mock = jest.fn()) {
    const adapter = createDurableInMemoryVaultAdapter();
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
