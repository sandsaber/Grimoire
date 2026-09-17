import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { getBundledChangelogPath, getEmbeddedChangelogMarkdown, readBundledChangelog } from '@/app/changelog/source';

describe('changelog source', () => {
  it('recovers the complete source changelog from the compressed release payload', () => {
    const markdown = readFileSync('CHANGELOG.md', 'utf8');
    Object.assign(globalThis, { GRIMOIRE_CHANGELOG_GZIP: gzipSync(markdown).toString('base64') });
    try {
      expect(getEmbeddedChangelogMarkdown()).toBe(markdown);
    } finally {
      Reflect.deleteProperty(globalThis, 'GRIMOIRE_CHANGELOG_GZIP');
    }
  });

  it('uses manifest.dir when available', () => {
    expect(getBundledChangelogPath({ id: 'grimoire', dir: '.obsidian/plugins/grimoire' })).toBe(
      '.obsidian/plugins/grimoire/CHANGELOG.md',
    );
  });

  it('falls back to the plugin id when manifest.dir is missing', () => {
    expect(getBundledChangelogPath({ id: 'grimoire' })).toBe(
      '.obsidian/plugins/grimoire/CHANGELOG.md',
    );
  });

  it('reads the bundled changelog and returns null on failure', async () => {
    const adapter = {
      read: jest.fn()
        .mockResolvedValueOnce('# Changelog')
        .mockRejectedValueOnce(new Error('missing')),
    };

    await expect(readBundledChangelog(adapter as any, { id: 'grimoire' })).resolves.toBe('# Changelog');
    await expect(readBundledChangelog(adapter as any, { id: 'grimoire' })).resolves.toBeNull();
  });

  it('prefers embedded changelog markdown over adapter reads', async () => {
    const adapter = {
      read: jest.fn().mockResolvedValue('# File changelog'),
    };

    await expect(readBundledChangelog(
      adapter as any,
      { id: 'grimoire' },
      { embeddedMarkdown: '# Embedded changelog' },
    )).resolves.toBe('# Embedded changelog');
    expect(adapter.read).not.toHaveBeenCalled();
  });
});
