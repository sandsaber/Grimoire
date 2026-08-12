import {
  clearTimeout as clearNodeTimeout,
  setTimeout as setNodeTimeout,
} from 'node:timers';

import { ExecutionControlRepositories } from '../../core/execution/ExecutionControlRepositories';
import {
  ExecutionControlTransactionCoordinator,
  type ExecutionControlTransactionCoordinatorOptions,
} from '../../core/execution/ExecutionControlTransactionCoordinator';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '../../core/execution/ExecutionLifecycleRegistry';
import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type { Sha256DigestPort } from '../../core/providers/ProviderSettingsFingerprint';
import { ApplicationIdentityFactory } from './ApplicationIdentityFactory';

export interface ApplicationRuntimeInfrastructureOptions {
  readonly storage: DurableStorage;
  readonly digest: Sha256DigestPort;
  readonly now?: () => number;
  readonly scheduler?: ExecutionLifecycleScheduler;
  readonly transactionOptions?: ExecutionControlTransactionCoordinatorOptions;
  readonly maxReorderDistance?: number;
  readonly recoveryTimeoutMs?: number;
  readonly shutdownGracePeriodMs?: number;
}

/**
 * Core execution infrastructure shared by the application runtime: durable
 * control repositories, the control transaction coordinator, and the
 * execution lifecycle registry. Provider backends, coordinators, and
 * projections attach to this foundation.
 */
export class ApplicationRuntimeInfrastructure {
  readonly identities: ApplicationIdentityFactory;
  readonly repositories: ExecutionControlRepositories;
  readonly transactions: ExecutionControlTransactionCoordinator;
  readonly lifecycle: ExecutionLifecycleRegistry;
  readonly scheduler: ExecutionLifecycleScheduler;

  constructor(options: ApplicationRuntimeInfrastructureOptions) {
    this.identities = new ApplicationIdentityFactory();
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback: () => void, delayMs: number) => setNodeTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>),
    };
    this.repositories = new ExecutionControlRepositories(options.storage, options.now);
    this.transactions = new ExecutionControlTransactionCoordinator(
      options.storage,
      this.repositories,
      {
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...options.transactionOptions,
      },
    );
    this.lifecycle = new ExecutionLifecycleRegistry({
      repositories: this.repositories,
      controlTransactions: this.transactions,
      nextTransactionId: () => this.identities.nextTransactionId(),
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.maxReorderDistance !== undefined
        ? { maxReorderDistance: options.maxReorderDistance }
        : {}),
      ...(options.recoveryTimeoutMs !== undefined
        ? { recoveryTimeoutMs: options.recoveryTimeoutMs }
        : {}),
      ...(options.shutdownGracePeriodMs !== undefined
        ? { shutdownGracePeriodMs: options.shutdownGracePeriodMs }
        : {}),
      scheduler: this.scheduler,
    });
  }
}
