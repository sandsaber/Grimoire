import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type {
  ProviderModelCatalog,
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { GrokAgentMentionProvider } from '../agents/GrokAgentMentionProvider';
import { GrokCommandCatalog } from '../commands/GrokCommandCatalog';
import { GrokCliResolver } from '../runtime/GrokCliResolver';
import { getGrokProviderSettings } from '../settings';
import { GrokAgentStorage } from '../storage/GrokAgentStorage';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';
import { grokPlanUsageStore } from './GrokPlanUsageStore';
import { GrokRuntimeCommandLoader } from './GrokRuntimeCommandLoader';

export interface GrokWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: GrokAgentStorage;
  agentMentionProvider: GrokAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

const grokTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createGrokModelCatalog(plugin: LegacyProviderContext): ProviderModelCatalog {
  const initialSettings = getGrokProviderSettings(plugin.settings ?? {});
  let lastRefreshAt = initialSettings.discoveredModels.length > 0 ? Date.now() : 0;
  let lastRefreshCacheKey = buildGrokModelCatalogCacheKey(initialSettings);

  return {
    isAvailable(settings) {
      return getGrokProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      const currentSettings = getGrokProviderSettings(settings);
      const cacheKey = buildGrokModelCatalogCacheKey(currentSettings);
      if (currentSettings.discoveredModels.length > 0 && lastRefreshAt === 0) {
        lastRefreshAt = Date.now();
        lastRefreshCacheKey = cacheKey;
      }
      const cacheAgeMs = lastRefreshAt > 0 ? Date.now() - lastRefreshAt : Number.POSITIVE_INFINITY;
      if (
        currentSettings.discoveredModels.length > 0
        && cacheKey === lastRefreshCacheKey
        && cacheAgeMs < MODEL_CATALOG_CACHE_TTL_MS
      ) {
        plugin.recordDebugLog?.({
          data: {
            ageMs: cacheAgeMs,
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'grok',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.grok',
        });
        return false;
      }

      plugin.recordDebugLog?.({
        data: {
          discoveredModelCount: currentSettings.discoveredModels.length,
          providerId: 'grok',
        },
        event: 'modelCatalog.refresh.started',
        level: 'debug',
        scope: 'provider.grok',
      });
      // Phase 9 cutover — GrokChatRuntime removed. Model discovery now happens
      // through the application runtime; legacy catalog refresh reports no change.
      plugin.recordDebugLog?.({
        data: {
          changed: false,
          discoveredModelCount: getGrokProviderSettings(settings).discoveredModels.length,
          loaded: false,
          providerId: 'grok',
          reason: 'phase9_runtime_removed',
        },
        event: 'modelCatalog.refresh.empty',
        level: 'debug',
        scope: 'provider.grok',
      });
      return false;
    },
  };
}

function buildGrokModelCatalogCacheKey(settings: ReturnType<typeof getGrokProviderSettings>): string {
  return JSON.stringify({
    cliPath: settings.cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentHash: settings.environmentHash,
    environmentVariables: settings.environmentVariables,
  });
}

export async function createGrokWorkspaceServices(
  plugin: LegacyProviderContext,
  vaultAdapter: VaultFileAdapter,
): Promise<GrokWorkspaceServices> {
  const mcpStorage = new AcpMcpStorage(vaultAdapter, 'grok');
  const mcpServerManager = new McpServerManager(mcpStorage);
  await mcpServerManager.loadServers();
  const agentStorage = new GrokAgentStorage(vaultAdapter);
  const agentMentionProvider = new GrokAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    agentStorage,
    agentMentionProvider,
    commandCatalog: new GrokCommandCatalog(vaultAdapter),
    cliResolver: new GrokCliResolver(),
    modelCatalog: createGrokModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: grokPlanUsageStore,
    runtimeCommandLoader: new GrokRuntimeCommandLoader(),
    settingsTabRenderer: grokSettingsTabRenderer,
    tabWarmupPolicy: grokTabWarmupPolicy,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const grokWorkspaceRegistration: ProviderWorkspaceRegistration<GrokWorkspaceServices> = {
  workspaceCapabilities: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'readonly', manager: 'managed', runtimeCommandDiscovery: 'active-session-only' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
  initialize: async ({ plugin, vaultAdapter }) => createGrokWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetGrokWorkspaceServices(): GrokWorkspaceServices | null {
  // Phase 9 cutover — ProviderWorkspaceRegistry.getServices removed.
  return null;
}
