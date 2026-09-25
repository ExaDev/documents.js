import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import type { ContentTable } from "document-schema.js";
import { walkTableGrid } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { attrValue } from "../../xml/query";
import { StyleRegistry } from "../../styles/registry";
import {
  readOdfTable,
  writeOdfTable,
  type OdfTableWriteContext,
} from "./table";

// Grammar verified against a real LibreOffice-generated .odp: a presentation's own draw:frame-wrapped table uses table:table/table:table-column/table:table-row/table:table-cell/table:covered-table-cell, column width via table:table-column's own table:style-name -> a style:family="table-column" style:style's style:table-column-properties/@style:column-width, row height the analogous table:family="table-row"/style:table-row-properties/@style:row-height — and, notably, a real saved table frame carries an EXTRA sibling draw:image (an .svm fallback preview) alongside table:table, which shapes.ts's own readDrawFrameContent (not this module) is responsible for not mistaking for the frame's real content.

function contentPackage(
  automaticStyleChildren: readonly XmlElement[] = [],
): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, automaticStyleChildren),
      ]),
    ],
  };
}

function cell(
  text: string,
  extraAttrs: Readonly<Record<string, string>> = {},
): XmlElement {
  return el("table:table-cell", extraAttrs, [el("text:p", {}, [txt(text)])]);
}

// ContentTable's grid rule (ContentTableCell in document-schema.js): a row's `cells` holds one entry per grid column, a merged region is an anchor plus a block-less entry at every other position it covers, and which entries are covered is derived from the anchors' spans.
describe("the grid rule: readOdfTable output is dense", () => {
  function coveredPositions(table: ContentTable): string[] {
    return walkTableGrid(table)
      .flat()
      .filter((position) => position.anchorRowIndex !== undefined)
      .map(
        (position) =>
          `${String(position.rowIndex)},${String(position.columnIndex)}<-${String(position.anchorRowIndex)},${String(position.anchorColumnIndex)}`,
      );
  }

  const THREE_COLUMN_COUNT = 3;

  function threeColumns(): XmlElement {
    return el("table:table-column", {
      "table:number-columns-repeated": `${THREE_COLUMN_COUNT}`,
    });
  }

  function expectEveryRowAsWideAsTheColumns(table: ContentTable): void {
    expect(table.columns).toHaveLength(THREE_COLUMN_COUNT);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(table.columns.length);
    }
  }

  it("keeps a real entry at the position a horizontal merge covers, so every row is as wide as the columns", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        threeColumns(),
        el("table:table-row", {}, [
          cell("A", { "table:number-columns-spanned": "2" }),
          el("table:covered-table-cell"),
          cell("C"),
        ]),
        el("table:table-row", {}, [cell("D"), cell("E"), cell("F")]),
      ]),
      { parts: {} },
    );
    expectEveryRowAsWideAsTheColumns(table);
    expect(table.rows[0]?.cells[0]).toMatchObject({ colSpan: 2 });
    expect(table.rows[0]?.cells[1]?.blocks).toEqual([]);
    expect(table.rows[0]?.cells[2]?.blocks).toHaveLength(1);
    expect(coveredPositions(table)).toEqual(["0,1<-0,0"]);
  });

  it("keeps a real entry at the position a vertical merge covers in the rows below", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        threeColumns(),
        el("table:table-row", {}, [
          cell("A", { "table:number-rows-spanned": "2" }),
          cell("B"),
          cell("C"),
        ]),
        el("table:table-row", {}, [
          el("table:covered-table-cell"),
          cell("E"),
          cell("F"),
        ]),
      ]),
      { parts: {} },
    );
    expectEveryRowAsWideAsTheColumns(table);
    expect(table.rows[0]?.cells[0]).toMatchObject({ rowSpan: 2 });
    expect(table.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(table.rows[1]?.cells[1]?.blocks).toHaveLength(1);
    expect(coveredPositions(table)).toEqual(["1,0<-0,0"]);
  });

  it("keeps a real entry at every position a 2x2 merge covers, including one produced by table:number-columns-repeated", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        threeColumns(),
        el("table:table-row", {}, [
          cell("A", {
            "table:number-columns-spanned": "2",
            "table:number-rows-spanned": "2",
          }),
          el("table:covered-table-cell"),
          cell("C"),
        ]),
        el("table:table-row", {}, [
          el("table:covered-table-cell", {
            "table:number-columns-repeated": "2",
          }),
          cell("F"),
        ]),
      ]),
      { parts: {} },
    );
    expectEveryRowAsWideAsTheColumns(table);
    expect(table.rows[0]?.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(coveredPositions(table)).toEqual([
      "0,1<-0,0",
      "1,0<-0,0",
      "1,1<-0,0",
    ]);
  });

  it("never reads a covered element's own content, since the region's content belongs to the anchor", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row", {}, [
          cell("A", { "table:number-columns-spanned": "2" }),
          el("table:covered-table-cell", {}, [el("text:p", {}, [txt("lost")])]),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.rows[0]?.cells[1]?.blocks).toEqual([]);
  });

  it("gives a covered position no span of its own, whatever its element states", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row", {}, [
          cell("A", { "table:number-columns-spanned": "2" }),
          el("table:covered-table-cell", {
            "table:number-columns-spanned": "5",
            "table:number-rows-spanned": "5",
          }),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.rows[0]?.cells[1]?.colSpan).toBeUndefined();
    expect(table.rows[0]?.cells[1]?.rowSpan).toBeUndefined();
  });
});

describe("a covered position's own background and borders", () => {
  const coveredStyle = el(
    "style:style",
    { "style:name": "ce1", "style:family": "table-cell" },
    [
      el("style:table-cell-properties", {
        "fo:background-color": "#00ff00",
        "fo:border-left": "2pt solid #0000ff",
      }),
    ],
  );

  const expectedBackground = {
    kind: "solid",
    color: { r: 0, g: 1, b: 0 },
  } as const;
  const expectedBorders = {
    left: { color: { r: 0, g: 0, b: 1 }, widthPt: 2, style: "solid" },
  } as const;

  it("are read from the table:covered-table-cell's own table:style-name", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("A", { "table:number-columns-spanned": "2" }),
        el("table:covered-table-cell", { "table:style-name": "ce1" }),
      ]),
    ]);
    const pkg: Package = {
      parts: { "content.xml": contentPackage([coveredStyle]) },
    };
    const covered = readOdfTable(table, pkg).rows[0]?.cells[1];
    expect(covered?.background).toEqual(expectedBackground);
    expect(covered?.borders).toEqual(expectedBorders);
    expect(covered?.blocks).toEqual([]);
  });

  it("are carried onto every entry a repeated covered element expands into", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("A", { "table:number-columns-spanned": "3" }),
        el("table:covered-table-cell", {
          "table:style-name": "ce1",
          "table:number-columns-repeated": "2",
        }),
      ]),
    ]);
    const pkg: Package = {
      parts: { "content.xml": contentPackage([coveredStyle]) },
    };
    const cells = readOdfTable(table, pkg).rows[0]?.cells;
    expect(cells?.[1]?.background).toEqual(expectedBackground);
    expect(cells?.[2]?.background).toEqual(expectedBackground);
  });

  it("are written onto the table:covered-table-cell and read back after a round trip", () => {
    const automaticStyles = el("office:automatic-styles", {}, []);
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [el("office:document-content", {}, [automaticStyles])],
        },
      },
    };
    let nextTable = 1;
    const context: OdfTableWriteContext = {
      registry: StyleRegistry.forPart(pkg, "content.xml"),
      mintTableName: () => `Table${nextTable++}`,
      mintListStyleName: (kind) => `L${kind}`,
    };
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 10 }, { widthPt: 10 }],
      rows: [
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
              colSpan: 2,
            },
            {
              blocks: [],
              background: expectedBackground,
              borders: expectedBorders,
            },
          ],
        },
      ],
    };
    const written = writeOdfTable(table, context);
    const row = written.children.find(
      (n): n is XmlElement =>
        n.type === "element" && n.tag === "table:table-row",
    );
    const writtenCells =
      row === undefined
        ? []
        : row.children.filter((n): n is XmlElement => n.type === "element");
    expect(writtenCells[1]?.tag).toBe("table:covered-table-cell");
    expect(attrValue(writtenCells[1]!, "table:style-name")).toBeDefined();
    expect(attrValue(writtenCells[1]!, "table:number-columns-spanned")).toBe(
      undefined,
    );

    const reread = readOdfTable(written, pkg);
    expect(reread.rows[0]?.cells[1]?.background).toEqual(expectedBackground);
    expect(reread.rows[0]?.cells[1]?.borders).toEqual(expectedBorders);
    expect(reread.rows[0]?.cells[1]?.blocks).toEqual([]);
  });

  it("are written without a table:style-name when the covered entry states neither", () => {
    const automaticStyles = el("office:automatic-styles", {}, []);
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [el("office:document-content", {}, [automaticStyles])],
        },
      },
    };
    const context: OdfTableWriteContext = {
      registry: StyleRegistry.forPart(pkg, "content.xml"),
      mintTableName: () => "Table1",
      mintListStyleName: (kind) => `L${kind}`,
    };
    const written = writeOdfTable(
      {
        kind: "table",
        columns: [{ widthPt: 10 }, { widthPt: 10 }],
        rows: [{ cells: [{ blocks: [], colSpan: 2 }, { blocks: [] }] }],
      },
      context,
    );
    const row = written.children.find(
      (n): n is XmlElement =>
        n.type === "element" && n.tag === "table:table-row",
    );
    const writtenCells =
      row === undefined
        ? []
        : row.children.filter((n): n is XmlElement => n.type === "element");
    expect(writtenCells[1]?.tag).toBe("table:covered-table-cell");
    expect(writtenCells[1]?.attributes).toHaveLength(0);
  });
});
