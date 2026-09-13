import { describe, expect, it } from "vitest";
import { readTableFormula } from "./formula";
import { word } from "../test-support/build-wpd";

// Builds a length-prefixed WP word string exactly as the formula codes that carry one (8, 9, 10, 26, 32) state it: a 16-bit word count, then that many WP-decoded characters. ASCII text round-trips through character set 0's own direct passthrough, the same convention test-support/build-wpd.ts's wordString() rests on.
function lengthPrefixedWordString(value: string): number[] {
  return [
    ...word(value.length),
    ...[...value].flatMap((character) => word(character.charCodeAt(0))),
  ];
}

// Code 30's own byte-string spelling: a 16-bit count, then that many raw ASCII bytes (one per character, not the two-byte word convention every other string-carrying code uses).
function lengthPrefixedByteString(value: string): number[] {
  return [...word(value.length), ...[...value].map((c) => c.charCodeAt(0))];
}

// Code 30's own 8-byte IEEE-754 double, little-endian, per the SDK's own field description.
function doubleBytes(value: number): number[] {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return Array.from(new Uint8Array(buffer));
}

const CELL_A1 = [64, ...word(0), ...word(0)]; // cell reference, no absolute flags: row 0, column 0
const CELL_B1 = [64, ...word(0), ...word(1)]; // row 0, column 1

describe("readTableFormula", () => {
  it("decodes a simple binary expression", () => {
    expect(readTableFormula(new Uint8Array([...CELL_A1, 1, ...CELL_B1]))).toBe(
      "A1+B1",
    );
  });

  it("decodes a function call with its own parentheses and comma tokens", () => {
    const bytes = new Uint8Array([
      7, // SUM
      23, // (
      ...CELL_A1,
      22, // ,
      ...CELL_B1,
      24, // )
    ]);
    expect(readTableFormula(bytes)).toBe("SUM(A1,B1)");
  });

  it("decodes an absolute range reference with dollar markers", () => {
    // code 48: flags 0 -- bottom-right relative, top-left absolute (bit2|bit3 set: 0x0C)
    const bytes = new Uint8Array([
      48 + 0x0c,
      ...word(0),
      ...word(0),
      ...word(2),
      ...word(1),
    ]);
    expect(readTableFormula(bytes)).toBe("$A$1:B3");
  });

  it("decodes a number constant and a string constant", () => {
    const bytes = new Uint8Array([
      8,
      ...lengthPrefixedWordString("3.5"),
      1,
      9,
      ...lengthPrefixedWordString("hi"),
    ]);
    expect(readTableFormula(bytes)).toBe('3.5+"hi"');
  });

  it("decodes group 1 and group 2 function references by name", () => {
    expect(readTableFormula(new Uint8Array([12, 2]))).toBe("ABS"); // group 1, function 2
    expect(readTableFormula(new Uint8Array([13, 4]))).toBe("SQRT"); // group 2, function 4
  });

  it("decodes a comparison operator", () => {
    expect(
      readTableFormula(new Uint8Array([...CELL_A1, 21, 4, ...CELL_B1])),
    ).toBe("A1>=B1");
  });

  it("skips formatting attribute markers, contributing no text", () => {
    const bytes = new Uint8Array([...CELL_A1, 41, ...word(1), 1, ...CELL_B1]);
    expect(readTableFormula(bytes)).toBe("A1+B1");
  });

  it("aborts the whole formula on the undocumented + shortcut code", () => {
    expect(
      readTableFormula(new Uint8Array([14, 0, 0, 0, 27, ...CELL_A1])),
    ).toBeUndefined();
  });

  it("aborts on a code the SDK itself only assumes the meaning of", () => {
    expect(readTableFormula(new Uint8Array([...CELL_A1, 45]))).toBeUndefined();
  });

  it("aborts on truncated input rather than reading past the end", () => {
    expect(readTableFormula(new Uint8Array([64, 0, 0, 0]))).toBeUndefined();
  });

  // Every existing cell reference names a column under 26 (a single base-26 digit), which the loop's own boundary happens to satisfy on its first pass regardless of when it stops -- only a two-digit column proves the loop actually continues into a second pass rather than stopping after exactly one.
  it("renders a column at or past the base-26 rollover with two letters", () => {
    // code 64, flags 0: row 0, column 26 -- the base-26 convention's "AA".
    expect(
      readTableFormula(new Uint8Array([64, ...word(0), ...word(26)])),
    ).toBe("AA1");
  });

  it("aborts a cell reference whose row is negative", () => {
    // code 64: row = -1 (0xFFFF as a signed 16-bit read), column = 0.
    expect(
      readTableFormula(new Uint8Array([64, ...word(0xffff), ...word(0)])),
    ).toBeUndefined();
  });

  it("aborts a cell reference whose column is negative", () => {
    expect(
      readTableFormula(new Uint8Array([64, ...word(0), ...word(0xffff)])),
    ).toBeUndefined();
  });

  it("renders a literal run of spaces for code 25's own count", () => {
    expect(readTableFormula(new Uint8Array([25, ...word(3)]))).toBe("   ");
  });

  it("aborts a space count with no room for its own 16-bit count", () => {
    expect(readTableFormula(new Uint8Array([25, 0]))).toBeUndefined();
  });

  it("decodes a plain, non-absolute cell reference (code 27)", () => {
    expect(readTableFormula(new Uint8Array([27, ...word(2), ...word(0)]))).toBe(
      "A3",
    );
  });

  it("decodes a plain, non-absolute range reference (code 28)", () => {
    const bytes = new Uint8Array([
      28,
      ...word(0),
      ...word(0), // start: A1
      ...word(2),
      ...word(1), // end: B3
    ]);
    expect(readTableFormula(bytes)).toBe("A1:B3");
  });

  it("aborts a plain range reference whose end cell is truncated", () => {
    const bytes = new Uint8Array([28, ...word(0), ...word(0)]); // start only, no end cell at all
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("aborts a plain range reference whose start cell's row is negative", () => {
    const bytes = new Uint8Array([
      28,
      ...word(0xffff),
      ...word(0),
      ...word(0),
      ...word(0),
    ]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("aborts a plain range reference whose end cell's row is negative", () => {
    const bytes = new Uint8Array([
      28,
      ...word(0),
      ...word(0),
      ...word(0xffff),
      ...word(0),
    ]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("decodes a floating point constant from its double and confirms the spelling is present", () => {
    const bytes = new Uint8Array([
      30,
      ...doubleBytes(3.5),
      ...lengthPrefixedByteString("3.5"),
    ]);
    expect(readTableFormula(bytes)).toBe("3.5");
  });

  it("reads the double as little-endian, not big-endian", () => {
    // 1.0's little-endian IEEE-754 bytes read back as a wildly different (but still finite) value in big-endian order, so misreading the endianness is easy to observe through String(value) rather than only through a coincidental NaN.
    const bytes = new Uint8Array([
      30,
      ...doubleBytes(1),
      ...lengthPrefixedByteString("1"),
    ]);
    expect(readTableFormula(bytes)).toBe("1");
  });

  it("continues correctly after a floating point constant's own spelling, not one byte off", () => {
    const bytes = new Uint8Array([
      30,
      ...doubleBytes(2),
      ...lengthPrefixedByteString("2"),
      1, // +
      30,
      ...doubleBytes(3),
      ...lengthPrefixedByteString("3"),
    ]);
    expect(readTableFormula(bytes)).toBe("2+3");
  });

  it("aborts a floating point constant with no room for its own 8-byte double", () => {
    expect(
      readTableFormula(new Uint8Array([30, ...doubleBytes(1).slice(0, 4)])),
    ).toBeUndefined();
  });

  it("aborts a floating point constant whose own spelling has no room for its length prefix", () => {
    const bytes = new Uint8Array([30, ...doubleBytes(1), 0]); // one stray byte, not the two the length prefix needs
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("accepts a floating point constant whose own spelling is empty, rather than rejecting it", () => {
    const bytes = new Uint8Array([30, ...doubleBytes(1), ...word(0)]);
    expect(readTableFormula(bytes)).toBe("1");
  });

  it("decodes a user argument reference by its own number", () => {
    expect(readTableFormula(new Uint8Array([31, ...word(7)]))).toBe("ARG7");
  });

  it("aborts a user argument reference with no room for its own number", () => {
    expect(readTableFormula(new Uint8Array([31, 0]))).toBeUndefined();
  });

  it("decodes a user function call by its own verbatim name", () => {
    const bytes = new Uint8Array([32, ...lengthPrefixedWordString("MYFUNC")]);
    expect(readTableFormula(bytes)).toBe("MYFUNC");
  });

  it("skips an attribute-off marker (42), contributing no text", () => {
    const bytes = new Uint8Array([...CELL_A1, 42, ...word(1), 1, ...CELL_B1]);
    expect(readTableFormula(bytes)).toBe("A1+B1");
  });

  it("skips a total-attribute-mask marker (43), contributing no text", () => {
    const bytes = new Uint8Array([...CELL_A1, 43, ...word(1), 1, ...CELL_B1]);
    expect(readTableFormula(bytes)).toBe("A1+B1");
  });

  it("skips a conditional-attribute marker (44), contributing no text", () => {
    const bytes = new Uint8Array([...CELL_A1, 44, 1, ...CELL_B1]);
    expect(readTableFormula(bytes)).toBe("A1+B1");
  });

  // Every one of the four absolute-reference flag bits a range reference (codes 48-63) carries, isolated one at a time -- the existing "decodes an absolute range reference" test only ever sets bits 2 and 3 together (0x0C), which cannot tell any one of the four apart from the others.
  it.each([
    [0x01, "A1:$B3"], // bit 0: end column absolute
    [0x02, "A1:B$3"], // bit 1: end row absolute
    [0x04, "$A1:B3"], // bit 2: start column absolute
    [0x08, "A$1:B3"], // bit 3: start row absolute
  ])("marks only the range reference flag bit 0x%s absolute", (flag, text) => {
    const bytes = new Uint8Array([
      48 + flag,
      ...word(0),
      ...word(0), // start: A1
      ...word(2),
      ...word(1), // end: B3
    ]);
    expect(readTableFormula(bytes)).toBe(text);
  });

  it("treats code 47 (one below the range-reference range) as unrecognised, even with a full range reference's own bytes following it", () => {
    // Full, well-formed range-reference bytes follow the code, so a lower bound that quietly slipped would decode a range instead of refusing it.
    const bytes = new Uint8Array([
      47,
      ...word(0),
      ...word(0),
      ...word(2),
      ...word(1),
    ]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("decodes a range reference at 63, the top of its own code range", () => {
    const bytes = new Uint8Array([
      48 + 15, // 63: every flag bit set
      ...word(0),
      ...word(0),
      ...word(2),
      ...word(1),
    ]);
    expect(readTableFormula(bytes)).toBe("$A$1:$B$3");
  });

  it("decodes a range reference at 48, the bottom of its own code range, with no absolute flags at all", () => {
    const bytes = new Uint8Array([
      48,
      ...word(0),
      ...word(0),
      ...word(2),
      ...word(1),
    ]);
    expect(readTableFormula(bytes)).toBe("A1:B3");
  });

  it("aborts a range reference (48-63) whose start cell's row is negative, even though the end cell is well-formed", () => {
    const bytes = new Uint8Array([
      48,
      ...word(0xffff),
      ...word(0), // start: row -1
      ...word(2),
      ...word(1), // end: B3, well-formed
    ]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("aborts a range reference (48-63) whose end cell's row is negative, even though the start cell is well-formed", () => {
    const bytes = new Uint8Array([
      48,
      ...word(0),
      ...word(0), // start: A1, well-formed
      ...word(0xffff),
      ...word(1), // end: row -1
    ]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  // Every one of the two absolute-reference flag bits an absolute cell reference (codes 64-67) carries, isolated one at a time.
  it.each([
    [0x01, "$B3"], // bit 0: column absolute
    [0x02, "B$3"], // bit 1: row absolute
  ])("marks only the cell reference flag bit 0x%s absolute", (flag, text) => {
    const bytes = new Uint8Array([64 + flag, ...word(2), ...word(1)]);
    expect(readTableFormula(bytes)).toBe(text);
  });

  it("decodes a cell reference at 67, the top of its own code range", () => {
    const bytes = new Uint8Array([67, ...word(2), ...word(1)]); // both flags set
    expect(readTableFormula(bytes)).toBe("$B$3");
  });

  it("treats code 68 (one past the cell-reference range) as unrecognised, even with a full cell reference's own bytes following it", () => {
    const bytes = new Uint8Array([68, ...word(0), ...word(0)]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("aborts a length-prefixed word string with no room for its own 16-bit count", () => {
    // Code 8 (number constant) is the simplest carrier of readLengthPrefixedWordString's shared boundary.
    expect(readTableFormula(new Uint8Array([8]))).toBeUndefined();
  });

  it("reads a zero-length word string at the exact boundary where its own 16-bit count just fits", () => {
    // Exactly 2 bytes remain for the count field itself, declaring zero characters -- the tie where "no room" and "just enough room" disagree.
    expect(readTableFormula(new Uint8Array([8, ...word(0)]))).toBe("");
  });

  it("aborts a string constant (code 9) with no room for its own 16-bit count, rather than quoting the word 'undefined'", () => {
    // Code 9 wraps its text in quotes unconditionally on the way out, so unlike code 8 this is the one carrier where a skipped abort would produce a defined (wrong) string instead of quietly converging back to undefined.
    expect(readTableFormula(new Uint8Array([9]))).toBeUndefined();
  });

  it("aborts a length-prefixed word string whose declared length runs past the words actually present", () => {
    // Declares 5 characters but supplies only one word's worth of bytes, so decodeWordString stops short of the declared length.
    const bytes = new Uint8Array([8, ...word(5), ...word(65)]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("aborts a floating point constant's byte-string spelling that runs past the bytes actually present", () => {
    // The length prefix itself is intact (declares 3 bytes) but only one byte of the spelling follows.
    const bytes = new Uint8Array([30, ...doubleBytes(1), ...word(3), 0x31]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("aborts a floating point constant with no spelling data at all after its own double, rather than emitting the double's own text with no more tokens to fail on", () => {
    // Nothing at all follows the 8-byte double -- not even the 2 bytes a spelling's own length prefix needs. With no further token left in the stream to independently fail on, this is the one case that actually observes whether the missing spelling aborts the whole token or is silently ignored.
    const bytes = new Uint8Array([30, ...doubleBytes(1)]);
    expect(readTableFormula(bytes)).toBeUndefined();
  });

  it("aborts a range reference (48-63) whose start cell has no room at all", () => {
    const bytes = new Uint8Array([48, ...word(0)]); // 2 bytes: one short of the 4 a cell reference needs
    expect(readTableFormula(bytes)).toBeUndefined();
  });
});
