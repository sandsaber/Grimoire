import type { ProviderPlanUsageWindow } from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { isRecord } from '../../../utils/records';

export const CLAUDE_STATUSLINE_USAGE_SNAPSHOT_PATH = '.grimoire/claude/statusline-usage.json';

type ClaudeStatusLineRateLimitKey = 'five_hour' | 'seven_day';

export interface ClaudeStatusLineUsageWindow {
  key: ClaudeStatusLineRateLimitKey;
  window: ProviderPlanUsageWindow;
}

export async function loadClaudeStatusLineUsageSnapshot(
  adapter: Pick<VaultFileAdapter, 'exists' | 'read'>,
): Promise<ClaudeStatusLineUsageWindow[] | null> {
  try {
    if (!(await adapter.exists(CLAUDE_STATUSLINE_USAGE_SNAPSHOT_PATH))) {
      return null;
    }

    return parseClaudeStatusLineUsageSnapshot(
      JSON.parse(await adapter.read(CLAUDE_STATUSLINE_USAGE_SNAPSHOT_PATH)) as unknown,
    );
  } catch {
    return null;
  }
}

export function parseClaudeStatusLineUsageSnapshot(payload: unknown): ClaudeStatusLineUsageWindow[] | null {
  if (!isRecord(payload)) {
    return null;
  }

  const rateLimits = isRecord(payload.rate_limits)
    ? payload.rate_limits
    : isRecord(payload.rateLimits)
      ? payload.rateLimits
      : payload;
  if (!isRecord(rateLimits)) {
    return null;
  }

  const windows = [
    parseStatusLineWindow('five_hour', rateLimits.five_hour),
    parseStatusLineWindow('seven_day', rateLimits.seven_day),
  ].filter((window): window is ClaudeStatusLineUsageWindow => window !== null);

  return windows.length > 0 ? windows : null;
}

function parseStatusLineWindow(
  key: ClaudeStatusLineRateLimitKey,
  value: unknown,
): ClaudeStatusLineUsageWindow | null {
  if (!isRecord(value)) {
    return null;
  }

  const pct = readPct(value.used_percentage ?? value.usedPercentage);
  const reset = formatResetValue(value.resets_at ?? value.resetsAt);
  if (pct === null || !reset) {
    return null;
  }

  return {
    key,
    window: {
      label: key === 'five_hour' ? '5-hr' : 'Weekly',
      pct,
      reset,
    },
  };
}

function readPct(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim())
      : Number.NaN;
  return Number.isFinite(numeric) ? clampPct(numeric) : null;
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

