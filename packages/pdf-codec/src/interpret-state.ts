// The state records the content-stream interpreter carries, split from interpret.ts, and the glyph displacement arithmetic of ISO 32000-1 9.4.4 that reads them: where the pen goes after one glyph, and where that glyph's own width ended.
import type { Color as LayoutColor } from "document-schema.js";
import type { Matrix } from "./matrix";
import { IDENTITY_MATRIX, multiplyMatrices, translationMatrix } from "./matrix";
import type { GlyphAdvance } from "./interpret-types";

// An unremarkable mid-range glyph advance (half an em) used only when a shown font resource can't be resolved to any width table at all — purely to stop subsequent glyphs collapsing onto the same point; the position is already degraded at that point regardless, and is reported via a diagnostic.
export const FALLBACK_GLYPH_WIDTH_PER_1000 = 500;
// Every "...Per1000" value above is expressed in thousandths of a text-space unit, matching PDF's own /Widths convention (see widthPer1000's own comment); dividing by this converts back to text-space units before scaling by the font size.
export const GLYPH_SPACE_PER_TEXT_SPACE_UNIT = 1000;
// The ASCII space character: word spacing (Tw) applies only to a single-byte code equal to this value (ISO 32000-1 9.3.3).
export const ASCII_SPACE = 0x20;

// ISO 32000-1 Table 52 lists the text state parameters — the font and size a Tf selects, plus Tc/Tw/Tz/TL/Ts — among the device-independent graphics state parameters, so they belong here rather than beside the text matrix: `q` saves them and `Q` restores them exactly as it does the CTM or the fill colour, and a form XObject invoked by `Do` inherits them exactly as it inherits the CTM (8.10.2). Only the text matrix and text line matrix are excluded, and they live in TextObjectState below. Modelling the two as one record is what makes both facts structural rather than something each operator has to remember.
export interface GraphicsState {
  readonly ctm: Matrix;
  readonly fillColor: LayoutColor;
  readonly strokeColor: LayoutColor;
  readonly lineWidth: number;
  readonly dashArray: readonly number[]; // the `d` operator's own dash array (ISO 32000-1 8.4.3.6), empty for the PDF default (a solid line) — the dash phase is write-only state this package never reads back, since content-write.ts always emits phase 0 and no recoverable ContentStrokeStyle distinguishes phases
  readonly fontResourceName: string | undefined;
  readonly fontSizePt: number;
  readonly charSpace: number;
  readonly wordSpace: number;
  readonly horizScale: number; // Tz / 100
  readonly leading: number;
  readonly rise: number;
}

// The text matrix and text line matrix: text OBJECT state (ISO 32000-1 9.4.1), not graphics state. They exist only between BT and ET, are reset to identity by every BT, and are the one part of the text machinery `Q` must not restore — so they sit outside GraphicsState and outside the q/Q stack entirely.
export interface TextObjectState {
  tm: Matrix;
  tlm: Matrix;
}

export function initialTextParameters(): Omit<
  GraphicsState,
  "ctm" | "fillColor" | "strokeColor" | "lineWidth" | "dashArray"
> {
  return {
    fontResourceName: undefined,
    fontSizePt: 0,
    charSpace: 0,
    wordSpace: 0,
    horizScale: 1,
    leading: 0,
    rise: 0,
  };
}

export function defaultTextObjectState(): TextObjectState {
  return { tm: IDENTITY_MATRIX, tlm: IDENTITY_MATRIX };
}

export function computeTrm(gs: GraphicsState, text: TextObjectState): Matrix {
  const fontMatrix: Matrix = [
    gs.fontSizePt * gs.horizScale,
    0,
    0,
    gs.fontSizePt,
    0,
    gs.rise,
  ];
  return multiplyMatrices(multiplyMatrices(fontMatrix, text.tm), gs.ctm);
}

/** Where one glyph leaves the text matrix, and what lies between the glyph and the next one. */
export interface GlyphStep {
  /** How many bytes of the shown string the glyph's code took. */
  readonly byteLength: number;
  /** The text matrix after the glyph's width and its spacing, where the next glyph starts. */
  readonly tm: Matrix;
  /** The text matrix at the end of the glyph's own advance width, before any spacing. */
  readonly widthEndTm: Matrix;
  /** The glyph's own advance width in unscaled text space units, along the direction the font is set in. */
  readonly widthAdvance: number;
  /** The character spacing added after the glyph's width, in unscaled text space units. The word spacing a single-byte space takes is not counted: the space character already records that word boundary in the run's text. */
  readonly charSpaceAfter: number;
}

/**
 * Moves a text matrix past one glyph.
 * @param gs - the graphics state whose font size, spacing and horizontal scaling apply
 * @param tm - the text matrix where the glyph starts
 * @param glyph - the font's advance for the glyph's code, or undefined when the font could not be resolved, in which case a fallback width is assumed and the code is taken as one byte
 * @param codes - the shown string
 * @param offset - where the glyph's code starts in `codes`
 * @returns the step, with the pen's new position and the end of the glyph's own width reported apart so a caller can tell the glyph's extent from the gap after it
 */
export function stepPastGlyph(
  gs: GraphicsState,
  tm: Matrix,
  glyph: GlyphAdvance | undefined,
  codes: Uint8Array<ArrayBuffer>,
  offset: number,
): GlyphStep {
  const widthPer1000 = glyph?.widthPer1000 ?? FALLBACK_GLYPH_WIDTH_PER_1000;
  const byteLength = glyph?.byteLengthConsumed ?? 1;
  const isSingleByteSpace = byteLength === 1 && codes[offset] === ASCII_SPACE;
  const spacing = gs.charSpace + (isSingleByteSpace ? gs.wordSpace : 0);
  // ISO 32000-1 9.4.4's own two displacement formulas. Horizontal advances by the glyph's width along x, scaled by Tz; vertical advances by the glyph's own w1y along y, which Tz does not touch since it scales horizontally only.
  const vertical = glyph?.vertical;
  const widthAdvance =
    vertical === undefined
      ? (widthPer1000 / GLYPH_SPACE_PER_TEXT_SPACE_UNIT) * gs.fontSizePt
      : (vertical.displacementPer1000 / GLYPH_SPACE_PER_TEXT_SPACE_UNIT) *
        gs.fontSizePt;
  const along = (distance: number): Matrix =>
    vertical === undefined
      ? translationMatrix(distance * gs.horizScale, 0)
      : translationMatrix(0, distance);
  return {
    byteLength,
    // The pen moves by width and spacing in one translation, so a run whose spacing is zero lands exactly where its widths alone put it.
    tm: multiplyMatrices(along(widthAdvance + spacing), tm),
    widthEndTm: multiplyMatrices(along(widthAdvance), tm),
    widthAdvance,
    charSpaceAfter: gs.charSpace,
  };
}
