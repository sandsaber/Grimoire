import type {
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import type {
  ProviderChatUIConfig,
} from '../../../providers/shared/providerHostContracts';
import { CLAUDE_PROVIDER_ICON } from '../../../shared/icons';
import { getCustomModelIds } from '../env/claudeModelEnv';
import { getClaudeModelOptions } from '../modelOptions';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '../settings';
import {
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_EFFORT_LEVEL,
  EFFORT_LEVELS,
  getAllowedEffortLevels,
  normalizeEffortLevel,
  resolveClaudeContextWindowSize,
} from '../types/models';

const CLAUDE_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'full_access',
  activeLabel: 'Auto-approve',
  planValue: 'plan',
  planLabel: 'Plan',
};

export const claudeChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings) {
    return getClaudeModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getClaudeModelOptions(settings).some((option: ProviderUIOption) => option.value === model)) {
      return true;
    }

    // Versioned Claude API / Bedrock ids may not appear in the current option
    // list (e.g. before discovery), but still belong to this provider.
    const normalized = model.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      DEFAULT_CLAUDE_MODELS.some((entry) => entry.value.toLowerCase() === normalized)
      || normalized.startsWith('claude-')
      || normalized.startsWith('anthropic.')
    );
  },

  isAdaptiveReasoningModel(_model: string, _settings: Record<string, unknown>): boolean {
    return true;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    const discoveredModel = getClaudeProviderSettings(settings).discoveredModels
      .find(candidate => candidate.id === model);
    const allowed = new Set(getAllowedEffortLevels(model, discoveredModel?.supportedEffortLevels));
    return EFFORT_LEVELS
      .filter(level => allowed.has(level.value))
      .map(level => ({ value: level.value, label: level.label }));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    return normalizeEffortLevel(
      model,
      DEFAULT_EFFORT_LEVEL[model] ?? 'high',
      getClaudeProviderSettings(settings).discoveredModels
        .find(candidate => candidate.id === model)?.supportedEffortLevels,
    );
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    settings?: Record<string, unknown>,
  ): number {
    return resolveClaudeContextWindowSize(
      model,
      customLimits,
      settings ? getClaudeProviderSettings(settings).discoveredModels : [],
    );
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_CLAUDE_MODELS.some(m => m.value === model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const target = settings as Record<string, unknown>;
    const isDiscoveredModel = getClaudeProviderSettings(target).discoveredModels
      .some(candidate => candidate.id === model);

    if (DEFAULT_CLAUDE_MODELS.some(m => m.value === model) || isDiscoveredModel) {
      target.effortLevel = this.getDefaultReasoningValue(model, target);
      updateClaudeProviderSettings(target, { lastModel: model });
    } else {
      target.lastCustomModel = model;
      target.effortLevel = normalizeEffortLevel(model, target.effortLevel);
    }
  },

  normalizeModelVariant(model: string, _settings) {
    return model;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    return getCustomModelIds(envVars);
  },

  getPermissionModeToggle() {
    return CLAUDE_PERMISSION_MODE_TOGGLE;
  },

  isBangBashEnabled(settings) {
    return getClaudeProviderSettings(settings).enableBangBash;
  },

  getProviderIcon() {
    return CLAUDE_PROVIDER_ICON;
  },
};

/** Re-export for type-only use in provider registration. */
export type { ProviderUIOption };
