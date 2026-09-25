import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import type { ContentTable, ContentTableCell } from "document-schema.js";
import { el } from "../../xml/fragment";
import { attrValue } from "../../xml/query";
import { StyleRegistry } from "../../styles/registry";
import {
  readOdfTable,
  writeOdfTable,
  type OdfTableWriteContext,
} from "./table";

// Grammar verified against a real LibreOffice-generated .odp: a presentation's own draw:frame-wrapped table uses table:table/table:table-column/table:table-row/table:table-cell/table:covered-table-cell, column width via table:table-column's own table:style-name -> a style:family="table-column" style:style's style:table-column-properties/@style:column-width, row height the analogous table:family="table-row"/style:table-row-properties/@style:row-height — and, notably, a real saved table frame carries an EXTRA sibling draw:image (an .svm fallback preview) alongside table:table, which shapes.ts's own readDrawFrameContent (not this module) is responsible for not mistaking for the frame's real content.

// The text of every cell of every row, so a test states the flattened rows and their order as data rather than by indexing into blocks.
function rowTexts(table: ContentTable): string[][] {
  return table.rows.map((row) =>
    row.cells.map((tableCell) =>
      tableCell.blocks
        .flatMap((block) =>
          block.kind === "paragraph"
            ? block.runs.map((run) => ("text" in run ? run.text : ""))
            : [],
        )
        .join(""),
    ),
  );
}

describe("writeOdfTable", () => {
  // Returns the write context alongside the minted <style:style> elements, read back from the SAME automaticStyles element object registry.intern() pushes into — the identical pattern styles/registry.test.ts's own automaticStylesOf establishes, rather than reaching into the registry's own private fields.
  function writeContext(): {
    context: OdfTableWriteContext;
    mintedStyles: () => XmlElement[];
    pkg: Package;
  } {
    const automaticStyles = el("office:automatic-styles", {}, []);
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [el("office:document-content", {}, [automaticStyles])],
        },
      },
    };
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    let nextTable = 1;
    return {
      context: {
        registry,
        mintTableName: () => `Table${nextTable++}`,
        mintListStyleName: (kind) => `L${kind}`,
      },
      mintedStyles: () =>
        automaticStyles.children.filter(
          (c): c is XmlElement =>
            c.type === "element" && c.tag === "style:style",
        ),
      pkg,
    };
  }

  function paragraphCell(text: string): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
  }

  // attrValue itself requires a real XmlElement; every caller here is reading an attribute off a `.find`/array-index result that is legitimately `XmlElement | undefined` under noUncheckedIndexedAccess, so this short-circuits the same way optional chaining does rather than asserting the element is present.
  function attr(
    element: XmlElement | undefined,
    name: string,
  ): string | undefined {
    return element === undefined ? undefined : attrValue(element, name);
  }

  function elementsWithTag(nodes: XmlElement["children"], tag: string) {
    return nodes.filter(
      (n): n is XmlElement => n.type === "element" && n.tag === tag,
    );
  }

  describe("a table breaking the grid rule", () => {
    // A merged header whose covered position carries a second copy of the anchor's content, which a table:covered-table-cell has no room for.
    const coveredContentTable: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            { ...paragraphCell("anchor"), colSpan: 2 },
            paragraphCell("copy"),
          ],
        },
      ],
    };

    it("is refused, naming the entry point and the fault, rather than dropping the covered content", () => {
      const { context } = writeContext();
      expect(() => writeOdfTable(coveredContentTable, context)).toThrow(
        "writeOdfTable: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
      );
    });

    it("is refused before a table name is minted", () => {
      const { context } = writeContext();
      expect(() => writeOdfTable(coveredContentTable, context)).toThrow();
      const clean = writeOdfTable(
        { kind: "table", rows: [], columns: [] },
        context,
      );
      expect(attrValue(clean, "table:name")).toBe("Table1");
    });

    it("is refused when it is the whole content of another table's cell", () => {
      const { context } = writeContext();
      const outer: ContentTable = {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [{ cells: [{ blocks: [coveredContentTable] }] }],
      };
      expect(() => writeOdfTable(outer, context)).toThrow(
        /^writeOdfTable: table breaks the grid rule/,
      );
    });
  });

  it("mints a document-unique table:name from the context on every call", () => {
    const { context } = writeContext();
    const table: ContentTable = {
      kind: "table",
      rows: [],
      columns: [],
    };
    const first = writeOdfTable(table, context);
    const second = writeOdfTable(table, context);
    expect(attrValue(first, "table:name")).toBe("Table1");
    expect(attrValue(second, "table:name")).toBe("Table2");
  });

  it("writes one table:table-column per column width, with no style-name for a non-positive width", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [],
      columns: [{ widthPt: 0 }, { widthPt: 100 }],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const columns = elementsWithTag(written.children, "table:table-column");
    expect(columns).toHaveLength(2);
    expect(attr(columns[0], "table:style-name")).toBeUndefined();
    expect(attr(columns[1], "table:style-name")).toBeDefined();
  });

  it("wraps a leading run of header columns in one table:table-header-columns and leaves the plain columns as direct children", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [],
      columns: [
        { widthPt: 10, isHeader: true },
        { widthPt: 20, isHeader: true },
        { widthPt: 30 },
      ],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const wrappers = elementsWithTag(
      written.children,
      "table:table-header-columns",
    );
    expect(wrappers).toHaveLength(1);
    expect(
      elementsWithTag(wrappers[0]!.children, "table:table-column"),
    ).toHaveLength(2);
    expect(
      elementsWithTag(written.children, "table:table-column"),
    ).toHaveLength(1);
  });

  it("writes no wrapper at all for a table whose columns state no header", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [],
      columns: [{ widthPt: 10 }, { widthPt: 20 }],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    expect(
      elementsWithTag(written.children, "table:table-header-columns"),
    ).toHaveLength(0);
    expect(
      elementsWithTag(written.children, "table:table-column"),
    ).toHaveLength(2);
  });

  // A header column that is neither leading nor contiguous with the leading block is stated as its own wrapper rather than dropped or folded into the first one, the column-axis mirror of the identical row-axis test above: ODF's own content model allows several table:table-header-columns blocks in one table, so nothing has to be lost to write it.
  it("gives each run of header columns its own wrapper, keeping every column in document order", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [],
      columns: [
        { widthPt: 10 },
        { widthPt: 20, isHeader: true },
        { widthPt: 30 },
        { widthPt: 40, isHeader: true },
        { widthPt: 50, isHeader: true },
      ],
    };
    const { context, pkg } = writeContext();
    const written = writeOdfTable(table, context);
    expect(
      written.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual([
      "table:table-column",
      "table:table-header-columns",
      "table:table-column",
      "table:table-header-columns",
    ]);
    const reread = readOdfTable(written, pkg);
    expect(reread.columns.map((c) => c.widthPt)).toEqual(
      table.columns.map((c) => c.widthPt),
    );
    expect(reread.columns.map((c) => c.isHeader)).toEqual([
      undefined,
      true,
      undefined,
      true,
      true,
    ]);
  });

  it("writes a table:style-name on a row only when it carries a heightPt", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        { cells: [paragraphCell("a")] },
        { cells: [paragraphCell("b")], heightPt: 20 },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const rows = elementsWithTag(written.children, "table:table-row");
    expect(attr(rows[0], "table:style-name")).toBeUndefined();
    expect(attr(rows[1], "table:style-name")).toBeDefined();
  });

  it("wraps a leading run of header rows in one table:table-header-rows and leaves the body rows as direct children", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        { cells: [paragraphCell("H1")], isHeader: true },
        { cells: [paragraphCell("H2")], isHeader: true },
        { cells: [paragraphCell("B")] },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const wrappers = elementsWithTag(
      written.children,
      "table:table-header-rows",
    );
    expect(wrappers).toHaveLength(1);
    expect(
      elementsWithTag(wrappers[0]!.children, "table:table-row"),
    ).toHaveLength(2);
    expect(elementsWithTag(written.children, "table:table-row")).toHaveLength(
      1,
    );
  });

  it("writes no wrapper at all for a table whose rows state no header", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [{ cells: [paragraphCell("a")] }, { cells: [paragraphCell("b")] }],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    expect(
      elementsWithTag(written.children, "table:table-header-rows"),
    ).toHaveLength(0);
    expect(elementsWithTag(written.children, "table:table-row")).toHaveLength(
      2,
    );
  });

  // A header row that is neither leading nor contiguous with the leading block is stated as its own wrapper rather than dropped or folded into the first one: ODF's own content model allows several table:table-header-rows blocks in one table, so nothing has to be lost to write it.
  it("gives each run of header rows its own wrapper, keeping every row in document order", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        { cells: [paragraphCell("b1")] },
        { cells: [paragraphCell("h1")], isHeader: true },
        { cells: [paragraphCell("b2")] },
        { cells: [paragraphCell("h2")], isHeader: true },
        { cells: [paragraphCell("h3")], isHeader: true },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    expect(
      written.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual([
      "table:table-row",
      "table:table-header-rows",
      "table:table-row",
      "table:table-header-rows",
    ]);
    const reread = readOdfTable(written, { parts: {} });
    expect(rowTexts(reread)).toEqual([["b1"], ["h1"], ["b2"], ["h2"], ["h3"]]);
    expect(reread.rows.map((row) => row.isHeader)).toEqual([
      undefined,
      true,
      undefined,
      true,
      true,
    ]);
  });

  it("writes a row's own height style onto a header row as well, since the wrapper changes nothing about the row itself", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [{ cells: [paragraphCell("h")], isHeader: true, heightPt: 20 }],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const wrapper = elementsWithTag(
      written.children,
      "table:table-header-rows",
    )[0];
    const row = elementsWithTag(wrapper!.children, "table:table-row")[0];
    expect(attr(row, "table:style-name")).toBeDefined();
    expect(readOdfTable(written, { parts: {} }).rows[0]?.isHeader).toBe(true);
  });

  it("writes a style:width on the table's own style only when the columns state a positive total width", () => {
    const withWidth: ContentTable = {
      kind: "table",
      rows: [],
      columns: [{ widthPt: 50 }, { widthPt: 50 }],
    };
    const withoutWidth: ContentTable = {
      kind: "table",
      rows: [],
      columns: [],
    };
    const { context: ctxWith, mintedStyles: stylesWith } = writeContext();
    writeOdfTable(withWidth, ctxWith);
    const tableStyleWith = stylesWith().find(
      (s) => attrValue(s, "style:family") === "table",
    );
    const propsWith = tableStyleWith?.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:table-properties",
    );
    expect(attr(propsWith, "style:width")).toBeDefined();

    const { context: ctxWithout, mintedStyles: stylesWithout } = writeContext();
    writeOdfTable(withoutWidth, ctxWithout);
    const tableStyleWithout = stylesWithout().find(
      (s) => attrValue(s, "style:family") === "table",
    );
    const propsWithout = tableStyleWithout?.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:table-properties",
    );
    expect(attr(propsWithout, "style:width")).toBeUndefined();
  });

  it("marks a colSpan'd cell's own covered neighbour, writing it as table:covered-table-cell", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "anchor" }] }],
              colSpan: 2,
            },
            { blocks: [] },
          ],
        },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const row = elementsWithTag(written.children, "table:table-row")[0];
    const rowCells =
      row === undefined
        ? []
        : row.children.filter((n): n is XmlElement => n.type === "element");
    expect(rowCells[0]?.tag).toBe("table:table-cell");
    expect(attr(rowCells[0], "table:number-columns-spanned")).toBe("2");
    expect(rowCells[1]?.tag).toBe("table:covered-table-cell");
  });

  it("marks a rowSpan'd cell's own covered neighbour in the row below, writing it as table:covered-table-cell", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "anchor" }] }],
              rowSpan: 2,
            },
            paragraphCell("sibling"),
          ],
        },
        { cells: [{ blocks: [] }, paragraphCell("plain")] },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const rows = elementsWithTag(written.children, "table:table-row");
    const row1Cells =
      rows[1] === undefined
        ? []
        : rows[1].children.filter((n): n is XmlElement => n.type === "element");
    expect(row1Cells[0]?.tag).toBe("table:covered-table-cell");
    expect(row1Cells[1]?.tag).toBe("table:table-cell");
  });

  it("writes the anchor's own table:number-rows-spanned and table:number-columns-spanned values", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            { ...paragraphCell("a"), colSpan: 2, rowSpan: 3 },
            { blocks: [] },
          ],
        },
        { cells: [{ blocks: [] }, { blocks: [] }] },
        { cells: [{ blocks: [] }, { blocks: [] }] },
      ],
      columns: [{ widthPt: 10 }, { widthPt: 10 }],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const row = elementsWithTag(written.children, "table:table-row")[0];
    const anchor =
      row === undefined
        ? undefined
        : row.children.find((n): n is XmlElement => n.type === "element");
    expect(attr(anchor, "table:number-columns-spanned")).toBe("2");
    expect(attr(anchor, "table:number-rows-spanned")).toBe("3");
  });

  it("writes table:number-columns-spanned/table:number-rows-spanned only when the cell actually states a span", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [{ cells: [paragraphCell("plain")] }],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const row = elementsWithTag(written.children, "table:table-row")[0];
    const writtenCell =
      row === undefined
        ? undefined
        : row.children.find((n): n is XmlElement => n.type === "element");
    expect(attr(writtenCell, "table:number-columns-spanned")).toBeUndefined();
    expect(attr(writtenCell, "table:number-rows-spanned")).toBeUndefined();
  });

  it("writes a table:style-name on a cell only when it carries background or borders", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            paragraphCell("plain"),
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "filled" }] }],
              background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
            },
          ],
        },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const row = elementsWithTag(written.children, "table:table-row")[0];
    const cells =
      row === undefined
        ? []
        : row.children.filter((n): n is XmlElement => n.type === "element");
    expect(attr(cells[0], "table:style-name")).toBeUndefined();
    expect(attr(cells[1], "table:style-name")).toBeDefined();
  });

  it("writes each per-edge border only for edges the cell actually states, leaving the others absent", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "bordered" }] }],
              borders: {
                left: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
              },
            },
          ],
        },
      ],
      columns: [],
    };
    const { context, mintedStyles } = writeContext();
    writeOdfTable(table, context);
    const cellStyleEl = mintedStyles().find(
      (s) => attrValue(s, "style:family") === "table-cell",
    );
    const props = cellStyleEl?.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:table-cell-properties",
    );
    expect(attr(props, "fo:border-left")).toBeDefined();
    expect(attr(props, "fo:border-top")).toBeUndefined();
    expect(attr(props, "fo:border-right")).toBeUndefined();
    expect(attr(props, "fo:border-bottom")).toBeUndefined();
  });

  it("groups consecutive same-list paragraphs into one text:list, closing it when membership changes", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "item1" }],
                  list: { numId: "bullet:list1", level: 0 },
                },
                {
                  kind: "paragraph",
                  runs: [{ text: "item2" }],
                  list: { numId: "bullet:list1", level: 0 },
                },
                { kind: "paragraph", runs: [{ text: "plain" }] },
              ],
            },
          ],
        },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const row = elementsWithTag(written.children, "table:table-row")[0];
    const writtenCell =
      row === undefined
        ? undefined
        : row.children.find((n): n is XmlElement => n.type === "element");
    const cellChildren =
      writtenCell === undefined
        ? []
        : writtenCell.children.filter(
            (n): n is XmlElement => n.type === "element",
          );
    expect(cellChildren).toHaveLength(2);
    expect(cellChildren[0]?.tag).toBe("text:list");
    expect(cellChildren[0]?.children).toHaveLength(2);
    expect(cellChildren[1]?.tag).toBe("text:p");
  });

  it("closes an open list and starts a fresh one when membership switches to a different numId", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "a" }],
                  list: { numId: "bullet:list1", level: 0 },
                },
                {
                  kind: "paragraph",
                  runs: [{ text: "b" }],
                  list: { numId: "ordered:list2", level: 0 },
                },
              ],
            },
          ],
        },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const row = elementsWithTag(written.children, "table:table-row")[0];
    const writtenCell =
      row === undefined
        ? undefined
        : row.children.find((n): n is XmlElement => n.type === "element");
    const cellChildren =
      writtenCell === undefined
        ? []
        : writtenCell.children.filter(
            (n): n is XmlElement => n.type === "element",
          );
    expect(cellChildren).toHaveLength(2);
    expect(cellChildren[0]?.tag).toBe("text:list");
    expect(cellChildren[1]?.tag).toBe("text:list");
  });

  it("writes a nested table found inside a cell by recursing into writeOdfTable, minting its own table:name off the same document-wide counter", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  kind: "table",
                  rows: [{ cells: [paragraphCell("nested")] }],
                  columns: [],
                },
              ],
            },
          ],
        },
      ],
      columns: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    expect(attrValue(written, "table:name")).toBe("Table1");
    const row = elementsWithTag(written.children, "table:table-row")[0];
    const writtenCell =
      row === undefined
        ? undefined
        : row.children.find((n): n is XmlElement => n.type === "element");
    const nestedTable =
      writtenCell === undefined
        ? undefined
        : writtenCell.children.find(
            (n): n is XmlElement =>
              n.type === "element" && n.tag === "table:table",
          );
    expect(
      nestedTable === undefined
        ? undefined
        : attrValue(nestedTable, "table:name"),
    ).toBe("Table2");
  });

  it("refuses to write a cell block kind readTableCell could never read back, naming the offending kind", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  kind: "image",
                  format: "png",
                  base64: "",
                  widthPt: 1,
                  heightPt: 1,
                },
              ],
            },
          ],
        },
      ],
      columns: [],
    };
    const { context } = writeContext();
    expect(() => writeOdfTable(table, context)).toThrow(/image/);
  });
});
