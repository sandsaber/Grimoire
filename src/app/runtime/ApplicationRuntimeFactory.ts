import type { WorkNodeDispatchFactory, WorkRecoveryPorts } from '../../core/work/WorkCoordinator';
import { builtInProviderCatalog } from '../../providers/BuiltInProviderCatalog';
import { ApplicationRuntime, type ApplicationRuntimeChatPort } from './ApplicationRuntime';
import type { ApplicationRuntimeComposition } from './ApplicationRuntimeComposition';
import { ApplicationRuntimeProjectionPort } from './ApplicationRuntimeProjectionPort';
import { createNativeAgentLifecycleBridge } from './NativeAgentLifecycleBridgeWiring';

export interface ApplicationRuntimeFactoryOptions {
  readonly composition: ApplicationRuntimeComposition;
  readonly workDispatchFactory?: WorkNodeDispatchFactory;
  readonly workRecoveryPorts?: WorkRecoveryPorts;
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

  // Wrap the chat coordinator to expose conversation creation and request
  // registration through the runtime's admission boundary.
  const chatPort: ApplicationRuntimeChatPort = {
    createConversation: async (input) => {
      const existing = await composition.conversations.read(input.conversationId);
      if (existing.kind !== 'absent') return;
      await composition.conversations.create({
        id: input.conversationId,
        providerId: input.providerId,
        title: input.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: null,
        messages: [],
      });
    },
    registerRequestRef: (kind, payload) =>
      composition.requests.register(kind, payload),
    loadConversation: (id) => composition.chat.loadConversation(id),
    attach: (id, listener) => composition.chat.attach(id, listener),
    submitTurn: (command) => composition.chat.submitTurn(command),
    cancelActive: (id) => composition.chat.cancelActive(id),
    resolveInteraction: (resolution) => composition.chat.resolveInteraction(resolution),
    waitForIdle: () => composition.chat.waitForIdle(),
    dispose: () => composition.chat.dispose(),
  };

  return new ApplicationRuntime({
    migration: composition.migration,
    backends: composition.lifecycleAdapter,
    lifecycle: composition.lifecycleAdapter,
    turnPreparation: {
      prepare: (providerId, input) => composition.turnPreparers.prepare(providerId, input),
    },
    interactionPresentations: {
      recover: () => composition.presentations.recover(),
      read: presentationRef => composition.composition.presentationStore.read(presentationRef),
    },
    settings: composition.settings.coordinator,
    chat: chatPort,
    shell: composition.shell,
    auxiliary: composition.auxiliary,
    agents: nativeAgents,
    work: {
      recoverDispatchBindings: port => composition.work.recoverDispatchBindings(port),
      recoverAll: (factory, ports) => composition.work.recoverAll(factory, ports),
    },
    ...(options.workDispatchFactory ? { workDispatchFactory: options.workDispatchFactory } : {}),
    ...(options.workRecoveryPorts ? { workRecoveryPorts: options.workRecoveryPorts } : {}),
    projections,
    workspaces: { dispose: async () => composition.settings.workspaceManager.dispose() },
    requests: { dispose: () => composition.requests.dispose() },
    nextShutdownCheckpointId: () => composition.identities.nextShutdownCheckpointId(),
  });
}
