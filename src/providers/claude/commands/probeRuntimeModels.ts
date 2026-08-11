import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { createCustomSpawnFunction } from '../runtime/customSpawn';
import {
  type ClaudeDiscoveredModel,
  getClaudeProviderSettings,
  resolveClaudeSettingSources,
} from '../settings';
import type { EffortLevel } from '../types/models';

type SdkModelProbe = {
  supportedModels?: () => Promise<unknown>;
};

function toSdkDiscoveredModels(value: unknown): ClaudeDiscoveredModel[] {
  if (!Array.isArray(value)) return [];

  const models: ClaudeDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.value === 'string' ? record.value.trim() : '';
    if (!id || seen.has(id)) continue;

    const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const resolvedModel = typeof record.resolvedModel === 'string' ? record.resolvedModel.trim() : '';
    const supportedEffortLevels = Array.isArray(record.supportedEffortLevels)
      ? record.supportedEffortLevels.filter((level): level is EffortLevel =>
        level === 'low'
        || level === 'medium'
        || level === 'high'
        || level === 'xhigh'
        || level === 'max'
      )
      : [];
    seen.add(id);
    models.push({
      id,
      displayName: displayName || id,
      ...(description ? { description } : {}),
      ...(resolvedModel ? { resolvedModel } : {}),
      ...(supportedEffortLevels.length > 0 ? { supportedEffortLevels } : {}),
      source: 'sdk',
    });
  }
  return models;
}

/**
 * Discovers the authenticated Claude Code model catalog without sending a prompt.
 * The SDK exposes this after its local system/init event, just like commands.
 */
export async function probeRuntimeModels(plugin: LegacyProviderContext): Promise<ClaudeDiscoveredModel[]> {
  const vaultPath = getVaultPath(plugin.app);
  const cliPath = plugin.getResolvedProviderCliPath?.('claude');
  if (!vaultPath || !cliPath) return [];

  const customEnv = parseEnvironmentVariables(plugin.getActiveEnvironmentVariables('claude'));
  const enhancedPath = getEnhancedPath(customEnv.PATH, cliPath);
  const claudeSettings = getClaudeProviderSettings(plugin.settings);
  const abortController = new AbortController();
  const extraArgs = claudeSettings.enableChrome ? { chrome: null } : undefined;

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
        ...(extraArgs ? { extraArgs } : {}),
        spawnClaudeCodeProcess: createCustomSpawnFunction(enhancedPath),
        persistSession: false,
      },
    });
    for await (const event of conversation) {
      if (event.type === 'system' && event.subtype === 'init') {
        return toSdkDiscoveredModels(await (conversation as SdkModelProbe).supportedModels?.());
      }
    }
  } catch {
    // Discovery is best-effort; the caller can use the API fallback.
  } finally {
    abortController.abort();
  }
  return [];
}
