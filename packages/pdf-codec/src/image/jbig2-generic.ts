import type { ArithContexts, MqDecoder } from './jbig2-arith';
import type { Jbig2Bitmap } from './jbig2-bitmap';
import { createBitmap, getPixel } from './jbig2-bitmap';
import { Jbig2UnsupportedError } from './jbig2-errors';

// The generic region decoding procedure (ITU-T T.88 6.2) and the generic refinement region decoding procedure (6.3): the two template-driven, context-modelled procedures that turn an MQ bit stream into a bitmap. Everything a JBIG2 stream ultimately paints -- a whole scanned page, an individual symbol in a dictionary, a refined symbol instance -- comes out of one of these two.
//
// A template is a fixed set of already-decoded neighbouring pixels; their values, concatenated in a fixed order, form the CONTEXT index into the adaptive probability states the arithmetic decoder keeps. The orderings below are the ones T.88 Figures 4-7 (generic) and Figures 12-13 (refinement) lay out, written MSB-first so each list reads left to right, top row down, exactly as the specification's own diagrams do.
//
// Worth knowing when reading or changing these: the SET of positions is load-bearing and cross-checked against a second implementation, but the ORDER within a list is not observable from outside. A context index is only a label for a neighbourhood pattern, so permuting a template's own list produces a different numbering that decodes identically -- the arithmetic coder's adaptive state simply lives under a different label. The one thing that ties a numbering down is a fixed pseudo-context constant used alongside it, which is why GENERIC_SLTP_CONTEXT below must be kept in step with GENERIC_TEMPLATES if either is ever reordered.

export interface Jbig2AtPixel {
  readonly x: number;
  readonly y: number;
}

// One template position: either a fixed offset from the pixel being decoded, or the nth adaptive (AT) pixel, whose offset the segment header supplies.
type TemplatePosition = { readonly kind: 'fixed'; readonly dx: number; readonly dy: number } | { readonly kind: 'at'; readonly index: number };

function fixed(dx: number, dy: number): TemplatePosition {
  return { kind: 'fixed', dx, dy };
}

function at(index: number): TemplatePosition {
  return { kind: 'at', index };
}

// T.88 Figures 4-7. Listed most-significant context bit first.
const GENERIC_TEMPLATES: readonly (readonly TemplatePosition[])[] = [
  // GBTEMPLATE 0 (Figure 4): 16 pixels, four of them adaptive. Nominal AT offsets are A1 (+3,-1), A2 (-3,-1), A3 (+2,-2), A4 (-2,-2).
  [at(3), fixed(-1, -2), fixed(0, -2), fixed(1, -2), at(2), at(1), fixed(-2, -1), fixed(-1, -1), fixed(0, -1), fixed(1, -1), fixed(2, -1), at(0), fixed(-4, 0), fixed(-3, 0), fixed(-2, 0), fixed(-1, 0)],
  // GBTEMPLATE 1 (Figure 5): 13 pixels, one adaptive. Nominal A1 (+3,-1).
  [fixed(-1, -2), fixed(0, -2), fixed(1, -2), fixed(2, -2), fixed(-2, -1), fixed(-1, -1), fixed(0, -1), fixed(1, -1), fixed(2, -1), at(0), fixed(-3, 0), fixed(-2, 0), fixed(-1, 0)],
  // GBTEMPLATE 2 (Figure 6): 10 pixels, one adaptive. Nominal A1 (+2,-1).
  [fixed(-1, -2), fixed(0, -2), fixed(1, -2), fixed(-2, -1), fixed(-1, -1), fixed(0, -1), fixed(1, -1), at(0), fixed(-2, 0), fixed(-1, 0)],
  // GBTEMPLATE 3 (Figure 7): 10 pixels, one adaptive, a single reference row. Nominal A1 (+2,-1).
  [fixed(-3, -1), fixed(-2, -1), fixed(-1, -1), fixed(0, -1), fixed(1, -1), at(0), fixed(-4, 0), fixed(-3, 0), fixed(-2, 0), fixed(-1, 0)],
];

// T.88 6.2.5.7: the fixed pseudo-context each template uses for the typical-prediction (SLTP) decision that precedes every row when TPGDON is set. Each value is expressed in that template's own context bit ordering above, so the two must move together.
//
// Each is the same picture read off the corresponding figure: 0x9b25 splits into the 5, 7 and 4 pixel rows of GBTEMPLATE 0 as 10011 0110010 0101, 0x0795 into GBTEMPLATE 1's 4, 6 and 3 as 0011 110010 101, 0x00e5 into GBTEMPLATE 2's 3, 5 and 2 as 001 11001 01, and 0x0195 into GBTEMPLATE 3's 6 and 4 as 011001 0101. The GBTEMPLATE 0 pairing is confirmed empirically as well, by decoding real `jbig2 -d` output from jbig2enc -- an encoder using the specification's own constant, so a mismatch here would corrupt those fixtures rather than round-trip.
const GENERIC_SLTP_CONTEXT: readonly number[] = [0x9b25, 0x0795, 0x00e5, 0x0195];

export const GENERIC_CONTEXT_BITS: readonly number[] = [16, 13, 10, 10];

export interface GenericRegionParams {
  readonly template: number;
  readonly tpgdon: boolean;
  readonly at: readonly Jbig2AtPixel[];
}

function resolveTemplate(template: number): readonly TemplatePosition[] {
  const positions = GENERIC_TEMPLATES[template];
  if (positions === undefined) {
    throw new Jbig2UnsupportedError(`generic region declares GBTEMPLATE ${String(template)}, which is outside the 0-3 range T.88 6.2.5.3 defines`);
  }
  return positions;
}

// Resolves a template's own adaptive entries against the AT offsets a segment actually declared, flattening the result into parallel offset arrays. Done once per region rather than once per pixel: the inner loop below runs up to sixteen times for every pixel of a page, so a per-position object property read there is the difference between a page decoding in well under a second and taking several.
function flattenTemplate(positions: readonly TemplatePosition[], at: readonly Jbig2AtPixel[]): { readonly dx: Int32Array; readonly dy: Int32Array } {
  const dx = new Int32Array(positions.length);
  const dy = new Int32Array(positions.length);
  positions.forEach((position, i) => {
    const offset = position.kind === 'fixed' ? { x: position.dx, y: position.dy } : (at[position.index] ?? { x: 0, y: 0 });
    dx[i] = offset.x;
    dy[i] = offset.y;
  });
  return { dx, dy };
}

// The generic region decoding procedure, T.88 6.2.5.7.
export function decodeGenericRegion(width: number, height: number, params: GenericRegionParams, mq: MqDecoder, contexts: ArithContexts): Jbig2Bitmap {
  const bitmap = createBitmap(width, height);
  const positions = resolveTemplate(params.template);
  const sltpContext = GENERIC_SLTP_CONTEXT[params.template] ?? 0;
  const { dx, dy } = flattenTemplate(positions, params.at);
  const data = bitmap.data;
  const count = positions.length;

  // Precomputed flat indices, valid only where every template position lands inside the bitmap -- which is the overwhelming majority of a real page, since the template only ever reaches a few pixels left, right, and up.
  const flatOffset = new Int32Array(count);
  let minDx = 0;
  let maxDx = 0;
  let minDy = 0;
  let maxDy = 0;
  for (let i = 0; i < count; i++) {
    flatOffset[i] = dy[i]! * width + dx[i]!;
    minDx = Math.min(minDx, dx[i]!);
    maxDx = Math.max(maxDx, dx[i]!);
    minDy = Math.min(minDy, dy[i]!);
    maxDy = Math.max(maxDy, dy[i]!);
  }
  const interiorFromX = -minDx;
  const interiorToX = width - maxDx;

  let typicalPrediction = 0;
  for (let y = 0; y < height; y++) {
    if (params.tpgdon) {
      typicalPrediction ^= mq.decode(contexts, sltpContext);
      if (typicalPrediction === 1) {
        // A "typical" row is byte-for-byte the row above it, and carries no coded pixels at all.
        if (y > 0) {
          data.copyWithin(y * width, (y - 1) * width, y * width);
        }
        continue;
      }
    }
    const rowInterior = y + minDy >= 0 && y + maxDy < height;
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      let context = 0;
      if (rowInterior && x >= interiorFromX && x < interiorToX) {
        const base = rowBase + x;
        for (let i = 0; i < count; i++) {
          context = (context << 1) | data[base + flatOffset[i]!]!;
        }
      } else {
        for (let i = 0; i < count; i++) {
          context = (context << 1) | getPixel(bitmap, x + dx[i]!, y + dy[i]!);
        }
      }
      data[rowBase + x] = mq.decode(contexts, context);
    }
  }
  return bitmap;
}

// --- The generic refinement region decoding procedure (T.88 6.3). ---

// A refinement template reads from two bitmaps at once: the one being decoded, and the reference bitmap offset by (dx, dy).
type RefinementPosition =
  | { readonly source: 'destination'; readonly dx: number; readonly dy: number }
  | { readonly source: 'reference'; readonly dx: number; readonly dy: number }
  | { readonly source: 'destination-at'; readonly index: number }
  | { readonly source: 'reference-at'; readonly index: number };

function destination(dx: number, dy: number): RefinementPosition {
  return { source: 'destination', dx, dy };
}

function reference(dx: number, dy: number): RefinementPosition {
  return { source: 'reference', dx, dy };
}

// T.88 Figures 12 (GRTEMPLATE 0, 13 pixels, two of them adaptive) and 13 (GRTEMPLATE 1, 10 pixels, none adaptive). Listed most-significant context bit first: the pixels read from the bitmap being decoded come first, then those read from the reference. Only the position set is load-bearing here, per the note at the top of this file -- with TPGRON refused below, no fixed pseudo-context constant ties these two lists to a particular numbering at all.
const REFINEMENT_TEMPLATES: readonly (readonly RefinementPosition[])[] = [
  [destination(0, -1), destination(1, -1), destination(-1, 0), { source: 'destination-at', index: 0 }, reference(0, -1), reference(1, -1), reference(-1, 0), reference(0, 0), reference(1, 0), reference(-1, 1), reference(0, 1), reference(1, 1), { source: 'reference-at', index: 1 }],
  [destination(-1, -1), destination(0, -1), destination(1, -1), destination(-1, 0), reference(0, -1), reference(-1, 0), reference(0, 0), reference(1, 0), reference(0, 1), reference(1, 1)],
];

// Typical prediction in a refinement region (TPGRON, T.88 6.3.5.6) is deliberately NOT implemented, and a region that sets it fails loudly instead of guessing.
//
// The decision procedure itself is straightforward -- one pseudo-context decision per row, then pixels whose reference 3x3 neighbourhood is uniform are taken from it rather than coded -- but it hinges on a single fixed pseudo-context constant per template, and this package has no way to establish those two numbers. No encoder available here emits TPGRON (jbig2enc's refinement support is disabled upstream: "Refinement broke in recent releases since it's rarely used"), so the only cross-check available is against a stream this package encoded itself, and that cannot pin the constant even in principle: the pseudo-context shares one adaptive state array with the real pixel contexts, so ANY constant that happens not to collide with a pattern the test image actually produces round-trips perfectly against an independent decoder using a different constant. Brute-forcing all 1024 ten-bit candidates against jbig2dec confirmed this empirically -- for GRTEMPLATE 0 a whole band of unrelated constants passed one test image and a different band passed another, which is the signature of the test measuring collision luck rather than correctness.
//
// Everything else about refinement IS cross-checked against jbig2dec and works: both templates, adaptive pixels, arbitrary reference offsets, and refinement of symbol instances inside a text region -- which is where refinement actually appears in practice, and where T.88 6.4.11 fixes TPGRON at 0 anyway. A standalone refinement region setting TPGRON is the only thing this rules out.
const TPGRON_UNSUPPORTED = 'JBIG2 refinement region sets TPGRON (typical prediction, T.88 6.3.5.6), whose per-template pseudo-context constants this decoder has no way to verify against a real encoder; refusing rather than risking a silently wrong bitmap';

export const REFINEMENT_CONTEXT_BITS: readonly number[] = [13, 10];

// The nominal adaptive-pixel offsets for GRTEMPLATE 0 (T.88 Figure 12): A1 relative to the destination, A2 relative to the reference.
export const NOMINAL_REFINEMENT_AT: readonly Jbig2AtPixel[] = [
  { x: -1, y: -1 },
  { x: -1, y: -1 },
];

export interface RefinementRegionParams {
  readonly template: number;
  readonly tpgron: boolean;
  readonly at: readonly Jbig2AtPixel[];
  readonly reference: Jbig2Bitmap;
  // The reference bitmap's own offset within the region being decoded (T.88 6.3.5.3's GRREFERENCEDX/DY).
  readonly dx: number;
  readonly dy: number;
}

export function decodeRefinementRegion(width: number, height: number, params: RefinementRegionParams, mq: MqDecoder, contexts: ArithContexts): Jbig2Bitmap {
  const positions = REFINEMENT_TEMPLATES[params.template];
  if (positions === undefined) {
    throw new Jbig2UnsupportedError(`refinement region declares GRTEMPLATE ${String(params.template)}, which is outside the 0-1 range T.88 6.3.5.3 defines`);
  }
  if (params.tpgron) {
    throw new Jbig2UnsupportedError(TPGRON_UNSUPPORTED);
  }
  const bitmap = createBitmap(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let context = 0;
      for (const position of positions) {
        if (position.source === 'destination') {
          context = (context << 1) | getPixel(bitmap, x + position.dx, y + position.dy);
        } else if (position.source === 'reference') {
          context = (context << 1) | getPixel(params.reference, x - params.dx + position.dx, y - params.dy + position.dy);
        } else if (position.source === 'destination-at') {
          const atPixel = params.at[position.index] ?? { x: 0, y: 0 };
          context = (context << 1) | getPixel(bitmap, x + atPixel.x, y + atPixel.y);
        } else {
          const atPixel = params.at[position.index] ?? { x: 0, y: 0 };
          context = (context << 1) | getPixel(params.reference, x - params.dx + atPixel.x, y - params.dy + atPixel.y);
        }
      }
      bitmap.data[y * width + x] = mq.decode(contexts, context);
    }
  }
  return bitmap;
}
