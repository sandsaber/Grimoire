import { constants as bufferConstants } from 'node:buffer';
import { open, stat as statPath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { BoundedVaultTextReader } from '../../core/storage/VaultFileAdapter';

export interface DesktopVaultPathPort {
  getBasePath(): string;
}

interface BoundedFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly size: number;
  readonly mtimeMs: number;
  isFile(): boolean;
}

interface BoundedFileHandle {
  stat(): Promise<BoundedFileStat>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
  close(): Promise<void>;
}

export interface BoundedFileSystemPort {
  open(path: string): Promise<BoundedFileHandle>;
  stat(path: string): Promise<BoundedFileStat>;
}

const nodeFileSystem: BoundedFileSystemPort = {
  open: path => open(path, 'r'),
  stat: statPath,
};

/** Capped descriptor read used by desktop vaults on macOS, Linux, and Windows. */
export class NodeBoundedVaultTextReader implements BoundedVaultTextReader {
  constructor(
    private readonly vault: DesktopVaultPathPort,
    private readonly fileSystem: BoundedFileSystemPort = nodeFileSystem,
  ) {}

  async readBounded(normalizedPath: string, maxBytes: number): Promise<string> {
    requireLimit(maxBytes);
    const absolutePath = resolveVaultPath(this.vault.getBasePath(), normalizedPath);
    const handle = await this.fileSystem.open(absolutePath);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxBytes) throw limitError();
      const bytes = Buffer.allocUnsafe(maxBytes + 1);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          bytes.byteLength - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > maxBytes) throw limitError();
      const after = await handle.stat();
      const current = await this.fileSystem.stat(absolutePath);
      if (!sameFile(before, after) || !sameFile(after, current) || current.size !== offset) {
        throw new Error('Vault file changed during bounded read.');
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
    } finally {
      await handle.close();
    }
  }
}

function resolveVaultPath(basePath: string, normalizedPath: string): string {
  if (!normalizedPath || normalizedPath.includes('\\') || normalizedPath.includes('\0')) {
    throw new Error('Bounded vault path is invalid.');
  }
  const absoluteBase = resolve(basePath);
  const absolutePath = resolve(absoluteBase, ...normalizedPath.split('/'));
  const child = relative(absoluteBase, absolutePath);
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Bounded vault path escapes the vault root.');
  }
  return absolutePath;
}

function requireLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || maxBytes >= bufferConstants.MAX_LENGTH) {
    throw new Error('Vault read byte limit must be a supported positive safe integer.');
  }
}

function sameFile(
  left: BoundedFileStat,
  right: BoundedFileStat,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function limitError(): Error {
  return new Error('Vault file exceeds the byte limit.');
}
