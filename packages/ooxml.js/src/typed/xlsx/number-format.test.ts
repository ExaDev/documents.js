import { describe, expect, it } from "vitest";
import type { CellNumberFormat } from "./number-format";
import {
  AMOUNT_NUMBER_FORMAT,
  BOOLEAN_NUMBER_FORMAT,
  currencyNumberFormat,
  DATE_NUMBER_FORMAT,
  DATE_TIME_NUMBER_FORMAT,
  PERCENTAGE_NUMBER_FORMAT,
  TIME_NUMBER_FORMAT,
} from "./number-format";
import {
  BUILTIN_NUMBER_FORMATS,
  classifyNumberFormat,
} from "excel-number-format";

// The classifier itself (tokenizeNumberFormat, splitNumberFormatSections, classifyNumberFormat, BUILTIN_NUMBER_FORMATS) is tested in excel-number-format's own suite now, and this module imports it directly from there (ExaDev/documents.js#848). What is genuinely local to this package is the WRITE side below: the formats typed/xlsx/build.ts actually emits for a ContentCellValue kind xlsx cannot express as a cell type, checked against the shared classifier so the two can never drift apart.
describe("the formats typed/xlsx/build.ts writes classify back to the kind they were chosen for", () => {
  function codeOf(format: CellNumberFormat): string {
    if (format.kind === "custom") {
      return format.code;
    }
    const builtin = BUILTIN_NUMBER_FORMATS.get(format.id);
    if (builtin === undefined) {
      throw new Error(
        `numFmtId ${format.id} is not a built-in this package can write by id alone`,
      );
    }
    return builtin;
  }

  it("writes a percentage and a time of day as built-in ids, not as custom codes", () => {
    expect(PERCENTAGE_NUMBER_FORMAT).toEqual({ kind: "builtin", id: 10 });
    expect(TIME_NUMBER_FORMAT).toEqual({ kind: "builtin", id: 21 });
    expect(classifyNumberFormat(codeOf(PERCENTAGE_NUMBER_FORMAT))).toEqual({
      kind: "percentage",
    });
    expect(classifyNumberFormat(codeOf(TIME_NUMBER_FORMAT))).toEqual({
      kind: "time",
    });
  });

  it("writes ISO-ordered date and dateTime codes that classify as date and dateTime, not as each other", () => {
    expect(codeOf(DATE_NUMBER_FORMAT)).toBe("yyyy\\-mm\\-dd");
    expect(codeOf(DATE_TIME_NUMBER_FORMAT)).toBe("yyyy\\-mm\\-dd hh:mm:ss");
    expect(classifyNumberFormat(codeOf(DATE_NUMBER_FORMAT))).toEqual({
      kind: "date",
    });
    expect(classifyNumberFormat(codeOf(DATE_TIME_NUMBER_FORMAT))).toEqual({
      kind: "dateTime",
    });
  });

  it("carries a currency's ISO code through the format itself, recovering the exact code on the way back", () => {
    expect(currencyNumberFormat("GBP")).toEqual({
      kind: "custom",
      code: "[$GBP]#,##0.00",
    });
    expect(classifyNumberFormat(codeOf(currencyNumberFormat("GBP")))).toEqual({
      kind: "currency",
      code: "GBP",
    });
    expect(classifyNumberFormat(codeOf(currencyNumberFormat("usd")))).toEqual({
      kind: "currency",
      code: "USD",
    });
  });

  it("falls back to the plain amount format for a currency naming no ISO code, or naming something that is not one", () => {
    expect(currencyNumberFormat(undefined)).toEqual(AMOUNT_NUMBER_FORMAT);
    // Not an ISO-code shape: interpolating either into a [$...] bracket would produce a malformed format code.
    expect(currencyNumberFormat("£")).toEqual(AMOUNT_NUMBER_FORMAT);
    expect(currencyNumberFormat("Pounds]")).toEqual(AMOUNT_NUMBER_FORMAT);
    // The documented, deliberate loss: nothing in the plain amount format says money.
    expect(classifyNumberFormat(codeOf(AMOUNT_NUMBER_FORMAT))).toEqual({
      kind: "number",
    });
  });

  it("writes the boolean display format as real, quoted three-section markup, matching LibreOffice's own numFmtId 165 verbatim", () => {
    expect(codeOf(BOOLEAN_NUMBER_FORMAT)).toBe('"TRUE";"TRUE";"FALSE"');
    // Its own classification is irrelevant to reading a boolean back (t="b" decides that outright, before any format is consulted) -- it exists so real Excel and Calc DISPLAY the stored 1/0 as TRUE/FALSE.
    expect(classifyNumberFormat(codeOf(BOOLEAN_NUMBER_FORMAT))).toEqual({
      kind: "number",
    });
  });
});
