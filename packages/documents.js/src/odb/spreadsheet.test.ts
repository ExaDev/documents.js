import type { HsqldbTable } from "../hsqldb/script";
import { describe, expect, it } from "vitest";
import { odbTablesToSpreadsheetDocument } from "./spreadsheet";

const TABLE: HsqldbTable = {
  tableName: "CUSTOMERS",
  columns: [
    { name: "ID", type: "INTEGER" },
    { name: "NAME", type: "VARCHAR(50)" },
  ],
  rows: [
    [
      { kind: "number", value: 1 },
      { kind: "string", value: "Alice" },
    ],
    [{ kind: "number", value: 2 }, { kind: "empty" }],
  ],
};

describe("odbTablesToSpreadsheetDocument", () => {
  it("produces a spreadsheet ContentDocument with one sheet named after the table", () => {
    const content = odbTablesToSpreadsheetDocument([TABLE]);
    expect(content.kind).toBe("spreadsheet");
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets).toHaveLength(1);
    expect(content.sheets[0]?.name).toBe("CUSTOMERS");
  });

  it("writes a header row (row 0) of string cells from the column names", () => {
    const content = odbTablesToSpreadsheetDocument([TABLE]);
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const header = content.sheets[0]?.cells
      .filter((cell) => cell.row === 0)
      .sort((a, b) => a.column - b.column);
    expect(header).toEqual([
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "ID" },
        displayText: "ID",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "string", value: "NAME" },
        displayText: "NAME",
      },
    ]);
  });

  it("writes data rows starting at row 1, each cell carrying the original typed value and a matching displayText", () => {
    const content = odbTablesToSpreadsheetDocument([TABLE]);
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const row1 = content.sheets[0]?.cells
      .filter((cell) => cell.row === 1)
      .sort((a, b) => a.column - b.column);
    expect(row1).toEqual([
      {
        row: 1,
        column: 0,
        value: { kind: "number", value: 1 },
        displayText: "1",
      },
      {
        row: 1,
        column: 1,
        value: { kind: "string", value: "Alice" },
        displayText: "Alice",
      },
    ]);
    const row2 = content.sheets[0]?.cells
      .filter((cell) => cell.row === 2)
      .sort((a, b) => a.column - b.column);
    expect(row2).toEqual([
      {
        row: 2,
        column: 0,
        value: { kind: "number", value: 2 },
        displayText: "2",
      },
      { row: 2, column: 1, value: { kind: "empty" }, displayText: "" },
    ]);
  });

  it("produces a real, non-empty printSettings for every sheet, so the xlsx builder has something to write", () => {
    const content = odbTablesToSpreadsheetDocument([TABLE]);
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets[0]?.printSettings.pageSize.widthPt).toBeGreaterThan(
      0,
    );
  });

  it("produces an empty sheets array for no tables", () => {
    const content = odbTablesToSpreadsheetDocument([]);
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets).toEqual([]);
  });
});
