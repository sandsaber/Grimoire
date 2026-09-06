import type { SlashCommand as SDKSlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

import type { SlashCommand } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { createCustomSpawnFunction } from '../runtime/customSpawn';
import {
  getClaudeProviderSettings,
  resolveClaudeSettingSources,
} from '../settings';

function mapSdkCommands(sdkCommands: SDKSlashCommand[]): SlashCommand[] {
  return sdkCommands.map((cmd) => ({
    id: `sdk:${cmd.name}`,
    name: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
    content: '',
    source: 'sdk' as const,
  }));
}

/**
 * Probes the Claude SDK locally to discover available commands and skills.
 *
 * Fires a throwaway query with an empty prompt, waits for the system/init event,
 * calls supportedCommands() for full metadata, then aborts.
 *
 * This is not free. A measurement on 2026-08-26 isolated a one percentage point
 * step of the five-hour plan window to the first dropdown open after a plugin
 * load, with a clean baseline before it. Treat every call as billed: the caller
 * is expected to reuse a cached list and to pace retries.
 */
export async function probeRuntimeCommands(plugin: GrimoirePlugin): Promise<SlashCommand[]> {
  const vaultPath = getVaultPath(plugin.app);
  if (!vaultPath) {
    plugin.recordDebugLog?.({
      data: { providerId: 'claude', reason: 'no_vault_path' },
      event: 'commandCatalog.probe.skipped',
      level: 'debug',
      scope: 'provider.claude',
    });
    return [];
  }

  const cliPath = plugin.getResolvedProviderCliPath('claude');
  if (!cliPath) {
    plugin.recordDebugLog?.({
      data: { providerId: 'claude', reason: 'no_cli_path' },
      event: 'commandCatalog.probe.skipped',
      level: 'debug',
      scope: 'provider.claude',
    });
    return [];
  }

  const customEnv = parseEnvironmentVariables(
    plugin.getActiveEnvironmentVariables('claude')
  );
  const enhancedPath = getEnhancedPath(customEnv.PATH, cliPath);
  const claudeSettings = getClaudeProviderSettings(
    plugin.settings,
  );

  const abortController = new AbortController();
  let commands: SlashCommand[] = [];
  const extraArgs = {
    ...(claudeSettings.enableChrome ? { chrome: null } : {}),
  };

  try {
    const conversation = agentQuery({
      prompt: '',
      options: {
        cwd: vaultPath,
        abortController,
        pathToClaudeCodeExecutable: cliPath,
        env: { ...process.env, ...customEnv, PATH: enhancedPath },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: resolveClaudeSettingSources(claudeSettings.loadUserSettings, 'full_access'),
        ...(Object.keys(extraArgs).length > 0 ? { extraArgs } : {}),
        spawnClaudeCodeProcess: createCustomSpawnFunction(enhancedPath),
        persistSession: false,
      },
    });

    for await (const event of conversation) {
      if (event.type === 'system' && event.subtype === 'init') {
        const sdkCommands: SDKSlashCommand[] = await conversation.supportedCommands();
        commands = mapSdkCommands(sdkCommands);
        abortController.abort();
        break;
      }
    }
  } catch (error) {
    // The abort above is how this probe ends on success, so its rejection is
    // not a failure. Anything else - an absent CLI, a session that is not
    // authenticated - is the very condition that paces later attempts, and
    // reporting it as "found nothing" is what left it indistinguishable in the
    // logs from a CLI that genuinely has no commands.
    if (!abortController.signal.aborted) {
      throw error;
    }
  } finally {
    // The abort inside the loop is how a *successful* probe ends, and it is not
    // reached when `supportedCommands()` throws — which left the throwaway
    // session running, and this probe is billed. Aborting here covers every
    // exit; the catch above still reads the pre-abort signal, so it can still
    // tell our own abort from a real failure.
    abortController.abort();
  }

  return commands;
}
