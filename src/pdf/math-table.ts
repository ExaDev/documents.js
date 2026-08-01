import type { SfntFont } from './sfnt';
import { i16, sfntTableBytes, u16 } from './sfnt';

// Parses the OpenType 'MATH' table (Microsoft's own spec: https://learn.microsoft.com/en-us/typography/opentype/spec/math) -- the MathConstants subtable in full (every named field, even the handful this package's own MathFontMetrics interface doesn't currently expose, since reading them all costs nothing extra once the table is being walked) and the MathGlyphInfo subtable's two per-glyph maps this package needs: MathItalicsCorrectionInfo and MathTopAccentAttachment. Deliberately does NOT parse MathVariants (the stretchy-glyph-assembly subtable) -- see math-font.ts's own module comment for that documented scope boundary. Table offsets below were derived from and cross-checked against the actual vendored STIXTwoMath-Regular.otf's own bytes while building this module, not transcribed from the spec alone.

export interface MathConstants {
  readonly scriptPercentScaleDown: number; // already divided by 100 (0..1)
  readonly scriptScriptPercentScaleDown: number;
  readonly axisHeight: number;
  readonly subscriptShiftDown: number;
  readonly subscriptBaselineDropMin: number;
  readonly superscriptShiftUp: number;
  readonly superscriptShiftUpCramped: number;
  readonly superscriptBaselineDropMax: number;
  readonly subSuperscriptGapMin: number;
  readonly spaceAfterScript: number;
  readonly upperLimitGapMin: number;
  readonly upperLimitBaselineRiseMin: number;
  readonly lowerLimitGapMin: number;
  readonly lowerLimitBaselineDropMin: number;
  readonly stackTopShiftUp: number;
  readonly stackBottomShiftDown: number;
  readonly stackGapMin: number;
  readonly fractionNumeratorShiftUp: number;
  readonly fractionNumeratorDisplayStyleShiftUp: number;
  readonly fractionDenominatorShiftDown: number;
  readonly fractionDenominatorDisplayStyleShiftDown: number;
  readonly fractionNumeratorGapMin: number;
  readonly fractionRuleThickness: number;
  readonly fractionDenominatorGapMin: number;
  readonly radicalVerticalGap: number;
  readonly radicalRuleThickness: number;
  readonly radicalExtraAscender: number;
  readonly radicalKernBeforeDegree: number;
  readonly radicalKernAfterDegree: number;
  readonly radicalDegreeBottomRaisePercent: number; // 0..100, NOT pre-divided (see MathFontMetrics.radicalDegreeBottomRaisePercent's own comment)
}

// The MathConstants subtable's own field order (Microsoft OpenType MATH spec, "MathConstants Table"): four leading int16/UFWORD scalars, then 51 MathValueRecords (each a 2-byte signed value plus a 2-byte device-table offset this module ignores -- STIX Two Math, like the overwhelming majority of static, non-variable math fonts, sets every one of these to 0), then one trailing int16 percentage. MATH_VALUE_RECORD_INDEX names every MathValueRecord this module reads by its own position in that sequence (0-based, immediately after the four leading scalars) -- verified against the real vendored font while this module was built, not transcribed from the spec alone.
const MATH_VALUE_RECORD_INDEX = {
  axisHeight: 1,
  subscriptShiftDown: 4,
  subscriptBaselineDropMin: 6,
  superscriptShiftUp: 7,
  superscriptShiftUpCramped: 8,
  superscriptBaselineDropMax: 10,
  subSuperscriptGapMin: 11,
  spaceAfterScript: 13,
  upperLimitGapMin: 14,
  upperLimitBaselineRiseMin: 15,
  lowerLimitGapMin: 16,
  lowerLimitBaselineDropMin: 17,
  stackTopShiftUp: 18,
  stackBottomShiftDown: 20,
  stackGapMin: 22,
  fractionNumeratorShiftUp: 28,
  fractionNumeratorDisplayStyleShiftUp: 29,
  fractionDenominatorShiftDown: 30,
  fractionDenominatorDisplayStyleShiftDown: 31,
  fractionNumeratorGapMin: 32,
  fractionRuleThickness: 34,
  fractionDenominatorGapMin: 35,
  radicalVerticalGap: 45,
  radicalRuleThickness: 47,
  radicalExtraAscender: 48,
  radicalKernBeforeDegree: 49,
  radicalKernAfterDegree: 50,
} as const;

const MATH_VALUE_RECORDS_START = 8; // byte offset from the MathConstants subtable's own start, after ScriptPercentScaleDown/ScriptScriptPercentScaleDown/DelimitedSubFormulaMinHeight/DisplayOperatorMinHeight
const MATH_VALUE_RECORD_SIZE = 4;
const MATH_VALUE_RECORD_COUNT = 51;
const RADICAL_DEGREE_BOTTOM_RAISE_PERCENT_OFFSET = MATH_VALUE_RECORDS_START + MATH_VALUE_RECORD_COUNT * MATH_VALUE_RECORD_SIZE;

function mathValueRecord(bytes: Uint8Array<ArrayBuffer>, constantsOffset: number, index: number): number {
  return i16(bytes, constantsOffset + MATH_VALUE_RECORDS_START + index * MATH_VALUE_RECORD_SIZE);
}

function parseMathConstants(bytes: Uint8Array<ArrayBuffer>, mathTableOffset: number): MathConstants {
  const constantsOffset = mathTableOffset + u16(bytes, mathTableOffset + 4);
  const field = (index: number): number => mathValueRecord(bytes, constantsOffset, index);
  return {
    scriptPercentScaleDown: i16(bytes, constantsOffset + 0) / 100,
    scriptScriptPercentScaleDown: i16(bytes, constantsOffset + 2) / 100,
    axisHeight: field(MATH_VALUE_RECORD_INDEX.axisHeight),
    subscriptShiftDown: field(MATH_VALUE_RECORD_INDEX.subscriptShiftDown),
    subscriptBaselineDropMin: field(MATH_VALUE_RECORD_INDEX.subscriptBaselineDropMin),
    superscriptShiftUp: field(MATH_VALUE_RECORD_INDEX.superscriptShiftUp),
    superscriptShiftUpCramped: field(MATH_VALUE_RECORD_INDEX.superscriptShiftUpCramped),
    superscriptBaselineDropMax: field(MATH_VALUE_RECORD_INDEX.superscriptBaselineDropMax),
    subSuperscriptGapMin: field(MATH_VALUE_RECORD_INDEX.subSuperscriptGapMin),
    spaceAfterScript: field(MATH_VALUE_RECORD_INDEX.spaceAfterScript),
    upperLimitGapMin: field(MATH_VALUE_RECORD_INDEX.upperLimitGapMin),
    upperLimitBaselineRiseMin: field(MATH_VALUE_RECORD_INDEX.upperLimitBaselineRiseMin),
    lowerLimitGapMin: field(MATH_VALUE_RECORD_INDEX.lowerLimitGapMin),
    lowerLimitBaselineDropMin: field(MATH_VALUE_RECORD_INDEX.lowerLimitBaselineDropMin),
    stackTopShiftUp: field(MATH_VALUE_RECORD_INDEX.stackTopShiftUp),
    stackBottomShiftDown: field(MATH_VALUE_RECORD_INDEX.stackBottomShiftDown),
    stackGapMin: field(MATH_VALUE_RECORD_INDEX.stackGapMin),
    fractionNumeratorShiftUp: field(MATH_VALUE_RECORD_INDEX.fractionNumeratorShiftUp),
    fractionNumeratorDisplayStyleShiftUp: field(MATH_VALUE_RECORD_INDEX.fractionNumeratorDisplayStyleShiftUp),
    fractionDenominatorShiftDown: field(MATH_VALUE_RECORD_INDEX.fractionDenominatorShiftDown),
    fractionDenominatorDisplayStyleShiftDown: field(MATH_VALUE_RECORD_INDEX.fractionDenominatorDisplayStyleShiftDown),
    fractionNumeratorGapMin: field(MATH_VALUE_RECORD_INDEX.fractionNumeratorGapMin),
    fractionRuleThickness: field(MATH_VALUE_RECORD_INDEX.fractionRuleThickness),
    fractionDenominatorGapMin: field(MATH_VALUE_RECORD_INDEX.fractionDenominatorGapMin),
    radicalVerticalGap: field(MATH_VALUE_RECORD_INDEX.radicalVerticalGap),
    radicalRuleThickness: field(MATH_VALUE_RECORD_INDEX.radicalRuleThickness),
    radicalExtraAscender: field(MATH_VALUE_RECORD_INDEX.radicalExtraAscender),
    radicalKernBeforeDegree: field(MATH_VALUE_RECORD_INDEX.radicalKernBeforeDegree),
    radicalKernAfterDegree: field(MATH_VALUE_RECORD_INDEX.radicalKernAfterDegree),
    radicalDegreeBottomRaisePercent: i16(bytes, constantsOffset + RADICAL_DEGREE_BOTTOM_RAISE_PERCENT_OFFSET),
  };
}

// A Coverage table (OpenType Common Table Formats clause 2.3.2) resolved to a glyph ID -> coverage-index lookup -- the shared indirection every glyph-keyed MATH subtable (MathItalicsCorrectionInfo, MathTopAccentAttachment) uses to go from "this glyph" to "this glyph's own position in the parallel value array".
function parseCoverageIndex(bytes: Uint8Array<ArrayBuffer>, coverageOffset: number): ReadonlyMap<number, number> {
  const format = u16(bytes, coverageOffset);
  const index = new Map<number, number>();
  if (format === 1) {
    const glyphCount = u16(bytes, coverageOffset + 2);
    for (let i = 0; i < glyphCount; i++) {
      index.set(u16(bytes, coverageOffset + 4 + i * 2), i);
    }
  } else if (format === 2) {
    const rangeCount = u16(bytes, coverageOffset + 2);
    for (let i = 0; i < rangeCount; i++) {
      const recordOffset = coverageOffset + 4 + i * 6;
      const startGlyphId = u16(bytes, recordOffset);
      const endGlyphId = u16(bytes, recordOffset + 2);
      const startCoverageIndex = u16(bytes, recordOffset + 4);
      for (let glyphId = startGlyphId; glyphId <= endGlyphId; glyphId++) {
        index.set(glyphId, startCoverageIndex + (glyphId - startGlyphId));
      }
    }
  }
  return index;
}

// A MathItalicsCorrectionInfo or MathTopAccentAttachment table (both share the identical shape: Offset16 Coverage, uint16 count, MathValueRecord[count]) resolved to a glyph ID -> design-unit value lookup.
function parseGlyphValueTable(bytes: Uint8Array<ArrayBuffer>, tableOffset: number): ReadonlyMap<number, number> {
  const coverageOffset = tableOffset + u16(bytes, tableOffset);
  const coverage = parseCoverageIndex(bytes, coverageOffset);
  const values = new Map<number, number>();
  for (const [glyphId, coverageIndex] of coverage) {
    values.set(glyphId, i16(bytes, tableOffset + 4 + coverageIndex * 4));
  }
  return values;
}

export interface MathGlyphInfo {
  readonly italicsCorrection: ReadonlyMap<number, number>; // glyph ID -> design units
  readonly topAccentAttachment: ReadonlyMap<number, number>; // glyph ID -> design units, x position from the glyph's own left origin
}

function parseMathGlyphInfo(bytes: Uint8Array<ArrayBuffer>, mathTableOffset: number): MathGlyphInfo {
  const glyphInfoOffset = mathTableOffset + u16(bytes, mathTableOffset + 6);
  const italicsInfoOffset = u16(bytes, glyphInfoOffset + 0);
  const topAccentOffset = u16(bytes, glyphInfoOffset + 2);
  return {
    italicsCorrection: italicsInfoOffset === 0 ? new Map() : parseGlyphValueTable(bytes, glyphInfoOffset + italicsInfoOffset),
    topAccentAttachment: topAccentOffset === 0 ? new Map() : parseGlyphValueTable(bytes, glyphInfoOffset + topAccentOffset),
  };
}

export interface MathTable {
  readonly constants: MathConstants;
  readonly glyphInfo: MathGlyphInfo;
}

export function parseMathTable(font: SfntFont): MathTable {
  const mathBytes = sfntTableBytes(font, 'MATH');
  if (mathBytes === undefined) {
    throw new Error('math font has no MATH table');
  }
  return {
    constants: parseMathConstants(mathBytes, 0),
    glyphInfo: parseMathGlyphInfo(mathBytes, 0),
  };
}
