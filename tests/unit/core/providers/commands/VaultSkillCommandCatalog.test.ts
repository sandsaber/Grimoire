import { VaultSkillCommandCatalog } from '@/core/providers/commands/VaultSkillCommandCatalog';

function createAdapter(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  return {
    delete: jest.fn(async (path: string) => { files.delete(path); }),
    deleteFolderRecursive: jest.fn(async (path: string) => {
      for (const file of Array.from(files.keys())) {
        if (file.startsWith(`${path}/`)) files.delete(file);
      }
    }),
    ensureFolder: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn(async (path: string) => (
      files.has(path) || Array.from(files.keys()).some((file) => file.startsWith(`${path}/`))
    )),
    listFiles: jest.fn(async (root: string) => Array.from(files.keys()).filter((path) => (
      path.startsWith(`${root}/`)
      && !path.slice(root.length + 1).includes('/')
    ))),
    listFolders: jest.fn(async (root: string) => Array.from(new Set(
      Array.from(files.keys())
        .filter((path) => path.startsWith(`${root}/`))
        .map((path) => path.slice(root.length + 1).split('/'))
        .filter((parts) => parts.length > 1)
        .map(([folder]) => `${root}/${folder}`),
    ))),
    read: jest.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`Missing ${path}`);
      return value;
    }),
    rename: jest.fn(async (oldPath: string, newPath: string) => {
      const moved = Array.from(files.entries()).filter(([path]) => (
        path === oldPath || path.startsWith(`${oldPath}/`)
      ));
      if (moved.length === 0) throw new Error(`Missing ${oldPath}`);
      for (const [path] of moved) files.delete(path);
      for (const [path, content] of moved) {
        files.set(`${newPath}${path.slice(oldPath.length)}`, content);
      }
    }),
    write: jest.fn(async (path: string, content: string) => { files.set(path, content); }),
    files,
  };
}

function createCatalog(adapter: ReturnType<typeof createAdapter>) {
  return new VaultSkillCommandCatalog(adapter, {
    providerId: 'kimicode',
    roots: [
      { id: 'kimi', path: '.kimi-code/skills', editable: true, includeFlatFiles: true },
      { id: 'agents', path: '.agents/skills', editable: true },
      { id: 'claude', path: '.claude/skills', editable: false },
    ],
    dropdown: {
      triggerChars: ['/'],
      builtInPrefix: '/',
      commandPrefix: '/',
      skillPrefix: '/skill:',
    },
  });
}

describe('VaultSkillCommandCatalog', () => {
  it('lists directory and flat project skills with their real source paths', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n\nReview it.',
      '.kimi-code/skills/commit.md': '---\nname: commit\ndescription: Commit code\n---\n\nCommit it.',
      '.claude/skills/shared/SKILL.md': '---\nname: shared\ndescription: Shared skill\n---\n\nShare it.',
    });

    const entries = await createCatalog(adapter).listVaultEntries();

    expect(entries.map(({ name, storagePath, isEditable }) => ({ name, storagePath, isEditable })))
      .toEqual([
        { name: 'review', storagePath: '.kimi-code/skills', isEditable: true },
        { name: 'commit', storagePath: '.kimi-code/skills', isEditable: true },
        { name: 'shared', storagePath: '.claude/skills', isEditable: false },
      ]);
  });

  it('preserves provider-native frontmatter fields when editing a skill', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': [
        '---',
        'name: review',
        'description: Review code',
        'type: flow',
        'whenToUse: Before merging',
        'arguments:',
        '  - target',
        '---',
        '',
        'Review $target.',
      ].join('\n'),
    });
    const catalog = createCatalog(adapter);
    const [entry] = await catalog.listVaultEntries();

    await catalog.saveVaultEntry({
      ...entry,
      description: 'Review carefully',
      content: 'Review the target carefully.',
    });

    const saved = adapter.files.get('.kimi-code/skills/review/SKILL.md') ?? '';
    expect(saved).toContain('description: Review carefully');
    expect(saved).toContain('type: flow');
    expect(saved).toContain('whenToUse: Before merging');
    expect(saved).toContain('- target');
    expect(saved).toContain('Review the target carefully.');
  });

  it('does not overwrite an existing skill when reading it fails', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n\nReview it.',
    });
    const catalog = createCatalog(adapter);
    const [entry] = await catalog.listVaultEntries();
    adapter.read.mockRejectedValueOnce(new Error('Transient vault read failure'));

    await expect(catalog.saveVaultEntry({ ...entry, description: 'Changed' }))
      .rejects.toThrow('Transient vault read failure');

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.files.get('.kimi-code/skills/review/SKILL.md')).toContain('Review code');
  });

  it('does not overwrite an existing skill with invalid frontmatter', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': [
        '---',
        'name: review',
        'description: Review code',
        'provider-metadata: [one',
        '---',
        '',
        'Original body.',
      ].join('\n'),
    });
    const catalog = createCatalog(adapter);
    const entry = {
      id: 'kimicode-skill-kimi-directory-review',
      providerId: 'kimicode' as const,
      kind: 'skill' as const,
      name: 'review',
      description: 'Changed',
      content: 'Changed body.',
      scope: 'vault' as const,
      source: 'user' as const,
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/skill:',
      insertPrefix: '/skill:',
      persistenceKey: 'vault-skill:kimi:directory:review',
    };

    await expect(catalog.saveVaultEntry(entry))
      .rejects.toThrow('Cannot safely edit a skill with invalid frontmatter.');

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.files.get('.kimi-code/skills/review/SKILL.md')).toContain('provider-metadata: [one');
  });

  it('preserves a directory skill bundle when renaming it', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n\nReview it.',
      '.kimi-code/skills/review/scripts/check.sh': '#!/bin/sh',
      '.kimi-code/skills/review/references/rules.md': 'Rules',
    });
    const catalog = createCatalog(adapter);
    const [entry] = await catalog.listVaultEntries();

    await catalog.saveVaultEntry({ ...entry, name: 'review-pr' });

    expect(adapter.files.has('.kimi-code/skills/review/SKILL.md')).toBe(false);
    expect(adapter.files.has('.kimi-code/skills/review/scripts/check.sh')).toBe(false);
    expect(adapter.files.get('.kimi-code/skills/review-pr/scripts/check.sh')).toBe('#!/bin/sh');
    expect(adapter.files.get('.kimi-code/skills/review-pr/references/rules.md')).toBe('Rules');
    expect(adapter.files.get('.kimi-code/skills/review-pr/SKILL.md')).toContain('name: review-pr');
  });

  it('deletes the complete directory skill bundle', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n\nReview it.',
      '.kimi-code/skills/review/scripts/check.sh': '#!/bin/sh',
    });
    const catalog = createCatalog(adapter);
    const [entry] = await catalog.listVaultEntries();

    await catalog.deleteVaultEntry(entry);

    expect(Array.from(adapter.files.keys())).toEqual([]);
    expect(adapter.deleteFolderRecursive).toHaveBeenCalledWith('.kimi-code/skills/review');
  });

  it('lets Kimi directory skills override flat skills with the same name', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': '---\nname: review\ndescription: Directory skill\n---\n\nDirectory.',
      '.kimi-code/skills/review.md': '---\nname: review\ndescription: Flat skill\n---\n\nFlat.',
    });

    const entries = await createCatalog(adapter).listVaultEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'review', description: 'Directory skill' });
    expect(entries[0]?.persistenceKey).toContain(':directory:');
  });

  it('falls back to a valid Kimi flat skill when the directory bundle has no SKILL.md', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/scripts/check.sh': '#!/bin/sh',
      '.kimi-code/skills/review.md': '---\nname: review\ndescription: Flat skill\n---\n\nFlat.',
    });

    const entries = await createCatalog(adapter).listVaultEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'review', description: 'Flat skill' });
    expect(entries[0]?.persistenceKey).toContain(':flat:');
  });

  it('falls back to a valid Kimi flat skill when directory frontmatter is malformed', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': '---\nname: review\nmetadata: [one\n---\n\nBroken.',
      '.kimi-code/skills/review.md': '---\nname: review\ndescription: Flat skill\n---\n\nFlat.',
    });

    const entries = await createCatalog(adapter).listVaultEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'review', description: 'Flat skill' });
    expect(entries[0]?.persistenceKey).toContain(':flat:');
  });

  it('creates new skills in the provider-specific root and preserves flat form on rename', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/old.md': '---\nname: old\ndescription: Old skill\n---\n\nOld body.',
    });
    const catalog = createCatalog(adapter);
    const [existing] = await catalog.listVaultEntries();

    await catalog.saveVaultEntry({ ...existing, name: 'renamed' });
    await catalog.saveVaultEntry({
      id: 'kimicode-skill-new',
      providerId: 'kimicode',
      kind: 'skill',
      name: 'new-skill',
      description: 'New skill',
      content: 'New body.',
      scope: 'vault',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/skill:',
      insertPrefix: '/skill:',
    });

    expect(adapter.files.has('.kimi-code/skills/old.md')).toBe(false);
    expect(adapter.files.has('.kimi-code/skills/renamed.md')).toBe(true);
    expect(adapter.files.has('.kimi-code/skills/new-skill/SKILL.md')).toBe(true);
  });

  it('rejects new skills without the description required by provider runtimes', async () => {
    const adapter = createAdapter();
    const catalog = createCatalog(adapter);

    await expect(catalog.saveVaultEntry({
      id: 'kimicode-skill-invalid',
      providerId: 'kimicode',
      kind: 'skill',
      name: 'invalid',
      content: 'Missing description.',
      scope: 'vault',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/skill:',
      insertPrefix: '/skill:',
    })).rejects.toThrow('Skill description is required.');
  });

  it('exposes the primary editable root for UI collision checks', () => {
    const catalog = createCatalog(createAdapter());

    expect(catalog.defaultVaultStoragePath()).toBe('.kimi-code/skills');
  });

  it('does not overwrite an existing skill when creating a duplicate in the primary root', async () => {
    const adapter = createAdapter({
      '.kimi-code/skills/review/SKILL.md': '---\nname: review\ndescription: Original\n---\n\nOriginal body.',
    });
    const catalog = createCatalog(adapter);

    await expect(catalog.saveVaultEntry({
      id: 'kimicode-skill-new-review',
      providerId: 'kimicode',
      kind: 'skill',
      name: 'review',
      description: 'Replacement',
      content: 'Replacement body.',
      scope: 'vault',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/skill:',
      insertPrefix: '/skill:',
    })).rejects.toThrow('A skill already exists');

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.files.get('.kimi-code/skills/review/SKILL.md')).toContain('Original body.');
  });
});
