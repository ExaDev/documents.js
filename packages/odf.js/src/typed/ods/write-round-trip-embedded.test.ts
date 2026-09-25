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

// The write side's correctness suite: what writeOdsContent produces reads back as the document it was given, mirroring typed/odt/write-round-trip.test.ts's own discipline exactly. THE LAW: normaliseOdsContent(readOdsContent(writeOdsContent(document))) equals normaliseOdsContent(document), for every document the writer accepts — normalisation applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose. The sibling suite (write.test.ts) pins the actual XML shapes this one cannot see through its own reader's own eyes.

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

function documentOf(sheets: readonly ContentSheet[]): SpreadsheetDocument {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

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
    printSettings: DEFAULT_PRINT_SETTINGS,
    ...overrides,
  };
}

describe("writeOdsContent round trip", () => {
  it("round-trips a spreadsheet embedded in a sheet through its anchor cell", () => {
    const sheet = sheetOf(
      "Sheet1",
      [
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "host" },
          displayText: "host",
        },
      ],
      {
        embeddedObjects: [
          {
            objectKind: "wordprocessing",
            frame: { xPt: 4.5, yPt: 13.2, widthPt: 180, heightPt: 90 },
            anchorRow: 0,
            anchorColumn: 0,
            offsetXPt: 4.5,
            offsetYPt: 13.2,
            document: {
              kind: "wordprocessing",
              metadata: {},
              sections: [
                {
                  pageSize: { widthPt: 612, heightPt: 792 },
                  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "inner text" }] },
                  ],
                },
              ],
            },
          },
        ],
      },
    );
    const document = documentOf([sheet]);
    const round = roundTrip(document);
    const objects = round.sheets[0]!.embeddedObjects ?? [];
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      objectKind: "wordprocessing",
      anchorRow: 0,
      anchorColumn: 0,
      document: {
        kind: "wordprocessing",
        sections: [
          {
            blocks: [{ kind: "paragraph", runs: [{ text: "inner text" }] }],
          },
        ],
      },
    });
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

    it("round-trips a comment on an otherwise genuinely empty cell — a note pinned to a cell with no value, formula, or text of its own", () => {
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
});
