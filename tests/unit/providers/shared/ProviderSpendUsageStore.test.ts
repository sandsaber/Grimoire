import { ProviderSpendUsageStore } from '@/providers/shared/ProviderSpendUsageStore';

describe('ProviderSpendUsageStore', () => {
  it('formats accumulated USD spend as provider plan usage', () => {
    const store = new ProviderSpendUsageStore({
      note: 'Pay per token across vendors · no cap set.',
      plan: 'API keys',
    });

    store.recordCost({ amount: 1.25, currency: 'USD' });
    store.recordCost({ amount: 0.75, currency: 'USD' });

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'opencode',
      settings: {},
    })).toEqual({
      plan: 'API keys',
      spend: '$2.00 this month',
      note: 'Pay per token across vendors · no cap set.',
    });
  });

  it('keeps non-USD currency labels explicit', () => {
    const store = new ProviderSpendUsageStore({ plan: 'API keys' });

    store.recordCost({ amount: 4.2, currency: 'EUR' });

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'opencode',
      settings: {},
    })).toEqual({
      plan: 'API keys',
      spend: 'EUR 4.20 this month',
    });
  });

  it('returns null until cost has been reported', () => {
    const store = new ProviderSpendUsageStore({ plan: 'API keys' });

    expect(store.getCachedUsage({
      plugin: {} as any,
      providerId: 'opencode',
      settings: {},
    })).toBeNull();
  });
});
