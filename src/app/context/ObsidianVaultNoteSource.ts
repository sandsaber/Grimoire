import type { App } from 'obsidian';

import type { VaultNote, VaultNoteSource } from '../../core/context/VaultTextIndex';

/**
 * The vault's markdown notes, as Obsidian hands them over.
 *
 * The adapter for `VaultTextIndex`'s port, and the only place that knows the
 * index reads Obsidian's metadata cache and its cached-read path rather than
 * plain files. It lives in `src/app` because that is where the plugin host is;
 * the index itself no longer imports one.
 */
export function createObsidianVaultNoteSource(app: App): VaultNoteSource {
  return {
    *markdownNotes(): Iterable<VaultNote> {
      for (const file of app.vault.getMarkdownFiles()) {
        yield {
          path: file.path,
          basename: file.basename,
          mtime: file.stat.mtime,
          cache: app.metadataCache.getFileCache(file),
          read: () => app.vault.cachedRead(file),
        };
      }
    },
  };
}
