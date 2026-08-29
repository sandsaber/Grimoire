import { createKimicodeWorkspaceServices } from '@/providers/kimicode/app/KimicodeWorkspaceServices';
import { getKimicodeProviderSettings, updateKimicodeProviderSettings } from '@/providers/kimicode/settings';

describe('createKimicodeWorkspaceServices', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes Kimi Code model discovery through an isolated workspace model catalog', async () => {
    const settings: Record<string, unknown> = {};
    updateKimicodeProviderSettings(settings, { enabled: true });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    // The catalog asks the isolated metadata session, which is what opening a
    // session and reading its reply has become.
    const discoverMetadata = jest.fn().mockImplementation(async () => {
      updateKimicodeProviderSettings(settings, {
        discoveredModels: [{ label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' }],
        visibleModels: ['openai/gpt-5.6'],
      });
      return true;
    });
    (plugin as any).getKimicodeExecution = () => ({ metadata: { discoverMetadata } });
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };

    const services = await createKimicodeWorkspaceServices(plugin as any, vaultAdapter as any);
    expect(services.usageProvider).toBeDefined();
    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(true);
    expect(discoverMetadata).toHaveBeenCalledTimes(1);
    expect(getKimicodeProviderSettings(settings).discoveredModels).toEqual([
      { label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' },
    ]);
  });

  it('boots the runtime once and then reuses the discovered models for the rest of the process', async () => {
    // Seeding the cache from persisted settings is what this stopped doing: a
    // list carried over from a legacy field was pinned for the whole process.
    // The first refresh discovers, and every later one reuses what it found.
    const settings: Record<string, unknown> = {};
    updateKimicodeProviderSettings(settings, { enabled: true });
    const plugin = {
      recordDebugLog: jest.fn(),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    const discoverMetadata = jest.fn(async () => {
      updateKimicodeProviderSettings(settings, {
        discoveredModels: [{ label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' }],
        visibleModels: ['openai/gpt-5.6'],
      });
      return true;
    });
    (plugin as any).getKimicodeExecution = () => ({ metadata: { discoverMetadata } });
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };

    const services = await createKimicodeWorkspaceServices(plugin as any, vaultAdapter as any);
    const discovered = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });
    const reused = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(discovered).toBe(true);
    expect(reused).toBe(false);
    expect(discoverMetadata).toHaveBeenCalledTimes(1);
    expect(plugin.recordDebugLog).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        modelCount: 1,
        providerId: 'kimicode',
        reason: 'cache_fresh',
      }),
      event: 'modelCatalog.refresh.skipped',
      level: 'debug',
      scope: 'provider.kimicode',
    }));
  });

  it('rediscovers a list carried over from a legacy persisted field instead of pinning it', async () => {
    // The catalog is deliberately not seeded from persisted settings: a list
    // present at construction came from a legacy field or an earlier runtime in
    // this process, discovered under no key this cache watched — and seeding it
    // would pin it for the rest of the process.
    const settings: Record<string, unknown> = {
      providerConfigs: {
        kimicode: {
          discoveredModels: [{ label: 'OpenAI/GPT-5.5', rawId: 'openai/gpt-5.5' }],
          enabled: true,
          visibleModels: ['openai/gpt-5.5'],
        },
      },
    };
    const plugin = {
      recordDebugLog: jest.fn(),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    // Answers `true` and writes what it discovered, which is what the real
    // metadata session does — a stub that answered `undefined` would make the
    // refresh report "nothing changed" for a discovery that changed everything.
    const discoverMetadata = jest.fn(async () => {
      updateKimicodeProviderSettings(settings, {
        discoveredModels: [{ label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' }],
        visibleModels: ['openai/gpt-5.6'],
      });
      return true;
    });
    (plugin as any).getKimicodeExecution = () => ({ metadata: { discoverMetadata } });
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };

    const services = await createKimicodeWorkspaceServices(plugin as any, vaultAdapter as any);
    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(true);
    expect(discoverMetadata).toHaveBeenCalledTimes(1);
    expect(getKimicodeProviderSettings(settings).discoveredModels).toEqual([
      { label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' },
    ]);
  });

});
