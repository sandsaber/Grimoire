import type { ProviderModule } from '../../core/providers/ProviderModule';
import type { ProviderId } from '../../core/types/provider';

type ApplicationProviderModule = ProviderModule<object>;

export interface ProviderApplicationContextFactory {
  readonly providerId: ProviderId;
  createBackendContext(input: {
    readonly generation: number;
    readonly module: ApplicationProviderModule;
  }): Promise<unknown>;
  createWorkspaceContext(input: {
    readonly generation: number;
    readonly module: ApplicationProviderModule;
  }): Promise<unknown>;
}

export interface ProviderApplicationContextCatalog {
  list(): readonly ApplicationProviderModule[];
  require(providerId: ProviderId): ApplicationProviderModule;
}

/**
 * Exact application composition for provider-owned backend and workspace
 * contexts. Concrete providers remain behind their catalog module and factory;
 * application startup never branches on provider identity.
 */
export class ProviderApplicationContextRegistry {
  private readonly factories: ReadonlyMap<ProviderId, ProviderApplicationContextFactory>;

  constructor(
    private readonly catalog: ProviderApplicationContextCatalog,
    factories: readonly ProviderApplicationContextFactory[],
  ) {
    this.factories = validateFactories(catalog, factories);
  }

  async resolve(input: {
    readonly providerId: ProviderId;
    readonly generation: number;
    readonly module: ApplicationProviderModule;
  }): Promise<unknown> {
    validateResolution(this.catalog, input);
    return this.requireFactory(input.providerId).createBackendContext({
      generation: input.generation,
      module: input.module,
    });
  }

  async resolveWorkspace(providerId: ProviderId, generation: number): Promise<unknown> {
    const module = this.catalog.require(providerId);
    validateGeneration(providerId, generation);
    return this.requireFactory(providerId).createWorkspaceContext({ generation, module });
  }

  private requireFactory(providerId: ProviderId): ProviderApplicationContextFactory {
    const factory = this.factories.get(providerId);
    if (!factory) {
      throw new Error(`Provider "${providerId}" has no application context factory.`);
    }
    return factory;
  }
}

function validateFactories(
  catalog: ProviderApplicationContextCatalog,
  factories: readonly ProviderApplicationContextFactory[],
): ReadonlyMap<ProviderId, ProviderApplicationContextFactory> {
  const modules = catalog.list();
  const moduleIds = new Set(modules.map(module => module.manifest.id));
  const byId = new Map<ProviderId, ProviderApplicationContextFactory>();
  for (const factory of factories) {
    if (!moduleIds.has(factory.providerId)) {
      throw new Error(
        `Provider application context factory "${factory.providerId}" is not in the catalog.`,
      );
    }
    if (byId.has(factory.providerId)) {
      throw new Error(
        `Provider "${factory.providerId}" has duplicate application context factories.`,
      );
    }
    requireFactoryMethod(factory, 'createBackendContext');
    requireFactoryMethod(factory, 'createWorkspaceContext');
    byId.set(factory.providerId, factory);
  }
  const missing = modules
    .map(module => module.manifest.id)
    .filter(providerId => !byId.has(providerId));
  if (missing.length > 0) {
    throw new Error(`Provider application contexts are incomplete: ${missing.join(', ')}.`);
  }
  return byId;
}

function validateResolution(
  catalog: ProviderApplicationContextCatalog,
  input: {
    readonly providerId: ProviderId;
    readonly generation: number;
    readonly module: ApplicationProviderModule;
  },
): void {
  validateGeneration(input.providerId, input.generation);
  const expected = catalog.require(input.providerId);
  if (input.module !== expected) {
    throw new Error(`Provider "${input.providerId}" application module identity conflicts.`);
  }
}

function validateGeneration(providerId: ProviderId, generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error(`Provider "${providerId}" application generation is invalid.`);
  }
}

function requireFactoryMethod(
  factory: ProviderApplicationContextFactory,
  method: 'createBackendContext' | 'createWorkspaceContext',
): void {
  if (typeof factory[method] !== 'function') {
    throw new Error(`Provider "${factory.providerId}" context factory has no ${method}.`);
  }
}
