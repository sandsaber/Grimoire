import { getProviderConfig, setProviderConfig } from '@/core/providers/providerConfig';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import { getEnhancedPath, getHostnameKey, parseEnvironmentVariables } from '@/utils/env';
import { resolveCliExecutable } from '@/utils/resolveCliExecutable';

import { isRecord } from './runtime/CommandcodeStream';

export interface CommandcodeSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: Record<string, string>;
  environmentVariables: string;
  reasoningEffortsByModel: Record<string, string[]>;
  discoveredModels: Array<{ rawId: string; label: string; description?: string }>;
}

export function decodeCommandcodeSettings(input: unknown): CommandcodeSettings {
  const record = isRecord(input) ? input : {};
  return {
    enabled: record.enabled === true,
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : '',
    cliPathsByHost: isRecord(record.cliPathsByHost)
      ? Object.fromEntries(Object.entries(record.cliPathsByHost).filter((entry): entry is [string, string] => (
        Boolean(entry[0].trim()) && typeof entry[1] === 'string' && Boolean(entry[1].trim())
      ))) : {},
    environmentVariables: typeof record.environmentVariables === 'string' ? record.environmentVariables : '',
    reasoningEffortsByModel: isRecord(record.reasoningEffortsByModel)
      ? Object.fromEntries(Object.entries(record.reasoningEffortsByModel).filter((entry): entry is [string, string[]] => (
        Array.isArray(entry[1]) && entry[1].every(value => typeof value === 'string' && /^[a-z][a-z0-9_-]*$/.test(value))
      ))) : {},
    discoveredModels: Array.isArray(record.discoveredModels)
      ? record.discoveredModels.filter((model): model is CommandcodeSettings['discoveredModels'][number] => (
        isRecord(model) && typeof model.rawId === 'string' && Boolean(model.rawId.trim())
        && typeof model.label === 'string'
        && (model.description === undefined || typeof model.description === 'string')
      )).map(model => ({ ...model })) : [],
  };
}

export function getCommandcodeSettings(settings: Record<string, unknown>): CommandcodeSettings {
  return decodeCommandcodeSettings(getProviderConfig(settings, 'commandcode'));
}

export function updateCommandcodeSettings(settings: Record<string, unknown>, patch: Partial<CommandcodeSettings>): void {
  setProviderConfig(settings, 'commandcode', { ...getProviderConfig(settings, 'commandcode'), ...patch });
}

export function resolveCommandcodeCli(settings: Record<string, unknown>): string | null {
  const config = getCommandcodeSettings(settings);
  return resolveCliExecutable('command-code', [config.cliPathsByHost[getHostnameKey()], config.cliPath],
    getRuntimeEnvironmentText(settings, 'commandcode'));
}

export function commandcodeEnvironment(settings: Record<string, unknown>, cli: string): Record<string, string> {
  const env = parseEnvironmentVariables(getRuntimeEnvironmentText(settings, 'commandcode'));
  return Object.fromEntries(Object.entries({ ...process.env, ...env,
    PATH: getEnhancedPath(env.PATH, cli), NO_COLOR: '1' })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export const COMMANDCODE_MODEL_PREFIX = 'commandcode:';
export function decodeCommandcodeModel(model: string): string | undefined {
  return model.startsWith(COMMANDCODE_MODEL_PREFIX) ? model.slice(COMMANDCODE_MODEL_PREFIX.length) || undefined : undefined;
}
