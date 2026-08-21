import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { ProviderSpendUsageStore } from '../../../core/providers/ProviderSpendUsageStore';
import type {
  ProviderPlanUsage,
  ProviderPlanUsageContext,
  ProviderPlanUsageWindow,
} from '../../../core/providers/types';
import { isRecord } from '../../../utils/records';
import { getClaudeProviderSettings } from '../settings';
import { loadClaudeStatusLineUsageSnapshot } from './ClaudeStatusLineUsageSnapshot';

type ClaudeRateLimitType = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';

export class ClaudePlanUsageStore extends ProviderSpendUsageStore {
  private windows = new Map<string, ProviderPlanUsageWindow>();

  constructor() {
    super({
      plan: 'Claude Code',
      note: 'SDK token cost reported for completed turns.',
      isAvailable: settings => getClaudeProviderSettings(settings).enabled,
    });
  }

  recordSdkMessage(message: SDKMessage | Record<string, unknown>): boolean {
    const rateLimitWindow = parseClaudeRateLimitWindow(message);
    if (rateLimitWindow) {
      const current = this.windows.get(rateLimitWindow.key);
      const changed = JSON.stringify(current) !== JSON.stringify(rateLimitWindow.window);
      this.windows.set(rateLimitWindow.key, rateLimitWindow.window);
      return changed;
    }

    if (!isRecord(message) || message.type !== 'result' || !isRecord(message.modelUsage)) {
      return false;
    }

    let changed = false;
    for (const usage of Object.values(message.modelUsage)) {
      if (!isRecord(usage)) {
        continue;
      }
      const costUSD = usage.costUSD;
      if (typeof costUSD === 'number' && Number.isFinite(costUSD) && costUSD > 0) {
        changed = this.recordCost({ amount: costUSD, currency: 'USD' }) || changed;
      }
    }
    return changed;
  }

  reset(): void {
    super.reset();
    this.windows.clear();
  }

  getCachedUsage(context: ProviderPlanUsageContext): ProviderPlanUsage | null {
    const spendUsage = super.getCachedUsage(context);
    if (this.windows.size > 0) {
      return {
        plan: 'Claude Code',
        ...(spendUsage?.spend ? { spend: spendUsage.spend } : {}),
        ...(spendUsage?.note ? { note: spendUsage.note } : {}),
        windows: [...this.windows.values()],
      };
    }

    return spendUsage;
  }

  async refreshUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
    const adapter = context.plugin.storage?.getAdapter?.();
    if (adapter) {
      const windows = await loadClaudeStatusLineUsageSnapshot(adapter);
      if (windows) {
        for (const { key, window } of windows) {
          this.windows.set(key, window);
        }
      }
    }

    return this.getCachedUsage(context);
  }
}

export const claudePlanUsageStore = new ClaudePlanUsageStore();

function parseClaudeRateLimitWindow(message: SDKMessage | Record<string, unknown>): { key: string; window: ProviderPlanUsageWindow } | null {
  if (!isRecord(message) || message.type !== 'rate_limit_event' || !isRecord(message.rate_limit_info)) {
    return null;
  }

  const info = message.rate_limit_info;
  const rateLimitType = readRateLimitType(info.rateLimitType);
  if (!rateLimitType) {
    return null;
  }

  const pct = readUtilizationPct(info);
  const reset = readReset(info, rateLimitType);
  const label = formatRateLimitLabel(rateLimitType);
  if (!reset || !label) {
    return null;
  }

  return {
    key: rateLimitType,
    window: {
      label,
      pct: pct ?? 0,
      ...(pct === null ? { pctKnown: false } : {}),
      reset,
    },
  };
}

function readRateLimitType(value: unknown): ClaudeRateLimitType | null {
  return value === 'five_hour'
    || value === 'seven_day'
    || value === 'seven_day_opus'
    || value === 'seven_day_sonnet'
    || value === 'overage'
    ? value
    : null;
}

function readUtilizationPct(info: Record<string, unknown>): number | null {
  const utilization = info.utilization;
  if (typeof utilization === 'number' && Number.isFinite(utilization)) {
    const pct = utilization > 0 && utilization <= 1 ? utilization * 100 : utilization;
    return clampPct(pct);
  }

  return info.status === 'rejected' ? 100 : null;
}

function readReset(info: Record<string, unknown>, rateLimitType: ClaudeRateLimitType): string | null {
  const value = rateLimitType === 'overage'
    ? info.overageResetsAt ?? info.resetsAt
    : info.resetsAt;
  return formatResetValue(value);
}

function formatRateLimitLabel(rateLimitType: ClaudeRateLimitType): string | null {
  if (rateLimitType === 'five_hour') {
    return '5-hr';
  }
  if (rateLimitType === 'seven_day') {
    return 'Weekly';
  }
  if (rateLimitType === 'seven_day_opus') {
    return 'Weekly Opus';
  }
  if (rateLimitType === 'seven_day_sonnet') {
    return 'Weekly Sonnet';
  }
  if (rateLimitType === 'overage') {
    return 'Overage';
  }
  return null;
}

function formatResetValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return formatResetDate(new Date(milliseconds));
  }

  return null;
}

function formatResetDate(date: Date): string {
  const now = new Date();
  if (
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  ) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}
