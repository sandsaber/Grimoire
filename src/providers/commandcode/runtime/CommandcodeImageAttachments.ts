import { attachImagesAsFiles } from '@/core/attachments/attachImagesAsFiles';
import type { AttachmentStore } from '@/core/attachments/AttachmentStore';
import type { ImageAttachment } from '@/core/types';

/** Headless stdin is text-only; the CLI reads images through its native file tool. */
export function attachCommandcodeImages(
  prompt: string,
  images: readonly ImageAttachment[],
  vaultPath: string,
  store: AttachmentStore,
  enabled: boolean,
): Promise<string> {
  return attachImagesAsFiles(prompt, images, vaultPath, store, enabled, 'Command Code');
}
