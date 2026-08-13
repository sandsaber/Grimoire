import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { KIMICODE_PROVIDER_ICON } from '../../../shared/icons';
import {
  buildKimicodeBaseModels,
  decodeKimicodeModelId,
  encodeKimicodeModelId,
  isKimicodeModelSelectionId,
  KIMICODE_DEFAULT_THINKING_LEVEL,
  KIMICODE_SYNTHETIC_MODEL_ID,
  resolveKimicodeBaseModelRawId,
} from '../models';
import {
  resolveKimicodeModeForPermissionMode,
  resolvePermissionModeForManagedKimicodeMode,
} from '../modes';
import { getKimicodeProviderSettings, updateKimicodeProviderSettings } from '../settings';

const KIMICODE_MODELS: ProviderUIOption[] = [
  { value: KIMICODE_SYNTHETIC_MODEL_ID, label: 'Kimi Code', description: 'ACP runtime' },
];
const KIMICODE_FALLBACK_THINKING_OPTIONS: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const KIMICODE_FALLBACK_THINKING_DEFAULT = 'high';
const DEFAULT_CONTEXT_WINDOW = 200_000;
const KIMICODE_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};

export const kimicodeChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const kimicodeSettings = getKimicodeProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = kimicodeSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredModels = new Map(buildKimicodeBaseModels(kimicodeSettings.discoveredModels).map((model) => [
      encodeKimicodeModelId(model.rawId),
      applyAlias(model.rawId, {
        description: model.description ?? 'ACP runtime',
        label: model.label,
        value: encodeKimicodeModelId(model.rawId),
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
    for (const rawModelId of kimicodeSettings.visibleModels) {
      const encodedModelId = encodeKimicodeModelId(rawModelId);
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
      typeof savedProviderModel?.kimicode === 'string'
        ? savedProviderModel.kimicode
        : '',
    ];

    for (const model of selectedModelValues) {
      const rawModelId = decodeKimicodeModelId(model);
      if (
        !model
        || !isKimicodeModelSelectionId(model)
        || model === KIMICODE_SYNTHETIC_MODEL_ID
        || !rawModelId
      ) {
        continue;
      }

      const baseRawId = resolveKimicodeBaseModelRawId(rawModelId, kimicodeSettings.discoveredModels);
      const baseModelId = encodeKimicodeModelId(baseRawId);
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

    return options.length > 0 ? options : [...KIMICODE_MODELS];
  },

  ownsModel(model: string): boolean {
    return isKimicodeModelSelectionId(model);
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return getKimicodeThinkingOptions(model, settings).length > 0;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return getKimicodeThinkingOptions(model, settings)
      .map((variant) => ({
        description: variant.description,
        label: variant.label,
        value: variant.value,
      }));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeKimicodeModelId(model);
    if (!rawModelId) {
      return KIMICODE_FALLBACK_THINKING_DEFAULT;
    }

    const kimicodeSettings = getKimicodeProviderSettings(settings);
    const baseRawId = resolveKimicodeBaseModelRawId(rawModelId, kimicodeSettings.discoveredModels);
    return getDefaultThinkingLevelForModel(baseRawId, settings);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isKimicodeModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeKimicodeModelId(model);
    if (!rawModelId) {
      settingsBag.effortLevel = KIMICODE_FALLBACK_THINKING_DEFAULT;
      return;
    }

    const kimicodeSettings = getKimicodeProviderSettings(settingsBag);
    const baseRawId = resolveKimicodeBaseModelRawId(rawModelId, kimicodeSettings.discoveredModels);
    settingsBag.model = encodeKimicodeModelId(baseRawId);
    settingsBag.effortLevel = getDefaultThinkingLevelForModel(baseRawId, settingsBag);
  },

  async prepareModelMetadata(model: string, _settings: Record<string, unknown>, context): Promise<void> {
    const rawModelId = decodeKimicodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const kimicodeSettings = getKimicodeProviderSettings(context.plugin.settings);
    const baseRawId = resolveKimicodeBaseModelRawId(rawModelId, kimicodeSettings.discoveredModels);
    if (baseRawId && kimicodeSettings.thinkingOptionsByModel[baseRawId]) {
      return;
    }

    // Phase 9 cutover — KimicodeChatRuntime removed. Model metadata warmup now
    // happens through the application runtime; this opportunistic hook is a no-op.
    void model;
    void context;
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeKimicodeModelId(model);
    if (!rawModelId) {
      return;
    }

    const kimicodeSettings = getKimicodeProviderSettings(settingsBag);
    const baseRawId = resolveKimicodeBaseModelRawId(rawModelId, kimicodeSettings.discoveredModels);
    const supportedValues = new Set(getSupportedThinkingOptionsForModel(baseRawId, settingsBag)
      .map((variant) => variant.value));
    const nextPreferredThinkingByModel = {
      ...kimicodeSettings.preferredThinkingByModel,
    };

    if (!value || value === KIMICODE_DEFAULT_THINKING_LEVEL || !supportedValues.has(value)) {
      delete nextPreferredThinkingByModel[baseRawId];
    } else {
      nextPreferredThinkingByModel[baseRawId] = value;
    }

    updateKimicodeProviderSettings(settingsBag, {
      preferredThinkingByModel: nextPreferredThinkingByModel,
    });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeKimicodeModelId(model);
    if (!rawModelId) {
      return model;
    }

    const kimicodeSettings = getKimicodeProviderSettings(settings);
    const baseRawId = resolveKimicodeBaseModelRawId(rawModelId, kimicodeSettings.discoveredModels);
    return encodeKimicodeModelId(baseRawId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return KIMICODE_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    const selectedMode = getKimicodeProviderSettings(settings).selectedMode;
    return resolvePermissionModeForManagedKimicodeMode(selectedMode);
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateKimicodeProviderSettings(settingsBag, {
      selectedMode: resolveKimicodeModeForPermissionMode(
        value,
        getKimicodeProviderSettings(settingsBag).availableModes,
      ),
    });
  },

  getProviderIcon() {
    return KIMICODE_PROVIDER_ICON;
  },
};

function getDefaultThinkingLevelForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): string {
  const kimicodeSettings = getKimicodeProviderSettings(settings);
  const preferred = kimicodeSettings.preferredThinkingByModel[baseRawId];
  const options = getSupportedThinkingOptionsForModel(baseRawId, settings);
  const supportedValues = new Set(options.map((variant) => variant.value));
  if (preferred && supportedValues.has(preferred)) {
    return preferred;
  }

  return (supportedValues.has(KIMICODE_FALLBACK_THINKING_DEFAULT)
    ? KIMICODE_FALLBACK_THINKING_DEFAULT
    : options[0]?.value)
    ?? KIMICODE_DEFAULT_THINKING_LEVEL;
}

function getSupportedThinkingOptionsForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  const kimicodeSettings = getKimicodeProviderSettings(settings);
  const discoveredOptions = kimicodeSettings.thinkingOptionsByModel[baseRawId] ?? [];
  return discoveredOptions.length > 0
    ? discoveredOptions
    : KIMICODE_FALLBACK_THINKING_OPTIONS;
}

function getKimicodeThinkingOptions(
  model: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  if (!isKimicodeModelSelectionId(model)) {
    return [];
  }

  const rawModelId = decodeKimicodeModelId(model);
  if (!rawModelId) {
    return KIMICODE_FALLBACK_THINKING_OPTIONS;
  }

  const kimicodeSettings = getKimicodeProviderSettings(settings);
  const baseRawId = resolveKimicodeBaseModelRawId(rawModelId, kimicodeSettings.discoveredModels);
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
