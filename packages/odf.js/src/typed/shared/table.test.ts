import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import type { ContentTable, ContentTableCell } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { attrValue } from "../../xml/query";
import { StyleRegistry } from "../../styles/registry";
import {
  readOdfTable,
  readCellStyleDecoration,
  writeOdfTable,
  type OdfTableWriteContext,
} from "./table";

// Grammar verified against a real LibreOffice-generated .odp: a presentation's own draw:frame-wrapped table uses table:table/table:table-column/table:table-row/table:table-cell/table:covered-table-cell, column width via table:table-column's own table:style-name -> a style:family="table-column" style:style's style:table-column-properties/@style:column-width, row height the analogous table:family="table-row"/style:table-row-properties/@style:row-height -- and, notably, a real saved table frame carries an EXTRA sibling draw:image (an .svm fallback preview) alongside table:table, which shapes.ts's own readDrawFrameContent (not this module) is responsible for not mistaking for the frame's real content.

function contentPackage(
  automaticStyleChildren: XmlElement[] = [],
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
  cellPropertyAttrs: Record<string, string>,
): XmlElement {
  return el(
    "style:style",
    { "style:name": name, "style:family": "table-cell" },
    [el("style:table-cell-properties", cellPropertyAttrs)],
  );
}

function cell(
  text: string,
  extraAttrs: Record<string, string> = {},
): XmlElement {
  return el("table:table-cell", extraAttrs, [el("text:p", {}, [txt(text)])]);
}

describe("readOdfTable: columns", () => {
  it("resolves each table:table-column's own width via its table:style-name -> table-column family style", () => {
    const co1 = columnStyle("co1", 100);
    const co2 = columnStyle("co2", 150);
    const table = el("table:table", {}, [
      el("table:table-column", { "table:style-name": "co1" }),
      el("table:table-column", { "table:style-name": "co2" }),
    ]);
    const pkg: Package = {
      parts: { "content.xml": contentPackage([co1, co2]) },
    };
    expect(readOdfTable(table, pkg).columnWidthsPt).toEqual([100, 150]);
  });

  it("defaults an unresolvable column width to 0pt, matching ooxml.js's own established readTable convention", () => {
    const table = el("table:table", {}, [el("table:table-column")]);
    expect(readOdfTable(table, { parts: {} }).columnWidthsPt).toEqual([0]);
  });

  it("expands table:number-columns-repeated into that many repeated width entries", () => {
    const co1 = columnStyle("co1", 80);
    const table = el("table:table", {}, [
      el("table:table-column", {
        "table:style-name": "co1",
        "table:number-columns-repeated": "3",
      }),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([co1]) } };
    expect(readOdfTable(table, pkg).columnWidthsPt).toEqual([80, 80, 80]);
  });
});

describe("readOdfTable: rows", () => {
  it("resolves each table:table-row's own height via its table:style-name -> table-row family style", () => {
    const ro1 = rowStyle("ro1", 20);
    const table = el("table:table", {}, [
      el("table:table-row", { "table:style-name": "ro1" }, [cell("x")]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ro1]) } };
    expect(readOdfTable(table, pkg).rows[0]?.heightPt).toBe(20);
  });

  it('leaves heightPt undefined (not 0) when unresolvable -- unlike column width, a missing row height is genuinely "unspecified"', () => {
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
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("Header", { "table:number-columns-spanned": "3" }),
        el("table:covered-table-cell", {
          "table:number-columns-repeated": "2",
        }),
      ]),
    ]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells).toHaveLength(3);
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
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("same", { "table:number-columns-repeated": "3" }),
      ]),
    ]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells).toHaveLength(3);
    expect(row?.cells.every((c) => c.blocks[0]?.kind === "paragraph")).toBe(
      true,
    );
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

describe("readOdfTable: cell borders (odt/odp -- single-level table:style-name -> table-cell family style, matching background's own established lookup)", () => {
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
    const ce1 = cellBorderStyle("ce1", {
      "fo:border-left": "0.5pt groove #123456",
    });
    const table = el("table:table", {}, [
      el("table:table-row", {}, [
        cell("grooved", { "table:style-name": "ce1" }),
      ]),
    ]);
    const pkg: Package = { parts: { "content.xml": contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    expect(borders?.left).toEqual({
      color: { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255 },
      widthPt: 0.5,
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
      columnWidthsPt: [],
    });
  });
});

describe("readOdfTable: repeat-count edge cases (readRepeatCount)", () => {
  it("a zero repeated count is invalid and falls back to a single entry, not zero entries", () => {
    const table = el("table:table", {}, [
      el("table:table-column", { "table:number-columns-repeated": "0" }),
    ]);
    expect(readOdfTable(table, { parts: {} }).columnWidthsPt).toEqual([0]);
  });

  it("a negative repeated count is invalid and falls back to a single entry", () => {
    const table = el("table:table", {}, [
      el("table:table-column", { "table:number-columns-repeated": "-3" }),
    ]);
    expect(readOdfTable(table, { parts: {} }).columnWidthsPt).toEqual([0]);
  });

  it("a non-numeric repeated count is invalid and falls back to a single entry", () => {
    const table = el("table:table", {}, [
      el("table:table-column", { "table:number-columns-repeated": "abc" }),
    ]);
    expect(readOdfTable(table, { parts: {} }).columnWidthsPt).toEqual([0]);
  });

  it("a genuinely positive repeated count on a row is honoured in full, not truncated", () => {
    const table = el("table:table", {}, [
      el("table:table-row", { "table:number-rows-repeated": "4" }, [cell("x")]),
    ]);
    expect(readOdfTable(table, { parts: {} }).rows).toHaveLength(4);
  });
});

describe("readCellStyleDecoration", () => {
  function cellPropsStyle(attrs: Record<string, string>): XmlElement {
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

describe("writeOdfTable", () => {
  // Returns the write context alongside the minted <style:style> elements, read back from the SAME automaticStyles element object registry.intern() pushes into -- the identical pattern styles/registry.test.ts's own automaticStylesOf establishes, rather than reaching into the registry's own private fields.
  function writeContext(): {
    context: OdfTableWriteContext;
    mintedStyles: () => XmlElement[];
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

  it("mints a document-unique table:name from the context on every call", () => {
    const { context } = writeContext();
    const table: ContentTable = {
      kind: "table",
      rows: [],
      columnWidthsPt: [],
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
      columnWidthsPt: [0, 100],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const columns = elementsWithTag(written.children, "table:table-column");
    expect(columns).toHaveLength(2);
    expect(attr(columns[0], "table:style-name")).toBeUndefined();
    expect(attr(columns[1], "table:style-name")).toBeDefined();
  });

  it("writes a table:style-name on a row only when it carries a heightPt", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        { cells: [paragraphCell("a")] },
        { cells: [paragraphCell("b")], heightPt: 20 },
      ],
      columnWidthsPt: [],
    };
    const { context } = writeContext();
    const written = writeOdfTable(table, context);
    const rows = elementsWithTag(written.children, "table:table-row");
    expect(attr(rows[0], "table:style-name")).toBeUndefined();
    expect(attr(rows[1], "table:style-name")).toBeDefined();
  });

  it("writes a style:width on the table's own style only when the columns state a positive total width", () => {
    const withWidth: ContentTable = {
      kind: "table",
      rows: [],
      columnWidthsPt: [50, 50],
    };
    const withoutWidth: ContentTable = {
      kind: "table",
      rows: [],
      columnWidthsPt: [],
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

  it("marks a colSpan'd cell's own covered neighbour, writing it as table:covered-table-cell rather than repeating the anchor's content", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "anchor" }] }],
              colSpan: 2,
            },
            paragraphCell("skipped"),
          ],
        },
      ],
      columnWidthsPt: [],
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
        { cells: [paragraphCell("covered"), paragraphCell("plain")] },
      ],
      columnWidthsPt: [],
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

  it("writes table:number-columns-spanned/table:number-rows-spanned only when the cell actually states a span", () => {
    const table: ContentTable = {
      kind: "table",
      rows: [{ cells: [paragraphCell("plain")] }],
      columnWidthsPt: [],
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
      columnWidthsPt: [],
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
      columnWidthsPt: [],
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
      columnWidthsPt: [],
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
      columnWidthsPt: [],
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
                  columnWidthsPt: [],
                },
              ],
            },
          ],
        },
      ],
      columnWidthsPt: [],
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
      columnWidthsPt: [],
    };
    const { context } = writeContext();
    expect(() => writeOdfTable(table, context)).toThrow(/image/);
  });
});
