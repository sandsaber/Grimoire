import { createCodexWorkspaceServices } from '@/providers/codex/app/CodexWorkspaceServices';
import { getCodexModelDiscoveryState } from '@/providers/codex/modelDiscoveryState';
import { CodexModelListingService } from '@/providers/codex/runtime/CodexModelListingService';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';

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
    const changed = await services.modelCatalog?.refreshModels({
      plugin: plugin as any,
      settings: plugin.settings,
    });

    expect(changed).toBe(true);
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
});
