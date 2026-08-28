import '@/providers';

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';

describe('ProviderWorkspaceRegistry', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
  });

  it('holds a provider\'s services and gives them back', () => {
    // What is left of this registry is holding. The accessor this replaced —
    // `getRuntimeCommandLoader` — is deleted with its row: the loader is a
    // member of `ProviderRuntimeCommandsPort` now, reached through
    // `ApplicationRuntime.workspaceFor`.
    const services = { runtimeCommandLoader: { isAvailable: () => true } };

    ProviderWorkspaceRegistry.setServices('opencode', services as never);

    expect(ProviderWorkspaceRegistry.getServices('opencode')).toBe(services);
  });

});
