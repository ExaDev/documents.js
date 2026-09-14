import { describe, expect, it } from "vitest";
import {
  buildChainContextFormat1,
  buildChainContextFormat2,
  buildClassDefFormat1,
  buildCmapTable,
  buildContextFormat1,
  buildContextFormat2,
  buildCoverageFormat1,
  buildFormat3Subtable,
  buildGdefTable,
  buildGsubTable,
  buildLigatureSubstFormat1,
  buildPostV2Table,
  buildPostV3Table,
  buildSfnt,
  buildSingleSubstFormat2,
} from "./sfnt";

// Every assertion below reads the byte layout back with a raw DataView, deliberately never through this package's own sfnt readers -- the same independent-oracle discipline this file's own top-of-file comment states for the builders themselves. These tests exist to pin the arithmetic and branch choices inside sfnt.ts's fixture builders directly, since gsub-table.test.ts/gdef-table.test.ts only exercise them indirectly through a real reader, which can tolerate an off-by-one the reader itself doesn't notice.

function u16(bytes: Uint8Array, at: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(at);
}
function u32(bytes: Uint8Array, at: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(at);
}
function tag(bytes: Uint8Array, at: number): string {
  return new TextDecoder("ascii").decode(bytes.slice(at, at + 4));
}

describe("buildSfnt", () => {
  it("writes the TrueType version and table count, then one record per table in call order", () => {
    const font = buildSfnt(
      new Map([
        ["cmap", Uint8Array.from([1, 2, 3])],
        ["post", Uint8Array.from([4, 5])],
      ]),
    );
    expect(u32(font, 0)).toBe(0x00010000);
    expect(u16(font, 4)).toBe(2);
    // record 0: tag, then offset/length at the record's own fixed slots
    expect(tag(font, 12)).toBe("cmap");
    expect(u32(font, 20)).toBe(44); // directorySize = 12 + 2*16
    expect(u32(font, 24)).toBe(3);
    // record 1
    expect(tag(font, 28)).toBe("post");
    expect(u32(font, 36)).toBe(47); // 44 + 3
    expect(u32(font, 40)).toBe(2);
    // table data itself, placed back-to-back after the directory
    expect([...font.slice(44, 47)]).toEqual([1, 2, 3]);
    expect([...font.slice(47, 49)]).toEqual([4, 5]);
    expect(font.length).toBe(49);
  });
});

describe("buildCmapTable / format 0", () => {
  it("writes format 0 with its fixed 262-byte length and glyph IDs at code offset", () => {
    const table = buildCmapTable([
      {
        platformId: 1,
        encodingId: 0,
        format: 0,
        mappings: new Map([[65, 10]]),
      },
    ]);
    const headerSize = 4 + 1 * 8;

    expect(u16(table, headerSize)).toBe(0);
    expect(u16(table, headerSize + 2)).toBe(262);
    expect(table[headerSize + 6 + 65]).toBe(10);
    expect(table.length).toBe(headerSize + 262);
  });
});

describe("buildCmapTable / format 4", () => {
  it("sorts mappings given out of order and lays out end/start/idDelta arrays plus the terminator segment", () => {
    // Deliberately inserted out of ascending order -- the builder must sort before laying anything out.
    const table = buildCmapTable([
      {
        platformId: 3,
        encodingId: 1,
        format: 4,
        mappings: new Map([
          [200, 20],
          [65, 10],
          [100, 15],
        ]),
      },
    ]);
    const at = 4 + 1 * 8; // one record before the subtable
    const segCount = 4; // 3 real codes + terminator
    expect(u16(table, at)).toBe(4); // format
    const length = 16 + segCount * 8;
    expect(u16(table, at + 2)).toBe(length);
    expect(u16(table, at + 6)).toBe(segCount * 2); // segCountX2
    // searchRange = 2 * 2**floor(log2(segCount)) = 2 * 2**2 = 8
    expect(u16(table, at + 8)).toBe(8);
    // entrySelector = log2(searchRange/2) = log2(4) = 2
    expect(u16(table, at + 10)).toBe(2);
    // rangeShift = segCountX2 - searchRange = 8 - 8 = 0
    expect(u16(table, at + 12)).toBe(0);
    const endCodes = at + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    // sorted ascending: 65, 100, 200, then the 0xFFFF terminator
    expect(u16(table, endCodes)).toBe(65);
    expect(u16(table, endCodes + 2)).toBe(100);
    expect(u16(table, endCodes + 4)).toBe(200);
    expect(u16(table, endCodes + 6)).toBe(0xffff);
    expect(u16(table, startCodes)).toBe(65);
    expect(u16(table, startCodes + 2)).toBe(100);
    expect(u16(table, startCodes + 4)).toBe(200);
    expect(u16(table, startCodes + 6)).toBe(0xffff);
    expect(u16(table, idDeltas)).toBe((10 - 65) & 0xffff);
    expect(u16(table, idDeltas + 2)).toBe((15 - 100) & 0xffff);
    expect(u16(table, idDeltas + 4)).toBe((20 - 200) & 0xffff);
    expect(u16(table, idDeltas + 6)).toBe(1);
  });

  it("computes a distinct searchRange/entrySelector/rangeShift for a segCount that is not itself a power of two", () => {
    // 5 real codes -> segCount 6: floor(log2(6))=2, searchRange=2*4=8, entrySelector=2, rangeShift=12-8=4.
    const mappings = new Map(
      [10, 20, 30, 40, 50].map((code, i) => [code, i + 1]),
    );
    const table = buildCmapTable([
      { platformId: 0, encodingId: 3, format: 4, mappings },
    ]);
    const at = 4 + 8;
    expect(u16(table, at + 8)).toBe(8);
    expect(u16(table, at + 10)).toBe(2);
    expect(u16(table, at + 12)).toBe(4);
  });
});

describe("buildCmapTable / format 6", () => {
  it("derives firstCode/entryCount from the sorted codes even when inserted out of order, and keeps a nonzero firstCode", () => {
    const table = buildCmapTable([
      {
        platformId: 1,
        encodingId: 0,
        format: 6,
        mappings: new Map([
          [72, 7],
          [70, 5],
          [71, 6],
        ]),
      },
    ]);
    const at = 4 + 8;
    expect(u16(table, at)).toBe(6);
    const entryCount = 72 - 70 + 1;
    expect(u16(table, at + 2)).toBe(10 + entryCount * 2);
    expect(u16(table, at + 6)).toBe(70); // firstCode: must be the real nonzero code, not 0
    expect(u16(table, at + 8)).toBe(entryCount);
    expect(u16(table, at + 10 + (70 - 70) * 2)).toBe(5);
    expect(u16(table, at + 10 + (71 - 70) * 2)).toBe(6);
    expect(u16(table, at + 10 + (72 - 70) * 2)).toBe(7);
  });
});

describe("buildCmapTable / multiple subtables", () => {
  it("lays out three subtables of different formats back to back with correct platform/encoding/offset records", () => {
    const table = buildCmapTable([
      { platformId: 1, encodingId: 0, format: 0, mappings: new Map([[1, 1]]) },
      {
        platformId: 3,
        encodingId: 1,
        format: 4,
        mappings: new Map([[1, 1]]),
      },
      {
        platformId: 1,
        encodingId: 0,
        format: 6,
        mappings: new Map([[1, 1]]),
      },
    ]);
    expect(u16(table, 2)).toBe(3);
    const headerSize = 4 + 3 * 8;
    // record 0
    expect(u16(table, 4)).toBe(1);
    expect(u16(table, 6)).toBe(0);
    expect(u32(table, 8)).toBe(headerSize);
    // format 0 subtable is always exactly 262 bytes
    const format4At = headerSize + 262;
    expect(u32(table, 16)).toBe(format4At);
    // format 4 subtable with a single code has segCount 2, length 16+16=32
    const format6At = format4At + 32;
    expect(u32(table, 24)).toBe(format6At);
    expect(u16(table, format6At)).toBe(6);
  });
});

describe("buildPostV2Table / buildPostV3Table", () => {
  it("assigns sequential custom-name indices past the 258 standard names, not the same index twice", () => {
    const table = buildPostV2Table(["", "first", "second"]);
    expect(u32(table, 0)).toBe(0x00020000);
    const HEADER = 32;
    expect(u16(table, HEADER)).toBe(3);
    expect(u16(table, HEADER + 2 + 0 * 2)).toBe(0); // "" -> .notdef
    expect(u16(table, HEADER + 2 + 1 * 2)).toBe(258);
    expect(u16(table, HEADER + 2 + 2 * 2)).toBe(259);
  });

  it("writes the version-3.0 header with no name data", () => {
    const table = buildPostV3Table();
    expect(u32(table, 0)).toBe(0x00030000);
    expect(table.length).toBe(32);
  });
});

describe("buildCoverageFormat1", () => {
  it("sorts glyph IDs given out of order", () => {
    const table = buildCoverageFormat1([50, 5, 20]);
    expect(u16(table, 0)).toBe(1);
    expect(u16(table, 2)).toBe(3);
    expect(u16(table, 4)).toBe(5);
    expect(u16(table, 6)).toBe(20);
    expect(u16(table, 8)).toBe(50);
  });
});

describe("buildSingleSubstFormat2", () => {
  it("sorts mappings by covered glyph and places substitutes at the matching index", () => {
    const table = buildSingleSubstFormat2([
      [30, 300],
      [10, 100],
      [20, 200],
    ]);
    expect(u16(table, 0)).toBe(2);
    expect(u16(table, 4)).toBe(3);
    expect(u16(table, 6)).toBe(100);
    expect(u16(table, 8)).toBe(200);
    expect(u16(table, 10)).toBe(300);
  });
});

describe("buildLigatureSubstFormat1 (buildLigatureRecord)", () => {
  it("sorts ligature sets by first glyph and places each set's own multiple ligature records correctly", () => {
    const table = buildLigatureSubstFormat1([
      {
        firstGlyph: 20,
        ligatures: [{ ligatureGlyph: 99, components: [21] }],
      },
      {
        firstGlyph: 10,
        ligatures: [
          { ligatureGlyph: 50, components: [11, 12] },
          { ligatureGlyph: 51, components: [13] },
        ],
      },
    ]);
    expect(u16(table, 0)).toBe(1);
    expect(u16(table, 4)).toBe(2);
    // coverage (sorted): firstGlyph 10 is index 0, 20 is index 1
    const coverageAt = u16(table, 2);
    expect(u16(table, coverageAt + 4)).toBe(10);
    expect(u16(table, coverageAt + 6)).toBe(20);
    // ligSet for firstGlyph 10 comes first (sorted), holding two ligature records
    const ligSet0At = u16(table, 6);
    expect(u16(table, ligSet0At)).toBe(2);
    const rec0At = ligSet0At + u16(table, ligSet0At + 2);
    expect(u16(table, rec0At)).toBe(50); // ligatureGlyph
    expect(u16(table, rec0At + 2)).toBe(3); // componentCount = components.length + 1
    expect(u16(table, rec0At + 4)).toBe(11);
    expect(u16(table, rec0At + 6)).toBe(12);
    const rec1At = ligSet0At + u16(table, ligSet0At + 4);
    expect(u16(table, rec1At)).toBe(51);
    expect(u16(table, rec1At + 2)).toBe(2);
    expect(u16(table, rec1At + 4)).toBe(13);
  });
});

describe("buildRecords (via buildContextFormat1)", () => {
  it("places multiple SubstLookupRecords at their own 4-byte slots", () => {
    const subtable = buildContextFormat1(
      [5],
      [
        [
          {
            input: [6, 7],
            records: [
              { sequenceIndex: 0, lookupIndex: 1 },
              { sequenceIndex: 1, lookupIndex: 2 },
            ],
          },
        ],
      ],
    );
    // Rule set for the one first glyph starts right after the header + offset array + coverage.
    const ruleSetAt = u16(subtable, 6);
    const ruleAt = ruleSetAt + u16(subtable, ruleSetAt + 2);
    // input.length(2) + 1 glyphs written, then substCount, then records
    const inputLen = u16(subtable, ruleAt);
    const recordsAt = ruleAt + 2 + (inputLen - 1) * 2 + 2;
    expect(u16(subtable, recordsAt - 2)).toBe(2); // substCount
    expect(u16(subtable, recordsAt)).toBe(0);
    expect(u16(subtable, recordsAt + 2)).toBe(1);
    expect(u16(subtable, recordsAt + 4)).toBe(1);
    expect(u16(subtable, recordsAt + 6)).toBe(2);
  });
});

describe("buildContextFormat1 / buildContextFormat2 (plain SequenceRule)", () => {
  it("writes only glyphCount + input + substCount + records, with no backtrack/lookahead fields at all", () => {
    const subtable = buildContextFormat1(
      [1],
      [[{ input: [2, 3], records: [{ sequenceIndex: 0, lookupIndex: 0 }] }]],
    );
    const ruleSetAt = u16(subtable, 6);
    const ruleAt = ruleSetAt + u16(subtable, ruleSetAt + 2);
    expect(u16(subtable, ruleAt)).toBe(3); // glyphCount = input.length + 1
    expect(u16(subtable, ruleAt + 2)).toBe(2);
    expect(u16(subtable, ruleAt + 4)).toBe(3);
    expect(u16(subtable, ruleAt + 6)).toBe(1); // substCount
    // Total rule byte length is exactly glyphCount-field + 2 inputs + substCount-field + 1 record -- proving nothing extra (backtrack/lookahead) was written.
    expect(subtable.length - ruleAt).toBe(2 + 2 * 2 + 2 + 1 * 4);
  });

  it("buildContextFormat2 threads the class def offset and rule sets the same way", () => {
    const classDef = buildClassDefFormat1(0, [1, 2]);
    const subtable = buildContextFormat2([1], classDef, [
      [{ input: [4], records: [{ sequenceIndex: 0, lookupIndex: 0 }] }],
    ]);
    expect(u16(subtable, 0)).toBe(2);
    const classDefAt = u16(subtable, 4);
    expect(u16(subtable, classDefAt)).toBe(1);
  });
});

describe("buildChainContextFormat1 / buildChainContextFormat2 (chained SequenceRule)", () => {
  it("writes backtrack, input, lookahead and records in that order with correct counts", () => {
    const subtable = buildChainContextFormat1(
      [1],
      [
        [
          {
            backtrack: [10, 11],
            input: [2],
            lookahead: [20],
            records: [{ sequenceIndex: 0, lookupIndex: 5 }],
          },
        ],
      ],
    );
    const ruleSetAt = u16(subtable, 6);
    const ruleAt = ruleSetAt + u16(subtable, ruleSetAt + 2);
    expect(u16(subtable, ruleAt)).toBe(2); // backtrackGlyphCount
    expect(u16(subtable, ruleAt + 2)).toBe(10);
    expect(u16(subtable, ruleAt + 4)).toBe(11);
    const inputAt = ruleAt + 6;
    expect(u16(subtable, inputAt)).toBe(2); // inputGlyphCount = input.length + 1
    expect(u16(subtable, inputAt + 2)).toBe(2);
    const lookaheadAt = inputAt + 4;
    expect(u16(subtable, lookaheadAt)).toBe(1);
    expect(u16(subtable, lookaheadAt + 2)).toBe(20);
    const recordsAt = lookaheadAt + 4;
    expect(u16(subtable, recordsAt)).toBe(1);
    expect(u16(subtable, recordsAt + 2)).toBe(0);
    expect(u16(subtable, recordsAt + 4)).toBe(5);
  });

  it("buildChainContextFormat2 writes distinct backtrack/input/lookahead class-def offsets", () => {
    const classDefs = {
      backtrack: buildClassDefFormat1(0, [1]),
      input: buildClassDefFormat1(0, [2]),
      lookahead: buildClassDefFormat1(0, [3]),
    };
    const subtable = buildChainContextFormat2([1], classDefs, [
      [{ backtrack: [], input: [4], lookahead: [], records: [] }],
    ]);
    const backtrackAt = u16(subtable, 4);
    const inputAt = u16(subtable, 6);
    const lookaheadAt = u16(subtable, 8);
    expect(backtrackAt).not.toBe(inputAt);
    expect(inputAt).not.toBe(lookaheadAt);
    // Each class def's own single class value round-trips at its own offset.
    expect(u16(subtable, backtrackAt + 6)).toBe(1);
    expect(u16(subtable, inputAt + 6)).toBe(2);
    expect(u16(subtable, lookaheadAt + 6)).toBe(3);
  });
});

describe("buildFormat3Subtable", () => {
  it("sizes the chained header correctly with multiple backtrack and lookahead coverage entries", () => {
    const subtable = buildFormat3Subtable(true, {
      backtrack: [[1], [2]],
      input: [[3]],
      lookahead: [[4], [5]],
      records: [{ sequenceIndex: 0, lookupIndex: 0 }],
    });
    expect(u16(subtable, 0)).toBe(3);
    expect(u16(subtable, 2)).toBe(2); // backtrackGlyphCount
    expect(u16(subtable, 4)).toBe(24); // first backtrack coverage's own offset, not a reserved zero
    const inputCountAt = 2 + 2 + 2 * 2;
    expect(u16(subtable, inputCountAt)).toBe(1); // inputGlyphCount
    const lookaheadCountAt = inputCountAt + 2 + 1 * 2;
    expect(u16(subtable, lookaheadCountAt)).toBe(2); // lookaheadGlyphCount
    const substCountAt = lookaheadCountAt + 2 + 2 * 2;
    expect(u16(subtable, substCountAt)).toBe(1);
  });

  it("plain (non-chained) form carries only the input coverage array, no backtrack/lookahead counts", () => {
    const subtable = buildFormat3Subtable(false, {
      backtrack: [],
      input: [[1], [2]],
      lookahead: [],
      records: [],
    });
    expect(u16(subtable, 0)).toBe(3);
    expect(u16(subtable, 2)).toBe(2); // glyphCount (the plain form's own single count)
    const substCountAt = 2 + 2 + 2 * 2;
    expect(u16(subtable, substCountAt)).toBe(0);
    // total length is exactly the fixed plain-form header plus the two coverage blobs, proving no backtrack/lookahead bytes leaked in
    const coverage1 = buildCoverageFormat1([1]);
    const coverage2 = buildCoverageFormat1([2]);
    expect(subtable.length).toBe(
      substCountAt + 2 + coverage1.length + coverage2.length,
    );
  });
});

describe("buildGsubTable", () => {
  it("lists every feature's lookup index in the default LangSys in feature order", () => {
    const table = buildGsubTable(
      [
        { tag: "liga", lookupIndices: [0] },
        { tag: "calt", lookupIndices: [1] },
      ],
      [{ type: 4, subtables: [Uint8Array.from([1, 2])] }],
    );
    const scriptListAt = u16(table, 4);
    const scriptAt = scriptListAt + u16(table, scriptListAt + 6);
    const langSysAt = scriptAt + 4;
    expect(u16(table, langSysAt + 4)).toBe(2); // featureIndexCount
    expect(u16(table, langSysAt + 6)).toBe(0);
    expect(u16(table, langSysAt + 8)).toBe(1);
  });

  it("does not overlap two features' own tables when their lookupIndices lengths differ", () => {
    const table = buildGsubTable(
      [
        { tag: "liga", lookupIndices: [0, 1, 2] },
        { tag: "calt", lookupIndices: [3] },
      ],
      [],
    );
    const featureListAt = u16(table, 6);
    expect(tag(table, featureListAt + 2)).toBe("liga");
    expect(tag(table, featureListAt + 8)).toBe("calt");
    // The feature table offsets stored in the feature list are relative to the feature list's OWN start, not the outer table's.
    const feature0TableAt = featureListAt + u16(table, featureListAt + 2 + 4);
    const feature1TableAt = featureListAt + u16(table, featureListAt + 8 + 4);
    // feature 0's table is 4 + 3*2 = 10 bytes; feature 1's must start exactly after it.
    expect(feature1TableAt - feature0TableAt).toBe(10);
    expect(u16(table, feature1TableAt)).toBe(0);
    expect(u16(table, feature1TableAt + 2)).toBe(1);
    expect(u16(table, feature1TableAt + 4)).toBe(3);
  });

  it("writes every feature tag correctly, including a feature after the first", () => {
    const table = buildGsubTable(
      [
        { tag: "aaaa", lookupIndices: [] },
        { tag: "zzzz", lookupIndices: [] },
      ],
      [],
    );
    const featureListAt = u16(table, 6);
    expect(tag(table, featureListAt + 2)).toBe("aaaa");
    expect(tag(table, featureListAt + 8)).toBe("zzzz");
  });

  it("omits the markFilteringSet slot when the lookup has no flag at all", () => {
    const table = buildGsubTable(
      [],
      [{ type: 1, subtables: [Uint8Array.from([9, 9])] }],
    );
    const lookupListAt = u16(table, 8);
    const lookupAt = lookupListAt + u16(table, lookupListAt + 2);
    expect(u16(table, lookupAt)).toBe(1);
    expect(u16(table, lookupAt + 4)).toBe(1); // subtableCount
    const subtableOffset = u16(table, lookupAt + 6);
    // With no markFilteringSet slot, the one subtable starts right after the 6-byte header + one offset slot.
    expect(subtableOffset).toBe(8);
  });

  it("omits the markFilteringSet slot when the flag is set but does not select useMarkFilteringSet", () => {
    const table = buildGsubTable(
      [],
      [{ type: 1, flag: 0x0008, subtables: [Uint8Array.from([9, 9])] }],
    );
    const lookupListAt = u16(table, 8);
    const lookupAt = lookupListAt + u16(table, lookupListAt + 2);
    expect(u16(table, lookupAt + 2)).toBe(0x0008);
    const subtableOffset = u16(table, lookupAt + 6);
    expect(subtableOffset).toBe(8);
  });

  it("writes the markFilteringSet slot, at the right offset, only when the flag selects useMarkFilteringSet", () => {
    const table = buildGsubTable(
      [],
      [
        {
          type: 1,
          flag: 0x0010,
          markFilteringSet: 7,
          subtables: [Uint8Array.from([1]), Uint8Array.from([2])],
        },
      ],
    );
    const lookupListAt = u16(table, 8);
    const lookupAt = lookupListAt + u16(table, lookupListAt + 2);
    expect(u16(table, lookupAt + 4)).toBe(2); // subtableCount
    // header(6) + 2 offset slots(4) = 10, the markFilteringSet slot sits right there
    expect(u16(table, lookupAt + 10)).toBe(7);
    // both subtables then start right after that slot
    const firstSubtableOffset = u16(table, lookupAt + 6);
    expect(firstSubtableOffset).toBe(12);
    const secondSubtableOffset = u16(table, lookupAt + 8);
    expect(secondSubtableOffset).toBe(13);
  });

  it("lists multiple subtable offsets in a lookup correctly", () => {
    const table = buildGsubTable(
      [],
      [
        {
          type: 4,
          subtables: [Uint8Array.from([1, 1]), Uint8Array.from([2, 2, 2])],
        },
      ],
    );
    const lookupListAt = u16(table, 8);
    const lookupAt = lookupListAt + u16(table, lookupListAt + 2);
    const offset0 = u16(table, lookupAt + 6);
    const offset1 = u16(table, lookupAt + 8);
    expect(offset1 - offset0).toBe(2);
  });
});

describe("buildGdefTable", () => {
  it("uses the 12-byte version-1.0 header and offset 0 for an absent glyphClassDef, with no MarkGlyphSetsDef", () => {
    const classDef = buildClassDefFormat1(0, [1]);
    const table = buildGdefTable({ markAttachClassDef: classDef });
    expect(u16(table, 0)).toBe(1);
    expect(u16(table, 2)).toBe(0); // minor version 0: no MarkGlyphSetsDef
    expect(u16(table, 4)).toBe(0); // glyphClassDef offset absent
    expect(u16(table, 10)).not.toBe(0); // markAttachClassDef IS present
    expect(table.length).toBe(12 + classDef.length);
  });

  it("uses the 14-byte version-1.2 header and a real MarkGlyphSetsDef offset when markGlyphSets is given", () => {
    const set0 = buildCoverageFormat1([1]);
    const table = buildGdefTable({ markGlyphSets: [set0] });
    expect(u16(table, 2)).toBe(2); // minor version 2
    const setsOffset = u16(table, 12);
    expect(setsOffset).toBe(14); // right after the 14-byte header, nothing else present
    expect(u16(table, setsOffset)).toBe(1); // MarkGlyphSetsDef format
    expect(u16(table, setsOffset + 2)).toBe(1); // markGlyphSetCount
  });
});
