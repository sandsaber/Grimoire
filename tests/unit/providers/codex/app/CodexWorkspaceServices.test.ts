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

  it('suppresses the reload listing when the CLI resolver is not reachable yet at construction', async () => {
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

    expect(outcome).toBe('skipped');
    expect(listModelsSpy).not.toHaveBeenCalled();
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

  it('keeps trusting a catalog persisted before the fingerprint existed', async () => {
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

    expect(outcome).toBe('skipped');
    expect(listModelsSpy).not.toHaveBeenCalled();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
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
