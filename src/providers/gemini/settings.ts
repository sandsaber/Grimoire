import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';

export interface GeminiDiscoveredModel {
  description?: string | null;
  label: string;
  rawId: string;
}

export interface GeminiMode {
  description?: string | null;
  id: string;
  name: string;
}

export interface PersistedGeminiProviderSettings {
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
  modelAliases: Record<string, string>;
  selectedMode: string;
  visibleModels: string[];
}

export interface GeminiProviderSettings extends PersistedGeminiProviderSettings {
  availableModes: GeminiMode[];
  discoveredModels: GeminiDiscoveredModel[];
}

export const DEFAULT_GEMINI_PROVIDER_SETTINGS: Readonly<PersistedGeminiProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  discoveredModelsFingerprint: '',
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  selectedMode: '',
  visibleModels: [],
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

export function normalizeGeminiVisibleModels(value: unknown): string[] {
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

export function normalizeGeminiModelAliases(value: unknown): Record<string, string> {
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

function normalizeGeminiDiscoveredModels(value: unknown): GeminiDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: GeminiDiscoveredModel[] = [];
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

function normalizeGeminiModes(value: unknown): GeminiMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: GeminiMode[] = [];
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

export function getGeminiProviderSettings(settings: Record<string, unknown>): GeminiProviderSettings {
  const config = getProviderConfig(settings, 'gemini');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    availableModes: normalizeGeminiModes(config.availableModes),
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels: normalizeGeminiDiscoveredModels(config.discoveredModels),
    discoveredModelsFingerprint: typeof config.discoveredModelsFingerprint === 'string'
      ? config.discoveredModelsFingerprint
      : DEFAULT_GEMINI_PROVIDER_SETTINGS.discoveredModelsFingerprint,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'gemini')
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeGeminiModelAliases(config.modelAliases),
    selectedMode: (config.selectedMode as string | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.selectedMode,
    visibleModels: normalizeGeminiVisibleModels(config.visibleModels),
  };
}

export function updateGeminiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<GeminiProviderSettings>,
): GeminiProviderSettings {
  const current = getGeminiProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const nextVisibleModels = normalizeGeminiVisibleModels(
    updates.visibleModels ?? current.visibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_GEMINI_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_GEMINI_PROVIDER_SETTINGS.cliPath;
  }

  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeGeminiModelAliases(updates.modelAliases ?? current.modelAliases),
    nextVisibleModels,
  );

  const next: GeminiProviderSettings = {
    ...current,
    ...updates,
    availableModes: normalizeGeminiModes(updates.availableModes ?? current.availableModes),
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: normalizeGeminiDiscoveredModels(updates.discoveredModels ?? current.discoveredModels),
    discoveredModelsFingerprint: typeof updates.discoveredModelsFingerprint === 'string'
      ? updates.discoveredModelsFingerprint
      : current.discoveredModelsFingerprint,
    modelAliases: nextModelAliases,
    selectedMode: typeof updates.selectedMode === 'string'
      ? updates.selectedMode.trim()
      : current.selectedMode,
    visibleModels: nextVisibleModels,
  };

  setProviderConfig(settings, 'gemini', {
    availableModes: next.availableModes,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    discoveredModels: next.discoveredModels,
    discoveredModelsFingerprint: next.discoveredModelsFingerprint,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
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
