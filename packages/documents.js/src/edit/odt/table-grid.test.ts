import type { XmlElement } from "odf.js";
import { decodePackage, encodePackage } from "odf.js";
import { findTableGridFault, tableGridColumnCount } from "document-schema.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "../../odf/odt/read";
import { el, txt } from "../../xml/fragment";
import { walkElements } from "../../xml/query";
import { createOdt } from "./editor";
import type { OdtTable } from "./table";
function contentElements(
  editor: ReturnType<typeof createOdt>,
  tag: string,
): XmlElement[] {
  const part = editor.toPackage().parts["content.xml"];
  if (part?.kind !== "xml") {
    throw new Error("expected an xml content.xml part");
  }
  const out: XmlElement[] = [];
  for (const { node } of walkElements(part.nodes)) {
    if (node.tag === tag) {
      out.push(node);
    }
  }
  return out;
}

function coveredCellElements(
  editor: ReturnType<typeof createOdt>,
): XmlElement[] {
  return contentElements(editor, "table:covered-table-cell");
}

function odtGridLabels(table: OdtTable): string[][] {
  return table
    .gridRows()
    .map((row) =>
      row.map((position) =>
        position === undefined
          ? "-"
          : `${position.cell.text.trim()}${position.isAnchor ? "" : "*"}`,
      ),
    );
}

describe("table:number-columns-repeated", () => {
  it("expands a repeated cell into that many grid columns, agreeing with the content pivot's own column count", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.cell(0, 0).appendParagraph({ text: "A" });
    table.cell(0, 1).appendParagraph({ text: "B" });
    const [cellA] = contentElements(editor, "table:table-cell");
    cellA?.attributes.push({
      name: "table:number-columns-repeated",
      value: "3",
    });

    // cellA now stands for grid columns 0-2 (all reading "A"), cellB for column 3 — 4 grid columns from 2 physical table:table-cell elements.
    expect(table.gridColumnCount()).toBe(4);
    expect(odtGridLabels(table)).toEqual([["A", "A", "A", "B"]]);

    const content = readOdtContent(editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const pivot = content.sections[0]?.blocks.find((b) => b.kind === "table");
    if (pivot?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(table.gridColumnCount()).toBe(tableGridColumnCount(pivot));
    expect(pivot.rows[0]?.cells).toHaveLength(4);
  });

  it("widens the grid via a declared table:table-column's own repeat, agreeing with the content pivot's own columns length", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 0, columns: 2 });
    const [firstColumn] = contentElements(editor, "table:table-column");
    firstColumn?.attributes.push({
      name: "table:number-columns-repeated",
      value: "4",
    });

    // 4 (the first column's repeat) + 1 (the second, un-repeated column) = 5 declared grid columns, from 2 physical table:table-column elements.
    expect(table.gridColumnCount()).toBe(5);

    const content = readOdtContent(editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const pivot = content.sections[0]?.blocks.find((b) => b.kind === "table");
    if (pivot?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(table.gridColumnCount()).toBe(pivot.columns.length);
  });

  it("mergeCellsHorizontally reaches a column after a repeated cell, which physical-child-index addressing could not", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.cell(0, 0).appendParagraph({ text: "A" });
    table.cell(0, 1).appendParagraph({ text: "B" });
    const [cellA] = contentElements(editor, "table:table-cell");
    cellA?.attributes.push({
      name: "table:number-columns-repeated",
      value: "3",
    });

    // Grid columns 0-2 are cellA's repeat, column 3 is cellB — but only 2 physical table:table-cell elements exist, so a physical-array lookup (this row's old gridCellElements) would say column 3 "does not exist" even though it plainly does.
    const anchor = table.rows()[0]!.mergeCellsHorizontally(3, 1);
    expect(anchor.text).toContain("B");
    expect(anchor.colSpan).toBe(1);
  });

  it("throws for a column beyond a repeated cell's own true grid width, not beyond its physical element count", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const [cellA] = contentElements(editor, "table:table-cell");
    cellA?.attributes.push({
      name: "table:number-columns-repeated",
      value: "2",
    });

    // One physical element, two real grid columns (0 and 1) — column 2 genuinely does not exist.
    expect(() => table.rows()[0]!.mergeCellsHorizontally(2, 1)).toThrow(
      /column 2 does not exist/,
    );
    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 3)).toThrow(
      /exceeds this row's own 2 grid columns/,
    );
  });

  it("splits a repeated cell's run when a merge targets a column inside it, leaving the untouched part of the run with its own original content intact", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.cell(0, 0).appendParagraph({ text: "A" });
    table.cell(0, 1).appendParagraph({ text: "B" });
    const [cellA] = contentElements(editor, "table:table-cell");
    cellA?.attributes.push({
      name: "table:number-columns-repeated",
      value: "3",
    });

    // Grid columns 0-2 are cellA's repeat (all reading "A"), column 3 is cellB. Merging columns 1-2 (both inside the repeat) must un-repeat exactly those two columns, leaving column 0's own copy of the run untouched.
    const anchor = table.rows()[0]!.mergeCellsHorizontally(1, 2);
    anchor.appendParagraph({ text: "merged" });

    const gridRow = table.gridRows()[0]!;
    expect(gridRow[0]!.cell.text.trim()).toBe("A");
    expect(gridRow[0]!.isAnchor).toBe(true);
    expect(gridRow[1]!.cell.text).toContain("merged");
    expect(gridRow[1]!.isAnchor).toBe(true);
    expect(gridRow[2]!.cell.text).toContain("merged");
    expect(gridRow[2]!.isAnchor).toBe(false);
    expect(gridRow[3]!.cell.text.trim()).toBe("B");

    // No table:number-columns-repeated survives anywhere: the run that used to cover the merged columns was split into individually-addressable elements, none of which stands for more than one column any longer.
    const stillRepeated = contentElements(editor, "table:table-cell").filter(
      (element) => attr(element, "table:number-columns-repeated") !== undefined,
    );
    expect(stillRepeated).toHaveLength(0);

    // The XML this produced is well-formed ODF that reads back through odf.js's own pivot reader identically to what the live grid view reports.
    const pkg = decodePackage(encodePackage(editor.toPackage()));
    const content = readOdtContent(pkg);
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const roundTrippedTable = content.sections[0]?.blocks.find(
      (b) => b.kind === "table",
    );
    if (roundTrippedTable?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[0]?.cells[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
    });
    expect(roundTrippedTable.rows[0]?.cells[1]?.colSpan).toBe(2);
  });

  it("markCellCovered individuates a column inside an already-covered repeated run", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const row = table.rows()[0]!;
    const rowElement = contentElements(editor, "table:table-row")[0]!;
    // Directly authoring the shape an external producer compressing a run of covered positions might leave: one real anchor cell, followed by a covered run standing for 2 more grid columns.
    rowElement.children = [
      el("table:table-cell", {}, [el("text:p", {}, [txt("anchor")])]),
      el("table:covered-table-cell", {
        "table:number-columns-repeated": "2",
      }),
    ];

    row.markCellCovered(2);

    const covered = coveredCellElements(editor);
    expect(covered).toHaveLength(2);
    expect(
      covered.map((element) => attr(element, "table:number-columns-repeated")),
    ).toEqual([undefined, undefined]);
  });

  it("markCellCovered throws for a column beyond the row's true grid width, honouring a covered run's own repeat", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const row = table.rows()[0]!;
    const rowElement = contentElements(editor, "table:table-row")[0]!;
    rowElement.children = [
      el("table:table-cell", {}, [el("text:p", {}, [txt("anchor")])]),
      el("table:covered-table-cell", {
        "table:number-columns-repeated": "2",
      }),
    ];

    // 1 real column + 2 covered columns = 3 grid columns total; column 3 does not exist.
    expect(() => {
      row.markCellCovered(3);
    }).toThrow(/markCellCovered: column 3 does not exist in this row/);
  });
});

describe("OdtTableRow grid columns ignore elements that are not cells", () => {
  it("does not count a stray element as a grid column when merging or marking a cell covered", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 3 });
    const rowElement = contentElements(editor, "table:table-row")[0];
    rowElement?.children.unshift(el("text:soft-page-break"));
    const row = table.rows()[0]!;

    expect(() => row.mergeCellsHorizontally(0, 4)).toThrow(
      /exceeds this row's own 3 grid columns/,
    );
    row.mergeCellsHorizontally(0, 2);
    expect(row.cells().map((cell) => cell.colSpan)).toEqual([2, undefined]);
    expect(() => {
      row.markCellCovered(3);
    }).toThrow(/markCellCovered: column 3 does not exist in this row/);
    row.markCellCovered(2);
    expect(coveredCellElements(editor)).toHaveLength(2);
  });
});

describe("OdtTable.mergeCells", () => {
  it("merges a rowSpan x colSpan rectangle, proving the true-grid-column-index property through a prior horizontal merge", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 4 });

    // First, horizontally merge row 0's columns 1-2 — this changes row 0's own shape (3 real cells instead of 4).
    table.rows()[0]!.mergeCellsHorizontally(1, 2);

    // Now merge a rowSpan=2 rectangle starting at grid column 1, spanning 2 columns, over BOTH rows — this must correctly find grid column 1 in row 0 (now the already-merged anchor) and mark row 1's TRUE grid columns 1 and 2 as covered, despite row 0's own different real-cell-count shape.
    const anchor = table.mergeCells(0, 1, 2, 2);
    anchor.appendParagraph({ text: "block" });

    expect(table.cell(0, 1).colSpan).toBe(2);
    expect(table.cell(0, 1).rowSpan).toBe(2);
    // row 1 now has 2 real cells (col 0 and col 3) plus 2 covered positions (cols 1-2)
    expect(table.rows()[1]!.cells()).toHaveLength(2);

    const pkg = decodePackage(encodePackage(editor.toPackage()));
    const content = readOdtContent(pkg);
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const roundTrippedTable = content.sections[0]?.blocks.find(
      (b) => b.kind === "table",
    );
    if (roundTrippedTable?.kind !== "table") {
      throw new Error("expected a table block");
    }
    // both rows keep the full 4-grid-position shape
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[1]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[0]?.cells[1]?.colSpan).toBe(2);
    expect(roundTrippedTable.rows[0]?.cells[1]?.rowSpan).toBe(2);
  });

  it("refuses a rectangle that starts in a position another merge covers, naming the row, the column and the merge", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 3 });
    table.mergeCells(0, 0, 2, 2);
    expect(() => table.mergeCells(0, 1, 1, 1)).toThrow(
      /^mergeCells: row 0: column 1 is covered by the merge anchored at row 0, column 0$/,
    );
  });

  it("silently discards consumed content, matching the docx primitive's own precedent", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    table.cell(0, 1).appendParagraph({ text: "discarded" });
    table.cell(1, 0).appendParagraph({ text: "also discarded" });
    expect(() => table.mergeCells(0, 0, 2, 2)).not.toThrow();
  });

  it("states no rowSpan for a rectangle one row high, and rejects a colSpan below one", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 3 });
    expect(table.mergeCells(0, 0, 1, 2).rowSpan).toBeUndefined();
    expect(() => table.mergeCells(0, 0, 1, 0)).toThrow(
      /^mergeCells: rowSpan and colSpan must be positive integers/,
    );
  });

  it("throws for an out-of-range startRow or a rowSpan exceeding the table height", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    expect(() => table.mergeCells(5, 0, 1, 1)).toThrow(/does not exist/);
    expect(() => table.mergeCells(0, 0, 5, 1)).toThrow(/exceeds/);
    expect(() => table.mergeCells(0, 0, 0, 1)).toThrow(/positive integer/);
  });
});

// The content.xml part as text, so a refused edit can be shown to have changed nothing at all rather than nothing a chosen accessor happens to read.
function contentXml(editor: ReturnType<typeof createOdt>): string {
  const part = editor.toPackage().parts["content.xml"];
  if (part?.kind !== "xml") {
    throw new Error("expected an xml content.xml part");
  }
  return JSON.stringify(part.nodes);
}

function expectRefusedUntouched(
  editor: ReturnType<typeof createOdt>,
  action: () => unknown,
  message: RegExp,
): void {
  const before = contentXml(editor);
  expect(action).toThrow(message);
  expect(contentXml(editor)).toBe(before);
}

// Asserts the table is well formed in both views the editor offers: no position is left without an owner (an orphaned covered element reads back through the pivot as an ordinary blank cell, so the pivot's own grid rule alone would not notice it), and the content pivot obeys the grid rule.
function expectWellFormedGrid(
  editor: ReturnType<typeof createOdt>,
  table: OdtTable,
): void {
  const unowned = table
    .gridRows()
    .flatMap((row, r) =>
      row.flatMap((position, c) =>
        position === undefined ? [`${r},${c}`] : [],
      ),
    );
  expect(unowned).toEqual([]);
  const content = readOdtContent(editor.toPackage());
  if (content.kind !== "wordprocessing") {
    throw new Error("expected wordprocessing content");
  }
  const pivot = content.sections[0]?.blocks.find((b) => b.kind === "table");
  if (pivot?.kind !== "table") {
    throw new Error("expected a table block");
  }
  expect(findTableGridFault(pivot)).toBeUndefined();
}

describe("merging over a merged region", () => {
  it("refuses a rectangle whose columns cut through a horizontal merge, through mergeCells and through the row", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 1, 1, 3);

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 0, 1, 2),
      /^mergeCells: row 0: column 1 belongs to the merge anchored at row 0, column 1, which reaches outside the region being merged and cannot be merged over$/,
    );
    expectRefusedUntouched(
      editor,
      () => table.rows()[0]!.mergeCellsHorizontally(0, 2),
      /^mergeCellsHorizontally: column 1 belongs to the merge anchored at row 0, column 1, which reaches outside/,
    );
    expectWellFormedGrid(editor, table);
  });

  it("refuses a rectangle that ends inside a horizontal merge that started before it", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(1, 0, 1, 3);

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(1, 1, 1, 2),
      /^mergeCells: row 1: column 1 is covered by the merge anchored at row 1, column 0$/,
    );
    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 2, 2, 2),
      /^mergeCells: row 1: column 2 belongs to the merge anchored at row 1, column 0, which reaches outside/,
    );
  });

  it("names the row of the rectangle a merge was found in, for a row below the first", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(1, 1, 1, 3);

    expectRefusedUntouched(
      editor,
      () => table.rows()[1]!.mergeCellsHorizontally(0, 2),
      /^mergeCellsHorizontally: column 1 belongs to the merge anchored at row 1, column 1,/,
    );
    expectRefusedUntouched(
      editor,
      () => {
        table.rows()[1]!.markCellCovered(1);
      },
      /^markCellCovered: column 1 anchors a merge with rowSpan 1 and colSpan 3, so covering it would leave the rest of that merge without an anchor$/,
    );
  });

  it("refuses a merge over the anchor of a vertical merge, from its own row and from a row it covers", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 1, 3, 1);

    expectRefusedUntouched(
      editor,
      () => table.rows()[0]!.mergeCellsHorizontally(0, 2),
      /^mergeCellsHorizontally: column 1 belongs to the merge anchored at row 0, column 1,/,
    );
    expectRefusedUntouched(
      editor,
      () => table.mergeCells(1, 0, 1, 2),
      /^mergeCells: row 1: column 1 belongs to the merge anchored at row 0, column 1,/,
    );
    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 0, 2, 2),
      /^mergeCells: row 0: column 1 belongs to the merge anchored at row 0, column 1,/,
    );
    expectWellFormedGrid(editor, table);
  });

  it("refuses a rectangle one row high over a vertical merge whose column span it would change", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 1, 3, 1);

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 1, 1, 2),
      /^mergeCells: row 0: column 1 belongs to the merge anchored at row 0, column 1,/,
    );
  });

  it("refuses a rectangle that reaches into an interior position of a 2x2 merge, whether it starts outside the merge or inside it", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 1, 2, 2);

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(1, 0, 1, 2),
      /^mergeCells: row 1: column 1 belongs to the merge anchored at row 0, column 1,/,
    );
    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 2, 2, 2),
      /^mergeCells: row 0: column 2 is covered by the merge anchored at row 0, column 1$/,
    );
    expectRefusedUntouched(
      editor,
      () => table.mergeCells(1, 2, 2, 2),
      /^mergeCells: row 1: column 2 is covered by the merge anchored at row 0, column 1$/,
    );
    expectWellFormedGrid(editor, table);
  });

  it("names the merge that covers a start position in the same column as its anchor, from a row above", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 3 });
    table.mergeCells(0, 1, 3, 1);

    expectRefusedUntouched(
      editor,
      () => table.rows()[1]!.mergeCellsHorizontally(1, 1),
      /^mergeCellsHorizontally: column 1 is covered by the merge anchored at row 0, column 1$/,
    );
  });

  it("refuses a rectangle that reaches a merge starting above it even when the merge ends inside the rectangle", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 3 });
    table.mergeCells(0, 1, 2, 1);

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(1, 0, 2, 2),
      /^mergeCells: row 1: column 1 belongs to the merge anchored at row 0, column 1,/,
    );
  });

  it("refuses a rectangle taller than it is over a merge that starts where it starts and ends below it", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 3 });
    table.mergeCells(0, 1, 3, 1);

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 1, 2, 1),
      /^mergeCells: row 0: column 1 belongs to the merge anchored at row 0, column 1,/,
    );
  });

  it("checks every row of the rectangle before changing any, so a refusal in a lower row leaves the anchor row alone", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 3 });
    table.mergeCells(1, 1, 2, 2);

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 0, 2, 2),
      /^mergeCells: row 1: column 1 belongs to the merge anchored at row 1, column 1,/,
    );
  });

  it("checks the rows a rectangle covers exist before changing the anchor row", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 0, 3, 2),
      /^mergeCells: rowSpan 3 starting at row 0 exceeds this table's own 2 rows$/,
    );
  });

  it("refuses a rectangle wider than a row it covers, naming that row, and leaves the anchor row alone", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.appendEmptyRow().appendCell();

    expectRefusedUntouched(
      editor,
      () => table.mergeCells(0, 0, 2, 2),
      /^mergeCells: row 1: colSpan 2 starting at column 0 exceeds this row's own 1 grid columns$/,
    );
  });

  it("refuses a merge that starts at a covered element no merge anchors, and swallows one inside the region", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 0, columns: 3 });
    const row = table.appendEmptyRow();
    row.appendCell();
    row.appendCoveredCell();
    row.appendCell();
    const below = table.appendEmptyRow();
    below.appendCell();
    below.appendCell();
    below.appendCell();

    expectRefusedUntouched(
      editor,
      () => row.mergeCellsHorizontally(1, 2),
      /^mergeCellsHorizontally: column 1 is a covered position that no merge anchors$/,
    );
    expect(row.mergeCellsHorizontally(0, 3).colSpan).toBe(3);
    expectWellFormedGrid(editor, table);
  });

  it("merges a row appended after the table was built", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 3 });
    const appended = table.appendRow(3);

    expect(appended.mergeCellsHorizontally(1, 2).colSpan).toBe(2);
    expect(() => appended.mergeCellsHorizontally(0, 2)).toThrow(
      /^mergeCellsHorizontally: column 1 belongs to the merge anchored at row 1, column 1,/,
    );
    expectWellFormedGrid(editor, table);
  });

  it("widens a horizontal merge over the cells beside it", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 4 });
    table.mergeCells(0, 0, 1, 2);

    const anchor = table.mergeCells(0, 0, 1, 3);

    expect(anchor.colSpan).toBe(3);
    expect(anchor.rowSpan).toBeUndefined();
    expect(coveredCellElements(editor)).toHaveLength(2);
    expectWellFormedGrid(editor, table);
  });

  it("swallows a merged region wholly inside the rectangle, whether it runs along a row or down a column", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 3 });
    table.mergeCells(1, 1, 1, 2);
    table.mergeCells(0, 0, 3, 3);
    expect(coveredCellElements(editor)).toHaveLength(8);
    expectWellFormedGrid(editor, table);

    const other = createOdt();
    const tall = other.body.appendTable({ rows: 3, columns: 3 });
    tall.mergeCells(0, 1, 2, 1);
    const anchor = tall.mergeCells(0, 0, 3, 2);
    expect(anchor.colSpan).toBe(2);
    expect(anchor.rowSpan).toBe(3);
    expect(coveredCellElements(other)).toHaveLength(5);
    expectWellFormedGrid(other, tall);
  });

  it("leaves a table as it was when the same rectangle is merged again, and when a merge changes nothing", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 0, 2, 2);
    table.mergeCells(0, 3, 3, 1);
    const before = contentXml(editor);

    table.mergeCells(0, 0, 2, 2);
    table.rows()[0]!.mergeCellsHorizontally(3, 1);

    expect(contentXml(editor)).toBe(before);
  });

  it("refuses to cover the anchor of a merged region, whichever way the region runs", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 0, 1, 2);
    table.mergeCells(1, 0, 2, 1);
    table.mergeCells(1, 2, 2, 2);

    expectRefusedUntouched(
      editor,
      () => {
        table.rows()[0]!.markCellCovered(0);
      },
      /^markCellCovered: column 0 anchors a merge with rowSpan 1 and colSpan 2, so covering it would leave the rest of that merge without an anchor$/,
    );
    expectRefusedUntouched(
      editor,
      () => {
        table.rows()[1]!.markCellCovered(0);
      },
      /^markCellCovered: column 0 anchors a merge with rowSpan 2 and colSpan 1,/,
    );
    expectRefusedUntouched(
      editor,
      () => {
        table.rows()[1]!.markCellCovered(2);
      },
      /^markCellCovered: column 2 anchors a merge with rowSpan 2 and colSpan 2,/,
    );
  });

  it("still covers an unmerged cell, a cell another merge covers, and a cell that states a span of one", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 4 });
    table.mergeCells(0, 0, 2, 2);
    table.cell(0, 1).colSpan = 1;
    table.cell(0, 1).rowSpan = 1;
    const rows = table.rows();

    rows[0]!.markCellCovered(3);
    rows[1]!.markCellCovered(1);
    rows[0]!.markCellCovered(2);

    expect(coveredCellElements(editor)).toHaveLength(5);
  });
});
