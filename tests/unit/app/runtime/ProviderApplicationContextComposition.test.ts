import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ProviderApplicationContextComposition } from '@/app/runtime/ProviderApplicationContextComposition';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ProviderApplicationContextComposition', () => {
  it('constructs the nine-provider application context registry from the catalog', () => {
    const composition = new ProviderApplicationContextComposition({
      storage: new TestDurableStorage(),
      digest,
    });

    expect(composition.primitives.requests).toBeDefined();
    expect(composition.primitives.results).toBeDefined();
    expect(composition.primitives.identities).toBeDefined();
    expect(composition.primitives.presentations).toBeDefined();

    // The registry validates one factory per catalog module at construction.
    // If it threw, we wouldn't reach this assertion.
    expect(composition.registry).toBeDefined();
    expect(builtInProviderCatalog.list()).toHaveLength(9);
  });

  it('resolves a backend context for every provider without launching a process', async () => {
    const composition = new ProviderApplicationContextComposition({
      storage: new TestDurableStorage(),
      digest,
    });

    for (const module of builtInProviderCatalog.list()) {
      const context = await composition.registry.resolve({
        providerId: module.manifest.id,
        generation: 1,
        module,
      });
      expect(context).toBeDefined();
    }
  });

  it('rejects an unknown provider module identity', async () => {
    const composition = new ProviderApplicationContextComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const realModule = builtInProviderCatalog.require('claude');
    await expect(composition.registry.resolve({
      providerId: 'codex',
      generation: 1,
      module: realModule,
    })).rejects.toThrow('identity');
  });
});
