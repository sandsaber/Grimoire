import type { ExecutionLifecycleRegistry } from '../../core/execution/ExecutionLifecycleRegistry';
import type { ApplicationRuntimeBackendPort } from './ApplicationRuntime';
import type { ApplicationRuntimeLifecyclePort } from './ApplicationRuntime';
import type { ProviderBackendStartup } from './ProviderBackendStartup';

export interface ProviderBackendLifecycleAdapterOptions {
  readonly startup: ProviderBackendStartup;
  readonly lifecycle: ExecutionLifecycleRegistry;
  readonly nextShutdownCheckpointId: () => string;
}

/**
 * Adapts the backend startup and lifecycle registry into the runtime's
 * backend and lifecycle ports. Backend preparation happens before lifecycle
 * start; lifecycle shutdown classifies all accepted runs before disposal.
 */
export class ProviderBackendLifecycleAdapter implements
  ApplicationRuntimeBackendPort,
  ApplicationRuntimeLifecyclePort {
  constructor(private readonly options: ProviderBackendLifecycleAdapterOptions) {}

  async initialize(): Promise<void> {
    await this.options.startup.initialize();
  }

  async dispose(): Promise<void> {
    await this.options.startup.dispose();
  }

  async start(): Promise<void> {
    await this.options.lifecycle.start();
  }

  async shutdown(checkpointId: string): Promise<void> {
    await this.options.lifecycle.shutdown(checkpointId);
  }
}
