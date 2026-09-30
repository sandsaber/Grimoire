import { requestUrl } from 'obsidian';

import {
  hashCatalogFingerprint,
  seedFingerprintMatches,
} from '../../../core/providers/catalogFingerprint';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderCatalogRefreshOutcome } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import type { ProviderModelCatalog } from '../../../providers/shared/providerHostContracts';
import { getVaultPath } from '../../../utils/path';
import {
  buildClaudeCatalogCacheKey,
  CLAUDE_EMPTY_DISCOVERY_RETRY_MS,
} from '../cli/claudeCatalogCache';
import { probeRuntimeModels } from '../commands/probeRuntimeModels';
import { getClaudeApiModelId, getEnvironmentModelName, getEnvironmentModelSlots } from '../env/claudeModelEnv';
import {
  type ClaudeDiscoveredModel,
  type ClaudeProviderSettings,
  getClaudeEffectiveEnvironmentVariables,
  getClaudeProviderSettings,
  normalizeClaudeDiscoveredModels,
  updateClaudeProviderSettings,
} from '../settings';
import { readClaudeCodeSettingsSnapshot } from './ClaudeCodeSettingsSnapshot';

const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_API_VERSION = '2023-06-01';
const MODEL_CATALOG_LIMIT = 1000;
const MODEL_CATALOG_MAX_PAGES = 10;
const MODEL_CATALOG_TIMEOUT_MS = 10_000;
// Only paces retries after an attempt that found nothing. A catalog that holds
// models is rediscovered solely on a cache-key change or an explicit request.

interface ClaudeModelsApiResponse {
  data?: unknown;
  has_more?: unknown;
  last_id?: unknown;
  hasMore?: unknown;
  lastId?: unknown;
}

function normalizeAnthropicBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') || ANTHROPIC_DEFAULT_BASE_URL;
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function buildModelsApiUrl(baseUrl: string, afterId?: string): string {
  const params = new URLSearchParams({ limit: String(MODEL_CATALOG_LIMIT) });
  if (afterId) {
    params.set('after_id', afterId);
  }
  return `${baseUrl}/models?${params.toString()}`;
}

function toClaudeDiscoveredModels(value: unknown, envVars: Record<string, string>): ClaudeDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  return normalizeClaudeDiscoveredModels(value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string') return entry;
    return {
      ...record,
      displayName: (typeof record.display_name === 'string' && record.display_name.trim())
        || (typeof record.displayName === 'string' && record.displayName.trim())
        || getEnvironmentModelName(envVars, record.id)
        || record.id,
    };
  }));
}

async function fetchClaudeModelsFromAnthropicApi(
  envVars: Record<string, string>,
): Promise<ClaudeDiscoveredModel[]> {
  const apiKey = envVars.ANTHROPIC_API_KEY?.trim();
  const authToken = envVars.ANTHROPIC_AUTH_TOKEN?.trim();

  const baseUrl = normalizeAnthropicBaseUrl(envVars.ANTHROPIC_BASE_URL);
  const models: ClaudeDiscoveredModel[] = [];
  const seen = new Set<string>();
  let afterId: string | undefined;

  for (let page = 0; page < MODEL_CATALOG_MAX_PAGES; page += 1) {
    const response = await requestUrl({
      url: buildModelsApiUrl(baseUrl, afterId),
      method: 'GET',
      headers: {
        'anthropic-version': ANTHROPIC_API_VERSION,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : apiKey ? { 'x-api-key': apiKey } : {}),
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Claude Models API request failed with HTTP ${response.status}`);
    }

    const payload = response.json as ClaudeModelsApiResponse;
    for (const model of toClaudeDiscoveredModels(payload.data, envVars)) {
      if (seen.has(model.id)) {
        continue;
      }

      seen.add(model.id);
      models.push({ ...model, source: 'api' });
    }

    const hasMore = payload.has_more ?? payload.hasMore;
    const lastId = payload.last_id ?? payload.lastId;
    if (hasMore !== true || typeof lastId !== 'string' || !lastId || lastId === afterId) {
      break;
    }

    afterId = lastId;
  }

  // Keep native slot selections in existing chats, but only for targets that
  // actually appear in the endpoint catalog. Names and limits come from it too.
  for (const slot of getEnvironmentModelSlots(envVars)) {
    const target = models.find(model => model.id === getClaudeApiModelId(slot.model));
    if (!target || seen.has(slot.id)) continue;
    models.push({ ...target, id: slot.id, resolvedModel: slot.model, description: `Claude Code ${slot.id} default` });
    seen.add(slot.id);
  }
  return models;
}

async function fetchModelsWithTimeout(envVars: Record<string, string>): Promise<ClaudeDiscoveredModel[]> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      fetchClaudeModelsFromAnthropicApi(envVars),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Model catalog request timed out')), MODEL_CATALOG_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function hasCustomEndpoint(envVars: Record<string, string>): boolean {
  return !!envVars.ANTHROPIC_BASE_URL?.trim()
    && normalizeAnthropicBaseUrl(envVars.ANTHROPIC_BASE_URL) !== `${ANTHROPIC_DEFAULT_BASE_URL}/v1`;
}

export function createClaudeModelCatalog(
  plugin: GrimoirePlugin,
  adapter: Pick<VaultFileAdapter, 'exists' | 'read'>,
): ProviderModelCatalog {
  const refreshAttemptsByKey = new Map<string, number>();
  const refreshesByKey = new Map<string, Promise<ProviderCatalogRefreshOutcome>>();
  const cacheKeyFor = (settings: Record<string, unknown>, claudeSettings: ClaudeProviderSettings, cliPath: string) =>
    buildClaudeCatalogCacheKey({
      ...claudeSettings,
      environmentVariables: getRuntimeEnvironmentText(settings, 'claude'),
    }, cliPath);
  const settingsSourceKey = (settings: Record<string, unknown>) => cacheKeyFor(settings, {
    ...getClaudeProviderSettings(settings),
    projectSettingsSnapshot: { model: '', env: {}, hash: '' },
  }, plugin.getResolvedProviderCliPath?.('claude') ?? '');

  // The attempt log only lives in memory, so every plugin load would otherwise
  // probe again on the first picker that is built - and probing starts a full
  // Claude Code session, which bills against the plan window.
  //
  // Native SDK catalogs can be reused across loads. Custom endpoints get one
  // fresh listing attempt per load, including older SDK-only cached catalogs.
  const initialSettings = getClaudeProviderSettings(plugin.settings ?? {});
  const initialEnvironment = getRuntimeEnvironmentText(plugin.settings ?? {}, 'claude');
  const catalogIsFullySdkSourced = initialSettings.discoveredModels.length > 0
    && initialSettings.discoveredModels.every(model => model.source === 'sdk')
    && !hasCustomEndpoint(getClaudeEffectiveEnvironmentVariables(plugin.settings ?? {}));

  // The CLI path is part of the cache key, but it cannot always be resolved
  // here: this catalog is constructed inside createClaudeWorkspaceServices,
  // which the workspace manager runs before it publishes the services, and it
  // only assigns this.services[providerId] *after* initialize() resolves. Until
  // then getCliResolver('claude') is null, so getResolvedProviderCliPath returns
  // null and an eager seed would be filed under cliPath '' while every later
  // refresh looks it up under the real path - the keys never match and the probe
  // runs on every plugin load anyway, which is exactly what the seed exists to
  // prevent. When the path is unavailable, seed on first use instead.
  const initialCliPath = plugin.getResolvedProviderCliPath?.('claude') ?? null;
  let seedOnFirstRefresh = false;
  if (catalogIsFullySdkSourced) {
    if (initialCliPath === null) {
      seedOnFirstRefresh = true;
    } else {
      // The seed speaks for a catalog it did not watch being discovered. While a
      // timer existed that guess self-healed within ten minutes; now it does not
      // expire, so a CLI swapped while the plugin was not running is adopted by
      // the seed instead of detected, pinning the previous CLI's models for good.
      // A recorded fingerprint turns the guess into a check. An unrecorded one
      // (a catalog persisted before this field existed) keeps the old behaviour
      // rather than spending a probe to migrate.
      const initialCacheKey = cacheKeyFor(plugin.settings ?? {}, initialSettings, initialCliPath);
      if (seedFingerprintMatches(initialSettings.discoveredModelsFingerprint, initialCacheKey)) {
        refreshAttemptsByKey.set(initialCacheKey, Date.now());
      }
    }
  }

  return {
    isAvailable(settings) {
      return getClaudeProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      // Refresh files even on a cache hit: switching a CLI profile must invalidate
      // the catalog, and deleted settings must not survive as extra picker rows.
      const beforeReadKey = settingsSourceKey(settings);
      try {
        const projectSettingsSnapshot = await readClaudeCodeSettingsSnapshot(settings, adapter, getVaultPath(plugin.app));
        if (beforeReadKey !== settingsSourceKey(settings)) {
          return 'failed';
        }
        updateClaudeProviderSettings(settings, { projectSettingsSnapshot });
      } catch {
        return 'failed';
      }
      const currentSettings = getClaudeProviderSettings(settings);
      const cacheKey = cacheKeyFor(
        settings,
        currentSettings,
        plugin.getResolvedProviderCliPath?.('claude') ?? '',
      );
      if (seedOnFirstRefresh) {
        seedOnFirstRefresh = false;
        // Only the CLI path was unknown at construction. Anything else the key
        // covers - environment, settings sources, Chrome - may have changed
        // since the plugin loaded, and such a change is exactly what must reach
        // the probe, so the seed applies only while the rest of the key still
        // matches the catalog that was persisted.
        const seededCacheKey = buildClaudeCatalogCacheKey(
          { ...initialSettings, environmentVariables: initialEnvironment },
          plugin.getResolvedProviderCliPath?.('claude') ?? '',
        );
        if (!force
          && seededCacheKey === cacheKey
          && currentSettings.discoveredModels.length > 0
          && seedFingerprintMatches(currentSettings.discoveredModelsFingerprint, cacheKey)) {
          refreshAttemptsByKey.set(cacheKey, Date.now());
          plugin.recordDebugLog?.({
            data: {
              modelCount: currentSettings.discoveredModels.length,
              providerId: 'claude',
              reason: 'seeded_on_first_use',
            },
            event: 'modelCatalog.refresh.skipped',
            level: 'debug',
            scope: 'provider.claude',
          });
          return 'skipped';
        }
      }

      const lastAttemptAt = refreshAttemptsByKey.get(cacheKey) ?? 0;
      const cacheAgeMs = lastAttemptAt > 0 ? Date.now() - lastAttemptAt : Number.POSITIVE_INFINITY;
      const hasCachedModels = currentSettings.discoveredModels.length > 0;
      // An earlier attempt for A cannot reuse the single catalog now holding B.
      const cacheMatches = seedFingerprintMatches(currentSettings.discoveredModelsFingerprint, cacheKey);
      if (!force && lastAttemptAt > 0
        && ((hasCachedModels && cacheMatches) || (!hasCachedModels && cacheAgeMs < CLAUDE_EMPTY_DISCOVERY_RETRY_MS))) {
        plugin.recordDebugLog?.({
          data: {
            ageMs: cacheAgeMs,
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'claude',
            reason: 'cache_fresh',
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.claude',
        });
        return 'skipped';
      }

      const inFlightRefresh = refreshesByKey.get(cacheKey);
      if (inFlightRefresh) return inFlightRefresh;

      const refresh = (async () => {
        const envVars = getClaudeEffectiveEnvironmentVariables(settings);
        const previousDiscoveredModels = currentSettings.discoveredModels;
        const previousFingerprint = currentSettings.discoveredModelsFingerprint;
        const before = JSON.stringify(previousDiscoveredModels);
        try {
          const customEndpoint = hasCustomEndpoint(envVars);
          let discoveredModels: ClaudeDiscoveredModel[] = [];
          if (customEndpoint) {
            try {
              discoveredModels = await fetchModelsWithTimeout(envVars);
            } catch {
              // Many compatible gateways implement messages but not model listing.
            }
          }
          if (discoveredModels.length === 0) {
            discoveredModels = await probeRuntimeModels(plugin);
          }
          if (!customEndpoint && discoveredModels.length === 0 && (envVars.ANTHROPIC_API_KEY?.trim() || envVars.ANTHROPIC_AUTH_TOKEN?.trim())) {
            discoveredModels = await fetchModelsWithTimeout(envVars);
          }
          if (discoveredModels.length === 0) {
            return 'failed';
          }

          const latestSnapshot = await readClaudeCodeSettingsSnapshot(settings, adapter, getVaultPath(plugin.app));
          if (latestSnapshot.hash !== currentSettings.projectSettingsSnapshot.hash) {
            return 'failed';
          }
          const latestSettings = getClaudeProviderSettings(settings);
          const latestCacheKey = cacheKeyFor(
            settings,
            latestSettings,
            plugin.getResolvedProviderCliPath?.('claude') ?? '',
          );
          if (latestCacheKey !== cacheKey) {
            // The configuration moved while the probe ran, so this answer is
            // for a CLI nobody is pointed at any more. Nothing was refreshed
            // for the caller that asked.
            return 'failed';
          }

          // Record which key produced this list, so a later load can tell
          // "discovered under this exact configuration" from "assumed".
          updateClaudeProviderSettings(settings, {
            discoveredModels,
            discoveredModelsFingerprint: hashCatalogFingerprint(cacheKey),
          });
          try {
            await plugin.saveSettings?.();
          } catch (error) {
            updateClaudeProviderSettings(settings, {
              discoveredModels: previousDiscoveredModels,
              discoveredModelsFingerprint: previousFingerprint,
            });
            throw error;
          }

          const updatedSettings = getClaudeProviderSettings(settings);
          const changed = before !== JSON.stringify(updatedSettings.discoveredModels);
          plugin.recordDebugLog?.({
            data: {
              changed,
              modelCount: updatedSettings.discoveredModels.length,
              providerId: 'claude',
            },
            event: changed ? 'modelCatalog.refresh.succeeded' : 'modelCatalog.refresh.empty',
            level: changed ? 'info' : 'debug',
            scope: 'provider.claude',
          });
          // The CLI answered and the catalog holds that answer, which is a
          // refresh whether or not the list is the same one as before.
          return 'refreshed';
        } catch (error) {
          plugin.recordDebugLog?.({
            data: {
              message: error instanceof Error ? error.message : String(error),
              providerId: 'claude',
            },
            event: 'modelCatalog.refresh.failed',
            level: 'warn',
            scope: 'provider.claude',
          });
          return 'failed';
        } finally {
          refreshAttemptsByKey.set(cacheKey, Date.now());
          refreshesByKey.delete(cacheKey);
        }
      })();
      refreshesByKey.set(cacheKey, refresh);
      return refresh;
    },
  };
}
