// Direct tests for this module's own byte-packing, distinct from the reader/writer tests that merely consume these fixtures as inputs — a bug here would corrupt every test built on top of it without necessarily showing up as an assertion failure in the consuming test itself.

import { describe, expect, it } from "vitest";

import {
  cellXfTrailer,
  ftNts,
  richExtendedString,
  shortXlUnicodeString,
} from "./biff";

describe("richExtendedString/shortXlUnicodeString's shared character encoding", () => {
  it("writes every character compressed (one byte each) when all fit in a low byte", () => {
    const bytes = shortXlUnicodeString("abc");
    // cch, flags, then one byte per character.
    expect(bytes).toStrictEqual([3, 0x00, 0x61, 0x62, 0x63]);
  });

  it("writes every character uncompressed (two bytes each) as soon as even one needs a high byte", () => {
    // A mix of low- and high-byte characters: only `.some`, not `.every`, correctly selects the uncompressed encoding here.
    const bytes = richExtendedString("aĀ");
    expect(bytes.slice(0, 3)).toStrictEqual([2, 0, 0x01]); // cch (u16), flags = 0x01 (needs high byte)
    expect(bytes.slice(3)).toStrictEqual([0x61, 0x00, 0x00, 0x01]); // 'a' then U+0100, each a little-endian u16
  });

  it("keeps a character at exactly 0xFF compressed, the last code unit that still fits in one byte", () => {
    const bytes = shortXlUnicodeString("ÿ");
    expect(bytes[1]).toBe(0x00);
  });

  it("switches to uncompressed for a character at 0x100, one past what a single byte can hold", () => {
    const bytes = shortXlUnicodeString("Ā");
    expect(bytes[1]).toBe(0x01);
  });
});

describe("ftNts", () => {
  it("is exactly 26 bytes: the ft/cb header, a 16-byte guid, fSharedNote, and a 4-byte trailer", () => {
    expect(ftNts()).toHaveLength(26);
  });

  it("fills its own 16-byte guid field with zero bytes", () => {
    const bytes = ftNts();
    // ft (2) + cb (2) precede the guid.
    expect(bytes.slice(4, 20)).toStrictEqual(new Array<number>(16).fill(0));
  });
});

describe("cellXfTrailer", () => {
  it("packs a stated alc into word1's own low bits, not the General default", () => {
    const withDefault = cellXfTrailer();
    const withAlc = cellXfTrailer({ alc: 3 });
    const [defaultWord1] = withDefault;
    const [alcWord1] = withAlc;
    if (defaultWord1 === undefined || alcWord1 === undefined) {
      throw new Error("expected a word1 byte");
    }
    // word1 sits in the trailer's first byte: bits 0-2 are alc.
    expect(defaultWord1 & 0x7).toBe(0);
    expect(alcWord1 & 0x7).toBe(3);
  });

  it("packs a stated alcV into word1's own next bits, not the Bottom default", () => {
    const withDefault = cellXfTrailer();
    const withAlcV = cellXfTrailer({ alcV: 1 });
    const [defaultWord1] = withDefault;
    const [alcVWord1] = withAlcV;
    if (defaultWord1 === undefined || alcVWord1 === undefined) {
      throw new Error("expected a word1 byte");
    }
    expect(defaultWord1 >> 4).toBe(2);
    expect(alcVWord1 >> 4).toBe(1);
  });
});
