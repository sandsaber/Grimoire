import type { App, TFile } from 'obsidian';

import { createObsidianVaultNoteSource } from '@/app/context/ObsidianVaultNoteSource';
import type { VaultSearchQuery } from '@/core/context/types';
import { VaultSearchService } from '@/core/context/VaultSearchService';
import { VaultTextIndex } from '@/core/context/VaultTextIndex';

function createFile(path: string, mtime: number): TFile {
  const basename = path.split('/').pop()?.replace(/\.md$/u, '') ?? path;

  return {
    path,
    name: `${basename}.md`,
    basename,
    stat: { mtime, ctime: mtime, size: 0 },
  } as TFile;
}

function createApp(files: TFile[], contents: Record<string, string>): App {
  return {
    vault: {
      getMarkdownFiles: jest.fn(() => files),
      cachedRead: jest.fn((file: TFile) => Promise.resolve(contents[file.path] ?? '')),
    },
    metadataCache: {
      getFileCache: jest.fn(() => null),
    },
  } as unknown as App;
}

/**
 * The index takes a note source now, not the plugin host.
 *
 * The double still speaks Obsidian, because the adapter is what translates —
 * so this exercises the same translation production uses rather than a second
 * one written for the test.
 */
function createNotes(files: TFile[], contents: Record<string, string>) {
  return createObsidianVaultNoteSource(createApp(files, contents));
}

function createQuery(overrides: Partial<VaultSearchQuery> = {}): VaultSearchQuery {
  return {
    raw: 'roadmap',
    terms: ['roadmap'],
    maxResults: 5,
    maxSnippetChars: 120,
    excludedTags: [],
    excludedFolders: [],
    ...overrides,
  };
}

describe('VaultSearchService', () => {
  it('ranks title matches before body-only matches and formats XML with query and path', async () => {
    const titleFile = createFile('notes/Roadmap.md', 100);
    const bodyFile = createFile('notes/Ideas.md', 300);
    const index = new VaultTextIndex(
      createNotes([titleFile, bodyFile], {
        'notes/Roadmap.md': 'Sparse planning note',
        'notes/Ideas.md': 'The roadmap appears in body text several times. roadmap roadmap.',
      })
    );
    const service = new VaultSearchService(index);

    const result = await service.search(createQuery());
    const prompt = service.formatForPrompt(result);

    expect(result.snippets.map((snippet) => snippet.source.path)).toEqual([
      'notes/Roadmap.md',
      'notes/Ideas.md',
    ]);
    expect(result.snippets[0].source).toMatchObject({
      id: 'v1',
      kind: 'vault-note',
      title: 'Roadmap',
    });
    expect(prompt).toContain('<vault_search query="roadmap">');
    expect(prompt).toContain('path="notes/Roadmap.md"');
  });

  it('extracts a query after a standalone vault mention', () => {
    const service = new VaultSearchService(new VaultTextIndex(createNotes([], {})));

    expect(service.extractVaultQuery('@vault roadmap')).toBe('roadmap');
  });

  it('falls back to the full input without the vault mention when mention has no trailing query', () => {
    const service = new VaultSearchService(new VaultTextIndex(createNotes([], {})));

    expect(service.extractVaultQuery('ask @vault')).toBe('ask');
  });

  it('does not match email addresses or longer mentions', () => {
    const service = new VaultSearchService(new VaultTextIndex(createNotes([], {})));

    expect(service.extractVaultQuery('email@vault.com')).toBeNull();
    expect(service.extractVaultQuery('@vaulted thing')).toBeNull();
  });

  it('removes other file mentions from the extracted query', () => {
    const service = new VaultSearchService(new VaultTextIndex(createNotes([], {})));

    expect(service.extractVaultQuery('ask @vault @file roadmap')).toBe('roadmap');
  });

  it('removes full file mentions with spaces before extracting the search query', () => {
    const service = new VaultSearchService(new VaultTextIndex(createNotes([], {})));

    expect(service.extractVaultQuery('@vault @Artic Ocean.md')).toBe('');
    expect(service.extractVaultQuery('@vault @Artic Ocean.md climate notes')).toBe('climate notes');
  });

  it('escapes XML attributes and text in formatted prompts', () => {
    const service = new VaultSearchService(new VaultTextIndex(createNotes([], {})));

    const prompt = service.formatForPrompt({
      query: createQuery({ raw: 'a "quoted" & <unsafe>' }),
      snippets: [
        {
          source: {
            id: 'v1',
            kind: 'vault-note',
            path: 'notes/A&B.md',
            title: 'A "Title" <Tag>',
          },
          text: 'Use <xml> & "quotes"',
          score: 12.345,
          matchedTerms: ['unsafe'],
        },
      ],
    });

    expect(prompt).toContain(
      '<vault_search query="a &quot;quoted&quot; &amp; &lt;unsafe&gt;">'
    );
    expect(prompt).toContain('path="notes/A&amp;B.md"');
    expect(prompt).toContain('title="A &quot;Title&quot; &lt;Tag&gt;"');
    expect(prompt).toContain('score="12.35"');
    expect(prompt).toContain('Use &lt;xml&gt; &amp; "quotes"');
  });
});
