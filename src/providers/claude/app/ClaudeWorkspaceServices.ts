import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type {
  AppAgentManager,
  AppAgentStorage,
  AppMcpStorage,
  AppPluginManager,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import type {
  ProviderWorkspaceRegistration,
} from '../../../providers/shared/providerHostContracts';
import type {
  ProviderCliResolver,
  ProviderModelCatalog,
  ProviderWorkspaceServices,
} from '../../../providers/shared/providerHostContracts';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { AgentManager } from '../agents/AgentManager';
import { ClaudeCommandCatalog } from '../commands/ClaudeCommandCatalog';
import { probeRuntimeCommands } from '../commands/probeRuntimeCommands';
import { resolveClaudeConfigDir } from '../config/ClaudeConfigDir';
import { PluginManager } from '../plugins/PluginManager';
import { claudeCliResolver } from '../runtime/ClaudeCliResolver';
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
  plugin: GrimoirePlugin,
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
  const cliResolver = claudeCliResolver();
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
  initialize: async ({ plugin, vaultAdapter }) => createClaudeWorkspaceServices(plugin, vaultAdapter),
};

/**
 * This provider's services, or a throw.
 *
 * For the callers that cannot proceed without them and would otherwise read a
 * half-built surface as an empty one. Takes a plugin for the same reason
 * `maybeGet` does: the services live on the composition root now, not in a
 * static that stood in for having one.
 */
export function getClaudeWorkspaceServices(plugin: GrimoirePlugin): ClaudeWorkspaceServices {
  const services = maybeGetClaudeWorkspaceServices(plugin);
  if (!services) {
    throw new Error('Provider workspace "claude" is not initialized.');
  }
  return services;
}

export function maybeGetClaudeWorkspaceServices(
  plugin: GrimoirePlugin,
): ClaudeWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('claude') as ClaudeWorkspaceServices | null ?? null;
}

