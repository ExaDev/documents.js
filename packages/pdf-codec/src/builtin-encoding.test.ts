import { describe, expect, it } from "vitest";
import type { BuiltinEncoding } from "./builtin-encoding";
import { readFontProgramEncoding } from "./builtin-encoding";
import { STIX_TWO_MATH_FONT_BASE64 } from "./assets/stix-two-math-font";
import {
  CFF_HEADER,
  CFF_STANDARD_STRING_COUNT,
  ROS_OPERANDS_AND_OPERATOR,
  cffFont,
  cffIndex,
  cffFontWithBuiltinEncoding,
  cffFontWithCharstrings,
  dictInt32,
} from "./test-support/cff";
import { caladeaRegularBytes, carlitoRegularBytes } from "./test-support/fonts";
import {
  buildCmapTable,
  buildPostV2Table,
  buildPostV3Table,
  buildSfnt,
} from "./test-support/sfnt";
import { base64ToBytes } from "byte-codec";

const OHM_SIGN = 0x2126; // the Adobe Glyph List's own mapping for the glyph name "Omega"

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

describe("readFontProgramEncoding: what it refuses to read", () => {
  it("returns undefined for bytes that are no font program at all", () => {
    expect(
      readFontProgramEncoding(textBytes("this is not a font")),
    ).toBeUndefined();
  });

  it("returns undefined for a CID-keyed CFF, whose charset holds CIDs rather than glyph names", () => {
    // Reading such a font's charset as though its numbers were name SIDs would name every glyph, and name them all wrongly — the same silent-wrong-answer failure this module exists to avoid.
    const program = cffFont("CIDKeyed", [...ROS_OPERANDS_AND_OPERATOR]);
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("returns undefined for a truncated CFF header", () => {
    expect(
      readFontProgramEncoding(Uint8Array.from(CFF_HEADER.slice(0, 2))),
    ).toBeUndefined();
  });

  it("leaves a code unmapped when the program's Unicode subtable only reaches it through the private-use area", () => {
    // A symbol subset commonly maps its glyphs from private-use code points and nowhere else. Reversing that yields U+F057, which identifies the glyph inside this one font and says nothing about what character it draws, so it is no answer rather than a wrong one.
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 3,
              encodingId: 1,
              format: 4,
              mappings: new Map([[0xf057, 3]]),
            },
          ]),
        ],
        ["post", buildPostV3Table()],
      ]),
    );
    expect(
      readFontProgramEncoding(program)?.codeToUnicode(0x57),
    ).toBeUndefined();
  });
});

describe("readFontProgramEncoding: TrueType programs", () => {
  it("reads a (1, 0) Macintosh subtable when the font carries no (3, 0) symbol one", () => {
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 1,
              encodingId: 0,
              format: 6,
              mappings: new Map([[0x57, 4]]),
            },
          ]),
        ],
        ["post", buildPostV2Table(["", "", "", "", "Omega"])],
      ]),
    );
    expect(readFontProgramEncoding(program)?.codeToUnicode(0x57)).toBe(
      OHM_SIGN,
    );
  });

  it("prefers the (3, 0) symbol subtable over a Unicode one covering the same code", () => {
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 3,
              encodingId: 0,
              format: 4,
              mappings: new Map([[0xf057, 4]]),
            },
            {
              platformId: 3,
              encodingId: 1,
              format: 4,
              mappings: new Map([[0x57, 9]]),
            },
          ]),
        ],
        [
          "post",
          buildPostV2Table(["", "", "", "", "Omega", "", "", "", "", "W"]),
        ],
      ]),
    );
    // 0x57 exists in both subtables, but only the symbol one states this font's own encoding: the Unicode subtable says which glyph draws a "W", not which glyph code 0x57 selects.
    expect(readFontProgramEncoding(program)?.codeToUnicode(0x57)).toBe(
      OHM_SIGN,
    );
  });

  it("names a glyph through the 'post' table of a real vendored font", () => {
    // Caladea ships a version 2.0 'post' table naming every glyph; glyph 5 is "A" and glyph 35 is "e" in its own glyph order, both read out of the .ttf independently of this package.
    const encoding = readFontProgramEncoding(caladeaRegularBytes());
    expect(encoding?.glyphIdToUnicode(5)).toBe(0x41);
    expect(encoding?.glyphIdToUnicode(35)).toBe(0x65);
  });

  it("identifies a glyph by reversing the Unicode subtable of a real font that strips its glyph names", () => {
    // Carlito ships a version 3.0 'post' table, so it names nothing; its (3, 1) subtable still maps U+00E9 to glyph 2007.
    const encoding = readFontProgramEncoding(carlitoRegularBytes());
    expect(encoding?.glyphIdToUnicode(2007)).toBe(0xe9);
  });
});

describe("readFontProgramEncoding: CFF programs", () => {
  it("names a glyph through the predefined ISOAdobe charset and predefined StandardEncoding when the font states neither operator", () => {
    // A raw (non-sfnt) CFF program with no Charset or Encoding operator at all: glyph 1's SID defaults to its own glyph ID (SID 1 is "space" in the standard strings), and predefinedEncodingApplies is true for a bare /FontFile3 Type1C, so StandardEncoding's own code 0x20 reaches it too.
    const program = cffFontWithCharstrings({
      name: "PredefinedCharsetAndEncoding",
      charStrings: [[14], [14]], // glyph 0 (.notdef) and glyph 1, both a bare endchar
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(0x20);
    expect(encoding?.codeToUnicode(0x20)).toBe(0x20);
  });

  it("names glyphs through a format 1 charset (ranges of consecutive SIDs)", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format1Charset",
      glyphNames: ["Omega", "mu", "A"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
        [0x41, 3],
      ]),
      charsetFormat: 1,
      charsetRangeSize: 2, // forces more than one range across 4 glyphs (.notdef + 3)
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5);
    expect(encoding?.codeToUnicode(0x41)).toBe(0x41);
  });

  it("names glyphs through a format 2 charset (16-bit range counts)", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format2Charset",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
      charsetFormat: 2,
      charsetRangeSize: 1, // one glyph per range, so the format 2 loop runs more than once
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5);
  });

  it("maps codes through a format 1 Encoding (ranges of consecutive codes)", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format1Encoding",
      glyphNames: ["A", "B", "C"],
      // Consecutive codes assigned to consecutive glyphs collapse into a single format 1 range.
      encoding: new Map([
        [0x41, 1],
        [0x42, 2],
        [0x43, 3],
      ]),
      encodingFormat: 1,
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x41)).toBe(0x41);
    expect(encoding?.codeToUnicode(0x42)).toBe(0x42);
    expect(encoding?.codeToUnicode(0x43)).toBe(0x43);
  });

  it("resolves a supplementary code through the Encoding's own supplement entries, addressed by SID rather than glyph index", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "EncodingSupplement",
      glyphNames: ["Omega"],
      encoding: new Map([[0x57, 1]]),
      // Glyph 1's own SID under the default format 0 charset is CFF_STANDARD_STRING_COUNT + 0 (its custom "Omega" string).
      encodingSupplement: [{ code: 0x1a, sid: CFF_STANDARD_STRING_COUNT }],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN); // the base format 0 mapping still works
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN); // reached only through the supplement
  });

  it("maps codes through a custom Encoding and names glyphs through the charset", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "SymbolSubset",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5); // MICRO SIGN, the AGL's mapping for "mu"
    expect(encoding?.codeToUnicode(0x41)).toBeUndefined(); // a code this font's own encoding does not cover
  });

  it("names glyphs through the charset of the real vendored CFF-flavoured font", () => {
    // STIX Two Math is an OpenType font with CFF outlines and a version 3.0 'post' table, so its glyph names exist only in the CFF charset: glyph 5 is "C" and glyph 35 is "uni1EA8", both read out of the .otf independently of this package. The second also exercises the Adobe Glyph List's own constructed "uniXXXX" name form.
    const encoding = readFontProgramEncoding(
      base64ToBytes(STIX_TWO_MATH_FONT_BASE64),
    );
    expect(encoding?.glyphIdToUnicode(5)).toBe(0x43);
    expect(encoding?.glyphIdToUnicode(35)).toBe(0x1ea8);
    // An sfnt-wrapped CFF states its encoding through the container's own 'cmap', never the CFF Encoding operator (predefinedEncodingApplies is false here) — so with no symbolic cmap subtable in this font, no code reaches any glyph at all, only glyph IDs do.
    expect(encoding?.codeToUnicode(0x43)).toBeUndefined();
  });
});

describe("readFontProgramEncoding: Type 1 programs", () => {
  it("reads the /Encoding array out of the cleartext header", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Symbols 001.000",
        "/Encoding 256 array",
        "dup 87 /Omega put",
        "dup 109 /mu put",
        "readonly def",
        "currentfile eexec",
        "binary charstrings follow, and hold no encoding",
      ].join("\n"),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5);
  });

  it("reads a program that names StandardEncoding rather than listing its own", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Plain 001.000",
        "/Encoding StandardEncoding def",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x41)).toBe(0x41);
    expect(encoding?.codeToUnicode(0xa9)).toBe(0x27); // quotesingle in StandardEncoding, where WinAnsi has the copyright sign
  });

  it("returns undefined for a PostScript program that states no encoding at all", () => {
    expect(
      readFontProgramEncoding(
        textBytes("%!PS-AdobeFont-1.0: Nameless\ncurrentfile eexec\n"),
      ),
    ).toBeUndefined();
  });

  it("reads a PFB-segmented Type 1 program, whose cleartext header follows a 6-byte binary segment marker", () => {
    const cleartext = [
      "%!PS-AdobeFont-1.0: PFB 001.000",
      "/Encoding 256 array",
      "dup 87 /Omega put",
      "readonly def",
      "currentfile eexec",
      "",
    ].join("\n");
    const body = new TextEncoder().encode(cleartext);
    const segmentHeader = [0x80, 1, 0, 0, 0, 0]; // marker + a segment-type/length header this module never reads
    const program = new Uint8Array([...segmentHeader, ...body]);
    expect(readFontProgramEncoding(program)?.codeToUnicode(0x57)).toBe(
      OHM_SIGN,
    );
  });

  it("reads the /Encoding array out of a program with no eexec marker at all, using the whole file as the cleartext header", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: NoEexec 001.000",
        "/Encoding 256 array",
        "dup 87 /Omega put",
        "readonly def",
      ].join("\n"),
    );
    expect(readFontProgramEncoding(program)?.codeToUnicode(0x57)).toBe(
      OHM_SIGN,
    );
  });
});

// A CFF program assembled from explicit parts rather than the opinionated
// cffFontWithBuiltinEncoding layout, for the malformed and overlapping shapes no real toolchain
// emits. The charset sits LAST, after the encoding and charstrings, so a fixture can truncate
// inside it and still leave a fully readable font behind; the header may be any length, letting
// its padding bytes host a charset.
function rawCffFont(parts: {
  readonly header: readonly number[];
  readonly glyphNames: readonly string[];
  readonly charset: readonly number[];
  readonly encoding: readonly number[];
  readonly charstrings: readonly (readonly number[])[];
  readonly truncateAfterCharsetBytes?: number;
}): Uint8Array<ArrayBuffer> {
  const nameIndex = cffIndex([[...new TextEncoder().encode("Fixture")]]);
  const stringIndex = cffIndex(
    parts.glyphNames.map((name) => [...new TextEncoder().encode(name)]),
  );
  const topDictEntry = 3 * (dictInt32(0).length + 1); // charset, Encoding, CharStrings
  const topDictIndexSize = cffIndex([
    new Array<number>(topDictEntry).fill(0),
  ]).length;
  const prefix =
    parts.header.length +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length;

  const charstringsOffset = prefix + parts.encoding.length;
  const charsetOffset = charstringsOffset + cffIndex(parts.charstrings).length;
  const topDict = [
    ...dictInt32(charsetOffset),
    15,
    ...dictInt32(prefix),
    16,
    ...dictInt32(charstringsOffset),
    17,
  ];
  const bytes = [
    ...parts.header,
    ...nameIndex,
    ...cffIndex([topDict]),
    ...stringIndex,
    ...parts.encoding,
    ...cffIndex(parts.charstrings),
    ...parts.charset,
  ];
  const cut =
    parts.truncateAfterCharsetBytes === undefined
      ? undefined
      : charsetOffset + parts.truncateAfterCharsetBytes;
  return new Uint8Array(cut === undefined ? bytes : bytes.slice(0, cut));
}

function charsetFormat0(sids: readonly number[]): number[] {
  return [0, ...sids.flatMap((sid) => [(sid >> 8) & 0xff, sid & 0xff])];
}

describe("readFontProgramEncoding: private-use boundaries", () => {
  // One format 12 subtable mapping ten glyphs, one from each private-use boundary and one from
  // just outside it, over a nameless 'post' table: every answer goes through the inverted
  // Unicode subtable, which is exactly where isPrivateUse decides. The fixture is built inside
  // each test rather than shared, because the inversion is memoised on first use — a shared
  // fixture would attribute the isPrivateUse calls wholly to whichever test happened to run
  // first, leaving the others unable to witness a mutation that changed what got inverted.
  function boundaryEncoding(): BuiltinEncoding | undefined {
    return readFontProgramEncoding(
      buildSfnt(
        new Map([
          [
            "cmap",
            buildCmapTable([
              {
                platformId: 3,
                encodingId: 10,
                format: 12,
                mappings: new Map<number, number>([
                  [0xdfff, 1],
                  [0xe000, 2],
                  [0xf8ff, 3],
                  [0xf900, 4],
                  [0xeffff, 5],
                  [0xf0000, 6],
                  [0xffffd, 7],
                  [0x100000, 8],
                  [0x10fffd, 9],
                  [0x10fffe, 10],
                ]),
              },
            ]),
          ],
          ["post", buildPostV3Table()],
        ]),
      ),
    );
  }

  it("resolves a glyph mapped from just below each private-use range", () => {
    const encoding = boundaryEncoding();
    expect(encoding?.glyphIdToUnicode(1)).toBe(0xdfff);
    expect(encoding?.glyphIdToUnicode(4)).toBe(0xf900);
    expect(encoding?.glyphIdToUnicode(5)).toBe(0xeffff);
    expect(encoding?.glyphIdToUnicode(10)).toBe(0x10fffe);
  });

  it("leaves a glyph unmapped when it is reachable only from inside a private-use range, at either edge", () => {
    const encoding = boundaryEncoding();
    for (const glyphId of [2, 3, 6, 7, 8, 9]) {
      expect(encoding?.glyphIdToUnicode(glyphId)).toBeUndefined();
    }
  });
});

describe("readFontProgramEncoding: which sources a program states", () => {
  it("returns undefined outright for a TrueType program that states nothing at all", () => {
    // No cmap, and a version 3 'post' table that names nothing: every source is undefined.
    const program = buildSfnt(new Map([["post", buildPostV3Table()]]));
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("returns an encoding object for a program whose only source is a symbol cmap", () => {
    // A (3, 0) subtable with no 'post' names and no Unicode subtable: the object exists (the
    // font does state an encoding) even though no glyph can be named.
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 3,
              encodingId: 0,
              format: 4,
              mappings: new Map([[0xf057, 4]]),
            },
          ]),
        ],
        ["post", buildPostV3Table()],
      ]),
    );
    expect(readFontProgramEncoding(program)).toBeDefined();
  });

  it("returns an encoding object for a program whose only source is its glyph names", () => {
    const program = buildSfnt(
      new Map([["post", buildPostV2Table(["", "", "", "", "Omega"])]]),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding).toBeDefined();
    expect(encoding?.glyphIdToUnicode(4)).toBe(OHM_SIGN);
  });

  it("returns an encoding object for a program whose only source is a Unicode subtable", () => {
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 3,
              encodingId: 1,
              format: 4,
              mappings: new Map([[0xe9, 2]]),
            },
          ]),
        ],
        ["post", buildPostV3Table()],
      ]),
    );
    expect(readFontProgramEncoding(program)?.glyphIdToUnicode(2)).toBe(0xe9);
  });
});

describe("readFontProgramEncoding: cmap subtable selection", () => {
  function withCmap(
    subtables: readonly {
      readonly platformId: number;
      readonly encodingId: number;
      readonly mappings: Map<number, number>;
    }[],
    glyphNames: readonly string[],
  ): BuiltinEncoding | undefined {
    return readFontProgramEncoding(
      buildSfnt(
        new Map([
          [
            "cmap",
            buildCmapTable(
              subtables.map((subtable) => ({
                ...subtable,
                format: 4 as const,
              })),
            ),
          ],
          ["post", buildPostV2Table(glyphNames)],
        ]),
      ),
    );
  }

  it("prefers the (3, 0) symbol subtable over a (1, 0) one, whichever comes first", () => {
    // Order (1, 0) then (3, 0): the (1, 0) subtable would map code 0x57 at glyph 9 ("W"), the
    // (3, 0) one at 0xF057 is the symbol encoding that must win.
    const encoding = withCmap(
      [
        { platformId: 1, encodingId: 0, mappings: new Map([[0x57, 9]]) },
        { platformId: 3, encodingId: 0, mappings: new Map([[0xf057, 4]]) },
      ],
      ["", "", "", "", "Omega", "", "", "", "", "W"],
    );
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
  });

  it("does not mistake a (1, non-zero) Macintosh subtable for the (1, 0) symbol fallback", () => {
    const encoding = withCmap(
      [
        { platformId: 1, encodingId: 1, mappings: new Map([[0x57, 9]]) },
        { platformId: 1, encodingId: 0, mappings: new Map([[0x57, 4]]) },
      ],
      ["", "", "", "", "Omega", "", "", "", "", "W"],
    );
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
  });

  it("prefers the UCS-4 (3, 10) subtable over the (3, 1) BMP one, whichever comes first", () => {
    const encoding = readFontProgramEncoding(
      buildSfnt(
        new Map([
          [
            "cmap",
            buildCmapTable([
              {
                platformId: 3,
                encodingId: 1,
                format: 4,
                mappings: new Map([[0xe9, 1]]),
              },
              {
                platformId: 3,
                encodingId: 10,
                format: 12,
                mappings: new Map([[0xe9, 2]]),
              },
            ]),
          ],
          ["post", buildPostV3Table()],
        ]),
      ),
    );
    expect(encoding?.glyphIdToUnicode(2)).toBe(0xe9);
    expect(encoding?.glyphIdToUnicode(1)).toBeUndefined();
  });

  it("falls back to the (3, 1) subtable before the platform-0 one, whichever comes first", () => {
    const encoding = readFontProgramEncoding(
      buildSfnt(
        new Map([
          [
            "cmap",
            buildCmapTable([
              {
                platformId: 0,
                encodingId: 3,
                format: 4,
                mappings: new Map([[0xe9, 2]]),
              },
              {
                platformId: 3,
                encodingId: 1,
                format: 4,
                mappings: new Map([[0xe9, 1]]),
              },
            ]),
          ],
          ["post", buildPostV3Table()],
        ]),
      ),
    );
    expect(encoding?.glyphIdToUnicode(1)).toBe(0xe9);
  });

  it("uses the platform-0 subtable when it is the only Unicode one", () => {
    const encoding = readFontProgramEncoding(
      buildSfnt(
        new Map([
          [
            "cmap",
            buildCmapTable([
              {
                platformId: 0,
                encodingId: 4,
                format: 4,
                mappings: new Map([[0x2126, 1]]),
              },
            ]),
          ],
          ["post", buildPostV3Table()],
        ]),
      ),
    );
    expect(encoding?.glyphIdToUnicode(1)).toBe(0x2126);
  });

  it("reads a font with no symbol subtable through the private-use range of its Unicode subtable", () => {
    // Some producers encode their symbol font as plain private-use code points in a (3, 1)
    // subtable rather than writing a (3, 0) one; code 0x41 still reaches the glyph at 0xF041.
    const encoding = withCmap(
      [{ platformId: 3, encodingId: 1, mappings: new Map([[0xf041, 4]]) }],
      ["", "", "", "", "Omega"],
    );
    expect(encoding?.codeToUnicode(0x41)).toBe(OHM_SIGN);
  });
});

describe("readFontProgramEncoding: CFF charset and encoding bounds", () => {
  it("reads no SID past the charstrings count under the predefined ISOAdobe charset", () => {
    // Two charstrings make glyphCount 2: glyph 1 is SID 1 (space), and there is no glyph 2.
    const program = cffFontWithCharstrings({
      name: "IsoAdobeBound",
      charStrings: [[14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(0x20);
    expect(encoding?.glyphIdToUnicode(2)).toBeUndefined();
  });

  it("reads no SID past the charstrings count under a format 0 charset", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format0Bound",
      glyphNames: ["Omega", "mu", "A"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
        [0x41, 3],
      ]),
    });
    // glyphCount is 4 (.notdef + 3); a fourth SID read would come from the Encoding's own bytes.
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(4),
    ).toBeUndefined();
  });

  it("keeps the glyphs a truncated format 0 charset did name, and names no glyph past the cut", () => {
    // Charstrings placed before the charset, which is then cut after one SID: the parser hands
    // back the partial map rather than throwing or reading past the end of the program.
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu", "A"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
        CFF_STANDARD_STRING_COUNT + 2,
      ]),
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14], [14]],
      truncateAfterCharsetBytes: 3, // format byte + exactly one SID
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
    expect(encoding?.glyphIdToUnicode(3)).toBeUndefined();
  });

  it("reads a charset that lives in the header's own padding, at exactly the minimum offset", () => {
    // hdrSize 8 leaves bytes 4..7 unused by the fixed four-byte header, and a font may legally
    // point its charset operator into them: offset 4 is the smallest offset the guard permits.
    const program = rawCffFont({
      header: [1, 0, 8, 1, 0, 0, 5, 0], // bytes 4..6 are a format 0 charset naming glyph 1 as SID 5
      glyphNames: ["dollar"],
      charset: [5], // consumed from the header padding, not from here (the operator points at 4)
      encoding: [0, 0],
      charstrings: [[14], [14]],
    });
    // Patch the charset operand to 4: the raw layout placed it after the indexes.
    const patched = patchCharsetOffset(program, 4);
    expect(readFontProgramEncoding(patched)?.glyphIdToUnicode(1)).toBe(0x24);
  });

  it("refuses a charset operator pointing into the header itself, before any table", () => {
    // Offset 1 would read SIDs out of the header's own version and size bytes.
    const program = cffFontWithBuiltinEncoding({
      name: "CharsetInHeader",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
    });
    const patched = patchCharsetOffset(program, 1);
    const encoding = readFontProgramEncoding(patched);
    // No glyph is named (the guard rejects the offset), and nothing crashes.
    expect(encoding?.glyphIdToUnicode(1)).toBeUndefined();
    expect(encoding?.glyphIdToUnicode(2)).toBeUndefined();
  });

  it("names no glyph past the count under a format 1 charset, however the ranges split", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format1Bound",
      glyphNames: ["Omega", "mu", "A"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
        [0x41, 3],
      ]),
      charsetFormat: 1,
      charsetRangeSize: 2,
    });
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(4),
    ).toBeUndefined();
  });

  it("names no glyph past the count under a format 2 charset", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format2Bound",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
      charsetFormat: 2,
      charsetRangeSize: 1,
    });
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(3),
    ).toBeUndefined();
  });

  it("keeps the glyphs a truncated format 2 charset did name", () => {
    // Cut inside the second range's 16-bit nLeft: the guard hands back a partial map instead of
    // reading the missing byte pair.
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu", "A"],
      charset: [
        2,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
        0,
        0, // first range covers glyph 1 only
        ...sidPair(CFF_STANDARD_STRING_COUNT + 2),
        0,
        1, // second range covers glyphs 2 and 3
      ],
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14], [14]],
      truncateAfterCharsetBytes: 6, // format byte + first range (2+2) + the second range's SID pair only
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
  });

  it("drops Encoding codes past the charstrings count rather than mapping them onto phantom glyphs", () => {
    // Format 0 Encoding listing three codes for a font with only two glyphs.
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5);
    expect(encoding?.codeToUnicode(0x41)).toBeUndefined();
  });

  it("reads every range of a multi-range format 1 Encoding", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "TwoRangeEncoding",
      glyphNames: ["A", "B", "C", "a", "b"],
      encoding: new Map([
        [0x41, 1],
        [0x42, 2],
        [0x43, 3],
        [0x61, 4],
        [0x62, 5],
      ]),
      encodingFormat: 1,
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x41)).toBe(0x41);
    expect(encoding?.codeToUnicode(0x43)).toBe(0x43);
    expect(encoding?.codeToUnicode(0x61)).toBe(0x61);
    expect(encoding?.codeToUnicode(0x62)).toBe(0x62);
  });

  it("keeps only the glyphs a truncated format 1 Encoding did map", () => {
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu", "A"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
        CFF_STANDARD_STRING_COUNT + 2,
      ]),
      encoding: [1, 2, 0x57, 1, 0x6d, 0], // two ranges, then a cut before the second's data
      charstrings: [[14], [14], [14], [14]],
    });
    const truncated = new Uint8Array(program.slice(0, program.length - 2));
    const encoding = readFontProgramEncoding(truncated);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
  });

  it("refuses an Encoding in a format this reader does not know, while the charset still names glyphs", () => {
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [3, 0], // no format 3 exists in CFF 1.0
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBeUndefined();
  });

  it("reads several supplementary codes, and keeps the base mapping of a code whose supplement names no known SID", () => {
    // Two supplements resolve through the charset; a third names a SID no glyph carries, and its
    // code collides with a base format 0 mapping that must survive the ignored supplement.
    const program = cffFontWithBuiltinEncoding({
      name: "TwoSupplements",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
      encodingSupplement: [
        { code: 0x1a, sid: CFF_STANDARD_STRING_COUNT },
        { code: 0x1b, sid: CFF_STANDARD_STRING_COUNT + 1 },
        { code: 0x57, sid: 9999 }, // no glyph in this font carries SID 9999
      ],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1b)).toBe(0xb5);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
  });

  it("keeps the mappings a truncated supplement list did carry", () => {
    // The encoding (format 0 with a supplement list naming both glyphs) sits at the very end of
    // the program, cut inside the second supplement's three bytes: the first must survive, the
    // second must simply be absent, and nothing may throw.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [
        0x80,
        1,
        0x57,
        1,
        0x1a,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
        0x1b,
        ...sidPair(CFF_STANDARD_STRING_COUNT + 1),
      ],
      charstrings: [[14], [14], [14]],
      cutBytesFromEnd: 1,
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1b)).toBeUndefined();
  });
});

// Patches the charset operator's 32-bit operand (the first [29 b3 b2 b1 b0, 15] pair in the Top
// DICT INDEX) to `offset`, for fixtures that need a charset pointing somewhere no toolchain puts it.

// The charset-last layout's mirror, for truncation inside the ENCODING instead: charstrings and
// charset first, encoding last, optionally cut short by a whole number of trailing bytes.
function rawCffFontEndingInEncoding(parts: {
  readonly glyphNames: readonly string[];
  readonly charset: readonly number[];
  readonly encoding: readonly number[];
  readonly charstrings: readonly (readonly number[])[];
  readonly cutBytesFromEnd?: number;
}): Uint8Array<ArrayBuffer> {
  const nameIndex = cffIndex([[...new TextEncoder().encode("Fixture")]]);
  const stringIndex = cffIndex(
    parts.glyphNames.map((name) => [...new TextEncoder().encode(name)]),
  );
  const topDictEntry = 3 * (dictInt32(0).length + 1);
  const topDictIndexSize = cffIndex([
    new Array<number>(topDictEntry).fill(0),
  ]).length;
  const prefix =
    CFF_HEADER.length +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length;

  const charsetOffset = prefix + cffIndex(parts.charstrings).length;
  const encodingOffset = charsetOffset + parts.charset.length;
  const topDict = [
    ...dictInt32(charsetOffset),
    15,
    ...dictInt32(encodingOffset),
    16,
    ...dictInt32(prefix),
    17,
  ];
  const bytes = [
    ...CFF_HEADER,
    ...nameIndex,
    ...cffIndex([topDict]),
    ...stringIndex,
    ...cffIndex(parts.charstrings),
    ...parts.charset,
    ...parts.encoding,
  ];
  return new Uint8Array(
    parts.cutBytesFromEnd === undefined
      ? bytes
      : bytes.slice(0, bytes.length - parts.cutBytesFromEnd),
  );
}

function patchCharsetOffset(
  program: Uint8Array<ArrayBuffer>,
  offset: number,
): Uint8Array<ArrayBuffer> {
  const patched = new Uint8Array(program);
  for (let i = 0; i + 5 < patched.length; i++) {
    if (patched[i] === 29 && patched[i + 5] === 15) {
      patched[i + 1] = (offset >>> 24) & 0xff;
      patched[i + 2] = (offset >>> 16) & 0xff;
      patched[i + 3] = (offset >>> 8) & 0xff;
      patched[i + 4] = offset & 0xff;
      return patched;
    }
  }
  throw new Error("no charset operator found in the fixture's Top DICT");
}

function sidPair(sid: number): number[] {
  return [(sid >> 8) & 0xff, sid & 0xff];
}

describe("readFontProgramEncoding: Type 1 header scanning", () => {
  it("refuses a program that does not open with the PostScript magic, however encodeable its body", () => {
    const program = textBytes(
      [
        "not-postscript-at-all",
        "/Encoding 256 array",
        "dup 87 /Omega put",
        "def",
      ].join("\n"),
    );
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("refuses a PostScript program whose header names no /Encoding at all", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Unencoded 001.000",
        "dup 87 /Omega put",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("refuses a header that names /Encoding but lists no assignments", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: EmptyArray 001.000",
        "/Encoding 256 array",
        "readonly def",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("stops the cleartext at an eexec embedded inside a glyph name, dropping anything after it", () => {
    // The terminator scan is a plain substring match, so "freexecx" ends the cleartext header:
    // the assignment before it survives and the one after the real eexec must never be read.
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Tricky 001.000",
        "/Encoding 256 array",
        "dup 87 /freexecx put",
        "currentfile eexec",
        "dup 88 /W put",
      ].join("\n"),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x58)).toBeUndefined();
  });

  it("matches the StandardEncoding spelling across repeated whitespace", () => {
    // The regex's own \\s+ spans any run of blanks between the three tokens.
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Spaced 001.000",
        "/Encoding  StandardEncoding  def",
        "currentfile eexec",
        "",
      ].join("\\n"),
    );
    expect(readFontProgramEncoding(program)?.codeToUnicode(0x41)).toBe(0x41);
  });

  it("matches dup assignments across repeated whitespace in each position", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Gaps 001.000",
        "/Encoding 256 array",
        "dup  87  /Omega  put",
        "dup\t109 /mu put",
        "readonly def",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5);
  });
});

describe("readFontProgramEncoding: CFF-flavoured OpenType programs", () => {
  it("names glyphs through the CFF charset of an sfnt-wrapped font whose cmap names nothing", () => {
    // A 'CFF ' table (carrying a charset and a custom Encoding over custom strings) inside an
    // sfnt with no cmap at all and a nameless version 3 'post': every name AND every code
    // mapping come from the CFF alone, because the container states nothing itself.
    const program = buildSfnt(
      new Map([
        [
          "CFF ",
          cffFontWithBuiltinEncoding({
            name: "WrappedCff",
            glyphNames: ["Omega", "mu"],
            encoding: new Map([
              [0x57, 1],
              [0x6d, 2],
            ]),
          }),
        ],
        ["post", buildPostV3Table()],
      ]),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.glyphIdToUnicode(2)).toBe(0xb5);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
  });

  it("applies no predefined StandardEncoding to an sfnt-wrapped CFF that states no Encoding operator", () => {
    // The same font shape with no custom Encoding at all: the charset still names glyphs, and a
    // code maps to nothing because predefined encodings belong to bare Type1C programs only.
    const program = buildSfnt(
      new Map([
        [
          "CFF ",
          cffFontWithCharstrings({
            name: "WrappedPredefined",
            charStrings: [[14], [14]],
          }),
        ],
        ["post", buildPostV3Table()],
      ]),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(0x20);
    expect(encoding?.codeToUnicode(0x20)).toBeUndefined();
  });
});

describe("readFontProgramEncoding: charset SIDs shared by several glyphs", () => {
  it("addresses a duplicated SID through the first glyph that carries it", () => {
    // A supplement resolves its SID through the charset's own glyph list; when two glyphs carry
    // the same SID, the first one encountered is the one the mapping must reach.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT,
      ]),
      encoding: [
        0x80, // format 0 with the supplement flag
        1, // one base code
        0x57,
        1, // one supplement entry
        0x1a,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
      ],
      charstrings: [[14], [14], [14]],
    });
    // Code 0x57 comes from the base format 0 list (glyph 1); code 0x1a from the supplement,
    // which must also resolve to glyph 1, not to glyph 2 sharing its SID.
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
  });
});

describe("readFontProgramEncoding: CFF range and header edge shapes", () => {
  it("reads a format 1 charset whose ranges carry non-consecutive SIDs", () => {
    // Glyph 1 is SID 391 ("Omega") and glyph 2 is SID 500, beyond this font's custom strings: a
    // range decoder that misreads nLeft's width would run glyph 2 off the end of range 1 instead.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: [1, ...sidPair(CFF_STANDARD_STRING_COUNT), 0, ...sidPair(500)],
      encoding: [0, 2, 0x57, 0x6d],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
  });

  it("names no glyph past the count under a non-contiguous format 1 charset", () => {
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu", "A"],
      charset: [
        1,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
        0,
        ...sidPair(CFF_STANDARD_STRING_COUNT + 2),
        0,
      ],
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14], [14]],
    });
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(4),
    ).toBeUndefined();
  });

  it("refuses an Encoding format byte of 3 even when the bytes after it would parse as ranges", () => {
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [3, 1, 0x57, 0], // format 3 does not exist; the tail is not ranges
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBeUndefined();
  });

  it("reads exactly the declared number of format 1 Encoding ranges, ignoring trailing bytes", () => {
    // Two ranges, then two more bytes that a decoder running one range too far would consume as
    // a third and use to overwrite code 0x57's real mapping.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [1, 2, 0x41, 0, 0x57, 0, 0x57, 0],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x41)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBe(0xb5);
  });

  it("reads no supplements from an Encoding whose format byte carries no supplement flag", () => {
    // The bytes after the one-code list look exactly like a supplement entry; without the flag
    // they are padding, and code 0x1a must stay unmapped.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [0, 1, 0x57, 1, 0x1a, ...sidPair(CFF_STANDARD_STRING_COUNT)],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1a)).toBeUndefined();
  });

  it("reads exactly the declared number of supplements, ignoring trailing bytes", () => {
    // One supplement, then three more bytes that a decoder running one supplement too far would
    // consume and use to overwrite code 0x1a's real mapping with an unnamed glyph.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [
        0x80,
        1,
        0x57,
        1,
        0x1a,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
        0x1a,
        ...sidPair(CFF_STANDARD_STRING_COUNT + 1),
      ],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
  });

  it("reads an Encoding that lives in the header's own padding, at exactly the minimum offset", () => {
    // hdrSize 8 leaves bytes 4..7 free, and a format 0 Encoding of one code fits in three of
    // them: offset 4 is the smallest the guard permits.
    const program = rawCffFont({
      header: [1, 0, 8, 1, 0, 1, 0x57, 0],
      glyphNames: ["Omega"],
      charset: charsetFormat0([CFF_STANDARD_STRING_COUNT]),
      encoding: [0, 0],
      charstrings: [[14], [14]],
    });
    const patched = patchEncodingOffset(program, 4);
    expect(readFontProgramEncoding(patched)?.codeToUnicode(0x57)).toBe(
      OHM_SIGN,
    );
  });

  it("refuses an Encoding operator pointing past the end of the program without throwing", () => {
    // The Encoding offset sits exactly at EOF: no mapping is read, the charset still names
    // glyphs, and the out-of-range read the guard prevents would have thrown.
    const whole = rawCffFontEndingInEncoding({
      glyphNames: ["Omega"],
      charset: charsetFormat0([CFF_STANDARD_STRING_COUNT]),
      encoding: [0, 1, 0x57],
      charstrings: [[14], [14]],
    });
    const cut = new Uint8Array(whole.slice(0, whole.length - 3));
    const patched = patchEncodingOffset(cut, cut.length);
    const encoding = readFontProgramEncoding(patched);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBeUndefined();
  });

  it("refuses a CFF whose major version is not 1", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Major2",
      glyphNames: ["Omega"],
      encoding: new Map([[0x57, 1]]),
    });
    const patched = new Uint8Array(program);
    patched[0] = 2;
    expect(readFontProgramEncoding(patched)).toBeUndefined();
  });

  it("refuses a CFF whose hdrSize undercuts the fixed header itself", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "TinyHeader",
      glyphNames: ["Omega"],
      encoding: new Map([[0x57, 1]]),
    });
    const patched = new Uint8Array(program);
    patched[2] = 3;
    expect(readFontProgramEncoding(patched)).toBeUndefined();
  });
});

// Patches the Encoding operator's 32-bit operand (the second [29 b3 b2 b1 b0, 16] pair in the
// Top DICT INDEX) to `offset`.
function patchEncodingOffset(
  program: Uint8Array<ArrayBuffer>,
  offset: number,
): Uint8Array<ArrayBuffer> {
  const patched = new Uint8Array(program);
  let seen = 0;
  for (let i = 0; i + 5 < patched.length; i++) {
    if (patched[i] === 29 && patched[i + 5] === 15) {
      seen += 1; // the charset operator comes first
      continue;
    }
    if (patched[i] === 29 && patched[i + 5] === 16 && seen === 1) {
      patched[i + 1] = (offset >>> 24) & 0xff;
      patched[i + 2] = (offset >>> 16) & 0xff;
      patched[i + 3] = (offset >>> 8) & 0xff;
      patched[i + 4] = offset & 0xff;
      return patched;
    }
  }
  throw new Error("no Encoding operator found in the fixture's Top DICT");
}
