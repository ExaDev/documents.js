// The inverse discrete wavelet transform of ISO/IEC 15444-1 Annex F: the 2D_SR reconstruction that turns one resolution level's LL band plus that level's HL/LH/HH bands into the next resolution level up, applied repeatedly until the tile-component is back in the sample domain.
//
// Both filters ISO/IEC 15444-1 defines are implemented: the reversible 5-3 (F.3.8.2's integer lifting, exact) and the irreversible 9-7 (F.3.8.2's four floating-point lifting steps plus the K normalisation). They are kept as separate routines over separate array types rather than one parameterised routine, because the reversible path's correctness rests on every intermediate staying an exact integer and sharing a float buffer with the other would quietly destroy that.
//
// Every coordinate below is the specification's own: u0/u1 and v0/v1 are the half-open sample ranges of the resolution level being reconstructed, on that level's own grid, and the four subbands' ranges follow from them by the ceil/floor split F.3.3 defines.

// The widest read in either filter is the 9-7's own scaling step, whose loop (F-9) runs two lifting indices -- four samples -- past each end of the signal. Six samples of symmetric extension covers that with room to spare, and covers the 5-3's narrower reach as well.
const EXTENSION_MARGIN = 6;

// F.3.8.2 Table F.4: the four lifting parameters of the 9-7 analysis filter and its normalisation constant. The synthesis below applies each in reverse order with the opposite sign, which is what makes lifting invertible at all.
const LIFT_ALPHA = -1.586134342059924;
const LIFT_BETA = -0.052980118572961;
const LIFT_GAMMA = 0.882911075530934;
const LIFT_DELTA = 0.443506852043971;
const LIFT_K = 1.230174104914001;

export interface Jpeg2000ResolutionBounds {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

// F.3.3's own four coordinate ranges, kept together because every caller needs all of them to size its subband buffers consistently with what the interleave below expects.
export interface Jpeg2000SubbandBounds {
  readonly llU0: number;
  readonly llU1: number;
  readonly llV0: number;
  readonly llV1: number;
  readonly hU0: number;
  readonly hU1: number;
  readonly hV0: number;
  readonly hV1: number;
}

export function subbandBounds(bounds: Jpeg2000ResolutionBounds): Jpeg2000SubbandBounds {
  return {
    llU0: Math.ceil(bounds.u0 / 2),
    llU1: Math.ceil(bounds.u1 / 2),
    llV0: Math.ceil(bounds.v0 / 2),
    llV1: Math.ceil(bounds.v1 / 2),
    hU0: Math.floor(bounds.u0 / 2),
    hU1: Math.floor(bounds.u1 / 2),
    hV0: Math.floor(bounds.v0 / 2),
    hV1: Math.floor(bounds.v1 / 2),
  };
}

// F.3.4's whole-sample symmetric extension: outside [i0, i1) the signal is mirrored about its own two end samples, so index i0 - k reads as i0 + k and index i1 - 1 + k as i1 - 1 - k, repeating with period 2(n - 1).
function mirrorIndex(position: number, i0: number, i1: number): number {
  const length = i1 - i0;
  if (length <= 1) {
    return i0;
  }
  const period = 2 * (length - 1);
  let offset = (position - i0) % period;
  if (offset < 0) {
    offset += period;
  }
  return i0 + (offset >= length ? period - offset : offset);
}

// The interleave of F.3.3, written generically over "read a subband sample" / "write an interleaved sample" so the reversible and irreversible paths share one copy of the coordinate arithmetic -- the part most likely to be got wrong, and the part that is identical between them.
interface InterleaveSource {
  readonly ll: (u: number, v: number) => number;
  readonly hl: (u: number, v: number) => number;
  readonly lh: (u: number, v: number) => number;
  readonly hh: (u: number, v: number) => number;
}

function interleave(source: InterleaveSource, bounds: Jpeg2000ResolutionBounds, write: (u: number, v: number, value: number) => void): void {
  const sub = subbandBounds(bounds);
  for (let v = sub.llV0; v < sub.llV1; v++) {
    for (let u = sub.llU0; u < sub.llU1; u++) {
      write(2 * u, 2 * v, source.ll(u, v));
    }
  }
  for (let v = sub.llV0; v < sub.llV1; v++) {
    for (let u = sub.hU0; u < sub.hU1; u++) {
      write(2 * u + 1, 2 * v, source.hl(u, v));
    }
  }
  for (let v = sub.hV0; v < sub.hV1; v++) {
    for (let u = sub.llU0; u < sub.llU1; u++) {
      write(2 * u, 2 * v + 1, source.lh(u, v));
    }
  }
  for (let v = sub.hV0; v < sub.hV1; v++) {
    for (let u = sub.hU0; u < sub.hU1; u++) {
      write(2 * u + 1, 2 * v + 1, source.hh(u, v));
    }
  }
}

// --- The reversible 5-3 filter (F.3.8.2, equations F-5 and F-6). ---

// Runs in place over an extended buffer where `buffer[index - i0 + EXTENSION_MARGIN]` holds sample `index`, the margin already filled by symmetric extension.
function inverse53Filter(buffer: Int32Array, i0: number, i1: number): void {
  const base = EXTENSION_MARGIN - i0;
  const first = Math.floor(i0 / 2) - 1;
  const last = Math.floor(i1 / 2) + 1;
  // X(2n) = Y(2n) - floor((Y(2n-1) + Y(2n+1) + 2) / 4)
  for (let n = first; n <= last; n++) {
    const index = base + 2 * n;
    buffer[index] = (buffer[index] ?? 0) - Math.floor(((buffer[index - 1] ?? 0) + (buffer[index + 1] ?? 0) + 2) / 4);
  }
  // X(2n+1) = Y(2n+1) + floor((X(2n) + X(2n+2)) / 2)
  for (let n = first; n < last; n++) {
    const index = base + 2 * n + 1;
    buffer[index] = (buffer[index] ?? 0) + Math.floor(((buffer[index - 1] ?? 0) + (buffer[index + 1] ?? 0)) / 2);
  }
}

// --- The irreversible 9-7 filter (F.3.8.2, equations F-8 to F-13). ---

function inverse97Filter(buffer: Float32Array, i0: number, i1: number): void {
  const base = EXTENSION_MARGIN - i0;
  const first = Math.floor(i0 / 2);
  const last = Math.floor(i1 / 2);
  const even = (n: number): number => base + 2 * n;
  const odd = (n: number): number => base + 2 * n + 1;

  // F-8/F-9: undo the K normalisation the analysis filter applied to each of the two phases.
  for (let n = first - 2; n <= last + 2; n++) {
    buffer[even(n)] = (buffer[even(n)] ?? 0) * LIFT_K;
    buffer[odd(n)] = (buffer[odd(n)] ?? 0) / LIFT_K;
  }
  // F-10: X(2n) -= delta * (X(2n-1) + X(2n+1))
  for (let n = first - 1; n <= last + 1; n++) {
    buffer[even(n)] = (buffer[even(n)] ?? 0) - LIFT_DELTA * ((buffer[even(n) - 1] ?? 0) + (buffer[even(n) + 1] ?? 0));
  }
  // F-11: X(2n+1) -= gamma * (X(2n) + X(2n+2))
  for (let n = first - 1; n <= last; n++) {
    buffer[odd(n)] = (buffer[odd(n)] ?? 0) - LIFT_GAMMA * ((buffer[odd(n) - 1] ?? 0) + (buffer[odd(n) + 1] ?? 0));
  }
  // F-12: X(2n) -= beta * (X(2n-1) + X(2n+1))
  for (let n = first; n <= last + 1; n++) {
    buffer[even(n)] = (buffer[even(n)] ?? 0) - LIFT_BETA * ((buffer[even(n) - 1] ?? 0) + (buffer[even(n) + 1] ?? 0));
  }
  // F-13: X(2n+1) -= alpha * (X(2n) + X(2n+2))
  for (let n = first; n <= last; n++) {
    buffer[odd(n)] = (buffer[odd(n)] ?? 0) - LIFT_ALPHA * ((buffer[odd(n) - 1] ?? 0) + (buffer[odd(n) + 1] ?? 0));
  }
}

// F.3.7 1D_SR: the one-dimensional synthesis of an interleaved signal spanning [i0, i1). `read` supplies sample `index` and `write` receives the reconstructed one, both in absolute coordinates, so the same routine serves rows and columns without transposing anything.
function synthesiseLine(
  read: (index: number) => number,
  write: (index: number, value: number) => void,
  i0: number,
  i1: number,
  fillScratch: (offset: number, value: number) => void,
  readScratch: (offset: number) => number,
  runFilter: () => void,
  singleSampleHighPassGain: (value: number) => number,
): void {
  const length = i1 - i0;
  if (length <= 0) {
    return;
  }
  if (length === 1) {
    // F.3.7's single-sample case: an odd-indexed lone sample is a high-pass coefficient, whose synthesis gain of two has to be undone.
    const value = read(i0);
    write(i0, i0 % 2 === 0 ? value : singleSampleHighPassGain(value));
    return;
  }
  for (let k = -EXTENSION_MARGIN; k < length + EXTENSION_MARGIN; k++) {
    fillScratch(EXTENSION_MARGIN + k, read(mirrorIndex(i0 + k, i0, i1)));
  }
  runFilter();
  for (let k = 0; k < length; k++) {
    write(i0 + k, readScratch(EXTENSION_MARGIN + k));
  }
}

export interface Jpeg2000ReversibleSubbands {
  // The reconstructed image of the resolution level below, spanning [ceil(u0/2), ceil(u1/2)) x [ceil(v0/2), ceil(v1/2)).
  readonly ll: Int32Array;
  readonly hl: Int32Array;
  readonly lh: Int32Array;
  readonly hh: Int32Array;
}

export interface Jpeg2000IrreversibleSubbands {
  readonly ll: Float32Array;
  readonly hl: Float32Array;
  readonly lh: Float32Array;
  readonly hh: Float32Array;
}

function interleaveSource(bands: { ll: ArrayLike<number>; hl: ArrayLike<number>; lh: ArrayLike<number>; hh: ArrayLike<number> }, bounds: Jpeg2000ResolutionBounds): InterleaveSource {
  const sub = subbandBounds(bounds);
  const llWidth = sub.llU1 - sub.llU0;
  const hWidth = sub.hU1 - sub.hU0;
  return {
    ll: (u, v) => bands.ll[(v - sub.llV0) * llWidth + (u - sub.llU0)] ?? 0,
    hl: (u, v) => bands.hl[(v - sub.llV0) * hWidth + (u - sub.hU0)] ?? 0,
    lh: (u, v) => bands.lh[(v - sub.hV0) * llWidth + (u - sub.llU0)] ?? 0,
    hh: (u, v) => bands.hh[(v - sub.hV0) * hWidth + (u - sub.hU0)] ?? 0,
  };
}

// F.3.2 2D_SR for the reversible 5-3 filter: interleave the four subbands onto the resolution level's own grid, filter every row, then filter every column. Returns the reconstructed level in raster order over [u0, u1) x [v0, v1).
export function inverseDwt53Level(bands: Jpeg2000ReversibleSubbands, bounds: Jpeg2000ResolutionBounds): Int32Array {
  const { u0, u1, v0, v1 } = bounds;
  const width = u1 - u0;
  const height = v1 - v0;
  const output = new Int32Array(Math.max(width * height, 0));
  if (width <= 0 || height <= 0) {
    return output;
  }
  interleave(interleaveSource(bands, bounds), bounds, (u, v, value) => {
    output[(v - v0) * width + (u - u0)] = value;
  });

  const scratch = new Int32Array(Math.max(width, height) + 2 * EXTENSION_MARGIN);
  // HOR_SR (F.3.5) then VER_SR (F.3.6), in that order -- with integer lifting the two are not commutative.
  for (let v = 0; v < height; v++) {
    const rowStart = v * width;
    synthesiseLine(
      (index) => output[rowStart + index - u0] ?? 0,
      (index, value) => {
        output[rowStart + index - u0] = value;
      },
      u0,
      u1,
      (offset, value) => {
        scratch[offset] = value;
      },
      (offset) => scratch[offset] ?? 0,
      () => {
        inverse53Filter(scratch, u0, u1);
      },
      (value) => value >> 1,
    );
  }
  for (let u = 0; u < width; u++) {
    synthesiseLine(
      (index) => output[(index - v0) * width + u] ?? 0,
      (index, value) => {
        output[(index - v0) * width + u] = value;
      },
      v0,
      v1,
      (offset, value) => {
        scratch[offset] = value;
      },
      (offset) => scratch[offset] ?? 0,
      () => {
        inverse53Filter(scratch, v0, v1);
      },
      (value) => value >> 1,
    );
  }
  return output;
}

// F.3.2 2D_SR for the irreversible 9-7 filter, structurally identical to the reversible one above but in floating point over already-dequantized coefficients.
export function inverseDwt97Level(bands: Jpeg2000IrreversibleSubbands, bounds: Jpeg2000ResolutionBounds): Float32Array {
  const { u0, u1, v0, v1 } = bounds;
  const width = u1 - u0;
  const height = v1 - v0;
  const output = new Float32Array(Math.max(width * height, 0));
  if (width <= 0 || height <= 0) {
    return output;
  }
  interleave(interleaveSource(bands, bounds), bounds, (u, v, value) => {
    output[(v - v0) * width + (u - u0)] = value;
  });

  const scratch = new Float32Array(Math.max(width, height) + 2 * EXTENSION_MARGIN);
  for (let v = 0; v < height; v++) {
    const rowStart = v * width;
    synthesiseLine(
      (index) => output[rowStart + index - u0] ?? 0,
      (index, value) => {
        output[rowStart + index - u0] = value;
      },
      u0,
      u1,
      (offset, value) => {
        scratch[offset] = value;
      },
      (offset) => scratch[offset] ?? 0,
      () => {
        inverse97Filter(scratch, u0, u1);
      },
      (value) => value / 2,
    );
  }
  for (let u = 0; u < width; u++) {
    synthesiseLine(
      (index) => output[(index - v0) * width + u] ?? 0,
      (index, value) => {
        output[(index - v0) * width + u] = value;
      },
      v0,
      v1,
      (offset, value) => {
        scratch[offset] = value;
      },
      (offset) => scratch[offset] ?? 0,
      () => {
        inverse97Filter(scratch, v0, v1);
      },
      (value) => value / 2,
    );
  }
  return output;
}
