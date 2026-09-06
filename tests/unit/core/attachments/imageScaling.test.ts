import {
  exceedsMaxEdge,
  fitWithin,
  MAX_ATTACHMENT_EDGE,
  shouldRescale,
} from '@/core/attachments/imageScaling';

describe('fitWithin', () => {
  it('leaves an image already within the limit untouched', () => {
    expect(fitWithin({ width: 1200, height: 800 }, 2000)).toEqual({ width: 1200, height: 800 });
  });

  it('leaves an image exactly on the limit untouched', () => {
    expect(fitWithin({ width: 2000, height: 1125 }, 2000)).toEqual({ width: 2000, height: 1125 });
  });

  it('scales a landscape image by its width', () => {
    expect(fitWithin({ width: 3840, height: 2160 }, 2000)).toEqual({ width: 2000, height: 1125 });
  });

  it('scales a portrait image by its height', () => {
    expect(fitWithin({ width: 2160, height: 3840 }, 2000)).toEqual({ width: 1125, height: 2000 });
  });

  it('keeps the aspect ratio of an extreme panorama', () => {
    const fitted = fitWithin({ width: 10000, height: 200 }, 2000);

    expect(fitted.width).toBe(2000);
    expect(fitted.height).toBe(40);
  });

  it('never returns a zero dimension', () => {
    const fitted = fitWithin({ width: 100000, height: 3 }, 2000);

    expect(fitted.width).toBe(2000);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });

  it('degrades safely on a nonsensical limit', () => {
    expect(fitWithin({ width: 100, height: 100 }, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('exceedsMaxEdge', () => {
  it('is true when either side is over the limit', () => {
    expect(exceedsMaxEdge({ width: 2001, height: 10 }, 2000)).toBe(true);
    expect(exceedsMaxEdge({ width: 10, height: 2001 }, 2000)).toBe(true);
  });

  it('is false on the limit', () => {
    expect(exceedsMaxEdge({ width: 2000, height: 2000 }, 2000)).toBe(false);
  });
});

describe('shouldRescale', () => {
  it('rescales an oversized screenshot', () => {
    expect(shouldRescale('image/png', { width: 3840, height: 2160 })).toBe(true);
  });

  it('leaves an image within the budget alone', () => {
    expect(shouldRescale('image/png', { width: 1600, height: 900 })).toBe(false);
  });

  it('never rescales a GIF, because the round-trip would drop the animation', () => {
    expect(shouldRescale('image/gif', { width: 4000, height: 4000 })).toBe(false);
  });

  it('defaults to the shared budget', () => {
    expect(shouldRescale('image/jpeg', { width: MAX_ATTACHMENT_EDGE + 1, height: 10 })).toBe(true);
    expect(shouldRescale('image/jpeg', { width: MAX_ATTACHMENT_EDGE, height: 10 })).toBe(false);
  });
});
