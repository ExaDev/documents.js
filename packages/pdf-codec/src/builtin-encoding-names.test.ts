import { describe, expect, it } from "vitest";
import {
  readFontProgramEncoding,
  readFontProgramName,
} from "./builtin-encoding";
import { cffFont, cffFontWithBuiltinEncoding } from "./test-support/cff";
import { buildPostV2Table, buildSfnt } from "./test-support/sfnt";
import { buildMaxpTable, buildNameTable } from "./test-support/sfnt-tables";

// glyphIdOfName: the glyph a program itself gives a name, the route a /Differences name the Adobe Glyph List does not know takes into the program.

describe("readFontProgramEncoding: glyphIdOfName", () => {
  it("finds a glyph by its 'post' table name", () => {
    const program = buildSfnt(
      new Map([
        ["maxp", buildMaxpTable(4)],
        ["post", buildPostV2Table(["", "", "g2", "g3"])],
      ]),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdOfName("g3")).toBe(3);
    expect(encoding?.glyphIdOfName("g2")).toBe(2);
  });

  it("finds the lowest glyph a 'post' table gives a repeated name", () => {
    const program = buildSfnt(
      new Map([
        ["maxp", buildMaxpTable(4)],
        ["post", buildPostV2Table(["", "dup", "", "dup"])],
      ]),
    );
    expect(readFontProgramEncoding(program)?.glyphIdOfName("dup")).toBe(1);
  });

  it("finds no glyph past the glyph count 'maxp' states, whatever 'post' names there", () => {
    const program = buildSfnt(
      new Map([
        ["maxp", buildMaxpTable(2)],
        ["post", buildPostV2Table(["", "", "g2"])],
      ]),
    );
    expect(
      readFontProgramEncoding(program)?.glyphIdOfName("g2"),
    ).toBeUndefined();
  });

  it("finds no glyph by name in a program with no 'maxp' to bound its glyphs", () => {
    const program = buildSfnt(
      new Map([["post", buildPostV2Table(["", "", "g2"])]]),
    );
    expect(
      readFontProgramEncoding(program)?.glyphIdOfName("g2"),
    ).toBeUndefined();
  });

  it("finds a glyph by its CFF charset name", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "CharsetNames",
      glyphNames: ["g1", "g2"],
      encoding: new Map([
        [0x41, 1],
        [0x42, 2],
      ]),
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdOfName("g2")).toBe(2);
    expect(encoding?.glyphIdOfName("g9")).toBeUndefined();
  });
});

describe("readFontProgramName", () => {
  const ascii = (text: string): Uint8Array<ArrayBuffer> =>
    new TextEncoder().encode(text);
  const nameTable = (postScriptName: string): Uint8Array<ArrayBuffer> =>
    buildNameTable([
      { platformId: 3, encodingId: 1, nameId: 6, text: postScriptName },
    ]);

  it("reads a TrueType program's PostScript name from its 'name' table", () => {
    expect(
      readFontProgramName(
        buildSfnt(new Map([["name", nameTable("ABCDEF+SymbolMT")]])),
      ),
    ).toBe("ABCDEF+SymbolMT");
  });

  it("reads a CFF-flavoured OpenType program with no 'name' entry from its CFF table's Name INDEX", () => {
    expect(
      readFontProgramName(
        buildSfnt(new Map([["CFF ", cffFont("EuclidSymbol", [])]])),
      ),
    ).toBe("EuclidSymbol");
  });

  it("reads a bare CFF program's name from its Name INDEX", () => {
    expect(readFontProgramName(cffFont("GycxflSymbol", []))).toBe(
      "GycxflSymbol",
    );
  });

  it("reads a Type 1 program's /FontName from its cleartext header", () => {
    expect(
      readFontProgramName(
        ascii(
          "%!PS-AdobeFont-1.0: Symbol 001.008\n/FontName /Symbol def\ncurrentfile eexec\n",
        ),
      ),
    ).toBe("Symbol");
  });

  it("reads nothing from a Type 1 header with no /FontName, nor from bytes that are no font program", () => {
    expect(
      readFontProgramName(ascii("%!PS-AdobeFont-1.0\neexec\n")),
    ).toBeUndefined();
    expect(readFontProgramName(ascii("not a font"))).toBeUndefined();
  });
});
