import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type {
  AppAgentManager,
  AppAgentStorage,
  AppMcpStorage,
  AppPluginManager,
  ProviderCliResolver,
  ProviderModelCatalog,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { AgentManager } from '../agents/AgentManager';
import { ClaudeCommandCatalog } from '../commands/ClaudeCommandCatalog';
import { probeRuntimeCommands } from '../commands/probeRuntimeCommands';
import { resolveClaudeConfigDir } from '../config/ClaudeConfigDir';
import { PluginManager } from '../plugins/PluginManager';
import { ClaudeCliResolver } from '../runtime/ClaudeCliResolver';
import { StorageService } from '../storage/StorageService';
import { claudeSettingsTabRenderer } from '../ui/ClaudeSettingsTab';
import { createClaudeModelCatalog } from './ClaudeModelCatalog';
import { claudePlanUsageStore } from './ClaudePlanUsageStore';

export interface ClaudeWorkspaceServices extends ProviderWorkspaceServices {
  claudeStorage: StorageService;
  cliResolver: ProviderCliResolver;
  mcpStorage: AppMcpStorage;
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
  agentStorage: AppAgentStorage;
  agentManager: AppAgentManager;
  commandCatalog: ProviderCommandCatalog;
  agentMentionProvider: AppAgentManager;
  modelCatalog: ProviderModelCatalog;
  getClaudeConfigDir(): string;
}

export async function createClaudeWorkspaceServices(
  plugin: LegacyProviderContext,
  adapter: VaultFileAdapter,
): Promise<ClaudeWorkspaceServices> {
  const claudeStorage = new StorageService(plugin, adapter);
  await claudeStorage.ensureDirectories();

  const vaultPath = getVaultPath(plugin.app) ?? '';
  const getClaudeConfigDir = () => resolveClaudeConfigDir({
    environment: {
      ...process.env,
      ...parseEnvironmentVariables(plugin.getActiveEnvironmentVariables?.('claude') ?? ''),
    },
    hostPlatform: process.platform,
    vaultPath,
  });
  const cliResolver = new ClaudeCliResolver();
  const mcpStorage = claudeStorage.mcp;
  const mcpManager = new McpServerManager(mcpStorage);
  await mcpManager.loadServers();

  const pluginManager = new PluginManager(vaultPath, getClaudeConfigDir);
  await pluginManager.loadPlugins();

  const agentStorage = claudeStorage.agents;
  const agentManager = new AgentManager(vaultPath, pluginManager, getClaudeConfigDir);
  await agentManager.loadAgents();

  const commandCatalog = new ClaudeCommandCatalog(
    claudeStorage.commands,
    claudeStorage.skills,
    () => probeRuntimeCommands(plugin),
  );

  return {
    claudeStorage,
    cliResolver,
    mcpStorage,
    mcpServerManager: mcpManager,
    mcpManager,
    pluginManager,
    agentStorage,
    agentManager,
    commandCatalog,
    agentMentionProvider: agentManager,
    modelCatalog: createClaudeModelCatalog(plugin),
    getClaudeConfigDir,
    usageProvider: claudePlanUsageStore,
    settingsTabRenderer: claudeSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentManager.loadAgents();
    },
  };
}

export const claudeWorkspaceRegistration: ProviderWorkspaceRegistration<ClaudeWorkspaceServices> = {
  workspaceCapabilities: {
    skills: { inventory: 'managed', manager: 'managed' },
    commands: { inventory: 'managed', manager: 'managed' },
    agents: { inventory: 'managed', manager: 'managed' },
    mcp: { inventory: 'managed', manager: 'managed' },
    environment: { inventory: 'managed', manager: 'managed' },
  },
  initialize: async ({ plugin, vaultAdapter }) => createClaudeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetClaudeWorkspaceServices(): ClaudeWorkspaceServices | null {
  // Phase 9 cutover — ProviderWorkspaceRegistry.getServices removed.
  return null;
}

export function getClaudeWorkspaceServices(): ClaudeWorkspaceServices {
  // Phase 9 cutover — ProviderWorkspaceRegistry.requireServices removed.
  throw new Error('Claude workspace services unavailable during Phase 9 cutover');
}
