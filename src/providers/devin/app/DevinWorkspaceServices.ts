import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderModelCatalogRefreshCache } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import type {
  ProviderCliResolver,
  ProviderModelCatalog,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../providers/shared/providerHostContracts';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { DevinCommandCatalog } from '../commands/DevinCommandCatalog';
import {
  buildDevinModelCatalogFingerprint,
  resolveDevinModelCatalogFingerprint,
} from '../modelCatalogFingerprint';
import { devinCliResolver } from '../runtime/DevinCliResolver';
import { getDevinProviderSettings } from '../settings';
import { devinSettingsTabRenderer } from '../ui/DevinSettingsTab';
import { devinPlanUsageStore } from './DevinPlanUsageStore';

export interface DevinWorkspaceServices extends ProviderWorkspaceServices {
  commandCatalog: ProviderCommandCatalog;
  cliResolver: ProviderCliResolver;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createDevinModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  const initialSettings = getDevinProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    // The resolved CLI path is part of the fingerprint but is not available
    // here: the workspace manager runs this before it publishes the services,
    // and until then getResolvedProviderCliPath returns null. Hold the seed
    // back until the path is known.
    const initialEnvironmentVariables = plugin.getActiveEnvironmentVariables?.('devin')
      ?? initialSettings.environmentVariables;
    if (plugin.getResolvedProviderCliPath?.('devin') == null) {
      refreshCache.seedOnFirstRefresh(() => buildDevinModelCatalogFingerprint(
        initialSettings,
        plugin.getResolvedProviderCliPath?.('devin') ?? initialSettings.cliPath,
        initialEnvironmentVariables,
      ));
    } else {
      refreshCache.seed(
        resolveDevinModelCatalogFingerprint(plugin, initialSettings),
        initialSettings.discoveredModelsFingerprint,
      );
    }
  }

  return {
    isAvailable(settings) {
      return getDevinProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      // Discovery boots the real CLI over ACP and creates a session, so it must
      // not run again for every model dropdown that opens.
      const currentSettings = getDevinProviderSettings(settings);
      const fingerprint = resolveDevinModelCatalogFingerprint(plugin, currentSettings);
      const hasCachedModels = currentSettings.discoveredModels.length > 0;
      const appliedDeferredSeed = refreshCache.applyDeferredSeed(
        fingerprint,
        hasCachedModels,
        currentSettings.discoveredModelsFingerprint,
      );
      if (appliedDeferredSeed && !force) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'devin',
            reason: 'seeded_on_first_use',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.devin',
        });
        return 'skipped';
      }

      if (!force && refreshCache.isFresh(fingerprint, hasCachedModels)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'devin',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.devin',
        });
        return 'skipped';
      }

      return refreshCache.refresh({
        fingerprint,
        force,
        hasCachedModels,
        load: async () => {
          const loaded = await plugin.getDevinExecution().metadata.discoverMetadata();
          return loaded ? 'refreshed' : 'failed';
        },
      });
    },
  };
}

export async function createDevinWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<DevinWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'devin');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  return {
    commandCatalog: new DevinCommandCatalog(vaultAdapter),
    cliResolver: devinCliResolver(),
    modelCatalog: createDevinModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: devinPlanUsageStore,
    settingsTabRenderer: devinSettingsTabRenderer,
  };
}

export const devinWorkspaceRegistration: ProviderWorkspaceRegistration<DevinWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createDevinWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetDevinWorkspaceServices(
  plugin: GrimoirePlugin,
): DevinWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('devin') as DevinWorkspaceServices | null ?? null;
}
