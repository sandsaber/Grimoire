import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { DevinCommandCatalog } from '@/providers/devin/commands/DevinCommandCatalog';

function adapter(files: Record<string, string>): VaultFileAdapter {
  const folders = new Set(Object.keys(files).flatMap((file) => {
    const parts = file.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }));
  return {
    exists: jest.fn(async (path: string) => path in files || folders.has(path)),
    read: jest.fn(async (path: string) => files[path]),
    write: jest.fn(), delete: jest.fn(), ensureFolder: jest.fn(), rename: jest.fn(), deleteFolderRecursive: jest.fn(),
    listFiles: jest.fn(async (folder: string) => Object.keys(files)
      .filter((file) => file.startsWith(`${folder}/`) && !file.slice(folder.length + 1).includes('/'))),
    listFolders: jest.fn(async (folder: string) => [...folders]
      .filter((entry) => entry.startsWith(`${folder}/`) && !entry.slice(folder.length + 1).includes('/'))),
  } as unknown as VaultFileAdapter;
}

describe('DevinCommandCatalog', () => {
  it('maps cached runtime commands into readonly slash dropdown entries', async () => {
    const catalog = new DevinCommandCatalog();
    catalog.setRuntimeCommands([
      { id: 'acp:/status', name: '/status', description: 'Check authentication status', content: '', source: 'sdk' },
      { id: 'acp:status-duplicate', name: 'status', description: 'Duplicate entry', content: '', source: 'sdk' },
    ]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([
      expect.objectContaining({
        id: 'acp:/status',
        providerId: 'devin',
        kind: 'command',
        name: 'status',
        scope: 'runtime',
        isEditable: false,
      }),
    ]);
  });

  it('lists nothing before an active Devin session supplies commands', async () => {
    const catalog = new DevinCommandCatalog();

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([]);
    await expect(catalog.listVaultEntries()).resolves.toEqual([]);
    expect(catalog.defaultVaultStoragePath()).toBe('.devin/skills');
  });

  it('lists the vault skills from both roots the CLI scans, behind runtime duplicates', async () => {
    // `devin skills paths`: `.devin/skills` and the cross-provider `.agents/skills`.
    const catalog = new DevinCommandCatalog(adapter({
      '.devin/skills/guide/SKILL.md': '---\nname: guide\ndescription: A guide\n---\nUse this guide.',
      '.agents/skills/shared/SKILL.md': '---\nname: shared\ndescription: Shared\n---\nShared skill.',
    }));
    catalog.setRuntimeCommands([{ id: 'runtime-guide', name: '/guide', description: 'Runtime guide', content: '', source: 'sdk' }]);

    const vault = await catalog.listVaultEntries();
    expect(vault.map((entry) => `${entry.kind}:${entry.name}`).sort()).toEqual(['skill:guide', 'skill:shared']);

    const dropdown = await catalog.listDropdownEntries({ includeBuiltIns: false });
    expect(dropdown.find((entry) => entry.name === 'guide')?.scope).toBe('runtime');
    expect(dropdown.some((entry) => entry.name === 'shared')).toBe(true);
  });
});
