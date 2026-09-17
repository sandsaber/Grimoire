import type { ProviderCatalogRefreshOutcome } from '@/core/providers/ProviderModelCatalogRefreshCache';
import type { ProviderWorkspaceRegistration } from '@/providers/shared/providerHostContracts';
import { getVaultPath } from '@/utils/path';

import { discoverCommandcodeModels } from '../runtime/CommandcodeModelDiscovery';
import { commandcodeEnvironment, getCommandcodeSettings, resolveCommandcodeCli, updateCommandcodeSettings } from '../settings';
import { commandcodeSettingsTabRenderer } from '../ui/CommandcodeSettingsTab';

export const commandcodeWorkspaceRegistration: ProviderWorkspaceRegistration = {
  async initialize({ plugin }) {
    let pending: Promise<ProviderCatalogRefreshOutcome> | undefined;
    let discoveredEnvironment: string | undefined;
    return {
      cliResolver: { resolveFromSettings: resolveCommandcodeCli, reset: () => undefined },
      settingsTabRenderer: commandcodeSettingsTabRenderer,
      usageProvider: { getCachedUsage: () => null, refreshUsage: async () => null },
      modelCatalog: {
        isAvailable: settings => getCommandcodeSettings(settings).enabled,
        async refreshModels({ settings, force }) {
          if (!getCommandcodeSettings(settings).enabled) return 'skipped';
          const command = resolveCommandcodeCli(settings) ?? 'command-code';
          const environment = commandcodeEnvironment(settings, command);
          const key = JSON.stringify([command, environment]);
          if (!force && discoveredEnvironment === key && getCommandcodeSettings(settings).discoveredModels.length) return 'skipped';
          if (pending) return pending;
          pending = (async () => {
            try {
              const models = await discoverCommandcodeModels(command, getVaultPath(plugin.app) ?? process.cwd(), environment);
              updateCommandcodeSettings(settings, { discoveredModels: models });
              discoveredEnvironment = key;
              return 'refreshed' as const;
            } catch {
              return 'failed' as const;
            } finally { pending = undefined; }
          })();
          return pending;
        },
      },
    };
  },
};
