import {
  type AttachmentFileStore,
  attachmentPath,
  ATTACHMENTS_FOLDER,
  AttachmentStore,
  hashBytes,
  hashFromAttachmentPath,
} from '@/core/attachments/AttachmentStore';

function createFiles(): AttachmentFileStore & { written: Map<string, ArrayBuffer> } {
  const written = new Map<string, ArrayBuffer>();
  return {
    written,
    exists: jest.fn(async (path: string) => written.has(path)),
    readBinary: jest.fn(async (path: string) => {
      const data = written.get(path);
      if (!data) throw new Error(`missing ${path}`);
      return data;
    }),
    writeBinary: jest.fn(async (path: string, data: ArrayBuffer) => {
      written.set(path, data);
    }),
    delete: jest.fn(async (path: string) => {
      written.delete(path);
    }),
    listFiles: jest.fn(async () => Array.from(written.keys())),
    getResourcePath: jest.fn((path: string) => `app://vault/${path}`),
  };
}

const bytesOf = (text: string): ArrayBuffer => {
  const buffer = Buffer.from(text, 'utf-8');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

describe('AttachmentStore', () => {
  it('writes the bytes under their content hash', async () => {
    const files = createFiles();
    const store = new AttachmentStore(files);
    const data = bytesOf('screenshot');

    const stored = await store.put(data, 'image/webp');

    expect(stored.hash).toBe(hashBytes(data));
    expect(stored.size).toBe(data.byteLength);
    expect(files.written.has(attachmentPath(stored.hash, 'image/webp'))).toBe(true);
  });

  it('stores the same content once, however many conversations use it', async () => {
    const files = createFiles();
    const store = new AttachmentStore(files);

    const first = await store.put(bytesOf('same'), 'image/png');
    const second = await store.put(bytesOf('same'), 'image/png');

    expect(second.hash).toBe(first.hash);
    expect(files.writeBinary).toHaveBeenCalledTimes(1);
    expect(files.written.size).toBe(1);
  });

  it('reads back what it stored', async () => {
    const files = createFiles();
    const store = new AttachmentStore(files);
    const stored = await store.put(bytesOf('payload'), 'image/png');

    const read = await store.read(stored.hash, 'image/png');

    expect(read && Buffer.from(read).toString('utf-8')).toBe('payload');
  });

  it('returns null for content it does not hold', async () => {
    const store = new AttachmentStore(createFiles());

    expect(await store.read('a'.repeat(64), 'image/png')).toBeNull();
  });

  it('returns null rather than throwing when the file cannot be read', async () => {
    const files = createFiles();
    files.exists = jest.fn().mockResolvedValue(true);
    files.readBinary = jest.fn().mockRejectedValue(new Error('disk gone'));

    const read = await new AttachmentStore(files).read('b'.repeat(64), 'image/png');

    expect(read).toBeNull();
  });

  it('hands the renderer a resource URL instead of a data URI', async () => {
    const files = createFiles();
    const store = new AttachmentStore(files);

    expect(store.resourcePath('c'.repeat(64), 'image/webp'))
      .toBe(`app://vault/${ATTACHMENTS_FOLDER}/${'c'.repeat(64)}.webp`);
  });

  describe('collectGarbage', () => {
    it('deletes only what nothing references', async () => {
      const files = createFiles();
      const store = new AttachmentStore(files);
      const kept = await store.put(bytesOf('kept'), 'image/png');
      const dropped = await store.put(bytesOf('dropped'), 'image/png');

      const removed = await store.collectGarbage(new Set([kept.hash]));

      expect(removed).toBe(1);
      expect(files.written.has(attachmentPath(kept.hash, 'image/png'))).toBe(true);
      expect(files.written.has(attachmentPath(dropped.hash, 'image/png'))).toBe(false);
    });

    it('leaves files it does not recognise alone', async () => {
      const files = createFiles();
      files.written.set(`${ATTACHMENTS_FOLDER}/notes.md`, bytesOf('x'));
      const store = new AttachmentStore(files);

      const removed = await store.collectGarbage(new Set());

      expect(removed).toBe(0);
      expect(files.delete).not.toHaveBeenCalled();
    });
  });
});

describe('hashFromAttachmentPath', () => {
  it('reads the hash out of a stored file name', () => {
    const hash = 'd'.repeat(64);

    expect(hashFromAttachmentPath(`${ATTACHMENTS_FOLDER}/${hash}.webp`)).toBe(hash);
  });

  it('rejects a name that is not ours', () => {
    expect(hashFromAttachmentPath(`${ATTACHMENTS_FOLDER}/notes.md`)).toBeNull();
    expect(hashFromAttachmentPath(`${ATTACHMENTS_FOLDER}/short.png`)).toBeNull();
    expect(hashFromAttachmentPath(`${ATTACHMENTS_FOLDER}/${'D'.repeat(64)}.png`)).toBeNull();
  });
});
