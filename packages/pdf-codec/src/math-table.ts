import { parseCoverage } from './ot-layout-common';
import type { SfntFont } from './sfnt';
import { i16, sfntTableBytes, u16 } from './sfnt';

// Parses the OpenType 'MATH' table (Microsoft's own spec: https://learn.microsoft.com/en-us/typography/opentype/spec/math) -- the MathConstants subtable in full (every named field, even the handful this package's own MathFontMetrics interface doesn't currently expose, since reading them all costs nothing extra once the table is being walked), the MathGlyphInfo subtable's two per-glyph maps this package needs (MathItalicsCorrectionInfo and MathTopAccentAttachment), and the MathVariants subtable in full: both per-axis glyph-construction lists (the pre-built larger-variant sequences) and their GlyphAssembly part recipes. Table offsets below were derived from and cross-checked against the actual vendored STIXTwoMath-Regular.otf's own bytes while building this module, not transcribed from the spec alone.

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

// A MathItalicsCorrectionInfo or MathTopAccentAttachment table (both share the identical shape: Offset16 Coverage, uint16 count, MathValueRecord[count]) resolved to a glyph ID -> design-unit value lookup. The Coverage table it indexes through is the shared OpenType Common Table Formats one (ot-layout-common.ts), the same structure gpos-table.ts resolves its own kerning subtables through; an unreadable Coverage costs this one subtable its values rather than the whole MATH table.
function parseGlyphValueTable(bytes: Uint8Array<ArrayBuffer>, tableOffset: number): ReadonlyMap<number, number> {
  const coverage = parseCoverage(bytes, tableOffset + u16(bytes, tableOffset));
  const values = new Map<number, number>();
  if (coverage === undefined) {
    return values;
  }
  for (const [glyphId, coverageIndex] of coverage.entries()) {
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

// One pre-built, fixed-size larger form of a stretchy glyph (a MathGlyphVariantRecord): the glyph to draw, plus how far it extends along the stretch axis -- its own height for a vertical construction (a tall parenthesis, brace, or radical sign), its own width for a horizontal one (an over/under-brace). `advanceMeasurement` is in font design units, and is the value a variant-selection pass compares against its target size; it is NOT the glyph's hmtx advance width unless the axis happens to be horizontal.
export interface MathGlyphVariant {
  readonly glyphId: number;
  readonly advanceMeasurement: number; // design units, along the construction's own stretch axis
}

// One reusable piece of a GlyphAssembly recipe (a GlyphPartRecord). `startConnectorLength`/`endConnectorLength` are how much of this part's own extent, at each end, is flat connecting material that may be overlapped with a neighbouring part without changing the drawn shape -- the metadata that makes a seamless join possible. `fullAdvance` is the part's own full extent along the stretch axis. An extender part is the one repeated as many times as needed to reach an arbitrary size; every other part is placed exactly once.
export interface MathGlyphPart {
  readonly glyphId: number;
  readonly startConnectorLength: number; // design units
  readonly endConnectorLength: number; // design units
  readonly fullAdvance: number; // design units
  readonly isExtender: boolean;
}

// A GlyphAssembly table: the recipe for building an arbitrarily large form of a stretchy glyph out of repeatable parts, used when no pre-built variant is large enough. Parts are listed in the order they are laid down along the stretch axis -- bottom to top for a vertical assembly, left to right for a horizontal one (spec, "GlyphAssembly Table") -- which is exactly the order assembleStretchyGlyph (math-stretch.ts) places them in.
export interface MathGlyphAssembly {
  readonly italicsCorrection: number; // design units
  readonly parts: readonly MathGlyphPart[];
}

// A MathGlyphConstruction table: everything the font declares about stretching one base glyph along one axis. `variants` is the font's own pre-built sequence at increasing sizes (its first entry is conventionally the base glyph itself, unstretched); `assembly` is present only for a glyph the font can also build from parts, which is what makes an unbounded size reachable.
export interface MathGlyphConstruction {
  readonly variants: readonly MathGlyphVariant[];
  readonly assembly?: MathGlyphAssembly;
}

// The MathVariants subtable: per-axis stretchy-glyph constructions, keyed by the base glyph ID they stretch. `minConnectorOverlap` is the font's own floor on how much two adjacent assembly parts must overlap -- overlapping by less leaves a visible seam where the two outlines fail to meet, so it is a lower bound on the overlap an assembly may use, never a target.
export interface MathVariants {
  readonly minConnectorOverlap: number; // design units
  readonly vertical: ReadonlyMap<number, MathGlyphConstruction>;
  readonly horizontal: ReadonlyMap<number, MathGlyphConstruction>;
}

const MATH_GLYPH_VARIANT_RECORD_SIZE = 4; // uint16 variantGlyph + UFWORD advanceMeasurement
const GLYPH_PART_RECORD_SIZE = 10; // uint16 glyphID + three UFWORDs + uint16 partFlags
const GLYPH_PART_FLAG_EXTENDER = 0x0001;
const MATH_VARIANTS_HEADER_SIZE = 10; // uint16 minConnectorOverlap + two Offset16 coverages + two uint16 counts, before the two Offset16 construction arrays

function parseGlyphAssembly(bytes: Uint8Array<ArrayBuffer>, assemblyOffset: number): MathGlyphAssembly {
  const partCount = u16(bytes, assemblyOffset + MATH_VALUE_RECORD_SIZE);
  const parts: MathGlyphPart[] = [];
  for (let i = 0; i < partCount; i++) {
    const recordOffset = assemblyOffset + MATH_VALUE_RECORD_SIZE + 2 + i * GLYPH_PART_RECORD_SIZE;
    parts.push({
      glyphId: u16(bytes, recordOffset),
      startConnectorLength: u16(bytes, recordOffset + 2),
      endConnectorLength: u16(bytes, recordOffset + 4),
      fullAdvance: u16(bytes, recordOffset + 6),
      isExtender: (u16(bytes, recordOffset + 8) & GLYPH_PART_FLAG_EXTENDER) !== 0,
    });
  }
  return { italicsCorrection: i16(bytes, assemblyOffset), parts };
}

function parseGlyphConstruction(bytes: Uint8Array<ArrayBuffer>, constructionOffset: number): MathGlyphConstruction {
  const assemblyOffset = u16(bytes, constructionOffset);
  const variantCount = u16(bytes, constructionOffset + 2);
  const variants: MathGlyphVariant[] = [];
  for (let i = 0; i < variantCount; i++) {
    const recordOffset = constructionOffset + 4 + i * MATH_GLYPH_VARIANT_RECORD_SIZE;
    variants.push({ glyphId: u16(bytes, recordOffset), advanceMeasurement: u16(bytes, recordOffset + 2) });
  }
  return assemblyOffset === 0 ? { variants } : { variants, assembly: parseGlyphAssembly(bytes, constructionOffset + assemblyOffset) };
}

// One axis's coverage table plus its own parallel MathGlyphConstruction offset array, resolved to a base-glyph-ID -> construction lookup. `constructionArrayOffset` is where that axis's Offset16 array starts (the vertical array first, immediately after the MathVariants header; the horizontal array immediately after it), and each entry in it is measured from the MathVariants table's own start.
function parseConstructionsForAxis(bytes: Uint8Array<ArrayBuffer>, variantsOffset: number, coverageOffset: number, count: number, constructionArrayOffset: number): ReadonlyMap<number, MathGlyphConstruction> {
  const constructions = new Map<number, MathGlyphConstruction>();
  if (coverageOffset === 0) {
    return constructions;
  }
  const coverage = parseCoverage(bytes, variantsOffset + coverageOffset);
  if (coverage === undefined) {
    return constructions;
  }
  for (const [glyphId, coverageIndex] of coverage.entries()) {
    if (coverageIndex >= count) {
      continue; // a coverage table listing more glyphs than the construction array has entries: skip the unbacked tail rather than reading past it
    }
    constructions.set(glyphId, parseGlyphConstruction(bytes, variantsOffset + u16(bytes, constructionArrayOffset + coverageIndex * 2)));
  }
  return constructions;
}

function parseMathVariants(bytes: Uint8Array<ArrayBuffer>, mathTableOffset: number): MathVariants {
  const variantsTableOffset = u16(bytes, mathTableOffset + 8);
  if (variantsTableOffset === 0) {
    return { minConnectorOverlap: 0, vertical: new Map(), horizontal: new Map() };
  }
  const variantsOffset = mathTableOffset + variantsTableOffset;
  const verticalCoverageOffset = u16(bytes, variantsOffset + 2);
  const horizontalCoverageOffset = u16(bytes, variantsOffset + 4);
  const verticalCount = u16(bytes, variantsOffset + 6);
  const horizontalCount = u16(bytes, variantsOffset + 8);
  const verticalArrayOffset = variantsOffset + MATH_VARIANTS_HEADER_SIZE;
  const horizontalArrayOffset = verticalArrayOffset + verticalCount * 2;
  return {
    minConnectorOverlap: u16(bytes, variantsOffset),
    vertical: parseConstructionsForAxis(bytes, variantsOffset, verticalCoverageOffset, verticalCount, verticalArrayOffset),
    horizontal: parseConstructionsForAxis(bytes, variantsOffset, horizontalCoverageOffset, horizontalCount, horizontalArrayOffset),
  };
}

export interface MathTable {
  readonly constants: MathConstants;
  readonly glyphInfo: MathGlyphInfo;
  readonly variants: MathVariants;
}

export function parseMathTable(font: SfntFont): MathTable {
  const mathBytes = sfntTableBytes(font, 'MATH');
  if (mathBytes === undefined) {
    throw new Error('math font has no MATH table');
  }
  return {
    constants: parseMathConstants(mathBytes, 0),
    glyphInfo: parseMathGlyphInfo(mathBytes, 0),
    variants: parseMathVariants(mathBytes, 0),
  };
}
