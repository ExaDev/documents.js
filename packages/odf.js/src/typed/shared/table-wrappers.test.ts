import { describe, expect, it } from "vitest";
import type { ContentTable } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { walkTableGrid } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readOdfTable } from "./table";

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

function columnStyle(name: string, widthPt: number): XmlElement {
  return el(
    "style:style",
    { "style:name": name, "style:family": "table-column" },
    [
      el("style:table-column-properties", {
        "style:column-width": `${widthPt}pt`,
      }),
    ],
  );
}

function rowStyle(name: string, heightPt: number): XmlElement {
  return el(
    "style:style",
    { "style:name": name, "style:family": "table-row" },
    [el("style:table-row-properties", { "style:row-height": `${heightPt}pt` })],
  );
}

function cell(
  text: string,
  extraAttrs: Readonly<Record<string, string>> = {},
): XmlElement {
  return el("table:table-cell", extraAttrs, [el("text:p", {}, [txt(text)])]);
}

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

describe("readOdfTable: row wrappers (table:table-header-rows, table:table-rows, table:table-row-group)", () => {
  it("reads the rows inside table:table-header-rows in document order, ahead of the body rows that follow", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column", { "table:number-columns-repeated": "2" }),
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [cell("H1"), cell("H2")]),
        ]),
        el("table:table-row", {}, [cell("B1"), cell("B2")]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([
      ["H1", "H2"],
      ["B1", "B2"],
    ]);
  });

  it("reads several rows inside one table:table-header-rows, and honours table:number-rows-repeated on a row inside it", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [cell("H1")]),
          el("table:table-row", { "table:number-rows-repeated": "2" }, [
            cell("H2"),
          ]),
        ]),
        el("table:table-row", {}, [cell("B")]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([["H1"], ["H2"], ["H2"], ["B"]]);
  });

  it("keeps a row before, a header-rows wrapper, and a row after in the order the file states them", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row", {}, [cell("first")]),
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [cell("header")]),
        ]),
        el("table:table-row", {}, [cell("last")]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([["first"], ["header"], ["last"]]);
  });

  it("marks every row inside table:table-header-rows as a header row, and leaves the body rows unmarked", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [cell("H1")]),
          el("table:table-row", {}, [cell("H2")]),
        ]),
        el("table:table-row", {}, [cell("B")]),
      ]),
      { parts: {} },
    );
    expect(table.rows.map((row) => row.isHeader)).toEqual([
      true,
      true,
      undefined,
    ]);
  });

  it("marks a repeated header row's every copy, since table:number-rows-repeated stands for identical rows inside the same wrapper", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-row", { "table:number-rows-repeated": "3" }, [
            cell("H"),
          ]),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.rows.map((row) => row.isHeader)).toEqual([true, true, true]);
  });

  it("marks the rows of a table:table-header-rows nested inside a table:table-row-group, however deep the groups go", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row-group", {}, [
          el("table:table-row", {}, [cell("before")]),
          el("table:table-row-group", {}, [
            el("table:table-header-rows", {}, [
              el("table:table-row", {}, [cell("deep-header")]),
            ]),
            el("table:table-row", {}, [cell("after")]),
          ]),
        ]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([["before"], ["deep-header"], ["after"]]);
    expect(table.rows.map((row) => row.isHeader)).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });

  it("marks a header wrapper that does not lead the table, rather than only a leading one", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row", {}, [cell("body")]),
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [cell("late-header")]),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.rows.map((row) => row.isHeader)).toEqual([undefined, true]);
  });

  it("leaves a row inside table:table-rows or a plain row group unmarked, since neither states a header", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-rows", {}, [el("table:table-row", {}, [cell("a")])]),
        el("table:table-row-group", {}, [
          el("table:table-row", {}, [cell("b")]),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.rows.map((row) => row.isHeader)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("reads the rows inside table:table-rows", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-rows", {}, [
          el("table:table-row", {}, [cell("a")]),
          el("table:table-row", {}, [cell("b")]),
        ]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([["a"], ["b"]]);
  });

  it("reads the rows inside table:table-row-group", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row", {}, [cell("before")]),
        el("table:table-row-group", {}, [
          el("table:table-row", {}, [cell("g1")]),
          el("table:table-row", {}, [cell("g2")]),
        ]),
        el("table:table-row", {}, [cell("after")]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([["before"], ["g1"], ["g2"], ["after"]]);
  });

  it("reads a table:table-row-group nested inside another, and a table:table-header-rows inside a group, all in document order", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row-group", {}, [
          el("table:table-header-rows", {}, [
            el("table:table-row", {}, [cell("outer-header")]),
          ]),
          el("table:table-row", {}, [cell("outer-row")]),
          el("table:table-row-group", {}, [
            el("table:table-row", {}, [cell("inner-1")]),
            el("table:table-row-group", {}, [
              el("table:table-row", {}, [cell("innermost")]),
            ]),
            el("table:table-row", {}, [cell("inner-2")]),
          ]),
          el("table:table-rows", {}, [
            el("table:table-row", {}, [cell("outer-rows")]),
          ]),
        ]),
        el("table:table-row", {}, [cell("tail")]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([
      ["outer-header"],
      ["outer-row"],
      ["inner-1"],
      ["innermost"],
      ["inner-2"],
      ["outer-rows"],
      ["tail"],
    ]);
  });

  it("does not read a table:table-row that sits inside a column wrapper", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column-group", {}, [
          el("table:table-row", {}, [cell("stray")]),
        ]),
        el("table:table-row", {}, [cell("real")]),
      ]),
      { parts: {} },
    );
    expect(rowTexts(table)).toEqual([["real"]]);
  });

  it("does not descend into a cell, so a table nested in a cell contributes no rows to the outer table", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [
            el("table:table-cell", {}, [
              el("table:table", {}, [
                el("table:table-header-rows", {}, [
                  el("table:table-row", {}, [cell("inner")]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.rows).toHaveLength(1);
    const nested = table.rows[0]?.cells[0]?.blocks[0];
    expect(nested).toMatchObject({ kind: "table" });
    expect(nested?.kind === "table" ? rowTexts(nested) : []).toEqual([
      ["inner"],
    ]);
  });

  it("keeps the grid rule when a merged region sits inside table:table-header-rows", () => {
    const columnCount = 3;
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column", {
          "table:number-columns-repeated": `${columnCount}`,
        }),
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [
            cell("H", { "table:number-columns-spanned": "2" }),
            el("table:covered-table-cell"),
            cell("R", { "table:number-rows-spanned": "2" }),
          ]),
        ]),
        el("table:table-row", {}, [
          cell("a"),
          cell("b"),
          el("table:covered-table-cell"),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.columns).toHaveLength(columnCount);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(columnCount);
    }
    expect(rowTexts(table)).toEqual([
      ["H", "", "R"],
      ["a", "b", ""],
    ]);
    expect(table.rows[0]?.cells[0]).toMatchObject({ colSpan: 2 });
    expect(table.rows[0]?.cells[2]).toMatchObject({ rowSpan: 2 });
    const covered = walkTableGrid(table)
      .flat()
      .filter((position) => position.anchorRowIndex !== undefined)
      .map(
        (position) =>
          `${String(position.rowIndex)},${String(position.columnIndex)}<-${String(position.anchorRowIndex)},${String(position.anchorColumnIndex)}`,
      );
    expect(covered).toEqual(["0,1<-0,0", "1,2<-0,2"]);
  });

  it("reads a row height from a row inside a wrapper", () => {
    const rowHeightPt = 18;
    const pkg: Package = {
      parts: { "content.xml": contentPackage([rowStyle("ro1", rowHeightPt)]) },
    };
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-row", { "table:style-name": "ro1" }, [cell("H")]),
        ]),
      ]),
      pkg,
    );
    expect(table.rows[0]?.heightPt).toBe(rowHeightPt);
  });
});

describe("readOdfTable: column wrappers (table:table-header-columns, table:table-columns, table:table-column-group)", () => {
  const CO1_WIDTH_PT = 10;
  const CO2_WIDTH_PT = 20;
  const CO3_WIDTH_PT = 30;
  const CO4_WIDTH_PT = 40;

  function widthPkg(): Package {
    return {
      parts: {
        "content.xml": contentPackage([
          columnStyle("co1", CO1_WIDTH_PT),
          columnStyle("co2", CO2_WIDTH_PT),
          columnStyle("co3", CO3_WIDTH_PT),
          columnStyle("co4", CO4_WIDTH_PT),
        ]),
      },
    };
  }

  it("counts the columns inside table:table-header-columns, in document order with the plain columns around them", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-columns", {}, [
          el("table:table-column", { "table:style-name": "co1" }),
        ]),
        el("table:table-column", { "table:style-name": "co2" }),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.widthPt)).toEqual([
      CO1_WIDTH_PT,
      CO2_WIDTH_PT,
    ]);
  });

  it("honours table:number-columns-repeated on a column inside a wrapper", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-columns", {}, [
          el("table:table-column", {
            "table:style-name": "co1",
            "table:number-columns-repeated": "2",
          }),
        ]),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.widthPt)).toEqual([
      CO1_WIDTH_PT,
      CO1_WIDTH_PT,
    ]);
  });

  it("counts the columns inside table:table-columns", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-columns", {}, [
          el("table:table-column", { "table:style-name": "co1" }),
          el("table:table-column", { "table:style-name": "co2" }),
        ]),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.widthPt)).toEqual([
      CO1_WIDTH_PT,
      CO2_WIDTH_PT,
    ]);
  });

  it("counts the columns inside table:table-column-group, including a nested group and a header-columns wrapper inside one", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column", { "table:style-name": "co1" }),
        el("table:table-column-group", {}, [
          el("table:table-header-columns", {}, [
            el("table:table-column", { "table:style-name": "co2" }),
          ]),
          el("table:table-column-group", {}, [
            el("table:table-column", { "table:style-name": "co3" }),
          ]),
        ]),
        el("table:table-column", { "table:style-name": "co4" }),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.widthPt)).toEqual([
      CO1_WIDTH_PT,
      CO2_WIDTH_PT,
      CO3_WIDTH_PT,
      CO4_WIDTH_PT,
    ]);
  });

  it("does not read a table:table-column that sits inside a row wrapper", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-column", { "table:style-name": "co1" }),
        ]),
        el("table:table-column", { "table:style-name": "co2" }),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.widthPt)).toEqual([CO2_WIDTH_PT]);
  });

  it("states a grid as wide as the columns the file declares across wrappers, with every row as wide", () => {
    const repeatedColumnCount = 2;
    const totalColumnCount = 1 + repeatedColumnCount;
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-columns", {}, [el("table:table-column")]),
        el("table:table-column-group", {}, [
          el("table:table-column", {
            "table:number-columns-repeated": `${repeatedColumnCount}`,
          }),
        ]),
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [cell("a"), cell("b"), cell("c")]),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.columns).toHaveLength(totalColumnCount);
    expect(table.rows[0]?.cells).toHaveLength(totalColumnCount);
  });

  it("marks every column inside table:table-header-columns as a header column, and leaves the plain columns unmarked", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-columns", {}, [
          el("table:table-column", { "table:style-name": "co1" }),
          el("table:table-column", { "table:style-name": "co2" }),
        ]),
        el("table:table-column", { "table:style-name": "co3" }),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.isHeader)).toEqual([
      true,
      true,
      undefined,
    ]);
  });

  it("marks a repeated header column's every copy, since table:number-columns-repeated stands for identical columns inside the same wrapper", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-columns", {}, [
          el("table:table-column", {
            "table:style-name": "co1",
            "table:number-columns-repeated": "3",
          }),
        ]),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.isHeader)).toEqual([true, true, true]);
  });

  it("marks the columns of a table:table-header-columns nested inside a table:table-column-group, however deep the groups go", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column-group", {}, [
          el("table:table-column", { "table:style-name": "co1" }),
          el("table:table-column-group", {}, [
            el("table:table-header-columns", {}, [
              el("table:table-column", { "table:style-name": "co2" }),
            ]),
            el("table:table-column", { "table:style-name": "co3" }),
          ]),
        ]),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.widthPt)).toEqual([
      CO1_WIDTH_PT,
      CO2_WIDTH_PT,
      CO3_WIDTH_PT,
    ]);
    expect(table.columns.map((c) => c.isHeader)).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });

  it("marks a header wrapper that does not lead the table, rather than only a leading one", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column", { "table:style-name": "co1" }),
        el("table:table-header-columns", {}, [
          el("table:table-column", { "table:style-name": "co2" }),
        ]),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.isHeader)).toEqual([undefined, true]);
  });

  it("leaves a column inside table:table-columns or a plain column group unmarked, since neither states a header", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-columns", {}, [
          el("table:table-column", { "table:style-name": "co1" }),
        ]),
        el("table:table-column-group", {}, [
          el("table:table-column", { "table:style-name": "co2" }),
        ]),
      ]),
      widthPkg(),
    );
    expect(table.columns.map((c) => c.isHeader)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
