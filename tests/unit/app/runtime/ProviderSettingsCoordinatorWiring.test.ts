import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeInfrastructure } from '@/app/runtime/ApplicationRuntimeInfrastructure';
import { ProviderApplicationContextComposition } from '@/app/runtime/ProviderApplicationContextComposition';
import { ProviderBackendGenerationStore } from '@/app/runtime/ProviderBackendGenerationStore';
import { createProviderSettingsCoordinator } from '@/app/runtime/ProviderSettingsCoordinatorWiring';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('createProviderSettingsCoordinator', () => {
  it('constructs the settings control plane, workspace manager, and transaction coordinator', () => {
    const storage = new TestDurableStorage();
    const infrastructure = new ApplicationRuntimeInfrastructure({ storage, digest });
    const composition = new ProviderApplicationContextComposition({ storage, digest });
    const generations = new ProviderBackendGenerationStore();

    const wiring = createProviderSettingsCoordinator({
      storage,
      digest,
      catalog: builtInProviderCatalog,
      lifecycle: infrastructure.lifecycle,
      generations,
      workspaceRegistry: composition.registry,
    });

    expect(wiring.controlPlane).toBeDefined();
    expect(wiring.settingsStore).toBeDefined();
    expect(wiring.workspaceManager).toBeDefined();
    expect(wiring.coordinator).toBeDefined();
    expect(typeof wiring.coordinator.recoverPending).toBe('function');
    expect(typeof wiring.coordinator.apply).toBe('function');
  });
});
