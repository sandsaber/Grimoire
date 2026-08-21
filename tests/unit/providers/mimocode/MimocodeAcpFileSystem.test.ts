import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import trace from '@test/fixtures/provider-traces/mimocode-execution.json';

import { MimocodeAcpFileSystem } from '@/providers/mimocode/execution/MimocodeAcpFileSystem';

describe('MimocodeAcpFileSystem', () => {
  it('contains reads and approved writes to the session workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grimoire-mimocode-fs-'));
    const approvals: string[] = [];
    const operations: string[] = [];
    const fileSystem = new MimocodeAcpFileSystem({
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
    const root = await mkdtemp(join(tmpdir(), 'grimoire-mimocode-contained-'));
    const outside = join(dirname(root), 'outside-secret.md');
    await writeFile(outside, 'secret', 'utf8');
    const approveWrite = jest.fn(async () => true);
    const fileSystem = new MimocodeAcpFileSystem({
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
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });

  it('refuses a write in MiMoCode own name when the person said no', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grimoire-mimocode-refused-'));
    const fileSystem = new MimocodeAcpFileSystem({
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
      })).rejects.toThrow('MiMoCode file write was not approved.');
      await expect(readFile(join(root, 'notes', 'result.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
