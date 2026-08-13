import { Notice, type TFile,type Vault } from 'obsidian';

import type { AtomicTextFileAdapter } from './VaultDurableStorage';

const MAX_LIST_ENTRIES = 10_000;

/**
 * Bridges the Obsidian Vault API to the AtomicTextFileAdapter contract
 * for durable storage. All reads and writes go through the vault's
 * coordinated file API.
 */
export class ObsidianVaultTextFileAdapter implements AtomicTextFileAdapter {
  readonly coordinationKey: object;

  constructor(
    private readonly vault: Vault,
    private readonly vaultBasePath: string,
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
    await this.vault.adapter.remove(normalized);
  }

  async listFilesRecursive(path: string): Promise<string[]> {
    const normalized = this.normalize(path);
    if (!normalized) return [];
    const results: string[] = [];
    await this.collectFiles(normalized, results);
    return results.slice(0, MAX_LIST_ENTRIES);
  }

  private normalize(path: string): string | null {
    if (!path.startsWith('.grimoire/')) return null;
    return `${this.vaultBasePath}/${path}`;
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
    for (const file of entries.files) {
      if (results.length >= MAX_LIST_ENTRIES) return;
      results.push(this.denormalize(file));
    }
    for (const folder of entries.folders) {
      await this.collectFiles(folder, results);
    }
  }

  private denormalize(fullPath: string): string {
    const prefix = `${this.vaultBasePath}/`;
    return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  }
}

export type { TFile,Vault };
