import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

import type { ApplicationRuntimeInfrastructure } from './ApplicationRuntimeInfrastructure';
import type { ProviderApplicationContextComposition } from './ProviderApplicationContextComposition';
import type { ProviderBackendContextResolver } from './ProviderBackendBootstrap';
import { ProviderBackendBootstrap } from './ProviderBackendBootstrap';
import type { ProviderBackendGenerationStore } from './ProviderBackendGenerationStore';

export interface ProviderBackendStartupOptions {
  readonly infrastructure: ApplicationRuntimeInfrastructure;
  readonly composition: ProviderApplicationContextComposition;
  readonly generations: ProviderBackendGenerationStore;
}

/**
 * Wires the provider context composition to the lifecycle registry through the
 * backend bootstrap. The bootstrap prepares every backend from the composition
 * root and registers it with the lifecycle registry before startup recovery.
 */
export class ProviderBackendStartup {
  readonly bootstrap: ProviderBackendBootstrap;

  constructor(options: ProviderBackendStartupOptions) {
    const contextResolver: ProviderBackendContextResolver = {
      resolve: async input => options.composition.registry.resolve(input),
    };
    this.bootstrap = new ProviderBackendBootstrap(
      builtInProviderCatalog,
      contextResolver,
      options.generations,
      options.infrastructure.lifecycle,
    );
  }

  initialize(): Promise<void> {
    return this.bootstrap.initialize();
  }

  dispose(): Promise<void> {
    return this.bootstrap.dispose();
  }
}
