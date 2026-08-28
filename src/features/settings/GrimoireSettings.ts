import type { App, SettingDefinitionItem } from 'obsidian';
import {
  Modal,
  Notice,
  Platform,
  PluginSettingTab,
  setIcon,
  Setting,
  ToggleComponent,
} from 'obsidian';

import { parseChangelogRelease } from '../../app/changelog/parser';
import { GRIMOIRE_CHANGELOG_URL, readBundledChangelog } from '../../app/changelog/source';
import { formatGrimoireVersion } from '../../app/version';
import { normalizeExcludedFolder } from '../../core/context/exclusions';
import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import type { ProviderCommandEntry } from '../../core/providers/commands/ProviderCommandEntry';
import { providerCatalog } from '../../core/providers/ProviderCatalog';
import type { ProviderCommandsPort } from '../../core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
  ProviderSettingsTabRendererContext,
  ProviderWorkspaceServices,
} from '../../core/providers/types';
import type {
  EnvironmentScope,
  ManagedMcpServer,
} from '../../core/types';
import {
  type ChatViewPlacement,
  MAX_TABS,
  MIN_TABS,
  normalizeMaxTabs,
} from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import type GrimoirePlugin from '../../main';
import { confirmDelete } from '../../shared/modals/ConfirmModal';
import { showWhatsNewModal } from '../../shared/modals/WhatsNewModal';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
import { renderProjectWorkspaceSettings } from './ProjectWorkspaceSettings';
import { renderAdvancedSection } from './ui/AdvancedSection';
import { renderEnvironmentSettingsSection } from './ui/EnvironmentSettingsSection';

type SettingsTabId = 'general' | 'providers' | 'workspace' | 'about';
type WorkspaceSection = 'skills' | 'agents' | 'mcp' | 'environment' | 'commands';
type AdvancedSettingsSection = 'general' | WorkspaceSection;
type WorkspaceResourceStatus = 'available' | 'connected' | 'disabled' | 'native' | 'readonly';

interface WorkspaceResourceRow {
  key: string;
  section: WorkspaceSection;
  name: string;
  description: string;
  source: string;
  providerIds: string[];
  ownerProviderId: string;
  readonly: boolean;
  status: WorkspaceResourceStatus;
  deleteResource?: () => Promise<void>;
  openResource?: () => void;
}

interface WorkspaceAgentDefinition extends Record<string, unknown> {
  name: string;
  description?: string;
}

interface WorkspaceAgentSummary {
  id: string;
  name: string;
  description?: string;
  source: 'plugin' | 'vault' | 'global' | 'builtin';
}

interface WorkspaceAgentStorage {
  loadAll?: () => Promise<WorkspaceAgentDefinition[]>;
  delete: (agent: WorkspaceAgentDefinition) => Promise<void>;
}

interface WorkspaceAgentManager {
  getAvailableAgents?: () => WorkspaceAgentDefinition[];
}

interface WorkspaceMcpStorage {
  save: (servers: ManagedMcpServer[]) => Promise<void>;
}

type WorkspaceServicesWithStorage = ProviderWorkspaceServices & {
  agentManager?: WorkspaceAgentManager;
  agentStorage?: WorkspaceAgentStorage;
  mcpStorage?: WorkspaceMcpStorage | null;
  subagentStorage?: WorkspaceAgentStorage;
};
type ObsidianHotkey = { modifiers: string[]; key: string };
type ObsidianHotkeyManager = {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
};
type ObsidianHotkeyTab = {
  searchInputEl?: HTMLInputElement;
  searchComponent?: { inputEl?: HTMLInputElement };
  updateHotkeyVisibility?: () => void;
};
type ObsidianSettingsController = {
  activeTab?: ObsidianHotkeyTab;
  open: () => void;
  openTabById: (id: string) => void;
};

const GRIMOIRE_REPOSITORY_URL = 'https://github.com/sandsaber/Grimoire';
const GRIMOIRE_RELEASES_URL = `${GRIMOIRE_REPOSITORY_URL}/releases`;
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

class SettingsTabScroller {
  private readonly buttons: HTMLButtonElement[];
  private readonly onScroll = () => this.updateState();
  private readonly onWheel = (event: WheelEvent) => this.handleWheel(event);
  private readonly onKeydown = (event: KeyboardEvent) => this.handleKeydown(event);
  private readonly onResize = () => this.updateState();
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly viewport: HTMLElement,
    private readonly previousButton: HTMLButtonElement,
    private readonly nextButton: HTMLButtonElement,
    private readonly activate: (index: number) => void,
  ) {
    this.buttons = Array.from(viewport.querySelectorAll<HTMLButtonElement>('.grimoire-settings-tab'));
    this.previousButton.addEventListener('click', () => this.scrollByPage(-1));
    this.nextButton.addEventListener('click', () => this.scrollByPage(1));
    this.viewport.addEventListener('scroll', this.onScroll);
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
    this.viewport.addEventListener('keydown', this.onKeydown);
    const ResizeObserverCtor = viewport.ownerDocument.defaultView?.ResizeObserver;
    if (typeof ResizeObserverCtor === 'function') {
      this.resizeObserver = new ResizeObserverCtor(this.onResize);
      this.resizeObserver.observe(viewport);
    }
    const view = viewport.ownerDocument.defaultView;
    if (typeof view?.addEventListener === 'function') {
      view.addEventListener('resize', this.onResize);
    }
    this.updateState();
  }

  reveal(button: HTMLButtonElement | undefined): void {
    if (!button || !this.root.hasClass('is-overflowing')) return;
    button.scrollIntoView?.({ behavior: this.motionBehavior(), block: 'nearest', inline: 'nearest' });
    this.updateState();
  }

  destroy(): void {
    this.viewport.removeEventListener('scroll', this.onScroll);
    this.viewport.removeEventListener('wheel', this.onWheel);
    this.viewport.removeEventListener('keydown', this.onKeydown);
    const view = this.viewport.ownerDocument.defaultView;
    if (typeof view?.removeEventListener === 'function') {
      view.removeEventListener('resize', this.onResize);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private handleWheel(event: WheelEvent): void {
    if (this.viewport.scrollWidth <= this.viewport.clientWidth) return;
    const delta = event.deltaX || event.deltaY;
    if (!delta) return;
    const before = this.viewport.scrollLeft;
    const maximum = Math.max(0, this.viewport.scrollWidth - this.viewport.clientWidth);
    this.viewport.scrollLeft = Math.max(0, Math.min(maximum, before + delta));
    if (this.viewport.scrollLeft !== before) {
      event.preventDefault();
      this.updateState();
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    const current = this.buttons.findIndex((button) => button === event.target);
    if (current < 0) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, current - 1);
    if (event.key === 'ArrowRight') nextIndex = Math.min(this.buttons.length - 1, current + 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = this.buttons.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    this.activate(nextIndex);
    const button = this.buttons[nextIndex];
    button?.focus?.();
  }

  private scrollByPage(direction: number): void {
    const amount = Math.max(80, this.viewport.clientWidth * 0.75) * direction;
    this.viewport.scrollBy?.({ behavior: this.motionBehavior(), left: amount });
    if (!this.viewport.scrollBy) this.viewport.scrollLeft += amount;
    this.updateState();
  }

  private updateState(): void {
    const overflowing = this.viewport.scrollWidth > this.viewport.clientWidth + 1;
    const canScrollPrevious = overflowing && this.viewport.scrollLeft > 1;
    const canScrollNext = overflowing
      && this.viewport.scrollLeft + this.viewport.clientWidth < this.viewport.scrollWidth - 1;
    this.root.toggleClass('is-overflowing', overflowing);
    this.root.toggleClass('can-scroll-prev', canScrollPrevious);
    this.root.toggleClass('can-scroll-next', canScrollNext);
    this.previousButton.disabled = !canScrollPrevious;
    this.nextButton.disabled = !canScrollNext;
  }

  private motionBehavior(): ScrollBehavior {
    return this.viewport.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
  }
}

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) {
    return;
  }

  setting.open();
  setting.openTabById('hotkeys');
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = 'Grimoire';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(', ');
}

function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = getHotkeyForCommand(app, commandId);
  const item = containerEl.createDiv({ cls: 'grimoire-hotkey-item' });
  item.createSpan({
    cls: 'grimoire-hotkey-name',
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: 'grimoire-hotkey-badge', text: hotkey });
  }
  item.addEventListener('click', () => openHotkeySettings(app));
}

function isTextAreaElement(element: Element): element is HTMLTextAreaElement {
  if (typeof element.instanceOf === 'function') {
    return element.instanceOf(HTMLTextAreaElement);
  }
  return element.tagName === 'TEXTAREA';
}

function isHtmlElement(element: Element | null): element is HTMLElement {
  if (!element) {
    return false;
  }
  if (typeof element.instanceOf === 'function') {
    return element.instanceOf(HTMLElement);
  }
  return 'classList' in element;
}

const PROVIDER_SETTING_COPY: Record<ProviderId, {
  descKey: TranslationKey;
  name: string;
  tabName: string;
}> = {
  claude: {
    descKey: 'settings.providers.claude.desc',
    name: 'Claude Code',
    tabName: 'Claude',
  },
  codex: {
    descKey: 'settings.providers.codex.desc',
    name: 'Codex',
    tabName: 'Codex',
  },
  antigravity: {
    descKey: 'settings.providers.antigravity.desc',
    name: 'Antigravity',
    tabName: 'Antigravity',
  },
  gemini: {
    descKey: 'settings.providers.gemini.desc',
    name: 'Gemini CLI (Legacy)',
    tabName: 'Gemini',
  },
  qwen: {
    descKey: 'settings.providers.qwen.desc',
    name: 'Qwen Code',
    tabName: 'Qwen',
  },
  opencode: {
    descKey: 'settings.providers.opencode.desc',
    name: 'OpenCode',
    tabName: 'OpenCode',
  },
  mimocode: {
    descKey: 'settings.providers.mimocode.desc',
    name: 'MiMoCode',
    tabName: 'MiMo',
  },
  kimicode: {
    descKey: 'settings.providers.kimicode.desc',
    name: 'Kimi Code',
    tabName: 'Kimi',
  },
  grok: {
    descKey: 'settings.providers.grok.desc',
    name: 'Grok Build',
    tabName: 'Grok',
  },
};

const GENERAL_SETTINGS_SEARCH_KEYS: TranslationKey[] = [
  'settings.version.name',
  'settings.whatsNew',
  'settings.language.name',
  'settings.display',
  'settings.chatViewPlacement.name',
  'settings.enableAutoScroll.name',
  'settings.conversations',
  'settings.autoTitle.name',
  'settings.content',
  'settings.userName.name',
  'settings.deferMathRenderingDuringStreaming.name',
  'settings.titleModel.name',
  'settings.systemPrompt.name',
  'settings.excludedTags.name',
  'settings.excludedFolders.name',
  'settings.mediaFolder.name',
  'settings.input',
  'settings.requireCommandOrControlEnterToSend.name',
  'settings.navMappings.name',
  'settings.hotkeys',
  'settings.diagnostics',
  'settings.usageIndicators.name',
  'settings.debugLogging.name',
  'settings.maxTabs.name',
];

export class GrimoireSettingTab extends PluginSettingTab {
  plugin: GrimoirePlugin;
  private activeTab: SettingsTabId = 'general';
  private activeProviderId: ProviderId | null = null;
  private activeWorkspaceProviderId: string | null = null;
  private activeWorkspaceSection: AdvancedSettingsSection = 'general';
  private tabScroller: SettingsTabScroller | null = null;
  private workspaceLoadToken: symbol | null = null;
  private settingsRootEl: HTMLElement | null = null;
  private settingsRenderCycle = 0;

  constructor(app: App, plugin: GrimoirePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  hide(): void {
    this.settingsRenderCycle += 1;
    this.settingsRootEl = null;
    this.tabScroller?.destroy();
    this.tabScroller = null;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    setLocale(this.plugin.settings.locale as Locale);
    const providerAliases = Object.values(PROVIDER_SETTING_COPY).flatMap((copy) => [
      copy.name,
      copy.tabName,
      t(copy.descKey),
    ]);
    const aliases = Array.from(new Set([
      ...GENERAL_SETTINGS_SEARCH_KEYS.map((key) => t(key)),
      ...providerAliases,
      t('settings.search.providers'),
      t('settings.search.models'),
      t('settings.search.permissions'),
      t('settings.search.environmentVariables'),
      t('settings.search.projectWorkspace'),
    ]));

    return [{
      name: t('settings.search.title'),
      desc: t('settings.search.description'),
      aliases,
      render: (setting, group) => {
        /*
         * Obsidian 1.13 wraps declarative definitions in a SettingGroup and
         * styles every descendant Setting as one grouped card. Mark only this
         * synthetic root so CSS can restore standalone cards inside the custom
         * tabbed page while the definition remains available to native search.
        */
        group.addClass('grimoire-settings-root-group');
        setting.settingEl.removeClass('setting-item');
        const settingsRoot = setting.settingEl;
        this.renderSettings(settingsRoot);
        return () => {
          this.settingsRenderCycle += 1;
          if (this.settingsRootEl === settingsRoot) {
            this.settingsRootEl = null;
          }
          this.tabScroller?.destroy();
          this.tabScroller = null;
        };
      },
    }];
  }

  private renderSettings(containerEl: HTMLElement = this.containerEl): void {
    this.settingsRootEl = containerEl;
    const renderCycle = ++this.settingsRenderCycle;
    this.tabScroller?.destroy();
    this.tabScroller = null;
    containerEl.empty();
    containerEl.addClass('grimoire-settings');

    setLocale(this.plugin.settings.locale as Locale);

    const providerIds = this.orderProviderIds(providerCatalog().ids());
    const tabIds: SettingsTabId[] = ['general', 'providers', 'workspace', 'about'];
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = 'general';
    }
    if (!this.activeProviderId || !providerIds.includes(this.activeProviderId)) {
      const configuredProvider = this.plugin.settings.settingsProvider;
      this.activeProviderId = providerIds.includes(configuredProvider)
        ? configuredProvider
        : (providerIds.find((providerId) => (
            providerCatalog().isEnabled(this.plugin.settings, providerId)
          )) ?? providerIds[0] ?? null);
    }

    const tabBar = containerEl.createDiv({ cls: 'grimoire-settings-tabs' });
    const previousTabButton = tabBar.createEl('button', {
      attr: {
        'aria-label': t('settings.tabs.scrollBackward'),
        type: 'button',
      },
      cls: 'grimoire-settings-tab-scroll grimoire-settings-tab-scroll--previous',
    });
    setIcon(previousTabButton, 'chevron-left');
    const tabViewport = tabBar.createDiv({ cls: 'grimoire-settings-tabs-viewport' });
    tabViewport.setAttribute('role', 'tablist');
    const nextTabButton = tabBar.createEl('button', {
      attr: {
        'aria-label': t('settings.tabs.scrollForward'),
        type: 'button',
      },
      cls: 'grimoire-settings-tab-scroll grimoire-settings-tab-scroll--next',
    });
    setIcon(nextTabButton, 'chevron-right');
    const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();
    const renderedTabs = new Set<SettingsTabId>();
    const pendingTabs = new Set<SettingsTabId>();

    for (const id of tabIds) {
      const content = containerEl.createDiv({
        cls: `grimoire-settings-tab-content${id === this.activeTab
          ? ' grimoire-settings-tab-content--active'
          : ''}`,
      });
      content.dataset.settingsTab = id;
      content.setAttribute('role', 'tabpanel');
      tabContents.set(id, content);
    }

    const showTabContent = (id: SettingsTabId): void => {
      for (const tabId of tabIds) {
        tabContents.get(tabId)?.toggleClass(
          'grimoire-settings-tab-content--active',
          tabId === id,
        );
      }
    };

    const renderTab = (id: SettingsTabId): void => {
      if (renderedTabs.has(id)) return;
      const content = tabContents.get(id);
      if (!content) return;
      switch (id) {
        case 'general':
          this.renderGeneralHub(content);
          break;
        case 'providers':
          this.renderProvidersHub(content, providerIds, containerEl);
          break;
        case 'workspace':
          this.renderWorkspaceHub(content, providerIds);
          break;
        case 'about':
          this.renderAboutHub(content);
          break;
      }
      this.markTextareaRows(content);
      renderedTabs.add(id);
    };

    const scheduleTabRender = (id: SettingsTabId): void => {
      if (renderedTabs.has(id) || pendingTabs.has(id)) return;
      pendingTabs.add(id);
      const view = containerEl.ownerDocument.defaultView;
      const run = (): void => {
        pendingTabs.delete(id);
        if (renderCycle !== this.settingsRenderCycle) return;
        renderTab(id);
        if (this.activeTab === id) showTabContent(id);
      };
      if (typeof view?.requestAnimationFrame === 'function') {
        view.requestAnimationFrame(() => {
          if (renderCycle !== this.settingsRenderCycle) return;
          view.requestAnimationFrame(run);
        });
        return;
      }
      window.setTimeout(run, 0);
    };

    for (const id of tabIds) {
      const button = tabViewport.createEl('button', {
        cls: `grimoire-settings-tab${id === this.activeTab ? ' grimoire-settings-tab--active' : ''}`,
        text: this.getHubText(id),
      });
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(id === this.activeTab));
      button.tabIndex = id === this.activeTab ? 0 : -1;
      button.addEventListener('click', () => {
        if (id === this.activeTab) return;
        this.activeTab = id;
        for (const tabId of tabIds) {
          tabButtons.get(tabId)?.toggleClass('grimoire-settings-tab--active', tabId === id);
          tabButtons.get(tabId)?.setAttribute('aria-selected', String(tabId === id));
          if (tabButtons.get(tabId)) {
            tabButtons.get(tabId)!.tabIndex = tabId === id ? 0 : -1;
          }
        }
        this.tabScroller?.reveal(button);
        if (renderedTabs.has(id)) {
          showTabContent(id);
        } else {
          scheduleTabRender(id);
        }
      });
      tabButtons.set(id, button);
    }

    this.tabScroller = new SettingsTabScroller(
      tabBar,
      tabViewport,
      previousTabButton,
      nextTabButton,
      (index) => tabButtons.get(tabIds[index])?.click(),
    );
    this.tabScroller.reveal(tabButtons.get(this.activeTab));
    renderTab(this.activeTab);
  }

  private getHubText(key: string): string {
    if (key === 'providerSelectionHint') {
      return t('settings.providers.selectionHint');
    }
    return t(`settings.hub.${key}` as TranslationKey);
  }

  private orderProviderIds(providerIds: readonly ProviderId[]): ProviderId[] {
    const preferredOrder = [
      'claude',
      'codex',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'antigravity',
      'gemini',
      'qwen',
      'pi',
    ];
    const positions = new Map(preferredOrder.map((providerId, index) => [providerId, index]));
    return providerIds
      .map((providerId, index) => ({ providerId, index }))
      .sort((left, right) => (
        (positions.get(left.providerId) ?? preferredOrder.length + left.index)
        - (positions.get(right.providerId) ?? preferredOrder.length + right.index)
      ))
      .map(({ providerId }) => providerId);
  }

  private renderGeneralHub(container: HTMLElement): void {
    this.renderGeneralTab(container);
    container.querySelector('.grimoire-settings-version-row')?.remove();
  }

  private getProviderDisplayName(providerId: ProviderId): string {
    if (providerId === 'gemini') {
      return this.getHubText('geminiLegacy');
    }
    return PROVIDER_SETTING_COPY[providerId]?.name
      ?? providerCatalog().displayName(providerId);
  }

  private getProviderStatusText(providerId: ProviderId): string {
    return this.getHubText(
      this.plugin.getResolvedProviderCliPath?.(providerId)
        ? 'cliDetected'
        : 'cliNotDetected',
    );
  }

  private renderProviderCards(
    container: HTMLElement,
    providerIds: ProviderId[],
    settingsRoot: HTMLElement,
  ): void {
    const grid = container.createDiv({ cls: 'grimoire-settings-provider-grid' });
    for (const providerId of providerIds) {
      const enabled = providerCatalog().isEnabled(this.plugin.settings, providerId);
      const card = grid.createDiv({
        attr: {
          'aria-pressed': String(providerId === this.activeProviderId),
          role: 'button',
          tabindex: '0',
        },
        cls: `grimoire-settings-provider-card${providerId === this.activeProviderId
          ? ' grimoire-settings-provider-card--active'
          : ''}`,
      });
      card.dataset.providerId = providerId;
      const copy = card.createDiv({ cls: 'grimoire-settings-provider-card-copy' });
      const title = copy.createDiv({ cls: 'grimoire-settings-provider-card-title' });
      title.createSpan({
        cls: 'grimoire-settings-provider-card-name',
        text: this.getProviderDisplayName(providerId),
      });
      copy.createDiv({
        cls: 'grimoire-settings-provider-card-meta',
        text: this.getProviderStatusText(providerId),
      });

      const toggleContainer = card.createDiv({ cls: 'grimoire-settings-provider-card-toggle' });
      toggleContainer.addEventListener('click', (event) => event.stopPropagation());
      toggleContainer.addEventListener('keydown', (event) => event.stopPropagation());
      new ToggleComponent(toggleContainer)
        .setValue(enabled)
        .onChange(async (value) => {
          await this.updateProviderEnabled(providerId, value);
        });

      const activate = (): void => {
        if (providerId === this.activeProviderId) return;
        this.activeProviderId = providerId;
        this.renderSettings(settingsRoot);
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    }
  }

  private renderProvidersHub(
    container: HTMLElement,
    providerIds: ProviderId[],
    settingsRoot: HTMLElement,
  ): void {
    this.renderProviderCards(container, providerIds, settingsRoot);
    container.createDiv({
      cls: 'grimoire-settings-provider-hint',
      text: this.getHubText('providerSelectionHint'),
    });
    const details = container.createDiv({ cls: 'grimoire-settings-provider-details' });
    if (!this.activeProviderId) {
      details.createDiv({ cls: 'grimoire-settings-hub-empty', text: this.getHubText('none') });
      return;
    }

    new Setting(details)
      .setName(this.getHubText('providerDetails').replace(
        '{provider}',
        this.getProviderDisplayName(this.activeProviderId),
      ))
      .setHeading();
    const renderer = ProviderWorkspaceRegistry.getSettingsTabRenderer(this.activeProviderId);
    if (!renderer) {
      details.createDiv({ cls: 'grimoire-settings-hub-empty', text: this.getHubText('none') });
      return;
    }

    renderer.render(details, this.createSettingsRendererContext(this.activeProviderId));
    this.extractProviderAdvancedOptions(details, this.activeProviderId);
  }

  private renderWorkspaceHub(container: HTMLElement, providerIds: ProviderId[]): void {
    const sections: AdvancedSettingsSection[] = [
      'general',
      'skills',
      'agents',
      'mcp',
      'environment',
      'commands',
    ];
    if (!sections.includes(this.activeWorkspaceSection)) {
      this.activeWorkspaceSection = 'general';
    }

    const navigation = container.createDiv({ cls: 'grimoire-settings-segmented-nav' });
    navigation.setAttribute('role', 'group');
    const buttons = new Map<AdvancedSettingsSection, HTMLButtonElement>();
    const resourceArea = container.createDiv({ cls: 'grimoire-settings-resource-area' });
    const activate = (section: AdvancedSettingsSection): void => {
      this.activeWorkspaceSection = section;
      for (const [buttonSection, button] of buttons) {
        const isActive = buttonSection === section;
        button.toggleClass('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      }
      void this.refreshWorkspaceHubList(resourceArea, providerIds);
    };

    for (const section of sections) {
      const button = navigation.createEl('button', {
        attr: {
          'aria-pressed': String(section === this.activeWorkspaceSection),
          type: 'button',
        },
        cls: section === this.activeWorkspaceSection ? 'is-active' : '',
        text: this.getHubText(section),
      });
      button.dataset.section = section;
      button.addEventListener('click', () => activate(section));
      buttons.set(section, button);
    }
    activate(this.activeWorkspaceSection);
  }

  private async refreshWorkspaceHubList(
    resourceArea: HTMLElement,
    providerIds: ProviderId[],
  ): Promise<void> {
    resourceArea.empty();
    const section = this.activeWorkspaceSection;
    resourceArea.toggleClass('grimoire-settings-resource-area--general', section === 'general');
    if (section === 'general') {
      this.renderGeneralAdvancedSettings(resourceArea);
      this.markTextareaRows(resourceArea);
      return;
    }
    const toolbar = resourceArea.createDiv({
      cls: 'grimoire-settings-resource-toolbar grimoire-settings-resource-toolbar--compact',
    });
    const actions = toolbar.createDiv({ cls: 'grimoire-settings-resource-toolbar-actions' });
    const search = actions.createEl('input', {
      cls: 'grimoire-settings-resource-search',
      placeholder: this.getHubText('search'),
      type: 'search',
    });
    const managerProviders = this.getWorkspaceManagerProviders(providerIds, section);
    const manageButton = actions.createEl('button', {
      attr: { type: 'button' },
      cls: 'mod-cta grimoire-settings-resource-manage',
      text: this.getHubText('manage'),
    });
    manageButton.disabled = managerProviders.length === 0;
    manageButton.addEventListener('click', () => {
      this.openWorkspaceManager(
        section,
        providerIds,
        this.activeWorkspaceProviderId ?? managerProviders[0],
        () => { void this.refreshWorkspaceHubList(resourceArea, providerIds); },
      );
    });

    const list = resourceArea.createDiv({ cls: 'grimoire-settings-resource-list' });
    list.createDiv({
      cls: 'grimoire-settings-resource-loading',
      text: this.getHubText('loading'),
    });
    const token = Symbol(section);
    this.workspaceLoadToken = token;
    try {
      const rows = await this.loadWorkspaceHubRows(providerIds, section);
      if (this.workspaceLoadToken !== token || !list.isConnected) return;
      const render = (): void => {
        this.renderWorkspaceHubRows(list, rows, search.value, providerIds, resourceArea);
      };
      search.addEventListener('input', render);
      render();
    } catch (error) {
      if (this.workspaceLoadToken !== token || !list.isConnected) return;
      list.empty();
      list.createDiv({
        cls: 'grimoire-settings-hub-empty',
        text: error instanceof Error ? error.message : this.getHubText('none'),
      });
    }
  }

  private getWorkspaceManagerProviders(
    providerIds: ProviderId[],
    section: WorkspaceSection,
  ): string[] {
    const supportedProviders = providerIds.filter((providerId) => (
      providerCatalog().workspaceCapabilities(providerId)[section]?.manager === 'managed'
    ));
    return section === 'environment'
      ? ['__shared__', ...supportedProviders]
      : supportedProviders;
  }

  private openWorkspaceGuidance(providerId: ProviderId, section: WorkspaceSection): void {
    new class extends Modal {
      constructor(app: App, private readonly settingsTab: GrimoireSettingTab) {
        super(app);
      }

      onOpen(): void {
        this.setTitle(`${this.settingsTab.getProviderDisplayName(providerId)} · ${
          this.settingsTab.getHubText('nativeCli')
        }`);
        this.modalEl.addClass('grimoire-workspace-manager-modal');
        this.settingsTab.renderWorkspaceProviderSection(this.contentEl, providerId, section);
      }

      onClose(): void {
        this.contentEl.empty();
      }
    }(this.app, this).open();
  }

  private getWorkspaceServices(providerId: ProviderId): WorkspaceServicesWithStorage | null {
    return ProviderWorkspaceRegistry.getServices(providerId);
  }

  private openWorkspaceManager(
    section: WorkspaceSection,
    providerIds: ProviderId[],
    initialProviderId: string | undefined,
    onClose?: () => void,
    focusName?: string,
  ): void {
    const supportedProviders = this.getWorkspaceManagerProviders(providerIds, section);
    if (supportedProviders.length === 0) {
      new Notice(this.getHubText('unsupported'));
      return;
    }
    const providerId = initialProviderId && supportedProviders.includes(initialProviderId)
      ? initialProviderId
      : supportedProviders[0];

    new class extends Modal {
      constructor(app: App, private readonly settingsTab: GrimoireSettingTab) {
        super(app);
      }

      onOpen(): void {
        this.setTitle(this.settingsTab.getHubText('manageTitle').replace(
          '{section}',
          this.settingsTab.getHubText(section),
        ));
        this.modalEl.addClass('grimoire-workspace-manager-modal');
        const providerNavigation = this.contentEl.createDiv({
          cls: 'grimoire-settings-segmented-nav grimoire-workspace-manager-providers',
        });
        const content = this.contentEl.createDiv({
          cls: 'grimoire-settings-workspace-modal-content',
        });
        let pendingFocusName = focusName;

        const activateProvider = (nextProviderId: string): void => {
          this.settingsTab.activeWorkspaceProviderId = nextProviderId;
          content.empty();
          for (const button of providerNavigation.querySelectorAll<HTMLButtonElement>('button')) {
            const isActive = button.dataset.providerId === nextProviderId;
            button.toggleClass('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
          }
          this.settingsTab.renderWorkspaceProviderSection(content, nextProviderId, section);
          if (pendingFocusName && nextProviderId === providerId) {
            this.settingsTab.focusWorkspaceManagerResource(content, pendingFocusName, section);
            pendingFocusName = undefined;
          }
        };

        for (const supportedProviderId of supportedProviders) {
          const button = providerNavigation.createEl('button', {
            attr: {
              'aria-pressed': String(supportedProviderId === providerId),
              type: 'button',
            },
            text: supportedProviderId === '__shared__'
              ? this.settingsTab.getHubText('shared')
              : this.settingsTab.getProviderDisplayName(supportedProviderId),
          });
          button.dataset.providerId = supportedProviderId;
          button.addEventListener('click', () => activateProvider(supportedProviderId));
        }
        activateProvider(providerId);
      }

      onClose(): void {
        this.contentEl.empty();
        onClose?.();
      }
    }(this.app, this).open();
  }

  private focusWorkspaceManagerResource(
    container: HTMLElement,
    resourceName: string,
    section: WorkspaceSection,
    attempt = 0,
  ): void {
    if (section === 'environment') {
      const textarea = container.querySelector<HTMLTextAreaElement>('.grimoire-settings-env-textarea');
      if (!textarea && attempt < 20) {
        window.setTimeout(() => {
          this.focusWorkspaceManagerResource(container, resourceName, section, attempt + 1);
        }, 100);
        return;
      }
      if (!textarea) return;

      const escapedName = resourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matcher = new RegExp(`^(?:export\\s+)?${escapedName}\\s*=`);
      let offset = 0;
      for (const line of textarea.value.split(/\r?\n/)) {
        if (matcher.test(line.trim())) {
          textarea.focus();
          textarea.setSelectionRange(offset, offset + line.length);
          return;
        }
        offset += line.length + 1;
      }
      return;
    }

    const resourceItem = Array.from(container.querySelectorAll<HTMLElement>(
      '.grimoire-sp-item, .grimoire-mcp-item',
    )).find((item) => {
      const name = item.querySelector(
        '.grimoire-sp-item-name, .grimoire-mcp-name',
      )?.textContent?.trim().replace(/^[/$]/, '');
      return name === resourceName;
    });
    if (!resourceItem && attempt < 20) {
      window.setTimeout(() => {
        this.focusWorkspaceManagerResource(container, resourceName, section, attempt + 1);
      }, 100);
      return;
    }
    if (!resourceItem) return;

    resourceItem.scrollIntoView({ block: 'center' });
    const editButton = Array.from(resourceItem.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.getAttribute('aria-label') === t('common.edit'));
    editButton?.click();
  }

  private renderWorkspaceProviderSection(
    container: HTMLElement,
    providerId: string,
    section: WorkspaceSection,
  ): void {
    if (providerId === '__shared__' && section === 'environment') {
      renderEnvironmentSettingsSection({
        container,
        plugin: this.plugin,
        scope: 'shared',
        heading: t('settings.environment'),
        name: t('settings.sharedEnvironment.name'),
        desc: t('settings.sharedEnvironment.desc'),
        placeholder: 'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
        renderCustomContextLimits: (target) => this.renderCustomContextLimits(target),
      });
      this.markTextareaRows(container);
      return;
    }

    if (providerId === '__shared__') {
      container.createDiv({
        cls: 'grimoire-settings-hub-empty',
        text: this.getHubText('unsupported'),
      });
      return;
    }
    const renderer = ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId);
    if (!renderer) {
      container.createDiv({
        cls: 'grimoire-settings-hub-empty',
        text: this.getHubText('unsupported'),
      });
      return;
    }

    const staging = container.createDiv({ cls: 'grimoire-workspace-render-staging' });
    renderer.render(staging, this.createSettingsRendererContext(providerId, true));
    let extracted = this.extractWorkspaceProviderSection(
      staging,
      container,
      section,
      providerId,
    );
    staging.remove();
    if (extracted) {
      this.markTextareaRows(container);
    } else {
      container.createDiv({
        cls: 'grimoire-settings-hub-empty',
        text: this.getHubText('unsupported'),
      });
    }
  }

  private extractWorkspaceProviderSection(
    staging: HTMLElement,
    target: HTMLElement,
    section: WorkspaceSection,
    providerId: ProviderId,
  ): boolean {
    const semanticSections = Array.from(staging.querySelectorAll<HTMLElement>(
      `[data-workspace-sections~="${section}"]`,
    ));
    if (semanticSections.length > 0) {
      for (const semanticSection of semanticSections) target.appendChild(semanticSection);
      return true;
    }

    const getTitle = (element: Element): string => (
      element.querySelector('.setting-item-name')?.textContent?.trim() ?? ''
    );
    const moveSemanticSection = (firstElement: Element): boolean => {
      const candidates: Element[] = [firstElement];
      let current = firstElement.nextElementSibling;
      while (current && !current.classList.contains('setting-item-heading')) {
        const isHiddenCommandSetting = current.classList.contains('setting-item')
          && Boolean(current.querySelector('textarea'))
          && /hidden|隐藏|ausgeblend|ocult|masqu|非表示|숨김|скры|oculto/i.test(
            getTitle(current),
          );
        const belongsToSection = section === 'environment'
          ? current.matches([
              '.grimoire-env-review-warning',
              '.grimoire-context-limits-container',
              '.grimoire-env-snippets-container',
            ].join(', ')) || Boolean(current.querySelector('.grimoire-settings-env-textarea'))
          : section === 'mcp'
            ? current.matches('.grimoire-mcp-settings-desc, .grimoire-mcp-container')
            : section === 'agents'
              ? current.matches(
                  '.grimoire-sp-settings-desc, .grimoire-agents-container, .grimoire-slash-commands-container',
                )
              : current.matches(
                  '.grimoire-sp-settings-desc, .grimoire-slash-commands-container',
                ) || isHiddenCommandSetting;
        if (belongsToSection) candidates.push(current);
        current = current.nextElementSibling;
      }
      for (const candidate of candidates) target.appendChild(candidate);
      return candidates.length > 0;
    };

    const headings = Array.from(staging.querySelectorAll<HTMLElement>('.setting-item-heading'));
    const localizedHeadings: Record<WorkspaceSection, string[]> = {
      skills: [
        t('settings.providerTabs.codex.skills.name'),
        t('settings.slashCommands.name'),
      ],
      commands: [t('settings.slashCommands.name')],
      agents: [
        t('settings.subagents.name'),
        t('settings.providerTabs.codex.subagents.name'),
      ],
      mcp: [t('settings.mcpServers.name')],
      environment: [
        t('settings.environment'),
        t('settings.providerTabs.qwen.environment.heading'),
      ],
    };
    const titleMatchers: Record<WorkspaceSection, RegExp> = {
      skills: /skill|技能/i,
      commands: /command|命令|slash/i,
      agents: /sub.?agent|子代理|代理/i,
      mcp: /mcp/i,
      environment: /environment|环境/i,
    };
    const exactTitles = localizedHeadings[section]
      .filter((title) => title && !title.startsWith('settings.'));
    let matchingHeading = headings.find((heading) => exactTitles.includes(getTitle(heading)));
    if (!matchingHeading && (
      (section !== 'skills' && section !== 'commands') || providerId === 'codex'
    )) {
      matchingHeading = headings.find((heading) => titleMatchers[section].test(getTitle(heading)));
    }

    if (section === 'environment') {
      const textarea = staging.querySelector('.grimoire-settings-env-textarea');
      if (textarea) {
        const settingItem = textarea.closest('.setting-item');
        let previous = settingItem?.previousElementSibling ?? null;
        while (previous && !previous.classList.contains('setting-item-heading')) {
          previous = previous.previousElementSibling;
        }
        matchingHeading = (previous ?? settingItem ?? undefined) as HTMLElement | undefined;
      }
    }
    if (matchingHeading) return moveSemanticSection(matchingHeading);

    if (section === 'skills' || section === 'commands') {
      const hiddenCommandsSetting = Array.from(staging.querySelectorAll<HTMLElement>(
        '.setting-item:not(.setting-item-heading)',
      )).find((settingItem) => (
        /hidden|隐藏|ausgeblend|ocult|masqu|非表示|숨김|скры|oculto/i.test(
          getTitle(settingItem),
        ) && Boolean(settingItem.querySelector('textarea'))
      ));
      if (hiddenCommandsSetting) {
        const previous = hiddenCommandsSetting.previousElementSibling;
        if (previous?.classList.contains('grimoire-sp-settings-desc')
          || previous?.classList.contains('grimoire-mcp-settings-desc')) {
          target.appendChild(previous);
        }
        target.appendChild(hiddenCommandsSetting);
        return true;
      }
    }
    return false;
  }

  private extractProviderAdvancedOptions(
    details: HTMLElement,
    providerId: ProviderId,
  ): void {
    const optionGroups: HTMLElement[][] = [];
    for (const advancedSection of Array.from(
      details.querySelectorAll<HTMLElement>('.grimoire-adv'),
    )) {
      const body = advancedSection.querySelector<HTMLElement>('.grimoire-adv-body');
      if (!body) {
        advancedSection.remove();
        continue;
      }
      const discarded = details.createDiv();
      discarded.detach();
      for (const section of ['skills', 'commands', 'agents', 'mcp', 'environment'] as const) {
        this.extractWorkspaceProviderSection(body, discarded, section, providerId);
      }
      const extras = Array.from(body.children) as HTMLElement[];
      if (extras.length > 0) optionGroups.push(extras);
      advancedSection.remove();
    }
    if (optionGroups.length === 0) return;

    new Setting(details).setName(this.getHubText('providerOptions')).setHeading();
    for (const extras of optionGroups) {
      for (const extra of extras) details.appendChild(extra);
    }
  }

  private createSettingsRendererContext(
    providerId: ProviderId = this.activeProviderId ?? this.plugin.settings.settingsProvider,
    suppressAutomaticDiscovery = false,
  ): ProviderSettingsTabRendererContext {
    return {
      plugin: this.plugin,
      suppressAutomaticDiscovery,
      createWorkspaceSection: (target, sections) => target.createDiv({
        attr: { 'data-workspace-sections': sections.join(' ') },
        cls: 'grimoire-workspace-provider-section',
      }),
      renderHiddenProviderCommandSetting: (target, targetProviderId, copy) => {
        this.renderHiddenProviderCommandSetting(target, targetProviderId, copy);
      },
      refreshModelSelectors: () => this.refreshModelSelectors(),
      renderCustomContextLimits: (target, targetProviderId) => {
        this.renderCustomContextLimits(target, targetProviderId);
      },
      renderAdvancedSection: (target, options) => (
        this.renderAdvancedSection(target, providerId, options)
      ),
    };
  }

  private async loadWorkspaceHubRows(
    providerIds: ProviderId[],
    section: WorkspaceSection,
  ): Promise<WorkspaceResourceRow[]> {
    const rows: WorkspaceResourceRow[] = [];
    if (section === 'skills' || section === 'commands') {
      for (const providerId of providerIds) {
        const capability = providerCatalog().workspaceCapabilities(providerId)[section];
        if (!capability || capability.inventory === 'none') continue;
        const catalog = (
          await this.plugin.getApplicationRuntimeOrNull()?.workspaceFor(providerId)
        )?.commands;
        if (!catalog) continue;
        try {
          const vaultEntries = await catalog.listVaultEntries();
          for (const entry of vaultEntries) {
            if (entry.kind !== (section === 'skills' ? 'skill' : 'command')) continue;
            rows.push(this.normalizeWorkspaceCommandEntry(
              entry,
              providerId,
              section,
              false,
              catalog,
            ));
          }
          if (section === 'commands' && providerId !== 'claude' && providerId !== 'codex') {
            const discovery = capability.runtimeCommandDiscovery ?? 'none';
            const loader = ProviderWorkspaceRegistry.getRuntimeCommandLoader(providerId);
            if (discovery === 'ephemeral'
              && loader?.isAvailable(this.plugin.settings)) {
              const commands = await loader.loadCommands({
                allowSessionCreation: true,
                conversation: null,
                externalContextPaths: [],
                runtime: null,
              });
              catalog.setRuntimeCommands(commands);
            }
            const runtimeEntries = await catalog.listDropdownEntries({ includeBuiltIns: false });
            for (const entry of runtimeEntries) {
              if (entry.kind !== 'command') continue;
              rows.push(this.normalizeWorkspaceCommandEntry(
                entry,
                providerId,
                section,
                true,
                catalog,
              ));
            }
            if (runtimeEntries.length === 0 && discovery === 'active-session-only') {
              const providerName = this.getProviderDisplayName(providerId);
              rows.push({
                key: `command-status:${providerId}`,
                section: 'commands',
                name: providerName,
                description: t('settings.hub.runtimeCommandsPending', { provider: providerName }),
                source: `${providerName} runtime`,
                providerIds: [providerId],
                ownerProviderId: providerId,
                readonly: true,
                status: 'readonly',
              });
            }
          }
        } catch {
          // A provider that cannot enumerate its local catalog should not hide other providers.
        }
      }
    } else if (section === 'agents') {
      for (const providerId of providerIds) {
        const services = this.getWorkspaceServices(providerId);
        const mentionProvider = services?.agentMentionProvider;
        const storage = services?.agentStorage ?? services?.subagentStorage;
        if (!mentionProvider && !storage) continue;
        try {
          const summaries = (mentionProvider?.searchAgents('') ?? []) as WorkspaceAgentSummary[];
          const storedDefinitions = storage?.loadAll
            ? await storage.loadAll()
            : (services?.agentManager?.getAvailableAgents?.() ?? []);
          const definitionsByName = new Map(
            storedDefinitions.map((definition) => [definition.name.toLowerCase(), definition]),
          );
          for (const definition of storedDefinitions) {
            const identity = typeof definition.persistenceKey === 'string'
              ? definition.persistenceKey
              : typeof definition.filePath === 'string'
                ? definition.filePath
                : typeof definition.id === 'string'
                  ? definition.id
                  : definition.name;
            rows.push(this.normalizeWorkspaceAgentEntry(
              {
                id: identity,
                name: definition.name,
                description: definition.description,
                source: 'vault',
              },
              providerId,
              storage,
              definition,
            ));
          }
          for (const summary of summaries) {
            if (summary.source === 'vault'
              && definitionsByName.has(summary.name.toLowerCase())) continue;
            rows.push(this.normalizeWorkspaceAgentEntry(
              summary,
              providerId,
              storage,
              definitionsByName.get(summary.name.toLowerCase()),
            ));
          }
        } catch {
          // Keep the unified list available even if one provider has malformed agent files.
        }
      }
    } else if (section === 'mcp') {
      for (const providerId of providerIds) {
        const capability = providerCatalog().workspaceCapabilities(providerId).mcp;
        const services = this.getWorkspaceServices(providerId);
        const manager = services?.mcpServerManager;
        if (manager && capability?.inventory === 'managed') {
          try {
            for (const server of manager.getServers()) {
              const storage = services.mcpStorage;
              rows.push({
                key: `mcp:${providerId}:${server.name}`,
                section: 'mcp',
                name: server.name,
                description: this.describeWorkspaceMcp(server),
                source: providerId === 'claude'
                  ? '.claude/mcp.json'
                  : `.grimoire/mcp/${providerId}.json`,
                providerIds: [providerId],
                ownerProviderId: providerId,
                readonly: !storage,
                status: storage
                  ? (server.enabled ? 'connected' : 'disabled')
                  : 'readonly',
                ...(storage
                  ? {
                      deleteResource: async (): Promise<void> => {
                        const nextServers = manager.getServers()
                          .filter((candidate) => candidate.name !== server.name);
                        await storage.save(nextServers);
                        await manager.loadServers();
                        for (const view of this.plugin.getAllViews()) {
                          await view.getTabManager()?.broadcastToAllTabs(
                            async (runtime) => {
                              if (runtime.providerId === providerId) {
                                await runtime.reloadMcpServers();
                              }
                            },
                          );
                        }
                      },
                    }
                  : {}),
              });
            }
          } catch {
            // Ignore a provider whose MCP config cannot currently be read.
          }
        } else if (capability?.manager === 'guidance') {
          rows.push({
            key: `mcp-guidance:${providerId}`,
            section: 'mcp',
            name: this.getProviderDisplayName(providerId),
            description: this.getHubText('nativeMcpDescription'),
            source: providerId === 'codex' ? 'codex mcp' : this.getHubText('nativeCli'),
            providerIds: [providerId],
            ownerProviderId: providerId,
            readonly: true,
            status: 'native',
            openResource: () => this.openWorkspaceGuidance(providerId, 'mcp'),
          });
        }
      }
    } else if (section === 'environment') {
      const scopes: Array<{ id: string; scope: EnvironmentScope }> = [
        { id: '__shared__', scope: 'shared' },
        ...providerIds.map((providerId) => ({
          id: providerId,
          scope: `provider:${providerId}` as EnvironmentScope,
        })),
      ];
      for (const { id, scope } of scopes) {
        try {
          const variables = parseEnvironmentVariables(
            this.plugin.getEnvironmentVariablesForScope(scope),
          );
          for (const name of Object.keys(variables).sort()) {
            rows.push({
              key: `env:${id}:${name}`,
              section: 'environment',
              name,
              description: id === '__shared__'
                ? this.getHubText('shared')
                : this.getProviderDisplayName(id),
              source: id === '__shared__'
                ? 'Grimoire shared environment'
                : `Grimoire · provider:${id}`,
              providerIds: [id],
              ownerProviderId: id,
              readonly: false,
              status: 'available',
              deleteResource: () => this.removeWorkspaceEnvironmentKey(scope, name),
            });
          }
        } catch {
          // Ignore a malformed scope while preserving the remaining environment rows.
        }
      }
    }
    return this.mergeWorkspaceRows(rows, providerIds);
  }

  private normalizeWorkspaceCommandEntry(
    entry: ProviderCommandEntry,
    providerId: ProviderId,
    section: Extract<WorkspaceSection, 'skills' | 'commands'>,
    forceReadonly: boolean,
    catalog: ProviderCommandsPort,
  ): WorkspaceResourceRow {
    const readonly = forceReadonly
      || !entry.isEditable
      || entry.scope !== 'vault';
    const source = section === 'skills'
      ? (entry.storagePath
          ?? (providerId === 'claude'
          ? '.claude/skills/'
          : providerId === 'codex'
            ? '.codex/skills/'
            : '.agents/skills/'))
      : (entry.storagePath
        ?? (providerId === 'claude'
          ? '.claude/commands/'
          : `${this.getProviderDisplayName(providerId)} runtime`));
    const key = section === 'skills'
      ? `skill:${source.replace(/\/+$/, '').toLowerCase()}:${entry.name.toLowerCase()}`
      : `${section}:${providerId}:${entry.id}`;
    return {
      key,
      section,
      name: entry.name,
      description: entry.description ?? '',
      source,
      providerIds: [providerId],
      ownerProviderId: providerId,
      readonly,
      status: readonly ? 'readonly' : 'available',
      ...(!readonly && entry.isDeletable
        ? { deleteResource: () => catalog.deleteVaultEntry(entry) }
        : {}),
    };
  }

  private normalizeWorkspaceAgentEntry(
    summary: WorkspaceAgentSummary,
    providerId: ProviderId,
    storage: WorkspaceAgentStorage | undefined,
    definition: WorkspaceAgentDefinition | undefined,
  ): WorkspaceResourceRow {
    const readonly = summary.source !== 'vault' || !storage || !definition;
    const source = providerId === 'claude'
      ? '.claude/agents/'
      : providerId === 'codex'
        ? '.codex/agents/'
        : providerId === 'opencode'
          ? '.opencode/agent/'
          : providerId === 'grok'
            ? '.grok/agent/'
            : providerId === 'mimocode'
              ? '.mimocode/agent/'
              : providerId === 'kimicode'
                ? '.kimicode/agent/'
                : providerId === 'qwen'
                  ? '.qwen/agents/'
                  : providerId === 'gemini'
                    ? '.gemini/agents/'
                    : `${this.getProviderDisplayName(providerId)} agents`;
    return {
      key: `agent:${providerId}:${summary.id}`,
      section: 'agents',
      name: summary.name,
      description: summary.description ?? '',
      source,
      providerIds: [providerId],
      ownerProviderId: providerId,
      readonly,
      status: readonly ? 'readonly' : 'available',
      ...(!readonly && storage && definition
        ? {
            deleteResource: async (): Promise<void> => {
              await storage.delete(definition);
              // `workspaceFor`, not `builtWorkspaceFor`: the registry this
              // replaces was populated for every provider at load, so its
              // accessor was never empty in a running plugin. Asking only for
              // an already-built workspace would have skipped the refresh for
              // any provider whose composition had not been used yet.
              await this.plugin.getApplicationRuntimeOrNull()
                ?.workspaceFor(providerId)
                .then(workspace => workspace.agentMentions?.refresh());
            },
          }
        : {}),
    };
  }

  private describeWorkspaceMcp(server: ManagedMcpServer): string {
    if ('command' in server.config) {
      return [server.config.command, ...(server.config.args ?? [])].join(' ');
    }
    return server.config.url;
  }

  private async removeWorkspaceEnvironmentKey(
    scope: EnvironmentScope,
    name: string,
  ): Promise<void> {
    const current = this.plugin.getEnvironmentVariablesForScope(scope);
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`^(?:export\\s+)?${escapedName}\\s*=`);
    const next = current
      .split(/\r?\n/)
      .filter((line) => !matcher.test(line.trim()))
      .join('\n');
    await this.plugin.applyEnvironmentVariables(scope, next);
  }

  private mergeWorkspaceRows(
    rows: WorkspaceResourceRow[],
    providerOrder: ProviderId[],
  ): WorkspaceResourceRow[] {
    const merged = new Map<string, WorkspaceResourceRow>();
    const positions = new Map(providerOrder.map((providerId, index) => [providerId, index]));
    for (const row of rows) {
      const key = row.key;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...row, providerIds: [...row.providerIds] });
        continue;
      }
      for (const providerId of row.providerIds) {
        if (!existing.providerIds.includes(providerId)) existing.providerIds.push(providerId);
      }
      if (!existing.description && row.description) existing.description = row.description;
      existing.readonly = existing.readonly && row.readonly;
      existing.status = existing.readonly
        ? 'readonly'
        : (existing.status === 'connected' || row.status === 'connected'
            ? 'connected'
            : existing.status);
    }
    return Array.from(merged.values())
      .map((row) => ({
        ...row,
        providerIds: row.providerIds.sort((left, right) => (
          (positions.get(left) ?? providerOrder.length)
          - (positions.get(right) ?? providerOrder.length)
        )),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private openWorkspaceResourceEditor(
    row: WorkspaceResourceRow,
    providerIds: ProviderId[],
    onClose: () => void,
  ): void {
    this.openWorkspaceManager(
      row.section,
      providerIds,
      row.ownerProviderId,
      onClose,
      row.name,
    );
  }

  private async deleteWorkspaceResource(
    row: WorkspaceResourceRow,
    onDeleted: () => void,
  ): Promise<void> {
    if (!row.deleteResource) return;
    const confirmed = await confirmDelete(
      this.app,
      this.getHubText('deleteConfirm').replace('{name}', row.name),
    );
    if (!confirmed) return;
    try {
      await row.deleteResource();
      new Notice(this.getHubText('deleted').replace('{name}', row.name));
      onDeleted();
    } catch (error) {
      new Notice(this.getHubText('deleteFailed').replace(
        '{message}',
        error instanceof Error ? error.message : String(error),
      ));
    }
  }

  private renderWorkspaceHubRows(
    container: HTMLElement,
    rows: WorkspaceResourceRow[],
    query: string,
    providerIds: ProviderId[],
    resourceArea: HTMLElement,
  ): void {
    container.empty();
    const normalizedQuery = query.trim().toLowerCase();
    const visibleRows = rows.filter((row) => {
      const providerText = row.providerIds.map((providerId) => (
        providerId === '__shared__'
          ? this.getHubText('shared')
          : this.getProviderDisplayName(providerId)
      )).join(' ');
      return !normalizedQuery
        || `${row.name} ${row.description} ${row.source} ${providerText}`
          .toLowerCase()
          .includes(normalizedQuery);
    });
    if (visibleRows.length === 0) {
      container.createDiv({ cls: 'grimoire-settings-hub-empty', text: this.getHubText('none') });
      return;
    }

    const header = container.createDiv({ cls: 'grimoire-settings-resource-row is-header' });
    for (const key of ['name', 'source', 'provider', 'actions']) {
      header.createSpan({ text: this.getHubText(key) });
    }

    const refresh = (): void => {
      void this.refreshWorkspaceHubList(resourceArea, providerIds);
    };
    for (const row of visibleRows) {
      const rowElement = container.createDiv({ cls: 'grimoire-settings-resource-row' });
      const name = rowElement.createDiv({ cls: 'grimoire-settings-resource-name' });
      name.createSpan({
        attr: { title: this.getHubText(row.status) },
        cls: `grimoire-settings-resource-dot is-${row.status}`,
      });
      const nameCopy = name.createDiv({ cls: 'grimoire-settings-resource-name-copy' });
      nameCopy.createSpan({
        attr: { title: row.name },
        cls: 'grimoire-settings-resource-name-title',
        text: row.name,
      });
      if (row.description) {
        nameCopy.createSpan({
          attr: { title: row.description },
          cls: 'grimoire-settings-resource-description',
          text: row.description,
        });
      }
      rowElement.createSpan({
        attr: { title: row.source },
        cls: 'grimoire-settings-resource-source',
        text: row.source,
      });
      rowElement.createSpan({
        cls: 'grimoire-settings-resource-provider',
        text: row.providerIds.map((providerId) => (
          providerId === '__shared__'
            ? this.getHubText('shared')
            : this.getProviderDisplayName(providerId)
        )).join(', '),
      });
      const actions = rowElement.createDiv({ cls: 'grimoire-settings-resource-actions' });
      if (row.openResource) {
        const openButton = actions.createEl('button', {
          attr: {
            'aria-label': this.getHubText('nativeCli'),
            title: this.getHubText('nativeCli'),
            type: 'button',
          },
          cls: 'grimoire-settings-resource-edit',
        });
        setIcon(openButton, 'terminal');
        openButton.addEventListener('click', row.openResource);
      }
      if (row.readonly) {
        actions.createSpan({
          cls: 'grimoire-settings-resource-readonly',
          text: this.getHubText('readonly'),
        });
        continue;
      }

      const editButton = actions.createEl('button', {
        attr: {
          'aria-label': this.getHubText('edit'),
          title: this.getHubText('edit'),
          type: 'button',
        },
        cls: 'grimoire-settings-resource-edit',
      });
      setIcon(editButton, 'pencil');
      editButton.addEventListener('click', () => {
        this.openWorkspaceResourceEditor(row, providerIds, refresh);
      });

      const deleteButton = actions.createEl('button', {
        attr: {
          'aria-label': this.getHubText('delete'),
          title: this.getHubText('delete'),
          type: 'button',
        },
        cls: 'grimoire-settings-resource-delete',
      });
      setIcon(deleteButton, 'trash-2');
      deleteButton.disabled = !row.deleteResource;
      deleteButton.addEventListener('click', () => {
        void this.deleteWorkspaceResource(row, refresh);
      });
    }
  }

  private renderAboutHub(container: HTMLElement): void {
    const about = container.createDiv({ cls: 'grimoire-settings-about' });
    about.createDiv({
      cls: 'grimoire-settings-about-copy',
      text: this.getHubText('aboutCopy'),
    });
    const projectLinks = new Setting(about).setName('GitHub');
    projectLinks.descEl.createEl('a', {
      attr: { href: GRIMOIRE_REPOSITORY_URL },
      text: 'GitHub.com/sandsaber/Grimoire',
    });
    projectLinks.descEl.appendText(' · ');
    projectLinks.descEl.createEl('a', {
      attr: { href: GRIMOIRE_RELEASES_URL },
      text: this.getHubText('releases'),
    });
    projectLinks.settingEl.addClass('grimoire-settings-about-links');
    new Setting(about)
      .setName(t('settings.version.name'))
      .setDesc(formatGrimoireVersion(this.plugin.manifest))
      .addButton((button) => {
        button
          .setButtonText(t('settings.whatsNew'))
          .onClick(() => { void this.openCurrentChangelog(); });
        button.buttonEl.addClass('grimoire-settings-whats-new');
      })
      .settingEl.addClass('grimoire-settings-version-row');
  }

  private async openCurrentChangelog(): Promise<void> {
    const version = this.plugin.manifest.version?.trim() ?? '';
    const normalizedVersion = version.replace(/-.*$/, '');
    const markdown = await readBundledChangelog(this.app.vault.adapter, this.plugin.manifest);
    const release = markdown ? parseChangelogRelease(markdown, normalizedVersion) : null;
    if (!release) {
      new Notice(t('settings.noReleaseNotes'));
      return;
    }

    await showWhatsNewModal({
      app: this.app,
      fullChangelogUrl: GRIMOIRE_CHANGELOG_URL,
      release,
    });
  }

  private markTextareaRows(containerEl: HTMLElement): void {
    for (const element of containerEl.querySelectorAll('textarea')) {
      if (!isTextAreaElement(element)) {
        continue;
      }

      const settingItem = element.closest('.setting-item');
      if (isHtmlElement(settingItem)) {
        if (typeof settingItem.addClass === 'function') {
          settingItem.addClass('grimoire-settings-textarea-row');
        } else {
          settingItem.classList.add('grimoire-settings-textarea-row');
        }
      }
    }
  }

  private isAdvancedSectionOpen(id: string): boolean {
    return this.plugin.settings.advancedSectionsOpen?.[id] ?? false;
  }

  private async setAdvancedSectionOpen(id: string, open: boolean): Promise<void> {
    this.plugin.settings.advancedSectionsOpen = {
      ...(this.plugin.settings.advancedSectionsOpen ?? {}),
      [id]: open,
    };
    await this.plugin.saveSettings();
  }

  private renderAdvancedSection(
    container: HTMLElement,
    id: string,
    opts: { count: number; summary: string },
  ): HTMLElement {
    return renderAdvancedSection(container, {
      ...opts,
      id,
      isOpen: (sectionId) => this.isAdvancedSectionOpen(sectionId),
      setOpen: (sectionId, open) => this.setAdvancedSectionOpen(sectionId, open),
    });
  }

  private renderGeneralTab(container: HTMLElement): void {
    const versionSetting = new Setting(container)
      .setName(t('settings.version.name'))
      .setDesc(formatGrimoireVersion(this.plugin.manifest))
      .addButton((button) => {
        button
          .setButtonText(t('settings.whatsNew'))
          .onClick(() => {
            void this.openCurrentChangelog();
          });
        button.buttonEl.addClass('grimoire-settings-whats-new');
      });
    versionSetting.settingEl.addClass('grimoire-settings-version-row');

    new Setting(container)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dropdown) => {
        dropdown.selectEl.addClass('grimoire-settings-language-select');
        const locales = getAvailableLocales();
        for (const locale of locales) {
          dropdown.addOption(locale, getLocaleDisplayName(locale));
        }
        dropdown
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            const locale = value as Locale;
            if (!setLocale(locale)) {
              dropdown.setValue(this.plugin.settings.locale);
              return;
            }
            this.plugin.settings.locale = locale;
            await this.plugin.saveSettings();
            this.plugin.refreshShellTranslations();
            if (this.settingsRootEl) {
              this.renderSettings(this.settingsRootEl);
            } else {
              this.update();
            }
          });
      });

    // --- Display ---

    new Setting(container).setName(t('settings.display')).setHeading();

    new Setting(container)
      .setName(t('settings.chatViewPlacement.name'))
      .setDesc(t('settings.chatViewPlacement.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('right-sidebar', t('settings.chatViewPlacement.rightSidebar'))
          .addOption('left-sidebar', t('settings.chatViewPlacement.leftSidebar'))
          .addOption('main-tab', t('settings.chatViewPlacement.mainTab'))
          .setValue(this.plugin.settings.chatViewPlacement)
          .onChange(async (value) => {
            this.plugin.settings.chatViewPlacement = value as ChatViewPlacement;
            await this.plugin.saveSettings();
          });
      });

    this.renderMaxTabsSetting(container);

    new Setting(container)
      .setName(t('settings.enableAutoScroll.name'))
      .setDesc(t('settings.enableAutoScroll.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Conversations ---

    new Setting(container).setName(t('settings.conversations')).setHeading();

    new Setting(container)
      .setName(t('settings.autoTitle.name'))
      .setDesc(t('settings.autoTitle.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.update();
          })
      );

    // --- Content ---

    new Setting(container).setName(t('settings.content')).setHeading();

    new Setting(container)
      .setName(t('settings.userName.name'))
      .setDesc(t('settings.userName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.userName.name'))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });
  }

  private renderGeneralAdvancedSettings(advancedContainer: HTMLElement): void {
    // --- Display (advanced) ---

    new Setting(advancedContainer).setName(t('settings.display')).setHeading();

    new Setting(advancedContainer)
      .setName(t('settings.deferMathRenderingDuringStreaming.name'))
      .setDesc(t('settings.deferMathRenderingDuringStreaming.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deferMathRenderingDuringStreaming ?? true)
          .onChange(async (value) => {
            this.plugin.settings.deferMathRenderingDuringStreaming = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Conversations (advanced) ---

    new Setting(advancedContainer).setName(t('settings.conversations')).setHeading();

    if (this.plugin.settings.enableAutoTitleGeneration) {
      new Setting(advancedContainer)
        .setName(t('settings.titleModel.name'))
        .setDesc(t('settings.titleModel.desc'))
        .addDropdown((dropdown) => {
          dropdown.addOption('', t('settings.titleModel.auto'));

          const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
          const seenValues = new Set<string>();
          for (const providerId of providerCatalog().ids()) {
            const chatUi = providerCatalog().declarations(providerId).chatUI;
            for (const model of chatUi.models.options(settingsBag)) {
              if (!seenValues.has(model.value)) {
                seenValues.add(model.value);
                dropdown.addOption(model.value, model.label);
              }
            }
          }

          dropdown
            .setValue(this.plugin.settings.titleGenerationModel || '')
            .onChange(async (value) => {
              this.plugin.settings.titleGenerationModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // --- Content (advanced) ---

    new Setting(advancedContainer).setName(t('settings.content')).setHeading();

    new Setting(advancedContainer)
      .setName(t('settings.systemPrompt.name'))
      .setDesc(t('settings.systemPrompt.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.systemPrompt.name'))
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(advancedContainer)
      .setName(t('settings.excludedTags.name'))
      .setDesc(t('settings.excludedTags.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('System\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ''))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(advancedContainer)
      .setName(t('settings.excludedFolders.name'))
      .setDesc(t('settings.excludedFolders.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('Private\narchive\nprojects/secret')
          .setValue(this.plugin.settings.excludedFolders.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value
              .split(/\r?\n/u)
              .map(normalizeExcludedFolder)
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(advancedContainer)
      .setName(t('settings.mediaFolder.name'))
      .setDesc(t('settings.mediaFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.mediaFolder.placeholder'))
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.mediaFolder = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('grimoire-settings-media-input');
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    renderProjectWorkspaceSettings(advancedContainer, { plugin: this.plugin });

    // --- Input (advanced) ---

    new Setting(advancedContainer).setName(t('settings.input')).setHeading();

    new Setting(advancedContainer)
      .setName(t('settings.requireCommandOrControlEnterToSend.name'))
      .setDesc(t('settings.requireCommandOrControlEnterToSend.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.requireCommandOrControlEnterToSend ?? false)
          .onChange(async (value) => {
            this.plugin.settings.requireCommandOrControlEnterToSend = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(advancedContainer)
      .setName(t('settings.navMappings.name'))
      .setDesc(t('settings.navMappings.desc'))
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`${t('common.error')}: ${result.error}`);
              pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
              text.setValue(pendingValue);
            }
            return;
          }

          this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
          this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
          this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
          await this.plugin.saveSettings();
          pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
          text.setValue(pendingValue);
        };

        const scheduleSave = (): void => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
          }
          saveTimeout = window.setTimeout(() => {
            void commitValue(false);
          }, 500);
        };

        text
          .setPlaceholder('Map w scrollup\nmap s scrolldown\nmap i focusinput')
          .setValue(pendingValue)
          .onChange((value) => {
            pendingValue = value;
            scheduleSave();
          });

        text.inputEl.rows = 3;
        text.inputEl.addEventListener('blur', () => {
          void commitValue(true);
        });
      });

    // --- Hotkeys (advanced) ---

    new Setting(advancedContainer).setName(t('settings.hotkeys')).setHeading();

    const hotkeyGrid = advancedContainer.createDiv({ cls: 'grimoire-hotkey-grid' });
    addHotkeySettingRow(hotkeyGrid, this.app, 'grimoire:inline-edit', 'settings.inlineEditHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'grimoire:open-view', 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'grimoire:new-session', 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'grimoire:new-tab', 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'grimoire:close-current-tab', 'settings.closeTabHotkey');

    // --- Diagnostics (advanced) ---

    new Setting(advancedContainer).setName(t('settings.diagnostics')).setHeading();

    new Setting(advancedContainer)
      .setName(t('settings.usageIndicators.name'))
      .setDesc(t('settings.usageIndicators.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.usageIndicatorsEnabled !== false)
          .onChange(async (value) => {
            this.plugin.settings.usageIndicatorsEnabled = value;
            await this.plugin.saveSettings();
            for (const view of this.plugin.getAllViews?.() ?? []) {
              view.refreshModelSelector?.();
            }
          });
      });

    new Setting(advancedContainer)
      .setName(t('settings.debugLogging.name'))
      .setDesc(t('settings.debugLogging.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.debugLoggingEnabled ?? false)
          .onChange(async (value) => {
            this.plugin.settings.debugLoggingEnabled = value;
            await this.plugin.saveSettings();
          });
      });

  }

  private refreshModelSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  private async updateProviderEnabled(providerId: ProviderId, enabled: boolean): Promise<void> {
    ProviderSettingsCoordinator.persistProjectedProviderState(this.plugin.settings);
    this.setProviderEnabled(providerId, enabled);

    if (ProviderSettingsCoordinator.normalizeProviderSelection(this.plugin.settings)) {
      ProviderSettingsCoordinator.projectActiveProviderState(this.plugin.settings);
    }
    if (enabled) {
      try {
        await this.refreshProviderModelCatalog(providerId);
      } catch {
        this.setProviderEnabled(providerId, false);
        if (ProviderSettingsCoordinator.normalizeProviderSelection(this.plugin.settings)) {
          ProviderSettingsCoordinator.projectActiveProviderState(this.plugin.settings);
        }
        await this.plugin.saveSettings();
        this.refreshModelSelectors();
        this.update();
        new Notice(t('settings.provider.loadModelsFailed'));
        return;
      }
    }
    await this.plugin.saveSettings();
    this.refreshModelSelectors();
    this.update();
  }

  private setProviderEnabled(providerId: ProviderId, enabled: boolean): void {
    providerCatalog().setEnabled(this.plugin.settings, providerId, enabled);
  }

  private async refreshProviderModelCatalog(providerId: ProviderId): Promise<void> {
    // No enablement gate, and the row's `isAvailable` was not one either on this
    // path: the only caller is `updateProviderEnabled`, which reaches here only
    // with `enabled === true` and only after `setProviderEnabled` has written
    // it — so the condition cannot be false. `ProviderSettingsCoordinator`
    // normalizes the *selection* between them, never enablement. A guard that
    // cannot fail is a guard nobody can test, which is how one survives long
    // enough to be mistaken for a rule.
    const workspace = await this.plugin.getApplicationRuntimeOrNull()?.workspaceFor(providerId);
    await workspace?.models?.refresh();
  }

  private renderMaxTabsSetting(container: HTMLElement): void {
    const maxTabsSetting = new Setting(container)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));

    maxTabsSetting.addSlider((slider) => {
      const initialValue = normalizeMaxTabs(this.plugin.settings.maxTabs);
      const valueEl = maxTabsSetting.controlEl.createSpan({
        cls: 'grimoire-slider-value',
        text: String(initialValue),
      });

      slider
        .setLimits(MIN_TABS, MAX_TABS, 1)
        .setValue(initialValue)
        .onChange(async (value) => {
          const normalizedValue = normalizeMaxTabs(value);
          valueEl.setText(String(normalizedValue));
          this.plugin.settings.maxTabs = normalizedValue;
          this.plugin.settings.tabBarPosition = 'header';
          await this.plugin.saveSettings();
          for (const view of this.plugin.getAllViews()) {
            view.refreshTabControls();
            view.updateLayoutForPosition();
          }
        });
    });
  }

  private renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenProviderCommands(this.plugin.settings, providerId).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.hiddenProviderCommands = {
              ...this.plugin.settings.hiddenProviderCommands,
              [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
            };
            await this.plugin.saveSettings();
            this.plugin.getView()?.updateHiddenProviderCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const providerIds = providerId
      ? [providerId]
      : providerCatalog().ids();

    for (const targetProviderId of providerIds) {
      const envVars = parseEnvironmentVariables(
        this.plugin.getActiveEnvironmentVariables(targetProviderId),
      );
      const targetModels = providerCatalog().declarations(targetProviderId).chatUI.models;
      for (const modelId of targetModels.customModelIds(envVars)) {
        uniqueModelIds.add(modelId);
      }
    }

    if (uniqueModelIds.size === 0) {
      return;
    }

    const headerEl = container.createDiv({ cls: 'grimoire-context-limits-header' });
    headerEl.createSpan({
      text: t('settings.customModelOverrides.name'),
      cls: 'grimoire-context-limits-label',
    });

    const descEl = container.createDiv({ cls: 'grimoire-context-limits-desc' });
    descEl.setText(t('settings.customModelOverrides.desc'));

    const listEl = container.createDiv({ cls: 'grimoire-context-limits-list' });

    for (const modelId of uniqueModelIds) {
      const currentValue = this.plugin.settings.customContextLimits?.[modelId];
      const currentAlias = this.plugin.settings.customModelAliases?.[modelId] ?? '';

      const itemEl = listEl.createDiv({ cls: 'grimoire-context-limits-item' });
      const nameEl = itemEl.createDiv({ cls: 'grimoire-context-limits-model' });
      nameEl.setText(modelId);

      const inputWrapper = itemEl.createDiv({ cls: 'grimoire-context-limits-input-wrapper' });
      const aliasInputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: t('settings.customModelAliases.placeholder'),
        cls: 'grimoire-context-alias-input',
        value: currentAlias,
      });
      aliasInputEl.setAttribute('aria-label', t('settings.providerModelPicker.aliasLabel', { model: modelId }));
      aliasInputEl.title = t('settings.providerModelPicker.aliasTitle');

      const inputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: '200k',
        cls: 'grimoire-context-limits-input',
        value: currentValue ? formatContextLimit(currentValue) : '',
      });
      inputEl.setAttribute('aria-label', t('settings.provider.contextWindowLabel', { model: modelId }));

      const validationEl = inputWrapper.createDiv({ cls: 'grimoire-context-limit-validation grimoire-hidden' });

      const saveAlias = async (): Promise<void> => {
        if (!this.plugin.settings.customModelAliases) {
          this.plugin.settings.customModelAliases = {};
        }

        const existing = this.plugin.settings.customModelAliases[modelId] ?? '';
        const trimmed = aliasInputEl.value.trim();
        if (trimmed === existing) {
          aliasInputEl.value = existing;
          return;
        }

        if (trimmed) {
          this.plugin.settings.customModelAliases[modelId] = trimmed;
        } else {
          delete this.plugin.settings.customModelAliases[modelId];
        }

        await this.plugin.saveSettings();
        for (const view of this.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
      };

      const saveContextLimit = async (): Promise<void> => {
        const trimmed = inputEl.value.trim();

        if (!this.plugin.settings.customContextLimits) {
          this.plugin.settings.customContextLimits = {};
        }

        if (!trimmed) {
          delete this.plugin.settings.customContextLimits[modelId];
          validationEl.toggleClass('grimoire-hidden', true);
          inputEl.classList.remove('grimoire-input-error');
        } else {
          const parsed = parseContextLimit(trimmed);
          if (parsed === null) {
            validationEl.setText(t('settings.customContextLimits.invalid'));
            validationEl.toggleClass('grimoire-hidden', false);
            inputEl.classList.add('grimoire-input-error');
            return;
          }

          this.plugin.settings.customContextLimits[modelId] = parsed;
          validationEl.toggleClass('grimoire-hidden', true);
          inputEl.classList.remove('grimoire-input-error');
        }

        await this.plugin.saveSettings();
      };

      inputEl.addEventListener('input', () => {
        void saveContextLimit();
      });
      aliasInputEl.addEventListener('blur', () => {
        void saveAlias();
      });
      aliasInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          aliasInputEl.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          aliasInputEl.value = this.plugin.settings.customModelAliases?.[modelId] ?? '';
          aliasInputEl.blur();
        }
      });
    }
  }

  private async restartServiceForPromptChange(): Promise<void> {
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();
    if (!tabManager) return;

    try {
      await tabManager.broadcastToAllTabs(
        async (service) => { await service.ensureReady({ force: true }); }
      );
    } catch {
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
