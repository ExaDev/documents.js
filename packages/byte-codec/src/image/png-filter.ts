// The five PNG scanline (un)filters (PNG spec section 9.2), shared by the PDF cross-reference stream predictor path (src/pdf/predictors.ts): xref streams are almost always /Predictor 12, which is exactly PNG's "Up" filter applied to fixed-width rows, so this module sits on the critical path for reading modern PDFs, not just for PNG images.
export type PngFilterType = 0 | 1 | 2 | 3 | 4; // None, Sub, Up, Average, Paeth

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  // Stated directly as "whichever neighbour has the smallest distance, preferring a, then b, then c on a tie" rather than as a chain of pairwise comparisons: a chain risks a tie boundary (pa <= pb vs pa < pb) that no input can actually distinguish, since pa === pb algebraically forces pc === 0, which the second comparison already resolves independently.
  const smallest = Math.min(pa, pb, pc);
  if (smallest === pa) {
    return a;
  }
  if (smallest === pb) {
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
    // Iterated via an exact-length Array.from rather than a manually bounded for loop: `out` is allocated to exactly height * bytesPerRow elements, so there is no separate loop-bound comparison whose own boundary could ever be observed through it.
    for (const x of Array.from({ length: bytesPerRow }, (_, i) => i)) {
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
    // The smaller of the byte's two possible signed-interpretation magnitudes, rather than a `<128`-branching choice between them: at the one point the branch's own boundary could matter (byte === 128), both magnitudes are already 128, so Math.min needs no comparison against 128 at all to agree with it everywhere.
    sum += Math.min(byte, 256 - byte);
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
  // Iterated via an exact-length Array.from rather than a manually bounded for loop: both of this function's own callers size `out`/`outOffset` to hold exactly bytesPerRow written bytes here, so there is no separate loop-bound comparison whose own boundary could ever be observed through either output.
  for (const x of Array.from({ length: bytesPerRow }, (_, i) => i)) {
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
