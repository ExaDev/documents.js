import { describe, expect, it } from "vitest";
import { buildCmapLookup, readCmapSubtables } from "./cmap-table";
import type { SfntFont } from "./sfnt";
import { parseSfnt } from "./sfnt";
import { caladeaRegularBytes, carlitoRegularBytes } from "./test-support/fonts";

// The glyph IDs asserted below were read out of the real vendored .ttf files by a standalone Node script walking the 'cmap' subtables with a bare DataView, independently of this module.
function parse(bytes: Uint8Array<ArrayBuffer>): SfntFont {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    throw new Error("font failed to parse as an sfnt container");
  }
  return font;
}

describe("buildCmapLookup against the real vendored fonts", () => {
  it("resolves Carlito Regular code points to their real glyph IDs", () => {
    const lookup = buildCmapLookup(parse(carlitoRegularBytes()));
    expect(lookup).toBeDefined();
    expect(lookup!(0x20)).toBe(2); // space
    expect(lookup!(0x41)).toBe(3); // 'A'
    expect(lookup!(0x65)).toBe(59); // 'e'
    expect(lookup!(0xe9)).toBe(2007); // 'e-acute'
  });

  it("picks Carlito's Windows/BMP format 4 subtable over the Macintosh format 6 one it also ships", () => {
    // Carlito carries three subtables: (0, 3) and (3, 1) format 4, plus a (1, 0) format 6 covering only code points 0..254. U+2019 lies outside that trimmed range, so resolving it at all proves the format 4 subtable is what drives the lookup.
    const lookup = buildCmapLookup(parse(carlitoRegularBytes()));
    expect(lookup!(0x2019)).toBe(317); // RIGHT SINGLE QUOTATION MARK
  });

  it("resolves Caladea Regular code points to their real glyph IDs", () => {
    const lookup = buildCmapLookup(parse(caladeaRegularBytes()));
    expect(lookup).toBeDefined();
    expect(lookup!(0x41)).toBe(5);
    expect(lookup!(0x65)).toBe(35);
    expect(lookup!(0xe9)).toBe(178);
    expect(lookup!(0x2019)).toBe(331);
  });

  it("returns undefined for a code point the font does not cover", () => {
    const lookup = buildCmapLookup(parse(carlitoRegularBytes()));
    expect(lookup!(0x1_0000)).toBeUndefined(); // an unassigned supplementary-plane code point, which no BMP-only format 4 subtable can reach
    expect(lookup!(0x4e00)).toBeUndefined(); // a CJK ideograph, outside a Latin text font's coverage
  });
});

// A minimal sfnt carrying one or more 'cmap' subtables, built to the spec's own layout (ISO/IEC 14496-22 clause 5.1). Subtables are laid out back-to-back in the order given, right after the fixed-size array of subtable records that names each one's platform/encoding pair and byte offset.
function buildFontWithCmapSubtables(
  entries: readonly {
    readonly platformId: number;
    readonly encodingId: number;
    readonly subtable: Uint8Array<ArrayBuffer>;
  }[],
): Uint8Array<ArrayBuffer> {
  const CMAP_HEADER_SIZE = 4;
  const SUBTABLE_RECORD_SIZE = 8;
  const recordsSize = entries.length * SUBTABLE_RECORD_SIZE;
  const subtablesSize = entries.reduce(
    (total, entry) => total + entry.subtable.length,
    0,
  );
  const cmap = new Uint8Array(CMAP_HEADER_SIZE + recordsSize + subtablesSize);
  const cmapView = new DataView(cmap.buffer);
  cmapView.setUint16(2, entries.length); // numTables
  let subtableOffset = CMAP_HEADER_SIZE + recordsSize;
  entries.forEach((entry, index) => {
    const recordOffset = CMAP_HEADER_SIZE + index * SUBTABLE_RECORD_SIZE;
    cmapView.setUint16(recordOffset, entry.platformId);
    cmapView.setUint16(recordOffset + 2, entry.encodingId);
    cmapView.setUint32(recordOffset + 4, subtableOffset);
    cmap.set(entry.subtable, subtableOffset);
    subtableOffset += entry.subtable.length;
  });

  const DIRECTORY_SIZE = 12 + 16;
  const font = new Uint8Array(DIRECTORY_SIZE + cmap.length);
  const fontView = new DataView(font.buffer);
  fontView.setUint32(0, 0x00010000);
  fontView.setUint16(4, 1); // numTables
  font.set(Uint8Array.from([0x63, 0x6d, 0x61, 0x70]), 12); // 'cmap'
  fontView.setUint32(12 + 8, DIRECTORY_SIZE);
  fontView.setUint32(12 + 12, cmap.length);
  font.set(cmap, DIRECTORY_SIZE);
  return font;
}

// The single-subtable case, which every existing test below was written against.
function buildFontWithCmapSubtable(
  platformId: number,
  encodingId: number,
  subtable: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return buildFontWithCmapSubtables([{ platformId, encodingId, subtable }]);
}

function buildFormat6Subtable(
  firstCode: number,
  glyphIds: readonly number[],
): Uint8Array<ArrayBuffer> {
  const HEADER_SIZE = 10;
  const subtable = new Uint8Array(HEADER_SIZE + glyphIds.length * 2);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 6); // format
  view.setUint16(2, subtable.length); // length
  view.setUint16(6, firstCode);
  view.setUint16(8, glyphIds.length); // entryCount
  glyphIds.forEach((glyphId, index) => {
    view.setUint16(HEADER_SIZE + index * 2, glyphId);
  });
  return subtable;
}

// A minimal format 4 (segment mapping to delta values) subtable, one segment covering [firstCode, firstCode + glyphIds.length - 1] via idDelta (idRangeOffset left at 0, so no glyph-index array is needed). segCountX2Override lets a test deliberately install a malformed segment count without disturbing the rest of the layout.
function buildFormat4Subtable(
  firstCode: number,
  glyphIds: readonly number[],
  segCountX2Override?: number,
): Uint8Array<ArrayBuffer> {
  const HEADER_SIZE = 14;
  const segCount = 1;
  const segCountX2 = segCountX2Override ?? segCount * 2;
  const endCode = firstCode + glyphIds.length - 1;
  // idDelta must satisfy (code + idDelta) & 0xffff === glyphIds[code - firstCode] for every code in range; with one glyph run starting at glyphIds[0], idDelta = glyphIds[0] - firstCode covers it exactly since each subsequent glyph id increments in step with the code.
  const idDelta = (glyphIds[0]! - firstCode) & 0xffff;
  const arraysSize = segCountX2 * 4 + 2; // endCodes + reservedPad + startCodes + idDeltas + idRangeOffsets
  const subtable = new Uint8Array(HEADER_SIZE + arraysSize);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 4); // format
  view.setUint16(2, subtable.length); // length
  view.setUint16(6, segCountX2);
  if (segCountX2Override === undefined) {
    // The well-formed case only: a malformed declared segCountX2 (0, or an odd value) has no real one-segment layout to write field values into, and none is needed — the test using it only checks that the malformed count itself is rejected, not what a garbage lookup would return.

    const startCodesOffset = HEADER_SIZE + segCountX2 + 2;
    const idDeltasOffset = startCodesOffset + segCountX2;
    const idRangeOffsetsOffset = idDeltasOffset + segCountX2;
    view.setUint16(HEADER_SIZE, endCode);
    view.setUint16(startCodesOffset, firstCode);
    view.setUint16(idDeltasOffset, idDelta);
    view.setUint16(idRangeOffsetsOffset, 0);
  }
  return subtable;
}

// A minimal format 12 (segmented coverage) subtable, one group per {startCharCode, endCharCode, startGlyphId} triple, exactly as the spec lays it out (ISO/IEC 14496-22 clause 5.1.7).
function buildFormat12Subtable(
  groups: readonly {
    readonly startCharCode: number;
    readonly endCharCode: number;
    readonly startGlyphId: number;
  }[],
): Uint8Array<ArrayBuffer> {
  const HEADER_SIZE = 16;
  const GROUP_SIZE = 12;
  const subtable = new Uint8Array(HEADER_SIZE + groups.length * GROUP_SIZE);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 12); // format
  view.setUint32(4, subtable.length); // length
  view.setUint32(12, groups.length); // numGroups
  groups.forEach((group, index) => {
    const recordOffset = HEADER_SIZE + index * GROUP_SIZE;
    view.setUint32(recordOffset, group.startCharCode);
    view.setUint32(recordOffset + 4, group.endCharCode);
    view.setUint32(recordOffset + 8, group.startGlyphId);
  });
  return subtable;
}

// A format 4 subtable with an explicit glyph-index array, for exercising the idRangeOffset !== 0 branch buildFormat4Subtable's own idDelta-only layout never reaches. One segment [firstCode, firstCode + glyphIds.length - 1], each code's glyph ID read from the array itself rather than derived by adding idDelta.
function buildFormat4SubtableWithGlyphArray(
  firstCode: number,
  glyphIds: readonly number[],
): Uint8Array<ArrayBuffer> {
  const HEADER_SIZE = 14;
  const segCountX2 = 2;
  const endCode = firstCode + glyphIds.length - 1;
  const startCodesOffset = HEADER_SIZE + segCountX2 + 2;
  const idDeltasOffset = startCodesOffset + segCountX2;
  const idRangeOffsetsOffset = idDeltasOffset + segCountX2;
  const glyphArrayOffset = idRangeOffsetsOffset + segCountX2;
  const subtable = new Uint8Array(glyphArrayOffset + glyphIds.length * 2);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 4); // format
  view.setUint16(2, subtable.length); // length
  view.setUint16(6, segCountX2);
  view.setUint16(HEADER_SIZE, endCode);
  view.setUint16(startCodesOffset, firstCode);
  view.setUint16(idDeltasOffset, 0); // idDelta is added to the array's own glyph ID, so 0 leaves it unchanged
  // idRangeOffset is relative to its OWN field's byte position, per spec Table 5b.
  view.setUint16(idRangeOffsetsOffset, glyphArrayOffset - idRangeOffsetsOffset);
  glyphIds.forEach((glyphId, index) => {
    view.setUint16(glyphArrayOffset + index * 2, glyphId);
  });
  return subtable;
}

describe("format 4 (segment mapping to delta values)", () => {
  it("drives a font whose only subtable is a hand-built format 4 one", () => {
    const font = parse(
      buildFontWithCmapSubtable(3, 1, buildFormat4Subtable(0x41, [11, 12, 13])),
    );
    const lookup = buildCmapLookup(font);
    expect(lookup).toBeDefined();
    expect(lookup!(0x41)).toBe(11);
    expect(lookup!(0x42)).toBe(12);
    expect(lookup!(0x43)).toBe(13);
    expect(lookup!(0x44)).toBeUndefined(); // past the segment's own endCode
  });

  it("returns undefined when a format 4 subtable's own fixed header does not fit", () => {
    // Four bytes (format + length) is nowhere near the 14-byte fixed header format 4 requires; hasBytes must catch this before any field past it is read.
    const shortSubtable = new Uint8Array(4);
    new DataView(shortSubtable.buffer).setUint16(0, 4); // format
    const font = parse(buildFontWithCmapSubtable(3, 1, shortSubtable));
    expect(buildCmapLookup(font)).toBeUndefined();
  });

  it("rejects a format 4 subtable declaring a zero segment count", () => {
    const font = parse(
      buildFontWithCmapSubtable(3, 1, buildFormat4Subtable(0x41, [11], 0)),
    );
    expect(buildCmapLookup(font)).toBeUndefined();
  });

  it("rejects a format 4 subtable declaring an odd segCountX2 (segCountX2 is always meant to be even)", () => {
    const font = parse(
      buildFontWithCmapSubtable(3, 1, buildFormat4Subtable(0x41, [11], 3)),
    );
    expect(buildCmapLookup(font)).toBeUndefined();
  });

  it("resolves a code through a segment's own glyph-index array (idRangeOffset !== 0), not through idDelta", () => {
    const font = parse(
      buildFontWithCmapSubtable(
        3,
        1,
        buildFormat4SubtableWithGlyphArray(0x41, [11, 0, 13]),
      ),
    );
    const lookup = buildCmapLookup(font);
    expect(lookup!(0x41)).toBe(11);
    expect(lookup!(0x42)).toBeUndefined(); // the array's own glyph ID is 0: unmapped, not glyph 0
    expect(lookup!(0x43)).toBe(13);
  });

  it("reports a code whose glyph-index array cell runs past the subtable as unmapped rather than reading past it", () => {
    const whole = buildFormat4SubtableWithGlyphArray(0x41, [11, 12, 13]);
    const truncated = whole.subarray(0, whole.length - 2); // drops the last glyph-array cell
    const clipped = new Uint8Array(truncated.length);
    clipped.set(truncated);
    const font = parse(buildFontWithCmapSubtable(3, 1, clipped));
    const lookup = buildCmapLookup(font);
    expect(lookup!(0x41)).toBe(11);
    expect(lookup!(0x43)).toBeUndefined(); // its own cell is exactly the two bytes that got dropped
  });
});

describe("format 12 (segmented coverage)", () => {
  it("drives a font whose only subtable is a hand-built format 12 one", () => {
    const font = parse(
      buildFontWithCmapSubtable(
        3,
        10,
        buildFormat12Subtable([
          { startCharCode: 0x1_0000, endCharCode: 0x1_0002, startGlyphId: 50 },
        ]),
      ),
    );
    const lookup = buildCmapLookup(font);
    expect(lookup).toBeDefined();
    expect(lookup!(0x1_0000)).toBe(50);
    expect(lookup!(0x1_0001)).toBe(51);
    expect(lookup!(0x1_0002)).toBe(52);
    expect(lookup!(0x1_0003)).toBeUndefined(); // past the group's own endCharCode
    expect(lookup!(0xffff)).toBeUndefined(); // below the group's own startCharCode
  });

  it("resolves multiple groups independently, not just the first", () => {
    const font = parse(
      buildFontWithCmapSubtable(
        3,
        10,
        buildFormat12Subtable([
          { startCharCode: 0x41, endCharCode: 0x41, startGlyphId: 5 },
          { startCharCode: 0x1_0000, endCharCode: 0x1_0000, startGlyphId: 99 },
        ]),
      ),
    );
    const lookup = buildCmapLookup(font);
    expect(lookup!(0x41)).toBe(5);
    expect(lookup!(0x1_0000)).toBe(99);
    expect(lookup!(0x42)).toBeUndefined(); // between the two groups
  });

  it("returns undefined when a format 12 subtable's own fixed header does not fit", () => {
    const shortSubtable = new Uint8Array(4);
    new DataView(shortSubtable.buffer).setUint16(0, 12); // format
    const font = parse(buildFontWithCmapSubtable(3, 10, shortSubtable));
    expect(buildCmapLookup(font)).toBeUndefined();
  });

  it("returns undefined when a format 12 subtable's groups array runs past the table", () => {
    // numGroups claims 2 groups but only one group's worth of bytes actually follows the header.
    const oneGroup = buildFormat12Subtable([
      { startCharCode: 0x41, endCharCode: 0x41, startGlyphId: 5 },
    ]);
    new DataView(
      oneGroup.buffer,
      oneGroup.byteOffset,
      oneGroup.byteLength,
    ).setUint32(12, 2);
    const font = parse(buildFontWithCmapSubtable(3, 10, oneGroup));
    expect(buildCmapLookup(font)).toBeUndefined();
  });

  it("enumerates a format 12 subtable's own mappings, clamped to the last valid Unicode code point", () => {
    // A malformed group declaring an endCharCode past U+10FFFF must not enumerate beyond it.
    const font = parse(
      buildFontWithCmapSubtable(
        3,
        10,
        buildFormat12Subtable([
          { startCharCode: 0x10_ffff, endCharCode: 0xff_ffff, startGlyphId: 7 },
        ]),
      ),
    );
    const [subtable] = readCmapSubtables(font);
    const visited: [number, number][] = [];
    subtable?.forEachMapping((code, glyphId) => visited.push([code, glyphId]));
    expect(visited).toEqual([[0x10_ffff, 7]]);
  });
});

describe("choosing among several available subtables (preferenceRank)", () => {
  it("prefers a (3, 10) Windows/UCS-4 format 12 subtable over any other format 12 subtable", () => {
    const font = parse(
      buildFontWithCmapSubtables([
        {
          platformId: 0,
          encodingId: 4,
          subtable: buildFormat12Subtable([
            { startCharCode: 0x41, endCharCode: 0x41, startGlyphId: 1 },
          ]),
        },
        {
          platformId: 3,
          encodingId: 10,
          subtable: buildFormat12Subtable([
            { startCharCode: 0x41, endCharCode: 0x41, startGlyphId: 2 },
          ]),
        },
      ]),
    );
    expect(buildCmapLookup(font)!(0x41)).toBe(2);
  });

  it("prefers a (0, *) Unicode format 12 subtable over a non-(3,10) one when there is no (3, 10) subtable", () => {
    const font = parse(
      buildFontWithCmapSubtables([
        {
          platformId: 1,
          encodingId: 0,
          subtable: buildFormat12Subtable([
            { startCharCode: 0x41, endCharCode: 0x41, startGlyphId: 1 },
          ]),
        },
        {
          platformId: 0,
          encodingId: 4,
          subtable: buildFormat12Subtable([
            { startCharCode: 0x41, endCharCode: 0x41, startGlyphId: 2 },
          ]),
        },
      ]),
    );
    expect(buildCmapLookup(font)!(0x41)).toBe(2);
  });

  it("prefers any format 12 subtable over a format 4 subtable", () => {
    const font = parse(
      buildFontWithCmapSubtables([
        {
          platformId: 3,
          encodingId: 1,
          subtable: buildFormat4Subtable(0x41, [1]),
        },
        {
          platformId: 1,
          encodingId: 0,
          subtable: buildFormat12Subtable([
            { startCharCode: 0x41, endCharCode: 0x41, startGlyphId: 2 },
          ]),
        },
      ]),
    );
    expect(buildCmapLookup(font)!(0x41)).toBe(2);
  });

  it("prefers a (3, 1) Windows/BMP format 4 subtable over a non-(3,1) format 4 subtable", () => {
    const font = parse(
      buildFontWithCmapSubtables([
        {
          platformId: 1,
          encodingId: 0,
          subtable: buildFormat4Subtable(0x41, [1]),
        },
        {
          platformId: 3,
          encodingId: 1,
          subtable: buildFormat4Subtable(0x41, [2]),
        },
      ]),
    );
    expect(buildCmapLookup(font)!(0x41)).toBe(2);
  });

  it("prefers any format 4 subtable over a format 6 subtable", () => {
    const font = parse(
      buildFontWithCmapSubtables([
        {
          platformId: 1,
          encodingId: 0,
          subtable: buildFormat6Subtable(0x41, [1]),
        },
        {
          platformId: 1,
          encodingId: 0,
          subtable: buildFormat4Subtable(0x41, [2]),
        },
      ]),
    );
    expect(buildCmapLookup(font)!(0x41)).toBe(2);
  });
});

describe("format 6 (trimmed table mapping)", () => {
  it("drives a font whose only subtable is a format 6 one", () => {
    const font = parse(
      buildFontWithCmapSubtable(1, 0, buildFormat6Subtable(0x41, [11, 12, 13])),
    );
    const lookup = buildCmapLookup(font);
    expect(lookup).toBeDefined();
    expect(lookup!(0x41)).toBe(11);
    expect(lookup!(0x42)).toBe(12);
    expect(lookup!(0x43)).toBe(13);
  });

  it("maps nothing outside its own trimmed range, and treats an explicit glyph 0 as unmapped", () => {
    const font = parse(
      buildFontWithCmapSubtable(1, 0, buildFormat6Subtable(0x41, [11, 0, 13])),
    );
    const lookup = buildCmapLookup(font);
    expect(lookup!(0x40)).toBeUndefined(); // below firstCode
    expect(lookup!(0x44)).toBeUndefined(); // past the last entry
    expect(lookup!(0x42)).toBeUndefined(); // present, but mapped to .notdef
  });

  it("reports a truncated format 6 subtable as unreadable rather than reading past it", () => {
    const complete = buildFontWithCmapSubtable(
      1,
      0,
      buildFormat6Subtable(0x41, [11, 12, 13]),
    );
    const truncated = complete.subarray(0, complete.length - 2);
    const clipped = new Uint8Array(truncated.length);
    clipped.set(truncated);
    const font = parseSfnt(clipped);
    // The table directory still claims the full-length 'cmap', which no longer fits: the record is dropped, so the font parses with no 'cmap' at all.
    expect(font).toBeDefined();
    expect(buildCmapLookup(font!)).toBeUndefined();
  });
});

describe("degrading on an unusable cmap", () => {
  it("returns undefined for a font with no cmap table at all", () => {
    const bytes = carlitoRegularBytes();
    const font = parse(bytes);
    const withoutCmap: SfntFont = {
      bytes: font.bytes,
      tables: new Map([...font.tables].filter(([tag]) => tag !== "cmap")),
    };
    expect(buildCmapLookup(withoutCmap)).toBeUndefined();
  });

  it("returns undefined for a font whose only subtable is a format 0 byte encoding table", () => {
    // Format 0 is read by this module (readCmapSubtables exposes it, for a symbol font whose whole encoding fits in one byte), but it is never a Unicode lookup: its 256 codes are a font's own 8-bit encoding, not code points, so buildCmapLookup does not select one.
    const format0 = new Uint8Array(262);
    new DataView(format0.buffer).setUint16(2, format0.length);
    expect(
      buildCmapLookup(parse(buildFontWithCmapSubtable(1, 0, format0))),
    ).toBeUndefined();
  });
});

describe("readCmapSubtables", () => {
  it("exposes every subtable of a real vendored font with the platform and encoding it is keyed by", () => {
    // Carlito ships three subtables: (0, 3) and (3, 1) in format 4, plus a (1, 0) in format 6 — read out of the .ttf by a standalone script, independently of this module.
    expect(
      readCmapSubtables(parse(carlitoRegularBytes())).map((subtable) => [
        subtable.platformId,
        subtable.encodingId,
        subtable.format,
      ]),
    ).toEqual([
      [0, 3, 4],
      [1, 0, 6],
      [3, 1, 4],
    ]);
  });

  it("reads a format 0 subtable, which buildCmapLookup declines to treat as Unicode", () => {
    const format0 = new Uint8Array(262);
    const view = new DataView(format0.buffer);
    view.setUint16(2, format0.length);
    format0[6 + 0x57] = 42;
    const [subtable] = readCmapSubtables(
      parse(buildFontWithCmapSubtable(3, 0, format0)),
    );
    expect(subtable?.lookup(0x57)).toBe(42);
    expect(subtable?.lookup(0x58)).toBeUndefined(); // glyph 0 means "no glyph", not glyph .notdef
  });

  it("enumerates a subtable's own mappings, which is what inverting one needs", () => {
    const format0 = new Uint8Array(262);
    new DataView(format0.buffer).setUint16(2, format0.length);
    format0[6 + 0x41] = 7;
    format0[6 + 0x42] = 9;
    const [subtable] = readCmapSubtables(
      parse(buildFontWithCmapSubtable(3, 0, format0)),
    );
    const visited: [number, number][] = [];
    subtable?.forEachMapping((code, glyphId) => visited.push([code, glyphId]));
    expect(visited).toEqual([
      [0x41, 7],
      [0x42, 9],
    ]);
  });

  it("enumerates a real font's format 4 subtable consistently with its own lookups", () => {
    const [, , windows] = readCmapSubtables(parse(carlitoRegularBytes()));
    expect(windows).toBeDefined();
    let checked = 0;
    windows!.forEachMapping((code, glyphId) => {
      expect(windows!.lookup(code)).toBe(glyphId);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it("drops a subtable in a format this module does not read (format 2), keeping the rest of the table's own subtables", () => {
    const format2 = new Uint8Array(6);
    new DataView(format2.buffer).setUint16(0, 2); // format: high-byte mapping through table, unsupported
    const font = parse(
      buildFontWithCmapSubtables([
        { platformId: 1, encodingId: 0, subtable: format2 },
        {
          platformId: 3,
          encodingId: 1,
          subtable: buildFormat4Subtable(0x41, [11]),
        },
      ]),
    );
    const subtables = readCmapSubtables(font);
    expect(subtables).toHaveLength(1);
    expect(subtables[0]?.format).toBe(4);
  });

  it("returns no subtables when the cmap header's own subtable-record array does not fit", () => {
    // numTables claims 3 records but the table holds only the fixed 4-byte header.
    const cmap = new Uint8Array(4);
    new DataView(cmap.buffer).setUint16(2, 3);
    const DIRECTORY_SIZE = 12 + 16;
    const font = new Uint8Array(DIRECTORY_SIZE + cmap.length);
    const view = new DataView(font.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 1);
    font.set(Uint8Array.from([0x63, 0x6d, 0x61, 0x70]), 12);
    view.setUint32(12 + 8, DIRECTORY_SIZE);
    view.setUint32(12 + 12, cmap.length);
    font.set(cmap, DIRECTORY_SIZE);
    expect(readCmapSubtables(parse(font))).toEqual([]);
  });

  it("skips a subtable record whose own offset points past the table, keeping a sibling record that is readable", () => {
    const good = buildFormat4Subtable(0x41, [11]);
    const CMAP_HEADER_SIZE = 4;
    const SUBTABLE_RECORD_SIZE = 8;
    const goodOffset = CMAP_HEADER_SIZE + 2 * SUBTABLE_RECORD_SIZE;
    const cmap = new Uint8Array(goodOffset + good.length);
    const view = new DataView(cmap.buffer);
    view.setUint16(2, 2); // numTables
    // Record 0: claims an offset far past the end of this table.
    view.setUint16(CMAP_HEADER_SIZE, 1);
    view.setUint16(CMAP_HEADER_SIZE + 2, 0);
    view.setUint32(CMAP_HEADER_SIZE + 4, 10_000);
    // Record 1: a genuinely readable format 4 subtable.
    view.setUint16(CMAP_HEADER_SIZE + SUBTABLE_RECORD_SIZE, 3);
    view.setUint16(CMAP_HEADER_SIZE + SUBTABLE_RECORD_SIZE + 2, 1);
    view.setUint32(CMAP_HEADER_SIZE + SUBTABLE_RECORD_SIZE + 4, goodOffset);
    cmap.set(good, goodOffset);

    const DIRECTORY_SIZE = 12 + 16;
    const font = new Uint8Array(DIRECTORY_SIZE + cmap.length);
    const fontView = new DataView(font.buffer);
    fontView.setUint32(0, 0x00010000);
    fontView.setUint16(4, 1);
    font.set(Uint8Array.from([0x63, 0x6d, 0x61, 0x70]), 12);
    fontView.setUint32(12 + 8, DIRECTORY_SIZE);
    fontView.setUint32(12 + 12, cmap.length);
    font.set(cmap, DIRECTORY_SIZE);

    const subtables = readCmapSubtables(parse(font));
    expect(subtables).toHaveLength(1);
    expect(subtables[0]).toMatchObject({ platformId: 3, encodingId: 1 });
  });
});
