import { hashCatalogFingerprint } from '@/core/providers/catalogFingerprint';
import { createCodexWorkspaceServices } from '@/providers/codex/app/CodexWorkspaceServices';
import { resolveCodexModelCatalogFingerprint } from '@/providers/codex/modelCatalogFingerprint';
import { getCodexModelDiscoveryState } from '@/providers/codex/modelDiscoveryState';
import { CodexModelListingService } from '@/providers/codex/runtime/CodexModelListingService';
import { getCodexProviderSettings } from '@/providers/codex/settings';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';

function createStubAdapter() {
  return {
    delete: jest.fn(),
    ensureFolder: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
    listFiles: jest.fn().mockResolvedValue([]),
    read: jest.fn(),
    write: jest.fn(),
  };
}

describe('createCodexWorkspaceServices', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests active-tab runtime warmup so Codex can discover models before the first turn', async () => {
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };
    const homeAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };
    const plugin = {
      app: {
        vault: {
          adapter: { basePath: '/repo' },
        },
      },
    };

    const services = await createCodexWorkspaceServices(plugin as any, vaultAdapter as any, homeAdapter as any);

    expect(services.usageProvider).toBeDefined();
    // The warm-up mode is a declaration on the provider module now, not a
    // service registered here: every implementation returned a constant and
    // read none of the context it was given.
  });

  it('refreshes Codex model discovery through the workspace model catalog', async () => {
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6', label: 'GPT-5.6', description: 'Latest' }]);
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };
    const homeAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };
    const plugin = {
      app: {
        vault: {
          adapter: { basePath: '/repo' },
        },
      },
      settings: {},
    };

    const services = await createCodexWorkspaceServices(plugin as any, vaultAdapter as any, homeAdapter as any);
    const outcome = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings: plugin.settings,
    });

    expect(outcome).toBe('refreshed');
    expect(listModelsSpy).toHaveBeenCalledWith();
    expect(getCodexModelDiscoveryState(plugin.settings).discoveredModels).toEqual([
      { id: 'gpt-5.6', label: 'GPT-5.6', description: 'Latest' },
    ]);
  });

  it('persists account-specific Codex models discovered from the CLI', async () => {
    jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', isDefault: true }]);
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };
    const homeAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };
    const plugin = {
      app: {
        vault: {
          adapter: { basePath: '/repo' },
        },
      },
      settings: {},
    };

    const services = await createCodexWorkspaceServices(plugin as any, vaultAdapter as any, homeAdapter as any);
    await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings: plugin.settings,
    });

    expect((plugin.settings as any).providerConfigs.codex.discoveredModels).toEqual([
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', isDefault: true },
    ]);

    const reloadedSettings = JSON.parse(JSON.stringify(plugin.settings));
    expect(codexChatUIConfig.getModelOptions(reloadedSettings)).toEqual([
      { value: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', description: undefined },
    ]);
  });

  it('updates the picker when the account catalog adds GPT-6 models without a CLI change', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValueOnce([{ id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' }])
      .mockResolvedValueOnce([
        { id: 'gpt-6-astra', label: 'GPT-6-Astra' },
        { id: 'gpt-6-sol', label: 'GPT-6-Sol' },
      ]);
    const settings = { providerConfigs: { codex: { enabled: true } } };
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };
    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );

    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });
    clock.mockReturnValue(1_000 + 9 * 60_000);
    expect(await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings })).toBe('skipped');
    expect(listModelsSpy).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(1_000 + 10 * 60_000);
    expect(await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings })).toBe('refreshed');
    expect(listModelsSpy).toHaveBeenCalledTimes(2);
    expect(codexChatUIConfig.getModelOptions(settings)).toEqual([
      { value: 'gpt-6-astra', label: 'GPT-6-Astra', description: undefined },
      { value: 'gpt-6-sol', label: 'GPT-6-Sol', description: undefined },
    ]);
  });

  it.each(['empty', 'rejected'])('paces %s catalog retries while keeping persisted models', async (failure) => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const oldModels = [{ id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' }];
    const list = jest.spyOn(CodexModelListingService.prototype, 'listModels');
    if (failure === 'empty') {
      list.mockResolvedValue([]);
    } else {
      list.mockRejectedValue(new Error('CLI unavailable'));
    }
    const settings = { providerConfigs: { codex: { enabled: true, discoveredModels: oldModels } } };
    const plugin = { app: { vault: { adapter: { basePath: '/repo' } } }, settings };
    const services = await createCodexWorkspaceServices(
      plugin as any, createStubAdapter() as any, createStubAdapter() as any,
    );
    const refresh = (force = false) => services.modelCatalog.refreshModels({
      plugin: plugin as any, settings, force,
    });

    expect(await refresh()).toBe('failed');
    clock.mockReturnValue(2_000);
    expect(await refresh()).toBe('skipped');
    expect(list).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(1_000 + 10 * 60_000);
    expect(await refresh()).toBe('failed');
    expect(await refresh()).toBe('skipped');
    expect(list).toHaveBeenCalledTimes(2);
    expect(settings.providerConfigs.codex.discoveredModels).toEqual(oldModels);

    list.mockResolvedValue([{ id: 'gpt-6-astra', label: 'GPT-6-Astra' }]);
    expect(await refresh(true)).toBe('refreshed');
    expect(list).toHaveBeenCalledTimes(3);
    expect(codexChatUIConfig.getModelOptions(settings).map(model => model.value)).toEqual(['gpt-6-astra']);
  });

  it('rechecks persisted models on first use after startup when the CLI resolver arrives later', async () => {
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6', label: 'GPT-5.6' }]);
    const settings = {
      providerConfigs: {
        codex: {
          discoveredModels: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
          enabled: true,
        },
      },
    };
    // Production ordering: the catalog is built inside createCodexWorkspaceServices,
    // which runs *inside* ProviderWorkspaceRegistry.initialize(). The registry only
    // assigns this.services[providerId] after initialize() resolves, so the CLI
    // resolver - and with it the resolved path - appears only afterwards.
    let resolvedCliPath: string | null = null;
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      getResolvedProviderCliPath: () => resolvedCliPath,
      settings,
    };

    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );
    resolvedCliPath = '/usr/local/bin/codex';
    const outcome = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings: settings,
    });

    expect(outcome).toBe('refreshed');
    expect(listModelsSpy).toHaveBeenCalledTimes(1);
  });

  it('still relists models when the environment changed before the first refresh', async () => {
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6', label: 'GPT-5.6' }]);
    const settings = {
      providerConfigs: {
        codex: {
          discoveredModels: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
          enabled: true,
        },
      },
    };
    let activeEnvironment = 'OPENAI_API_KEY=old';
    let resolvedCliPath: string | null = null;
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      getActiveEnvironmentVariables: () => activeEnvironment,
      getResolvedProviderCliPath: () => resolvedCliPath,
      settings,
    };

    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );
    resolvedCliPath = '/usr/local/bin/codex';
    activeEnvironment = 'OPENAI_API_KEY=new';
    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings: settings });

    expect(listModelsSpy).toHaveBeenCalledTimes(1);
  });
  it('records the fingerprint of the listing that produced the persisted models', async () => {
    jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6', label: 'GPT-5.6' }]);
    const settings = { providerConfigs: { codex: { enabled: true } } };
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/codex',
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };

    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );
    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });

    expect((settings.providerConfigs.codex as any).discoveredModelsFingerprint).toBe(
      hashCatalogFingerprint(
        resolveCodexModelCatalogFingerprint(plugin as any, getCodexProviderSettings(settings)),
      ),
    );
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('relists when the CLI path changed while the plugin was not running', async () => {
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6', label: 'GPT-5.6' }]);
    const settings = {
      providerConfigs: {
        codex: {
          discoveredModels: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
          discoveredModelsFingerprint: hashCatalogFingerprint(
            resolveCodexModelCatalogFingerprint(
              { getResolvedProviderCliPath: () => '/usr/local/bin/codex' } as any,
              getCodexProviderSettings({ providerConfigs: { codex: { enabled: true } } }),
            ),
          ),
          enabled: true,
        },
      },
    };
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      getResolvedProviderCliPath: () => '/opt/homebrew/bin/codex',
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };

    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );
    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });

    expect(listModelsSpy).toHaveBeenCalledTimes(1);
  });

  it('relists when the CLI path changed and the resolver only arrives after construction', async () => {
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6', label: 'GPT-5.6' }]);
    const settings = {
      providerConfigs: {
        codex: {
          discoveredModels: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
          discoveredModelsFingerprint: hashCatalogFingerprint(
            resolveCodexModelCatalogFingerprint(
              { getResolvedProviderCliPath: () => '/usr/local/bin/codex' } as any,
              getCodexProviderSettings({ providerConfigs: { codex: { enabled: true } } }),
            ),
          ),
          enabled: true,
        },
      },
    };
    let resolvedCliPath: string | null = null;
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      getResolvedProviderCliPath: () => resolvedCliPath,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };

    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );
    resolvedCliPath = '/opt/homebrew/bin/codex';
    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });

    expect(listModelsSpy).toHaveBeenCalledTimes(1);
  });

  it('rechecks a catalog persisted before the fingerprint existed', async () => {
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.6', label: 'GPT-5.6' }]);
    const settings = {
      providerConfigs: {
        codex: {
          discoveredModels: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
          enabled: true,
        },
      },
    };
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/codex',
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };

    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );
    const outcome = await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });

    expect(outcome).toBe('refreshed');
    expect(listModelsSpy).toHaveBeenCalledTimes(1);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('re-records the fingerprint when the CLI changed but the list did not', async () => {
    const listModelsSpy = jest
      .spyOn(CodexModelListingService.prototype, 'listModels')
      .mockResolvedValue([{ id: 'gpt-5.5', label: 'GPT-5.5' }]);
    const settings = {
      providerConfigs: {
        codex: {
          discoveredModels: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
          discoveredModelsFingerprint: 'deadbeef',
          enabled: true,
        },
      },
    };
    const plugin = {
      app: { vault: { adapter: { basePath: '/repo' } } },
      getResolvedProviderCliPath: () => '/opt/homebrew/bin/codex',
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };

    const services = await createCodexWorkspaceServices(
      plugin as any,
      createStubAdapter() as any,
      createStubAdapter() as any,
    );
    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });

    expect(listModelsSpy).toHaveBeenCalledTimes(1);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect((settings.providerConfigs.codex as any).discoveredModelsFingerprint).toBe(
      hashCatalogFingerprint(
        resolveCodexModelCatalogFingerprint(plugin as any, getCodexProviderSettings(settings)),
      ),
    );

    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });
    expect(listModelsSpy).toHaveBeenCalledTimes(1);
  });
});
