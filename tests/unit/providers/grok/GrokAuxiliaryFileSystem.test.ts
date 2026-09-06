import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createGrokAuxiliaryFileSystem } from '@/providers/grok/execution/GrokAuxiliaryFileSystem';

/**
 * What an auxiliary Grok turn may reach on disk.
 *
 * The chat filesystem opts out of containment when the vault is set to
 * auto-approve. This one never does, and the reason is not symmetry: the user
 * who opted into unrestricted access opted in for the turn they can see, and an
 * auxiliary turn is one nobody asked for and nobody is watching.
 */
describe('Grok auxiliary filesystem', () => {
  it('stays in the vault and writes nothing, whatever the chat is set to', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grimoire-grok-aux-fs-'));
    const fileSystem = createGrokAuxiliaryFileSystem(() => root);
    try {
      await writeFile(join(root, 'note.md'), 'the note', 'utf8');
      const outside = join(dirname(root), 'elsewhere.md');
      await writeFile(outside, 'not the vault', 'utf8');

      // Reading inside is the whole reason an inline edit has a filesystem.
      await expect(fileSystem.readTextFile({ sessionId: 'aux', path: 'note.md' }))
        .resolves.toEqual({ content: 'the note' });
      await expect(fileSystem.readTextFile({ sessionId: 'aux', path: outside }))
        .rejects.toThrow(/workspace/i);
      // And it writes nothing at all, contained or not.
      await expect(fileSystem.writeTextFile({
        sessionId: 'aux',
        path: 'note.md',
        content: 'overwritten by a title generator',
      })).rejects.toThrow(/Grok Build/);
      await expect(readFile(join(root, 'note.md'), 'utf8')).resolves.toBe('the note');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(join(dirname(root), 'elsewhere.md'), { force: true });
    }
  });

  it('reads the vault path per call, because the vault can move under it', async () => {
    const first = await mkdtemp(join(tmpdir(), 'grimoire-grok-aux-fs-a-'));
    const second = await mkdtemp(join(tmpdir(), 'grimoire-grok-aux-fs-b-'));
    let root = first;
    const fileSystem = createGrokAuxiliaryFileSystem(() => root);
    try {
      await writeFile(join(first, 'note.md'), 'the first vault', 'utf8');
      await writeFile(join(second, 'note.md'), 'the second vault', 'utf8');

      await expect(fileSystem.readTextFile({ sessionId: 'aux', path: 'note.md' }))
        .resolves.toEqual({ content: 'the first vault' });
      root = second;
      // The factory is built once at plugin load and the vault is resolved from
      // the running app; capturing it would pin an auxiliary turn to wherever
      // the vault was when the composition was constructed.
      await expect(fileSystem.readTextFile({ sessionId: 'aux', path: 'note.md' }))
        .resolves.toEqual({ content: 'the second vault' });
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });
});
