import type {
  ContentSheet,
  ContentSheetCell,
  ContentTable,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { sheetToTable } from "./sheet-table";

function cell(row: number, column: number, text: string): ContentSheetCell {
  return {
    row,
    column,
    value: { kind: "string", value: text },
    displayText: text,
  };
}

function sheet(
  cells: readonly ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name: "Sheet1",
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: {
      pageSize: { widthPt: 600, heightPt: 800 },
      margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    },
    ...overrides,
  };
}

function texts(table: ContentTable | undefined): string[][] | undefined {
  return table?.rows.map((row) =>
    row.cells.map((tableCell) =>
      tableCell.blocks
        .flatMap((block) =>
          block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
        )
        .join(""),
    ),
  );
}

describe("sheetToTable", () => {
  it("spans only the rows and columns holding a visible cell, in sheet order, so a blank spacer row, an empty leading column and a hidden row add nothing", () => {
    const flattened = sheetToTable(
      sheet(
        [
          cell(4, 3, "D5"),
          cell(0, 1, "B1"),
          cell(2, 1, "B3"),
          cell(3, 3, "Hidden"),
          cell(2, 3, "D3"),
        ],
        {
          rows: [{ index: 3, heightPt: 10, hidden: true }],
          columns: [{ index: 3, widthPt: 40 }],
        },
      ),
    );
    expect(texts(flattened?.table)).toEqual([
      ["B1", ""],
      ["B3", "D3"],
      ["", "D5"],
    ]);
    expect(flattened?.table.columns).toEqual([
      { widthPt: 72 },
      { widthPt: 40 },
    ]);
    expect(flattened?.hiddenRowCount).toBe(1);
    expect(flattened?.hiddenColumnCount).toBe(0);
  });
});
