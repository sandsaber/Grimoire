import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Menu, Notice, Platform, Scope } from 'obsidian';

import { GRIMOIRE_CHANGELOG_URL } from '../../app/changelog/source';
import { getHiddenProviderCommandSet } from '../../core/providers/commands/hiddenCommands';
import { providerCatalog } from '../../core/providers/ProviderCatalog';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../core/providers/types';
import { VIEW_TYPE_GRIMOIRE } from '../../core/types';
import { t } from '../../i18n/i18n';
import type GrimoirePlugin from '../../main';
import { GRIMOIRE_APP_ICON_ID } from '../../shared/appIcon';
import { renderWhatsNewCard } from '../../shared/whats-new/renderWhatsNewCard';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../utils/animationFrame';
import type { HistoryConversationOpenState } from './controllers/ConversationController';
import {
  InlineOrchestratorPlan,
  type OrchestratorPlanDecision,
} from './rendering/InlineOrchestratorPlan';
import type { OrchestratorPlan } from './rendering/orchestratorPlanParser';
import { getTabProviderId, getTabSettingsSnapshot, getTabTitle, onProviderAvailabilityChanged, updatePlanModeUI } from './tabs/Tab';
import { TabBar } from './tabs/TabBar';
import { TabManager } from './tabs/TabManager';
import type { ClosedTabSnapshot, TabData, TabId } from './tabs/types';
import { normalizeMaxTabs } from './tabs/types';
import { ContextUsageMeter, getNextPermissionMode } from './ui/InputToolbar';
import { requestTabRename } from './ui/RenameTabModal';
import { buildAssistantResponseMetadata } from './utils/assistantResponseMetadata';
import { recalculateUsageForModel } from './utils/usageInfo';

type LoadableView = {
  containerEl?: HTMLElement;
  load: (this: LoadableView) => Promise<void> | void;
};

function isLoadableView(value: unknown): value is LoadableView {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return typeof (value as { load?: unknown }).load === 'function';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { then?: unknown }).then === 'function'
  );
}

function bindPrototypeLoad(value: unknown, view: LoadableView): () => Promise<void> | void {
  if (!isLoadableView(value)) {
    return () => undefined;
  }

  const load = value.load;
  return () => {
    const result: unknown = load.call(view);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(() => undefined);
    }
    return undefined;
  };
}

const HISTORY_ICON_PATHS = [
  'M3 12a9 9 0 1 0 3-6.7L3 8',
  'M3 3v5h5',
  'M12 7.5V12l3 2',
];

let historyDialogSequence = 0;

function appendHistoryHeaderIcon(container: HTMLElement): void {
  container.empty();

  const svg = container.createSvg('svg', {
    attr: {
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
  });

  for (const pathData of HISTORY_ICON_PATHS) {
    svg.createSvg('path', { attr: { d: pathData } });
  }
}

export class GrimoireView extends ItemView {
  private plugin: GrimoirePlugin;
  private readonly historyDialogTitleId = `grimoire-history-title-${++historyDialogSequence}`;

  // Tab management
  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private whatsNewHostEl: HTMLElement | null = null;
  private closeToastHostEl: HTMLElement | null = null;
  private closeToastTimers = new Set<number>();
  private closingTabIds = new Set<TabId>();

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private sessionStripEl: HTMLElement | null = null;
  private navContentEl: HTMLElement | null = null;
  private headerActionsContent: HTMLElement | null = null;
  private headerContextUsageMeter: ContextUsageMeter | null = null;
  private newTabButtonEl: HTMLElement | null = null;
  private historyButtonEl: HTMLElement | null = null;

  // Header elements
  private historyDropdown: HTMLElement | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: GrimoirePlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches GrimoireView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype: unknown = Object.getPrototypeOf(this);
    const originalLoad = bindPrototypeLoad(prototype, this);
    Object.defineProperty(this, 'load', {
      value: async (): Promise<void> => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_GRIMOIRE;
  }

  getDisplayText(): string {
    return 'Grimoire';
  }

  getIcon(): string {
    return GRIMOIRE_APP_ICON_ID;
  }

  /** Refreshes model-dependent UI across all tabs (used after settings/env changes). */
  refreshModelSelector(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      onProviderAvailabilityChanged(tab, this.plugin);
      const providerId = getTabProviderId(tab, this.plugin);
      const providerSettings = getTabSettingsSnapshot(tab, this.plugin);
      const model = providerSettings.model;
      const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
      const capabilities = providerCatalog().capabilities(providerId);
      const contextWindow = uiConfig.getContextWindowSize(
        model,
        providerSettings.customContextLimits,
        providerSettings,
      );

      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(tab.state.usage, model, contextWindow);
      }

      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();
      tab.ui.planUsageBadge?.updateDisplay();
      tab.ui.planUsageBadge?.refreshInBackground();
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.permissionToggle?.updateDisplay();
      tab.ui.serviceTierToggle?.updateDisplay();
      tab.dom.inputWrapper.toggleClass(
        'grimoire-input-plan-mode',
        providerSettings.permissionMode === 'plan' && capabilities.supportsPlanMode,
      );
    }

    this.tabManager?.primeProviderRuntime();
  }

  invalidateProviderCommandCaches(providerIds?: ProviderId[]): void {
    this.tabManager?.invalidateProviderCommandCaches(providerIds);
  }

  /** Updates provider-scoped hidden commands on all tabs after settings changes. */
  updateHiddenProviderCommands(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(
        getHiddenProviderCommandSet(this.plugin.settings, getTabProviderId(tab, this.plugin)),
      );
    }
  }

  private async recordOpenEvent(
    event: string,
    data: Record<string, unknown> = {},
    level: 'debug' | 'info' | 'warn' | 'error' = 'debug',
    error?: unknown,
  ): Promise<void> {
    if (typeof this.plugin.writeDebugLog !== 'function') {
      return;
    }

    await this.plugin.writeDebugLog({
      data,
      event,
      level,
      scope: 'view.open',
      ...(error ? { error } : {}),
    });
  }

  async onOpen() {
    await this.recordOpenEvent('onOpen.started', {
      hasContainer: !!this.containerEl,
      hasContent: !!this.contentEl,
    }, 'info');

    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      await this.recordOpenEvent('onOpen.skipped', { reason: 'missing_container' }, 'warn');
      return;
    }

    try {
      // Use contentEl (standard Obsidian API) as primary target.
      // Hover Editor and other plugins may modify the DOM structure,
      // so we need fallbacks to handle non-standard scenarios.
      let container: HTMLElement | null =
        this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

      if (!container) {
        // Last resort: create our own container inside containerEl
        container = this.containerEl.createDiv();
      }

      this.viewContainerEl = container;
      this.viewContainerEl.empty();
      this.viewContainerEl.addClass('grimoire-container');
      this.viewContainerEl.addClass('grimoire-container--chat-window');
      await this.recordOpenEvent('dom.ready', {
        usedContentEl: container === this.contentEl,
      }, 'info');

      const shellEl = this.viewContainerEl.createDiv({ cls: 'grimoire-chat-window-shell' });
      this.closeToastHostEl = shellEl.createDiv({ cls: 'grimoire-tab-close-toast-stack' });
      this.sessionStripEl = shellEl.createDiv({ cls: 'grimoire-header grimoire-session-strip' });
      this.buildNavRowContent();
      this.tabContentEl = shellEl.createDiv({
        cls: 'grimoire-tab-content-container grimoire-tab-content-container--chat-window',
      });
      this.whatsNewHostEl = this.tabContentEl.createDiv({ cls: 'grimoire-whats-new-host' });
      this.showPendingWhatsNew();
      this.historyDropdown = this.buildHistorySheet(shellEl);
      await this.recordOpenEvent('shell.ready');

      this.tabManager = new TabManager(
        this.plugin,
        this.tabContentEl,
        this,
        {
          onTabCreated: (tab) => {
            this.wireOrchestratorCallbacks(tab);
            this.updateTabBar();
            this.updateNavRowLocation();
            this.persistTabState();
            this.syncProviderBrandColor();
            this.syncHeaderContextUsage();
          },
          onTabSwitched: () => {
            this.updateTabBar();
            this.updateHistoryDropdown();
            this.updateNavRowLocation();
            this.persistTabState();
            this.syncProviderBrandColor();
            this.syncHeaderContextUsage();
          },
          onTabClosed: () => {
            this.updateTabBar();
            this.updateNavRowLocation();
            this.persistTabState();
            this.syncHeaderContextUsage();
          },
          onTabOrderChanged: () => {
            this.updateTabBar();
            this.persistTabState();
          },
          onTabStreamingChanged: () => {
            this.updateTabBar();
            this.syncHeaderContextUsage();
          },
          onTabTitleChanged: () => {
            this.updateTabBar();
            this.updateHistoryDropdown();
          },
          onTabAttentionChanged: () => this.updateTabBar(),
          onTabConversationChanged: () => {
            this.updateTabBar();
            this.persistTabState();
            this.syncProviderBrandColor();
            this.syncHeaderContextUsage();
          },
          onTabProviderChanged: () => {
            this.updateTabBar();
            this.syncProviderBrandColor();
            this.syncHeaderContextUsage();
          },
          onTabDraftSettingsChanged: () => {
            this.updateTabBar();
            this.persistTabState();
            this.syncProviderBrandColor();
            this.syncHeaderContextUsage();
          },
          onTabOrchestratorModeChanged: () => {
            this.updateTabBar();
            this.persistTabState();
            this.syncProviderBrandColor();
            this.syncHeaderContextUsage();
          },
          onTabUsageChanged: (tabId) => {
            if (this.tabManager?.getActiveTabId() === tabId) {
              this.syncHeaderContextUsage();
            }
          },
        }
      );

      this.wireEventHandlers();
      await this.recordOpenEvent('restore.started', undefined, 'info');
      await this.restoreOrCreateTabs();
      await this.recordOpenEvent('restore.finished', {
        tabCount: this.tabManager.getTabCount(),
      }, 'info');
      this.syncProviderBrandColor();
      this.updateLayoutForPosition();
      this.tabManager?.primeProviderRuntime();
      await this.recordOpenEvent('onOpen.finished', undefined, 'info');
    } catch (error) {
      await this.recordOpenEvent('onOpen.failed', undefined, 'error', error);
      throw error;
    }
  }

  async onClose() {
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }

    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    for (const timer of this.closeToastTimers) window.clearTimeout(timer);
    this.closeToastTimers.clear();
    this.closeToastHostEl = null;

    await this.persistTabStateImmediate();

    await this.tabManager?.destroy();
    this.tabManager = null;

    this.tabBar?.destroy();
    this.tabBar = null;
    this.scope = null;
    this.whatsNewHostEl = null;
    this.sessionStripEl = null;
    this.navContentEl = null;
  }

  // ============================================
  // UI Building
  // ============================================

  showPendingWhatsNew(): void {
    const containerEl = this.whatsNewHostEl;
    if (!containerEl) {
      return;
    }

    const release = this.plugin.getPendingWhatsNewRelease?.();
    if (!release) {
      return;
    }

    renderWhatsNewCard(containerEl, {
      fullChangelogUrl: GRIMOIRE_CHANGELOG_URL,
      release,
      onDismiss: () => this.plugin.acknowledgePendingWhatsNew?.(),
    });
  }

  /**
   * Builds the shared session strip (tab badges + context/history actions).
   */
  private buildNavRowContent(): HTMLElement {
    const wrapper = this.containerEl.createDiv({ cls: 'grimoire-input-nav-content' });
    wrapper.detach();
    this.navContentEl = wrapper;

    // Tab badges (left side of the composer nav row)
    this.tabBarContainerEl = wrapper.createDiv({ cls: 'grimoire-tab-bar-container' });
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabContextMenu: (tabId, event) => {
        this.showTabContextMenu(tabId, event);
      },
      onTabMiddleClick: (tabId) => {
        void this.requestTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice(t('chat.ui.tabs.createFailed')));
      },
    });
    // Context, new-tab, and history actions (right side)
    this.headerActionsContent = wrapper.createDiv({ cls: 'grimoire-header-actions' });

    this.headerContextUsageMeter = new ContextUsageMeter(this.headerActionsContent, {
      showWhenEmpty: true,
    });

    // New tab button (plus icon)
    this.newTabButtonEl = this.headerActionsContent.createDiv({ cls: 'grimoire-header-btn grimoire-new-tab-btn' });
    this.newTabButtonEl.setText('+');
    this.newTabButtonEl.setAttribute('aria-label', t('chat.ui.tabs.newTab'));
    this.newTabButtonEl.addEventListener('click', () => {
      void this.createNewTab().catch(() => new Notice(t('chat.ui.tabs.createFailed')));
    });

    this.historyButtonEl = this.headerActionsContent.createDiv({ cls: 'grimoire-header-btn grimoire-history-btn' });
    this.historyButtonEl.setAttribute('role', 'button');
    this.historyButtonEl.setAttribute('tabindex', '0');
    this.historyButtonEl.setAttribute('aria-label', t('chat.ui.tabs.history'));
    this.historyButtonEl.setAttribute('aria-haspopup', 'dialog');
    this.historyButtonEl.setAttribute('aria-expanded', 'false');
    appendHistoryHeaderIcon(this.historyButtonEl);
    this.historyButtonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });
    this.historyButtonEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    return wrapper;
  }

  private buildHistorySheet(parentEl: HTMLElement): HTMLElement {
    const sheetEl = parentEl.createEl('aside', {
      cls: 'grimoire-history-menu',
      attr: {
        role: 'dialog',
        'aria-hidden': 'true',
        'aria-labelledby': this.historyDialogTitleId,
      },
    });
    sheetEl.addEventListener('click', (e) => e.stopPropagation());
    return sheetEl;
  }

  /** Keeps session controls above the active tab's panel-view row. */
  private updateNavRowLocation(): void {
    if (!this.sessionStripEl || !this.navContentEl) return;

    this.sessionStripEl.appendChild(this.navContentEl);
  }

  /**
   * Updates layout after settings that can affect the session strip change.
   */
  updateLayoutForPosition(): void {
    if (!this.viewContainerEl) return;

    this.viewContainerEl.removeClass('grimoire-container--header-mode');

    // Move nav content to appropriate location
    this.updateNavRowLocation();

    // Update tab bar and title visibility
    this.updateTabBarVisibility();
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateTabBarVisibility();
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice(t('chat.ui.tabs.switchFailed')));
    }
  }

  async requestTabClose(tabId: TabId): Promise<void> {
    await this.closeTabsWithUndo([tabId]);
  }

  private async closeTabsWithUndo(tabIds: TabId[]): Promise<void> {
    const manager = this.tabManager;
    if (!manager) return;
    const positions = new Map(manager.getTabIds().map((id, index) => [id, index]));
    const candidates = [...new Set(tabIds)]
      .filter(id => !this.closingTabIds.has(id))
      .sort((a, b) => (positions.get(b) ?? 0) - (positions.get(a) ?? 0));
    const snapshots: ClosedTabSnapshot[] = [];

    for (const candidate of candidates) {
      this.closingTabIds.add(candidate);
      try {
        const snapshot = await manager.closeTabForUndo(candidate);
        if (snapshot) snapshots.push(snapshot);
      } catch {
        new Notice(t('chat.ui.tabs.closeFailed'));
      } finally {
        this.closingTabIds.delete(candidate);
      }
    }

    if (snapshots.length > 0) this.showClosedTabToast(snapshots);
    this.updateTabBarVisibility();
  }

  private showTabContextMenu(tabId: TabId, event: MouseEvent): void {
    const manager = this.tabManager;
    const tab = manager?.getTab(tabId);
    if (!manager || !tab) return;
    const tabIds = manager.getTabIds();
    const index = tabIds.indexOf(tabId);
    const canClose = tabIds.length > 1;
    const hasTabsToRight = index >= 0 && index < tabIds.length - 1;
    const hotkey = Platform.isMacOS ? '⌘W' : 'Ctrl+W';
    const menu = new Menu();

    menu.addItem(item => item
      .setTitle(getTabTitle(tab, this.plugin).toUpperCase())
      .setIsLabel(true));
    menu.addItem(item => item
      .setTitle(`${t('chat.ui.tabs.closeTab')} (${hotkey})`)
      .setDisabled(!canClose)
      .onClick(() => { void this.requestTabClose(tabId); }));
    menu.addItem(item => item
      .setTitle(t('chat.ui.tabs.closeOthers'))
      .setDisabled(!canClose)
      .onClick(() => { void this.closeTabsWithUndo(tabIds.filter(id => id !== tabId)); }));
    menu.addItem(item => item
      .setTitle(t('chat.ui.tabs.closeRight'))
      .setDisabled(!hasTabsToRight)
      .onClick(() => { void this.closeTabsWithUndo(tabIds.slice(index + 1)); }));
    menu.addSeparator();
    menu.addItem(item => item
      .setTitle(t('chat.ui.tabs.rename'))
      .onClick(() => { void this.renameTab(tabId); }));
    menu.addItem(item => item
      .setTitle(t('chat.ui.tabs.duplicate'))
      .setDisabled(!manager.canCreateTab())
      .onClick(() => { void this.duplicateTab(tabId); }));
    menu.showAtMouseEvent(event);
  }

  private async renameTab(tabId: TabId): Promise<void> {
    const manager = this.tabManager;
    const tab = manager?.getTab(tabId);
    if (!manager || !tab) return;
    const title = await requestTabRename(this.app, getTabTitle(tab, this.plugin));
    if (title === null) return;
    await manager.renameTab(tabId, title);
  }

  private async duplicateTab(tabId: TabId): Promise<void> {
    try {
      const duplicated = await this.tabManager?.duplicateTab(tabId);
      if (!duplicated) {
        new Notice(t('chat.ui.tabs.maximumAllowed', {
          count: normalizeMaxTabs(this.plugin.settings.maxTabs),
        }));
      }
    } catch {
      new Notice(t('chat.ui.tabs.duplicateFailed'));
    }
  }

  private showClosedTabToast(snapshots: ClosedTabSnapshot[]): void {
    const host = this.closeToastHostEl;
    if (!host) return;
    const toast = host.createDiv({ cls: 'grimoire-tab-close-toast' });
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.createSpan({
      cls: 'grimoire-tab-close-toast-message',
      text: snapshots.length === 1
        ? t('chat.ui.tabs.closed', { title: snapshots[0].title })
        : t('chat.ui.tabs.closedMany', { count: snapshots.length }),
    });
    toast.createSpan({
      cls: 'grimoire-tab-close-toast-separator',
      text: ' · ',
      attr: { 'aria-hidden': 'true' },
    });
    const undo = toast.createEl('button', {
      cls: 'grimoire-tab-close-toast-undo',
      text: t('chat.ui.tabs.undo'),
      attr: { type: 'button' },
    });
    toast.createDiv({ cls: 'grimoire-tab-close-toast-progress' });

    const removeToast = () => {
      toast.remove();
      this.closeToastTimers.delete(timer);
    };
    const timer = window.setTimeout(removeToast, 6000);
    this.closeToastTimers.add(timer);

    undo.addEventListener('click', () => {
      window.clearTimeout(timer);
      this.closeToastTimers.delete(timer);
      undo.disabled = true;
      void this.tabManager?.restoreClosedTabs(snapshots)
        .then(() => toast.remove())
        .catch(() => {
          toast.remove();
          new Notice(t('chat.ui.tabs.restoreFailed'));
        });
    });
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = normalizeMaxTabs(this.plugin.settings.maxTabs);
      new Notice(t('chat.ui.tabs.maximumAllowed', { count: maxTabs }));
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.updateTabBarVisibility();
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.getTabCount();
    const showTabBar = tabCount >= 1;

    // Keep the numbered session strip visible above the panel-view row.
    this.tabBarContainerEl.toggleClass('grimoire-hidden', !showTabBar);

    this.updateNewTabButtonVisibility();
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.newTabButtonEl || !this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    this.newTabButtonEl.toggleClass('grimoire-hidden', !canCreateTab);
    if (canCreateTab) {
      this.newTabButtonEl.removeAttribute('aria-disabled');
      this.newTabButtonEl.removeAttribute('aria-hidden');
      return;
    }

    this.newTabButtonEl.setAttribute('aria-disabled', 'true');
    this.newTabButtonEl.setAttribute('aria-hidden', 'true');
  }

  /** Sets `data-provider` on the root container for provider-scoped status accents. */
  private syncProviderBrandColor(): void {
    if (!this.viewContainerEl) return;
    const activeTab = this.tabManager?.getActiveTab();
    const providerId = activeTab ? getTabProviderId(activeTab, this.plugin) : DEFAULT_CHAT_PROVIDER_ID;
    this.viewContainerEl.dataset.provider = providerId;
  }

  private syncHeaderContextUsage(): void {
    this.headerContextUsageMeter?.update(this.tabManager?.getActiveTab()?.state.usage ?? null);
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.closeHistoryDropdown();
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
      this.historyDropdown.setAttribute('aria-hidden', 'false');
      this.syncHistoryButtonState(true);
    }
  }

  private closeHistoryDropdown(): void {
    this.historyDropdown?.removeClass('visible');
    this.historyDropdown?.setAttribute('aria-hidden', 'true');
    this.syncHistoryButtonState(false);
  }

  private syncHistoryButtonState(isOpen = this.historyDropdown?.hasClass('visible') ?? false): void {
    this.historyButtonEl?.removeClass('active');
    this.historyButtonEl?.setAttribute('aria-expanded', String(isOpen));
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;

    if (conversationController) {
      conversationController.renderHistoryDropdown(this.historyDropdown, {
        onSelectConversation: (id) => this.openHistoryConversation(id),
        onOpenConversationInNewTab: (id, activate) =>
          this.openHistoryConversationInNewTab(id, activate),
        getConversationOpenState: (id) => this.getHistoryConversationOpenState(id),
        onClose: () => this.closeHistoryDropdown(),
      });
      this.historyDropdown
        .querySelector<HTMLElement>('.grimoire-history-title')
        ?.setAttribute('id', this.historyDialogTitleId);
    }
  }

  private async openHistoryConversation(conversationId: string): Promise<void> {
    await this.tabManager?.openConversation(conversationId);
    this.closeHistoryDropdown();
  }

  private async openHistoryConversationInNewTab(
    conversationId: string,
    activate = true,
  ): Promise<void> {
    await this.tabManager?.openConversation(conversationId, {
      preferNewTab: true,
      activate,
    });
    this.closeHistoryDropdown();
  }

  private getHistoryConversationOpenState(conversationId: string): HistoryConversationOpenState {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === conversationId) {
      return 'current';
    }

    if (this.findTabWithConversation(conversationId)) {
      return 'open';
    }

    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    if (crossViewResult && crossViewResult.view !== this) {
      return 'open';
    }

    return 'closed';
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  private wireOrchestratorCallbacks(tab: TabData): void {
    const streamController = tab.controllers.streamController;
    if (!streamController) return;

    const isWorker = tab.orchestratorTabId != null;
    streamController.setOrchestratorCallbacks(
      isWorker
        ? undefined
        : (containerEl, plan) => this.renderOrchestratorApproval(tab, containerEl, plan),
      () => tab.orchestratorMode,
    );
  }

  private renderOrchestratorApproval(
    tab: TabData,
    containerEl: HTMLElement,
    plan: OrchestratorPlan,
  ): void {
    const providerId = getTabProviderId(tab, this.plugin);
    const settings = getTabSettingsSnapshot(tab, this.plugin);
    const metadata = buildAssistantResponseMetadata(providerId, settings);
    const inlinePlan = new InlineOrchestratorPlan(
      containerEl,
      plan,
      (decision) => {
        void this.handleOrchestratorDecision(tab, decision);
      },
      {
        providerId,
        ...(metadata.modelLabel ? { modelLabel: metadata.modelLabel } : {}),
      },
    );
    inlinePlan.render();
  }

  private async handleOrchestratorDecision(
    orchestratorTab: TabData,
    decision: OrchestratorPlanDecision,
  ): Promise<void> {
    if (decision.type !== 'spawn_workers') {
      return;
    }

    for (const task of decision.plan.tasks) {
      const workerTab = await this.tabManager?.createWorkerTab(orchestratorTab.id);
      if (!workerTab) {
        continue;
      }

      workerTab.orchestratorMode = false;
      this.wireOrchestratorCallbacks(workerTab);
      void workerTab.controllers.inputController?.sendMessage({ content: task.prompt });
    }

    this.updateTabBar();
    this.persistTabState();
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', () => {
      this.closeHistoryDropdown();
    });

    // View-level Shift+Tab cycles the provider's permission modes from any focused element.
    this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && this.historyDropdown?.hasClass('visible')) {
        e.preventDefault();
        this.closeHistoryDropdown();
        return;
      }

      if (e.key === 'Tab' && e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const activeTab = this.tabManager?.getActiveTab();
        if (!activeTab) return;
        const providerId = getTabProviderId(activeTab, this.plugin);
        const capabilities = providerCatalog().capabilities(providerId);
        const toggleConfig = providerCatalog().declarations(providerId)
          .chatUI.permissionMode?.toggle() ?? null;
        if (!toggleConfig) return;
        const current = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
          this.plugin.settings,
          providerId,
        ).permissionMode as string;
        const next = getNextPermissionMode(current, toggleConfig, capabilities.supportsPlanMode);
        if (current === toggleConfig.planValue) {
          activeTab.state.prePlanPermissionMode = null;
        } else if (next === toggleConfig.planValue) {
          activeTab.state.prePlanPermissionMode = current;
        }
        updatePlanModeUI(activeTab, this.plugin, next);
      }
    });

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!e.defaultPrevented) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });
    this.scope.register(['Mod'], 'w', (e: KeyboardEvent) => {
      if (!e.isComposing && (this.tabManager?.getTabCount() ?? 0) > 1) {
        const activeTabId = this.tabManager?.getActiveTabId();
        if (activeTabId) void this.requestTabClose(activeTabId);
      }
      return false;
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      const mgr = this.tabManager?.getActiveTab()?.ui.fileContextManager;
      if (!mgr) return;
      mgr.markFileCacheDirty();
      if (includesFolders) mgr.markFolderCacheDirty();
    };
    const registerCreateCacheInvalidation = (): void => {
      if (!this.tabManager) return;
      this.eventRefs.push(
        this.plugin.app.vault.on('create', () => markCacheDirty(true))
      );
    };
    if (this.plugin.app.workspace.layoutReady) {
      registerCreateCacheInvalidation();
    } else if (typeof this.plugin.app.workspace.onLayoutReady === 'function') {
      this.plugin.app.workspace.onLayoutReady(registerCreateCacheInvalidation);
    } else {
      registerCreateCacheInvalidation();
    }
    this.eventRefs.push(
      this.plugin.app.vault.on('delete', () => markCacheDirty(true)),
      this.plugin.app.vault.on('rename', () => markCacheDirty(true)),
      this.plugin.app.vault.on('modify', () => markCacheDirty(false))
    );

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    if (!this.tabManager) return;

    // Try to restore from persisted state
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await this.tabManager.restoreState(persistedState);
      return;
    }

    // Fallback: create a new empty tab
    await this.tabManager.createTab();
  }

  private persistTabState(): void {

    // Debounce persistence to avoid rapid writes (300ms delay)
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = window.setTimeout(() => {
      this.pendingPersist = null;
      if (!this.tabManager) return;
      const state = this.tabManager.getPersistedState();
      this.plugin.persistTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    // Cancel any pending debounced persist
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }
}
