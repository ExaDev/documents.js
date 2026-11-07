import { describe, expect, it } from "vitest";
import type { ContentSheet } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { readXlsxWorkbook } from "../xlsx";
import { readXlsxContent } from "./content";

// Worksheets whose <row> and <c> elements omit their r reference, as ECMA-376's schema allows and real producers emit: each such element takes the position after the previous one in document order. Every package here is hand-built through el/txt, holding exactly the markup a reference-free producer writes.

const RELATIONSHIP_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function workbookPackage(
  sheetDataChildren: readonly XmlNode[],
  sharedStrings?: readonly string[],
  worksheetChildren: readonly XmlNode[] = [],
): Package {
  const relationships = [
    el("Relationship", {
      Id: "rId1",
      Type: `${RELATIONSHIP_BASE}/worksheet`,
      Target: "worksheets/sheet1.xml",
    }),
  ];
  const parts: Package["parts"] = {
    "xl/workbook.xml": {
      kind: "xml",
      nodes: [
        el("workbook", {}, [
          el("sheets", {}, [el("sheet", { name: "Sheet1", "r:id": "rId1" })]),
        ]),
      ],
    },
    "xl/worksheets/sheet1.xml": {
      kind: "xml",
      nodes: [
        el("worksheet", {}, [
          ...worksheetChildren,
          el("sheetData", {}, sheetDataChildren),
        ]),
      ],
    },
  };
  if (sharedStrings !== undefined) {
    relationships.push(
      el("Relationship", {
        Id: "rId2",
        Type: `${RELATIONSHIP_BASE}/sharedStrings`,
        Target: "sharedStrings.xml",
      }),
    );
    parts["xl/sharedStrings.xml"] = {
      kind: "xml",
      nodes: [
        el(
          "sst",
          {},
          sharedStrings.map((text) => el("si", {}, [el("t", {}, [txt(text)])])),
        ),
      ],
    };
  }
  parts["xl/_rels/workbook.xml.rels"] = {
    kind: "xml",
    nodes: [el("Relationships", {}, relationships)],
  };
  return { parts };
}

function numberCell(value: string, reference?: string): XmlElement {
  return el("c", reference === undefined ? {} : { r: reference }, [
    el("v", {}, [txt(value)]),
  ]);
}

function inlineStringCell(text: string): XmlElement {
  return el("c", { t: "inlineStr" }, [
    el("is", {}, [el("t", {}, [txt(text)])]),
  ]);
}

function sharedStringCell(index: number): XmlElement {
  return el("c", { t: "s" }, [el("v", {}, [txt(String(index))])]);
}

function contentSheet(pkg: Package): ContentSheet {
  const document = readXlsxContent(pkg);
  if (document.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  const sheet = document.sheets[0];
  if (sheet === undefined) {
    throw new Error("expected one sheet");
  }
  return sheet;
}

function positionsAndText(
  pkg: Package,
): { row: number; column: number; text: string }[] {
  return contentSheet(pkg).cells.map((cell) => ({
    row: cell.row,
    column: cell.column,
    text: cell.displayText,
  }));
}

describe("readXlsxContent: rows and cells without an r reference", () => {
  it("places cells without r in successive columns from A within their row", () => {
    const pkg = workbookPackage([
      el("row", { r: "1" }, [
        numberCell("1"),
        numberCell("2"),
        numberCell("3"),
      ]),
    ]);
    expect(positionsAndText(pkg)).toEqual([
      { row: 0, column: 0, text: "1" },
      { row: 0, column: 1, text: "2" },
      { row: 0, column: 2, text: "3" },
    ]);
  });

  it("places rows without r on successive rows from the first, restarting the column in each", () => {
    const pkg = workbookPackage([
      el("row", {}, [numberCell("1"), numberCell("2")]),
      el("row", {}, [numberCell("3")]),
      el("row", {}, [numberCell("4"), numberCell("5")]),
    ]);
    expect(positionsAndText(pkg)).toEqual([
      { row: 0, column: 0, text: "1" },
      { row: 0, column: 1, text: "2" },
      { row: 1, column: 0, text: "3" },
      { row: 2, column: 0, text: "4" },
      { row: 2, column: 1, text: "5" },
    ]);
    expect(contentSheet(pkg).rows.map((row) => row.index)).toEqual([0, 1, 2]);
  });

  it("continues from the last explicit reference when present and absent r are mixed", () => {
    const pkg = workbookPackage([
      el("row", { r: "3" }, [
        numberCell("1"),
        numberCell("2", "D3"),
        numberCell("3"),
      ]),
      el("row", {}, [numberCell("4", "B4"), numberCell("5")]),
      el("row", { r: "7" }, [numberCell("6")]),
      el("row", {}, [numberCell("7")]),
    ]);
    expect(positionsAndText(pkg)).toEqual([
      { row: 2, column: 0, text: "1" },
      { row: 2, column: 3, text: "2" },
      { row: 2, column: 4, text: "3" },
      { row: 3, column: 1, text: "4" },
      { row: 3, column: 2, text: "5" },
      { row: 6, column: 0, text: "6" },
      { row: 7, column: 0, text: "7" },
    ]);
    expect(contentSheet(pkg).rows.map((row) => row.index)).toEqual([
      2, 3, 6, 7,
    ]);
  });

  it("counts a valueless cell without r as occupying its column", () => {
    const pkg = workbookPackage([
      el("row", {}, [numberCell("1"), el("c", { s: "0" }), numberCell("3")]),
    ]);
    expect(positionsAndText(pkg)).toEqual([
      { row: 0, column: 0, text: "1" },
      { row: 0, column: 2, text: "3" },
    ]);
  });

  it("reads inline-string cells without r", () => {
    const pkg = workbookPackage([
      el("row", {}, [inlineStringCell("alpha"), inlineStringCell("beta")]),
    ]);
    expect(positionsAndText(pkg)).toEqual([
      { row: 0, column: 0, text: "alpha" },
      { row: 0, column: 1, text: "beta" },
    ]);
  });

  it("reads shared-string cells without r", () => {
    const pkg = workbookPackage(
      [el("row", {}, [sharedStringCell(1), sharedStringCell(0)])],
      ["first", "second"],
    );
    expect(positionsAndText(pkg)).toEqual([
      { row: 0, column: 0, text: "second" },
      { row: 0, column: 1, text: "first" },
    ]);
  });

  it("drops a cell without r inside a row whose own r does not parse, keeping a cell there with its own reference", () => {
    const pkg = workbookPackage([
      el("row", { r: "x" }, [numberCell("1"), numberCell("2", "C5")]),
      el("row", {}, [numberCell("3")]),
    ]);
    expect(positionsAndText(pkg)).toEqual([
      { row: 4, column: 2, text: "2" },
      { row: 0, column: 0, text: "3" },
    ]);
  });

  it("resolves the height of a row without r for a drawing anchored on it", () => {
    const anchor = el("xdr:twoCellAnchor", {}, [
      el("xdr:from", {}, [
        el("xdr:col", {}, [txt("0")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("1")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:to", {}, [
        el("xdr:col", {}, [txt("1")]),
        el("xdr:colOff", {}, [txt("0")]),
        el("xdr:row", {}, [txt("2")]),
        el("xdr:rowOff", {}, [txt("0")]),
      ]),
      el("xdr:pic", {}, [
        el("xdr:nvPicPr", {}, [el("xdr:cNvPr", { id: "2", name: "Picture" })]),
        el("xdr:blipFill", {}, [el("a:blip", { "r:embed": "rIdImage" })]),
      ]),
      el("xdr:clientData"),
    ]);
    const pkg = workbookPackage(
      [el("row", { ht: "20" }), el("row", { ht: "40" })],
      undefined,
      [el("sheetFormatPr", { defaultRowHeight: "15" })],
    );
    const worksheet = pkg.parts["xl/worksheets/sheet1.xml"];
    if (worksheet?.kind !== "xml" || worksheet.nodes[0]?.type !== "element") {
      throw new Error("expected the worksheet part");
    }
    worksheet.nodes[0].children.push(el("drawing", { "r:id": "rIdDrawing" }));
    const relationship = (id: string, type: string, target: string) =>
      el("Relationship", {
        Id: id,
        Type: `${RELATIONSHIP_BASE}/${type}`,
        Target: target,
      });
    pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          relationship("rIdDrawing", "drawing", "../drawings/drawing1.xml"),
        ]),
      ],
    };
    pkg.parts["xl/drawings/drawing1.xml"] = {
      kind: "xml",
      nodes: [el("xdr:wsDr", {}, [anchor])],
    };
    pkg.parts["xl/drawings/_rels/drawing1.xml.rels"] = {
      kind: "xml",
      nodes: [
        el("Relationships", {}, [
          relationship("rIdImage", "image", "../media/image1.png"),
        ]),
      ],
    };
    pkg.parts["xl/media/image1.png"] = {
      kind: "binary",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
    // The anchor spans the second row only, so its height is that row's ht (40), not the first row's (20) nor the sheet default (15).
    const SECOND_ROW_HEIGHT_PT = 40;
    expect(contentSheet(pkg).images[0]?.heightPt).toBeCloseTo(
      SECOND_ROW_HEIGHT_PT,
    );
  });
});

describe("readXlsxWorkbook: cells without an r reference", () => {
  it("projects cells without r under the reference their position implies", () => {
    const pkg = workbookPackage(
      [
        el("row", {}, [numberCell("1"), sharedStringCell(0)]),
        el("row", { r: "5" }, [numberCell("2", "C5"), numberCell("3")]),
      ],
      ["text"],
    );
    expect(readXlsxWorkbook(pkg).sheets[0]?.cells).toEqual([
      { reference: "A1", value: "1" },
      { reference: "B1", value: "text" },
      { reference: "C5", value: "2" },
      { reference: "D5", value: "3" },
    ]);
  });
});
