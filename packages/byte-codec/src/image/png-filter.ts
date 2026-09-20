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
    // Walks this row's own window of `out` through the typed array's forEach rather than a manually bounded for loop, and rather than an index array built per row: the window is exactly bytesPerRow elements, so there is no separate loop-bound comparison whose own boundary could ever be observed through it, and no allocation proportional to the row on every row.
    out
      .subarray(outRowStart, outRowStart + bytesPerRow)
      .forEach((_value, x) => {
        const raw = data[rowStart + x]!;
        const a = x >= bpp ? out[outRowStart + x - bpp]! : 0;
        const b = prevOutRowStart === undefined ? 0 : out[prevOutRowStart + x]!;
        const c =
          x >= bpp && prevOutRowStart !== undefined
            ? out[prevOutRowStart + x - bpp]!
            : 0;
        out[outRowStart + x] =
          (raw + predictorValue(filterByte, a, b, c)) & 0xff;
      });
  }
  return out;
}

// Filters one row into `target` (exactly bytesPerRow long) and returns the sum of the filtered bytes' absolute values read as signed, the score the adaptive strategy minimises. `current` and `previous` are the row and the row above it, each with `bpp` zero bytes in front of its samples, so the byte to the left of a sample at row index x is `current[x]`, the byte above is `previous[x + bpp]` and the one above-left is `previous[x]`: the "before the row starts" and "above the first row" cases (PNG spec 9.2) are then just those zeros, with no bounds test on any byte. The filter type is chosen once, outside the per-byte walk, so each byte costs one small callback instead of a dispatch through a general predictor function; the score is accumulated in the same pass rather than by a second one. Each byte's magnitude is the smaller of its two signed readings, `Math.min(byte, 256 - byte)`, rather than a `< 128` branch: at the one point the branch's own boundary could matter (byte === 128) both readings are already 128.
function filterRowInto(
  current: Uint8Array<ArrayBuffer>,
  previous: Uint8Array<ArrayBuffer>,
  bpp: number,
  filterType: PngFilterType,
  target: Uint8Array<ArrayBuffer>,
): number {
  let sum = 0;
  // Each callback walks `target`'s own exact-length window through the typed array's forEach rather than a manually bounded for loop, so there is no separate loop-bound comparison whose own boundary could ever be observed through it.
  switch (filterType) {
    case 1:
      target.forEach((_byte, x) => {
        const filtered = (current[x + bpp]! - current[x]!) & 0xff;
        target[x] = filtered;
        sum += Math.min(filtered, 256 - filtered);
      });
      break;
    case 2:
      target.forEach((_byte, x) => {
        const filtered = (current[x + bpp]! - previous[x + bpp]!) & 0xff;
        target[x] = filtered;
        sum += Math.min(filtered, 256 - filtered);
      });
      break;
    case 3:
      target.forEach((_byte, x) => {
        const filtered =
          (current[x + bpp]! -
            Math.floor((current[x]! + previous[x + bpp]!) / 2)) &
          0xff;
        target[x] = filtered;
        sum += Math.min(filtered, 256 - filtered);
      });
      break;
    case 4:
      target.forEach((_byte, x) => {
        const filtered =
          (current[x + bpp]! -
            paethPredictor(current[x]!, previous[x + bpp]!, previous[x]!)) &
          0xff;
        target[x] = filtered;
        sum += Math.min(filtered, 256 - filtered);
      });
      break;
    case 0:
      target.forEach((_byte, x) => {
        const filtered = current[x + bpp]!;
        target[x] = filtered;
        sum += Math.min(filtered, 256 - filtered);
      });
  }
  return sum;
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
  // Two padded row buffers, swapped after each row so the row above is always the one just filtered; `previous` starts as all zeros, which is what "above the first row" means. Two candidate buffers, swapped when a filter beats the best so far, so no filtered row is ever copied out just to be compared.
  let current = new Uint8Array(bytesPerRow + bpp);
  let previous = new Uint8Array(bytesPerRow + bpp);
  let candidate = new Uint8Array(bytesPerRow);
  let best = new Uint8Array(bytesPerRow);
  const filterTypes: readonly PngFilterType[] =
    strategy === "none" ? [0] : ALL_FILTER_TYPES;

  Array.from({ length: height }).forEach((_row, y) => {
    current.set(raw.subarray(y * bytesPerRow, (y + 1) * bytesPerRow), bpp);
    let bestType: PngFilterType = 0;
    let bestSum = Number.POSITIVE_INFINITY;
    for (const filterType of filterTypes) {
      const sum = filterRowInto(current, previous, bpp, filterType, candidate);
      if (sum < bestSum) {
        bestSum = sum;
        bestType = filterType;
        [best, candidate] = [candidate, best];
      }
    }
    out[y * stride] = bestType;
    out.set(best, y * stride + 1);
    [previous, current] = [current, previous];
  });
  return out;
}
