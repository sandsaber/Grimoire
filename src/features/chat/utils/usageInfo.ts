import type { ProviderChatUiContribution, ProviderScopedSettings } from '../../../core/providers/ProviderModule';
import type { UsageInfo } from '../../../core/types';

export function resolveContextUsage(
  usage: UsageInfo | null,
  chatUI: ProviderChatUiContribution,
  model: string,
  settings: ProviderScopedSettings,
): UsageInfo | null {
  if (!usage) return null;
  const normalized = chatUI.normalizeContextUsage ? chatUI.normalizeContextUsage(usage) : usage;
  return normalized ? recalculateUsageForModel(
    normalized, model,
    chatUI.models.contextWindow(model, settings, settings.customContextLimits as Record<string, number> | undefined),
  ) : null;
}

export function calculateUsagePercentage(contextTokens: number, contextWindow: number): number {
  return contextWindow > 0
    ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
    : 0;
}

export function recalculateUsageForModel(
  usage: UsageInfo,
  model: string,
  fallbackContextWindow: number,
): UsageInfo {
  const preserveAuthoritativeWindow = usage.contextWindowIsAuthoritative === true
    && usage.contextWindow > 0
    && usage.model === model;
  const contextWindow = preserveAuthoritativeWindow ? usage.contextWindow : fallbackContextWindow;

  return {
    ...usage,
    model,
    contextWindow,
    contextWindowIsAuthoritative: preserveAuthoritativeWindow,
    percentage: calculateUsagePercentage(usage.contextTokens, contextWindow),
  };
}
