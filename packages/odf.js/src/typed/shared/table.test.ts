import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import type { ContentTable, ContentTableCell } from "document-schema.js";
import { walkTableGrid } from "document-schema.js";
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

  describe("a table breaking the grid rule", () => {
    // A merged header whose covered position carries a second copy of the anchor's content, which a table:covered-table-cell has no room for.
    const coveredContentTable: ContentTable = {
      kind: "table",
      columnWidthsPt: [100, 100],
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
        { kind: "table", rows: [], columnWidthsPt: [] },
        context,
      );
      expect(attrValue(clean, "table:name")).toBe("Table1");
    });

    it("is refused when it is the whole content of another table's cell", () => {
      const { context } = writeContext();
      const outer: ContentTable = {
        kind: "table",
        columnWidthsPt: [100],
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
        { cells: [{ blocks: [] }, paragraphCell("plain")] },
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
      columnWidthsPt: [10, 10],
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

  function threeColumns(): XmlElement {
    return el("table:table-column", { "table:number-columns-repeated": "3" });
  }

  function expectEveryRowAsWideAsTheColumns(table: ContentTable): void {
    expect(table.columnWidthsPt).toHaveLength(3);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(table.columnWidthsPt.length);
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
      columnWidthsPt: [10, 10],
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
        columnWidthsPt: [10, 10],
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
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column", { "table:number-columns-repeated": "3" }),
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
    expect(table.columnWidthsPt).toHaveLength(3);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(3);
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
    const pkg: Package = {
      parts: { "content.xml": contentPackage([rowStyle("ro1", 18)]) },
    };
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-row", { "table:style-name": "ro1" }, [cell("H")]),
        ]),
      ]),
      pkg,
    );
    expect(table.rows[0]?.heightPt).toBe(18);
  });
});

describe("readOdfTable: column wrappers (table:table-header-columns, table:table-columns, table:table-column-group)", () => {
  function widthPkg(): Package {
    return {
      parts: {
        "content.xml": contentPackage([
          columnStyle("co1", 10),
          columnStyle("co2", 20),
          columnStyle("co3", 30),
          columnStyle("co4", 40),
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
    expect(table.columnWidthsPt).toEqual([10, 20]);
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
    expect(table.columnWidthsPt).toEqual([10, 10]);
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
    expect(table.columnWidthsPt).toEqual([10, 20]);
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
    expect(table.columnWidthsPt).toEqual([10, 20, 30, 40]);
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
    expect(table.columnWidthsPt).toEqual([20]);
  });

  it("states a grid as wide as the columns the file declares across wrappers, with every row as wide", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-columns", {}, [el("table:table-column")]),
        el("table:table-column-group", {}, [
          el("table:table-column", { "table:number-columns-repeated": "2" }),
        ]),
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [cell("a"), cell("b"), cell("c")]),
        ]),
      ]),
      { parts: {} },
    );
    expect(table.columnWidthsPt).toHaveLength(3);
    expect(table.rows[0]?.cells).toHaveLength(3);
  });
});

describe("readOdfTable: a cell's vertical alignment", () => {
  function verticalAlignPkg(): Package {
    return {
      parts: {
        "content.xml": contentPackage([
          cellBorderStyle("ce-top", { "style:vertical-align": "top" }),
          cellBorderStyle("ce-middle", { "style:vertical-align": "middle" }),
          cellBorderStyle("ce-bottom", { "style:vertical-align": "bottom" }),
          cellBorderStyle("ce-auto", { "style:vertical-align": "automatic" }),
          cellBorderStyle("ce-fill", { "fo:background-color": "#ff0000" }),
        ]),
      },
    };
  }

  function verticalAlignOf(styleName: string | undefined) {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-row", {}, [
          cell(
            "x",
            styleName === undefined ? {} : { "table:style-name": styleName },
          ),
        ]),
      ]),
      verticalAlignPkg(),
    );
    return table.rows[0]?.cells[0]?.verticalAlign;
  }

  it('reads style:vertical-align "top" as "top"', () => {
    expect(verticalAlignOf("ce-top")).toBe("top");
  });

  it('reads style:vertical-align "middle" as the pivot\'s own "center"', () => {
    expect(verticalAlignOf("ce-middle")).toBe("center");
  });

  it('reads style:vertical-align "bottom" as "bottom"', () => {
    expect(verticalAlignOf("ce-bottom")).toBe("bottom");
  });

  it('leaves verticalAlign undefined for "automatic", which the pivot has no member for', () => {
    expect(verticalAlignOf("ce-auto")).toBeUndefined();
  });

  it("leaves verticalAlign undefined for a cell whose style states none, and for a cell with no style", () => {
    expect(verticalAlignOf("ce-fill")).toBeUndefined();
    expect(verticalAlignOf(undefined)).toBeUndefined();
  });

  it("reads it together with the fill and borders the same style states", () => {
    const pkg: Package = {
      parts: {
        "content.xml": contentPackage([
          cellBorderStyle("ce-all", {
            "style:vertical-align": "middle",
            "fo:background-color": "#00ff00",
            "fo:border": "1pt solid #000000",
          }),
        ]),
      },
    };
    const decorated = readOdfTable(
      el("table:table", {}, [
        el("table:table-row", {}, [
          cell("x", { "table:style-name": "ce-all" }),
        ]),
      ]),
      pkg,
    ).rows[0]?.cells[0];
    expect(decorated?.verticalAlign).toBe("center");
    expect(decorated?.background).toBeDefined();
    expect(decorated?.borders?.left).toBeDefined();
  });

  it("reads it onto a table:covered-table-cell as well, since a covered position carries its own decoration", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-column", { "table:number-columns-repeated": "2" }),
        el("table:table-row", {}, [
          cell("A", { "table:number-columns-spanned": "2" }),
          el("table:covered-table-cell", { "table:style-name": "ce-bottom" }),
        ]),
      ]),
      verticalAlignPkg(),
    );
    expect(table.rows[0]?.cells[1]?.verticalAlign).toBe("bottom");
    expect(table.rows[0]?.cells[0]?.verticalAlign).toBeUndefined();
  });

  it("reads it for a cell inside a header-rows wrapper", () => {
    const table = readOdfTable(
      el("table:table", {}, [
        el("table:table-header-rows", {}, [
          el("table:table-row", {}, [
            cell("H", { "table:style-name": "ce-middle" }),
          ]),
        ]),
      ]),
      verticalAlignPkg(),
    );
    expect(table.rows[0]?.cells[0]?.verticalAlign).toBe("center");
  });
});

describe("writeOdfTable: a cell's vertical alignment", () => {
  function roundTrip(table: ContentTable): {
    written: XmlElement;
    reread: ContentTable;
    automaticStyles: XmlElement;
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
    const context: OdfTableWriteContext = {
      registry: StyleRegistry.forPart(pkg, "content.xml"),
      mintTableName: () => "Table1",
      mintListStyleName: (kind) => `L${kind}`,
    };
    const written = writeOdfTable(table, context);
    return { written, reread: readOdfTable(written, pkg), automaticStyles };
  }

  function writtenCell(
    written: XmlElement,
    columnIndex: number,
  ): XmlElement | undefined {
    const row = written.children.find(
      (n): n is XmlElement =>
        n.type === "element" && n.tag === "table:table-row",
    );
    return row?.children.filter((n): n is XmlElement => n.type === "element")[
      columnIndex
    ];
  }

  // The style:vertical-align the cell's own table:style-name resolves to in the minted automatic styles, or undefined when the cell names no style or its style states none.
  function styleAttribute(
    written: XmlElement,
    automaticStyles: XmlElement,
    columnIndex: number,
  ): string | undefined {
    const cellElement = writtenCell(written, columnIndex);
    const styleName =
      cellElement === undefined
        ? undefined
        : attrValue(cellElement, "table:style-name");
    const style = automaticStyles.children.find(
      (n): n is XmlElement =>
        n.type === "element" &&
        n.tag === "style:style" &&
        attrValue(n, "style:name") === styleName,
    );
    const properties = style?.children.find(
      (n): n is XmlElement =>
        n.type === "element" && n.tag === "style:table-cell-properties",
    );
    return properties === undefined
      ? undefined
      : attrValue(properties, "style:vertical-align");
  }

  it.each([
    ["top", "top"],
    ["center", "middle"],
    ["bottom", "bottom"],
  ] as const)(
    "writes verticalAlign %s as style:vertical-align %s and reads it back",
    (pivot, odf) => {
      const { written, reread, automaticStyles } = roundTrip({
        kind: "table",
        columnWidthsPt: [10],
        rows: [{ cells: [{ blocks: [], verticalAlign: pivot }] }],
      });
      expect(styleAttribute(written, automaticStyles, 0)).toBe(odf);
      expect(reread.rows[0]?.cells[0]?.verticalAlign).toBe(pivot);
    },
  );

  it("writes no style for a cell that states no verticalAlign", () => {
    const { written, automaticStyles } = roundTrip({
      kind: "table",
      columnWidthsPt: [10],
      rows: [{ cells: [{ blocks: [] }] }],
    });
    const cellElement = writtenCell(written, 0);
    expect(cellElement).toBeDefined();
    expect(
      cellElement === undefined
        ? "missing"
        : attrValue(cellElement, "table:style-name"),
    ).toBeUndefined();
    expect(styleAttribute(written, automaticStyles, 0)).toBeUndefined();
  });

  it("states it beside the fill on one shared cell style and reads both back", () => {
    const fill = { kind: "solid", color: { r: 1, g: 0, b: 0 } } as const;
    const { reread } = roundTrip({
      kind: "table",
      columnWidthsPt: [10],
      rows: [
        { cells: [{ blocks: [], background: fill, verticalAlign: "center" }] },
      ],
    });
    expect(reread.rows[0]?.cells[0]?.verticalAlign).toBe("center");
    expect(reread.rows[0]?.cells[0]?.background).toEqual(fill);
  });

  it("writes it onto a covered entry and reads it back", () => {
    const { written, reread, automaticStyles } = roundTrip({
      kind: "table",
      columnWidthsPt: [10, 10],
      rows: [
        {
          cells: [
            { blocks: [], colSpan: 2 },
            { blocks: [], verticalAlign: "bottom" },
          ],
        },
      ],
    });
    expect(styleAttribute(written, automaticStyles, 1)).toBe("bottom");
    expect(reread.rows[0]?.cells[1]?.verticalAlign).toBe("bottom");
  });
});
