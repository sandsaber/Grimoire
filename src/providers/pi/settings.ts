import { getProviderConfig, setProviderConfig } from '@/core/providers/providerConfig';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import { getEnhancedPath, getHostnameKey, parseEnvironmentVariables } from '@/utils/env';
import { isRecord } from '@/utils/records';
import { resolveCliExecutable } from '@/utils/resolveCliExecutable';

export interface PiSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: Record<string, string>;
  environmentVariables: string;
  visibleModels: string[];
  modelAliases: Record<string, string>;
  discoveredModels: Array<{ rawId: string; label: string; description?: string; thinkingLevels?: string[] }>;
  thinkingLevels: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string =>
    typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()))] : [];
}

function stringMap(value: unknown): Record<string, string> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value)
    .filter((entry): entry is [string, string] => Boolean(entry[0].trim())
      && typeof entry[1] === 'string' && Boolean(entry[1].trim()))
    .map(([key, entry]) => [key.trim(), entry.trim()])) : {};
}

export function decodePiSettings(input: unknown): PiSettings {
  const record = isRecord(input) ? input : {};
  return {
    enabled: record.enabled === true,
    cliPath: typeof record.cliPath === 'string' ? record.cliPath.trim() : '',
    cliPathsByHost: stringMap(record.cliPathsByHost),
    environmentVariables: typeof record.environmentVariables === 'string' ? record.environmentVariables : '',
    visibleModels: strings(record.visibleModels),
    modelAliases: stringMap(record.modelAliases),
    thinkingLevels: strings(record.thinkingLevels),
    discoveredModels: Array.isArray(record.discoveredModels) ? record.discoveredModels
      .filter((model): model is PiSettings['discoveredModels'][number] => isRecord(model)
        && typeof model.rawId === 'string' && Boolean(model.rawId.trim())
        && typeof model.label === 'string'
        && (model.description === undefined || typeof model.description === 'string'))
      .map(model => ({ ...model, thinkingLevels: strings(model.thinkingLevels) })) : [],
  };
}

export const getPiSettings = (settings: Record<string, unknown>): PiSettings =>
  decodePiSettings(getProviderConfig(settings, 'pi'));

export function updatePiSettings(settings: Record<string, unknown>, patch: Partial<PiSettings>): void {
  setProviderConfig(settings, 'pi', { ...getProviderConfig(settings, 'pi'), ...patch });
}

export function resolvePiAdapter(settings: Record<string, unknown>): string | null {
  const config = getPiSettings(settings);
  return resolveCliExecutable('pi-acp', [config.cliPathsByHost[getHostnameKey()], config.cliPath],
    getRuntimeEnvironmentText(settings, 'pi'));
}

export function piEnvironment(settings: Record<string, unknown>, adapter: string): Record<string, string> {
  const env = parseEnvironmentVariables(getRuntimeEnvironmentText(settings, 'pi'));
  return Object.fromEntries(Object.entries({ ...process.env, ...env,
    PATH: getEnhancedPath(env.PATH, adapter), NO_COLOR: '1' })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function resolvePiCommand(settings: Record<string, unknown>): string | null {
  const text = getRuntimeEnvironmentText(settings, 'pi');
  const env = parseEnvironmentVariables(text);
  return resolveCliExecutable('pi', [env.PI_ACP_PI_COMMAND ?? process.env.PI_ACP_PI_COMMAND], text);
}

export const decodePiModel = (model: string): string | undefined =>
  model.startsWith('pi:') ? model.slice(3) || undefined : undefined;
