import type { ImageMediaType } from '../types';
import { canvasImageCodec, type ImageCodec,rescaleImage } from './imageEncoder';
import { isRescalableType, MAX_ATTACHMENT_EDGE } from './imageScaling';

export interface PreparedAttachment {
  bytes: ArrayBuffer;
  mediaType: ImageMediaType;
  width?: number;
  height?: number;
  /** True when the stored bytes differ from what the user supplied. */
  rescaled: boolean;
}

export interface PrepareImageOptions {
  maxEdge?: number;
  codec?: ImageCodec;
}

/**
 * Decides what an attachment is stored as.
 *
 * A rescale is taken only when it actually produces fewer bytes, so the store
 * never holds more than the user supplied, and a build that cannot re-encode
 * simply keeps the original.
 */
export async function prepareImageForStore(
  bytes: ArrayBuffer,
  mediaType: ImageMediaType,
  options: PrepareImageOptions = {},
): Promise<PreparedAttachment> {
  const original: PreparedAttachment = { bytes, mediaType, rescaled: false };

  // An animated GIF must not reach a canvas, and that is decided by type alone
  // - no point decoding first.
  if (!isRescalableType(mediaType)) {
    return original;
  }

  const maxEdge = options.maxEdge ?? MAX_ATTACHMENT_EDGE;
  const rescaled = await rescaleImage(bytes, mediaType, maxEdge, options.codec ?? canvasImageCodec);
  if (!rescaled || rescaled.bytes.byteLength >= bytes.byteLength) {
    return original;
  }

  return {
    bytes: rescaled.bytes,
    mediaType: rescaled.mediaType,
    width: rescaled.width,
    height: rescaled.height,
    rescaled: true,
  };
}
