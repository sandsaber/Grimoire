import type {
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import type {
  ProviderChatUIConfig,
} from '../../../providers/shared/providerHostContracts';
import { REASONIX_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeReasonixModelId,
  encodeReasonixModelId,
  isReasonixModelSelectionId,
  REASONIX_SYNTHETIC_MODEL_ID,
} from '../models';
import {
  getReasonixProviderSettings,
  REASONIX_AUTO_EFFORT,
  updateReasonixProviderSettings,
} from '../settings';

const REASONIX_MODELS: ProviderUIOption[] = [
  {
    description: 'Reasonix CLI ACP runtime',
    label: 'Reasonix',
    value: REASONIX_SYNTHETIC_MODEL_ID,
  },
];
/** Local model-window fallback; it does not imply known context occupancy. */
export const REASONIX_DEFAULT_CONTEXT_WINDOW = 200_000;
/**
 * The picker is built from the session, because the levels are the session's.
 *
 * Which levels a model takes is decided by the provider block that serves it:
 * one with `supported_efforts` offers `disabled`, `low`, `high`, `max`, one
 * without gets the built-in set for its kind. So there is no static list to
 * write here — `availableEfforts` is discovered the way the model catalogue is,
 * and `auto` heads it as the one value that always works, meaning "leave it to
 * Reasonix". Before a session has ever opened, `auto` is the whole list.
 */
const REASONIX_AUTO_REASONING_OPTION: ProviderReasoningOption = {
  label: 'Auto',
  value: REASONIX_AUTO_EFFORT,
};
const REASONIX_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};

function getReasonixModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const reasonixSettings = getReasonixProviderSettings(settings);
  const discoveredModels = new Map(reasonixSettings.discoveredModels.map((model) => [
    model.rawId,
    model,
  ]));
  const optionRawIds = reasonixSettings.discoveredModels.length > 0
    ? reasonixSettings.discoveredModels.map((model) => model.rawId)
    : reasonixSettings.visibleModels;

  const options: ProviderUIOption[] = [];
  for (const rawId of optionRawIds) {
    const discovered = discoveredModels.get(rawId);
    const label = reasonixSettings.modelAliases[rawId] ?? discovered?.label ?? rawId;
    options.push({
      description: discovered?.description ?? 'Reasonix CLI ACP model',
      label,
      value: encodeReasonixModelId(rawId),
    });
  }

  return options.length > 0 ? options : [...REASONIX_MODELS];
}

export const reasonixChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getReasonixModelOptions(settings);
  },

  ownsModel(model: string): boolean {
    return isReasonixModelSelectionId(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(_model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    const discovered = settings ? getReasonixProviderSettings(settings).availableEfforts : [];
    return [
      { ...REASONIX_AUTO_REASONING_OPTION },
      ...discovered.map((effort) => ({
        ...(effort.description ? { description: effort.description } : {}),
        label: effort.name,
        value: effort.id,
      })),
    ];
  },

  getDefaultReasoningValue(_model: string, settings: Record<string, unknown>): string {
    return getReasonixProviderSettings(settings).effortLevel;
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? REASONIX_DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isReasonixModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeReasonixModelId(model);
    settingsBag.model = rawModelId ? encodeReasonixModelId(rawModelId) : REASONIX_SYNTHETIC_MODEL_ID;
    settingsBag.effortLevel = getReasonixProviderSettings(settingsBag).effortLevel;
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    // A level the open session did not offer is refused by the agent, so the
    // selection falls back to `auto` rather than being stored and failing on
    // the next turn. The picker only shows what the session offered; this is
    // the guard for a value that arrives any other way.
    const level = value.trim();
    const offered = getReasonixProviderSettings(settingsBag).availableEfforts;
    const next = updateReasonixProviderSettings(settingsBag, {
      effortLevel: level && (level === REASONIX_AUTO_EFFORT
        || offered.some(effort => effort.id === level))
        ? level
        : REASONIX_AUTO_EFFORT,
    });
    settingsBag.effortLevel = next.effortLevel;
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getReasonixModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return REASONIX_SYNTHETIC_MODEL_ID;
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return REASONIX_PERMISSION_MODE_TOGGLE;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateReasonixProviderSettings(settingsBag, { selectedMode: value });
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getReasonixProviderSettings(settings).selectedMode || null;
  },

  getProviderIcon() {
    return REASONIX_PROVIDER_ICON;
  },
};
