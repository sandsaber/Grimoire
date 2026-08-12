import type { InteractionResolution } from '../../core/execution/ExecutionContracts';
import type {
  WorkNodeDispatchFactory,
  WorkRecoveryPorts,
} from '../../core/work/WorkCoordinator';
import type { WorkGraphExecution } from '../../core/work/WorkGraph';
import type {
  ChatTurnTicket,
  SubmitChatTurnCommand,
} from '../../features/chat/application/ChatExecutionCoordinator';
import type {
  ChatProjection,
} from '../../features/chat/projections/ChatProjection';

export type ApplicationRuntimeState =
  | 'constructed'
  | 'starting'
  | 'accepting'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface ApplicationRuntimeMigrationPort {
  migrate(): Promise<void>;
}

export interface ApplicationRuntimeLifecyclePort {
  start(): Promise<void>;
  shutdown(checkpointId: string): Promise<void>;
}

export interface ApplicationRuntimeBackendPort {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ApplicationRuntimeSettingsPort {
  recoverPending(): Promise<unknown>;
}

export interface ApplicationRuntimeInteractionPresentationPort {
  recover(): Promise<unknown>;
}

export interface ApplicationRuntimeRecoverableCoordinator {
  recover(): Promise<void>;
  waitForIdle(): Promise<void>;
  dispose(): void;
}

export interface ApplicationRuntimeAgentPort {
  recover(): Promise<void>;
  waitForIdle(): Promise<void>;
  dispose(): void;
}

export interface ApplicationRuntimeChatPort {
  loadConversation(conversationId: string): Promise<ChatProjection>;
  attach(
    conversationId: string,
    listener: (projection: ChatProjection) => void,
  ): Promise<() => void>;
  submitTurn(command: SubmitChatTurnCommand): Promise<ChatTurnTicket>;
  cancelActive(conversationId: string): Promise<void>;
  resolveInteraction(resolution: InteractionResolution): Promise<void>;
  waitForIdle(): Promise<void>;
  dispose(): void;
}

export interface ApplicationRuntimeWorkPort {
  recoverDispatchBindings(
    port: WorkRecoveryPorts['dispatchRecovery'],
  ): Promise<unknown>;
  recoverAll(
    factory: WorkNodeDispatchFactory,
    ports: WorkRecoveryPorts,
  ): Promise<readonly WorkGraphExecution[]>;
}

export interface ApplicationRuntimeProjectionPort {
  dispose(): void;
}

export interface ApplicationRuntimeWorkspacePort {
  dispose(): Promise<void>;
}

export interface ApplicationRuntimeRequestPort {
  dispose(): void;
}

export interface ApplicationRuntimeOptions {
  readonly migration: ApplicationRuntimeMigrationPort;
  readonly backends: ApplicationRuntimeBackendPort;
  readonly lifecycle: ApplicationRuntimeLifecyclePort;
  readonly interactionPresentations: ApplicationRuntimeInteractionPresentationPort;
  readonly settings: ApplicationRuntimeSettingsPort;
  readonly chat: ApplicationRuntimeChatPort;
  readonly shell: ApplicationRuntimeRecoverableCoordinator;
  readonly auxiliary: ApplicationRuntimeRecoverableCoordinator;
  readonly agents: ApplicationRuntimeAgentPort;
  readonly work: ApplicationRuntimeWorkPort;
  readonly workDispatchFactory: WorkNodeDispatchFactory;
  readonly workRecoveryPorts: WorkRecoveryPorts;
  readonly projections: ApplicationRuntimeProjectionPort;
  readonly workspaces: ApplicationRuntimeWorkspacePort;
  readonly requests: ApplicationRuntimeRequestPort;
  readonly nextShutdownCheckpointId: () => string;
}

/**
 * The single application lifecycle and command admission boundary. Views own
 * presentation only and cannot reach the underlying coordinators directly.
 */
export class ApplicationRuntime {
  private stateValue: ApplicationRuntimeState = 'constructed';
  private startTask?: Promise<void>;
  private stopTask?: Promise<void>;
  private cleanupTask?: Promise<void>;
  private lifecycleStarted = false;
  private lifecycleStopped = false;

  constructor(private readonly options: ApplicationRuntimeOptions) {}

  get state(): ApplicationRuntimeState {
    return this.stateValue;
  }

  start(): Promise<void> {
    if (this.stateValue === 'accepting') return Promise.resolve();
    if (this.startTask) return this.startTask;
    if (this.stateValue !== 'constructed') {
      return Promise.reject(new Error('Application runtime cannot be started in its current state.'));
    }
    this.stateValue = 'starting';
    const task = this.startUnlocked();
    this.startTask = task;
    return task;
  }

  loadConversation(conversationId: string): Promise<ChatProjection> {
    this.requireAccepting();
    return this.options.chat.loadConversation(conversationId);
  }

  attachConversation(
    conversationId: string,
    listener: (projection: ChatProjection) => void,
  ): Promise<() => void> {
    this.requireAccepting();
    return this.options.chat.attach(conversationId, listener);
  }

  submitChatTurn(command: SubmitChatTurnCommand): Promise<ChatTurnTicket> {
    this.requireAccepting();
    return this.options.chat.submitTurn(command);
  }

  cancelChatTurn(conversationId: string): Promise<void> {
    this.requireAccepting();
    return this.options.chat.cancelActive(conversationId);
  }

  resolveInteraction(resolution: InteractionResolution): Promise<void> {
    this.requireAccepting();
    return this.options.chat.resolveInteraction(resolution);
  }

  shutdown(): Promise<void> {
    if (this.stateValue === 'stopped') return Promise.resolve();
    if (this.stopTask) return this.stopTask;
    this.stateValue = 'stopping';
    const task = this.shutdownUnlocked().finally(() => {
      if (this.stateValue !== 'stopped') this.stopTask = undefined;
    });
    this.stopTask = task;
    return task;
  }

  private async startUnlocked(): Promise<void> {
    try {
      await this.options.migration.migrate();
      await this.options.backends.initialize();
      await this.options.lifecycle.start();
      this.lifecycleStarted = true;
      await this.options.interactionPresentations.recover();
      await this.options.settings.recoverPending();
      await this.options.shell.recover();
      await this.options.auxiliary.recover();
      await this.options.agents.recover();
      await this.options.work.recoverDispatchBindings(
        this.options.workRecoveryPorts.dispatchRecovery,
      );
      await this.options.agents.recover();
      await this.options.work.recoverAll(
        this.options.workDispatchFactory,
        this.options.workRecoveryPorts,
      );
      if (this.stateValue === 'stopping') return;
      if (this.stateValue !== 'starting') {
        throw new Error('Application runtime startup admission was superseded.');
      }
      this.stateValue = 'accepting';
    } catch (error) {
      this.stateValue = 'failed';
      try {
        await this.cleanupResources();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Application runtime startup and cleanup failed.',
        );
      }
      throw error;
    }
  }

  private async shutdownUnlocked(): Promise<void> {
    if (this.startTask) {
      await this.startTask.catch(() => undefined);
    }
    try {
      await this.cleanupResources();
      this.stateValue = 'stopped';
    } catch (error) {
      this.stateValue = 'failed';
      throw error;
    }
  }

  private cleanupResources(): Promise<void> {
    if (this.cleanupTask) return this.cleanupTask;
    const task = this.cleanupResourcesUnlocked().catch(error => {
      if (this.cleanupTask === task) this.cleanupTask = undefined;
      throw error;
    });
    this.cleanupTask = task;
    return task;
  }

  private async cleanupResourcesUnlocked(): Promise<void> {
    const failures: unknown[] = [];
    const attempt = async (operation: () => void | Promise<void>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    if (this.lifecycleStarted && !this.lifecycleStopped) {
      await attempt(async () => {
        await this.options.lifecycle.shutdown(this.options.nextShutdownCheckpointId());
        this.lifecycleStopped = true;
      });
    }

    // Coordinators stay subscribed until lifecycle shutdown has classified all
    // accepted work and chat persistence has observed terminal projections.
    await attempt(() => this.options.agents.waitForIdle());
    await attempt(() => this.options.chat.waitForIdle());
    await Promise.all([
      attempt(() => this.options.shell.waitForIdle()),
      attempt(() => this.options.auxiliary.waitForIdle()),
    ]);
    await attempt(() => this.options.chat.dispose());
    await attempt(() => this.options.shell.dispose());
    await attempt(() => this.options.auxiliary.dispose());
    await attempt(() => this.options.agents.dispose());
    await attempt(() => this.options.projections.dispose());
    await attempt(() => this.options.requests.dispose());
    await attempt(() => this.options.backends.dispose());
    await attempt(() => this.options.workspaces.dispose());
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Application runtime cleanup failed.');
    }
  }

  private requireAccepting(): void {
    if (this.stateValue !== 'accepting') {
      throw new ApplicationRuntimeAdmissionError(this.stateValue);
    }
  }
}

export class ApplicationRuntimeAdmissionError extends Error {
  constructor(readonly runtimeState: ApplicationRuntimeState) {
    super(`Application runtime is not accepting commands (${runtimeState}).`);
    this.name = 'ApplicationRuntimeAdmissionError';
  }
}
