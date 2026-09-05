import type { ImageCodec } from '@/core/attachments/imageEncoder';
import { prepareImageForStore } from '@/core/attachments/prepareImage';

const bytes = (length: number): ArrayBuffer => new Uint8Array(length).buffer;

function createCodec(
  decoded: { width: number; height: number },
  encodedLength: number,
): ImageCodec & { encode: jest.Mock } {
  return {
    decode: jest.fn().mockResolvedValue({ ...decoded, source: 'bitmap' }),
    encode: jest.fn().mockResolvedValue(bytes(encodedLength)),
  };
}

describe('prepareImageForStore', () => {
  it('rescales an oversized screenshot and reports the stored size', async () => {
    const codec = createCodec({ width: 3840, height: 2160 }, 300);

    const prepared = await prepareImageForStore(bytes(5_000_000), 'image/png', { codec });

    expect(prepared.rescaled).toBe(true);
    expect(prepared.mediaType).toBe('image/webp');
    expect(prepared.width).toBe(2000);
    expect(prepared.height).toBe(1125);
    expect(prepared.bytes.byteLength).toBe(300);
  });

  it('keeps an image already within the budget untouched', async () => {
    const codec = createCodec({ width: 1600, height: 900 }, 10);
    const source = bytes(400);

    const prepared = await prepareImageForStore(source, 'image/png', { codec });

    expect(prepared.rescaled).toBe(false);
    expect(prepared.bytes).toBe(source);
    expect(prepared.mediaType).toBe('image/png');
    expect(codec.encode).not.toHaveBeenCalled();
  });

  it('keeps the original when the re-encode came out no smaller', async () => {
    const codec = createCodec({ width: 4000, height: 4000 }, 900);
    const source = bytes(800);

    const prepared = await prepareImageForStore(source, 'image/png', { codec });

    expect(prepared.rescaled).toBe(false);
    expect(prepared.bytes).toBe(source);
  });

  it('never sends a GIF through the codec, so the animation survives', async () => {
    const codec = createCodec({ width: 4000, height: 4000 }, 10);
    const source = bytes(900);

    const prepared = await prepareImageForStore(source, 'image/gif', { codec });

    expect(prepared.rescaled).toBe(false);
    expect(prepared.bytes).toBe(source);
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it('keeps the attachment when the environment cannot decode it', async () => {
    const codec: ImageCodec = {
      decode: jest.fn().mockRejectedValue(new Error('no canvas here')),
      encode: jest.fn(),
    };
    const source = bytes(5_000_000);

    const prepared = await prepareImageForStore(source, 'image/png', { codec });

    expect(prepared.rescaled).toBe(false);
    expect(prepared.bytes).toBe(source);
  });

  it('keeps the attachment when the encode fails', async () => {
    const codec: ImageCodec = {
      decode: jest.fn().mockResolvedValue({ width: 4000, height: 4000, source: 'bitmap' }),
      encode: jest.fn().mockRejectedValue(new Error('webp unsupported')),
    };
    const source = bytes(5_000_000);

    const prepared = await prepareImageForStore(source, 'image/png', { codec });

    expect(prepared.rescaled).toBe(false);
    expect(prepared.bytes).toBe(source);
  });

  it('honours a custom edge budget', async () => {
    const codec = createCodec({ width: 1600, height: 900 }, 10);

    const prepared = await prepareImageForStore(bytes(400), 'image/png', { codec, maxEdge: 800 });

    expect(prepared.rescaled).toBe(true);
    expect(prepared.width).toBe(800);
    expect(prepared.height).toBe(450);
  });
});
