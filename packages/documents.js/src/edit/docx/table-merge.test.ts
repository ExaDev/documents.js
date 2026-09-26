import type { XmlElement } from "ooxml.js";
import { buildXml, decodePackage, el, encodePackage } from "ooxml.js";
import { tableGridColumnCount, walkTableGrid } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readDocxContent } from "../../ooxml/docx/read";
import { createDocx } from "./editor";
import { buildTable, DocxTable } from "./table";

describe("DocxTableRow.mergeCellsHorizontally and vertical merges", () => {
  // A 3x3 table whose grid column 1 is merged over rows 0 and 1.
  function verticallyMergedTable(): DocxTable {
    const tableElement = buildTable({ rows: 3, columns: 3 });
    const table = new DocxTable([tableElement], tableElement);
    table.mergeCells(0, 1, 2, 1);
    return table;
  }

  it("refuses to swallow the cell that restarts a vertical merge, leaving the merge intact", () => {
    const table = verticallyMergedTable();
    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 2)).toThrow(
      /column 1 takes part in a vertical merge/,
    );
    expect(table.rows()[0]!.cells()).toHaveLength(3);
    expect(table.cell(0, 1).verticalMerge).toBe("restart");
    expect(table.cell(1, 1).verticalMerge).toBe("continue");
  });

  it("refuses to swallow a continuation cell, so the merge it belongs to is never left without a row", () => {
    const table = verticallyMergedTable();
    expect(() => table.rows()[1]!.mergeCellsHorizontally(1, 2)).toThrow(
      /column 1 takes part in a vertical merge/,
    );
    expect(table.rows()[1]!.cells()).toHaveLength(3);
  });

  it("refuses to widen a cell that already takes part in a vertical merge", () => {
    const table = verticallyMergedTable();
    expect(() => table.rows()[0]!.mergeCellsHorizontally(1, 2)).toThrow(
      /column 1 takes part in a vertical merge/,
    );
  });

  it("names the row when a rectangle merge is refused, and leaves every row untouched", () => {
    const table = verticallyMergedTable();
    expect(() => table.mergeCells(0, 0, 3, 2)).toThrow(
      /mergeCells: row 0: .*column 1 takes part in a vertical merge/,
    );
    expect(table.rows().map((row) => row.cells().length)).toEqual([3, 3, 3]);
    expect(table.cell(0, 0).colSpan).toBeUndefined();
    expect(table.cell(0, 0).verticalMerge).toBeUndefined();
  });

  it("refuses a rectangle whose later row is the one that cannot merge, before touching the earlier rows", () => {
    const tableElement = buildTable({ rows: 3, columns: 3 });
    const table = new DocxTable([tableElement], tableElement);
    table.rows()[2]!.mergeCellsHorizontally(0, 2);
    expect(() => table.mergeCells(0, 1, 3, 1)).toThrow(
      /mergeCells: row 2: .*column 1 is covered by the cell starting at column 0/,
    );
    expect(table.rows().map((row) => row.cells().length)).toEqual([3, 3, 2]);
    expect(table.cell(0, 1).verticalMerge).toBeUndefined();
  });

  it("refuses a vertical-only rectangle over a cell that is already part of a vertical merge", () => {
    const table = verticallyMergedTable();
    expect(() => table.mergeCells(1, 1, 2, 1)).toThrow(
      /mergeCells: row 1: .*column 1 takes part in a vertical merge/,
    );
    expect(table.cell(1, 1).verticalMerge).toBe("continue");
    expect(table.cell(2, 1).verticalMerge).toBeUndefined();
  });

  it("allows a merge that changes nothing on a cell that takes part in a vertical merge", () => {
    const table = verticallyMergedTable();
    expect(() => table.rows()[0]!.mergeCellsHorizontally(1, 1)).not.toThrow();
    expect(() => table.rows()[1]!.mergeCellsHorizontally(1, 1)).not.toThrow();
    expect(() => table.mergeCells(0, 1, 1, 1)).not.toThrow();
    expect(table.cell(0, 1).verticalMerge).toBe("restart");
    expect(table.cell(1, 1).verticalMerge).toBe("continue");
  });

  it("does not start a vertical merge for a rectangle one row high", () => {
    const tableElement = buildTable({ rows: 2, columns: 3 });
    const table = new DocxTable([tableElement], tableElement);
    const anchor = table.mergeCells(0, 0, 1, 2);
    expect(anchor.colSpan).toBe(2);
    expect(anchor.verticalMerge).toBeUndefined();
    expect(table.cell(1, 0).verticalMerge).toBeUndefined();
  });

  it("rejects a colSpan below one for a rectangle", () => {
    const table = verticallyMergedTable();
    expect(() => table.mergeCells(0, 0, 1, 0)).toThrow(/positive integer/);
  });

  it("still merges a rectangle beside an existing vertical merge", () => {
    const table = verticallyMergedTable();
    table.mergeCells(0, 2, 2, 1);
    expect(table.cell(0, 2).verticalMerge).toBe("restart");
    expect(table.cell(1, 2).verticalMerge).toBe("continue");
  });
});

// Builds a table of rows x columns whose cells hold the text "<row>,<column>", so a grid position can be traced to the live cell that owns it.
function labelledTable(rows: number, columns: number): DocxTable {
  const tableElement = buildTable({ rows, columns });
  const table = new DocxTable([tableElement], tableElement);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      table.cell(row, column).appendParagraph({ text: `${row},${column}` });
    }
  }
  return table;
}

// The grid as text: each position's owning cell's label, with a trailing "*" on the positions that are not the owner's own.
function gridLabels(table: DocxTable): string[][] {
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

describe("DocxTable grid view", () => {
  it("reports the grid width and resolves every position of a table with no merges to its own cell", () => {
    const table = labelledTable(2, 3);
    expect(table.gridColumnCount()).toBe(3);
    expect(gridLabels(table)).toEqual([
      ["0,0", "0,1", "0,2"],
      ["1,0", "1,1", "1,2"],
    ]);
  });

  it("keeps the grid width after a 2x2 merge, where the row's own w:tc count under-reports it", () => {
    const table = labelledTable(3, 3);
    table.mergeCells(0, 0, 2, 2);
    expect(table.rows()[0]!.cells()).toHaveLength(2);
    expect(table.gridColumnCount()).toBe(3);
    expect(gridLabels(table)).toEqual([
      ["0,0", "0,0*", "0,2"],
      ["0,0*", "0,0*", "1,2"],
      ["2,0", "2,1", "2,2"],
    ]);
  });

  it("resolves a position covered by a horizontal merge to the anchor, and marks only the anchor's own position", () => {
    const table = labelledTable(1, 4);
    table.rows()[0]!.mergeCellsHorizontally(1, 2);
    expect(gridLabels(table)).toEqual([["0,0", "0,1", "0,1*", "0,3"]]);
    expect(table.gridRows()[0]![1]!.isAnchor).toBe(true);
    expect(table.gridRows()[0]![2]!.isAnchor).toBe(false);
  });

  it("derives a vertical merge's height from the run of continuation cells directly below it", () => {
    const table = labelledTable(4, 1);
    table.cell(0, 0).verticalMerge = "restart";
    table.cell(1, 0).verticalMerge = "continue";
    table.cell(2, 0).verticalMerge = "continue";
    // A restart below the run begins a region of its own.
    table.cell(3, 0).verticalMerge = "restart";
    expect(gridLabels(table)).toEqual([["0,0"], ["0,0*"], ["0,0*"], ["3,0"]]);
  });

  it("ends a vertical merge at a row that does not continue it, and attaches a later continuation to the cell directly above it", () => {
    const table = labelledTable(4, 1);
    table.cell(0, 0).verticalMerge = "restart";
    table.cell(1, 0).verticalMerge = "continue";
    table.cell(3, 0).verticalMerge = "continue";
    // The pivot's reader gives a continuation to the nearest cell above it at its own column, whether or not that cell restarted a merge.
    expect(gridLabels(table)).toEqual([["0,0"], ["0,0*"], ["2,0"], ["2,0*"]]);
  });

  it("matches a continuation to the cell starting at its own grid column, not to a cell at the same physical index", () => {
    const table = labelledTable(2, 3);
    table.rows()[0]!.mergeCellsHorizontally(0, 2);
    table.rows()[1]!.cells()[1]!.verticalMerge = "continue";
    table.rows()[0]!.cells()[1]!.verticalMerge = "restart";
    // Row 0 reads [0,0 spanning 0-1] [0,2]; row 1 reads [1,0] [1,1] [1,2], with its physical cell 1 (grid column 1) continuing. Physical index 1 of row 0 starts at grid column 2, so the continuation at grid column 1 has nothing above it and stands alone, empty.
    expect(gridLabels(table)).toEqual([
      ["0,0", "0,0*", "0,2"],
      ["1,0", "", "1,2"],
    ]);
  });

  it("widens the grid to the table's own w:tblGrid when a row holds fewer cells, leaving the missing positions undefined", () => {
    const table = labelledTable(1, 4);
    table.appendRow(2);
    expect(table.gridColumnCount()).toBe(4);
    const shortRow = table.gridRows()[1]!;
    expect(shortRow).toHaveLength(4);
    expect(shortRow.map((position) => position === undefined)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("widens the grid past the w:tblGrid when a row places a cell beyond it", () => {
    const table = labelledTable(1, 2);
    table.appendRow(4);
    expect(table.gridColumnCount()).toBe(4);
    expect(table.gridRows()[0]).toHaveLength(4);
  });

  it("reads a table with no w:tblGrid as as wide as its widest row", () => {
    const tableElement = buildTable({ rows: 1, columns: 3 });
    tableElement.children = tableElement.children.filter(
      (child) => !(child.type === "element" && child.tag === "w:tblGrid"),
    );
    const table = new DocxTable([tableElement], tableElement);
    expect(table.gridColumnCount()).toBe(3);
  });

  it("takes the w:tblGrid's own column count as the width of a table with no rows", () => {
    const tableElement = buildTable({ rows: 0, columns: 3 });
    const table = new DocxTable([tableElement], tableElement);
    expect(table.gridColumnCount()).toBe(3);
    expect(table.gridRows()).toEqual([]);
  });

  it("counts only w:gridCol children of the w:tblGrid", () => {
    const tableElement = buildTable({ rows: 0, columns: 2 });
    const tblGrid = tableElement.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:tblGrid",
    );
    tblGrid?.children.push(el("w:tblGridChange"), { type: "text", value: " " });
    const table = new DocxTable([tableElement], tableElement);
    expect(table.gridColumnCount()).toBe(2);
  });

  it("is empty for a table with no rows and no grid columns", () => {
    const tableElement = buildTable({ rows: 0, columns: 0 });
    const table = new DocxTable([tableElement], tableElement);
    expect(table.gridColumnCount()).toBe(0);
    expect(table.gridRows()).toEqual([]);
  });

  it("agrees with the content pivot on the grid width and on which positions a merge covers", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 3, columns: 4 });
    table.mergeCells(0, 1, 2, 2);
    table.rows()[2]!.mergeCellsHorizontally(2, 2);

    const content = readDocxContent(
      decodePackage(encodePackage(editor.toPackage())),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const pivot = content.sections[0]?.blocks.find((b) => b.kind === "table");
    if (pivot?.kind !== "table") {
      throw new Error("expected a table block");
    }
    const walked = walkTableGrid(pivot);
    expect(table.gridColumnCount()).toBe(tableGridColumnCount(pivot));
    expect(
      table.gridRows().map((row) => row.map((entry) => entry?.isAnchor)),
    ).toEqual(
      walked.map((row) =>
        row.map((position) => position.anchorRowIndex === undefined),
      ),
    );
  });
});

describe("DocxTable.mergeCells", () => {
  it("merges a rowSpan x colSpan rectangle via mergeCellsHorizontally plus verticalMerge", () => {
    const tableElement = buildTable({ rows: 3, columns: 3 });
    const table = new DocxTable([tableElement], tableElement);
    const anchor = table.mergeCells(0, 1, 2, 2);
    anchor.appendParagraph({ text: "block" });

    expect(table.cell(0, 1).colSpan).toBe(2);
    expect(table.cell(0, 1).verticalMerge).toBe("restart");
    expect(table.rows()[0]!.cells()).toHaveLength(2);
    expect(table.cell(1, 1).colSpan).toBe(2);
    expect(table.cell(1, 1).verticalMerge).toBe("continue");
    expect(table.rows()[1]!.cells()).toHaveLength(2);
    // the untouched third row keeps all three original columns
    expect(table.rows()[2]!.cells()).toHaveLength(3);
  });

  it("throws for an out-of-range startRow or a rowSpan exceeding the table height", () => {
    const tableElement = buildTable({ rows: 2, columns: 2 });
    const table = new DocxTable([tableElement], tableElement);
    expect(() => table.mergeCells(5, 0, 1, 1)).toThrow(/does not exist/);
    expect(() => table.mergeCells(0, 0, 5, 1)).toThrow(/exceeds/);
    expect(() => table.mergeCells(0, 0, 0, 1)).toThrow(/positive integer/);
  });
});

// The bytes a docx editor would write, re-decoded and serialised back to the document part's own XML text: what a consumer reading the part directly (not through readDocxContent, which hides a continuation cell's content) would find.
function writtenDocumentXml(editor: ReturnType<typeof createDocx>): string {
  const part = decodePackage(encodePackage(editor.toPackage())).parts[
    "word/document.xml"
  ];
  if (part?.kind !== "xml") {
    throw new Error("expected word/document.xml to be an XML part");
  }
  return buildXml(part.nodes);
}

describe("a vertical-merge continuation cell holds no content", () => {
  it("DocxTable.mergeCells leaves none of the covered cells' text in the written document part", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 3, columns: 2 });
    table.cell(0, 0).appendParagraph({ text: "anchor text" });
    table.cell(1, 0).appendParagraph({ text: "covered text one" });
    table.cell(2, 0).appendParagraph({ text: "covered text two" });
    table.cell(1, 1).appendParagraph({ text: "neighbour text" });

    table.mergeCells(0, 0, 3, 1);

    const xml = writtenDocumentXml(editor);
    expect(xml).toContain("anchor text");
    expect(xml).toContain("neighbour text");
    expect(xml).not.toContain("covered text one");
    expect(xml).not.toContain("covered text two");
  });

  it("a rectangle merge clears the continuation cell it keeps in each covered row, and only that", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 2, columns: 3 });
    table.cell(0, 0).appendParagraph({ text: "left" });
    table.cell(0, 1).appendParagraph({ text: "anchor" });
    table.cell(0, 2).appendParagraph({ text: "consumed by colSpan" });
    table.cell(1, 1).appendParagraph({ text: "covered below" });
    table.cell(1, 2).appendParagraph({ text: "consumed below" });

    table.mergeCells(0, 1, 2, 2);

    const xml = writtenDocumentXml(editor);
    expect(xml).toContain("left");
    expect(xml).toContain("anchor");
    expect(xml).not.toContain("consumed by colSpan");
    expect(xml).not.toContain("covered below");
    expect(xml).not.toContain("consumed below");
  });

  it("setting 'continue' by hand also discards the text, leaving exactly one empty w:p after w:tcPr", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 2, columns: 1 });
    table.cell(0, 0).verticalMerge = "restart";
    table.cell(0, 0).appendParagraph({ text: "top" });
    const covered = table.cell(1, 0);
    covered.appendParagraph({ text: "first hidden paragraph" });
    covered.appendParagraph({ text: "second hidden paragraph" });

    covered.verticalMerge = "continue";

    const xml = writtenDocumentXml(editor);
    expect(xml).not.toContain("hidden paragraph");
    expect(covered.paragraphs()).toHaveLength(1);
    expect(covered.text).toBe("");
    expect(covered.verticalMerge).toBe("continue");
  });

  it("keeps w:tcPr as the first child of a cleared cell, ahead of its one w:p", () => {
    const tableElement = buildTable({ rows: 2, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const covered = table.cell(1, 0);
    covered.colSpan = 1;
    covered.appendParagraph({ text: "gone" });

    covered.verticalMerge = "continue";

    const rows = tableElement.children.filter(
      (c): c is XmlElement => c.type === "element" && c.tag === "w:tr",
    );
    const tc = rows[1]?.children.find(
      (c): c is XmlElement => c.type === "element" && c.tag === "w:tc",
    );
    expect(
      tc?.children.map((c) => (c.type === "element" ? c.tag : c.type)),
    ).toEqual(["w:tcPr", "w:p"]);
  });

  it("does not clear a cell that restarts a merge, nor one whose merge is removed", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const cell = table.cell(0, 0);
    cell.appendParagraph({ text: "kept text" });

    cell.verticalMerge = "restart";
    expect(cell.text).toContain("kept text");
    cell.verticalMerge = undefined;
    expect(cell.text).toContain("kept text");
    expect(writtenDocumentXml(editor)).toContain("kept text");
  });
});
