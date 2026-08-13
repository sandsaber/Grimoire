import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderModelCatalogRefreshCache } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type {
  ProviderModelCatalog,
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { OpencodeAgentMentionProvider } from '../agents/OpencodeAgentMentionProvider';
import { OpencodeCommandCatalog } from '../commands/OpencodeCommandCatalog';
import { OpencodeCliResolver } from '../runtime/OpencodeCliResolver';
import { getOpencodeProviderSettings } from '../settings';
import { OpencodeAgentStorage } from '../storage/OpencodeAgentStorage';
import { opencodeSettingsTabRenderer } from '../ui/OpencodeSettingsTab';
import { opencodePlanUsageStore } from './OpencodePlanUsageStore';
import { OpencodeRuntimeCommandLoader } from './OpencodeRuntimeCommandLoader';

export interface OpencodeWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: OpencodeAgentStorage;
  agentMentionProvider: OpencodeAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

const opencodeTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createOpencodeModelCatalog(plugin: LegacyProviderContext): ProviderModelCatalog {
  const initialSettings = getOpencodeProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    refreshCache.seed(buildOpencodeModelCatalogCacheKey(initialSettings));
  }

  return {
    isAvailable(settings) {
      return getOpencodeProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      const currentSettings = getOpencodeProviderSettings(settings);
      const cacheKey = buildOpencodeModelCatalogCacheKey(currentSettings);
      if (refreshCache.isFresh(cacheKey, currentSettings.discoveredModels.length > 0)) {
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
        return false;
      }

      return refreshCache.refresh({
        fingerprint: cacheKey,
        hasCachedModels: currentSettings.discoveredModels.length > 0,
        // Phase 9 cutover — OpencodeChatRuntime removed. Model discovery now
        // happens through the application runtime; legacy load reports no change.
        load: async () => false,
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
  plugin: LegacyProviderContext,
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
    cliResolver: new OpencodeCliResolver(),
    modelCatalog: createOpencodeModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: opencodePlanUsageStore,
    runtimeCommandLoader: new OpencodeRuntimeCommandLoader(),
    settingsTabRenderer: opencodeSettingsTabRenderer,
    tabWarmupPolicy: opencodeTabWarmupPolicy,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const opencodeWorkspaceRegistration: ProviderWorkspaceRegistration<OpencodeWorkspaceServices> = {
  workspaceCapabilities: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'readonly', manager: 'managed', runtimeCommandDiscovery: 'ephemeral' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
  initialize: async ({ plugin, vaultAdapter }) => createOpencodeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetOpencodeWorkspaceServices(): OpencodeWorkspaceServices | null {
  // Phase 9 cutover — ProviderWorkspaceRegistry.getServices removed.
  return null;
}
