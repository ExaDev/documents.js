import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
  DocumentTree,
  SourceResidue,
} from "document-schema.js";
import { PAGE_SIZE_A4, assembleTree } from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import {
  childrenWithTag,
  findChildElement,
  rootElement,
} from "../../xml/query";
import { readManifest } from "../../manifest";
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

  it("round-trips a whole-number data-validation rule with a comparison, messages, and a no-blank restriction", () => {
    const sheet = sheetOf(
      "Sheet1",
      [
        {
          row: 0,
          column: 0,
          value: { kind: "number", value: 5 },
          displayText: "5",
        },
      ],
      {
        dataValidations: [
          {
            ranges: [{ startRow: 0, startColumn: 0, endRow: 1, endColumn: 2 }],
            type: "whole",
            operator: "greaterThanOrEqual",
            formula1: "1",
            allowBlank: false,
            showInputMessage: true,
            promptTitle: "Whole numbers only",
            prompt: "Enter a whole number\nno decimals",
            showErrorMessage: true,
            errorStyle: "warning",
            errorTitle: "Not whole",
            error: "That was not a whole number",
          },
        ],
      },
    );
    expectRoundTrip(documentOf([sheet]));
  });

  it("round-trips list, text-length-between, custom, and bare-type validation rules together", () => {
    const sheet = sheetOf("Sheet1", [], {
      dataValidations: [
        {
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          type: "list",
          formula1: '"red";"green";"blue"',
        },
        {
          ranges: [{ startRow: 2, startColumn: 0, endRow: 2, endColumn: 0 }],
          type: "textLength",
          operator: "notBetween",
          formula1: "0",
          formula2: "5",
        },
        {
          ranges: [{ startRow: 4, startColumn: 0, endRow: 4, endColumn: 0 }],
          type: "custom",
          formula1: "ISODD(A5)",
        },
        {
          ranges: [{ startRow: 6, startColumn: 0, endRow: 6, endColumn: 0 }],
          type: "date",
        },
      ],
    });
    expectRoundTrip(documentOf([sheet]));
  });

  it("merges two identical validation rules into one definition and re-orders rules by first reference", () => {
    const sheet = sheetOf("Sheet1", [], {
      dataValidations: [
        {
          ranges: [{ startRow: 2, startColumn: 0, endRow: 2, endColumn: 0 }],
          type: "whole",
          operator: "lessThan",
          formula1: "10",
        },
        {
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          type: "decimal",
          operator: "equal",
          formula1: "3.5",
        },
        {
          // Same promoted content as the first rule: one shared definition, ranges unioned.
          ranges: [{ startRow: 4, startColumn: 0, endRow: 4, endColumn: 0 }],
          type: "whole",
          operator: "lessThan",
          formula1: "10",
        },
      ],
    });
    expectRoundTrip(documentOf([sheet]));
  });

  it("round-trips conditional-format rules of every writable type sharing one range list", () => {
    const ranges = [{ startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 }];
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "cellIs",
          ranges,
          operator: "between",
          formula1: "1",
          formula2: "10",
          style: { textColor: { r: 0.5019607843137255, g: 0.0, b: 0.0 } },
        },
        {
          type: "uniqueValues",
          ranges,
          style: { background: { r: 1.0, g: 1.0, b: 0.8784313725490196 } },
        },
        {
          type: "top10",
          ranges,
          rank: 5,
          percent: true,
        },
        {
          type: "aboveAverage",
          ranges,
          aboveAverage: false,
          equalAverage: true,
        },
        {
          type: "timePeriod",
          ranges,
          timePeriod: "last7Days",
        },
        {
          type: "colorScale",
          ranges,
          stops: [
            {
              value: { type: "min" },
              color: {
                r: 0.9725490196078431,
                g: 0.42745098039215684,
                b: 0.42745098039215684,
              },
            },
            {
              value: { type: "percent", value: "50" },
              color: { r: 1.0, g: 0.9215686274509803, b: 0.5176470588235295 },
            },
            {
              value: { type: "max" },
              color: {
                r: 0.42745098039215684,
                g: 0.7176470588235294,
                b: 0.5607843137254902,
              },
            },
          ],
        },
        {
          type: "dataBar",
          ranges,
          min: { type: "min" },
          max: { type: "max" },
          color: {
            r: 0.38823529411764707,
            g: 0.7450980392156863,
            b: 0.4823529411764706,
          },
          showValue: false,
        },
        {
          type: "iconSet",
          ranges,
          iconSetType: "3TrafficLights1",
          thresholds: [
            { type: "percent", value: "0" },
            { type: "percent", value: "33" },
            { type: "percent", value: "67" },
          ],
        },
      ],
    });
    expectRoundTrip(documentOf([sheet]));
  });

  it("refuses a containsBlanks conditional-format rule by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "containsBlanks",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(
      /containsBlanks.*no spelling/,
    );
  });

  it("round-trips a conditional-format rule whose range reaches far past the content grid without materialising it", () => {
    // The hostile shape the security review of this PR named: a compact calcext:target-range-address controls nothing but its own attribute, so a rule spanning a huge rectangle must not drive one row element per covered row. This rule's range reaches ~100k rows x 256 columns on a sheet whose content grid is empty; if the writer ever lets a conditional-format range extend the materialised grid, this test takes seconds and allocates millions of nodes before it fails.
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "uniqueValues",
          ranges: [
            { startRow: 0, startColumn: 0, endRow: 99_999, endColumn: 255 },
          ],
        },
      ],
    });
    expectRoundTrip(documentOf([sheet]));
    const pkg = writeOdsContent(documentOf([sheet]));
    const part = pkg.parts["content.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml content.xml part");
    }
    const root = rootElement(part.nodes);
    if (root === undefined) {
      throw new Error("expected a content.xml root element");
    }
    const body = findChildElement(root.children, "office:body");
    const spreadsheet = findChildElement(
      body?.children ?? [],
      "office:spreadsheet",
    );
    if (spreadsheet === undefined) {
      throw new Error("expected an office:spreadsheet element");
    }
    const table = childrenWithTag(spreadsheet, "table:table")[0];
    if (table === undefined) {
      throw new Error("expected a table:table element");
    }
    expect(childrenWithTag(table, "table:table-row")).toHaveLength(0);
    expect(childrenWithTag(table, "calcext:conditional-formats")).toHaveLength(
      1,
    );
  });

  it("refuses a conditional-format rule carrying a priority by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "uniqueValues",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          priority: 1,
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(/priority/);
  });

  it("refuses an aboveAverage rule carrying a standard-deviation count by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "aboveAverage",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          stdDev: 2,
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(
      /standard-deviation/,
    );
  });

  it("refuses a reversed icon set by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "iconSet",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          iconSetType: "3Arrows",
          thresholds: [{ type: "percent", value: "0" }],
          reverse: true,
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(/reversed/);
  });

  it("refuses a colour scale carrying a num threshold by name", () => {
    const sheet = sheetOf("Sheet1", [], {
      conditionalFormats: [
        {
          type: "colorScale",
          ranges: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }],
          stops: [
            { value: { type: "num", value: "0" }, color: { r: 0, g: 0, b: 0 } },
            { value: { type: "max" }, color: { r: 255, g: 255, b: 255 } },
          ],
        },
      ],
    });
    expect(() => writeOdsContent(documentOf([sheet]))).toThrow(/'num'/);
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

  it("restores a quarantined non-content package part verbatim, through the tree form", () => {
    // A settings.xml this writer never generates itself, exactly the shape readOdsContent quarantines wholesale on the way in (typed/shared/constructs.ts's collectOdfNonContentPartResidue).
    const settingsXml =
      '<office:document-settings office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item config:name="ViewAreaTop" config:type="int">0</config:config-item></config:config-item-set></office:settings></office:document-settings>';
    const source: Record<string, SourceResidue> = {
      "settings.xml": { format: "ods", xml: settingsXml },
    };
    const tree: DocumentTree = {
      ...assembleTree(documentOf([sheetOf("Sheet1", [])])),
      source,
    };

    const written = writeOds(tree);
    const settingsPart = written.parts["settings.xml"];
    expect(settingsPart?.kind).toBe("xml");
    expect(
      settingsPart?.kind === "xml" &&
        settingsPart.nodes.some(
          (node) =>
            node.type === "element" && node.tag === "office:document-settings",
        ),
    ).toBe(true);
    const manifest = readManifest(written);
    expect(
      manifest.entries.some((entry) => entry.fullPath === "settings.xml"),
    ).toBe(true);

    const readBack = readOds(decodePackage(encodePackage(written)));
    expect(readBack.source).toEqual(source);
  });

  describe("real producer fixtures", () => {
    it("round-trips minimal.ods (real LibreOffice output)", () => {
      const content = contentOf(loadFixture("minimal.ods"));
      expectRoundTrip(content);
    });
  });
});

describe("writeOdsContent round trip: cell comments (ExaDev/documents.js#949)", () => {
  it("round-trips a full comment (text, author, createdAt) alongside the cell's own value", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "number", value: 42 },
        displayText: "42",
        comment: {
          text: "A real note",
          author: "Alice",
          createdAt: "2026-01-02T03:04:05",
        },
      },
    ];
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a comment with no author and no createdAt", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        comment: { text: "Just text" },
      },
    ];
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a multi-paragraph comment", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        comment: { text: "First paragraph\nSecond paragraph" },
      },
    ];
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a comment on an otherwise genuinely empty cell -- a note pinned to a cell with no value, formula, or text of its own", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 3,
        column: 2,
        value: { kind: "empty" },
        displayText: "",
        comment: { text: "Floating note" },
      },
    ];
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });

  it("round-trips a comment whose text needs XML escaping in its own text:p and whose author needs it in dc:creator", () => {
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
        comment: { text: "Tom & Jerry <b>bold</b>", author: "A & B" },
      },
    ];
    expectRoundTrip(documentOf([sheetOf("Sheet1", cells)]));
  });
});
