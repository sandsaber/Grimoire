import { getCliBinaryFingerprint } from '../../core/providers/cliBinaryFingerprint';
import type GrimoirePlugin from '../../main';
import type { CodexProviderSettings } from './settings';

/**
 * The inputs that decide which models the Codex CLI can list: which binary runs
 * and which environment it reads. The model catalog keys its refresh cache on
 * this, and every discovery persists a digest of it so a later load can tell a
 * list discovered under this configuration from one merely assumed to match.
 *
 * The binary's identity is part of that, not just its path: Codex ships new
 * models with new releases, and an upgrade in place leaves the path untouched.
 * Without it a catalog discovered before the upgrade stays settled forever and
 * the new models never reach the picker.
 */
export function buildCodexModelCatalogFingerprint(
  settings: CodexProviderSettings,
  cliPath: string,
  environmentVariables: string,
): string {
  return JSON.stringify({
    cliBinary: getCliBinaryFingerprint(cliPath),
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
