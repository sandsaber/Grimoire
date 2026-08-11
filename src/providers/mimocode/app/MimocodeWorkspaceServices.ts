import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderModelCatalogRefreshCache } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderModelCatalog,
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { MimocodeAgentMentionProvider } from '../agents/MimocodeAgentMentionProvider';
import { MimocodeCommandCatalog } from '../commands/MimocodeCommandCatalog';
import { MimocodeChatRuntime } from '../runtime/MimocodeChatRuntime';
import { MimocodeCliResolver } from '../runtime/MimocodeCliResolver';
import { getMimocodeProviderSettings } from '../settings';
import { MimocodeAgentStorage } from '../storage/MimocodeAgentStorage';
import { mimocodeSettingsTabRenderer } from '../ui/MimocodeSettingsTab';
import { mimocodePlanUsageStore } from './MimocodePlanUsageStore';
import { MimocodeRuntimeCommandLoader } from './MimocodeRuntimeCommandLoader';

export interface MimocodeWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: MimocodeAgentStorage;
  agentMentionProvider: MimocodeAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

const MIMOCODE_METADATA_WARMUP_DB = ':memory:';

const mimocodeTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createMimocodeModelCatalog(plugin: LegacyProviderContext): ProviderModelCatalog {
  const initialSettings = getMimocodeProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    refreshCache.seed(buildMimocodeModelCatalogCacheKey(initialSettings));
  }

  return {
    isAvailable(settings) {
      return getMimocodeProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      const currentSettings = getMimocodeProviderSettings(settings);
      const cacheKey = buildMimocodeModelCatalogCacheKey(currentSettings);
      if (refreshCache.isFresh(cacheKey, currentSettings.discoveredModels.length > 0)) {
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
        return false;
      }

      return refreshCache.refresh({
        fingerprint: cacheKey,
        hasCachedModels: currentSettings.discoveredModels.length > 0,
        load: async () => {
          const before = JSON.stringify(currentSettings.discoveredModels);
          const runtime = new MimocodeChatRuntime(plugin);
          try {
            runtime.syncConversationState({
              providerState: { databasePath: MIMOCODE_METADATA_WARMUP_DB },
              sessionId: null,
            });
            const loaded = await runtime.ensureReady({ allowSessionCreation: true });
            const after = JSON.stringify(getMimocodeProviderSettings(settings).discoveredModels);
            return loaded && before !== after;
          } finally {
            runtime.cleanup();
          }
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
  plugin: LegacyProviderContext,
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
    cliResolver: new MimocodeCliResolver(),
    modelCatalog: createMimocodeModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: mimocodePlanUsageStore,
    runtimeCommandLoader: new MimocodeRuntimeCommandLoader(),
    settingsTabRenderer: mimocodeSettingsTabRenderer,
    tabWarmupPolicy: mimocodeTabWarmupPolicy,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const mimocodeWorkspaceRegistration: ProviderWorkspaceRegistration<MimocodeWorkspaceServices> = {
  workspaceCapabilities: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'readonly', manager: 'managed', runtimeCommandDiscovery: 'ephemeral' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
  initialize: async ({ plugin, vaultAdapter }) => createMimocodeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetMimocodeWorkspaceServices(): MimocodeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('mimocode') as MimocodeWorkspaceServices | null;
}
