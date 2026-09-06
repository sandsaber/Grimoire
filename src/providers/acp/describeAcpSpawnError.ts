import { existsSync } from 'node:fs';

import { AcpSpawnError } from './AcpSpawnError';

/**
 * What a failed spawn means, in words the person can act on.
 *
 * `ENOENT` from a spawn is one of two things and reads as neither: the CLI is
 * not where Grimoire looked, or the working directory is gone. Left raw it
 * reaches the surface as a transport failure — and for a provider whose
 * pre-dispatch wording is about sessions, as advice to start a new chat about a
 * CLI that is not installed.
 *
 * Shared because both paths to an ACP process need it: the legacy subprocess
 * and the managed launcher the flips run on.
 *
 * The result is an `AcpSpawnError` for the errnos that mean the process never
 * ran, so a caller can classify it rather than only print it. Anything else is
 * returned untouched: an error this function cannot explain is one it must not
 * relabel.
 */
const SPAWN_ERRNOS = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR']);

export function describeAcpSpawnError(error: Error, command: string, cwd: string): Error {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === undefined || !SPAWN_ERRNOS.has(code)) {
    return error;
  }

  if (code !== 'ENOENT') {
    // Classified but not reworded. `ENOENT` is the one that reads as something
    // it is not; a permission or path-type error already says what happened,
    // and the legacy subprocess path shows this message verbatim.
    return new AcpSpawnError(error.message, error);
  }

  if (!existsSync(cwd)) {
    return new AcpSpawnError(
      `Failed to start "${command}": working directory not found: "${cwd}".`,
      error,
    );
  }

  return new AcpSpawnError(
    `Failed to start "${command}": command not found. Set an absolute CLI path `
    + 'in the provider settings — desktop apps do not inherit the shell PATH.',
    error,
  );
}
