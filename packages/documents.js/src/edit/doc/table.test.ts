import { describe, expect, it } from "vitest";
import { createDoc, openDoc } from "./editor";
import type { ContentBlock, ContentTable } from "document-schema.js";
import { DocTable, DocTableCell } from "./table";

function tableOf(rows: number, columns: number): DocTable {
  const table = createDoc().appendTable({ rows, columns });
  table.rows().forEach((row, rowIndex) => {
    row.cells().forEach((cell, columnIndex) => {
      cell.text = `r${rowIndex}c${columnIndex}`;
    });
  });
  return table;
}

function texts(table: DocTable): string[][] {
  return table.rows().map((row) => row.cells().map((cell) => cell.text));
}

describe("DocTable.mergeCells", () => {
  it("keeps every row dense: a horizontal merge leaves the covered position as an empty entry and the anchor's content in place", () => {
    const table = tableOf(2, 3);

    const anchor = table.mergeCells(0, 0, 1, 2);

    expect(anchor.colSpan).toBe(2);
    expect(anchor.rowSpan).toBeUndefined();
    expect(texts(table)).toEqual([
      ["r0c0", "", "r0c2"],
      ["r1c0", "r1c1", "r1c2"],
    ]);
    expect(table.rows().map((row) => row.cells().length)).toEqual([3, 3]);
  });

  it("states a vertical merge on the anchor alone and empties the covered entries below it", () => {
    const table = tableOf(3, 2);

    const anchor = table.mergeCells(0, 1, 3, 1);

    expect(anchor.rowSpan).toBe(3);
    expect(anchor.colSpan).toBeUndefined();
    expect(texts(table)).toEqual([
      ["r0c0", "r0c1"],
      ["r1c0", ""],
      ["r2c0", ""],
    ]);
  });

  it("merges a rectangle with the anchor at its top-left and every other position covered", () => {
    const table = tableOf(3, 3);

    const anchor = table.mergeCells(1, 1, 2, 2);

    expect(anchor.colSpan).toBe(2);
    expect(anchor.rowSpan).toBe(2);
    expect(texts(table)).toEqual([
      ["r0c0", "r0c1", "r0c2"],
      ["r1c0", "r1c1", ""],
      ["r2c0", "", ""],
    ]);
  });

  it("leaves a 1 x 1 merge as a no-op that returns the cell itself", () => {
    const table = tableOf(1, 2);

    const anchor = table.mergeCells(0, 1, 1, 1);

    expect(anchor.text).toBe("r0c1");
    expect(anchor.colSpan).toBeUndefined();
    expect(anchor.rowSpan).toBeUndefined();
    expect(texts(table)).toEqual([["r0c0", "r0c1"]]);
  });

  it("writes and re-reads a rectangle merge as the same dense table, with the discarded text absent", () => {
    const editor = createDoc();
    const table = editor.appendTable({ rows: 3, columns: 3 });
    table.rows().forEach((row, rowIndex) => {
      row.cells().forEach((cell, columnIndex) => {
        cell.text = `r${rowIndex}c${columnIndex}`;
      });
    });
    table.mergeCells(0, 0, 2, 2);

    const reread = openDoc(editor.toBytes()).tables()[0]!;

    expect(texts(reread)).toEqual([
      ["r0c0", "", "r0c2"],
      ["", "", "r1c2"],
      ["r2c0", "r2c1", "r2c2"],
    ]);
    expect(reread.rows()[0]!.cells()[0]!.colSpan).toBe(2);
    expect(reread.rows()[0]!.cells()[0]!.rowSpan).toBe(2);
    expect(reread.rows().map((row) => row.cells().length)).toEqual([3, 3, 3]);
  });

  it("refuses a rectangle that touches an existing merged region, as its anchor or as a covered position", () => {
    const table = tableOf(3, 3);
    table.mergeCells(0, 0, 2, 2);

    expect(() => table.mergeCells(0, 0, 1, 1)).toThrow(/already belongs/);
    expect(() => table.mergeCells(1, 1, 1, 2)).toThrow(
      /row 1, column 1 already belongs/,
    );
    expect(() => table.mergeCells(0, 2, 2, 1)).not.toThrow();
    expect(() => table.mergeCells(2, 0, 1, 2)).not.toThrow();
  });

  it("refuses a rectangle containing an anchor that spans columns only, or rows only", () => {
    const table = tableOf(3, 3);
    table.rows()[0]!.cells()[1]!.colSpan = 2;
    table.rows()[2]!.cells()[0]!.rowSpan = 2;

    expect(() => table.mergeCells(0, 0, 1, 2)).toThrow(
      /row 0, column 1 already belongs/,
    );
    expect(() => table.mergeCells(2, 0, 1, 1)).toThrow(
      /row 2, column 0 already belongs/,
    );
  });

  it("names the missing position when a row is shorter than the grid", () => {
    const shortRowTable = new DocTable([], {
      kind: "table",
      rows: [
        { cells: [{ blocks: [] }, { blocks: [] }] },
        { cells: [{ blocks: [] }] },
      ],
      columnWidthsPt: [10, 10],
    });

    expect(() => shortRowTable.mergeCells(1, 0, 1, 2)).toThrow(
      /column 1 does not exist in row 1/,
    );
  });

  it("throws for a non-positive or non-integer span, and for a rectangle outside the grid", () => {
    const table = tableOf(2, 2);

    expect(() => table.mergeCells(0, 0, 0, 1)).toThrow(/positive integer/);
    expect(() => table.mergeCells(0, 0, 1, 0)).toThrow(/positive integer/);
    expect(() => table.mergeCells(0, 0, 1.5, 1)).toThrow(/positive integer/);
    expect(() => table.mergeCells(0, 0, 1, 1.5)).toThrow(/positive integer/);
    expect(() => table.mergeCells(5, 0, 1, 1)).toThrow(
      /row 5, column 0 does not exist/,
    );
    expect(() => table.mergeCells(0, 5, 1, 1)).toThrow(
      /row 0, column 5 does not exist/,
    );
    expect(() => table.mergeCells(1, 0, 2, 1)).toThrow(
      /rowSpan 2 starting at row 1 exceeds this table's own 2 rows/,
    );
    expect(() => table.mergeCells(0, 1, 1, 2)).toThrow(
      /colSpan 2 starting at column 1 exceeds this table's own 2 columns/,
    );
  });

  it("leaves the table untouched when it throws part-way", () => {
    const table = tableOf(2, 2);
    table.rows()[1]!.cells()[1]!.colSpan = 2;

    expect(() => table.mergeCells(0, 0, 2, 2)).toThrow(/already belongs/);
    expect(texts(table)).toEqual([
      ["r0c0", "r0c1"],
      ["r1c0", "r1c1"],
    ]);
    expect(table.rows()[0]!.cells()[0]!.colSpan).toBeUndefined();
  });

  it("throws on a removed table", () => {
    const table = tableOf(1, 2);
    table.remove();
    expect(() => table.mergeCells(0, 0, 1, 2)).toThrow(/removed/);
  });
});

function emptyNodeTable(): ContentTable {
  return { kind: "table", rows: [], columnWidthsPt: [] };
}

describe("DocTableCell", () => {
  it("clears a span by removing the field from the node, not by storing undefined", () => {
    const node: { blocks: []; colSpan?: number; rowSpan?: number } = {
      blocks: [],
      colSpan: 2,
      rowSpan: 3,
    };
    const cell = new DocTableCell(node);

    cell.colSpan = undefined;
    cell.rowSpan = undefined;

    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
    expect("colSpan" in node).toBe(false);
    expect("rowSpan" in node).toBe(false);
  });

  it("reads paragraphs only, and joins their text with a newline", () => {
    const cell = new DocTableCell({ blocks: [] });
    cell.appendParagraph({ text: "one" });
    cell.appendParagraph({ text: "two" });
    const nested: ContentBlock = emptyNodeTable();
    const withTable = new DocTableCell({ blocks: [nested] });

    expect(cell.text).toBe("one\ntwo");
    expect(cell.paragraphs().map((paragraph) => paragraph.text)).toEqual([
      "one",
      "two",
    ]);
    expect(withTable.paragraphs()).toHaveLength(0);
    expect(withTable.text).toBe("");
  });
});

describe("DocTable rows and removal", () => {
  it("builds each new cell holding one empty paragraph, and appends rows as wide as the grid", () => {
    const table = createDoc().appendTable({ rows: 1, columns: 3 });

    const appended = table.appendRow();

    expect(table.rows()).toHaveLength(2);
    expect(appended.cells()).toHaveLength(3);
    expect(
      table
        .rows()
        .flatMap((row) => row.cells().map((c) => c.paragraphs().length)),
    ).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("removes itself from its container, and leaves the container alone when it is no longer in it", () => {
    const node = emptyNodeTable();
    const other: ContentBlock = emptyNodeTable();
    const container: ContentBlock[] = [other, node];

    new DocTable(container, node).remove();
    expect(container).toEqual([other]);

    new DocTable(container, emptyNodeTable()).remove();
    expect(container).toEqual([other]);
  });
});

describe("DocTable grid view", () => {
  it("resolves a merged region's covered positions to its anchor, leaving the row as wide as the table", () => {
    const table = tableOf(3, 3);
    table.mergeCells(0, 0, 2, 2);

    expect(table.gridColumnCount()).toBe(3);
    const grid = table.gridRows();
    expect(
      grid.map((row) =>
        row.map((position) =>
          position === undefined
            ? "-"
            : `${position.cell.text}${position.isAnchor ? "" : "*"}`,
        ),
      ),
    ).toEqual([
      ["r0c0", "r0c0*", "r0c2"],
      ["r0c0*", "r0c0*", "r1c2"],
      ["r2c0", "r2c1", "r2c2"],
    ]);
  });

  it("is empty for a table with no rows and no columns", () => {
    const table = createDoc().appendTable({ rows: 0, columns: 0 });
    expect(table.gridColumnCount()).toBe(0);
    expect(table.gridRows()).toEqual([]);
  });
});
