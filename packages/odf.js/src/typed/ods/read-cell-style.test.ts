import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { readOdsContent } from "./read";
import { el, txt } from "../../xml/fragment";

describe('readOdsContent: cell background/borders/alignment/verticalAlignment (synthetic packages — the real cascade, including a genuine style:parent-style-name chain matching kitchen-sink.ods\'s own real ce1..ce5 -> "Default" -> table-cell family default-style shape)', () => {
  interface TableCellStyleOptions {
    cellProperties?: Record<string, string>;
    paragraphProperties?: Record<string, string>;
    parentStyleName?: string;
  }

  function tableCellStyle(
    name: string,
    options: TableCellStyleOptions = {},
  ): XmlElement {
    const children: XmlElement[] = [];
    if (options.cellProperties !== undefined) {
      children.push(el("style:table-cell-properties", options.cellProperties));
    }
    if (options.paragraphProperties !== undefined) {
      children.push(
        el("style:paragraph-properties", options.paragraphProperties),
      );
    }
    const attrs: Record<string, string> = {
      "style:name": name,
      "style:family": "table-cell",
    };
    if (options.parentStyleName !== undefined) {
      attrs["style:parent-style-name"] = options.parentStyleName;
    }
    return el("style:style", attrs, children);
  }

  function tableCellDefaultStyle(
    options: TableCellStyleOptions = {},
  ): XmlElement {
    const children: XmlElement[] = [];
    if (options.cellProperties !== undefined) {
      children.push(el("style:table-cell-properties", options.cellProperties));
    }
    if (options.paragraphProperties !== undefined) {
      children.push(
        el("style:paragraph-properties", options.paragraphProperties),
      );
    }
    return el(
      "style:default-style",
      { "style:family": "table-cell" },
      children,
    );
  }

  function stringCell(
    text: string,
    extraAttrs: Readonly<Record<string, string>> = {},
  ): XmlElement {
    return el(
      "table:table-cell",
      { "office:value-type": "string", ...extraAttrs },
      [el("text:p", {}, [txt(text)])],
    );
  }

  function sheetPackage(
    automaticStyleChildren: readonly XmlElement[],
    table: XmlElement,
  ): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:automatic-styles", {}, automaticStyleChildren),
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
  }

  it("defaults an unstyled column/row to a positive width/height (not 0, which would violate ContentSheet{Column,Row}Schema's .positive() constraint)", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-column", {}, []),
      el("table:table-row", {}, [stringCell("a")]),
    ]);
    const defaultColumnWidthPt = 64;
    const defaultRowHeightPt = 15;
    const { sheets } = readOdsContent(sheetPackage([], table));
    expect(sheets[0]?.columns[0]?.widthPt).toBe(defaultColumnWidthPt);
    expect(sheets[0]?.rows[0]?.heightPt).toBe(defaultRowHeightPt);
  });

  it("resolves fo:background-color from the cell's own table:style-name -> table-cell family style", () => {
    const ce1 = tableCellStyle("ce1", {
      cellProperties: { "fo:background-color": "#ff0000" },
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("red", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("expands the fo:border shorthand onto all four edges", () => {
    const ce1 = tableCellStyle("ce1", {
      cellProperties: { "fo:border": "0.5pt solid #0000ff" },
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("bordered", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    const expectedEdge = {
      color: { r: 0, g: 0, b: 1 },
      widthPt: 0.5,
      style: "solid",
    };
    expect(sheets[0]?.cells[0]?.borders).toEqual({
      left: expectedEdge,
      right: expectedEdge,
      top: expectedEdge,
      bottom: expectedEdge,
    });
  });

  it("lets a per-edge fo:border-top override just that one edge", () => {
    const ce1 = tableCellStyle("ce1", {
      cellProperties: {
        "fo:border": "1pt solid #000000",
        "fo:border-top": "2pt dotted #ffff00",
      },
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("bordered", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    const borders = sheets[0]?.cells[0]?.borders;
    expect(borders?.top).toEqual({
      color: { r: 1, g: 1, b: 0 },
      widthPt: 2,
      style: "dotted",
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
  });

  it('treats an explicit "none" border-style override as genuinely clearing an inherited edge, not merely leaving it unmentioned', () => {
    const parent = tableCellStyle("Parent", {
      cellProperties: { "fo:border": "1pt solid #000000" },
    });
    const child = tableCellStyle("ce1", {
      cellProperties: { "fo:border-bottom": "1pt none #000000" },
      parentStyleName: "Parent",
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("partial", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([parent, child], table));
    const borders = sheets[0]?.cells[0]?.borders;
    expect(borders?.bottom).toBeUndefined();
    expect(borders?.top).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
  });

  it("reads style:vertical-align from the cell's own table-cell-properties", () => {
    const ce1 = tableCellStyle("ce1", {
      cellProperties: { "style:vertical-align": "middle" },
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("centred", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBe("middle");
  });

  it('leaves verticalAlignment undefined for style:vertical-align="automatic" (no matching enum member), rather than guessing', () => {
    const ce1 = tableCellStyle("ce1", {
      cellProperties: { "style:vertical-align": "automatic" },
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("auto", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBeUndefined();
  });

  it("reads fo:text-align from the cell style's own style:paragraph-properties as an alignment override", () => {
    const ce1 = tableCellStyle("ce1", {
      paragraphProperties: { "fo:text-align": "center" },
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("centred", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.alignment).toBe("center");
  });

  it("leaves alignment undefined for a cell whose style sets no fo:text-align at all — the value-kind default stays in effect elsewhere, this reader never fabricates one", () => {
    const ce1 = tableCellStyle("ce1", {
      cellProperties: { "fo:background-color": "#ff0000" },
    });
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("red", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.alignment).toBeUndefined();
  });

  it("resolves background through the FULL resolveStyleElementChain cascade — a family default-style contributes a background the cell's own specific style never overrides", () => {
    const defaultStyle = tableCellDefaultStyle({
      cellProperties: { "fo:background-color": "#00ff00" },
    });
    const ce1 = tableCellStyle("ce1", {
      cellProperties: { "style:vertical-align": "top" },
    }); // no background of its own
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("inherited", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([defaultStyle, ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBe("top");
  });

  it("lets a style:parent-style-name chain contribute a background that the cell's own specific style then overrides — later (more specific) always wins, matching kitchen-sink.ods's own real ce1..ce5 -> \"Default\" chain shape", () => {
    const parent = tableCellStyle("Parent", {
      cellProperties: { "fo:background-color": "#ff0000" },
    });
    const ce1 = el(
      "style:style",
      {
        "style:name": "ce1",
        "style:family": "table-cell",
        "style:parent-style-name": "Parent",
      },
      [el("style:table-cell-properties", { "fo:background-color": "#0000ff" })],
    );
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [
        stringCell("overridden", { "table:style-name": "ce1" }),
      ]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([parent, ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 0, b: 1 },
    });
  });

  it("leaves background/borders/alignment/verticalAlignment all undefined for a cell with no table:style-name at all", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [stringCell("plain")]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([], table));
    const cell = sheets[0]?.cells[0];
    expect(cell?.background).toBeUndefined();
    expect(cell?.borders).toBeUndefined();
    expect(cell?.alignment).toBeUndefined();
    expect(cell?.verticalAlignment).toBeUndefined();
  });
});
