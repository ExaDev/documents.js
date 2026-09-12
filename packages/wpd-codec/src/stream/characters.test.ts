import { describe, expect, it } from "vitest";
import {
  decodeSingleByteCharacter,
  decodeWordString,
  decodeWpCharacter,
} from "./characters";

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

  // Character set 0's ASCII range is 0x20-0x7f (0x20 itself only reachable through this path, not the document-area byte stream -- see the module's own top comment), boundaries pinned directly since the rest of this describe block never exercises character numbers near either edge.
  it("rejects a character set 0 number one below the ASCII range", () => {
    expect(decodeWpCharacter(0, 0x1f)).toBeUndefined();
  });

  it("accepts a character set 0 number at the low end of the ASCII range", () => {
    expect(decodeWpCharacter(0, 0x20)).toBe(" ");
  });

  it("accepts a character set 0 number at the high end of the ASCII range", () => {
    expect(decodeWpCharacter(0, 0x7f)).toBe(String.fromCharCode(0x7f));
  });

  it("rejects a character set 0 number one above the ASCII range", () => {
    expect(decodeWpCharacter(0, 0x80)).toBeUndefined();
  });
});

describe("decodeSingleByteCharacter", () => {
  it("rejects byte 0, below the ASCII range and not one of the thirty-two shorthands", () => {
    expect(decodeSingleByteCharacter(0)).toBeUndefined();
  });

  it("accepts the lowest byte in the ASCII range", () => {
    expect(decodeSingleByteCharacter(0x21)).toBe("!");
  });

  it("accepts the highest byte in the ASCII range", () => {
    expect(decodeSingleByteCharacter(0x7f)).toBe(String.fromCharCode(0x7f));
  });

  it("rejects a byte one above the ASCII range", () => {
    expect(decodeSingleByteCharacter(0x80)).toBeUndefined();
  });

  // The document area's own tokeniser only ever mints a "character" token for a byte in exactly this range (0 is skipped upstream, 0x80 and above becomes a function instead), and read.ts's applyToken relies on this range being gap-free to treat a decode as never failing for a byte it hands in. This is the test that invariant actually rests on: if the shorthand table and the ASCII range ever drifted apart and left a gap, this is what would catch it.
  it("has no gap anywhere across its own documented domain (1 through 127)", () => {
    const gaps: number[] = [];
    for (let byte = 1; byte <= 0x7f; byte += 1) {
      if (decodeSingleByteCharacter(byte) === undefined) {
        gaps.push(byte);
      }
    }
    expect(gaps).toEqual([]);
  });
});

describe("decodeWordString", () => {
  it("reads each word's own high byte, not a neighbouring word's", () => {
    // 'A' (ASCII, high byte 0), then character-set 5 number 0 ('♡', high byte 5), then the null terminator -- every existing caller only ever writes pure-ASCII words (high byte always 0), which cannot distinguish a word's own high byte from its neighbour's.
    const bytes = new Uint8Array([0x41, 0, 0, 5, 0, 0]);
    expect(decodeWordString(bytes, 0, 10)).toEqual({
      text: "A♡",
      wordsRead: 3,
    });
  });
});
