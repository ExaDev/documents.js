import { describe, expect, it } from "vitest";
import {
  WINANSI_GLYPH_NAMES,
  namedEncodingGlyphName,
  winAnsiGlyphName,
} from "./encoding";
import {
  MACROMAN_GLYPH_NAMES,
  STANDARD_GLYPH_NAMES,
  macRomanGlyphName,
  standardGlyphName,
} from "./encoding-standard-tables";

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

describe("the named base encodings a simple font's /Encoding can select", () => {
  it("gives each of the three tables 256 entries", () => {
    expect(STANDARD_GLYPH_NAMES).toHaveLength(256);
    expect(MACROMAN_GLYPH_NAMES).toHaveLength(256);
    expect(WINANSI_GLYPH_NAMES).toHaveLength(256);
  });

  it("differs from WinAnsi across the upper half, which is what makes approximating one as another wrong", () => {
    // Reading one table as another silently substitutes a different, entirely plausible character: 0xBD is "perthousand" in StandardEncoding, "Omega" in MacRomanEncoding, and "onehalf" in WinAnsi — three unrelated glyphs at one code.
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
