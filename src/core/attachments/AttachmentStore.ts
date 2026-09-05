import { createHash } from 'crypto';

import type { ImageMediaType } from '../types';

/** Grimoire-owned vault folder holding attachment bytes, addressed by content. */
export const ATTACHMENTS_FOLDER = '.grimoire/attachments';

const EXTENSIONS: Record<ImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** The slice of the vault adapter the store needs. */
export interface AttachmentFileStore {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  listFiles(folder: string): Promise<string[]>;
  getResourcePath(path: string): string;
}

export interface StoredAttachment {
  hash: string;
  mediaType: ImageMediaType;
  size: number;
}

export function attachmentFileName(hash: string, mediaType: ImageMediaType): string {
  return `${hash}.${EXTENSIONS[mediaType] ?? 'bin'}`;
}

export function attachmentPath(hash: string, mediaType: ImageMediaType): string {
  return `${ATTACHMENTS_FOLDER}/${attachmentFileName(hash, mediaType)}`;
}

/** The hash a stored file name carries, or null when the name is not one of ours. */
export function hashFromAttachmentPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const match = /^([0-9a-f]{64})\.[a-z]+$/.exec(name);
  return match ? match[1] : null;
}

/**
 * Attachment bytes, stored once per distinct content.
 *
 * Addressing by hash makes writes idempotent and deduplicates the same
 * screenshot across conversations, which matters because a message keeps only
 * the reference: the bytes stop travelling through session metadata on every
 * save, and stop being the largest thing a conversation holds in memory.
 */
export class AttachmentStore {
  constructor(private readonly files: AttachmentFileStore) {}

  /** Writes the bytes unless that content is already stored. */
  async put(bytes: ArrayBuffer, mediaType: ImageMediaType): Promise<StoredAttachment> {
    const hash = hashBytes(bytes);
    const path = attachmentPath(hash, mediaType);

    if (!(await this.files.exists(path))) {
      await this.files.writeBinary(path, bytes);
    }

    return { hash, mediaType, size: bytes.byteLength };
  }

  async read(hash: string, mediaType: ImageMediaType): Promise<ArrayBuffer | null> {
    const path = attachmentPath(hash, mediaType);
    if (!(await this.files.exists(path))) {
      return null;
    }

    try {
      return await this.files.readBinary(path);
    } catch {
      return null;
    }
  }

  /** A URL the renderer can display without decoding the file into a data URI. */
  resourcePath(hash: string, mediaType: ImageMediaType): string {
    return this.files.getResourcePath(attachmentPath(hash, mediaType));
  }

  /**
   * Deletes stored files no conversation references any more, and reports how
   * many went. Callers pass every hash still reachable, so a hash they forgot
   * is a deleted attachment - collect only when the set is known to be complete.
   */
  async collectGarbage(referenced: ReadonlySet<string>): Promise<number> {
    const stored = await this.files.listFiles(ATTACHMENTS_FOLDER);
    let removed = 0;

    for (const path of stored) {
      const hash = hashFromAttachmentPath(path);
      if (!hash || referenced.has(hash)) {
        continue;
      }
      await this.files.delete(path);
      removed += 1;
    }

    return removed;
  }
}

export function hashBytes(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}
