import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readOdfTable, readCellStyleDecoration } from "./table";

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

function cellStyle(name: string, backgroundHex: string): XmlElement {
  return el(
    "style:style",
    { "style:name": name, "style:family": "table-cell" },
    [
      el("style:table-cell-properties", {
        "fo:background-color": backgroundHex,
      }),
    ],
  );
}

function cellBorderStyle(
  name: string,
  cellPropertyAttrs: Readonly<Record<string, string>>,
): XmlElement {
  return el(
    "style:style",
    { "style:name": name, "style:family": "table-cell" },
    [el("style:table-cell-properties", cellPropertyAttrs)],
  );
}

function cell(
  text: string,
  extraAttrs: Readonly<Record<string, string>> = {},
): XmlElement {
  return el("table:table-cell", extraAttrs, [el("text:p", {}, [txt(text)])]);
}

describe("readOdfTable: columns", () => {
  it("resolves each table:table-column's own width via its table:style-name -> table-column family style", () => {
    const firstColumnWidthPt = 100;
    const secondColumnWidthPt = 150;
    const co1 = columnStyle("co1", firstColumnWidthPt);
    const co2 = columnStyle("co2", secondColumnWidthPt);
    const table = el("table:table", {}, [
      el("table:table-column", { "table:style-name": "co1" }),
      el("table:table-column", { "table:style-name": "co2" }),
    ]);
    const pkg: Package = {
      parts: { "content.xml": contentPackage([co1, co2]) },
    };
    expect(readOdfTable(table, pkg).columns.map((c) => c.widthPt)).toEqual([
      firstColumnWidthPt,
      secondColumnWidthPt,
    ]);
  });

  it("defaults an unresolvable column width to 0pt, matching ooxml.js's own established readTable convention", () => {
    const table = el("table:table", {}, [el("table:table-column")]);
    expect(
      readOdfTable(table, { parts: {} }).columns.map((c) => c.widthPt),
    ).toEqual([0]);
  });

  it("expands table:number-columns-repeated into that many repeated width entries", () => {
    const columnWidthPt = 80;
    const repeatCount = 3;
    const co1 = columnStyle("co1", columnWidthPt);
    const table = el("table:table", {}, [
      el("table:table-column", {
        "table:style-name": "co1",
        "table:number-columns-repeated": `${repeatCount}`,
      }),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([co1]) } };
    expect(readOdfTable(table, pkg).columns.map((c) => c.widthPt)).toEqual(
      Array.from({ length: repeatCount }, () => columnWidthPt),
    );
  });
});

describe("readOdfTable: rows", () => {
  it("resolves each table:table-row's own height via its table:style-name -> table-row family style", () => {
    const rowHeightPt = 20;
    const ro1 = rowStyle("ro1", rowHeightPt);
    const table = el("table:table", {}, [
      el("table:table-row", { "table:style-name": "ro1" }, [cell("x")]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ro1]) } };
    expect(readOdfTable(table, pkg).rows[0]?.heightPt).toBe(rowHeightPt);
  });

  it('leaves heightPt undefined (not 0) when unresolvable — unlike column width, a missing row height is genuinely "unspecified"', () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [cell("x")]),
    ]);
    expect(
      readOdfTable(table, { parts: {} }).rows[0]?.heightPt,
    ).toBeUndefined();
  });

  it("expands table:number-rows-repeated into that many repeated rows", () => {
    const table = el("table:table", {}, [
      el("table:table-row", { "table:number-rows-repeated": "2" }, [cell("x")]),
    ]);
    expect(readOdfTable(table, { parts: {} }).rows).toHaveLength(2);
  });
});

describe("readOdfTable: cell content, spans, and covered cells", () => {
  it("reads each cell's own text:p children as paragraph blocks", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [cell("Hello")]),
    ]);
    const blocks = readOdfTable(table, { parts: {} }).rows[0]?.cells[0]?.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Hello" }],
    });
  });

  it("reads a text:h cell child as a heading paragraph, deriving headingLevel and the synthetic styleId from its text:outline-level", () => {
    const heading = el(
      "text:h",
      { "text:outline-level": "2", "text:style-name": "Heading_20_2" },
      [txt("Cell heading")],
    );
    const table = el("table:table", {}, [
      el("table:table-row", {}, [el("table:table-cell", {}, [heading])]),
    ]);
    const blocks = readOdfTable(table, { parts: {} }).rows[0]?.cells[0]?.blocks;
    expect(blocks?.[0]).toMatchObject({
      kind: "paragraph",
      styleId: "Heading2",
      headingLevel: 2,
      runs: [{ text: "Cell heading" }],
    });
  });

  it("keeps document order across a cell's mixed text:p and text:h children", () => {
    const cellElement = el("table:table-cell", {}, [
      el("text:p", {}, [txt("first")]),
      el("text:h", { "text:outline-level": "1" }, [txt("middle")]),
      el("text:p", {}, [txt("last")]),
    ]);
    const table = el("table:table", {}, [
      el("table:table-row", {}, [cellElement]),
    ]);
    const texts = readOdfTable(table, {
      parts: {},
    }).rows[0]?.cells[0]?.blocks.map((block) =>
      block.kind === "paragraph" ? block.runs[0]?.text : undefined,
    );
    expect(texts).toEqual(["first", "middle", "last"]);
  });

  it("reads table:number-columns-spanned/table:number-rows-spanned onto the anchor cell", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("Header", {
          "table:number-columns-spanned": "2",
          "table:number-rows-spanned": "3",
        }),
        el("table:covered-table-cell"),
      ]),
    ]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 3 });
  });

  it("reads a table:covered-table-cell as an empty placeholder cell, not the anchor's own content repeated", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("Header", { "table:number-columns-spanned": "2" }),
        el("table:covered-table-cell"),
      ]),
    ]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells[1]).toEqual({ blocks: [] });
  });

  it("expands a covered-table-cell's own table:number-columns-repeated into that many empty placeholder cells", () => {
    const coveredCellRepeatCount = 2;
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("Header", { "table:number-columns-spanned": "3" }),
        el("table:covered-table-cell", {
          "table:number-columns-repeated": `${coveredCellRepeatCount}`,
        }),
      ]),
    ]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    // The header cell itself, plus one placeholder per repeated covered cell.
    expect(row?.cells).toHaveLength(1 + coveredCellRepeatCount);
    expect(row?.cells[1]).toEqual({ blocks: [] });
    expect(row?.cells[2]).toEqual({ blocks: [] });
  });

  it("leaves colSpan/rowSpan undefined for a plain, unspanned cell", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [cell("plain")]),
    ]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells[0]?.colSpan).toBeUndefined();
    expect(row?.cells[0]?.rowSpan).toBeUndefined();
  });

  it("expands a cell's own table:number-columns-repeated into that many repeated cells", () => {
    const repeatCount = 3;
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("same", { "table:number-columns-repeated": `${repeatCount}` }),
      ]),
    ]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells).toHaveLength(repeatCount);
    expect(row?.cells.every((c) => c.blocks[0]?.kind === "paragraph")).toBe(
      true,
    );
  });
});

describe("readOdfTable: elements that are not cells", () => {
  it("skips a row child that is neither a table:table-cell nor a table:covered-table-cell", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("A"),
        el("text:soft-page-break"),
        cell("B"),
      ]),
    ]);
    expect(readOdfTable(table, { parts: {} }).rows[0]?.cells).toHaveLength(2);
  });

  it("reads only paragraphs, headings, lists and tables out of a cell, ignoring any other child element", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        el("table:table-cell", {}, [
          el("text:soft-page-break"),
          el("text:p", {}, [txt("kept")]),
        ]),
      ]),
    ]);
    const blocks = readOdfTable(table, { parts: {} }).rows[0]?.cells[0]?.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]?.kind).toBe("paragraph");
  });
});

describe("readOdfTable: cell background", () => {
  it("resolves fo:background-color from the cell's own table:style-name -> table-cell family style", () => {
    const ce1 = cellStyle("ce1", "#ff0000");
    const table = el("table:table", {}, [
      el("table:table-row", {}, [cell("red", { "table:style-name": "ce1" })]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ce1]) } };
    expect(readOdfTable(table, pkg).rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("leaves background undefined for a cell with no style-name", () => {
    const table = el("table:table", {}, [
      el("table:table-row", {}, [cell("plain")]),
    ]);
    expect(
      readOdfTable(table, { parts: {} }).rows[0]?.cells[0]?.background,
    ).toBeUndefined();
  });
});

describe("readOdfTable: cell borders (odt/odp — single-level table:style-name -> table-cell family style, matching background's own established lookup)", () => {
  it("expands the fo:border shorthand onto all four edges", () => {
    const ce1 = cellBorderStyle("ce1", { "fo:border": "1pt solid #ff0000" });
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("bordered", { "table:style-name": "ce1" }),
      ]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    const expectedEdge = {
      color: { r: 1, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    };
    expect(borders).toEqual({
      left: expectedEdge,
      right: expectedEdge,
      top: expectedEdge,
      bottom: expectedEdge,
    });
  });

  it("lets a per-edge fo:border-top override just that one edge, leaving the other three at the shorthand value", () => {
    const ce1 = cellBorderStyle("ce1", {
      "fo:border": "1pt solid #000000",
      "fo:border-top": "2pt dashed #00ff00",
    });
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("bordered", { "table:style-name": "ce1" }),
      ]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    expect(borders?.top).toEqual({
      color: { r: 0, g: 1, b: 0 },
      widthPt: 2,
      style: "dashed",
    });
    expect(borders?.left).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
    expect(borders?.right).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
  });

  it('reads a border style ODF allows but ContentBorderSchema has no member for (e.g. "groove") as a real border with width/colour, but no style field', () => {
    const RGB_CHANNEL_MAX = 255;
    const red = 0x12;
    const green = 0x34;
    const blue = 0x56;
    const hexRadix = 16;
    const hexColor = [red, green, blue]
      .map((c) => c.toString(hexRadix).padStart(2, "0"))
      .join("");
    const borderWidthPt = 0.5;
    const ce1 = cellBorderStyle("ce1", {
      "fo:border-left": `${borderWidthPt}pt groove #${hexColor}`,
    });
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("grooved", { "table:style-name": "ce1" }),
      ]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    expect(borders?.left).toEqual({
      color: {
        r: red / RGB_CHANNEL_MAX,
        g: green / RGB_CHANNEL_MAX,
        b: blue / RGB_CHANNEL_MAX,
      },
      widthPt: borderWidthPt,
    });
    expect(borders?.right).toBeUndefined();
  });

  it('treats a "none" border-style token as genuinely no border on that edge, not a real border', () => {
    const ce1 = cellBorderStyle("ce1", {
      "fo:border": "1pt solid #000000",
      "fo:border-bottom": "1pt none #000000",
    });
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("partial", { "table:style-name": "ce1" }),
      ]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    expect(borders?.bottom).toBeUndefined();
    expect(borders?.top).toBeDefined();
  });

  it("leaves borders undefined entirely for a cell whose style carries no fo:border(-*) attributes at all", () => {
    const ce1 = cellStyle("ce1", "#ff0000");
    const table = el("table:table", {}, [
      el("table:table-row", {}, [cell("red", { "table:style-name": "ce1" })]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ce1]) } };
    expect(readOdfTable(table, pkg).rows[0]?.cells[0]?.borders).toBeUndefined();
  });
});

describe("readOdfTable: overall shape", () => {
  it('always returns kind: "table"', () => {
    expect(readOdfTable(el("table:table"), { parts: {} }).kind).toBe("table");
  });

  it("handles an empty table:table with no columns or rows at all", () => {
    expect(readOdfTable(el("table:table"), { parts: {} })).toEqual({
      kind: "table",
      rows: [],
      columns: [],
    });
  });
});

describe("readOdfTable: repeat-count edge cases (readRepeatCount)", () => {
  it("a zero repeated count is invalid and falls back to a single entry, not zero entries", () => {
    const table = el("table:table", {}, [
      el("table:table-column", { "table:number-columns-repeated": "0" }),
    ]);
    expect(
      readOdfTable(table, { parts: {} }).columns.map((c) => c.widthPt),
    ).toEqual([0]);
  });

  it("a negative repeated count is invalid and falls back to a single entry", () => {
    const table = el("table:table", {}, [
      el("table:table-column", { "table:number-columns-repeated": "-3" }),
    ]);
    expect(
      readOdfTable(table, { parts: {} }).columns.map((c) => c.widthPt),
    ).toEqual([0]);
  });

  it("a non-numeric repeated count is invalid and falls back to a single entry", () => {
    const table = el("table:table", {}, [
      el("table:table-column", { "table:number-columns-repeated": "abc" }),
    ]);
    expect(
      readOdfTable(table, { parts: {} }).columns.map((c) => c.widthPt),
    ).toEqual([0]);
  });

  it("a genuinely positive repeated count on a row is honoured in full, not truncated", () => {
    const repeatCount = 4;
    const table = el("table:table", {}, [
      el(
        "table:table-row",
        { "table:number-rows-repeated": `${repeatCount}` },
        [cell("x")],
      ),
    ]);
    expect(readOdfTable(table, { parts: {} }).rows).toHaveLength(repeatCount);
  });
});

describe("readCellStyleDecoration", () => {
  function cellPropsStyle(attrs: Readonly<Record<string, string>>): XmlElement {
    return el("style:table-cell-properties", attrs);
  }

  it("returns everything undefined for an empty element list", () => {
    expect(readCellStyleDecoration([])).toEqual({
      background: undefined,
      borders: undefined,
      alignment: undefined,
      verticalAlignment: undefined,
    });
  });

  it("returns everything undefined when the style element carries neither a table-cell-properties nor a paragraph-properties child", () => {
    const styleElement = el("style:style", {});
    expect(readCellStyleDecoration([styleElement])).toEqual({
      background: undefined,
      borders: undefined,
      alignment: undefined,
      verticalAlignment: undefined,
    });
  });

  it.each(["top", "middle", "bottom"] as const)(
    "resolves style:vertical-align=%s",
    (value) => {
      const styleElement = el("style:style", {}, [
        cellPropsStyle({ "style:vertical-align": value }),
      ]);
      expect(readCellStyleDecoration([styleElement]).verticalAlignment).toBe(
        value,
      );
    },
  );

  it('leaves verticalAlignment undefined for "automatic", the one enumerated ODF value ContentSheetCell has no member for', () => {
    const styleElement = el("style:style", {}, [
      cellPropsStyle({ "style:vertical-align": "automatic" }),
    ]);
    expect(
      readCellStyleDecoration([styleElement]).verticalAlignment,
    ).toBeUndefined();
  });

  it.each(["left", "center", "right", "justify"] as const)(
    "resolves fo:text-align=%s from a sibling style:paragraph-properties child",
    (value) => {
      const styleElement = el("style:style", {}, [
        el("style:paragraph-properties", { "fo:text-align": value }),
      ]);
      expect(readCellStyleDecoration([styleElement]).alignment).toBe(value);
    },
  );

  it('leaves alignment undefined for a fo:text-align value this package does not model (e.g. ODF\'s own "start")', () => {
    const styleElement = el("style:style", {}, [
      el("style:paragraph-properties", { "fo:text-align": "start" }),
    ]);
    expect(readCellStyleDecoration([styleElement]).alignment).toBeUndefined();
  });

  it("folds background/alignment/verticalAlignment across a multi-element chain, a later element overriding an earlier one", () => {
    const base = el("style:style", {}, [
      cellPropsStyle({
        "fo:background-color": "#ff0000",
        "style:vertical-align": "top",
      }),
      el("style:paragraph-properties", { "fo:text-align": "left" }),
    ]);
    const override = el("style:style", {}, [
      cellPropsStyle({
        "fo:background-color": "#00ff00",
        "style:vertical-align": "bottom",
      }),
      el("style:paragraph-properties", { "fo:text-align": "right" }),
    ]);
    const decoration = readCellStyleDecoration([base, override]);
    expect(decoration.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
    expect(decoration.verticalAlignment).toBe("bottom");
    expect(decoration.alignment).toBe("right");
  });

  it("accumulates per-edge borders across a multi-element chain rather than only keeping the last element's own edges", () => {
    const withLeft = el("style:style", {}, [
      cellPropsStyle({ "fo:border-left": "1pt solid #000000" }),
    ]);
    const withTop = el("style:style", {}, [
      cellPropsStyle({ "fo:border-top": "2pt dashed #ffffff" }),
    ]);
    const decoration = readCellStyleDecoration([withLeft, withTop]);
    expect(decoration.borders?.left).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
    expect(decoration.borders?.top).toEqual({
      color: { r: 1, g: 1, b: 1 },
      widthPt: 2,
      style: "dashed",
    });
  });
});
