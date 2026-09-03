import { describe, expect, it } from "vitest";
import { readFontProgramEncoding } from "./builtin-encoding";
import { STIX_TWO_MATH_FONT_BASE64 } from "./assets/stix-two-math-font";
import {
  CFF_HEADER,
  ROS_OPERANDS_AND_OPERATOR,
  cffFont,
  cffFontWithBuiltinEncoding,
} from "./test-support/cff";
import { caladeaRegularBytes, carlitoRegularBytes } from "./test-support/fonts";
import {
  buildCmapTable,
  buildPostV2Table,
  buildPostV3Table,
  buildSfnt,
} from "./test-support/sfnt";
import { base64ToBytes } from "./util/base64";

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
    // Reading such a font's charset as though its numbers were name SIDs would name every glyph, and name them all wrongly -- the same silent-wrong-answer failure this module exists to avoid.
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
});
