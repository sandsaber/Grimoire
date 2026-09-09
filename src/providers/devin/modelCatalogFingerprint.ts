import { getCliBinaryFingerprint } from '../../core/providers/cliBinaryFingerprint';
import type GrimoirePlugin from '../../main';
import type { DevinProviderSettings } from './settings';

/**
 * The inputs that decide which models the Devin CLI offers over ACP: which binary
 * runs and which environment it reads. The model catalog keys its refresh cache
 * on this, and every discovery persists a digest of it so a later load can tell
 * a list discovered under this configuration from one merely assumed to match.
 *
 * The binary's identity is part of that, not just its path: a CLI release can
 * change which models it offers, and an upgrade in place leaves the path
 * untouched. Without it a catalog discovered before the upgrade stays settled
 * and the new models never reach the picker.
 */
export function buildDevinModelCatalogFingerprint(
  settings: DevinProviderSettings,
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

export function resolveDevinModelCatalogFingerprint(
  plugin: GrimoirePlugin,
  settings: DevinProviderSettings,
): string {
  return buildDevinModelCatalogFingerprint(
    settings,
    plugin.getResolvedProviderCliPath?.('devin') ?? settings.cliPath,
    plugin.getActiveEnvironmentVariables?.('devin') ?? settings.environmentVariables,
  );
}
