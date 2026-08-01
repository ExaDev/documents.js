import type { SfntFont } from './sfnt';
import { sfntTableBytes, u16, u32 } from './sfnt';

// A Unicode code point -> glyph ID lookup built from a font's own 'cmap' table (ISO/IEC 14496-22 clause 5.1) -- only formats 4 (segmented, BMP-only, uint16 glyph IDs) and 12 (segmented coverage, full Unicode range, uint32 glyph IDs) are parsed: the two formats every mainstream font tool actually emits for a font meant to cover math's own supplementary-plane Mathematical Alphanumeric Symbols block. Format 12 is preferred whenever present (it alone can map a codepoint above U+FFFF, which most of this package's own mathvariant-mapped characters are); format 4 is the fallback for a font that only ships BMP coverage.
export type CmapLookup = (codePoint: number) => number | undefined;

interface Format4Group {
  readonly startCode: number;
  readonly endCode: number;
  readonly idDelta: number;
  readonly idRangeOffsetPos: number; // absolute byte offset of this segment's own idRangeOffset field, needed to resolve a glyph-index-array lookup relative to it
  readonly idRangeOffset: number;
}

function parseFormat4(bytes: Uint8Array<ArrayBuffer>, subtableOffset: number): CmapLookup {
  const segCountX2 = u16(bytes, subtableOffset + 6);
  const segCount = segCountX2 / 2;
  const endCodesOffset = subtableOffset + 14;
  const startCodesOffset = endCodesOffset + segCountX2 + 2; // +2 skips the format's own reservedPad
  const idDeltasOffset = startCodesOffset + segCountX2;
  const idRangeOffsetsOffset = idDeltasOffset + segCountX2;

  const groups: Format4Group[] = [];
  for (let i = 0; i < segCount; i++) {
    const idRangeOffsetPos = idRangeOffsetsOffset + i * 2;
    groups.push({
      endCode: u16(bytes, endCodesOffset + i * 2),
      startCode: u16(bytes, startCodesOffset + i * 2),
      idDelta: (() => {
        const raw = u16(bytes, idDeltasOffset + i * 2);
        return raw >= 0x8000 ? raw - 0x10000 : raw;
      })(),
      idRangeOffsetPos,
      idRangeOffset: u16(bytes, idRangeOffsetPos),
    });
  }

  return (codePoint: number): number | undefined => {
    if (codePoint > 0xffff) {
      return undefined;
    }
    for (const group of groups) {
      if (codePoint < group.startCode || codePoint > group.endCode) {
        continue;
      }
      if (group.idRangeOffset === 0) {
        return (codePoint + group.idDelta) & 0xffff;
      }
      const glyphIndexAddress = group.idRangeOffsetPos + group.idRangeOffset + (codePoint - group.startCode) * 2;
      const glyphId = u16(bytes, glyphIndexAddress);
      return glyphId === 0 ? undefined : (glyphId + group.idDelta) & 0xffff;
    }
    return undefined;
  };
}

interface Format12Group {
  readonly startCharCode: number;
  readonly endCharCode: number;
  readonly startGlyphId: number;
}

function parseFormat12(bytes: Uint8Array<ArrayBuffer>, subtableOffset: number): CmapLookup {
  const numGroups = u32(bytes, subtableOffset + 12);
  const groups: Format12Group[] = [];
  for (let i = 0; i < numGroups; i++) {
    const recordOffset = subtableOffset + 16 + i * 12;
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

// Picks the best available cmap subtable and returns a lookup function -- preferring, in order: (3, 10) Windows/UCS-4 format 12, (0, *) Unicode format 12, any format 12, (3, 1) Windows/BMP format 4, any format 4. Throws if the font has no 'cmap' table at all or none of its subtables are format 4/12 -- both would mean this isn't a font this module can drive at all, which cannot legitimately happen for the one font this package ever loads (see math-font.ts), so this is an invariant check, not a degrade-with-diagnostic case a real caller needs to recover from.
export function buildCmapLookup(font: SfntFont): CmapLookup {
  const cmapBytes = sfntTableBytes(font, 'cmap');
  if (cmapBytes === undefined) {
    throw new Error('math font has no cmap table');
  }
  const numTables = u16(cmapBytes, 2);
  const subtables: { readonly platformId: number; readonly encodingId: number; readonly offset: number; readonly format: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 4 + i * 8;
    const platformId = u16(cmapBytes, recordOffset);
    const encodingId = u16(cmapBytes, recordOffset + 2);
    const offset = u32(cmapBytes, recordOffset + 4);
    subtables.push({ platformId, encodingId, offset, format: u16(cmapBytes, offset) });
  }

  const byPreference = (a: { readonly platformId: number; readonly encodingId: number; readonly format: number }): number => {
    if (a.format === 12 && a.platformId === 3 && a.encodingId === 10) {
      return 0;
    }
    if (a.format === 12 && a.platformId === 0) {
      return 1;
    }
    if (a.format === 12) {
      return 2;
    }
    if (a.format === 4 && a.platformId === 3 && a.encodingId === 1) {
      return 3;
    }
    if (a.format === 4) {
      return 4;
    }
    return 5;
  };

  const best = subtables.filter((s) => s.format === 4 || s.format === 12).sort((a, b) => byPreference(a) - byPreference(b))[0];
  if (best === undefined) {
    throw new Error('math font cmap has no format 4 or format 12 subtable');
  }
  return best.format === 12 ? parseFormat12(cmapBytes, best.offset) : parseFormat4(cmapBytes, best.offset);
}
