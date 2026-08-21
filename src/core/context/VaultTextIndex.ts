import { isPathInExcludedFolder } from './exclusions';
import { tokenizeSearchText } from './text';

/**
 * One markdown note, as the index needs it.
 *
 * A port rather than the vault adapter, and rather than Obsidian's `App`. This
 * is not file I/O: the index wants the *document* model — the metadata cache's
 * tags and links, and the cached read tied to Obsidian's own file objects —
 * none of which the storage adapter offers or should grow to. Reading it
 * through a contract is what keeps this module in `src/core` honestly: it now
 * depends on what it needs rather than on the plugin host.
 */
export interface VaultNote {
  readonly path: string;
  readonly basename: string;
  readonly mtime: number;
  /** Obsidian's file cache for this note, read only through the extractors. */
  readonly cache: unknown;
  read(): Promise<string>;
}

export interface VaultNoteSource {
  markdownNotes(): Iterable<VaultNote>;
}

export interface VaultIndexedDocument {
  path: string;
  title: string;
  text: string;
  terms: Set<string>;
  tags: Set<string>;
  links: Set<string>;
  mtime: number;
}

export class VaultTextIndex {
  private readonly documents = new Map<string, VaultIndexedDocument>();

  constructor(private readonly notes: VaultNoteSource) {}

  async refresh(options: { excludedTags: string[]; excludedFolders: string[] }): Promise<void> {
    const excludedTags = new Set(options.excludedTags.map(normalizeTag));
    const documents = new Map<string, VaultIndexedDocument>();

    for (const note of this.notes.markdownNotes()) {
      if (isPathInExcludedFolder(note.path, options.excludedFolders)) {
        continue;
      }

      const tags = extractTags(note.cache);

      if (hasExcludedTag(tags, excludedTags)) {
        continue;
      }

      const text = await note.read();

      documents.set(note.path, {
        path: note.path,
        title: note.basename,
        text,
        terms: new Set(tokenizeSearchText(`${note.basename} ${note.path} ${text}`)),
        tags,
        links: extractLinks(note.cache),
        mtime: note.mtime,
      });
    }

    this.documents.clear();
    for (const [path, document] of documents) {
      this.documents.set(path, document);
    }
  }

  markDirty(path?: string): void {
    if (path === undefined) {
      this.documents.clear();
      return;
    }

    this.documents.delete(path);
  }

  getAllDocuments(): VaultIndexedDocument[] {
    return Array.from(this.documents.values());
  }

  getByPath(path: string): VaultIndexedDocument | null {
    return this.documents.get(path) ?? null;
  }
}

function extractTags(cache: unknown): Set<string> {
  const tags = new Set<string>();
  const fileCache = cache as {
    frontmatter?: { tags?: unknown };
    tags?: Array<{ tag?: unknown }>;
  } | null;

  addFrontmatterTags(tags, fileCache?.frontmatter?.tags);

  for (const tag of fileCache?.tags ?? []) {
    if (typeof tag.tag === 'string') {
      tags.add(normalizeTag(tag.tag));
    }
  }

  return tags;
}

function addFrontmatterTags(tags: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const tag of value) {
      if (typeof tag === 'string') {
        tags.add(normalizeTag(tag));
      }
    }
    return;
  }

  if (typeof value === 'string') {
    tags.add(normalizeTag(value));
  }
}

function extractLinks(cache: unknown): Set<string> {
  const links = new Set<string>();
  const fileCache = cache as { links?: Array<{ link?: unknown }> } | null;

  for (const link of fileCache?.links ?? []) {
    if (typeof link.link === 'string') {
      links.add(link.link);
    }
  }

  return links;
}

function hasExcludedTag(tags: Set<string>, excludedTags: Set<string>): boolean {
  for (const tag of tags) {
    if (excludedTags.has(tag)) {
      return true;
    }
  }

  return false;
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#+/u, '');
}
