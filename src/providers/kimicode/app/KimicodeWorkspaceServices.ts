import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderModelCatalogRefreshCache } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import type {
  ProviderWorkspaceRegistration,
} from '../../../providers/shared/providerHostContracts';
import type {
  ProviderModelCatalog,
  ProviderWorkspaceServices,
} from '../../../providers/shared/providerHostContracts';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { KimicodeAgentMentionProvider } from '../agents/KimicodeAgentMentionProvider';
import { KimicodeCommandCatalog } from '../commands/KimicodeCommandCatalog';
import { kimicodeCliResolver } from '../runtime/KimicodeCliResolver';
import { getKimicodeProviderSettings } from '../settings';
import { KimicodeAgentStorage } from '../storage/KimicodeAgentStorage';
import { kimicodeSettingsTabRenderer } from '../ui/KimicodeSettingsTab';
import { kimicodePlanUsageStore } from './KimicodePlanUsageStore';
import { createKimicodeRuntimeCommandLoader } from './KimicodeRuntimeCommandLoader';

export interface KimicodeWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: KimicodeAgentStorage;
  agentMentionProvider: KimicodeAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}


const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createKimicodeModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  // Not seeded from the persisted settings. The discovered list lives in memory
  // only, so anything present at construction came from a legacy persisted field
  // or an earlier runtime in this process - neither discovered under a key this
  // cache watched, and a seed would pin it for the rest of the process. The
  // first refresh boots the runtime once and every later one reuses it.
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);

  return {
    isAvailable(settings) {
      return getKimicodeProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      const currentSettings = getKimicodeProviderSettings(settings);
      const cacheKey = buildKimicodeModelCatalogCacheKey(currentSettings);
      if (!force && refreshCache.isFresh(cacheKey, currentSettings.discoveredModels.length > 0)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'kimicode',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.kimicode',
        });
        return false;
      }

      return refreshCache.refresh({
        fingerprint: cacheKey,
        force,
        hasCachedModels: currentSettings.discoveredModels.length > 0,
        load: async () => {
          const before = JSON.stringify(currentSettings.discoveredModels);
          // One isolated session, opened and closed: what the legacy runtime
          // was doing here was opening a session and reading its reply.
          const loaded = await plugin.getKimicodeExecution().metadata.discoverMetadata();
          const after = JSON.stringify(getKimicodeProviderSettings(settings).discoveredModels);
          return loaded && before !== after;
        },
      });
    },
  };
}

function buildKimicodeModelCatalogCacheKey(settings: ReturnType<typeof getKimicodeProviderSettings>): string {
  return JSON.stringify({
    cliPath: settings.cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentHash: settings.environmentHash,
    environmentVariables: settings.environmentVariables,
  });
}

export async function createKimicodeWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<KimicodeWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'kimicode');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  const agentStorage = new KimicodeAgentStorage(vaultAdapter);
  const agentMentionProvider = new KimicodeAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    agentStorage,
    agentMentionProvider,
    commandCatalog: new KimicodeCommandCatalog(vaultAdapter),
    cliResolver: kimicodeCliResolver(),
    modelCatalog: createKimicodeModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: kimicodePlanUsageStore,
    runtimeCommandLoader: createKimicodeRuntimeCommandLoader(plugin),
    settingsTabRenderer: kimicodeSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const kimicodeWorkspaceRegistration: ProviderWorkspaceRegistration<KimicodeWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createKimicodeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetKimicodeWorkspaceServices(
  plugin: GrimoirePlugin,
): KimicodeWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('kimicode') as KimicodeWorkspaceServices | null ?? null;
}
