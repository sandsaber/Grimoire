import { getCliBinaryFingerprint } from '../../core/providers/cliBinaryFingerprint';
import type GrimoirePlugin from '../../main';
import type { GeminiProviderSettings } from './settings';

/**
 * The inputs that decide which models the Gemini CLI offers over ACP: which binary
 * runs and which environment it reads. The model catalog keys its refresh cache
 * on this, and every discovery persists a digest of it so a later load can tell
 * a list discovered under this configuration from one merely assumed to match.
 *
 * The binary's identity is part of that, not just its path: a CLI release can
 * change which models it offers, and an upgrade in place leaves the path
 * untouched. Without it a catalog discovered before the upgrade stays settled
 * and the new models never reach the picker.
 */
export function buildGeminiModelCatalogFingerprint(
  settings: GeminiProviderSettings,
  cliPath: string,
  environmentVariables: string,
): string {
  return JSON.stringify({
    cliBinary: getCliBinaryFingerprint(cliPath),
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
