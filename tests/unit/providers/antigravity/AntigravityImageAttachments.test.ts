import fs from 'node:fs';
import path from 'node:path';

import type { ImageAttachment } from '@/core/types';
import {
  attachAntigravityImages,
  toAntigravityAttachmentFilename,
} from '@/providers/antigravity/runtime/AntigravityImageAttachments';

// A 1x1 PNG: small enough to inline, real enough that the decoded bytes carry
// a signature a truncated or double-encoded write would not reproduce.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function createImage(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    data: PNG_BASE64,
    id: 'img-1',
    mediaType: 'image/png',
    name: 'diagram.png',
    size: 70,
    source: 'paste',
    ...overrides,
  };
}

describe('attachAntigravityImages', () => {
  it('leaves the prompt untouched and writes nothing when there are no images', () => {
    const bundle = attachAntigravityImages('Describe the defect', []);

    expect(bundle.prompt).toBe('Describe the defect');
    expect(bundle.paths).toEqual([]);
    expect(bundle.directory).toBeNull();
    // A no-op cleanup must stay callable so the caller needs no null check.
    expect(() => bundle.cleanup()).not.toThrow();
  });

  it('writes the decoded image to a temp file and puts its absolute path in the prompt', () => {
    const bundle = attachAntigravityImages('Describe the defect', [createImage()]);

    try {
      expect(bundle.paths).toHaveLength(1);
      const filePath = bundle.paths[0];
      expect(path.isAbsolute(filePath)).toBe(true);
      expect(fs.readFileSync(filePath).subarray(0, 4)).toEqual(PNG_SIGNATURE);
      // agy has no image flag, so the path is the whole channel: the prompt
      // must carry it verbatim or the attachment is invisible to the agent.
      expect(bundle.prompt).toContain(filePath);
      expect(bundle.prompt.startsWith('Describe the defect')).toBe(true);
    } finally {
      bundle.cleanup();
    }
  });

  it('numbers every attachment so two files with one name cannot collide', () => {
    const bundle = attachAntigravityImages('Compare these', [
      createImage({ id: 'a' }),
      createImage({ id: 'b' }),
    ]);

    try {
      expect(bundle.paths).toHaveLength(2);
      expect(new Set(bundle.paths).size).toBe(2);
      expect(bundle.paths.every((filePath) => fs.existsSync(filePath))).toBe(true);
    } finally {
      bundle.cleanup();
    }
  });

  it('writes an attachment whose name has no real extension', () => {
    // A name the byte budget did not cover used to fail the write and be
    // dropped with nothing but a debug log to show for it.
    const bundle = attachAntigravityImages('Describe this', [
      createImage({ name: `a.${'x'.repeat(300)}` }),
    ]);

    try {
      expect(bundle.paths).toHaveLength(1);
      expect(fs.readFileSync(bundle.paths[0]).subarray(0, 4)).toEqual(PNG_SIGNATURE);
    } finally {
      bundle.cleanup();
    }
  });

  it('skips an attachment whose media type is not an image', () => {
    const bundle = attachAntigravityImages('Read this', [
      createImage({ mediaType: 'application/pdf' as ImageAttachment['mediaType'], name: 'manual.pdf' }),
      createImage({ id: 'img-2', name: 'photo.png' }),
    ]);

    try {
      expect(bundle.paths).toHaveLength(1);
      expect(bundle.paths[0]).toContain('photo.png');
    } finally {
      bundle.cleanup();
    }
  });

  it('keeps the turn alive when one attachment cannot be written', () => {
    const failing = jest
      .spyOn(fs, 'writeFileSync')
      .mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

    const bundle = attachAntigravityImages('Describe these', [
      createImage({ id: 'a', name: 'broken.png' }),
      createImage({ id: 'b', name: 'good.png' }),
    ]);

    try {
      // Losing one attachment must not cost the user the whole answer.
      expect(bundle.paths).toHaveLength(1);
      expect(bundle.paths[0]).toContain('good.png');
      expect(bundle.prompt).toContain(bundle.paths[0]);
    } finally {
      bundle.cleanup();
      failing.mockRestore();
    }
  });

  it('reports a failed attachment to the caller instead of dropping it silently', () => {
    const failing = jest
      .spyOn(fs, 'writeFileSync')
      .mockImplementationOnce(() => {
        throw new Error('EACCES');
      });
    const onError = jest.fn();

    const bundle = attachAntigravityImages('Describe this', [createImage({ name: 'broken.png' })], onError);

    try {
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'broken.png' }));
    } finally {
      bundle.cleanup();
      failing.mockRestore();
    }
  });

  it('removes the whole temp directory on cleanup', () => {
    const bundle = attachAntigravityImages('Describe the defect', [createImage()]);
    const directory = bundle.directory as string;
    expect(fs.existsSync(directory)).toBe(true);

    bundle.cleanup();

    expect(fs.existsSync(directory)).toBe(false);
  });

  it('survives a second cleanup call', () => {
    const bundle = attachAntigravityImages('Describe the defect', [createImage()]);

    bundle.cleanup();

    expect(() => bundle.cleanup()).not.toThrow();
  });
});

describe('toAntigravityAttachmentFilename', () => {
  // The positional prefix is part of the name the helper returns: it is what
  // keeps two attachments sharing one name apart, and what the byte budget and
  // the Windows device rule below are measured against.
  it('keeps a safe name as is behind the positional prefix', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: 'defect-01.png' }), 0)).toBe('1-defect-01.png');
    expect(toAntigravityAttachmentFilename(createImage({ name: 'defect-01.png' }), 1)).toBe('2-defect-01.png');
  });

  // The name is the only label the attachment carries: agy is handed a path,
  // not an attachment, and it reads the basename back (measured 2026-09-03,
  // agy answered with `дефект-слой-1.png` verbatim). Transliterating a
  // non-ASCII name to underscores throws that context away.
  it('keeps letters outside ASCII', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: 'дефект-слой-1.png' }), 0))
      .toBe('1-дефект-слой-1.png');
    expect(toAntigravityAttachmentFilename(createImage({ name: '層間剥離.png' }), 0))
      .toBe('1-層間剥離.png');
  });

  it('replaces both path separators regardless of host os', () => {
    // The same attachment must land on the same file name on Windows and
    // POSIX, so both separators go even where only one is special.
    expect(toAntigravityAttachmentFilename(createImage({ name: 'a/b.png' }), 0)).toBe('1-a_b.png');
    expect(toAntigravityAttachmentFilename(createImage({ name: 'a\\b.png' }), 0)).toBe('1-a_b.png');
  });

  it('replaces characters Windows refuses in a file name', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: 'a<b>c:d"e|f?g*h.png' }), 0))
      .toBe('1-a_b_c_d_e_f_g_h.png');
  });

  it('drops control characters instead of turning them into padding', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: 'de\u0007fe\u0000ct.png' }), 0))
      .toBe('1-defect.png');
  });

  it('drops direction overrides that can disguise the extension', () => {
    // U+202E would render `photo<RLO>gnp.exe` as `photo.exe...`; the bytes on
    // disk must match what the user and the agent read.
    expect(toAntigravityAttachmentFilename(createImage({ name: 'photo\u202egnp.png' }), 0))
      .toBe('1-photognp.png');
  });

  it('strips trailing dots and spaces that Windows would drop anyway', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: 'defect.png. ' }), 0)).toBe('1-defect.png');
  });

  it('leaves reserved Windows device names harmless without mangling them', () => {
    // `CON.png` is a device, not a file, and opening it on Windows never
    // reaches the attachment - but the positional prefix already moves the
    // name off the reserved list, so the user's name survives intact.
    expect(toAntigravityAttachmentFilename(createImage({ name: 'CON.png' }), 0)).toBe('1-CON.png');
    expect(toAntigravityAttachmentFilename(createImage({ name: 'lpt9.png' }), 0)).toBe('1-lpt9.png');
    expect(toAntigravityAttachmentFilename(createImage({ name: 'console.png' }), 0)).toBe('1-console.png');
  });

  it('falls back when the name is nothing but dots', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: '..' }), 0)).toBe('1-image-1.png');
    expect(toAntigravityAttachmentFilename(createImage({ name: '.' }), 1)).toBe('2-image-2.png');
  });

  it('truncates a long name by bytes without splitting a character', () => {
    const name = `${'д'.repeat(300)}.png`;

    const result = toAntigravityAttachmentFilename(createImage({ name }), 0);

    // NAME_MAX is 255 bytes on ext4, and Cyrillic costs two bytes per letter,
    // so a name that looks short in characters can still be unwritable.
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(160);
    expect(result.endsWith('.png')).toBe(true);
    expect(result).not.toContain('�');
  });

  it('bounds the whole name, not just the stem, when the last dot sits near the end', () => {
    // `photo.<200 chars>` has a dot, not an extension. Spending the budget on
    // that tail left the name over NAME_MAX, so the write failed with
    // ENAMETOOLONG and the attachment was dropped.
    const name = `a.${'x'.repeat(300)}`;

    const result = toAntigravityAttachmentFilename(createImage({ name }), 0);

    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(160);
    // The tail is not an extension, so the media type supplies one.
    expect(result.endsWith('.png')).toBe(true);
  });

  it('replaces characters that are unsafe in a file name', () => {
    // A pasted name can carry separators; joining it raw would escape the
    // temp directory the cleanup deletes.
    expect(toAntigravityAttachmentFilename(createImage({ name: '../../etc/passwd.png' }), 0))
      .toBe('1-.._.._etc_passwd.png');
  });

  it('derives an extension from the media type when the name has none', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: 'scan' }), 0)).toBe('1-scan.png');
    expect(toAntigravityAttachmentFilename(
      createImage({ mediaType: 'image/jpeg', name: 'scan' }),
      0,
    )).toBe('1-scan.jpg');
  });

  it('falls back to a positional name when the attachment has none', () => {
    expect(toAntigravityAttachmentFilename(createImage({ name: '' }), 2)).toBe('3-image-3.png');
  });
});
