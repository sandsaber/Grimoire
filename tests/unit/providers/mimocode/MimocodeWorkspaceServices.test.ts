import { createMimocodeWorkspaceServices } from '@/providers/mimocode/app/MimocodeWorkspaceServices';
import { getMimocodeProviderSettings, updateMimocodeProviderSettings } from '@/providers/mimocode/settings';

describe('createMimocodeWorkspaceServices', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes MiMoCode model discovery through an isolated workspace model catalog', async () => {
    const settings: Record<string, unknown> = {};
    updateMimocodeProviderSettings(settings, { enabled: true });
    const plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    // The catalog asks the isolated metadata session, which is what opening a
    // session and reading its reply has become.
    const discoverMetadata = jest.fn().mockImplementation(async () => {
      updateMimocodeProviderSettings(settings, {
        discoveredModels: [{ label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' }],
        visibleModels: ['openai/gpt-5.6'],
      });
      return true;
    });
    (plugin as any).getMimocodeExecution = () => ({ metadata: { discoverMetadata } });
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };

    const services = await createMimocodeWorkspaceServices(plugin as any, vaultAdapter as any);
    expect(services.usageProvider).toBeDefined();
    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(true);
    expect(discoverMetadata).toHaveBeenCalledTimes(1);
    expect(getMimocodeProviderSettings(settings).discoveredModels).toEqual([
      { label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' },
    ]);
  });

  it('uses cached MiMoCode discovered models without warming the runtime again', async () => {
    const settings: Record<string, unknown> = {};
    updateMimocodeProviderSettings(settings, {
      discoveredModels: [{ label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' }],
      enabled: true,
      visibleModels: ['openai/gpt-5.6'],
    });
    const plugin = {
      recordDebugLog: jest.fn(),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    const discoverMetadata = jest.fn();
    (plugin as any).getMimocodeExecution = () => ({ metadata: { discoverMetadata } });
    const vaultAdapter = {
      delete: jest.fn(),
      ensureFolder: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      listFiles: jest.fn().mockResolvedValue([]),
      read: jest.fn(),
      write: jest.fn(),
    };

    const services = await createMimocodeWorkspaceServices(plugin as any, vaultAdapter as any);
    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(false);
    // No process at all for a catalog that is still fresh.
    expect(discoverMetadata).not.toHaveBeenCalled();
    expect(plugin.recordDebugLog).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        modelCount: 1,
        providerId: 'mimocode',
        reason: 'cache_fresh',
      }),
      event: 'modelCatalog.refresh.skipped',
      level: 'debug',
      scope: 'provider.mimocode',
    }));
  });
});
