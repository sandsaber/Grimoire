import { ProviderBackendGenerationStore } from '@/app/runtime/ProviderBackendGenerationStore';

describe('ProviderBackendGenerationStore', () => {
  it('defaults every provider to generation 1', () => {
    const store = new ProviderBackendGenerationStore();
    expect(store.getGeneration('claude')).toBe(1);
    expect(store.getGeneration('codex')).toBe(1);
  });

  it('sets and advances generations per provider independently', () => {
    const store = new ProviderBackendGenerationStore();
    store.setGeneration('claude', 3);
    expect(store.getGeneration('claude')).toBe(3);
    expect(store.advanceGeneration('claude')).toBe(4);
    expect(store.getGeneration('codex')).toBe(1);
  });

  it('rejects invalid generations', () => {
    const store = new ProviderBackendGenerationStore();
    expect(() => store.setGeneration('claude', 0)).toThrow('positive');
    expect(() => store.setGeneration('claude', -1)).toThrow('positive');
    expect(() => store.setGeneration('claude', 1.5)).toThrow('positive');
  });
});
