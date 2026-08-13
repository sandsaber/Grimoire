import type { WorkNodeDispatchFactory, WorkRecoveryPorts } from '../../core/work/WorkCoordinator';
import { builtInProviderCatalog } from '../../providers/BuiltInProviderCatalog';
import { ApplicationRuntime } from './ApplicationRuntime';
import type { ApplicationRuntimeComposition } from './ApplicationRuntimeComposition';
import { ApplicationRuntimeProjectionPort } from './ApplicationRuntimeProjectionPort';
import { createNativeAgentLifecycleBridge } from './NativeAgentLifecycleBridgeWiring';

export interface ApplicationRuntimeFactoryOptions {
  readonly composition: ApplicationRuntimeComposition;
  readonly workDispatchFactory: WorkNodeDispatchFactory;
  readonly workRecoveryPorts: WorkRecoveryPorts;
}

/**
 * Constructs the ApplicationRuntime from the complete production composition.
 * The runtime is the sole admission boundary; views own presentation only.
 *
 * The native agent lifecycle bridge and projection port are constructed
 * internally from the composition. The work dispatch factory and recovery
 * ports are injected by the caller because they depend on provider-specific
 * dispatch semantics.
 */
export function createApplicationRuntime(
  options: ApplicationRuntimeFactoryOptions,
): ApplicationRuntime {
  const composition = options.composition;
  const nativeAgents = createNativeAgentLifecycleBridge(composition, builtInProviderCatalog);
  const projections = new ApplicationRuntimeProjectionPort([
    () => nativeAgents.dispose(),
  ]);
  return new ApplicationRuntime({
    migration: composition.migration,
    backends: composition.lifecycleAdapter,
    lifecycle: composition.lifecycleAdapter,
    interactionPresentations: composition.presentations,
    settings: composition.settings.coordinator,
    chat: composition.chat,
    shell: composition.shell,
    auxiliary: composition.auxiliary,
    agents: nativeAgents,
    work: {
      recoverDispatchBindings: port => composition.work.recoverDispatchBindings(port),
      recoverAll: (factory, ports) => composition.work.recoverAll(factory, ports),
    },
    workDispatchFactory: options.workDispatchFactory,
    workRecoveryPorts: options.workRecoveryPorts,
    projections,
    workspaces: { dispose: async () => composition.settings.workspaceManager.dispose() },
    requests: { dispose: () => composition.requests.dispose() },
    nextShutdownCheckpointId: () => composition.identities.nextShutdownCheckpointId(),
  });
}
