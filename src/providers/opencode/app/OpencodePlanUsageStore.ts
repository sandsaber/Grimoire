import { type ProviderCostValue, ProviderSpendUsageStore } from '../../../providers/shared/ProviderSpendUsageStore';
import { getOpencodeProviderSettings } from '../settings';

const OPENCODE_USAGE_NOTE = 'Pay per token across vendors · no cap set.';

export class OpencodePlanUsageStore extends ProviderSpendUsageStore {
  private readonly sessionTotals = new Map<string, number>();

  constructor() {
    super({
      plan: 'API keys',
      note: OPENCODE_USAGE_NOTE,
      isAvailable: settings => getOpencodeProviderSettings(settings).enabled,
    });
  }

  recordSessionTotalCost(sessionId: string, cost: ProviderCostValue | null | undefined): boolean {
    const amount = cost?.amount;
    if (!sessionId || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }

    const currency = normalizeCurrency(cost?.currency);
    const key = `${sessionId}:${currency}`;
    const previous = this.sessionTotals.get(key) ?? 0;
    this.sessionTotals.set(key, amount);
    if (amount <= previous) {
      return false;
    }

    return this.recordCost({
      amount: amount - previous,
      currency,
    });
  }

  reset(): void {
    super.reset();
    this.sessionTotals.clear();
  }
}

export const opencodePlanUsageStore = new OpencodePlanUsageStore();

function normalizeCurrency(currency: string | null | undefined): string {
  const normalized = currency?.trim().toUpperCase();
  return normalized || 'USD';
}
