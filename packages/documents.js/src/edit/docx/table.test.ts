import type { XmlElement, XmlNode } from "ooxml.js";
import { buildXml, decodePackage, el, encodePackage } from "ooxml.js";
import { tableGridColumnCount, walkTableGrid } from "document-schema.js";
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

  it("setting colSpan again while one already exists replaces it rather than leaving a stale gridSpan behind", () => {
    const tableElement = buildTable({ rows: 1, columns: 3 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    cell.colSpan = 2;
    cell.colSpan = 3;
    expect(cell.colSpan).toBe(3);
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

  it("vertical merge already works with zero new code — the existing verticalMerge setter alone round-trips correctly", () => {
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

  it("isHeader is false for a row with no w:tblHeader, and a header row written through the live editor survives a real docx read/build round trip", () => {
    const editor = createDocx();
    const table = editor.body.appendTable({ rows: 2, columns: 1 });
    const row = table.rows()[0]!;
    expect(row.isHeader).toBe(false);
    row.isHeader = true;
    expect(row.isHeader).toBe(true);

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
    expect(roundTrippedTable.rows.map((r) => r.isHeader)).toEqual([
      true,
      undefined,
    ]);
  });

  it("isHeader can be set back to false on a row that already carries the flag, alongside a height", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const row = table.rows()[0]!;
    row.isHeader = true;
    row.heightPt = 20;
    expect(row.isHeader).toBe(true);
    expect(row.heightPt).toBeCloseTo(20, 5);
    row.isHeader = false;
    expect(row.isHeader).toBe(false);
    expect(row.heightPt).toBeCloseTo(20, 5);
  });

  it("heightPt can be updated to a new value and cleared back to undefined on a row that already has one", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const row = table.rows()[0]!;
    row.heightPt = 20;
    expect(row.heightPt).toBeCloseTo(20, 5);
    row.heightPt = 40;
    expect(row.heightPt).toBeCloseTo(40, 5);
    row.heightPt = undefined;
    expect(row.heightPt).toBeUndefined();
  });
});

describe("DocxTableCell background", () => {
  // Walks down to the row-0/col-0 cell's own w:tcPr, creating it (via the public colSpan setter, mirroring the "colSpan and verticalMerge coexist" test above) when the cell has none yet — so a test can hand-insert a raw w:shd shape this editor's own setter never writes (it always writes w:val="clear"), the same way a real producer's own docx can.
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

  it("setting background again while one already exists replaces it rather than leaving a stale w:shd behind", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    cell.background = { r: 1, g: 0, b: 0 };
    cell.background = { r: 0, g: 0, b: 1 };
    expect(cell.background).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('resolves a w:val="solid" shading from w:color, not w:fill — the real bug this getter once had, since it read w:fill unconditionally regardless of w:val', () => {
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

describe("DocxTableCell.borders", () => {
  // Same walk-to-w:tcPr helper as the background describe block above, duplicated locally since that one is scoped to its own describe callback.
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

  it("borders is undefined for a cell with no w:tcBorders, and round-trips all four edges through the setter", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    expect(cell.borders).toBeUndefined();

    cell.borders = {
      top: { color: { r: 1, g: 0, b: 0 }, widthPt: 2, style: "dashed" },
      left: { color: { r: 0, g: 1, b: 0 }, widthPt: 1.5, style: "dotted" },
      bottom: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5, style: "double" },
      right: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
    };

    expect(cell.borders).toEqual({
      top: { color: { r: 1, g: 0, b: 0 }, widthPt: 2, style: "dashed" },
      left: { color: { r: 0, g: 1, b: 0 }, widthPt: 1.5, style: "dotted" },
      bottom: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5, style: "double" },
      right: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
    });
  });

  it("setting borders again while one already exists replaces it rather than leaving a stale w:tcBorders behind", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    cell.borders = {
      top: { color: { r: 1, g: 0, b: 0 }, widthPt: 2, style: "dashed" },
    };
    expect(cell.borders).toEqual({
      top: { color: { r: 1, g: 0, b: 0 }, widthPt: 2, style: "dashed" },
    });
    cell.borders = {
      left: { color: { r: 0, g: 1, b: 0 }, widthPt: 1, style: "solid" },
    };
    expect(cell.borders).toEqual({
      left: { color: { r: 0, g: 1, b: 0 }, widthPt: 1, style: "solid" },
    });
  });

  it("clearing borders (undefined) removes w:tcBorders entirely", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    cell.borders = {
      top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
    };
    expect(cell.borders).not.toBeUndefined();
    cell.borders = undefined;
    expect(cell.borders).toBeUndefined();
  });

  it("clearing borders on a cell with no w:tcPr at all is a no-op, not an error", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    expect(() => {
      cell.borders = undefined;
    }).not.toThrow();
    expect(cell.borders).toBeUndefined();
  });

  it('an edge whose w:val is "nil" or "none" is excluded from the read-back borders, and an edge with neither w:sz nor w:color falls back to a 1pt black solid border', () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    const tcPr = tcPrOf(tableElement, cell);
    tcPr.children.push(
      el("w:tcBorders", {}, [
        el("w:top", { "w:val": "nil" }),
        el("w:left", { "w:val": "none" }),
        el("w:bottom", { "w:val": "single" }),
      ]),
    );

    const borders = cell.borders;
    expect(borders?.top).toBeUndefined();
    expect(borders?.left).toBeUndefined();
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
  });

  it('an edge whose w:color is "auto" (rather than absent) also falls back to black', () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    const tcPr = tcPrOf(tableElement, cell);
    tcPr.children.push(
      el("w:tcBorders", {}, [
        el("w:top", { "w:val": "single", "w:sz": "16", "w:color": "auto" }),
      ]),
    );

    expect(cell.borders?.top).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 2,
      style: "solid",
    });
  });

  it("borders is undefined when w:tcBorders is present but every edge is nil/none, since an empty resolved map is treated the same as no borders at all", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    const tcPr = tcPrOf(tableElement, cell);
    tcPr.children.push(
      el("w:tcBorders", {}, [
        el("w:top", { "w:val": "nil" }),
        el("w:left", { "w:val": "none" }),
      ]),
    );

    expect(cell.borders).toBeUndefined();
  });

  it("an unrecognised w:val reads back as the 'solid' default, mirroring ooxml.js read.js's own fallback for unrecognised vals", () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(0, 0);
    const tcPr = tcPrOf(tableElement, cell);
    tcPr.children.push(
      el("w:tcBorders", {}, [
        el("w:top", { "w:val": "wave", "w:sz": "8", "w:color": "123456" }),
      ]),
    );

    expect(cell.borders?.top?.style).toBe("solid");
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
    // The four-column row reads back dense: the anchor at column 1 and an empty covered cell at column 2, the column its w:gridSpan reaches.
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[0]?.cells[1]?.colSpan).toBe(2);
    expect(roundTrippedTable.rows[0]?.cells[2]).toEqual({ blocks: [] });
  });
});

// Builds a one-row table of `count` cells whose text is a, b, c, ... so an assertion can tell which cells a merge kept.
function labelledRowTable(count: number): DocxTable {
  const tableElement = buildTable({ rows: 1, columns: count });
  const table = new DocxTable([tableElement], tableElement);
  for (let column = 0; column < count; column++) {
    table
      .cell(0, column)
      .appendParagraph({ text: String.fromCharCode(97 + column) });
  }
  return table;
}

describe("DocxTableRow.mergeCellsHorizontally addresses grid columns", () => {
  it("finds the start column by accumulating the gridSpan of the cells before it, not by counting w:tc elements", () => {
    const table = labelledRowTable(5);
    const row = table.rows()[0]!;
    row.mergeCellsHorizontally(0, 2);
    // The row now reads a (grid columns 0-1), c (2), d (3), e (4). Grid column 2 is c, whose physical index is 1.
    row.mergeCellsHorizontally(2, 2);

    const cells = row.cells();
    expect(cells.map((cell) => cell.text.replace(/^\n/, ""))).toEqual([
      "a",
      "c",
      "e",
    ]);
    expect(cells.map((cell) => cell.colSpan)).toEqual([2, 2, undefined]);
  });

  it("refuses a start column that lies inside a cell spanning several grid columns, naming the column", () => {
    const table = labelledRowTable(4);
    const row = table.rows()[0]!;
    row.mergeCellsHorizontally(0, 3);
    expect(() => row.mergeCellsHorizontally(1, 2)).toThrow(
      /column 1 is covered by the cell starting at column 0/,
    );
    expect(row.cells()).toHaveLength(2);
  });

  it("refuses a merge that would cut through a cell spanning past the region's last column, naming both columns", () => {
    const table = labelledRowTable(4);
    const row = table.rows()[0]!;
    row.mergeCellsHorizontally(1, 3);
    expect(() => row.mergeCellsHorizontally(0, 2)).toThrow(
      /column 1 spans columns 1 to 3, past the last merged column 1/,
    );
    expect(row.cells().map((cell) => cell.colSpan)).toEqual([undefined, 3]);
  });

  it("reports a colSpan reaching past the row's grid width in grid columns", () => {
    const table = labelledRowTable(4);
    const row = table.rows()[0]!;
    row.mergeCellsHorizontally(0, 2);
    // Three w:tc remain but four grid columns: counting w:tc elements would allow colSpan 3 from column 3 and refuse colSpan 4 from column 0.
    expect(() => row.mergeCellsHorizontally(2, 3)).toThrow(
      /exceeds this row's own 4 grid columns/,
    );
    expect(() => row.mergeCellsHorizontally(0, 5)).toThrow(
      /exceeds this row's own 4 grid columns/,
    );
    expect(() => row.mergeCellsHorizontally(1, 1)).toThrow(/covered by/);
    expect(() => row.mergeCellsHorizontally(0, 4)).not.toThrow();
    expect(row.cells()).toHaveLength(1);
  });

  it("widens a spanning cell over the plain cells beside it, and treats a merge that changes nothing as allowed", () => {
    const table = labelledRowTable(4);
    const row = table.rows()[0]!;
    row.mergeCellsHorizontally(0, 2);
    row.mergeCellsHorizontally(0, 3);
    expect(row.cells().map((cell) => cell.colSpan)).toEqual([3, undefined]);
    expect(() => row.mergeCellsHorizontally(0, 3)).not.toThrow();
    expect(row.cells().map((cell) => cell.colSpan)).toEqual([3, undefined]);
  });
});

describe("DocxTableRow.mergeCellsHorizontally row shape", () => {
  it("does not treat a column before the first as existing", () => {
    const row = labelledRowTable(3).rows()[0]!;
    expect(() => row.mergeCellsHorizontally(-1, 2)).toThrow(/does not exist/);
    expect(row.cells()).toHaveLength(3);
  });

  it("counts only w:tc elements when a row also holds row properties", () => {
    const row = labelledRowTable(4).rows()[0]!;
    row.heightPt = 20;
    row.mergeCellsHorizontally(1, 2);
    expect(row.cells().map((cell) => cell.colSpan)).toEqual([
      undefined,
      2,
      undefined,
    ]);
    expect(row.cells().map((cell) => cell.text.trim())).toEqual([
      "a",
      "b",
      "d",
    ]);
  });
});

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
