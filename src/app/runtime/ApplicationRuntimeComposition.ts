import { AgentCoordinator } from '../../core/agents/AgentCoordinator';
import { executionBackendId } from '../../core/execution/ExecutionBackendDescriptor';
import { ConversationRepository } from '../../core/persistence/ConversationRepository';
import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type { Sha256DigestPort } from '../../core/providers/ProviderSettingsFingerprint';
import { WorkCoordinator } from '../../core/work/WorkCoordinator';
import { WorkGraphRepository } from '../../core/work/WorkGraphRepository';
import { AuxiliaryExecutionCoordinator } from '../../features/chat/application/AuxiliaryExecutionCoordinator';
import { LocalShellExecutionCoordinator } from '../../features/chat/application/LocalShellExecutionCoordinator';
import { LocalShellOutputProjectionStore } from '../../features/chat/application/LocalShellOutputProjectionStore';
import { ApplicationExecutionRequestBroker } from './ApplicationExecutionRequestBroker';
import type { ApplicationIdentityFactory } from './ApplicationIdentityFactory';
import { ApplicationRuntimeInfrastructure } from './ApplicationRuntimeInfrastructure';
import { ApplicationRuntimeMigration } from './ApplicationRuntimeMigration';
import { createChatExecutionCoordinator } from './ChatRuntimeWiring';
import { DurableExecutionResultStore } from './DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from './EphemeralExecutionRequestStore';
import { ExecutionInteractionPresentationRecovery } from './ExecutionInteractionPresentationRecovery';
import { ProviderApplicationContextComposition } from './ProviderApplicationContextComposition';
import { ProviderBackendGenerationStore } from './ProviderBackendGenerationStore';
import { ProviderBackendLifecycleAdapter } from './ProviderBackendLifecycleAdapter';
import { ProviderBackendStartup } from './ProviderBackendStartup';

export interface ApplicationRuntimeCompositionOptions {
  readonly storage: DurableStorage;
  readonly digest: Sha256DigestPort;
  readonly now?: () => number;
}

/**
 * The complete production composition of the application runtime: durable
 * infrastructure, provider context composition, backend startup, and all
 * coordinators (chat, shell, auxiliary, agents, work). This is the single
 * object `main.ts` will construct at the Phase 9 hard cutover.
 */
export class ApplicationRuntimeComposition {
  readonly infrastructure: ApplicationRuntimeInfrastructure;
  readonly composition: ProviderApplicationContextComposition;
  readonly generations: ProviderBackendGenerationStore;
  readonly startup: ProviderBackendStartup;
  readonly lifecycleAdapter: ProviderBackendLifecycleAdapter;
  readonly migration: ApplicationRuntimeMigration;
  readonly requests: ApplicationExecutionRequestBroker;
  readonly results: DurableExecutionResultStore;
  readonly presentations: ExecutionInteractionPresentationRecovery;
  readonly conversations: ConversationRepository;
  readonly agents: AgentCoordinator;
  readonly work: WorkCoordinator;
  readonly chat: ReturnType<typeof createChatExecutionCoordinator>;
  readonly shell: LocalShellExecutionCoordinator;
  readonly auxiliary: AuxiliaryExecutionCoordinator;
  readonly shellOutput: LocalShellOutputProjectionStore;

  constructor(options: ApplicationRuntimeCompositionOptions) {
    this.infrastructure = new ApplicationRuntimeInfrastructure({
      storage: options.storage,
      digest: options.digest,
      ...(options.now ? { now: options.now } : {}),
    });

    this.composition = new ProviderApplicationContextComposition({
      storage: options.storage,
      digest: options.digest,
    });

    this.generations = new ProviderBackendGenerationStore();

    this.startup = new ProviderBackendStartup({
      infrastructure: this.infrastructure,
      composition: this.composition,
      generations: this.generations,
    });

    this.lifecycleAdapter = new ProviderBackendLifecycleAdapter({
      startup: this.startup,
      lifecycle: this.infrastructure.lifecycle,
      nextShutdownCheckpointId: () => this.infrastructure.identities.nextShutdownCheckpointId(),
    });

    this.migration = new ApplicationRuntimeMigration();

    const ephemeralRequests = new EphemeralExecutionRequestStore();
    this.requests = new ApplicationExecutionRequestBroker(
      ephemeralRequests,
      this.infrastructure.identities,
    );
    this.results = new DurableExecutionResultStore(options.storage, options.digest);
    this.presentations = new ExecutionInteractionPresentationRecovery(
      this.infrastructure.lifecycle,
      this.composition.presentationStore,
    );
    this.conversations = new ConversationRepository(options.storage);
    this.agents = new AgentCoordinator(options.storage, {
      ...(options.now ? { now: options.now } : {}),
    });

    const workGraphs = new WorkGraphRepository(options.storage, options.now);
    this.work = new WorkCoordinator(
      workGraphs,
      this.agents,
      options.now ?? Date.now,
    );

    this.chat = createChatExecutionCoordinator({
      lifecycle: this.infrastructure.lifecycle,
      conversations: this.conversations,
      results: this.results,
      identities: this.infrastructure.identities,
      requests: this.requests,
      ...(options.now ? { now: options.now } : {}),
    });

    this.shellOutput = new LocalShellOutputProjectionStore();
    this.shell = new LocalShellExecutionCoordinator({
      backendId: executionBackendId('internal-local-shell'),
      lifecycle: this.infrastructure.lifecycle,
      requests: this.requests,
      output: this.shellOutput,
    });

    this.auxiliary = new AuxiliaryExecutionCoordinator(
      this.infrastructure.lifecycle,
      this.requests,
    );
  }

  get identities(): ApplicationIdentityFactory {
    return this.infrastructure.identities;
  }
}
