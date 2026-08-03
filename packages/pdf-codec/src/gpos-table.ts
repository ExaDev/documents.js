import { parseClassDef, parseCoverage } from './ot-layout-common';
import type { SfntFont } from './sfnt';
import { hasBytes, i16, sfntTableBytes, u16, u32, u8 } from './sfnt';

// Reads a font's own 'GPOS' table (Microsoft's OpenType spec, "GPOS - Glyph Positioning Table") far enough to answer one question: how much does this font want the advance of glyph A adjusted when glyph B follows it. That is pair kerning, and it is the only part of GPOS this package has any use for -- a PDF content stream positions glyphs itself, so mark attachment, cursive joining, and contextual positioning have no consumer here, and parsing them would be building against a caller that does not exist.
//
// The vendored text fonts are the reason this exists at all and the reason it is GPOS rather than the older 'kern' table: neither Carlito nor Caladea ships a 'kern' table in any face, and both carry all of their real pair kerning in GPOS (verified directly against assets/fonts/{carlito,caladea}/*.ttf while this module was written). The two fonts also happen to exercise genuinely different corners of the format, which is why both PairPos subtable formats and the Extension indirection below are all real code paths rather than speculative ones: Carlito reaches its kerning exclusively through LookupType 9 (Extension Positioning) wrapping LookupType 2 PairPos format 2 subtables, while Caladea uses LookupType 2 directly and mixes format 1 (an explicit per-pair list) with format 2 (class-based) subtables in the same lookup.
//
// What is deliberately not modelled: only the horizontal advance adjustment applied to the FIRST glyph of a pair (ValueRecord's XAdvance) is read. A horizontal left-to-right run is the only case this package's own text layout produces, and in that case a second-glyph ValueRecord, the placement fields, and the vertical fields have nothing to contribute to where the next glyph starts. Device/VariationIndex tables are likewise skipped: they carry per-pixel-size hinting corrections for a rasteriser, and this codec emits scalable PDF text rather than rasterising. A lookup's own LookupFlag (ignore-marks, mark filtering, and so on) is not consulted either, since this API is asked about a pair of glyphs the caller has already decided are adjacent -- there is no glyph sequence here to skip anything within.
//
// Every read is bounds-checked and any malformed structure degrades to "this font has no kerning" rather than throwing, matching cmap-table.ts's policy for the same reason: fonts embedded in arbitrary input documents are untrusted input, and an unreadable GPOS must cost the caller kerning, not the document.

// The kerning adjustment, in font design units, this font applies to `leftGlyphId`'s advance when `rightGlyphId` immediately follows it, or `undefined` when no kerning subtable covers the pair at all. A pair a subtable genuinely does cover but assigns no adjustment reads back as `0` rather than `undefined` -- the distinction is between "this font says nothing about this pair" and "this font says this pair needs no adjustment", and reporting the font's real answer is more faithful than collapsing both into absence. Callers that treat them alike can simply add `?? 0`.
export type GposKernLookup = (leftGlyphId: number, rightGlyphId: number) => number | undefined;

// One PairPos subtable, reduced to the pair query it answers. `undefined` means this subtable does not describe the pair, which is what makes the caller move on to the next subtable in the lookup -- distinct from a subtable that does describe it and returns 0.
type PairPosSubtable = (leftGlyphId: number, rightGlyphId: number) => number | undefined;

const GPOS_HEADER_SIZE = 10; // uint16 majorVersion + uint16 minorVersion + three Offset16s (ScriptList, FeatureList, LookupList); version 1.1's trailing Offset32 featureVariationsOffset is not read, since feature variations only select alternate feature tables per design-variation instance and this package never instantiates a variable font
const SCRIPT_RECORD_SIZE = 6; // Tag scriptTag + Offset16 scriptOffset
const FEATURE_RECORD_SIZE = 6; // Tag featureTag + Offset16 featureOffset
const LANG_SYS_HEADER_SIZE = 6; // Offset16 lookupOrderOffset (reserved, always NULL) + uint16 requiredFeatureIndex + uint16 featureIndexCount
const FEATURE_HEADER_SIZE = 4; // Offset16 featureParamsOffset + uint16 lookupIndexCount
const LOOKUP_HEADER_SIZE = 6; // uint16 lookupType + uint16 lookupFlag + uint16 subTableCount
const EXTENSION_POS_HEADER_SIZE = 8; // uint16 posFormat + uint16 extensionLookupType + Offset32 extensionOffset

const LOOKUP_TYPE_PAIR_POS = 2;
const LOOKUP_TYPE_EXTENSION_POS = 9;

const KERN_FEATURE_TAG = 'kern';
// The script this package resolves kerning for, best first. Latin is what the vendored text fonts are for and what this codec's own layout engine lays out; 'DFLT' is the spec's own script-independent fallback. Carlito is the concrete reason the fallback chain has to end in "whatever script the font does list" rather than requiring one of these two: it declares 'cyrl', 'grek', and 'latn' and no 'DFLT' at all, so a font that happened to omit 'latn' as well would otherwise silently lose all of its kerning.
const PREFERRED_SCRIPT_TAGS = ['latn', 'DFLT'] as const;

// A four-byte OpenType Tag read as its literal ASCII, for comparing against a script or feature tag. Callers have already bounds-checked the record this sits in, so `u8`'s own throw-on-overrun is the right behaviour here rather than a second check.
function readTag(bytes: Uint8Array<ArrayBuffer>, offset: number): string {
  return String.fromCharCode(u8(bytes, offset), u8(bytes, offset + 1), u8(bytes, offset + 2), u8(bytes, offset + 3));
}

// The number of bytes a ValueRecord in `valueFormat` occupies: one int16 per set bit (OpenType spec, "Value Record"), the device/variation-index bits included, since those are Offset16s that still take their two bytes whether or not anything follows them.
function valueRecordSize(valueFormat: number): number {
  let size = 0;
  for (let bit = valueFormat; bit !== 0; bit >>= 1) {
    size += (bit & 1) * 2;
  }
  return size;
}

const VALUE_FORMAT_X_PLACEMENT = 0x0001;
const VALUE_FORMAT_Y_PLACEMENT = 0x0002;
const VALUE_FORMAT_X_ADVANCE = 0x0004;

// Where XAdvance sits inside a ValueRecord of `valueFormat`, or `undefined` when the record carries no XAdvance at all. Fields appear in the fixed bit order the spec lists them in, so the offset is simply the width of whichever lower-order fields are also present.
function xAdvanceOffset(valueFormat: number): number | undefined {
  if ((valueFormat & VALUE_FORMAT_X_ADVANCE) === 0) {
    return undefined;
  }
  return valueRecordSize(valueFormat & (VALUE_FORMAT_X_PLACEMENT | VALUE_FORMAT_Y_PLACEMENT));
}

const PAIR_POS_FORMAT_1_HEADER_SIZE = 10; // uint16 posFormat + Offset16 coverageOffset + uint16 valueFormat1 + uint16 valueFormat2 + uint16 pairSetCount
const PAIR_VALUE_RECORD_GLYPH_SIZE = 2; // the uint16 secondGlyph each PairValueRecord opens with, before its one or two ValueRecords

// PairPos format 1: an explicit list of second glyphs per covered first glyph, each with its own ValueRecord. Caladea reaches real pairs ('a'+'v', 'F'+'C', 'm'+'y', ...) through this format.
function parsePairPosFormat1(bytes: Uint8Array<ArrayBuffer>, subtableOffset: number): PairPosSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, PAIR_POS_FORMAT_1_HEADER_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(bytes, subtableOffset + u16(bytes, subtableOffset + 2));
  if (coverage === undefined) {
    return undefined;
  }
  const valueFormat1 = u16(bytes, subtableOffset + 4);
  const valueFormat2 = u16(bytes, subtableOffset + 6);
  const pairSetCount = u16(bytes, subtableOffset + 8);
  const pairSetOffsetsOffset = subtableOffset + PAIR_POS_FORMAT_1_HEADER_SIZE;
  if (!hasBytes(bytes, pairSetOffsetsOffset, pairSetCount * 2)) {
    return undefined;
  }
  const recordSize = PAIR_VALUE_RECORD_GLYPH_SIZE + valueRecordSize(valueFormat1) + valueRecordSize(valueFormat2);
  const advanceOffset = xAdvanceOffset(valueFormat1);

  return (leftGlyphId: number, rightGlyphId: number): number | undefined => {
    const coverageIndex = coverage.coverageIndex(leftGlyphId);
    if (coverageIndex === undefined || coverageIndex >= pairSetCount) {
      return undefined;
    }
    const pairSetOffset = subtableOffset + u16(bytes, pairSetOffsetsOffset + coverageIndex * 2);
    if (!hasBytes(bytes, pairSetOffset, 2)) {
      return undefined;
    }
    const pairValueCount = u16(bytes, pairSetOffset);
    const recordsOffset = pairSetOffset + 2;
    if (!hasBytes(bytes, recordsOffset, pairValueCount * recordSize)) {
      return undefined;
    }
    // PairValueRecords are ordered by second glyph, so this bisects rather than scanning: a covered first glyph in a real text font routinely lists a hundred-odd second glyphs, and this runs once per adjacent pair in every string laid out.
    let low = 0;
    let high = pairValueCount - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const recordOffset = recordsOffset + mid * recordSize;
      const secondGlyph = u16(bytes, recordOffset);
      if (rightGlyphId < secondGlyph) {
        high = mid - 1;
      } else if (rightGlyphId > secondGlyph) {
        low = mid + 1;
      } else {
        // The pair is listed. A record whose ValueRecord carries no XAdvance still counts as a match describing no advance change, which is what 0 means here.
        return advanceOffset === undefined ? 0 : i16(bytes, recordOffset + PAIR_VALUE_RECORD_GLYPH_SIZE + advanceOffset);
      }
    }
    return undefined;
  };
}

const PAIR_POS_FORMAT_2_HEADER_SIZE = 16; // uint16 posFormat + Offset16 coverageOffset + two uint16 valueFormats + two Offset16 classDefs + uint16 class1Count + uint16 class2Count

// PairPos format 2: both glyphs of the pair are mapped to a class, and the adjustment is read out of a class1Count x class2Count matrix. This is how real fonts keep a large kerning table compact, and it is the only format Carlito uses at all.
function parsePairPosFormat2(bytes: Uint8Array<ArrayBuffer>, subtableOffset: number): PairPosSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, PAIR_POS_FORMAT_2_HEADER_SIZE)) {
    return undefined;
  }
  const coverage = parseCoverage(bytes, subtableOffset + u16(bytes, subtableOffset + 2));
  const classDef1 = parseClassDef(bytes, subtableOffset + u16(bytes, subtableOffset + 8));
  const classDef2 = parseClassDef(bytes, subtableOffset + u16(bytes, subtableOffset + 10));
  if (coverage === undefined || classDef1 === undefined || classDef2 === undefined) {
    return undefined;
  }
  const valueFormat1 = u16(bytes, subtableOffset + 4);
  const valueFormat2 = u16(bytes, subtableOffset + 6);
  const class1Count = u16(bytes, subtableOffset + 12);
  const class2Count = u16(bytes, subtableOffset + 14);
  const class2RecordSize = valueRecordSize(valueFormat1) + valueRecordSize(valueFormat2);
  const class1RecordSize = class2Count * class2RecordSize;
  const matrixOffset = subtableOffset + PAIR_POS_FORMAT_2_HEADER_SIZE;
  if (!hasBytes(bytes, matrixOffset, class1Count * class1RecordSize)) {
    return undefined;
  }
  const advanceOffset = xAdvanceOffset(valueFormat1);

  return (leftGlyphId: number, rightGlyphId: number): number | undefined => {
    // Coverage, not the class definition, is what decides whether this subtable applies: class 0 is a real class carrying real adjustments, so "classDef1 puts this glyph in class 0" says nothing about whether the subtable covers it.
    if (coverage.coverageIndex(leftGlyphId) === undefined) {
      return undefined;
    }
    const class1 = classDef1(leftGlyphId);
    const class2 = classDef2(rightGlyphId);
    if (class1 >= class1Count || class2 >= class2Count) {
      return undefined; // a class the matrix has no row or column for: this subtable cannot describe the pair, so the next one gets its turn
    }
    if (advanceOffset === undefined) {
      return 0;
    }
    return i16(bytes, matrixOffset + class1 * class1RecordSize + class2 * class2RecordSize + advanceOffset);
  };
}

// One subtable of a kerning lookup, resolving LookupType 9 (Extension Positioning) transparently. Extension exists so a lookup's subtables can sit beyond the 64 KB an Offset16 can reach, which is exactly what a font with a large kerning table needs and precisely why Carlito -- whose GPOS is ~85 KB -- wraps every one of its PairPos subtables in one.
function parseSubtable(bytes: Uint8Array<ArrayBuffer>, lookupType: number, subtableOffset: number): PairPosSubtable | undefined {
  if (lookupType === LOOKUP_TYPE_EXTENSION_POS) {
    if (!hasBytes(bytes, subtableOffset, EXTENSION_POS_HEADER_SIZE) || u16(bytes, subtableOffset) !== 1) {
      return undefined;
    }
    const extensionLookupType = u16(bytes, subtableOffset + 2);
    if (extensionLookupType === LOOKUP_TYPE_EXTENSION_POS) {
      return undefined; // an Extension subtable may not wrap another one (spec, "Extension Positioning Subtable Format 1"); refusing rather than recursing keeps a malformed font from looping
    }
    return parseSubtable(bytes, extensionLookupType, subtableOffset + u32(bytes, subtableOffset + 4));
  }
  if (lookupType !== LOOKUP_TYPE_PAIR_POS) {
    return undefined; // a kerning feature is free to reference a non-pair lookup (cursive attachment, single positioning); nothing here can use one
  }
  if (!hasBytes(bytes, subtableOffset, 2)) {
    return undefined;
  }
  const posFormat = u16(bytes, subtableOffset);
  if (posFormat === 1) {
    return parsePairPosFormat1(bytes, subtableOffset);
  }
  if (posFormat === 2) {
    return parsePairPosFormat2(bytes, subtableOffset);
  }
  return undefined;
}

// Every PairPos subtable of one lookup, in the order the lookup lists them -- which is the order they must be tried in, since the first subtable that describes a pair is the one that positions it.
function parseLookupSubtables(bytes: Uint8Array<ArrayBuffer>, lookupOffset: number): PairPosSubtable[] {
  if (!hasBytes(bytes, lookupOffset, LOOKUP_HEADER_SIZE)) {
    return [];
  }
  const lookupType = u16(bytes, lookupOffset);
  const subTableCount = u16(bytes, lookupOffset + 4);
  const offsetsOffset = lookupOffset + LOOKUP_HEADER_SIZE;
  if (!hasBytes(bytes, offsetsOffset, subTableCount * 2)) {
    return [];
  }
  const subtables: PairPosSubtable[] = [];
  for (let i = 0; i < subTableCount; i++) {
    const subtable = parseSubtable(bytes, lookupType, lookupOffset + u16(bytes, offsetsOffset + i * 2));
    if (subtable !== undefined) {
      subtables.push(subtable);
    }
  }
  return subtables;
}

// The feature indices the chosen script's default language system enables. Language-specific LangSys records are deliberately not consulted: they exist to swap in language-tailored feature sets, and this package lays text out with no language tag to select one by, so the default system is the honest choice rather than an arbitrary one of the alternatives.
function parseDefaultLangSysFeatureIndices(bytes: Uint8Array<ArrayBuffer>, scriptOffset: number): number[] {
  if (!hasBytes(bytes, scriptOffset, 2)) {
    return [];
  }
  const defaultLangSysOffset = u16(bytes, scriptOffset);
  if (defaultLangSysOffset === 0) {
    return [];
  }
  const langSysOffset = scriptOffset + defaultLangSysOffset;
  if (!hasBytes(bytes, langSysOffset, LANG_SYS_HEADER_SIZE)) {
    return [];
  }
  const featureIndexCount = u16(bytes, langSysOffset + 4);
  const indicesOffset = langSysOffset + LANG_SYS_HEADER_SIZE;
  if (!hasBytes(bytes, indicesOffset, featureIndexCount * 2)) {
    return [];
  }
  const indices: number[] = [];
  for (let i = 0; i < featureIndexCount; i++) {
    indices.push(u16(bytes, indicesOffset + i * 2));
  }
  return indices;
}

// The ScriptList entry this package positions text with: Latin if the font has it, the script-independent default if not, and otherwise the font's first script. Going through the ScriptList at all -- rather than sweeping the FeatureList for every feature tagged 'kern' -- is what keeps a font's Cyrillic or Greek kerning lookups from being applied to Latin text, which a font that scopes different lookups to different scripts would otherwise suffer.
function findScriptOffset(bytes: Uint8Array<ArrayBuffer>, scriptListOffset: number): number | undefined {
  if (!hasBytes(bytes, scriptListOffset, 2)) {
    return undefined;
  }
  const scriptCount = u16(bytes, scriptListOffset);
  const recordsOffset = scriptListOffset + 2;
  if (!hasBytes(bytes, recordsOffset, scriptCount * SCRIPT_RECORD_SIZE) || scriptCount === 0) {
    return undefined;
  }
  for (const wanted of PREFERRED_SCRIPT_TAGS) {
    for (let i = 0; i < scriptCount; i++) {
      const recordOffset = recordsOffset + i * SCRIPT_RECORD_SIZE;
      if (readTag(bytes, recordOffset) === wanted) {
        return scriptListOffset + u16(bytes, recordOffset + 4);
      }
    }
  }
  return scriptListOffset + u16(bytes, recordsOffset + 4);
}

// The lookup indices every 'kern' feature the chosen script enables points at, in feature order and de-duplicated. A script's language systems routinely enable several separate 'kern' feature records that all reference the same lookup (Carlito declares seven), so the same lookup must not be walked -- or applied -- more than once.
function collectKernLookupIndices(bytes: Uint8Array<ArrayBuffer>, featureListOffset: number, featureIndices: readonly number[]): number[] {
  if (!hasBytes(bytes, featureListOffset, 2)) {
    return [];
  }
  const featureCount = u16(bytes, featureListOffset);
  const recordsOffset = featureListOffset + 2;
  if (!hasBytes(bytes, recordsOffset, featureCount * FEATURE_RECORD_SIZE)) {
    return [];
  }
  const lookupIndices: number[] = [];
  const seen = new Set<number>();
  for (const featureIndex of featureIndices) {
    if (featureIndex >= featureCount) {
      continue;
    }
    const recordOffset = recordsOffset + featureIndex * FEATURE_RECORD_SIZE;
    if (readTag(bytes, recordOffset) !== KERN_FEATURE_TAG) {
      continue;
    }
    const featureOffset = featureListOffset + u16(bytes, recordOffset + 4);
    if (!hasBytes(bytes, featureOffset, FEATURE_HEADER_SIZE)) {
      continue;
    }
    const lookupIndexCount = u16(bytes, featureOffset + 2);
    const indicesOffset = featureOffset + FEATURE_HEADER_SIZE;
    if (!hasBytes(bytes, indicesOffset, lookupIndexCount * 2)) {
      continue;
    }
    for (let i = 0; i < lookupIndexCount; i++) {
      const lookupIndex = u16(bytes, indicesOffset + i * 2);
      if (!seen.has(lookupIndex)) {
        seen.add(lookupIndex);
        lookupIndices.push(lookupIndex);
      }
    }
  }
  return lookupIndices;
}

// Builds a pair-kerning lookup from a font's own 'GPOS' table, or returns `undefined` when the font has no GPOS, no 'kern' feature reachable from the script it positions text with, or nothing readable behind one. The whole table is walked once here and reduced to a list of per-subtable closures, so a query costs a coverage bisection rather than a re-parse -- this runs once per adjacent glyph pair of every string laid out.
export function buildGposKernLookup(font: SfntFont): GposKernLookup | undefined {
  const bytes = sfntTableBytes(font, 'GPOS');
  if (bytes === undefined || !hasBytes(bytes, 0, GPOS_HEADER_SIZE) || u16(bytes, 0) !== 1) {
    return undefined;
  }
  const scriptOffset = findScriptOffset(bytes, u16(bytes, 4));
  if (scriptOffset === undefined) {
    return undefined;
  }
  const lookupIndices = collectKernLookupIndices(bytes, u16(bytes, 6), parseDefaultLangSysFeatureIndices(bytes, scriptOffset));
  if (lookupIndices.length === 0) {
    return undefined;
  }

  const lookupListOffset = u16(bytes, 8);
  if (!hasBytes(bytes, lookupListOffset, 2)) {
    return undefined;
  }
  const lookupCount = u16(bytes, lookupListOffset);
  const lookupOffsetsOffset = lookupListOffset + 2;
  if (!hasBytes(bytes, lookupOffsetsOffset, lookupCount * 2)) {
    return undefined;
  }

  // Flattened across lookups deliberately: within one lookup the first subtable that describes a pair wins, and across lookups each is applied in turn, but since every subtable here contributes the same kind of adjustment to the same glyph, "first match wins" over the concatenation is the same answer either reading produces for a pair only one subtable describes -- which, in a real kerning table, is every pair.
  const subtables: PairPosSubtable[] = [];
  for (const lookupIndex of lookupIndices) {
    if (lookupIndex >= lookupCount) {
      continue;
    }
    subtables.push(...parseLookupSubtables(bytes, lookupListOffset + u16(bytes, lookupOffsetsOffset + lookupIndex * 2)));
  }
  if (subtables.length === 0) {
    return undefined;
  }

  return (leftGlyphId: number, rightGlyphId: number): number | undefined => {
    for (const subtable of subtables) {
      const adjustment = subtable(leftGlyphId, rightGlyphId);
      if (adjustment !== undefined) {
        return adjustment;
      }
    }
    return undefined;
  };
}
