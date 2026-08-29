import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import {
  getProviderEnvironmentVariables,
  getRuntimeEnvironmentText,
  getRuntimeEnvironmentVariables,
} from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths, PermissionMode, SlashCommand } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import type { EffortLevel } from './types/models';
import type { CCSettings } from './types/settings';

export type ClaudeSettingSource = 'user' | 'project' | 'local';

export interface ClaudeProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  loadUserSettings: boolean;
  enableChrome: boolean;
  enableBangBash: boolean;
  customModels: string;
  lastModel: string;
  environmentVariables: string;
  environmentHash: string;
  respectProjectSettings: boolean;
  projectSettingsSnapshot: ClaudeCodeProjectSettingsSnapshot;
  discoveredModels: ClaudeDiscoveredModel[];
  discoveredCommands: SlashCommand[];
  discoveredCommandsFingerprint: string;
  discoveredModelsFingerprint: string;
}

export interface ClaudeDiscoveredModel {
  id: string;
  displayName: string;
  description?: string;
  maxInputTokens?: number;
  resolvedModel?: string;
  source?: 'api' | 'sdk';
  supportedEffortLevels?: EffortLevel[];
}

export interface ClaudeCodeProjectSettingsSnapshot {
  model: string;
  env: Record<string, string>;
  hash: string;
}

export const DEFAULT_CLAUDE_CODE_PROJECT_SETTINGS_SNAPSHOT: Readonly<ClaudeCodeProjectSettingsSnapshot> = Object.freeze({
  model: '',
  env: {},
  hash: '',
});

export const DEFAULT_CLAUDE_PROVIDER_SETTINGS: Readonly<ClaudeProviderSettings> = Object.freeze({
  enabled: false,
  cliPath: '',
  cliPathsByHost: {},
  loadUserSettings: true,
  enableChrome: false,
  enableBangBash: false,
  customModels: '',
  lastModel: 'haiku',
  environmentVariables: '',
  environmentHash: '',
  respectProjectSettings: true,
  projectSettingsSnapshot: DEFAULT_CLAUDE_CODE_PROJECT_SETTINGS_SNAPSHOT,
  discoveredModels: [],
  discoveredCommands: [],
  discoveredCommandsFingerprint: '',
  discoveredModelsFingerprint: '',
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') {
      continue;
    }

    const key = rawKey.trim();
    const value = rawValue.trim();
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Persisted SDK commands are narrowed to the shape the probe produces. Anything
 * else a settings file happens to hold is dropped rather than trusted: the list
 * is replayed into the command dropdown, and a malformed entry would surface
 * there as a broken command.
 */
export function normalizeClaudeDiscoveredCommands(value: unknown): SlashCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const commands: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    // Trimmed and deduplicated like the discovered models below: a hand-edited
    // or sync-merged settings file can carry `" commit "`, which would insert
    // as `/ commit `, or the same id twice, which would show as two identical
    // dropdown rows.
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (!id || !name || seen.has(id)) {
      continue;
    }
    seen.add(id);

    commands.push({
      content: typeof candidate.content === 'string' ? candidate.content : '',
      id,
      name,
      source: 'sdk',
      ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
      ...(typeof candidate.argumentHint === 'string' ? { argumentHint: candidate.argumentHint } : {}),
    });
  }

  return commands;
}

export function normalizeClaudeDiscoveredModels(value: unknown): ClaudeDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const models: ClaudeDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || seen.has(id)) {
      continue;
    }

    const displayName = typeof record.displayName === 'string'
      ? record.displayName.trim()
      : typeof record.display_name === 'string'
        ? record.display_name.trim()
        : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const resolvedModel = typeof record.resolvedModel === 'string' ? record.resolvedModel.trim() : '';
    const source = record.source === 'sdk' || record.source === 'api' ? record.source : undefined;
    const supportedEffortLevels = Array.isArray(record.supportedEffortLevels)
      ? record.supportedEffortLevels.filter((level): level is EffortLevel =>
        level === 'low'
        || level === 'medium'
        || level === 'high'
        || level === 'xhigh'
        || level === 'max'
      )
      : [];
    const rawMaxInputTokens = record.maxInputTokens ?? record.max_input_tokens;
    const maxInputTokens = typeof rawMaxInputTokens === 'number' && isFinite(rawMaxInputTokens) && rawMaxInputTokens > 0
      ? rawMaxInputTokens
      : undefined;

    seen.add(id);
    models.push({
      id,
      displayName: displayName || id,
      ...(description ? { description } : {}),
      ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
      ...(resolvedModel ? { resolvedModel } : {}),
      ...(source ? { source } : {}),
      ...(supportedEffortLevels.length > 0 ? { supportedEffortLevels } : {}),
    });
  }

  return models;
}

function computeClaudeCodeProjectSettingsHash(
  model: string,
  env: Record<string, string>,
): string {
  return [
    model ? `model=${model}` : '',
    ...Object.entries(env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`),
  ].filter(Boolean).join('|');
}

export function normalizeClaudeCodeProjectSettingsSnapshot(
  value: unknown,
): ClaudeCodeProjectSettingsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_CLAUDE_CODE_PROJECT_SETTINGS_SNAPSHOT, env: {} };
  }

  const record = value as Record<string, unknown>;
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  const env = normalizeStringMap(record.env);
  return {
    model,
    env,
    hash: computeClaudeCodeProjectSettingsHash(model, env),
  };
}

export function snapshotClaudeCodeProjectSettings(
  settings: CCSettings,
): ClaudeCodeProjectSettingsSnapshot {
  return normalizeClaudeCodeProjectSettingsSnapshot({
    model: settings.model,
    env: settings.env,
  });
}

export function snapshotClaudeCodeSettings({
  includeUserSettings,
  user,
  project,
}: {
  includeUserSettings: boolean;
  user?: CCSettings;
  project?: CCSettings;
}): ClaudeCodeProjectSettingsSnapshot {
  const userSnapshot = includeUserSettings
    ? snapshotClaudeCodeProjectSettings(user ?? {})
    : snapshotClaudeCodeProjectSettings({});
  const projectSnapshot = snapshotClaudeCodeProjectSettings(project ?? {});
  return normalizeClaudeCodeProjectSettingsSnapshot({
    model: projectSnapshot.model || userSnapshot.model,
    env: {
      ...userSnapshot.env,
      ...projectSnapshot.env,
    },
  });
}

export function getClaudeProviderSettings(
  settings: Record<string, unknown>,
): ClaudeProviderSettings {
  const config = getProviderConfig(settings, 'claude');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(
    config.cliPathsByHost ?? settings.claudeCliPathsByHost,
  );
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    enabled: typeof config.enabled === 'boolean'
      ? config.enabled
      : DEFAULT_CLAUDE_PROVIDER_SETTINGS.enabled,
    cliPath: (config.cliPath as string | undefined)
      ?? (settings.claudeCliPath as string | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    loadUserSettings: (config.loadUserSettings as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.loadUserSettings,
    enableChrome: (config.enableChrome as boolean | undefined)
      ?? (settings.enableChrome as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enableChrome,
    enableBangBash: (config.enableBangBash as boolean | undefined)
      ?? (settings.enableBangBash as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enableBangBash,
    customModels: (config.customModels as string | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.customModels,
    lastModel: (config.lastModel as string | undefined)
      ?? (settings.lastClaudeModel as string | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.lastModel,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'claude')
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.environmentVariables,
    environmentHash: (config.environmentHash as string | undefined)
      ?? (settings.lastEnvHash as string | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.environmentHash,
    respectProjectSettings: (config.respectProjectSettings as boolean | undefined)
      ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.respectProjectSettings,
    projectSettingsSnapshot: normalizeClaudeCodeProjectSettingsSnapshot(
      config.projectSettingsSnapshot,
    ),
    discoveredModels: normalizeClaudeDiscoveredModels(config.discoveredModels),
    discoveredCommands: normalizeClaudeDiscoveredCommands(config.discoveredCommands),
    discoveredCommandsFingerprint: typeof config.discoveredCommandsFingerprint === 'string'
      ? config.discoveredCommandsFingerprint
      : DEFAULT_CLAUDE_PROVIDER_SETTINGS.discoveredCommandsFingerprint,
    discoveredModelsFingerprint: typeof config.discoveredModelsFingerprint === 'string'
      ? config.discoveredModelsFingerprint
      : DEFAULT_CLAUDE_PROVIDER_SETTINGS.discoveredModelsFingerprint,
  };
}

export function getClaudeModelSupportedEffortLevels(
  settings: Record<string, unknown>,
  model: string,
): EffortLevel[] | undefined {
  return getClaudeProviderSettings(settings).discoveredModels
    .find(candidate => candidate.id === model)?.supportedEffortLevels;
}

export function getClaudeEffectiveEnvironmentVariables(
  settings: Record<string, unknown>,
): Record<string, string> {
  const runtimeEnv = getRuntimeEnvironmentVariables(settings, 'claude');
  const claudeSettings = getClaudeProviderSettings(settings);
  if (!claudeSettings.respectProjectSettings) {
    return runtimeEnv;
  }

  return {
    ...claudeSettings.projectSettingsSnapshot.env,
    ...runtimeEnv,
  };
}

export function getClaudeRuntimeEnvironmentText(
  settings: Record<string, unknown>,
): string {
  const claudeSettings = getClaudeProviderSettings(settings);
  if (!claudeSettings.respectProjectSettings) {
    return getRuntimeEnvironmentText(settings, 'claude');
  }

  return Object.entries(getClaudeEffectiveEnvironmentVariables(settings))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function resolveClaudeSettingSources(
  loadUserSettings: boolean,
  permissionMode: PermissionMode = 'full_access',
): ClaudeSettingSource[] {
  if (permissionMode !== 'full_access') {
    return ['project', 'local'];
  }

  return loadUserSettings
    ? ['user', 'project', 'local']
    : ['project', 'local'];
}

export function updateClaudeProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<ClaudeProviderSettings>,
): ClaudeProviderSettings {
  const current = getClaudeProviderSettings(settings);
  const next: ClaudeProviderSettings = {
    ...current,
    ...updates,
  };
  setProviderConfig(settings, 'claude', { ...next });
  return next;
}
