import type { XmlElement } from "odf.js";
import { decodePackage, encodePackage } from "odf.js";
import { tableGridColumnCount, walkTableGrid } from "document-schema.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "../../odf/odt/read";
import { el } from "../../xml/fragment";
import { walkElements } from "../../xml/query";
import { createOdt } from "./editor";
import type { OdtTable } from "./table";

describe("OdtTableRow.mergeCellsHorizontally", () => {
  it("merges colSpan grid columns into one cell, retagging the consumed positions to table:covered-table-cell", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 4 });
    table.cell(0, 2).appendParagraph({ text: "consumed content" });

    const anchor = table.rows()[0]!.mergeCellsHorizontally(1, 2);
    anchor.appendParagraph({ text: "anchor content" });

    // 4 grid positions still exist: 1 unmerged real cell (col 0), 1 anchor real cell with colSpan=2 (col 1), 1 table:covered-table-cell (col 2), and 1 unmerged real cell (col 3) — 3 real cells total
    expect(table.rows()[0]!.cells()).toHaveLength(3);
    expect(table.cell(0, 1).colSpan).toBe(2);
    expect(table.cell(0, 1).text).toContain("anchor content");

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
    // the grid-position invariant: 4 entries total (1 plain + 1 merged-anchor + 2 covered), matching the 4 real grid columns
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[0]?.cells[1]?.colSpan).toBe(2);
  });

  it("throws a clear error when the anchor position is already covered by another merge", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 4 });
    table.rows()[0]!.mergeCellsHorizontally(0, 2);
    expect(() => table.rows()[0]!.mergeCellsHorizontally(1, 1)).toThrow(
      /^mergeCellsHorizontally: column 1 is covered by the merge anchored at row 0, column 0$/,
    );
  });

  it("silently discards a consumed cell that already had real text, with no error", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 3 });
    table.cell(0, 0).appendParagraph({ text: "anchor" });
    table.cell(0, 1).appendParagraph({ text: "about to be discarded" });

    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 2)).not.toThrow();
    expect(table.rows()[0]!.cells()).toHaveLength(2);
  });

  it("throws for an out-of-range startColumnIndex or a colSpan exceeding the row width", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    expect(() => table.rows()[0]!.mergeCellsHorizontally(5, 1)).toThrow(
      /does not exist/,
    );
    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 5)).toThrow(
      /exceeds/,
    );
    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 0)).toThrow(
      /positive integer/,
    );
  });
});

// Every element with the given tag in the package's content.xml, in document order, as the raw elements the editor wrote.
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

describe("a cell retagged as covered keeps its own style and drops its content and spans", () => {
  const RED = { r: 1, g: 0, b: 0 };

  it("mergeCellsHorizontally keeps the consumed cell's table:style-name, so its background and borders survive", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 3 });
    table.cell(0, 1).appendParagraph({ text: "consumed" });
    table.cell(0, 1).background = RED;
    const consumed = contentElements(editor, "table:table-cell")[1];
    const styleName = consumed && attr(consumed, "table:style-name");
    expect(styleName).toBeDefined();

    table.rows()[0]!.mergeCellsHorizontally(0, 2);

    const [covered, ...rest] = coveredCellElements(editor);
    expect(rest).toHaveLength(0);
    expect(covered?.attributes).toEqual([
      { name: "table:style-name", value: styleName },
    ]);
    expect(covered?.children).toEqual([]);

    const content = readOdtContent(editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const block = content.sections[0]?.blocks.find((b) => b.kind === "table");
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.rows[0]?.cells[1]).toEqual({
      blocks: [],
      background: { kind: "solid", color: RED },
    });
  });

  it("a merge that swallows a whole merged region drops the anchor's span attributes but keeps its style", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    table.mergeCells(1, 0, 1, 2);
    const below = table.gridRows()[1]?.[0]?.cell;
    if (below === undefined) {
      throw new Error("expected a cell at row 1, column 0");
    }
    below.background = RED;
    const styleName = attr(
      contentElements(editor, "table:table-cell")[2]!,
      "table:style-name",
    );
    expect(styleName).toBeDefined();

    table.mergeCells(0, 0, 2, 2);

    const covered = coveredCellElements(editor);
    expect(covered).toHaveLength(3);
    expect(covered[1]?.attributes).toEqual([
      { name: "table:style-name", value: styleName },
    ]);
    expect(covered[1]?.children).toEqual([]);
  });

  it("a covered cell that had no style carries no attributes at all", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.rows()[0]!.mergeCellsHorizontally(0, 2);
    expect(coveredCellElements(editor)[0]?.attributes).toEqual([]);
  });
});

// Builds a table of rows x columns whose cells hold the text "<row>,<column>", so a grid position can be traced to the live cell that owns it.
function labelledOdtTable(rows: number, columns: number): OdtTable {
  const table = createOdt().body.appendTable({ rows, columns });
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      table.cell(row, column).appendParagraph({ text: `${row},${column}` });
    }
  }
  return table;
}

// The grid as text: each position's owning cell's label, with a trailing "*" on the positions that are not the owner's own.
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

describe("OdtTable grid view", () => {
  it("reports the grid width and resolves every position of a table with no merges to its own cell", () => {
    const table = labelledOdtTable(2, 3);
    expect(table.gridColumnCount()).toBe(3);
    expect(odtGridLabels(table)).toEqual([
      ["0,0", "0,1", "0,2"],
      ["1,0", "1,1", "1,2"],
    ]);
  });

  it("keeps the grid width after a 2x2 merge, where the row's own real-cell count under-reports it", () => {
    const table = labelledOdtTable(3, 3);
    table.mergeCells(0, 0, 2, 2);
    expect(table.rows()[0]!.cells()).toHaveLength(2);
    expect(table.gridColumnCount()).toBe(3);
    expect(odtGridLabels(table)).toEqual([
      ["0,0", "0,0*", "0,2"],
      ["0,0*", "0,0*", "1,2"],
      ["2,0", "2,1", "2,2"],
    ]);
  });

  it("resolves a position covered along its own row and a position covered from a row above to the same anchor", () => {
    const table = labelledOdtTable(3, 3);
    table.mergeCells(0, 0, 3, 1);
    table.rows()[1]!.mergeCellsHorizontally(1, 2);
    expect(odtGridLabels(table)).toEqual([
      ["0,0", "0,1", "0,2"],
      ["0,0*", "1,1", "1,1*"],
      ["0,0*", "2,1", "2,2"],
    ]);
  });

  it("takes the declared table:table-column count as the width when no row states one", () => {
    const table = createOdt().body.appendTable({ rows: 0, columns: 3 });
    expect(table.gridColumnCount()).toBe(3);
    expect(table.gridRows()).toEqual([]);
  });

  it("widens the grid to a row wider than the declared columns, and leaves the positions a shorter row lacks undefined", () => {
    const table = createOdt().body.appendTable({ rows: 1, columns: 2 });
    const wide = table.appendEmptyRow();
    for (let column = 0; column < 3; column++) {
      wide.appendCell();
    }
    expect(table.gridColumnCount()).toBe(3);
    expect(
      table.gridRows().map((row) => row.map((entry) => entry === undefined)),
    ).toEqual([
      [false, false, true],
      [false, false, false],
    ]);
  });

  it("leaves a covered position no live cell can own undefined, and ignores elements of a row that are not cells", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 0, columns: 2 });
    const row = table.appendEmptyRow();
    row.appendCell();
    row.appendCoveredCell();
    contentElements(editor, "table:table-row")[0]?.children.push(
      el("text:soft-page-break"),
    );
    expect(
      table.gridRows().map((r) => r.map((entry) => entry === undefined)),
    ).toEqual([[false, true]]);
    expect(table.gridColumnCount()).toBe(2);
  });

  it("ignores children of the table that are neither columns nor rows", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    contentElements(editor, "table:table")[0]?.children.push(
      el("table:table-header-rows"),
    );
    expect(table.gridRows()).toHaveLength(1);
    expect(table.gridColumnCount()).toBe(2);
  });

  it("agrees with the content pivot on the grid width and on which positions a merge covers", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 1, 2, 2);
    table.rows()[2]!.mergeCellsHorizontally(2, 2);

    const content = readOdtContent(editor.toPackage());
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const pivot = content.sections[0]?.blocks.find((b) => b.kind === "table");
    if (pivot?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(table.gridColumnCount()).toBe(tableGridColumnCount(pivot));
    expect(
      table.gridRows().map((row) => row.map((entry) => entry?.isAnchor)),
    ).toEqual(
      walkTableGrid(pivot).map((row) =>
        row.map((position) => position.anchorRowIndex === undefined),
      ),
    );
  });
});

// table:number-columns-repeated (ExaDev/documents.js#1374): a real table:table-cell/table:covered-table-cell or table:table-column element can carry this attribute to stand for that many identical adjacent grid positions rather than one — confirmed by odf.js's own pivot reader (typed/shared/table.ts's readTableRow/readOdfTable) to be something real ODF producers emit routinely for a short run of identically-styled columns or empty cells, not just a spreadsheet-scale hazard. This editor's own write paths (buildTable, appendCell, appendCoveredCell) never emit the attribute themselves, so every case below authors it directly on the raw XML the way an external producer's file would arrive already carrying it.
