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
