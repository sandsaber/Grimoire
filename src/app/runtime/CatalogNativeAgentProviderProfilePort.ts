import type { ExecutionBackendId } from '../../core/execution/ExecutionBackendDescriptor';
import type { ProviderCatalog } from '../../core/providers/ProviderCatalog';
import type {
  NativeAgentProviderProfile,
  NativeAgentProviderProfilePort,
} from './NativeAgentLifecycleBridge';

/**
 * Maps execution backend IDs to their provider agent observation profiles
 * through the validated provider catalog. The profile port never branches on
 * provider identity; it looks up the descriptor and capability from the module.
 */
export class CatalogNativeAgentProviderProfilePort implements NativeAgentProviderProfilePort {
  private readonly backendIndex: ReadonlyMap<string, NativeAgentProviderProfile>;

  constructor(catalog: ProviderCatalog) {
    const index = new Map<string, NativeAgentProviderProfile>();
    for (const module of catalog.list()) {
      const descriptor = module.execution.descriptor;
      const providerId = descriptor.association.kind === 'provider'
        ? descriptor.association.providerId
        : null;
      if (!providerId) continue;
      const capabilities = module.capabilities;
      if (capabilities.agents.observation === 'none') continue;
      index.set(descriptor.backendId, {
        providerId: providerId,
        observation: capabilities.agents.observation,
      });
    }
    this.backendIndex = index;
  }

  forBackend(backendId: ExecutionBackendId): NativeAgentProviderProfile | null {
    return this.backendIndex.get(backendId) ?? null;
  }
}
