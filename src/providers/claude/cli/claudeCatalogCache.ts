import { getCliBinaryFingerprint } from '../../../core/providers/cliBinaryFingerprint';
import type { ClaudeProviderSettings } from '../settings';

/**
 * How long a discovery that found nothing is left alone before it is tried
 * again. Both catalogs pace themselves with it, so it lives here rather than
 * as two literals whose comments each claim to match the other.
 *
 * In memory on purpose: a probe that found nothing must be retried after the
 * user installs or logs into the CLI, and persisting the attempt would keep the
 * result empty across the very restart meant to fix it.
 */
export const CLAUDE_EMPTY_DISCOVERY_RETRY_MS = 10 * 60 * 1000;

/**
 * The inputs that decide what the Claude Code SDK can see at all: which binary
 * runs, where it runs from, and which settings sources and environment it reads.
 * Both catalogs that persist a discovery - models and commands - are keyed on
 * this, because a change to any of it can change the answer.
 *
 * Vault folders are deliberately absent. Their freshness comes from merging
 * what is on disk at display time, not from invalidating the cache, so editing
 * a skill never costs a probe.
 */
export function buildClaudeCatalogCacheKey(
  settings: ClaudeProviderSettings,
  cliPath: string,
): string {
  return JSON.stringify({
    cliBinary: getCliBinaryFingerprint(cliPath),
    cliPath,
    enableChrome: settings.enableChrome,
    environmentHash: settings.environmentHash,
    environmentVariables: settings.environmentVariables,
    loadUserSettings: settings.loadUserSettings,
    projectSettingsEnvHash: settings.projectSettingsSnapshot.hash,
    respectProjectSettings: settings.respectProjectSettings,
  });
}
