import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { MIMOCODE_PROVIDER_ICON } from '../../../shared/icons';
import {
  buildMimocodeBaseModels,
  decodeMimocodeModelId,
  encodeMimocodeModelId,
  isMimocodeModelSelectionId,
  MIMOCODE_DEFAULT_THINKING_LEVEL,
  MIMOCODE_SYNTHETIC_MODEL_ID,
  resolveMimocodeBaseModelRawId,
} from '../models';
import {
  resolveMimocodeModeForPermissionMode,
  resolvePermissionModeForManagedMimocodeMode,
} from '../modes';
import { getMimocodeProviderSettings, updateMimocodeProviderSettings } from '../settings';

const MIMOCODE_MODELS: ProviderUIOption[] = [
  { value: MIMOCODE_SYNTHETIC_MODEL_ID, label: 'MiMoCode', description: 'ACP runtime' },
];
const MIMOCODE_FALLBACK_THINKING_OPTIONS: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const MIMOCODE_FALLBACK_THINKING_DEFAULT = 'high';
const DEFAULT_CONTEXT_WINDOW = 200_000;
const MIMOCODE_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};

export const mimocodeChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const mimocodeSettings = getMimocodeProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = mimocodeSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredModels = new Map(buildMimocodeBaseModels(mimocodeSettings.discoveredModels).map((model) => [
      encodeMimocodeModelId(model.rawId),
      applyAlias(model.rawId, {
        description: model.description ?? 'ACP runtime',
        label: model.label,
        value: encodeMimocodeModelId(model.rawId),
      }),
    ]));
    const savedProviderModel = (
      settings.savedProviderModel
      && typeof settings.savedProviderModel === 'object'
      && !Array.isArray(settings.savedProviderModel)
    )
      ? settings.savedProviderModel as Record<string, unknown>
      : null;

    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    for (const rawModelId of mimocodeSettings.visibleModels) {
      const encodedModelId = encodeMimocodeModelId(rawModelId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredModels.get(encodedModelId)
          ?? applyAlias(rawModelId, {
            description: 'Configured model',
            label: rawModelId,
            value: encodedModelId,
          }),
      );
    }

    const selectedModelValues = [
      typeof settings.model === 'string' ? settings.model : '',
      typeof savedProviderModel?.mimocode === 'string'
        ? savedProviderModel.mimocode
        : '',
    ];

    for (const model of selectedModelValues) {
      const rawModelId = decodeMimocodeModelId(model);
      if (
        !model
        || !isMimocodeModelSelectionId(model)
        || model === MIMOCODE_SYNTHETIC_MODEL_ID
        || !rawModelId
      ) {
        continue;
      }

      const baseRawId = resolveMimocodeBaseModelRawId(rawModelId, mimocodeSettings.discoveredModels);
      const baseModelId = encodeMimocodeModelId(baseRawId);
      pushOption(
        options,
        seenValues,
        baseModelId,
        discoveredModels.get(baseModelId)
          ?? applyAlias(baseRawId, {
            description: 'Selected in an existing session',
            label: baseRawId,
            value: baseModelId,
          }),
      );
    }

    return options.length > 0 ? options : [...MIMOCODE_MODELS];
  },

  ownsModel(model: string): boolean {
    return isMimocodeModelSelectionId(model);
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return getMimocodeThinkingOptions(model, settings).length > 0;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return getMimocodeThinkingOptions(model, settings)
      .map((variant) => ({
        description: variant.description,
        label: variant.label,
        value: variant.value,
      }));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeMimocodeModelId(model);
    if (!rawModelId) {
      return MIMOCODE_FALLBACK_THINKING_DEFAULT;
    }

    const mimocodeSettings = getMimocodeProviderSettings(settings);
    const baseRawId = resolveMimocodeBaseModelRawId(rawModelId, mimocodeSettings.discoveredModels);
    return getDefaultThinkingLevelForModel(baseRawId, settings);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isMimocodeModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeMimocodeModelId(model);
    if (!rawModelId) {
      settingsBag.effortLevel = MIMOCODE_FALLBACK_THINKING_DEFAULT;
      return;
    }

    const mimocodeSettings = getMimocodeProviderSettings(settingsBag);
    const baseRawId = resolveMimocodeBaseModelRawId(rawModelId, mimocodeSettings.discoveredModels);
    settingsBag.model = encodeMimocodeModelId(baseRawId);
    settingsBag.effortLevel = getDefaultThinkingLevelForModel(baseRawId, settingsBag);
  },

  async prepareModelMetadata(model: string, _settings: Record<string, unknown>, context): Promise<void> {
    const rawModelId = decodeMimocodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const mimocodeSettings = getMimocodeProviderSettings(context.plugin.settings);
    const baseRawId = resolveMimocodeBaseModelRawId(rawModelId, mimocodeSettings.discoveredModels);
    if (baseRawId && mimocodeSettings.thinkingOptionsByModel[baseRawId]) {
      return;
    }

    // MimocodeChatRuntime removed. Model metadata warmup now
    // happens through the application runtime; this opportunistic hook is a no-op.
    void model;
    void context;
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeMimocodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const mimocodeSettings = getMimocodeProviderSettings(settingsBag);
    const baseRawId = resolveMimocodeBaseModelRawId(rawModelId, mimocodeSettings.discoveredModels);
    const supportedValues = new Set(getSupportedThinkingOptionsForModel(baseRawId, settingsBag)
      .map((variant) => variant.value));
    const nextPreferredThinkingByModel = {
      ...mimocodeSettings.preferredThinkingByModel,
    };

    if (!value || value === MIMOCODE_DEFAULT_THINKING_LEVEL || !supportedValues.has(value)) {
      delete nextPreferredThinkingByModel[baseRawId];
    } else {
      nextPreferredThinkingByModel[baseRawId] = value;
    }

    updateMimocodeProviderSettings(settingsBag, {
      preferredThinkingByModel: nextPreferredThinkingByModel,
    });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeMimocodeModelId(model);
    if (!rawModelId) {
      return model;
    }

    const mimocodeSettings = getMimocodeProviderSettings(settings);
    const baseRawId = resolveMimocodeBaseModelRawId(rawModelId, mimocodeSettings.discoveredModels);
    return encodeMimocodeModelId(baseRawId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return MIMOCODE_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    const selectedMode = getMimocodeProviderSettings(settings).selectedMode;
    return resolvePermissionModeForManagedMimocodeMode(selectedMode);
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateMimocodeProviderSettings(settingsBag, {
      selectedMode: resolveMimocodeModeForPermissionMode(
        value,
        getMimocodeProviderSettings(settingsBag).availableModes,
      ),
    });
  },

  getProviderIcon() {
    return MIMOCODE_PROVIDER_ICON;
  },
};

function getDefaultThinkingLevelForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): string {
  const mimocodeSettings = getMimocodeProviderSettings(settings);
  const preferred = mimocodeSettings.preferredThinkingByModel[baseRawId];
  const options = getSupportedThinkingOptionsForModel(baseRawId, settings);
  const supportedValues = new Set(options.map((variant) => variant.value));
  if (preferred && supportedValues.has(preferred)) {
    return preferred;
  }

  return (supportedValues.has(MIMOCODE_FALLBACK_THINKING_DEFAULT)
    ? MIMOCODE_FALLBACK_THINKING_DEFAULT
    : options[0]?.value)
    ?? MIMOCODE_DEFAULT_THINKING_LEVEL;
}

function getSupportedThinkingOptionsForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  const mimocodeSettings = getMimocodeProviderSettings(settings);
  const discoveredOptions = mimocodeSettings.thinkingOptionsByModel[baseRawId] ?? [];
  return discoveredOptions.length > 0
    ? discoveredOptions
    : MIMOCODE_FALLBACK_THINKING_OPTIONS;
}

function getMimocodeThinkingOptions(
  model: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  if (!isMimocodeModelSelectionId(model)) {
    return [];
  }

  const rawModelId = decodeMimocodeModelId(model);
  if (!rawModelId) {
    return MIMOCODE_FALLBACK_THINKING_OPTIONS;
  }

  const mimocodeSettings = getMimocodeProviderSettings(settings);
  const baseRawId = resolveMimocodeBaseModelRawId(rawModelId, mimocodeSettings.discoveredModels);
  return getSupportedThinkingOptionsForModel(baseRawId, settings);
}

function pushOption(
  target: ProviderUIOption[],
  seenValues: Set<string>,
  value: string,
  option: ProviderUIOption,
): void {
  if (seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  target.push(option);
}
