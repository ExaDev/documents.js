import type { XmlElement } from "odf.js";
import { decodePackage, encodePackage, rootElement } from "odf.js";
import {
  findTableGridFault,
  tableGridColumnCount,
  walkTableGrid,
} from "document-schema.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "../../odf/odt/read";
import { el, txt } from "../../xml/fragment";
import { findDescendantElement, walkElements } from "../../xml/query";
import { createOdt } from "./editor";
import type { OdtTable } from "./table";

// Finds styleName's own style:table-row-properties inside automaticStyles, throwing rather than returning undefined — every caller below already knows the style must exist by this point.
function findRowStyleProperties(
  automaticStyles: XmlElement,
  styleName: string,
): XmlElement {
  const style = automaticStyles.children.find(
    (c) =>
      c.type === "element" &&
      c.tag === "style:style" &&
      attr(c, "style:name") === styleName,
  );
  if (style?.type !== "element") {
    throw new Error(`expected style:style named ${styleName}`);
  }
  const props = style.children.find(
    (c): c is XmlElement =>
      c.type === "element" && c.tag === "style:table-row-properties",
  );
  if (props === undefined) {
    throw new Error(`expected style:table-row-properties on ${styleName}`);
  }
  return props;
}

describe("OdtTable", () => {
  it("appendTable builds the right row/column count with paragraph-per-cell", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    table.cell(0, 0).appendParagraph({ text: "A1" });
    table.cell(0, 1).appendParagraph({ text: "B1" });
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[0]!.cells()).toHaveLength(2);
    expect(table.cell(0, 0).text).toContain("A1");
    expect(table.cell(0, 1).text).toContain("B1");
  });

  it("appendRow adds a row with the given column count", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.appendRow(2);
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[1]!.cells()).toHaveLength(2);
  });

  it("cell() throws for an out-of-range row or column", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    expect(() => table.cell(5, 0)).toThrow(/row 5/);
    expect(() => table.cell(0, 5)).toThrow(/column 5/);
  });

  it("colSpan/rowSpan write and read table:number-columns/rows-spanned, and clearing them removes the attribute", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    const cell = table.cell(0, 0);
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
    cell.colSpan = 2;
    cell.rowSpan = 3;
    expect(cell.colSpan).toBe(2);
    expect(cell.rowSpan).toBe(3);
    cell.colSpan = undefined;
    cell.rowSpan = undefined;
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
  });

  it("paragraphs() surfaces a text:h cell child as a paragraph with its headingLevel readable, matching OdtBody.paragraphs's own both-tag walk", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const cell = table.cell(0, 0);
    cell.paragraphs()[0]!.appendRun({ text: "Cell heading" });
    cell.paragraphs()[0]!.headingLevel = 2;
    // The headingLevel setter retagged the cell's own first paragraph element to text:h in place — the cell read view must still see it, or a heading written into a cell (buildOdtPackage's own populateCellBlocks now does exactly that) would be invisible to the editor surface and cell.text would silently drop its words.
    expect(cell.paragraphs()).toHaveLength(1);
    expect(cell.paragraphs()[0]!.headingLevel).toBe(2);
    expect(cell.paragraphs()[0]!.text).toBe("Cell heading");
    expect(cell.text).toBe("Cell heading");
  });

  it("appendEmptyRow + appendCell/appendCoveredCell build a row cell by cell, matching appendRow's own uniform-grid cell count", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 0, columns: 2 });
    const row = table.appendEmptyRow();
    const cell = row.appendCell();
    cell.paragraphs()[0]!.appendRun({ text: "A1" });
    row.appendCoveredCell();
    expect(table.rows()).toHaveLength(1);
    // cells() only surfaces table:table-cell, not table:covered-table-cell, so the covered placeholder is invisible to it — matching odf.js's own readTableRow, which reads a covered-table-cell as a distinct, contentless entry.
    expect(table.rows()[0]!.cells()).toHaveLength(1);
    expect(table.rows()[0]!.cells()[0]!.text).toBe("A1");
  });

  it("appendCoveredCell returns a view that states the covered position's own background and borders, read back through the same style", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 0, columns: 2 });
    const row = table.appendEmptyRow();
    row.appendCell().colSpan = 2;
    const covered = row.appendCoveredCell();
    expect(covered.background).toBeUndefined();
    expect(covered.borders).toBeUndefined();
    covered.background = { r: 1, g: 0, b: 0 };
    covered.borders = { top: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 } };
    expect(covered.background).toEqual({ r: 1, g: 0, b: 0 });
    // Setting borders after the background mints a style carrying both, rather than the second setter clobbering the first.
    expect(covered.borders.top).toMatchObject({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 2,
    });
    expect(covered.background).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("remove() removes the table and throws on any further use", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    expect(editor.tables()).toHaveLength(1);
    table.remove();
    expect(editor.tables()).toHaveLength(0);
    expect(() => table.rows()).toThrow(/removed/);
  });

  it("distinct column widths intern distinct table-column styles; identical widths across two tables reuse the same one", () => {
    const editor = createOdt();
    editor.body.appendTable({
      rows: 1,
      columns: 2,
      columnWidthsPt: [100, 200],
    });
    editor.body.appendTable({
      rows: 1,
      columns: 1,
      columnWidthsPt: [100],
    });

    const contentPart = editor.toPackage().parts["content.xml"];
    const root = rootElement(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
    );
    const automaticStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:automatic-styles",
    );
    const columnStyles =
      automaticStyles?.type === "element"
        ? automaticStyles.children.filter(
            (c) =>
              c.type === "element" &&
              c.tag === "style:style" &&
              c.attributes.some(
                (a) => a.name === "style:family" && a.value === "table-column",
              ),
          )
        : [];
    // Two distinct widths (100pt, 200pt) across the first table, plus the second table's 100pt column reusing the first table's own 100pt style — so exactly two table-column styles total, not three.
    expect(columnStyles).toHaveLength(2);
  });
});

describe("OdtTable header rows", () => {
  function tableOfRows(rowCount: number): OdtTable {
    const editor = createOdt();
    return editor.body.appendTable({ rows: rowCount, columns: 1 });
  }

  it("states no header row until one is asked for", () => {
    const table = tableOfRows(2);
    expect(table.headerRows()).toEqual([false, false]);
  });

  it("wraps each run of header rows in its own table:table-header-rows, keeping every row in order", () => {
    const table = tableOfRows(4);
    ["a", "b", "c", "d"].forEach((text, index) => {
      table.rows()[index]!.cells()[0]!.appendParagraph({ text });
    });
    table.setHeaderRows([true, false, true, true]);
    expect(table.headerRows()).toEqual([true, false, true, true]);
    expect(table.rows()).toHaveLength(4);
    expect(
      table.rows().map((row) => row.cells()[0]?.paragraphs().at(-1)?.text),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("restates the wrappers rather than nesting them when the flags change", () => {
    const table = tableOfRows(3);
    table.setHeaderRows([true, true, false]);
    table.setHeaderRows([false, true, false]);
    expect(table.headerRows()).toEqual([false, true, false]);
    expect(table.rows()).toHaveLength(3);
  });

  it("reads a row's cells and the grid through the wrappers, not just the table's own direct children", () => {
    const table = tableOfRows(2);
    table.setHeaderRows([true, false]);
    expect(table.gridRows()).toHaveLength(2);
    expect(table.gridColumnCount()).toBe(1);
  });
});

describe("OdtTable header columns", () => {
  function tableOfColumns(columnCount: number): OdtTable {
    const editor = createOdt();
    return editor.body.appendTable({ rows: 1, columns: columnCount });
  }

  it("states no header column until one is asked for", () => {
    const table = tableOfColumns(2);
    expect(table.headerColumns()).toEqual([false, false]);
  });

  it("wraps each run of header columns in its own table:table-header-columns, keeping every column in order", () => {
    const table = tableOfColumns(4);
    table.setHeaderColumns([true, false, true, true]);
    expect(table.headerColumns()).toEqual([true, false, true, true]);
    expect(table.gridColumnCount()).toBe(4);
  });

  it("restates the wrappers rather than nesting them when the flags change", () => {
    const table = tableOfColumns(3);
    table.setHeaderColumns([true, true, false]);
    table.setHeaderColumns([false, true, false]);
    expect(table.headerColumns()).toEqual([false, true, false]);
    expect(table.gridColumnCount()).toBe(3);
  });

  it("reads a row's cells and the grid through the wrappers, not just the table's own direct children", () => {
    const table = tableOfColumns(2);
    table.setHeaderColumns([true, false]);
    expect(table.gridRows()).toHaveLength(1);
    expect(table.gridColumnCount()).toBe(2);
  });

  it("keeps every cell's own content when the columns it sits under are wrapped", () => {
    const table = tableOfColumns(2);
    table.rows()[0]!.cells()[0]!.appendParagraph({ text: "a" });
    table.rows()[0]!.cells()[1]!.appendParagraph({ text: "b" });
    table.setHeaderColumns([true, false]);
    expect(
      table
        .rows()[0]!
        .cells()
        .map((cell) => cell.paragraphs().at(-1)?.text),
    ).toEqual(["a", "b"]);
  });
});

describe("OdtTableRow.heightPt", () => {
  it("is undefined for a row with no style, and round-trips a value written through the setter", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const row = table.rows()[0]!;
    expect(row.heightPt).toBeUndefined();
    row.heightPt = 30;
    expect(row.heightPt).toBeCloseTo(30, 5);
  });

  it("clearing heightPt removes table:style-name entirely when no other row property remains", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const row = table.rows()[0]!;
    row.heightPt = 40;
    row.heightPt = undefined;
    expect(row.heightPt).toBeUndefined();

    const contentPart = editor.toPackage().parts["content.xml"];
    const rowElement = findDescendantElement(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
      "table:table-row",
    )?.node;
    if (rowElement === undefined) {
      throw new Error("expected a table:table-row element");
    }
    expect(attr(rowElement, "table:style-name")).toBeUndefined();
  });

  it("preserves another row-style property already present when setting or clearing heightPt, and never reuses a style carrying extra properties for a plain height-only row", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 1 });
    const [rowWithExtraProperty, plainRow] = table.rows();
    if (rowWithExtraProperty === undefined || plainRow === undefined) {
      throw new Error("expected two rows");
    }

    const contentPart = editor.toPackage().parts["content.xml"];
    const root = rootElement(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
    );
    const automaticStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:automatic-styles",
    );
    if (automaticStyles?.type !== "element") {
      throw new Error("expected office:automatic-styles");
    }
    // Simulates a table-row style a real external producer wrote (a document opened via openOdt()) — fo:break-before stands in for style:use-optimal-row-height/fo:keep-together/fo:background-color, the other properties the review names: the hazard (silently dropped on set, silently imported on reuse) is identical regardless of which property it is.
    automaticStyles.children.push(
      el(
        "style:style",
        { "style:name": "ExternalRowStyle", "style:family": "table-row" },
        [
          el("style:table-row-properties", {
            "style:row-height": "20pt",
            "fo:break-before": "page",
          }),
        ],
      ),
    );
    const rowElements = [
      ...walkElements(contentPart?.kind === "xml" ? contentPart.nodes : []),
    ]
      .map((cursor) => cursor.node)
      .filter((node) => node.tag === "table:table-row");
    const [firstRowElement, secondRowElement] = rowElements;
    if (firstRowElement === undefined || secondRowElement === undefined) {
      throw new Error("expected two table:table-row elements");
    }
    firstRowElement.attributes.push({
      name: "table:style-name",
      value: "ExternalRowStyle",
    });

    // The reuse loop must not hand ExternalRowStyle to a row that only asked for the matching height — doing so would silently import fo:break-before onto a row that never had it.
    plainRow.heightPt = 20;
    expect(attr(secondRowElement, "table:style-name")).not.toBe(
      "ExternalRowStyle",
    );

    // Setting a NEW height on the row that already carries fo:break-before must mint a style carrying both, not silently drop fo:break-before.
    rowWithExtraProperty.heightPt = 25;
    expect(rowWithExtraProperty.heightPt).toBeCloseTo(25, 5);
    const mintedStyleName = attr(firstRowElement, "table:style-name");
    if (mintedStyleName === undefined) {
      throw new Error("expected a table:style-name after setting heightPt");
    }
    expect(
      attr(
        findRowStyleProperties(automaticStyles, mintedStyleName),
        "fo:break-before",
      ),
    ).toBe("page");

    // Clearing the height must keep fo:break-before, minting a style carrying it alone rather than dropping table:style-name entirely.
    rowWithExtraProperty.heightPt = undefined;
    expect(rowWithExtraProperty.heightPt).toBeUndefined();
    const clearedStyleName = attr(firstRowElement, "table:style-name");
    if (clearedStyleName === undefined) {
      throw new Error(
        "expected table:style-name to remain, carrying fo:break-before",
      );
    }
    const clearedProps = findRowStyleProperties(
      automaticStyles,
      clearedStyleName,
    );
    expect(attr(clearedProps, "fo:break-before")).toBe("page");
    expect(attr(clearedProps, "style:row-height")).toBeUndefined();
  });

  it("preserves a row style's own child element (style:background-image) across a heightPt set and clear, and never reuses a style whose properties element carries a child the request doesn't", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 1 });
    const [rowWithBackgroundImage, plainRow] = table.rows();
    if (rowWithBackgroundImage === undefined || plainRow === undefined) {
      throw new Error("expected two rows");
    }

    const contentPart = editor.toPackage().parts["content.xml"];
    const root = rootElement(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
    );
    const automaticStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:automatic-styles",
    );
    if (automaticStyles?.type !== "element") {
      throw new Error("expected office:automatic-styles");
    }
    // style:background-image is the one child OASIS ODF 1.3's RelaxNG schema permits on style:table-row-properties — simulating a table-row style a real external producer (openOdt()) wrote, carrying it alongside a matching row-height.
    automaticStyles.children.push(
      el(
        "style:style",
        { "style:name": "ImageRowStyle", "style:family": "table-row" },
        [
          el("style:table-row-properties", { "style:row-height": "20pt" }, [
            el("style:background-image", { "xlink:href": "Pictures/bg.png" }),
          ]),
        ],
      ),
    );
    const rowElements = [
      ...walkElements(contentPart?.kind === "xml" ? contentPart.nodes : []),
    ]
      .map((cursor) => cursor.node)
      .filter((node) => node.tag === "table:table-row");
    const [firstRowElement, secondRowElement] = rowElements;
    if (firstRowElement === undefined || secondRowElement === undefined) {
      throw new Error("expected two table:table-row elements");
    }
    firstRowElement.attributes.push({
      name: "table:style-name",
      value: "ImageRowStyle",
    });

    // A plain row asking for the same 20pt height must NOT reuse ImageRowStyle — doing so would silently import a background image onto a row that never had one.
    plainRow.heightPt = 20;
    expect(attr(secondRowElement, "table:style-name")).not.toBe(
      "ImageRowStyle",
    );

    // Setting a NEW height on the row that already carries the background image must mint a style carrying both the new height AND the child element, not silently drop it.
    rowWithBackgroundImage.heightPt = 25;
    const mintedStyleName = attr(firstRowElement, "table:style-name");
    if (mintedStyleName === undefined) {
      throw new Error("expected a table:style-name after setting heightPt");
    }
    const mintedProps = findRowStyleProperties(
      automaticStyles,
      mintedStyleName,
    );
    const mintedBackgroundImage = mintedProps.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:background-image",
    );
    if (mintedBackgroundImage === undefined) {
      throw new Error("expected style:background-image to survive the set");
    }
    expect(attr(mintedBackgroundImage, "xlink:href")).toBe("Pictures/bg.png");

    // Clearing the height must keep the background image, minting a style carrying it alone rather than dropping table:style-name entirely.
    rowWithBackgroundImage.heightPt = undefined;
    const clearedStyleName = attr(firstRowElement, "table:style-name");
    if (clearedStyleName === undefined) {
      throw new Error(
        "expected table:style-name to remain, carrying the background image",
      );
    }
    const clearedProps = findRowStyleProperties(
      automaticStyles,
      clearedStyleName,
    );
    expect(attr(clearedProps, "style:row-height")).toBeUndefined();
    const clearedBackgroundImage = clearedProps.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:background-image",
    );
    if (clearedBackgroundImage === undefined) {
      throw new Error("expected style:background-image to survive the clear");
    }
    expect(attr(clearedBackgroundImage, "xlink:href")).toBe("Pictures/bg.png");
  });

  it('clears a pre-existing style:use-optimal-row-height="true" to "false" when an explicit height is set, but never introduces the attribute for a row that never had it', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 1 });
    const [autoFitRow, plainRow] = table.rows();
    if (autoFitRow === undefined || plainRow === undefined) {
      throw new Error("expected two rows");
    }

    const contentPart = editor.toPackage().parts["content.xml"];
    const root = rootElement(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
    );
    const automaticStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:automatic-styles",
    );
    if (automaticStyles?.type !== "element") {
      throw new Error("expected office:automatic-styles");
    }
    automaticStyles.children.push(
      el(
        "style:style",
        { "style:name": "AutoFitRowStyle", "style:family": "table-row" },
        [
          el("style:table-row-properties", {
            "style:row-height": "20pt",
            "style:use-optimal-row-height": "true",
          }),
        ],
      ),
    );
    const rowElements = [
      ...walkElements(contentPart?.kind === "xml" ? contentPart.nodes : []),
    ]
      .map((cursor) => cursor.node)
      .filter((node) => node.tag === "table:table-row");
    const [firstRowElement, secondRowElement] = rowElements;
    if (firstRowElement === undefined || secondRowElement === undefined) {
      throw new Error("expected two table:table-row elements");
    }
    firstRowElement.attributes.push({
      name: "table:style-name",
      value: "AutoFitRowStyle",
    });

    // Writing a new explicit height on a row whose style says "auto-fit to content" must turn that flag off — left at "true", a real consumer would keep auto-fitting and ignore the height this setter just wrote, even though the getter reports it back.
    autoFitRow.heightPt = 30;
    const autoFitStyleName = attr(firstRowElement, "table:style-name");
    if (autoFitStyleName === undefined) {
      throw new Error("expected a table:style-name after setting heightPt");
    }
    expect(
      attr(
        findRowStyleProperties(automaticStyles, autoFitStyleName),
        "style:use-optimal-row-height",
      ),
    ).toBe("false");

    // A row that never carried the flag at all must not gain it just because a height was set.
    plainRow.heightPt = 30;
    const plainStyleName = attr(secondRowElement, "table:style-name");
    if (plainStyleName === undefined) {
      throw new Error("expected a table:style-name after setting heightPt");
    }
    expect(
      attr(
        findRowStyleProperties(automaticStyles, plainStyleName),
        "style:use-optimal-row-height",
      ),
    ).toBeUndefined();
  });

  it("survives a real odt read/build round trip via readOdtContent", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    table.rows()[0]!.heightPt = 36;

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
    expect(roundTrippedTable.rows[0]?.heightPt).toBeCloseTo(36, 5);
  });

  it("two rows with the same height reuse one table-row style; a distinct height mints another", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 3, columns: 1 });
    table.rows()[0]!.heightPt = 20;
    table.rows()[1]!.heightPt = 20;
    table.rows()[2]!.heightPt = 50;

    const contentPart = editor.toPackage().parts["content.xml"];
    const root = rootElement(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
    );
    const automaticStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:automatic-styles",
    );
    const rowStyles =
      automaticStyles?.type === "element"
        ? automaticStyles.children.filter(
            (c) =>
              c.type === "element" &&
              c.tag === "style:style" &&
              c.attributes.some(
                (a) => a.name === "style:family" && a.value === "table-row",
              ),
          )
        : [];
    expect(rowStyles).toHaveLength(2);
  });
});

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
