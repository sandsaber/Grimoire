import type { App } from 'obsidian';

import { ClaudeSdkExecutionQueryFactory } from '../../providers/claude/execution/ClaudeSdkExecutionAdapter';
import { getVaultPath } from '../../utils/path';
import { ClaudeStartupOptionsResolverAdapter } from '../execution/claude/ClaudeStartupOptionsResolverAdapter';
import { createNodeProcessLauncherComposition } from '../execution/NodeProcessLauncherComposition';
import { SubtleCryptoSha256DigestPort } from '../security/SubtleCryptoSha256DigestPort';
import { ObsidianVaultTextFileAdapter } from '../storage/ObsidianVaultTextFileAdapter';
import { VaultDurableStorage } from '../storage/VaultDurableStorage';
import { ApplicationExecutionRequestBroker } from './ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from './ApplicationIdentityFactory';
import { ApplicationRuntimeComposition } from './ApplicationRuntimeComposition';
import type { ApplicationRuntimePluginLifecycle } from './ApplicationRuntimePluginLifecycle';
import { createApplicationRuntimePluginLifecycle } from './ApplicationRuntimePluginLifecycle';
import { EphemeralExecutionRequestStore } from './EphemeralExecutionRequestStore';

export interface ObsidianApplicationRuntimeBootstrapOptions {
  readonly app: App;
}

/**
 * The production entry point for constructing the ApplicationRuntime from
 * Obsidian vault primitives. main.ts calls this once during onload().
 *
 * Constructs the complete composition with concrete Node process launchers
 * (Antigravity transport, managed ACP launcher, Codex app-server process
 * factory) and the Claude SDK query factory.
 */
export function createObsidianApplicationRuntime(
  options: ObsidianApplicationRuntimeBootstrapOptions,
): ApplicationRuntimePluginLifecycle {
  const vaultPath = getVaultPath(options.app);
  if (!vaultPath) throw new Error('Vault path is not available.');
  const adapter = new ObsidianVaultTextFileAdapter(options.app.vault, vaultPath);
  const storage = new VaultDurableStorage(adapter);
  const digest = new SubtleCryptoSha256DigestPort(crypto.subtle);

  // Construct the request broker for provider launch specs and startup options.
  const identities = new ApplicationIdentityFactory();
  const requestStore = new EphemeralExecutionRequestStore();
  const requests = new ApplicationExecutionRequestBroker(requestStore, identities);

  // Construct concrete Node process launchers for every topology.
  const launchers = createNodeProcessLauncherComposition({
    requests,
    codexLaunchSpec: {
      command: 'codex',
      args: ['--app-server'],
      spawnCwd: vaultPath,
      env: {},
    },
  });

  // Construct the Claude SDK query factory with a broker-backed resolver.
  const claudeResolver = new ClaudeStartupOptionsResolverAdapter(requests);
  const claudeQueryFactory = new ClaudeSdkExecutionQueryFactory(claudeResolver);

  const composition = new ApplicationRuntimeComposition({
    storage,
    digest,
    launchers,
    claudeQueryFactory,
  });

  return createApplicationRuntimePluginLifecycle({
    composition,
  });
}
