import type {
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import type {
  ProviderChatUIConfig,
} from '../../../providers/shared/providerHostContracts';
import { DEVIN_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeDevinModelId,
  DEVIN_SYNTHETIC_MODEL_ID,
  encodeDevinModelId,
  isDevinModelSelectionId,
} from '../models';
import {
  getDevinProviderSettings,
  updateDevinProviderSettings,
} from '../settings';

const DEVIN_MODELS: ProviderUIOption[] = [
  {
    description: 'Devin CLI ACP runtime',
    label: 'Devin',
    value: DEVIN_SYNTHETIC_MODEL_ID,
  },
];
/** What the recorded session reports as `size`; the wire overrides it per turn. */
const DEFAULT_CONTEXT_WINDOW = 200_000;
/**
 * One option, because the capability says `reasoningControl: 'none'` and the
 * contribution builds no reasoning group from it. Devin's effort lives in the
 * model id — `claude-opus-5-high` is a model, not a level — so the picker is
 * the model picker.
 */
const DEVIN_DEFAULT_REASONING = 'default';
const DEVIN_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { label: 'Default', value: DEVIN_DEFAULT_REASONING },
];
const DEVIN_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};

function getDevinModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const devinSettings = getDevinProviderSettings(settings);
  const discoveredModels = new Map(devinSettings.discoveredModels.map((model) => [
    model.rawId,
    model,
  ]));
  const optionRawIds = devinSettings.discoveredModels.length > 0
    ? devinSettings.discoveredModels.map((model) => model.rawId)
    : devinSettings.visibleModels;

  const options: ProviderUIOption[] = [];
  for (const rawId of optionRawIds) {
    const discovered = discoveredModels.get(rawId);
    const label = devinSettings.modelAliases[rawId] ?? discovered?.label ?? rawId;
    options.push({
      description: discovered?.description ?? 'Devin CLI ACP model',
      label,
      value: encodeDevinModelId(rawId),
    });
  }

  return options.length > 0 ? options : [...DEVIN_MODELS];
}

export const devinChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getDevinModelOptions(settings);
  },

  ownsModel(model: string): boolean {
    return isDevinModelSelectionId(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return DEVIN_REASONING_OPTIONS.map((option) => ({ ...option }));
  },

  getDefaultReasoningValue(): string {
    return DEVIN_DEFAULT_REASONING;
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isDevinModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeDevinModelId(model);
    settingsBag.model = rawModelId ? encodeDevinModelId(rawModelId) : DEVIN_SYNTHETIC_MODEL_ID;
  },

  applyReasoningSelection(): void {
    // Nothing to apply: see `DEVIN_REASONING_OPTIONS`.
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getDevinModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return DEVIN_SYNTHETIC_MODEL_ID;
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return DEVIN_PERMISSION_MODE_TOGGLE;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateDevinProviderSettings(settingsBag, { selectedMode: value });
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getDevinProviderSettings(settings).selectedMode || null;
  },

  getProviderIcon() {
    return DEVIN_PROVIDER_ICON;
  },
};
