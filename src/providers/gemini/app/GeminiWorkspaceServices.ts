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
import { GeminiCommandCatalog } from '../commands/GeminiCommandCatalog';
import {
  buildGeminiModelCatalogFingerprint,
  resolveGeminiModelCatalogFingerprint,
} from '../modelCatalogFingerprint';
import { geminiCliResolver } from '../runtime/GeminiCliResolver';
import { getGeminiProviderSettings } from '../settings';
import { GeminiAgentStorage } from '../storage/GeminiAgentStorage';
import { geminiSettingsTabRenderer } from '../ui/GeminiSettingsTab';
import { geminiPlanUsageStore } from './GeminiPlanUsageStore';

export interface GeminiWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: GeminiAgentStorage;
  commandCatalog: ProviderCommandCatalog;
  cliResolver: ProviderCliResolver;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

function createGeminiCliResolver(): ProviderCliResolver {
  return geminiCliResolver();
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createGeminiModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  const initialSettings = getGeminiProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    // The resolved CLI path is part of the fingerprint and is not available
    // here: this catalog is built inside `createGeminiWorkspaceServices`, which
    // the workspace manager runs before it publishes the services — until then
    // `getResolvedProviderCliPath` answers null, and an eager seed would be
    // filed under `settings.cliPath` while every later refresh looks it up
    // under the resolved path. Hold the seed back until the path is known.
    const initialEnvironmentVariables = plugin.getActiveEnvironmentVariables?.('gemini')
      ?? initialSettings.environmentVariables;
    if (plugin.getResolvedProviderCliPath?.('gemini') == null) {
      refreshCache.seedOnFirstRefresh(() => buildGeminiModelCatalogFingerprint(
        initialSettings,
        plugin.getResolvedProviderCliPath?.('gemini') ?? initialSettings.cliPath,
        initialEnvironmentVariables,
      ));
    } else {
      refreshCache.seed(
        resolveGeminiModelCatalogFingerprint(plugin, initialSettings),
        initialSettings.discoveredModelsFingerprint,
      );
    }
  }

  return {
    isAvailable(settings) {
      return getGeminiProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      // Discovery boots the real CLI over ACP and creates a session, so it must
      // not run again for every model dropdown that opens.
      const currentSettings = getGeminiProviderSettings(settings);
      const fingerprint = resolveGeminiModelCatalogFingerprint(plugin, currentSettings);
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
            providerId: 'gemini',
            reason: 'seeded_on_first_use',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.gemini',
        });
        return false;
      }

      if (!force && refreshCache.isFresh(fingerprint, hasCachedModels)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'gemini',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.gemini',
        });
        return false;
      }

      return refreshCache.refresh({
        fingerprint,
        force,
        hasCachedModels,
        load: async () => {
          // One isolated session, opened and closed. Building a whole chat
          // runtime to get here was the only thing that runtime did for this
          // surface: open a session and read its reply.
          //
          // Its answer was whether anything was learned; what this reports is
          // whether the *model list* changed, which is the narrower question
          // and the one the legacy code asked.
          const before = JSON.stringify(getGeminiProviderSettings(settings).discoveredModels);
          await plugin.getGeminiExecution().metadata.discoverMetadata();
          const after = JSON.stringify(getGeminiProviderSettings(settings).discoveredModels);
          return before !== after;
        },
      });
    },
  };
}

export async function createGeminiWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<GeminiWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'gemini');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  const agentStorage = new GeminiAgentStorage(vaultAdapter);
  return {
    agentStorage,
    commandCatalog: new GeminiCommandCatalog(vaultAdapter),
    cliResolver: createGeminiCliResolver(),
    modelCatalog: createGeminiModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: geminiPlanUsageStore,
    settingsTabRenderer: geminiSettingsTabRenderer,
  };
}

export const geminiWorkspaceRegistration: ProviderWorkspaceRegistration<GeminiWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createGeminiWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetGeminiWorkspaceServices(
  plugin: GrimoirePlugin,
): GeminiWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('gemini') as GeminiWorkspaceServices | null ?? null;
}
