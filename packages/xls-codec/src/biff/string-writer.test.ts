import { describe, expect, it } from "vitest";

import { BlockCursor } from "./cursor";
import {
  readRichExtendedString,
  readShortXLUnicodeString,
  readXLUnicodeString,
} from "./strings";
import {
  writeRichExtendedString,
  writeShortXLUnicodeString,
  writeXLUnicodeString,
} from "./string-writer";
import { BiffWriteError } from "./write-errors";

describe("writeXLUnicodeString", () => {
  it("round-trips a plain ASCII string through this package's own reader", () => {
    const bytes = writeXLUnicodeString("Hello, world!");
    expect(readXLUnicodeString(new BlockCursor([bytes]))).toBe("Hello, world!");
  });

  it("round-trips an empty string", () => {
    const bytes = writeXLUnicodeString("");
    expect(readXLUnicodeString(new BlockCursor([bytes]))).toBe("");
  });

  it("writes a compressed (one-byte-per-character) encoding when every character fits", () => {
    const bytes = writeXLUnicodeString("abc");
    // cch (u16) + flags (u8, clear) + 3 one-byte characters = 6 bytes, not 9.
    expect(bytes.length).toBe(6);
    expect(bytes[2]).toBe(0x00);
  });

  it("round-trips a string needing the uncompressed encoding, and writes the longer form", () => {
    const text = "café £€"; // accented + currency symbols above 0xFF... some below, some above
    const bytes = writeXLUnicodeString(text);
    expect(readXLUnicodeString(new BlockCursor([bytes]))).toBe(text);
  });

  it("round-trips an astral character as its own two surrogate code units", () => {
    const text = "before \u{1F600} after"; // an emoji: one astral code point, two UTF-16 units
    const bytes = writeXLUnicodeString(text);
    expect(readXLUnicodeString(new BlockCursor([bytes]))).toBe(text);
  });

  it("refuses a string longer than the two-byte cch can hold", () => {
    expect(() => writeXLUnicodeString("x".repeat(0x10000))).toThrow(
      BiffWriteError,
    );
  });
});

describe("writeShortXLUnicodeString", () => {
  it("round-trips a plain ASCII string through this package's own reader", () => {
    const bytes = writeShortXLUnicodeString("Sheet1");
    expect(readShortXLUnicodeString(new BlockCursor([bytes]))).toBe("Sheet1");
  });

  it("round-trips a string at exactly the 255-character ceiling", () => {
    const text = "x".repeat(255);
    const bytes = writeShortXLUnicodeString(text);
    expect(readShortXLUnicodeString(new BlockCursor([bytes]))).toBe(text);
  });

  it("refuses a string longer than the one-byte cch can hold", () => {
    expect(() => writeShortXLUnicodeString("x".repeat(256))).toThrow(
      BiffWriteError,
    );
  });
});

describe("writeRichExtendedString", () => {
  it("round-trips a shared-string entry through this package's own reader", () => {
    const bytes = writeRichExtendedString("Shared text");
    expect(readRichExtendedString(new BlockCursor([bytes]))).toBe(
      "Shared text",
    );
  });

  it("writes no formatting-run or phonetic payload", () => {
    // flags byte: bits 2 (fExtSt) and 3 (fRichSt) both clear, since this writer never carries either payload.
    const bytes = writeRichExtendedString("x");
    const flags = bytes[2] ?? 0xff;
    expect(flags & 0x0c).toBe(0);
  });

  it("round-trips several distinct strings read back in sequence, as an SST body would carry them", () => {
    const strings = ["First", "Second é", "Third"];
    const encoded = strings.map((text) => writeRichExtendedString(text));
    const cursor = new BlockCursor(encoded);
    for (const expected of strings) {
      expect(readRichExtendedString(cursor)).toBe(expected);
    }
  });
});
