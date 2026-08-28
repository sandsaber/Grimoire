import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderModelCatalogRefreshCache } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCliResolver,
  ProviderModelCatalog,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type GrimoirePlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { CodexAgentMentionProvider } from '../agents/CodexAgentMentionProvider';
import { CodexSkillCatalog } from '../commands/CodexSkillCatalog';
import { updateCodexModelDiscoveryState } from '../modelDiscoveryState';
import { codexCliResolver } from '../runtime/CodexCliResolver';
import { CodexModelListingService } from '../runtime/CodexModelListingService';
import { getCodexProviderSettings } from '../settings';
import { CodexSkillListingService } from '../skills/CodexSkillListingService';
import { CodexSkillStorage } from '../storage/CodexSkillStorage';
import { CodexSubagentStorage } from '../storage/CodexSubagentStorage';
import { codexSettingsTabRenderer } from '../ui/CodexSettingsTab';
import { codexPlanUsageStore } from './CodexPlanUsageStore';

export interface CodexWorkspaceServices extends ProviderWorkspaceServices {
  subagentStorage: CodexSubagentStorage;
  commandCatalog: ProviderCommandCatalog;
  agentMentionProvider: CodexAgentMentionProvider;
  cliResolver: ProviderCliResolver;
  modelCatalog: ProviderModelCatalog;
}

function createCodexCliResolver(): ProviderCliResolver {
  return codexCliResolver();
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function createCodexModelCatalog(plugin: GrimoirePlugin): ProviderModelCatalog {
  const modelListingService = new CodexModelListingService(plugin);
  const initialSettings = getCodexProviderSettings(plugin.settings ?? {});
  const refreshCache = new ProviderModelCatalogRefreshCache(MODEL_CATALOG_CACHE_TTL_MS);
  if (initialSettings.discoveredModels.length > 0) {
    refreshCache.seed(buildCodexModelCatalogFingerprint(plugin, initialSettings));
  }
  return {
    isAvailable(settings) {
      return getCodexProviderSettings(settings).enabled;
    },
    async refreshModels({ settings }) {
      const currentSettings = getCodexProviderSettings(settings);
      const fingerprint = buildCodexModelCatalogFingerprint(plugin, currentSettings);
      if (refreshCache.isFresh(fingerprint, currentSettings.discoveredModels.length > 0)) {
        plugin.recordDebugLog?.({
          data: {
            modelCount: currentSettings.discoveredModels.length,
            providerId: 'codex',
            reason: 'cache_fresh',
            ttlMs: MODEL_CATALOG_CACHE_TTL_MS,
          },
          event: 'modelCatalog.refresh.skipped',
          level: 'debug',
          scope: 'provider.codex',
        });
        return false;
      }

      return refreshCache.refresh({
        fingerprint,
        hasCachedModels: currentSettings.discoveredModels.length > 0,
        load: async () => {
      plugin.recordDebugLog?.({
        data: { providerId: 'codex' },
        event: 'modelCatalog.refresh.started',
        level: 'debug',
        scope: 'provider.codex',
      });

      try {
        modelListingService.invalidate();
        const models = await modelListingService.listModels();
        if (models.length === 0) {
          plugin.recordDebugLog?.({
            data: { providerId: 'codex' },
            event: 'modelCatalog.refresh.empty',
            level: 'debug',
            scope: 'provider.codex',
          });
          return false;
        }

        const changed = updateCodexModelDiscoveryState(settings, { discoveredModels: models });
        if (changed) {
          await plugin.saveSettings?.();
        }
        plugin.recordDebugLog?.({
          data: {
            changed,
            modelCount: models.length,
            providerId: 'codex',
          },
          event: 'modelCatalog.refresh.succeeded',
          level: 'info',
          scope: 'provider.codex',
        });
        return changed;
      } catch (error) {
        plugin.recordDebugLog?.({
          data: {
            message: error instanceof Error ? error.message : String(error),
            providerId: 'codex',
          },
          error,
          event: 'modelCatalog.refresh.failed',
          level: 'warn',
          scope: 'provider.codex',
        });
        throw error;
      }
        },
      });
    },
  };
}

function buildCodexModelCatalogFingerprint(
  plugin: GrimoirePlugin,
  settings: ReturnType<typeof getCodexProviderSettings>,
): string {
  return JSON.stringify({
    cliPath: plugin.getResolvedProviderCliPath?.('codex') ?? settings.cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentHash: settings.environmentHash,
    environmentVariables: plugin.getActiveEnvironmentVariables?.('codex')
      ?? settings.environmentVariables,
  });
}

export async function createCodexWorkspaceServices(
  plugin: GrimoirePlugin,
  vaultAdapter: VaultFileAdapter,
  homeAdapter: HomeFileAdapter,
): Promise<CodexWorkspaceServices> {
  const subagentStorage = new CodexSubagentStorage(vaultAdapter);
  const agentMentionProvider = new CodexAgentMentionProvider(subagentStorage);
  await agentMentionProvider.loadAgents();

  const skillListProvider = new CodexSkillListingService(plugin);
  const commandCatalog = new CodexSkillCatalog(
    new CodexSkillStorage(
      vaultAdapter,
      homeAdapter,
    ),
    skillListProvider,
    getVaultPath(plugin.app),
  );

  return {
    subagentStorage,
    commandCatalog,
    agentMentionProvider,
    cliResolver: createCodexCliResolver(),
    modelCatalog: createCodexModelCatalog(plugin),
    usageProvider: codexPlanUsageStore,
    settingsTabRenderer: codexSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const codexWorkspaceRegistration: ProviderWorkspaceRegistration<CodexWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter, homeAdapter }) => createCodexWorkspaceServices(
    plugin,
    vaultAdapter,
    homeAdapter,
  ),
};

export function maybeGetCodexWorkspaceServices(): CodexWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('codex') as CodexWorkspaceServices | null;
}

export function getCodexWorkspaceServices(): CodexWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('codex') as CodexWorkspaceServices;
}
