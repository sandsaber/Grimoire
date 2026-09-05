import type { ImageMediaType } from '../types';

/**
 * Longest edge an attachment is stored at.
 *
 * Above this, provider vision pipelines downscale server-side anyway, so the
 * extra pixels only cost memory, disk and upload time. 2000 is also the width
 * Anthropic documents for staying under the stricter per-image dimension limit
 * that applies once a request carries more than 20 image blocks - and every
 * turn of a conversation resends the images of the turns before it.
 */
export const MAX_ATTACHMENT_EDGE = 2000;

/** What a re-encode produces. Lossy at a quality that keeps screenshot text legible. */
export const RESCALED_MEDIA_TYPE: ImageMediaType = 'image/webp';
export const RESCALE_QUALITY = 0.92;

export interface ImageDimensions {
  width: number;
  height: number;
}

export function exceedsMaxEdge(size: ImageDimensions, maxEdge: number): boolean {
  return size.width > maxEdge || size.height > maxEdge;
}

/**
 * The largest size that fits within `maxEdge` on both sides while keeping the
 * aspect ratio. A size already within the limit is returned unchanged.
 */
export function fitWithin(size: ImageDimensions, maxEdge: number): ImageDimensions {
  if (maxEdge <= 0) {
    return { width: 1, height: 1 };
  }
  if (!exceedsMaxEdge(size, maxEdge)) {
    return { width: size.width, height: size.height };
  }

  const scale = maxEdge / Math.max(size.width, size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Whether this type may go through a canvas at all.
 *
 * GIF may not: the round-trip keeps only the first frame, which would silently
 * turn the user's animation into a still.
 */
export function isRescalableType(mediaType: ImageMediaType): boolean {
  return mediaType !== 'image/gif';
}

/** Whether an attachment of this type and size is worth re-encoding. */
export function shouldRescale(
  mediaType: ImageMediaType,
  size: ImageDimensions,
  maxEdge: number = MAX_ATTACHMENT_EDGE,
): boolean {
  return isRescalableType(mediaType) && exceedsMaxEdge(size, maxEdge);
}
