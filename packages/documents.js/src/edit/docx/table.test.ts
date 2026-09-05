import type { XmlElement, XmlNode } from "ooxml.js";
import { decodePackage, el, encodePackage } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readDocxContent } from "../../ooxml/docx/read";
import { createDocx } from "./editor";
import { buildTable, DocxTable, type DocxTableCell } from "./table";

describe("buildTable", () => {
  it("builds a grid with the requested row/column count", () => {
    const tableElement = buildTable({ rows: 2, columns: 3 });
    const container: XmlNode[] = [tableElement];
    const table = new DocxTable(container, tableElement);
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[0]?.cells()).toHaveLength(3);
    expect(table.rows()[1]?.cells()).toHaveLength(3);
  });

  it("uses explicit column widths when given", () => {
    const tableElement = buildTable({
      rows: 1,
      columns: 2,
      columnWidthsTwips: [3000, 6000],
    });
    const tblGrid = tableElement.children.find(
      (c) => c.type === "element" && c.tag === "w:tblGrid",
    );
    if (tblGrid?.type !== "element") {
      throw new Error("expected w:tblGrid");
    }
    const widths = tblGrid.children
      .filter((c) => c.type === "element")
      .map((c) => c.attributes.find((a) => a.name === "w:w")?.value);
    expect(widths).toEqual(["3000", "6000"]);
  });
});

describe("DocxTable cell access and mutation", () => {
  it("cell(row, col) returns the right cell, and its text can be set via appendParagraph", () => {
    const tableElement = buildTable({ rows: 2, columns: 2 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(1, 1);
    cell.appendParagraph({ text: "B2" });
    expect(table.cell(1, 1).text).toContain("B2");
    expect(table.cell(0, 0).text).toBe(""); // untouched cells start with one empty paragraph
  });

  it("throws for an out-of-range row or column", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    expect(() => table.cell(5, 0)).toThrow();
    expect(() => table.cell(0, 5)).toThrow();
  });

  it("appendRow adds a row with the given column count", () => {
    const tableElement = buildTable({ rows: 1, columns: 2 });
    const table = new DocxTable([tableElement], tableElement);
    table.appendRow(2);
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[1]?.cells()).toHaveLength(2);
  });

  it("colSpan writes and reads w:tcPr/w:gridSpan, and clearing it removes the element", () => {
    const tableElement = buildTable({ rows: 1, columns: 2 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    expect(cell.colSpan).toBeUndefined();
    cell.colSpan = 2;
    expect(cell.colSpan).toBe(2);
    cell.colSpan = undefined;
    expect(cell.colSpan).toBeUndefined();
  });

  it("verticalMerge writes and reads w:tcPr/w:vMerge, distinguishing restart from continue", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    expect(cell.verticalMerge).toBeUndefined();
    cell.verticalMerge = "restart";
    expect(cell.verticalMerge).toBe("restart");
    cell.verticalMerge = "continue";
    expect(cell.verticalMerge).toBe("continue");
    cell.verticalMerge = undefined;
    expect(cell.verticalMerge).toBeUndefined();
  });

  it("colSpan and verticalMerge coexist on the same cell in schema order (w:gridSpan before w:vMerge)", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    cell.colSpan = 2;
    cell.verticalMerge = "restart";
    expect(cell.colSpan).toBe(2);
    expect(cell.verticalMerge).toBe("restart");
    const tc = tableElement.children.find(
      (c) => c.type === "element" && c.tag === "w:tr",
    );
    const row =
      tc?.type === "element"
        ? tc.children.find((c) => c.type === "element" && c.tag === "w:tc")
        : undefined;
    const tcPr =
      row?.type === "element"
        ? row.children.find((c) => c.type === "element" && c.tag === "w:tcPr")
        : undefined;
    const childTags =
      tcPr?.type === "element"
        ? tcPr.children.filter((c) => c.type === "element").map((c) => c.tag)
        : [];
    expect(childTags).toEqual(["w:gridSpan", "w:vMerge"]);
  });

  it("remove() removes the table and throws on further use", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const container: XmlNode[] = [tableElement];
    const table = new DocxTable(container, tableElement);
    table.remove();
    expect(container).toHaveLength(0);
    expect(() => table.rows()).toThrow(/removed/);
  });

  it("vertical merge already works with zero new code -- the existing verticalMerge setter alone round-trips correctly", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 2, columns: 1 });
    table.cell(0, 0).verticalMerge = "restart";
    table.cell(0, 0).appendParagraph({ text: "top" });
    table.cell(1, 0).verticalMerge = "continue";

    const pkg = decodePackage(encodePackage(editor.toPackage()));
    const content = readDocxContent(pkg);
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const roundTrippedTable = content.sections[0]?.blocks.find(
      (b) => b.kind === "table",
    );
    if (roundTrippedTable?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(1);
    expect(roundTrippedTable.rows[1]?.cells).toHaveLength(1);
  });

  it("heightPt is undefined for a row with no w:trHeight, and a value written through the live editor survives a real docx read/build round trip", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const row = table.rows()[0]!;
    expect(row.heightPt).toBeUndefined();
    row.heightPt = 34;
    expect(row.heightPt).toBeCloseTo(34, 5);

    const pkg = decodePackage(encodePackage(editor.toPackage()));
    const content = readDocxContent(pkg);
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const roundTrippedTable = content.sections[0]?.blocks.find(
      (b) => b.kind === "table",
    );
    if (roundTrippedTable?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(roundTrippedTable.rows[0]?.heightPt).toBeCloseTo(34, 5);
  });
});

describe("DocxTableCell background", () => {
  // Walks down to the row-0/col-0 cell's own w:tcPr, creating it (via the public colSpan setter, mirroring the "colSpan and verticalMerge coexist" test above) when the cell has none yet -- so a test can hand-insert a raw w:shd shape this editor's own setter never writes (it always writes w:val="clear"), the same way a real producer's own docx can.
  function tcPrOf(tableElement: XmlNode, cell: DocxTableCell): XmlElement {
    cell.colSpan = 1;
    const tr = tableElement.type === "element" ? tableElement : undefined;
    const row =
      tr?.children.find((c) => c.type === "element" && c.tag === "w:tr") ??
      undefined;
    const tc =
      row?.type === "element"
        ? row.children.find((c) => c.type === "element" && c.tag === "w:tc")
        : undefined;
    const tcPr =
      tc?.type === "element"
        ? tc.children.find((c) => c.type === "element" && c.tag === "w:tcPr")
        : undefined;
    if (tcPr?.type !== "element") {
      throw new Error("expected w:tcPr");
    }
    return tcPr;
  }

  it("background is undefined for an undecorated cell, and round-trips through the setter", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    expect(cell.background).toBeUndefined();
    cell.background = { r: 1, g: 0, b: 0 };
    expect(cell.background).toEqual({ r: 1, g: 0, b: 0 });
    cell.background = undefined;
    expect(cell.background).toBeUndefined();
  });

  it('resolves a w:val="solid" shading from w:color, not w:fill -- the real bug this getter once had, since it read w:fill unconditionally regardless of w:val', () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    const tcPr = tcPrOf(tableElement, cell);
    tcPr.children.push(
      el("w:shd", { "w:val": "solid", "w:color": "00ff00", "w:fill": "auto" }),
    );
    expect(cell.background).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("resolves a genuine pattern fill to its own representative colour, rather than no colour at all", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    const tcPr = tcPrOf(tableElement, cell);
    tcPr.children.push(
      el("w:shd", { "w:val": "pct25", "w:color": "0000ff", "w:fill": "auto" }),
    );
    expect(cell.background).toEqual({ r: 0, g: 0, b: 1 });
  });
});

describe("DocxTableRow.mergeCellsHorizontally", () => {
  it("merges colSpan columns into one cell, removing the consumed w:tc elements and leaving w:tblGrid untouched", () => {
    const tableElement = buildTable({ rows: 1, columns: 4 });
    const table = new DocxTable([tableElement], tableElement);
    table.cell(0, 2).appendParagraph({ text: "consumed content" });

    const anchor = table.rows()[0]!.mergeCellsHorizontally(1, 2);
    anchor.appendParagraph({ text: "anchor content" });

    expect(table.rows()[0]!.cells()).toHaveLength(3);
    expect(table.cell(0, 1).colSpan).toBe(2);
    expect(table.cell(0, 1).text).toContain("anchor content");
    // the consumed cell's own pre-merge content ("consumed content") is nowhere in the surviving row
    expect(
      table
        .rows()[0]!
        .cells()
        .some((c) => c.text.includes("consumed content")),
    ).toBe(false);

    const tblGrid = tableElement.children.find(
      (c) => c.type === "element" && c.tag === "w:tblGrid",
    );
    const gridColumns =
      tblGrid?.type === "element"
        ? tblGrid.children.filter((c) => c.type === "element")
        : [];
    expect(gridColumns).toHaveLength(4);
  });

  it("silently discards a consumed cell that already had real text, with no error", () => {
    const tableElement = buildTable({ rows: 1, columns: 3 });
    const table = new DocxTable([tableElement], tableElement);
    table.cell(0, 0).appendParagraph({ text: "anchor" });
    table.cell(0, 1).appendParagraph({ text: "about to be discarded" });

    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 2)).not.toThrow();
    expect(table.rows()[0]!.cells()).toHaveLength(2);
  });

  it("throws for an out-of-range startColumnIndex or a colSpan exceeding the row width", () => {
    const tableElement = buildTable({ rows: 1, columns: 2 });
    const table = new DocxTable([tableElement], tableElement);
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

  it("a merged table survives a real docx read/build round trip with the right colSpan", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 1, columns: 4 });
    const anchor = table.rows()[0]!.mergeCellsHorizontally(1, 2);
    anchor.appendParagraph({ text: "merged" });

    const pkg = decodePackage(encodePackage(editor.toPackage()));
    const content = readDocxContent(pkg);
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const roundTrippedTable = content.sections[0]?.blocks.find(
      (b) => b.kind === "table",
    );
    if (roundTrippedTable?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(3);
    expect(roundTrippedTable.rows[0]?.cells[1]?.colSpan).toBe(2);
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
