import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeInfrastructure } from '@/app/runtime/ApplicationRuntimeInfrastructure';
import { ProviderApplicationContextComposition } from '@/app/runtime/ProviderApplicationContextComposition';
import { ProviderBackendGenerationStore } from '@/app/runtime/ProviderBackendGenerationStore';
import { ProviderBackendLifecycleAdapter } from '@/app/runtime/ProviderBackendLifecycleAdapter';
import { ProviderBackendStartup } from '@/app/runtime/ProviderBackendStartup';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ProviderBackendLifecycleAdapter', () => {
  it('initializes backends, starts the lifecycle registry, and shuts down in order', async () => {
    const storage = new TestDurableStorage();
    const infrastructure = new ApplicationRuntimeInfrastructure({ storage, digest });
    const composition = new ProviderApplicationContextComposition({ storage, digest });
    const generations = new ProviderBackendGenerationStore();
    const startup = new ProviderBackendStartup({ infrastructure, composition, generations });
    const adapter = new ProviderBackendLifecycleAdapter({
      startup,
      lifecycle: infrastructure.lifecycle,
      nextShutdownCheckpointId: () => `sd-${'1'.repeat(32)}`,
    });

    await adapter.initialize();
    await adapter.start();

    // The lifecycle registry should now be accepting.
    for (const module of builtInProviderCatalog.list()) {
      const backend = startup.bootstrap.getBackend(module.manifest.id);
      expect(backend).toBeDefined();
    }

    await adapter.shutdown(`sd-${'2'.repeat(32)}`);
    await adapter.dispose();
  });
});
