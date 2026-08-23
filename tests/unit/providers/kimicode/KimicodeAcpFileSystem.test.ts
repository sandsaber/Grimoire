import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import trace from '@test/fixtures/provider-traces/kimicode-execution.json';

import { KimicodeAcpFileSystem } from '@/providers/kimicode/execution/KimicodeAcpFileSystem';
import { createKimicodeAuxiliaryFileSystem } from '@/providers/kimicode/execution/KimicodeAuxiliaryFileSystem';

describe('KimicodeAcpFileSystem', () => {
  describe('what an auxiliary turn may reach', () => {
    it('stays in the vault and writes nothing, whatever the chat is set to', async () => {
      const root = await mkdtemp(join(tmpdir(), 'grimoire-kimicode-aux-fs-'));
      const fileSystem = createKimicodeAuxiliaryFileSystem(() => root);
      try {
        await writeFile(join(root, 'note.md'), 'the note', 'utf8');
        const outside = join(dirname(root), 'elsewhere.md');
        await writeFile(outside, 'not the vault', 'utf8');

        // Reading inside is the whole reason an inline edit has a filesystem.
        await expect(fileSystem.readTextFile({ sessionId: 'aux', path: 'note.md' }))
          .resolves.toEqual({ content: 'the note' });
        // Outside is refused even though the *chat* may be in full access: an
        // auxiliary turn is neither asked for nor watched, and the user who
        // opted into unrestricted access opted in for the turn they can see.
        await expect(fileSystem.readTextFile({ sessionId: 'aux', path: outside }))
          .rejects.toThrow(/workspace/i);
        // And it writes nothing at all, contained or not.
        await expect(fileSystem.writeTextFile({
          sessionId: 'aux',
          path: 'note.md',
          content: 'overwritten by a title generator',
        })).rejects.toThrow();
        await expect(readFile(join(root, 'note.md'), 'utf8')).resolves.toBe('the note');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  it('contains reads and approved writes to the session workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grimoire-kimicode-fs-'));
    const approvals: string[] = [];
    const operations: string[] = [];
    const fileSystem = new KimicodeAcpFileSystem({
      resolveSession: () => ({ cwd: root, allowOutsideWorkspace: false }),
      approveWrite: async ({ resolvedPath }) => {
        approvals.push(resolvedPath);
        return true;
      },
    });
    try {
      await fileSystem.writeTextFile({
        sessionId: 'session-1',
        path: 'notes/result.md',
        content: 'line one\nline two',
      });
      operations.push('write:contained:approved');
      await expect(readFile(join(root, 'notes', 'result.md'), 'utf8'))
        .resolves.toBe('line one\nline two');
      await expect(fileSystem.readTextFile({
        sessionId: 'session-1',
        path: 'notes/result.md',
        line: 2,
        limit: 1,
      })).resolves.toEqual({ content: 'line two' });
      operations.push('read:contained');
      expect(approvals).toEqual([join(root, 'notes', 'result.md')]);
      expect(operations).toEqual(trace.cases.filesystemContainment.slice(0, 2));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects workspace escape before approval or filesystem access', async () => {
    // Two levels, and the outer one is why: the file this test tries to escape
    // to lives *beside* the workspace, and `dirname(mkdtemp(tmpdir()))` is
    // `/tmp` — shared. Three providers now run this same test with the same
    // file name, in parallel, each removing it in its own `finally`. One suite
    // then deletes another's file between its write and its read, which is a
    // flake that only appears once a second provider has the test.
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-kimicode-contained-'));
    const root = join(enclosing, 'workspace');
    await mkdir(root, { recursive: true });
    const outside = join(dirname(root), 'outside-secret.md');
    await writeFile(outside, 'secret', 'utf8');
    const approveWrite = jest.fn(async () => true);
    const fileSystem = new KimicodeAcpFileSystem({
      resolveSession: () => ({ cwd: root, allowOutsideWorkspace: false }),
      approveWrite,
    });
    try {
      await expect(fileSystem.readTextFile({
        sessionId: 'session-1',
        path: outside,
      })).rejects.toThrow('limited to the current workspace');
      await expect(fileSystem.writeTextFile({
        sessionId: 'session-1',
        path: outside,
        content: 'overwrite',
      })).rejects.toThrow('limited to the current workspace');
      expect(approveWrite).not.toHaveBeenCalled();
      expect(await readFile(outside, 'utf8')).toBe('secret');
      expect('escape:rejected-before-approval').toBe(trace.cases.filesystemContainment[2]);
    } finally {
      await rm(enclosing, { recursive: true, force: true });
    }
  });

  it('refuses a write in Kimi Code own name when the person said no', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grimoire-kimicode-refused-'));
    const fileSystem = new KimicodeAcpFileSystem({
      resolveSession: () => ({ cwd: root, allowOutsideWorkspace: false }),
      approveWrite: async () => false,
    });
    try {
      // The refusal reaches the agent as text, and it is the one place this
      // provider's own label has to be in it.
      await expect(fileSystem.writeTextFile({
        sessionId: 'session-1',
        path: 'notes/result.md',
        content: 'unapproved',
      })).rejects.toThrow('Kimi Code file write was not approved.');
      await expect(readFile(join(root, 'notes', 'result.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
