import { describe, expect, it } from "vitest";
import { readFontProgramEncoding } from "./builtin-encoding";
import { cffFontWithBuiltinEncoding } from "./test-support/cff";
import { buildPostV2Table, buildSfnt } from "./test-support/sfnt";
import { buildMaxpTable } from "./test-support/sfnt-tables";

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
