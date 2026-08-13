import type { ExecutionLifecycleRegistry } from '../../core/execution/ExecutionLifecycleRegistry';
import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type { ProviderCatalog } from '../../core/providers/ProviderCatalog';
import { ProviderControlPlane } from '../../core/providers/ProviderControlPlane';
import type { Sha256DigestPort } from '../../core/providers/ProviderSettingsFingerprint';
import {
  type ProviderSettingsLifecyclePort,
  ProviderSettingsTransactionCoordinator,
  type ProviderWorkspaceSettingsPort,
} from '../../core/providers/ProviderSettingsTransactionCoordinator';
import { ProviderWorkspaceManager } from '../../core/providers/ProviderWorkspaceManager';
import { DurableStagedProviderSettingsStore } from '../settings/StagedProviderSettingsStore';
import type { ProviderApplicationContextRegistry } from './ProviderApplicationContextRegistry';
import type { ProviderBackendGenerationStore } from './ProviderBackendGenerationStore';

export interface ProviderSettingsCoordinatorWiringOptions {
  readonly storage: DurableStorage;
  readonly digest: Sha256DigestPort;
  readonly catalog: ProviderCatalog;
  readonly lifecycle: ExecutionLifecycleRegistry;
  readonly generations: ProviderBackendGenerationStore;
  readonly workspaceRegistry: ProviderApplicationContextRegistry;
  readonly settlementTimeoutMs?: number;
  readonly initializationTimeoutMs?: number;
}

export interface ProviderSettingsCoordinatorWiring {
  readonly controlPlane: ProviderControlPlane;
  readonly settingsStore: DurableStagedProviderSettingsStore;
  readonly workspaceManager: ProviderWorkspaceManager;
  readonly coordinator: ProviderSettingsTransactionCoordinator;
}

/**
 * Production composition of the Phase 8 provider settings control plane,
 * workspace manager, and settings transaction coordinator.
 */
export function createProviderSettingsCoordinator(
  options: ProviderSettingsCoordinatorWiringOptions,
): ProviderSettingsCoordinatorWiring {
  const controlPlane = new ProviderControlPlane(options.catalog, options.digest);
  const settingsStore = new DurableStagedProviderSettingsStore(options.storage);

  const workspaceContextResolver = {
    resolve: async (providerId: never, generation: number) =>
      options.workspaceRegistry.resolveWorkspace(providerId, generation),
  };
  const workspaceManager = new ProviderWorkspaceManager(
    options.catalog,
    workspaceContextResolver,
    options.generations,
    {
      settlementTimeoutMs: options.settlementTimeoutMs ?? 10_000,
      scheduler: {
        setTimeout: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle: unknown) => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    },
  );

  const lifecyclePort: ProviderSettingsLifecyclePort = options.lifecycle;
  const workspacePort: ProviderWorkspaceSettingsPort = workspaceManager;

  const coordinator = new ProviderSettingsTransactionCoordinator(
    options.storage,
    options.catalog,
    controlPlane,
    settingsStore,
    lifecyclePort,
    workspacePort,
  );

  return { controlPlane, settingsStore, workspaceManager, coordinator };
}
