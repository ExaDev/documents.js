import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
} from "document-schema.js";
import {
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
  assembleTree,
  flattenTree,
} from "document-schema.js";
import type { Package } from "../model/package";
import { decodePackage, encodePackage } from "../codec";
import {
  rootElement,
  attrValue,
  childrenWithTag,
  findChildElement,
} from "../xml/query";
import { readMimetype } from "../mimetype";
import { normaliseOdtContent } from "../typed/odt/write";
import { normaliseOdsContent } from "../typed/ods/write";
import { readSxw, readSxwContent, readSxc, readSxcContent } from "./read";
import { isOoo1Package } from "./ns";
import { writeSxw, writeSxwContent, writeSxc, writeSxcContent } from "./write";

// The write side's correctness suite for .sxw, mirroring typed/odt/write-round-trip.test.ts's own law: a document written by writeSxwContent and read back through the EXISTING readSxwContent reader (readOdtContent run over transformOoo1Package's own forward transform -- unmodified by anything in this PR) reproduces the document it was given, up to the exact same canonical form normaliseOdtContent already states for the plain .odt writer. That reuse is deliberate, not a shortcut: writeSxwContent is writeOdtContent's own output run through transformToOoo1Package and back through transformOoo1Package on the way in, so the two writers share one correctness law by construction, and a normalisation gap in one is a normalisation gap in both.
//
// A second, independent kind of assertion sits alongside the round trip: that the PACKAGE writeSxwContent produces actually LOOKS like OpenOffice.org 1.x XML -- declares its own namespace URIs, carries no "mimetype" part, splits nothing into ODF's typed style:*-properties family, wraps nothing in a draw:frame -- rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed. A writer that merely round-trips without genuinely changing shape would pass the round-trip law by accident (see this module's own top-of-file note on why transformToOoo1Package must produce authentically OpenOffice.org 1.x-shaped output, not just something transformOoo1Package happens not to choke on).

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type WordprocessingDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

function documentOf(blocks: ContentBlock[]): WordprocessingDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [{ pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks }],
  };
}

function roundTrip(document: ContentDocument): WordprocessingDocument {
  const pkg = decodePackage(encodePackage(writeSxwContent(document)));
  const { metadata, sections } = readSxwContent(pkg);
  return { kind: "wordprocessing", metadata, sections };
}

function expectRoundTrip(document: ContentDocument): void {
  expect(normaliseOdtContent(roundTrip(document))).toEqual(
    normaliseOdtContent(document),
  );
}

const KITCHEN_SINK: WordprocessingDocument = {
  kind: "wordprocessing",
  metadata: {
    title: "Writer round trip",
    author: "odf.js",
    subject: "The sxw write path",
    keywords: ["odf", "openoffice", "writer"],
    creator: "odf.js test suite",
    createdIso: "2026-09-03T10:00:00Z",
    modifiedIso: "2026-09-03T11:00:00Z",
  },
  sections: [
    {
      pageSize: PAGE_SIZE_A4,
      margins: MARGINS,
      blocks: [
        {
          kind: "paragraph",
          headingLevel: 1,
          styleId: "Heading1",
          runs: [{ text: "Title" }],
        },
        {
          kind: "paragraph",
          alignment: "justify",
          spacingBeforePt: 6,
          spacingAfterPt: 3,
          lineSpacing: 1.5,
          indentLeftPt: 18,
          indentFirstLinePt: 9,
          runs: [
            { text: "Plain, " },
            { text: "bold", bold: true },
            { text: ", " },
            {
              text: "italic",
              italic: true,
              sizePt: 12,
              fontFamily: "Liberation Serif",
            },
            { text: ", " },
            { text: "struck", strike: true, color: { r: 0.8, g: 0, b: 0 } },
            { text: " and " },
            {
              text: "a link",
              underline: true,
              hyperlink: "https://example.invalid/?a=1&b=2",
            },
            { text: "." },
          ],
        },
        {
          kind: "paragraph",
          runs: [{ text: "  leading, three   inner, a\ttab and a\nbreak.  " }],
        },
        {
          kind: "paragraph",
          runs: [{ text: "First" }],
          list: { numId: "ordered:list1", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "Nested" }],
          list: { numId: "ordered:list1", level: 1 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "Second" }],
          list: { numId: "ordered:list1", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "A bullet" }],
          list: { numId: "bullet:list2", level: 0 },
        },
        {
          kind: "table",
          columnWidthsPt: [120, 120, 120],
          rows: [
            {
              heightPt: 20,
              cells: [
                {
                  colSpan: 2,
                  background: { r: 1, g: 1, b: 0.6 },
                  borders: {
                    top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
                    bottom: {
                      color: { r: 0, g: 0, b: 0 },
                      widthPt: 1,
                      style: "dashed",
                    },
                  },
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "Merged header" }] },
                  ],
                },
                { blocks: [] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "Third" }] }] },
              ],
            },
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "b" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "c" }] }] },
              ],
            },
          ],
        },
        { kind: "paragraph", runs: [{ text: "An image follows." }] },
        {
          kind: "image",
          format: "png",
          base64: PNG_BASE64,
          widthPt: 36,
          heightPt: 36,
          altText: "A red dot",
        },
        { kind: "pageBreak" },
        {
          kind: "paragraph",
          runs: [{ text: "After an explicit page break." }],
        },
      ],
    },
    {
      pageSize: PAGE_SIZE_LETTER,
      margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
      breakType: "nextPage",
      blocks: [
        {
          kind: "paragraph",
          runs: [{ text: "A second section, on Letter paper." }],
        },
      ],
    },
  ],
};

describe("the sxw round-trip law", () => {
  it("holds over a document exercising every construct writeOdtContent writes", () => {
    expectRoundTrip(KITCHEN_SINK);
  });

  it("holds through the tree form as well as the flat one", () => {
    const tree = assembleTree(KITCHEN_SINK);
    const pkg = decodePackage(encodePackage(writeSxw(tree)));
    expect(normaliseOdtContent(flattenTree(readSxw(pkg)))).toEqual(
      normaliseOdtContent(KITCHEN_SINK),
    );
    expect(readSxw(pkg).kind).toBe("wordprocessing");
  });

  it("holds for a document whose only content is one empty paragraph", () => {
    expectRoundTrip(documentOf([{ kind: "paragraph", runs: [] }]));
  });

  it("holds for a document carrying no metadata at all", () => {
    expectRoundTrip(documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]));
  });

  it("holds for a bullet list nested two levels deep with no top-level style-name to inherit from", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "A" }],
          list: { numId: "bullet:list1", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "B" }],
          list: { numId: "bullet:list1", level: 1 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "C" }],
          list: { numId: "bullet:list1", level: 2 },
        },
      ]),
    );
  });
});

describe("writeSxwContent produces genuine OpenOffice.org 1.x XML, not merely something transformOoo1Package tolerates", () => {
  function contentRootOf(pkg: Package): {
    readonly pkg: Package;
    readonly root: ReturnType<typeof rootElement>;
  } {
    const content = pkg.parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("content.xml did not survive as an XML part");
    }
    return { pkg, root: rootElement(content.nodes) };
  }

  it("carries no mimetype part at all", () => {
    const pkg = writeSxwContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(pkg.parts.mimetype).toBeUndefined();
    expect(readMimetype(pkg)).toBeUndefined();
  });

  it("is itself detected as an OpenOffice.org 1.x package", () => {
    const pkg = writeSxwContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("declares the OpenOffice.org 1.x namespace URIs, not the OASIS ones", () => {
    const { root } = contentRootOf(
      writeSxwContent(
        documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]),
      ),
    );
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    expect(attrValue(root, "xmlns:office")).toBe(
      "http://openoffice.org/2000/office",
    );
    expect(attrValue(root, "xmlns:text")).toBe(
      "http://openoffice.org/2000/text",
    );
    expect(attrValue(root, "xmlns:fo")).toBe(
      "http://www.w3.org/1999/XSL/Format",
    );
    expect(attrValue(root, "office:class")).toBe("text");
  });

  it("puts office:body's content directly inside it, with no office:text genre wrapper", () => {
    const { root } = contentRootOf(
      writeSxwContent(
        documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]),
      ),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("content.xml has no office:body");
    }
    expect(findChildElement(body.children, "office:text")).toBeUndefined();
    expect(findChildElement(body.children, "text:p")).toBeDefined();
  });

  it("writes a bold run's automatic style as one bare style:properties, not a typed style:text-properties", () => {
    const { root } = contentRootOf(
      writeSxwContent(
        documentOf([
          { kind: "paragraph", runs: [{ text: "bold", bold: true }] },
        ]),
      ),
    );
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
    const style = findChildElement(automaticStyles.children, "style:style");
    if (style === undefined) {
      throw new Error("no style:style was minted");
    }
    expect(findChildElement(style.children, "style:properties")).toBeDefined();
    expect(
      findChildElement(style.children, "style:text-properties"),
    ).toBeUndefined();
  });

  it("writes an inline image as a bare draw:image, not a draw:frame wrapping one", () => {
    const { root } = contentRootOf(
      writeSxwContent(
        documentOf([
          { kind: "paragraph", runs: [{ text: "x" }] },
          {
            kind: "image",
            format: "png",
            base64: PNG_BASE64,
            widthPt: 10,
            heightPt: 10,
          },
        ]),
      ),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    const paragraph =
      body === undefined
        ? undefined
        : findChildElement(body.children, "text:p");
    if (paragraph === undefined) {
      throw new Error("no anchor paragraph found");
    }
    expect(findChildElement(paragraph.children, "draw:frame")).toBeUndefined();
    expect(findChildElement(paragraph.children, "draw:image")).toBeDefined();
  });

  it("spells an ordered list's own element distinctly from a bullet list's", () => {
    const { root } = contentRootOf(
      writeSxwContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "one" }],
            list: { numId: "ordered:list1", level: 0 },
          },
        ]),
      ),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("no office:body found");
    }
    expect(findChildElement(body.children, "text:ordered-list")).toBeDefined();
    expect(findChildElement(body.children, "text:list")).toBeUndefined();

    const { root: bulletRoot } = contentRootOf(
      writeSxwContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "one" }],
            list: { numId: "bullet:list1", level: 0 },
          },
        ]),
      ),
    );
    const bulletBody =
      bulletRoot === undefined
        ? undefined
        : findChildElement(bulletRoot.children, "office:body");
    if (bulletBody === undefined) {
      throw new Error("no office:body found");
    }
    expect(
      findChildElement(bulletBody.children, "text:unordered-list"),
    ).toBeDefined();
  });

  it("wraps every meta:keyword under one meta:keywords element", () => {
    const withKeywords = writeSxwContent({
      kind: "wordprocessing",
      metadata: { keywords: ["a", "b", "c"] },
      sections: [{ pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks: [] }],
    });
    const meta = withKeywords.parts["meta.xml"];
    if (meta?.kind !== "xml") {
      throw new Error("meta.xml did not survive as an XML part");
    }
    const root = rootElement(meta.nodes);
    const officeMeta =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:meta");
    if (officeMeta === undefined) {
      throw new Error("meta.xml has no office:meta");
    }
    const wrapper = findChildElement(officeMeta.children, "meta:keywords");
    if (wrapper === undefined) {
      throw new Error("no meta:keywords wrapper was written");
    }
    expect(
      wrapper.children.filter((child) => child.type === "element"),
    ).toHaveLength(3);
    expect(
      findChildElement(officeMeta.children, "meta:keyword"),
    ).toBeUndefined();
  });
});

// --- .sxc: the OpenOffice.org 1.x Calc writer -------------------------------------------------------------------------
//
// The same two-part discipline as the .sxw suite above: THE LAW below is the round-trip correctness proof (normaliseOdsContent(readSxcContent(writeSxcContent(document))) equals normaliseOdsContent(document), mirroring typed/ods/write-round-trip.test.ts's own law exactly, run through one more transform each way), and the "genuine OpenOffice.org 1.x XML" describe block that follows it makes the same second, independent kind of assertion the .sxw suite makes above: that the package writeSxcContent produces actually LOOKS like OpenOffice.org 1.x XML -- declares its own namespace URIs, carries no "mimetype" part, keeps a cell's value on table:value-type/table:value rather than ODF's office:value-type/office:value, splits nothing into ODF's typed style:table-cell-properties, wraps nothing in a draw:frame -- rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed.

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
  cells: ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name,
    cells,
    columns: [],
    rows: [],
    images: [],
    printSettings: DEFAULT_SHEET_PRINT_SETTINGS,
    ...overrides,
  };
}

function sheetDocumentOf(sheets: ContentSheet[]): SpreadsheetDocument {
  return { kind: "spreadsheet", metadata: {}, sheets };
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
            background: { r: 1, g: 0, b: 0 },
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
