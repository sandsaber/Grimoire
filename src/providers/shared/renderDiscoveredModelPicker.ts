import { renderProviderModelPicker } from '@/features/settings/ui/ProviderModelPicker';
import type { ProviderSettingsTabRendererContext } from '@/providers/shared/providerHostContracts';

interface ModelPickerState {
  discoveredModels: Array<{ rawId: string; label: string; description?: string }>;
  visibleModels: string[];
  modelAliases: Record<string, string>;
}

interface ModelPickerAdapter {
  providerName: string;
  getSettings(): ModelPickerState;
  updateSettings(patch: Partial<ModelPickerState>): void;
  refresh(): Promise<boolean>;
}

export function renderDiscoveredModelPicker(container: HTMLElement, context: ProviderSettingsTabRendererContext, adapter: ModelPickerAdapter): void {
  const { plugin } = context;
  renderProviderModelPicker(container, {
    providerName: adapter.providerName,
    description: 'Choose which models appear in chat. With none selected, all discovered models are shown. Refresh keeps your selection.',
    suppressAutomaticDiscovery: context.suppressAutomaticDiscovery,
    showProviderFilter: false,
    clearSelectionLabel: 'Show all models',
    getState: () => {
      const current = adapter.getSettings();
      const models = current.discoveredModels.map(model => ({
        rawId: model.rawId, modelLabel: model.label, description: model.description ?? '',
        providerKey: '', providerLabel: '', isAvailable: true,
      }));
      const discoveredIds = new Set(models.map(model => model.rawId));
      for (const rawId of current.visibleModels) {
        if (!discoveredIds.has(rawId)) models.push({ rawId, modelLabel: rawId, description: '',
          providerKey: '', providerLabel: '', isAvailable: false });
      }
      return { models, discoveredCount: current.discoveredModels.length, visibleModels: current.visibleModels,
        modelAliases: current.modelAliases };
    },
    onSelectionChange: async visibleModels => {
      adapter.updateSettings({ visibleModels });
      await plugin.saveSettings();
      context.refreshModelSelectors();
    },
    onAliasChange: async (rawId, alias) => {
      const modelAliases = { ...adapter.getSettings().modelAliases };
      if (alias) modelAliases[rawId] = alias;
      else delete modelAliases[rawId];
      adapter.updateSettings({ modelAliases });
      await plugin.saveSettings();
      context.refreshModelSelectors();
    },
    onRefresh: async () => {
      const refreshed = await adapter.refresh();
      if (!refreshed) return false;
      await plugin.saveSettings();
      context.refreshModelSelectors();
      return true;
    },
  });
}
