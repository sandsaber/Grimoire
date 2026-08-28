import type {
  ProviderPlanUsage,
  ProviderPlanUsageContext,
  ProviderPlanUsageProvider,
} from './providerHostContracts';

export interface ProviderCostValue {
  amount: number;
  currency: string;
}

export interface ProviderSpendUsageStoreOptions {
  plan: string;
  note?: string;
  isAvailable?: (settings: Record<string, unknown>) => boolean;
  now?: () => Date;
}

export class ProviderSpendUsageStore implements ProviderPlanUsageProvider {
  private readonly costs = new Map<string, number>();

  constructor(private readonly options: ProviderSpendUsageStoreOptions) {}

  isAvailable(settings: Record<string, unknown>): boolean {
    return this.options.isAvailable?.(settings) ?? true;
  }

  recordCost(cost: ProviderCostValue | null | undefined): boolean {
    const amount = cost?.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }

    const currency = normalizeCurrency(cost?.currency);
    const key = `${this.getMonthKey()}:${currency}`;
    this.costs.set(key, (this.costs.get(key) ?? 0) + amount);
    return true;
  }

  reset(): void {
    this.costs.clear();
  }

  getCachedUsage(_context: ProviderPlanUsageContext): ProviderPlanUsage | null {
    const spend = this.formatCurrentMonthSpend();
    if (!spend) {
      return null;
    }

    return {
      plan: this.options.plan,
      spend,
      ...(this.options.note ? { note: this.options.note } : {}),
    };
  }

  async refreshUsage(context: ProviderPlanUsageContext): Promise<ProviderPlanUsage | null> {
    return this.getCachedUsage(context);
  }

  private formatCurrentMonthSpend(): string | null {
    const prefix = `${this.getMonthKey()}:`;
    const totals = [...this.costs.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, amount]) => ({
        amount,
        currency: key.slice(prefix.length),
      }))
      .filter(({ amount }) => amount > 0)
      .sort((a, b) => a.currency.localeCompare(b.currency));

    if (totals.length === 0) {
      return null;
    }

    return `${totals.map(formatCurrencyAmount).join(' + ')} this month`;
  }

  private getMonthKey(): string {
    const now = this.options.now?.() ?? new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}

function normalizeCurrency(currency: string | null | undefined): string {
  const normalized = currency?.trim().toUpperCase();
  return normalized || 'USD';
}

function formatCurrencyAmount(value: { amount: number; currency: string }): string {
  const amount = value.amount.toFixed(2);
  return value.currency === 'USD' ? `$${amount}` : `${value.currency} ${amount}`;
}
