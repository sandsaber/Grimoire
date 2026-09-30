import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { resolveClaudeConfigDir } from '../config/ClaudeConfigDir';
import {
  type ClaudeCodeProjectSettingsSnapshot,
  getClaudeProviderSettings,
  normalizeClaudeCodeProjectSettingsSnapshot,
} from '../settings';

type SettingsReader = Pick<VaultFileAdapter, 'exists' | 'read'>;

async function readSnapshot(adapter: SettingsReader, path: string): Promise<ClaudeCodeProjectSettingsSnapshot> {
  if (!(await adapter.exists(path))) {
    return normalizeClaudeCodeProjectSettingsSnapshot(undefined);
  }
  return normalizeClaudeCodeProjectSettingsSnapshot(JSON.parse(await adapter.read(path)));
}

/** Read the same settings layers the CLI will load, before consulting a cached catalog. */
export async function readClaudeCodeSettingsSnapshot(
  settings: Record<string, unknown>,
  adapter: SettingsReader,
  vaultPath: string | null,
): Promise<ClaudeCodeProjectSettingsSnapshot> {
  const { loadUserSettings } = getClaudeProviderSettings(settings);
  const configDir = resolveClaudeConfigDir({
    environment: { ...process.env, ...getRuntimeEnvironmentVariables(settings, 'claude') },
    vaultPath,
  });
  const [user, project, local] = await Promise.all([
    loadUserSettings ? readSnapshot(new HomeFileAdapter(configDir), 'settings.json') : undefined,
    readSnapshot(adapter, '.claude/settings.json'),
    readSnapshot(adapter, '.claude/settings.local.json'),
  ]);
  return normalizeClaudeCodeProjectSettingsSnapshot({
    model: local.model || project.model || user?.model,
    env: { ...user?.env, ...project.env, ...local.env },
  });
}
