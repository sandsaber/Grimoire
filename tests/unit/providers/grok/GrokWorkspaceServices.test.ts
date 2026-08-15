import { createGrokWorkspaceServices } from '@/providers/grok/app/GrokWorkspaceServices';
import { GrokChatRuntime } from '@/providers/grok/runtime/GrokChatRuntime';
import { discoverGrokModelsFromCli } from '@/providers/grok/runtime/GrokModelDiscovery';
import { readGrokNativeModelCatalog } from '@/providers/grok/runtime/GrokModelsCache';
import { getGrokProviderSettings, updateGrokProviderSettings } from '@/providers/grok/settings';

jest.mock('@/providers/grok/runtime/GrokModelDiscovery', () => ({
  discoverGrokModelsFromCli: jest.fn(),
}));
jest.mock('@/providers/grok/runtime/GrokModelsCache', () => {
  const actual = jest.requireActual('@/providers/grok/runtime/GrokModelsCache');
  return {
    ...actual,
    readGrokNativeModelCatalog: jest.fn(() => ({ defaultModelId: null, models: [] })),
  };
});

const discoverGrokModelsFromCliMock = discoverGrokModelsFromCli as jest.MockedFunction<
  typeof discoverGrokModelsFromCli
>;
const readGrokNativeModelCatalogMock = readGrokNativeModelCatalog as jest.MockedFunction<
  typeof readGrokNativeModelCatalog
>;

function createVaultAdapter() {
  return {
    delete: jest.fn(),
    ensureFolder: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
    listFiles: jest.fn().mockResolvedValue([]),
    read: jest.fn(),
    write: jest.fn(),
  };
}

describe('createGrokWorkspaceServices', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    discoverGrokModelsFromCliMock.mockReset();
    readGrokNativeModelCatalogMock.mockReset();
    readGrokNativeModelCatalogMock.mockReturnValue({ defaultModelId: null, models: [] });
  });

  it('refreshes the Grok model catalog from the live CLI list', async () => {
    const settings: Record<string, unknown> = {};
    updateGrokProviderSettings(settings, { enabled: true });
    const refreshModelSelector = jest.fn();
    const plugin = {
      getAllViews: jest.fn().mockReturnValue([{ refreshModelSelector }]),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/grok'),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };
    discoverGrokModelsFromCliMock.mockResolvedValue({
      defaultModelId: 'grok-4.6',
      models: [
        { label: 'Grok 4.6', rawId: 'grok-4.6' },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
    const ensureReadySpy = jest.spyOn(GrokChatRuntime.prototype, 'ensureReady');

    const services = await createGrokWorkspaceServices(plugin as any, createVaultAdapter() as any);
    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(true);
    expect(discoverGrokModelsFromCliMock).toHaveBeenCalled();
    expect(ensureReadySpy).not.toHaveBeenCalled();
    expect(getGrokProviderSettings(settings).discoveredModels).toEqual([
      { label: 'Grok 4.6', rawId: 'grok-4.6' },
      { label: 'Grok 4.5', rawId: 'grok-4.5' },
    ]);
    expect(plugin.settings.savedProviderModel).toEqual({ grok: 'grok:grok-4.6' });
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(refreshModelSelector).toHaveBeenCalled();
  });

  it('runs another live CLI refresh on the next picker open instead of skipping a recent catalog', async () => {
    const settings: Record<string, unknown> = {};
    updateGrokProviderSettings(settings, { enabled: true });
    const plugin = {
      getAllViews: jest.fn().mockReturnValue([]),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/grok'),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };
    discoverGrokModelsFromCliMock.mockResolvedValue({
      defaultModelId: 'grok-4.6',
      models: [{ label: 'Grok 4.6', rawId: 'grok-4.6' }],
    });

    const services = await createGrokWorkspaceServices(plugin as any, createVaultAdapter() as any);
    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });
    await services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });

    expect(discoverGrokModelsFromCliMock).toHaveBeenCalledTimes(2);
  });

  it('joins an in-flight live catalog refresh instead of spawning a second CLI', async () => {
    const settings: Record<string, unknown> = {};
    updateGrokProviderSettings(settings, { enabled: true });
    const plugin = {
      getAllViews: jest.fn().mockReturnValue([]),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/grok'),
      recordDebugLog: jest.fn(),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };
    let resolveCatalog!: (catalog: { defaultModelId: string; models: Array<{ label: string; rawId: string }> }) => void;
    discoverGrokModelsFromCliMock.mockReturnValue(new Promise((resolve) => {
      resolveCatalog = resolve;
    }));

    const services = await createGrokWorkspaceServices(plugin as any, createVaultAdapter() as any);
    const first = services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });
    const second = services.modelCatalog?.refreshModels({ plugin: plugin as any, settings });
    resolveCatalog({
      defaultModelId: 'grok-4.6',
      models: [{ label: 'Grok 4.6', rawId: 'grok-4.6' }],
    });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(discoverGrokModelsFromCliMock).toHaveBeenCalledTimes(1);
    expect(plugin.recordDebugLog).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerId: 'grok',
        reason: 'in_flight',
      }),
      event: 'modelCatalog.refresh.joined',
    }));
  });

  it('falls back to an ACP session when the live CLI list is empty', async () => {
    const settings: Record<string, unknown> = {};
    updateGrokProviderSettings(settings, { enabled: true });
    const plugin = {
      getAllViews: jest.fn().mockReturnValue([]),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/grok'),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      settings,
    };
    discoverGrokModelsFromCliMock.mockResolvedValue({ defaultModelId: null, models: [] });
    jest.spyOn(GrokChatRuntime.prototype, 'ensureReady')
      .mockImplementation(async function ensureReady(this: GrokChatRuntime) {
        updateGrokProviderSettings((this as any).plugin.settings, {
          discoveredModels: [{ label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' }],
          visibleModels: ['openai/gpt-5.6'],
        });
        return true;
      });
    jest.spyOn(GrokChatRuntime.prototype, 'cleanup').mockImplementation(() => undefined);

    const services = await createGrokWorkspaceServices(plugin as any, createVaultAdapter() as any);
    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(true);
    expect(getGrokProviderSettings(settings).discoveredModels).toEqual([
      { label: 'OpenAI/GPT-5.6', rawId: 'openai/gpt-5.6' },
    ]);
  });
});
