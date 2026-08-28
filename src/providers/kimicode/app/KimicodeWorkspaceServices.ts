import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderModelCatalogRefreshCache } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderModelCatalog,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
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
  const initialSettings = getKimicodeProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    refreshCache.seed(buildKimicodeModelCatalogCacheKey(initialSettings));
  }

  return {
    isAvailable(settings) {
      return getKimicodeProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      const currentSettings = getKimicodeProviderSettings(settings);
      const cacheKey = buildKimicodeModelCatalogCacheKey(currentSettings);
      if (refreshCache.isFresh(cacheKey, currentSettings.discoveredModels.length > 0)) {
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
  workspaceCapabilities: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'readonly', manager: 'managed', runtimeCommandDiscovery: 'ephemeral' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
  initialize: async ({ plugin, vaultAdapter }) => createKimicodeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetKimicodeWorkspaceServices(): KimicodeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('kimicode') as KimicodeWorkspaceServices | null;
}
