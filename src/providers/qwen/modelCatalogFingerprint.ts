import type GrimoirePlugin from '../../main';
import type { QwenProviderSettings } from './settings';

/**
 * The inputs that decide which models the Qwen CLI offers over ACP: which binary
 * runs and which environment it reads. The model catalog keys its refresh cache
 * on this, and every discovery persists a digest of it so a later load can tell
 * a list discovered under this configuration from one merely assumed to match.
 */
export function buildQwenModelCatalogFingerprint(
  settings: QwenProviderSettings,
  cliPath: string,
  environmentVariables: string,
): string {
  return JSON.stringify({
    cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentVariables,
  });
}

export function resolveQwenModelCatalogFingerprint(
  plugin: GrimoirePlugin,
  settings: QwenProviderSettings,
): string {
  return buildQwenModelCatalogFingerprint(
    settings,
    plugin.getResolvedProviderCliPath?.('qwen') ?? settings.cliPath,
    plugin.getActiveEnvironmentVariables?.('qwen') ?? settings.environmentVariables,
  );
}
