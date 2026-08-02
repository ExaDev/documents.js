import type { SfntFont } from './sfnt';
import { hasBytes, sfntTableBytes, u16, u32 } from './sfnt';

// A Unicode code point -> glyph ID lookup built from a font's own 'cmap' table (ISO/IEC 14496-22 clause 5.1). Three subtable formats are parsed: 4 (segmented, BMP-only, uint16 glyph IDs), 12 (segmented coverage, full Unicode range, uint32 glyph IDs), and 6 (a single contiguous trimmed range) -- the two formats every mainstream font tool emits for a font meant to cover the supplementary-plane Mathematical Alphanumeric Symbols block, plus the small trimmed format some subsetting tools emit for a font reduced to one narrow character range, which a font extracted from a source document may well be. Format 12 is preferred whenever present (it alone can map a code point above U+FFFF, which most of this package's own mathvariant-mapped characters are); format 4 is the fallback for a font that only ships BMP coverage, and format 6 the last resort.
//
// Every structural read below is bounds-checked, and any font whose 'cmap' is missing, truncated, or carries no subtable in a format this module reads yields `undefined` rather than throwing: this module's input is no longer only the one trusted vendored math font it was written for, and a font embedded in an arbitrary source document must degrade to "no glyph mapping available" rather than abort the conversion around it.
export type CmapLookup = (codePoint: number) => number | undefined;

const CMAP_HEADER_SIZE = 4;
const SUBTABLE_RECORD_SIZE = 8;

interface Format4Segment {
  readonly startCode: number;
  readonly endCode: number;
  readonly idDelta: number;
  readonly idRangeOffsetPos: number; // absolute byte offset of this segment's own idRangeOffset field, needed to resolve a glyph-index-array lookup relative to it
  readonly idRangeOffset: number;
}

const FORMAT_4_HEADER_SIZE = 14; // format, length, language, segCountX2, searchRange, entrySelector, rangeShift

function parseFormat4(bytes: Uint8Array<ArrayBuffer>, subtableOffset: number): CmapLookup | undefined {
  if (!hasBytes(bytes, subtableOffset, FORMAT_4_HEADER_SIZE)) {
    return undefined;
  }
  const segCountX2 = u16(bytes, subtableOffset + 6);
  if (segCountX2 === 0 || segCountX2 % 2 !== 0) {
    return undefined;
  }
  const segCount = segCountX2 / 2;
  const endCodesOffset = subtableOffset + FORMAT_4_HEADER_SIZE;
  const startCodesOffset = endCodesOffset + segCountX2 + 2; // +2 skips the format's own reservedPad
  const idDeltasOffset = startCodesOffset + segCountX2;
  const idRangeOffsetsOffset = idDeltasOffset + segCountX2;
  // The four parallel per-segment arrays plus the reservedPad between the first two.
  if (!hasBytes(bytes, endCodesOffset, segCountX2 * 4 + 2)) {
    return undefined;
  }

  const segments: Format4Segment[] = [];
  for (let i = 0; i < segCount; i++) {
    const idRangeOffsetPos = idRangeOffsetsOffset + i * 2;
    const rawDelta = u16(bytes, idDeltasOffset + i * 2);
    segments.push({
      endCode: u16(bytes, endCodesOffset + i * 2),
      startCode: u16(bytes, startCodesOffset + i * 2),
      idDelta: rawDelta >= 0x8000 ? rawDelta - 0x10000 : rawDelta,
      idRangeOffsetPos,
      idRangeOffset: u16(bytes, idRangeOffsetPos),
    });
  }

  return (codePoint: number): number | undefined => {
    if (codePoint > 0xffff) {
      return undefined;
    }
    for (const segment of segments) {
      if (codePoint < segment.startCode || codePoint > segment.endCode) {
        continue;
      }
      if (segment.idRangeOffset === 0) {
        return (codePoint + segment.idDelta) & 0xffff;
      }
      const glyphIndexAddress = segment.idRangeOffsetPos + segment.idRangeOffset + (codePoint - segment.startCode) * 2;
      if (!hasBytes(bytes, glyphIndexAddress, 2)) {
        return undefined; // a segment whose glyph-index array runs past the table maps nothing here, rather than reading past the end
      }
      const glyphId = u16(bytes, glyphIndexAddress);
      return glyphId === 0 ? undefined : (glyphId + segment.idDelta) & 0xffff;
    }
    return undefined;
  };
}

interface Format12Group {
  readonly startCharCode: number;
  readonly endCharCode: number;
  readonly startGlyphId: number;
}

const FORMAT_12_HEADER_SIZE = 16; // format, reserved, length, language, numGroups
const FORMAT_12_GROUP_SIZE = 12;

function parseFormat12(bytes: Uint8Array<ArrayBuffer>, subtableOffset: number): CmapLookup | undefined {
  if (!hasBytes(bytes, subtableOffset, FORMAT_12_HEADER_SIZE)) {
    return undefined;
  }
  const numGroups = u32(bytes, subtableOffset + 12);
  const groupsOffset = subtableOffset + FORMAT_12_HEADER_SIZE;
  if (!hasBytes(bytes, groupsOffset, numGroups * FORMAT_12_GROUP_SIZE)) {
    return undefined;
  }
  const groups: Format12Group[] = [];
  for (let i = 0; i < numGroups; i++) {
    const recordOffset = groupsOffset + i * FORMAT_12_GROUP_SIZE;
    groups.push({
      startCharCode: u32(bytes, recordOffset),
      endCharCode: u32(bytes, recordOffset + 4),
      startGlyphId: u32(bytes, recordOffset + 8),
    });
  }
  return (codePoint: number): number | undefined => {
    for (const group of groups) {
      if (codePoint >= group.startCharCode && codePoint <= group.endCharCode) {
        return group.startGlyphId + (codePoint - group.startCharCode);
      }
    }
    return undefined;
  };
}

const FORMAT_6_HEADER_SIZE = 10; // format, length, language, firstCode, entryCount

// Format 6 ("trimmed table mapping"): one contiguous run of code points, each with an explicit glyph ID. Rare in a fully-featured font, but a subsetting tool that reduces a font to a single narrow character range sometimes emits it in place of a one-segment format 4, so it is worth reading as a fallback rather than declaring such a font unmappable.
function parseFormat6(bytes: Uint8Array<ArrayBuffer>, subtableOffset: number): CmapLookup | undefined {
  if (!hasBytes(bytes, subtableOffset, FORMAT_6_HEADER_SIZE)) {
    return undefined;
  }
  const firstCode = u16(bytes, subtableOffset + 6);
  const entryCount = u16(bytes, subtableOffset + 8);
  const glyphIdArrayOffset = subtableOffset + FORMAT_6_HEADER_SIZE;
  if (!hasBytes(bytes, glyphIdArrayOffset, entryCount * 2)) {
    return undefined;
  }
  return (codePoint: number): number | undefined => {
    const index = codePoint - firstCode;
    if (index < 0 || index >= entryCount) {
      return undefined;
    }
    const glyphId = u16(bytes, glyphIdArrayOffset + index * 2);
    return glyphId === 0 ? undefined : glyphId;
  };
}

interface CmapSubtableRecord {
  readonly platformId: number;
  readonly encodingId: number;
  readonly offset: number;
  readonly format: number;
}

// Ranks the subtables this module can read, best first: (3, 10) Windows/UCS-4 format 12, (0, *) Unicode format 12, any format 12, (3, 1) Windows/BMP format 4, any format 4, then format 6.
function preferenceRank(subtable: CmapSubtableRecord): number {
  if (subtable.format === 12) {
    if (subtable.platformId === 3 && subtable.encodingId === 10) {
      return 0;
    }
    if (subtable.platformId === 0) {
      return 1;
    }
    return 2;
  }
  if (subtable.format === 4) {
    return subtable.platformId === 3 && subtable.encodingId === 1 ? 3 : 4;
  }
  return 5; // format 6
}

// Picks the best available cmap subtable and returns a lookup function, or `undefined` if the font has no readable 'cmap' at all -- a font with no usable character-to-glyph mapping is one the caller must degrade around (skip the glyph, substitute another font), not one worth aborting a whole conversion over.
export function buildCmapLookup(font: SfntFont): CmapLookup | undefined {
  const cmapBytes = sfntTableBytes(font, 'cmap');
  if (cmapBytes === undefined || !hasBytes(cmapBytes, 0, CMAP_HEADER_SIZE)) {
    return undefined;
  }
  const numTables = u16(cmapBytes, 2);
  if (!hasBytes(cmapBytes, CMAP_HEADER_SIZE, numTables * SUBTABLE_RECORD_SIZE)) {
    return undefined;
  }

  const subtables: CmapSubtableRecord[] = [];
  for (let i = 0; i < numTables; i++) {
    const recordOffset = CMAP_HEADER_SIZE + i * SUBTABLE_RECORD_SIZE;
    const offset = u32(cmapBytes, recordOffset + 4);
    if (!hasBytes(cmapBytes, offset, 2)) {
      continue; // a subtable record pointing past the table: skip it, another record may still be readable
    }
    subtables.push({
      platformId: u16(cmapBytes, recordOffset),
      encodingId: u16(cmapBytes, recordOffset + 2),
      offset,
      format: u16(cmapBytes, offset),
    });
  }

  const candidates = subtables.filter((s) => s.format === 4 || s.format === 6 || s.format === 12).sort((a, b) => preferenceRank(a) - preferenceRank(b));
  // Walk in preference order rather than taking only the best: a font whose preferred subtable turns out to be truncated can still be driven by a lower-ranked one that is intact.
  for (const candidate of candidates) {
    const lookup = candidate.format === 12 ? parseFormat12(cmapBytes, candidate.offset) : candidate.format === 4 ? parseFormat4(cmapBytes, candidate.offset) : parseFormat6(cmapBytes, candidate.offset);
    if (lookup !== undefined) {
      return lookup;
    }
  }
  return undefined;
}
