import type { Component } from 'obsidian';
import { Notice, setIcon, TFile } from 'obsidian';

import { formatGrimoireVersion } from '../../../app/version';
import { ProjectWorkspaceStore } from '../../../core/context/ProjectWorkspaceStore';
import { RelevantNotesService } from '../../../core/context/RelevantNotesService';
import { VaultSearchService } from '../../../core/context/VaultSearchService';
import { VaultTextIndex } from '../../../core/context/VaultTextIndex';
import { getHiddenProviderCommandSet } from '../../../core/providers/commands/hiddenCommands';
import type { ProviderCommandDropdownConfig } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { getEnabledProviderForModel, getProviderForModel } from '../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderId,
  ProviderPlanUsage,
  ProviderPlanUsageWindow,
  ProviderUIOption,
} from '../../../core/providers/types';
import {
  DEFAULT_CHAT_PROVIDER_ID,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { AutoTurnResult } from '../../../core/runtime/types';
import { TOOL_AGENT_OUTPUT } from '../../../core/tools/toolNames';
import {
  type ChatMessage,
  type Conversation,
  type GrimoireSettings,
  type StreamChunk,
  type UsageInfo,
  VIEW_TYPE_GRIMOIRE,
} from '../../../core/types';
import {
  coercePermissionMode,
  LEGACY_YOLO_PERMISSION_MODE,
} from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { SlashCommandDropdown } from '../../../shared/components/SlashCommandDropdown';
import { getEnhancedPath } from '../../../utils/env';
import { validateContextPath } from '../../../utils/externalContext';
import { getVaultPath } from '../../../utils/path';
import { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import { updateContextRowHasContent } from '../controllers/contextRowVisibility';
import { ConversationController } from '../controllers/ConversationController';
import { InputController } from '../controllers/InputController';
import { NavigationController } from '../controllers/NavigationController';
import { SelectionController } from '../controllers/SelectionController';
import { StreamController } from '../controllers/StreamController';
import { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { findRewindContext } from '../rewind';
import { BangBashService } from '../services/BangBashService';
import { SubagentManager } from '../services/SubagentManager';
import { ChatState } from '../state/ChatState';
import { BangBashModeManager as BangBashModeManagerClass } from '../ui/BangBashModeManager';
import { RuntimeContextActivityView } from '../ui/context/RuntimeContextActivity';
import { FileContextManager } from '../ui/FileContext';
import { ImageContextManager } from '../ui/ImageContext';
import { createInputResizeHandle } from '../ui/inputResizeHandle';
import { createInputToolbar } from '../ui/InputToolbar';
import { InstructionModeManager as InstructionModeManagerClass } from '../ui/InstructionModeManager';
import { NavigationSidebar } from '../ui/NavigationSidebar';
import { type RelevantNotesCurrentSource, RelevantNotesView } from '../ui/RelevantNotesView';
import { StatusPanel } from '../ui/StatusPanel';
import { autoResizeTextarea } from '../ui/textareaResize';
import { buildAssistantResponseMetadata } from '../utils/assistantResponseMetadata';
import { recalculateUsageForModel } from '../utils/usageInfo';
import { getTabProviderId } from './providerResolution';
import type { TabData, TabDOMElements, TabId, TabPanelView, TabProviderContext } from './types';
import { generateTabId } from './types';

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 20;
const AUTO_SCROLL_REENABLE_DELAY_MS = 150;
const SCROLL_RESUME_ICON_PATH = 'M12 17 6 11l1.4-1.4 4.6 4.6 4.6-4.6L18 11l-6 6Zm0-6L6 5l1.4-1.4 4.6 4.6 4.6-4.6L18 5l-6 6Z';
const SVG_NS = 'http://www.w3.org/2000/svg';

function getBasename(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || filePath;
}

function getOrCreateExternalFileIndicator(tab: TabData): HTMLElement {
  const existing = tab.dom.contextRowEl.querySelector('.grimoire-external-file-indicator');
  if (existing) {
    return existing as HTMLElement;
  }
  return tab.dom.contextRowEl.createDiv({ cls: 'grimoire-external-file-indicator grimoire-hidden' });
}

function isExternalFilePath(contextPath: string): boolean {
  return validateContextPath(contextPath).type === 'file';
}

function getSelectedExternalFilePaths(tab: TabData): string[] {
  return (tab.ui.externalContextSelector?.getExternalContexts() ?? []).filter(isExternalFilePath);
}

function renderExternalFileChips(tab: TabData, selectedFilePath?: string): void {
  const indicatorEl = getOrCreateExternalFileIndicator(tab);
  const filePaths = getSelectedExternalFilePaths(tab);
  const selectedPaths = selectedFilePath && !filePaths.includes(selectedFilePath)
    ? [...filePaths, selectedFilePath]
    : filePaths;

  indicatorEl.empty();

  if (selectedPaths.length === 0) {
    indicatorEl.removeClass('grimoire-visible-flex');
    indicatorEl.addClass('grimoire-hidden');
    updateContextRowHasContent(tab.dom.contextRowEl);
    return;
  }

  indicatorEl.addClass('grimoire-visible-flex');
  indicatorEl.removeClass('grimoire-hidden');

  for (const filePath of selectedPaths) {
    const chipEl = indicatorEl.createSpan({ cls: 'grimoire-external-file-chip' });
    chipEl.setAttribute('title', filePath);
    const iconEl = chipEl.createSpan({ cls: 'grimoire-external-file-chip-icon' });
    setIcon(iconEl, 'file');
    chipEl.createSpan({
      cls: 'grimoire-external-file-chip-name',
      text: getBasename(filePath),
    });
    const removeEl = chipEl.createSpan({
      cls: 'grimoire-external-file-chip-remove',
      text: '\u00D7',
      attr: { 'aria-label': 'Remove external file' },
    });
    removeEl.addEventListener('click', (event) => {
      event.stopPropagation();
      tab.ui.externalContextSelector?.removePath(filePath);
      renderExternalFileChips(tab);
    });
  }

  updateContextRowHasContent(tab.dom.contextRowEl);
}

type TabProviderSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  customContextLimits?: Record<string, number>;
};

const DRAFT_SETTINGS_KEYS = [
  'model',
  'thinkingBudget',
  'effortLevel',
  'serviceTier',
  'permissionMode',
] as const;

type ContextEngineRelevantSettings = GrimoireSettings & {
  contextEngine?: {
    relevantNotesEnabled?: boolean;
    relevantNotesMaxResults?: number;
  };
};

/**
 * Returns model options for a blank tab.
 * Uses provider registration metadata to determine which providers are
 * available and how they should appear in the mixed picker.
 */
export function getBlankTabModelOptions(
  settings: Record<string, unknown>,
): ProviderUIOption[] {
  return ProviderRegistry.getEnabledProviderIds(settings).flatMap((providerId) => {
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const providerIcon = uiConfig.getProviderIcon?.() ?? undefined;
    const group = ProviderRegistry.getProviderDisplayName(providerId);

    return uiConfig.getModelOptions(settings)
      .map(model => ({
        ...model,
        group,
        providerId,
        ...(providerIcon ? { providerIcon } : {}),
      }));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRecordEntry(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function hasStartedConversation(conversation: Conversation | null | undefined): conversation is Conversation {
  if (!conversation) {
    return false;
  }
  if (conversation.messages.length > 0) {
    return true;
  }
  try {
    const historyService = ProviderRegistry.getConversationHistoryService(conversation.providerId);
    return !!historyService.resolveSessionIdForConversation?.(conversation);
  } catch {
    return !!conversation.sessionId;
  }
}

function cloneSerializableValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return undefined;
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const next = value
      .map(item => cloneSerializableValue(item, depth + 1))
      .filter(item => item !== undefined);
    return next;
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const cloned = cloneSerializableValue(entry, depth + 1);
      if (cloned !== undefined) {
        next[key] = cloned;
      }
    }
    return next;
  }
  return undefined;
}

function cloneSerializableRecord(value: unknown): Record<string, unknown> | null {
  const cloned = cloneSerializableValue(value);
  return isRecord(cloned) ? cloned : null;
}

function createDraftSettingsSnapshot(
  settings: Record<string, unknown>,
  providerId: ProviderId,
): Record<string, unknown> {
  const draftSettings: Record<string, unknown> = {};

  for (const key of DRAFT_SETTINGS_KEYS) {
    const value = settings[key];
    if (typeof value === 'string') {
      draftSettings[key] = value;
    }
  }

  const providerConfigs = isRecord(settings.providerConfigs)
    ? settings.providerConfigs
    : null;
  const providerConfig = providerConfigs ? cloneSerializableRecord(providerConfigs[providerId]) : null;
  if (providerConfig) {
    draftSettings.providerConfigs = {
      [providerId]: providerConfig,
    };
  }

  return draftSettings;
}

function mergeDraftSettingsSnapshot(
  baseSettings: TabProviderSettings,
  draftSettings: Record<string, unknown> | null,
  providerId: ProviderId,
): TabProviderSettings {
  if (!draftSettings) {
    return baseSettings;
  }

  const merged: TabProviderSettings = {
    ...baseSettings,
    ...draftSettings,
  };

  const baseProviderConfigs = isRecord(baseSettings.providerConfigs)
    ? baseSettings.providerConfigs
    : {};
  const draftProviderConfigs = isRecord(draftSettings.providerConfigs)
    ? draftSettings.providerConfigs
    : {};
  const baseProviderConfig = getRecordEntry(baseProviderConfigs, providerId) ?? {};
  const draftProviderConfig = getRecordEntry(draftProviderConfigs, providerId);

  if (draftProviderConfig) {
    const providerConfig: Record<string, unknown> = {
      ...baseProviderConfig,
      ...draftProviderConfig,
    };
    const providerConfigs: Record<string, unknown> = {
      ...baseProviderConfigs,
      [providerId]: providerConfig,
    };
    merged.providerConfigs = providerConfigs;
  } else {
    merged.providerConfigs = baseProviderConfigs;
  }

  return merged;
}

function appendScrollResumeIcon(buttonEl: HTMLButtonElement): void {
  const ownerDocument = buttonEl.ownerDocument;
  const svg = ownerDocument.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'currentColor');

  const path = ownerDocument.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SCROLL_RESUME_ICON_PATH);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  buttonEl.appendChild(svg);
}

/**
 * Resolves the draft model for a new blank tab by projecting provider-specific
 * saved settings. Without this, `plugin.settings.model` reflects only the
 * settings-provider's model, which may belong to a different provider.
 */
function resolveBlankTabModel(
  plugin: GrimoirePlugin,
  providerId?: ProviderId,
): string {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  if (!providerId) {
    return settings.model as string;
  }

  const targetProviderId = ProviderRegistry.isEnabled(providerId, settings)
    ? providerId
    : ProviderRegistry.resolveSettingsProviderId(settings);
  const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, targetProviderId);
  return snapshot.model as string;
}

export interface TabCreateOptions {
  plugin: GrimoirePlugin;

  containerEl: HTMLElement;
  conversation?: Conversation;
  tabId?: TabId;
  /** Restored draft model for blank tabs. */
  draftModel?: string | null;
  /** Restored draft provider settings for blank tabs. */
  draftSettings?: Record<string, unknown> | null;
  /** Restored tab-scoped orchestrator mode for blank tabs. */
  orchestratorMode?: boolean;
  /** Provider to inherit for blank tabs (e.g. from the active tab). */
  defaultProviderId?: ProviderId;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onConversationIdChanged?: (conversationId: string | null) => void;
}

export { getTabProviderId } from './providerResolution';

function getTabCapabilities(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): ProviderCapabilities {
  const providerId = getTabProviderId(tab, plugin, conversation);
  if (tab.service?.providerId === providerId) {
    return tab.service.getCapabilities();
  }

  return ProviderRegistry.getCapabilities(providerId);
}

function getTabChatUIConfig(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): ProviderChatUIConfig {
  return ProviderRegistry.getChatUIConfig(getTabProviderId(tab, plugin, conversation));
}

function getTabSettingsSnapshot(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
): TabProviderSettings {
  const providerId = getTabProviderId(tab, plugin);
  const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
    plugin.settings,
    providerId,
  );
  if (tab.lifecycleState === 'blank') {
    return mergeDraftSettingsSnapshot(snapshot, tab.draftSettings, providerId);
  }
  return snapshot;
}

function getTabPermissionMode(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
): string {
  const permissionMode = getTabSettingsSnapshot(tab, plugin).permissionMode;
  return typeof permissionMode === 'string' && permissionMode
    ? permissionMode
    : 'normal';
}

function getTabHiddenCommands(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): Set<string> {
  return getHiddenProviderCommandSet(
    plugin.settings,
    getTabProviderId(tab, plugin, conversation),
  );
}

function shouldSendMessageFromEnterKey(
  e: KeyboardEvent,
  settings: Pick<GrimoireSettings, 'requireCommandOrControlEnterToSend'>,
): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) {
    return false;
  }

  return settings.requireCommandOrControlEnterToSend !== true;
}

type ProviderCatalogInfo = {
  config: ProviderCommandDropdownConfig;
  getEntries: () => Promise<ProviderCommandEntry[]>;
} | null;

function getRegistryProviderCatalogInfo(providerId: ProviderId): ProviderCatalogInfo {
  const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
  if (!catalog) {
    return null;
  }

  return {
    config: catalog.getDropdownConfig(),
    getEntries: () => catalog.listDropdownEntries({ includeBuiltIns: false }),
  };
}

function getProviderMcpManager(providerId: ProviderId) {
  return ProviderWorkspaceRegistry.getMcpServerManager(providerId);
}

function getProviderUsageSnapshot(plugin: GrimoirePlugin, providerId: ProviderId): ProviderPlanUsage | null {
  const usageProvider = ProviderWorkspaceRegistry.getUsageProvider(providerId);
  if (!usageProvider || usageProvider.isAvailable?.(plugin.settings) === false) {
    return null;
  }

  return usageProvider.getCachedUsage({
    plugin,
    providerId,
    settings: plugin.settings,
  });
}

function summarizeUsageWindow(window: ProviderPlanUsageWindow): Record<string, unknown> {
  return {
    label: window.label,
    pct: window.pct,
    ...(window.pctKnown === false ? { pctKnown: false } : {}),
    reset: window.reset,
  };
}

function summarizePlanUsage(usage: ProviderPlanUsage | null): Record<string, unknown> {
  if (!usage) {
    return { usageKind: 'none' };
  }

  return {
    hasSpend: typeof usage.spend === 'string' && usage.spend.trim().length > 0,
    plan: usage.plan,
    usageKind: usage.windows?.length && usage.spend ? 'hybrid' : usage.windows?.length ? 'quota' : 'spend',
    ...(usage.windows?.length ? {
      windowCount: usage.windows.length,
      windows: usage.windows.map(summarizeUsageWindow),
    } : {}),
  };
}

async function refreshProviderUsageSnapshot(plugin: GrimoirePlugin, providerId: ProviderId): Promise<ProviderPlanUsage | null> {
  const usageProvider = ProviderWorkspaceRegistry.getUsageProvider(providerId);
  if (!usageProvider) {
    plugin.recordDebugLog?.({
      data: {
        providerId,
        reason: 'missing_usage_provider',
      },
      event: 'refresh.skipped',
      level: 'debug',
      scope: 'usage',
    });
    return getProviderUsageSnapshot(plugin, providerId);
  }

  if (usageProvider.isAvailable?.(plugin.settings) === false) {
    plugin.recordDebugLog?.({
      data: {
        providerId,
        reason: 'provider_unavailable',
      },
      event: 'refresh.skipped',
      level: 'debug',
      scope: 'usage',
    });
    return getProviderUsageSnapshot(plugin, providerId);
  }

  plugin.recordDebugLog?.({
    data: { providerId },
    event: 'refresh.started',
    level: 'debug',
    scope: 'usage',
  });

  try {
    const usage = await usageProvider.refreshUsage({
      plugin,
      providerId,
      settings: plugin.settings,
    });
    plugin.recordDebugLog?.({
      data: {
        providerId,
        ...summarizePlanUsage(usage),
      },
      event: usage ? 'refresh.succeeded' : 'refresh.empty',
      level: usage ? 'info' : 'debug',
      scope: 'usage',
    });
    return usage;
  } catch (error) {
    plugin.recordDebugLog?.({
      data: { providerId },
      error,
      event: 'refresh.failed',
      level: 'warn',
      scope: 'usage',
    });
    throw error;
  }
}

function refreshPlanUsageUI(tab: TabData): void {
  tab.ui.planUsageBadge?.updateDisplay();
  tab.ui.planUsageBadge?.refreshInBackground();
  tab.ui.modelSelector?.renderOptions();
}

export function refreshRuntimeContextUI(tab: TabData, plugin: GrimoirePlugin): void {
  if (!tab.ui.runtimeContextActivity || !tab.state) {
    return;
  }

  const providerId = getTabProviderId(tab, plugin);
  tab.ui.runtimeContextActivity.hydrateFromMessages(providerId, tab.state.messages);
  recordProviderLaunchArtifacts(tab, plugin);
}

function recordProviderLaunchArtifacts(tab: TabData, plugin: GrimoirePlugin): void {
  const providerId = getTabProviderId(tab, plugin);
  if (providerId !== 'grok') {
    return;
  }

  tab.ui.runtimeContextActivity?.recordPreloadedFile(
    providerId,
    '.grimoire/grok/system.md',
  );
}

function syncSlashCommandDropdownForProvider(
  tab: TabData,
  plugin: GrimoirePlugin,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
  conversation?: Conversation | null,
): void {
  const dropdown = tab.ui.slashCommandDropdown;
  if (!dropdown) {
    return;
  }

  const catalogInfo = getProviderCatalogConfig?.()
    ?? getRegistryProviderCatalogInfo(getTabProviderId(tab, plugin, conversation));

  if (catalogInfo) {
    dropdown.setProviderCatalog?.(catalogInfo.config, catalogInfo.getEntries);
  } else {
    dropdown.resetSdkSkillsCache();
  }

  dropdown.setHiddenCommands(getTabHiddenCommands(tab, plugin, conversation));
}

async function updateTabProviderSettings(
  tab: TabData,
  plugin: GrimoirePlugin,
  update: (settings: TabProviderSettings) => void,
  onBlankDraftSettingsChanged?: (
    providerId: ProviderId,
    settings: Record<string, unknown>,
  ) => void | Promise<void>,
): Promise<TabProviderSettings> {
  const providerId = getTabProviderId(tab, plugin);
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  update(snapshot);
  if (tab.lifecycleState === 'blank') {
    tab.draftSettings = createDraftSettingsSnapshot(snapshot, providerId);
    plugin.settings.settingsProvider = providerId;
    snapshot.settingsProvider = providerId;
  }
  ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
    plugin.settings,
    providerId,
    snapshot,
  );
  await plugin.saveSettings();
  if (tab.lifecycleState === 'blank' && tab.draftSettings) {
    runDraftSettingsChangedInBackground(
      onBlankDraftSettingsChanged,
      providerId,
      tab.draftSettings,
    );
  }
  return snapshot;
}

async function applyBlankDraftSettings(
  tab: TabData,
  plugin: GrimoirePlugin,
  providerId: ProviderId,
): Promise<void> {
  if (tab.lifecycleState !== 'blank' || !tab.draftSettings) {
    return;
  }

  const snapshot = getTabSettingsSnapshot(tab, plugin);
  plugin.settings.settingsProvider = providerId;
  snapshot.settingsProvider = providerId;
  ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
    plugin.settings,
    providerId,
    snapshot,
  );
  await plugin.saveSettings();
}

function runProviderChangedInBackground(
  callback: ((providerId: ProviderId) => void | Promise<void>) | undefined,
  providerId: ProviderId,
): void {
  if (!callback) {
    return;
  }

  try {
    void Promise.resolve(callback(providerId)).catch(() => {});
  } catch {
    // Provider warmup is opportunistic; model selection must stay responsive.
  }
}

function runDraftSettingsChangedInBackground(
  callback: ((providerId: ProviderId, settings: Record<string, unknown>) => void | Promise<void>) | undefined,
  providerId: ProviderId,
  settings: Record<string, unknown>,
): void {
  if (!callback) {
    return;
  }

  try {
    void Promise.resolve(callback(providerId, settings)).catch(() => {});
  } catch {
    // Draft persistence must never block model selection.
  }
}

function refreshTabProviderUI(tab: TabData, plugin: GrimoirePlugin): void {
  const capabilities = getTabCapabilities(tab, plugin);
  const permissionMode = getTabPermissionMode(tab, plugin);
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
    permissionMode === 'plan' && capabilities.supportsPlanMode,
  );
  syncContextSummary(tab, plugin);
  syncBoundStatus(tab, plugin);
}

function prepareModelMetadataInBackground(
  tab: TabData,
  plugin: GrimoirePlugin,
  providerId: ProviderId,
  model: string,
  uiConfig: ProviderChatUIConfig,
): void {
  let metadataWarmup: Promise<void> | void;
  try {
    metadataWarmup = uiConfig.prepareModelMetadata?.(model, plugin.settings, { plugin });
  } catch {
    return;
  }

  if (!metadataWarmup) {
    return;
  }

  void Promise.resolve(metadataWarmup)
    .then(() => {
      if (getTabProviderId(tab, plugin) !== providerId) {
        return;
      }
      if (getTabSettingsSnapshot(tab, plugin).model !== model) {
        return;
      }
      refreshTabProviderUI(tab, plugin);
    })
    .catch(() => {});
}

function syncContextSummary(tab: TabData, plugin: GrimoirePlugin): void {
  const { contextSummaryEl } = tab.dom;
  contextSummaryEl.empty();

  const providerId = getTabProviderId(tab, plugin);
  const settings = getTabSettingsSnapshot(tab, plugin);
  const providerName = ProviderRegistry.getProviderDisplayName(providerId);
  const reasoningLabel = getReasoningLabel(settings);
  const currentPath = tab.ui.fileContextManager?.getCurrentNotePath() ?? '';

  appendContextSummaryRow(
    contextSummaryEl,
    currentPath ? getPathTitle(currentPath) : 'No note selected',
    currentPath ? 'bound to this chat tab' : 'open a note to bind it to this chat',
    currentPath ? 'active' : 'idle',
    Boolean(currentPath),
  );

  const selectedExternalFiles = getSelectedExternalFilePaths(tab);
  if (selectedExternalFiles.length > 0) {
    appendContextSummaryRow(
      contextSummaryEl,
      selectedExternalFiles.length === 1 ? 'Selected file' : 'Selected files',
      selectedExternalFiles.map(getBasename).join(', '),
      'files',
      true,
    );
  }

  appendContextSummaryRow(
    contextSummaryEl,
    getModelSummaryLabel(providerId, settings),
    `${providerName}${reasoningLabel ? ` · ${reasoningLabel}` : ''} · provider state preserved`,
    'model',
    false,
  );

  const permissionMode = getTabPermissionMode(tab, plugin);
  appendContextSummaryRow(
    contextSummaryEl,
    getPermissionTitle(providerId, permissionMode),
    getPermissionSummary(providerId, permissionMode),
    formatPermissionBadge(permissionMode),
    permissionMode !== 'full_access',
  );
}

function getModelSummaryLabel(providerId: ProviderId, settings: TabProviderSettings): string {
  const model = settings.model || '';
  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
  const modelInfo = uiConfig.getModelOptions(settings).find(option => option.value === model);
  return modelInfo?.label ?? formatModelFallbackLabel(model);
}

function formatModelFallbackLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return 'Unknown';
  }
  if (/^gpt-/i.test(trimmed)) {
    return trimmed
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-([a-z])/gi, (_, letter: string) => ` ${letter.toUpperCase()}`);
  }
  const readable = trimmed
    .replace(/^claude[-_/]/i, '')
    .replace(/-(\d+)-(\d+)/g, ' $1.$2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
  return readable;
}

function syncBoundStatus(tab: TabData, plugin: GrimoirePlugin): void {
  const fileContextManager = tab.ui.fileContextManager;
  const currentPath = fileContextManager?.getCurrentNotePath() ?? '';
  const attachedFiles = typeof fileContextManager?.getAttachedFiles === 'function'
    ? fileContextManager.getAttachedFiles()
    : new Set<string>();
  const hasContext = Boolean(currentPath) || attachedFiles.size > 0;

  tab.dom.boundStatusEl.toggleClass('grimoire-hidden', !hasContext);
  tab.dom.boundStatusDotEl.toggleClass('busy', tab.state.isStreaming);

  if (!hasContext) {
    tab.dom.boundStatusNoteEl.setText('');
    tab.dom.boundStatusMetaEl.setText('');
    return;
  }

  const permissionMode = getTabPermissionMode(tab, plugin);
  const safeLabel = getPermissionInlineLabel(getTabProviderId(tab, plugin), permissionMode);
  const linkedCount = attachedFiles.size;

  tab.dom.boundStatusNoteEl.setText(currentPath ? getPathTitle(currentPath) : 'Attached context');
  tab.dom.boundStatusMetaEl.setText(`${linkedCount} linked ${linkedCount === 1 ? 'note' : 'notes'} · ${safeLabel}`);
}

function syncComposerStopButton(tab: TabData): void {
  tab.dom.stopButtonEl?.toggleClass('grimoire-hidden', !tab.state.isStreaming);
}

function appendContextSummaryRow(
  parentEl: HTMLElement,
  title: string,
  detail: string,
  badge: string,
  accent: boolean,
): void {
  const rowEl = parentEl.createDiv({ cls: 'grimoire-context-summary-row' });
  const copyEl = rowEl.createDiv({ cls: 'grimoire-context-summary-copy' });
  copyEl.createEl('strong', { cls: 'grimoire-context-summary-title', text: title });
  copyEl.createSpan({ cls: 'grimoire-context-summary-detail', text: detail });
  rowEl.createSpan({
    cls: `grimoire-context-summary-badge${accent ? ' is-active' : ''}`,
    text: badge,
  });
}

function getReasoningLabel(settings: TabProviderSettings): string {
  if (settings.effortLevel) {
    return `${settings.effortLevel} effort`;
  }
  if (settings.thinkingBudget && settings.thinkingBudget !== 'off') {
    return `${settings.thinkingBudget} thinking`;
  }
  return '';
}

function getPermissionSummary(providerId: ProviderId, permissionMode: string): string {
  const toggle = ProviderRegistry.getChatUIConfig(providerId).getPermissionModeToggle?.() ?? null;
  if (toggle) {
    if (permissionMode === toggle.activeValue && toggle.activeDescription) {
      return toggle.activeDescription;
    }
    if (permissionMode === toggle.inactiveValue && toggle.inactiveDescription) {
      return toggle.inactiveDescription;
    }
    if (permissionMode === toggle.planValue && toggle.planDescription) {
      return toggle.planDescription;
    }
  }
  if (permissionMode === 'plan') {
    return 'plan before tool execution';
  }
  return 'ask before file edits and MCP writes';
}

function getPermissionTitle(providerId: ProviderId, permissionMode: string): string {
  const toggle = ProviderRegistry.getChatUIConfig(providerId).getPermissionModeToggle?.() ?? null;
  if (toggle) {
    if (permissionMode === toggle.activeValue) {
      return toggle.activeLabel;
    }
    if (permissionMode === toggle.inactiveValue) {
      return toggle.inactiveLabel;
    }
    if (permissionMode === toggle.planValue) {
      return toggle.planLabel ?? 'Plan mode';
    }
  }
  if (permissionMode === 'plan') {
    return 'Plan mode';
  }
  if (permissionMode === 'full_access') {
    return 'Auto-approve';
  }
  return 'Safe mode';
}

function getPermissionInlineLabel(providerId: ProviderId, permissionMode: string): string {
  const title = getPermissionTitle(providerId, permissionMode);
  return title.toLowerCase();
}

function formatPermissionBadge(permissionMode: string): string {
  if (permissionMode === 'full_access') {
    return 'auto';
  }
  if (permissionMode === 'plan') {
    return 'plan';
  }
  return 'on';
}

/**
 * Hides or disables UI elements that the active provider does not support.
 * Called after toolbar initialization and on provider switches.
 */
function applyProviderUIGating(tab: TabData, plugin: GrimoirePlugin): void {
  const capabilities = getTabCapabilities(tab, plugin);
  const uiConfig = getTabChatUIConfig(tab, plugin);
  const mcpManager = capabilities.supportsMcpTools
    ? getProviderMcpManager(capabilities.providerId)
    : null;
  const hasPermissionToggle = Boolean(uiConfig.getPermissionModeToggle?.());

  if (!capabilities.supportsMcpTools) {
    tab.ui.mcpServerSelector?.clearEnabled();
  }
  tab.ui.mcpServerSelector?.setVisible(capabilities.supportsMcpTools);
  tab.ui.permissionToggle?.setVisible(hasPermissionToggle);
  tab.ui.fileContextManager?.setMcpManager(mcpManager);

  tab.ui.fileContextManager?.setAgentService(
    ProviderWorkspaceRegistry.getAgentMentionProvider(capabilities.providerId),
  );

  tab.ui.imageContextManager?.setEnabled(capabilities.supportsImageAttachments);
  tab.ui.contextUsageMeter?.update(tab.state.usage);
}

function syncTabProviderServices(
  tab: TabData,
  plugin: GrimoirePlugin,
): void {
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = ProviderRegistry.createInstructionRefineService(plugin, tab.providerId);
  tab.services.subagentManager.setTaskResultInterpreter?.(
    ProviderRegistry.getTaskResultInterpreter(tab.providerId)
  );
}

function ensureTitleGenerationService(tab: TabData, plugin: GrimoirePlugin): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = ProviderRegistry.createTitleGenerationService(plugin);
  }
}

function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === 'function') {
    tab.service.cleanup();
  }
  tab.service = null;
  tab.serviceInitialized = false;
}

/**
 * Called when provider availability changes. If a blank tab targets a provider
 * that is now disabled, it falls back to the first enabled provider's default
 * blank-tab model. Refreshes model selector options for all blank tabs.
 */
export function onProviderAvailabilityChanged(tab: TabData, plugin: GrimoirePlugin): void {
  if (tab.lifecycleState !== 'blank') return;

  const settingsSnapshot = plugin.settings as unknown as Record<string, unknown>;
  const enabledProviderIds = ProviderRegistry.getEnabledProviderIds(settingsSnapshot);
  if (enabledProviderIds.length === 0) {
    cleanupTabRuntime(tab);
    tab.ui.modelSelector?.updateDisplay();
    tab.ui.modelSelector?.renderOptions();
    tab.ui.planUsageBadge?.updateDisplay();
    return;
  }

  let nextProviderId = tab.providerId;

  if (tab.draftModel) {
    const draftProvider = getEnabledProviderForModel(tab.draftModel, settingsSnapshot);
    const draftProviderOwnsModel = ProviderRegistry
      .getChatUIConfig(draftProvider)
      .ownsModel(tab.draftModel, settingsSnapshot);
    if (!enabledProviderIds.includes(draftProvider) || !draftProviderOwnsModel) {
      const fallbackProviderId = enabledProviderIds[0] ?? DEFAULT_CHAT_PROVIDER_ID;
      const fallbackModels = ProviderRegistry.getChatUIConfig(fallbackProviderId)
        .getModelOptions(settingsSnapshot);
      tab.draftModel = fallbackModels[0]?.value ?? tab.draftModel;
      nextProviderId = fallbackProviderId;
    } else {
      nextProviderId = draftProvider;
    }
  }

  tab.providerId = nextProviderId;

  // Clean up stale service if provider changed
  if (
    tab.service
    && tab.service.providerId !== nextProviderId
  ) {
    tab.service.cleanup();
    tab.service = null;
    tab.serviceInitialized = false;
  }

  syncTabProviderServices(tab, plugin);
  tab.ui.slashCommandDropdown?.setHiddenCommands(getTabHiddenCommands(tab, plugin));
  tab.ui.slashCommandDropdown?.resetSdkSkillsCache();
  refreshTabProviderUI(tab, plugin);
  applyProviderUIGating(tab, plugin);
}

/**
 * Creates a new Tab instance with all required state.
 */
export function createTab(options: TabCreateOptions): TabData {
  const {
    plugin,
    containerEl,
    conversation,
    tabId,
    onStreamingChanged,
    onAttentionChanged,
    onConversationIdChanged,
  } = options;

  const id = tabId ?? generateTabId();

  const contentEl = containerEl.createDiv({ cls: 'grimoire-tab-content grimoire-hidden' });

  const state = new ChatState({
    onStreamingStateChanged: onStreamingChanged,
    onAttentionChanged: onAttentionChanged,
    onConversationChanged: onConversationIdChanged,
  });

  // Create subagent manager with no-op callback.
  // This placeholder is replaced in initializeTabControllers() with the actual
  // callback that updates the StreamController. We defer the real callback
  // because StreamController doesn't exist until controllers are initialized.
  const subagentManager = new SubagentManager(() => {});
  const vaultTextIndex = new VaultTextIndex(plugin.app);
  const vaultSearchService = new VaultSearchService(vaultTextIndex);
  const relevantNotesService = new RelevantNotesService(vaultTextIndex);

  const dom = buildTabDOM(contentEl, formatGrimoireVersion(plugin.manifest));
  dom.eventCleanups.push(attachInputResizeHandle(dom));
  state.queueIndicatorEl = dom.queueIndicatorEl;

  const isBound = !!conversation?.id;
  const restoredDraftSettings = !isBound
    ? cloneSerializableRecord(options.draftSettings)
    : null;
  const restoredDraftModel = typeof options.draftModel === 'string'
    ? options.draftModel.trim()
    : '';
  const restoredDraftSettingsModel = typeof restoredDraftSettings?.model === 'string'
    ? restoredDraftSettings.model.trim()
    : '';
  const draftModel = isBound
    ? null
    : (restoredDraftModel || restoredDraftSettingsModel || resolveBlankTabModel(plugin, options.defaultProviderId));
  const initialProviderId = conversation?.providerId
    ?? (draftModel
      ? getEnabledProviderForModel(draftModel, plugin.settings)
      : DEFAULT_CHAT_PROVIDER_ID);

  const tab: TabData = {
    id,
    lifecycleState: isBound ? 'bound_cold' : 'blank',
    draftModel,
    draftSettings: restoredDraftSettings
      ? {
        ...restoredDraftSettings,
        model: draftModel,
      }
      : null,
    providerId: initialProviderId,
    conversationId: conversation?.id ?? null,
    service: null,
    serviceInitialized: false,
    state,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      conversationController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: {
      subagentManager,
      instructionRefineService: null,
      titleGenerationService: null,
      vaultTextIndex,
      vaultSearchService,
      relevantNotesService,
    },
    ui: {
      fileContextManager: null,
      imageContextManager: null,
      modelSelector: null,
      planUsageBadge: null,
      modeSelector: null,
      thinkingBudgetSelector: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      permissionToggle: null,
      serviceTierToggle: null,
      orchestratorToggle: null,
      projectWorkspaceSelector: null,
      slashCommandDropdown: null,
      instructionModeManager: null,
      bangBashModeManager: null,
      contextUsageMeter: null,
      runtimeContextActivity: null,
      statusPanel: null,
      navigationSidebar: null,
      relevantNotesView: null,
    },
    dom,
    renderer: null,
    orchestratorMode: conversation?.orchestratorMode === true
      || (!isBound && options.orchestratorMode === true),
  };

  return tab;
}

/**
 * Builds the DOM structure for a tab.
 */
function buildTabDOM(contentEl: HTMLElement, versionText: string): TabDOMElements {
  contentEl.addClass('grimoire-tab-chat-window');
  contentEl.dataset.panelView = 'chat';

  const workbenchGridEl = contentEl.createDiv({ cls: 'grimoire-chat-window-grid' });

  const panelTabsEl = workbenchGridEl.createEl('nav', {
    cls: 'grimoire-panel-tabs',
    attr: { 'aria-label': 'Current tab views' },
  });
  const chatPanelButtonEl = panelTabsEl.createEl('button', {
    cls: 'grimoire-panel-tab is-active',
    text: 'Chat',
    attr: { type: 'button', 'data-panel-view': 'chat', 'aria-pressed': 'true' },
  });
  const sourcesPanelButtonEl = panelTabsEl.createEl('button', {
    cls: 'grimoire-panel-tab',
    text: 'Sources',
    attr: { type: 'button', 'data-panel-view': 'sources', 'aria-pressed': 'false' },
  });
  const contextPanelButtonEl = panelTabsEl.createEl('button', {
    cls: 'grimoire-panel-tab',
    text: 'Context',
    attr: { type: 'button', 'data-panel-view': 'context', 'aria-pressed': 'false' },
  });

  const chatScrollEl = workbenchGridEl.createDiv({
    cls: 'grimoire-chat-scroll',
    attr: { 'aria-live': 'polite' },
  });
  const focusedMainEl = chatScrollEl.createDiv({ cls: 'grimoire-panel-content' });

  const chatStageEl = focusedMainEl.createDiv({
    cls: 'grimoire-panel-view grimoire-chat-panel is-active',
    attr: { 'data-panel-view': 'chat', 'aria-label': 'Conversation' },
  });
  const boundStatusEl = chatStageEl.createDiv({ cls: 'grimoire-bound-status grimoire-hidden' });
  const boundStatusDotEl = boundStatusEl.createSpan({ cls: 'grimoire-bound-status-dot' });
  const boundStatusNoteEl = boundStatusEl.createSpan({ cls: 'grimoire-bound-status-note' });
  const boundStatusMetaEl = boundStatusEl.createSpan({ cls: 'grimoire-bound-status-meta' });
  const messagesWrapperEl = chatStageEl.createDiv({ cls: 'grimoire-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'grimoire-messages' });
  const welcomeEl = messagesEl.createDiv({ cls: 'grimoire-welcome grimoire-welcome--chat-window' });

  const sourceRailEl = focusedMainEl.createDiv({
    cls: 'grimoire-panel-view grimoire-sources-panel',
    attr: { 'data-panel-view': 'sources', 'aria-label': 'Sources and actions' },
  });
  sourceRailEl.hidden = true;
  const sourceHeaderEl = sourceRailEl.createDiv({ cls: 'grimoire-panel-section-heading' });
  sourceHeaderEl.createSpan({ text: 'Sources in tab' });
  const sourceShownCountEl = sourceHeaderEl.createSpan({ cls: 'grimoire-panel-section-count', text: '0 shown' });
  const sourceFiltersEl = sourceRailEl.createDiv({ cls: 'grimoire-source-filters' });
  sourceFiltersEl.createEl('button', {
    cls: 'grimoire-source-filter is-active',
    text: 'All',
    attr: { type: 'button', 'data-source-filter': 'all', 'aria-pressed': 'true' },
  });
  sourceFiltersEl.createEl('button', {
    cls: 'grimoire-source-filter',
    text: 'Linked',
    attr: { type: 'button', 'data-source-filter': 'linked', 'aria-pressed': 'false' },
  });
  sourceFiltersEl.createEl('button', {
    cls: 'grimoire-source-filter',
    text: 'Current',
    attr: { type: 'button', 'data-source-filter': 'current', 'aria-pressed': 'false' },
  });
  const sourceCardsEl = sourceRailEl.createDiv({ cls: 'grimoire-source-card-stack' });
  const statusPanelContainerEl = sourceRailEl.createDiv({
    cls: 'grimoire-status-panel-container grimoire-operational-panel',
  });

  const contextRailEl = focusedMainEl.createDiv({
    cls: 'grimoire-panel-view grimoire-context-panel',
    attr: { 'data-panel-view': 'context', 'aria-label': 'Vault context memory' },
  });
  contextRailEl.hidden = true;
  const contextHeaderEl = contextRailEl.createDiv({ cls: 'grimoire-panel-section-heading' });
  contextHeaderEl.createSpan({ text: 'Context memory · tab' });
  const contextSummaryEl = contextRailEl.createDiv({ cls: 'grimoire-context-summary' });
  const contextMemoryEl = contextRailEl.createDiv({ cls: 'grimoire-context-memory-panel grimoire-hidden' });
  const contextRuntimeEl = contextRailEl.createDiv({ cls: 'grimoire-context-runtime-panel grimoire-hidden' });

  const composerSurfaceEl = workbenchGridEl.createDiv({ cls: 'grimoire-composer-surface grimoire-composer' });
  const scrollResumeButtonEl = composerSurfaceEl.createEl('button', {
    cls: 'grimoire-scroll-resume-btn grimoire-hidden',
    attr: {
      type: 'button',
      'aria-label': 'Jump to latest message',
      'aria-hidden': 'true',
    },
  });
  appendScrollResumeIcon(scrollResumeButtonEl);
  const inputContainerEl = composerSurfaceEl.createDiv({
    cls: 'grimoire-input-container grimoire-composer-shell',
  });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'grimoire-input-queue-row' });
  const navRowEl = inputContainerEl.createDiv({ cls: 'grimoire-input-nav-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'grimoire-input-wrapper' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'grimoire-context-row' });
  const inputEl = inputWrapper.createEl('textarea', {
    cls: 'grimoire-input',
    attr: {
      placeholder: 'Ask Grimoire to edit, search, compare, generate, or run a command...',
      rows: '3',
      dir: 'auto',
    },
  });
  const composerVersionEl = composerSurfaceEl.createDiv({
    cls: 'grimoire-composer-version',
    text: versionText,
  });

  const panelViews: Record<TabPanelView, HTMLElement> = {
    chat: chatStageEl,
    sources: sourceRailEl,
    context: contextRailEl,
  };
  const panelButtons: Record<TabPanelView, HTMLButtonElement> = {
    chat: chatPanelButtonEl,
    sources: sourcesPanelButtonEl,
    context: contextPanelButtonEl,
  };
  const setPanelView = (view: TabPanelView): void => {
    contentEl.dataset.panelView = view;
    for (const [name, panelEl] of Object.entries(panelViews) as [TabPanelView, HTMLElement][]) {
      const isActive = name === view;
      panelEl.hidden = !isActive;
      panelEl.toggleClass('is-active', isActive);
      panelButtons[name].toggleClass('is-active', isActive);
      panelButtons[name].setAttribute('aria-pressed', String(isActive));
    }
  };
  chatPanelButtonEl.addEventListener('click', () => setPanelView('chat'));
  sourcesPanelButtonEl.addEventListener('click', () => setPanelView('sources'));
  contextPanelButtonEl.addEventListener('click', () => setPanelView('context'));

  return {
    contentEl,
    workbenchGridEl,
    contextRailEl,
    contextMemoryEl,
    contextRuntimeEl,
    contextSummaryEl,
    chatStageEl,
    chatScrollEl,
    scrollResumeButtonEl,
    sourceRailEl,
    sourceCardsEl,
    sourceFiltersEl,
    sourceShownCountEl,
    composerSurfaceEl,
    panelTabsEl,
    chatPanelButtonEl,
    sourcesPanelButtonEl,
    contextPanelButtonEl,
    focusedMainEl,
    focusedChatPanelEl: chatStageEl,
    focusedSourcesPanelEl: sourceRailEl,
    focusedContextPanelEl: contextRailEl,
    boundStatusEl,
    boundStatusDotEl,
    boundStatusNoteEl,
    boundStatusMetaEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputContainerEl,
    composerVersionEl,
    queueIndicatorEl,
    inputWrapper,
    inputEl,
    sendButtonEl: null,
    stopButtonEl: null,
    navRowEl,
    contextRowEl,
    selectionIndicatorEl: null,
    browserIndicatorEl: null,
    canvasIndicatorEl: null,
    eventCleanups: [],
  };
}

function attachInputResizeHandle(dom: TabDOMElements): () => void {
  const viewport = dom.inputWrapper.closest<HTMLElement>('.grimoire-container');
  if (!viewport) {
    return () => {};
  }

  return createInputResizeHandle({
    inputWrapper: dom.inputWrapper,
    viewport,
  });
}

function isTabScrollAtBottom(tab: TabData): boolean {
  const { scrollTop, scrollHeight, clientHeight } = tab.dom.chatScrollEl;
  return scrollHeight - scrollTop - clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
}

function updateScrollResumeButton(tab: TabData, plugin: GrimoirePlugin): void {
  const autoScrollAllowed = plugin.settings.enableAutoScroll ?? true;
  const shouldShow = autoScrollAllowed && !tab.state.autoScrollEnabled && !isTabScrollAtBottom(tab);
  const shouldQuietScrollbar = autoScrollAllowed && tab.state.isStreaming && tab.state.autoScrollEnabled;
  tab.dom.scrollResumeButtonEl.toggleClass('grimoire-hidden', !shouldShow);
  tab.dom.scrollResumeButtonEl.setAttribute('aria-hidden', String(!shouldShow));
  tab.dom.chatScrollEl.toggleClass('grimoire-chat-scroll--quiet', shouldQuietScrollbar);
}

function scrollTabToBottom(tab: TabData, plugin: GrimoirePlugin): void {
  if (!(plugin.settings.enableAutoScroll ?? true)) {
    updateScrollResumeButton(tab, plugin);
    return;
  }

  tab.state.autoScrollEnabled = true;
  tab.dom.chatScrollEl.scrollTop = tab.dom.chatScrollEl.scrollHeight;
  updateScrollResumeButton(tab, plugin);
}

function shouldAutoScrollTab(tab: TabData, plugin: GrimoirePlugin): boolean {
  return (plugin.settings.enableAutoScroll ?? true) && tab.state.autoScrollEnabled;
}

/**
 * Initializes the tab's chat runtime for the send path.
 *
 * This is the ONLY place a runtime is created. Called from:
 * - ensureServiceInitialized() in InputController.sendMessage()
 *
 * Session sync is passive (state update only). The runtime is started
 * on demand by query() inside the send path.
 */
interface InitializeTabServiceOptions {
  bindBlank?: boolean;
  conversationOverride?: Conversation | null;
}

export async function initializeTabService(
  tab: TabData,
  plugin: GrimoirePlugin,
  options?: InitializeTabServiceOptions,
): Promise<void>;
export async function initializeTabService(
  tab: TabData,
  plugin: GrimoirePlugin,
  conversationOverride?: Conversation | null,
): Promise<void>;
export async function initializeTabService(
  tab: TabData,
  plugin: GrimoirePlugin,
  _legacyArg: unknown,
  conversationOverride?: Conversation | null,
): Promise<void>;
export async function initializeTabService(
  tab: TabData,
  plugin: GrimoirePlugin,
  argOrOverride?: unknown,
  maybeOverride?: Conversation | null,
): Promise<void> {
  if (tab.lifecycleState === 'closing') {
    return;
  }

  const serviceOptions = isInitializeTabServiceOptions(argOrOverride)
    ? argOrOverride
    : {};
  const bindBlank = serviceOptions.bindBlank !== false;

  // Support legacy 4-arg call sites (3rd arg was previously an MCP manager)
  const conversationOverride = isInitializeTabServiceOptions(argOrOverride)
    ? serviceOptions.conversationOverride
    : (isConversationLike(argOrOverride)
      ? argOrOverride
      : (argOrOverride === null ? null : maybeOverride));

  const conversation = conversationOverride ?? (
    tab.conversationId
      ? await plugin.getConversationById(tab.conversationId)
      : null
  );
  const providerId = getTabProviderId(tab, plugin, conversation);

  if (tab.serviceInitialized && tab.service?.providerId === providerId) {
    if (bindBlank && tab.lifecycleState === 'blank') {
      await applyBlankDraftSettings(tab, plugin, providerId);
      tab.draftModel = null;
      tab.draftSettings = null;
      tab.lifecycleState = 'bound_active';
    }
    return;
  }

  let service: ChatRuntime | null = null;
  let unsubscribeReadyState: (() => void) | null = null;
  const previousService = tab.service;

  try {
    if (typeof previousService?.cleanup === 'function') {
      previousService.cleanup();
    }
    tab.service = null;
    tab.serviceInitialized = false;

    await applyBlankDraftSettings(tab, plugin, providerId);
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId });
    service = runtime;
    unsubscribeReadyState = runtime.onReadyStateChange(() => {});
    tab.dom.eventCleanups.push(() => unsubscribeReadyState?.());

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    if (conversation) {
      const hasStartedSession = hasStartedConversation(conversation);
      const externalContextPaths = hasStartedSession
        ? conversation.externalContextPaths || []
        : (plugin.settings.persistentExternalContextPaths || []);

      runtime.syncConversationState(conversation, externalContextPaths);
    }

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      unsubscribeReadyState?.();
      service?.cleanup();
      return;
    }


    tab.providerId = providerId;
    tab.service = service;
    tab.serviceInitialized = true;

    if (tab.lifecycleState === 'blank' && !bindBlank) {
      return;
    }

    // Update lifecycle state
    if (tab.lifecycleState === 'blank') {
      tab.draftModel = null;
      tab.draftSettings = null;
    }
    tab.lifecycleState = 'bound_active';
  } catch (error) {
    // Clean up partial state on failure
    unsubscribeReadyState?.();
    service?.cleanup();
    tab.service = null;
    tab.serviceInitialized = false;

    // Re-throw to let caller handle (e.g., show error to user)
    throw error;
  }
}

function isInitializeTabServiceOptions(value: unknown): value is InitializeTabServiceOptions {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && ('bindBlank' in value || 'conversationOverride' in value);
}

function isConversationLike(value: unknown): value is Conversation {
  return !!value
    && typeof value === 'object'
    && typeof (value as Conversation).id === 'string'
    && Array.isArray((value as Conversation).messages);
}

function initializeContextManagers(tab: TabData, plugin: GrimoirePlugin): void {
  const { dom } = tab;
  const app = plugin.app;

  // File context manager - chips in contextRowEl, dropdown in inputContainerEl
  tab.ui.fileContextManager = new FileContextManager(
    app,
    dom.contextRowEl,
    dom.inputEl,
    {
      getExcludedTags: () => plugin.settings.excludedTags,
      onChipsChanged: () => {
        void updateRelevantNotes(tab, plugin);
        syncContextSummary(tab, plugin);
        syncBoundStatus(tab, plugin);
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
      getExternalContexts: () => tab.ui.externalContextSelector?.getExternalContexts() || [],
    },
    dom.inputContainerEl,
    dom.contextMemoryEl
  );
  tab.ui.fileContextManager.setMcpManager(getProviderMcpManager(getTabProviderId(tab, plugin)));

  const markVaultSearchDirty = (file: unknown): void => {
    if (file instanceof TFile) {
      tab.services.vaultTextIndex?.markDirty(file.path);
    }
  };
  const markVaultSearchRenameDirty = (file: unknown, oldPath: string): void => {
    if (file instanceof TFile) {
      tab.services.vaultTextIndex?.markDirty(oldPath);
      tab.services.vaultTextIndex?.markDirty(file.path);
    }
  };
  const modifyRef = app.vault.on('modify', markVaultSearchDirty);
  const deleteRef = app.vault.on('delete', markVaultSearchDirty);
  const renameRef = app.vault.on('rename', markVaultSearchRenameDirty);
  dom.eventCleanups.push(() => {
    app.vault.offref(modifyRef);
    app.vault.offref(deleteRef);
    app.vault.offref(renameRef);
  });

  // Image context manager - drag/drop uses inputContainerEl, preview in contextRowEl
  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
    },
    dom.contextRowEl
  );
}

async function updateRelevantNotes(tab: TabData, plugin: GrimoirePlugin): Promise<void> {
  syncBoundStatus(tab, plugin);
  const view = tab.ui.relevantNotesView;
  if (!view) {
    return;
  }

  const currentSources = getCurrentSourceRows(tab);
  const settings = plugin.settings as ContextEngineRelevantSettings;
  if (settings.contextEngine?.relevantNotesEnabled === false) {
    view.render([], currentSources);
    return;
  }

  const currentPath = tab.ui.fileContextManager?.getCurrentNotePath();
  if (!currentPath) {
    view.render([], currentSources);
    return;
  }

  const maxResults = settings.contextEngine?.relevantNotesMaxResults ?? 6;
  if (maxResults <= 0) {
    view.render([], currentSources);
    return;
  }

  try {
    await tab.services.vaultTextIndex?.refresh({ excludedTags: settings.excludedTags });
    const notes = tab.services.relevantNotesService?.findRelevantNotes(currentPath, { maxResults }) ?? [];
    view.render(notes, currentSources);
  } catch (error) {
    view.render([], currentSources);
    new Notice(`Relevant notes failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getCurrentSourceRows(tab: TabData): RelevantNotesCurrentSource[] {
  const fileContextManager = tab.ui.fileContextManager;
  if (!fileContextManager) {
    return [];
  }

  const currentNotePath = fileContextManager.getCurrentNotePath();
  const sources: RelevantNotesCurrentSource[] = [];
  if (currentNotePath) {
    sources.push({
      path: currentNotePath,
      title: getPathTitle(currentNotePath),
      detail: 'current note',
      badge: 'live',
    });
  }

  const attachedFiles = typeof fileContextManager.getAttachedFiles === 'function'
    ? fileContextManager.getAttachedFiles()
    : new Set<string>();
  for (const filePath of attachedFiles) {
    if (filePath === currentNotePath) {
      continue;
    }
    sources.push({
      path: filePath,
      title: getPathTitle(filePath),
      detail: 'attached file',
      badge: 'file',
    });
  }
  return sources;
}

function getPathTitle(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

function openRelevantVaultPath(plugin: GrimoirePlugin, path: string): void {
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    new Notice(`Could not open file: ${path}`);
    return;
  }

  void (async (): Promise<void> => {
    try {
      await plugin.app.workspace.getLeaf().openFile(file);
    } catch (error) {
      new Notice(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
}

function initializeSlashCommands(
  tab: TabData,
  getHiddenCommands?: () => Set<string>,
  catalogInfo?: { config: ProviderCommandDropdownConfig; getEntries: () => Promise<ProviderCommandEntry[]> } | null,
): void {
  const { dom } = tab;

  tab.ui.slashCommandDropdown = new SlashCommandDropdown(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onSelect: () => {},
      onHide: () => {},
    },
    {
      hiddenCommands: getHiddenCommands?.() ?? new Set(),
      providerConfig: catalogInfo?.config,
      getProviderEntries: catalogInfo?.getEntries,
    }
  );
}

/**
 * Initializes instruction mode and todo panel for a tab.
 */
function initializeInstructionAndTodo(tab: TabData, plugin: GrimoirePlugin): void {
  const { dom } = tab;

  syncTabProviderServices(tab, plugin);
  ensureTitleGenerationService(tab, plugin);
  tab.ui.instructionModeManager = new InstructionModeManagerClass(
    dom.inputEl,
    {
      onSubmit: async (rawInstruction) => {
        await tab.controllers.inputController?.handleInstructionSubmit(rawInstruction);
      },
      getInputWrapper: () => dom.inputWrapper,
    }
  );

  // Bang bash mode (! command execution)
  if (isBangBashEnabled(plugin.settings)) {
    const vaultPath = getVaultPath(plugin.app);
    if (vaultPath) {
      const enhancedPath = getEnhancedPath();
      const bashService = new BangBashService(vaultPath, enhancedPath);

      tab.ui.bangBashModeManager = new BangBashModeManagerClass(
        dom.inputEl,
        {
          onSubmit: async (command) => {
            const statusPanel = tab.ui.statusPanel;
            if (!statusPanel) return;

            const id = `bash-${Date.now()}`;
            statusPanel.addBashOutput({ id, command, status: 'running', output: '' });

            const result = await bashService.execute(command);
            const output = [result.stdout, result.stderr, result.error].filter(Boolean).join('\n').trim();
            const status = result.exitCode === 0 ? 'completed' : 'error';
            statusPanel.updateBashOutput(id, { status, output, exitCode: result.exitCode });
          },
          getInputWrapper: () => dom.inputWrapper,
        }
      );
    }
  }

  tab.ui.statusPanel = new StatusPanel();
  tab.ui.statusPanel.mount(dom.statusPanelContainerEl);
}

function isBangBashEnabled(settings: Record<string, unknown>): boolean {
  return ProviderRegistry.getEnabledProviderIds(settings).some((providerId) => (
    ProviderRegistry.getChatUIConfig(providerId).isBangBashEnabled?.(settings) ?? false
  ));
}

function getModelCatalogProviderIds(_tab: TabData, plugin: GrimoirePlugin): ProviderId[] {
  return ProviderRegistry.getEnabledProviderIds(plugin.settings);
}

async function refreshTabModelOptions(tab: TabData, plugin: GrimoirePlugin): Promise<void> {
  const providerIds = getModelCatalogProviderIds(tab, plugin);
  await Promise.all(providerIds.map(async (providerId) => {
    const catalog = ProviderWorkspaceRegistry.getModelCatalog(providerId);
    if (!catalog || catalog.isAvailable?.(plugin.settings) === false) {
      return;
    }

    await catalog.refreshModels({
      plugin,
      settings: plugin.settings,
    });
  }).map((promise) => promise.catch(() => undefined)));

  tab.ui.modelSelector?.updateDisplay();
  tab.ui.modelSelector?.renderOptions();
  tab.ui.planUsageBadge?.updateDisplay();
}

/**
 * Creates and wires the input toolbar for a tab.
 */
function initializeInputToolbar(
  tab: TabData,
  plugin: GrimoirePlugin,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
  onProviderChanged?: (providerId: ProviderId) => void | Promise<void>,
  onDraftSettingsChanged?: (
    providerId: ProviderId,
    settings: Record<string, unknown>,
  ) => void | Promise<void>,
  onOrchestratorModeChanged?: (orchestratorMode: boolean) => void | Promise<void>,
): void {
  const { dom } = tab;

  const inputToolbar = dom.inputWrapper.createDiv({ cls: 'grimoire-input-toolbar' });

  // The model picker is mixed-provider even when the active session remains bound.
  const mixedModelUIConfigProxy = (): ProviderChatUIConfig => {
    const draftProvider = tab.draftModel
      ? getEnabledProviderForModel(tab.draftModel, plugin.settings)
      : getTabProviderId(tab, plugin);
    const baseConfig = ProviderRegistry.getChatUIConfig(draftProvider);
    return {
      ...baseConfig,
      getModelOptions: (settings: Record<string, unknown>) =>
        getBlankTabModelOptions(settings),
    };
  };

  const toolbarComponents = createInputToolbar(inputToolbar, {
    getUIConfig: () => mixedModelUIConfigProxy(),
    getCapabilities: () => getTabCapabilities(tab, plugin),
    getSettings: () => getTabSettingsSnapshot(tab, plugin),
    getEnvironmentVariables: () => plugin.getActiveEnvironmentVariables(),
    refreshModelOptions: () => refreshTabModelOptions(tab, plugin),
    getProviderId: () => getTabProviderId(tab, plugin),
    getProviderUsage: (providerId: ProviderId) => getProviderUsageSnapshot(plugin, providerId),
    refreshProviderUsage: (providerId: ProviderId) => refreshProviderUsageSnapshot(plugin, providerId),
    onProviderUsageRefresh: (providerId: ProviderId) => {
      if (providerId === getTabProviderId(tab, plugin)) {
        tab.ui.planUsageBadge?.updateDisplay();
      }
    },
    resolveProviderForModel: (model: string) => getEnabledProviderForModel(model, plugin.settings),
    onModelChange: async (model: string) => {
      // For blank tabs, update draft model and derive provider
      if (tab.lifecycleState === 'blank') {
        const previousProvider = tab.providerId;
        tab.draftModel = model;
        const newProvider = getEnabledProviderForModel(
          model,
          plugin.settings,
        );
        const didProviderChange = newProvider !== previousProvider;
        if (tab.service) {
          cleanupTabRuntime(tab);
        }
        tab.providerId = newProvider;
        if (didProviderChange) {
          syncTabProviderServices(tab, plugin);
        }
        syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig);

        // Update settings for the new provider
        plugin.settings.settingsProvider = newProvider;
        const uiConfig = ProviderRegistry.getChatUIConfig(newProvider);
        await updateTabProviderSettings(
          tab,
          plugin,
          (settings) => {
            settings.model = model;
            uiConfig.applyModelDefaults(model, settings);
          },
          onDraftSettingsChanged,
        );
        if (didProviderChange) {
          runProviderChangedInBackground(onProviderChanged, newProvider);
        }
        prepareModelMetadataInBackground(tab, plugin, newProvider, model, uiConfig);
        tab.ui.thinkingBudgetSelector?.updateDisplay();
        tab.ui.serviceTierToggle?.updateDisplay();
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.planUsageBadge?.updateDisplay();
        tab.ui.planUsageBadge?.refreshInBackground();
        tab.ui.modeSelector?.updateDisplay();
        // Re-render options (provider may have changed reasoning controls)
        tab.ui.modelSelector?.renderOptions();
        tab.ui.modeSelector?.renderOptions();
        applyProviderUIGating(tab, plugin);
        syncContextSummary(tab, plugin);
        return;
      }

      // For bound tabs, reject cross-provider model changes
      const boundProvider = tab.providerId;
      const modelProvider = getProviderForModel(model, plugin.settings);
      if (modelProvider !== boundProvider) {
        new Notice('Cannot switch provider on a bound session. Start a new tab instead.');
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.planUsageBadge?.updateDisplay();
        return;
      }

      const uiConfig: ProviderChatUIConfig = getTabChatUIConfig(tab, plugin);
      const providerSettings = await updateTabProviderSettings(
        tab,
        plugin,
        (settings) => {
          settings.model = model;
          uiConfig.applyModelDefaults(model, settings);
        },
        onDraftSettingsChanged,
      );
      prepareModelMetadataInBackground(tab, plugin, boundProvider, model, uiConfig);
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.serviceTierToggle?.updateDisplay();
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.planUsageBadge?.updateDisplay();
      tab.ui.planUsageBadge?.refreshInBackground();
      tab.ui.modelSelector?.renderOptions();

      // Recalculate context usage percentage for the new model's context window
      const currentUsage = tab.state.usage;
      if (currentUsage) {
        const newContextWindow = uiConfig.getContextWindowSize(
          model,
          providerSettings.customContextLimits,
        );
        tab.state.usage = recalculateUsageForModel(currentUsage, model, newContextWindow);
      }
      syncContextSummary(tab, plugin);
    },
    onModeChange: async (mode: string) => {
      await updateTabProviderSettings(
        tab,
        plugin,
        (settings) => {
          getTabChatUIConfig(tab, plugin).applyModeSelection?.(mode, settings);
        },
        onDraftSettingsChanged,
      );
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
    },
    onThinkingBudgetChange: async (budget: string) => {
      await updateTabProviderSettings(
        tab,
        plugin,
        (settings) => {
          settings.thinkingBudget = budget;
          getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(settings.model, budget, settings);
        },
        onDraftSettingsChanged,
      );
      syncContextSummary(tab, plugin);
    },
    onEffortLevelChange: async (effort: string) => {
      await updateTabProviderSettings(
        tab,
        plugin,
        (settings) => {
          settings.effortLevel = effort;
          getTabChatUIConfig(tab, plugin).applyReasoningSelection?.(settings.model, effort, settings);
        },
        onDraftSettingsChanged,
      );
      syncContextSummary(tab, plugin);
    },
    onServiceTierChange: async (serviceTier: string) => {
      await updateTabProviderSettings(
        tab,
        plugin,
        (settings) => {
          settings.serviceTier = serviceTier;
        },
        onDraftSettingsChanged,
      );
      tab.ui.serviceTierToggle?.updateDisplay();
      syncContextSummary(tab, plugin);
    },
    onPermissionModeChange: async (mode: string) => {
      await updateTabProviderSettings(
        tab,
        plugin,
        (settings) => {
          const uiConfig = getTabChatUIConfig(tab, plugin);
          if (uiConfig.applyPermissionMode) {
            uiConfig.applyPermissionMode(mode, settings);
          } else {
            settings.permissionMode = mode;
          }
        },
        onDraftSettingsChanged,
      );
      tab.ui.permissionToggle?.updateDisplay();
      dom.inputWrapper.toggleClass(
        'grimoire-input-plan-mode',
        mode === 'plan' && getTabCapabilities(tab, plugin).supportsPlanMode,
      );
      syncContextSummary(tab, plugin);
      syncBoundStatus(tab, plugin);
    },
    getOrchestratorMode: () => tab.orchestratorMode,
    getProjectWorkspaces: () => ProjectWorkspaceStore.normalizeWorkspaceList(
      plugin.settings.contextEngine?.projectWorkspaces,
    ),
    getActiveProjectWorkspaceId: () => plugin.settings.contextEngine?.activeProjectWorkspaceId ?? '',
    onProjectWorkspaceChange: async (workspaceId: string) => {
      if (!plugin.settings.contextEngine) {
        return;
      }
      plugin.settings.contextEngine.activeProjectWorkspaceId = workspaceId;
      await plugin.saveSettings();
      tab.ui.projectWorkspaceSelector?.updateDisplay();
    },
    onExternalContextFileSelect: (filePath: string) => {
      dom.inputEl.focus();
      tab.ui.fileContextManager?.hideMentionDropdown();
      renderExternalFileChips(tab, filePath);
      autoResizeTextarea(dom.inputEl);
    },
    onOrchestratorModeChange: async () => {
      tab.orchestratorMode = !tab.orchestratorMode;
      tab.ui.orchestratorToggle?.updateDisplay();
      try {
        void Promise.resolve(onOrchestratorModeChanged?.(tab.orchestratorMode)).catch(() => {});
      } catch {
        // Layout persistence must not block the toggle.
      }

      if (tab.conversationId) {
        await plugin.updateConversation(tab.conversationId, {
          orchestratorMode: tab.orchestratorMode,
        });
      }
    },
  });

  const actionsRowEl = inputToolbar.querySelector<HTMLElement>('.grimoire-input-toolbar-actions-row')
    ?? inputToolbar;
  const sendActionsEl = actionsRowEl.createDiv({ cls: 'grimoire-send-actions' });
  dom.stopButtonEl = sendActionsEl.createEl('button', {
    cls: 'grimoire-stop-button grimoire-hidden',
    attr: { type: 'button', 'aria-label': 'Stop response', title: 'Stop response' },
  });
  setIcon(dom.stopButtonEl, 'square');
  dom.sendButtonEl = sendActionsEl.createEl('button', {
    cls: 'grimoire-send-button',
    text: 'Send',
    attr: { type: 'button', 'aria-label': 'Send message' },
  });
  syncComposerStopButton(tab);

  tab.ui.modelSelector = toolbarComponents.modelSelector;
  tab.ui.planUsageBadge = toolbarComponents.planUsageBadge;
  tab.ui.modeSelector = toolbarComponents.modeSelector;
  tab.ui.thinkingBudgetSelector = toolbarComponents.thinkingBudgetSelector;
  tab.ui.contextUsageMeter = toolbarComponents.contextUsageMeter;
  tab.ui.externalContextSelector = toolbarComponents.externalContextSelector;
  tab.ui.mcpServerSelector = toolbarComponents.mcpServerSelector;
  tab.ui.permissionToggle = toolbarComponents.permissionToggle;
  tab.ui.serviceTierToggle = toolbarComponents.serviceTierToggle;
  tab.ui.orchestratorToggle = toolbarComponents.orchestratorToggle;
  tab.ui.projectWorkspaceSelector = toolbarComponents.projectWorkspaceSelector;
  tab.ui.relevantNotesView = new RelevantNotesView(
    dom.sourceCardsEl,
    path => openRelevantVaultPath(plugin, path),
    {
      filtersEl: dom.sourceFiltersEl,
      shownCountEl: dom.sourceShownCountEl,
    },
  );
  tab.ui.runtimeContextActivity = new RuntimeContextActivityView(dom.contextRuntimeEl);

  tab.ui.mcpServerSelector.setMcpManager(getProviderMcpManager(getTabProviderId(tab, plugin)));

  // Sync @-mentions to UI selector
  tab.ui.fileContextManager?.setOnMcpMentionChange((servers) => {
    tab.ui.mcpServerSelector?.addMentionedServers(servers);
  });

  // Wire external context changes
  tab.ui.externalContextSelector.setOnChange(() => {
    tab.ui.fileContextManager?.preScanExternalContexts();
    renderExternalFileChips(tab);
    syncContextSummary(tab, plugin);
  });

  // Initialize persistent paths
  tab.ui.externalContextSelector.setPersistentPaths(
    plugin.settings.persistentExternalContextPaths || []
  );
  renderExternalFileChips(tab);

  // Wire persistence changes
  tab.ui.externalContextSelector.setOnPersistenceChange((paths) => {
    plugin.settings.persistentExternalContextPaths = paths;
    void plugin.saveSettings();
  });

  refreshTabProviderUI(tab, plugin);

  // Gate provider-specific UI elements
  applyProviderUIGating(tab, plugin);
}

export interface InitializeTabUIOptions {
  getProviderCatalogConfig?: () => ProviderCatalogInfo;
  onProviderChanged?: (providerId: ProviderId) => void | Promise<void>;
  onDraftSettingsChanged?: (
    providerId: ProviderId,
    settings: Record<string, unknown>,
  ) => void | Promise<void>;
  onOrchestratorModeChanged?: (orchestratorMode: boolean) => void | Promise<void>;
  onUsageChanged?: (usage: UsageInfo | null) => void;
}

/**
 * Initializes the tab's UI components.
 * Call this after the tab is created and before it becomes active.
 */
export function initializeTabUI(
  tab: TabData,
  plugin: GrimoirePlugin,
  options: InitializeTabUIOptions = {}
): void {
  const { dom, state } = tab;

  // Initialize context managers (file/image)
  initializeContextManagers(tab, plugin);

  void updateRelevantNotes(tab, plugin);

  // Selection indicator - add to contextRowEl
  dom.selectionIndicatorEl = dom.contextRowEl.createDiv({ cls: 'grimoire-selection-indicator grimoire-hidden' });

  dom.browserIndicatorEl = dom.contextRowEl.createDiv({ cls: 'grimoire-browser-selection-indicator grimoire-hidden' });

  dom.canvasIndicatorEl = dom.contextRowEl.createDiv({ cls: 'grimoire-canvas-indicator grimoire-hidden' });

  const catalogInfo = options.getProviderCatalogConfig?.() ?? null;
  initializeSlashCommands(
    tab,
    () => getTabHiddenCommands(tab, plugin),
    catalogInfo,
  );

  if (dom.messagesEl.parentElement) {
    tab.ui.navigationSidebar = new NavigationSidebar(
      dom.messagesEl.parentElement,
      dom.messagesEl
    );
  }

  initializeInstructionAndTodo(tab, plugin);
  initializeInputToolbar(
    tab,
    plugin,
    options.getProviderCatalogConfig,
    options.onProviderChanged,
    options.onDraftSettingsChanged,
    options.onOrchestratorModeChanged,
  );

  const previousStreamingStateChanged = state.callbacks.onStreamingStateChanged;
  state.callbacks = {
    ...state.callbacks,
    onStreamingStateChanged: (isStreaming) => {
      syncBoundStatus(tab, plugin);
      syncComposerStopButton(tab);
      updateScrollResumeButton(tab, plugin);
      previousStreamingStateChanged?.(isStreaming);
    },
    onUsageChanged: (usage) => {
      tab.ui.contextUsageMeter?.update(usage);
      options.onUsageChanged?.(usage);
    },
    onTodosChanged: (todos) => tab.ui.statusPanel?.updateTodos(todos),
    onAutoScrollChanged: () => tab.ui.navigationSidebar?.updateVisibility(),
  };

  // ResizeObserver detects overflow changes from streamed/content growth when available.
  const ResizeObserverCtor = dom.messagesEl.ownerDocument.defaultView?.ResizeObserver;
  if (typeof ResizeObserverCtor === 'function') {
    const resizeObserver = new ResizeObserverCtor(() => {
      tab.ui.navigationSidebar?.updateVisibility();
    });
    resizeObserver.observe(dom.messagesEl);
    dom.eventCleanups.push(() => resizeObserver.disconnect());
  }
}

export interface ForkContext {
  messages: ChatMessage[];
  providerId?: ProviderId;
  sourceSessionId: string;
  sourceProviderState?: Record<string, unknown>;
  resumeAt: string;
  sourceTitle?: string;
  /** 1-based index used for fork title suffix (counts only non-interrupt user messages). */
  forkAtUserMessage?: number;
  currentNote?: string;
}

function deepCloneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

function isClosingLifecycleState(state: TabData['lifecycleState']): boolean {
  return state === 'closing';
}

function countUserMessagesForForkTitle(messages: ChatMessage[]): number {
  // Keep fork numbering stable by excluding non-semantic user messages.
  return messages.filter(m => m.role === 'user' && !m.isInterrupt && !m.isRebuiltContext).length;
}

interface ForkSource {
  providerId?: ProviderId;
  sourceSessionId: string;
  sourceProviderState?: Record<string, unknown>;
  sourceTitle?: string;
  currentNote?: string;
}

/**
 * Resolves session ID and conversation metadata needed for forking.
 * Prefers the live service session ID; falls back to persisted conversation metadata.
 * Shows a notice and returns null when no session can be resolved.
 */
function resolveForkSource(tab: TabData, plugin: GrimoirePlugin): ForkSource | null {
  const conversation = tab.conversationId
    ? plugin.getConversationSync(tab.conversationId)
    : null;

  // Delegate session ID resolution to the runtime when available;
  // fall back to persisted conversation metadata when no runtime is active.
  const sourceSessionId = tab.service
    ? tab.service.resolveSessionIdForFork(conversation ?? null)
    : ProviderRegistry
      .getConversationHistoryService(conversation?.providerId ?? tab.providerId)
      .resolveSessionIdForConversation(conversation);

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    providerId: getTabProviderId(tab, plugin, conversation),
    sourceSessionId,
    sourceProviderState: conversation?.providerState,
    sourceTitle: conversation?.title,
    currentNote: conversation?.currentNote,
  };
}

async function handleForkRequest(
  tab: TabData,
  plugin: GrimoirePlugin,
  userMessageId: string,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab, plugin).supportsFork) {
    new Notice('Fork is not supported by this provider.');
    return;
  }

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  const userIdx = msgs.findIndex(m => m.id === userMessageId);
  if (userIdx === -1) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  if (!msgs[userIdx].userMessageId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const rewindCtx = findRewindContext(msgs, userIdx);
  if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
    new Notice(t('chat.fork.unavailableNoResponse'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs.slice(0, userIdx)),
    providerId: source.providerId,
    sourceSessionId: source.sourceSessionId,
    sourceProviderState: source.sourceProviderState,
    resumeAt: rewindCtx.prevAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs.slice(0, userIdx + 1)),
    currentNote: source.currentNote,
  });
}

async function handleForkAll(
  tab: TabData,
  plugin: GrimoirePlugin,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab, plugin).supportsFork) {
    new Notice('Fork is not supported by this provider.');
    return;
  }

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  if (msgs.length === 0) {
    new Notice(t('chat.fork.commandNoMessages'));
    return;
  }

  let lastAssistantUuid: string | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].assistantMessageId) {
      lastAssistantUuid = msgs[i].assistantMessageId;
      break;
    }
  }

  if (!lastAssistantUuid) {
    new Notice(t('chat.fork.commandNoAssistantUuid'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs),
    providerId: source.providerId,
    sourceSessionId: source.sourceSessionId,
    sourceProviderState: source.sourceProviderState,
    resumeAt: lastAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs) + 1,
    currentNote: source.currentNote,
  });
}

export function initializeTabControllers(
  tab: TabData,
  plugin: GrimoirePlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void;
/** @deprecated Legacy 7-arg overload — 4th arg was previously an MCP manager. */
export function initializeTabControllers(
  tab: TabData,
  plugin: GrimoirePlugin,
  component: Component,
  _legacyArg: unknown,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void;
export function initializeTabControllers(
  tab: TabData,
  plugin: GrimoirePlugin,
  component: Component,
  arg4?: unknown,
  arg5?: unknown,
  arg6?: unknown,
  arg7?: unknown,
): void {
  // Support legacy 7-arg call sites (4th arg was previously an MCP manager)
  const isLegacy = arg4 !== undefined && typeof arg4 !== 'function';
  const forkRequestCallback = (isLegacy ? arg5 : arg4) as
    ((forkContext: ForkContext) => Promise<void>) | undefined;
  const openConversation = (isLegacy ? arg6 : arg5) as
    ((conversationId: string) => Promise<void>) | undefined;
  const getProviderCatalogConfig = (isLegacy ? arg7 : arg6) as
    (() => ProviderCatalogInfo) | undefined;

  const { dom, state, services, ui } = tab;

  // Create renderer
  tab.renderer = new MessageRenderer(
    plugin,
    component,
    dom.messagesEl,
    (id, mode) => tab.controllers.conversationController!.rewind(id, mode),
    forkRequestCallback
      ? (id) => handleForkRequest(tab, plugin, id, forkRequestCallback)
      : undefined,
    () => getTabCapabilities(tab, plugin),
    {
      getScrollEl: () => dom.chatScrollEl,
      shouldAutoScroll: () => shouldAutoScrollTab(tab, plugin),
      onAutoScrollSuppressed: () => updateScrollResumeButton(tab, plugin),
    },
  );

  // Selection controller
  tab.controllers.selectionController = new SelectionController(
    plugin.app,
    dom.selectionIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl),
    dom.contentEl,
    VIEW_TYPE_GRIMOIRE,
  );

  tab.controllers.browserSelectionController = new BrowserSelectionController(
    plugin.app,
    dom.browserIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
  );

  tab.controllers.canvasSelectionController = new CanvasSelectionController(
    plugin.app,
    dom.canvasIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
  );

  tab.controllers.streamController = new StreamController({
    plugin,
    state,
    renderer: tab.renderer,
    subagentManager: services.subagentManager,
    getMessagesEl: () => dom.messagesEl,
    getScrollEl: () => dom.chatScrollEl,
    getFileContextManager: () => ui.fileContextManager,
    updateQueueIndicator: () => tab.controllers.inputController?.updateQueueIndicator(),
    getAgentService: () => tab.service,
    recordRuntimeToolCall: (toolCall) => {
      tab.ui.runtimeContextActivity?.recordToolCall(getTabProviderId(tab, plugin), toolCall);
    },
  });

  // Wire subagent callback now that StreamController exists
  // DOM updates for async subagents are handled by SubagentManager directly;
  // this callback handles message persistence.
  services.subagentManager.setCallback(
    (subagent) => {
      tab.controllers.streamController?.onAsyncSubagentStateChange(subagent);

      // During active stream, regular end-of-turn save captures latest state.
      if (!tab.state.isStreaming && tab.state.currentConversationId) {
        void tab.controllers.conversationController?.save(false).catch(() => {
          // Best-effort persistence; avoid surfacing background-save failures here.
        });
      }
    }
  );

  tab.controllers.conversationController = new ConversationController(
    {
      plugin,
      state,
      renderer: tab.renderer,
      subagentManager: services.subagentManager,
      getHistoryDropdown: () => null, // Tab doesn't have its own history dropdown
      getWelcomeEl: () => dom.welcomeEl,
      setWelcomeEl: (el) => { dom.welcomeEl = el; },
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.inputEl,
      getFileContextManager: () => ui.fileContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getMcpServerSelector: () => ui.mcpServerSelector,
      getExternalContextSelector: () => ui.externalContextSelector,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
      getTitleGenerationService: () => services.titleGenerationService,
      getStatusPanel: () => ui.statusPanel,
      getAgentService: () => tab.service, // Use tab's service instead of plugin's
      getOrchestratorMode: () => tab.orchestratorMode,
      dismissPendingInlinePrompts: () => tab.controllers.inputController?.dismissPendingApproval(),
      clearRuntimeContextActivity: () => tab.ui.runtimeContextActivity?.clear(),
      hydrateRuntimeContextFromMessages: (providerId, messages) => {
        tab.ui.runtimeContextActivity?.hydrateFromMessages(providerId, messages);
        recordProviderLaunchArtifacts(tab, plugin);
      },
      ensureServiceForConversation: async (conversation) => {
        const nextProviderId = getTabProviderId(tab, plugin, conversation);
        const providerChanged = tab.providerId !== nextProviderId;
        tab.providerId = nextProviderId;

        if (providerChanged) {
          syncTabProviderServices(tab, plugin);
        }

        // Bind session state only — runtime starts on send
        tab.orchestratorMode = conversation?.orchestratorMode === true;
        tab.draftModel = null;
        tab.draftSettings = null;
        const hasStartedSession = hasStartedConversation(conversation);
        tab.conversationId = conversation?.id ?? null;
        tab.lifecycleState = conversation ? 'bound_cold' : 'blank';
        syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig, conversation);

        // If the runtime already exists for the right provider, sync it passively
        if (tab.service && tab.service.providerId === nextProviderId && conversation) {
          const externalContextPaths = hasStartedSession
            ? conversation.externalContextPaths || []
            : (plugin.settings.persistentExternalContextPaths || []);
          tab.service.syncConversationState(conversation, externalContextPaths);
        }

        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
      },
    },
    {
      onNewConversation: () => {
        // Reset to blank state and drop the bound runtime so the next send
        // reinitializes against the currently selected blank-tab provider.
        const previousProviderId = tab.providerId;
        cleanupTabRuntime(tab);
        tab.lifecycleState = 'blank';
        tab.draftModel = resolveBlankTabModel(plugin, previousProviderId);
        tab.draftSettings = null;
        tab.conversationId = null;
        tab.orchestratorMode = false;
        tab.providerId = getTabProviderId(tab, plugin);
        if (tab.providerId !== previousProviderId) {
          syncTabProviderServices(tab, plugin);
        }
        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
        syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig);
      },
      onConversationLoaded: () => {
        ui.slashCommandDropdown?.resetSdkSkillsCache();
        refreshRuntimeContextUI(tab, plugin);
      },
      onConversationSwitched: () => {
        ui.slashCommandDropdown?.resetSdkSkillsCache();
        refreshRuntimeContextUI(tab, plugin);
      },
    }
  );

  tab.controllers.inputController = new InputController({
    plugin,
    state,
    renderer: tab.renderer,
    streamController: tab.controllers.streamController,
    selectionController: tab.controllers.selectionController,
    browserSelectionController: tab.controllers.browserSelectionController,
    canvasSelectionController: tab.controllers.canvasSelectionController,
    conversationController: tab.controllers.conversationController,
    getInputEl: () => dom.inputEl,
    getInputContainerEl: () => dom.inputContainerEl,
    getWelcomeEl: () => dom.welcomeEl,
    getMessagesEl: () => dom.messagesEl,
    getScrollEl: () => dom.chatScrollEl,
    getFileContextManager: () => ui.fileContextManager,
    getImageContextManager: () => ui.imageContextManager,
    getMcpServerSelector: () => ui.mcpServerSelector,
    getExternalContextSelector: () => ui.externalContextSelector,
    getInstructionModeManager: () => ui.instructionModeManager,
    getInstructionRefineService: () => services.instructionRefineService,
    getTitleGenerationService: () => services.titleGenerationService,
    getStatusPanel: () => ui.statusPanel,
    generateId: generateMessageId,
    resetInputHeight: () => {
      // Per-tab input height is managed by CSS, no dynamic adjustment needed
    },
    getAuxiliaryModel: () => tab.service?.getAuxiliaryModel?.() ?? tab.draftModel ?? null,
    getAgentService: () => tab.service,
    getSubagentManager: () => services.subagentManager,
    getActiveProviderSettings: () => getTabSettingsSnapshot(tab, plugin),
    refreshPlanUsage: () => refreshPlanUsageUI(tab),
    getVaultSearchService: () => services.vaultSearchService,
    getActiveProjectWorkspace: () => new ProjectWorkspaceStore(
      plugin.settings.contextEngine ?? {
        projectWorkspaces: [],
        activeProjectWorkspaceId: '',
      },
    ).getActiveWorkspace(),
    applyProjectWorkspaceRouting: async ({ providerId, model }) => {
      if (tab.lifecycleState !== 'blank') {
        return getTabProviderId(tab, plugin);
      }

      const previousProviderId = tab.providerId;
      const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
      const targetModel = model ?? resolveBlankTabModel(plugin, providerId);
      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
        plugin.settings,
        providerId,
      ) as TabProviderSettings;

      snapshot.model = targetModel;
      uiConfig.applyModelDefaults(targetModel, snapshot);
      ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
        plugin.settings,
        providerId,
        snapshot,
      );
      await plugin.saveSettings();

      tab.providerId = providerId;
      tab.draftModel = targetModel;
      tab.draftSettings = createDraftSettingsSnapshot(snapshot, providerId);
      if (tab.service) {
        cleanupTabRuntime(tab);
      }
      if (providerId !== previousProviderId) {
        syncTabProviderServices(tab, plugin);
      }
      syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig);
      refreshTabProviderUI(tab, plugin);
      applyProviderUIGating(tab, plugin);
      return providerId;
    },
    getTabProviderId: () => getTabProviderId(tab, plugin),
    getOrchestratorMode: () => tab.orchestratorMode,
    ensureServiceInitialized: async () => {
      if (tab.serviceInitialized && tab.lifecycleState === 'bound_active') {
        return true;
      }

      try {
        // For blank tabs on first send: derive provider from draft model
        if (tab.lifecycleState === 'blank' && tab.draftModel) {
          const derivedProvider = getEnabledProviderForModel(
            tab.draftModel,
            plugin.settings,
          );
          tab.providerId = derivedProvider;
        }
        if (!ProviderRegistry.isEnabled(tab.providerId, plugin.settings)) {
          throw new Error(`${ProviderRegistry.getProviderDisplayName(tab.providerId)} is disabled. Enable it in Grimoire settings first.`);
        }

        await initializeTabService(tab, plugin);
        setupServiceCallbacks(tab, plugin);

        // Transition: lock model selector to bound provider
        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Failed to initialize chat service');
        return false;
      }
    },
    openConversation,
    onForkAll: forkRequestCallback
      ? () => handleForkAll(tab, plugin, forkRequestCallback)
      : undefined,
    restorePrePlanPermissionModeIfNeeded: () => {
      if (getTabPermissionMode(tab, plugin) === 'plan') {
        const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
        tab.state.prePlanPermissionMode = null;
        updatePlanModeUI(tab, plugin, restoreMode);
      }
    },
  });

  tab.controllers.navigationController = new NavigationController({
    getMessagesEl: () => dom.messagesEl,
    getInputEl: () => dom.inputEl,
    getSettings: () => plugin.settings.keyboardNavigation,
    isStreaming: () => state.isStreaming,
    shouldSkipEscapeHandling: () => {
      if (ui.instructionModeManager?.isActive()) return true;
      if (ui.bangBashModeManager?.isActive()) return true;
      if (tab.controllers.inputController?.isResumeDropdownVisible()) return true;
      if (ui.slashCommandDropdown?.isVisible()) return true;
      if (ui.fileContextManager?.isMentionDropdownVisible()) return true;
      return false;
    },
  });
  tab.controllers.navigationController.initialize();
}

/**
 * Wires up input event handlers for a tab.
 * Call this after controllers are initialized.
 * Stores cleanup functions in dom.eventCleanups for proper memory management.
 */
export function wireTabInputEvents(tab: TabData, plugin: GrimoirePlugin): void {
  const { dom, ui, state, controllers } = tab;

  let wasBangBashActive = ui.bangBashModeManager?.isActive() ?? false;
  const syncBangBashSuppression = (): void => {
    const isActive = ui.bangBashModeManager?.isActive() ?? false;
    if (isActive === wasBangBashActive) return;
    wasBangBashActive = isActive;

    ui.slashCommandDropdown?.setEnabled(!isActive);
    if (isActive) {
      ui.fileContextManager?.hideMentionDropdown();
    }
  };

  const keydownHandler = (e: KeyboardEvent) => {
    if (ui.bangBashModeManager?.isActive()) {
      ui.bangBashModeManager.handleKeydown(e);
      syncBangBashSuppression();
      return;
    }

    if (getTabCapabilities(tab, plugin).supportsInstructionMode && ui.instructionModeManager?.handleTriggerKey(e)) {
      return;
    }

    if (ui.bangBashModeManager?.handleTriggerKey(e)) {
      syncBangBashSuppression();
      return;
    }

    if (getTabCapabilities(tab, plugin).supportsInstructionMode && ui.instructionModeManager?.handleKeydown(e)) {
      return;
    }

    if (e.key === 'Enter' && e.shiftKey && !e.isComposing) {
      return;
    }

    if (controllers.inputController?.handleResumeKeydown(e)) {
      return;
    }

    if (ui.slashCommandDropdown?.handleKeydown(e)) {
      return;
    }

    if (ui.fileContextManager?.handleMentionKeydown(e)) {
      return;
    }

    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if (e.key === 'Escape' && !e.isComposing && state.isStreaming) {
      e.preventDefault();
      controllers.inputController?.cancelStreaming();
      return;
    }

    if (shouldSendMessageFromEnterKey(e, plugin.settings)) {
      e.preventDefault();
      void controllers.inputController?.sendMessage();
    }
  };
  dom.inputEl.addEventListener('keydown', keydownHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('keydown', keydownHandler));

  if (dom.sendButtonEl) {
    const sendClickHandler = () => {
      void controllers.inputController?.sendMessage();
    };
    dom.sendButtonEl.addEventListener('click', sendClickHandler);
    dom.eventCleanups.push(() => dom.sendButtonEl?.removeEventListener('click', sendClickHandler));
  }

  if (dom.stopButtonEl) {
    const stopClickHandler = () => {
      controllers.inputController?.cancelStreaming();
    };
    dom.stopButtonEl.addEventListener('click', stopClickHandler);
    dom.eventCleanups.push(() => dom.stopButtonEl?.removeEventListener('click', stopClickHandler));
  }

  const inputHandler = () => {
    if (!ui.bangBashModeManager?.isActive()) {
      ui.fileContextManager?.handleInputChange();
    }
    ui.instructionModeManager?.handleInputChange();
    ui.bangBashModeManager?.handleInputChange();
    syncBangBashSuppression();
    autoResizeTextarea(dom.inputEl);
  };
  dom.inputEl.addEventListener('input', inputHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('input', inputHandler));

  // Sidebar focus handler — show selection highlight when focus enters the tab from outside
  const focusHandler = (e: FocusEvent) => {
    if (e.relatedTarget && dom.contentEl.contains(e.relatedTarget as Node)) return;
    controllers.selectionController?.showHighlight();
  };
  dom.contentEl.addEventListener('focusin', focusHandler);
  dom.eventCleanups.push(() => dom.contentEl.removeEventListener('focusin', focusHandler));

  // Scroll listener for auto-scroll control (tracks position always, not just during streaming)
  let reEnableTimeout: number | null = null;

  const isAutoScrollAllowed = (): boolean => plugin.settings.enableAutoScroll ?? true;

  const scrollHandler = () => {
    if (!isAutoScrollAllowed()) {
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
      updateScrollResumeButton(tab, plugin);
      return;
    }

    const isAtBottom = isTabScrollAtBottom(tab);

    if (!isAtBottom) {
      // Immediately disable when user scrolls up
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
      updateScrollResumeButton(tab, plugin);
    } else if (!state.autoScrollEnabled) {
      // Debounce re-enabling to avoid bounce during scroll animation
      if (!reEnableTimeout) {
        reEnableTimeout = window.setTimeout(() => {
          reEnableTimeout = null;
          if (isTabScrollAtBottom(tab)) {
            state.autoScrollEnabled = true;
          }
          updateScrollResumeButton(tab, plugin);
        }, AUTO_SCROLL_REENABLE_DELAY_MS);
      }
    } else {
      updateScrollResumeButton(tab, plugin);
    }
  };

  const resumeClickHandler = () => scrollTabToBottom(tab, plugin);
  dom.scrollResumeButtonEl.addEventListener('click', resumeClickHandler);
  dom.eventCleanups.push(() => dom.scrollResumeButtonEl.removeEventListener('click', resumeClickHandler));

  dom.chatScrollEl.addEventListener('scroll', scrollHandler, { passive: true });
  dom.eventCleanups.push(() => {
    dom.chatScrollEl.removeEventListener('scroll', scrollHandler);
    if (reEnableTimeout) window.clearTimeout(reEnableTimeout);
  });
  updateScrollResumeButton(tab, plugin);
}

/**
 * Activates a tab (shows it and starts services).
 */
export function activateTab(tab: TabData): void {
  tab.dom.contentEl.removeClass('grimoire-hidden');
  if (tab.state.autoScrollEnabled) {
    tab.dom.chatScrollEl.scrollTop = tab.dom.chatScrollEl.scrollHeight;
  }
  tab.controllers.selectionController?.start();
  tab.controllers.browserSelectionController?.start();
  tab.controllers.canvasSelectionController?.start();
  // Refresh navigation sidebar visibility (dimensions now available after display)
  tab.ui.navigationSidebar?.updateVisibility();
}

/**
 * Deactivates a tab (hides it and stops services).
 */
export function deactivateTab(tab: TabData): void {
  tab.dom.contentEl.addClass('grimoire-hidden');
  tab.controllers.selectionController?.stop();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.canvasSelectionController?.stop();
}

/**
 * Cleans up a tab and releases all resources.
 * Made async to ensure proper cleanup ordering.
 */
export async function destroyTab(tab: TabData): Promise<void> {
  tab.lifecycleState = 'closing';

  tab.controllers.selectionController?.stop();
  tab.controllers.selectionController?.clear();
  tab.controllers.browserSelectionController?.stop();
  tab.controllers.browserSelectionController?.clear();
  tab.controllers.canvasSelectionController?.stop();
  tab.controllers.canvasSelectionController?.clear();
  tab.controllers.navigationController?.dispose();

  cleanupThinkingBlock(tab.state.currentThinkingState);
  tab.state.currentThinkingState = null;

  // Dismiss pending inline prompts before DOM teardown
  tab.controllers.inputController?.dismissPendingApproval();

  tab.controllers.inputController?.destroyResumeDropdown();
  tab.ui.fileContextManager?.destroy();
  tab.ui.relevantNotesView?.destroy();
  tab.ui.relevantNotesView = null;
  tab.ui.slashCommandDropdown?.destroy();
  tab.ui.slashCommandDropdown = null;
  tab.ui.instructionModeManager?.destroy();
  tab.ui.instructionModeManager = null;
  tab.ui.bangBashModeManager?.destroy();
  tab.ui.bangBashModeManager = null;
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = null;
  tab.services.titleGenerationService?.cancel();
  tab.services.titleGenerationService = null;
  tab.ui.statusPanel?.destroy();
  tab.ui.statusPanel = null;
  tab.ui.modelSelector?.destroy();
  tab.ui.navigationSidebar?.destroy();
  tab.ui.navigationSidebar = null;

  tab.services.subagentManager.orphanAllActive();
  tab.services.subagentManager.clear();

  for (const cleanup of tab.dom.eventCleanups) {
    cleanup();
  }
  tab.dom.eventCleanups.length = 0;

  // Clean up runtime before removing DOM
  tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
}

/**
 * Gets the display title for a tab.
 * Uses synchronous access since we only need the title, not messages.
 */
export function getTabTitle(tab: TabData, plugin: GrimoirePlugin): string {
  if (tab.conversationId) {
    const conversation = plugin.getConversationSync(tab.conversationId);
    if (conversation?.title) {
      return conversation.title;
    }
  }
  return 'New Chat';
}

/** Shared between Tab.ts and TabManager.ts to avoid duplication. */
export function setupServiceCallbacks(tab: TabData, plugin: GrimoirePlugin): void {
  if (tab.service && tab.controllers.inputController) {
    tab.service.setApprovalCallback(
      async (toolName, input, description, options) =>
        await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
        ?? 'cancel'
    );
    tab.service.setApprovalDismisser(
      () => tab.controllers.inputController?.dismissPendingApprovalPrompt()
    );
    tab.service.setAskUserQuestionCallback(
      async (input, signal) =>
        await tab.controllers.inputController?.handleAskUserQuestion(input, signal)
        ?? null
    );
    tab.service.setExitPlanModeCallback(
      async (input, signal) => {
        const decision = await tab.controllers.inputController?.handleExitPlanMode(input, signal) ?? null;
        // Revert only on approve; feedback and cancel keep plan mode active.
        if (decision !== null && decision.type !== 'feedback') {
          // Only restore permission mode if still in plan mode — user may have toggled out via Shift+Tab
          if (getTabPermissionMode(tab, plugin) === 'plan') {
            const restoreMode = tab.state.prePlanPermissionMode ?? 'normal';
            tab.state.prePlanPermissionMode = null;
            updatePlanModeUI(tab, plugin, restoreMode);
          }
        }
        return decision;
      }
    );
    tab.service.setSubagentHookProvider(
      () => ({
        hasRunning: tab.services.subagentManager.hasRunningSubagents(),
      })
    );
    tab.service.setAutoTurnCallback((result: AutoTurnResult) => renderAutoTriggeredTurn(tab, plugin, result));
    tab.service.setPermissionModeSyncCallback((sdkMode) => {
      const mode = normalizePermissionModeSyncValue(sdkMode);
      const currentMode = getTabPermissionMode(tab, plugin);

      // Never let a live session report silently downgrade Auto-approve → Safe.
      // Plan entry/exit and explicit user toggles still update the toolbar.
      if (mode === 'normal' && currentMode === 'full_access') {
        return;
      }

      if (currentMode !== mode) {
        // Save pre-plan mode when entering plan (for Shift+Tab toggle restore)
        if (mode === 'plan' && tab.state.prePlanPermissionMode === null) {
          tab.state.prePlanPermissionMode = currentMode;
        }
        updatePlanModeUI(tab, plugin, mode);
      }
    });
  }
}

/**
 * Providers emit either shared PermissionMode values (Grok/OpenCode/etc:
 * full_access | normal | plan) or Claude SDK modes (bypassPermissions, plan,
 * default, ...). Map both families onto Grimoire's shared toolbar modes.
 */
export function normalizePermissionModeSyncValue(sdkMode: string): string {
  const sharedMode = coercePermissionMode(sdkMode);
  if (sharedMode) {
    return sharedMode;
  }
  if (
    sdkMode === 'bypassPermissions'
    || sdkMode === LEGACY_YOLO_PERMISSION_MODE
    || sdkMode === 'always-approve'
  ) {
    return 'full_access';
  }
  if (sdkMode === 'plan') {
    return 'plan';
  }
  if (sdkMode === 'ask' || sdkMode === 'default') {
    return 'normal';
  }
  return 'normal';
}

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Renders an auto-triggered turn (e.g., agent response to task-notification)
 * that arrives after the main handler has completed.
 */
function isVisibleAutoTurnChunk(chunk: StreamChunk, hiddenToolIds: Set<string>): boolean {
  switch (chunk.type) {
    case 'text':
      return chunk.content.trim().length > 0;
    case 'thinking':
    case 'progress':
    case 'notice':
    case 'error':
    case 'tool_output':
    case 'context_compacted':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      return true;
    case 'tool_use':
      return chunk.name !== TOOL_AGENT_OUTPUT;
    case 'tool_result':
      return !hiddenToolIds.has(chunk.id);
    default:
      return false;
  }
}

function hasVisibleAutoTurnMessageContent(msg: ChatMessage): boolean {
  if (msg.content.trim().length > 0) return true;
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  return msg.contentBlocks?.some(block =>
    block.type !== 'text' || block.content.trim().length > 0
  ) ?? false;
}

async function renderAutoTriggeredTurn(tab: TabData, plugin: GrimoirePlugin, result: AutoTurnResult): Promise<void> {
  if (!tab.dom.contentEl.isConnected) {
    return;
  }

  const { chunks, metadata } = result;
  if (chunks.length === 0) return;

  const hiddenToolIds = new Set(
    chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use' }> =>
        chunk.type === 'tool_use' && chunk.name === TOOL_AGENT_OUTPUT
      )
      .map(chunk => chunk.id)
  );
  const hasVisibleContent = chunks.some(chunk => isVisibleAutoTurnChunk(chunk, hiddenToolIds));

  const assistantMsg: ChatMessage = {
    id: metadata.assistantMessageId ?? generateMessageId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
    responseMetadata: buildAssistantResponseMetadata(
      tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
      getTabSettingsSnapshot(tab, plugin),
    ),
    ...(metadata.assistantMessageId && { assistantMessageId: metadata.assistantMessageId }),
  };

  const previousContentEl = tab.state.currentContentEl;
  const previousTextEl = tab.state.currentTextEl;
  const previousTextContent = tab.state.currentTextContent;
  const previousThinkingState = tab.state.currentThinkingState;

  if (hasVisibleContent) {
    tab.state.addMessage(assistantMsg);
    const msgEl = tab.renderer?.addMessage?.(assistantMsg);
    const contentEl = msgEl?.querySelector<HTMLElement>('.grimoire-message-content');
    if (contentEl) {
      if (!previousContentEl) {
        tab.state.toolCallElements.clear();
      }
      tab.state.currentContentEl = contentEl;
      tab.state.currentTextEl = null;
      tab.state.currentTextContent = '';
      tab.state.currentThinkingState = null;
    }
  }

  try {
    for (const chunk of chunks) {
      await tab.controllers.streamController?.handleStreamChunk(chunk, assistantMsg);
    }

    if (hasVisibleContent && !hasVisibleAutoTurnMessageContent(assistantMsg)) {
      const placeholder = '(background task completed)';
      assistantMsg.content = placeholder;
      await tab.controllers.streamController?.appendText(placeholder);
    }

    if (hasVisibleContent) {
      await tab.controllers.streamController?.finalizeProgressBlocks(assistantMsg);
      await tab.controllers.streamController?.finalizeCurrentThinkingBlock(assistantMsg);
      await tab.controllers.streamController?.finalizeCurrentTextBlock(assistantMsg);
    }
  } finally {
    if (hasVisibleContent) {
      tab.controllers.streamController?.hideThinkingIndicator();
      tab.services.subagentManager.resetStreamingState?.();
      tab.state.currentContentEl = previousContentEl;
      tab.state.currentTextEl = previousTextEl;
      tab.state.currentTextContent = previousTextContent;
      tab.state.currentThinkingState = previousThinkingState;
      tab.renderer?.scrollToBottom();
    }
  }
}

export function updatePlanModeUI(tab: TabData, plugin: GrimoirePlugin, mode: string): void {
  const providerId = getTabProviderId(tab, plugin);
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
  if (uiConfig.applyPermissionMode) {
    uiConfig.applyPermissionMode(mode, snapshot);
  } else {
    snapshot.permissionMode = mode;
  }
  ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
    plugin.settings,
    providerId,
    snapshot,
  );
  void plugin.saveSettings();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass(
    'grimoire-input-plan-mode',
    mode === 'plan' && getTabCapabilities(tab, plugin).supportsPlanMode,
  );
}
