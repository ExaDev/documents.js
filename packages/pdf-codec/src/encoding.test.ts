import { describe, expect, it } from "vitest";
import {
  MACROMAN_GLYPH_NAMES,
  STANDARD_GLYPH_NAMES,
  WINANSI_GLYPH_NAMES,
  glyphNameToUnicode,
  macRomanGlyphName,
  namedEncodingGlyphName,
  standardGlyphName,
  winAnsiGlyphName,
} from "./encoding";

describe("WINANSI_GLYPH_NAMES", () => {
  it("has exactly 256 entries", () => {
    expect(WINANSI_GLYPH_NAMES).toHaveLength(256);
  });

  it("matches known reference code points", () => {
    expect(WINANSI_GLYPH_NAMES[32]).toBe("space");
    expect(WINANSI_GLYPH_NAMES[65]).toBe("A");
    expect(WINANSI_GLYPH_NAMES[97]).toBe("a");
    expect(WINANSI_GLYPH_NAMES[128]).toBe("Euro");
    expect(WINANSI_GLYPH_NAMES[233]).toBe("eacute");
    expect(WINANSI_GLYPH_NAMES[0xe9]).toBe("eacute");
  });

  it("leaves control codes (0-31) unassigned", () => {
    for (let code = 0; code < 32; code++) {
      expect(WINANSI_GLYPH_NAMES[code]).toBe("");
    }
  });
});

describe("winAnsiGlyphName", () => {
  it("returns the glyph name for an assigned code", () => {
    expect(winAnsiGlyphName(65)).toBe("A");
  });

  it("returns undefined for an unassigned control code", () => {
    expect(winAnsiGlyphName(1)).toBeUndefined();
  });

  it("returns undefined for a code outside the table", () => {
    expect(winAnsiGlyphName(300)).toBeUndefined();
  });
});

describe("glyphNameToUnicode", () => {
  it("resolves an ASCII glyph name to its own code point", () => {
    expect(glyphNameToUnicode("A")).toBe(0x41);
  });

  it("resolves a CP1252-extension glyph name to its real Unicode value", () => {
    expect(glyphNameToUnicode("eacute")).toBe(0xe9);
    expect(glyphNameToUnicode("Euro")).toBe(0x20ac);
  });

  it('resolves the one real "bullet" entry, unclobbered by the placeholder duplicates in WINANSI_GLYPH_NAMES', () => {
    expect(glyphNameToUnicode("bullet")).toBe(0x2022);
  });

  it('resolves "space" to the ordinary space, not the non-breaking space that shares the same glyph name at 0xA0', () => {
    expect(glyphNameToUnicode("space")).toBe(0x20);
  });

  it("returns undefined for a name outside the WinAnsi set", () => {
    expect(glyphNameToUnicode("not-a-real-glyph-name")).toBeUndefined();
  });

  it("resolves the Adobe Glyph List's own constructed name forms", () => {
    // What a subsetting tool re-emits when it strips a font's real glyph names: "uniXXXX" for a BMP code point, "uXXXX" through "uXXXXXX" for any code point.
    expect(glyphNameToUnicode("uni2126")).toBe(0x2126);
    expect(glyphNameToUnicode("u1D400")).toBe(0x1d400);
    expect(glyphNameToUnicode("u0041")).toBe(0x41);
  });

  it("resolves a name carrying a variant suffix through its base name", () => {
    // The AGL specification's own rule: everything from the first period onward names a variant of the glyph the base name identifies, not a different character.
    expect(glyphNameToUnicode("A.sc")).toBe(0x41);
    expect(glyphNameToUnicode("Omega.alt01")).toBe(0x2126);
  });

  it("resolves nothing for a name that only identifies a glyph's position in one font", () => {
    // "g27" and "cid42" are glyph indices wearing a name; a code point read out of one would be invented rather than recovered.
    expect(glyphNameToUnicode("g27")).toBeUndefined();
    expect(glyphNameToUnicode("cid42")).toBeUndefined();
    expect(glyphNameToUnicode("u110000")).toBeUndefined(); // past the last Unicode code point
  });
});

describe("the named base encodings a simple font's /Encoding can select", () => {
  it("gives each of the three tables 256 entries", () => {
    expect(STANDARD_GLYPH_NAMES).toHaveLength(256);
    expect(MACROMAN_GLYPH_NAMES).toHaveLength(256);
    expect(WINANSI_GLYPH_NAMES).toHaveLength(256);
  });

  it("differs from WinAnsi across the upper half, which is what makes approximating one as another wrong", () => {
    // Reading one table as another silently substitutes a different, entirely plausible character: 0xBD is "perthousand" in StandardEncoding, "Omega" in MacRomanEncoding, and "onehalf" in WinAnsi -- three unrelated glyphs at one code.
    expect(standardGlyphName(0xbd)).toBe("perthousand");
    expect(macRomanGlyphName(0xbd)).toBe("Omega");
    expect(winAnsiGlyphName(0xbd)).toBe("onehalf");
    // ASCII letters are common ground; the quoting conventions above them are not.
    expect(standardGlyphName(0x41)).toBe("A");
    expect(macRomanGlyphName(0x41)).toBe("A");
    expect(standardGlyphName(0xa9)).toBe("quotesingle");
    expect(macRomanGlyphName(0xa9)).toBe("copyright");
  });

  it("keeps MacRomanEncoding's 0xDB as currency rather than the Euro sign later revisions moved there", () => {
    expect(macRomanGlyphName(0xdb)).toBe("currency");
  });

  it("resolves an /Encoding name to its own table, and nothing to a name it has no table for", () => {
    expect(namedEncodingGlyphName("WinAnsiEncoding")?.(0xbd)).toBe("onehalf");
    expect(namedEncodingGlyphName("MacRomanEncoding")?.(0xbd)).toBe("Omega");
    expect(namedEncodingGlyphName("StandardEncoding")?.(0xbd)).toBe(
      "perthousand",
    );
    expect(namedEncodingGlyphName("MacExpertEncoding")).toBeUndefined();
  });
});
