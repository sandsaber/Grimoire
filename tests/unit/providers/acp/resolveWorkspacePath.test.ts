import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveWorkspacePath } from '@/providers/acp/resolveWorkspacePath';

// Resolved rather than written as a literal: resolveWorkspacePath runs every
// input through path.resolve, so on Windows the workspace root carries the
// current drive and separators the POSIX literal never would.
const CWD = path.resolve('/tmp/grimoire-test-vault');

describe('resolveWorkspacePath', () => {
  describe('when containment is enforced (safe/plan mode)', () => {
    it('resolves a relative path inside the workspace', () => {
      expect(resolveWorkspacePath(CWD, 'notes/today.md')).toBe(path.join(CWD, 'notes', 'today.md'));
    });

    it('allows an absolute path that stays inside the workspace', () => {
      const inside = path.join(CWD, 'notes', 'today.md');

      expect(resolveWorkspacePath(CWD, inside)).toBe(inside);
    });

    it('allows the workspace root itself', () => {
      expect(resolveWorkspacePath(CWD, CWD)).toBe(CWD);
    });

    it('rejects a relative path that escapes the workspace', () => {
      expect(() => resolveWorkspacePath(CWD, '../../etc/hosts')).toThrow(
        'File access is limited to the current workspace.',
      );
    });

    it('rejects an absolute path outside the workspace', () => {
      expect(() => resolveWorkspacePath(CWD, '/etc/hosts')).toThrow(
        'File access is limited to the current workspace.',
      );
    });

    it('uses a custom containment message when provided', () => {
      expect(() => resolveWorkspacePath(CWD, '/etc/hosts', {
        containmentMessage: 'OpenCode aux read access is limited to the current workspace.',
      })).toThrow('OpenCode aux read access is limited to the current workspace.');
    });

    it('rejects a workspace-relative symlink that escapes the workspace', () => {
      if (process.platform === 'win32') {
        return;
      }

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-workspace-'));
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-outside-'));
      const linkPath = path.join(root, 'escape-link');
      const outsideFile = path.join(outside, 'secret.md');
      try {
        fs.writeFileSync(outsideFile, 'secret');
        fs.symlinkSync(outside, linkPath);
        expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
        // Ensure the linked file is readable through the symlink before asserting
        // containment (realpath of a missing target is platform-dependent).
        expect(fs.readFileSync(path.join(linkPath, 'secret.md'), 'utf8')).toBe('secret');
        expect(() => resolveWorkspacePath(root, 'escape-link/secret.md')).toThrow(
          'File access is limited to the current workspace.',
        );
      } finally {
        fs.rmSync(root, { force: true, recursive: true });
        fs.rmSync(outside, { force: true, recursive: true });
      }
    });
  });

  describe('when containment is disabled (active / full_access mode)', () => {
    it('returns an absolute path outside the workspace unchanged', () => {
      expect(resolveWorkspacePath(CWD, '/etc/hosts', { allowOutsideWorkspace: true }))
        .toBe(path.resolve('/etc/hosts'));
    });

    it('returns an escaping relative path resolved against the workspace', () => {
      expect(resolveWorkspacePath(CWD, '../sibling/file.md', { allowOutsideWorkspace: true })).toBe(
        path.join(path.dirname(CWD), 'sibling', 'file.md'),
      );
    });
  });
});
