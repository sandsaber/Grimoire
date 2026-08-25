export { isRecord } from '../../../utils/records';
import { getHiddenProviderCommandSet } from '../../../core/providers/commands/hiddenCommands';
import type { ProviderCommandDropdownConfig } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderId,
  ProviderUIOption,
} from '../../../core/providers/types';
import type { Conversation, GrimoireSettings } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { isRecord } from '../../../utils/records';
import { getTabProviderId } from './providerResolution';
import type { TabId, TabProviderContext } from './types';

/**
 * Provider settings are shared by every tab in a plugin instance. Keep model
 * selections ordered per provider so a slower earlier save cannot overwrite a
 * later selection's future-tab default.
 */
export interface ProviderModelPersistenceQueue {
  tail: Promise<void>;
  durableConversationModels: Map<string, string | undefined>;
}

export const providerModelPersistenceQueues = new WeakMap<object, Map<ProviderId, ProviderModelPersistenceQueue>>();

export function getProviderModelPersistenceQueue(
  plugin: GrimoirePlugin,
  providerId: ProviderId,
): ProviderModelPersistenceQueue {
  let queues = providerModelPersistenceQueues.get(plugin);
  if (!queues) {
    queues = new Map();
    providerModelPersistenceQueues.set(plugin, queues);
  }

  let queue = queues.get(providerId);
  if (!queue) {
    queue = { tail: Promise.resolve(), durableConversationModels: new Map() };
    queues.set(providerId, queue);
  }
  return queue;
}

export function enqueueProviderModelPersistence<T>(
  plugin: GrimoirePlugin,
  providerId: ProviderId,
  task: (queue: ProviderModelPersistenceQueue) => Promise<T>,
): Promise<T> {
  const queue = getProviderModelPersistenceQueue(plugin, providerId);
  const persistence = queue.tail.catch(() => {}).then(() => task(queue));
  const continuation = persistence.then(() => {}, () => {});
  queue.tail = continuation;
  void continuation.then(() => {
    const queues = providerModelPersistenceQueues.get(plugin);
    if (queues?.get(providerId) === queue && queue.tail === continuation) {
      queues.delete(providerId);
    }
  });
  return persistence;
}


export type TabProviderSettings = Record<string, unknown> & {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  customContextLimits?: Record<string, number>;
};

export const DRAFT_SETTINGS_KEYS = [
  'model',
  'thinkingBudget',
  'effortLevel',
  'serviceTier',
  'permissionMode',
] as const;

export type ContextEngineRelevantSettings = GrimoireSettings & {
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
  return providerCatalog().enabledIds(settings).flatMap((providerId) => {
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const providerIcon = uiConfig.getProviderIcon?.() ?? undefined;
    const group = providerCatalog().displayName(providerId);

    return uiConfig.getModelOptions(settings)
      .map(model => ({
        ...model,
        group,
        providerId,
        ...(providerIcon ? { providerIcon } : {}),
      }));
  });
}

export function getRecordEntry(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function hasStartedConversation(conversation: Conversation | null | undefined): conversation is Conversation {
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

export function cloneSerializableValue(value: unknown, depth = 0): unknown {
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

export function cloneSerializableRecord(value: unknown): Record<string, unknown> | null {
  const cloned = cloneSerializableValue(value);
  return isRecord(cloned) ? cloned : null;
}

export function createDraftSettingsSnapshot(
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

export function mergeDraftSettingsSnapshot(
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

/**
 * Resolves the draft model for a new blank tab by projecting provider-specific
 * saved settings. Without this, `plugin.settings.model` reflects only the
 * settings-provider's model, which may belong to a different provider.
 */
export function resolveBlankTabModel(
  plugin: GrimoirePlugin,
  providerId?: ProviderId,
): string {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  if (!providerId) {
    return settings.model as string;
  }

  const targetProviderId = providerCatalog().isEnabled(settings, providerId)
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

export function getTabCapabilities(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): ProviderCapabilities {
  const providerId = getTabProviderId(tab, plugin, conversation);
  if (tab.service?.providerId === providerId) {
    return tab.service.getCapabilities();
  }

  return providerCatalog().capabilities(providerId);
}

export function getTabChatUIConfig(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): ProviderChatUIConfig {
  return ProviderRegistry.getChatUIConfig(getTabProviderId(tab, plugin, conversation));
}

export function resolveLegacyConversationModel(conversation: Conversation | null | undefined): string | undefined {
  if (!conversation) {
    return undefined;
  }

  const persisted = conversation.assistantResponseMetadata;
  for (let index = (persisted?.length ?? 0) - 1; index >= 0; index--) {
    const model = persisted?.[index]?.metadata.model;
    if (model) return model;
  }
  for (let index = conversation.messages.length - 1; index >= 0; index--) {
    const model = conversation.messages[index].responseMetadata?.model;
    if (model) return model;
  }
  return conversation.usage?.model;
}

/** Resolves the model for a tab without making other provider settings tab-local. */
export function resolveTabModel(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): string | undefined {
  if (tab.lifecycleState === 'blank') {
    return tab.draftModel ?? undefined;
  }
  const boundConversation = conversation ?? (tab.conversationId
    ? plugin.getConversationSync(tab.conversationId)
    : null);
  return boundConversation?.model ?? resolveLegacyConversationModel(boundConversation);
}

export function getTabSettingsSnapshot(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): TabProviderSettings {
  const providerId = getTabProviderId(tab, plugin, conversation);
  const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
    plugin.settings,
    providerId,
  );
  if (tab.lifecycleState === 'blank') {
    return mergeDraftSettingsSnapshot(snapshot, tab.draftSettings, providerId);
  }
  const model = resolveTabModel(tab, plugin, conversation);
  if (model) {
    snapshot.model = model;
  }
  return snapshot;
}

export function getTabPermissionMode(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
): string {
  const permissionMode = getTabSettingsSnapshot(tab, plugin).permissionMode;
  return typeof permissionMode === 'string' && permissionMode
    ? permissionMode
    : 'normal';
}

export function getTabHiddenCommands(
  tab: TabProviderContext,
  plugin: GrimoirePlugin,
  conversation?: Conversation | null,
): Set<string> {
  return getHiddenProviderCommandSet(
    plugin.settings,
    getTabProviderId(tab, plugin, conversation),
  );
}

export function shouldSendMessageFromEnterKey(
  e: KeyboardEvent,
  settings: Pick<GrimoireSettings, 'requireCommandOrControlEnterToSend'>,
): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) {
    return false;
  }

  return settings.requireCommandOrControlEnterToSend !== true;
}

export type ProviderCatalogInfo = {
  config: ProviderCommandDropdownConfig;
  getEntries: () => Promise<ProviderCommandEntry[]>;
} | null;

export function getRegistryProviderCatalogInfo(providerId: ProviderId): ProviderCatalogInfo {
  const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
  if (!catalog) {
    return null;
  }

  return {
    config: catalog.getDropdownConfig(),
    getEntries: () => catalog.listDropdownEntries({ includeBuiltIns: false }),
  };
}

export function getProviderMcpManager(providerId: ProviderId) {
  return ProviderWorkspaceRegistry.getMcpServerManager(providerId);
}
