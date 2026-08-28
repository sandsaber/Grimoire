import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import type {
  ProviderWorkspaceRegistration,
} from '../../../providers/shared/providerHostContracts';
import type {
  ProviderModelCatalog,
  ProviderWorkspaceServices,
} from '../../../providers/shared/providerHostContracts';
import { getVaultPath } from '../../../utils/path';
import { AcpMcpStorage } from '../../acp/mcp/AcpMcpStorage';
import { GrokAgentMentionProvider } from '../agents/GrokAgentMentionProvider';
import { GrokCommandCatalog } from '../commands/GrokCommandCatalog';
import { grokCliResolver } from '../runtime/GrokCliResolver';
import { discoverGrokModelsFromCli } from '../runtime/GrokModelDiscovery';
import {
  applyGrokNativeModelCatalog,
  readGrokNativeModelCatalog,
} from '../runtime/GrokModelsCache';
import { resolveManagedGrokHomePath } from '../runtime/GrokPaths';
import { buildGrokRuntimeEnv } from '../runtime/GrokRuntimeEnvironment';
import { getGrokProviderSettings } from '../settings';
import { GrokAgentStorage } from '../storage/GrokAgentStorage';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';
import { grokPlanUsageStore } from './GrokPlanUsageStore';
import { createGrokRuntimeCommandLoader } from './GrokRuntimeCommandLoader';

export interface GrokWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: GrokAgentStorage;
  agentMentionProvider: GrokAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
  modelCatalog: ProviderModelCatalog;
  mcpStorage: AcpMcpStorage;
  mcpServerManager: McpServerManager;
}

function createGrokModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  let pendingRefresh: Promise<boolean> | null = null;

  return {
    isAvailable(settings) {
      return getGrokProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      if (pendingRefresh) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: getGrokProviderSettings(settings).discoveredModels.length,
            providerId: 'grok',
            reason: 'in_flight',
          },
          event: 'modelCatalog.refresh.joined',
          level: 'debug',
          scope: 'provider.grok',
        });
        return pendingRefresh;
      }

      pendingRefresh = refreshGrokModelCatalog(plugin, settings).finally(() => {
        pendingRefresh = null;
      });
      return pendingRefresh;
    },
  };
}

async function refreshGrokModelCatalog(
  plugin: GrimoirePlugin,
  settings: Record<string, unknown>,
): Promise<boolean> {
  const before = JSON.stringify(getGrokProviderSettings(settings).discoveredModels);
  plugin.recordDebugLog?.({
    data: {
      discoveredModelCount: getGrokProviderSettings(settings).discoveredModels.length,
      providerId: 'grok',
    },
    event: 'modelCatalog.refresh.started',
    level: 'debug',
    scope: 'provider.grok',
  });

  let catalog = await discoverGrokModelsFromCli(plugin);
  if (catalog.models.length === 0) {
    const cwd = plugin.app ? getVaultPath(plugin.app) ?? process.cwd() : process.cwd();
    catalog = readGrokNativeModelCatalog({
      env: buildGrokRuntimeEnv(
        plugin.settings,
        plugin.getResolvedProviderCliPath('grok') ?? 'grok',
        resolveManagedGrokHomePath(cwd),
      ),
      managedGrokHomePath: resolveManagedGrokHomePath(cwd),
    });
  }

  let changed = applyGrokNativeModelCatalog(settings, catalog);
  if (catalog.models.length === 0) {
    // The managed home had no catalog to read, so the models are asked for the
    // only other way there is: one isolated session, opened and closed. What
    // the legacy runtime did here was exactly that.
    const loaded = await plugin.getGrokExecution().metadata.discoverMetadata();
    const after = JSON.stringify(getGrokProviderSettings(settings).discoveredModels);
    changed = loaded && before !== after;
  }

  if (changed) {
    await plugin.saveSettings();
    for (const view of plugin.getAllViews?.() ?? []) {
      view.refreshModelSelector?.();
    }
  }

  plugin.recordDebugLog?.({
    data: {
      changed,
      discoveredModelCount: getGrokProviderSettings(settings).discoveredModels.length,
      providerId: 'grok',
    },
    event: changed ? 'modelCatalog.refresh.succeeded' : 'modelCatalog.refresh.empty',
    level: changed ? 'info' : 'debug',
    scope: 'provider.grok',
  });
  return changed;
}

export async function createGrokWorkspaceServices(
  plugin: GrimoirePlugin,
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
    cliResolver: grokCliResolver(),
    modelCatalog: createGrokModelCatalog(plugin),
    mcpStorage,
    mcpServerManager,
    usageProvider: grokPlanUsageStore,
    runtimeCommandLoader: createGrokRuntimeCommandLoader(plugin),
    settingsTabRenderer: grokSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const grokWorkspaceRegistration: ProviderWorkspaceRegistration<GrokWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createGrokWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetGrokWorkspaceServices(
  plugin: GrimoirePlugin,
): GrokWorkspaceServices | null {
  return plugin.getApplicationRuntimeOrNull?.()
    ?.workspaceServicesFor('grok') as GrokWorkspaceServices | null ?? null;
}
