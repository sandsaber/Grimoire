import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { ANTIGRAVITY_PROVIDER_ICON } from '../../../shared/icons';
import { resolveAntigravityModelChoices } from '../AntigravityModelSelection';
import {
  ANTIGRAVITY_DEFAULT_REASONING_LEVEL,
  ANTIGRAVITY_SYNTHETIC_MODEL_ID,
  decodeAntigravityModelId,
  encodeAntigravityModelId,
  isAntigravityModelSelectionId,
} from '../models';
import { getAntigravityProviderSettings } from '../settings';

const ANTIGRAVITY_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: ANTIGRAVITY_DEFAULT_REASONING_LEVEL, label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const ANTIGRAVITY_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Blocked',
  inactiveDescription: 'Safe approvals are unavailable for agy --print; Windows uses best-effort CLI fallbacks',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  activeDescription: 'Antigravity may edit files without Grimoire prompts',
};

function getAntigravityModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const antigravitySettings = getAntigravityProviderSettings(settings);
  return resolveAntigravityModelChoices(antigravitySettings).map(choice => ({
    description: choice.description,
    label: choice.label,
    value: choice.selectionId,
  }));
}

export const antigravityChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getAntigravityModelOptions(settings);
  },

  ownsModel(model: string): boolean {
    return isAntigravityModelSelectionId(model);
  },

  isAdaptiveReasoningModel(_model: string, _settings: Record<string, unknown>): boolean {
    return true;
  },

  getReasoningOptions(_model: string, _settings: Record<string, unknown>): ProviderReasoningOption[] {
    return [...ANTIGRAVITY_REASONING_OPTIONS];
  },

  getDefaultReasoningValue(_model: string, _settings: Record<string, unknown>): string {
    return ANTIGRAVITY_DEFAULT_REASONING_LEVEL;
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isAntigravityModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeAntigravityModelId(model);
    settingsBag.model = rawModelId ? encodeAntigravityModelId(rawModelId) : ANTIGRAVITY_SYNTHETIC_MODEL_ID;
    settingsBag.effortLevel = ANTIGRAVITY_DEFAULT_REASONING_LEVEL;
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    (settings as Record<string, unknown>).effortLevel = value || ANTIGRAVITY_DEFAULT_REASONING_LEVEL;
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getAntigravityModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return ANTIGRAVITY_SYNTHETIC_MODEL_ID;
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return ANTIGRAVITY_PERMISSION_MODE_TOGGLE;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    (settings as Record<string, unknown>).permissionMode = value;
  },

  getProviderIcon() {
    return ANTIGRAVITY_PROVIDER_ICON;
  },
};
