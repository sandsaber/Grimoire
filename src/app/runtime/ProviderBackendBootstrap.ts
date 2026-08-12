import type {
  ExecutionBackend,
  ExecutionRecoveryPort,
  InteractionPort,
} from '../../core/execution/ExecutionContracts';
import type {
  BackendLifecycleRegistration,
} from '../../core/execution/ExecutionLifecycleRegistry';
import type { ProviderModule } from '../../core/providers/ProviderModule';
import type { ProviderId } from '../../core/types/provider';

type BootstrapProviderModule = ProviderModule<object>;

export interface ProviderBackendCatalogPort {
  list(): readonly BootstrapProviderModule[];
}

export interface ProviderBackendContextResolver {
  resolve(input: {
    readonly providerId: ProviderId;
    readonly generation: number;
    readonly module: BootstrapProviderModule;
  }): Promise<unknown>;
}

export interface ProviderBackendGenerationPort {
  getGeneration(providerId: ProviderId): number;
}

export interface ProviderBackendRegistrationPort {
  registerBackends(registrations: readonly BackendLifecycleRegistration[]): void;
}

interface PreparedBackend {
  readonly module: BootstrapProviderModule;
  readonly backend: ExecutionBackend;
  readonly generation: number;
}

/**
 * Constructs provider backends without starting provider processes. Registration
 * happens only after every module is prepared, so recovery never sees a partial catalog.
 */
export class ProviderBackendBootstrap {
  private prepared: readonly PreparedBackend[] = [];
  private initializeTask?: Promise<void>;
  private disposeTask?: Promise<void>;
  private initialized = false;
  private disposed = false;

  constructor(
    private readonly catalog: ProviderBackendCatalogPort,
    private readonly contexts: ProviderBackendContextResolver,
    private readonly generations: ProviderBackendGenerationPort,
    private readonly lifecycle: ProviderBackendRegistrationPort,
  ) {}

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initializeTask) return this.initializeTask;
    if (this.disposed) {
      return Promise.reject(new Error('Provider backend bootstrap is disposed.'));
    }
    const task = this.initializeUnlocked().finally(() => {
      if (!this.initialized) this.initializeTask = undefined;
    });
    this.initializeTask = task;
    return task;
  }

  dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask;
    const task = this.disposeUnlocked().catch(error => {
      if (this.disposeTask === task) this.disposeTask = undefined;
      throw error;
    });
    this.disposeTask = task;
    return task;
  }

  getBackend(providerId: ProviderId): ExecutionBackend | null {
    return this.prepared.find(entry => entry.module.manifest.id === providerId)?.backend ?? null;
  }

  private async initializeUnlocked(): Promise<void> {
    const prepared: PreparedBackend[] = [];
    try {
      for (const module of this.catalog.list()) {
        const generation = requireGeneration(
          this.generations.getGeneration(module.manifest.id),
          module.manifest.id,
        );
        const context = await this.contexts.resolve({
          providerId: module.manifest.id,
          generation,
          module,
        });
        const backend = requireExecutionBackend(
          await module.execution.create(context),
          module,
        );
        prepared.push({ module, backend, generation });
      }
      this.lifecycle.registerBackends(prepared.map(entry => ({
          backend: entry.backend,
          initialGeneration: entry.generation,
          ...(isExecutionRecoveryPort(entry.backend) ? { recovery: entry.backend } : {}),
          ...(isInteractionPort(entry.backend) ? { interactions: entry.backend } : {}),
        })));
      this.prepared = Object.freeze([...prepared]);
      this.initialized = true;
    } catch (error) {
      this.prepared = Object.freeze([...prepared]);
      try {
        await disposeBackends(prepared.map(entry => entry.backend));
        this.prepared = [];
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Provider backend preparation and cleanup failed.',
        );
      }
      throw error;
    }
  }

  private async disposeUnlocked(): Promise<void> {
    this.disposed = true;
    if (this.initializeTask) await this.initializeTask.catch(() => undefined);
    await disposeBackends(this.prepared.map(entry => entry.backend));
    this.prepared = [];
  }
}

function requireExecutionBackend(
  value: unknown,
  module: BootstrapProviderModule,
): ExecutionBackend {
  if (!value || typeof value !== 'object') {
    throw new Error(`Provider "${module.manifest.id}" did not create an execution backend.`);
  }
  const backend = value as Partial<ExecutionBackend>;
  if (backend.descriptor?.backendId !== module.execution.descriptor.backendId
    || typeof backend.createSession !== 'function'
    || typeof backend.dispose !== 'function') {
    throw new Error(`Provider "${module.manifest.id}" created an invalid execution backend.`);
  }
  return backend as ExecutionBackend;
}

function isExecutionRecoveryPort(backend: ExecutionBackend): backend is ExecutionBackend & ExecutionRecoveryPort {
  return typeof (backend as Partial<ExecutionRecoveryPort>).reconcile === 'function';
}

function isInteractionPort(backend: ExecutionBackend): backend is ExecutionBackend & InteractionPort {
  const candidate = backend as Partial<InteractionPort>;
  return typeof candidate.resolve === 'function' && typeof candidate.cancel === 'function';
}

function requireGeneration(value: number, providerId: ProviderId): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Provider "${providerId}" has an invalid backend generation.`);
  }
  return value;
}

async function disposeBackends(backends: readonly ExecutionBackend[]): Promise<void> {
  const results = await Promise.allSettled([...backends].reverse().map(backend => backend.dispose()));
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;
}
