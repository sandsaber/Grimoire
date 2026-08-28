import { Notice } from 'obsidian';

import { getOpaqueProviderState } from '../../../core/providers/getOpaqueProviderState';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import type { ProviderCommandsPort } from '../../../core/providers/ProviderModule';
import type { ProviderWarmupMode } from '../../../core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
} from '../../../core/providers/types';
import type { ExecutionChatRuntimeAdapter } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage, Conversation, SlashCommand } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { chooseForkTarget } from '../../../shared/modals/ForkTargetModal';
import { revealWorkspaceLeaf } from '../../../utils/obsidianCompat';
import { getTabProviderId } from './providerResolution';
import {
  activateTab,
  createTab,
  deactivateTab,
  destroyTab,
  type ForkContext,
  getTabSettingsSnapshot,
  getTabTitle,
  initializeTabControllers,
  initializeTabService,
  initializeTabUI,
  refreshRuntimeContextUI,
  setupServiceCallbacks,
  wireTabInputEvents,
} from './Tab';
import { resolveTabProjectionExecution } from './tabProjectionExecution';
import {
  type ClosedTabSnapshot,
  MAX_TAB_TITLE_LENGTH,
  normalizeMaxTabs,
  type PersistedTabManagerState,
  type PersistedTabState,
  type TabBarItem,
  type TabData,
  type TabId,
  type TabLifecycleState,
  type TabManagerCallbacks,
  type TabManagerInterface,
  type TabManagerViewHost,
} from './types';
import { WarmRuntimeLru } from './WarmRuntimeLru';

function isTabManagerViewHost(value: unknown): value is TabManagerViewHost {
  return !!value
    && typeof value === 'object'
    && 'getTabManager' in (value as Record<string, unknown>);
}

type CreateTabOptions = {
  activate?: boolean;
  bypassTabLimit?: boolean;
  draftModel?: string;
  draftSettings?: Record<string, unknown>;
  orchestratorMode?: boolean;
  providerId?: ProviderId;
  titleOverride?: string | null;
};

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

type OpenConversationOptions = {
  preferNewTab?: boolean;
  activate?: boolean;
};

type ProviderCommandCacheEntry = {
  commands: SlashCommand[];
  key: string;
};

type ProviderWarmupContext = {
  conversation: Conversation | null;
  externalContextPaths: string[];
  runtime: ExecutionChatRuntimeAdapter | null;
  /**
   * The tab, as the warm-up path reads it.
   *
   * Declared here now rather than borrowed from a provider contribution's
   * context type: that context was built for a policy nobody consulted, and
   * this is the only shape still using any of it.
   */
  tab: {
    conversationId: string | null;
    draftModel: string | null;
    lifecycleState: TabLifecycleState;
    providerId: ProviderId;
  };
  warmupMode: ProviderWarmupMode;
};

type ProviderCommandContext = ProviderWarmupContext & {
  cacheKey: string;
};

type ProviderCommandWarmupEntry = {
  key: string;
  promise: Promise<SlashCommand[]>;
};

export const MAX_WARM_PROVIDER_RUNTIMES = 5;

/**
 * TabManager coordinates multiple chat tabs.
 */
export class TabManager implements TabManagerInterface {
  private plugin: GrimoirePlugin;
  private containerEl: HTMLElement;
  private view: TabManagerViewHost;

  private tabs: Map<TabId, TabData> = new Map();
  private activeTabId: TabId | null = null;
  private callbacks: TabManagerCallbacks;
  private providerCommandWarmups = new Map<TabId, ProviderCommandWarmupEntry>();
  private providerCommandCache = new Map<TabId, ProviderCommandCacheEntry>();
  private warmRuntimes = new WarmRuntimeLru<ExecutionChatRuntimeAdapter>(MAX_WARM_PROVIDER_RUNTIMES);
  private isRestoringState = false;

  /** Guard to prevent concurrent tab switches. */
  private isSwitchingTab = false;

  private recordRestoreEvent(
    event: string,
    data: Record<string, unknown>,
    level: 'debug' | 'info' | 'warn' | 'error' = 'debug',
    error?: unknown,
  ): void {
    this.plugin.recordDebugLog?.({
      data,
      event,
      level,
      scope: 'tabs.restore',
      ...(error ? { error } : {}),
    });
  }

  /**
   * Gets the current max tabs limit from settings.
   * Clamps to the configured chat tab bounds.
   */
  private getMaxTabs(): number {
    return normalizeMaxTabs(this.plugin.settings.maxTabs);
  }

  private getUserTabCount(): number {
    return Array.from(this.tabs.values())
      .filter((tab) => tab.orchestratorTabId == null)
      .length;
  }

  private hasStartedConversation(conversation: Conversation | null | undefined): conversation is Conversation {
    if (!conversation) {
      return false;
    }
    if (conversation.messages.length > 0) {
      return true;
    }
    try {
      return !!providerCatalog().declarations(conversation.providerId)
        .conversationState?.resolveSessionId(conversation);
    } catch {
      return !!conversation.sessionId;
    }
  }

  constructor(
    plugin: GrimoirePlugin,
    containerEl: HTMLElement,
    view: TabManagerViewHost,
    callbacks?: TabManagerCallbacks,
  );
  constructor(
    plugin: GrimoirePlugin,
    legacyArg: unknown,
    containerEl: HTMLElement,
    view: TabManagerViewHost,
    callbacks?: TabManagerCallbacks,
  );
  constructor(
    plugin: GrimoirePlugin,
    arg2: unknown,
    arg3: HTMLElement | TabManagerViewHost,
    arg4?: TabManagerViewHost | TabManagerCallbacks,
    arg5: TabManagerCallbacks = {},
  ) {
    this.plugin = plugin;

    if (isTabManagerViewHost(arg3)) {
      this.containerEl = arg2 as HTMLElement;
      this.view = arg3;
      this.callbacks = (arg4 as TabManagerCallbacks | undefined) ?? {};
      return;
    }

    this.containerEl = arg3;
    this.view = arg4 as TabManagerViewHost;
    this.callbacks = arg5;
  }

  // ============================================
  // Tab Lifecycle
  // ============================================

  /**
   * Creates a new tab.
   * @param conversationId Optional conversation to load into the tab.
   * @param tabId Optional tab ID (for restoration).
   * @param options Controls whether the new tab becomes active immediately.
   * @returns The created tab, or null if max tabs reached.
   */
  async createTab(
    conversationId?: string | null,
    tabId?: TabId,
    options: CreateTabOptions = {},
  ): Promise<TabData | null> {
    const maxTabs = this.getMaxTabs();
    if (this.getUserTabCount() >= maxTabs && !options.bypassTabLimit) {
      return null;
    }

    const {
      activate = true,
      draftModel,
      draftSettings,
      orchestratorMode,
      providerId,
      titleOverride,
    } = options;

    const conversation = conversationId
      ? await this.plugin.getConversationById(conversationId)
      : undefined;

    // Inherit the active tab's provider so the new blank tab picks up its model
    const activeTab = this.getActiveTab();
    const defaultProviderId = conversation
      ? undefined
      : (providerId ?? (activeTab ? getTabProviderId(activeTab, this.plugin) : undefined));

    const tab = createTab({
      plugin: this.plugin,
      containerEl: this.containerEl,
      conversation: conversation ?? undefined,
      tabId,
      ...(typeof draftModel === 'string' ? { draftModel } : {}),
      ...(draftSettings && typeof draftSettings === 'object' ? { draftSettings } : {}),
      ...(orchestratorMode === true ? { orchestratorMode } : {}),
      defaultProviderId,
      onStreamingChanged: (isStreaming) => {
        this.callbacks.onTabStreamingChanged?.(tab.id, isStreaming);
        this.touchWarmRuntime(tab);
      },
      onTitleChanged: (title) => {
        this.callbacks.onTabTitleChanged?.(tab.id, title);
      },
      onAttentionChanged: (needsAttention) => {
        this.callbacks.onTabAttentionChanged?.(tab.id, needsAttention);
      },
      onConversationIdChanged: (conversationId) => {
        // Sync tab.conversationId when conversation is lazily created
        tab.conversationId = conversationId;
        // The tab is showing a different conversation now, so its projection is
        // a different conversation's. Detaching first is what stops the old
        // one's turn being drawn into the new one's column.
        const execution = resolveTabProjectionExecution(tab, this.plugin);
        if (conversationId) {
          void execution?.open(conversationId);
        } else {
          execution?.detach();
        }
        this.callbacks.onTabConversationChanged?.(tab.id, conversationId);
      },
    });
    tab.titleOverride = titleOverride ?? null;

    // Initialize UI components with provider catalog
    initializeTabUI(tab, this.plugin, {
      getProviderCatalogConfig: () => this.getProviderCatalogConfig(tab),
      onUsageChanged: (usage) => {
        this.callbacks.onTabUsageChanged?.(tab.id, usage);
      },
      onProviderChanged: (providerId) => {
        this.callbacks.onTabProviderChanged?.(tab.id, providerId);
        void this.prewarmProviderTab(tab).catch(() => {
          // Keep provider switching non-blocking even if command warmup fails.
        });
      },
      onDraftSettingsChanged: (providerId, settings) => {
        this.callbacks.onTabDraftSettingsChanged?.(tab.id, providerId, settings);
      },
      onOrchestratorModeChanged: (enabled) => {
        this.callbacks.onTabOrchestratorModeChanged?.(tab.id, enabled);
      },
    });

    initializeTabControllers(
      tab,
      this.plugin,
      this.view,
      (forkContext) => this.handleForkRequest(forkContext),
      (conversationId) => this.openConversation(conversationId),
      () => this.getProviderCatalogConfig(tab),
    );

    // After the controllers, because a tab's binding reads its renderer and its
    // stream controller. `null` unless this tab's provider is on the projection
    // path, which is what keeps the flip to one provider at a time.
    resolveTabProjectionExecution(tab, this.plugin);

    // Wire input event handlers
    wireTabInputEvents(tab, this.plugin);

    this.tabs.set(tab.id, tab);
    this.callbacks.onTabCreated?.(tab);

    if (!this.isRestoringState && (activate || !this.activeTabId)) {
      await this.switchToTab(tab.id);
    } else if (!this.isRestoringState) {
      this.maybePrimeProviderRuntime(tab);
    }

    return tab;
  }

  /**
   * Creates a background worker tab for an orchestrator. Worker tabs intentionally
   * bypass the user-facing tab cap because a single approved plan owns the fleet.
   */
  async createWorkerTab(orchestratorTabId: TabId): Promise<TabData | null> {
    const orchestratorTab = this.tabs.get(orchestratorTabId);
    const providerId = orchestratorTab
      ? getTabProviderId(orchestratorTab, this.plugin)
      : undefined;
    const draftSettings = orchestratorTab
      ? getTabSettingsSnapshot(orchestratorTab, this.plugin)
      : undefined;
    const draftModel = typeof draftSettings?.model === 'string'
      ? draftSettings.model
      : undefined;
    const tab = await this.createTab(undefined, undefined, {
      activate: false,
      bypassTabLimit: true,
      ...(draftModel ? { draftModel } : {}),
      ...(draftSettings ? { draftSettings: cloneValue(draftSettings) } : {}),
      ...(providerId ? { providerId } : {}),
    });
    if (!tab) {
      return null;
    }

    tab.orchestratorTabId = orchestratorTabId;
    if (orchestratorTab) {
      orchestratorTab.workerTabIds = orchestratorTab.workerTabIds ?? [];
      orchestratorTab.workerTabIds.push(tab.id);
    }

    return tab;
  }

  /**
   * Switches to a different tab.
   * @param tabId The tab to switch to.
   */
  async switchToTab(tabId: TabId): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }

    // Guard against concurrent tab switches
    if (this.isSwitchingTab) {
      return;
    }

    this.isSwitchingTab = true;
    const previousTabId = this.activeTabId;

    try {
      // Deactivate current tab
      if (previousTabId && previousTabId !== tabId) {
        const currentTab = this.tabs.get(previousTabId);
        if (currentTab) {
          deactivateTab(currentTab);
        }
      }

      // Activate new tab
      this.activeTabId = tabId;
      activateTab(tab);
      refreshRuntimeContextUI(tab, this.plugin);

      // Load conversation if not already loaded
      if (tab.conversationId && tab.state.messages.length === 0) {
        await tab.controllers.conversationController?.switchTo(tab.conversationId);
      } else if (
        tab.conversationId
        && tab.state.messages.length > 0
        && tab.service
        && !tab.state.isStreaming
        && !tab.state.hasPendingConversationSave
      ) {
        // Passive sync is only safe once local tab state has been persisted.
        const conversation = this.plugin.getConversationSync(tab.conversationId);
        if (conversation) {

          tab.service.syncConversationState(conversation);
        }
      } else if (!tab.conversationId && tab.state.messages.length === 0) {
        // New tab with no conversation - initialize welcome greeting
        tab.controllers.conversationController?.initializeWelcome();
      }

      this.callbacks.onTabSwitched?.(previousTabId, tabId);
      this.touchWarmRuntime(tab);
      this.maybePrimeProviderRuntime(tab);
    } finally {
      this.isSwitchingTab = false;
    }
  }

  /**
   * Closes a tab.
   * @param tabId The tab to close.
   * @param force If true, close even if streaming.
   * @returns True if the tab was closed.
   */
  async closeTab(tabId: TabId, force = false): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return false;
    }

    // Don't close if streaming unless forced
    if (tab.state.isStreaming && !force) {
      return false;
    }

    // Keep one tab open, matching browser-style tab controls.
    if (this.tabs.size <= 1) {
      return false;
    }

    // Save conversation before closing
    await tab.controllers.conversationController?.save();

    // Capture tab order BEFORE deletion for fallback calculation
    const tabIdsBefore = Array.from(this.tabs.keys());
    const closingIndex = tabIdsBefore.indexOf(tabId);

    // Destroy tab resources (async for proper cleanup)
    await destroyTab(tab);
    this.warmRuntimes.remove(tabId);
    this.providerCommandWarmups.delete(tabId);
    this.providerCommandCache.delete(tabId);
    this.tabs.delete(tabId);
    this.callbacks.onTabClosed?.(tabId);

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId) {
      this.activeTabId = null;

      if (this.tabs.size > 0) {
        // Fallback strategy: prefer previous tab, except for first tab (go to next)
        const fallbackTabId = closingIndex === 0
          ? tabIdsBefore[1]  // First tab: go to next
          : tabIdsBefore[closingIndex - 1];  // Others: go to previous

        if (fallbackTabId && this.tabs.has(fallbackTabId)) {
          await this.switchToTab(fallbackTabId);
        }
      } else {
        // Create a replacement blank tab.
        await this.createTab();
      }
    }

    return true;
  }

  async closeTabForUndo(tabId: TabId): Promise<ClosedTabSnapshot | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || this.tabs.size <= 1) return null;

    const tabIds = Array.from(this.tabs.keys());
    const snapshot: ClosedTabSnapshot = {
      tabId: tab.id,
      index: tabIds.indexOf(tab.id),
      title: getTabTitle(tab, this.plugin),
      wasActive: this.activeTabId === tab.id,
      conversationId: tab.conversationId,
      draftModel: tab.draftModel,
      draftSettings: tab.draftSettings ? cloneValue(tab.draftSettings) : null,
      titleOverride: tab.titleOverride ?? null,
      orchestratorMode: tab.orchestratorMode,
      orchestratorTabId: tab.orchestratorTabId,
      workerTabIds: tab.workerTabIds ? [...tab.workerTabIds] : undefined,
      inputValue: tab.dom.inputEl.value,
    };

    const closed = await this.closeTab(tab.id, tab.state.isStreaming);
    return closed ? snapshot : null;
  }

  async restoreClosedTabs(snapshots: ClosedTabSnapshot[]): Promise<TabData[]> {
    const restored: TabData[] = [];
    const ordered = [...snapshots].sort((a, b) => a.index - b.index);

    for (const snapshot of ordered) {
      const tab = await this.createTab(snapshot.conversationId, snapshot.tabId, {
        activate: false,
        bypassTabLimit: true,
        draftModel: snapshot.draftModel ?? undefined,
        draftSettings: snapshot.draftSettings ?? undefined,
        orchestratorMode: snapshot.orchestratorMode,
        titleOverride: snapshot.titleOverride,
      });
      if (!tab) continue;

      tab.orchestratorTabId = snapshot.orchestratorTabId;
      tab.workerTabIds = snapshot.workerTabIds ? [...snapshot.workerTabIds] : undefined;
      tab.dom.inputEl.value = snapshot.inputValue;
      this.moveTabToIndex(tab.id, snapshot.index);
      restored.push(tab);
    }

    const previouslyActive = ordered.find(snapshot => snapshot.wasActive);
    if (previouslyActive && this.tabs.has(previouslyActive.tabId)) {
      await this.switchToTab(previouslyActive.tabId);
    }
    this.callbacks.onTabOrderChanged?.();
    return restored;
  }

  async renameTab(tabId: TabId, title: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const normalized = title.trim().slice(0, MAX_TAB_TITLE_LENGTH);
    if (!normalized) return;

    if (tab.conversationId) {
      await this.plugin.renameConversation(tab.conversationId, normalized);
      return;
    }

    tab.titleOverride = normalized;
    this.callbacks.onTabTitleChanged?.(tab.id, getTabTitle(tab, this.plugin));
  }

  async duplicateTab(tabId: TabId): Promise<TabData | null> {
    const source = this.tabs.get(tabId);
    if (!source || !this.canCreateTab()) return null;
    const sourceIndex = Array.from(this.tabs.keys()).indexOf(tabId);

    if (!source.conversationId) {
      const duplicate = await this.createTab(null, undefined, {
        draftModel: source.draftModel ?? undefined,
        draftSettings: source.draftSettings ? cloneValue(source.draftSettings) : undefined,
        orchestratorMode: source.orchestratorMode,
        titleOverride: this.buildDuplicateTitle(getTabTitle(source, this.plugin)),
      });
      if (!duplicate) return null;
      duplicate.dom.inputEl.value = source.dom.inputEl.value;
      this.moveTabToIndex(duplicate.id, sourceIndex + 1);
      return duplicate;
    }

    await source.controllers.conversationController?.save();
    const original = this.plugin.getConversationSync(source.conversationId);
    if (!original) return null;
    const duplicateConversation = await this.plugin.createConversation({
      providerId: original.providerId,
      model: original.model,
    });

    try {
      await this.plugin.updateConversation(duplicateConversation.id, {
        title: this.buildDuplicateTitle(getTabTitle(source, this.plugin)),
        messages: cloneValue<ChatMessage[]>(source.state.messages),
        currentNote: original.currentNote,
        externalContextPaths: original.externalContextPaths,
        usage: original.usage,
        enabledMcpServers: original.enabledMcpServers,
        orchestratorMode: original.orchestratorMode,
        model: original.model,
      });
      const duplicate = await this.createTab(duplicateConversation.id);
      if (!duplicate) {
        await this.plugin.deleteConversation(duplicateConversation.id);
        return null;
      }
      this.moveTabToIndex(duplicate.id, sourceIndex + 1);
      return duplicate;
    } catch (error) {
      await this.plugin.deleteConversation(duplicateConversation.id).catch(() => {});
      throw error;
    }
  }

  private buildDuplicateTitle(sourceTitle: string): string {
    const base = t('chat.ui.tabs.duplicateTitle', { title: sourceTitle });
    const existing = new Set(this.plugin.getConversationList().map(conversation => conversation.title));
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base} ${suffix}`)) suffix++;
    return `${base} ${suffix}`;
  }

  private moveTabToIndex(tabId: TabId, index: number): void {
    const entries = Array.from(this.tabs.entries());
    const currentIndex = entries.findIndex(([id]) => id === tabId);
    if (currentIndex === -1) return;
    const [entry] = entries.splice(currentIndex, 1);
    entries.splice(Math.max(0, Math.min(index, entries.length)), 0, entry);
    this.tabs = new Map(entries);
    this.callbacks.onTabOrderChanged?.();
  }

  // ============================================
  // Tab Queries
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) ?? null : null;
  }

  /** Gets the active tab ID. */
  getActiveTabId(): TabId | null {
    return this.activeTabId;
  }

  getTabIds(): TabId[] {
    return Array.from(this.tabs.keys());
  }

  /** Gets a tab by ID. */
  getTab(tabId: TabId): TabData | null {
    return this.tabs.get(tabId) ?? null;
  }

  /** Gets all tabs. */
  getAllTabs(): TabData[] {
    return Array.from(this.tabs.values());
  }

  /** Refreshes tab-bar titles for every tab displaying a renamed conversation. */
  notifyConversationRenamed(conversationId: string, title: string): void {
    for (const tab of this.tabs.values()) {
      if (tab.conversationId === conversationId) {
        this.callbacks.onTabTitleChanged?.(tab.id, title);
      }
    }
  }

  /** Gets the number of tabs. */
  getTabCount(): number {
    return this.tabs.size;
  }

  /** Checks if more tabs can be created. */
  canCreateTab(): boolean {
    return this.getUserTabCount() < this.getMaxTabs();
  }

  // ============================================
  // Tab Bar Data
  // ============================================

  /** Gets data for rendering the tab bar. */
  getTabBarItems(): TabBarItem[] {
    const items: TabBarItem[] = [];
    let index = 1;

    for (const tab of this.tabs.values()) {
      items.push({
        id: tab.id,
        index: index++,
        title: getTabTitle(tab, this.plugin),
        providerId: getTabProviderId(tab, this.plugin),
        isActive: tab.id === this.activeTabId,
        isStreaming: tab.state.isStreaming,
        needsAttention: tab.state.needsAttention,
        canClose: this.tabs.size > 1,
        isOrchestrator: (tab.workerTabIds?.length ?? 0) > 0,
        isWorker: tab.orchestratorTabId != null,
      });
    }

    return items;
  }

  // ============================================
  // Conversation Management
  // ============================================

  /**
   * Opens a conversation in a new tab or existing tab.
   * @param conversationId The conversation to open.
   * @param options Controls tab creation behavior (backward-compatible with boolean).
   */
  async openConversation(
    conversationId: string,
    options: boolean | OpenConversationOptions = false,
  ): Promise<void> {
    const preferNewTab = typeof options === 'boolean'
      ? options
      : options.preferNewTab ?? false;
    const activate = typeof options === 'boolean'
      ? true
      : options.activate ?? true;

    // Check if conversation is already open in this view's tabs
    for (const tab of this.tabs.values()) {
      if (tab.conversationId === conversationId) {
        await this.switchToTab(tab.id);
        return;
      }
    }

    // Check if conversation is open in another view (split workspace scenario)
    // Compare view references directly (more robust than leaf comparison)
    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    const isSameView = crossViewResult?.view === this.view;
    if (crossViewResult && !isSameView) {
      // Focus the other view and switch to its tab instead of opening duplicate
      await revealWorkspaceLeaf(this.plugin.app.workspace, crossViewResult.view.leaf);
      await crossViewResult.view.getTabManager()?.switchToTab(crossViewResult.tabId);
      return;
    }

    // A conversation may only be mounted once. Two tabs bound to the same
    // stored conversation can race while saving and overwrite newer messages.
    if (preferNewTab && this.canCreateTab()) {
      await this.createTab(conversationId, undefined, { activate });
      return;
    }

    // Open in current tab or new tab
    // Open in current tab. Note: Don't set tab.conversationId here - the
    // onConversationIdChanged callback will sync it after successful switch.
    const activeTab = this.getActiveTab();
    if (activeTab) {
      await activeTab.controllers.conversationController?.switchTo(conversationId);
    }
  }

  /**
   * Creates a new conversation in the active tab.
   */
  async createNewConversation(): Promise<void> {
    const activeTab = this.getActiveTab();
    if (activeTab) {
      await activeTab.controllers.conversationController?.createNew();
      // Sync tab.conversationId with the newly created conversation
      activeTab.conversationId = activeTab.state.currentConversationId;
      this.maybePrimeProviderRuntime(activeTab);
    }
  }

  invalidateProviderCommandCaches(providerIds?: ProviderId | ProviderId[]): void {
    for (const tab of this.filterTabsByProvider(providerIds, (tab) => getTabProviderId(tab, this.plugin))) {
      this.providerCommandWarmups.delete(tab.id);
      this.providerCommandCache.delete(tab.id);
      tab.ui?.slashCommandDropdown?.resetSdkSkillsCache();
    }
  }

  primeProviderRuntime(providerIds?: ProviderId | ProviderId[]): void {
    for (const tab of this.filterTabsByProvider(providerIds, (tab) => tab.service?.providerId ?? tab.providerId)) {
      this.maybePrimeProviderRuntime(tab);
    }
  }

  private *filterTabsByProvider(
    providerIds: ProviderId | ProviderId[] | undefined,
    resolve: (tab: TabData) => ProviderId,
  ): Iterable<TabData> {
    const filter = providerIds
      ? new Set(Array.isArray(providerIds) ? providerIds : [providerIds])
      : null;

    for (const tab of this.tabs.values()) {
      if (filter && !filter.has(resolve(tab))) {
        continue;
      }
      yield tab;
    }
  }

  // ============================================
  // Fork
  // ============================================

  private async handleForkRequest(context: ForkContext): Promise<void> {
    const target = await chooseForkTarget(this.plugin.app);
    if (!target) return;

    if (target === 'new-tab') {
      const tab = await this.forkToNewTab(context);
      if (!tab) {
        const maxTabs = this.getMaxTabs();
        new Notice(t('chat.fork.maxTabsReached', { count: String(maxTabs) }));
        return;
      }
      new Notice(t('chat.fork.notice'));
    } else {
      const success = await this.forkInCurrentTab(context);
      if (!success) {
        new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoActiveTab') }));
        return;
      }
      new Notice(t('chat.fork.noticeCurrentTab'));
    }
  }

  async forkToNewTab(context: ForkContext): Promise<TabData | null> {
    const maxTabs = this.getMaxTabs();
    if (this.tabs.size >= maxTabs) {
      return null;
    }

    const conversationId = await this.createForkConversation(context);
    try {
      return await this.createTab(conversationId);
    } catch (error) {
      await this.plugin.deleteConversation(conversationId).catch(() => {});
      throw error;
    }
  }

  async forkInCurrentTab(context: ForkContext): Promise<boolean> {
    const activeTab = this.getActiveTab();
    if (!activeTab?.controllers.conversationController) return false;

    const conversationId = await this.createForkConversation(context);
    try {
      await activeTab.controllers.conversationController.switchTo(conversationId);
    } catch (error) {
      await this.plugin.deleteConversation(conversationId).catch(() => {});
      throw error;
    }
    return true;
  }

  private async createForkConversation(context: ForkContext): Promise<string> {
    const conversation = await this.plugin.createConversation({
      providerId: context.providerId,
      model: context.model,
    });

    const title = context.sourceTitle
      ? this.buildForkTitle(context.sourceTitle, context.forkAtUserMessage)
      : undefined;

    const forkProviderState = providerCatalog()
      .declarations(conversation.providerId).conversationState
      ?.forkState(
        context.sourceSessionId,
        context.resumeAt,
        context.sourceProviderState,
      ) ?? {};

    await this.plugin.updateConversation(conversation.id, {
      messages: context.messages,
      providerState: forkProviderState,
      ...(title && { title }),
      ...(context.currentNote && { currentNote: context.currentNote }),
    });

    return conversation.id;
  }

  private buildForkTitle(sourceTitle: string, forkAtUserMessage?: number): string {
    const MAX_TITLE_LENGTH = 50;
    const forkSuffix = forkAtUserMessage ? ` (#${forkAtUserMessage})` : '';
    const forkPrefix = 'Fork: ';
    const maxSourceLength = MAX_TITLE_LENGTH - forkPrefix.length - forkSuffix.length;
    const truncatedSource = sourceTitle.length > maxSourceLength
      ? sourceTitle.slice(0, maxSourceLength - 1) + '…'
      : sourceTitle;
    let title = forkPrefix + truncatedSource + forkSuffix;

    const existingTitles = new Set(this.plugin.getConversationList().map(c => c.title));
    if (existingTitles.has(title)) {
      let n = 2;
      while (existingTitles.has(`${title} ${n}`)) n++;
      title = `${title} ${n}`;
    }

    return title;
  }

  // ============================================
  // Persistence
  // ============================================

  /** Gets the state to persist. */
  getPersistedState(): PersistedTabManagerState {
    const openTabs: PersistedTabState[] = [];

    for (const tab of this.tabs.values()) {
      openTabs.push({
        ...(tab.lifecycleState === 'blank' && tab.draftModel
          ? { draftModel: tab.draftModel }
          : {}),
        ...(tab.lifecycleState === 'blank' && tab.draftSettings
          ? { draftSettings: tab.draftSettings }
          : {}),
        ...(tab.titleOverride ? { titleOverride: tab.titleOverride } : {}),
        ...(tab.lifecycleState === 'blank' && tab.orchestratorMode
          ? { orchestratorMode: true }
          : {}),
        tabId: tab.id,
        conversationId: tab.conversationId,
      });
    }

    return {
      openTabs,
      activeTabId: this.activeTabId,
    };
  }

  /** Restores state from persisted data. */
  async restoreState(state: PersistedTabManagerState): Promise<void> {
    this.recordRestoreEvent('restore.started', {
      hasActiveTab: !!state.activeTabId,
      tabCount: state.openTabs.length,
    });

    let restoredTabCount = 0;
    let skippedTabCount = 0;

    this.isRestoringState = true;
    try {
      // Create tabs from persisted state with error handling.
      for (const [tabIndex, tabState] of state.openTabs.entries()) {
        try {
          const tab = await this.createTab(tabState.conversationId, tabState.tabId, {
            activate: false,
            ...(typeof tabState.draftModel === 'string' ? { draftModel: tabState.draftModel } : {}),
            ...(tabState.draftSettings ? { draftSettings: tabState.draftSettings } : {}),
            ...(tabState.titleOverride ? { titleOverride: tabState.titleOverride } : {}),
            ...(tabState.orchestratorMode === true ? { orchestratorMode: true } : {}),
          });
          if (tab) {
            restoredTabCount++;
          } else {
            skippedTabCount++;
            this.recordRestoreEvent('tab.skipped', {
              hasConversation: !!tabState.conversationId,
              reason: 'create_returned_null',
              tabIndex,
            }, 'warn');
          }
        } catch (error) {
          skippedTabCount++;
          this.recordRestoreEvent('tab.failed', {
            hasConversation: !!tabState.conversationId,
            reason: 'create_failed',
            tabIndex,
          }, 'warn', error);
          // Continue restoring other tabs
        }
      }
    } finally {
      this.isRestoringState = false;
    }

    const fallbackTabId = state.openTabs.find((tabState) => this.tabs.has(tabState.tabId))?.tabId
      ?? Array.from(this.tabs.keys())[0]
      ?? null;
    const targetTabId = state.activeTabId && this.tabs.has(state.activeTabId)
      ? state.activeTabId
      : fallbackTabId;

    // Switch to the previously active tab after all tabs are restored so background
    // restore does not warm the first restored tab by accident.
    if (targetTabId) {
      try {
        await this.switchToTab(targetTabId);
      } catch (error) {
        this.recordRestoreEvent('switch.failed', {
          reason: 'switch_failed',
          restoredTabCount,
        }, 'warn', error);
        // Ignore switch errors
      }
    } else if (state.openTabs.length > 0) {
      this.recordRestoreEvent('switch.skipped', {
        reason: 'no_restored_target',
        restoredTabCount,
      }, 'warn');
    }

    // If no tabs were restored, create a default one
    if (this.tabs.size === 0) {
      try {
        await this.createTab();
        this.recordRestoreEvent('fallback.created', {
          reason: 'no_tabs_restored',
          skippedTabCount,
        }, 'warn');
      } catch (error) {
        this.recordRestoreEvent('fallback.failed', {
          reason: 'fallback_create_failed',
          skippedTabCount,
        }, 'error', error);
        throw error;
      }
    }

    this.recordRestoreEvent('restore.finished', {
      hasActiveTab: !!this.activeTabId,
      restoredTabCount,
      skippedTabCount,
      tabCount: this.tabs.size,
    }, skippedTabCount > 0 ? 'warn' : 'debug');
  }

  // ============================================
  // SDK Commands (Shared)
  // ============================================

  /**
   * Gets provider-scoped SDK supported commands for a tab.
   * Reuses a ready runtime from the same provider when available to avoid
   * leaking commands across providers in mixed-provider workspaces.
   * @returns Array of SDK commands, or empty array if no service is ready.
   */
  async getSdkCommands(tabId?: TabId): Promise<SlashCommand[]> {
    const targetTab = (tabId ? this.tabs.get(tabId) : this.getActiveTab()) ?? null;
    if (!targetTab) {
      return [];
    }

    const providerId = getTabProviderId(targetTab, this.plugin);
    const staticCapabilities = providerCatalog().capabilities(providerId);
    if (!staticCapabilities.supportsProviderCommands) {
      return [];
    }

    const runtimeCommandLoader = ProviderWorkspaceRegistry.getRuntimeCommandLoader(providerId);
    const context = await this.buildProviderWarmupContext(targetTab, providerId);
    // Read after the warm-up context, not before it: building the workspace is
    // asynchronous now, and an await placed ahead of the lifecycle checks lets
    // another tab's runtime finish becoming ready in between — which is a
    // different answer, not a slower one.
    const catalog = await this.commandsPortFor(providerId);
    if (
      targetTab.lifecycleState === 'blank'
      && runtimeCommandLoader
      && (context.warmupMode !== 'commands' || targetTab.id !== this.activeTabId)
    ) {
      catalog?.setRuntimeCommands([]);
      return [];
    }

    let sdkCommands: SlashCommand[] = [];

    const targetService = targetTab.service;
    if (targetService?.providerId === providerId && targetService.isReady()) {
      this.touchWarmRuntime(targetTab);
      sdkCommands = await targetService.getSupportedCommands();
    } else if (!runtimeCommandLoader) {
      for (const tab of this.tabs.values()) {
        if (tab.id === targetTab.id) {
          continue;
        }
        if (tab.service?.providerId === providerId && tab.service.isReady()) {
          sdkCommands = await tab.service.getSupportedCommands();
          break;
        }
      }
    }

    if (sdkCommands.length === 0) {
      sdkCommands = await this.ensureProviderCommandRuntime(targetTab, providerId, context);
    }

    catalog?.setRuntimeCommands(sdkCommands);

    return sdkCommands;
  }

  private async ensureProviderCommandRuntime(
    tab: TabData,
    providerId: ProviderId,
    warmupContext?: ProviderWarmupContext,
  ): Promise<SlashCommand[]> {
    if (!this.isProviderCommandLoaderAvailable(providerId)) {
      return [];
    }

    const resolvedWarmupContext = warmupContext
      ?? await this.buildProviderWarmupContext(tab, providerId);
    const context = this.buildProviderCommandContext(
      tab,
      providerId,
      resolvedWarmupContext,
    );
    const cached = this.providerCommandCache.get(tab.id);
    if (
      (!context.runtime || !context.runtime.isReady())
      && cached
      && cached.key === context.cacheKey
    ) {
      return cached.commands.map((command) => ({ ...command }));
    }

    const existing = this.providerCommandWarmups.get(tab.id);
    if (existing?.key === context.cacheKey) {
      return await existing.promise;
    }
    this.providerCommandWarmups.delete(tab.id);

    const warmup = this.warmProviderCommandRuntime(tab, providerId, context).finally(() => {
      if (this.providerCommandWarmups.get(tab.id)?.promise === warmup) {
        this.providerCommandWarmups.delete(tab.id);
      }
    });
    this.providerCommandWarmups.set(tab.id, {
      key: context.cacheKey,
      promise: warmup,
    });
    return await warmup;
  }

  private maybePrimeProviderRuntime(tab: TabData): void {
    void this.prewarmProviderTab(tab).catch(() => {});
  }

  private isProviderCommandLoaderAvailable(providerId: ProviderId): boolean {
    const loader = ProviderWorkspaceRegistry.getRuntimeCommandLoader(providerId);
    if (!loader) return false;
    return loader.isAvailable(this.plugin.settings);
  }

  private async prewarmProviderTab(tab: TabData): Promise<void> {
    const providerId = tab.service?.providerId ?? tab.providerId;
    const context = await this.buildProviderWarmupContext(tab, providerId);
    const hasReadyRuntime = tab.service?.providerId === providerId && tab.service.isReady();
    if (!hasReadyRuntime && tab.id !== this.activeTabId) {
      return;
    }

    switch (context.warmupMode) {
      case 'commands':
        await this.getSdkCommands(tab.id);
        return;
      case 'runtime':
        await this.ensureProviderTabRuntimeReady(tab, providerId, context);
        return;
      default:
        return;
    }
  }

  private async ensureProviderTabRuntimeReady(
    tab: TabData,
    providerId: ProviderId,
    context: ProviderWarmupContext,
  ): Promise<void> {
    if (!context.runtime || context.runtime.providerId !== providerId || !tab.serviceInitialized) {
      await initializeTabService(tab, this.plugin, {
        bindBlank: tab.lifecycleState !== 'blank',
        conversationOverride: context.conversation,
      });
      setupServiceCallbacks(tab, this.plugin);
    }

    const runtime = tab.service?.providerId === providerId ? tab.service : null;
    if (!runtime) {
      return;
    }

    runtime.syncConversationState(context.conversation);
    await runtime.ensureReady();
    this.touchWarmRuntime(tab);
    if (tab.lifecycleState === 'blank') {
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();
    }
    if (providerCatalog().capabilities(providerId).supportsProviderCommands) {
      await this.getSdkCommands(tab.id);
    }
  }

  private async buildProviderWarmupContext(
    tab: TabData,
    providerId: ProviderId,
  ): Promise<ProviderWarmupContext> {
    const conversation = tab.conversationId
      ? await this.plugin.getConversationById(tab.conversationId)
      : null;
    const hasConversationContext = this.hasStartedConversation(conversation);
    const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
      ?? (hasConversationContext
        ? conversation?.externalContextPaths ?? []
        : this.plugin.settings.persistentExternalContextPaths ?? []);
    const runtime = tab.service?.providerId === providerId ? tab.service : null;
    const warmupMode = this.resolveProviderTabWarmupMode(providerId);

    return {
      conversation,
      externalContextPaths,
      runtime,
      tab: {
        conversationId: tab.conversationId,
        draftModel: tab.draftModel,
        lifecycleState: tab.lifecycleState,
        providerId,
      },
      warmupMode,
    };
  }

  /**
   * How much of this tab's provider to prime before anything is sent.
   *
   * **Read from the catalog's declaration, not from a workspace service.** It
   * used to be a policy taking the conversation, the plugin, the runtime and
   * the tab's lifecycle state — and every provider that had one returned a
   * constant and read none of it. A declaration is what it always was.
   */
  private resolveProviderTabWarmupMode(providerId: ProviderId): ProviderWarmupMode {
    return providerCatalog().declarations(providerId).warmup;
  }

  private buildProviderCommandContext(
    tab: TabData,
    providerId: ProviderId,
    warmupContext: ProviderWarmupContext,
  ): ProviderCommandContext {
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      providerId,
    );

    return {
      ...warmupContext,
      cacheKey: JSON.stringify({
        allowSessionCreation: warmupContext.warmupMode === 'commands'
          && tab.lifecycleState === 'blank'
          && tab.id === this.activeTabId,
        conversationId: warmupContext.conversation?.id ?? null,
        draftModel: tab.draftModel ?? null,
        externalContextPaths: warmupContext.externalContextPaths,
        lifecycleState: tab.lifecycleState,
        providerId,
        providerSettings,
        providerState: getOpaqueProviderState(warmupContext.conversation) ?? null,
        sessionId: warmupContext.conversation?.sessionId ?? null,
        warmupMode: warmupContext.warmupMode,
      }),
    };
  }

  private async warmProviderCommandRuntime(
    tab: TabData,
    providerId: ProviderId,
    context: ProviderCommandContext,
  ): Promise<SlashCommand[]> {
    const catalog = await this.commandsPortFor(providerId);
    const loader = ProviderWorkspaceRegistry.getRuntimeCommandLoader(providerId);
    if (!catalog || !loader) {
      return [];
    }
    const commands = await loader.loadCommands({
      allowSessionCreation: context.warmupMode === 'commands'
        && tab.lifecycleState === 'blank'
        && tab.id === this.activeTabId,
      conversation: context.conversation,
      externalContextPaths: context.externalContextPaths,
      plugin: this.plugin,
      runtime: context.runtime,
    });

    if (!context.runtime || !context.runtime.isReady()) {
      this.providerCommandCache.set(tab.id, {
        key: context.cacheKey,
        commands: commands.map((command) => ({ ...command })),
      });
    } else {
      this.providerCommandCache.delete(tab.id);
    }
    catalog.setRuntimeCommands(commands);
    return commands;
  }

  private touchWarmRuntime(tab: TabData): void {
    const runtime = tab.service;
    if (!runtime || typeof runtime.isReady !== 'function' || !runtime.isReady()) {
      this.warmRuntimes.remove(tab.id);
      this.trimWarmRuntimes();
      return;
    }

    this.warmRuntimes.touch(tab.id, runtime);
    this.trimWarmRuntimes();
  }

  private trimWarmRuntimes(): void {
    this.warmRuntimes.trim({
      isLive: (tabId, runtime) => {
        const tab = this.tabs.get(tabId);
        return tab?.service === runtime
          && typeof runtime.isReady === 'function'
          && runtime.isReady();
      },
      isProtected: (tabId) => {
        const tab = this.tabs.get(tabId);
        return tabId === this.activeTabId || tab?.state.isStreaming === true;
      },
      onEvict: (tabId, runtime) => {
        const tab = this.tabs.get(tabId);
        if (!tab || tab.service !== runtime) {
          return;
        }

        void runtime.cleanup();
        tab.service = null;
        tab.serviceInitialized = false;
        if (tab.lifecycleState === 'bound_active') {
          tab.lifecycleState = 'bound_cold';
        }
        this.providerCommandWarmups.delete(tabId);
        this.plugin.recordDebugLog?.({
          data: {
            limit: MAX_WARM_PROVIDER_RUNTIMES,
            providerId: runtime.providerId,
            reason: 'lru_limit',
          },
          event: 'runtime.warm.evicted',
          level: 'debug',
          scope: 'tabs.runtime',
        });
      },
    });
  }

  // ============================================
  // Provider Command Catalog
  // ============================================

  /**
   * The provider's command catalog, built on demand.
   *
   * Every caller is already asynchronous. The one that was not —
   * `getProviderCatalogConfig` — needed only the dropdown's trigger characters
   * synchronously, and those are a declaration now.
   */
  private async commandsPortFor(providerId: ProviderId): Promise<ProviderCommandsPort | undefined> {
    return (await this.plugin.getApplicationRuntimeOrNull()?.workspaceFor(providerId))?.commands;
  }

  private getProviderCatalogConfig(tab: TabData) {
    const providerId = getTabProviderId(tab, this.plugin);
    const dropdown = providerCatalog().declarations(providerId).commandDropdown;
    if (!dropdown) return null;

    return {
      config: { providerId, ...dropdown },
      getEntries: async () => {
        await this.getSdkCommands(tab.id);
        return (await this.commandsPortFor(providerId))
          ?.listDropdownEntries({ includeBuiltIns: false }) ?? [];
      },
    };
  }

  // ============================================
  // Broadcast
  // ============================================

  /**
   * Broadcasts a function call to all initialized tab runtimes.
   * Used by settings managers to apply configuration changes to all tabs.
   * @param fn Function to call on each runtime.
   */
  async broadcastToAllTabs(fn: (service: ExecutionChatRuntimeAdapter) => Promise<void>): Promise<void> {
    await this.broadcastToTabs(this.tabs.values(), fn);
  }

  async broadcastToProviderTabs(
    providerIds: ProviderId | ProviderId[],
    fn: (service: ExecutionChatRuntimeAdapter) => Promise<void>,
  ): Promise<void> {
    await this.broadcastToTabs(
      this.filterTabsByProvider(providerIds, (tab) => tab.service?.providerId ?? tab.providerId),
      fn,
    );
  }

  private async broadcastToTabs(
    tabs: Iterable<TabData>,
    fn: (service: ExecutionChatRuntimeAdapter) => Promise<void>,
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const tab of tabs) {
      if (tab.service && tab.serviceInitialized) {
        promises.push(
          fn(tab.service).catch(() => {
            // Silently ignore broadcast errors
          })
        );
      }
    }

    await Promise.all(promises);
  }

  // ============================================
  // Cleanup
  // ============================================

  /** Destroys all tabs and cleans up resources. */
  async destroy(): Promise<void> {
    // Save all conversations in parallel (independent per-tab)
    await Promise.all(
      Array.from(this.tabs.values()).map(
        tab => tab.controllers.conversationController?.save() ?? Promise.resolve()
      )
    );

    // Destroy all tabs in parallel (independent per-tab, must run after saves complete)
    await Promise.all(Array.from(this.tabs.values()).map(tab => destroyTab(tab)));

    this.warmRuntimes.clear();
    this.tabs.clear();
    this.activeTabId = null;
  }
}
