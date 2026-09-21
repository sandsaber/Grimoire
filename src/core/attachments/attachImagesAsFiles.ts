import { join } from 'node:path';

import type { ImageAttachment } from '@/core/types';

import { attachmentPath,type AttachmentStore } from './AttachmentStore';

/** Delivers images to text-only providers through the shared vault attachment store. */
export async function attachImagesAsFiles(
  prompt: string,
  images: readonly ImageAttachment[],
  vaultPath: string,
  store: AttachmentStore,
  enabled: boolean,
  providerName: string,
): Promise<string> {
  if (!images.length) return prompt;
  if (!enabled) {
    throw new Error(`Enable "Image attachments as files" in ${providerName} settings and select a model that can read images.`);
  }
  const paths: string[] = [];
  for (const image of images) {
    const bytes = image.data ? Uint8Array.from(Buffer.from(image.data, 'base64')).buffer
      : image.hash && /^[0-9a-f]{64}$/.test(image.hash) ? await store.read(image.hash, image.mediaType) : null;
    if (!bytes?.byteLength) throw new Error(`A ${providerName} image attachment is unavailable. Attach the image again.`);
    const stored = await store.put(bytes, image.mediaType);
    Object.assign(image, stored);
    paths.push(join(vaultPath, attachmentPath(stored.hash, stored.mediaType)));
  }
  return `${prompt}\n\nThe user attached images. Use your file-reading tool to open each image before answering. The following JSON strings are file paths:\n${paths.map(path => `- ${JSON.stringify(path)}`).join('\n')}`;
}
