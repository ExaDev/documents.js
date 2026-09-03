import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { parsePackage } from "../../package-io/read";
import { readOds, readOdsContent } from "./read";
import { normaliseOdsContent, writeOds, writeOdsContent } from "./write";

// The write side's correctness suite: what writeOdsContent produces reads back as the document it was given, mirroring typed/odt/write-round-trip.test.ts's own discipline exactly. THE LAW: normaliseOdsContent(readOdsContent(writeOdsContent(document))) equals normaliseOdsContent(document), for every document the writer accepts -- normalisation applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose. The sibling suite (write.test.ts) pins the actual XML shapes this one cannot see through its own reader's own eyes.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const MARGINS = { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 };

const DEFAULT_PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_A4,
  margins: MARGINS,
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

// A 1x1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type SpreadsheetDocument = Extract<ContentDocument, { kind: "spreadsheet" }>;

function loadFixture(name: string): Package {
  return parsePackage(new Uint8Array(readFileSync(join(FIXTURES_DIR, name))));
}

function contentOf(pkg: Package): SpreadsheetDocument {
  const { metadata, sheets } = readOdsContent(pkg);
  return { kind: "spreadsheet", metadata, sheets };
}

function roundTrip(document: ContentDocument): SpreadsheetDocument {
  return contentOf(decodePackage(encodePackage(writeOdsContent(document))));
}

function expectRoundTrip(document: ContentDocument): void {
  expect(normaliseOdsContent(roundTrip(document))).toEqual(
    normaliseOdsContent(document),
  );
}

function documentOf(sheets: ContentSheet[]): SpreadsheetDocument {
  return { kind: "spreadsheet", metadata: {}, sheets };
}

function sheetOf(
  name: string,
  cells: ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name,
    cells,
    columns: [],
    rows: [],
    images: [],
    printSettings: DEFAULT_PRINT_SETTINGS,
    ...overrides,
  };
}

describe("writeOdsContent round trip", () => {
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
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a number cell's exactValue as the recovered double, dropping the decimal string itself", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "number", value: 0.1 + 0.2, exactValue: "0.3" },
        displayText: "0.3",
      },
    ];
    const document = documentOf([sheetOf("Sheet1", cells)]);
    const result = roundTrip(document);
    expect(result.sheets[0]!.cells[0]!.value).toEqual({
      kind: "number",
      value: 0.3,
    });
  });

  it("refuses a 'dateTime' cell by name -- readOdsContent can never produce this kind", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "dateTime", value: "2026-07-30T13:30:00" },
        displayText: "2026-07-30 13:30",
      },
    ];
    expect(() =>
      writeOdsContent(documentOf([sheetOf("Sheet1", cells)])),
    ).toThrow(/dateTime/);
  });

  it("refuses an 'error' cell by name -- readOdsContent can never produce this kind", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "error", value: "#DIV/0!" },
        displayText: "#DIV/0!",
      },
    ];
    expect(() =>
      writeOdsContent(documentOf([sheetOf("Sheet1", cells)])),
    ).toThrow(/error/);
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
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
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
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a cell manually broken across multiple lines", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "line one\nline two" },
        displayText: "line one\nline two",
        runs: [{ text: "line one" }, { text: "\n" }, { text: "line two" }],
      },
    ];
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips cell background, borders, alignment, and vertical alignment", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Decorated" },
        displayText: "Decorated",
        background: { r: 1, g: 1, b: 0.6 },
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
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
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
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips multiple sheets with distinct names", () => {
    const document = documentOf([
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
    expectRoundTrip(document);
  });

  it("round-trips column widths and hidden columns, densifying undeclared positions to the reader's own default width", () => {
    const document = documentOf([
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
    expectRoundTrip(document);
  });

  it("round-trips row heights and hidden rows, densifying undeclared positions to the reader's own default height", () => {
    const document = documentOf([
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
    expectRoundTrip(document);
  });

  it("round-trips a cell-anchored image, including alt text", () => {
    const document = documentOf([
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
    expectRoundTrip(document);
  });

  it("round-trips an image anchored at the sheet origin, even alongside real cell content there", () => {
    const document = documentOf([
      sheetOf(
        "Sheet1",
        [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "Origin" },
            displayText: "Origin",
          },
        ],
        {
          images: [
            {
              kind: "image",
              format: "png",
              base64: PNG_BASE64,
              widthPt: 20,
              heightPt: 20,
              anchorRow: 0,
              anchorColumn: 0,
              offsetXPt: 0,
              offsetYPt: 0,
            },
          ],
        },
      ),
    ]);
    expectRoundTrip(document);
  });

  it("round-trips print settings: gridlines, headers, page order, scale, and print range", () => {
    const document = documentOf([
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
            margins: MARGINS,
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
    expectRoundTrip(document);
  });

  it("round-trips fit-to-pages scaling", () => {
    const document = documentOf([
      sheetOf(
        "Sheet1",
        [
          {
            row: 0,
            column: 0,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
        ],
        {
          printSettings: {
            ...DEFAULT_PRINT_SETTINGS,
            fitToPages: { width: 1, height: 2 },
          },
        },
      ),
    ]);
    expectRoundTrip(document);
  });

  it("round-trips repeated header rows and columns", () => {
    const document = documentOf([
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
            ...DEFAULT_PRINT_SETTINGS,
            repeatRows: { start: 0, end: 1 },
            repeatColumns: { start: 0, end: 1 },
          },
        },
      ),
    ]);
    expectRoundTrip(document);
  });

  it("round-trips manual page breaks on rows and columns", () => {
    const document = documentOf([
      sheetOf(
        "Sheet1",
        [
          {
            row: 3,
            column: 3,
            value: { kind: "number", value: 1 },
            displayText: "1",
          },
        ],
        {
          printSettings: {
            ...DEFAULT_PRINT_SETTINGS,
            manualBreaks: { rows: [2], columns: [1] },
          },
        },
      ),
    ]);
    expectRoundTrip(document);
  });

  it("refuses a sheet carrying an embedded object by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      embeddedObjects: [
        {
          objectKind: "chart",
          document: { kind: "spreadsheet", metadata: {}, sheets: [] },
          frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(
      /embedded object/,
    );
  });

  it("refuses a sheet carrying a data-validation rule by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      dataValidations: [
        {
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          type: "whole",
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(
      /data-validation/,
    );
  });

  it("refuses a sheet carrying a conditional-formatting rule by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "containsBlanks",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(
      /conditional-formatting/,
    );
  });

  it("refuses a wrong-kind ContentDocument", () => {
    expect(() =>
      writeOdsContent({ kind: "wordprocessing", metadata: {}, sections: [] }),
    ).toThrow(/spreadsheet/);
  });

  it("writeOds flattens a DocumentTree read by readOds and writes it back out", () => {
    const pkg = loadFixture("minimal.ods");
    const tree = readOds(pkg);
    const rewritten = decodePackage(encodePackage(writeOds(tree)));
    const reread = readOds(rewritten);
    expect(reread.kind).toBe("spreadsheet");
  });

  describe("real producer fixtures", () => {
    it("round-trips minimal.ods (real LibreOffice output)", () => {
      const content = contentOf(loadFixture("minimal.ods"));
      expectRoundTrip(content);
    });
  });
});
