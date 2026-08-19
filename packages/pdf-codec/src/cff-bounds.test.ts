import { describe, expect, it } from 'vitest';
import { parseCffGlyphBounds } from './cff-bounds';
import type { CffGlyphBounds } from './cff-bounds';
import { STIX_TWO_MATH_FONT_BASE64 } from './assets/stix-two-math-font';
import { parseSfnt, sfntTableBytes } from './sfnt';
import { CFF_HEADER, ROS_OPERANDS_AND_OPERATOR, cffFont, cffIndex, stixMathCffBytes } from './test-support/cff';
import { base64ToBytes } from './util/base64';

// Every bounding box asserted below was cross-checked against fontTools 4.61.1's own BoundsPen run over the same vendored assets/fonts/STIXTwoMath-Regular.otf -- an independent, mature implementation of the same computation, not this package's own output re-asserted against itself. That comparison was run across the font's whole 5543-glyph repertoire while building this module: every glyph matched to within 0.01 design units, and every glyph fontTools reported as drawing nothing this module reports as `undefined`.
//
// The font's nominal vertical metrics, for the "tighter than the metric it replaces" assertions: unitsPerEm 1000, hhea ascent 762, hhea descent -238.
const UNITS_PER_EM = 1000;
const NOMINAL_ASCENT = 762;
const NOMINAL_DESCENT = -238;

// Glyph IDs in the vendored font, resolved through its own cmap in math-font.test.ts and hard-coded here so this module's tests need no cmap parse of their own.
const GID_SPACE = 1;
const GID_PERIOD = 1052; // U+002E FULL STOP
const GID_PARENLEFT = 1064; // U+0028 LEFT PARENTHESIS
const GID_X = 279; // U+0078 LATIN SMALL LETTER X
const GID_Y = 280; // U+0079 LATIN SMALL LETTER Y
const GID_BOLD_GAMMA = 4075; // U+1D738 MATHEMATICAL BOLD SMALL GAMMA

function stixBounds(): CffGlyphBounds {
  const bounds = parseCffGlyphBounds(stixMathCffBytes());
  if (bounds === undefined) {
    throw new Error('the vendored STIX Two Math CFF program failed to parse');
  }
  return bounds;
}

describe('parseCffGlyphBounds against the real vendored STIX Two Math CFF program', () => {
  it("walks every one of the font's charstrings and reports its glyph count", () => {
    const bounds = stixBounds();
    expect(bounds.numGlyphs).toBe(5543);
  });

  it('computes real, tight ink boxes for ordinary glyphs', () => {
    const bounds = stixBounds();
    expect(bounds.bounds(GID_PERIOD)).toEqual({ xMin: 62, yMin: -8, xMax: 183, yMax: 114 });
    expect(bounds.bounds(GID_PARENLEFT)).toEqual({ xMin: 45, yMin: -196, xMax: 327, yMax: 736 });
    expect(bounds.bounds(GID_X)).toEqual({ xMin: -2, yMin: 0, xMax: 482, yMax: 473 });
    expect(bounds.bounds(GID_Y)).toEqual({ xMin: -12, yMin: -235, xMax: 493, yMax: 473 });
  });

  it('distinguishes a short glyph from a tall one, which the nominal metrics cannot', () => {
    const bounds = stixBounds();
    const period = bounds.bounds(GID_PERIOD)!;
    const parenleft = bounds.bounds(GID_PARENLEFT)!;
    const periodInkHeight = period.yMax - period.yMin;
    const parenInkHeight = parenleft.yMax - parenleft.yMin;
    // A full stop is a dot on the baseline; a parenthesis spans most of the em. The nominal ascent/descent gives both the same 1000-unit extent.
    expect(periodInkHeight).toBe(122);
    expect(parenInkHeight).toBe(932);
    expect(parenInkHeight / periodInkHeight).toBeGreaterThan(7);
    expect(periodInkHeight).toBeLessThan((NOMINAL_ASCENT - NOMINAL_DESCENT) / 8);
  });

  it('reports ink no taller or deeper than the nominal metrics for the glyphs a text-like token is built from', () => {
    const bounds = stixBounds();
    for (const glyphId of [GID_PERIOD, GID_PARENLEFT, GID_X, GID_Y]) {
      const box = bounds.bounds(glyphId)!;
      expect(box.yMax).toBeLessThanOrEqual(NOMINAL_ASCENT);
      expect(box.yMin).toBeGreaterThanOrEqual(NOMINAL_DESCENT);
      expect(box.yMax - box.yMin).toBeLessThanOrEqual(NOMINAL_ASCENT - NOMINAL_DESCENT);
    }
  });

  it('reports undefined for a glyph that draws nothing, rather than a zero-sized box at the origin', () => {
    // A space's charstring is a width and `endchar`: it has no ink, so it has no ink box, which is a different claim from "its ink is a point on the baseline".
    expect(stixBounds().bounds(GID_SPACE)).toBeUndefined();
  });

  it('reports undefined for a glyph ID outside the font', () => {
    const bounds = stixBounds();
    expect(bounds.bounds(bounds.numGlyphs)).toBeUndefined();
    expect(bounds.bounds(-1)).toBeUndefined();
  });

  it('solves curve extrema rather than hulling control points', () => {
    // U+1D738's lowest ink is a point on a cubic between its control points, not one of them: the tight bound is -194.38, where the convex hull of the same curve's control points reaches -201 (both values from fontTools' BoundsPen and ControlBoundsPen respectively). A walker that accumulated control points would report the glyph 6.6 units deeper than it draws.
    const box = stixBounds().bounds(GID_BOLD_GAMMA)!;
    expect(box.yMin).toBeCloseTo(-194.3817805810559, 6);
    expect(box.yMin).toBeGreaterThan(-201);
  });

  it("agrees with the font's own head-table FontBBox, a value from a different table entirely", () => {
    // head's xMin/yMin/xMax/yMax is the union of every glyph's own bounds, written by the font's producer. Recomputing that union from 5543 independently walked charstrings and landing exactly on it is a cross-check against data this module never reads.
    const font = parseSfnt(base64ToBytes(STIX_TWO_MATH_FONT_BASE64))!;
    const head = sfntTableBytes(font, 'head')!;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const declared = { xMin: view.getInt16(36), yMin: view.getInt16(38), xMax: view.getInt16(40), yMax: view.getInt16(42) };

    const bounds = stixBounds();
    let drawn = 0;
    const walked = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
    for (let glyphId = 0; glyphId < bounds.numGlyphs; glyphId++) {
      const box = bounds.bounds(glyphId);
      if (box === undefined) {
        continue;
      }
      drawn += 1;
      walked.xMin = Math.min(walked.xMin, box.xMin);
      walked.yMin = Math.min(walked.yMin, box.yMin);
      walked.xMax = Math.max(walked.xMax, box.xMax);
      walked.yMax = Math.max(walked.yMax, box.yMax);
    }
    expect(drawn).toBe(bounds.numGlyphs - 8); // the eight glyphs in this font that draw nothing at all
    expect(walked).toEqual(declared);
  });

  it('reaches well past the nominal metrics for the extension glyphs a math font is full of, which is the point of measuring per glyph', () => {
    // The "ink is tighter than the nominal metrics" property holds for text-like glyphs, not for every glyph in a math font: a bracket's extension piece or a display-size integral is drawn far outside the face's own nominal ascent/descent, and a layout engine sizing those from ascentPerEm would under-report them just as badly as it over-reports a full stop.
    const bounds = stixBounds();
    let tallerThanNominal = 0;
    let deeperThanNominal = 0;
    for (let glyphId = 0; glyphId < bounds.numGlyphs; glyphId++) {
      const box = bounds.bounds(glyphId);
      if (box === undefined) {
        continue;
      }
      if (box.yMax > NOMINAL_ASCENT) {
        tallerThanNominal += 1;
      }
      if (box.yMin < NOMINAL_DESCENT) {
        deeperThanNominal += 1;
      }
    }
    expect(tallerThanNominal).toBeGreaterThan(bounds.numGlyphs / 10);
    expect(deeperThanNominal).toBeGreaterThan(bounds.numGlyphs / 10);
  });

  it('scales design units independently of the em size the caller renders at', () => {
    // Every value this module reports is in design units; converting to points is the caller's own unitsPerEm division (see math-font.ts). Stated here as an assertion so a future change that starts scaling internally fails loudly.
    const box = stixBounds().bounds(GID_X)!;
    expect(box.yMax / UNITS_PER_EM).toBeCloseTo(0.473, 6);
  });
});

describe('CFF programs parseCffGlyphBounds refuses to walk', () => {
  it('returns undefined for a CID-keyed program, whose local subroutines live per-FD', () => {
    expect(parseCffGlyphBounds(cffFont('CidKeyed', ROS_OPERANDS_AND_OPERATOR))).toBeUndefined();
  });

  it('returns undefined for a program with no CharStrings operator in its Top DICT', () => {
    // A Top DICT carrying only `version` (operator 0): structurally valid, but there is no glyph data to walk.
    expect(parseCffGlyphBounds(cffFont('NoCharStrings', [139, 0]))).toBeUndefined();
  });

  it('returns undefined for a truncated header, a non-CFF1 major version, and an undersized header', () => {
    expect(parseCffGlyphBounds(new Uint8Array([1, 0]))).toBeUndefined();
    expect(parseCffGlyphBounds(cffFont('Cff2Font', [139, 0], [2, 0, 5, 1]))).toBeUndefined();
    expect(parseCffGlyphBounds(cffFont('ShortHeader', [139, 0], [1, 0, 2, 1]))).toBeUndefined();
  });

  it('returns undefined for a CharStrings offset pointing outside the program', () => {
    // Operator 17 (CharStrings) with a 32-bit operand well past the end of these few dozen bytes.
    const topDict = [29, 0x00, 0x0f, 0x00, 0x00, 17];
    expect(parseCffGlyphBounds(new Uint8Array([...CFF_HEADER, ...cffIndex([[0x41]]), ...cffIndex([topDict]), ...cffIndex([]), ...cffIndex([])]))).toBeUndefined();
  });
});
