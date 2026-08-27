import { AuxiliaryExecutionOwner } from '../../../app/auxiliary/AuxiliaryExecutionOwner';
import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderChatUIConfig,
  ProviderId,
  ProviderPlanUsage,
  ProviderPlanUsageWindow,
} from '../../../core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { getTabProviderId } from './providerResolution';
import {
  syncBoundStatus,
  syncContextSummary,
} from './tabContextUI';
import {
  createDraftSettingsSnapshot,
  getProviderMcpManager,
  getRegistryProviderCatalogInfo,
  getTabCapabilities,
  getTabChatUIConfig,
  getTabHiddenCommands,
  getTabPermissionMode,
  getTabSettingsSnapshot,
  type ProviderCatalogInfo,
  type TabProviderSettings,
} from './tabSettings';
import type { TabData } from './types';

export function getProviderUsageSnapshot(plugin: GrimoirePlugin, providerId: ProviderId): ProviderPlanUsage | null {
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

export function summarizeUsageWindow(window: ProviderPlanUsageWindow): Record<string, unknown> {
  return {
    label: window.label,
    pct: window.pct,
    ...(window.pctKnown === false ? { pctKnown: false } : {}),
    reset: window.reset,
  };
}

export function summarizePlanUsage(usage: ProviderPlanUsage | null): Record<string, unknown> {
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

export async function refreshProviderUsageSnapshot(plugin: GrimoirePlugin, providerId: ProviderId): Promise<ProviderPlanUsage | null> {
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

export function refreshPlanUsageUI(tab: TabData): void {
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

export function recordProviderLaunchArtifacts(tab: TabData, plugin: GrimoirePlugin): void {
  const providerId = getTabProviderId(tab, plugin);
  for (const path of providerCatalog().preloadedContextFiles(providerId)) {
    tab.ui.runtimeContextActivity?.recordPreloadedFile(providerId, path);
  }
}

export function syncSlashCommandDropdownForProvider(
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

export async function updateTabProviderSettings(
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

export async function applyBlankDraftSettings(
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

export function runProviderChangedInBackground(
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

export function runDraftSettingsChangedInBackground(
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

export function refreshTabProviderUI(tab: TabData, plugin: GrimoirePlugin): void {
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

export function prepareModelMetadataInBackground(
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
/**
 * Hides or disables UI elements that the active provider does not support.
 * Called after toolbar initialization and on provider switches.
 */
export function applyProviderUIGating(tab: TabData, plugin: GrimoirePlugin): void {
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

export function syncTabProviderServices(
  tab: TabData,
  plugin: GrimoirePlugin,
): void {
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = auxiliaryExecution(plugin, tab.providerId)
    .instructionRefineService(tab.providerId);
  tab.services.subagentManager.setTaskResultInterpreter?.(
    ProviderRegistry.getTaskResultInterpreter(tab.providerId)
  );
}

export function ensureTitleGenerationService(tab: TabData, plugin: GrimoirePlugin): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = auxiliaryExecution(plugin, tab.providerId)
      .titleGenerationService();
  }
}

/**
 * The application's auxiliary owner, or one that reports it has none.
 *
 * A tab can be built before the kernel has started and survives an unload that
 * takes the composition down, and neither is a reason to hand back a service
 * that fails somewhere the user cannot see.
 */
function auxiliaryExecution(
  plugin: GrimoirePlugin,
  providerId: ProviderId,
): AuxiliaryExecutionOwner {
  return plugin.getApplicationRuntimeOrNull()?.auxiliary
    ?? AuxiliaryExecutionOwner.unavailable(providerId);
}

export function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === 'function') {
    // Discarded on purpose: the contract returns void, and the async
    // implementations report their own failures rather than rejecting.
    void tab.service.cleanup();
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
  const enabledProviderIds = providerCatalog().enabledIds(settingsSnapshot);
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
