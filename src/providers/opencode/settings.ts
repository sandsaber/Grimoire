import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import {
  getOpencodeDiscoveryState,
  seedOpencodeDiscoveryStateFromLegacyConfig,
  updateOpencodeDiscoveryState,
} from './discoveryState';
import { ensureProviderProjectionMap } from './internal/providerProjection';
import {
  decodeOpencodeModelId,
  encodeOpencodeModelId,
  isOpencodeModelSelectionId,
  normalizeOpencodeThinkingOptionsByModel,
  OPENCODE_DEFAULT_THINKING_LEVEL,
  type OpencodeDiscoveredModel,
  type OpencodeThinkingOptionsByModel,
  resolveOpencodeBaseModelRawId,
} from './models';
import {
  normalizeManagedOpencodeSelectedMode,
  type OpencodeMode,
} from './modes';

export type OpencodeInstallationMethod = 'native-windows' | 'wsl';
export type HostnameInstallationMethods = Record<string, OpencodeInstallationMethod>;

function normalizeOpencodeInstallationMethod(value: unknown): OpencodeInstallationMethod {
  return value === 'wsl' ? 'wsl' : 'native-windows';
}

export interface PersistedOpencodeProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  installationMethod: OpencodeInstallationMethod;
  installationMethodsByHost: HostnameInstallationMethods;
  modelAliases: Record<string, string>;
  preferredThinkingByModel: Record<string, string>;
  selectedMode: string;
  thinkingOptionsByModel: OpencodeThinkingOptionsByModel;
  visibleModels: string[];
  wslDistroOverride: string;
  wslDistroOverridesByHost: HostnameCliPaths;
}

export interface OpencodeProviderSettings extends PersistedOpencodeProviderSettings {
  availableModes: OpencodeMode[];
  discoveredModels: OpencodeDiscoveredModel[];
}

export const OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES = 'OPENCODE_ENABLE_EXA=1';

export const DEFAULT_OPENCODE_PROVIDER_SETTINGS: Readonly<PersistedOpencodeProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
  installationMethod: 'native-windows',
  installationMethodsByHost: {},
  modelAliases: {},
  preferredThinkingByModel: {},
  selectedMode: '',
  thinkingOptionsByModel: {},
  visibleModels: [],
  wslDistroOverride: '',
  wslDistroOverridesByHost: {},
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

function normalizeInstallationMethodsByHost(value: unknown): HostnameInstallationMethods {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameInstallationMethods = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key === 'string' && key.trim()) {
      result[key] = normalizeOpencodeInstallationMethod(entry);
    }
  }
  return result;
}

export function normalizeOpencodeVisibleModels(
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[] = [],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = resolveOpencodeBaseModelRawId(entry.trim(), discoveredModels);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function normalizeOpencodeModelAliases(
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const normalizedRawId = resolveOpencodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedAlias = alias.trim();
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }

    normalized[normalizedRawId] = normalizedAlias;
  }

  return normalized;
}

export function normalizeOpencodePreferredThinkingByModel(
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, thinkingLevel] of Object.entries(value as Record<string, unknown>)) {
    if (typeof thinkingLevel !== 'string') {
      continue;
    }

    const normalizedRawId = resolveOpencodeBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedThinkingLevel = thinkingLevel.trim();
    if (!normalizedRawId || !normalizedThinkingLevel) {
      continue;
    }

    normalized[normalizedRawId] = normalizedThinkingLevel;
  }

  return normalized;
}

export function getOpencodeProviderSettings(
  settings: Record<string, unknown>,
): OpencodeProviderSettings {
  const config = getProviderConfig(settings, 'opencode');
  const hostnameKey = getHostnameKey();
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const normalizedInstallationMethodsByHost = normalizeInstallationMethodsByHost(
    config.installationMethodsByHost,
  );
  const normalizedWslDistroOverridesByHost = normalizeHostnameCliPaths(
    config.wslDistroOverridesByHost,
  );
  const hasLegacyHostnameKeyedSettings = Object.keys(normalizedCliPathsByHost).length > 0
    || Object.keys(normalizedInstallationMethodsByHost).length > 0
    || Object.keys(normalizedWslDistroOverridesByHost).length > 0;
  const legacyHostnameKey = hasLegacyHostnameKeyedSettings ? getLegacyHostnameKey() : '';
  const cliPathsByHost = hasLegacyHostnameKeyedSettings
    ? migrateLegacyHostnameKeyedMap(normalizedCliPathsByHost, hostnameKey, legacyHostnameKey)
    : normalizedCliPathsByHost;
  const installationMethodsByHost = hasLegacyHostnameKeyedSettings
    ? migrateLegacyHostnameKeyedMap(
      normalizedInstallationMethodsByHost,
      hostnameKey,
      legacyHostnameKey,
    )
    : normalizedInstallationMethodsByHost;
  const wslDistroOverridesByHost = hasLegacyHostnameKeyedSettings
    ? migrateLegacyHostnameKeyedMap(
      normalizedWslDistroOverridesByHost,
      hostnameKey,
      legacyHostnameKey,
    )
    : normalizedWslDistroOverridesByHost;
  const hasHostScopedInstallationMethods = Object.keys(installationMethodsByHost).length > 0;
  const hasHostScopedWslDistroOverrides = Object.keys(wslDistroOverridesByHost).length > 0;
  const legacyInstallationMethod = normalizeOpencodeInstallationMethod(config.installationMethod);
  const legacyWslDistroOverride = typeof config.wslDistroOverride === 'string'
    ? config.wslDistroOverride.trim()
    : '';
  seedOpencodeDiscoveryStateFromLegacyConfig(settings, config);
  const discoveryState = getOpencodeDiscoveryState(settings);
  const availableModes = discoveryState.availableModes;
  const discoveredModels = discoveryState.discoveredModels;
  const persistedThinkingOptionsByModel = normalizeOpencodeThinkingOptionsByModel(
    config.thinkingOptionsByModel,
    discoveredModels,
  );
  const thinkingOptionsByModel = normalizeOpencodeThinkingOptionsByModel({
    ...persistedThinkingOptionsByModel,
    ...discoveryState.thinkingOptionsByModel,
  }, discoveredModels);

  return {
    availableModes,
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'opencode')
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.environmentVariables,
    installationMethod: installationMethodsByHost[hostnameKey]
      ?? (
        hasHostScopedInstallationMethods
          ? DEFAULT_OPENCODE_PROVIDER_SETTINGS.installationMethod
          : legacyInstallationMethod
      ),
    installationMethodsByHost,
    modelAliases: normalizeOpencodeModelAliases(config.modelAliases, discoveredModels),
    preferredThinkingByModel: normalizeOpencodePreferredThinkingByModel(
      config.preferredThinkingByModel,
      discoveredModels,
    ),
    selectedMode: normalizeManagedOpencodeSelectedMode(config.selectedMode, availableModes),
    thinkingOptionsByModel,
    visibleModels: normalizeOpencodeVisibleModels(config.visibleModels, discoveredModels),
    wslDistroOverride: wslDistroOverridesByHost[hostnameKey]
      ?? (
        hasHostScopedWslDistroOverrides
          ? DEFAULT_OPENCODE_PROVIDER_SETTINGS.wslDistroOverride
          : legacyWslDistroOverride
      ),
    wslDistroOverridesByHost,
  };
}

export function updateOpencodeProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<OpencodeProviderSettings>,
): OpencodeProviderSettings {
  const current = getOpencodeProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  if ('availableModes' in updates || 'discoveredModels' in updates || 'thinkingOptionsByModel' in updates) {
    updateOpencodeDiscoveryState(settings, {
      ...(updates.availableModes !== undefined ? { availableModes: updates.availableModes } : {}),
      ...(updates.discoveredModels !== undefined ? { discoveredModels: updates.discoveredModels } : {}),
      ...(updates.thinkingOptionsByModel !== undefined
        ? { thinkingOptionsByModel: updates.thinkingOptionsByModel }
        : {}),
    });
  }
  const discoveryState = getOpencodeDiscoveryState(settings);
  const nextAvailableModes = discoveryState.availableModes;
  const nextDiscoveredModels = discoveryState.discoveredModels;
  const nextThinkingOptionsByModel = updates.thinkingOptionsByModel !== undefined
    ? discoveryState.thinkingOptionsByModel
    : normalizeOpencodeThinkingOptionsByModel(
      current.thinkingOptionsByModel,
      nextDiscoveredModels,
    );
  const nextSelectedMode = normalizeManagedOpencodeSelectedMode(
    updates.selectedMode ?? current.selectedMode,
    nextAvailableModes,
  );
  const nextVisibleModels = normalizeOpencodeVisibleModels(
    updates.visibleModels ?? current.visibleModels,
    nextDiscoveredModels,
  );
  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeOpencodeModelAliases(
      updates.modelAliases ?? current.modelAliases,
      nextDiscoveredModels,
    ),
    nextVisibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  const nextInstallationMethodsByHost = 'installationMethodsByHost' in updates
    ? normalizeInstallationMethodsByHost(updates.installationMethodsByHost)
    : { ...current.installationMethodsByHost };
  const nextWslDistroOverridesByHost = 'wslDistroOverridesByHost' in updates
    ? normalizeHostnameCliPaths(updates.wslDistroOverridesByHost)
    : { ...current.wslDistroOverridesByHost };

  if (
    Object.keys(nextInstallationMethodsByHost).length === 0
    && current.installationMethod !== DEFAULT_OPENCODE_PROVIDER_SETTINGS.installationMethod
  ) {
    nextInstallationMethodsByHost[hostnameKey] = current.installationMethod;
  }

  if (
    Object.keys(nextWslDistroOverridesByHost).length === 0
    && current.wslDistroOverride
  ) {
    nextWslDistroOverridesByHost[hostnameKey] = current.wslDistroOverride;
  }

  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_OPENCODE_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_OPENCODE_PROVIDER_SETTINGS.cliPath;
  }

  if ('installationMethod' in updates) {
    nextInstallationMethodsByHost[hostnameKey] = normalizeOpencodeInstallationMethod(
      updates.installationMethod,
    );
  }

  if ('wslDistroOverride' in updates) {
    const normalizedDistroOverride = typeof updates.wslDistroOverride === 'string'
      ? updates.wslDistroOverride.trim()
      : '';
    if (normalizedDistroOverride) {
      nextWslDistroOverridesByHost[hostnameKey] = normalizedDistroOverride;
    } else {
      delete nextWslDistroOverridesByHost[hostnameKey];
    }
  }

  const next: OpencodeProviderSettings = {
    ...current,
    ...updates,
    availableModes: nextAvailableModes,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: nextDiscoveredModels,
    installationMethod: nextInstallationMethodsByHost[hostnameKey]
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.installationMethod,
    installationMethodsByHost: nextInstallationMethodsByHost,
    modelAliases: nextModelAliases,
    preferredThinkingByModel: normalizeOpencodePreferredThinkingByModel(
      updates.preferredThinkingByModel ?? current.preferredThinkingByModel,
      nextDiscoveredModels,
    ),
    selectedMode: nextSelectedMode,
    thinkingOptionsByModel: nextThinkingOptionsByModel,
    visibleModels: nextVisibleModels,
    wslDistroOverride: nextWslDistroOverridesByHost[hostnameKey]
      ?? DEFAULT_OPENCODE_PROVIDER_SETTINGS.wslDistroOverride,
    wslDistroOverridesByHost: nextWslDistroOverridesByHost,
  };

  if (updates.visibleModels !== undefined) {
    retargetRemovedOpencodeSelections(settings, next);
  }

  const persistedThinkingOptionsByModel = pruneThinkingOptionsToPersistedSelections(
    settings,
    next,
  );

  setProviderConfig(settings, 'opencode', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    installationMethodsByHost: next.installationMethodsByHost,
    modelAliases: next.modelAliases,
    preferredThinkingByModel: next.preferredThinkingByModel,
    selectedMode: next.selectedMode,
    thinkingOptionsByModel: persistedThinkingOptionsByModel,
    visibleModels: next.visibleModels,
    wslDistroOverridesByHost: next.wslDistroOverridesByHost,
  });

  return next;
}

export function hasLegacyOpencodeDiscoveryFields(settings: Record<string, unknown>): boolean {
  const config = getProviderConfig(settings, 'opencode');
  return 'availableModes' in config || 'discoveredModels' in config;
}

function pruneModelAliasesToVisible(
  aliases: Record<string, string>,
  visibleModels: string[],
): Record<string, string> {
  if (visibleModels.length === 0 || Object.keys(aliases).length === 0) {
    return {};
  }

  const visibleSet = new Set(visibleModels);
  const pruned: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(aliases)) {
    if (visibleSet.has(rawId)) {
      pruned[rawId] = alias;
    }
  }
  return pruned;
}

function pruneThinkingOptionsToPersistedSelections(
  settings: Record<string, unknown>,
  next: OpencodeProviderSettings,
): OpencodeThinkingOptionsByModel {
  const persistableRawIds = new Set(next.visibleModels);
  addPersistableSelection(persistableRawIds, settings.model, next.discoveredModels);
  addPersistableSelection(persistableRawIds, settings.titleGenerationModel, next.discoveredModels);

  const savedProviderModel = settings.savedProviderModel;
  if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
    addPersistableSelection(
      persistableRawIds,
      (savedProviderModel as Record<string, unknown>).opencode,
      next.discoveredModels,
    );
  }

  const pruned: OpencodeThinkingOptionsByModel = {};
  for (const rawId of persistableRawIds) {
    const options = next.thinkingOptionsByModel[rawId];
    if (options?.length) {
      pruned[rawId] = options.map((option) => ({ ...option }));
    }
  }
  return pruned;
}

function addPersistableSelection(
  target: Set<string>,
  value: unknown,
  discoveredModels: OpencodeDiscoveredModel[],
): void {
  if (typeof value !== 'string' || !isOpencodeModelSelectionId(value)) {
    return;
  }

  const rawModelId = decodeOpencodeModelId(value);
  if (!rawModelId) {
    return;
  }

  const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, discoveredModels);
  if (baseRawId) {
    target.add(baseRawId);
  }
}

function retargetRemovedOpencodeSelections(
  settings: Record<string, unknown>,
  next: OpencodeProviderSettings,
): void {
  if (next.visibleModels.length === 0) {
    if (
      typeof settings.titleGenerationModel === 'string'
      && isOpencodeModelSelectionId(settings.titleGenerationModel)
    ) {
      settings.titleGenerationModel = '';
    }
    return;
  }

  const visibleSet = new Set(next.visibleModels);
  const fallbackRawId = next.visibleModels[0];
  const fallbackModelId = encodeOpencodeModelId(fallbackRawId);
  const fallbackEffort = next.preferredThinkingByModel[fallbackRawId] ?? OPENCODE_DEFAULT_THINKING_LEVEL;

  const maybeRetargetModel = (value: unknown): string | null => {
    if (typeof value !== 'string' || !isOpencodeModelSelectionId(value)) {
      return null;
    }

    const rawModelId = decodeOpencodeModelId(value);
    if (!rawModelId) {
      return fallbackModelId;
    }

    const baseRawId = resolveOpencodeBaseModelRawId(rawModelId, next.discoveredModels);
    return visibleSet.has(baseRawId) ? null : fallbackModelId;
  };

  const savedProviderModel = ensureProviderProjectionMap(settings, 'savedProviderModel');
  const nextSavedModel = maybeRetargetModel(savedProviderModel.opencode);
  if (nextSavedModel) {
    savedProviderModel.opencode = nextSavedModel;
    ensureProviderProjectionMap(settings, 'savedProviderEffort').opencode = fallbackEffort;
  }

  const nextTopLevelModel = maybeRetargetModel(settings.model);
  if (nextTopLevelModel) {
    settings.model = nextTopLevelModel;
    settings.effortLevel = fallbackEffort;
  }

  const nextTitleGenerationModel = maybeRetargetModel(settings.titleGenerationModel);
  if (nextTitleGenerationModel) {
    settings.titleGenerationModel = nextTitleGenerationModel;
  }
}
