import * as fs from 'node:fs';

import type { ProviderCostValue } from '../../../providers/shared/ProviderSpendUsageStore';
import { readAcpSqliteRows } from '../../acp/history/AcpSqliteReader';
import { resolveExistingKimicodeDatabasePath } from '../runtime/KimicodePaths';
import type { KimicodeProviderState } from '../types';

type StoredCostRow = Record<string, unknown>;

export async function loadKimicodeSessionCost(
  sessionId: string,
  providerState?: KimicodeProviderState,
): Promise<ProviderCostValue | null> {
  const databasePath = resolveExistingKimicodeDatabasePath(providerState?.databasePath);
  if (!sessionId || !databasePath || databasePath === ':memory:' || !fs.existsSync(databasePath)) {
    return null;
  }

  const messageCost = sumKimicodeCostRows(await loadKimicodeCostRows(databasePath, sessionId, 'message'));
  if (messageCost) {
    return messageCost;
  }

  return sumKimicodeCostRows(await loadKimicodeCostRows(databasePath, sessionId, 'step'));
}

export function sumKimicodeCostRows(rows: StoredCostRow[] | null): ProviderCostValue | null {
  const amount = (rows ?? [])
    .map(row => readCostAmount(row.cost))
    .filter((cost): cost is number => cost !== null && cost > 0)
    .reduce((total, cost) => total + cost, 0);

  return amount > 0
    ? { amount, currency: 'USD' }
    : null;
}

async function loadKimicodeCostRows(
  databasePath: string,
  sessionId: string,
  source: 'message' | 'step',
): Promise<StoredCostRow[] | null> {
  const rows = await readAcpSqliteRows<StoredCostRow>(databasePath, [{
    params: [sessionId],
    sql: buildCostQuery(source, '?'),
  }]);
  return rows?.[0] ?? null;
}

function buildCostQuery(source: 'message' | 'step', sessionPlaceholder: string): string {
  if (source === 'message') {
    return [
      "select json_extract(data, '$.cost') as cost",
      'from message',
      `where session_id = ${sessionPlaceholder}`,
      "and json_extract(data, '$.role') = 'assistant'",
    ].join(' ');
  }

  return [
    "select json_extract(data, '$.cost') as cost",
    'from part',
    `where session_id = ${sessionPlaceholder}`,
    "and json_extract(data, '$.type') = 'step-finish'",
  ].join(' ');
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
