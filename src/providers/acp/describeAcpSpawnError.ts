import { existsSync } from 'node:fs';

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
 */
export function describeAcpSpawnError(error: Error, command: string, cwd: string): Error {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    return error;
  }

  if (!existsSync(cwd)) {
    return new Error(
      `Failed to start "${command}": working directory not found: "${cwd}".`,
      { cause: error },
    );
  }

  return new Error(
    `Failed to start "${command}": command not found. Set an absolute CLI path `
    + 'in the provider settings — desktop apps do not inherit the shell PATH.',
    { cause: error },
  );
}
