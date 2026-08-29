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
import { OpencodeAgentMentionProvider } from '../agents/OpencodeAgentMentionProvider';
import { OpencodeCommandCatalog } from '../commands/OpencodeCommandCatalog';
import { opencodeCliResolver } from '../runtime/OpencodeCliResolver';
import { getOpencodeProviderSettings } from '../settings';
import { OpencodeAgentStorage } from '../storage/OpencodeAgentStorage';
import { opencodeSettingsTabRenderer } from '../ui/OpencodeSettingsTab';
import { opencodePlanUsageStore } from './OpencodePlanUsageStore';
import { createOpencodeRuntimeCommandLoader } from './OpencodeRuntimeCommandLoader';

export interface OpencodeWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: OpencodeAgentStorage;
  agentMentionProvider: OpencodeAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createOpencodeModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  // Not seeded from the persisted settings. The discovered list lives in memory
  // only, so anything present at construction came from a legacy persisted field
  // or an earlier runtime in this process - neither discovered under a key this
  // cache watched, and a seed would pin it for the rest of the process. The
  // first refresh boots the runtime once and every later one reuses it.
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);

  return {
    isAvailable(settings) {
      return getOpencodeProviderSettings(settings).enabled;
    },
    async refreshModels({ force, settings }) {
      const currentSettings = getOpencodeProviderSettings(settings);
      const cacheKey = buildOpencodeModelCatalogCacheKey(currentSettings);
      if (!force && refreshCache.isFresh(cacheKey, currentSettings.discoveredModels.length > 0)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'opencode',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.opencode',
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
          const loaded = await plugin.getOpencodeExecution().metadata.discoverMetadata();
          return loaded ? 'refreshed' : 'failed';
        },
      });
    },
  };
}

function buildOpencodeModelCatalogCacheKey(settings: ReturnType<typeof getOpencodeProviderSettings>): string {
  return JSON.stringify({
    cliPath: settings.cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentHash: settings.environmentHash,
    environmentVariables: settings.environmentVariables,
  });
}

export async function createOpencodeWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
): Promise<OpencodeWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'opencode');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  const agentStorage = new OpencodeAgentStorage(vaultAdapter);
  const agentMentionProvider = new OpencodeAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    agentStorage,
    agentMentionProvider,
    commandCatalog: new OpencodeCommandCatalog(vaultAdapter),
    cliResolver: opencodeCliResolver(),
    modelCatalog: createOpencodeModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: opencodePlanUsageStore,
    runtimeCommandLoader: createOpencodeRuntimeCommandLoader(plugin),
    settingsTabRenderer: opencodeSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const opencodeWorkspaceRegistration: ProviderWorkspaceRegistration<OpencodeWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createOpencodeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetOpencodeWorkspaceServices(
  plugin: GrimoirePlugin,
): OpencodeWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('opencode') as OpencodeWorkspaceServices | null ?? null;
}
