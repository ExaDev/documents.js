import { MqDecoder, createArithContexts } from './jbig2-arith';
import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';

// The EBCOT tier-1 code-block decoder of ISO/IEC 15444-1 Annex D: three coding passes per bit-plane (significance propagation, magnitude refinement, cleanup) driven by the same MQ arithmetic decoder JBIG2 uses. T.800 Annex C and T.88 Annex E specify the identical coder -- same Qe state table, same INITDEC/BYTEIN/DECODE/RENORMD -- so src/image/jbig2-arith.ts's MqDecoder is reused verbatim here rather than duplicated. The only JPEG 2000-specific part of the entropy layer is which contexts start in a non-zero state (Table D.7), applied below.
//
// This module has no codestream knowledge at all: it is handed one code-block's bytes, its dimensions, which subband it belongs to, and how many bit-planes and coding passes were coded, and it hands back one signed integer per coefficient.

export type Jpeg2000SubbandType = 'LL' | 'HL' | 'LH' | 'HH';

// T.800 Table D.7's own numbering: contexts 0-8 are the zero-coding (significance) labels, 9-13 the sign-coding labels, 14-16 the magnitude-refinement labels, 17 the run-length context, 18 the uniform context.
const SIGN_CONTEXT_BASE = 9;
const MAGNITUDE_REFINEMENT_NO_NEIGHBOURS = 14;
const MAGNITUDE_REFINEMENT_WITH_NEIGHBOURS = 15;
const MAGNITUDE_REFINEMENT_SUBSEQUENT = 16;
const RUN_LENGTH_CONTEXT = 17;
const UNIFORM_CONTEXT = 18;
const CONTEXT_COUNT_BITS = 5; // 32 slots, the smallest power of two that holds the 19 contexts above.

// T.800 Table D.7: every context starts in state 0 with an MPS of 0 except these three. The MqDecoder packs a context as (stateIndex << 1) | mps, so an initial state is just the index doubled.
const INITIAL_STATE_ZERO_CODING_0 = 4;
const INITIAL_STATE_RUN_LENGTH = 3;
const INITIAL_STATE_UNIFORM = 46;

// T.800 Table A.19, the code-block style bit field.
const STYLE_SELECTIVE_BYPASS = 0x01;
const STYLE_RESET_CONTEXTS = 0x02;
const STYLE_TERMINATE_ALL = 0x04;
const STYLE_VERTICALLY_CAUSAL = 0x08;
const STYLE_SEGMENTATION_SYMBOLS = 0x20;

// D.3.4: the four-bit symbol 0b1010 an encoder writes at the end of every cleanup pass when segmentation symbols are enabled, and the only thing that makes the option observable to a decoder.
const SEGMENTATION_SYMBOL = 0xa;

// The coefficients are scanned in stripes of four rows (D.2): whole stripe columns top to bottom, left to right across the code-block, stripe by stripe down it.
const STRIPE_HEIGHT = 4;

// D.3.1/D.3.2/D.3.4, in the order the passes run for one bit-plane. The very first pass of a code-block is a cleanup pass, because the bit-plane it belongs to has no earlier plane for the other two passes to build on.
const PASS_SIGNIFICANCE = 0;
const PASS_REFINEMENT = 1;
const PASS_CLEANUP = 2;

export interface Jpeg2000CodeBlockDecodeOptions {
  readonly width: number;
  readonly height: number;
  readonly subband: Jpeg2000SubbandType;
  // The number of leading all-zero bit-planes the packet header declared for this code-block.
  readonly zeroBitPlanes: number;
  // Mb, the total bit-plane count for the subband: the quantization exponent plus the guard bits, less one (T.800 E.1, equation E-2).
  readonly maxBitPlanes: number;
  readonly totalPasses: number;
  readonly codeBlockStyle: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

export interface Jpeg2000CodeBlockResult {
  // One signed value per coefficient in raster order, at twice the coefficient's own scale and already carrying T.800 E.1.1.2's mid-point reconstruction: a coefficient of magnitude m whose lowest decoded bit-plane is p comes back as +/-(2m + 2^p). Halving it recovers the exact magnitude when every plane was decoded, and biases a truncated coefficient to the middle of the interval its decoded bits actually pin it to, which is what the reconstruction parameter r = 0.5 means.
  readonly values: Int32Array;
}

function throwForUnsupportedStyle(style: number): void {
  if ((style & STYLE_SELECTIVE_BYPASS) !== 0) {
    throw new Jpeg2000UnsupportedError('the code-block style enables selective arithmetic coding bypass (lazy mode), which splits a code-block into raw and arithmetically coded segments this decoder does not read');
  }
  if ((style & STYLE_TERMINATE_ALL) !== 0) {
    throw new Jpeg2000UnsupportedError('the code-block style terminates the arithmetic coder on every coding pass, which splits a code-block into one segment per pass this decoder does not read');
  }
  // The remaining flag, predictable termination (0x10), is deliberately accepted and ignored rather than named as a constant above: it constrains how an encoder terminates so a decoder can detect corruption, and changes nothing at all about how correct data decodes.
}

// T.800 Table D.1. The three neighbour sums are the count of significant horizontal (2 max), vertical (2 max), and diagonal (4 max) neighbours; HL swaps the roles of the horizontal and vertical sums relative to LL/LH, and HH is driven by the diagonal count against the combined horizontal-plus-vertical one.
function zeroCodingContext(subband: Jpeg2000SubbandType, horizontal: number, vertical: number, diagonal: number): number {
  if (subband === 'HH') {
    const straight = horizontal + vertical;
    if (diagonal >= 3) {
      return 8;
    }
    if (diagonal === 2) {
      return straight >= 1 ? 7 : 6;
    }
    if (diagonal === 1) {
      return straight >= 2 ? 5 : straight === 1 ? 4 : 3;
    }
    return straight >= 2 ? 2 : straight === 1 ? 1 : 0;
  }
  // HL is the horizontally low-pass band, so its own table is LL/LH's with the two axes exchanged.
  const primary = subband === 'HL' ? vertical : horizontal;
  const secondary = subband === 'HL' ? horizontal : vertical;
  if (primary === 2) {
    return 8;
  }
  if (primary === 1) {
    if (secondary >= 1) {
      return 7;
    }
    return diagonal >= 1 ? 6 : 5;
  }
  if (secondary === 2) {
    return 4;
  }
  if (secondary === 1) {
    return 3;
  }
  return diagonal >= 2 ? 2 : diagonal === 1 ? 1 : 0;
}

// T.800 Table D.3, indexed by the clamped horizontal and vertical sign contributions offset to 0..2. The value packs the context label in its low bits and the XOR bit -- the sign the decoded decision is to be flipped by -- in bit 3.
const SIGN_CONTEXT_TABLE: readonly number[] = (() => {
  // Table D.3 rows, as (horizontal, vertical, contextOffset, xorBit). The offsets are relative to SIGN_CONTEXT_BASE, i.e. context 9 is offset 0.
  const rows: readonly (readonly [number, number, number, number])[] = [
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
  const table = new Array<number>(9).fill(0);
  for (const [horizontal, vertical, offset, xorBit] of rows) {
    table[(horizontal + 1) * 3 + (vertical + 1)] = offset | (xorBit << 3);
  }
  return table;
})();

const SIGN_XOR_FLAG = 0x08;

export function decodeJpeg2000CodeBlock(options: Jpeg2000CodeBlockDecodeOptions): Jpeg2000CodeBlockResult {
  const { width, height, subband, zeroBitPlanes, maxBitPlanes, totalPasses, codeBlockStyle, data } = options;
  throwForUnsupportedStyle(codeBlockStyle);
  const values = new Int32Array(Math.max(width * height, 0));
  const codedBitPlanes = maxBitPlanes - zeroBitPlanes;
  if (width <= 0 || height <= 0 || codedBitPlanes <= 0 || totalPasses <= 0 || data.length === 0) {
    return { values };
  }

  // A one-cell border of permanently insignificant samples removes every bounds check from the neighbourhood sums below: a coefficient outside the code-block is insignificant by definition (D.3), which a zero-filled border already says.
  const stride = width + 2;
  const cellCount = stride * (height + 2);
  const significant = new Uint8Array(cellCount);
  const negative = new Uint8Array(cellCount);
  const codedThisPlane = new Uint8Array(cellCount);
  const everRefined = new Uint8Array(cellCount);
  const magnitude = new Int32Array(cellCount);
  const lastCodedPlane = new Int32Array(cellCount);

  const contexts = createArithContexts(CONTEXT_COUNT_BITS);
  const resetContexts = (): void => {
    contexts.fill(0);
    contexts[0] = INITIAL_STATE_ZERO_CODING_0 << 1;
    contexts[RUN_LENGTH_CONTEXT] = INITIAL_STATE_RUN_LENGTH << 1;
    contexts[UNIFORM_CONTEXT] = INITIAL_STATE_UNIFORM << 1;
  };
  resetContexts();
  const mq = new MqDecoder(data, 0, data.length);

  const verticallyCausal = (codeBlockStyle & STYLE_VERTICALLY_CAUSAL) !== 0;
  const segmentationSymbols = (codeBlockStyle & STYLE_SEGMENTATION_SYMBOLS) !== 0;
  const resetEachPass = (codeBlockStyle & STYLE_RESET_CONTEXTS) !== 0;

  const at = (x: number, y: number): number => (y + 1) * stride + (x + 1);

  // In vertically causal mode (T.800 Table A.19) a coefficient never sees the stripe below its own, so the row after the current stripe is treated as insignificant no matter what it actually holds.
  const belowVisible = (y: number, stripeEnd: number): boolean => !verticallyCausal || y + 1 < stripeEnd;

  const significanceContext = (x: number, y: number, stripeEnd: number): number => {
    const n = at(x, y);
    const below = belowVisible(y, stripeEnd);
    const horizontal = (significant[n - 1] ?? 0) + (significant[n + 1] ?? 0);
    const vertical = (significant[n - stride] ?? 0) + (below ? (significant[n + stride] ?? 0) : 0);
    const diagonal =
      (significant[n - stride - 1] ?? 0) +
      (significant[n - stride + 1] ?? 0) +
      (below ? (significant[n + stride - 1] ?? 0) + (significant[n + stride + 1] ?? 0) : 0);
    return zeroCodingContext(subband, horizontal, vertical, diagonal);
  };

  const neighbourhoodIsSignificant = (x: number, y: number, stripeEnd: number): boolean => {
    const n = at(x, y);
    const below = belowVisible(y, stripeEnd);
    const straight = (significant[n - 1] ?? 0) + (significant[n + 1] ?? 0) + (significant[n - stride] ?? 0) + (below ? (significant[n + stride] ?? 0) : 0);
    const diagonal =
      (significant[n - stride - 1] ?? 0) +
      (significant[n - stride + 1] ?? 0) +
      (below ? (significant[n + stride - 1] ?? 0) + (significant[n + stride + 1] ?? 0) : 0);
    return straight + diagonal > 0;
  };

  // D.3.2: the sign is coded against the clamped sum of each axis's two neighbours, where a significant positive neighbour contributes +1, a significant negative one -1, and an insignificant one nothing.
  const contribution = (cell: number): number => ((significant[cell] ?? 0) === 0 ? 0 : (negative[cell] ?? 0) === 1 ? -1 : 1);
  const clampToUnit = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

  const decodeSign = (x: number, y: number, stripeEnd: number): void => {
    const n = at(x, y);
    const below = belowVisible(y, stripeEnd);
    const horizontal = clampToUnit(contribution(n - 1) + contribution(n + 1));
    const vertical = clampToUnit(contribution(n - stride) + (below ? contribution(n + stride) : 0));
    const packed = SIGN_CONTEXT_TABLE[(horizontal + 1) * 3 + (vertical + 1)] ?? 0;
    const decision = mq.decode(contexts, SIGN_CONTEXT_BASE + (packed & ~SIGN_XOR_FLAG));
    negative[n] = decision ^ ((packed & SIGN_XOR_FLAG) !== 0 ? 1 : 0);
  };

  const becomeSignificant = (x: number, y: number, plane: number, stripeEnd: number): void => {
    const n = at(x, y);
    significant[n] = 1;
    magnitude[n] = 1 << plane;
    lastCodedPlane[n] = plane;
    decodeSign(x, y, stripeEnd);
  };

  const significancePass = (plane: number): void => {
    for (let stripe = 0; stripe < height; stripe += STRIPE_HEIGHT) {
      const stripeEnd = Math.min(stripe + STRIPE_HEIGHT, height);
      for (let x = 0; x < width; x++) {
        for (let y = stripe; y < stripeEnd; y++) {
          const n = at(x, y);
          if ((significant[n] ?? 0) === 1) {
            continue;
          }
          const context = significanceContext(x, y, stripeEnd);
          if (context === 0) {
            continue; // No significant neighbour: this coefficient belongs to the cleanup pass, not this one.
          }
          if (mq.decode(contexts, context) === 1) {
            becomeSignificant(x, y, plane, stripeEnd);
          } else {
            lastCodedPlane[n] = plane;
          }
          codedThisPlane[n] = 1;
        }
      }
    }
  };

  const refinementPass = (plane: number): void => {
    for (let stripe = 0; stripe < height; stripe += STRIPE_HEIGHT) {
      const stripeEnd = Math.min(stripe + STRIPE_HEIGHT, height);
      for (let x = 0; x < width; x++) {
        for (let y = stripe; y < stripeEnd; y++) {
          const n = at(x, y);
          if ((significant[n] ?? 0) === 0 || (codedThisPlane[n] ?? 0) === 1) {
            continue; // Insignificant, or already coded by this plane's significance pass.
          }
          const context =
            (everRefined[n] ?? 0) === 1
              ? MAGNITUDE_REFINEMENT_SUBSEQUENT
              : neighbourhoodIsSignificant(x, y, stripeEnd)
                ? MAGNITUDE_REFINEMENT_WITH_NEIGHBOURS
                : MAGNITUDE_REFINEMENT_NO_NEIGHBOURS;
          if (mq.decode(contexts, context) === 1) {
            magnitude[n] = (magnitude[n] ?? 0) | (1 << plane);
          }
          everRefined[n] = 1;
          lastCodedPlane[n] = plane;
        }
      }
    }
  };

  const cleanupPass = (plane: number): void => {
    for (let stripe = 0; stripe < height; stripe += STRIPE_HEIGHT) {
      const stripeEnd = Math.min(stripe + STRIPE_HEIGHT, height);
      const fullStripe = stripeEnd - stripe === STRIPE_HEIGHT;
      for (let x = 0; x < width; x++) {
        let y = stripe;
        // D.3.4's run-length mode: a full four-row column in which every coefficient is still insignificant, none was coded earlier in this bit-plane, and none has a significant neighbour is coded as a single decision saying whether any of the four becomes significant at all.
        if (fullStripe && columnIsRunLengthEligible(x, stripe, stripeEnd)) {
          if (mq.decode(contexts, RUN_LENGTH_CONTEXT) === 0) {
            for (let row = stripe; row < stripeEnd; row++) {
              lastCodedPlane[at(x, row)] = plane;
            }
            continue;
          }
          // Two bits in the uniform context give the index of the first coefficient in the column that does become significant; the ones above it are known insignificant and are not coded at all.
          const firstSignificant = (mq.decode(contexts, UNIFORM_CONTEXT) << 1) | mq.decode(contexts, UNIFORM_CONTEXT);
          for (let row = stripe; row < stripe + firstSignificant; row++) {
            lastCodedPlane[at(x, row)] = plane;
          }
          y = stripe + firstSignificant;
          becomeSignificant(x, y, plane, stripeEnd);
          y++;
        }
        for (; y < stripeEnd; y++) {
          const n = at(x, y);
          if ((codedThisPlane[n] ?? 0) === 1 || (significant[n] ?? 0) === 1) {
            continue;
          }
          if (mq.decode(contexts, significanceContext(x, y, stripeEnd)) === 1) {
            becomeSignificant(x, y, plane, stripeEnd);
          } else {
            lastCodedPlane[n] = plane;
          }
        }
      }
    }
    if (segmentationSymbols) {
      const symbol = (mq.decode(contexts, UNIFORM_CONTEXT) << 3) | (mq.decode(contexts, UNIFORM_CONTEXT) << 2) | (mq.decode(contexts, UNIFORM_CONTEXT) << 1) | mq.decode(contexts, UNIFORM_CONTEXT);
      if (symbol !== SEGMENTATION_SYMBOL) {
        throw new Jpeg2000ParseError(`a cleanup pass ended with segmentation symbol 0x${symbol.toString(16)} rather than the 0xA ISO/IEC 15444-1 D.3.4 requires, so this code-block's coded data is corrupt`);
      }
    }
    codedThisPlane.fill(0);
  };

  function columnIsRunLengthEligible(x: number, stripe: number, stripeEnd: number): boolean {
    for (let y = stripe; y < stripeEnd; y++) {
      const n = at(x, y);
      if ((significant[n] ?? 0) === 1 || (codedThisPlane[n] ?? 0) === 1) {
        return false;
      }
      if (significanceContext(x, y, stripeEnd) !== 0) {
        return false;
      }
    }
    return true;
  }

  // The first coded pass is the cleanup pass of the most significant bit-plane that is not known to be all zero; from there the three passes cycle downward one plane at a time until the coded passes run out.
  let plane = codedBitPlanes - 1;
  let passType = PASS_CLEANUP;
  for (let pass = 0; pass < totalPasses && plane >= 0; pass++) {
    if (resetEachPass) {
      resetContexts();
    }
    if (passType === PASS_SIGNIFICANCE) {
      significancePass(plane);
    } else if (passType === PASS_REFINEMENT) {
      refinementPass(plane);
    } else {
      cleanupPass(plane);
    }
    passType++;
    if (passType > PASS_CLEANUP) {
      passType = PASS_SIGNIFICANCE;
      plane--;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = at(x, y);
      if ((significant[n] ?? 0) === 0) {
        continue;
      }
      // The doubled, mid-point-reconstructed value this module's own result type documents.
      const reconstructed = 2 * (magnitude[n] ?? 0) + (1 << (lastCodedPlane[n] ?? 0));
      values[y * width + x] = (negative[n] ?? 0) === 1 ? -reconstructed : reconstructed;
    }
  }
  return { values };
}
