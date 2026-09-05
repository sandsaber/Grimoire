import type { AttachmentStore } from '@/core/attachments/AttachmentStore';
import { collectReferencedHashes, hydrateImageAttachments } from '@/core/attachments/hydrateImages';
import type { ChatMessage } from '@/core/types';

const HASH = 'a'.repeat(64);

const bytesOf = (text: string): ArrayBuffer => {
  const buffer = Buffer.from(text, 'utf-8');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

function messageWithImage(overrides: Record<string, unknown>): ChatMessage {
  return {
    id: 'm1',
    role: 'user',
    content: 'look',
    timestamp: 0,
    images: [{
      id: 'img-1',
      name: 'shot.webp',
      mediaType: 'image/webp',
      data: '',
      size: 5,
      source: 'paste',
      ...overrides,
    }],
  } as unknown as ChatMessage;
}

describe('hydrateImageAttachments', () => {
  it('refills the bytes a stored attachment left out of metadata', async () => {
    const store = { read: jest.fn().mockResolvedValue(bytesOf('hello')) } as unknown as AttachmentStore;
    const messages = [messageWithImage({ hash: HASH })];

    await hydrateImageAttachments(messages, store);

    expect(store.read).toHaveBeenCalledWith(HASH, 'image/webp');
    expect(Buffer.from(messages[0].images![0].data, 'base64').toString()).toBe('hello');
  });

  it('leaves an attachment that still carries its own bytes alone', async () => {
    const store = { read: jest.fn() } as unknown as AttachmentStore;
    const messages = [messageWithImage({ hash: HASH, data: 'aGk=' })];

    await hydrateImageAttachments(messages, store);

    expect(store.read).not.toHaveBeenCalled();
    expect(messages[0].images![0].data).toBe('aGk=');
  });

  it('ignores an attachment the store never held', async () => {
    const store = { read: jest.fn() } as unknown as AttachmentStore;
    const messages = [messageWithImage({})];

    await hydrateImageAttachments(messages, store);

    expect(store.read).not.toHaveBeenCalled();
  });

  it('opens the conversation anyway when the stored file is gone', async () => {
    const store = { read: jest.fn().mockResolvedValue(null) } as unknown as AttachmentStore;
    const messages = [messageWithImage({ hash: HASH })];

    await expect(hydrateImageAttachments(messages, store)).resolves.toBeUndefined();
    expect(messages[0].images![0].data).toBe('');
  });

  it('tolerates a conversation with no messages', async () => {
    const store = { read: jest.fn() } as unknown as AttachmentStore;

    await expect(hydrateImageAttachments(undefined, store)).resolves.toBeUndefined();
  });
});

describe('collectReferencedHashes', () => {
  it('gathers every hash still referenced, across conversations', () => {
    const other = 'b'.repeat(64);

    const hashes = collectReferencedHashes([
      { messages: [messageWithImage({ hash: HASH })] },
      { messages: [messageWithImage({ hash: other })] },
      { messages: [messageWithImage({ hash: HASH })] },
    ]);

    expect(hashes).toEqual(new Set([HASH, other]));
  });

  it('skips attachments that were never stored', () => {
    expect(collectReferencedHashes([{ messages: [messageWithImage({})] }])).toEqual(new Set());
  });

  it('handles conversations without messages', () => {
    expect(collectReferencedHashes([{}, { messages: [] }])).toEqual(new Set());
  });
});
