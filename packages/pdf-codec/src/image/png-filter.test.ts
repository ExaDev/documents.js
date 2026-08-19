import { describe, expect, it } from 'vitest';
import { filterScanlines, unfilterScanlines } from './png-filter';

// A tiny 3x2 RGB (bpp=3) raw pixel buffer: two rows of three RGB triples each.
const WIDTH = 3;
const HEIGHT = 2;
const BPP = 3;
const BYTES_PER_ROW = WIDTH * BPP;
const RAW = new Uint8Array([
  10, 20, 30, 40, 50, 60, 70, 80, 90, // row 0
  15, 25, 35, 45, 55, 65, 75, 85, 95, // row 1
]);

describe('filterScanlines / unfilterScanlines round-trip', () => {
  it('round-trips with strategy "none" (always filter type 0)', () => {
    const filtered = filterScanlines(RAW, HEIGHT, BYTES_PER_ROW, BPP, 'none');
    // Every row's leading filter-type byte must be 0.
    expect(filtered[0]).toBe(0);
    expect(filtered[BYTES_PER_ROW + 1]).toBe(0);
    expect(unfilterScanlines(filtered, HEIGHT, BYTES_PER_ROW, BPP)).toEqual(RAW);
  });

  it('round-trips with strategy "adaptive"', () => {
    const filtered = filterScanlines(RAW, HEIGHT, BYTES_PER_ROW, BPP, 'adaptive');
    expect(unfilterScanlines(filtered, HEIGHT, BYTES_PER_ROW, BPP)).toEqual(RAW);
  });

  it('round-trips a larger, more varied buffer under adaptive filtering', () => {
    const width = 17;
    const height = 11;
    const bpp = 4; // RGBA
    const bytesPerRow = width * bpp;
    const raw = new Uint8Array(height * bytesPerRow);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = (i * 37 + 11) % 256; // deterministic pseudo-random fill, no actual randomness in a test
    }
    const filtered = filterScanlines(raw, height, bytesPerRow, bpp, 'adaptive');
    expect(unfilterScanlines(filtered, height, bytesPerRow, bpp)).toEqual(raw);
  });

  it('the adaptive selector genuinely varies its choice of filter type across rows with different local structure', () => {
    const width = 8;
    const height = 4;
    const bpp = 1; // grayscale, so bpp=1 keeps the crafted rows unambiguous
    const bytesPerRow = width * bpp;
    const raw = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, // row 0: constant -- "None" trivially has the smallest sum (all zero)
      0, 1, 2, 3, 4, 5, 6, 7, // row 1: a steady left-to-right ramp -- "Sub" reduces this to a constant step
      0, 1, 2, 3, 4, 5, 6, 7, // row 2: identical to row 1 above -- "Up" reduces this to all zero
      10, 30, 5, 90, 2, 60, 8, 40, // row 3: unrelated to row 2 -- exercises the remaining predictors
    ]);
    const filtered = filterScanlines(raw, height, bytesPerRow, bpp, 'adaptive');
    const stride = bytesPerRow + 1;
    const chosenTypes = new Set([filtered[0], filtered[stride], filtered[2 * stride], filtered[3 * stride]]);
    expect(chosenTypes.size).toBeGreaterThan(1);
    expect(unfilterScanlines(filtered, height, bytesPerRow, bpp)).toEqual(raw);
  });

  it('unfilterScanlines throws on a filter-type byte outside 0..4', () => {
    const stride = BYTES_PER_ROW + 1;
    const bad = new Uint8Array(HEIGHT * stride);
    bad[0] = 9; // invalid filter type
    expect(() => unfilterScanlines(bad, HEIGHT, BYTES_PER_ROW, BPP)).toThrow();
  });

  it('unfilterScanlines throws on data shorter than height*stride implies', () => {
    expect(() => unfilterScanlines(new Uint8Array(2), HEIGHT, BYTES_PER_ROW, BPP)).toThrow();
  });
});
