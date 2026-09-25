// The five PNG scanline (un)filters (PNG spec section 9.2), shared by the PDF cross-reference stream predictor path (src/pdf/predictors.ts): xref streams are almost always /Predictor 12, which is exactly PNG's "Up" filter applied to fixed-width rows, so this module sits on the critical path for reading modern PDFs, not just for PNG images.
export type PngFilterType = 0 | 1 | 2 | 3 | 4; // None, Sub, Up, Average, Paeth

const FILTER_TYPE_NONE: PngFilterType = 0;
const FILTER_TYPE_SUB: PngFilterType = 1;
const FILTER_TYPE_UP: PngFilterType = 2;
const FILTER_TYPE_AVERAGE: PngFilterType = 3;
const FILTER_TYPE_PAETH: PngFilterType = 4;

const BYTE_MASK = 0xff; // wraps a filtered/unfiltered sample back into an unsigned byte, matching the PNG spec's own "all arithmetic is performed modulo 256" rule for filtering and unfiltering (section 9.2)

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

// The value a filter type predicts from the left (a), above (b), and above-left (c) samples — added back in during unfiltering, or subtracted out during filtering. Returning a value from a pure function (rather than assigning inside a switch) sidesteps having to prove a switch over a literal union is exhaustive to a variable declared without an initialiser.
function isPngFilterType(value: number): value is PngFilterType {
  return (
    value === FILTER_TYPE_NONE ||
    value === FILTER_TYPE_SUB ||
    value === FILTER_TYPE_UP ||
    value === FILTER_TYPE_AVERAGE ||
    value === FILTER_TYPE_PAETH
  );
}

function predictorValue(
  filterType: PngFilterType,
  a: number,
  b: number,
  c: number,
): number {
  if (filterType === FILTER_TYPE_SUB) {
    return a;
  }
  if (filterType === FILTER_TYPE_UP) {
    return b;
  }
  if (filterType === FILTER_TYPE_AVERAGE) {
    return Math.floor((a + b) / 2);
  }
  if (filterType === FILTER_TYPE_PAETH) {
    return paethPredictor(a, b, c);
  }
  return 0; // None
}

// Reverses PNG's per-scanline filtering. `data` is the inflated IDAT payload: height rows, each prefixed by one filter-type byte followed by `bytesPerRow` filtered sample bytes. Returns the raw (unfiltered) pixel bytes, height * bytesPerRow long, with the filter-type bytes stripped.
export function unfilterScanlines(
  data: Uint8Array<ArrayBuffer>,
  height: number,
  bytesPerRow: number,
  bpp: number,
): Uint8Array<ArrayBuffer> {
  const stride = bytesPerRow + 1;
  if (data.length < height * stride) {
    throw new Error(
      `PNG scanline data too short: expected at least ${height * stride} bytes, got ${data.length}`,
    );
  }
  const out = new Uint8Array(height * bytesPerRow);
  for (let y = 0; y < height; y++) {
    const filterByte = data[y * stride];
    if (filterByte === undefined || !isPngFilterType(filterByte)) {
      throw new Error(`unknown PNG filter type: ${String(filterByte)}`);
    }
    const rowStart = y * stride + 1;
    const outRowStart = y * bytesPerRow;
    const prevOutRowStart = y > 0 ? outRowStart - bytesPerRow : undefined;
    for (let x = 0; x < bytesPerRow; x++) {
      const raw = data[rowStart + x]!;
      const a = x >= bpp ? out[outRowStart + x - bpp]! : 0;
      const b = prevOutRowStart === undefined ? 0 : out[prevOutRowStart + x]!;
      const c =
        x >= bpp && prevOutRowStart !== undefined
          ? out[prevOutRowStart + x - bpp]!
          : 0;
      out[outRowStart + x] =
        (raw + predictorValue(filterByte, a, b, c)) & BYTE_MASK;
    }
  }
  return out;
}

const BYTE_RADIX = 256; // one past the maximum value an unsigned byte holds; also the modulus that turns a byte >= SIGNED_BYTE_THRESHOLD into its two's-complement negative equivalent
const SIGNED_BYTE_THRESHOLD = 128; // 2^7: an unsigned byte at or above this value represents a negative number when read as signed 8-bit, per the PNG spec's own "sum of absolute differences" filter-selection heuristic (section 9.8, "Filter selection heuristics")

function sumOfAbsSigned(bytes: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (const byte of bytes) {
    sum += byte < SIGNED_BYTE_THRESHOLD ? byte : BYTE_RADIX - byte;
  }
  return sum;
}

function filterRowInto(
  raw: Uint8Array<ArrayBuffer>,
  rowStart: number,
  prevRowStart: number | undefined,
  bytesPerRow: number,
  bpp: number,
  filterType: PngFilterType,
  out: Uint8Array<ArrayBuffer>,
  outOffset: number,
): void {
  for (let x = 0; x < bytesPerRow; x++) {
    const rawByte = raw[rowStart + x]!;
    const a = x >= bpp ? raw[rowStart + x - bpp]! : 0;
    const b = prevRowStart === undefined ? 0 : raw[prevRowStart + x]!;
    const c =
      x >= bpp && prevRowStart !== undefined ? raw[prevRowStart + x - bpp]! : 0;
    out[outOffset + x] =
      (rawByte - predictorValue(filterType, a, b, c)) & BYTE_MASK;
  }
}

const ALL_FILTER_TYPES: readonly PngFilterType[] = [
  FILTER_TYPE_NONE,
  FILTER_TYPE_SUB,
  FILTER_TYPE_UP,
  FILTER_TYPE_AVERAGE,
  FILTER_TYPE_PAETH,
];

// Filters raw (unfiltered) pixel bytes into PNG's per-scanline IDAT payload shape. `strategy: 'none'` always emits filter type 0 (useful for deterministic, human-auditable test output); `'adaptive'` (the default) picks, per row, whichever of the five filters minimises the sum of the filtered bytes' absolute values interpreted as signed — the heuristic the PNG spec itself recommends.
export function filterScanlines(
  raw: Uint8Array<ArrayBuffer>,
  height: number,
  bytesPerRow: number,
  bpp: number,
  strategy: "none" | "adaptive" = "adaptive",
): Uint8Array<ArrayBuffer> {
  const stride = bytesPerRow + 1;
  const out = new Uint8Array(height * stride);
  const candidate = new Uint8Array(bytesPerRow);

  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    const prevRowStart = y > 0 ? rowStart - bytesPerRow : undefined;
    const outRowStart = y * stride;

    if (strategy === "none") {
      out[outRowStart] = 0;
      filterRowInto(
        raw,
        rowStart,
        prevRowStart,
        bytesPerRow,
        bpp,
        FILTER_TYPE_NONE,
        out,
        outRowStart + 1,
      );
      continue;
    }

    let bestType: PngFilterType = FILTER_TYPE_NONE;
    let bestSum = Number.POSITIVE_INFINITY;
    let best: Uint8Array<ArrayBuffer> | undefined;
    for (const filterType of ALL_FILTER_TYPES) {
      filterRowInto(
        raw,
        rowStart,
        prevRowStart,
        bytesPerRow,
        bpp,
        filterType,
        candidate,
        0,
      );
      const sum = sumOfAbsSigned(candidate);
      if (sum < bestSum) {
        bestSum = sum;
        bestType = filterType;
        best = candidate.slice();
      }
    }
    out[outRowStart] = bestType;
    if (best !== undefined) {
      out.set(best, outRowStart + 1);
    }
  }
  return out;
}
