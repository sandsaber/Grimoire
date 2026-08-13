import type { WorkNodeDispatchFactory, WorkRecoveryPorts } from '../../core/work/WorkCoordinator';
import { ApplicationRuntime, type ApplicationRuntimeOptions } from './ApplicationRuntime';
import type { ApplicationRuntimeComposition } from './ApplicationRuntimeComposition';

export interface ApplicationRuntimeFactoryOptions {
  readonly composition: ApplicationRuntimeComposition;
  readonly agents: ApplicationRuntimeOptions['agents'];
  readonly projections: ApplicationRuntimeOptions['projections'];
  readonly workDispatchFactory: WorkNodeDispatchFactory;
  readonly workRecoveryPorts: WorkRecoveryPorts;
}

/**
 * Constructs the ApplicationRuntime from the complete production composition.
 * The runtime is the sole admission boundary; views own presentation only.
 *
 * The `agents` and `projections` ports require additional wiring
 * (NativeAgentLifecycleBridge, projection coordinator) that depends on
 * the composition's lifecycle, agent coordinator, and result store. Those
 * adapters are constructed by the caller and passed here so the factory
 * remains a pure mapping from composition to runtime options.
 */
export function createApplicationRuntime(
  options: ApplicationRuntimeFactoryOptions,
): ApplicationRuntime {
  const composition = options.composition;
  return new ApplicationRuntime({
    migration: composition.migration,
    backends: composition.lifecycleAdapter,
    lifecycle: composition.lifecycleAdapter,
    interactionPresentations: composition.presentations,
    settings: composition.settings.coordinator,
    chat: composition.chat,
    shell: composition.shell,
    auxiliary: composition.auxiliary,
    agents: options.agents,
    work: {
      recoverDispatchBindings: port => composition.work.recoverDispatchBindings(port),
      recoverAll: (factory, ports) => composition.work.recoverAll(factory, ports),
    },
    workDispatchFactory: options.workDispatchFactory,
    workRecoveryPorts: options.workRecoveryPorts,
    projections: options.projections,
    workspaces: { dispose: async () => composition.settings.workspaceManager.dispose() },
    requests: { dispose: () => composition.requests.dispose() },
    nextShutdownCheckpointId: () => composition.identities.nextShutdownCheckpointId(),
  });
}
