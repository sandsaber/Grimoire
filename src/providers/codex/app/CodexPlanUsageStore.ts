import type {
  ProviderPlanUsageWindow,
} from '../../../core/providers/types';
import type {
  ProviderPlanUsage,
  ProviderPlanUsageContext,
  ProviderPlanUsageProvider,
} from '../../../providers/shared/providerHostContracts';
import { isRecord } from '../../../utils/records';
import { getCodexProviderSettings } from '../settings';

interface ParsedWindow {
  label: string;
  pct: number;
  reset: string;
}

const DEFAULT_CODEX_PLAN = 'ChatGPT Pro';
type RateLimitsReader = () => Promise<unknown>;

export class CodexPlanUsageStore implements ProviderPlanUsageProvider {
  private usage: ProviderPlanUsage | null = null;
  private rateLimitsReader: RateLimitsReader | null = null;

  isAvailable(settings: Record<string, unknown>): boolean {
    return getCodexProviderSettings(settings).enabled;
  }

  updateFromRateLimits(payload: unknown): boolean {
    const usage = parseCodexRateLimits(payload);
    if (!usage) {
      return false;
    }

    const changed = !hasSameCodexUsage(this.usage, usage);
    this.usage = {
      ...usage,
      updatedAt: Date.now(),
    };
    return changed;
  }

  getCachedUsage(_context: ProviderPlanUsageContext): ProviderPlanUsage | null {
    return this.usage;
  }

  async refreshUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
    if (!this.rateLimitsReader) {
      context.plugin.recordDebugLog?.({
        data: {
          providerId: context.providerId,
          reason: 'missing_rate_limits_reader',
        },
        event: 'reader.missing',
        level: 'debug',
        scope: 'codex.usage',
      });
      return this.getCachedUsage(context);
    }

    try {
      const changed = this.updateFromRateLimits(await this.rateLimitsReader());
      const usage = this.getCachedUsage(context);
      context.plugin.recordDebugLog?.({
        data: {
          changed,
          providerId: context.providerId,
          ...summarizeCodexUsage(usage),
        },
        event: usage ? 'rateLimits.parsed' : 'rateLimits.empty',
        level: usage ? 'info' : 'debug',
        scope: 'codex.usage',
      });
    } catch (error) {
      context.plugin.recordDebugLog?.({
        data: {
          providerId: context.providerId,
        },
        error,
        event: 'rateLimits.failed',
        level: 'warn',
        scope: 'codex.usage',
      });
      // Keep the last good value; a failed refresh should not blank the meter.
    }
    return this.getCachedUsage(context);
  }

  setRateLimitsReader(reader: RateLimitsReader | null): void {
    this.rateLimitsReader = reader;
  }

  /**
   * Drops a reader that has outlived its connection.
   *
   * Identity-checked rather than unconditional: this store is process-wide and
   * the reader is rebound per connection, so a composition tearing down must
   * not clear a reader some later connection has already installed.
   */
  clearRateLimitsReader(reader: RateLimitsReader): void {
    if (this.rateLimitsReader === reader) {
      this.rateLimitsReader = null;
    }
  }

  reset(): void {
    this.usage = null;
    this.rateLimitsReader = null;
  }
}

export const codexPlanUsageStore = new CodexPlanUsageStore();

function hasSameCodexUsage(current: ProviderPlanUsage | null, next: ProviderPlanUsage): boolean {
  return current?.plan === next.plan
    && JSON.stringify(current.windows) === JSON.stringify(next.windows);
}

function summarizeCodexUsage(usage: ProviderPlanUsage | null): Record<string, unknown> {
  if (!usage) {
    return { usageKind: 'none' };
  }

  return {
    hasSpend: typeof usage.spend === 'string' && usage.spend.trim().length > 0,
    plan: usage.plan,
    usageKind: usage.windows?.length && usage.spend ? 'hybrid' : usage.windows?.length ? 'quota' : 'spend',
    ...(usage.windows?.length ? {
      windowCount: usage.windows.length,
      windows: usage.windows.map(window => ({
        label: window.label,
        pct: window.pct,
        ...(window.pctKnown === false ? { pctKnown: false } : {}),
        reset: window.reset,
      })),
    } : {}),
  };
}

function parseCodexRateLimits(payload: unknown): ProviderPlanUsage | null {
  const root = isRecord(payload) ? payload : {};
  const source = root.rateLimits ?? root.limits ?? payload;
  const windows = extractWindowCandidates(source)
    .map(parseWindowCandidate)
    .filter((window): window is ParsedWindow => Boolean(window))
    .map(normalizeParsedWindow);

  if (windows.length === 0) {
    return null;
  }

  return {
    plan: readString(root, ['plan', 'planName', 'tier', 'accountPlan']) ?? DEFAULT_CODEX_PLAN,
    windows,
  };
}

function extractWindowCandidates(source: unknown): Array<{ key?: string; value: unknown }> {
  if (Array.isArray(source)) {
    return (source as unknown[]).map(value => ({ value }));
  }

  if (!isRecord(source)) {
    return [];
  }

  if (hasWindowMetric(source)) {
    return [{ value: source }];
  }

  return Object.entries(source)
    .map(([key, value]) => ({ key, value }))
    .filter(candidate => isRecord(candidate.value) && hasWindowMetric(candidate.value));
}

function parseWindowCandidate(candidate: { key?: string; value: unknown }): ParsedWindow | null {
  if (!isRecord(candidate.value)) {
    return null;
  }

  const windowDurationMins = readNumber(candidate.value, ['windowDurationMins', 'windowDurationMinutes', 'durationMins']);
  const label = normalizeWindowLabel(
    readString(candidate.value, ['label', 'window', 'name', 'type'])
      ?? candidate.key
      ?? '',
    windowDurationMins,
  );
  if (!label) {
    return null;
  }

  const pct = readPct(candidate.value);
  const reset = readReset(candidate.value);
  if (pct === null || !reset) {
    return null;
  }

  return { label, pct, reset };
}

function normalizeParsedWindow(window: ParsedWindow): ProviderPlanUsageWindow {
  return {
    label: window.label,
    pct: clampPct(window.pct),
    reset: window.reset,
  };
}

function hasWindowMetric(value: Record<string, unknown>): boolean {
  return readNumber(value, ['pct', 'percent', 'usedPercent', 'usagePercent', 'consumedPct']) !== null
    || (
      readNumber(value, ['limit', 'total', 'size', 'quota']) !== null
      && (
        readNumber(value, ['remaining', 'remainingRequests', 'remainingTokens']) !== null
        || readNumber(value, ['used', 'consumed', 'current']) !== null
      )
    );
}

function readPct(record: Record<string, unknown>): number | null {
  const explicitPct = readNumber(record, ['pct', 'percent', 'usedPercent', 'usagePercent', 'consumedPct']);
  if (explicitPct !== null) {
    return explicitPct <= 1 && explicitPct > 0 ? explicitPct * 100 : explicitPct;
  }

  const limit = readNumber(record, ['limit', 'total', 'size', 'quota']);
  if (limit === null || limit <= 0) {
    return null;
  }

  const used = readNumber(record, ['used', 'consumed', 'current']);
  if (used !== null) {
    return (used / limit) * 100;
  }

  const remaining = readNumber(record, ['remaining', 'remainingRequests', 'remainingTokens']);
  if (remaining !== null) {
    return (1 - remaining / limit) * 100;
  }

  return null;
}

function readReset(record: Record<string, unknown>): string | null {
  const value = readValue(record, ['reset', 'resets', 'resetAt', 'resetsAt', 'resetTime', 'resetLabel', 'resetAfter']);
  if (value === null) {
    return null;
  }
  return formatResetValue(value);
}

function normalizeWindowLabel(value: string, windowDurationMins?: number | null): string | null {
  if (typeof windowDurationMins === 'number' && Number.isFinite(windowDurationMins)) {
    if (windowDurationMins === 300) {
      return '5-hr';
    }
    if (windowDurationMins === 10080) {
      return 'Weekly';
    }
    if (windowDurationMins === 1440) {
      return 'Daily';
    }
  }

  const label = value.trim();
  if (!label) {
    return null;
  }
  const normalized = label.toLowerCase().replace(/[_-]+/g, ' ');
  if (/weekly|week/.test(normalized)) {
    return 'Weekly';
  }
  if (/daily|day/.test(normalized)) {
    return 'Daily';
  }
  if (/five\s*hour|5\s*h|5\s*hour/.test(normalized)) {
    return '5-hr';
  }
  return label;
}

function formatResetValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsedDate = Date.parse(trimmed);
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) && Number.isFinite(parsedDate)) {
      return formatResetDate(new Date(parsedDate));
    }
    return trimmed;
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

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  const value = readValue(record, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  const value = readValue(record, keys);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return null;
}

