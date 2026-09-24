import { describe, expect, it } from "vitest";
import {
  Jpeg2000ParseError,
  Jpeg2000UnsupportedError,
} from "./jpeg2000-errors";
import type {
  Jpeg2000CodeBlockDecodeOptions,
  Jpeg2000SubbandType,
} from "./jpeg2000-t1";
import { decodeJpeg2000CodeBlock } from "./jpeg2000-t1";

function baseOptions(): Jpeg2000CodeBlockDecodeOptions {
  return {
    width: 4,
    height: 4,
    subband: "LL",
    zeroBitPlanes: 0,
    maxBitPlanes: 1,
    totalPasses: 1,
    codeBlockStyle: 0,
    data: new Uint8Array(0),
  };
}

// throwForUnsupportedStyle runs before any code-block data is touched, so these style-flag checks need no real encoded bytes at all.
describe("decodeJpeg2000CodeBlock: unsupported code-block styles", () => {
  it("rejects selective arithmetic coding bypass (lazy mode)", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x01 }),
    ).toThrow(Jpeg2000UnsupportedError);
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x01 }),
    ).toThrow(/selective arithmetic coding bypass/);
  });

  it("rejects termination of the arithmetic coder on every coding pass", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x04 }),
    ).toThrow(Jpeg2000UnsupportedError);
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x04 }),
    ).toThrow(/terminates the arithmetic coder on every coding pass/);
  });

  it("accepts the predictable-termination flag without throwing", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x10 }),
    ).not.toThrow();
  });

  it("accepts a code-block style with none of the flags set", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0 }),
    ).not.toThrow();
  });
});

// The guard has to refuse a degenerate code-block before the entropy coder is constructed, because the cleanup pass reads its segmentation symbols even when the stripe loops visit nothing: with the style below, a guard that let any of these through would end up decoding a "segmentation symbol" out of data that was never meant to be read.
describe("decodeJpeg2000CodeBlock: degenerate code-blocks", () => {
  const bytes = new Uint8Array([0x5a, 0x37, 0xc1, 0x0e]);

  it("returns an empty result for a zero-width code-block", () => {
    const { values } = decodeJpeg2000CodeBlock({
      ...baseOptions(),
      width: 0,
      codeBlockStyle: 0x20,
      data: bytes,
    });
    expect(values.length).toBe(0);
  });

  it("returns an empty result for a zero-height code-block", () => {
    const { values } = decodeJpeg2000CodeBlock({
      ...baseOptions(),
      height: 0,
      codeBlockStyle: 0x20,
      data: bytes,
    });
    expect(values.length).toBe(0);
  });

  it("returns all zeros for a code-block with no coded bytes", () => {
    const { values } = decodeJpeg2000CodeBlock({
      ...baseOptions(),
      codeBlockStyle: 0x20,
      data: new Uint8Array(0),
    });
    expect(Array.from(values)).toEqual(new Array(16).fill(0));
  });

  it("returns all zeros when every bit-plane is already known to be zero", () => {
    const { values } = decodeJpeg2000CodeBlock({
      ...baseOptions(),
      zeroBitPlanes: 1,
      maxBitPlanes: 1,
      codeBlockStyle: 0x20,
      data: bytes,
    });
    expect(Array.from(values)).toEqual(new Array(16).fill(0));
  });

  it("returns all zeros for a code-block with no coding passes", () => {
    const { values } = decodeJpeg2000CodeBlock({
      ...baseOptions(),
      totalPasses: 0,
      codeBlockStyle: 0x20,
      data: bytes,
    });
    expect(Array.from(values)).toEqual(new Array(16).fill(0));
  });
});

// --- A hand-written EBCOT tier-1 encoder (ISO/IEC 15444-1 Annex D), driving decodeJpeg2000CodeBlock from hand-chosen coefficient grids. ---
//
// The whole-codestream fixtures in jpeg2000.test.ts pin this decoder end to end against OpenJPEG's output, but only along the neighbourhood shapes a real encoder's images happen to produce, and only where a context divergence happens to flip a sample: a completely zeroed sign-context table decodes every fixture in the suite unchallenged. The tests below need bit streams whose exact decision sequence is known, so the encoder half of Annex D is restated here the way scripts/generate-jbig2-fixtures.mjs restates the MQ coder: T.800's Table D.1 and Table D.3 are transcribed afresh below, independently of src/image/jpeg2000-t1.ts's own transcription. A decoder that maps any neighbourhood shape to a different label than this encoder writes, or that merges two labels' decisions into one adaptive slot, cannot decode these streams; the one labelling change no stream can expose is a pure exchange of two labels that both start in state zero, because the MQ coder's per-context state is a function of the decisions that context decodes and an exchange preserves each set's sequence.

// T.800 Table C.1 (identical to T.88 Table E.1), as (Qe, NMPS, NLPS, SWITCH).
const ENCODER_QE_STATES: readonly (readonly [
  number,
  number,
  number,
  number,
])[] = [
  [0x5601, 1, 1, 1],
  [0x3401, 2, 6, 0],
  [0x1801, 3, 9, 0],
  [0x0ac1, 4, 12, 0],
  [0x0521, 5, 29, 0],
  [0x0221, 38, 33, 0],
  [0x5601, 7, 6, 1],
  [0x5401, 8, 14, 0],
  [0x4801, 9, 14, 0],
  [0x3801, 10, 14, 0],
  [0x3001, 11, 17, 0],
  [0x2401, 12, 18, 0],
  [0x1c01, 13, 20, 0],
  [0x1601, 29, 21, 0],
  [0x5601, 15, 14, 1],
  [0x5401, 16, 14, 0],
  [0x5101, 17, 15, 0],
  [0x4801, 18, 16, 0],
  [0x3801, 19, 17, 0],
  [0x3401, 20, 18, 0],
  [0x3001, 21, 19, 0],
  [0x2801, 22, 19, 0],
  [0x2401, 23, 20, 0],
  [0x2201, 24, 21, 0],
  [0x1c01, 25, 22, 0],
  [0x1801, 26, 23, 0],
  [0x1601, 27, 24, 0],
  [0x1401, 28, 25, 0],
  [0x1201, 29, 26, 0],
  [0x1101, 30, 27, 0],
  [0x0ac1, 31, 28, 0],
  [0x09c1, 32, 29, 0],
  [0x08a1, 33, 30, 0],
  [0x0521, 34, 31, 0],
  [0x0441, 35, 32, 0],
  [0x02a1, 36, 33, 0],
  [0x0221, 37, 34, 0],
  [0x0141, 38, 35, 0],
  [0x0111, 39, 36, 0],
  [0x0085, 40, 37, 0],
  [0x0049, 41, 38, 0],
  [0x0025, 42, 39, 0],
  [0x0015, 43, 40, 0],
  [0x0009, 44, 41, 0],
  [0x0005, 45, 42, 0],
  [0x0001, 45, 43, 0],
  [0x5601, 46, 46, 0],
];

// The MQ encoder (T.800 Annex C.2's INITENC/CODEMPS/CODELPS/RENORM/BYTEOUT/FLUSH), restated from the specification's own figures rather than shared with the decoder under test.
class MqEncoder {
  private readonly out: number[] = [];
  private bp = -1;
  private a = 0x8000;
  private c = 0;
  private ct = 12;

  private b(): number {
    return this.bp < 0 ? 0 : (this.out[this.bp] ?? 0);
  }

  private setB(value: number): void {
    if (this.bp >= 0) {
      this.out[this.bp] = value & 0xff;
    }
  }

  private byteOut(): void {
    if (this.b() === 0xff) {
      this.bp++;
      this.setB(this.c >>> 20);
      this.c &= 0xfffff;
      this.ct = 7;
      return;
    }
    if (this.c > 0x7ffffff) {
      this.setB(this.b() + 1);
      if (this.b() === 0xff) {
        this.c &= 0x7ffffff;
        this.bp++;
        this.setB(this.c >>> 20);
        this.c &= 0xfffff;
        this.ct = 7;
        return;
      }
    }
    this.bp++;
    this.setB(this.c >>> 19);
    this.c &= 0x7ffff;
    this.ct = 8;
  }

  private renorm(): void {
    do {
      this.a = (this.a << 1) & 0xffff;
      this.c = (this.c << 1) >>> 0;
      this.ct--;
      if (this.ct === 0) {
        this.byteOut();
      }
    } while ((this.a & 0x8000) === 0);
  }

  encode(
    states: Uint8Array<ArrayBuffer>,
    contextIndex: number,
    d: number,
  ): void {
    const state = states[contextIndex] ?? 0;
    let index = state >> 1;
    let mps = state & 1;
    const [qe, nmps, nlps, sw] = ENCODER_QE_STATES[index] ?? [0, 0, 0, 0];
    if (d === mps) {
      this.a -= qe;
      if ((this.a & 0x8000) === 0) {
        if (this.a < qe) {
          this.a = qe;
        } else {
          this.c = (this.c + qe) >>> 0;
        }
        index = nmps;
        states[contextIndex] = (index << 1) | mps;
        this.renorm();
      } else {
        this.c = (this.c + qe) >>> 0;
      }
      return;
    }
    this.a -= qe;
    if (this.a < qe) {
      this.c = (this.c + qe) >>> 0;
    } else {
      this.a = qe;
    }
    if (sw === 1) {
      mps = 1 - mps;
    }
    states[contextIndex] = (nlps << 1) | mps;
    this.renorm();
  }

  flush(): Uint8Array<ArrayBuffer> {
    const tempC = (this.c + this.a) >>> 0;
    this.c = (this.c | 0xffff) >>> 0;
    if (this.c >= tempC) {
      this.c = (this.c - 0x8000) >>> 0;
    }
    this.c = (this.c << this.ct) >>> 0;
    this.byteOut();
    this.c = (this.c << this.ct) >>> 0;
    this.byteOut();
    if (this.b() !== 0xff) {
      this.bp++;
      this.setB(0xff);
    }
    this.bp++;
    this.setB(0xac);
    return Uint8Array.from(this.out.slice(0, this.bp + 1));
  }
}

// T.800 Table D.1 restated: the zero-coding context label for each subband and neighbour sum, transcribed independently of zeroCodingContext so the two cannot share a mistake.
function zeroCodingLabel(
  subband: Jpeg2000SubbandType,
  h: number,
  v: number,
  d: number,
): number {
  if (subband === "HH") {
    const straight = h + v;
    if (d >= 3) {
      return 8;
    }
    if (d === 2) {
      return straight >= 1 ? 7 : 6;
    }
    if (d === 1) {
      return straight >= 2 ? 5 : straight === 1 ? 4 : 3;
    }
    return straight >= 2 ? 2 : straight === 1 ? 1 : 0;
  }
  const primary = subband === "HL" ? v : h;
  const secondary = subband === "HL" ? h : v;
  if (primary === 2) {
    return 8;
  }
  if (primary === 1) {
    return secondary >= 1 ? 7 : d >= 1 ? 6 : 5;
  }
  if (secondary === 2) {
    return 4;
  }
  if (secondary === 1) {
    return 3;
  }
  return d >= 2 ? 2 : d === 1 ? 1 : 0;
}

// T.800 Table D.3 restated: rows of (horizontal, vertical, context offset above 9, XOR bit).
const SIGN_TABLE_D3: readonly (readonly [number, number, number, number])[] = [
  [1, 1, 4, 0],
  [1, 0, 3, 0],
  [1, -1, 2, 0],
  [0, 1, 1, 0],
  [0, 0, 0, 0],
  [0, -1, 1, 1],
  [-1, 1, 2, 1],
  [-1, 0, 3, 1],
  [-1, -1, 4, 1],
];

function signCoding(h: number, v: number): { offset: number; flip: boolean } {
  const row = SIGN_TABLE_D3.find(([rh, rv]) => rh === h && rv === v);
  if (row === undefined) {
    throw new Error(`no Table D.3 row for (${h}, ${v})`);
  }
  return { offset: row[2], flip: row[3] === 1 };
}

// The code-block style bits Table A.19 defines, restated for the encoder.
const ENCODER_STYLE_RESET_CONTEXTS = 0x02;
const ENCODER_STYLE_VERTICALLY_CAUSAL = 0x08;
const ENCODER_STYLE_SEGMENTATION_SYMBOLS = 0x20;

// One coefficient per cell: magnitude m (coded bit by bit from the most significant plane down, so m must be below 2^planes) and a sign, with a magnitude of zero meaning the coefficient never becomes significant.
interface EncoderGrid {
  readonly width: number;
  readonly height: number;
  readonly subband: Jpeg2000SubbandType;
  readonly maxBitPlanes: number;
  readonly zeroBitPlanes?: number;
  readonly codeBlockStyle?: number;
  // Sparse cells as [x, y, magnitude, sign]; every cell not listed has magnitude zero.
  readonly cells: readonly (readonly [number, number, number, number])[];
  // The four-bit symbol to terminate every cleanup pass with when segmentation symbols are enabled; D.3.4's 0xA unless a test deliberately corrupts it.
  readonly segmentationSymbol?: number;
}

interface EncodedBlock {
  readonly data: Uint8Array<ArrayBuffer>;
  readonly values: Int32Array;
}

function encodeCodeBlock(grid: EncoderGrid): EncodedBlock {
  const {
    width,
    height,
    subband,
    maxBitPlanes,
    codeBlockStyle = 0,
    segmentationSymbol = 0xa,
  } = grid;
  const zeroBitPlanes = grid.zeroBitPlanes ?? 0;
  const planes = maxBitPlanes - zeroBitPlanes;
  if (planes <= 0) {
    throw new Error("the grid codes no bit-planes");
  }
  const totalPasses = 3 * planes - 2;
  const magnitudes = new Array<number>(width * height).fill(0);
  const signs = new Array<number>(width * height).fill(1);
  for (const [x, y, magnitude, sign] of grid.cells) {
    if (magnitude <= 0 || magnitude >= 1 << planes) {
      throw new Error(
        `magnitude ${magnitude} does not fit ${planes} coded bit-planes`,
      );
    }
    magnitudes[y * width + x] = magnitude;
    signs[y * width + x] = sign < 0 ? -1 : 1;
  }

  const stride = width + 2;
  const cellCount = stride * (height + 2);
  const significant = new Uint8Array(cellCount);
  const negative = new Uint8Array(cellCount);
  const codedThisPlane = new Uint8Array(cellCount);
  const everRefined = new Uint8Array(cellCount);
  const at = (x: number, y: number): number => (y + 1) * stride + (x + 1);
  const causal = (codeBlockStyle & ENCODER_STYLE_VERTICALLY_CAUSAL) !== 0;
  const resetEachPass = (codeBlockStyle & ENCODER_STYLE_RESET_CONTEXTS) !== 0;
  const segmentationSymbols =
    (codeBlockStyle & ENCODER_STYLE_SEGMENTATION_SYMBOLS) !== 0;
  const bit = (x: number, y: number, plane: number): number =>
    ((magnitudes[y * width + x] ?? 0) >> plane) & 1;

  const contexts = new Uint8Array(32);
  const initContexts = (): void => {
    contexts.fill(0);
    contexts[0] = 4 << 1;
    contexts[17] = 3 << 1;
    contexts[18] = 46 << 1;
  };
  initContexts();
  const mq = new MqEncoder();

  const belowVisible = (y: number, stripeEnd: number): boolean =>
    !causal || y + 1 < stripeEnd;

  const context = (x: number, y: number, stripeEnd: number): number => {
    const n = at(x, y);
    const below = belowVisible(y, stripeEnd);
    const h = (significant[n - 1] ?? 0) + (significant[n + 1] ?? 0);
    const v =
      (significant[n - stride] ?? 0) +
      (below ? (significant[n + stride] ?? 0) : 0);
    const d =
      (significant[n - stride - 1] ?? 0) +
      (significant[n - stride + 1] ?? 0) +
      (below
        ? (significant[n + stride - 1] ?? 0) +
          (significant[n + stride + 1] ?? 0)
        : 0);
    return zeroCodingLabel(subband, h, v, d);
  };

  const hasSignificantNeighbour = (
    x: number,
    y: number,
    stripeEnd: number,
  ): boolean => {
    const n = at(x, y);
    const below = belowVisible(y, stripeEnd);
    const straight =
      (significant[n - 1] ?? 0) +
      (significant[n + 1] ?? 0) +
      (significant[n - stride] ?? 0) +
      (below ? (significant[n + stride] ?? 0) : 0);
    const diagonal =
      (significant[n - stride - 1] ?? 0) +
      (significant[n - stride + 1] ?? 0) +
      (below
        ? (significant[n + stride - 1] ?? 0) +
          (significant[n + stride + 1] ?? 0)
        : 0);
    return straight + diagonal > 0;
  };

  const contribution = (cell: number): number =>
    (significant[cell] ?? 0) === 0 ? 0 : (negative[cell] ?? 0) === 1 ? -1 : 1;
  const clampToUnit = (value: number): number =>
    value > 0 ? 1 : value < 0 ? -1 : 0;

  const encodeSign = (
    x: number,
    y: number,
    stripeEnd: number,
    intendedNegative: boolean,
  ): void => {
    const n = at(x, y);
    const below = belowVisible(y, stripeEnd);
    const h = clampToUnit(contribution(n - 1) + contribution(n + 1));
    const v = clampToUnit(
      contribution(n - stride) + (below ? contribution(n + stride) : 0),
    );
    const { offset, flip } = signCoding(h, v);
    // The decoder flips its decision by the XOR bit, so the encoder writes the coefficient's sign already flipped.
    mq.encode(
      contexts,
      9 + offset,
      (intendedNegative ? 1 : 0) ^ (flip ? 1 : 0),
    );
    negative[n] = intendedNegative ? 1 : 0;
  };

  const becomeSignificant = (
    x: number,
    y: number,
    plane: number,
    stripeEnd: number,
  ): void => {
    const n = at(x, y);
    significant[n] = 1;
    if (bit(x, y, plane) !== 1) {
      throw new Error(
        `cell (${x}, ${y}) becomes significant in a plane its magnitude does not cover`,
      );
    }
    encodeSign(x, y, stripeEnd, signs[y * width + x] === -1);
  };

  const columnIsRunLengthEligible = (
    x: number,
    stripe: number,
    stripeEnd: number,
  ): boolean => {
    for (let y = stripe; y < stripeEnd; y++) {
      const n = at(x, y);
      if ((significant[n] ?? 0) === 1 || (codedThisPlane[n] ?? 0) === 1) {
        return false;
      }
      if (context(x, y, stripeEnd) !== 0) {
        return false;
      }
    }
    return true;
  };

  let plane = planes - 1;
  let passType = 2;
  for (let pass = 0; pass < totalPasses; pass++) {
    if (resetEachPass) {
      initContexts();
    }
    if (passType === 0) {
      // D.3.1, the significance propagation pass.
      for (let stripe = 0; stripe < height; stripe += 4) {
        const stripeEnd = Math.min(stripe + 4, height);
        for (let x = 0; x < width; x++) {
          for (let y = stripe; y < stripeEnd; y++) {
            const n = at(x, y);
            if ((significant[n] ?? 0) === 1) {
              continue;
            }
            const label = context(x, y, stripeEnd);
            if (label === 0) {
              continue;
            }
            const decision = bit(x, y, plane);
            mq.encode(contexts, label, decision);
            if (decision === 1) {
              becomeSignificant(x, y, plane, stripeEnd);
            }
            codedThisPlane[n] = 1;
          }
        }
      }
    } else if (passType === 1) {
      // D.3.2, the magnitude refinement pass.
      for (let stripe = 0; stripe < height; stripe += 4) {
        const stripeEnd = Math.min(stripe + 4, height);
        for (let x = 0; x < width; x++) {
          for (let y = stripe; y < stripeEnd; y++) {
            const n = at(x, y);
            if ((significant[n] ?? 0) === 0 || (codedThisPlane[n] ?? 0) === 1) {
              continue;
            }
            const label =
              (everRefined[n] ?? 0) === 1
                ? 16
                : hasSignificantNeighbour(x, y, stripeEnd)
                  ? 15
                  : 14;
            mq.encode(contexts, label, bit(x, y, plane));
            everRefined[n] = 1;
          }
        }
      }
    } else {
      // D.3.4, the cleanup pass, with its run-length mode.
      for (let stripe = 0; stripe < height; stripe += 4) {
        const stripeEnd = Math.min(stripe + 4, height);
        const fullStripe = stripeEnd - stripe === 4;
        for (let x = 0; x < width; x++) {
          let y = stripe;
          if (fullStripe && columnIsRunLengthEligible(x, stripe, stripeEnd)) {
            const firstSignificantRow = Array.from({ length: 4 }, (_, row) =>
              bit(x, stripe + row, plane),
            ).findIndex((decision) => decision === 1);
            if (firstSignificantRow === -1) {
              mq.encode(contexts, 17, 0);
              continue;
            }
            mq.encode(contexts, 17, 1);
            mq.encode(contexts, 18, (firstSignificantRow >> 1) & 1);
            mq.encode(contexts, 18, firstSignificantRow & 1);
            y = stripe + firstSignificantRow;
            becomeSignificant(x, y, plane, stripeEnd);
            y++;
          }
          for (; y < stripeEnd; y++) {
            const n = at(x, y);
            if ((codedThisPlane[n] ?? 0) === 1 || (significant[n] ?? 0) === 1) {
              continue;
            }
            mq.encode(contexts, context(x, y, stripeEnd), bit(x, y, plane));
            if (bit(x, y, plane) === 1) {
              becomeSignificant(x, y, plane, stripeEnd);
            }
          }
        }
      }
      if (segmentationSymbols) {
        for (let shift = 3; shift >= 0; shift--) {
          mq.encode(contexts, 18, (segmentationSymbol >> shift) & 1);
        }
      }
      codedThisPlane.fill(0);
    }
    passType++;
    if (passType > 2) {
      passType = 0;
      plane--;
    }
  }

  const values = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const magnitude = magnitudes[y * width + x] ?? 0;
      const sign = signs[y * width + x] ?? 1;
      // A coefficient that never becomes significant decodes to zero; a fully coded one to twice its magnitude plus the mid-point reconstruction bit of the last (least significant) plane.
      values[y * width + x] = magnitude === 0 ? 0 : sign * (2 * magnitude + 1);
    }
  }
  return { data: mq.flush(), values };
}

// Asserts the round trip: decoding the bytes this encoder writes must return exactly the grid it was handed.
function expectRoundTrip(grid: EncoderGrid): void {
  const { data, values } = encodeCodeBlock(grid);
  const { values: decoded } = decodeJpeg2000CodeBlock({
    width: grid.width,
    height: grid.height,
    subband: grid.subband,
    zeroBitPlanes: grid.zeroBitPlanes ?? 0,
    maxBitPlanes: grid.maxBitPlanes,
    totalPasses: 3 * (grid.maxBitPlanes - (grid.zeroBitPlanes ?? 0)) - 2,
    codeBlockStyle: grid.codeBlockStyle ?? 0,
    data,
  });
  expect(Array.from(decoded)).toEqual(Array.from(values));
}

// A deterministic scatter of magnitudes and signs over a 16x16 grid, dense enough that every context label is reached many times with both decisions, so a decoder that redirects or merges labels tracks different adaptive states from the ones this encoder wrote.
function scatterGrid(
  subband: Jpeg2000SubbandType,
  codeBlockStyle = 0,
  salt = 0,
): EncoderGrid {
  const width = 16;
  const height = 16;
  const maxBitPlanes = 4;
  const cells: (readonly [number, number, number, number])[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const magnitude =
        ((((x * 7 + y * 11 + salt * 3) ^ (x * y * 13 + salt)) % 15) + 15) % 15;
      if (magnitude === 0) {
        continue;
      }
      const sign = (x * 13 + y * 7 + salt) % 5 < 2 ? -1 : 1;
      cells.push([x, y, magnitude, sign]);
    }
  }
  return { width, height, subband, maxBitPlanes, codeBlockStyle, cells };
}

describe("decodeJpeg2000CodeBlock: round trips through a hand-written Annex D encoder", () => {
  it("decodes a single significant coefficient with either sign", () => {
    expectRoundTrip({
      width: 1,
      height: 1,
      subband: "LL",
      maxBitPlanes: 2,
      cells: [[0, 0, 2, 1]],
    });
    expectRoundTrip({
      width: 1,
      height: 1,
      subband: "LL",
      maxBitPlanes: 2,
      cells: [[0, 0, 3, -1]],
    });
  });

  it("decodes a block whose leading bit-planes are all zero", () => {
    expectRoundTrip({
      width: 4,
      height: 4,
      subband: "LL",
      maxBitPlanes: 4,
      zeroBitPlanes: 2,
      cells: [
        [0, 0, 3, 1],
        [1, 2, 2, -1],
        [3, 3, 1, -1],
      ],
    });
  });

  // Two grids per subband orientation: LL and LH read Table D.1's axes one way round, HL exchanges them, and HH is driven by the diagonal sum against the combined straight one. A second, differently scattered grid keeps any label's decision sequence from being a repetition of another's.
  it("decodes the full zero-coding context table of an LL block", () => {
    expectRoundTrip(scatterGrid("LL"));
    expectRoundTrip(scatterGrid("LL", 0, 1));
  });

  it("decodes the full zero-coding context table of an LH block", () => {
    expectRoundTrip(scatterGrid("LH"));
    expectRoundTrip(scatterGrid("LH", 0, 2));
  });

  it("decodes the full zero-coding context table of an HL block", () => {
    expectRoundTrip(scatterGrid("HL"));
    expectRoundTrip(scatterGrid("HL", 0, 3));
  });

  it("decodes the full zero-coding context table of an HH block", () => {
    expectRoundTrip(scatterGrid("HH"));
    expectRoundTrip(scatterGrid("HH", 0, 4));
  });

  it("decodes a block taller than one stripe, with a partial final stripe", () => {
    expectRoundTrip({
      width: 6,
      height: 10,
      subband: "LH",
      maxBitPlanes: 3,
      cells: [
        [0, 0, 5, 1],
        [1, 3, 6, -1],
        [2, 4, 1, -1],
        [3, 7, 3, 1],
        [4, 8, 2, 1],
        [5, 9, 7, -1],
        [0, 9, 4, 1],
        [5, 0, 1, -1],
      ],
    });
  });

  it("decodes run-length columns against columns coding coefficient by coefficient", () => {
    // Column x=0 is all-zero (a run-length "nothing significant" column), x=1 becomes significant part-way down the column (the run-length index bits), and x=2 carries a significant coefficient from the first plane, so the later plane's cleanup finds a column that is partly significant and must not enter run-length mode at all.
    expectRoundTrip({
      width: 3,
      height: 4,
      subband: "LL",
      maxBitPlanes: 3,
      cells: [
        [1, 2, 4, -1],
        [1, 3, 1, 1],
        [2, 0, 5, 1],
        [2, 2, 3, -1],
      ],
    });
  });

  it("separates refinement with a significant neighbour from refinement without one", () => {
    // The isolated coefficient at (0, 0) is refined in context 14 and the vertical pair at x=2 in context 15, so both halves of D.3.2's context choice are exercised on one stream. (An exchange of the two labels themselves is not observable by any stream: both contexts start in state zero and the MQ coder's per-context state is a function of the decisions that context decodes, which an exchange preserves.)
    expectRoundTrip({
      width: 3,
      height: 4,
      subband: "LL",
      maxBitPlanes: 2,
      cells: [
        [0, 0, 3, -1],
        [2, 1, 3, 1],
        [2, 2, 1, -1],
      ],
    });
  });

  it("resets the arithmetic contexts at the start of every coding pass when the style asks for it", () => {
    expectRoundTrip(scatterGrid("HL", 0x02));
  });

  it("treats the row below a stripe as insignificant in vertically causal mode", () => {
    // (0, 4) is significant from the first coded plane, so when stripe 0 is processed again at the next plane down, the coefficient at (0, 3) has a significant neighbour exactly below it: causally invisible, so it stays a context-zero coefficient of the cleanup pass, where a non-causal reading would promote it into the significance propagation pass.
    expectRoundTrip({
      width: 2,
      height: 8,
      subband: "LL",
      maxBitPlanes: 2,
      codeBlockStyle: 0x08,
      cells: [
        [0, 4, 3, -1],
        [0, 3, 1, 1],
        [1, 0, 2, 1],
        [1, 5, 1, -1],
      ],
    });
  });

  it("decodes the same block without the causal restriction when the style does not ask for it", () => {
    expectRoundTrip({
      width: 2,
      height: 8,
      subband: "LL",
      maxBitPlanes: 2,
      cells: [
        [0, 4, 3, -1],
        [0, 3, 1, 1],
        [1, 0, 2, 1],
        [1, 5, 1, -1],
      ],
    });
  });

  it("checks the segmentation symbol at the end of every cleanup pass", () => {
    expectRoundTrip(scatterGrid("LH", 0x20));
  });
});

describe("decodeJpeg2000CodeBlock: segmentation symbol failures", () => {
  it("refuses a code-block whose cleanup pass ends with a symbol other than 0xA", () => {
    const { data } = encodeCodeBlock({
      width: 4,
      height: 4,
      subband: "LL",
      maxBitPlanes: 2,
      codeBlockStyle: 0x20,
      segmentationSymbol: 0x6,
      cells: [
        [0, 0, 2, 1],
        [2, 3, 1, -1],
      ],
    });
    expect(() =>
      decodeJpeg2000CodeBlock({
        width: 4,
        height: 4,
        subband: "LL",
        zeroBitPlanes: 0,
        maxBitPlanes: 2,
        totalPasses: 4,
        codeBlockStyle: 0x20,
        data,
      }),
    ).toThrow(Jpeg2000ParseError);
    expect(() =>
      decodeJpeg2000CodeBlock({
        width: 4,
        height: 4,
        subband: "LL",
        zeroBitPlanes: 0,
        maxBitPlanes: 2,
        totalPasses: 4,
        codeBlockStyle: 0x20,
        data,
      }),
    ).toThrow(/segmentation symbol 0x6 rather than the 0xA/);
  });
});
