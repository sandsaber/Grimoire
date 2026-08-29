import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import type {
  ProviderCliResolver,
  ProviderModelCatalog,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../providers/shared/providerHostContracts';
import { AntigravityCommandCatalog } from '../commands/AntigravityCommandCatalog';
import { ANTIGRAVITY_FALLBACK_DISCOVERED_MODELS } from '../models';
import { antigravityCliResolver } from '../runtime/AntigravityCliResolver';
import { discoverAntigravityModels } from '../runtime/AntigravityModelDiscovery';
import { getAntigravityProviderSettings, updateAntigravityProviderSettings } from '../settings';
import { antigravitySettingsTabRenderer } from '../ui/AntigravitySettingsTab';
import { antigravityPlanUsageStore } from './AntigravityPlanUsageStore';

export interface AntigravityWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: ProviderCliResolver;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
}

function createAntigravityCliResolver(): ProviderCliResolver {
  return antigravityCliResolver();
}

function createAntigravityModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  const initialSettings = getAntigravityProviderSettings(plugin.settings ?? {});
  let lastRefreshAt = initialSettings.discoveredModels.length > 0 ? Date.now() : 0;
  let lastRefreshCacheKey = buildAntigravityModelCatalogCacheKey(initialSettings);
  let refreshPromise: Promise<boolean> | null = null;
  return {
    isAvailable(settings) {
      return getAntigravityProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      const currentSettings = getAntigravityProviderSettings(settings);
      const cacheKey = buildAntigravityModelCatalogCacheKey(currentSettings);
      if (currentSettings.discoveredModels.length > 0 && lastRefreshAt === 0) {
        lastRefreshAt = Date.now();
        lastRefreshCacheKey = cacheKey;
      }
      // A settled catalog is rediscovered only when its key changes or the
      // caller asks; the picker that triggers background refreshes must not
      // spawn agy on a timer.
      const cacheAgeMs = lastRefreshAt > 0 ? Date.now() - lastRefreshAt : Number.POSITIVE_INFINITY;
      if (
        !force
        && currentSettings.discoveredModels.length > 0
        && cacheKey === lastRefreshCacheKey
        && lastRefreshAt > 0
      ) {
        plugin.recordDebugLog?.({
          data: {
            ageMs: cacheAgeMs,
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'antigravity',
            reason: 'cache_fresh',
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.antigravity',
        });
        return false;
      }

      if (refreshPromise) {
        plugin.recordDebugLog?.({
          data: {
            providerId: 'antigravity',
          },
          event: 'modelCatalog.refresh.joined',
          level: 'debug',
          scope: 'provider.antigravity',
        });
        return refreshPromise;
      }

      const before = JSON.stringify(getAntigravityProviderSettings(settings));
      plugin.recordDebugLog?.({
        data: {
          providerId: 'antigravity',
        },
        event: 'modelCatalog.refresh.started',
        level: 'debug',
        scope: 'provider.antigravity',
      });

      refreshPromise = (async () => {
        const cliDiscoveredModels = await discoverAntigravityModels(plugin);
        const settingsBeforeUpdate = getAntigravityProviderSettings(settings);
        if (cliDiscoveredModels.length === 0 && settingsBeforeUpdate.discoveredModels.length > 0) {
          lastRefreshAt = Date.now();
          lastRefreshCacheKey = buildAntigravityModelCatalogCacheKey(settingsBeforeUpdate);
          plugin.recordDebugLog?.({
            data: {
              modelCount: settingsBeforeUpdate.discoveredModels.length,
              providerId: 'antigravity',
            },
            event: 'modelCatalog.refresh.preserved',
            level: 'warn',
            scope: 'provider.antigravity',
          });
          return false;
        }
        const usingFallbackModels = cliDiscoveredModels.length === 0;
        const discoveredModels = usingFallbackModels
          ? ANTIGRAVITY_FALLBACK_DISCOVERED_MODELS.map((model) => ({ ...model }))
          : cliDiscoveredModels;

        updateAntigravityProviderSettings(settings, {
          discoveredModels,
          visibleModels: discoveredModels.map((model) => model.rawId),
        });
        const updatedSettings = getAntigravityProviderSettings(settings);
        lastRefreshAt = Date.now();
        lastRefreshCacheKey = buildAntigravityModelCatalogCacheKey(updatedSettings);
        const after = JSON.stringify(getAntigravityProviderSettings(settings));
        const changed = before !== after;
        plugin.recordDebugLog?.({
          data: {
            changed,
            modelCount: discoveredModels.length,
            providerId: 'antigravity',
            ...(usingFallbackModels ? { reason: 'empty_cli_output' } : {}),
          },
          event: usingFallbackModels ? 'modelCatalog.refresh.fallback' : 'modelCatalog.refresh.succeeded',
          level: usingFallbackModels ? 'warn' : 'info',
          scope: 'provider.antigravity',
        });
        return changed;
      })();

      try {
        return await refreshPromise;
      } catch (error) {
        plugin.recordDebugLog?.({
          data: {
            providerId: 'antigravity',
          },
          error,
          event: 'modelCatalog.refresh.failed',
          level: 'error',
          scope: 'provider.antigravity',
        });
        throw error;
      } finally {
        refreshPromise = null;
      }
    },
  };
}

function buildAntigravityModelCatalogCacheKey(settings: ReturnType<typeof getAntigravityProviderSettings>): string {
  return JSON.stringify({
    cliPath: settings.cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentHash: settings.environmentHash,
    environmentVariables: settings.environmentVariables,
  });
}

export async function createAntigravityWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<AntigravityWorkspaceServices> {
  return {
    cliResolver: createAntigravityCliResolver(),
    commandCatalog: new AntigravityCommandCatalog(vaultAdapter),
    modelCatalog: createAntigravityModelCatalog(plugin),
    usageProvider: antigravityPlanUsageStore,
    settingsTabRenderer: antigravitySettingsTabRenderer,
  };
}

export const antigravityWorkspaceRegistration: ProviderWorkspaceRegistration<AntigravityWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createAntigravityWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetAntigravityWorkspaceServices(
  plugin: GrimoirePlugin,
): AntigravityWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('antigravity') as AntigravityWorkspaceServices | null ?? null;
}
