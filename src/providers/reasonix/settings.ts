import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';

export interface ReasonixDiscoveredModel {
  description?: string | null;
  label: string;
  rawId: string;
}

export interface ReasonixMode {
  description?: string | null;
  id: string;
  name: string;
}

/**
 * One reasoning effort the open session offered.
 *
 * **Discovered, never assumed.** Which levels a model takes is decided by the
 * provider block that serves it: a block with `supported_efforts` offers
 * `disabled`, `low`, `high`, `max`, and one without gets the built-in set for
 * its kind — `auto`, `enabled`, `disabled` for an OpenAI-shaped endpoint. The
 * CLI validates the value against the model and refuses one it does not take,
 * so a level the session did not offer is never sent.
 */
export interface ReasonixEffort {
  description?: string | null;
  id: string;
  name: string;
}

export interface PersistedReasonixProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  /**
   * Digest of the catalog cache key `discoveredModels` was discovered under.
   * Written together with the list by ACP discovery; any new writer must pass
   * both, or a later load will trust a list the configuration no longer matches.
   */
  discoveredModelsFingerprint: string;
  enabled: boolean;
  imageAttachmentsAsFiles: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  /** The reasoning effort the person picked, or `auto` to leave it to Reasonix. */
  effortLevel: string;
  selectedMode: string;
  visibleModels: string[];
}

export interface ReasonixProviderSettings extends PersistedReasonixProviderSettings {
  availableModes: ReasonixMode[];
  availableEfforts: ReasonixEffort[];
  discoveredModels: ReasonixDiscoveredModel[];
}

/** What a session is left on when nobody has picked: Reasonix's own choice. */
export const REASONIX_AUTO_EFFORT = 'auto';

export const DEFAULT_REASONIX_PROVIDER_SETTINGS: Readonly<PersistedReasonixProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  discoveredModelsFingerprint: '',
  enabled: false,
  imageAttachmentsAsFiles: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  effortLevel: REASONIX_AUTO_EFFORT,
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

export function normalizeReasonixVisibleModels(value: unknown): string[] {
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

export function normalizeReasonixModelAliases(value: unknown): Record<string, string> {
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

function normalizeReasonixDiscoveredModels(value: unknown): ReasonixDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ReasonixDiscoveredModel[] = [];
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

function normalizeReasonixEfforts(value: unknown): ReasonixEffort[] {
  return normalizeReasonixModes(value);
}

function normalizeReasonixModes(value: unknown): ReasonixMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ReasonixMode[] = [];
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

export function getReasonixProviderSettings(settings: Record<string, unknown>): ReasonixProviderSettings {
  const config = getProviderConfig(settings, 'reasonix');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    availableModes: normalizeReasonixModes(config.availableModes),
    availableEfforts: normalizeReasonixEfforts(config.availableEfforts),
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_REASONIX_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels: normalizeReasonixDiscoveredModels(config.discoveredModels),
    discoveredModelsFingerprint: typeof config.discoveredModelsFingerprint === 'string'
      ? config.discoveredModelsFingerprint
      : DEFAULT_REASONIX_PROVIDER_SETTINGS.discoveredModelsFingerprint,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_REASONIX_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_REASONIX_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'reasonix')
      ?? DEFAULT_REASONIX_PROVIDER_SETTINGS.environmentVariables,
    imageAttachmentsAsFiles: config.imageAttachmentsAsFiles === true,
    modelAliases: normalizeReasonixModelAliases(config.modelAliases),
    effortLevel: typeof config.effortLevel === 'string' && config.effortLevel.trim()
      ? config.effortLevel.trim()
      : DEFAULT_REASONIX_PROVIDER_SETTINGS.effortLevel,
    selectedMode: (config.selectedMode as string | undefined)
      ?? DEFAULT_REASONIX_PROVIDER_SETTINGS.selectedMode,
    visibleModels: normalizeReasonixVisibleModels(config.visibleModels),
  };
}

export function updateReasonixProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<ReasonixProviderSettings>,
): ReasonixProviderSettings {
  const current = getReasonixProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const nextVisibleModels = normalizeReasonixVisibleModels(
    updates.visibleModels ?? current.visibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_REASONIX_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_REASONIX_PROVIDER_SETTINGS.cliPath;
  }

  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeReasonixModelAliases(updates.modelAliases ?? current.modelAliases),
    nextVisibleModels,
  );

  const next: ReasonixProviderSettings = {
    ...current,
    ...updates,
    availableModes: normalizeReasonixModes(updates.availableModes ?? current.availableModes),
    availableEfforts: normalizeReasonixEfforts(updates.availableEfforts ?? current.availableEfforts),
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: normalizeReasonixDiscoveredModels(updates.discoveredModels ?? current.discoveredModels),
    discoveredModelsFingerprint: typeof updates.discoveredModelsFingerprint === 'string'
      ? updates.discoveredModelsFingerprint
      : current.discoveredModelsFingerprint,
    modelAliases: nextModelAliases,
    effortLevel: typeof updates.effortLevel === 'string' && updates.effortLevel.trim()
      ? updates.effortLevel.trim()
      : current.effortLevel,
    selectedMode: typeof updates.selectedMode === 'string'
      ? updates.selectedMode.trim()
      : current.selectedMode,
    visibleModels: nextVisibleModels,
  };

  setProviderConfig(settings, 'reasonix', {
    availableModes: next.availableModes,
    availableEfforts: next.availableEfforts,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    discoveredModels: next.discoveredModels,
    discoveredModelsFingerprint: next.discoveredModelsFingerprint,
    enabled: next.enabled,
    imageAttachmentsAsFiles: next.imageAttachmentsAsFiles,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    modelAliases: next.modelAliases,
    effortLevel: next.effortLevel,
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
