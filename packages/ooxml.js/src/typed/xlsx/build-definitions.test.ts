import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentSheet,
  DefinitionsTable,
} from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag, rootElement } from "../util";
import { buildXlsxPackageFromContent } from "./build";
import { assertNeverContentCellValueKind } from "./build-worksheet";
const DEDUPED_STRING_CELL_ROW = 5;

const KITCHEN_SINK_SHEET: ContentSheet = {
  name: "Data",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "string", value: "Name" },
      displayText: "Name",
    },
    {
      row: 0,
      column: 1,
      value: { kind: "string", value: "Amount" },
      displayText: "Amount",
    },
    {
      row: 1,
      column: 0,
      value: { kind: "string", value: "Acme Corp" },
      displayText: "Acme Corp",
    },
    {
      row: 1,
      column: 1,
      value: { kind: "number", value: 1234.56 },
      displayText: "1234.56",
    },
    {
      row: 2,
      column: 0,
      value: { kind: "boolean", value: true },
      displayText: "TRUE",
    },
    {
      row: 3,
      column: 0,
      value: { kind: "number", value: 3 },
      formula: "SUM(B2:B3)",
      displayText: "3",
    },
    {
      row: 4,
      column: 0,
      value: { kind: "error", value: "#DIV/0!" },
      formula: "1/0",
      displayText: "#DIV/0!",
    },
    // A repeated text value — exercises shared-string deduplication (both cells must intern to the SAME index).
    {
      row: 5,
      column: 0,
      value: { kind: "string", value: "Acme Corp" },
      displayText: "Acme Corp",
    },
    // The anchor of a 2x2 merge.
    {
      row: 6,
      column: 0,
      value: { kind: "string", value: "Merged Cell" },
      displayText: "Merged Cell",
      colSpan: 2,
      rowSpan: 2,
    },
    // A cell containing text that needs XML escaping.
    {
      row: 8,
      column: 0,
      value: { kind: "string", value: "Tom & Jerry <b>" },
      displayText: "Tom & Jerry <b>",
    },
  ],
  columns: [
    { index: 0, widthPt: 100 },
    { index: 1, widthPt: 60, hidden: true },
  ],
  rows: [
    { index: 0, heightPt: 20 },
    { index: 9, heightPt: 15, hidden: true },
  ],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
    printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 },
    scalePercent: 125,
    repeatRows: { start: 0, end: 0 },
    repeatColumns: { start: 0, end: 0 },
    gridlines: true,
    headers: true,
    pageOrder: "overThenDown",
    manualBreaks: { rows: [DEDUPED_STRING_CELL_ROW], columns: [1] },
  },
};

const SUMMARY_SHEET: ContentSheet = {
  name: "Summary",
  cells: [
    {
      row: 0,
      column: 0,
      value: { kind: "number", value: 42 },
      displayText: "42",
    },
  ],
  columns: [],
  rows: [],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_LETTER,
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    fitToPages: { width: 1, height: 3 },
    gridlines: false,
    headers: false,
    pageOrder: "downThenOver",
  },
};

const DOCUMENT: ContentDocument = {
  kind: "spreadsheet",
  metadata: {
    title: "Kitchen Sink",
    author: "Test Suite",
    keywords: ["a", "b"],
    createdIso: "2026-07-31T00:00:00Z",
  },
  sheets: [KITCHEN_SINK_SHEET, SUMMARY_SHEET],
};

const DEFAULT_PRINT_SETTINGS: ContentSheet["printSettings"] = {
  pageSize: PAGE_SIZE_LETTER,
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function singleSheetDocument(cells: ContentSheet["cells"]): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        cells,
        columns: [],
        rows: [],
        images: [],
        printSettings: DEFAULT_PRINT_SETTINGS,
      },
    ],
  };
}

function elementsOf(parent: XmlElement, tag: string): XmlElement[] {
  return parent.children.filter(
    (node): node is XmlElement => node.type === "element" && node.tag === tag,
  );
}

function childElement(parent: XmlElement, tag: string): XmlElement | undefined {
  return elementsOf(parent, tag)[0];
}

function requireChild(parent: XmlElement, tag: string): XmlElement {
  const child = childElement(parent, tag);
  if (child === undefined) {
    throw new Error(`expected a <${tag}> child of <${parent.tag}>`);
  }
  return child;
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function tableDefinitions(): DefinitionsTable {
  return {
    "table:SalesTable": {
      kind: "table",
      name: "SalesTable",
      ref: "A1:B3",
      sheet: "Sheet1",
      columns: ["Item", "Amount"],
    },
  };
}

function attributeOf(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

describe("buildWorksheetPart: element presence for cols, mergeCells, drawing, and tableParts, and buildWorksheetRelsPart's own root", () => {
  it("writes cols, mergeCells, drawing, and tableParts all together, and no more than one of each, for a sheet carrying every optional feature", () => {
    const pkg = buildXlsxPackageFromContent(
      {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Sheet1",
            cells: [
              {
                row: 0,
                column: 0,
                value: { kind: "string", value: "x" },
                displayText: "x",
                colSpan: 2,
              },
            ],
            columns: [{ index: 0, widthPt: 50 }],
            rows: [],
            images: [
              {
                kind: "image",
                format: "png",
                base64: TINY_PNG_BASE64,
                widthPt: 10,
                heightPt: 10,
                anchorRow: 1,
                anchorColumn: 0,
                offsetXPt: 0,
                offsetYPt: 0,
              },
            ],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
        ],
      },
      { definitions: tableDefinitions() },
    );
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(worksheet.tag).toBe("worksheet");
    expect(attr(worksheet, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    );
    expect(attr(worksheet, "xmlns:r")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    expect(childrenWithTag(worksheet, "cols")).toHaveLength(1);
    expect(childrenWithTag(worksheet, "mergeCells")).toHaveLength(1);
    const drawing = requireChild(worksheet, "drawing");
    expect(attr(drawing, "r:id")).toBeDefined();
    const tableParts = requireChild(worksheet, "tableParts");
    expect(attr(tableParts, "count")).toBe("1");
    expect(attr(requireChild(tableParts, "tablePart"), "r:id")).toBeDefined();

    const rels = rootElement(pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a root element",
      );
    }
    expect(rels.tag).toBe("Relationships");
    expect(attr(rels, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
  });

  it("writes no cols, mergeCells, drawing, or tableParts at all for a plain sheet with none of those features", () => {
    const worksheet = rootElement(
      buildXlsxPackageFromContent(singleSheetDocument([])).parts[
        "xl/worksheets/sheet1.xml"
      ],
    );
    if (worksheet === undefined) {
      throw new Error("expected a worksheet root element");
    }
    expect(childrenWithTag(worksheet, "cols")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "mergeCells")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "drawing")).toHaveLength(0);
    expect(childrenWithTag(worksheet, "tableParts")).toHaveLength(0);
  });
});

// --- entry point: per-sheet table filtering, sequential relationship ids, and multi-format image usage ------------

describe("buildXlsxPackageFromContent: a table definitions entry attaches only to its own named sheet, never to any other", () => {
  it("writes tableParts and xl/tables/table1.xml for the sheet the table names, and neither for a second, unrelated sheet", () => {
    const pkg = buildXlsxPackageFromContent(
      {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Sheet1",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
          {
            name: "Other",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
        ],
      },
      { definitions: tableDefinitions() },
    );
    const sheet1 = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    const sheet2 = rootElement(pkg.parts["xl/worksheets/sheet2.xml"]);
    if (sheet1 === undefined || sheet2 === undefined) {
      throw new Error("expected both worksheet root elements");
    }
    expect(childrenWithTag(sheet1, "tableParts")).toHaveLength(1);
    expect(childrenWithTag(sheet2, "tableParts")).toHaveLength(0);
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/worksheets/_rels/sheet2.xml.rels",
    );
  });
});

describe("buildXlsxPackageFromContent: worksheet relationships are numbered sequentially across comments, drawing, and tables on the same sheet", () => {
  it("assigns rId1/rId2/rId3 in the order comments, drawing, and table relationships are added, with no gap or repeat", () => {
    const pkg = buildXlsxPackageFromContent(
      {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Sheet1",
            cells: [
              {
                row: 0,
                column: 0,
                value: { kind: "string", value: "x" },
                displayText: "x",
                comment: { text: "note" },
              },
            ],
            columns: [],
            rows: [],
            images: [
              {
                kind: "image",
                format: "png",
                base64: TINY_PNG_BASE64,
                widthPt: 10,
                heightPt: 10,
                anchorRow: 0,
                anchorColumn: 0,
                offsetXPt: 0,
                offsetYPt: 0,
              },
            ],
            printSettings: DEFAULT_PRINT_SETTINGS,
          },
        ],
      },
      { definitions: tableDefinitions() },
    );
    const rels = rootElement(pkg.parts["xl/worksheets/_rels/sheet1.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected the worksheet rels part to have a root element",
      );
    }
    const relationships = childrenWithTag(rels, "Relationship");
    expect(relationships.map((el) => attr(el, "Id"))).toEqual([
      "rId1",
      "rId2",
      "rId3",
    ]);
    const types = relationships.map((el) => attr(el, "Type"));
    expect(types[0]).toContain("threadedComment");
    expect(types[1]).toContain("/drawing");
    expect(types[2]).toContain("/table");
  });
});

describe("buildXlsxPackageFromContent: usedImageFormats collects every distinct image format actually used, and only those", () => {
  it("declares a Default entry for both png and jpeg when a sheet carries one image of each, and none for gif", () => {
    const pkg = buildXlsxPackageFromContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
              anchorRow: 0,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
            {
              kind: "image",
              format: "jpeg",
              base64: TINY_PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
              anchorRow: 1,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
          ],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    });
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const extensions = childrenWithTag(contentTypes, "Default").map((el) =>
      attr(el, "Extension"),
    );
    expect(extensions).toContain("png");
    expect(extensions).toContain("jpeg");
    expect(extensions).not.toContain("gif");
    expect(Object.keys(pkg.parts)).toContain("xl/media/image1.png");
    expect(Object.keys(pkg.parts)).toContain("xl/media/image2.jpeg");
  });
});

describe("buildXlsxPackageFromContent: [Content_Types].xml carries no chart/table overrides at all for a document with neither", () => {
  it("writes no /xl/charts/ or /xl/tables/ Override, and no chart/table Default extensions, for a plain document", () => {
    const pkg = buildXlsxPackageFromContent(DOCUMENT);
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(
      overrides.some((name) => name?.startsWith("/xl/charts/") === true),
    ).toBe(false);
    expect(
      overrides.some((name) => name?.startsWith("/xl/tables/") === true),
    ).toBe(false);
  });
});

describe("buildXlsxPackageFromContent: xl/workbook.xml sheet elements carry the correct sheetId and r:id per index", () => {
  it("numbers sheetId from 1 and r:id via worksheetRelId, matching the sheet's own position, for a 2-sheet workbook", () => {
    const pkg = buildXlsxPackageFromContent(DOCUMENT);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    expect(attr(workbook, "xmlns:r")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    const sheetsEl = requireChild(workbook, "sheets");
    const sheetElements = elementsOf(sheetsEl, "sheet").map((el) => ({
      name: attributeOf(el, "name"),
      sheetId: attributeOf(el, "sheetId"),
      rId: attributeOf(el, "r:id"),
    }));
    expect(sheetElements).toEqual([
      { name: "Data", sheetId: "1", rId: "rId1" },
      { name: "Summary", sheetId: "2", rId: "rId2" },
    ]);
  });
});

describe("assertNeverContentCellValueKind", () => {
  it("throws naming the unhandled kind, proving renderCellValue's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverContentCellValueKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'renderCellValue: unhandled ContentCellValue kind {"kind":"bogus"}',
    );
  });
});
