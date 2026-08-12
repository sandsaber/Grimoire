import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeInfrastructure } from '@/app/runtime/ApplicationRuntimeInfrastructure';
import { ProviderApplicationContextComposition } from '@/app/runtime/ProviderApplicationContextComposition';
import { ProviderBackendGenerationStore } from '@/app/runtime/ProviderBackendGenerationStore';
import { ProviderBackendStartup } from '@/app/runtime/ProviderBackendStartup';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ProviderBackendStartup', () => {
  it('prepares and registers all nine provider backends without launching processes', async () => {
    const storage = new TestDurableStorage();
    const infrastructure = new ApplicationRuntimeInfrastructure({ storage, digest });
    const composition = new ProviderApplicationContextComposition({ storage, digest });
    const generations = new ProviderBackendGenerationStore();
    const startup = new ProviderBackendStartup({ infrastructure, composition, generations });

    await startup.initialize();

    for (const module of builtInProviderCatalog.list()) {
      const backend = startup.bootstrap.getBackend(module.manifest.id);
      expect(backend).toBeDefined();
      expect(backend?.descriptor.association).toMatchObject({
        kind: 'provider',
        providerId: module.manifest.id,
      });
    }
  });

  it('disposes all prepared backends', async () => {
    const storage = new TestDurableStorage();
    const infrastructure = new ApplicationRuntimeInfrastructure({ storage, digest });
    const composition = new ProviderApplicationContextComposition({ storage, digest });
    const generations = new ProviderBackendGenerationStore();
    const startup = new ProviderBackendStartup({ infrastructure, composition, generations });

    await startup.initialize();
    await expect(startup.dispose()).resolves.toBeUndefined();
  });
});
