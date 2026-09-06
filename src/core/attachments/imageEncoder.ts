import type { ImageMediaType } from '../types';
import {
  fitWithin,
  type ImageDimensions,
  MAX_ATTACHMENT_EDGE,
  RESCALE_QUALITY,
  RESCALED_MEDIA_TYPE,
} from './imageScaling';

export interface EncodedImage {
  bytes: ArrayBuffer;
  mediaType: ImageMediaType;
  width: number;
  height: number;
}

/**
 * Decoding and re-encoding an image needs the renderer's canvas APIs, which
 * exist in Obsidian but not under a plain Node test runner. Keeping the two
 * calls behind this seam lets the surrounding policy be tested without them.
 */
export interface ImageCodec {
  decode(bytes: ArrayBuffer, mediaType: ImageMediaType): Promise<ImageDimensions & { source: unknown }>;
  encode(
    source: unknown,
    size: ImageDimensions,
    mediaType: ImageMediaType,
    quality: number,
  ): Promise<ArrayBuffer>;
}

/** The codec Obsidian's renderer provides. */
export const canvasImageCodec: ImageCodec = {
  async decode(bytes, mediaType) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }));
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },

  async encode(source, size, mediaType, quality) {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2d canvas context unavailable');
    }
    context.drawImage(source as CanvasImageSource, 0, 0, size.width, size.height);
    const blob = await canvas.convertToBlob({ type: mediaType, quality });
    return blob.arrayBuffer();
  },
};

/**
 * Returns the image scaled to fit `maxEdge`, or null when it does not need
 * scaling and when the environment cannot do it. A null answer means "store
 * what the user gave us".
 */
export async function rescaleImage(
  bytes: ArrayBuffer,
  mediaType: ImageMediaType,
  maxEdge: number = MAX_ATTACHMENT_EDGE,
  codec: ImageCodec = canvasImageCodec,
): Promise<EncodedImage | null> {
  try {
    const decoded = await codec.decode(bytes, mediaType);
    const target = fitWithin(decoded, maxEdge);
    if (target.width === decoded.width && target.height === decoded.height) {
      return null;
    }

    const encoded = await codec.encode(decoded.source, target, RESCALED_MEDIA_TYPE, RESCALE_QUALITY);
    return {
      bytes: encoded,
      mediaType: RESCALED_MEDIA_TYPE,
      width: target.width,
      height: target.height,
    };
  } catch {
    // A decode or encode this build cannot do is not a reason to lose the
    // attachment - the original bytes are still perfectly usable.
    return null;
  }
}
