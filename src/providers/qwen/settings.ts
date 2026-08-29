import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';

export interface QwenDiscoveredModel {
  description?: string | null;
  label: string;
  rawId: string;
}

export interface QwenMode {
  description?: string | null;
  id: string;
  name: string;
}

export interface PersistedQwenProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  /**
   * Digest of the catalog cache key `discoveredModels` was discovered under.
   * Written together with the list by ACP discovery; any new writer must pass
   * both, or a later load will trust a list the configuration no longer matches.
   */
  discoveredModelsFingerprint: string;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  effortLevel: QwenEffortLevel;
  modelAliases: Record<string, string>;
  selectedMode: string;
  visibleModels: string[];
}

export const QWEN_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type QwenEffortLevel = typeof QWEN_EFFORT_LEVELS[number];

export interface QwenProviderSettings extends PersistedQwenProviderSettings {
  availableModes: QwenMode[];
  discoveredModels: QwenDiscoveredModel[];
}

export const DEFAULT_QWEN_PROVIDER_SETTINGS: Readonly<PersistedQwenProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  discoveredModelsFingerprint: '',
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  effortLevel: 'high',
  modelAliases: {},
  selectedMode: '',
  visibleModels: [],
});

export function normalizeQwenEffortLevel(value: unknown): QwenEffortLevel {
  return typeof value === 'string' && (QWEN_EFFORT_LEVELS as readonly string[]).includes(value)
    ? value as QwenEffortLevel
    : DEFAULT_QWEN_PROVIDER_SETTINGS.effortLevel;
}

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

export function normalizeQwenVisibleModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function normalizeQwenModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    const normalizedRawId = rawId.trim();
    const normalizedAlias = typeof alias === 'string' ? alias.trim() : '';
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }
    normalized[normalizedRawId] = normalizedAlias;
  }
  return normalized;
}

function normalizeQwenDiscoveredModels(value: unknown): QwenDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: QwenDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : rawId;
    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    result.push({
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      label,
      rawId,
    });
  }
  return result;
}

function normalizeQwenModes(value: unknown): QwenMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: QwenMode[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : id;
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push({
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      id,
      name,
    });
  }
  return result;
}

export function getQwenProviderSettings(settings: Record<string, unknown>): QwenProviderSettings {
  const config = getProviderConfig(settings, 'qwen');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    availableModes: normalizeQwenModes(config.availableModes),
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_QWEN_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels: normalizeQwenDiscoveredModels(config.discoveredModels),
    discoveredModelsFingerprint: typeof config.discoveredModelsFingerprint === 'string'
      ? config.discoveredModelsFingerprint
      : DEFAULT_QWEN_PROVIDER_SETTINGS.discoveredModelsFingerprint,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_QWEN_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_QWEN_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'qwen')
      ?? DEFAULT_QWEN_PROVIDER_SETTINGS.environmentVariables,
    effortLevel: normalizeQwenEffortLevel(config.effortLevel),
    modelAliases: normalizeQwenModelAliases(config.modelAliases),
    selectedMode: (config.selectedMode as string | undefined)
      ?? DEFAULT_QWEN_PROVIDER_SETTINGS.selectedMode,
    visibleModels: normalizeQwenVisibleModels(config.visibleModels),
  };
}

export function updateQwenProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<QwenProviderSettings>,
): QwenProviderSettings {
  const current = getQwenProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const nextVisibleModels = normalizeQwenVisibleModels(
    updates.visibleModels ?? current.visibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_QWEN_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_QWEN_PROVIDER_SETTINGS.cliPath;
  }

  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeQwenModelAliases(updates.modelAliases ?? current.modelAliases),
    nextVisibleModels,
  );

  const next: QwenProviderSettings = {
    ...current,
    ...updates,
    availableModes: normalizeQwenModes(updates.availableModes ?? current.availableModes),
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: normalizeQwenDiscoveredModels(updates.discoveredModels ?? current.discoveredModels),
    discoveredModelsFingerprint: typeof updates.discoveredModelsFingerprint === 'string'
      ? updates.discoveredModelsFingerprint
      : current.discoveredModelsFingerprint,
    effortLevel: normalizeQwenEffortLevel(updates.effortLevel ?? current.effortLevel),
    modelAliases: nextModelAliases,
    selectedMode: typeof updates.selectedMode === 'string'
      ? updates.selectedMode.trim()
      : current.selectedMode,
    visibleModels: nextVisibleModels,
  };

  setProviderConfig(settings, 'qwen', {
    availableModes: next.availableModes,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    discoveredModels: next.discoveredModels,
    discoveredModelsFingerprint: next.discoveredModelsFingerprint,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    effortLevel: next.effortLevel,
    modelAliases: next.modelAliases,
    selectedMode: next.selectedMode,
    visibleModels: next.visibleModels,
  });

  return next;
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
