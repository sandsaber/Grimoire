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
import { MimocodeAgentMentionProvider } from '../agents/MimocodeAgentMentionProvider';
import { MimocodeCommandCatalog } from '../commands/MimocodeCommandCatalog';
import { mimocodeCliResolver } from '../runtime/MimocodeCliResolver';
import { getMimocodeProviderSettings } from '../settings';
import { MimocodeAgentStorage } from '../storage/MimocodeAgentStorage';
import { mimocodeSettingsTabRenderer } from '../ui/MimocodeSettingsTab';
import { mimocodePlanUsageStore } from './MimocodePlanUsageStore';
import { createMimocodeRuntimeCommandLoader } from './MimocodeRuntimeCommandLoader';

export interface MimocodeWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: MimocodeAgentStorage;
  agentMentionProvider: MimocodeAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}


const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createMimocodeModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  // Not seeded from the persisted settings. The discovered list lives in memory
  // only, so anything present at construction came from a legacy persisted field
  // or an earlier runtime in this process - neither discovered under a key this
  // cache watched, and a seed would pin it for the rest of the process. The
  // first refresh boots the runtime once and every later one reuses it.
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);

  return {
    isAvailable(settings) {
      return getMimocodeProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      const currentSettings = getMimocodeProviderSettings(settings);
      const cacheKey = buildMimocodeModelCatalogCacheKey(currentSettings);
      if (!force && refreshCache.isFresh(cacheKey, currentSettings.discoveredModels.length > 0)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'mimocode',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.mimocode',
        });
        return 'skipped';
      }

      return refreshCache.refresh({
        fingerprint: cacheKey,
        force,
        hasCachedModels: currentSettings.discoveredModels.length > 0,
        load: async () => {
          // One isolated session, opened and closed: what the legacy runtime
          // was doing here was opening a session and reading its reply.
          //
          // Its answer is whether the agent said anything, which is the question
          // the surface asks. Whether the *list* changed is a different one, and
          // a refresh that returns the same models did not fail.
          const loaded = await plugin.getMimocodeExecution().metadata.discoverMetadata();
          return loaded ? 'refreshed' : 'failed';
        },
      });
    },
  };
}

function buildMimocodeModelCatalogCacheKey(settings: ReturnType<typeof getMimocodeProviderSettings>): string {
  return JSON.stringify({
    cliPath: settings.cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentHash: settings.environmentHash,
    environmentVariables: settings.environmentVariables,
  });
}

export async function createMimocodeWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<MimocodeWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'mimocode');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  const agentStorage = new MimocodeAgentStorage(vaultAdapter);
  const agentMentionProvider = new MimocodeAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    agentStorage,
    agentMentionProvider,
    commandCatalog: new MimocodeCommandCatalog(vaultAdapter),
    cliResolver: mimocodeCliResolver(),
    modelCatalog: createMimocodeModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: mimocodePlanUsageStore,
    runtimeCommandLoader: createMimocodeRuntimeCommandLoader(plugin),
    settingsTabRenderer: mimocodeSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const mimocodeWorkspaceRegistration: ProviderWorkspaceRegistration<MimocodeWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createMimocodeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetMimocodeWorkspaceServices(
  plugin: GrimoirePlugin,
): MimocodeWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('mimocode') as MimocodeWorkspaceServices | null ?? null;
}
