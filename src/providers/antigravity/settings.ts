import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import { normalizeAntigravityModelSelector } from './models';

export interface AntigravityDiscoveredModel {
  description?: string | null;
  label: string;
  rawId: string;
}

export interface PersistedAntigravityProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  customModels: string;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  visibleModels: string[];
}

export interface AntigravityProviderSettings extends PersistedAntigravityProviderSettings {
  discoveredModels: AntigravityDiscoveredModel[];
}

export const DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS: Readonly<PersistedAntigravityProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  customModels: '',
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  visibleModels: [],
});

export function normalizeAntigravityHostnameCliPaths(value: unknown): HostnameCliPaths {
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

export function normalizeAntigravityVisibleModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const normalizedEntry = normalizeAntigravityModelSelector(entry);
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }

    seen.add(normalizedEntry);
    normalized.push(normalizedEntry);
  }

  return normalized;
}

export function normalizeAntigravityCustomModels(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized.join('\n');
}

export function normalizeAntigravityModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    const normalizedRawId = normalizeAntigravityModelSelector(rawId);
    const normalizedAlias = typeof alias === 'string' ? alias.trim() : '';
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }
    normalized[normalizedRawId] = normalizedAlias;
  }
  return normalized;
}

export function normalizeAntigravityDiscoveredModels(value: unknown): AntigravityDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: AntigravityDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawId = typeof record.rawId === 'string'
      ? normalizeAntigravityModelSelector(record.rawId)
      : '';
    const label = typeof record.label === 'string'
      ? normalizeAntigravityModelSelector(record.label) || rawId
      : rawId;
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

export function getAntigravityProviderSettings(settings: Record<string, unknown>): AntigravityProviderSettings {
  const config = getProviderConfig(settings, 'antigravity');
  const normalizedCliPathsByHost = normalizeAntigravityHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    customModels: normalizeAntigravityCustomModels(
      config.customModels ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.customModels,
    ),
    discoveredModels: normalizeAntigravityDiscoveredModels(config.discoveredModels),
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'antigravity')
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeAntigravityModelAliases(config.modelAliases),
    visibleModels: normalizeAntigravityVisibleModels(config.visibleModels),
  };
}

export function updateAntigravityProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<AntigravityProviderSettings>,
): AntigravityProviderSettings {
  const current = getAntigravityProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const nextVisibleModels = normalizeAntigravityVisibleModels(
    updates.visibleModels ?? current.visibleModels,
  );
  const nextCustomModels = normalizeAntigravityCustomModels(
    updates.customModels ?? current.customModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeAntigravityHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath;
  }

  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeAntigravityModelAliases(updates.modelAliases ?? current.modelAliases),
    nextVisibleModels,
  );

  const next: AntigravityProviderSettings = {
    ...current,
    ...updates,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    customModels: nextCustomModels,
    discoveredModels: normalizeAntigravityDiscoveredModels(updates.discoveredModels ?? current.discoveredModels),
    modelAliases: nextModelAliases,
    visibleModels: nextVisibleModels,
  };

  setProviderConfig(settings, 'antigravity', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    customModels: next.customModels,
    discoveredModels: next.discoveredModels,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    modelAliases: next.modelAliases,
    visibleModels: next.visibleModels,
  });

  return next;
}

function pruneModelAliasesToVisible(
  aliases: Record<string, string>,
  visibleModels: string[],
): Record<string, string> {
  if (visibleModels.length === 0) {
    return {};
  }

  const visible = new Set(visibleModels);
  return Object.fromEntries(
    Object.entries(aliases).filter(([rawId]) => visible.has(rawId)),
  );
}
