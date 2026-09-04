import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentDrawPage,
  ContentSheet,
  ContentSheetCell,
  ContentShape,
  ContentSlide,
  ContentVector,
} from "document-schema.js";
import {
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
  SLIDE_SIZE_WIDESCREEN,
  assembleTree,
  flattenTree,
  rgbHexToColor,
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
import { readManifest } from "../manifest";
import { normaliseOdtContent } from "../typed/odt/write";
import { normaliseOdsContent } from "../typed/ods/write";
import { normaliseOdpContent } from "../typed/odp/write";
import { normaliseOdgContent } from "../typed/odg/write";
import {
  readSxw,
  readSxwContent,
  readSxc,
  readSxcContent,
  readSxi,
  readSxiContent,
  readSxd,
  readSxdContent,
} from "./read";
import { isOoo1Package } from "./ns";
import {
  writeSxw,
  writeSxwContent,
  writeSxc,
  writeSxcContent,
  writeSxi,
  writeSxiContent,
  writeSxd,
  writeSxdContent,
} from "./write";

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
    // The round trip alone cannot distinguish genuine OpenOffice.org 1.x output from writeOdt's own plain ODF passed straight through: transformOoo1Package returns anything it does not detect as OpenOffice.org 1.x unchanged, so a writeSxw that silently skipped transformToOoo1Package would still round-trip correctly here (identity composed with identity). isOoo1Package is the assertion that actually catches that -- see the "genuine OpenOffice.org 1.x XML" describe block below for the same check on writeSxwContent's own output.
    expect(isOoo1Package(pkg)).toBe(true);
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

  it("declares the .stw template media type in the manifest root entry when template is requested -- derived from writeOdtContent's own template option through ooo1MediaTypeForOdfMediaType, with no template-specific code of its own", () => {
    const pkg = writeSxwContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]),
      { template: true },
    );
    expect(
      readManifest(pkg).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.sun.xml.writer.template");
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

// The same two-part discipline as the .sxw/.sxc suites above: THE LAW below is the round-trip correctness proof (normaliseOdpContent(readSxiContent(writeSxiContent(document))) equals normaliseOdpContent(document), mirroring typed/odp/write-round-trip.test.ts's own law exactly, run through one more transform each way, including that suite's own rotated-shape tolerance exception), and the "genuine OpenOffice.org 1.x XML" describe block that follows makes the same second, independent assertion the .sxw/.sxc suites make: that writeSxiContent's own output actually LOOKS like OpenOffice.org 1.x XML -- declares its own namespace URIs, carries no "mimetype" part, puts office:body's content directly inside it with no office:presentation genre wrapper, and writes a shape as a bare draw:text-box rather than ODF's draw:frame-wrapped one -- rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed.

// A 1x1 PNG, genuinely decodable (sniffImageFormat reads real magic bytes) -- the same fixture typed/odp/write-round-trip.test.ts's own suite uses.
const SXI_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type PresentationDocument = Extract<ContentDocument, { kind: "presentation" }>;

function shapeOf(
  overrides: Partial<ContentShape> = {},
  blocks: ContentShape["blocks"] = [
    { kind: "paragraph", runs: [{ text: "Body" }] },
  ],
): ContentShape {
  return {
    frame: { xPt: 36, yPt: 48, widthPt: 400, heightPt: 120 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
    ...overrides,
  };
}

function slideOf(shapes: ContentShape[], notes = ""): ContentSlide {
  return { size: SLIDE_SIZE_WIDESCREEN, shapes, notes };
}

function presentationDocumentOf(slides: ContentSlide[]): PresentationDocument {
  return { kind: "presentation", metadata: {}, slides };
}

function presentationRoundTrip(
  document: ContentDocument,
): PresentationDocument {
  const pkg = decodePackage(encodePackage(writeSxiContent(document)));
  const { metadata, slides } = readSxiContent(pkg);
  return { kind: "presentation", metadata, slides };
}

function expectPresentationRoundTrip(document: ContentDocument): void {
  expect(normaliseOdpContent(presentationRoundTrip(document))).toEqual(
    normaliseOdpContent(document),
  );
}

describe("the sxi round-trip law", () => {
  it("round-trips a slide with formatted text, a table, an image, and speaker notes", () => {
    expectPresentationRoundTrip(
      presentationDocumentOf([
        slideOf(
          [
            shapeOf({}, [
              {
                kind: "paragraph",
                alignment: "center",
                runs: [{ text: "Title", bold: true }],
              },
            ]),
            shapeOf(
              { frame: { xPt: 300, yPt: 300, widthPt: 200, heightPt: 100 } },
              [
                {
                  kind: "table",
                  columnWidthsPt: [80, 80],
                  rows: [
                    {
                      cells: [
                        {
                          blocks: [
                            { kind: "paragraph", runs: [{ text: "A" }] },
                          ],
                        },
                        {
                          blocks: [
                            { kind: "paragraph", runs: [{ text: "B" }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            ),
            shapeOf(
              { frame: { xPt: 100, yPt: 400, widthPt: 96, heightPt: 96 } },
              [
                {
                  kind: "image",
                  format: "png",
                  base64: SXI_PNG_BASE64,
                  widthPt: 96,
                  heightPt: 96,
                },
              ],
            ),
          ],
          "Speaker notes line one\nline two",
        ),
      ]),
    );
  });

  it("round-trips multiple slides, each with its own page size", () => {
    expectPresentationRoundTrip({
      kind: "presentation",
      metadata: { title: "Sxi doc" },
      slides: [
        { size: SLIDE_SIZE_WIDESCREEN, shapes: [shapeOf()], notes: "" },
        { size: PAGE_SIZE_A4, shapes: [shapeOf()], notes: "" },
      ],
    });
  });

  // A rotated shape's own frame/rotationDeg is an exact algebraic inverse (typed/draw/write-shapes.ts's own frameGeometryAttrs) verified with a numeric tolerance rather than the blanket expectPresentationRoundTrip helper above, exactly mirroring typed/odp/write-round-trip.test.ts's own identical exception (two independent trig evaluations on either side of a real round trip -- here run through transformToOoo1Package/transformOoo1Package on top of writeOdp/readOdp -- are not guaranteed bit-identical).
  it("round-trips a rotated shape's geometry within floating-point tolerance", () => {
    const written = presentationRoundTrip(
      presentationDocumentOf([
        slideOf([
          shapeOf({
            frame: { xPt: 60, yPt: 200, widthPt: 200, heightPt: 80 },
            rotationDeg: 30,
          }),
        ]),
      ]),
    );
    const writtenShape = written.slides[0]!.shapes[0]!;
    expect(writtenShape.rotationDeg).toBeCloseTo(30, 9);
    expect(writtenShape.frame.xPt).toBeCloseTo(60, 6);
    expect(writtenShape.frame.yPt).toBeCloseTo(200, 6);
    expect(writtenShape.frame.widthPt).toBeCloseTo(200, 6);
    expect(writtenShape.frame.heightPt).toBeCloseTo(80, 6);
  });

  it("holds through the tree form as well as the flat one", () => {
    const document = presentationDocumentOf([slideOf([shapeOf()])]);
    const tree = assembleTree(document);
    const pkg = decodePackage(encodePackage(writeSxi(tree)));
    // See the sxw suite's own identical note above: the round trip alone cannot distinguish genuine OpenOffice.org 1.x output from writeOdp's own plain ODF passed straight through.
    expect(isOoo1Package(pkg)).toBe(true);
    expect(normaliseOdpContent(flattenTree(readSxi(pkg)))).toEqual(
      normaliseOdpContent(document),
    );
  });
});

describe("writeSxiContent produces genuine OpenOffice.org 1.x XML, not merely something transformOoo1Package tolerates", () => {
  function presentationContentRootOf(pkg: Package): {
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
    const pkg = writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])]));
    expect(pkg.parts.mimetype).toBeUndefined();
    expect(readMimetype(pkg)).toBeUndefined();
  });

  it("is itself detected as an OpenOffice.org 1.x package", () => {
    const pkg = writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])]));
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("declares the .sti template media type in the manifest root entry when template is requested", () => {
    const pkg = writeSxiContent(
      presentationDocumentOf([slideOf([shapeOf()])]),
      { template: true },
    );
    expect(
      readManifest(pkg).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.sun.xml.impress.template");
  });

  it("declares the OpenOffice.org 1.x namespace URIs and office:class='presentation'", () => {
    const { root } = presentationContentRootOf(
      writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])])),
    );
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    expect(attrValue(root, "xmlns:office")).toBe(
      "http://openoffice.org/2000/office",
    );
    expect(attrValue(root, "xmlns:presentation")).toBe(
      "http://openoffice.org/2000/presentation",
    );
    expect(attrValue(root, "office:class")).toBe("presentation");
  });

  it("puts office:body's content directly inside it, with no office:presentation genre wrapper", () => {
    const { root } = presentationContentRootOf(
      writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])])),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("content.xml has no office:body");
    }
    expect(
      findChildElement(body.children, "office:presentation"),
    ).toBeUndefined();
    expect(findChildElement(body.children, "draw:page")).toBeDefined();
  });

  it("writes a shape as a bare draw:text-box, not ODF's draw:frame-wrapped one", () => {
    const pkg = writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])]));
    const { root } = presentationContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    const page =
      body === undefined
        ? undefined
        : findChildElement(body.children, "draw:page");
    if (page === undefined) {
      throw new Error("content.xml has no draw:page");
    }
    expect(findChildElement(page.children, "draw:frame")).toBeUndefined();
    expect(findChildElement(page.children, "draw:text-box")).toBeDefined();
  });

  it("gives each slide's speaker notes as presentation:notes with no xmlns undeclared-prefix defect", () => {
    const pkg = writeSxiContent(
      presentationDocumentOf([slideOf([shapeOf()], "Notes text")]),
    );
    const { root } = presentationContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    const page =
      body === undefined
        ? undefined
        : findChildElement(body.children, "draw:page");
    const notes =
      page === undefined
        ? undefined
        : findChildElement(page.children, "presentation:notes");
    expect(notes).toBeDefined();
  });
});

// --- .sxd: the OpenOffice.org 1.x Draw writer --------------------------------------------------------------------------
//
// The same two-part discipline as the .sxw/.sxc/.sxi suites above: THE LAW below is the round-trip correctness proof (normaliseOdgContent(readSxdContent(writeSxdContent(document))) equals normaliseOdgContent(document), mirroring typed/odg/write-round-trip.test.ts's own law exactly, run through one more transform each way, including that suite's own rotated-geometry tolerance exception), and the "genuine OpenOffice.org 1.x XML" describe block that follows makes the same second, independent assertion the other three suites make: that writeSxdContent's own output actually LOOKS like OpenOffice.org 1.x XML -- declares its own namespace URIs, carries no "mimetype" part, puts office:body's content directly inside it with no office:drawing genre wrapper, writes a text-in-a-frame shape as a bare draw:text-box rather than ODF's draw:frame-wrapped one, and keeps a vector's fill and stroke in one bare style:properties rather than ODF's typed style:graphic-properties -- rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed.
//
// What this suite covers that the .sxi one structurally cannot is a drawing page's own second array: the VECTOR PRIMITIVES (rect/ellipse/line/path with fill and stroke) a ContentShape has no vocabulary for at all, and the paint order that has to hold BETWEEN the two arrays rather than within one of them.

type DrawingDocument = Extract<ContentDocument, { kind: "drawing" }>;

const SXD_RED = rgbHexToColor("#cc0000");
const SXD_GREEN = rgbHexToColor("#00aa44");
const SXD_BLUE = rgbHexToColor("#0033ff");

const SXD_PAGE_SIZE_LANDSCAPE = { widthPt: 720, heightPt: 540 };

function drawShapeOf(
  overrides: Partial<ContentShape> = {},
  blocks: ContentShape["blocks"] = [
    { kind: "paragraph", runs: [{ text: "Label" }] },
  ],
): ContentShape {
  return {
    frame: { xPt: 36, yPt: 48, widthPt: 240, heightPt: 80 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
    ...overrides,
  };
}

function drawPageOf(
  vectors: ContentVector[],
  shapes: ContentShape[] = [],
  size = SXD_PAGE_SIZE_LANDSCAPE,
): ContentDrawPage {
  return { size, shapes, vectors };
}

function drawingDocumentOf(pages: ContentDrawPage[]): DrawingDocument {
  return { kind: "drawing", metadata: {}, pages };
}

function drawingRoundTrip(document: ContentDocument): DrawingDocument {
  const pkg = decodePackage(encodePackage(writeSxdContent(document)));
  const { metadata, pages } = readSxdContent(pkg);
  return { kind: "drawing", metadata, pages };
}

function expectDrawingRoundTrip(document: ContentDocument): void {
  expect(normaliseOdgContent(drawingRoundTrip(document))).toEqual(
    normaliseOdgContent(document),
  );
}

describe("the sxd round-trip law", () => {
  it("round-trips a page carrying every vector kind writeOdgContent writes, alongside a text shape", () => {
    expectDrawingRoundTrip(
      drawingDocumentOf([
        drawPageOf(
          [
            {
              kind: "rect",
              frame: { xPt: 36, yPt: 48, widthPt: 120, heightPt: 90 },
              fill: SXD_BLUE,
              stroke: { color: SXD_RED, widthPt: 1.5 },
            },
            {
              kind: "ellipse",
              frame: { xPt: 200, yPt: 48, widthPt: 140, heightPt: 90 },
              fill: SXD_GREEN,
              stroke: { color: SXD_RED, widthPt: 3, style: "dashed" },
            },
            {
              kind: "line",
              from: { xPt: 12, yPt: 24 },
              to: { xPt: 300, yPt: 180 },
              stroke: { color: SXD_RED, widthPt: 2.25 },
            },
            {
              kind: "path",
              frame: { xPt: 40, yPt: 240, widthPt: 200, heightPt: 120 },
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  segments: [
                    { kind: "line", to: { xPt: 80, yPt: 0 } },
                    {
                      kind: "cubic",
                      control1: { xPt: 120, yPt: 0 },
                      control2: { xPt: 120, yPt: 60 },
                      to: { xPt: 80, yPt: 60 },
                    },
                    { kind: "line", to: { xPt: 0, yPt: 60 } },
                  ],
                  closed: true,
                },
                {
                  start: { xPt: 140, yPt: 10 },
                  segments: [
                    {
                      kind: "cubic",
                      control1: { xPt: 160, yPt: 110 },
                      control2: { xPt: 190, yPt: -10 },
                      to: { xPt: 200, yPt: 100 },
                    },
                  ],
                  closed: false,
                },
              ],
              fill: SXD_GREEN,
              fillRule: "evenodd",
              stroke: { color: SXD_RED, widthPt: 1 },
            },
          ],
          [
            drawShapeOf({}, [
              {
                kind: "paragraph",
                alignment: "center",
                runs: [{ text: "Caption", bold: true }],
              },
            ]),
          ],
        ),
      ]),
    );
  });

  it("round-trips multiple pages, each with its own page size", () => {
    expectDrawingRoundTrip({
      kind: "drawing",
      metadata: { title: "Sxd doc", keywords: ["openoffice", "draw"] },
      pages: [
        drawPageOf([
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 60, heightPt: 40 },
            fill: SXD_BLUE,
          },
        ]),
        drawPageOf(
          [
            {
              kind: "ellipse",
              frame: { xPt: 20, yPt: 20, widthPt: 80, heightPt: 80 },
              fill: SXD_GREEN,
            },
          ],
          [drawShapeOf()],
          PAGE_SIZE_A4,
        ),
      ],
    });
  });

  it("round-trips a paint order that disagrees with document order across both of a page's arrays", () => {
    expectDrawingRoundTrip(
      drawingDocumentOf([
        drawPageOf(
          [
            {
              kind: "rect",
              frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 },
              fill: SXD_BLUE,
              paintOrder: 0,
            },
            {
              kind: "ellipse",
              frame: { xPt: 60, yPt: 0, widthPt: 50, heightPt: 50 },
              fill: SXD_GREEN,
              paintOrder: 2,
            },
          ],
          [drawShapeOf({ paintOrder: 1 })],
        ),
      ]),
    );
  });

  // A rotated shape's and a rotated vector's own frame/rotationDeg is an exact algebraic inverse (typed/draw/write-shapes.ts's own frameGeometryAttrs) verified with a numeric tolerance rather than the blanket expectDrawingRoundTrip helper above, exactly mirroring typed/odg/write-round-trip.test.ts's own identical exception (two independent trig evaluations on either side of a real round trip -- here run through transformToOoo1Package/transformOoo1Package on top of writeOdg/readOdg -- are not guaranteed bit-identical).
  it("round-trips a rotated vector's geometry within floating-point tolerance", () => {
    const frame = { xPt: 60, yPt: 200, widthPt: 200, heightPt: 80 };
    const written = drawingRoundTrip(
      drawingDocumentOf([
        drawPageOf([{ kind: "rect", frame, rotationDeg: 30, fill: SXD_BLUE }]),
      ]),
    );
    const vector = written.pages[0]!.vectors[0]!;
    if (vector.kind !== "rect") {
      throw new Error(`expected a rect back, got '${vector.kind}'`);
    }
    expect(vector.rotationDeg).toBeCloseTo(30, 9);
    expect(vector.frame.xPt).toBeCloseTo(frame.xPt, 6);
    expect(vector.frame.yPt).toBeCloseTo(frame.yPt, 6);
    expect(vector.frame.widthPt).toBeCloseTo(frame.widthPt, 6);
    expect(vector.frame.heightPt).toBeCloseTo(frame.heightPt, 6);
  });

  it("round-trips a rotated shape's geometry within floating-point tolerance", () => {
    const frame = { xPt: 36, yPt: 48, widthPt: 240, heightPt: 80 };
    const written = drawingRoundTrip(
      drawingDocumentOf([
        drawPageOf([], [drawShapeOf({ frame, rotationDeg: 30 })]),
      ]),
    );
    const writtenShape = written.pages[0]!.shapes[0]!;
    expect(writtenShape.rotationDeg).toBeCloseTo(30, 9);
    expect(writtenShape.frame.xPt).toBeCloseTo(frame.xPt, 6);
    expect(writtenShape.frame.yPt).toBeCloseTo(frame.yPt, 6);
    expect(writtenShape.frame.widthPt).toBeCloseTo(frame.widthPt, 6);
    expect(writtenShape.frame.heightPt).toBeCloseTo(frame.heightPt, 6);
  });

  it("holds through the tree form as well as the flat one", () => {
    const document = drawingDocumentOf([
      drawPageOf(
        [
          {
            kind: "rect",
            frame: { xPt: 12, yPt: 12, widthPt: 100, heightPt: 60 },
            fill: SXD_BLUE,
            stroke: { color: SXD_RED, widthPt: 2 },
          },
        ],
        [drawShapeOf()],
      ),
    ]);
    const tree = assembleTree(document);
    const pkg = decodePackage(encodePackage(writeSxd(tree)));
    // See the sxw suite's own identical note above: the round trip alone cannot distinguish genuine OpenOffice.org 1.x output from writeOdg's own plain ODF passed straight through.
    expect(isOoo1Package(pkg)).toBe(true);
    expect(normaliseOdgContent(flattenTree(readSxd(pkg)))).toEqual(
      normaliseOdgContent(document),
    );
    expect(readSxd(pkg).kind).toBe("drawing");
  });
});

describe("writeSxdContent produces genuine OpenOffice.org 1.x XML, not merely something transformOoo1Package tolerates", () => {
  function drawingContentRootOf(pkg: Package): {
    readonly pkg: Package;
    readonly root: ReturnType<typeof rootElement>;
  } {
    const content = pkg.parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("content.xml did not survive as an XML part");
    }
    return { pkg, root: rootElement(content.nodes) };
  }

  function firstDrawPage(pkg: Package): ReturnType<typeof findChildElement> {
    const { root } = drawingContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    return body === undefined
      ? undefined
      : findChildElement(body.children, "draw:page");
  }

  const RECT: ContentVector = {
    kind: "rect",
    frame: { xPt: 36, yPt: 48, widthPt: 120, heightPt: 90 },
    fill: SXD_BLUE,
    stroke: { color: SXD_RED, widthPt: 1.5 },
  };

  it("carries no mimetype part at all", () => {
    const pkg = writeSxdContent(drawingDocumentOf([drawPageOf([RECT])]));
    expect(pkg.parts.mimetype).toBeUndefined();
    expect(readMimetype(pkg)).toBeUndefined();
  });

  it("is itself detected as an OpenOffice.org 1.x package", () => {
    const pkg = writeSxdContent(drawingDocumentOf([drawPageOf([RECT])]));
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("declares the .std template media type in the manifest root entry when template is requested", () => {
    const pkg = writeSxdContent(drawingDocumentOf([drawPageOf([RECT])]), {
      template: true,
    });
    expect(
      readManifest(pkg).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.sun.xml.draw.template");
  });

  it("declares the OpenOffice.org 1.x namespace URIs and office:class='drawing'", () => {
    const { root } = drawingContentRootOf(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
    );
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    expect(attrValue(root, "xmlns:office")).toBe(
      "http://openoffice.org/2000/office",
    );
    // The trap this format shares with OASIS ODF: the drawing namespace is ".../drawing", never ".../draw" (see ./ns.ts).
    expect(attrValue(root, "xmlns:draw")).toBe(
      "http://openoffice.org/2000/drawing",
    );
    expect(attrValue(root, "xmlns:svg")).toBe("http://www.w3.org/2000/svg");
    expect(attrValue(root, "office:class")).toBe("drawing");
  });

  it("puts office:body's content directly inside it, with no office:drawing genre wrapper", () => {
    const { root } = drawingContentRootOf(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("content.xml has no office:body");
    }
    expect(findChildElement(body.children, "office:drawing")).toBeUndefined();
    expect(findChildElement(body.children, "draw:page")).toBeDefined();
  });

  it("writes a text-in-a-frame shape as a bare draw:text-box, not ODF's draw:frame-wrapped one", () => {
    const page = firstDrawPage(
      writeSxdContent(drawingDocumentOf([drawPageOf([], [drawShapeOf()])])),
    );
    if (page === undefined) {
      throw new Error("content.xml has no draw:page");
    }
    expect(findChildElement(page.children, "draw:frame")).toBeUndefined();
    expect(findChildElement(page.children, "draw:text-box")).toBeDefined();
  });

  it("writes a vector as a bare draw:rect, never wrapped in anything", () => {
    const page = firstDrawPage(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
    );
    if (page === undefined) {
      throw new Error("content.xml has no draw:page");
    }
    expect(findChildElement(page.children, "draw:frame")).toBeUndefined();
    const rectElement = findChildElement(page.children, "draw:rect");
    if (rectElement === undefined) {
      throw new Error("no draw:rect was written");
    }
    expect(attrValue(rectElement, "svg:x")).toBe("36pt");
    expect(attrValue(rectElement, "svg:width")).toBe("120pt");
  });

  // Two independent facts in one assertion, both of which a real consumer needs: the drawing family is spelled "graphics" (ODF's singular "graphic" leaves every fill and stroke silently unbound in LibreOffice), and its properties sit in one bare style:properties rather than ODF's typed style:graphic-properties.
  it("writes a vector's fill and stroke as one bare style:properties on a style:family='graphics' style", () => {
    const { root } = drawingContentRootOf(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
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
    expect(
      childrenWithTag(automaticStyles, "style:style").some(
        (styleElement) => attrValue(styleElement, "style:family") === "graphic",
      ),
    ).toBe(false);
    const graphicStyle = childrenWithTag(automaticStyles, "style:style").find(
      (styleElement) => attrValue(styleElement, "style:family") === "graphics",
    );
    if (graphicStyle === undefined) {
      throw new Error("no graphics style:style was minted");
    }
    const properties = findChildElement(
      graphicStyle.children,
      "style:properties",
    );
    if (properties === undefined) {
      throw new Error("the graphic style carries no bare style:properties");
    }
    expect(
      findChildElement(graphicStyle.children, "style:graphic-properties"),
    ).toBeUndefined();
    expect(attrValue(properties, "draw:fill")).toBe("solid");
    expect(attrValue(properties, "draw:fill-color")).toBe("#0033ff");
  });

  it("writes a path's own subpaths as real svg:d path data against an svg:viewBox", () => {
    const page = firstDrawPage(
      writeSxdContent(
        drawingDocumentOf([
          drawPageOf([
            {
              kind: "path",
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  segments: [{ kind: "line", to: { xPt: 100, yPt: 50 } }],
                  closed: false,
                },
              ],
              stroke: { color: SXD_RED, widthPt: 1 },
            },
          ]),
        ]),
      ),
    );
    const pathElement =
      page === undefined
        ? undefined
        : findChildElement(page.children, "draw:path");
    if (pathElement === undefined) {
      throw new Error("no draw:path was written");
    }
    expect(attrValue(pathElement, "svg:viewBox")).toBe("0 0 100 50");
    expect(attrValue(pathElement, "svg:d")).toBe("M 0,0 L 100,50");
  });
});
