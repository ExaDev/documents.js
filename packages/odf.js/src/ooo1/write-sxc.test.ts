import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
} from "document-schema.js";
import { PAGE_SIZE_A4, assembleTree, flattenTree } from "document-schema.js";
import type { Package } from "../model/package";
import { decodePackage, encodePackage } from "../codec";
import {
  rootElement,
  attrValue,
  childrenWithTag,
  findChildElement,
} from "../xml/query";
import { readMimetype } from "../mimetype";
import { readManifest } from "../manifest";
import { normaliseOdsContent } from "../typed/ods/write";
import { readSxc, readSxcContent } from "./read";
import { isOoo1Package } from "./ns";
import { writeSxc, writeSxcContent } from "./write";

// The write side's correctness suite for .sxw, mirroring typed/odt/write-round-trip.test.ts's own law: a document written by writeSxwContent and read back through the EXISTING readSxwContent reader (readOdtContent run over transformOoo1Package's own forward transform — unmodified by anything in this PR) reproduces the document it was given, up to the exact same canonical form normaliseOdtContent already states for the plain .odt writer. That reuse is deliberate, not a shortcut: writeSxwContent is writeOdtContent's own output run through transformToOoo1Package and back through transformOoo1Package on the way in, so the two writers share one correctness law by construction, and a normalisation gap in one is a normalisation gap in both.
//
// A second, independent kind of assertion sits alongside the round trip: that the PACKAGE writeSxwContent produces actually LOOKS like OpenOffice.org 1.x XML — declares its own namespace URIs, carries no "mimetype" part, splits nothing into ODF's typed style:*-properties family, wraps nothing in a draw:frame — rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed. A writer that merely round-trips without genuinely changing shape would pass the round-trip law by accident (see this module's own top-of-file note on why transformToOoo1Package must produce authentically OpenOffice.org 1.x-shaped output, not just something transformOoo1Package happens not to choke on).

// The same two-part discipline as the .sxw suite above: THE LAW below is the round-trip correctness proof (normaliseOdsContent(readSxcContent(writeSxcContent(document))) equals normaliseOdsContent(document), mirroring typed/ods/write-round-trip.test.ts's own law exactly, run through one more transform each way), and the "genuine OpenOffice.org 1.x XML" describe block that follows it makes the same second, independent kind of assertion the .sxw suite makes above: that the package writeSxcContent produces actually LOOKS like OpenOffice.org 1.x XML — declares its own namespace URIs, carries no "mimetype" part, keeps a cell's value on table:value-type/table:value rather than ODF's office:value-type/office:value, splits nothing into ODF's typed style:table-cell-properties, wraps nothing in a draw:frame — rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed.

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SHEET_MARGINS = { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 };

const DEFAULT_SHEET_PRINT_SETTINGS = {
  pageSize: PAGE_SIZE_A4,
  margins: SHEET_MARGINS,
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver" as const,
};

type SpreadsheetDocument = Extract<ContentDocument, { kind: "spreadsheet" }>;

function sheetOf(
  name: string,
  cells: readonly ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name,
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: DEFAULT_SHEET_PRINT_SETTINGS,
    ...overrides,
  };
}

function sheetDocumentOf(sheets: readonly ContentSheet[]): SpreadsheetDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

function sheetRoundTrip(document: ContentDocument): SpreadsheetDocument {
  const pkg = decodePackage(encodePackage(writeSxcContent(document)));
  const { metadata, sheets } = readSxcContent(pkg);
  return { kind: "spreadsheet", metadata, sheets };
}

function expectSheetRoundTrip(document: ContentDocument): void {
  expect(normaliseOdsContent(sheetRoundTrip(document))).toEqual(
    normaliseOdsContent(document),
  );
}

describe("the sxc round-trip law", () => {
  it("round-trips every cell value kind readOdsContent can produce", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "number", value: 42.5 },
        displayText: "42.5",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "percentage", value: 0.5 },
        displayText: "50%",
      },
      {
        row: 0,
        column: 2,
        value: { kind: "currency", value: 9.99, currency: "GBP" },
        displayText: "£9.99",
      },
      {
        row: 1,
        column: 0,
        value: { kind: "boolean", value: true },
        displayText: "TRUE",
      },
      {
        row: 1,
        column: 1,
        value: { kind: "date", value: "2026-07-30" },
        displayText: "2026-07-30",
      },
      {
        row: 1,
        column: 2,
        value: { kind: "string", value: "hello" },
        displayText: "hello",
      },
    ];
    expectSheetRoundTrip(sheetDocumentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a formula cell's verbatim formula text alongside its cached value", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "number", value: 3 },
        displayText: "3",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "number", value: 4 },
        displayText: "4",
      },
      {
        row: 0,
        column: 2,
        value: { kind: "number", value: 7 },
        displayText: "7",
        formula: "of:=[.A1]+[.B1]",
      },
    ];
    expectSheetRoundTrip(sheetDocumentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips cell runs with inline formatting and a hyperlink", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Bold and a link" },
        displayText: "Bold and a link",
        runs: [
          { text: "Bold", bold: true },
          { text: " and " },
          { text: "a link", hyperlink: "https://example.invalid/?a=1&b=2" },
        ],
      },
    ];
    expectSheetRoundTrip(sheetDocumentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips cell background, borders, alignment, and vertical alignment", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Decorated" },
        displayText: "Decorated",
        background: { kind: "solid", color: { r: 1, g: 1, b: 0.6 } },
        borders: {
          left: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "solid" },
          right: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "dashed" },
          top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
          bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "double" },
        },
        alignment: "center",
        verticalAlignment: "middle",
      },
    ];
    expectSheetRoundTrip(sheetDocumentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a merged range, with the anchor cell's own colSpan/rowSpan and the covered cells dropped", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Merged" },
        displayText: "Merged",
        colSpan: 2,
        rowSpan: 2,
      },
      {
        row: 0,
        column: 2,
        value: { kind: "string", value: "Neighbour" },
        displayText: "Neighbour",
      },
    ];
    expectSheetRoundTrip(sheetDocumentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips multiple sheets with distinct names", () => {
    const document = sheetDocumentOf([
      sheetOf("First", [
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 1 },
          displayText: "1",
        },
      ]),
      sheetOf("Second", [
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 2 },
          displayText: "2",
        },
      ]),
    ]);
    expectSheetRoundTrip(document);
  });

  it("round-trips column widths and hidden columns", () => {
    const document = sheetDocumentOf([
      sheetOf(
        "Sheet1",
        [
          {
            row: 0,
            column: 3,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
        ],
        {
          columns: [
            { index: 0, widthPt: 100 },
            { index: 1, hidden: true },
          ],
        },
      ),
    ]);
    expectSheetRoundTrip(document);
  });

  it("round-trips row heights and hidden rows", () => {
    const document = sheetDocumentOf([
      sheetOf(
        "Sheet1",
        [
          {
            row: 3,
            column: 0,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
        ],
        {
          rows: [
            { index: 0, heightPt: 30 },
            { index: 1, hidden: true },
          ],
        },
      ),
    ]);
    expectSheetRoundTrip(document);
  });

  it("round-trips a cell-anchored image, including alt text", () => {
    const document = sheetDocumentOf([
      sheetOf("Sheet1", [], {
        images: [
          {
            kind: "image",
            format: "png",
            base64: PNG_BASE64,
            widthPt: 40,
            heightPt: 40,
            anchorRow: 2,
            anchorColumn: 1,
            offsetXPt: 5,
            offsetYPt: 3,
            altText: "A test image",
          },
        ],
      }),
    ]);
    expectSheetRoundTrip(document);
  });

  it("round-trips print settings: gridlines, headers, page order, scale, and print range", () => {
    const document = sheetDocumentOf([
      sheetOf(
        "Sheet1",
        [
          {
            row: 5,
            column: 5,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
        ],
        {
          printSettings: {
            pageSize: PAGE_SIZE_A4,
            margins: SHEET_MARGINS,
            gridlines: true,
            headers: true,
            pageOrder: "overThenDown",
            scalePercent: 75,
            printRange: {
              startRow: 0,
              startColumn: 0,
              endRow: 5,
              endColumn: 5,
            },
          },
        },
      ),
    ]);
    expectSheetRoundTrip(document);
  });

  it("round-trips repeated header rows/columns and manual page breaks", () => {
    const document = sheetDocumentOf([
      sheetOf(
        "Sheet1",
        [
          {
            row: 4,
            column: 4,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
        ],
        {
          printSettings: {
            ...DEFAULT_SHEET_PRINT_SETTINGS,
            repeatRows: { start: 0, end: 1 },
            repeatColumns: { start: 0, end: 1 },
            manualBreaks: { rows: [2], columns: [1] },
          },
        },
      ),
    ]);
    expectSheetRoundTrip(document);
  });

  it("holds through the tree form as well as the flat one", () => {
    const document = sheetDocumentOf([
      sheetOf("Sheet1", [
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "Tree form" },
          displayText: "Tree form",
        },
      ]),
    ]);
    const tree = assembleTree(document);
    const pkg = decodePackage(encodePackage(writeSxc(tree)));
    // See the sxw suite's own identical note above: the round trip alone cannot distinguish genuine OpenOffice.org 1.x output from writeOds's own plain ODF passed straight through.
    expect(isOoo1Package(pkg)).toBe(true);
    expect(normaliseOdsContent(flattenTree(readSxc(pkg)))).toEqual(
      normaliseOdsContent(document),
    );
    expect(readSxc(pkg).kind).toBe("spreadsheet");
  });
});

describe("writeSxcContent produces genuine OpenOffice.org 1.x XML, not merely something transformOoo1Package tolerates", () => {
  function sheetContentRootOf(pkg: Package): {
    readonly pkg: Package;
    readonly root: ReturnType<typeof rootElement>;
  } {
    const content = pkg.parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("content.xml did not survive as an XML part");
    }
    return { pkg, root: rootElement(content.nodes) };
  }

  function firstAnchorCell(pkg: Package): ReturnType<typeof findChildElement> {
    const { root } = sheetContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    const table =
      body === undefined
        ? undefined
        : findChildElement(body.children, "table:table");
    const row =
      table === undefined
        ? undefined
        : findChildElement(table.children, "table:table-row");
    return row === undefined
      ? undefined
      : findChildElement(row.children, "table:table-cell");
  }

  it("carries no mimetype part at all", () => {
    const pkg = writeSxcContent(sheetDocumentOf([sheetOf("Sheet1", [])]));
    expect(pkg.parts.mimetype).toBeUndefined();
    expect(readMimetype(pkg)).toBeUndefined();
  });

  it("is itself detected as an OpenOffice.org 1.x package", () => {
    const pkg = writeSxcContent(sheetDocumentOf([sheetOf("Sheet1", [])]));
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("declares the .stc template media type in the manifest root entry when template is requested", () => {
    const pkg = writeSxcContent(sheetDocumentOf([sheetOf("Sheet1", [])]), {
      template: true,
    });
    expect(
      readManifest(pkg).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.sun.xml.calc.template");
  });

  it("declares the OpenOffice.org 1.x namespace URIs and office:class='spreadsheet'", () => {
    const { root } = sheetContentRootOf(
      writeSxcContent(sheetDocumentOf([sheetOf("Sheet1", [])])),
    );
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    expect(attrValue(root, "xmlns:office")).toBe(
      "http://openoffice.org/2000/office",
    );
    expect(attrValue(root, "xmlns:table")).toBe(
      "http://openoffice.org/2000/table",
    );
    expect(attrValue(root, "office:class")).toBe("spreadsheet");
  });

  it("puts office:body's content directly inside it, with no office:spreadsheet genre wrapper", () => {
    const { root } = sheetContentRootOf(
      writeSxcContent(sheetDocumentOf([sheetOf("Sheet1", [])])),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("content.xml has no office:body");
    }
    expect(
      findChildElement(body.children, "office:spreadsheet"),
    ).toBeUndefined();
    expect(findChildElement(body.children, "table:table")).toBeDefined();
  });

  it("writes a cell's value as table:value-type/table:value, not office:value-type/office:value", () => {
    const pkg = writeSxcContent(
      sheetDocumentOf([
        sheetOf("Sheet1", [
          {
            row: 0,
            column: 0,
            value: { kind: "number", value: 42 },
            displayText: "42",
          },
        ]),
      ]),
    );
    const cell = firstAnchorCell(pkg);
    if (cell === undefined) {
      throw new Error("no anchor table:table-cell found");
    }
    expect(attrValue(cell, "table:value-type")).toBe("float");
    expect(attrValue(cell, "table:value")).toBe("42");
    expect(attrValue(cell, "office:value-type")).toBeUndefined();
    expect(attrValue(cell, "office:value")).toBeUndefined();
  });

  it("writes a cell background as one bare style:properties, not a typed style:table-cell-properties", () => {
    const pkg = writeSxcContent(
      sheetDocumentOf([
        sheetOf("Sheet1", [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "x" },
            displayText: "x",
            background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
          },
        ]),
      ]),
    );
    const { root } = sheetContentRootOf(pkg);
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    const automaticStyles = findChildElement(
      root.children,
      "office:automatic-styles",
    );
    if (automaticStyles === undefined) {
      throw new Error("content.xml has no office:automatic-styles");
    }
    const cellStyle = childrenWithTag(automaticStyles, "style:style").find(
      (styleElement) =>
        attrValue(styleElement, "style:family") === "table-cell" &&
        findChildElement(styleElement.children, "style:properties") !==
          undefined,
    );
    if (cellStyle === undefined) {
      throw new Error(
        "no table-cell style:style with a style:properties child was minted",
      );
    }
    expect(
      findChildElement(cellStyle.children, "style:table-cell-properties"),
    ).toBeUndefined();
  });

  it("writes a cell-anchored image as a bare draw:image, not a draw:frame wrapping one", () => {
    const pkg = writeSxcContent(
      sheetDocumentOf([
        sheetOf("Sheet1", [], {
          images: [
            {
              kind: "image",
              format: "png",
              base64: PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
              anchorRow: 0,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
          ],
        }),
      ]),
    );
    const cell = firstAnchorCell(pkg);
    if (cell === undefined) {
      throw new Error("no anchor table:table-cell found");
    }
    expect(findChildElement(cell.children, "draw:frame")).toBeUndefined();
    expect(findChildElement(cell.children, "draw:image")).toBeDefined();
  });

  it("gives each sheet its own distinct table:name", () => {
    const pkg = writeSxcContent(
      sheetDocumentOf([sheetOf("First", []), sheetOf("Second", [])]),
    );
    const { root } = sheetContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("content.xml has no office:body");
    }
    const tables = childrenWithTag(body, "table:table");
    expect(tables.map((table) => attrValue(table, "table:name"))).toEqual([
      "First",
      "Second",
    ]);
  });
});
