import type { ProviderSettingsTabRendererContext } from '@/providers/shared/providerHostContracts';
import { renderDiscoveredModelPicker } from '@/providers/shared/renderDiscoveredModelPicker';

import { getCommandcodeSettings, updateCommandcodeSettings } from '../settings';

export function renderCommandcodeModelPicker(container: HTMLElement, context: ProviderSettingsTabRendererContext): void {
  renderDiscoveredModelPicker(container, context, {
    providerName: 'Command Code',
    getSettings: () => getCommandcodeSettings(context.plugin.settings),
    updateSettings: patch => updateCommandcodeSettings(context.plugin.settings, patch),
    refresh: async () => {
      const { plugin } = context;
      const catalog = plugin.getApplicationRuntimeOrNull()?.workspaceServicesFor('commandcode')?.modelCatalog;
      return await catalog?.refreshModels({ plugin, settings: plugin.settings, force: true }) === 'refreshed';
    },
  });
}
