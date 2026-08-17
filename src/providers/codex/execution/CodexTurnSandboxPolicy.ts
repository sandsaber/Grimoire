import os from 'node:os';
import path from 'node:path';

import { deriveCodexMemoriesDirFromSessionsRoot } from '../history/CodexHistoryStore';
import type { SandboxPolicy } from '../runtime/codexAppServerTypes';

/**
 * Host-to-target path translation for the selected launch target.
 *
 * Codex may run somewhere the vault's paths do not mean the same thing — WSL
 * being the case that exists today — so every path handed to the sandbox has to
 * be expressed in the target's terms.
 */
export interface CodexTargetPaths {
  /** The working directory the daemon was launched in, in target terms. */
  readonly workspaceRoot: string | null;
  /**
   * `null` where the target cannot see the path at all.
   *
   * Strict on purpose. The temp directories below fall back to the host path
   * when the mapping says nothing, because a missing scratch directory is a
   * degradation; a pinned context path that cannot be mapped is not, and is
   * raised rather than quietly replaced with a path the target cannot read.
   */
  toTargetPath(hostPath: string | null | undefined): string | null;
  /** Whether the target uses POSIX conventions, which decides `/tmp`. */
  readonly posixTarget: boolean;
  /**
   * Whether the target is a machine other than this one.
   *
   * Separate from `posixTarget` on purpose: a local Windows target is not
   * POSIX but its home directory is this process's home, while a WSL target is
   * POSIX and its home is not. Collapsing the two loses one case each way.
   */
  readonly remoteTarget: boolean;
  /** Where this target keeps Codex memories, when the caller already knows. */
  readonly memoriesDirTarget?: string | null;
}

export interface CodexTurnSandboxInputs {
  readonly sandboxMode: string;
  readonly externalContextPaths: readonly string[];
  readonly transcriptRootTarget?: string | null;
  readonly target: CodexTargetPaths;
}

/**
 * What this turn is allowed to write.
 *
 * Extracted from the legacy runtime unchanged, because it is the one decision in
 * a turn whose mistakes are not recoverable: a writable root too many hands the
 * model a directory the user never offered it, and one too few breaks editing in
 * a way that looks like the model refusing to work.
 *
 * An external context path the target cannot see is an error rather than a
 * silent omission — the user pinned it, and a turn that quietly cannot read it
 * answers about files it never saw.
 */
export function buildCodexTurnSandboxPolicy(
  inputs: CodexTurnSandboxInputs,
): SandboxPolicy | undefined {
  if (inputs.sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }

  if (inputs.sandboxMode === 'read-only') {
    return { type: 'readOnly', access: { type: 'fullAccess' }, networkAccess: false };
  }

  if (inputs.sandboxMode !== 'workspace-write') {
    return undefined;
  }

  const target = inputs.target;
  const externalContextPaths = inputs.externalContextPaths.map(hostPath => {
    const targetPath = target.toTargetPath(hostPath);
    if (!targetPath) {
      throw new Error(`Codex cannot access external context path from the selected target: ${hostPath}`);
    }
    return targetPath;
  });

  const memoriesDirTarget = deriveCodexMemoriesDirFromSessionsRoot(inputs.transcriptRootTarget)
    ?? target.memoriesDirTarget
    // Only where the target is this machine: a home directory guessed for a
    // remote target names a path that exists here and not there.
    ?? (target.remoteTarget ? null : path.join(os.homedir(), '.codex', 'memories'));

  const writableRoots = [
    target.workspaceRoot,
    ...externalContextPaths,
    memoriesDirTarget,
    target.toTargetPath(os.tmpdir()) ?? os.tmpdir(),
    target.posixTarget ? '/tmp' : null,
    target.toTargetPath(process.env.TMPDIR) ?? process.env.TMPDIR ?? null,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    type: 'workspaceWrite',
    writableRoots: [...new Set(writableRoots)],
    readOnlyAccess: { type: 'fullAccess' },
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}
