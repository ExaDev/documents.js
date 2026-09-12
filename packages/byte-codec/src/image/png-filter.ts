// The five PNG scanline (un)filters (PNG spec section 9.2), shared by the PDF cross-reference stream predictor path (src/pdf/predictors.ts): xref streams are almost always /Predictor 12, which is exactly PNG's "Up" filter applied to fixed-width rows, so this module sits on the critical path for reading modern PDFs, not just for PNG images.
export type PngFilterType = 0 | 1 | 2 | 3 | 4; // None, Sub, Up, Average, Paeth

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  // Stryker disable next-line EqualityOperator: pa === pb (non-trivially, a !== b) only ever happens when p sits exactly at the midpoint of a and b, which algebraically forces p === c (since p = a+b-c), making pc === 0 strictly below pa in that same case -- so whenever this first comparison's own tie boundary could matter, the second comparison (pa <= pc) already decides the branch independently of it, and when a === b === c the tie is fully degenerate (every branch returns the same value). No input can distinguish `pa <= pb` from `pa < pb` here.
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

// The value a filter type predicts from the left (a), above (b), and above-left (c) samples -- added back in during unfiltering, or subtracted out during filtering. Returning a value from a pure function (rather than assigning inside a switch) sidesteps having to prove a switch over a literal union is exhaustive to a variable declared without an initialiser.
function isPngFilterType(value: number): value is PngFilterType {
  return (
    value === 0 || value === 1 || value === 2 || value === 3 || value === 4
  );
}

function predictorValue(
  filterType: PngFilterType,
  a: number,
  b: number,
  c: number,
): number {
  if (filterType === 1) {
    return a;
  }
  if (filterType === 2) {
    return b;
  }
  if (filterType === 3) {
    return Math.floor((a + b) / 2);
  }
  if (filterType === 4) {
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
    // Stryker disable next-line EqualityOperator: an extra x === bytesPerRow iteration writes out[outRowStart + bytesPerRow], which for every row but the last is exactly the NEXT row's own x === 0 slot -- immediately overwritten by that row's own (correct) computation on the very next y iteration -- and for the last row lands exactly at out.length, an out-of-bounds Uint8Array write that is silently dropped. Neither case is ever observable in the returned array.
    for (let x = 0; x < bytesPerRow; x++) {
      const raw = data[rowStart + x]!;
      const a = x >= bpp ? out[outRowStart + x - bpp]! : 0;
      const b = prevOutRowStart === undefined ? 0 : out[prevOutRowStart + x]!;
      const c =
        x >= bpp && prevOutRowStart !== undefined
          ? out[prevOutRowStart + x - bpp]!
          : 0;
      out[outRowStart + x] = (raw + predictorValue(filterByte, a, b, c)) & 0xff;
    }
  }
  return out;
}

function sumOfAbsSigned(bytes: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (const byte of bytes) {
    // Stryker disable next-line EqualityOperator: the two branches agree at the single point where `<128` and `<=128` could ever differ -- byte === 128 -- since 256 - 128 === 128 too, so switching which branch fires at that exact value changes nothing.
    sum += byte < 128 ? byte : 256 - byte;
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
  // Stryker disable next-line EqualityOperator: an extra x === bytesPerRow iteration writes out[outOffset + bytesPerRow] -- for the 'none' strategy's direct write into filterScanlines' own output array, that is the next row's own filter-type byte, overwritten by that row's own explicit write on the following iteration; for the adaptive candidate scratch array (exactly bytesPerRow long), it is an out-of-bounds Uint8Array write, silently dropped. Neither is ever observable.
  for (let x = 0; x < bytesPerRow; x++) {
    const rawByte = raw[rowStart + x]!;
    const a = x >= bpp ? raw[rowStart + x - bpp]! : 0;
    const b = prevRowStart === undefined ? 0 : raw[prevRowStart + x]!;
    const c =
      x >= bpp && prevRowStart !== undefined ? raw[prevRowStart + x - bpp]! : 0;
    out[outOffset + x] = (rawByte - predictorValue(filterType, a, b, c)) & 0xff;
  }
}

const ALL_FILTER_TYPES: readonly PngFilterType[] = [0, 1, 2, 3, 4];

// Filters raw (unfiltered) pixel bytes into PNG's per-scanline IDAT payload shape. `strategy: 'none'` always emits filter type 0 (useful for deterministic, human-auditable test output); `'adaptive'` (the default) picks, per row, whichever of the five filters minimises the sum of the filtered bytes' absolute values interpreted as signed -- the heuristic the PNG spec itself recommends.
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
        0,
        out,
        outRowStart + 1,
      );
      continue;
    }

    let bestType: PngFilterType = 0;
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
