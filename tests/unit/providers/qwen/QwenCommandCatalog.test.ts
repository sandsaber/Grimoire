import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { QwenCommandCatalog } from '@/providers/qwen/commands/QwenCommandCatalog';

function adapter(files: Record<string, string>): VaultFileAdapter {
  return {
    exists: jest.fn(async (path: string) => path in files || Object.keys(files).some((file) => file.startsWith(`${path}/`))),
    read: jest.fn(async (path: string) => files[path]), write: jest.fn(), delete: jest.fn(), ensureFolder: jest.fn(),
    listFilesRecursive: jest.fn(async (folder: string) => Object.keys(files).filter((file) => file.startsWith(`${folder}/`))),
    listFiles: jest.fn(async () => []), listFolders: jest.fn(async () => []), rename: jest.fn(), deleteFolderRecursive: jest.fn(),
  } as unknown as VaultFileAdapter;
}

describe('QwenCommandCatalog', () => {
  it('maps cached runtime commands into readonly slash dropdown entries', async () => {
    const catalog = new QwenCommandCatalog();
    catalog.setRuntimeCommands([
      {
        id: 'acp:/review',
        name: '/review',
        description: 'Review the current changes',
        argumentHint: '$1',
        content: '',
        source: 'sdk',
      },
      {
        id: 'acp:review-duplicate',
        name: 'review',
        description: 'Duplicate entry',
        content: '',
        source: 'sdk',
      },
    ]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([
      {
        id: 'acp:/review',
        providerId: 'qwen',
        kind: 'command',
        name: 'review',
        description: 'Review the current changes',
        content: '',
        argumentHint: '$1',
        scope: 'runtime',
        source: 'sdk',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      },
    ]);
  });

  it('does not load commands before an active Qwen session supplies them', async () => {
    const catalog = new QwenCommandCatalog();

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([]);
    await expect(catalog.listVaultEntries()).resolves.toEqual([]);
    expect(catalog.defaultVaultStoragePath()).toBe('.qwen/skills');
  });

  it('combines nested vault commands and skills with runtime commands, preferring runtime duplicates', async () => {
    const catalog = new QwenCommandCatalog(adapter({
      '.qwen/commands/review/security.md': '---\ndescription: Review security changes\ncustom: keep\n---\nReview the diff.',
      '.qwen/commands/review.md': 'Review the current work.',
      '.qwen/skills/guide/SKILL.md': '---\nname: guide\ndescription: A guide\n---\nUse this guide.',
    }));
    catalog.setRuntimeCommands([{ id: 'runtime-review', name: '/review', description: 'Runtime review', content: '', source: 'sdk' }]);

    await expect(catalog.listVaultEntries()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'review:security', kind: 'command', isEditable: true }),
      expect.objectContaining({ name: 'review', kind: 'command', isEditable: true }),
    ]));
    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'review', scope: 'runtime', isEditable: false }),
      expect.objectContaining({ name: 'review:security', scope: 'vault' }),
    ]));
  });

  it('maps colon namespaces back to nested files and rejects occupied targets', async () => {
    const mock = adapter({
      '.qwen/commands/review/security.md': '---\ndescription: Security\ncustom: keep\n---\nReview.',
      '.qwen/commands/taken.md': 'Taken.',
    });
    const catalog = new QwenCommandCatalog(mock);
    const command = (await catalog.listVaultEntries())
      .find((entry) => entry.name === 'review:security')!;

    await catalog.saveVaultEntry({ ...command, name: 'audit:security', content: 'Audit.' });
    expect(mock.write).toHaveBeenCalledWith(
      '.qwen/commands/audit/security.md',
      expect.stringContaining('custom: keep'),
    );
    expect(mock.delete).toHaveBeenCalledWith('.qwen/commands/review/security.md');
    await expect(catalog.saveVaultEntry({ ...command, name: 'taken' }))
      .rejects.toThrow('already exists');
  });

  it('edits commands whose optional YAML frontmatter is absent', async () => {
    const mock = adapter({ '.qwen/commands/review.md': 'Review the current work.' });
    const catalog = new QwenCommandCatalog(mock);
    const command = (await catalog.listVaultEntries()).find((entry) => entry.name === 'review')!;

    await expect(catalog.saveVaultEntry({ ...command, content: 'Review carefully.' })).resolves.toBeUndefined();
    expect(mock.write).toHaveBeenCalledWith(
      '.qwen/commands/review.md',
      expect.stringContaining('Review carefully.'),
    );
  });
});
