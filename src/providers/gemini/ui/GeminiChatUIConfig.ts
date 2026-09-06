import type {
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import type {
  ProviderChatUIConfig,
} from '../../../providers/shared/providerHostContracts';
import { GEMINI_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeGeminiModelId,
  encodeGeminiModelId,
  GEMINI_DEFAULT_THINKING_LEVEL,
  GEMINI_SYNTHETIC_MODEL_ID,
  isGeminiModelSelectionId,
} from '../models';
import { getGeminiProviderSettings, updateGeminiProviderSettings } from '../settings';

const GEMINI_MODELS: ProviderUIOption[] = [
  {
    description: 'Gemini CLI ACP runtime',
    label: 'Gemini',
    value: GEMINI_SYNTHETIC_MODEL_ID,
  },
];
const GEMINI_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: GEMINI_DEFAULT_THINKING_LEVEL, label: 'Default' },
];
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const GEMINI_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};

function getGeminiModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const geminiSettings = getGeminiProviderSettings(settings);
  const discoveredModels = new Map(geminiSettings.discoveredModels.map((model) => [
    model.rawId,
    model,
  ]));
  const optionRawIds = geminiSettings.discoveredModels.length > 0
    ? geminiSettings.discoveredModels.map((model) => model.rawId)
    : geminiSettings.visibleModels;

  const options: ProviderUIOption[] = [];
  for (const rawId of optionRawIds) {
    const discovered = discoveredModels.get(rawId);
    options.push({
      description: discovered?.description ?? 'Gemini CLI ACP model',
      label: geminiSettings.modelAliases[rawId] ?? discovered?.label ?? rawId,
      value: encodeGeminiModelId(rawId),
    });
  }

  return options.length > 0 ? options : [...GEMINI_MODELS];
}

export const geminiChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getGeminiModelOptions(settings);
  },

  ownsModel(model: string): boolean {
    return isGeminiModelSelectionId(model);
  },

  isAdaptiveReasoningModel(_model: string, _settings: Record<string, unknown>): boolean {
    // Capabilities currently advertise reasoningControl: 'none' until effort is
    // applied end-to-end by the Gemini ACP runtime.
    return false;
  },

  getReasoningOptions(_model: string, _settings: Record<string, unknown>): ProviderReasoningOption[] {
    return [...GEMINI_REASONING_OPTIONS];
  },

  getDefaultReasoningValue(_model: string, _settings: Record<string, unknown>): string {
    return GEMINI_DEFAULT_THINKING_LEVEL;
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isGeminiModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeGeminiModelId(model);
    settingsBag.model = rawModelId ? encodeGeminiModelId(rawModelId) : GEMINI_SYNTHETIC_MODEL_ID;
    settingsBag.effortLevel = GEMINI_DEFAULT_THINKING_LEVEL;
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    (settings as Record<string, unknown>).effortLevel = value || GEMINI_DEFAULT_THINKING_LEVEL;
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getGeminiModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return GEMINI_SYNTHETIC_MODEL_ID;
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return GEMINI_PERMISSION_MODE_TOGGLE;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateGeminiProviderSettings(settingsBag, { selectedMode: value });
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getGeminiProviderSettings(settings).selectedMode || null;
  },

  getProviderIcon() {
    return GEMINI_PROVIDER_ICON;
  },
};
