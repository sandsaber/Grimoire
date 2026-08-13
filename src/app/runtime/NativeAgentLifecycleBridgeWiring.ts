import type { ProviderCatalog } from '../../core/providers/ProviderCatalog';
import type { ApplicationRuntimeComposition } from './ApplicationRuntimeComposition';
import { CatalogNativeAgentProviderProfilePort } from './CatalogNativeAgentProviderProfilePort';
import { CatalogNativeAgentRootPolicyPort } from './CatalogNativeAgentRootPolicyPort';
import { NativeAgentLifecycleBridge } from './NativeAgentLifecycleBridge';

/**
 * Constructs the NativeAgentLifecycleBridge from the production composition.
 * The bridge materializes durable execution agent evidence into durable agent
 * instances, attempts, results, and work-node state.
 */
export function createNativeAgentLifecycleBridge(
  composition: ApplicationRuntimeComposition,
  catalog: ProviderCatalog,
): NativeAgentLifecycleBridge {
  return new NativeAgentLifecycleBridge({
    lifecycle: composition.infrastructure.lifecycle,
    agents: composition.agents,
    results: { materialize: resultRef => composition.results.materialize(resultRef) },
    providers: new CatalogNativeAgentProviderProfilePort(catalog),
    work: { synchronizeAgentRun: run => composition.work.synchronizeAgentRun(run) },
    rootPolicy: new CatalogNativeAgentRootPolicyPort(catalog),
  });
}
