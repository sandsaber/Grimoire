import type { ProviderWorkspaceRegistration } from '@/providers/shared/providerHostContracts';

import { getPiSettings, resolvePiAdapter } from './settings';
import { piSettingsTabRenderer } from './ui/PiSettingsTab';

export const piWorkspaceRegistration: ProviderWorkspaceRegistration = {
  async initialize({ plugin }) {
    return {
      cliResolver: { resolveFromSettings: resolvePiAdapter, reset: () => undefined },
      settingsTabRenderer: piSettingsTabRenderer,
      usageProvider: { getCachedUsage: () => null, refreshUsage: async () => null },
      modelCatalog: {
        isAvailable: settings => getPiSettings(settings).enabled,
        async refreshModels({ settings, force }) {
          if (!getPiSettings(settings).enabled) return 'skipped';
          const models = getPiSettings(settings).discoveredModels;
          if (!force && models.length && models.every(model => model.thinkingLevels?.length)) return 'skipped';
          try {
            return await plugin.getApplicationRuntimeOrNull()?.pi.discoverModels() ? 'refreshed' : 'failed';
          } catch { return 'failed'; }
        },
      },
    };
  },
};
