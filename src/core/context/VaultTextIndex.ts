import type { App, CachedMetadata } from 'obsidian';

import { isPathInExcludedFolder } from './exclusions';
import { tokenizeSearchText } from './text';

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

  constructor(private readonly app: App) {}

  async refresh(options: { excludedTags: string[]; excludedFolders: string[] }): Promise<void> {
    const excludedTags = new Set(options.excludedTags.map(normalizeTag));
    const documents = new Map<string, VaultIndexedDocument>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (isPathInExcludedFolder(file.path, options.excludedFolders)) {
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      const tags = extractTags(cache);

      if (hasExcludedTag(tags, excludedTags)) {
        continue;
      }

      const text = await this.app.vault.cachedRead(file);

      documents.set(file.path, {
        path: file.path,
        title: file.basename,
        text,
        terms: new Set(tokenizeSearchText(`${file.basename} ${file.path} ${text}`)),
        tags,
        links: extractLinks(cache),
        mtime: file.stat.mtime,
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

function extractTags(cache: CachedMetadata | null): Set<string> {
  const tags = new Set<string>();

  addFrontmatterTags(tags, cache?.frontmatter?.tags);

  for (const tag of cache?.tags ?? []) {
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

function extractLinks(cache: CachedMetadata | null): Set<string> {
  const links = new Set<string>();

  for (const link of cache?.links ?? []) {
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
