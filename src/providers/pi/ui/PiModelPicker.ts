import type { ProviderSettingsTabRendererContext } from '@/providers/shared/providerHostContracts';
import { renderDiscoveredModelPicker } from '@/providers/shared/renderDiscoveredModelPicker';

import { getPiSettings, updatePiSettings } from '../settings';

export function renderPiModelPicker(container: HTMLElement, context: ProviderSettingsTabRendererContext): void {
  renderDiscoveredModelPicker(container, context, {
    providerName: 'Pi',
    getSettings: () => getPiSettings(context.plugin.settings),
    updateSettings: patch => updatePiSettings(context.plugin.settings, patch),
    refresh: async () => await context.plugin.getApplicationRuntimeOrNull()?.pi.discoverModels() ?? false,
  });
}
