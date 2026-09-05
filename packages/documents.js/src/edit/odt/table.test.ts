import type { XmlElement } from "odf.js";
import { decodePackage, encodePackage, rootElement } from "odf.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { readOdtContent } from "../../odf/odt/read";
import { el } from "../../xml/fragment";
import { findDescendantElement, walkElements } from "../../xml/query";
import { createOdt } from "./editor";

// Finds styleName's own style:table-row-properties inside automaticStyles, throwing rather than returning undefined -- every caller below already knows the style must exist by this point.
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
    // The headingLevel setter retagged the cell's own first paragraph element to text:h in place -- the cell read view must still see it, or a heading written into a cell (buildOdtPackage's own populateCellBlocks now does exactly that) would be invisible to the editor surface and cell.text would silently drop its words.
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
    // cells() only surfaces table:table-cell, not table:covered-table-cell, so the covered placeholder is invisible to it -- matching odf.js's own readTableRow, which reads a covered-table-cell as a distinct, contentless entry.
    expect(table.rows()[0]!.cells()).toHaveLength(1);
    expect(table.rows()[0]!.cells()[0]!.text).toBe("A1");
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
    editor.body.appendTable({ rows: 1, columns: 1, columnWidthsPt: [100] });

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
    // Two distinct widths (100pt, 200pt) across the first table, plus the second table's 100pt column reusing the first table's own 100pt style -- so exactly two table-column styles total, not three.
    expect(columnStyles).toHaveLength(2);
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
    // Simulates a table-row style a real external producer wrote (a document opened via openOdt()) -- fo:break-before stands in for style:use-optimal-row-height/fo:keep-together/fo:background-color, the other properties the review names: the hazard (silently dropped on set, silently imported on reuse) is identical regardless of which property it is.
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

    // The reuse loop must not hand ExternalRowStyle to a row that only asked for the matching height -- doing so would silently import fo:break-before onto a row that never had it.
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
    // style:background-image is the one child OASIS ODF 1.3's RelaxNG schema permits on style:table-row-properties -- simulating a table-row style a real external producer (openOdt()) wrote, carrying it alongside a matching row-height.
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

    // A plain row asking for the same 20pt height must NOT reuse ImageRowStyle -- doing so would silently import a background image onto a row that never had one.
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

    // Writing a new explicit height on a row whose style says "auto-fit to content" must turn that flag off -- left at "true", a real consumer would keep auto-fitting and ignore the height this setter just wrote, even though the getter reports it back.
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

    // 4 grid positions still exist: 1 unmerged real cell (col 0), 1 anchor real cell with colSpan=2 (col 1), 1 table:covered-table-cell (col 2), and 1 unmerged real cell (col 3) -- 3 real cells total
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
      /already covered/,
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

describe("OdtTable.mergeCells", () => {
  it("merges a rowSpan x colSpan rectangle, proving the true-grid-column-index property through a prior horizontal merge", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 4 });

    // First, horizontally merge row 0's columns 1-2 -- this changes row 0's own shape (3 real cells instead of 4).
    table.rows()[0]!.mergeCellsHorizontally(1, 2);

    // Now merge a rowSpan=2 rectangle starting at grid column 1, spanning 2 columns, over BOTH rows -- this must correctly find grid column 1 in row 0 (now the already-merged anchor) and mark row 1's TRUE grid columns 1 and 2 as covered, despite row 0's own different real-cell-count shape.
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

  it("throws a clear error when the already-covered-anchor guard fires through mergeCells", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 3 });
    table.mergeCells(0, 0, 2, 2);
    expect(() => table.mergeCells(0, 1, 1, 1)).toThrow(/already covered/);
  });

  it("silently discards consumed content, matching the docx primitive's own precedent", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    table.cell(0, 1).appendParagraph({ text: "discarded" });
    table.cell(1, 0).appendParagraph({ text: "also discarded" });
    expect(() => table.mergeCells(0, 0, 2, 2)).not.toThrow();
  });

  it("throws for an out-of-range startRow or a rowSpan exceeding the table height", () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    expect(() => table.mergeCells(5, 0, 1, 1)).toThrow(/does not exist/);
    expect(() => table.mergeCells(0, 0, 5, 1)).toThrow(/exceeds/);
    expect(() => table.mergeCells(0, 0, 0, 1)).toThrow(/positive integer/);
  });
});
