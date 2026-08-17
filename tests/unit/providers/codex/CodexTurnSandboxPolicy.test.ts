import os from 'node:os';

import {
  buildCodexTurnSandboxPolicy,
  type CodexTargetPaths,
} from '@/providers/codex/execution/CodexTurnSandboxPolicy';

/**
 * What a Codex turn is allowed to write.
 *
 * The one decision in a turn whose mistakes are not recoverable: a writable root
 * too many hands the model a directory the user never offered it, and one too
 * few breaks editing in a way that reads as the model refusing to work. It lived
 * inside the legacy runtime with no direct test, reachable only by driving a
 * whole turn through a daemon.
 */
describe('Codex turn sandbox policy', () => {
  function localTarget(overrides: Partial<CodexTargetPaths> = {}): CodexTargetPaths {
    return {
      workspaceRoot: '/vault',
      toTargetPath: hostPath => hostPath ?? null,
      posixTarget: true,
      remoteTarget: false,
      ...overrides,
    };
  }

  it('asks for no policy at all where the mode does not describe one', () => {
    // `undefined` leaves the daemon on its configured default. An empty policy
    // object would instead be a claim about access this turn does not make.
    expect(buildCodexTurnSandboxPolicy({
      sandboxMode: 'something-else',
      externalContextPaths: [],
      target: localTarget(),
    })).toBeUndefined();
  });

  it('maps the two whole-machine modes without inventing roots', () => {
    expect(buildCodexTurnSandboxPolicy({
      sandboxMode: 'danger-full-access',
      externalContextPaths: ['/elsewhere'],
      target: localTarget(),
    })).toEqual({ type: 'dangerFullAccess' });

    expect(buildCodexTurnSandboxPolicy({
      sandboxMode: 'read-only',
      externalContextPaths: ['/elsewhere'],
      target: localTarget(),
    })).toEqual({ type: 'readOnly', access: { type: 'fullAccess' }, networkAccess: false });
  });

  it('grants the workspace, the pinned paths, memories and temp, and nothing else', () => {
    const policy = buildCodexTurnSandboxPolicy({
      sandboxMode: 'workspace-write',
      externalContextPaths: ['/notes/pinned', '/notes/pinned'],
      transcriptRootTarget: '/home/user/.codex/sessions',
      target: localTarget(),
    });

    expect(policy?.type).toBe('workspaceWrite');
    const roots = policy?.type === 'workspaceWrite' ? policy.writableRoots : [];
    expect(roots).toContain('/vault');
    expect(roots).toContain('/notes/pinned');
    expect(roots).toContain('/home/user/.codex/memories');
    expect(roots).toContain('/tmp');
    expect(roots).toContain(os.tmpdir());
    // Duplicates collapse, so a path pinned twice does not appear twice.
    expect(roots.filter(root => root === '/notes/pinned')).toHaveLength(1);
    // Reading stays wide and the network stays shut: this policy is about
    // writes, and widening either here would be a silent grant.
    expect(policy).toMatchObject({
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
    });
  });

  it('refuses a pinned path the target cannot see instead of dropping it', () => {
    // The quiet failure this guards: a turn that silently cannot read a file the
    // user pinned answers about files it never saw, and nothing says so.
    expect(() => buildCodexTurnSandboxPolicy({
      sandboxMode: 'workspace-write',
      externalContextPaths: ['C:\\notes\\pinned'],
      target: localTarget({
        toTargetPath: hostPath => (hostPath?.startsWith('C:') ? null : hostPath ?? null),
      }),
    })).toThrow('cannot access external context path');
  });

  it('keeps this machine\'s memories directory for a local non-POSIX target', () => {
    // The case a single "is it POSIX" flag would lose: a local Windows target
    // is not POSIX, but its home directory is this process's home.
    const policy = buildCodexTurnSandboxPolicy({
      sandboxMode: 'workspace-write',
      externalContextPaths: [],
      target: localTarget({ posixTarget: false, workspaceRoot: 'C:\\vault' }),
    });

    const roots = policy?.type === 'workspaceWrite' ? policy.writableRoots : [];
    expect(roots.some(root => root.includes('.codex'))).toBe(true);
  });

  it('guesses no home directory for a target that is not this machine', () => {
    // A memories path derived from this machine's home names a directory that
    // exists here and not there, so the turn would ask the daemon to write
    // somewhere meaningless.
    const policy = buildCodexTurnSandboxPolicy({
      sandboxMode: 'workspace-write',
      externalContextPaths: [],
      target: {
        workspaceRoot: '/mnt/c/vault',
        toTargetPath: () => null,
        posixTarget: true,
        remoteTarget: true,
      },
    });

    const roots = policy?.type === 'workspaceWrite' ? policy.writableRoots : [];
    expect(roots).toEqual(['/mnt/c/vault', '/tmp']);
  });

  it('prefers the memories directory the caller already resolved', () => {
    const policy = buildCodexTurnSandboxPolicy({
      sandboxMode: 'workspace-write',
      externalContextPaths: [],
      target: localTarget({ memoriesDirTarget: '/mnt/c/codex/memories' }),
    });

    const roots = policy?.type === 'workspaceWrite' ? policy.writableRoots : [];
    expect(roots).toContain('/mnt/c/codex/memories');
  });
});
