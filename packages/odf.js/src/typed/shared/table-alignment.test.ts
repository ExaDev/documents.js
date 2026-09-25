import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import type { ContentTable } from "document-schema.js";
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
        columns: [{ widthPt: 10 }],
        rows: [{ cells: [{ blocks: [], verticalAlign: pivot }] }],
      });
      expect(styleAttribute(written, automaticStyles, 0)).toBe(odf);
      expect(reread.rows[0]?.cells[0]?.verticalAlign).toBe(pivot);
    },
  );

  it("writes no style for a cell that states no verticalAlign", () => {
    const { written, automaticStyles } = roundTrip({
      kind: "table",
      columns: [{ widthPt: 10 }],
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
      columns: [{ widthPt: 10 }],
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
      columns: [{ widthPt: 10 }, { widthPt: 10 }],
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
