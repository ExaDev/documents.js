import { describe, expect, it } from "vitest";
import type { FormulaSheetContext } from "../biff/ptg";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { readRecords } from "../biff/records";
import { record, u16, u32, xlUnicodeString } from "../test-support/biff";
import { RECORD_DV } from "../biff/record-types";
import { readDv } from "./data-validation";

// Dv ([MS-XLS] 2.4.95): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/862bbc7c-009a-4fd6-a93e-3e32e591c2f8. Every byte layout exercised here is built directly to that published field table (flags DWORD, four XLUnicodeStrings, one or two DVParsedFormula structures, a trailing SqRefU range list) -- this is a real Microsoft-published binary grammar, not a producer-specific convention transcribed from LibreOffice source the way odf.js's own calcext:condition reading needed.

const NO_SHEETS: FormulaSheetContext = { sheets: [], sheetRanges: [] };

/** PtgInt ([MS-XLS] 2.5.198.66): opcode 0x1E then an unsigned 16-bit value -- the simplest possible formula token, used here only to prove formula bytes are read and handed to parseFormulaText, not to exercise that parser's own grammar (biff/ptg.test.ts already does that exhaustively). */
function ptgInt(value: number): number[] {
  return [0x1e, ...u16(value)];
}

/** A DVParsedFormula: cce, two unused bytes, then that many rgce bytes. Pass an empty array of tokens for "no formula" (cce 0). */
function dvFormula(tokens: readonly number[]): number[] {
  return [...u16(tokens.length), ...u16(0), ...tokens];
}

function sqRefU(
  ...ranges: readonly {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  }[]
): number[] {
  return [
    ...u16(ranges.length),
    ...ranges.flatMap((r) => [
      ...u16(r.startRow),
      ...u16(r.endRow),
      ...u16(r.startColumn),
      ...u16(r.endColumn),
    ]),
  ];
}

function dvRecord(
  flags: number,
  promptTitle: string,
  errorTitle: string,
  prompt: string,
  error: string,
  formula1: readonly number[],
  formula2: readonly number[],
  ranges: readonly {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  }[],
): RecordGroup {
  const bytes = record(RECORD_DV, [
    ...u32(flags),
    ...xlUnicodeString(promptTitle),
    ...xlUnicodeString(errorTitle),
    ...xlUnicodeString(prompt),
    ...xlUnicodeString(error),
    ...dvFormula(formula1),
    ...dvFormula(formula2),
    ...sqRefU(...ranges),
  ]);
  const groups = groupRecords(readRecords(bytes));
  const group = groups[0];
  if (group === undefined) {
    throw new Error("test setup produced no record group");
  }
  return group;
}

// flags DWORD bit layout, LSB first: valType(4) errStyle(3) fStrLookup(1) fAllowBlank(1) fSuppressCombo(1) mdImeMode(8) fShowInputMsg(1) fShowErrorMsg(1) typOperator(4) reserved(8).
function dvFlags(options: {
  valType: number;
  errStyle?: number;
  fAllowBlank?: boolean;
  fShowInputMsg?: boolean;
  fShowErrorMsg?: boolean;
  typOperator?: number;
}): number {
  return (
    (options.valType & 0xf) |
    ((options.errStyle ?? 0) << 4) |
    ((options.fAllowBlank === true ? 1 : 0) << 8) |
    ((options.fShowInputMsg === true ? 1 : 0) << 18) |
    ((options.fShowErrorMsg === true ? 1 : 0) << 19) |
    ((options.typOperator ?? 0) << 20)
  );
}

describe("readDv", () => {
  it("reads a whole-number 'between' rule with two formulas", () => {
    const group = dvRecord(
      dvFlags({ valType: 0x1, typOperator: 0x0, fAllowBlank: true }),
      "",
      "",
      "",
      "",
      ptgInt(1),
      ptgInt(10),
      [{ startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 }],
    );

    expect(readDv(group, NO_SHEETS)).toStrictEqual({
      type: "whole",
      operator: "between",
      formula1: "1",
      formula2: "10",
      allowBlank: true,
      showInputMessage: false,
      showErrorMessage: false,
      errorStyle: "stop",
      promptTitle: "",
      errorTitle: "",
      prompt: "",
      error: "",
      ranges: [{ startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 }],
    });
  });

  it("reads every typOperator value against SheetRuleOperator, not table:condition's own different ordering", () => {
    const cases: [number, string][] = [
      [0x0, "between"],
      [0x1, "notBetween"],
      [0x2, "equal"],
      [0x3, "notEqual"],
      [0x4, "greaterThan"],
      [0x5, "lessThan"],
      [0x6, "greaterThanOrEqual"],
      [0x7, "lessThanOrEqual"],
    ];
    for (const [typOperator, operator] of cases) {
      const group = dvRecord(
        dvFlags({ valType: 0x2, typOperator }),
        "",
        "",
        "",
        "",
        ptgInt(5),
        [],
        [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      );
      expect(readDv(group, NO_SHEETS)?.operator).toBe(operator);
    }
  });

  it("omits operator for 'list' (valType 3) and 'custom' (valType 7), matching ContentSheetDataValidationSchema's own contract", () => {
    const list = dvRecord(
      dvFlags({ valType: 0x3 }),
      "",
      "",
      "",
      "",
      ptgInt(1),
      [],
      [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
    );
    expect(readDv(list, NO_SHEETS)?.type).toBe("list");
    expect(readDv(list, NO_SHEETS)?.operator).toBeUndefined();

    const custom = dvRecord(
      dvFlags({ valType: 0x7 }),
      "",
      "",
      "",
      "",
      ptgInt(1),
      [],
      [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
    );
    expect(readDv(custom, NO_SHEETS)?.type).toBe("custom");
    expect(readDv(custom, NO_SHEETS)?.operator).toBeUndefined();
  });

  it("degrades valType 0 ('any', no type check) to 'custom' with no formula, the same 'no real type signal' default the ODF reader uses", () => {
    const group = dvRecord(
      dvFlags({ valType: 0x0 }),
      "",
      "",
      "",
      "",
      [],
      [],
      [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
    );
    const result = readDv(group, NO_SHEETS);
    expect(result?.type).toBe("custom");
    expect(result?.formula1).toBeUndefined();
    expect(result?.operator).toBeUndefined();
  });

  it("reads prompt/error titles and messages, and the input/error-message flags", () => {
    const group = dvRecord(
      dvFlags({
        valType: 0x1,
        typOperator: 0x4,
        fShowInputMsg: true,
        fShowErrorMsg: true,
        errStyle: 0x1,
      }),
      "Enter a number",
      "Invalid entry",
      "Must be positive",
      "That value is not allowed",
      ptgInt(0),
      [],
      [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
    );

    expect(readDv(group, NO_SHEETS)).toMatchObject({
      showInputMessage: true,
      showErrorMessage: true,
      errorStyle: "warning",
      promptTitle: "Enter a number",
      errorTitle: "Invalid entry",
      prompt: "Must be positive",
      error: "That value is not allowed",
    });
  });

  it("reads a multi-range SqRefU list in full", () => {
    const group = dvRecord(
      dvFlags({ valType: 0x4, typOperator: 0x2 }),
      "",
      "",
      "",
      "",
      ptgInt(1),
      [],
      [
        { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        { startRow: 2, endRow: 4, startColumn: 1, endColumn: 3 },
      ],
    );

    expect(readDv(group, NO_SHEETS)?.ranges).toStrictEqual([
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 2, endRow: 4, startColumn: 1, endColumn: 3 },
    ]);
  });

  it("degrades to undefined on a truncated record rather than throwing", () => {
    // A flags DWORD claiming a range count field that was never written.
    const bytes = record(RECORD_DV, [...u32(dvFlags({ valType: 0x0 }))]);
    const group = groupRecords(readRecords(bytes))[0];
    if (group === undefined)
      throw new Error("test setup produced no record group");

    expect(readDv(group, NO_SHEETS)).toBeUndefined();
  });
});
