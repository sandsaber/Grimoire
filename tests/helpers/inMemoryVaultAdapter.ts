import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

/**
 * A vault file adapter backed by a map of real file contents.
 *
 * Storage tests usually assert against a mocked `write` call. Byte preservation
 * cannot be asserted that way: it needs a store that actually holds what was
 * written so a load-save cycle can be compared against the original file.
 */
export interface InMemoryVaultAdapter extends VaultFileAdapter {
  files: Map<string, string>;
}

export function createInMemoryVaultAdapter(
  initialFiles: Record<string, string> = {},
): InMemoryVaultAdapter {
  const files = new Map(Object.entries(initialFiles));

  const adapter = {
    files,
    exists: async (path: string) => files.has(path),
    read: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return content;
    },
    write: async (path: string, content: string) => {
      files.set(path, content);
    },
    append: async (path: string, content: string) => {
      files.set(path, (files.get(path) ?? '') + content);
    },
    delete: async (path: string) => {
      files.delete(path);
    },
    deleteFolder: async (path: string) => {
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`)) {
          files.delete(key);
        }
      }
    },
    listFiles: async (path: string) =>
      [...files.keys()].filter(key => key.startsWith(`${path}/`)),
  };

  return adapter as unknown as InMemoryVaultAdapter;
}

/**
 * The same store, with the members a durable writer needs.
 *
 * `VaultDurableStorage` replaces a file by writing beside it and renaming, and
 * it serializes per path against the adapter's backing store — so a double that
 * a `SessionStorage` writes through has to answer those three as well.
 */
export function createDurableInMemoryVaultAdapter(
  initialFiles: Record<string, string> = {},
): InMemoryVaultAdapter {
  const adapter = createInMemoryVaultAdapter(initialFiles);
  const files = adapter.files;
  const coordinationKey = {};
  return Object.assign(adapter, {
    coordinationKey,
    rename: async (from: string, to: string) => {
      const content = files.get(from);
      if (content === undefined) {
        throw new Error(`ENOENT: ${from}`);
      }
      files.delete(from);
      files.set(to, content);
    },
    listFilesRecursive: async (path: string) =>
      [...files.keys()].filter(key => key.startsWith(`${path}/`)),
  });
}
