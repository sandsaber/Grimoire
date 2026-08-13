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
import { QwenCommandCatalog } from '../commands/QwenCommandCatalog';
import { QwenCliResolver } from '../runtime/QwenCliResolver';
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
  return new QwenCliResolver();
}

const qwenTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'runtime';
  },
};

function createQwenModelCatalog(plugin: LegacyProviderContext): ProviderModelCatalog {
  return {
    isAvailable(settings) {
      return getQwenProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      // Phase 9 cutover — QwenChatRuntime removed. Model discovery now happens
      // through the application runtime; legacy refresh reports no change.
      void settings;
      void plugin;
      return false;
    },
  };
}

export async function createQwenWorkspaceServices(
  plugin: LegacyProviderContext,
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
    tabWarmupPolicy: qwenTabWarmupPolicy,
  };
}

export const qwenWorkspaceRegistration: ProviderWorkspaceRegistration<QwenWorkspaceServices> = {
  workspaceCapabilities: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'managed', manager: 'managed', runtimeCommandDiscovery: 'active-session-only' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
  initialize: async ({ plugin, vaultAdapter }) => createQwenWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetQwenWorkspaceServices(): QwenWorkspaceServices | null {
  // Phase 9 cutover — ProviderWorkspaceRegistry.getServices removed.
  return null;
}
