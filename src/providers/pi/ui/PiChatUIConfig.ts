import type { ProviderChatUIConfig } from '@/providers/shared/providerHostContracts';

import { getPiSettings } from '../settings';

const owns = (model: string) => model === 'pi' || model.startsWith('pi:');

export const piChatUIConfig: ProviderChatUIConfig = {
  getProviderIcon: () => ({ viewBox: '0 0 24 24', path: 'M4 5h16v3h-3v9c0 1 1 2 3 2v3c-4 0-6-2-6-5V8h-4v14H7V8H4z' }),
  getModelOptions: settings => {
    const { discoveredModels, visibleModels, modelAliases } = getPiSettings(settings);
    const saved = (settings.savedProviderModel as Record<string, unknown> | undefined)?.pi;
    const coldModel = typeof saved === 'string' && saved.startsWith('pi:') ? saved.slice(3) : undefined;
    const byId = new Map(discoveredModels.map(model => [model.rawId, model]));
    const models = visibleModels.length ? visibleModels.map(rawId => byId.get(rawId) ?? {
      rawId, label: rawId, description: 'Not reported by the latest Pi catalog',
    }) : discoveredModels.length ? discoveredModels : coldModel ? [{ rawId: coldModel, label: coldModel }] : [];
    return models.length ? models.map(model => ({ value: `pi:${model.rawId}`,
      label: modelAliases[model.rawId] || model.label, description: model.description }))
      : [{ value: 'pi', label: 'Pi', description: 'Use the native session default model' }];
  },
  ownsModel: owns,
  isDefaultModel: owns,
  isAdaptiveReasoningModel: () => true,
  getReasoningOptions: (model, settings) => [
    { value: 'default', label: 'Pi default' },
    ...(getPiSettings(settings).discoveredModels.find(item => `pi:${item.rawId}` === model)?.thinkingLevels ?? []).map(value => ({ value, label: value })),
  ],
  getDefaultReasoningValue: () => 'default',
  getContextWindowSize: (model, limits) => limits?.[model] ?? 0,
  getCustomModelIds: () => new Set(),
  normalizeModelVariant: model => owns(model) ? model : 'pi',
  applyModelDefaults(model, settings) {
    if (settings && typeof settings === 'object') Object.assign(settings, { model, effortLevel: 'default' });
  },
  // Pi controls tool execution itself; ACP modes are thinking levels.
  getPermissionModeToggle: () => null,
};
