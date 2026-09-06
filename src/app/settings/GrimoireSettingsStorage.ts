import { GRIMOIRE_SETTINGS_PATH } from '../../core/bootstrap/StoragePaths';
import {
  normalizeHiddenCommandList,
  normalizeHiddenProviderCommands,
} from '../../core/providers/commands/hiddenCommands';
import {
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  resolveEnvironmentSnippetScope,
} from '../../core/providers/providerEnvironment';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import {
  type AdvancedSectionsOpen,
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  coercePermissionMode,
  type EnvironmentScope,
  type EnvSnippet,
  type GrimoireSettings,
  type HiddenProviderCommands,
  normalizeMaxTabs,
  normalizePermissionMode,
  type ProviderConfigMap,
  type TabBarPosition,
} from '../../core/types/settings';
import { builtInProviderCatalog } from '../../providers/BuiltInProviderCatalog';
import { DEFAULT_GRIMOIRE_SETTINGS } from './defaultSettings';

export { GRIMOIRE_SETTINGS_PATH };

export type StoredGrimoireSettings = GrimoireSettings;

const LEGACY_TOP_LEVEL_PROVIDER_FIELDS = [
  'claudeCliPath',
  'claudeCliPathsByHost',
  'codexCliPath',
  'codexCliPathsByHost',
  'codexReasoningSummary',
  'codexEnabled',
  'lastClaudeModel',
  'enableChrome',
  'enableBangBash',
  'enableOpus1M',
  'enableSonnet1M',
  'environmentVariables',
  'lastEnvHash',
  'lastCodexEnvHash',
] as const;

const LEGACY_STRIPPED_SETTING_FIELDS = [
  'activeConversationId',
  'show1MModel',
  'hiddenSlashCommands',
  'slashCommands',
  'allowExternalAccess',
  'allowedExportPaths',
  'enableBlocklist',
  'blockedCommands',
  ...LEGACY_TOP_LEVEL_PROVIDER_FIELDS,
  'loadUserClaudeSettings',
  'openInMainTab',
  'appearanceTheme',
] as const;

const TRANSIENT_PROVIDER_CONFIG_FIELDS: Record<string, string[]> = {
  claude: ['projectSettingsSnapshot'],
};

function stripLegacyFields(settings: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...settings };
  for (const key of LEGACY_STRIPPED_SETTING_FIELDS) {
    delete cleaned[key];
  }
  return cleaned;
}

function stripTransientProviderConfigFields(settings: Record<string, unknown>): Record<string, unknown> {
  const providerConfigs = normalizeProviderConfigs(settings.providerConfigs);
  if (Object.keys(providerConfigs).length === 0) {
    return settings;
  }

  let changed = false;
  const cleanedProviderConfigs: ProviderConfigMap = {};
  for (const [providerId, config] of Object.entries(providerConfigs)) {
    const nextConfig = { ...config };
    for (const field of TRANSIENT_PROVIDER_CONFIG_FIELDS[providerId] ?? []) {
      if (field in nextConfig) {
        delete nextConfig[field];
        changed = true;
      }
    }
    cleanedProviderConfigs[providerId] = nextConfig;
  }

  return changed
    ? { ...settings, providerConfigs: cleanedProviderConfigs }
    : settings;
}

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return typeof value === 'string'
    && (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeChatViewPlacement(
  value: unknown,
  legacyOpenInMainTab: unknown,
): ChatViewPlacement {
  if (isChatViewPlacement(value)) {
    return value;
  }

  if (typeof legacyOpenInMainTab === 'boolean') {
    return legacyOpenInMainTab ? 'main-tab' : 'right-sidebar';
  }

  return DEFAULT_GRIMOIRE_SETTINGS.chatViewPlacement;
}

function normalizeTabBarPosition(_value: unknown): TabBarPosition {
  return 'header';
}

function normalizeDebugLoggingEnabled(value: unknown): boolean {
  return typeof value === 'boolean'
    ? value
    : DEFAULT_GRIMOIRE_SETTINGS.debugLoggingEnabled;
}

function normalizeUsageIndicatorsEnabled(value: unknown): boolean {
  return typeof value === 'boolean'
    ? value
    : DEFAULT_GRIMOIRE_SETTINGS.usageIndicatorsEnabled;
}

function shouldPersistChatViewPlacementMigration(
  stored: Record<string, unknown>,
  normalized: ChatViewPlacement,
): boolean {
  return 'openInMainTab' in stored
    || (
      'chatViewPlacement' in stored
      && stored.chatViewPlacement !== normalized
    );
}

function shouldPersistTabLayoutNormalization(
  stored: Record<string, unknown>,
  maxTabs: number,
  tabBarPosition: TabBarPosition,
): boolean {
  return (
    'maxTabs' in stored
    && stored.maxTabs !== maxTabs
  ) || (
    'tabBarPosition' in stored
    && stored.tabBarPosition !== tabBarPosition
  );
}

function normalizeProviderConfigs(value: unknown): ProviderConfigMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: ProviderConfigMap = {};
  for (const [providerId, config] of Object.entries(value as Record<string, unknown>)) {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      result[providerId] = { ...(config as Record<string, unknown>) };
    }
  }
  return result;
}

const HOST_SCOPED_PROVIDER_CONFIG_FIELDS: Record<string, string[]> = {
  claude: ['cliPathsByHost'],
  codex: ['cliPathsByHost', 'installationMethodsByHost', 'wslDistroOverridesByHost'],
  opencode: ['cliPathsByHost'],
};

function hasHostScopedProviderConfigNormalization(
  original: ProviderConfigMap,
  normalized: unknown,
): boolean {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return false;
  }

  const normalizedConfigs = normalized as ProviderConfigMap;
  for (const [providerId, fields] of Object.entries(HOST_SCOPED_PROVIDER_CONFIG_FIELDS)) {
    const originalConfig = original[providerId];
    const normalizedConfig = normalizedConfigs[providerId];
    if (!originalConfig || !normalizedConfig) {
      continue;
    }

    for (const field of fields) {
      if (
        field in originalConfig
        && JSON.stringify(originalConfig[field]) !== JSON.stringify(normalizedConfig[field])
      ) {
        return true;
      }
    }
  }

  return false;
}

function isEnvironmentScope(value: unknown): value is EnvironmentScope {
  return value === 'shared' || (typeof value === 'string' && value.startsWith('provider:'));
}

function normalizeContextLimits(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
      result[key] = entry;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const modelId = key.trim();
    const normalizedAlias = alias.trim();
    if (modelId && normalizedAlias) {
      result[modelId] = normalizedAlias;
    }
  }

  return result;
}

function normalizeAdvancedSectionsOpen(value: unknown): AdvancedSectionsOpen {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: AdvancedSectionsOpen = {};
  for (const [id, open] of Object.entries(value)) {
    if (typeof id === 'string' && id.trim() && typeof open === 'boolean') {
      result[id.trim()] = open;
    }
  }
  return result;
}

function normalizeEnvSnippets(value: unknown): EnvSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const snippets: EnvSnippet[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.description !== 'string'
      || typeof candidate.envVars !== 'string'
    ) {
      continue;
    }

    const modelAliases = 'modelAliases' in candidate
      ? normalizeModelAliases(candidate.modelAliases)
      : undefined;

    snippets.push({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      envVars: candidate.envVars,
      scope: resolveEnvironmentSnippetScope(
        candidate.envVars,
        isEnvironmentScope(candidate.scope)
          ? candidate.scope
          : inferEnvironmentSnippetScope(candidate.envVars),
      ),
      contextLimits: normalizeContextLimits(candidate.contextLimits),
      modelAliases,
    });
  }

  return snippets;
}

function normalizeSavedProviderPermissionMode(value: unknown): Partial<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Partial<Record<string, string>> = {};
  for (const [providerId, entry] of Object.entries(value)) {
    const normalized = coercePermissionMode(entry);
    if (normalized) {
      result[providerId] = normalized;
    }
  }
  return result;
}

function hasLegacyTopLevelProviderFields(stored: Record<string, unknown>): boolean {
  return LEGACY_TOP_LEVEL_PROVIDER_FIELDS.some((key) => key in stored);
}

function mergeLegacyClaudeHiddenCommands(
  hiddenProviderCommands: HiddenProviderCommands,
  legacyHiddenSlashCommands: unknown,
): HiddenProviderCommands {
  const legacyCommands = normalizeHiddenCommandList(legacyHiddenSlashCommands);
  if (legacyCommands.length === 0 || hiddenProviderCommands.claude) {
    return hiddenProviderCommands;
  }

  return {
    ...hiddenProviderCommands,
    claude: legacyCommands,
  };
}

export class GrimoireSettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<StoredGrimoireSettings> {
    const settingsPath = await this.resolveSettingsPath();
    if (!settingsPath) {
      return this.getDefaults();
    }

    const stored = await this.readStoredSettings(settingsPath);
    if (!stored) {
      return this.getDefaults();
    }
    const hiddenProviderCommands = mergeLegacyClaudeHiddenCommands(
      normalizeHiddenProviderCommands(stored.hiddenProviderCommands),
      stored.hiddenSlashCommands,
    );
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const customModelAliases = normalizeModelAliases(stored.customModelAliases);
    const advancedSectionsOpen = normalizeAdvancedSectionsOpen(stored.advancedSectionsOpen);
    const providerConfigs = normalizeProviderConfigs(stored.providerConfigs);
    const permissionMode = normalizePermissionMode(
      stored.permissionMode,
      DEFAULT_GRIMOIRE_SETTINGS.permissionMode,
    );
    const savedProviderPermissionMode = normalizeSavedProviderPermissionMode(
      stored.savedProviderPermissionMode,
    );
    const chatViewPlacement = normalizeChatViewPlacement(
      stored.chatViewPlacement,
      stored.openInMainTab,
    );
    const maxTabs = normalizeMaxTabs(stored.maxTabs);
    const tabBarPosition = normalizeTabBarPosition(stored.tabBarPosition);
    const usageIndicatorsEnabled = normalizeUsageIndicatorsEnabled(stored.usageIndicatorsEnabled);
    const debugLoggingEnabled = normalizeDebugLoggingEnabled(stored.debugLoggingEnabled);
    const legacyProviderSettings = {
      ...stored,
      hiddenProviderCommands,
      providerConfigs,
    };
    const storedWithoutLegacy = stripLegacyFields({
      ...legacyProviderSettings,
    });

    const legacyNormalized = {
      ...storedWithoutLegacy,
      sharedEnvironmentVariables: getSharedEnvironmentVariables(legacyProviderSettings),
      envSnippets,
      customModelAliases,
      advancedSectionsOpen,
      hiddenProviderCommands,
      providerConfigs,
      permissionMode,
      savedProviderPermissionMode,
      chatViewPlacement,
      maxTabs,
      tabBarPosition,
      usageIndicatorsEnabled,
      debugLoggingEnabled,
    };

    const merged = {
      ...this.getDefaults(),
      ...legacyNormalized,
    };

    // Three providers, and it is still not a list that fell behind: this is the
    // migration of a *stored* shape, and the stored shape only ever held those
    // three. A provider added later was never written in the old format, so
    // migrating it would move a field that never existed.
    //
    // Which three is a provider's own answer now. The reader for each knows the
    // on-disk names its own old build used — Claude falls back to
    // `settings.claudeCliPathsByHost` — which is knowledge this file had by
    // importing three providers directly. Read off the catalog instance rather
    // than the installed accessor, for the reason `defaultProviderConfigs`
    // gives: settings load before the providers register.
    for (const providerId of builtInProviderCatalog.ids()) {
      builtInProviderCatalog
        .settingsReconciliation(providerId)
        .adoptLegacyTopLevelFields?.(legacyProviderSettings, merged);
    }
    const didNormalizeHostScopedProviderConfigs = hasHostScopedProviderConfigNormalization(
      providerConfigs,
      merged.providerConfigs,
    );

    if (
      hasLegacyTopLevelProviderFields(stored)
      || 'show1MModel' in stored
      || 'slashCommands' in stored
      || 'hiddenSlashCommands' in stored
      || 'activeConversationId' in stored
      || 'allowExternalAccess' in stored
      || 'allowedExportPaths' in stored
      || 'enableBlocklist' in stored
      || 'blockedCommands' in stored
      || shouldPersistChatViewPlacementMigration(stored, chatViewPlacement)
      || 'appearanceTheme' in stored
      || shouldPersistTabLayoutNormalization(stored, maxTabs, tabBarPosition)
      || (
        'usageIndicatorsEnabled' in stored
        && stored.usageIndicatorsEnabled !== usageIndicatorsEnabled
      )
      || (
        'debugLoggingEnabled' in stored
        && stored.debugLoggingEnabled !== debugLoggingEnabled
      )
      || ('permissionMode' in stored && stored.permissionMode !== permissionMode)
      || (
        'savedProviderPermissionMode' in stored
        && JSON.stringify(savedProviderPermissionMode) !== JSON.stringify(stored.savedProviderPermissionMode ?? {})
      )
      || JSON.stringify(envSnippets) !== JSON.stringify(stored.envSnippets ?? [])
      || (
        'customModelAliases' in stored
        && JSON.stringify(customModelAliases) !== JSON.stringify(stored.customModelAliases ?? {})
      )
      || (
        'advancedSectionsOpen' in stored
        && JSON.stringify(advancedSectionsOpen) !== JSON.stringify(stored.advancedSectionsOpen ?? {})
      )
      || didNormalizeHostScopedProviderConfigs
    ) {
      await this.save(merged);
    }

    return merged;
  }

  private async readStoredSettings(settingsPath: string): Promise<Record<string, unknown> | null> {
    const content = await this.adapter.read(settingsPath);
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }

      const backupPath = `${settingsPath}.invalid-${Date.now()}`;
      await this.adapter.rename(settingsPath, backupPath);
      await this.save(this.getDefaults());
      return null;
    }
  }

  async save(settings: StoredGrimoireSettings): Promise<void> {
    const content = JSON.stringify(
      stripTransientProviderConfigFields(stripLegacyFields(settings)),
      null,
      2,
    );
    await this.adapter.write(GRIMOIRE_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(GRIMOIRE_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredGrimoireSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  private getDefaults(): StoredGrimoireSettings {
    return DEFAULT_GRIMOIRE_SETTINGS;
  }

  private async resolveSettingsPath(): Promise<string | null> {
    if (await this.adapter.exists(GRIMOIRE_SETTINGS_PATH)) {
      return GRIMOIRE_SETTINGS_PATH;
    }

    return null;
  }
}
