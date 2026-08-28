import type {
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import type {
  ProviderChatUIConfig,
} from '../../../providers/shared/providerHostContracts';
import { QWEN_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeQwenModelId,
  encodeQwenModelId,
  isQwenModelSelectionId,
  QWEN_SYNTHETIC_MODEL_ID,
} from '../models';
import {
  getQwenProviderSettings,
  normalizeQwenEffortLevel,
  QWEN_EFFORT_LEVELS,
  updateQwenProviderSettings,
} from '../settings';

const QWEN_MODELS: ProviderUIOption[] = [
  {
    description: 'Qwen CLI ACP runtime',
    label: 'Qwen',
    value: QWEN_SYNTHETIC_MODEL_ID,
  },
];
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const QWEN_REASONING_OPTIONS: ProviderReasoningOption[] = QWEN_EFFORT_LEVELS.map((value) => ({
  label: value === 'xhigh' ? 'XHigh' : value[0].toUpperCase() + value.slice(1),
  value,
}));
const QWEN_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};
const QWEN_TOKEN_PLAN_PREFIX = /^\[Token Plan[^\]]*\]\s*/i;

function getQwenButtonLabel(label: string): string | null {
  const compactLabel = label.replace(QWEN_TOKEN_PLAN_PREFIX, '').trim();
  return compactLabel && compactLabel !== label.trim() ? compactLabel : null;
}

function getQwenModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const qwenSettings = getQwenProviderSettings(settings);
  const discoveredModels = new Map(qwenSettings.discoveredModels.map((model) => [
    model.rawId,
    model,
  ]));
  const optionRawIds = qwenSettings.discoveredModels.length > 0
    ? qwenSettings.discoveredModels.map((model) => model.rawId)
    : qwenSettings.visibleModels;

  const options: ProviderUIOption[] = [];
  for (const rawId of optionRawIds) {
    const discovered = discoveredModels.get(rawId);
    const label = qwenSettings.modelAliases[rawId] ?? discovered?.label ?? rawId;
    const buttonLabel = getQwenButtonLabel(label);
    options.push({
      ...(buttonLabel ? { buttonLabel } : {}),
      description: discovered?.description ?? 'Qwen CLI ACP model',
      label,
      value: encodeQwenModelId(rawId),
    });
  }

  return options.length > 0 ? options : [...QWEN_MODELS];
}

export const qwenChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getQwenModelOptions(settings);
  },

  ownsModel(model: string): boolean {
    return isQwenModelSelectionId(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return true;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return QWEN_REASONING_OPTIONS.map((option) => ({ ...option }));
  },

  getDefaultReasoningValue(_model: string, settings: Record<string, unknown>): string {
    return getQwenProviderSettings(settings).effortLevel;
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isQwenModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeQwenModelId(model);
    settingsBag.model = rawModelId ? encodeQwenModelId(rawModelId) : QWEN_SYNTHETIC_MODEL_ID;
    settingsBag.effortLevel = getQwenProviderSettings(settingsBag).effortLevel;
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const next = updateQwenProviderSettings(settingsBag, {
      effortLevel: normalizeQwenEffortLevel(value),
    });
    settingsBag.effortLevel = next.effortLevel;
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getQwenModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return QWEN_SYNTHETIC_MODEL_ID;
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return QWEN_PERMISSION_MODE_TOGGLE;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateQwenProviderSettings(settingsBag, { selectedMode: value });
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getQwenProviderSettings(settings).selectedMode || null;
  },

  getProviderIcon() {
    return QWEN_PROVIDER_ICON;
  },
};
