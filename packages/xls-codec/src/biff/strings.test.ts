import { describe, expect, it } from "vitest";

import { BlockCursor } from "./cursor";
import { BiffFormatError } from "./records";
import {
  readRichExtendedString,
  readShortXLUnicodeString,
  readXLUnicodeString,
} from "./strings";

function bytes(...values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

/** The low bytes of an ASCII string, as a compressed (fHighByte = 0) rgb holds them. */
function compressed(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/** The UTF-16LE code units of a string, as an uncompressed (fHighByte = 1) rgb holds them. */
function uncompressed(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    out.push(unit & 0xff, (unit >> 8) & 0xff);
  }
  return out;
}

describe("readXLUnicodeString", () => {
  // [MS-XLS] 2.5.294: a two-byte cch, one flags byte whose bit 0 is fHighByte, then rgb of cch bytes (compressed) or cch*2 bytes (uncompressed). https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/36ca6de7-be16-48bc-aa5e-3eaf4942f671

  it("reads a compressed string as one byte per character", () => {
    const cursor = new BlockCursor([
      bytes(0x02, 0x00, 0x00, ...compressed("Hi")),
    ]);

    expect(readXLUnicodeString(cursor)).toBe("Hi");
  });

  it("reads an uncompressed string as two bytes per character", () => {
    const cursor = new BlockCursor([
      bytes(0x02, 0x00, 0x01, ...uncompressed("Hi")),
    ]);

    expect(readXLUnicodeString(cursor)).toBe("Hi");
  });

  it("reads a non-Latin string from its UTF-16 code units", () => {
    const cursor = new BlockCursor([
      bytes(0x03, 0x00, 0x01, ...uncompressed("日本語")),
    ]);

    expect(readXLUnicodeString(cursor)).toBe("日本語");
  });

  it("reads an astral character from its surrogate pair", () => {
    // Two UTF-16 code units, so cch is 2 even though the string is one code point -- cch counts characters as the format's own UTF-16 units, not as code points.
    const cursor = new BlockCursor([
      bytes(0x02, 0x00, 0x01, ...uncompressed("😀")),
    ]);

    expect(readXLUnicodeString(cursor)).toBe("😀");
  });

  it("reads an empty string", () => {
    const cursor = new BlockCursor([bytes(0x00, 0x00, 0x00)]);

    expect(readXLUnicodeString(cursor)).toBe("");
  });

  it("preserves a high-bit character in a compressed string as its own code point", () => {
    // fHighByte = 0 means "the high byte is 0x00 and only the low bytes are in rgb", so byte 0xE9 is U+00E9, not a code-page lookup.
    const cursor = new BlockCursor([bytes(0x01, 0x00, 0x00, 0xe9)]);

    expect(readXLUnicodeString(cursor)).toBe("é");
  });
});

describe("readShortXLUnicodeString", () => {
  // [MS-XLS] 2.5.240: identical to XLUnicodeString but with a ONE-byte cch. BoundSheet8's stName is this shape. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/05162858-0ca9-44cb-bb07-a720928f63f8

  it("reads a compressed string behind a one-byte character count", () => {
    const cursor = new BlockCursor([bytes(0x05, 0x00, ...compressed("Sheet"))]);

    expect(readShortXLUnicodeString(cursor)).toBe("Sheet");
  });

  it("reads an uncompressed string behind a one-byte character count", () => {
    const cursor = new BlockCursor([bytes(0x02, 0x01, ...uncompressed("Hi"))]);

    expect(readShortXLUnicodeString(cursor)).toBe("Hi");
  });
});

describe("readRichExtendedString", () => {
  // [MS-XLS] 2.5.293: cch, a flags byte (fHighByte, fExtSt, fRichSt), then the optional cRun and cbExtRst counts, then rgb, then rgRun, then ExtRst. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/173d9f51-e5d3-43da-8de2-be7f22e119b9

  it("reads a plain compressed string", () => {
    const cursor = new BlockCursor([
      bytes(0x05, 0x00, 0x00, ...compressed("Alpha")),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Alpha");
  });

  it("skips the formatting runs a rich string carries", () => {
    // fRichSt (bit 3) set means cRun follows the flags byte and cRun FormatRun structures ([MS-XLS] 2.5.132, four bytes each) follow rgb. The text is the same either way; this package reads the characters, not the run formatting.
    const cursor = new BlockCursor([
      bytes(
        0x05,
        0x00,
        0x08,
        0x02,
        0x00,
        ...compressed("Alpha"),
        0x00,
        0x00,
        0x01,
        0x00,
        0x03,
        0x00,
        0x02,
        0x00,
      ),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Alpha");
  });

  it("skips the phonetic data an extended string carries", () => {
    // fExtSt (bit 2) set means a four-byte cbExtRst follows the flags byte and cbExtRst bytes of ExtRst follow rgb.
    const cursor = new BlockCursor([
      bytes(
        0x05,
        0x00,
        0x04,
        0x03,
        0x00,
        0x00,
        0x00,
        ...compressed("Alpha"),
        0xaa,
        0xbb,
        0xcc,
      ),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Alpha");
  });

  it("consumes the re-stated flag byte when a compressed string continues into the next block", () => {
    // The continuation rule this whole cursor design exists for. [MS-XLS] 2.5.293: "This structure's variable fields can be extended with Continue records. A value from the table for fHighByte MUST be specified in the first byte of the continue field of the Continue record followed by the remaining portions of this structure's variable fields."
    //
    // Read naively -- by concatenating the blocks and taking cch bytes -- the 0x00 opening the second block would be read as a NUL character and every character after it would shift by one. That is the silent-truncation bug a BIFF reader has to get right.
    const cursor = new BlockCursor([
      bytes(0x06, 0x00, 0x00, ...compressed("Abc")),
      bytes(0x00, ...compressed("def")),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Abcdef");
  });

  it("consumes the re-stated flag byte when an uncompressed string continues into the next block", () => {
    const cursor = new BlockCursor([
      bytes(0x04, 0x00, 0x01, ...uncompressed("Ab")),
      bytes(0x01, ...uncompressed("cd")),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Abcd");
  });

  it("honours a continuation that switches from compressed to uncompressed", () => {
    // The re-stated flag governs the REMAINDER of the string, so the two halves can legitimately disagree -- which is exactly why the flag is re-stated rather than assumed to carry over.
    const cursor = new BlockCursor([
      bytes(0x04, 0x00, 0x00, ...compressed("Ab")),
      bytes(0x01, ...uncompressed("語")),
      bytes(0x00, ...compressed("z")),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Ab語z");
  });

  it("honours a continuation that switches from uncompressed to compressed", () => {
    const cursor = new BlockCursor([
      bytes(0x03, 0x00, 0x01, ...uncompressed("A")),
      bytes(0x00, ...compressed("bc")),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Abc");
  });

  it("reads a string that ends exactly on a block boundary without consuming the next block's flag byte", () => {
    // The boundary byte belongs to the string only while characters remain to read. A string whose last character lands on the final byte of a block must leave the next block's first byte alone -- it is the next string's cch, not this string's flag.
    const cursor = new BlockCursor([
      bytes(0x03, 0x00, 0x00, ...compressed("Abc")),
      bytes(0x01, 0x00, 0x00, ...compressed("Z")),
    ]);

    expect(readRichExtendedString(cursor)).toBe("Abc");
    expect(readRichExtendedString(cursor)).toBe("Z");
  });

  it("rejects a continuation whose re-stated flag byte is missing", () => {
    const cursor = new BlockCursor([
      bytes(0x06, 0x00, 0x00, ...compressed("Abc")),
    ]);

    expect(() => readRichExtendedString(cursor)).toThrow(BiffFormatError);
  });
});
