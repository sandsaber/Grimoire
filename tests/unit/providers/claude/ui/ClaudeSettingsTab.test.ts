import * as fs from 'fs';

import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from '@/providers/claude/settings';
import { claudeSettingsTabRenderer } from '@/providers/claude/ui/ClaudeSettingsTab';

const mockRenderEnvironmentSettingsSection = jest.fn();
const mockSaveSettings = jest.fn().mockResolvedValue(undefined);

jest.mock('fs');
jest.mock('@/core/providers/ProviderSettingsCoordinator', () => ({
  ProviderSettingsCoordinator: {
    reconcileTitleGenerationModelSelection: jest.fn((settings: Record<string, unknown>) => {
      const titleGenerationModel = settings.titleGenerationModel;
      const customModels = (
        settings.providerConfigs as { claude?: { customModels?: string } } | undefined
      )?.claude?.customModels ?? '';
      if (titleGenerationModel === 'claude-opus-4-6' && customModels !== 'claude-opus-4-6') {
        settings.titleGenerationModel = '';
        return true;
      }
      return false;
    }),
  },
}));

jest.mock('obsidian', () => {
  class MockSetting {
    public name = '';
    public desc = '';
    public heading = false;
    public textComponents: MockTextComponent[] = [];
    public textAreaComponents: MockTextAreaComponent[] = [];
    public dropdownComponents: MockDropdownComponent[] = [];
    public toggleComponents: MockToggleComponent[] = [];
    public buttonComponents: MockButtonComponent[] = [];

    constructor(_container: unknown) {
      createdSettings.push(this);
    }

    setName(name: string) {
      this.name = name;
      return this;
    }

    setDesc(desc: string) {
      this.desc = desc;
      return this;
    }

    setHeading() {
      this.heading = true;
      return this;
    }

    addText(callback: (text: MockTextComponent) => void) {
      const component = createTextComponent();
      this.textComponents.push(component);
      callback(component);
      return this;
    }

    addTextArea(callback: (text: MockTextAreaComponent) => void) {
      const component = createTextAreaComponent();
      this.textAreaComponents.push(component);
      callback(component);
      return this;
    }

    addDropdown(callback: (dropdown: MockDropdownComponent) => void) {
      const component = createDropdownComponent();
      this.dropdownComponents.push(component);
      callback(component);
      return this;
    }

    addButton(callback: (button: MockButtonComponent) => void) {
      const component = createButtonComponent();
      this.buttonComponents.push(component);
      callback(component);
      return this;
    }

    addToggle(callback: (toggle: MockToggleComponent) => void) {
      const component = createToggleComponent();
      this.toggleComponents.push(component);
      callback(component);
      return this;
    }
  }

  return {
    Notice: jest.fn(),
    Setting: MockSetting,
  };
});

jest.mock('@/features/settings/ui/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: (...args: unknown[]) => mockRenderEnvironmentSettingsSection(...args),
}));

jest.mock('@/features/settings/ui/McpSettingsManager', () => ({
  McpSettingsManager: jest.fn(),
}));

const mockRefreshModels = jest.fn().mockResolvedValue('refreshed');
const mockRefreshCommands = jest.fn().mockResolvedValue('refreshed');

jest.mock('@/providers/claude/app/ClaudeWorkspaceServices', () => ({
  getClaudeWorkspaceServices: jest.fn(() => ({
    cliResolver: {
      reset: jest.fn(),
    },
    commandCatalog: {
      refresh: (...args: unknown[]) => mockRefreshCommands(...args),
    },
    modelCatalog: {
      refreshModels: (...args: unknown[]) => mockRefreshModels(...args),
    },
    agentManager: {},
    agentStorage: {},
    mcpStorage: {},
    pluginManager: {},
  })),
}));

jest.mock('@/providers/claude/ui/AgentSettings', () => ({
  AgentSettings: jest.fn(),
}));

jest.mock('@/providers/claude/ui/SlashCommandSettings', () => ({
  SlashCommandSettings: jest.fn(),
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

jest.mock('@/utils/env', () => {
  const actual = jest.requireActual('@/utils/env');
  return {
    ...actual,
    getHostnameKey: () => 'host-a',
  };
});

interface MockInputEl {
  rows: number;
  cols: number;
  value: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  addClass: jest.Mock;
  toggleClass: jest.Mock;
  addEventListener: jest.Mock;
}

interface MockTextComponent {
  value: string;
  placeholder: string;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  setPlaceholder: jest.MockedFunction<(value: string) => MockTextComponent>;
  setValue: jest.MockedFunction<(value: string) => MockTextComponent>;
  onChange: jest.MockedFunction<(callback: (value: string) => Promise<void> | void) => MockTextComponent>;
  inputEl: MockInputEl;
}

interface MockTextAreaComponent extends MockTextComponent {
  trigger: (event: string) => Promise<void>;
}

interface MockDropdownComponent {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  addOption: jest.MockedFunction<(value: string, label: string) => MockDropdownComponent>;
  setValue: jest.MockedFunction<(value: string) => MockDropdownComponent>;
  onChange: jest.MockedFunction<(callback: (value: string) => Promise<void> | void) => MockDropdownComponent>;
}

interface MockButtonComponent {
  disabled: boolean;
  text: string;
  onClickCallback: (() => Promise<void> | void) | null;
  setButtonText: jest.MockedFunction<(value: string) => MockButtonComponent>;
  setDisabled: jest.MockedFunction<(value: boolean) => MockButtonComponent>;
  onClick: jest.MockedFunction<(callback: () => Promise<void> | void) => MockButtonComponent>;
}

interface MockToggleComponent {
  value: boolean;
  onChangeCallback: ((value: boolean) => Promise<void> | void) | null;
  setValue: jest.MockedFunction<(value: boolean) => MockToggleComponent>;
  onChange: jest.MockedFunction<(callback: (value: boolean) => Promise<void> | void) => MockToggleComponent>;
}

const createdSettings: Array<{
  name: string;
  desc: string;
  heading: boolean;
  textComponents: MockTextComponent[];
  textAreaComponents: MockTextAreaComponent[];
  dropdownComponents: MockDropdownComponent[];
  toggleComponents: MockToggleComponent[];
  buttonComponents: MockButtonComponent[];
}> = [];

function createInputEl(): MockInputEl & { _listeners: Map<string, Array<() => void>> } {
  const listeners = new Map<string, Array<() => void>>();
  return {
    rows: 0,
    cols: 0,
    value: '',
    style: {},
    dataset: {},
    addClass: jest.fn(),
    toggleClass: jest.fn(),
    addEventListener: jest.fn((event: string, handler: () => void) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(handler);
      listeners.set(event, handlers);
    }),
    _listeners: listeners,
  };
}

function createTextComponent(): MockTextComponent {
  const component = {} as MockTextComponent;
  component.value = '';
  component.placeholder = '';
  component.onChangeCallback = null;
  component.inputEl = createInputEl();
  component.setPlaceholder = jest.fn((value: string) => {
    component.placeholder = value;
    return component;
  });
  component.setValue = jest.fn((value: string) => {
    component.value = value;
    component.inputEl.value = value;
    return component;
  });
  component.onChange = jest.fn((callback: (value: string) => Promise<void> | void) => {
    component.onChangeCallback = callback;
    return component;
  });

  return component;
}

function createTextAreaComponent(): MockTextAreaComponent {
  const component = createTextComponent() as MockTextAreaComponent;
  component.trigger = async (event: string) => {
    const handlers = (component.inputEl as ReturnType<typeof createInputEl>)._listeners.get(event) ?? [];
    for (const handler of handlers) {
      handler();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return component;
}

function createDropdownComponent(): MockDropdownComponent {
  const component = {} as MockDropdownComponent;
  component.value = '';
  component.options = [];
  component.onChangeCallback = null;
  component.addOption = jest.fn((value: string, label: string) => {
    component.options.push({ value, label });
    return component;
  });
  component.setValue = jest.fn((value: string) => {
    component.value = value;
    return component;
  });
  component.onChange = jest.fn((callback: (value: string) => Promise<void> | void) => {
    component.onChangeCallback = callback;
    return component;
  });

  return component;
}

function createButtonComponent(): MockButtonComponent {
  const component = {} as MockButtonComponent;
  component.disabled = false;
  component.text = '';
  component.onClickCallback = null;
  component.setButtonText = jest.fn((value: string) => {
    component.text = value;
    return component;
  });
  component.setDisabled = jest.fn((value: boolean) => {
    component.disabled = value;
    return component;
  });
  component.onClick = jest.fn((callback: () => Promise<void> | void) => {
    component.onClickCallback = callback;
    return component;
  });

  return component;
}

function createToggleComponent(): MockToggleComponent {
  const component = {} as MockToggleComponent;
  component.value = false;
  component.onChangeCallback = null;
  component.setValue = jest.fn((value: boolean) => {
    component.value = value;
    return component;
  });
  component.onChange = jest.fn((callback: (value: boolean) => Promise<void> | void) => {
    component.onChangeCallback = callback;
    return component;
  });

  return component;
}

function createElement(): any {
  const classes = new Set<string>();
  const element: any = {
    value: '',
    style: {},
    dataset: {},
    appendText: jest.fn(),
    createEl: jest.fn(() => createElement()),
    createDiv: jest.fn(() => createElement()),
    createSpan: jest.fn(() => createElement()),
    setText: jest.fn(),
    empty: jest.fn(),
    addClass: jest.fn((cls: string) => {
      cls.split(/\s+/).filter(Boolean).forEach((item) => classes.add(item));
    }),
    removeClass: jest.fn((cls: string) => {
      cls.split(/\s+/).filter(Boolean).forEach((item) => classes.delete(item));
    }),
    toggleClass: jest.fn((cls: string, force: boolean) => {
      if (force) {
        classes.add(cls);
      } else {
        classes.delete(cls);
      }
    }),
    hasClass: jest.fn((cls: string) => classes.has(cls)),
    classList: {
      add: jest.fn((cls: string) => classes.add(cls)),
      remove: jest.fn((cls: string) => classes.delete(cls)),
      toggle: jest.fn((cls: string, force?: boolean) => {
        if (force === undefined) {
          if (classes.has(cls)) {
            classes.delete(cls);
            return false;
          }
          classes.add(cls);
          return true;
        }
        if (force) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
        return force;
      }),
      contains: jest.fn((cls: string) => classes.has(cls)),
    },
  };

  return element;
}

function createContainer(): any {
  return {
    createDiv: jest.fn(() => createElement()),
    createEl: jest.fn(() => createElement()),
  };
}

function createPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {
      settingsProvider: 'claude',
      model: 'claude-opus-4-6',
      titleGenerationModel: '',
      providerConfigs: {
        claude: {
          ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
          customModels: 'claude-opus-4-6',
          lastModel: 'sonnet',
        },
      },
      ...overrides,
    },
    saveSettings: mockSaveSettings,
    normalizeModelVariantSettings: jest.fn(() => false),
    getView: jest.fn(() => ({
      getTabManager: jest.fn(() => ({
        broadcastToAllTabs: jest.fn().mockResolvedValue(undefined),
      })),
    })),
    app: {
      vault: {
        adapter: {
          basePath: '/test/vault',
        },
      },
    },
  };
}

function createContext(plugin: any) {
  return {
    plugin,
    suppressAutomaticDiscovery: false,
    createWorkspaceSection: jest.fn((container: any) => container),
    refreshModelSelectors: jest.fn(),
    renderHiddenProviderCommandSetting: jest.fn(),
    renderCustomContextLimits: jest.fn(),
    renderAdvancedSection: jest.fn((container: any) => container),
  };
}

function findSetting(name: string) {
  const setting = createdSettings.find(candidate => candidate.name === name);
  if (!setting) {
    throw new Error(`Setting not found: ${name}`);
  }
  return setting;
}

function findOptionalSetting(name: string) {
  return createdSettings.find(candidate => candidate.name === name);
}

describe('ClaudeSettingsTab', () => {
  const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

  beforeEach(() => {
    createdSettings.length = 0;
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);
  });

  it('uses the current npm package wrapper path as the CLI placeholder', () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    const cliPathSetting = findSetting('settings.cliPath.name');
    const cliPathInput = cliPathSetting.textComponents[0];

    expect(cliPathInput.placeholder).toContain('cli-wrapper.cjs');
    expect(cliPathInput.placeholder).not.toContain('cli.js');
  });

  it('does not switch the active model while the custom models textarea is mid-edit', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    const customModelsSetting = findSetting('settings.customModels.name');
    const customModelsTextArea = customModelsSetting.textAreaComponents[0];

    await customModelsTextArea.onChangeCallback?.('claude-opus-4-7');

    expect(plugin.settings.providerConfigs.claude.customModels).toBe('claude-opus-4-6');
    expect(plugin.settings.model).toBe('claude-opus-4-6');
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(context.refreshModelSelectors).not.toHaveBeenCalled();
  });

  it('does not render a provider-level safe mode setting', () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    expect(findOptionalSetting('settings.claudeSafeMode.name')).toBeUndefined();
  });

  it('does not render Claude Code settings-source or plugin controls', () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    expect(findOptionalSetting('settings.loadUserSettings.name')).toBeUndefined();
    expect(findOptionalSetting('settings.plugins.name')).toBeUndefined();
  });

  it('renders a toggle for respecting Claude Code settings', async () => {
    const plugin = createPlugin({
      providerConfigs: {
        claude: {
          ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
          respectProjectSettings: false,
          projectSettingsSnapshot: {
            model: 'settings-json-model',
            env: {},
          },
        },
      },
    });
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    const projectSettingsToggle = findSetting('settings.respectProjectSettings.name')
      .toggleComponents[0];

    expect(projectSettingsToggle.value).toBe(false);

    await projectSettingsToggle.onChangeCallback?.(true);

    expect(plugin.settings.providerConfigs.claude.respectProjectSettings).toBe(true);
    expect(plugin.settings.model).toBe('settings-json-model');
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
  });

  it('reconciles removed custom models on blur and clears stale title model selections', async () => {
    const plugin = createPlugin({
      titleGenerationModel: 'claude-opus-4-6',
    });
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    const customModelsSetting = findSetting('settings.customModels.name');
    const customModelsTextArea = customModelsSetting.textAreaComponents[0];

    await customModelsTextArea.onChangeCallback?.('claude-opus-4-7');
    await customModelsTextArea.trigger('blur');

    expect(plugin.settings.providerConfigs.claude.customModels).toBe('claude-opus-4-7');
    expect(plugin.settings.model).toBe('sonnet');
    expect(plugin.settings.titleGenerationModel).toBe('');
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
  });

  it('forces SDK model discovery from the refresh button and reports the result', async () => {
    const { Notice } = await import('obsidian');
    const plugin = createPlugin({
      providerConfigs: {
        claude: {
          ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
          discoveredModels: [
            { id: 'opus', displayName: 'Opus', source: 'sdk' },
            { id: 'sonnet', displayName: 'Sonnet', source: 'sdk' },
          ],
        },
      },
    });
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    const refreshSetting = findSetting('settings.refreshModels.name');
    const button = refreshSetting.buttonComponents[0];
    expect(button.text).toBe('settings.refreshModels.button');

    await button.onClickCallback?.();

    // Background picker refreshes never force; this button is the one explicit path.
    expect(mockRefreshModels).toHaveBeenCalledWith({
      force: true,
      plugin,
      settings: plugin.settings,
    });
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith('settings.refreshModels.done:{"count":2}');
    expect(button.setDisabled).toHaveBeenLastCalledWith(false);
  });

  it('lets the user ask the SDK for its current command list', async () => {
    const { Notice } = await import('obsidian');
    const plugin = createPlugin({
      providerConfigs: {
        claude: {
          discoveredCommands: [
            { id: 'sdk:commit', name: 'commit', content: '', source: 'sdk' },
            { id: 'sdk:review', name: 'review', content: '', source: 'sdk' },
          ],
        },
      },
    });
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    // The dropdown reuses a persisted list and never re-probes on its own, so
    // without this button nothing can ask for a fresh one.
    const button = findSetting('settings.refreshCommands.name').buttonComponents[0];
    expect(button.text).toBe('settings.refreshCommands.button');

    await button.onClickCallback?.();

    expect(mockRefreshCommands).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith('settings.refreshCommands.done:{"count":2}');
    expect(button.setDisabled).toHaveBeenLastCalledWith(false);
  });

  it('does not report a model count the refresh did not produce', async () => {
    // The persisted list still holds the previous models when a refresh fails,
    // so counting it said "Model list refreshed: 2 models" for a refresh against
    // a logged-out CLI. The catalog's own answer is the only honest signal, and
    // it did not throw here — it came back and said it found nothing.
    const { Notice } = await import('obsidian');
    mockRefreshModels.mockResolvedValueOnce('failed');
    const plugin = createPlugin({
      providerConfigs: {
        claude: {
          discoveredModels: [
            { id: 'opus', displayName: 'Opus', source: 'sdk' },
            { id: 'sonnet', displayName: 'Sonnet', source: 'sdk' },
          ],
        },
      },
    });
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);
    await findSetting('settings.refreshModels.name').buttonComponents[0].onClickCallback?.();

    expect(Notice).toHaveBeenCalledWith('settings.provider.loadModelsFailed');
    expect(Notice).not.toHaveBeenCalledWith('settings.refreshModels.done:{"count":2}');
    expect(context.refreshModelSelectors).not.toHaveBeenCalled();
  });

  it('does not report a command count the refresh did not produce', async () => {
    // Same for commands, and the catalog is explicit about it: a probe that
    // finds nothing puts the previous list back, so the list it leaves behind
    // is evidence of the refresh *before* this one.
    const { Notice } = await import('obsidian');
    mockRefreshCommands.mockResolvedValueOnce('failed');
    const plugin = createPlugin({
      providerConfigs: {
        claude: {
          discoveredCommands: [
            { id: 'sdk:commit', name: 'commit', content: '', source: 'sdk' },
            { id: 'sdk:review', name: 'review', content: '', source: 'sdk' },
          ],
        },
      },
    });
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);
    await findSetting('settings.refreshCommands.name').buttonComponents[0].onClickCallback?.();

    expect(Notice).toHaveBeenCalledWith('settings.provider.loadCommandsFailed');
    expect(Notice).not.toHaveBeenCalledWith('settings.refreshCommands.done:{"count":2}');
  });

  it('reports a failed command refresh instead of leaving the button stuck', async () => {
    const { Notice } = await import('obsidian');
    mockRefreshCommands.mockRejectedValueOnce(new Error('probe failed'));
    const plugin = createPlugin();
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    const button = findSetting('settings.refreshCommands.name').buttonComponents[0];
    await button.onClickCallback?.();

    expect(Notice).toHaveBeenCalledWith('settings.provider.loadCommandsFailed');
    expect(button.setDisabled).toHaveBeenLastCalledWith(false);
  });

  it('reports a failed refresh instead of leaving the button stuck', async () => {
    const { Notice } = await import('obsidian');
    mockRefreshModels.mockRejectedValueOnce(new Error('spawn failed'));
    const plugin = createPlugin();
    const context = createContext(plugin);

    claudeSettingsTabRenderer.render(createContainer(), context);

    const button = findSetting('settings.refreshModels.name').buttonComponents[0];
    await button.onClickCallback?.();

    expect(context.refreshModelSelectors).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('settings.provider.loadModelsFailed');
    expect(button.setDisabled).toHaveBeenLastCalledWith(false);
  });
});
