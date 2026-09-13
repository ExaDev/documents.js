import {
  createOds,
  type ContentSheet,
  type ContentSheetCell,
} from "documents.js";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../../state/reducer.js";
import type { AppState, OdsOpenDocument } from "../../../state/types.js";
import {
  buildCellValue,
  cellKey,
  cellLookup,
  inferKind,
  odsDocument,
  rawEditableText,
  resolveSheet,
  sheetExtent,
} from "./shared";

describe("odsDocument", () => {
  it("returns the open ods document", () => {
    const editor = createOds();
    const doc: OdsOpenDocument = { format: "ods", editor, path: undefined };
    const state: AppState = { ...createInitialState(), openDocument: doc };
    expect(odsDocument(state)).toBe(doc);
  });

  it("throws when the open document is not ods", () => {
    const state: AppState = {
      ...createInitialState(),
      openDocument: undefined,
    };
    expect(() => odsDocument(state)).toThrow(/was not ods/);
  });
});

describe("resolveSheet", () => {
  it("resolves the first sheet of a freshly created ods document", () => {
    const editor = createOds();
    const sheet = resolveSheet(editor, 0);
    expect(sheet).toBeDefined();
  });

  it("returns undefined for a sheet index beyond the document", () => {
    const editor = createOds();
    expect(resolveSheet(editor, 99)).toBeUndefined();
  });
});

describe("sheetExtent", () => {
  it("floors to 1x1 for an undefined sheet", () => {
    expect(sheetExtent(undefined)).toEqual({ rowCount: 1, columnCount: 1 });
  });

  it("floors to 1x1 for a sheet with no cells, rows, or columns at all", () => {
    const sheet = {
      cells: [],
      rows: [],
      columns: [],
    } as unknown as ContentSheet;
    expect(sheetExtent(sheet)).toEqual({ rowCount: 1, columnCount: 1 });
  });

  it("derives extent from the furthest populated cell", () => {
    const sheet = {
      cells: [{ row: 3, column: 2, value: { kind: "empty" } }],
      rows: [],
      columns: [],
    } as unknown as ContentSheet;
    expect(sheetExtent(sheet)).toEqual({ rowCount: 4, columnCount: 3 });
  });

  it("derives extent from a declared row/column beyond any populated cell", () => {
    const sheet = {
      cells: [{ row: 1, column: 1, value: { kind: "empty" } }],
      rows: [{ index: 9 }],
      columns: [{ index: 7 }],
    } as unknown as ContentSheet;
    expect(sheetExtent(sheet)).toEqual({ rowCount: 10, columnCount: 8 });
  });
});

describe("cellKey", () => {
  it("joins row and column with a colon", () => {
    expect(cellKey(3, 5)).toBe("3:5");
  });

  it("distinguishes (1,23) from (12,3)", () => {
    expect(cellKey(1, 23)).not.toBe(cellKey(12, 3));
  });
});

describe("cellLookup", () => {
  it("returns an empty map for an undefined sheet", () => {
    expect(cellLookup(undefined).size).toBe(0);
  });

  it("indexes every cell by its own row:column key", () => {
    const cellA = { row: 0, column: 0, value: { kind: "string", value: "A" } };
    const cellB = { row: 1, column: 2, value: { kind: "string", value: "B" } };
    const sheet = { cells: [cellA, cellB] } as unknown as ContentSheet;
    const map = cellLookup(sheet);
    expect(map.get("0:0")).toBe(cellA as unknown as ContentSheetCell);
    expect(map.get("1:2")).toBe(cellB as unknown as ContentSheetCell);
    expect(map.size).toBe(2);
  });
});

describe("rawEditableText", () => {
  it("returns an empty string for empty", () => {
    expect(rawEditableText({ kind: "empty" })).toBe("");
  });

  it("returns the raw value for string/date/time/dateTime/error", () => {
    expect(rawEditableText({ kind: "string", value: "hi" })).toBe("hi");
    expect(rawEditableText({ kind: "date", value: "2024-01-01" })).toBe(
      "2024-01-01",
    );
    expect(rawEditableText({ kind: "time", value: "12:00" })).toBe("12:00");
    expect(
      rawEditableText({ kind: "dateTime", value: "2024-01-01T12:00" }),
    ).toBe("2024-01-01T12:00");
    expect(rawEditableText({ kind: "error", value: "#REF!" })).toBe("#REF!");
  });

  it("renders TRUE/FALSE for boolean", () => {
    expect(rawEditableText({ kind: "boolean", value: true })).toBe("TRUE");
    expect(rawEditableText({ kind: "boolean", value: false })).toBe("FALSE");
  });

  it("stringifies the numeric value for number/percentage/currency", () => {
    expect(rawEditableText({ kind: "number", value: 42.5 })).toBe("42.5");
    expect(rawEditableText({ kind: "percentage", value: 0.5 })).toBe("0.5");
    expect(
      rawEditableText({ kind: "currency", value: 10, currency: "USD" }),
    ).toBe("10");
  });
});

describe("inferKind", () => {
  it("infers empty for blank/whitespace-only input", () => {
    expect(inferKind("")).toBe("empty");
    expect(inferKind("   ")).toBe("empty");
  });

  it("infers boolean for true/false, case-insensitively", () => {
    expect(inferKind("true")).toBe("boolean");
    expect(inferKind("FALSE")).toBe("boolean");
  });

  it("infers number for an integer or decimal, including negative", () => {
    expect(inferKind("42")).toBe("number");
    expect(inferKind("-3.5")).toBe("number");
  });

  it("infers string for anything else", () => {
    expect(inferKind("hello")).toBe("string");
    expect(inferKind("42abc")).toBe("string");
  });
});

describe("buildCellValue", () => {
  it("builds empty regardless of text", () => {
    expect(buildCellValue("empty", "anything")).toEqual({ kind: "empty" });
  });

  it("builds string verbatim, including empty text", () => {
    expect(buildCellValue("string", "hello")).toEqual({
      kind: "string",
      value: "hello",
    });
    expect(buildCellValue("string", "")).toEqual({
      kind: "string",
      value: "",
    });
  });

  it("builds boolean from true/false case-insensitively, trimmed", () => {
    expect(buildCellValue("boolean", " True ")).toEqual({
      kind: "boolean",
      value: true,
    });
    expect(buildCellValue("boolean", "FALSE")).toEqual({
      kind: "boolean",
      value: false,
    });
  });

  it("rejects a boolean value that isn't true or false", () => {
    expect(buildCellValue("boolean", "maybe")).toBeUndefined();
  });

  it("builds number from a finite numeric string", () => {
    expect(buildCellValue("number", "42.5")).toEqual({
      kind: "number",
      value: 42.5,
    });
  });

  it("rejects a non-numeric or empty number", () => {
    expect(buildCellValue("number", "abc")).toBeUndefined();
    expect(buildCellValue("number", "")).toBeUndefined();
  });

  it("builds percentage, stripping a trailing % sign", () => {
    expect(buildCellValue("percentage", "50%")).toEqual({
      kind: "percentage",
      value: 50,
    });
  });

  it("rejects an unparsable percentage", () => {
    expect(buildCellValue("percentage", "%")).toBeUndefined();
  });

  it("builds currency, stripping non-numeric characters", () => {
    expect(buildCellValue("currency", "$1,234.56")).toEqual({
      kind: "currency",
      value: 1234.56,
    });
  });

  it("rejects an unparsable currency", () => {
    expect(buildCellValue("currency", "$")).toBeUndefined();
  });

  it("builds date/time/dateTime/error from trimmed non-empty text", () => {
    expect(buildCellValue("date", " 2024-01-01 ")).toEqual({
      kind: "date",
      value: "2024-01-01",
    });
    expect(buildCellValue("time", " 12:00 ")).toEqual({
      kind: "time",
      value: "12:00",
    });
    expect(buildCellValue("dateTime", " 2024-01-01T12:00 ")).toEqual({
      kind: "dateTime",
      value: "2024-01-01T12:00",
    });
    expect(buildCellValue("error", " #REF! ")).toEqual({
      kind: "error",
      value: "#REF!",
    });
  });

  it("rejects empty/whitespace-only text for date/time/dateTime/error", () => {
    expect(buildCellValue("date", "   ")).toBeUndefined();
    expect(buildCellValue("time", "")).toBeUndefined();
    expect(buildCellValue("dateTime", "  ")).toBeUndefined();
    expect(buildCellValue("error", "")).toBeUndefined();
  });
});
