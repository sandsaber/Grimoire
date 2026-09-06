import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JsonRpcHandlerError } from '@/providers/acp/AcpJsonRpcTransport';
import { AcpWorkspaceFileSystem } from '@/providers/acp/execution/AcpWorkspaceFileSystem';

/**
 * The filesystem six ACP providers read and write the vault through.
 *
 * The two answers a failed read can give are the subject: a file that is not
 * there, and a path the workspace will not reach. They were the same answer
 * until 2026-08-31 — a bare internal error carrying whatever `node:fs` said —
 * and Gemini CLI's live row 15 is what showed the cost: its write tool reads
 * the file it is about to replace, could not tell "missing" from "refused", and
 * abandoned the write before Grimoire was ever asked for permission.
 */
describe('ACP workspace file system', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'grimoire-acp-fs-'));
  });

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true });
  });

  function createFileSystem(options: { allowOutsideWorkspace?: boolean } = {}): {
    fileSystem: AcpWorkspaceFileSystem;
    approvals: string[];
  } {
    const approvals: string[] = [];
    const fileSystem = new AcpWorkspaceFileSystem({
      providerLabel: 'Gemini',
      resolveSession: () => ({
        cwd: workspace,
        allowOutsideWorkspace: options.allowOutsideWorkspace ?? false,
      }),
      approveWrite: async input => {
        approvals.push(input.requestPath);
        return true;
      },
    });
    return { approvals, fileSystem };
  }

  it('reads a file the workspace has', async () => {
    writeFileSync(join(workspace, 'Note.md'), 'first\nsecond\n');
    const { fileSystem } = createFileSystem();

    await expect(fileSystem.readTextFile({ path: 'Note.md', sessionId: 'session-1' }))
      .resolves.toEqual({ content: 'first\nsecond\n' });
  });

  it('says a file is not there in the protocol\'s own words', async () => {
    const { fileSystem } = createFileSystem();

    // `-32002 Resource not found` is the code the protocol has for this, and the
    // sentence is the one the agent's own client looks for. An agent that asked
    // whether a file exists gets an answer it can act on rather than one it has
    // to treat as a failure of the client.
    const failure = await fileSystem
      .readTextFile({ path: 'missing.md', sessionId: 'session-1' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JsonRpcHandlerError);
    expect(failure).toMatchObject({
      code: -32002,
      message: `Resource not found: ${join(workspace, 'missing.md')}`,
    });
  });

  it('keeps the refusal distinct from the file that is not there', async () => {
    const { fileSystem } = createFileSystem();

    // The same wire answer for both is what made a containment refusal
    // unreadable: this one is the client saying no, not the file being absent,
    // and it stays an internal error with the sentence a person is shown.
    const failure = await fileSystem
      .readTextFile({ path: '../outside.md', sessionId: 'session-1' })
      .catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(JsonRpcHandlerError);
    expect((failure as Error).message).toBe('File access is limited to the current workspace.');
  });

  it('reports a directory read as itself rather than as a missing file', async () => {
    // Everything else `node:fs` raises travels as it always did: only ENOENT is
    // the protocol's "not found", and an EISDIR that claimed to be one would
    // send an agent off to create a file over a directory.
    const { fileSystem } = createFileSystem();

    const failure = await fileSystem
      .readTextFile({ path: '.', sessionId: 'session-1' })
      .catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(JsonRpcHandlerError);
    expect((failure as Error).message).toContain('EISDIR');
  });

  it('writes what the tab approved', async () => {
    const { approvals, fileSystem } = createFileSystem();

    await expect(fileSystem.writeTextFile({
      content: 'yes',
      path: 'written.md',
      sessionId: 'session-1',
    })).resolves.toEqual({});
    expect(approvals).toEqual(['written.md']);
  });
});
