import { Jbig2ParseError } from './jbig2-errors';

// The bi-level bitmap every JBIG2 decoding procedure reads and writes, plus the region composition operators of ITU-T T.88 6.2.2 and the packing step that turns a finished page into the byte layout a 1-bit-per-pixel raster consumer expects.
//
// Storage is one byte per pixel rather than a packed bit array. That costs memory but removes an entire class of shift/mask bugs from the template-context builders in jbig2-generic.ts, which read up to sixteen neighbouring pixels -- several of them outside the bitmap -- for every single decoded pixel. The one place packing genuinely matters is the final output, which packBitmapRows below produces on the way out.

export interface Jbig2Bitmap {
  readonly width: number;
  readonly height: number;
  // One entry per pixel in row-major order, 0 or 1. In JBIG2's own convention (T.88 3.29) a 1 bit is a BLACK pixel; nothing in this file inverts that.
  readonly data: Uint8Array<ArrayBuffer>;
}

// A ceiling on how large a single bitmap this decoder will allocate, guarding against a corrupt or hostile segment header declaring an absurd region size. At one byte per pixel this caps a single allocation at 64 MiB, which still comfortably covers a 600 dpi A4 page (5100 x 6600 = 33.7 megapixels) -- the largest thing a real scanned-document JBIG2 stream contains.
export const MAX_JBIG2_BITMAP_PIXELS = 1 << 26;

// A subclass of Jbig2ParseError rather than a standalone error: a declared region size this large only ever comes from a corrupt or hostile segment header, which is exactly what a parse failure is.
export class Jbig2BitmapTooLargeError extends Jbig2ParseError {
  constructor(width: number, height: number) {
    super(`JBIG2 bitmap of ${String(width)}x${String(height)} exceeds the ${String(MAX_JBIG2_BITMAP_PIXELS)}-pixel limit this decoder allocates`);
    this.name = 'Jbig2BitmapTooLargeError';
  }
}

export function createBitmap(width: number, height: number, fill = 0): Jbig2Bitmap {
  if (width < 0 || height < 0 || !Number.isFinite(width) || !Number.isFinite(height) || width * height > MAX_JBIG2_BITMAP_PIXELS) {
    throw new Jbig2BitmapTooLargeError(width, height);
  }
  const data = new Uint8Array(width * height);
  if (fill !== 0) {
    data.fill(1);
  }
  return { width, height, data };
}

// A pixel outside the bitmap reads as 0. Every template in T.88 6.2.5.3 reaches above and to the left of the region being decoded, and 6.2.5.7 defines those out-of-bounds neighbours to be 0.
export function getPixel(bitmap: Jbig2Bitmap, x: number, y: number): number {
  if (x < 0 || x >= bitmap.width || y < 0 || y >= bitmap.height) {
    return 0;
  }
  return bitmap.data[y * bitmap.width + x] ?? 0;
}

// T.88 Table 12: the external combination operator a region segment carries, and the same set a text region's SBCOMBOP uses for compositing symbol instances.
export type Jbig2CombinationOperator = 'or' | 'and' | 'xor' | 'xnor' | 'replace';

const COMBINATION_OPERATORS: readonly Jbig2CombinationOperator[] = ['or', 'and', 'xor', 'xnor', 'replace'];

export function combinationOperatorFromCode(code: number): Jbig2CombinationOperator | undefined {
  return COMBINATION_OPERATORS[code];
}

function combineValue(destination: number, source: number, operator: Jbig2CombinationOperator): number {
  if (operator === 'or') {
    return destination | source;
  }
  if (operator === 'and') {
    return destination & source;
  }
  if (operator === 'xor') {
    return destination ^ source;
  }
  if (operator === 'xnor') {
    return destination === source ? 1 : 0;
  }
  return source;
}

// Composites `source` onto `destination` with its top-left corner at (x, y), clipping anything that falls outside the destination -- T.88 6.2.2's own generic region composition, reused unchanged for symbol instance placement (6.4.5) since the operator set is identical.
export function combineBitmap(destination: Jbig2Bitmap, source: Jbig2Bitmap, x: number, y: number, operator: Jbig2CombinationOperator): void {
  for (let sy = 0; sy < source.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= destination.height) {
      continue;
    }
    for (let sx = 0; sx < source.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= destination.width) {
        continue;
      }
      const destinationIndex = dy * destination.width + dx;
      destination.data[destinationIndex] = combineValue(destination.data[destinationIndex] ?? 0, source.data[sy * source.width + sx] ?? 0, operator);
    }
  }
}

// Packs a bitmap into 1 bit per pixel, most significant bit first, each row padded out to a whole number of bytes -- the layout a PDF image with /BitsPerComponent 1 expects, and the same one src/image/ccitt.ts produces. `width`/`height` are the caller's own requested output size rather than the bitmap's: a region smaller than the declared image reads as 0 (white) outside itself, and a larger one is cropped.
export function packBitmapRows(bitmap: Jbig2Bitmap, width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    for (let x = 0; x < width; x++) {
      if (getPixel(bitmap, x, y) === 1) {
        out[rowStart + (x >> 3)] = (out[rowStart + (x >> 3)] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  return out;
}

// The inverse of packBitmapRows, for a bitmap that arrived already packed -- the MMR-coded generic region path, where src/image/ccitt.ts has produced exactly this layout with black in the 1 bits.
export function unpackBitmapRows(packed: Uint8Array<ArrayBuffer>, width: number, height: number): Jbig2Bitmap {
  const bitmap = createBitmap(width, height);
  const bytesPerRow = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    for (let x = 0; x < width; x++) {
      bitmap.data[y * width + x] = ((packed[rowStart + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
    }
  }
  return bitmap;
}
