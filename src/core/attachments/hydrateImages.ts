import type { ChatMessage, ImageAttachment } from '../types';
import type { AttachmentStore } from './AttachmentStore';

/**
 * Refills the in-memory bytes of attachments whose data was left out of
 * session metadata.
 *
 * Called when a conversation becomes the active one, so only its attachments
 * are held - rather than those of every conversation in the vault, which is
 * what loading metadata used to bring in.
 *
 * An attachment whose file is gone keeps its empty data instead of failing the
 * load: the rest of the conversation is still worth opening.
 */
export async function hydrateImageAttachments(
  messages: ChatMessage[] | undefined,
  store: AttachmentStore,
): Promise<void> {
  for (const message of messages ?? []) {
    await hydrateImages(message.images, store);
  }
}

/** Refills one batch of attachments - the images of a turn about to be sent. */
export async function hydrateImages(
  images: ImageAttachment[] | undefined,
  store: AttachmentStore,
): Promise<void> {
  for (const image of images ?? []) {
    if (!image.hash || image.data) {
      continue;
    }

    const bytes = await store.read(image.hash, image.mediaType);
    if (bytes) {
      image.data = Buffer.from(bytes).toString('base64');
    }
  }
}

/** Every attachment hash the given conversations still reference. */
export function collectReferencedHashes(
  conversations: readonly { messages?: ChatMessage[] }[],
): Set<string> {
  const hashes = new Set<string>();

  for (const conversation of conversations) {
    for (const message of conversation.messages ?? []) {
      for (const image of message.images ?? []) {
        if (image.hash) {
          hashes.add(image.hash);
        }
      }
    }
  }

  return hashes;
}
