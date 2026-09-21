import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

/** Real disk storage for reload tests; only the Obsidian API boundary is replaced. */
export function nodeVaultAdapter(root: string): VaultFileAdapter {
  const full = (path: string) => join(root, path);
  return new VaultFileAdapter({ vault: { adapter: {
    exists: async (path: string) => existsSync(full(path)),
    read: async (path: string) => readFileSync(full(path), 'utf8'),
    write: async (path: string, content: string) => { writeFileSync(full(path), content); },
    readBinary: async (path: string) => Uint8Array.from(readFileSync(full(path))).buffer,
    writeBinary: async (path: string, bytes: ArrayBuffer) => { writeFileSync(full(path), Buffer.from(bytes)); },
    mkdir: async (path: string) => { mkdirSync(full(path), { recursive: true }); },
    rename: async (from: string, to: string) => { renameSync(full(from), full(to)); },
    remove: async (path: string) => { rmSync(full(path)); },
    rmdir: async (path: string) => { rmSync(full(path), { recursive: true }); },
    getResourcePath: (path: string) => pathToFileURL(full(path)).href,
    stat: async (path: string) => {
      const stat = statSync(full(path));
      return { mtime: stat.mtimeMs, size: stat.size };
    },
    list: async (path: string) => {
      const entries = readdirSync(full(path), { withFileTypes: true });
      return {
        files: entries.filter(entry => entry.isFile()).map(entry => join(path, entry.name)),
        folders: entries.filter(entry => entry.isDirectory()).map(entry => join(path, entry.name)),
      };
    },
  } } } as never);
}
