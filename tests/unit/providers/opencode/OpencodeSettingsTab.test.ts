import * as fs from 'fs';

import { OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES } from '@/providers/opencode/settings';
import { opencodeSettingsTabRenderer } from '@/providers/opencode/ui/OpencodeSettingsTab';

const mockGetHostnameKey = jest.fn(() => 'host-a');
const mockRenderEnvironmentSettingsSection = jest.fn();
const mockSaveSettings = jest.fn().mockResolvedValue(undefined);
const mockBroadcastToProviderTabs = jest.fn().mockResolvedValue(undefined);
const mockRefreshAgentMentions = jest.fn().mockResolvedValue(undefined);
const mockInvalidateProviderCommandCaches = jest.fn();
const mockRefreshModelSelector = jest.fn();
const mockCliResolverReset = jest.fn();
const mockRuntimeEnsureReady = jest.fn().mockResolvedValue(false);
const mockRuntimeSyncConversationState = jest.fn();
const mockRuntimeCleanup = jest.fn();
const mockRuntimeWarmModelMetadata = jest.fn().mockResolvedValue(false);
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
    public dropdownComponents: MockDropdownComponent[] = [];
    public toggleComponents: MockToggleComponent[] = [];
    public settingEl = {
      style: {},
      toggleClass: jest.fn(),
      addClass: jest.fn(),
      removeClass: jest.fn(),
    };

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

    addDropdown(callback: (dropdown: MockDropdownComponent) => void) {
      const component = createDropdownComponent();
      this.dropdownComponents.push(component);
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

jest.mock('@/providers/opencode/ui/OpencodeAgentSettings', () => ({
  OpencodeAgentSettings: class MockOpencodeAgentSettings {
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

jest.mock('@/providers/opencode/app/OpencodeWorkspaceServices', () => ({
  maybeGetOpencodeWorkspaceServices: jest.fn(() => ({
    agentStorage: mockAgentStorage,
    cliResolver: {
      reset: mockCliResolverReset,
    },
    refreshAgentMentions: mockRefreshAgentMentions,
  })),
}));

jest.mock('@/providers/opencode/runtime/OpencodeChatRuntime', () => ({
  OpencodeChatRuntime: class MockOpencodeChatRuntime {
    constructor(readonly plugin: any) {}

    syncConversationState(...args: unknown[]) {
      return mockRuntimeSyncConversationState(...args);
    }

    ensureReady(...args: unknown[]) {
      return mockRuntimeEnsureReady(this.plugin, ...args);
    }

    warmModelMetadata(...args: unknown[]) {
      return mockRuntimeWarmModelMetadata(this.plugin, ...args);
    }

    cleanup() {
      return mockRuntimeCleanup();
    }
  },
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

interface MockDropdownComponent {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  addOption: jest.MockedFunction<(value: string, label: string) => MockDropdownComponent>;
  setValue: jest.MockedFunction<(value: string) => MockDropdownComponent>;
  onChange: jest.MockedFunction<(callback: (value: string) => Promise<void> | void) => MockDropdownComponent>;
}

type MockSettingRecord = {
  name: string;
  desc: string;
  heading: boolean;
  textComponents: MockTextComponent[];
  dropdownComponents: MockDropdownComponent[];
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
        await listener(event);
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
    settings: {
      providerConfigs: {
        opencode: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [],
          enabled: true,
          environmentVariables: OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
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

function findOptionalSetting(name: string): MockSettingRecord | undefined {
  return createdSettings.find((candidate) => candidate.name === name);
}

function findElement(tag: string, cls: string): any {
  const element = createdDomElements.find((candidate) => candidate.tag === tag && candidate.cls === cls);
  if (!element) {
    throw new Error(`Element not found: ${tag}.${cls}`);
  }
  return element;
}

describe('OpencodeSettingsTab', () => {
  const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;
  const originalPlatform = process.platform;

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  beforeEach(() => {
    createdSettings.length = 0;
    createdElements.length = 0;
    createdDomElements.length = 0;
    mockCreatedAgentSettings.length = 0;
    jest.clearAllMocks();
    mockRuntimeEnsureReady.mockResolvedValue(false);
    mockRuntimeWarmModelMetadata.mockResolvedValue(false);
    mockedExistsSync.mockReturnValue(false);
    mockedStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);
  });

  it('stores the CLI path per host and resets active runtime state across all views', async () => {
    mockedExistsSync.mockImplementation((filePath: fs.PathLike) => String(filePath) === '/custom/opencode');
    const plugin = createPlugin();

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    const cliPathSetting = findSetting('CLI path');
    await cliPathSetting.textComponents[0].onChangeCallback?.('/custom/opencode');

    expect(plugin.settings.providerConfigs.opencode.cliPathsByHost).toEqual({
      'host-a': '/custom/opencode',
    });
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockCliResolverReset).toHaveBeenCalledTimes(1);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledTimes(2);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledWith(
      'opencode',
      expect.any(Function),
    );
    expect(mockInvalidateProviderCommandCaches).toHaveBeenCalledTimes(2);
    expect(mockRefreshModelSelector).toHaveBeenCalledTimes(2);
  });

  it('renders a notice explaining where vault-level commands and skills are managed', () => {
    const plugin = createPlugin();
    const context = createContext(plugin);

    opencodeSettingsTabRenderer.render(createContainer(), context);

    expect(findSetting('Commands and skills').heading).toBe(true);
    expect(context.renderHiddenProviderCommandSetting).toHaveBeenCalledWith(
      expect.anything(),
      'opencode',
      expect.objectContaining({
        name: 'Hidden Commands and Skills',
        desc: 'Hide specific OpenCode commands and skills from the dropdown. Enter names without the leading slash, one per line.',
      }),
    );

    expect(createdElements).toContainEqual({
      cls: 'setting-item-description',
      tag: 'p',
      text: 'OpenCode can auto-detect vault-level Claude slash commands from .claude/commands/ and skills from .claude/skills/, .codex/skills/, and .agents/skills/. Manage those entries in the Claude or Codex settings tab. This setting only hides entries from the OpenCode dropdown.',
    });
  });

  it('renders vault subagent settings and refreshes runtime state when they change', async () => {
    const plugin = createPlugin();

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    expect(findSetting('Subagents').heading).toBe(true);
    expect(createdElements).toContainEqual({
      cls: 'setting-item-description',
      tag: 'p',
      text: 'Manage vault-level OpenCode subagents from .opencode/agent/ and legacy .opencode/agents/. New entries are saved as subagent-only files and appear in the @mention menu.',
    });

    expect(mockCreatedAgentSettings).toHaveLength(1);
    expect(mockCreatedAgentSettings[0].storage).toBe(mockAgentStorage);

    await mockCreatedAgentSettings[0].onChanged?.();

    expect(mockRefreshAgentMentions).toHaveBeenCalledTimes(1);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledTimes(2);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledWith(
      'opencode',
      expect.any(Function),
    );
    expect(mockInvalidateProviderCommandCaches).toHaveBeenCalledTimes(2);
    expect(mockInvalidateProviderCommandCaches).toHaveBeenCalledWith(['opencode']);
    expect(mockRefreshModelSelector).toHaveBeenCalledTimes(2);
  });

  it('passes the default Exa env var into the environment section copy', () => {
    const plugin = createPlugin();

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    expect(mockRenderEnvironmentSettingsSection).toHaveBeenCalledWith(expect.objectContaining({
      desc: expect.stringContaining(OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES),
      placeholder: `${OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES}\nOPENCODE_DB=/path/to/opencode.db`,
    }));
  });

  it('loads the OpenCode model catalog when the model browser is expanded', async () => {
    mockRuntimeEnsureReady.mockImplementation(async (plugin: any) => {
      plugin.settings.providerConfigs.opencode.discoveredModels = [
        { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
      ];
      return true;
    });
    const plugin = createPlugin({
      providerConfigs: {
        opencode: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [],
          enabled: true,
          environmentVariables: OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
          modelAliases: {},
          preferredThinkingByModel: {},
          selectedMode: '',
          visibleModels: ['deepseek/deepseek-v4-pro'],
        },
      },
    });
    const context = createContext(plugin);

    opencodeSettingsTabRenderer.render(createContainer(), context);

    const catalogEl = findElement('details', 'grimoire-opencode-model-picker-catalog');
    catalogEl.open = true;
    await catalogEl.dispatchMockEvent('toggle');

    expect(mockRuntimeSyncConversationState).toHaveBeenCalledWith({
      providerState: { databasePath: ':memory:' },
      sessionId: null,
    });
    expect(mockRuntimeEnsureReady).toHaveBeenCalledWith(
      plugin,
      { allowSessionCreation: true },
    );
    expect(mockRuntimeCleanup).toHaveBeenCalledTimes(1);
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
  });

  it('loads the OpenCode model catalog immediately when a fresh picker starts expanded', async () => {
    mockRuntimeEnsureReady.mockImplementation(async (plugin: any) => {
      plugin.settings.providerConfigs.opencode.discoveredModels = [
        { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
      ];
      return true;
    });
    const plugin = createPlugin({
      providerConfigs: {
        opencode: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [],
          enabled: true,
          environmentVariables: OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
          modelAliases: {},
          preferredThinkingByModel: {},
          selectedMode: '',
          visibleModels: [],
        },
      },
    });
    const context = createContext(plugin);

    opencodeSettingsTabRenderer.render(createContainer(), context);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRuntimeSyncConversationState).toHaveBeenCalledWith({
      providerState: { databasePath: ':memory:' },
      sessionId: null,
    });
    expect(mockRuntimeEnsureReady).toHaveBeenCalledWith(
      plugin,
      { allowSessionCreation: true },
    );
    expect(mockRuntimeCleanup).toHaveBeenCalledTimes(1);
    expect(context.refreshModelSelectors).toHaveBeenCalledTimes(1);
  });

  it('warms and persists thinking metadata when a model is added to the visible list', async () => {
    mockRuntimeWarmModelMetadata.mockResolvedValue(true);
    const plugin = createPlugin({
      providerConfigs: {
        opencode: {
          availableModes: [],
          cliPath: '',
          cliPathsByHost: {},
          discoveredModels: [
            { label: 'DeepSeek/DeepSeek V4 Pro', rawId: 'deepseek/deepseek-v4-pro' },
          ],
          enabled: true,
          environmentVariables: OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
          modelAliases: {},
          preferredThinkingByModel: {},
          selectedMode: '',
          visibleModels: [],
        },
      },
    });
    const context = createContext(plugin);

    opencodeSettingsTabRenderer.render(createContainer(), context);

    const checkboxEl = createdDomElements.find((element) => element.type === 'checkbox');
    if (!checkboxEl) {
      throw new Error('Expected model checkbox');
    }

    checkboxEl.checked = true;
    await checkboxEl.dispatchMockEvent('change');
    await Promise.resolve();
    await Promise.resolve();

    expect(plugin.settings.providerConfigs.opencode.visibleModels).toEqual([
      'deepseek/deepseek-v4-pro',
    ]);
    expect(mockRuntimeWarmModelMetadata).toHaveBeenCalledWith(
      plugin,
      'opencode:deepseek/deepseek-v4-pro',
    );
    expect(context.refreshModelSelectors).toHaveBeenCalled();
  });

  it('renders installation method and WSL distro override controls on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const plugin = createPlugin();

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    expect(findSetting(t('settings.providerTabs.codex.installationMethod.name')).dropdownComponents).toHaveLength(1);
    expect(findSetting(t('settings.providerTabs.codex.wslDistro.name')).textComponents).toHaveLength(1);
  });

  it('hides Windows-only installation controls on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const plugin = createPlugin();

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    expect(findOptionalSetting(t('settings.providerTabs.codex.installationMethod.name'))).toBeUndefined();
    expect(findOptionalSetting(t('settings.providerTabs.codex.wslDistro.name'))).toBeUndefined();
  });

  it('uses host-native CLI path behavior on non-Windows even when WSL is saved', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const plugin = createPlugin({
      providerConfigs: {
        opencode: {
          enabled: true,
          cliPath: '',
          cliPathsByHost: {},
          installationMethod: 'wsl',
          installationMethodsByHost: {
            'host-a': 'wsl',
          },
          wslDistroOverride: 'Ubuntu',
          wslDistroOverridesByHost: {
            'host-a': 'Ubuntu',
          },
        },
      },
    });

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    const cliPathSetting = findSetting(t('settings.providerTabs.acp.cliPath.name', {
      provider: 'OpenCode',
    }));
    expect(cliPathSetting.desc).toBe(t('settings.providerTabs.acp.cliPath.desc', {
      command: 'opencode',
      provider: 'OpenCode',
    }));
    expect(cliPathSetting.textComponents[0].placeholder).toBe('/usr/local/bin/opencode');

    await cliPathSetting.textComponents[0].onChangeCallback?.('codex');

    expect(plugin.settings.providerConfigs.opencode.cliPathsByHost['host-a']).toBeUndefined();
    expect(mockSaveSettings).toHaveBeenCalledTimes(0);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledTimes(0);
  });

  it('accepts a Linux-side CLI command when installation method is WSL', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const plugin = createPlugin();

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    const installationMethodSetting = findSetting(t('settings.providerTabs.codex.installationMethod.name'));
    await installationMethodSetting.dropdownComponents[0].onChangeCallback?.('wsl');

    const cliPathSetting = findSetting(t('settings.providerTabs.acp.cliPath.name', {
      provider: 'OpenCode',
    }));
    await cliPathSetting.textComponents[0].onChangeCallback?.('opencode');

    expect(plugin.settings.providerConfigs.opencode.installationMethodsByHost).toEqual({
      'host-a': 'wsl',
    });
    expect(plugin.settings.providerConfigs.opencode.cliPathsByHost['host-a']).toBe('opencode');
    expect(mockSaveSettings).toHaveBeenCalled();
    expect(mockBroadcastToProviderTabs).toHaveBeenCalled();
  });

  it('rejects a Windows-native CLI path when installation method is WSL', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const plugin = createPlugin({
      providerConfigs: {
        opencode: {
          enabled: true,
          cliPath: '',
          cliPathsByHost: {
            'host-a': 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd',
          },
          installationMethod: 'wsl',
          installationMethodsByHost: {
            'host-a': 'wsl',
          },
          wslDistroOverride: 'Ubuntu',
          wslDistroOverridesByHost: {
            'host-a': 'Ubuntu',
          },
        },
      },
    });

    opencodeSettingsTabRenderer.render(createContainer(), createContext(plugin));

    const installationMethodSetting = findSetting(t('settings.providerTabs.codex.installationMethod.name'));
    await installationMethodSetting.dropdownComponents[0].onChangeCallback?.('wsl');

    const cliPathSetting = findSetting(t('settings.providerTabs.acp.cliPath.name', {
      provider: 'OpenCode',
    }));
    await cliPathSetting.textComponents[0].onChangeCallback?.('C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd');

    expect(plugin.settings.providerConfigs.opencode.installationMethodsByHost).toEqual({
      'host-a': 'wsl',
    });
    expect(plugin.settings.providerConfigs.opencode.cliPathsByHost['host-a']).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd',
    );
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledTimes(2);
  });
});
