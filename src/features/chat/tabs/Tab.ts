import type { Component } from 'obsidian';
import { Notice, setIcon } from 'obsidian';

import { createObsidianVaultNoteSource } from '@/app/context/ObsidianVaultNoteSource';

import { ProjectWorkspaceStore } from '../../../core/context/ProjectWorkspaceStore';
import { RelevantNotesService } from '../../../core/context/RelevantNotesService';
import { VaultSearchService } from '../../../core/context/VaultSearchService';
import { VaultTextIndex } from '../../../core/context/VaultTextIndex';
import type { ProviderCommandDropdownConfig } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { getOpaqueProviderState } from '../../../core/providers/getOpaqueProviderState';
import { getEnabledProviderForModel, getProviderForModel } from '../../../core/providers/modelRouting';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import type { ProviderChatUiContribution } from '../../../core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type {
  ProviderId,
} from '../../../core/providers/types';
import {
  DEFAULT_CHAT_PROVIDER_ID,
} from '../../../core/providers/types';
import type {
  ExecutionChatRuntimeAdapter,
  ExecutionInteractionCallbacks,
} from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { AutoTurnResult } from '../../../core/runtime/types';
import { TOOL_AGENT_OUTPUT } from '../../../core/tools/toolNames';
import {
  type ChatMessage,
  type Conversation,
  type StreamChunk,
  type UsageInfo,
  VIEW_TYPE_GRIMOIRE,
} from '../../../core/types';
import { coercePermissionMode, LEGACY_YOLO_PERMISSION_MODE } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { SlashCommandDropdown } from '../../../shared/components/SlashCommandDropdown';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { BrowserSelectionController } from '../controllers/BrowserSelectionController';
import { CanvasSelectionController } from '../controllers/CanvasSelectionController';
import { ConversationController } from '../controllers/ConversationController';
import { InputController } from '../controllers/InputController';
import { NavigationController } from '../controllers/NavigationController';
import { SelectionController } from '../controllers/SelectionController';
import { StreamController } from '../controllers/StreamController';
import { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { findRewindContext } from '../rewind';
import { SubagentManager } from '../services/SubagentManager';
import { ChatState } from '../state/ChatState';
import { BangBashModeManager as BangBashModeManagerClass } from '../ui/BangBashModeManager';
import { RuntimeContextActivityView } from '../ui/context/RuntimeContextActivity';
import { createInputToolbar } from '../ui/InputToolbar';
import { InstructionModeManager as InstructionModeManagerClass } from '../ui/InstructionModeManager';
import { NavigationSidebar } from '../ui/NavigationSidebar';
import { RelevantNotesView } from '../ui/RelevantNotesView';
import { StatusPanel } from '../ui/StatusPanel';
import { autoResizeTextarea } from '../ui/textareaResize';
import { buildAssistantResponseMetadata } from '../utils/assistantResponseMetadata';
import { recalculateUsageForModel } from '../utils/usageInfo';
import { getTabProviderId } from './providerResolution';
import { attachInputResizeHandle, buildTabDOM } from './tabDOM';
import {
  durableAgentsRunning,
  recordDurableSubagent,
  refreshBackgroundAgentCard,
} from './tabDurableSubagents';
import { resolveTabProjectionExecution } from './tabProjectionExecution';
import {
  AUTO_SCROLL_REENABLE_DELAY_MS,
  isTabScrollAtBottom,
  scrollTabToBottom,
  shouldAutoScrollTab,
  updateAutoScrollUI,
} from './tabScroll';
import {
  cloneSerializableRecord,
  createDraftSettingsSnapshot,
  enqueueProviderModelPersistence,
  getBlankTabModelOptions,
  getProviderMcpManager,
  getProviderModelPersistenceQueue,
  getTabCapabilities,
  getTabChatUIConfig,
  getTabHiddenCommands,
  getTabPermissionMode,
  getTabSettingsSnapshot,
  type ProviderCatalogInfo,
  resolveBlankTabModel,
  resolveTabModel,
  shouldSendMessageFromEnterKey,
  type TabProviderSettings,
} from './tabSettings';
import type { TabData, TabId } from './types';
import { generateTabId } from './types';

export { getTabProviderId } from './providerResolution';
export {
  getBlankTabModelOptions,
  getTabSettingsSnapshot,
  resolveTabModel,
} from './tabSettings';

import { NO_TASK_RESULT_INTERPRETATION } from '../../../core/providers/noTaskResultInterpretation';
import {
  initializeContextManagers,
  openRelevantVaultPath,
  renderExternalFileChips,
  syncBoundStatus,
  syncComposerStopButton,
  syncContextSummary,
  updateRelevantNotes,
} from './tabContextUI';
import {
  applyBlankDraftSettings,
  applyProviderUIGating,
  cleanupTabRuntime,
  ensureTitleGenerationService,
  getProviderUsageSnapshot,
  prepareModelMetadataInBackground,
  recordProviderLaunchArtifacts,
  refreshPlanUsageUI,
  refreshProviderUsageSnapshot,
  refreshRuntimeContextUI,
  refreshTabProviderUI,
  runProviderChangedInBackground,
  syncSlashCommandDropdownForProvider,
  syncTabProviderServices,
  updateTabProviderSettings,
} from './tabProviderUI';

export {
  onProviderAvailabilityChanged,
  refreshRuntimeContextUI,
} from './tabProviderUI';

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

  const vaultTextIndex = new VaultTextIndex(createObsidianVaultNoteSource(plugin.app));
  const vaultSearchService = new VaultSearchService(vaultTextIndex);
  const relevantNotesService = new RelevantNotesService(vaultTextIndex);

  const dom = buildTabDOM(contentEl);
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
  // Built here rather than above, because it needs the provider this tab is
  // for: reading a subagent result is provider-specific, and the interpreter
  // used to default to one named provider's for every tab until a rebind.
  // The callback is a placeholder — `initializeTabControllers` replaces it once
  // the StreamController it updates exists.
  const subagentManager = new SubagentManager(
    () => {},
    providerCatalog().declarations(initialProviderId).asyncTaskResults
      ?? NO_TASK_RESULT_INTERPRETATION,
  );

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
      agentMentionServices: new Map(),
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
    // Built after the controllers are, because a tab's binding reads them.
    execution: null,
    orchestratorMode: conversation?.orchestratorMode === true
      || (!isBound && options.orchestratorMode === true),
  };

  return tab;
}

/**
 * Builds the DOM structure for a tab.
 */


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

  let service: ExecutionChatRuntimeAdapter | null = null;
  let unsubscribeReadyState: (() => void) | null = null;
  const previousService = tab.service;

  try {
    if (typeof previousService?.cleanup === 'function') {
      // Discarded on purpose: `ChatRuntime.cleanup()` returns void by contract,
      // and the implementations that are async are total — a tab must not wait
      // on a provider to finish closing before it can be replaced.
      void previousService.cleanup();
    }
    tab.service = null;
    tab.serviceInitialized = false;

    await applyBlankDraftSettings(tab, plugin, providerId);
    // From the composition that builds it, not through a registration whose
    // factory reached the same composition by way of a plugin.
    const runtime = plugin.getApplicationRuntimeOrNull()?.createRuntimeFor(providerId);
    if (!runtime) {
      throw new Error(`${providerCatalog().displayNameOrId(providerId)} has no execution to run on.`);
    }
    service = runtime;
    unsubscribeReadyState = runtime.onReadyStateChange(() => {});
    tab.dom.eventCleanups.push(() => unsubscribeReadyState?.());

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    if (conversation) {

      runtime.syncConversationState(conversation);
    }

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      unsubscribeReadyState?.();
      void service?.cleanup();
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
    void service?.cleanup();
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


function initializeSlashCommands(
  tab: TabData,
  getHiddenCommands?: () => Set<string>,
  catalogInfo?: {
    config: ProviderCommandDropdownConfig;
    getEntries: () => Promise<readonly ProviderCommandEntry[]>;
  } | null,
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

  // Bang bash mode (! command execution) — only for the tab's provider.
  if (isBangBashEnabledForProvider(plugin.settings, getTabProviderId(tab, plugin))) {
    const vaultPath = getVaultPath(plugin.app);
    if (vaultPath) {
      const enhancedPath = getEnhancedPath();

      tab.ui.bangBashModeManager = new BangBashModeManagerClass(
        dom.inputEl,
        {
          onSubmit: async (command) => {
            const statusPanel = tab.ui.statusPanel;
            if (!statusPanel) return;

            const id = `bash-${Date.now()}`;
            statusPanel.addBashOutput({ id, command, status: 'running', output: '' });

            // Through the kernel rather than a child process of this feature:
            // the run is owned by the application, so unloading the plugin
            // takes the command down with it.
            const result = await plugin.runShellCommand({
              command,
              cwd: vaultPath,
              environment: { ...process.env as Record<string, string>, PATH: enhancedPath },
            });
            const output = [result.stdout, result.stderr, result.error]
              .filter(Boolean).join('\n').trim();
            statusPanel.updateBashOutput(id, {
              status: result.failed ? 'error' : 'completed',
              output,
            });
          },
          getInputWrapper: () => dom.inputWrapper,
        }
      );
    }
  }

  tab.ui.statusPanel = new StatusPanel();
  tab.ui.statusPanel.mount(dom.statusPanelContainerEl);
}

function isBangBashEnabledForProvider(
  settings: Record<string, unknown>,
  providerId: ProviderId,
): boolean {
  return providerCatalog().declarations(providerId).chatUI.bangBashEnabled(settings);
}

function getModelCatalogProviderIds(
  _tab: TabData,
  plugin: GrimoirePlugin,
): readonly ProviderId[] {
  return providerCatalog().enabledIds(plugin.settings);
}

async function refreshTabModelOptions(tab: TabData, plugin: GrimoirePlugin): Promise<void> {
  const providerIds = getModelCatalogProviderIds(tab, plugin);
  await Promise.all(providerIds.map(async (providerId) => {
    // `enabledIds` above is the gate the row's own `isAvailable` was: for the
    // one provider that implemented it, it answered "is this provider enabled",
    // which the catalog already decided before this loop started.
    const models = (await plugin.getApplicationRuntimeOrNull()?.workspaceFor(providerId))?.models;
    await models?.refresh();
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
  const mixedModelChatUIProxy = (): ProviderChatUiContribution => {
    const draftProvider = tab.draftModel
      ? getEnabledProviderForModel(tab.draftModel, plugin.settings)
      : getTabProviderId(tab, plugin);
    const base = providerCatalog().declarations(draftProvider).chatUI;
    return {
      ...base,
      models: {
        ...base.models,
        options: (settings: Record<string, unknown>) => getBlankTabModelOptions(settings),
      },
    };
  };

  const toolbarComponents = createInputToolbar(inputToolbar, {
    getChatUI: () => mixedModelChatUIProxy(),
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
        const newChatUI = providerCatalog().declarations(newProvider).chatUI;
        await updateTabProviderSettings(
          tab,
          plugin,
          (settings) => {
            settings.model = model;
            newChatUI.models.applyDefaults(model, settings);
          },
          onDraftSettingsChanged,
        );
        if (didProviderChange) {
          runProviderChangedInBackground(onProviderChanged, newProvider);
        }
        prepareModelMetadataInBackground(tab, plugin, newProvider, model, newChatUI);
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
        new Notice(t('chat.ui.errors.providerSwitchBound'));
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.planUsageBadge?.updateDisplay();
        return;
      }

      const chatUI = getTabChatUIConfig(tab, plugin);
      const modelSelectionGeneration = (tab.modelSelectionGeneration ?? 0) + 1;
      tab.modelSelectionGeneration = modelSelectionGeneration;
      const targetConversationId = tab.conversationId;
      const conversation = targetConversationId
        ? plugin.getConversationSync(targetConversationId)
        : null;
      const previousConversationModel = conversation?.model;
      const persistenceQueue = getProviderModelPersistenceQueue(plugin, boundProvider);
      if (targetConversationId && !persistenceQueue.durableConversationModels.has(targetConversationId)) {
        persistenceQueue.durableConversationModels.set(targetConversationId, previousConversationModel);
      }

      // Make the new bound-tab model visible to a Send triggered before persistence finishes.
      if (conversation) {
        conversation.model = model;
      }

      let providerSettings: TabProviderSettings | undefined;
      const isCurrentSelection = () => (
        tab.modelSelectionGeneration === modelSelectionGeneration
        && tab.conversationId === targetConversationId
      );
      const rollbackConversationModel = () => {
        if (conversation?.model === model) {
          conversation.model = targetConversationId
            ? persistenceQueue.durableConversationModels.get(targetConversationId)
            : previousConversationModel;
        }
      };
      const persistence = enqueueProviderModelPersistence(plugin, boundProvider, async (queue) => {
          const previousProviderSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
            plugin.settings,
            boundProvider,
          );
          if (!isCurrentSelection()) {
            rollbackConversationModel();
            return;
          }
          try {
            providerSettings = await updateTabProviderSettings(
              tab,
              plugin,
              (settings) => {
                settings.model = model;
                chatUI.models.applyDefaults(model, settings);
              },
              onDraftSettingsChanged,
            );
            if (!isCurrentSelection()) {
              rollbackConversationModel();
              return;
            }
            if (targetConversationId) {
              await plugin.updateConversation(targetConversationId, { model });
              queue.durableConversationModels.set(targetConversationId, model);
            }
          } catch (error) {
            rollbackConversationModel();
            ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
              plugin.settings,
              boundProvider,
              previousProviderSettings,
            );
            await plugin.saveSettings().catch(() => {});
            throw error;
          }
        });
      try {
        await persistence;
        if (!isCurrentSelection()) {
          return;
        }
      } catch (error) {
        if (!isCurrentSelection()) {
          rollbackConversationModel();
          return;
        }
        rollbackConversationModel();
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.modelSelector?.renderOptions();
        throw error;
      }
      if (!providerSettings || !isCurrentSelection()) {
        return;
      }
      prepareModelMetadataInBackground(tab, plugin, boundProvider, model, chatUI);
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.serviceTierToggle?.updateDisplay();
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.planUsageBadge?.updateDisplay();
      tab.ui.planUsageBadge?.refreshInBackground();
      tab.ui.modelSelector?.renderOptions();

      // Recalculate context usage percentage for the new model's context window
      const currentUsage = tab.state.usage;
      if (currentUsage) {
        const newContextWindow = chatUI.models.contextWindow(
          model,
          providerSettings,
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
          getTabChatUIConfig(tab, plugin).modeSelector?.apply(mode, settings);
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
          getTabChatUIConfig(tab, plugin).reasoning?.apply?.(settings.model, budget, settings);
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
          getTabChatUIConfig(tab, plugin).reasoning?.apply?.(settings.model, effort, settings);
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
          // A provider that publishes a toggle but implements no apply hook —
          // Claude and Codex — keeps the shared field written directly, which
          // is what the optional member on the row makes visible.
          const permissionMode = getTabChatUIConfig(tab, plugin).permissionMode;
          if (permissionMode?.apply) {
            permissionMode.apply(mode, settings);
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
    attr: {
      type: 'button',
      'aria-label': t('chat.ui.composer.stopResponse'),
    },
  });
  setIcon(dom.stopButtonEl, 'square');
  dom.sendButtonEl = sendActionsEl.createEl('button', {
    cls: 'grimoire-send-button',
    text: t('chat.ui.composer.send'),
    attr: { type: 'button', 'aria-label': t('chat.ui.composer.sendMessage') },
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

  tab.ui.mcpServerSelector.setMcpManager(getProviderMcpManager(getTabProviderId(tab, plugin), plugin));

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

  tab.ui.navigationSidebar = new NavigationSidebar(
    dom.workbenchGridEl,
    dom.chatScrollEl,
    dom.messagesEl,
    () => scrollTabToBottom(tab, plugin),
  );

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
      updateAutoScrollUI(tab, plugin);
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
  model?: string;
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
  model?: string;
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
    : providerCatalog()
      .declarations(conversation?.providerId ?? tab.providerId)
      .conversationState?.resolveSessionId(conversation) ?? null;

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    providerId: getTabProviderId(tab, plugin, conversation),
    sourceSessionId,
    sourceProviderState: getOpaqueProviderState(conversation),
    sourceTitle: conversation?.title,
    currentNote: conversation?.currentNote,
    model: resolveTabModel(tab, plugin, conversation),
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
    new Notice(t('chat.ui.errors.forkUnsupported'));
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
    model: source.model,
  });
}

async function handleForkAll(
  tab: TabData,
  plugin: GrimoirePlugin,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (!getTabCapabilities(tab, plugin).supportsFork) {
    new Notice(t('chat.ui.errors.forkUnsupported'));
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
    model: source.model,
  });
}

export function initializeTabControllers(
  tab: TabData,
  plugin: GrimoirePlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getProviderCatalogConfig?: () => ProviderCatalogInfo,
): void {
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
      onAutoScrollSuppressed: () => updateAutoScrollUI(tab, plugin),
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
    getActiveProviderSettings: () => getTabSettingsSnapshot(tab, plugin),
    recordRuntimeToolCall: (toolCall) => {
      tab.ui.runtimeContextActivity?.recordToolCall(getTabProviderId(tab, plugin), toolCall);
    },
    onSubagentActivityDetected: () => syncComposerStopButton(tab, true),
  });

  // Wire subagent callback now that StreamController exists
  // DOM updates for async subagents are handled by SubagentManager directly;
  // this callback handles message persistence.
  services.subagentManager.setCallback(
    (subagent) => {
      tab.controllers.streamController?.onAsyncSubagentStateChange(subagent);
      // **Recorded, then redrawn from what was recorded** — and the redraw
      // waits for the write. Fired side by side, the read wins: the first
      // `running` event drew an empty list because nothing was adopted yet, and
      // a terminal drew the record before its result was appended, which the
      // card reads as still running. Nothing follows a terminal, so it stayed
      // that way.
      void recordDurableSubagent(tab, plugin, subagent)
        .then(() => refreshBackgroundAgentCard(tab, plugin));

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
      // For one thing only: stopping a turn. The kernel owns the run, so the
      // runtime's own `cancel` acts on a run it never started.
      getProjectionExecution: () => resolveTabProjectionExecution(tab, plugin),
      getActiveProviderSettings: () => getTabSettingsSnapshot(tab, plugin),
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
        if (tab.conversationId !== (conversation?.id ?? null)) {
          tab.modelSelectionGeneration = (tab.modelSelectionGeneration ?? 0) + 1;
        }
        tab.orchestratorMode = conversation?.orchestratorMode === true;
        tab.draftModel = null;
        tab.draftSettings = null;
        tab.conversationId = conversation?.id ?? null;
        tab.lifecycleState = conversation ? 'bound_cold' : 'blank';
        syncSlashCommandDropdownForProvider(tab, plugin, getProviderCatalogConfig, conversation);

        // If the runtime already exists for the right provider, sync it passively
        if (tab.service && tab.service.providerId === nextProviderId && conversation) {
          tab.service.syncConversationState(conversation);
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
        // A blank tab owns no conversation, so it shows no background work.
        // Without this the cards of the conversation just left stay on screen.
        void refreshBackgroundAgentCard(tab, plugin);
      },
      onConversationLoaded: () => {
        ui.slashCommandDropdown?.resetSdkSkillsCache();
        refreshRuntimeContextUI(tab, plugin);
        // **This is what makes the card mean anything.** An agent started in a
        // tab that has since closed fires no live event, so opening the
        // conversation is the only moment it can appear at all — and the whole
        // point of recording it was that it appears.
        void refreshBackgroundAgentCard(tab, plugin);
      },
      onConversationSwitched: () => {
        ui.slashCommandDropdown?.resetSdkSkillsCache();
        refreshRuntimeContextUI(tab, plugin);
        // And on the way in to another conversation, which also clears the
        // cards belonging to the one being left.
        void refreshBackgroundAgentCard(tab, plugin);
      },
    }
  );

  tab.controllers.inputController = new InputController({
    plugin,
    state,
    // Read late: the binding is built after the controllers are, and a tab
    // whose provider is not on the projection path never has one.
    getProjectionExecution: () => resolveTabProjectionExecution(tab, plugin),
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
    // The tab's draft, not the runtime's: `getAuxiliaryModel` is absent from
    // the adapter by contract — recorded in `adapterMemberCoverage.test.ts` —
    // so the optional call answered `undefined` for every flipped provider and
    // this fallback is what has been running. Typing the field as the adapter
    // is what made that visible.
    getAuxiliaryModel: () => tab.draftModel ?? null,
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
      const targetModel = model ?? resolveBlankTabModel(plugin, providerId);
      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
        plugin.settings,
        providerId,
      ) as TabProviderSettings;

      snapshot.model = targetModel;
      providerCatalog().declarations(providerId).chatUI.models
        .applyDefaults(targetModel, snapshot);
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
        if (!providerCatalog().isEnabled(plugin.settings, tab.providerId)) {
          throw new Error(`${providerCatalog().displayName(tab.providerId)} is disabled. Enable it in Grimoire settings first.`);
        }

        await initializeTabService(tab, plugin);
        setupServiceCallbacks(tab, plugin);

        // Transition: lock model selector to bound provider
        refreshTabProviderUI(tab, plugin);
        applyProviderUIGating(tab, plugin);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : t('chat.ui.errors.initializeFailed'));
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
      updateAutoScrollUI(tab, plugin);
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
      updateAutoScrollUI(tab, plugin);
    } else if (!state.autoScrollEnabled) {
      // Debounce re-enabling to avoid bounce during scroll animation
      if (!reEnableTimeout) {
        reEnableTimeout = window.setTimeout(() => {
          reEnableTimeout = null;
          if (isTabScrollAtBottom(tab)) {
            state.autoScrollEnabled = true;
          }
          updateAutoScrollUI(tab, plugin);
        }, AUTO_SCROLL_REENABLE_DELAY_MS);
      }
    } else {
      updateAutoScrollUI(tab, plugin);
    }
  };

  dom.chatScrollEl.addEventListener('scroll', scrollHandler, { passive: true });
  dom.eventCleanups.push(() => {
    dom.chatScrollEl.removeEventListener('scroll', scrollHandler);
    if (reEnableTimeout) window.clearTimeout(reEnableTimeout);
  });
  updateAutoScrollUI(tab, plugin);
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

  // First, and before anything cancels: this ends the *view* of the work. What
  // happens to a run still going is the kernel's to decide, and a tab that
  // stopped drawing is not a tab that stopped the turn.
  tab.execution?.detach();
  tab.execution = null;

  // Invalidate any in-flight stream so sendMessage finally-blocks skip
  // DOM/save work against a torn-down tab (mirrors createNew({ force })).
  if (tab.state.isStreaming) {
    tab.state.cancelRequested = true;
    tab.state.bumpStreamGeneration();
    tab.controllers.inputController?.cancelStreaming();
  }
  tab.controllers.streamController?.resetStreamingState();
  tab.state.isStreaming = false;

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
  tab.ui.imageContextManager?.destroy();
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
  tab.ui.thinkingBudgetSelector?.destroy();
  tab.ui.permissionToggle?.destroy();
  tab.ui.navigationSidebar?.destroy();
  tab.ui.navigationSidebar = null;

  // **Closing a tab no longer abandons the work it started.** This used to mark
  // every running background agent `orphaned` — a status meaning "nobody is
  // watching this any more", which was true and was all anyone ever learned
  // about it. The records outlive the tab now and the status panel draws them
  // from the vault, so reopening the conversation shows the agent still running
  // and how it ended. The in-memory maps still go: they belong to this tab.
  tab.services.subagentManager.clear();

  for (const cleanup of tab.dom.eventCleanups) {
    cleanup();
  }
  tab.dom.eventCleanups.length = 0;

  // Clean up runtime before removing DOM. Discarded: see `replaceTabRuntime`.
  void tab.service?.cleanup();
  tab.service = null;
  tab.dom.contentEl.remove();
}

/**
 * Gets the display title for a tab.
 * Uses synchronous access since we only need the title, not messages.
 */
export function getTabTitle(tab: TabData, plugin: GrimoirePlugin): string {
  if (tab.titleOverride) {
    return tab.titleOverride;
  }
  if (tab.conversationId) {
    const conversation = plugin.getConversationSync(tab.conversationId);
    if (conversation?.title) {
      return conversation.title;
    }
  }
  return t('chat.ui.messages.newChatTitle');
}

/**
 * Gives the tab's adapter everything its presenter needs, in one call.
 *
 * **Off the frozen contract.** These were seven `ChatRuntime` setters that the
 * adapter stored and never acted on — a seam, not a runtime capability — and
 * they are one `installInteractions` on the adapter now. Installed together
 * rather than one at a time, so a presenter is never half built between two of
 * them.
 *
 * Shared between Tab.ts and TabManager.ts to avoid duplication.
 */
export function setupServiceCallbacks(tab: TabData, plugin: GrimoirePlugin): void {
  const adapter = interactionInstallerFor(tab);
  if (!adapter || !tab.controllers.inputController) {
    return;
  }

  adapter.installInteractions({
    approval: async (toolName, input, description, options) =>
      await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
      ?? 'cancel',

    approvalDismisser: () => tab.controllers.inputController?.dismissPendingApprovalPrompt(),

    autoTurn: (result: AutoTurnResult) => renderAutoTriggeredTurn(tab, plugin, result),

    planDecision: async (input, signal) => {
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
    },

    permissionModeSync: (sdkMode: string) => {
      // Claude SDK uses bypassPermissions; ACP providers emit already-normalized
      // Grimoire modes (full_access / plan / normal). Unknown values stay Safe.
      const mode = sdkMode === 'bypassPermissions' || sdkMode === LEGACY_YOLO_PERMISSION_MODE
        ? 'full_access'
        : coercePermissionMode(sdkMode) ?? 'normal';
      const currentMode = getTabPermissionMode(tab, plugin);

      if (currentMode !== mode) {
        // Save pre-plan mode when entering plan (for Shift+Tab toggle restore)
        if (mode === 'plan' && tab.state.prePlanPermissionMode === null) {
          tab.state.prePlanPermissionMode = currentMode;
        }
        updatePlanModeUI(tab, plugin, mode);
      }
    },

    question: async (input, signal) =>
      await tab.controllers.inputController?.handleAskUserQuestion(input, signal) ?? null,

    subagentState: () => ({
      // The tab's own view, and the records'. The manager is per tab and is
      // cleared on a conversation switch, so an agent started before one — or in
      // a tab that has since closed — is in no live map here; the records are
      // where it still exists. Either saying yes is enough, because what this
      // decides is whether Claude may end a turn on top of running work.
      hasRunning: tab.services.subagentManager.hasRunningSubagents()
        || durableAgentsRunning(tab, plugin),
    }),
  });
}

/**
 * The tab's runtime as something that can take an interaction installation.
 *
 * Asked by shape rather than by class, like `tabProjectionExecution` asks for
 * the same object: the field is typed as the frozen `ChatRuntime`, which no
 * longer carries these — and must not. A tab whose runtime cannot take them is
 * left alone rather than guessed at.
 */
interface InteractionInstaller {
  installInteractions(callbacks: ExecutionInteractionCallbacks): void;
}

function interactionInstallerFor(tab: TabData): InteractionInstaller | null {
  const service: unknown = tab.service;
  return isInteractionInstaller(service) ? service : null;
}

function isInteractionInstaller(value: unknown): value is InteractionInstaller {
  return typeof (value as InteractionInstaller | null)?.installInteractions === 'function';
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
      assistantMsg.completedAt = Date.now();
      tab.renderer?.updateMessageCompletionTime?.(assistantMsg);
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
  const permissionMode = providerCatalog().declarations(providerId).chatUI.permissionMode;
  if (permissionMode?.apply) {
    permissionMode.apply(mode, snapshot);
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
