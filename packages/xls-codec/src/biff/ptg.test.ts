import { describe, expect, it } from "vitest";

import { u16, u32 } from "../test-support/biff";
import { type FormulaSheetContext, parseFormulaText } from "./ptg";

// Every byte sequence here is built by hand from [MS-XLS] 2.5.198's own per-Ptg field layouts, matching this package's established convention (see test-support/biff.ts) -- and cross-checked against a real BIFF8 workbook that LibreOffice wrote for the identical formulas during development of this module (SUM/AVERAGE/IF/ROUND/ATAN2/SYD/REPLACE/SUMIF/CONCATENATE, a cross-sheet SUM, and a parenthesised `(A1+B1)*C1`), which produced byte-for-byte the same token streams these tests assert against.

function bytes(...values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

/** A plain, fully-relative RgceLoc column field ([MS-XLS] 2.5.51 ColRelU): both colRelative and rowRelative set, which is what a bare `A1` reference (as opposed to `$A$1`) carries. */
function relativeColumn(column: number): number[] {
  return u16(0xc000 | column);
}

const NO_SHEETS: FormulaSheetContext = { sheets: [], sheetRanges: [] };

/** PtgRef (value class, [MS-XLS] 2.5.198.84): opcode 0x44, then a row and a ColRelU column field, all relative. */
function ptgRef(row: number, column: number): number[] {
  return [0x44, ...u16(row), ...relativeColumn(column)];
}

/** PtgArea (ref class, [MS-XLS] 2.5.198.27): opcode 0x25, rwFirst, rwLast, then each corner's own relative ColRelU column field. */
function ptgArea(
  rowFirst: number,
  rowLast: number,
  columnFirst: number,
  columnLast: number,
): number[] {
  return [
    0x25,
    ...u16(rowFirst),
    ...u16(rowLast),
    ...relativeColumn(columnFirst),
    ...relativeColumn(columnLast),
  ];
}

/** PtgInt ([MS-XLS] 2.5.198.66): opcode 0x1E then an unsigned 16-bit value. */
function ptgInt(value: number): number[] {
  return [0x1e, ...u16(value)];
}

describe("parseFormulaText", () => {
  it("formats a binary arithmetic expression from two references", () => {
    // A1+B1
    const rgce = bytes(...ptgRef(0, 0), ...ptgRef(0, 1), 0x03);
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("A1+B1");
  });

  it("formats each comparison operator", () => {
    const operator = (opcode: number, expected: string) => {
      const rgce = bytes(...ptgRef(0, 0), ...ptgRef(0, 1), opcode);
      expect(parseFormulaText(rgce, NO_SHEETS)).toBe(`A1${expected}B1`);
    };
    operator(0x09, "<");
    operator(0x0a, "<=");
    operator(0x0b, "=");
    operator(0x0c, ">=");
    operator(0x0d, ">");
    operator(0x0e, "<>");
  });

  it("wraps a lower-precedence child on the left of a higher-precedence operator", () => {
    // (A1+B1)*C1 -- PtgParen explicitly restates the source's own parentheses, matching a real producer's output byte-for-byte.
    const rgce = bytes(
      ...ptgRef(0, 0),
      ...ptgRef(0, 1),
      0x03, // PtgAdd
      0x15, // PtgParen
      ...ptgRef(0, 2),
      0x05, // PtgMul
    );
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("(A1+B1)*C1");
  });

  it("wraps a same-precedence right child that division is not associative over", () => {
    // A1/(B1/C1) -- the postfix nesting itself (right child built before being combined) is what requires the parenthesis, independent of any PtgParen token.
    const rgce = bytes(
      ...ptgRef(0, 0),
      ...ptgRef(0, 1),
      ...ptgRef(0, 2),
      0x06, // PtgDiv (B1/C1)
      0x06, // PtgDiv (A1/(B1/C1))
    );
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("A1/(B1/C1)");
  });

  it("does not wrap a left-nested chain of the same operator", () => {
    // A1-B1-C1, postfix ((A1-B1)-C1) -- the ordinary left-associative reading, no parens needed.
    const rgce = bytes(
      ...ptgRef(0, 0),
      ...ptgRef(0, 1),
      0x04, // PtgSub
      ...ptgRef(0, 2),
      0x04, // PtgSub
    );
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("A1-B1-C1");
  });

  it("does not add a paren a lower-precedence multiply/add mix does not need", () => {
    // A1+B1*C1 -- multiply binds tighter, so the addition's right child needs no wrapping.
    const rgce = bytes(
      ...ptgRef(0, 0),
      ...ptgRef(0, 1),
      ...ptgRef(0, 2),
      0x05, // PtgMul (B1*C1)
      0x03, // PtgAdd
    );
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("A1+B1*C1");
  });

  it("formats unary minus, unary plus, and percent", () => {
    expect(parseFormulaText(bytes(...ptgRef(0, 0), 0x13), NO_SHEETS)).toBe(
      "-A1",
    );
    expect(parseFormulaText(bytes(...ptgRef(0, 0), 0x12), NO_SHEETS)).toBe(
      "+A1",
    );
    // A1*10% -- PtgPercent binds to the literal immediately before it, then PtgMul combines.
    const rgce = bytes(...ptgRef(0, 0), ...ptgInt(10), 0x14, 0x05);
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("A1*10%");
  });

  it("formats a range reference and the PtgAttrSum optimisation for a top-level SUM", () => {
    // SUM(A1:A10) -- a real producer's own optimisation for a single-range SUM call, [MS-XLS] 2.5.198.41.
    const rgce = bytes(
      ...ptgArea(0, 9, 0, 0),
      0x19,
      0x10,
      ...u16(0), // PtgAttrSum
    );
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("SUM(A1:A10)");
  });

  it("formats absolute and mixed cell references with dollar signs", () => {
    const columnField = (colRelative: boolean, rowRelative: boolean) =>
      u16(
        (colRelative ? 0x4000 : 0) | (rowRelative ? 0x8000 : 0) | 0, // column A (index 0)
      );
    const refWith = (colRelative: boolean, rowRelative: boolean) =>
      bytes(0x44, ...u16(0), ...columnField(colRelative, rowRelative));

    expect(parseFormulaText(refWith(false, false), NO_SHEETS)).toBe("$A$1");
    expect(parseFormulaText(refWith(true, false), NO_SHEETS)).toBe("A$1");
    expect(parseFormulaText(refWith(false, true), NO_SHEETS)).toBe("$A1");
    expect(parseFormulaText(refWith(true, true), NO_SHEETS)).toBe("A1");
  });

  it("formats a string literal, doubling an embedded quote", () => {
    // PtgStr ([MS-XLS] 2.5.198.89): opcode 0x17, a ShortXLUnicodeString with cch=3, compressed flags, then the three characters `a"b`.
    const text = 'a"b';
    const characters: number[] = [];
    for (let index = 0; index < text.length; index += 1) {
      characters.push(text.charCodeAt(index));
    }
    const rgce = bytes(0x17, text.length, 0x00, ...characters);
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe('"a""b"');
  });

  it("formats a boolean literal and an error literal", () => {
    expect(parseFormulaText(bytes(0x1d, 0x01), NO_SHEETS)).toBe("TRUE");
    expect(parseFormulaText(bytes(0x1d, 0x00), NO_SHEETS)).toBe("FALSE");
    // PtgErr ([MS-XLS] 2.5.198.57): opcode 0x1C then a BErr byte -- 0x07 is #DIV/0!.
    expect(parseFormulaText(bytes(0x1c, 0x07), NO_SHEETS)).toBe("#DIV/0!");
  });

  it("formats a numeric literal", () => {
    // PtgNum ([MS-XLS] 2.5.198.79): opcode 0x1F then an Xnum.
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, 3.5, true);
    const rgce = bytes(0x1f, ...new Uint8Array(buffer));
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("3.5");
  });

  it("formats a fixed-arity PtgFunc call", () => {
    // SIN(A1) -- iftab 0x000F, verified against real LibreOffice-written BIFF8 during development.
    const rgce = bytes(...ptgRef(0, 0), 0x41, ...u16(0x000f));
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("SIN(A1)");
  });

  it("formats a zero-argument PtgFunc call with empty parentheses", () => {
    // PI() -- iftab 0x0013.
    const rgce = bytes(0x41, ...u16(0x0013));
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("PI()");
  });

  it("formats a variable-arity PtgFuncVar call, using its own on-disk cparams", () => {
    // COUNT(A1:B1) -- cparams=1, iftab 0x0000.
    const rgce = bytes(...ptgArea(0, 0, 0, 1), 0x42, 0x01, ...u16(0x0000));
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("COUNT(A1:B1)");
  });

  it("formats IF's PtgAttrIf/PtgAttrGoto control tokens as pure no-ops", () => {
    // IF(A1>0,1,0), byte-for-byte the real stream a LibreOffice-written workbook carries for it.
    const rgce = bytes(
      ...ptgRef(0, 0),
      ...ptgInt(0),
      0x0d, // PtgGt
      0x19,
      0x02,
      ...u16(7), // PtgAttrIf, offset 7
      ...ptgInt(1),
      0x19,
      0x08,
      ...u16(10), // PtgAttrGoto, offset 10
      ...ptgInt(0),
      0x19,
      0x08,
      ...u16(3), // PtgAttrGoto, offset 3
      0x42,
      0x03,
      ...u16(0x0001), // PtgFuncVar, IF, cparams=3
    );
    expect(parseFormulaText(rgce, NO_SHEETS)).toBe("IF(A1>0,1,0)");
  });

  it("resolves a single-sheet 3D reference, quoting a sheet name that needs it", () => {
    const context: FormulaSheetContext = {
      sheets: [{ name: "Sheet1" }, { name: "Data Sheet" }],
      sheetRanges: [{ firstSheetIndex: 1, lastSheetIndex: 1 }],
    };
    // PtgArea3d (ref class, [MS-XLS] 2.5.198.28): opcode 0x3B, ixti, then an RgceArea.
    const rgce = bytes(0x3b, ...u16(0), ...ptgArea(0, 1, 0, 1).slice(1));
    expect(parseFormulaText(rgce, context)).toBe("'Data Sheet'!A1:B2");
  });

  it("resolves a multi-sheet 3D range, always quoted for the embedded colon", () => {
    const context: FormulaSheetContext = {
      sheets: [{ name: "Jan" }, { name: "Feb" }, { name: "Mar" }],
      sheetRanges: [{ firstSheetIndex: 0, lastSheetIndex: 2 }],
    };
    // PtgRef3d (value class): opcode 0x5A, ixti, then an RgceLoc.
    const rgce = bytes(0x5a, ...u16(0), ...ptgRef(0, 0).slice(1));
    expect(parseFormulaText(rgce, context)).toBe("'Jan:Mar'!A1");
  });

  it("aborts the whole parse when a 3D reference's ixti does not resolve", () => {
    const context: FormulaSheetContext = { sheets: [], sheetRanges: [] };
    const rgce = bytes(0x5a, ...u16(0), ...ptgRef(0, 0).slice(1));
    expect(parseFormulaText(rgce, context)).toBeUndefined();
  });

  it("aborts on a token outside this reader's vocabulary, such as a shared formula's PtgExp", () => {
    // PtgExp ([MS-XLS] 2.5.198.58): opcode 0x01. A real Formula record whose rgce is just this single token is exactly what a shared-formula member's own cell carries.
    const rgce = bytes(0x01, ...u32(0));
    expect(parseFormulaText(rgce, NO_SHEETS)).toBeUndefined();
  });

  it("aborts on a binary operator with too few operands rather than guessing", () => {
    const rgce = bytes(...ptgRef(0, 0), 0x03); // PtgAdd with only one operand pushed
    expect(parseFormulaText(rgce, NO_SHEETS)).toBeUndefined();
  });

  it("aborts on an empty token stream", () => {
    expect(parseFormulaText(bytes(), NO_SHEETS)).toBeUndefined();
  });

  it("aborts when the token stream leaves more than one value on the stack", () => {
    const rgce = bytes(...ptgRef(0, 0), ...ptgRef(0, 1)); // two operands, no combining operator
    expect(parseFormulaText(rgce, NO_SHEETS)).toBeUndefined();
  });
});
