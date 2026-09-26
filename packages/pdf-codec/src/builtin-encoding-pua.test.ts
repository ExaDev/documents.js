import { describe, expect, it } from "vitest";
import type { BuiltinEncoding } from "./builtin-encoding";
import { readFontProgramEncoding } from "./builtin-encoding";
import {
  buildCmapTable,
  buildPostV2Table,
  buildPostV3Table,
  buildSfnt,
} from "./test-support/sfnt";

const OHM_SIGN = 0x2126; // the Adobe Glyph List's own mapping for the glyph name "Omega"

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
