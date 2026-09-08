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
});
