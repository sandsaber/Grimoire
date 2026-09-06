import type {
  ProviderPlanUsage,
  ProviderPlanUsageContext,
} from '../../../providers/shared/providerHostContracts';
import { type ProviderCostValue, ProviderSpendUsageStore } from '../../../providers/shared/ProviderSpendUsageStore';
import { getGrokProviderSettings } from '../settings';
import {
  fetchGrokCreditsUsage,
  parseGrokBillingResponse,
} from './GrokBillingFetcher';

const GROK_API_USAGE_NOTE = 'Pay per token across vendors · no cap set.';
type GrokBillingReader = () => Promise<unknown>;

export class GrokPlanUsageStore extends ProviderSpendUsageStore {
  private readonly billingReaders = new Map<object, GrokBillingReader>();
  private readonly sessionTotals = new Map<string, number>();
  private creditsUsage: ProviderPlanUsage | null = null;

  constructor() {
    super({
      plan: 'API keys',
      note: GROK_API_USAGE_NOTE,
      isAvailable: settings => getGrokProviderSettings(settings).enabled,
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
    this.billingReaders.clear();
    this.sessionTotals.clear();
    this.creditsUsage = null;
  }

  getCachedUsage(_context: ProviderPlanUsageContext): ProviderPlanUsage | null {
    return mergeGrokPlanUsage(this.creditsUsage, super.getCachedUsage(_context));
  }

  async refreshUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
    let refreshedUsage: ReturnType<typeof parseGrokBillingResponse> = null;
    const billingReader = [...this.billingReaders.values()].at(-1);
    if (billingReader) {
      try {
        refreshedUsage = parseGrokBillingResponse(await billingReader());
      } catch {
        // Fall through to the auth-backed endpoint and then the last good snapshot.
      }
    }

    try {
      const creditsUsage = refreshedUsage ?? await fetchGrokCreditsUsage(process.env);
      if (creditsUsage) {
        const nextCreditsUsage: ProviderPlanUsage = {
          plan: creditsUsage.plan,
          windows: creditsUsage.windows,
          ...(creditsUsage.note ? { note: creditsUsage.note } : {}),
        };
        const changed = JSON.stringify(this.creditsUsage) !== JSON.stringify(nextCreditsUsage);
        this.creditsUsage = nextCreditsUsage;
        if (changed) {
          return this.getCachedUsage(context);
        }
      }
    } catch {
      // Keep the last good credits snapshot when refresh fails.
    }

    return this.getCachedUsage(context);
  }

  setBillingReader(reader: GrokBillingReader | null, owner: object): void {
    this.billingReaders.delete(owner);
    if (reader) {
      this.billingReaders.set(owner, reader);
    }
  }

  setCreditsUsageForTests(usage: ProviderPlanUsage | null): void {
    this.creditsUsage = usage;
  }
}

export const grokPlanUsageStore = new GrokPlanUsageStore();

function mergeGrokPlanUsage(
  creditsUsage: ProviderPlanUsage | null,
  spendUsage: ProviderPlanUsage | null,
): ProviderPlanUsage | null {
  if (!creditsUsage && !spendUsage) {
    return null;
  }

  const windows = [
    ...(creditsUsage?.windows ?? []),
    ...(spendUsage?.windows ?? []),
  ];

  return {
    plan: creditsUsage?.plan ?? spendUsage?.plan ?? 'Grok Build',
    ...(windows.length > 0 ? { windows } : {}),
    ...(spendUsage?.spend ? { spend: spendUsage.spend } : {}),
    ...(creditsUsage?.note ?? spendUsage?.note
      ? { note: [creditsUsage?.note, spendUsage?.note].filter(Boolean).join(' · ') }
      : {}),
  };
}

function normalizeCurrency(currency: string | null | undefined): string {
  const normalized = currency?.trim().toUpperCase();
  return normalized || 'USD';
}
