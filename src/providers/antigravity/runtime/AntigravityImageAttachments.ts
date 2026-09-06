/**
 * Image attachments for `agy`.
 *
 * agy exposes no image flag and its stream-json `user` event carries `content`
 * as a plain string, so an attachment cannot travel with the turn the way it
 * does for providers with content blocks. What agy does have is file access:
 * measured on 2026-09-03 against agy on Windows, the agent opens an absolute
 * path handed to it in the prompt, including a path outside the workspace and
 * without `--add-dir`. Attachments are therefore materialized as temp files
 * and referenced by path.
 *
 * The files hold user data, so the caller must run `cleanup()` for every turn
 * that created a bundle - including cancelled and failed ones, unlike the agy
 * log, which is deliberately preserved on failure for diagnosis.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ImageAttachment } from '../../../core/types';

export interface AntigravityImageAttachmentBundle {
  /** Removes the temp directory. Safe to call more than once. */
  cleanup: () => void;
  /** Temp directory holding the attachments, or null when none were written. */
  directory: string | null;
  /** Absolute paths of the attachments handed to agy, in prompt order. */
  paths: string[];
  /** The prompt with the attachment paths appended. */
  prompt: string;
}

/**
 * Characters that must not survive into a file name at all: control
 * characters, which are unprintable, and the zero-width and bidirectional
 * overrides, which disguise what a name says - U+202E renders
 * `photo<RLO>gnp.exe` as `photo.exe`-looking text. They are dropped rather
 * than replaced, because padding underscores would only add noise to a name
 * the agent reads back.
 */
function isRemovedCharacter(codePoint: number): boolean {
  return codePoint <= 0x1f
    || codePoint === 0x7f
    || (codePoint >= 0x200b && codePoint <= 0x200f)
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069)
    || codePoint === 0xfeff;
}

function removeDisguisingCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => !isRemovedCharacter(character.codePointAt(0) ?? 0))
    .join('');
}

/**
 * Characters no host accepts in a file name, plus the ones only Windows
 * rejects. The union is applied everywhere so one attachment produces the same
 * file name on every OS: a name that silently differs per platform turns a
 * user's bug report into a platform question.
 */
const UNSAFE_CHARACTERS = /[<>:"/\\|?*]/g;

/**
 * Byte budget for the whole file name, positional prefix included. NAME_MAX is
 * 255 bytes on ext4 and APFS, and the limit counts bytes, not characters: 300
 * Cyrillic letters are 600 of them. The budget stays well under NAME_MAX
 * because the name shares its path with the temp directory.
 */
const MAX_FILENAME_BYTES = 160;

/**
 * Longest tail still treated as an extension. A name whose last dot sits near
 * its end - `photo.<200 chars>` - has no extension, it has a dot: spending the
 * byte budget on that tail would leave the stem nothing and make the write
 * fail with ENAMETOOLONG.
 */
const MAX_SUFFIX_BYTES = 24;

function truncateToBytes(value: string, limit: number): string {
  if (Buffer.byteLength(value, 'utf8') <= limit) {
    return value;
  }
  let result = '';
  let used = 0;
  // Iterating by code point rather than slicing the buffer keeps a multi-byte
  // character from being cut in half into a replacement character.
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (used + size > limit) {
      break;
    }
    result += character;
    used += size;
  }
  return result;
}

/**
 * The complete file name for one attachment, safe to join onto the temp
 * directory on any host and bounded by `MAX_FILENAME_BYTES`.
 *
 * A pasted attachment name is user input: separators and `..` in it would
 * otherwise write outside the directory that `cleanup()` deletes. Everything
 * else is preserved, including non-ASCII letters - the basename is the only
 * label the attachment carries, because agy receives a path rather than an
 * attachment and reads the name back from it.
 */
export function toAntigravityAttachmentFilename(image: ImageAttachment, index: number): string {
  // The positional prefix keeps two attachments sharing one name apart. It
  // also puts a digit in front of every stem, which is what makes a Windows
  // device name harmless: `CON.png` is a device, `1-CON.png` is a file.
  const prefix = `${index + 1}-`;
  const fallback = `image-${index + 1}`;
  const subtype = image.mediaType.split('/')[1] ?? 'img';
  const extension = subtype === 'jpeg' ? 'jpg' : subtype;

  let base = removeDisguisingCharacters(image.name ?? '')
    .replace(UNSAFE_CHARACTERS, '_')
    .trim()
    // Windows drops trailing dots and spaces itself, which would make the
    // written path differ from the path handed to agy.
    .replace(/[. ]+$/, '');

  // `.` and `..` name directories, not files.
  if (!base || /^\.+$/.test(base)) {
    base = fallback;
  }

  const lastDot = base.lastIndexOf('.');
  const hasExtension = lastDot > 0
    && Buffer.byteLength(base.slice(lastDot), 'utf8') <= MAX_SUFFIX_BYTES;
  const stem = hasExtension ? base.slice(0, lastDot) : base;
  const suffix = hasExtension ? base.slice(lastDot) : `.${extension}`;

  // Bounding the stem by what the prefix and suffix leave keeps the whole name
  // inside the budget, not just the part the user typed.
  const truncatedStem = truncateToBytes(
    stem,
    Math.max(1, MAX_FILENAME_BYTES - Buffer.byteLength(`${prefix}${suffix}`, 'utf8')),
  ) || fallback;

  return `${prefix}${truncatedStem}${suffix}`;
}

function buildAttachmentPromptSection(prompt: string, paths: string[]): string {
  if (paths.length === 0) {
    return prompt;
  }
  const list = paths.map((filePath) => `- ${filePath}`).join('\n');
  const header = paths.length === 1
    ? 'The user attached an image. Open this file to view it:'
    : 'The user attached images. Open these files to view them:';
  return `${prompt}\n\n${header}\n${list}`;
}

/**
 * Writes `images` to a fresh temp directory and returns the prompt with their
 * absolute paths appended.
 *
 * A single attachment that cannot be written is reported through `onError` and
 * skipped: losing one image must not cost the user the answer to the rest of
 * the turn.
 */
export function attachAntigravityImages(
  prompt: string,
  images?: ImageAttachment[],
  onError?: (image: ImageAttachment, error: unknown) => void,
): AntigravityImageAttachmentBundle {
  const noop: AntigravityImageAttachmentBundle = {
    cleanup: () => {},
    directory: null,
    paths: [],
    prompt,
  };

  if (!images || images.length === 0) {
    return noop;
  }

  // Without bytes there is nothing to write: `Buffer.from('', 'base64')` would
  // put a zero-byte file in front of agy and call it a screenshot.
  const usable = images.filter((image) => image.mediaType.startsWith('image/') && !!image.data);
  if (usable.length === 0) {
    return noop;
  }

  let directory: string;
  try {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-antigravity-images-'));
  } catch (error) {
    for (const image of usable) {
      onError?.(image, error);
    }
    return noop;
  }

  const cleanup = (): void => {
    try {
      fs.rmSync(directory, { force: true, recursive: true });
    } catch {
      // Best-effort: the OS reclaims its temp directory, and a failure here
      // must never surface as a turn error.
    }
  };

  const paths: string[] = [];
  for (let index = 0; index < usable.length; index += 1) {
    const image = usable[index];
    const filePath = path.join(directory, toAntigravityAttachmentFilename(image, index));
    try {
      fs.writeFileSync(filePath, Buffer.from(image.data, 'base64'));
      paths.push(filePath);
    } catch (error) {
      onError?.(image, error);
    }
  }

  if (paths.length === 0) {
    cleanup();
    return noop;
  }

  return {
    cleanup,
    directory,
    paths,
    prompt: buildAttachmentPromptSection(prompt, paths),
  };
}
