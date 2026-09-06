import { AcpWorkspaceFileSystem } from '@/providers/acp/execution/AcpWorkspaceFileSystem';

/**
 * What an auxiliary Grok turn may reach on disk, which is less than a chat turn
 * may.
 *
 * The chat filesystem opts out of containment in `always-approve`: the user
 * asked for it and is watching the turn that uses it. **An auxiliary turn is
 * neither asked for nor watched** — a title is generated behind a conversation
 * nobody may be looking at, and an inline edit runs from a modal over a note. So
 * it is contained whatever the chat is set to, and it writes nothing at all.
 *
 * This is what the legacy runner did with its own `readTextFile` and no
 * `writeTextFile`, kept as a named policy rather than as the absence of a
 * feature: a client that advertises no write invites the agent to find another
 * way, while one that refuses gives it an error it can report.
 *
 * Given only to the purpose that reads. A title and a refinement are launched
 * with no filesystem delegate at all, which is what tells the agent over the
 * handshake that there is nothing there to read.
 */
export function createGrokAuxiliaryFileSystem(
  resolveVaultPath: () => string,
): AcpWorkspaceFileSystem {
  return new AcpWorkspaceFileSystem({
    providerLabel: 'Grok Build',
    resolveSession: () => ({ cwd: resolveVaultPath(), allowOutsideWorkspace: false }),
    approveWrite: async () => false,
  });
}
