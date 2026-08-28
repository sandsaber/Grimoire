import * as fs from 'node:fs/promises';

import type { ProviderCostValue } from '../../../providers/shared/ProviderSpendUsageStore';
import type { AcpUsageUpdate } from '../../acp/types';
import {
  resolveGrokSignalsPath,
  resolveGrokUpdatesPath,
} from '../runtime/GrokPaths';
import type { GrokProviderState } from '../types';

type StoredRow = Record<string, unknown>;

export async function loadGrokSessionCost(
  sessionId: string,
  providerState?: GrokProviderState,
): Promise<ProviderCostValue | null> {
  const updatesPath = resolveGrokUpdatesPath(
    sessionId,
    providerState?.workspacePath ?? null,
    providerState?.sessionDirPath ?? null,
  );
  if (!updatesPath) {
    return null;
  }

  try {
    const rawUpdates = await fs.readFile(updatesPath, 'utf8');
    return sumGrokCostRows(parseGrokUsageUpdateRows(rawUpdates));
  } catch {
    return null;
  }
}

export async function loadGrokSessionContextUsage(
  sessionId: string,
  providerState?: GrokProviderState,
): Promise<AcpUsageUpdate | null> {
  const signalsPath = resolveGrokSignalsPath(
    sessionId,
    providerState?.workspacePath ?? null,
    providerState?.sessionDirPath ?? null,
  );
  if (!signalsPath) {
    return null;
  }

  try {
    const rawSignals = await fs.readFile(signalsPath, 'utf8');
    const parsed = JSON.parse(rawSignals) as unknown;
    return parseGrokSignalsContextUsage(parsed);
  } catch {
    return null;
  }
}

export function sumGrokCostRows(
  rows: Array<Record<string, unknown>> | null,
): ProviderCostValue | null {
  const amount = (rows ?? [])
    .map((row) => readCostAmount(row.cost))
    .filter((cost): cost is number => cost !== null && cost > 0)
    .reduce((total, cost) => total + cost, 0);

  return amount > 0
    ? { amount, currency: 'USD' }
    : null;
}

export function parseGrokUsageUpdateRows(rawUpdates: string): StoredRow[] {
  const rows: StoredRow[] = [];

  for (const line of rawUpdates.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isPlainObject(parsed)) {
        continue;
      }

      const update = readNestedUpdate(parsed);
      if (!update || update.sessionUpdate !== 'usage_update') {
        continue;
      }

      const cost = readCostObject(update.cost);
      if (!cost) {
        continue;
      }

      rows.push({ cost: cost.amount });
    } catch {
      // Ignore malformed JSONL rows.
    }
  }

  return rows;
}

export function parseGrokSignalsContextUsage(value: unknown): AcpUsageUpdate | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const used = readNonNegativeNumber(value.contextTokensUsed);
  const size = readNonNegativeNumber(value.contextWindowTokens);
  if (used === null || size === null || size <= 0) {
    return null;
  }

  return { size, used };
}

function readNestedUpdate(value: StoredRow): StoredRow | null {
  const params = value.params;
  if (!isPlainObject(params)) {
    return null;
  }

  const update = params.update;
  return isPlainObject(update) ? update : null;
}

function readCostObject(value: unknown): ProviderCostValue | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const amount = readCostAmount(value.amount);
  if (amount === null || amount <= 0) {
    return null;
  }

  const currency = typeof value.currency === 'string' && value.currency.trim()
    ? value.currency.trim().toUpperCase()
    : 'USD';
  return { amount, currency };
}

function readCostAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

function isPlainObject(value: unknown): value is StoredRow {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}