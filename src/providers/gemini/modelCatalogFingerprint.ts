import type GrimoirePlugin from '../../main';
import type { GeminiProviderSettings } from './settings';

/**
 * The inputs that decide which models the Gemini CLI offers over ACP: which binary
 * runs and which environment it reads. The model catalog keys its refresh cache
 * on this, and every discovery persists a digest of it so a later load can tell
 * a list discovered under this configuration from one merely assumed to match.
 */
export function buildGeminiModelCatalogFingerprint(
  settings: GeminiProviderSettings,
  cliPath: string,
  environmentVariables: string,
): string {
  return JSON.stringify({
    cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentVariables,
  });
}

export function resolveGeminiModelCatalogFingerprint(
  plugin: GrimoirePlugin,
  settings: GeminiProviderSettings,
): string {
  return buildGeminiModelCatalogFingerprint(
    settings,
    plugin.getResolvedProviderCliPath?.('gemini') ?? settings.cliPath,
    plugin.getActiveEnvironmentVariables?.('gemini') ?? settings.environmentVariables,
  );
}
