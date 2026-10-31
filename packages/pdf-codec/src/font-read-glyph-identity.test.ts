import { describe, expect, it } from "vitest";
import { readPdf } from "./read";
import {
  compositeFontProgramPdf,
  simpleFontDifferencesPdf,
} from "./test-support/pdf-font-programs";
import {
  buildCmapTable,
  buildPostV2Table,
  buildSfnt,
} from "./test-support/sfnt";
import {
  buildHeadTable,
  buildHheaTable,
  buildHmtxTable,
  buildMaxpTable,
  buildNameTable,
} from "./test-support/sfnt-tables";

// What a page reads as when nothing in the font dictionary maps its codes to text: no /ToUnicode CMap, so whatever comes out was recovered from the encoding and the embedded program, or is U+FFFD.

const REPLACEMENT = "�";

function pageText(pdf: Uint8Array<ArrayBuffer>): string {
  return (
    readPdf(pdf)
      .pages[0]?.items.flatMap((item) =>
        item.kind === "text" ? [item.text] : [],
      )
      .join("") ?? ""
  );
}

// Glyph ids and advance widths of the Arial face (ArialMT), on its 2048-unit grid: the face's own order numbers the space 3, the full stop 17, the digits 19 to 28, capital A 36 and the Greek capital omega 525. The widths are the face's own; they equal Helvetica's AFM widths (278, 556, 667) scaled to the grid and rounded, since Arial was drawn metric-compatible with Helvetica.
const ARIAL_UNITS_PER_EM = 2048;
const ARIAL_GLYPHS: readonly (readonly [number, string, number])[] = [
  [3, " ", 569],
  [17, ".", 569],
  ..."0123456789"
    .split("")
    .map((digit, index): readonly [number, string, number] => [
      19 + index,
      digit,
      1139,
    ]),
  [36, "A", 1366],
  [525, "Ω", 1531],
];
const ARIAL_GLYPH_IDS = ARIAL_GLYPHS.map(([glyphId]) => glyphId);
const ARIAL_TEXT = ARIAL_GLYPHS.map(([, text]) => text).join("");

// A TrueType program the way a subsetter that keeps the face's own glyph numbering but drops 'cmap' and 'post' leaves it: 'head', 'hhea', 'hmtx', 'maxp' and, unless `postScriptName` is undefined, 'name'. Every glyph not listed takes advance 0, as an emptied glyph does. 'hhea' declares `metricCount` full metrics (every glyph's, by default), and 'hmtx' holds the first `hmtxMetrics` of them (as many as 'hhea' declares, by default).
function namelessProgram(options: {
  readonly postScriptName: string | undefined;
  readonly unitsPerEm?: number;
  readonly advances?: ReadonlyMap<number, number>;
  readonly metricCount?: number;
  readonly hmtxMetrics?: number;
  readonly extraTables?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}): Uint8Array<ArrayBuffer> {
  const advanceOf = new Map(
    ARIAL_GLYPHS.map(([glyphId, , advance]) => [glyphId, advance]),
  );
  for (const [glyphId, advance] of options.advances ?? []) {
    advanceOf.set(glyphId, advance);
  }
  const glyphCount = Math.max(...advanceOf.keys()) + 1;
  const advances = Array.from(
    { length: glyphCount },
    (_, glyphId) => advanceOf.get(glyphId) ?? 0,
  );
  const tables = new Map<string, Uint8Array<ArrayBuffer>>([
    ["head", buildHeadTable(options.unitsPerEm ?? ARIAL_UNITS_PER_EM)],
    ["hhea", buildHheaTable(options.metricCount ?? glyphCount)],
    [
      "hmtx",
      buildHmtxTable(
        advances.slice(0, options.hmtxMetrics ?? options.metricCount),
      ),
    ],
    ["maxp", buildMaxpTable(glyphCount)],
    ...(options.extraTables ?? []),
  ]);
  if (options.postScriptName !== undefined) {
    tables.set(
      "name",
      buildNameTable([
        {
          platformId: 3,
          encodingId: 1,
          nameId: 6,
          text: options.postScriptName,
        },
      ]),
    );
  }
  return buildSfnt(tables);
}

describe("a composite font whose embedded TrueType program has neither 'cmap' nor 'post'", () => {
  it("reads each glyph through the glyph order of the core face the program names", () => {
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({ postScriptName: "ABCDEF+ArialMT" }),
      cids: ARIAL_GLYPH_IDS,
    });
    expect(pageText(pdf)).toBe(ARIAL_TEXT);
  });

  it("leaves unmapped a glyph whose advance width in the program is not the face's", () => {
    // Glyph 20 is the digit one in the face; a program drawing something else there, as a renumbered subset or another release would, gives itself away by its width.
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({
        postScriptName: "ABCDEF+ArialMT",
        advances: new Map([[20, 1000]]),
      }),
      cids: [19, 20, 21],
    });
    expect(pageText(pdf)).toBe(`0${REPLACEMENT}2`);
  });

  it("reads nothing through a face the program does not name, whatever the font dictionary calls it", () => {
    // The program's own 'name' table is what identifies it; a /BaseFont that disagrees cannot vouch for it.
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({ postScriptName: "ABCDEF+SomeOtherFace" }),
      cids: [19, 36],
    });
    expect(pageText(pdf)).toBe(REPLACEMENT.repeat(2));
  });

  it("identifies the face by /BaseFont when the program states no PostScript name of its own", () => {
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({ postScriptName: undefined }),
      cids: ARIAL_GLYPH_IDS,
    });
    expect(pageText(pdf)).toBe(ARIAL_TEXT);
  });

  it("reads nothing through the face's order for a program on another design grid", () => {
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({
        postScriptName: "ABCDEF+ArialMT",
        unitsPerEm: 1000,
      }),
      cids: [19, 36],
    });
    expect(pageText(pdf)).toBe(REPLACEMENT.repeat(2));
  });

  it("gives every glyph past the last full metric that metric's width, as 'hmtx' states", () => {
    // 'hhea' declares metrics for glyphs 0 to 19 only; the digits 1 to 9 share glyph 19's width, the face's own width for each of them.
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({
        postScriptName: "ABCDEF+ArialMT",
        metricCount: 20,
      }),
      cids: [19, 20, 28],
    });
    expect(pageText(pdf)).toBe("019");
  });

  it("reads nothing through the face's order for a program whose 'hmtx' is shorter than its 'hhea' says", () => {
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({
        postScriptName: "ABCDEF+ArialMT",
        hmtxMetrics: 10,
      }),
      cids: [3, 19],
    });
    expect(pageText(pdf)).toBe(REPLACEMENT.repeat(2));
  });

  it("takes what the program's own Unicode subtable says over the face's order", () => {
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+ArialMT",
      program: namelessProgram({
        postScriptName: "ABCDEF+ArialMT",
        extraTables: new Map([
          [
            "cmap",
            buildCmapTable([
              {
                platformId: 3,
                encodingId: 1,
                format: 4,
                mappings: new Map([[0x58, 36]]),
              },
            ]),
          ],
        ]),
      }),
      cids: [36, 19],
    });
    expect(pageText(pdf)).toBe("X0");
  });
});

describe("a composite font with a /CIDToGIDMap stream", () => {
  // A program whose Unicode subtable maps A to glyph 7 and B to glyph 9, reached from CIDs 1 and 2 only through the map.
  const program = buildSfnt(
    new Map([
      [
        "cmap",
        buildCmapTable([
          {
            platformId: 3,
            encodingId: 1,
            format: 4,
            mappings: new Map([
              [0x41, 7],
              [0x42, 9],
            ]),
          },
        ]),
      ],
    ]),
  );
  const cidToGidMap = Uint8Array.from([0, 0, 0, 7, 0, 9]);

  it("reads each CID through the glyph the map assigns it", () => {
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+Subset",
      program,
      cids: [1, 2],
      cidToGidMap,
    });
    expect(pageText(pdf)).toBe("AB");
  });

  it("leaves unmapped a CID past the end of the map rather than reading it as its own glyph index", () => {
    // CID 7 would read as A if the map were ignored and the CID taken as the glyph index.
    const pdf = compositeFontProgramPdf({
      baseFont: "ABCDEF+Subset",
      program,
      cids: [7, 1],
      cidToGidMap,
    });
    expect(pageText(pdf)).toBe(`${REPLACEMENT}A`);
  });
});

describe("a simple font whose /Differences names a glyph the Adobe Glyph List does not know", () => {
  // A subset whose 'post' table calls glyph 5 "g5" and whose Unicode subtable says glyph 5 draws the ohm sign.
  const program = buildSfnt(
    new Map([
      ["maxp", buildMaxpTable(6)],
      ["post", buildPostV2Table(["", "", "", "", "", "g5"])],
      [
        "cmap",
        buildCmapTable([
          {
            platformId: 3,
            encodingId: 1,
            format: 4,
            mappings: new Map([[0x2126, 5]]),
          },
        ]),
      ],
    ]),
  );

  it("reads the code through the program's own glyph of that name", () => {
    const pdf = simpleFontDifferencesPdf({
      differences: "65 /g5",
      codes: [65],
      program,
    });
    expect(pageText(pdf)).toBe("Ω");
  });

  it("leaves unmapped a code whose /Differences name nothing identifies, rather than reading the code through the base encoding it replaced", () => {
    // Read through WinAnsi, code 65 would come out as A: the glyph /Differences put there is named g9, which neither the list nor the program identifies.
    const pdf = simpleFontDifferencesPdf({
      differences: "65 /g9",
      codes: [65, 66],
      program,
    });
    expect(pageText(pdf)).toBe(`${REPLACEMENT}B`);
  });

  it("reads a ligature name through its components", () => {
    const pdf = simpleFontDifferencesPdf({
      differences: "65 /f_f_i 66 /uni0041030A",
      codes: [65, 66],
    });
    expect(pageText(pdf)).toBe("ffiÅ");
  });
});
