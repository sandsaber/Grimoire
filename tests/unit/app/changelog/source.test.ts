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
    expect(getBundledChangelogPath({ id: 'grimoire', dir: '.obsidian/plugins/grimoire' }, '.custom-config')).toBe(
      '.obsidian/plugins/grimoire/CHANGELOG.md',
    );
  });

  it('uses the configured folder when manifest.dir is missing', () => {
    expect(getBundledChangelogPath({ id: 'grimoire' }, '.custom-config')).toBe(
      '.custom-config/plugins/grimoire/CHANGELOG.md',
    );
  });

  it('reads the bundled changelog and returns null on failure', async () => {
    const adapter = {
      read: jest.fn()
        .mockResolvedValueOnce('# Changelog')
        .mockRejectedValueOnce(new Error('missing')),
    };

    const vault = { adapter, configDir: '.custom-config' };
    await expect(readBundledChangelog(vault, { id: 'grimoire' })).resolves.toBe('# Changelog');
    expect(adapter.read).toHaveBeenCalledWith('.custom-config/plugins/grimoire/CHANGELOG.md');
    await expect(readBundledChangelog(vault, { id: 'grimoire' })).resolves.toBeNull();
  });

  it('prefers embedded changelog markdown over adapter reads', async () => {
    const adapter = {
      read: jest.fn().mockResolvedValue('# File changelog'),
    };

    await expect(readBundledChangelog(
      { adapter, configDir: '.custom-config' },
      { id: 'grimoire' },
      { embeddedMarkdown: '# Embedded changelog' },
    )).resolves.toBe('# Embedded changelog');
    expect(adapter.read).not.toHaveBeenCalled();
  });
});
