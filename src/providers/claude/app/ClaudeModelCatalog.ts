import { requestUrl } from 'obsidian';

import {
  hashCatalogFingerprint,
  seedFingerprintMatches,
} from '../../../core/providers/catalogFingerprint';
import type GrimoirePlugin from '../../../main';
import type { ProviderModelCatalog } from '../../../providers/shared/providerHostContracts';
import {
  buildClaudeCatalogCacheKey,
  CLAUDE_EMPTY_DISCOVERY_RETRY_MS,
} from '../cli/claudeCatalogCache';
import { probeRuntimeModels } from '../commands/probeRuntimeModels';
import {
  type ClaudeDiscoveredModel,
  getClaudeEffectiveEnvironmentVariables,
  getClaudeProviderSettings,
  normalizeClaudeDiscoveredModels,
  updateClaudeProviderSettings,
} from '../settings';

const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_API_VERSION = '2023-06-01';
const MODEL_CATALOG_LIMIT = 1000;
const MODEL_CATALOG_MAX_PAGES = 10;
// Only paces retries after an attempt that found nothing. A catalog that holds
// models is rediscovered solely on a cache-key change or an explicit request.

interface ClaudeModelsApiResponse {
  data?: unknown;
  has_more?: unknown;
  last_id?: unknown;
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

function toClaudeDiscoveredModels(value: unknown): ClaudeDiscoveredModel[] {
  return normalizeClaudeDiscoveredModels(value);
}

async function fetchClaudeModelsFromAnthropicApi(
  envVars: Record<string, string>,
): Promise<ClaudeDiscoveredModel[]> {
  const apiKey = envVars.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

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
        'x-api-key': apiKey,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Claude Models API request failed with HTTP ${response.status}`);
    }

    const payload = response.json as ClaudeModelsApiResponse;
    for (const model of toClaudeDiscoveredModels(payload.data)) {
      if (seen.has(model.id)) {
        continue;
      }

      seen.add(model.id);
      models.push({ ...model, source: 'api' });
    }

    if (payload.has_more !== true || typeof payload.last_id !== 'string' || !payload.last_id) {
      break;
    }

    afterId = payload.last_id;
  }

  return models;
}

export function createClaudeModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  const refreshAttemptsByKey = new Map<string, number>();
  const refreshesByKey = new Map<string, Promise<boolean>>();

  // The attempt log only lives in memory, so every plugin load would otherwise
  // probe again on the first picker that is built - and probing starts a full
  // Claude Code session, which bills against the plan window.
  //
  // Only an already SDK-sourced catalog is seeded. A persisted `api` catalog
  // (or a partial one) still gets its single per-load probe, because that probe
  // exists to upgrade the cheap API listing to the authenticated SDK list.
  const initialSettings = getClaudeProviderSettings(plugin.settings ?? {});
  const catalogIsFullySdkSourced = initialSettings.discoveredModels.length > 0
    && initialSettings.discoveredModels.every(model => model.source === 'sdk');

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
      const initialCacheKey = buildClaudeCatalogCacheKey(initialSettings, initialCliPath);
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
      const currentSettings = getClaudeProviderSettings(settings);
      const cacheKey = buildClaudeCatalogCacheKey(
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
          initialSettings,
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
          return false;
        }
      }

      const lastAttemptAt = refreshAttemptsByKey.get(cacheKey) ?? 0;
      const cacheAgeMs = lastAttemptAt > 0 ? Date.now() - lastAttemptAt : Number.POSITIVE_INFINITY;
      const hasCachedModels = currentSettings.discoveredModels.length > 0;
      if (!force && lastAttemptAt > 0 && (hasCachedModels || cacheAgeMs < CLAUDE_EMPTY_DISCOVERY_RETRY_MS)) {
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
        return false;
      }

      const inFlightRefresh = refreshesByKey.get(cacheKey);
      if (inFlightRefresh) return inFlightRefresh;

      const refresh = (async () => {
        const envVars = getClaudeEffectiveEnvironmentVariables(settings);
        const previousDiscoveredModels = currentSettings.discoveredModels;
        const previousFingerprint = currentSettings.discoveredModelsFingerprint;
        const before = JSON.stringify(previousDiscoveredModels);
        try {
          let discoveredModels = await probeRuntimeModels(plugin);
          if (discoveredModels.length === 0 && envVars.ANTHROPIC_API_KEY?.trim()) {
            discoveredModels = await fetchClaudeModelsFromAnthropicApi(envVars);
          }
          if (discoveredModels.length === 0) {
            return false;
          }

          const latestSettings = getClaudeProviderSettings(settings);
          const latestCacheKey = buildClaudeCatalogCacheKey(
            latestSettings,
            plugin.getResolvedProviderCliPath?.('claude') ?? '',
          );
          if (latestCacheKey !== cacheKey) {
            return false;
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
          return changed;
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
          return false;
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
