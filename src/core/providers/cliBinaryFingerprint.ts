import * as fs from 'fs';

/**
 * Identifies the installed CLI build behind a resolved path.
 *
 * A model or command catalog is rediscovered only when its cache key changes,
 * and an upgrade in place (`npm install -g`, or a managed installer repointing
 * its `current` link) leaves the path untouched. The file's size and mtime
 * change with every install, so folding them into the key lets an upgrade
 * surface new models without a manual refresh. Symlinks are followed, so a shim
 * pointing at a versioned file tracks the target. Returns '' when the path
 * cannot be inspected; the key then falls back to the path alone.
 */
export function getCliBinaryFingerprint(cliPath: string): string {
  if (!cliPath) {
    return '';
  }

  try {
    const stat = fs.statSync(cliPath);
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return '';
  }
}
