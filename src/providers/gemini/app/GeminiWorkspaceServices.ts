import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type {
  ProviderCliResolver,
  ProviderModelCatalog,
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { GeminiCommandCatalog } from '../commands/GeminiCommandCatalog';
import { GeminiCliResolver } from '../runtime/GeminiCliResolver';
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
  return new GeminiCliResolver();
}

const geminiTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'runtime';
  },
};

function createGeminiModelCatalog(plugin: LegacyProviderContext): ProviderModelCatalog {
  return {
    isAvailable(settings) {
      return getGeminiProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      // Phase 9 cutover — GeminiChatRuntime removed. Model discovery now
      // happens through the application runtime; legacy refresh reports no change.
      void settings;
      void plugin;
      return false;
    },
  };
}

export async function createGeminiWorkspaceServices(
  plugin: LegacyProviderContext,
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
    tabWarmupPolicy: geminiTabWarmupPolicy,
  };
}

export const geminiWorkspaceRegistration: ProviderWorkspaceRegistration<GeminiWorkspaceServices> = {
  workspaceCapabilities: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'managed', manager: 'managed', runtimeCommandDiscovery: 'none' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
  initialize: async ({ plugin, vaultAdapter }) => createGeminiWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetGeminiWorkspaceServices(): GeminiWorkspaceServices | null {
  // Phase 9 cutover — ProviderWorkspaceRegistry.getServices removed.
  return null;
}
