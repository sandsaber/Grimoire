import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Notice } from 'obsidian';

import { readBundledChangelog } from '@/app/changelog/source';
import { DEFAULT_GRIMOIRE_SETTINGS } from '@/app/settings/defaultSettings';
import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { GrimoireSettingTab } from '@/features/settings/GrimoireSettings';
import { setLocale, t } from '@/i18n/i18n';
import type { Locale } from '@/i18n/types';
import { showWhatsNewModal } from '@/shared/modals/WhatsNewModal';

jest.mock('@/shared/modals/WhatsNewModal', () => ({
  showWhatsNewModal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/app/changelog/source', () => ({
  GRIMOIRE_CHANGELOG_URL: 'https://github.com/sandsaber/Grimoire/blob/main/CHANGELOG.md',
  readBundledChangelog: jest.fn().mockResolvedValue('# Changelog\n\n## 9.8.7\n\n### Added\n\n- Manual release note.'),
}));

function collectText(el: any): string {
  return [
    el.textContent ?? '',
    ...(el.children ?? []).map((child: any) => collectText(child)),
  ].filter(Boolean).join(' ');
}

function createSettingsPlugin(overrides: Record<string, any> = {}): any {
  return {
    manifest: { version: '9.8.7-test' },
    settings: {
      ...DEFAULT_GRIMOIRE_SETTINGS,
      ...overrides,
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn().mockReturnValue([]),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    getEnvironmentVariablesForScope: jest.fn().mockReturnValue(''),
    getResolvedProviderCliPath: jest.fn().mockReturnValue(null),
    refreshShellTranslations: jest.fn(),
    applyEnvironmentVariables: jest.fn().mockResolvedValue(undefined),
    applyEnvironmentVariablesBatch: jest.fn().mockResolvedValue(undefined),
  };
}

function createSettingsApp(): any {
  return {
    hotkeyManager: {},
    vault: {
      adapter: {},
    },
  };
}

const providerSelectionHints: Record<Locale, string> = {
  en: 'Select a provider card to view its settings below.',
  de: 'Klicken Sie auf eine Anbieterkarte, um die Einstellungen darunter anzuzeigen.',
  es: 'Haz clic en una tarjeta de proveedor para ver su configuración a continuación.',
  fr: 'Cliquez sur une carte de fournisseur pour afficher ses paramètres ci-dessous.',
  ja: 'プロバイダーカードをクリックすると、下に設定が表示されます。',
  ko: '제공업체 카드를 클릭하면 아래에서 설정을 확인할 수 있습니다.',
  pt: 'Clique em um cartão de provedor para ver as configurações abaixo.',
  ru: 'Нажмите на карточку провайдера, чтобы открыть его настройки ниже.',
  'zh-CN': '选择供应商卡片以查看下方设置。',
  'zh-TW': '選擇供應商卡片以查看下方設定。',
};

function renderDeclarativeSettings(
  tab: GrimoireSettingTab,
  settingEl: any = createMockEl('div'),
): { group: { addClass: jest.Mock }; settingEl: any } {
  const [definition] = tab.getSettingDefinitions();
  const group = { addClass: jest.fn() };
  if ('render' in definition && typeof definition.render === 'function') {
    definition.render({ settingEl } as any, group as any);
  }
  return { group, settingEl };
}

describe('GrimoireSettingTab general tab settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLocale('en');
  });

  it('does not render Grimoire-specific appearance theme controls', () => {
    const plugin = createSettingsPlugin();
    const app: any = { hotkeyManager: {} };
    const tab = new GrimoireSettingTab(app, plugin);
    const container = createMockEl('div');
    (tab as any).containerEl = createMockEl('div');

    (tab as any).renderGeneralTab(container);

    expect(collectText(container)).not.toContain('Theme');
    expect(collectText(container)).not.toContain('Follows Obsidian');
    expect(container.querySelector('.grimoire-theme-card')).toBeNull();
  });

  it('renders the plugin version and permanent what\'s new action in settings', () => {
    const plugin = createSettingsPlugin();
    const app = createSettingsApp();
    const tab = new GrimoireSettingTab(app, plugin);
    const { settingEl } = renderDeclarativeSettings(tab);

    const versionEl = settingEl.querySelector('.grimoire-settings-version-row');
    expect(collectText(versionEl)).toContain('Version');
    expect(collectText(versionEl)).toContain('Grimoire v9.8.7-test');
    expect(versionEl?.querySelector('.grimoire-settings-whats-new')?.textContent).toBe('What\'s new');
  });

  it('keeps the custom settings page searchable without inheriting the outer setting-group styles', () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);

    const [definition] = tab.getSettingDefinitions();
    expect(definition).toMatchObject({
      name: 'Grimoire settings',
      desc: 'Configure Grimoire, its workspace, and provider integrations.',
    });
    expect('aliases' in definition ? definition.aliases : []).toEqual(expect.arrayContaining([
      'Maximum chat tabs',
      'Claude Code',
      'Project workspace',
    ]));
    expect('render' in definition).toBe(true);

    const settingEl = createMockEl('div');
    settingEl.addClass('setting-item');
    const { group } = renderDeclarativeSettings(tab, settingEl);

    expect(Object.prototype.hasOwnProperty.call(GrimoireSettingTab.prototype, 'display')).toBe(false);
    expect(group.addClass).toHaveBeenCalledWith('grimoire-settings-root-group');
    expect(settingEl.hasClass('setting-item')).toBe(false);
    expect(settingEl.hasClass('grimoire-settings')).toBe(true);
    expect(collectText(settingEl)).toContain('Maximum chat tabs');
  });

  it('opens bundled release notes for the current version from the what\'s new action', async () => {
    const plugin = createSettingsPlugin();
    const app = createSettingsApp();
    const tab = new GrimoireSettingTab(app, plugin);
    const { settingEl } = renderDeclarativeSettings(tab);

    const button = settingEl.querySelector('.grimoire-settings-whats-new');
    button?.dispatchEvent('click');
    await Promise.resolve();
    await Promise.resolve();

    expect(readBundledChangelog).toHaveBeenCalledWith(app.vault.adapter, plugin.manifest);
    expect(showWhatsNewModal).toHaveBeenCalledWith({
      app,
      fullChangelogUrl: 'https://github.com/sandsaber/Grimoire/blob/main/CHANGELOG.md',
      release: expect.objectContaining({
        version: '9.8.7',
      }),
    });
  });

  it('shows a notice when no bundled release notes match the current version', async () => {
    (readBundledChangelog as jest.Mock).mockResolvedValueOnce('# Changelog\n\n## 1.2.3\n\n- Older release.');
    const plugin = createSettingsPlugin();
    const app = createSettingsApp();
    const tab = new GrimoireSettingTab(app, plugin);
    const { settingEl } = renderDeclarativeSettings(tab);

    const button = settingEl.querySelector('.grimoire-settings-whats-new');
    button?.dispatchEvent('click');
    await Promise.resolve();
    await Promise.resolve();

    expect(showWhatsNewModal).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('No release notes are bundled for this Grimoire version.');
  });

  it('renders the maximum chat tabs control in General and removes tab bar placement', () => {
    const plugin = createSettingsPlugin({ maxTabs: 5, tabBarPosition: 'input' });
    const app: any = { hotkeyManager: {} };
    const tab = new GrimoireSettingTab(app, plugin);
    const container = createMockEl('div');
    (tab as any).containerEl = createMockEl('div');

    (tab as any).renderGeneralTab(container);

    const allText = collectText(container);
    expect(allText).toContain('Maximum chat tabs');
    expect(allText).toContain('Maximum number of concurrent chat tabs (1-10).');
    expect(container.querySelector('.grimoire-adv')).toBeNull();
    expect(allText).not.toContain('Debug logging');
    expect(allText).not.toContain('Tab bar position');
    expect(container.querySelector('.grimoire-slider-value')?.textContent).toBe('5');
  });

  it('renders the debug logging toggle in the Advanced General section', () => {
    const plugin = createSettingsPlugin({ debugLoggingEnabled: false });
    const app: any = { hotkeyManager: {} };
    const tab = new GrimoireSettingTab(app, plugin);
    const container = createMockEl('div');
    (tab as any).containerEl = createMockEl('div');

    (tab as any).renderGeneralAdvancedSettings(container);

    const advancedText = collectText(container);
    expect(advancedText).toContain('Debug logging');
    expect(advancedText).toContain('.grimoire/logs/YYYY-MM-DD.jsonl');
  });

  it('renders the usage indicators toggle in the Advanced General section', () => {
    const plugin = createSettingsPlugin({ usageIndicatorsEnabled: true });
    const app: any = { hotkeyManager: {} };
    const tab = new GrimoireSettingTab(app, plugin);
    const container = createMockEl('div');
    (tab as any).containerEl = createMockEl('div');

    (tab as any).renderGeneralAdvancedSettings(container);

    const advancedText = collectText(container);
    expect(advancedText).toContain('Usage indicators');
    expect(advancedText).toContain('Show plan usage and API spend indicators');
  });

  it('renders the manual send button setting in the Advanced General section', () => {
    const plugin = createSettingsPlugin({ requireCommandOrControlEnterToSend: false });
    const app: any = { hotkeyManager: {} };
    const tab = new GrimoireSettingTab(app, plugin);
    const container = createMockEl('div');
    (tab as any).containerEl = createMockEl('div');

    (tab as any).renderGeneralAdvancedSettings(container);

    const advancedText = collectText(container);
    expect(advancedText).toContain('Send only with button');
    expect(advancedText).toContain('Use the Send button to submit');
    expect(advancedText).not.toContain('Require Command/Ctrl+Enter to send');
  });

  it('keeps environment settings out of General', () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    const container = createMockEl('div');

    (tab as any).renderGeneralTab(container);

    expect(container.querySelector('.grimoire-settings-env-textarea')).toBeNull();
    expect(collectText(container)).not.toContain('Shared environment');
  });
});

describe('GrimoireSettingTab settings hub', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    setLocale('en');
  });

  it.each(Object.entries(providerSelectionHints))(
    'uses the localized provider selection hint for %s',
    (locale, expectedHint) => {
      setLocale(locale as Locale);
      expect(t('settings.providers.selectionHint')).toBe(expectedHint);
      expect(t('settings.providers.selectionHint')).not.toBe('settings.providers.selectionHint');

      const plugin = createSettingsPlugin({ locale });
      const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
      const container = createMockEl('div');

      (tab as any).renderProvidersHub(
        container,
        providerCatalog().ids(),
        createMockEl('div'),
      );

      expect(container.querySelector('.grimoire-settings-provider-hint')?.textContent)
        .toBe(expectedHint);
    },
  );

  it('rolls back a provider toggle when its model catalog cannot start', async () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    const refreshModels = jest.fn().mockRejectedValue(
      Object.assign(new Error('spawn qwen ENOENT'), { code: 'ENOENT' }),
    );
    // The catalog is reached through the application's workspace lookup now,
    // not a static registry: the row moved with the enablement gate stated at
    // the call site, because this one does not iterate enabled providers.
    plugin.getApplicationRuntimeOrNull = () => ({
      workspaceFor: async () => ({ models: { list: async () => [], refresh: refreshModels } }),
    });

    await (tab as any).updateProviderEnabled('qwen', true);

    expect(refreshModels).toHaveBeenCalledTimes(1);
    expect(providerCatalog().isEnabled(plugin.settings, 'qwen')).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith('Could not load provider models.');
  });

  it('renders the four top-level settings tabs', () => {
    const plugin = createSettingsPlugin();
    const app: any = { hotkeyManager: {} };
    const tab = new GrimoireSettingTab(app, plugin);
    const { settingEl } = renderDeclarativeSettings(tab);

    const tabLabels = Array.from(
      settingEl.querySelectorAll('.grimoire-settings-tab'),
    ).map((button: any) => button.textContent?.trim() ?? '');

    expect(tabLabels).toEqual(['General', 'Providers', 'Advanced', 'About']);
    expect(settingEl.querySelector('.grimoire-settings-tab-count')).toBeNull();
  });

  it('re-renders every settings tab immediately after changing the locale in General', async () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    const { settingEl } = renderDeclarativeSettings(tab);
    const languageSelect = settingEl.querySelector('.grimoire-settings-language-select');

    languageSelect.value = 'zh-CN';
    languageSelect.dispatchEvent('change');
    await new Promise(resolve => window.setTimeout(resolve, 0));

    const tabLabels = Array.from<any>(
      settingEl.querySelectorAll('.grimoire-settings-tab'),
    ).map(button => button.textContent?.trim() ?? '');
    expect(tabLabels).toEqual(['常规', '供应商', '高级设置', '关于']);
    expect(plugin.refreshShellTranslations).toHaveBeenCalledTimes(1);

    const providerTab = settingEl.querySelectorAll('.grimoire-settings-tab')[1];
    providerTab.dispatchEvent('click');
    await new Promise(resolve => window.setTimeout(resolve, 50));

    const providerNames = Array.from<any>(
      settingEl.querySelectorAll('.grimoire-settings-provider-card-name'),
    ).map(element => element.textContent?.trim() ?? '');
    expect(providerNames).toContain('Gemini CLI（旧版）');
    expect(settingEl.querySelector('.grimoire-settings-provider-hint')?.textContent)
      .toBe('选择供应商卡片以查看下方设置。');
  });

  it('renders provider cards in registry order inside Providers', () => {
    const plugin = createSettingsPlugin();
    plugin.getResolvedProviderCliPath.mockImplementation((providerId: string) => `/bin/${providerId}`);
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    (tab as any).activeTab = 'providers';
    const { settingEl } = renderDeclarativeSettings(tab);
    const providerNames = Array.from(
      settingEl.querySelectorAll('.grimoire-settings-provider-card-name'),
    ).map((element: any) => element.textContent?.trim() ?? '');

    expect(providerNames).toEqual([
      'Claude Code',
      'Codex',
      'OpenCode',
      'Grok Build',
      'MiMoCode',
      'Kimi Code',
      'Antigravity',
      'Gemini CLI (Legacy)',
      'Qwen Code',
    ]);
    expect(collectText(settingEl)).not.toContain('Enabled');
    expect(collectText(settingEl)).not.toContain('Disabled');
    expect(settingEl.querySelector('.grimoire-settings-provider-card-meta')?.textContent).toBe('CLI detected');
    const providerGrid = settingEl.querySelector('.grimoire-settings-provider-grid');
    const providerHint = settingEl.querySelector('.grimoire-settings-provider-hint');
    expect(providerHint?.textContent).toBe('Select a provider card to view its settings below.');
    expect(providerGrid).not.toBeNull();
    expect(providerCatalog().ids()).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'antigravity',
      'gemini',
      'qwen',
    ]);
  });

  it('renders the provider selection hint between the cards and provider settings', () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    const container = createMockEl('div');

    (tab as any).renderProvidersHub(
      container,
      providerCatalog().ids(),
      createMockEl('div'),
    );

    expect(container.children.slice(0, 3).map((child: any) => child.className)).toEqual([
      'grimoire-settings-provider-grid',
      'grimoire-settings-provider-hint',
      'grimoire-settings-provider-details',
    ]);
    expect(container.children[1].textContent).toBe(
      'Select a provider card to view its settings below.',
    );
  });

  it('reports only CLI availability regardless of persisted provider models', () => {
    const plugin = createSettingsPlugin();
    plugin.settings.providerConfigs.claude.discoveredModels = [
      { rawId: 'stale-model' },
    ];
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);

    expect((tab as any).getProviderStatusText('claude')).toBe('CLI not detected');
  });

  it('localizes the legacy Gemini provider name in Chinese', () => {
    const plugin = createSettingsPlugin();
    plugin.settings.locale = 'zh-CN';
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    (tab as any).activeTab = 'providers';
    const { settingEl } = renderDeclarativeSettings(tab);
    const providerNames = Array.from(
      settingEl.querySelectorAll('.grimoire-settings-provider-card-name'),
    ).map((element: any) => element.textContent?.trim() ?? '');

    expect(providerNames).toContain('Gemini CLI（旧版）');
    expect(providerNames).not.toContain('Gemini CLI (Legacy)');
  });

  it('renders six Advanced sections and moves General advanced settings into a direct page', () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    const container = createMockEl('div');

    (tab as any).renderWorkspaceHub(container, providerCatalog().ids());

    const navigation = container.children[0];
    const sectionLabels = Array.from(
      navigation?.children ?? [],
    ).map((button: any) => button.textContent?.trim() ?? '');
    expect(sectionLabels).toEqual([
      'General',
      'Skills',
      'Subagents',
      'MCP',
      'Environment',
      'Commands',
    ]);
    expect(collectText(container)).toContain('Debug logging');
    expect(container.querySelector('.grimoire-adv')).toBeNull();
    expect(container.querySelector('.grimoire-settings-resource-toolbar')).toBeNull();
    expect(container.querySelector('.grimoire-settings-resource-list')).toBeNull();
    expect(collectText(container)).not.toContain('Advanced · Skills');
  });

  it('shows repository and release links in About', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const container = createMockEl('div');

    (tab as any).renderAboutHub(container);

    const links = container.querySelector('.grimoire-settings-about-links');
    const collectHrefs = (element: any): string[] => [
      ...(element?.tagName === 'A' ? [element.getAttribute('href')] : []),
      ...(element?.children ?? []).flatMap((child: any) => collectHrefs(child)),
    ];
    const hrefs = collectHrefs(links);
    expect(collectText(links)).toContain('GitHub.com/sandsaber/Grimoire');
    expect(collectText(links)).toContain('Releases');
    expect(hrefs).toEqual([
      'https://github.com/sandsaber/Grimoire',
      'https://github.com/sandsaber/Grimoire/releases',
    ]);
  });

  it('uses explicit provider capabilities for every Advanced manager', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const providerIds = providerCatalog().ids();

    expect((tab as any).getWorkspaceManagerProviders(providerIds, 'skills')).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'gemini',
      'qwen',
    ]);
    expect((tab as any).getWorkspaceManagerProviders(providerIds, 'commands')).toEqual([
      'claude',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'gemini',
      'qwen',
    ]);
    expect((tab as any).getWorkspaceManagerProviders(providerIds, 'agents')).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'gemini',
      'qwen',
    ]);
    expect((tab as any).getWorkspaceManagerProviders(providerIds, 'mcp')).toEqual([
      'claude',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'gemini',
      'qwen',
    ]);
    expect((tab as any).getWorkspaceManagerProviders(providerIds, 'environment')).toEqual([
      '__shared__',
      ...providerIds,
    ]);
  });

  it('warms runtime commands through an isolated settings discovery context', async () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    const runtimeEntry = {
      id: 'runtime:review',
      name: 'review',
      description: 'Review the current workspace',
      kind: 'command',
      scope: 'runtime',
      isEditable: false,
      isDeletable: false,
    };
    const catalog = {
      listVaultEntries: jest.fn().mockResolvedValue([]),
      listDropdownEntries: jest.fn().mockResolvedValue([runtimeEntry]),
      setRuntimeCommands: jest.fn(),
    };
    const loader = {
      isAvailable: jest.fn().mockReturnValue(true),
      loadCommands: jest.fn().mockResolvedValue([{ name: 'review', description: 'Review the current workspace' }]),
    };
    // Both are workspace slots now, so both are stubbed in one place — which is
    // the point of the row having moved.
    plugin.getApplicationRuntimeOrNull = () => ({
      workspaceFor: async (providerId: string) => (
        providerId === 'opencode' ? { commands: catalog, runtimeCommands: loader } : {}
      ),
    });

    const rows = await (tab as any).loadWorkspaceHubRows(['opencode'], 'commands');

    // No plugin: the loader's context stopped carrying one when the provider's
    // metadata session moved into the closure its workspace services build it
    // with. What the host still decides is on this object.
    expect(loader.loadCommands).toHaveBeenCalledWith({
      allowSessionCreation: true,
      conversation: null,
      externalContextPaths: [],
      runtime: null,
    });
    expect(catalog.setRuntimeCommands).toHaveBeenCalledWith([
      { name: 'review', description: 'Review the current workspace' },
    ]);
    expect(rows).toEqual([expect.objectContaining({
      name: 'review',
      ownerProviderId: 'opencode',
      readonly: true,
      section: 'commands',
    })]);
  });

  it('enumerates stored agents even when mention search hides them and keeps providers independent', async () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const providerIds = ['grok', 'mimocode', 'kimicode'] as const;
    const storages = Object.fromEntries(providerIds.map((providerId) => [providerId, {
      delete: jest.fn().mockResolvedValue(undefined),
      loadAll: jest.fn().mockResolvedValue([{
        description: `${providerId} hidden reviewer`,
        mode: 'primary',
        name: 'review',
        persistenceKey: `${providerId}-agent:review.md`,
      }]),
    }]));
    // Both halves come off the composition root now — the hub's two legacy rows
    // and the mention refresh a delete triggers — so they are stubbed together
    // rather than one on a registry and one on the runtime.
    const refreshes = Object.fromEntries(providerIds.map(providerId => [providerId, jest.fn()]));
    (tab as any).plugin.getApplicationRuntimeOrNull = () => ({
      workspaceServicesFor: (providerId: string) => {
        const storage = storages[providerId];
        if (!storage) return null;
        return {
          agentMentionProvider: { searchAgents: jest.fn().mockReturnValue([]) },
          agentStorage: storage,
        };
      },
      workspaceFor: async (providerId: string) => (
        refreshes[providerId] ? { agentMentions: { refresh: refreshes[providerId] } } : {}
      ),
    });

    const rows = await (tab as any).loadWorkspaceHubRows([...providerIds], 'agents');

    expect(rows).toHaveLength(3);
    expect(rows.map((row: any) => [row.ownerProviderId, row.source])).toEqual([
      ['grok', '.grok/agent/'],
      ['mimocode', '.mimocode/agent/'],
      ['kimicode', '.kimicode/agent/'],
    ]);
    for (const row of rows) await row.deleteResource();
    for (const providerId of providerIds) {
      expect(storages[providerId].delete).toHaveBeenCalledWith(expect.objectContaining({
        description: `${providerId} hidden reviewer`,
        name: 'review',
      }));
      // Once, and only for the provider whose agent was deleted.
      expect(refreshes[providerId]).toHaveBeenCalledTimes(1);
    }
  });

  it('draws a provider section when its slot answers, and drops a superseded one', async () => {
    // **The provider's settings tab is drawn a tick late now.** Obsidian's
    // declarative settings API is synchronous and a provider's workspace is
    // built on first use, so the section fills when the slot answers. The
    // hazard that introduces is a reader clicking a second provider while the
    // first is still resolving — the late draw would land in a pane they left.
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const drawn: string[] = [];
    const gates: Record<string, () => void> = {};
    (tab as any).plugin.getApplicationRuntimeOrNull = () => ({
      workspaceFor: (providerId: string) => new Promise(resolve => {
        gates[providerId] = () => resolve({
          settingsPresentation: {
            render: (host: { container: HTMLElement }) => {
              drawn.push(providerId);
              host.container.createDiv({ attr: { 'data-workspace-sections': 'commands' } });
            },
          },
        });
      }),
    });

    const container = createMockEl('div');
    (tab as any).renderWorkspaceProviderSection(container, 'opencode', 'commands');
    (tab as any).renderWorkspaceProviderSection(container, 'grok', 'commands');

    // The first provider answers *after* the reader moved on.
    gates.grok?.();
    await Promise.resolve();
    gates.opencode?.();
    await Promise.resolve();

    expect(drawn).toEqual(['grok']);
  });

  it('keeps Codex MCP guidance in the inventory without advertising it as managed', async () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    (tab as any).plugin.getApplicationRuntimeOrNull = () => ({
      workspaceServicesFor: (providerId: string) => {
        if (providerId === 'claude') {
          return {
            mcpServerManager: { getServers: jest.fn().mockReturnValue([]) },
            mcpStorage: { save: jest.fn() },
          };
        }
        return null;
      },
    });

    expect((tab as any).getWorkspaceManagerProviders(['claude', 'codex'], 'mcp'))
      .toEqual(['claude']);
    await expect((tab as any).loadWorkspaceHubRows(['claude', 'codex'], 'mcp'))
      .resolves.toEqual([expect.objectContaining({
        name: 'Codex',
        ownerProviderId: 'codex',
        readonly: true,
        source: 'codex mcp',
        status: 'native',
      })]);
  });

  it('extracts only the semantic MCP elements and leaves unrelated provider controls behind', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const staging = createMockEl('div');
    const target = createMockEl('div');
    const heading = staging.createDiv({ cls: 'setting-item setting-item-heading' });
    heading.createDiv({ cls: 'setting-item-name', text: 'MCP servers' });
    const description = staging.createDiv({ cls: 'grimoire-mcp-settings-desc', text: 'MCP description' });
    const manager = staging.createDiv({ cls: 'grimoire-mcp-container', text: 'MCP manager' });
    const unrelated = staging.createDiv({ cls: 'setting-item' });
    unrelated.createDiv({ cls: 'setting-item-name', text: 'Respect project settings' });
    const environmentHeading = staging.createDiv({ cls: 'setting-item setting-item-heading' });
    environmentHeading.createDiv({ cls: 'setting-item-name', text: 'Environment' });
    const siblings = [heading, description, manager, unrelated, environmentHeading];
    for (const [index, element] of siblings.entries()) {
      element.nextElementSibling = siblings[index + 1] ?? null;
      element.matches = (selector: string) => selector.split(',').some((part) => {
        const className = part.trim().replace(/^\./, '');
        return element.hasClass(className);
      });
    }

    expect((tab as any).extractWorkspaceProviderSection(
      staging,
      target,
      'mcp',
      'claude',
    )).toBe(true);
    expect(collectText(target)).toContain('MCP manager');
    expect(collectText(target)).not.toContain('Respect project settings');
    expect(collectText(staging)).toContain('Respect project settings');
  });

  it('omits the resource type column and renders edit/delete row actions', () => {
    const plugin = createSettingsPlugin();
    const tab = new GrimoireSettingTab(createSettingsApp(), plugin);
    const container = createMockEl('div');
    const resourceArea = createMockEl('div');

    (tab as any).renderWorkspaceHubRows(container, [{
      key: 'skill:claude:review',
      section: 'skills',
      name: 'review',
      description: 'Review code',
      source: '.claude/skills/',
      providerIds: ['claude'],
      ownerProviderId: 'claude',
      readonly: false,
      status: 'available',
      deleteResource: jest.fn().mockResolvedValue(undefined),
    }], '', providerCatalog().ids(), resourceArea);

    expect(container.children[0].children.map((cell: any) => cell.textContent)).toEqual([
      'Name',
      'Source',
      'Provider',
      'Actions',
    ]);
    const actionButtons = container.children[1].children[3].children;
    expect(actionButtons[0].hasClass('grimoire-settings-resource-edit')).toBe(true);
    expect(actionButtons[1].hasClass('grimoire-settings-resource-delete')).toBe(true);
  });

  it('merges the same shared skill path across providers without merging provider-owned skills', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const catalog = { deleteVaultEntry: jest.fn() };
    const makeEntry = (providerId: string, storagePath: string) => ({
      id: `${providerId}-review`,
      providerId,
      kind: 'skill',
      name: 'review',
      description: 'Review code',
      content: 'Review it.',
      scope: 'vault',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
      storagePath,
    });
    const sharedRows = [
      (tab as any).normalizeWorkspaceCommandEntry(
        makeEntry('opencode', '.agents/skills'),
        'opencode',
        'skills',
        false,
        catalog,
      ),
      (tab as any).normalizeWorkspaceCommandEntry(
        makeEntry('gemini', '.agents/skills'),
        'gemini',
        'skills',
        false,
        catalog,
      ),
    ];
    const providerOwned = (tab as any).normalizeWorkspaceCommandEntry(
      makeEntry('qwen', '.qwen/skills'),
      'qwen',
      'skills',
      false,
      catalog,
    );

    const merged = (tab as any).mergeWorkspaceRows(
      [...sharedRows, providerOwned],
      ['opencode', 'gemini', 'qwen'],
    );

    expect(merged).toHaveLength(2);
    expect(merged.find((row: any) => row.source === '.agents/skills')?.providerIds)
      .toEqual(['opencode', 'gemini']);
    expect(merged.find((row: any) => row.source === '.qwen/skills')?.providerIds)
      .toEqual(['qwen']);
  });

  it('renders accessible overflow controls and updates their boundary state', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const container = createMockEl('div');
    renderDeclarativeSettings(tab, container);

    const tabBar = container.querySelector('.grimoire-settings-tabs');
    const viewport = container.querySelector('.grimoire-settings-tabs-viewport');
    const previous = container.querySelector('.grimoire-settings-tab-scroll--previous');
    const next = container.querySelector('.grimoire-settings-tab-scroll--next');
    viewport.clientWidth = 100;
    viewport.scrollWidth = 300;
    viewport.scrollLeft = 0;
    viewport.dispatchEvent('scroll');

    expect(previous.getAttribute('aria-label')).toBe('Scroll settings tabs backward');
    expect(next.getAttribute('aria-label')).toBe('Scroll settings tabs forward');
    expect(tabBar.hasClass('is-overflowing')).toBe(true);
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    viewport.scrollLeft = 200;
    viewport.dispatchEvent('scroll');
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    expect(tabBar.hasClass('can-scroll-prev')).toBe(true);

    tab.hide();
    expect(viewport.getEventListenerCount('scroll')).toBe(0);
    expect(viewport.getEventListenerCount('wheel')).toBe(0);
    expect(viewport.getEventListenerCount('keydown')).toBe(0);
  });

  it('uses wheel movement only when the overflowing tab list moves', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const container = createMockEl('div');
    renderDeclarativeSettings(tab, container);

    const viewport = container.querySelector('.grimoire-settings-tabs-viewport');
    viewport.clientWidth = 100;
    viewport.scrollWidth = 300;
    viewport.scrollLeft = 0;
    const preventDefault = jest.fn();
    viewport.dispatchEvent({ type: 'wheel', deltaX: 0, deltaY: 40, preventDefault });
    expect(viewport.scrollLeft).toBe(40);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    viewport.scrollLeft = 200;
    viewport.dispatchEvent({ type: 'wheel', deltaX: 40, deltaY: 0, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('skips scrollIntoView when the compact tab bar is not overflowing', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const container = createMockEl('div');
    renderDeclarativeSettings(tab, container);

    const buttons = Array.from<any>(container.querySelectorAll('.grimoire-settings-tab'));
    const reveal = jest.fn();
    buttons[1].scrollIntoView = reveal;
    buttons[1].dispatchEvent('click');

    expect(reveal).not.toHaveBeenCalled();
  });

  it('renders each top-level tab once and reuses it on later switches', async () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const generalRender = jest.spyOn(tab as any, 'renderGeneralHub');
    const providerRender = jest.spyOn(tab as any, 'renderProvidersHub');
    const container = createMockEl('div');
    renderDeclarativeSettings(tab, container);
    const buttons = Array.from<any>(container.querySelectorAll('.grimoire-settings-tab'));

    buttons[1].dispatchEvent('click');
    // Waited for rather than slept through. A tab renders behind two nested
    // `requestAnimationFrame` calls, which the test environment polyfills as
    // two chained macrotasks — and under a full parallel suite run those do not
    // reliably land inside a fixed 50ms, so this failed about one run in four
    // with the render simply not having happened yet.
    await waitFor(() => providerRender.mock.calls.length === 1);
    buttons[0].dispatchEvent('click');
    buttons[1].dispatchEvent('click');

    expect(generalRender).toHaveBeenCalledTimes(1);
    expect(providerRender).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.grimoire-settings-tab-content')).toHaveLength(4);
  });

  it('activates, focuses, and reveals keyboard-selected tabs', () => {
    const tab = new GrimoireSettingTab(createSettingsApp(), createSettingsPlugin());
    const container = createMockEl('div');
    renderDeclarativeSettings(tab, container);

    const buttons = Array.from<any>(container.querySelectorAll('.grimoire-settings-tab'));
    const viewport = container.querySelector('.grimoire-settings-tabs-viewport');
    viewport.clientWidth = 100;
    viewport.scrollWidth = 300;
    viewport.dispatchEvent('scroll');
    const reveal = jest.fn();
    const focus = jest.fn();
    buttons[1].scrollIntoView = reveal;
    buttons[1].focus = focus;
    const preventDefault = jest.fn();
    viewport.dispatchEvent({
      key: 'ArrowRight', preventDefault, target: buttons[0], type: 'keydown',
    });

    expect(buttons[1].hasClass('grimoire-settings-tab--active')).toBe(true);
    expect(buttons[0].tabIndex).toBe(-1);
    expect(buttons[1].tabIndex).toBe(0);
    expect(focus).toHaveBeenCalled();
    expect(reveal).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });
});

/** Waits for a condition the surface reaches on its own schedule. */
async function waitFor(predicate: () => boolean, attempts = 200): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Condition was not reached.');
}
