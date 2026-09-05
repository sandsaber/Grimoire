import { createMockEl } from '@test/helpers/mockElement';
import { ButtonComponent, Notice } from 'obsidian';

import { getGeminiProviderSettings } from '@/providers/gemini/settings';
import { geminiSettingsTabRenderer } from '@/providers/gemini/ui/GeminiSettingsTab';

const mockRefreshModels = jest.fn().mockResolvedValue(true);

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  statSync: jest.fn().mockReturnValue({ isFile: () => true }),
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    (params ? `${key}:${JSON.stringify(params)}` : key),
}));

jest.mock('@/providers/gemini/app/GeminiWorkspaceServices', () => ({
  maybeGetGeminiWorkspaceServices: jest.fn(() => ({
    commandCatalog: null,
    modelCatalog: {
      isAvailable: () => true,
      refreshModels: (...args: unknown[]) => mockRefreshModels(...args),
    },
  })),
}));

jest.mock('@/features/settings/ui/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: jest.fn(),
}));
jest.mock('@/features/settings/ui/ProviderDisabledNotice', () => ({
  renderProviderDisabledNotice: jest.fn(),
}));
jest.mock('@/features/settings/ui/ProviderSkillSettings', () => ({
  ProviderSkillSettings: jest.fn(),
}));
jest.mock('@/features/settings/ui/McpSettingsManager', () => ({
  McpSettingsManager: jest.fn(),
}));
jest.mock('@/providers/gemini/ui/GeminiAgentSettings', () => ({
  GeminiAgentSettings: jest.fn(),
}));
jest.mock('@/providers/gemini/ui/GeminiCommandSettings', () => ({
  GeminiCommandSettings: jest.fn(),
}));

const mockNotice = Notice as unknown as jest.Mock;

function createContext(discoveredModels: unknown[]) {
  const plugin = {
    app: { vault: { adapter: { basePath: '/vault' } } },
    getAllViews: jest.fn(() => []),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    settings: {
      providerConfigs: {
        gemini: { enabled: true, discoveredModels },
      },
    },
  } as any;

  return {
    plugin,
    context: {
      plugin,
      createWorkspaceSection: jest.fn((container: any) => container),
      renderAdvancedSection: jest.fn((container: any) => container),
      renderCustomContextLimits: jest.fn(),
      renderHiddenProviderCommandSetting: jest.fn(),
      refreshModelSelectors: jest.fn(),
      suppressAutomaticDiscovery: false,
    } as any,
  };
}

/** Renders the tab and hands back the one button it builds, with its click handler. */
function renderTab(discoveredModels: unknown[]) {
  const handlers: Array<(evt: MouseEvent) => unknown> = [];
  const onClick = jest.spyOn(ButtonComponent.prototype, 'onClick')
    .mockImplementation(function mockOnClick(this: ButtonComponent, handler) {
      handlers.push(handler);
      return this;
    });
  const setDisabled = jest.spyOn(ButtonComponent.prototype, 'setDisabled');
  const setButtonText = jest.spyOn(ButtonComponent.prototype, 'setButtonText');

  const { plugin, context } = createContext(discoveredModels);
  geminiSettingsTabRenderer.render(createMockEl(), context);
  onClick.mockRestore();

  return { context, handlers, plugin, setButtonText, setDisabled };
}

describe('GeminiSettingsTab model refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshModels.mockResolvedValue(true);
  });

  it('lets the user ask the CLI for its current model list', async () => {
    const { context, handlers, plugin, setButtonText, setDisabled } = renderTab([
      { rawId: 'model-a', label: 'Model A' },
      { rawId: 'model-b', label: 'Model B' },
    ]);

    expect(setButtonText).toHaveBeenCalledWith('settings.refreshModels.button');

    await handlers[0]?.({} as MouseEvent);

    // Background picker refreshes never force; this button is the one explicit path.
    expect(mockRefreshModels).toHaveBeenCalledWith({
      force: true,
      plugin,
      settings: plugin.settings,
    });
    expect(getGeminiProviderSettings(plugin.settings).discoveredModels).toHaveLength(2);
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
    expect(mockNotice).toHaveBeenCalledWith('settings.refreshModels.done:{"count":2}');
    expect(setDisabled).toHaveBeenLastCalledWith(false);
  });

  it('warns and re-enables the button when a refresh finds nothing', async () => {
    const { context, handlers, setDisabled } = renderTab([]);

    await handlers[0]?.({} as MouseEvent);

    expect(mockNotice).toHaveBeenCalledWith('settings.provider.loadModelsFailed');
    expect(context.refreshModelSelectors).not.toHaveBeenCalled();
    expect(setDisabled).toHaveBeenLastCalledWith(false);
  });

  it('warns and re-enables the button when the refresh throws', async () => {
    mockRefreshModels.mockRejectedValueOnce(new Error('CLI missing'));
    const { context, handlers, setDisabled } = renderTab([{ rawId: 'model-a', label: 'Model A' }]);

    await handlers[0]?.({} as MouseEvent);

    expect(mockNotice).toHaveBeenCalledWith('settings.provider.loadModelsFailed');
    expect(context.refreshModelSelectors).not.toHaveBeenCalled();
    expect(setDisabled).toHaveBeenLastCalledWith(false);
  });
});
