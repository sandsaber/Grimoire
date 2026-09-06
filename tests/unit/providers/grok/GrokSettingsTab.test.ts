import * as fs from 'fs';

import { setLocale, t } from '@/i18n/i18n';
import { GROK_DEFAULT_ENVIRONMENT_VARIABLES } from '@/providers/grok/settings';
import { grokSettingsTabRenderer } from '@/providers/grok/ui/GrokSettingsTab';

const mockGetHostnameKey = jest.fn(() => 'host-a');
const mockRenderEnvironmentSettingsSection = jest.fn();
const mockSaveSettings = jest.fn().mockResolvedValue(undefined);
const mockBroadcastToProviderTabs = jest.fn().mockResolvedValue(undefined);
const mockRefreshAgentMentions = jest.fn().mockResolvedValue(undefined);
const mockInvalidateProviderCommandCaches = jest.fn();
const mockRefreshModelSelector = jest.fn();
const mockCliResolverReset = jest.fn();
const mockDiscoverMetadata = jest.fn().mockResolvedValue(false);
const mockAgentStorage = {};
const mockCreatedAgentSettings: Array<{
  app: unknown;
  containerEl: unknown;
  onChanged?: () => Promise<void> | void;
  storage: unknown;
}> = [];

jest.mock('fs');
jest.mock('obsidian', () => {
  class MockSetting {
    public name = '';
    public desc = '';
    public heading = false;
    public textComponents: MockTextComponent[] = [];
    public toggleComponents: MockToggleComponent[] = [];

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

    addToggle(callback: (toggle: MockToggleComponent) => void) {
      const component = createToggleComponent();
      this.toggleComponents.push(component);
      callback(component);
      return this;
    }
  }

  return {
    Setting: MockSetting,
  };
});

jest.mock('@/features/settings/ui/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: (...args: unknown[]) => mockRenderEnvironmentSettingsSection(...args),
}));

jest.mock('@/features/settings/ui/ProviderSkillSettings', () => ({
  ProviderSkillSettings: jest.fn(),
}));

jest.mock('@/features/settings/ui/McpSettingsManager', () => ({
  McpSettingsManager: jest.fn(),
}));

jest.mock('@/providers/grok/ui/GrokAgentSettings', () => ({
  GrokAgentSettings: class MockGrokAgentSettings {
    constructor(
      containerEl: unknown,
      storage: unknown,
      app: unknown,
      onChanged?: () => Promise<void> | void,
    ) {
      mockCreatedAgentSettings.push({
        app,
        containerEl,
        onChanged,
        storage,
      });
    }
  },
}));

jest.mock('@/providers/grok/app/GrokWorkspaceServices', () => ({
  maybeGetGrokWorkspaceServices: jest.fn(() => ({
    agentStorage: mockAgentStorage,
    cliResolver: {
      reset: mockCliResolverReset,
    },
    refreshAgentMentions: mockRefreshAgentMentions,
  })),
}));

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

interface MockTextComponent {
  value: string;
  placeholder: string;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  setPlaceholder: jest.MockedFunction<(value: string) => MockTextComponent>;
  setValue: jest.MockedFunction<(value: string) => MockTextComponent>;
  onChange: jest.MockedFunction<(callback: (value: string) => Promise<void> | void) => MockTextComponent>;
  inputEl: {
    value: string;
    style: Record<string, string>;
    addClass: jest.Mock;
    toggleClass: jest.Mock;
  };
}

interface MockToggleComponent {
  value: boolean;
  onChangeCallback: ((value: boolean) => Promise<void> | void) | null;
  setValue: jest.MockedFunction<(value: boolean) => MockToggleComponent>;
  onChange: jest.MockedFunction<(callback: (value: boolean) => Promise<void> | void) => MockToggleComponent>;
}

type MockSettingRecord = {
  name: string;
  desc: string;
  heading: boolean;
  textComponents: MockTextComponent[];
  toggleComponents: MockToggleComponent[];
};

type MockElementRecord = {
  cls?: string;
  tag?: string;
  text?: string;
};

const createdSettings: MockSettingRecord[] = [];
const createdElements: MockElementRecord[] = [];
const createdDomElements: any[] = [];

function createTextComponent(): MockTextComponent {
  const component = {} as MockTextComponent;
  component.value = '';
  component.placeholder = '';
  component.onChangeCallback = null;
  component.inputEl = {
    value: '',
    style: {},
    addClass: jest.fn(),
    toggleClass: jest.fn(),
  };
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
  const eventListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const element: any = {
    value: '',
    checked: false,
    open: false,
    placeholder: '',
    title: '',
    style: {},
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
    appendText: jest.fn(),
    setText: jest.fn((value: string) => {
      element.text = value;
    }),
    empty: jest.fn(),
    setAttribute: jest.fn(),
    addEventListener: jest.fn((type: string, callback: (...args: unknown[]) => void) => {
      const listeners = eventListeners.get(type) ?? [];
      listeners.push(callback);
      eventListeners.set(type, listeners);
    }),
    dispatchMockEvent: async (type: string, event?: unknown) => {
      for (const listener of eventListeners.get(type) ?? []) {
        await Promise.resolve(listener(event));
      }
    },
    blur: jest.fn(),
    createEl: jest.fn((_tag?: string, attrs?: Record<string, unknown>) => {
      const child = createElement();
      child.tag = _tag;
      if (attrs && typeof attrs.cls === 'string') {
        child.cls = attrs.cls;
      }
      if (attrs && typeof attrs.text === 'string') {
        child.text = attrs.text;
      }
      if (attrs && typeof attrs.value === 'string') {
        child.value = attrs.value;
      }
      if (attrs && typeof attrs.type === 'string') {
        child.type = attrs.type;
      }
      createdElements.push({
        cls: child.cls,
        tag: child.tag,
        text: child.text,
      });
      createdDomElements.push(child);
      return child;
    }),
    createDiv: jest.fn((attrs?: Record<string, unknown>) => {
      const child = createElement();
      child.tag = 'div';
      if (attrs && typeof attrs.cls === 'string') {
        child.cls = attrs.cls;
      }
      createdElements.push({
        cls: child.cls,
        tag: child.tag,
        text: child.text,
      });
      createdDomElements.push(child);
      return child;
    }),
    createSpan: jest.fn((_attrs?: Record<string, unknown>) => createElement()),
  };

  return element;
}

function createContainer(): any {
  return {
    createDiv: jest.fn((attrs?: Record<string, unknown>) => {
      const child = createElement();
      child.tag = 'div';
      if (attrs && typeof attrs.cls === 'string') {
        child.cls = attrs.cls;
      }
      createdElements.push({
        cls: child.cls,
        tag: child.tag,
        text: child.text,
      });
      createdDomElements.push(child);
      return child;
    }),
    createEl: jest.fn((tag?: string, attrs?: Record<string, unknown>) => {
      const child = createElement();
      child.tag = tag;
      if (attrs && typeof attrs.cls === 'string') {
        child.cls = attrs.cls;
      }
      if (attrs && typeof attrs.text === 'string') {
        child.text = attrs.text;
      }
      createdElements.push({
        cls: child.cls,
        tag: child.tag,
        text: child.text,
      });
      createdDomElements.push(child);
      return child;
    }),
  };
}

function createPlugin(overrides: Record<string, unknown> = {}): any {
  const viewA = {
    getTabManager: jest.fn(() => ({
      broadcastToProviderTabs: mockBroadcastToProviderTabs,
    })),
    invalidateProviderCommandCaches: mockInvalidateProviderCommandCaches,
    refreshModelSelector: mockRefreshModelSelector,
  };
  const viewB = {
    getTabManager: jest.fn(() => ({
      broadcastToProviderTabs: mockBroadcastToProviderTabs,
    })),
    invalidateProviderCommandCaches: mockInvalidateProviderCommandCaches,
    refreshModelSelector: mockRefreshModelSelector,
  };

  return {
    getGrokExecution: () => ({ metadata: { discoverMetadata: mockDiscoverMetadata } }),
    settings: {
      providerConfigs: {
        grok: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [],
          enabled: true,
          environmentVariables: GROK_DEFAULT_ENVIRONMENT_VARIABLES,
          modelAliases: {},
          preferredThinkingByModel: {},
          selectedMode: '',
          visibleModels: [],
        },
      },
      ...overrides,
    },
    saveSettings: mockSaveSettings,
    getView: jest.fn(() => viewA),
    getAllViews: jest.fn(() => [viewA, viewB]),
  };
}

function createContext(plugin: any) {
  return {
    plugin,
    suppressAutomaticDiscovery: false,
    createWorkspaceSection: jest.fn((container: any) => container),
    renderHiddenProviderCommandSetting: jest.fn(),
    refreshModelSelectors: jest.fn(),
    renderCustomContextLimits: jest.fn(),
    renderAdvancedSection: jest.fn((container: any) => container),
  };
}

function findSetting(name: string): MockSettingRecord {
  const setting = createdSettings.find((candidate) => candidate.name === name);
  if (!setting) {
    throw new Error(`Setting not found: ${name}`);
  }
  return setting;
}

function findElement(tag: string, cls: string): any {
  const element = createdDomElements.find((candidate) => candidate.tag === tag && candidate.cls === cls);
  if (!element) {
    throw new Error(`Element not found: ${tag}.${cls}`);
  }
  return element;
}

describe('GrokSettingsTab', () => {
  const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

  beforeEach(() => {
    createdSettings.length = 0;
    createdElements.length = 0;
    createdDomElements.length = 0;
    mockCreatedAgentSettings.length = 0;
    jest.clearAllMocks();
    mockDiscoverMetadata.mockResolvedValue(false);
    mockedExistsSync.mockReturnValue(false);
    mockedStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);
    setLocale('en');
  });

  it('stores the CLI path per host and resets active runtime state across all views', async () => {
    mockedExistsSync.mockImplementation((filePath: fs.PathLike) => String(filePath) === '/custom/grok');
    const plugin = createPlugin();

    grokSettingsTabRenderer.render(createContainer(), createContext(plugin));

    const cliPathSetting = findSetting(t('settings.cliPath.name'));
    expect(cliPathSetting.desc).toBe(t('settings.grok.cliPath.desc'));
    expect(cliPathSetting.textComponents[0].placeholder).toBe('/usr/local/bin/grok');
    await cliPathSetting.textComponents[0].onChangeCallback?.('/custom/grok');

    expect(plugin.settings.providerConfigs.grok.cliPathsByHost).toEqual({
      'host-a': '/custom/grok',
    });
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockCliResolverReset).toHaveBeenCalledTimes(1);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledTimes(2);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledWith(
      'grok',
      expect.any(Function),
    );
    expect(mockInvalidateProviderCommandCaches).toHaveBeenCalledTimes(2);
    expect(mockRefreshModelSelector).toHaveBeenCalledTimes(2);
  });

  it('renders a notice explaining where vault-level commands and skills are managed', () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    grokSettingsTabRenderer.render(createContainer(), context);

    expect(findSetting(t('settings.hub.skills')).heading).toBe(true);
    expect(context.createWorkspaceSection).toHaveBeenCalledWith(expect.anything(), ['skills']);
    expect(findSetting(t('settings.slashCommands.name')).heading).toBe(true);
    expect(context.renderHiddenProviderCommandSetting).toHaveBeenCalledWith(
      expect.anything(),
      'grok',
      expect.objectContaining({
        name: t('settings.hiddenSlashCommands.name'),
        desc: t('settings.grok.hiddenCommands.desc'),
      }),
    );

    expect(createdElements).toContainEqual({
      cls: 'setting-item-description',
      tag: 'p',
      text: t('settings.grok.commands.desc'),
    });
  });

  it('renders vault subagent settings and refreshes runtime state when they change', async () => {
    const plugin = createPlugin();

    grokSettingsTabRenderer.render(createContainer(), createContext(plugin));

    expect(findSetting(t('settings.subagents.name')).heading).toBe(true);
    expect(createdElements.some((element) => (
      element.tag === 'p'
      && element.text === t('settings.grok.subagents.desc')
    ))).toBe(true);

    expect(mockCreatedAgentSettings).toHaveLength(1);
    expect(mockCreatedAgentSettings[0].storage).toBe(mockAgentStorage);

    await mockCreatedAgentSettings[0].onChanged?.();

    expect(mockRefreshAgentMentions).toHaveBeenCalledTimes(1);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledTimes(2);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledWith(
      'grok',
      expect.any(Function),
    );
    expect(mockInvalidateProviderCommandCaches).toHaveBeenCalledTimes(2);
    expect(mockInvalidateProviderCommandCaches).toHaveBeenCalledWith(['grok']);
    expect(mockRefreshModelSelector).toHaveBeenCalledTimes(2);
  });

  it('passes the default Exa env var into the environment section copy', () => {
    const plugin = createPlugin();

    grokSettingsTabRenderer.render(createContainer(), createContext(plugin));

    expect(mockRenderEnvironmentSettingsSection).toHaveBeenCalledWith(expect.objectContaining({
      desc: expect.stringContaining(GROK_DEFAULT_ENVIRONMENT_VARIABLES),
      placeholder: `${GROK_DEFAULT_ENVIRONMENT_VARIABLES}\nGROK_AUTH_PATH=~/.grok/auth.json`,
    }));
  });

  it('loads the Grok Build model catalog when the model browser is expanded', async () => {
    mockDiscoverMetadata.mockImplementation(async () => {
      plugin.settings.providerConfigs.grok.discoveredModels = [
        { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
      ];
      return true;
    });
    const plugin = createPlugin({
      providerConfigs: {
        grok: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [],
          enabled: true,
          environmentVariables: GROK_DEFAULT_ENVIRONMENT_VARIABLES,
          modelAliases: {},
          preferredThinkingByModel: {},
          selectedMode: '',
          visibleModels: ['deepseek/deepseek-v4-pro'],
        },
      },
    });
    const context = createContext(plugin);

    grokSettingsTabRenderer.render(createContainer(), context);

    const catalogEl = findElement('details', 'grimoire-grok-model-picker-catalog');
    catalogEl.open = true;
    await catalogEl.dispatchMockEvent('toggle');

    expect(mockDiscoverMetadata).toHaveBeenCalledTimes(1);
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
  });

  it('loads the Grok Build model catalog immediately when a fresh picker starts expanded', async () => {
    mockDiscoverMetadata.mockImplementation(async () => {
      plugin.settings.providerConfigs.grok.discoveredModels = [
        { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
      ];
      return true;
    });
    const plugin = createPlugin({
      providerConfigs: {
        grok: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [],
          enabled: true,
          environmentVariables: GROK_DEFAULT_ENVIRONMENT_VARIABLES,
          modelAliases: {},
          preferredThinkingByModel: {},
          selectedMode: '',
          visibleModels: [],
        },
      },
    });
    const context = createContext(plugin);

    grokSettingsTabRenderer.render(createContainer(), context);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockDiscoverMetadata).toHaveBeenCalledTimes(1);
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
  });

  it('does not create a Grok session while settings are rendered for workspace extraction', async () => {
    const plugin = createPlugin();
    const context = createContext(plugin);
    context.suppressAutomaticDiscovery = true;

    grokSettingsTabRenderer.render(createContainer(), context);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockDiscoverMetadata).not.toHaveBeenCalled();
  });

  it('warms and persists thinking metadata when a model is added to the visible list', async () => {
    mockDiscoverMetadata.mockResolvedValue(true);
    const plugin = createPlugin({
      providerConfigs: {
        grok: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [
            { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
          ],
          enabled: true,
          environmentVariables: GROK_DEFAULT_ENVIRONMENT_VARIABLES,
          modelAliases: {},
          preferredThinkingByModel: {},
          selectedMode: '',
          visibleModels: [],
        },
      },
    });
    const context = createContext(plugin);

    grokSettingsTabRenderer.render(createContainer(), context);

    const checkboxEl = createdDomElements.find((element) => element.type === 'checkbox');
    if (!checkboxEl) {
      throw new Error('Expected model checkbox');
    }

    checkboxEl.checked = true;
    await checkboxEl.dispatchMockEvent('change');
    await Promise.resolve();
    await Promise.resolve();

    expect(plugin.settings.providerConfigs.grok.visibleModels).toEqual([
      'deepseek/deepseek-v4-pro',
    ]);
    expect(mockDiscoverMetadata).toHaveBeenCalledWith({
      model: 'grok:deepseek/deepseek-v4-pro',
    });
    expect(context.refreshModelSelectors).toHaveBeenCalled();
  });
});
