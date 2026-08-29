import type GrimoirePlugin from '../../main';
import type { CodexProviderSettings } from './settings';

/**
 * The inputs that decide which models the Codex CLI can list: which binary runs
 * and which environment it reads. The model catalog keys its refresh cache on
 * this, and every discovery persists a digest of it so a later load can tell a
 * list discovered under this configuration from one merely assumed to match.
 */
export function buildCodexModelCatalogFingerprint(
  settings: CodexProviderSettings,
  cliPath: string,
  environmentVariables: string,
): string {
  return JSON.stringify({
    cliPath,
    cliPathsByHost: settings.cliPathsByHost,
    environmentHash: settings.environmentHash,
    environmentVariables,
  });
}

export function resolveCodexModelCatalogFingerprint(
  plugin: GrimoirePlugin,
  settings: CodexProviderSettings,
): string {
  return buildCodexModelCatalogFingerprint(
    settings,
    plugin.getResolvedProviderCliPath?.('codex') ?? settings.cliPath,
    plugin.getActiveEnvironmentVariables?.('codex') ?? settings.environmentVariables,
  );
}
