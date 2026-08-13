import type { App } from 'obsidian';

import type { WorkNodeDispatchFactory, WorkRecoveryPorts } from '../../core/work/WorkCoordinator';
import { getVaultPath } from '../../utils/path';
import { SubtleCryptoSha256DigestPort } from '../security/SubtleCryptoSha256DigestPort';
import { ObsidianVaultTextFileAdapter } from '../storage/ObsidianVaultTextFileAdapter';
import { VaultDurableStorage } from '../storage/VaultDurableStorage';
import { ApplicationRuntimeComposition } from './ApplicationRuntimeComposition';
import type { ApplicationRuntimePluginLifecycle } from './ApplicationRuntimePluginLifecycle';
import { createApplicationRuntimePluginLifecycle } from './ApplicationRuntimePluginLifecycle';

export interface ObsidianApplicationRuntimeBootstrapOptions {
  readonly app: App;
  readonly workDispatchFactory: WorkNodeDispatchFactory;
  readonly workRecoveryPorts: WorkRecoveryPorts;
}

/**
 * The production entry point for constructing the ApplicationRuntime from
 * Obsidian vault primitives. main.ts calls this once during onload().
 */
export function createObsidianApplicationRuntime(
  options: ObsidianApplicationRuntimeBootstrapOptions,
): ApplicationRuntimePluginLifecycle {
  const vaultPath = getVaultPath(options.app);
  if (!vaultPath) throw new Error('Vault path is not available.');
  const adapter = new ObsidianVaultTextFileAdapter(options.app.vault, vaultPath);
  const storage = new VaultDurableStorage(adapter);
  const digest = new SubtleCryptoSha256DigestPort(crypto.subtle);

  const composition = new ApplicationRuntimeComposition({ storage, digest });
  return createApplicationRuntimePluginLifecycle({
    composition,
    workDispatchFactory: options.workDispatchFactory,
    workRecoveryPorts: options.workRecoveryPorts,
  });
}
