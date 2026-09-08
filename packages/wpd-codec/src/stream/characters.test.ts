import { describe, expect, it } from "vitest";
import { decodeWpCharacter } from "./characters";

// Every expectation here is checked against libwpd's own WP6-to-Unicode tables (see character-sets.ts's own top-of-file citation), not typed from memory: each (character set, character number) pair below is the value at that 0-based index in libwpd's own array, and the resulting code point was independently confirmed against the Unicode Character Database (Python's unicodedata module) to carry the expected script and letter name.

describe("decodeWpCharacter", () => {
  it("decodes character set 0 (ASCII) directly", () => {
    expect(decodeWpCharacter(0, 0x41)).toBe("A");
  });

  it("decodes character set 1 (Multinational) beyond the thirty-two shorthands", () => {
    // Character 128, one of the entries the single-byte shorthand table does not cover.
    expect(decodeWpCharacter(1, 128)).toBe("Ħ");
  });

  it("decodes a character set 1 combining-sequence entry libwpd states as two code points", () => {
    // Character 156: a combining apostrophe over a capital N, which Unicode has no single precomposed letter for.
    expect(decodeWpCharacter(1, 156)).toBe("ʼN");
  });

  it("decodes character set 2 (Phonetic Symbols)", () => {
    expect(decodeWpCharacter(2, 0)).toBe("ʹ");
  });

  it("decodes character set 3 (Box Drawing)", () => {
    expect(decodeWpCharacter(3, 8)).toBe("─"); // U+2500 BOX DRAWINGS LIGHT HORIZONTAL
    expect(decodeWpCharacter(3, 0)).toBe("░"); // U+2591 LIGHT SHADE
  });

  it("decodes character set 4 (Typographic Symbols), the set the corpus check found dominates real documents", () => {
    expect(decodeWpCharacter(4, 0)).toBe("●"); // U+25CF BLACK CIRCLE
    expect(decodeWpCharacter(4, 3)).toBe("•"); // U+2022 BULLET
    expect(decodeWpCharacter(4, 7)).toBe("¡"); // U+00A1 INVERTED EXCLAMATION MARK
  });

  it("decodes character set 5 (Iconic Symbols)", () => {
    expect(decodeWpCharacter(5, 0)).toBe("♡"); // U+2661 WHITE HEART SUIT
  });

  it("decodes character set 6 (Math/Scientific)", () => {
    expect(decodeWpCharacter(6, 0)).toBe("−"); // U+2212 MINUS SIGN
  });

  it("decodes character set 7 (Math/Scientific Extended)", () => {
    expect(decodeWpCharacter(7, 4)).toBe("√"); // U+221A SQUARE ROOT
  });

  it("decodes character set 8 (Greek)", () => {
    expect(decodeWpCharacter(8, 0)).toBe("Α"); // U+0391 GREEK CAPITAL LETTER ALPHA
    expect(decodeWpCharacter(8, 1)).toBe("α"); // U+03B1 GREEK SMALL LETTER ALPHA
  });

  it("decodes character set 9 (Hebrew)", () => {
    expect(decodeWpCharacter(9, 0)).toBe("א"); // U+05D0 HEBREW LETTER ALEF
    expect(decodeWpCharacter(9, 26)).toBe("ת"); // U+05EA HEBREW LETTER TAV
  });

  it("decodes character set 10 (Cyrillic)", () => {
    expect(decodeWpCharacter(10, 0)).toBe("А"); // U+0410 CYRILLIC CAPITAL LETTER A
    expect(decodeWpCharacter(10, 1)).toBe("а"); // U+0430 CYRILLIC SMALL LETTER A
  });

  it("decodes character set 10's own trailing Georgian entries", () => {
    // Cyrillic (charset 10) carries a run of Georgian letters at its tail per libwpd's own table.
    expect(decodeWpCharacter(10, 212)).toBe("გ"); // U+10D2 GEORGIAN LETTER GAN
  });

  it("decodes character set 11 (Japanese) as the Halfwidth Katakana block, contiguously", () => {
    expect(decodeWpCharacter(11, 0)).toBe("｡"); // U+FF61 HALFWIDTH IDEOGRAPHIC FULL STOP
    expect(decodeWpCharacter(11, 62)).toBe("ﾟ"); // U+FF9F HALFWIDTH KATAKANA SEMI-VOICED SOUND MARK
  });

  it("decodes character set 12 (Tibetan)", () => {
    expect(decodeWpCharacter(12, 33)).toBe("ཀ"); // U+0F40 TIBETAN LETTER KA
  });

  it("decodes a character set 12 entry libwpd states as a stacked consonant/vowel sequence", () => {
    expect(decodeWpCharacter(12, 63)).toBe("རྐ");
  });

  it("reports no mapping for a character set 12 position below libwpd's own lowest transcribed index", () => {
    // libwpd's tibetanMap1 table has no entry below character number 33.
    expect(decodeWpCharacter(12, 0)).toBeUndefined();
  });

  it("decodes character set 13 (Arabic)", () => {
    expect(decodeWpCharacter(13, 58)).toBe("ا"); // U+0627 ARABIC LETTER ALEF
  });

  it("decodes character set 14 (Arabic Script)", () => {
    expect(decodeWpCharacter(14, 7)).toBe("ؕ"); // ARABIC SMALL HIGH TAH
  });

  it("reports no mapping for a character set this package does not name", () => {
    expect(decodeWpCharacter(15, 0)).toBeUndefined();
  });
});
