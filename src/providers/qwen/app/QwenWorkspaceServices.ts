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
import { QwenCommandCatalog } from '../commands/QwenCommandCatalog';
import {
  buildQwenModelCatalogFingerprint,
  resolveQwenModelCatalogFingerprint,
} from '../modelCatalogFingerprint';
import { qwenCliResolver } from '../runtime/QwenCliResolver';
import { getQwenProviderSettings } from '../settings';
import { QwenAgentStorage } from '../storage/QwenAgentStorage';
import { qwenSettingsTabRenderer } from '../ui/QwenSettingsTab';
import { qwenPlanUsageStore } from './QwenPlanUsageStore';

export interface QwenWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: QwenAgentStorage;
  commandCatalog: ProviderCommandCatalog;
  cliResolver: ProviderCliResolver;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

function createQwenCliResolver(): ProviderCliResolver {
  return qwenCliResolver();
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createQwenModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  const initialSettings = getQwenProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    // The resolved CLI path is part of the fingerprint but is not available
    // here: this catalog is built inside createQwenWorkspaceServices, which runs
    // the workspace manager runs before it publishes the services - until then
    // getResolvedProviderCliPath returns null and an eager seed would be filed
    // under settings.cliPath while every later refresh looks it up under the
    // resolved path. Hold the seed back until the path is known.
    const initialEnvironmentVariables = plugin.getActiveEnvironmentVariables?.('qwen')
      ?? initialSettings.environmentVariables;
    if (plugin.getResolvedProviderCliPath?.('qwen') == null) {
      refreshCache.seedOnFirstRefresh(() => buildQwenModelCatalogFingerprint(
        initialSettings,
        plugin.getResolvedProviderCliPath?.('qwen') ?? initialSettings.cliPath,
        initialEnvironmentVariables,
      ));
    } else {
      refreshCache.seed(
        resolveQwenModelCatalogFingerprint(plugin, initialSettings),
        initialSettings.discoveredModelsFingerprint,
      );
    }
  }

  return {
    isAvailable(settings) {
      return getQwenProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      // Discovery boots the real CLI over ACP and creates a session, so it must
      // not run again for every model dropdown that opens.
      const currentSettings = getQwenProviderSettings(settings);
      const fingerprint = resolveQwenModelCatalogFingerprint(plugin, currentSettings);
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
            providerId: 'qwen',
            reason: 'seeded_on_first_use',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.qwen',
        });
        return false;
      }

      if (!force && refreshCache.isFresh(fingerprint, hasCachedModels)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'qwen',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.qwen',
        });
        return false;
      }

      return refreshCache.refresh({
        fingerprint,
        force,
        hasCachedModels,
        load: async () => {
          const before = JSON.stringify(getQwenProviderSettings(settings).discoveredModels);
          // One isolated session, opened and closed. Building a whole chat
          // runtime to get here was the only thing that runtime did for this
          // surface: open a session and read its reply.
          await plugin.getQwenExecution().metadata.discoverMetadata();
          const after = JSON.stringify(getQwenProviderSettings(settings).discoveredModels);
          return before !== after;
        },
      });
    },
  };
}

export async function createQwenWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<QwenWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'qwen');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  const agentStorage = new QwenAgentStorage(vaultAdapter);
  return {
    agentStorage,
    commandCatalog: new QwenCommandCatalog(vaultAdapter),
    cliResolver: createQwenCliResolver(),
    modelCatalog: createQwenModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: qwenPlanUsageStore,
    settingsTabRenderer: qwenSettingsTabRenderer,
  };
}

export const qwenWorkspaceRegistration: ProviderWorkspaceRegistration<QwenWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createQwenWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetQwenWorkspaceServices(
  plugin: GrimoirePlugin,
): QwenWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('qwen') as QwenWorkspaceServices | null ?? null;
}
