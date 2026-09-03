import type { SfntFont } from "./sfnt";
import { hasBytes, sfntTableBytes, u8, u16, u32 } from "./sfnt";

// A Unicode code point -> glyph ID lookup built from a font's own 'cmap' table (ISO/IEC 14496-22 clause 5.1). Three subtable formats are parsed: 4 (segmented, BMP-only, uint16 glyph IDs), 12 (segmented coverage, full Unicode range, uint32 glyph IDs), and 6 (a single contiguous trimmed range) -- the two formats every mainstream font tool emits for a font meant to cover the supplementary-plane Mathematical Alphanumeric Symbols block, plus the small trimmed format some subsetting tools emit for a font reduced to one narrow character range, which a font extracted from a source document may well be. Format 12 is preferred whenever present (it alone can map a code point above U+FFFF, which most of this package's own mathvariant-mapped characters are); format 4 is the fallback for a font that only ships BMP coverage, and format 6 the last resort.
//
// Every structural read below is bounds-checked, and any font whose 'cmap' is missing, truncated, or carries no subtable in a format this module reads yields `undefined` rather than throwing: this module's input is no longer only the one trusted vendored math font it was written for, and a font embedded in an arbitrary source document must degrade to "no glyph mapping available" rather than abort the conversion around it.
export type CmapLookup = (codePoint: number) => number | undefined;

// One readable subtable, kept alongside the platform/encoding pair that says what its codes actually are. That pairing is the whole point of exposing subtables individually rather than only the best Unicode one: a (3, 1) subtable is keyed by Unicode, but a (3, 0) subtable is keyed by a symbolic font's own character codes and a (1, 0) subtable by Mac OS Roman ones, and reading either of the latter as though it were Unicode is how a symbol font's glyphs end up identified as the wrong characters.
export interface CmapSubtable {
  readonly platformId: number;
  readonly encodingId: number;
  readonly format: number;
  readonly lookup: CmapLookup;
  // Visits every code this subtable maps, in no particular order. Used to invert a subtable (glyph ID -> code), which has no direct form in any of these formats.
  forEachMapping(visit: (code: number, glyphId: number) => void): void;
}

interface ParsedSubtable {
  readonly lookup: CmapLookup;
  forEachMapping(visit: (code: number, glyphId: number) => void): void;
}

const CMAP_HEADER_SIZE = 4;
const SUBTABLE_RECORD_SIZE = 8;
const MAX_UNICODE_CODE_POINT = 0x10ffff;

interface Format4Segment {
  readonly startCode: number;
  readonly endCode: number;
  readonly idDelta: number;
  readonly idRangeOffsetPos: number; // absolute byte offset of this segment's own idRangeOffset field, needed to resolve a glyph-index-array lookup relative to it
  readonly idRangeOffset: number;
}

const FORMAT_4_HEADER_SIZE = 14; // format, length, language, segCountX2, searchRange, entrySelector, rangeShift

function parseFormat4(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
): ParsedSubtable | undefined {
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

  const lookup = (codePoint: number): number | undefined => {
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
      const glyphIndexAddress =
        segment.idRangeOffsetPos +
        segment.idRangeOffset +
        (codePoint - segment.startCode) * 2;
      if (!hasBytes(bytes, glyphIndexAddress, 2)) {
        return undefined; // a segment whose glyph-index array runs past the table maps nothing here, rather than reading past the end
      }
      const glyphId = u16(bytes, glyphIndexAddress);
      return glyphId === 0 ? undefined : (glyphId + segment.idDelta) & 0xffff;
    }
    return undefined;
  };

  return {
    lookup,
    forEachMapping(visit) {
      for (const segment of segments) {
        // 0xFFFF is the mandatory terminating segment's own end code, and maps nothing.
        const end = Math.min(segment.endCode, 0xfffe);
        for (let code = segment.startCode; code <= end; code++) {
          const glyphId = lookup(code);
          if (glyphId !== undefined && glyphId !== 0) {
            visit(code, glyphId);
          }
        }
      }
    },
  };
}

interface Format12Group {
  readonly startCharCode: number;
  readonly endCharCode: number;
  readonly startGlyphId: number;
}

const FORMAT_12_HEADER_SIZE = 16; // format, reserved, length, language, numGroups
const FORMAT_12_GROUP_SIZE = 12;

function parseFormat12(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
): ParsedSubtable | undefined {
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
  return {
    lookup(codePoint: number): number | undefined {
      for (const group of groups) {
        if (
          codePoint >= group.startCharCode &&
          codePoint <= group.endCharCode
        ) {
          return group.startGlyphId + (codePoint - group.startCharCode);
        }
      }
      return undefined;
    },
    forEachMapping(visit) {
      for (const group of groups) {
        // A group's declared end is clamped to the last Unicode code point: the field is a uint32, so a malformed font can name a range far larger than the code space it is indexing.
        const end = Math.min(group.endCharCode, MAX_UNICODE_CODE_POINT);
        for (let code = group.startCharCode; code <= end; code++) {
          visit(code, group.startGlyphId + (code - group.startCharCode));
        }
      }
    },
  };
}

const FORMAT_0_SIZE = 262; // format, length, language, then a fixed 256-byte glyph-ID array

// Format 0 ("byte encoding table"): one glyph ID per code 0..255. The oldest and simplest subtable format, and still what a symbol font's own (3, 0) or (1, 0) subtable often is, since such a font's whole encoding fits in a single byte.
function parseFormat0(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
): ParsedSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, FORMAT_0_SIZE)) {
    return undefined;
  }
  const glyphIdArrayOffset = subtableOffset + 6;
  const lookup = (codePoint: number): number | undefined => {
    if (codePoint < 0 || codePoint > 0xff) {
      return undefined;
    }
    const glyphId = u8(bytes, glyphIdArrayOffset + codePoint);
    return glyphId === 0 ? undefined : glyphId;
  };
  return {
    lookup,
    forEachMapping(visit) {
      for (let code = 0; code <= 0xff; code++) {
        const glyphId = lookup(code);
        if (glyphId !== undefined) {
          visit(code, glyphId);
        }
      }
    },
  };
}

const FORMAT_6_HEADER_SIZE = 10; // format, length, language, firstCode, entryCount

// Format 6 ("trimmed table mapping"): one contiguous run of code points, each with an explicit glyph ID. Rare in a fully-featured font, but a subsetting tool that reduces a font to a single narrow character range sometimes emits it in place of a one-segment format 4, so it is worth reading as a fallback rather than declaring such a font unmappable.
function parseFormat6(
  bytes: Uint8Array<ArrayBuffer>,
  subtableOffset: number,
): ParsedSubtable | undefined {
  if (!hasBytes(bytes, subtableOffset, FORMAT_6_HEADER_SIZE)) {
    return undefined;
  }
  const firstCode = u16(bytes, subtableOffset + 6);
  const entryCount = u16(bytes, subtableOffset + 8);
  const glyphIdArrayOffset = subtableOffset + FORMAT_6_HEADER_SIZE;
  if (!hasBytes(bytes, glyphIdArrayOffset, entryCount * 2)) {
    return undefined;
  }
  const lookup = (codePoint: number): number | undefined => {
    const index = codePoint - firstCode;
    if (index < 0 || index >= entryCount) {
      return undefined;
    }
    const glyphId = u16(bytes, glyphIdArrayOffset + index * 2);
    return glyphId === 0 ? undefined : glyphId;
  };
  return {
    lookup,
    forEachMapping(visit) {
      for (let index = 0; index < entryCount; index++) {
        const code = firstCode + index;
        const glyphId = lookup(code);
        if (glyphId !== undefined) {
          visit(code, glyphId);
        }
      }
    },
  };
}

interface CmapSubtableRecord {
  readonly platformId: number;
  readonly encodingId: number;
  readonly offset: number;
  readonly format: number;
}

// Ranks the subtables this module can read, best first: (3, 10) Windows/UCS-4 format 12, (0, *) Unicode format 12, any format 12, (3, 1) Windows/BMP format 4, any format 4, then format 6.
function preferenceRank(subtable: CmapSubtable): number {
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

function parseSubtable(
  bytes: Uint8Array<ArrayBuffer>,
  record: CmapSubtableRecord,
): ParsedSubtable | undefined {
  if (record.format === 12) {
    return parseFormat12(bytes, record.offset);
  }
  if (record.format === 4) {
    return parseFormat4(bytes, record.offset);
  }
  if (record.format === 6) {
    return parseFormat6(bytes, record.offset);
  }
  return record.format === 0 ? parseFormat0(bytes, record.offset) : undefined;
}

// Every readable subtable of a font's own 'cmap', each still carrying the platform and encoding IDs that say what its codes mean. Subtables in a format this module does not read, and ones whose bytes are truncated, are dropped individually rather than costing the caller the whole table.
export function readCmapSubtables(font: SfntFont): readonly CmapSubtable[] {
  const cmapBytes = sfntTableBytes(font, "cmap");
  if (cmapBytes === undefined || !hasBytes(cmapBytes, 0, CMAP_HEADER_SIZE)) {
    return [];
  }
  const numTables = u16(cmapBytes, 2);
  if (
    !hasBytes(cmapBytes, CMAP_HEADER_SIZE, numTables * SUBTABLE_RECORD_SIZE)
  ) {
    return [];
  }

  const subtables: CmapSubtable[] = [];
  for (let i = 0; i < numTables; i++) {
    const recordOffset = CMAP_HEADER_SIZE + i * SUBTABLE_RECORD_SIZE;
    const offset = u32(cmapBytes, recordOffset + 4);
    if (!hasBytes(cmapBytes, offset, 2)) {
      continue; // a subtable record pointing past the table: skip it, another record may still be readable
    }
    const record: CmapSubtableRecord = {
      platformId: u16(cmapBytes, recordOffset),
      encodingId: u16(cmapBytes, recordOffset + 2),
      offset,
      format: u16(cmapBytes, offset),
    };
    const parsed = parseSubtable(cmapBytes, record);
    if (parsed !== undefined) {
      subtables.push({
        platformId: record.platformId,
        encodingId: record.encodingId,
        format: record.format,
        ...parsed,
      });
    }
  }
  return subtables;
}

// Picks the best available Unicode-keyed cmap subtable and returns a lookup function, or `undefined` if the font has no readable 'cmap' at all -- a font with no usable character-to-glyph mapping is one the caller must degrade around (skip the glyph, substitute another font), not one worth aborting a whole conversion over.
export function buildCmapLookup(font: SfntFont): CmapLookup | undefined {
  const candidates = readCmapSubtables(font)
    .filter((s) => s.format === 4 || s.format === 6 || s.format === 12)
    .sort((a, b) => preferenceRank(a) - preferenceRank(b));
  return candidates[0]?.lookup;
}
