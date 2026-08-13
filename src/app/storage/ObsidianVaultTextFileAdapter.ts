import { Notice, type TFile,type Vault } from 'obsidian';

import type { AtomicTextFileAdapter } from './VaultDurableStorage';

const MAX_LIST_ENTRIES = 10_000;

/**
 * Bridges the Obsidian Vault API to the AtomicTextFileAdapter contract
 * for durable storage. All reads and writes go through the vault's
 * coordinated file API using vault-relative paths.
 */
export class ObsidianVaultTextFileAdapter implements AtomicTextFileAdapter {
  readonly coordinationKey: object;

  constructor(
    private readonly vault: Vault,
    /**
     * Retained for callers that need the absolute vault path (e.g. process
     * spawn CWD). This adapter itself uses vault-relative paths only.
     */
    _vaultBasePath?: string,
  ) {
    this.coordinationKey = vault;
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalize(path);
    if (!normalized) return false;
    return this.vault.adapter.exists(normalized);
  }

  async read(path: string): Promise<string> {
    const normalized = this.normalize(path);
    if (!normalized) throw new Error(`Vault path "${path}" is invalid.`);
    return this.vault.adapter.read(normalized);
  }

  async readBounded(path: string, maxBytes: number): Promise<string> {
    const normalized = this.normalize(path);
    if (!normalized) throw new Error(`Vault path "${path}" is invalid.`);
    const buffer = await this.vault.adapter.readBinary(normalized);
    const bytes = buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer, 0, Math.min(buffer.byteLength, maxBytes))
      : new Uint8Array(buffer);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  async write(path: string, content: string): Promise<void> {
    const normalized = this.normalize(path);
    if (!normalized) throw new Error(`Vault path "${path}" is invalid.`);
    await this.ensureDirectory(normalized);
    await this.vault.adapter.write(normalized, content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldNormalized = this.normalize(oldPath);
    const newNormalized = this.normalize(newPath);
    if (!oldNormalized || !newNormalized) throw new Error('Vault rename paths are invalid.');
    await this.ensureDirectory(newNormalized);
    await this.vault.adapter.rename(oldNormalized, newNormalized);
  }

  async delete(path: string): Promise<void> {
    const normalized = this.normalize(path);
    if (!normalized) return;
    // delete() must be idempotent: the durable storage layer calls it on
    // .pending/.backup companions that may not exist. Obsidian's remove()
    // throws ENOENT on missing files, so swallow that error.
    try {
      await this.vault.adapter.remove(normalized);
    } catch (error) {
      if (!isENOENT(error)) throw error;
    }
  }

  async listFilesRecursive(path: string): Promise<string[]> {
    const normalized = this.normalize(path);
    if (!normalized) return [];
    const results: string[] = [];
    await this.collectFiles(normalized, results);
    return results.slice(0, MAX_LIST_ENTRIES);
  }

  /**
   * Returns the vault-relative path for storage operations.
   * The vault adapter expects paths relative to the vault root (e.g.
   * `.grimoire/control/conversations/foo.json`), NOT absolute filesystem
   * paths. The vaultBasePath is retained only for adapter compatibility.
   */
  private normalize(path: string): string | null {
    if (!path.startsWith('.grimoire/')) return null;
    return path;
  }

  private async ensureDirectory(fullPath: string): Promise<void> {
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash <= 0) return;
    const dir = fullPath.slice(0, lastSlash);
    if (!(await this.vault.adapter.exists(dir))) {
      try {
        await this.vault.adapter.mkdir(dir);
      } catch {
        new Notice('Failed to create vault directory.');
      }
    }
  }

  private async collectFiles(dir: string, results: string[]): Promise<void> {
    if (results.length >= MAX_LIST_ENTRIES) return;
    let entries;
    try {
      entries = await this.vault.adapter.list(dir);
    } catch {
      return;
    }
    // vault.adapter.list() returns vault-relative paths already in the
    // normalized format this adapter uses (.grimoire/...).
    for (const file of entries.files) {
      if (results.length >= MAX_LIST_ENTRIES) return;
      results.push(file);
    }
    for (const folder of entries.folders) {
      await this.collectFiles(folder, results);
    }
  }
}

export type { TFile,Vault };

/**
 * Returns true when an error is a "file not found" error from the vault
 * adapter (Node ENOENT or Obsidian's normalized equivalent).
 */
function isENOENT(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return true;
  // Obsidian may wrap the error or use a message-only form.
  return /ENOENT|no such file or directory/i.test(error.message);
}
