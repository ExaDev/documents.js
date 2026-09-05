import { describe, expect, it } from "vitest";
import { COLOR_BLACK } from "./color";
import {
  type ContentBlock,
  ContentBlockSchema,
  ContentCellBordersSchema,
  ContentConstructEndSchema,
  ContentConstructStartSchema,
  type ContentDocument,
  ContentDocumentSchema,
  type ContentEmbeddedObject,
  ContentEmbeddedObjectSchema,
  ContentImageBlockSchema,
  ContentParagraphSchema,
  ContentRunSchema,
  ContentSectionSchema,
  ContentShapeSchema,
  ContentSheetCellSchema,
  ContentSheetColumnSchema,
  ContentSheetRowSchema,
  type ContentTable,
  ContentTableCellSchema,
  ContentTableRowSchema,
  clampHeadingLevel,
  findConstructMarkerImbalance,
  findRunConstructFault,
  isContentBlock,
  isContentConstructEnd,
  isContentConstructStart,
  isRunConstructExtent,
  type RunConstructExtent,
} from "./content";
import type { ConstructDescriptor } from "./construct";
import { assembleTree } from "./factor-styles";
import { flattenTree } from "./flatten";
import { LayoutFrameSchema } from "./geometry";
import { LayoutMetadataSchema } from "./metadata";
import type { SourceResidue } from "./source";

const paragraph: ContentBlock = {
  kind: "paragraph",
  runs: [
    { text: "Hello " },
    {
      text: "world",
      bold: true,
      italic: true,
      color: { r: 0.2, g: 0.4, b: 0.6 },
    },
  ],
  styleId: "Heading1",
  alignment: "center",
  spacingBeforePt: 12,
  spacingAfterPt: 6,
};

const listParagraph: ContentBlock = {
  kind: "paragraph",
  runs: [{ text: "Item one" }],
  list: { numId: "1", level: 0 },
};

const image: ContentBlock = {
  kind: "image",
  format: "png",
  base64: "AA==",
  widthPt: 100,
  heightPt: 50,
  altText: "a placeholder image",
};

const pageBreak: ContentBlock = { kind: "pageBreak" };

const table: ContentBlock = {
  kind: "table",
  rows: [
    {
      cells: [
        { blocks: [paragraph] },
        { blocks: [image], colSpan: 2, background: COLOR_BLACK },
      ],
    },
    { cells: [{ blocks: [pageBreak] }], heightPt: 20 },
  ],
  columnWidthsPt: [150, 150],
};

// Deliberately deep nesting: a table whose cell contains a table whose cell contains a table -- the highest-risk case for the hand-written recursive isContentBlock guard. Typed as ContentTable (not the broader ContentBlock union) at each level so the nested `.rows`/`.cells` access below needs no narrowing or assertion.
const level3Table: ContentTable = {
  kind: "table",
  rows: [{ cells: [{ blocks: [paragraph] }] }],
  columnWidthsPt: [100],
};
const level2Table: ContentTable = {
  kind: "table",
  rows: [{ cells: [{ blocks: [level3Table, paragraph] }] }],
  columnWidthsPt: [200],
};
const level1Table: ContentTable = {
  kind: "table",
  rows: [{ cells: [{ blocks: [level2Table] }] }],
  columnWidthsPt: [300],
};

describe("isContentBlock", () => {
  it("accepts every block kind", () => {
    for (const block of [
      paragraph,
      listParagraph,
      image,
      pageBreak,
      table,
      level1Table,
    ]) {
      expect(isContentBlock(block)).toBe(true);
    }
  });

  it("accepts a table nested three levels deep inside table cells, and the guard genuinely walks every level", () => {
    expect(isContentBlock(level1Table)).toBe(true);
    // Confirm the full depth is really there and each level individually validates -- not just the outermost shell.
    const level2 = level1Table.rows[0]?.cells[0]?.blocks[0];
    if (level2?.kind !== "table") {
      throw new Error("expected level2 to be a table");
    }
    expect(isContentBlock(level2)).toBe(true);
    const level3 = level2.rows[0]?.cells[0]?.blocks[0];
    if (level3?.kind !== "table") {
      throw new Error("expected level3 to be a table");
    }
    expect(isContentBlock(level3)).toBe(true);
  });

  it("rejects a malformed block at every level", () => {
    expect(isContentBlock({ kind: "paragraph", runs: "not-an-array" })).toBe(
      false,
    );
    expect(
      isContentBlock({
        kind: "image",
        format: "gif",
        base64: "AA==",
        widthPt: 1,
        heightPt: 1,
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "table",
        rows: [{ cells: [{ blocks: [{ kind: "bogus" }] }] }],
      }),
    ).toBe(false);
    // A malformed block buried three levels deep must still fail the guard, not be silently accepted.
    expect(
      isContentBlock({
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [
                  {
                    kind: "table",
                    rows: [
                      {
                        cells: [
                          {
                            blocks: [
                              { kind: "paragraph", runs: [{ text: 1 }] },
                            ],
                          },
                        ],
                      },
                    ],
                    columnWidthsPt: [10],
                  },
                ],
              },
            ],
          },
        ],
        columnWidthsPt: [20],
      }),
    ).toBe(false);
    expect(isContentBlock(null)).toBe(false);
    expect(isContentBlock("a string")).toBe(false);
    expect(isContentBlock(undefined)).toBe(false);
  });
});

function wordprocessingDocument(): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {
      title: "Deep nesting test",
      author: "documents.js",
      keywords: ["schema", "content-model"],
      createdIso: "2026-07-30T00:00:00.000Z",
    },
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          paragraph,
          listParagraph,
          image,
          pageBreak,
          table,
          level1Table,
        ],
      },
    ],
  };
}

function presentationDocument(): ContentDocument {
  return {
    kind: "presentation",
    metadata: { title: "Deck" },
    slides: [
      {
        size: { widthPt: 960, heightPt: 540 },
        shapes: [
          {
            name: "Title 1",
            frame: { xPt: 10, yPt: 10, widthPt: 400, heightPt: 100 },
            rotationDeg: 15,
            insetLeftPt: 7.2,
            insetTopPt: 3.6,
            insetRightPt: 7.2,
            insetBottomPt: 3.6,
            fontScale: 0.9,
            lineSpacingReduction: 0.1,
            blocks: [paragraph],
          },
          {
            frame: { xPt: 0, yPt: 150, widthPt: 300, heightPt: 200 },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
            blocks: [table],
          },
        ],
        notes: "Speaker notes for slide one.",
      },
    ],
  };
}

function spreadsheetDocument(): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: { title: "Quarterly figures" },
    sheets: [
      {
        name: "Sheet1",
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "string", value: "Revenue" },
            displayText: "Revenue",
          },
          {
            row: 0,
            column: 1,
            value: { kind: "currency", value: 125000, currency: "USD" },
            formula: "=SUM(B2:B10)",
            displayText: "$125,000.00",
            comment: {
              text: "Excludes the late Q4 bookings.",
              author: "Joseph Mearman",
              createdAt: "2026-08-17T09:30:00Z",
              replies: [
                {
                  text: "Confirmed against the ledger.",
                  author: "Robin Achebe",
                },
              ],
            },
          },
          {
            row: 1,
            column: 1,
            value: { kind: "percentage", value: 0.235 },
            displayText: "23.5%",
          },
          {
            row: 2,
            column: 1,
            value: { kind: "boolean", value: true },
            displayText: "TRUE",
          },
          {
            row: 3,
            column: 1,
            value: { kind: "date", value: "2026-07-30" },
            displayText: "30/07/2026",
          },
          {
            row: 4,
            column: 1,
            value: { kind: "time", value: "13:30:00" },
            displayText: "1:30 PM",
          },
          {
            row: 5,
            column: 1,
            value: { kind: "dateTime", value: "2026-07-30T13:30:00" },
            displayText: "30/07/2026 1:30 PM",
          },
          {
            row: 6,
            column: 1,
            value: { kind: "error", value: "#DIV/0!" },
            displayText: "#DIV/0!",
          },
          {
            row: 7,
            column: 1,
            value: { kind: "empty" },
            displayText: "",
            colSpan: 2,
          },
          {
            row: 8,
            column: 0,
            value: { kind: "string", value: "Mixed formatting" },
            displayText: "Mixed formatting",
            runs: [{ text: "Mixed " }, { text: "formatting", bold: true }],
          },
        ],
        columns: [
          { index: 0, widthPt: 120 },
          { index: 1, widthPt: 80, hidden: false },
          { index: 2, hidden: true }, // an entry carrying no declared width at all -- "use the application default", not a zero-width column
        ],
        rows: [
          { index: 0, heightPt: 15 },
          { index: 1, heightPt: 15, hidden: true },
          { index: 2 },
        ],
        images: [
          {
            kind: "image",
            format: "png",
            base64: "AA==",
            widthPt: 40,
            heightPt: 40,
            anchorRow: 0,
            anchorColumn: 3,
            offsetXPt: 2,
            offsetYPt: 2,
          },
        ],
        printSettings: {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          printRange: { startRow: 0, startColumn: 0, endRow: 10, endColumn: 5 },
          scalePercent: 100,
          fitToPages: { width: 1, height: 1 },
          repeatRows: { start: 0, end: 0 },
          repeatColumns: { start: 0, end: 0 },
          gridlines: true,
          headers: false,
          pageOrder: "downThenOver",
          manualBreaks: { rows: [20], columns: [] },
        },
      },
    ],
  };
}

function drawingDocument(): ContentDocument {
  return {
    kind: "drawing",
    metadata: { title: "Org chart" },
    pages: [
      {
        size: { widthPt: 842, heightPt: 595 },
        shapes: [
          {
            frame: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 60 },
            insetLeftPt: 3.6,
            insetTopPt: 3.6,
            insetRightPt: 3.6,
            insetBottomPt: 3.6,
            blocks: [paragraph],
          },
        ],
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 60 },
            fill: { r: 0.9, g: 0.9, b: 1 },
            stroke: { color: COLOR_BLACK, widthPt: 1 },
          },
          {
            kind: "ellipse",
            frame: { xPt: 300, yPt: 50, widthPt: 100, heightPt: 100 },
            fill: { r: 1, g: 1, b: 0.8 },
          },
          {
            kind: "line",
            from: { xPt: 250, yPt: 80 },
            to: { xPt: 300, yPt: 100 },
            stroke: { color: COLOR_BLACK, widthPt: 2 },
          },
          {
            kind: "path",
            frame: { xPt: 400, yPt: 200, widthPt: 100, heightPt: 100 },
            subpaths: [
              {
                start: { xPt: 0, yPt: 0 },
                segments: [
                  { kind: "line", to: { xPt: 100, yPt: 0 } },
                  {
                    kind: "cubic",
                    control1: { xPt: 100, yPt: 50 },
                    control2: { xPt: 50, yPt: 100 },
                    to: { xPt: 0, yPt: 100 },
                  },
                ],
                closed: true,
              },
            ],
            fill: { r: 0.2, g: 0.8, b: 0.2 },
            fillRule: "nonzero",
            stroke: { color: COLOR_BLACK, widthPt: 0.5 },
          },
        ],
      },
    ],
  };
}

// A real MathML tree, in the exact node shape an XML parser hands back: an <?xml?> declaration and a whitespace text node ahead of the <math> root, which is why ContentFormulaSchema.mathml is a node list rather than a single element.
function formulaDocument(): ContentDocument {
  return {
    kind: "formula",
    metadata: { title: "Pythagoras" },
    formula: {
      mathml: [
        {
          type: "declaration",
          attributes: [{ name: "version", value: "1.0" }],
        },
        { type: "text", value: "\n" },
        {
          type: "element",
          tag: "math",
          attributes: [
            { name: "xmlns", value: "http://www.w3.org/1998/Math/MathML" },
          ],
          children: [
            {
              type: "element",
              tag: "msup",
              attributes: [],
              children: [
                {
                  type: "element",
                  tag: "mi",
                  attributes: [],
                  children: [{ type: "text", value: "a" }],
                },
                {
                  type: "element",
                  tag: "mn",
                  attributes: [],
                  children: [{ type: "text", value: "2" }],
                },
              ],
            },
            {
              type: "element",
              tag: "mo",
              attributes: [],
              children: [{ type: "text", value: "+" }],
            },
            { type: "comment", value: " the other leg " },
          ],
        },
      ],
      starMath: "a^2 + b^2 = c^2",
    },
  };
}

describe("ContentDocument formula variant", () => {
  it("accepts a formula document carrying a real MathML node tree", () => {
    expect(ContentDocumentSchema.safeParse(formulaDocument()).success).toBe(
      true,
    );
  });

  it("deep-equals the original formula document after a JSON round trip, at full MathML depth", () => {
    const original = formulaDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it("rejects a malformed MathML node buried inside the tree, not just at the outermost element", () => {
    const malformed: unknown = {
      kind: "formula",
      metadata: {},
      formula: {
        mathml: [
          {
            type: "element",
            tag: "math",
            attributes: [],
            // malformed two levels down: an element's children must be nodes, and a node's `type` must be one of the six known kinds.
            children: [
              {
                type: "element",
                tag: "mi",
                attributes: [],
                children: [{ type: "bogus" }],
              },
            ],
          },
        ],
      },
    };
    expect(ContentDocumentSchema.safeParse(malformed).success).toBe(false);
  });

  it("parses with starMath omitted, since MathML alone is the authoritative content", () => {
    const parsed = ContentDocumentSchema.parse({
      kind: "formula",
      metadata: {},
      formula: {
        mathml: [
          { type: "element", tag: "math", attributes: [], children: [] },
        ],
      },
    });
    if (parsed.kind !== "formula") {
      throw new Error("expected a formula document");
    }
    expect(parsed.formula.starMath).toBeUndefined();
  });
});

// The two-layer design (src/math.ts's own top comment): the same Pythagoras formula as above, carrying its verbatim LaTeX alongside an equivalent semantic tree, neither derived from the other at rest. An empty mathml array is the LaTeX-authored case -- a formula whose source offered no MathML tree keeps the required field while all its meaning lives in the two layers.
function layeredFormulaDocument(): ContentDocument {
  return {
    kind: "formula",
    metadata: { title: "Pythagoras, both layers" },
    formula: {
      mathml: [],
      presentation: { latex: "c = \\sqrt{a^2 + b^2}" },
      content: {
        kind: "app",
        operator: "math:equals",
        args: [
          { kind: "sym", id: "c" },
          {
            kind: "app",
            operator: "math:sqrt",
            args: [
              {
                kind: "app",
                operator: "math:add",
                args: [
                  {
                    kind: "app",
                    operator: "math:pow",
                    args: [
                      { kind: "sym", id: "a" },
                      { kind: "num", numerator: "2", denominator: "1" },
                    ],
                  },
                  {
                    kind: "app",
                    operator: "math:pow",
                    args: [
                      { kind: "sym", id: "b" },
                      { kind: "num", numerator: "2", denominator: "1" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      provenance: {
        source: "lowered:latex",
        editTrail: ["lowered from presentation on ingest"],
      },
    },
  };
}

describe("ContentFormula two-layer model", () => {
  it("carries presentation, content, and provenance alongside the MathML tree", () => {
    const parsed = ContentDocumentSchema.parse(layeredFormulaDocument());
    if (parsed.kind !== "formula") {
      throw new Error("expected a formula document");
    }
    expect(parsed.formula.presentation?.latex).toBe("c = \\sqrt{a^2 + b^2}");
    expect(parsed.formula.content?.kind).toBe("app");
    expect(parsed.formula.provenance?.source).toBe("lowered:latex");
  });

  it("still validates the pre-existing shape with every new layer absent", () => {
    expect(ContentDocumentSchema.safeParse(formulaDocument()).success).toBe(
      true,
    );
  });

  it("rejects a malformed semantic tree rather than degrading it, keeping coverage gaps the job of explicit unparsed nodes", () => {
    const malformed: unknown = {
      ...layeredFormulaDocument(),
      formula: {
        mathml: [],
        presentation: { latex: "x" },
        content: {
          kind: "app",
          operator: "math:divide",
          args: [{ kind: "num", numerator: "1", denominator: "0" }],
        },
      },
    };
    expect(ContentDocumentSchema.safeParse(malformed).success).toBe(false);
  });
});

describe("the document-level symbol table", () => {
  const symbolTable = {
    symbols: [
      { glyph: "a", scope: "document", id: "leg-a", preferredUnit: "si:metre" },
      { glyph: "b", scope: "document", id: "leg-b", preferredUnit: "si:metre" },
    ],
    units: [
      {
        id: "si:metre",
        symbol: "m",
        dimension: { length: 1 },
        factorToSi: { numerator: "1", denominator: "1" },
      },
    ],
  };

  it("is accepted on every one of the five ContentDocument arms", () => {
    for (const document of [
      wordprocessingDocument(),
      presentationDocument(),
      spreadsheetDocument(),
      drawingDocument(),
      formulaDocument(),
    ]) {
      const withTable = { ...document, symbolTable };
      expect(ContentDocumentSchema.safeParse(withTable).success).toBe(true);
    }
  });

  it("parses back off the envelope with its entries intact", () => {
    const parsed = ContentDocumentSchema.parse({
      ...formulaDocument(),
      symbolTable,
    });
    if (parsed.kind !== "formula") {
      throw new Error("expected a formula document");
    }
    expect(parsed.symbolTable?.symbols).toHaveLength(2);
    expect(parsed.symbolTable?.units[0]?.id).toBe("si:metre");
  });

  it("stays absent and optional on documents that carry no math curation", () => {
    const parsed = ContentDocumentSchema.parse(wordprocessingDocument());
    if (parsed.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(parsed.symbolTable).toBeUndefined();
  });
});

// The formula ContentDocument kind slots straight into the pre-existing ContentEmbeddedObjectKind 'formula' mechanism -- an embedded equation now carries genuine MathML instead of a wordprocessing document standing in for one.
describe("an embedded formula object carrying a real formula document", () => {
  it("validates as a ContentBlock and inside a whole document", () => {
    const embedded: ContentBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      document: formulaDocument(),
      frame: { xPt: 10, yPt: 10, widthPt: 80, heightPt: 20 },
    };
    expect(isContentBlock(embedded)).toBe(true);
    expect(
      ContentDocumentSchema.safeParse({
        kind: "wordprocessing",
        metadata: {},
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [embedded],
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("ContentSheetColumn/ContentSheetRow sizes", () => {
  it('accepts an entry with no declared size, meaning "use the application default"', () => {
    expect(ContentSheetColumnSchema.parse({ index: 3 })).toEqual({ index: 3 });
    expect(ContentSheetRowSchema.parse({ index: 3, hidden: true })).toEqual({
      index: 3,
      hidden: true,
    });
  });

  it("rejects an explicit zero size, which previously parsed and was then treated as authoritative", () => {
    expect(
      ContentSheetColumnSchema.safeParse({ index: 0, widthPt: 0 }).success,
    ).toBe(false);
    expect(
      ContentSheetRowSchema.safeParse({ index: 0, heightPt: 0 }).success,
    ).toBe(false);
  });
});

describe("an embedded 'chart' object", () => {
  it("validates with a spreadsheet document carrying the chart's cached series/category model", () => {
    const chart: ContentEmbeddedObject = {
      objectKind: "chart",
      document: {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Chart 1",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: {
              pageSize: { widthPt: 612, heightPt: 792 },
              margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
              gridlines: true,
              headers: false,
              pageOrder: "downThenOver",
            },
          },
        ],
      },
      frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 100 },
    };
    expect(ContentEmbeddedObjectSchema.safeParse(chart).success).toBe(true);
    expect(isContentBlock({ kind: "embeddedObject", ...chart })).toBe(true);
  });
});

describe("sourcePath", () => {
  it("survives a JSON round trip when set on every block kind that carries it", () => {
    const runWithSourcePath: ContentBlock = {
      kind: "paragraph",
      runs: [
        { text: "Traceable", sourcePath: "sections[0].blocks[0].runs[0]" },
      ],
      sourcePath: "sections[0].blocks[0]",
    };
    const imageWithSourcePath: ContentBlock = {
      kind: "image",
      format: "png",
      base64: "AA==",
      widthPt: 100,
      heightPt: 50,
      sourcePath: "sections[0].blocks[1]",
    };
    const pageBreakWithSourcePath: ContentBlock = {
      kind: "pageBreak",
      sourcePath: "sections[0].blocks[2]",
    };
    const tableWithSourcePath: ContentTable = {
      kind: "table",
      rows: [{ cells: [{ blocks: [paragraph] }] }],
      columnWidthsPt: [100],
      sourcePath: "sections[0].blocks[3]",
    };

    for (const block of [
      runWithSourcePath,
      imageWithSourcePath,
      pageBreakWithSourcePath,
      tableWithSourcePath,
    ]) {
      expect(isContentBlock(block)).toBe(true);
      const parsed = ContentBlockSchema.parse(block);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(ContentBlockSchema.parse(roundTripped)).toEqual(block);
    }

    const shapeWithSourcePath = ContentShapeSchema.parse({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [],
      sourcePath: "slides[0].shapes[0]",
    });
    const shapeRoundTripped: unknown = JSON.parse(
      JSON.stringify(shapeWithSourcePath),
    );
    expect(ContentShapeSchema.parse(shapeRoundTripped)).toEqual(
      shapeWithSourcePath,
    );
  });

  it("parses correctly when sourcePath is omitted, matching every other optional field", () => {
    expect(ContentRunSchema.parse({ text: "No path" })).toEqual({
      text: "No path",
    });
    expect(ContentBlockSchema.parse(paragraph)).toEqual(paragraph);
    expect(ContentBlockSchema.parse(pageBreak)).toEqual(pageBreak);
    expect(ContentBlockSchema.parse(table)).toEqual(table);
    const shapeWithoutSourcePath = ContentShapeSchema.parse({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [],
    });
    expect(shapeWithoutSourcePath.sourcePath).toBeUndefined();
  });
});

describe("source (the quarantined residue channel)", () => {
  // One residue value reused across positions, plus a second format spelling, so the tests pin that the field is the SAME facility everywhere rather than per-node lookalikes.
  const docxResidue: SourceResidue = {
    format: "docx",
    xml: '<w:proofErr w:type="spellStart"/>',
  };
  const odfResidue: SourceResidue = {
    format: "odt",
    xml: "<text:filter-name>x</text:filter-name>",
  };

  it("rides on every block leaf kind and on runs, surviving a JSON round trip", () => {
    const paragraphWithResidue: ContentBlock = {
      kind: "paragraph",
      runs: [{ text: "carries residue", source: docxResidue }],
      source: docxResidue,
    };
    const imageWithResidue: ContentBlock = {
      kind: "image",
      format: "png",
      base64: "AA==",
      widthPt: 100,
      heightPt: 50,
      source: docxResidue,
    };
    const pageBreakWithResidue: ContentBlock = {
      kind: "pageBreak",
      source: docxResidue,
    };
    const tableWithResidue: ContentTable = {
      kind: "table",
      rows: [{ cells: [{ blocks: [paragraph], source: docxResidue }] }],
      columnWidthsPt: [100],
      source: docxResidue,
    };
    const embeddedWithResidue: ContentBlock = {
      kind: "embeddedObject",
      objectKind: "drawing",
      document: drawingDocument(),
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      source: docxResidue,
    };

    for (const block of [
      paragraphWithResidue,
      imageWithResidue,
      pageBreakWithResidue,
      tableWithResidue,
      embeddedWithResidue,
    ]) {
      expect(isContentBlock(block)).toBe(true);
      const parsed = ContentBlockSchema.parse(block);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(ContentBlockSchema.parse(roundTripped)).toEqual(block);
    }

    const shapeWithResidue = ContentShapeSchema.parse({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [],
      source: docxResidue,
    });
    expect(shapeWithResidue.source).toEqual(docxResidue);
  });

  it("rides on every container and per-kind node a format reader produces, across all five document kinds", () => {
    const wordprocessingBase = wordprocessingDocument();
    if (wordprocessingBase.kind !== "wordprocessing")
      throw new Error("fixture must be a wordprocessing document");
    const wordprocessing = ContentDocumentSchema.parse({
      ...wordprocessingBase,
      sections: [
        {
          ...wordprocessingBase.sections[0],
          source: docxResidue,
          blocks: [{ kind: "pageBreak", source: docxResidue }],
        },
      ],
    });
    if (wordprocessing.kind !== "wordprocessing")
      throw new Error("parse must return the wordprocessing arm");
    expect(wordprocessing.sections[0]?.source).toEqual(docxResidue);

    const presentationBase = presentationDocument();
    if (presentationBase.kind !== "presentation")
      throw new Error("fixture must be a presentation document");
    const presentation = ContentDocumentSchema.parse({
      ...presentationBase,
      slides: presentationBase.slides.map((slide) => ({
        ...slide,
        source: docxResidue,
      })),
    });
    if (presentation.kind !== "presentation")
      throw new Error("parse must return the presentation arm");
    expect(
      presentation.slides.every((slide) => slide.source !== undefined),
    ).toBe(true);

    const spreadsheetBase = spreadsheetDocument();
    if (spreadsheetBase.kind !== "spreadsheet")
      throw new Error("fixture must be a spreadsheet document");
    const spreadsheet = ContentDocumentSchema.parse({
      ...spreadsheetBase,
      sheets: spreadsheetBase.sheets.map((sheet) => ({
        ...sheet,
        source: odfResidue,
        cells: sheet.cells.map((cell) => ({ ...cell, source: odfResidue })),
        images: sheet.images.map((image) => ({ ...image, source: odfResidue })),
      })),
    });
    if (spreadsheet.kind !== "spreadsheet")
      throw new Error("parse must return the spreadsheet arm");
    expect(spreadsheet.sheets[0]?.source).toEqual(odfResidue);

    const drawingBase = drawingDocument();
    if (drawingBase.kind !== "drawing")
      throw new Error("fixture must be a drawing document");
    const drawing = ContentDocumentSchema.parse({
      ...drawingBase,
      pages: drawingBase.pages.map((page) => ({
        ...page,
        source: odfResidue,
        vectors: page.vectors.map((vector) => ({
          ...vector,
          source: odfResidue,
        })),
      })),
    });
    if (drawing.kind !== "drawing")
      throw new Error("parse must return the drawing arm");
    expect(drawing.pages[0]?.source).toEqual(odfResidue);

    const formulaBase = formulaDocument();
    if (formulaBase.kind !== "formula")
      throw new Error("fixture must be a formula document");
    const formula = ContentDocumentSchema.parse({
      ...formulaBase,
      formula: { ...formulaBase.formula, source: odfResidue },
    });
    if (formula.kind !== "formula")
      throw new Error("parse must return the formula arm");
    expect(formula.formula.source).toEqual(odfResidue);
  });

  it("rides on a standalone embedded object (the sheet-children leaf position)", () => {
    const parsed = ContentEmbeddedObjectSchema.parse({
      ...drawingEmbeddedObject,
      source: docxResidue,
    });
    expect(parsed.source).toEqual(docxResidue);
  });

  it("keeps the construct boundary markers bare -- a smuggled source is not part of either marker's shape", () => {
    // The marker schemas are plain z.objects like every content schema (accept-and-ignore unknown keys), so a source placed on a marker parses to a value WITHOUT it: the marker's own shape is { kind, descriptor } and nothing else, pinned here so the flat form never grows a second residue position beside the descriptor's own.
    const smuggled = ContentConstructStartSchema.parse({
      kind: "constructStart",
      descriptor: { kind: "field", instruction: "PAGE" },
      source: docxResidue,
    });
    expect("source" in smuggled).toBe(false);
    expect(
      ContentConstructEndSchema.parse({
        kind: "constructEnd",
        source: docxResidue,
      }),
    ).toEqual({ kind: "constructEnd" });
  });

  it("is absent by default, matching every other optional per-node field", () => {
    expect(ContentRunSchema.parse({ text: "No residue" })).toEqual({
      text: "No residue",
    });
    expect(
      ContentParagraphSchema.parse({
        kind: "paragraph",
        runs: [{ text: "No residue" }],
      }),
    ).toEqual({ kind: "paragraph", runs: [{ text: "No residue" }] });
  });
});

describe("ContentParagraphSchema headingLevel", () => {
  it("accepts an explicit heading level, independent of styleId", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "A heading" }],
      styleId: "Heading2",
      headingLevel: 2,
    });
    expect(parsed.headingLevel).toBe(2);
    expect(parsed.styleId).toBe("Heading2");
  });

  it("accepts a heading level beyond 6, since the canonical field is not itself clamped (ODF permits ten levels)", () => {
    expect(
      ContentParagraphSchema.parse({
        kind: "paragraph",
        runs: [],
        headingLevel: 9,
      }).headingLevel,
    ).toBe(9);
  });

  it("parses with headingLevel omitted, matching every other optional field", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Body text" }],
    });
    expect(parsed.headingLevel).toBeUndefined();
  });

  it("rejects a zero, negative, or non-integer headingLevel", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        headingLevel: 0,
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        headingLevel: -1,
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        headingLevel: 1.5,
      }).success,
    ).toBe(false);
  });

  it("survives a JSON round trip", () => {
    const original = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Heading" }],
      headingLevel: 3,
    });
    const roundTripped: unknown = JSON.parse(JSON.stringify(original));
    expect(ContentParagraphSchema.parse(roundTripped)).toEqual(original);
  });
});

describe("ContentParagraph pageBreakBefore/pageBreakAfter", () => {
  it("parses both page-break flags, the canonical spelling of a paragraph style that forces a page boundary", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Starts a new page" }],
      pageBreakBefore: true,
      pageBreakAfter: true,
    });
    expect(parsed.pageBreakBefore).toBe(true);
    expect(parsed.pageBreakAfter).toBe(true);
  });

  it("parses with both omitted, matching every other optional field", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Body" }],
    });
    expect(parsed.pageBreakBefore).toBeUndefined();
    expect(parsed.pageBreakAfter).toBeUndefined();
  });

  it("rejects a non-boolean value for either flag", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        pageBreakBefore: "page",
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        pageBreakAfter: 1,
      }).success,
    ).toBe(false);
  });
});

describe("ContentListMembership numId", () => {
  it("parses a level-only membership, the shape a format with depth but no numbering identity produces (OOXML drawing paragraphs carry only a:pPr/@lvl)", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Bullet text" }],
      list: { level: 1 },
    });
    expect(parsed.list).toEqual({ level: 1 });
  });

  it("still parses a numId+level membership, the shape a format with a shared numbering definition produces (docx w:numId, ODF minted identity)", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Item one" }],
      list: { numId: "1", level: 0 },
    });
    expect(parsed.list).toEqual({ numId: "1", level: 0 });
  });

  it("keeps level required, so a membership without one does not parse", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { numId: "1" },
      }).success,
    ).toBe(false);
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: {},
      }).success,
    ).toBe(false);
  });
});

describe("ContentListMembership checked and itemId", () => {
  it("parses a checked membership, the GFM task-list-item state a markdown fence's checkbox carries", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "done" }],
      list: { numId: "md1:bullet+task", level: 0, checked: true },
    });
    expect(parsed.list).toEqual({
      numId: "md1:bullet+task",
      level: 0,
      checked: true,
    });
  });

  it("parses an itemId membership, the identity distinguishing one multi-block list item from several single-block siblings sharing a numId and level", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "second block of one item" }],
      list: { numId: "md1:bullet", level: 0, itemId: "md-i1" },
    });
    expect(parsed.list).toEqual({
      numId: "md1:bullet",
      level: 0,
      itemId: "md-i1",
    });
  });

  it("keeps both fields optional, so a membership carrying neither parses exactly as before", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "Item one" }],
      list: { numId: "1", level: 0 },
    });
    expect(parsed.list).toEqual({ numId: "1", level: 0 });
  });

  it("refuses a checked that is not a boolean, so the checkbox state cannot silently degrade to a truthy string", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { level: 0, checked: "yes" },
      }).success,
    ).toBe(false);
  });

  it("refuses an itemId that is not a string, keeping the item identity an opaque producer-minted key", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { level: 0, itemId: 1 },
      }).success,
    ).toBe(false);
  });

  it("parses a numbering format, distinguishing an ordered list from a bulleted one", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "First" }],
      list: { level: 0, format: "decimal" },
    });
    expect(parsed.list).toEqual({ level: 0, format: "decimal" });
  });

  it("refuses a format outside the closed numbering-format vocabulary", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        list: { level: 0, format: "hebrew" },
      }).success,
    ).toBe(false);
  });
});

describe("ContentRun verticalAlign and direction", () => {
  it("parses a superscript run", () => {
    expect(
      ContentRunSchema.parse({ text: "x", verticalAlign: "superscript" })
        .verticalAlign,
    ).toBe("superscript");
  });

  it("parses a subscript run", () => {
    expect(
      ContentRunSchema.parse({ text: "x", verticalAlign: "subscript" })
        .verticalAlign,
    ).toBe("subscript");
  });

  it("refuses a verticalAlign outside superscript/subscript", () => {
    expect(
      ContentRunSchema.safeParse({ text: "x", verticalAlign: "baseline" })
        .success,
    ).toBe(false);
  });

  it("parses an rtl run, RTF's own \\rtlch scope", () => {
    expect(
      ContentRunSchema.parse({ text: "x", direction: "rtl" }).direction,
    ).toBe("rtl");
  });

  it("keeps both fields optional, so a run carrying neither parses exactly as before", () => {
    const parsed = ContentRunSchema.parse({ text: "plain" });
    expect(parsed.verticalAlign).toBeUndefined();
    expect(parsed.direction).toBeUndefined();
  });
});

describe("ContentParagraph indentRightPt and direction", () => {
  it("parses a right indent alongside the existing left/first-line indents", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      indentLeftPt: 36,
      indentRightPt: 18,
    });
    expect(parsed.indentRightPt).toBe(18);
  });

  it("parses an rtl paragraph, RTF's own \\rtlpar scope", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      direction: "rtl",
    });
    expect(parsed.direction).toBe("rtl");
  });
});

describe("ContentImageBlock format", () => {
  it.each(["png", "jpeg", "svg", "gif"] as const)("accepts %s", (format) => {
    expect(
      ContentImageBlockSchema.parse({
        kind: "image",
        format,
        base64: "",
        widthPt: 10,
        heightPt: 10,
      }).format,
    ).toBe(format);
  });

  it("refuses a format outside the closed vocabulary", () => {
    expect(
      ContentImageBlockSchema.safeParse({
        kind: "image",
        format: "webp",
        base64: "",
        widthPt: 10,
        heightPt: 10,
      }).success,
    ).toBe(false);
  });
});

describe("ContentCellBorders diagonals", () => {
  it("parses diagonalUp and diagonalDown alongside the four sides", () => {
    const border = { color: COLOR_BLACK, widthPt: 1 };
    const parsed = ContentCellBordersSchema.parse({
      diagonalUp: border,
      diagonalDown: border,
    });
    expect(parsed.diagonalUp).toEqual(border);
    expect(parsed.diagonalDown).toEqual(border);
  });
});

describe("ContentTableCell verticalAlign", () => {
  it.each(["top", "center", "bottom"] as const)(
    "accepts %s",
    (verticalAlign) => {
      expect(
        ContentTableCellSchema.parse({ blocks: [], verticalAlign })
          .verticalAlign,
      ).toBe(verticalAlign);
    },
  );
});

describe("ContentTableRow direction", () => {
  it("parses an rtl row, RTF's own \\rtlrow scope", () => {
    expect(
      ContentTableRowSchema.parse({ cells: [], direction: "rtl" }).direction,
    ).toBe("rtl");
  });
});

describe("LayoutMetadata publication and provenance fields", () => {
  it("parses the full set of newly added fields", () => {
    const parsed = LayoutMetadataSchema.parse({
      publisher: "Acme Press",
      contributor: "J. Editor",
      rights: "CC-BY-4.0",
      identifier: "urn:isbn:0000000000",
      comments: "Draft for review",
      lastPrintedIso: "2026-01-01T00:00:00Z",
      company: "Acme Corp",
      manager: "A. Manager",
      direction: "rtl",
    });
    expect(parsed).toMatchObject({
      publisher: "Acme Press",
      contributor: "J. Editor",
      rights: "CC-BY-4.0",
      identifier: "urn:isbn:0000000000",
      comments: "Draft for review",
      lastPrintedIso: "2026-01-01T00:00:00Z",
      company: "Acme Corp",
      manager: "A. Manager",
      direction: "rtl",
    });
  });

  it("keeps every new field optional, so metadata carrying none of them parses exactly as before", () => {
    expect(LayoutMetadataSchema.parse({ title: "Plain" })).toEqual({
      title: "Plain",
    });
  });
});

describe("ContentParagraph codeLanguage", () => {
  it("parses a code-styled paragraph carrying a source-format language identifier, the markdown fence's info word", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "console.log(1);" }],
      styleId: "CodeBlock",
      codeLanguage: "js",
    });
    expect(parsed.codeLanguage).toBe("js");
  });

  it("leaves the field optional, so an ordinary paragraph and a language-less code block parse exactly as before", () => {
    const plain = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "text" }],
    });
    expect("codeLanguage" in plain).toBe(false);
    const bare = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      styleId: "CodeBlock",
    });
    expect("codeLanguage" in bare).toBe(false);
  });

  it("refuses a non-string, so the language word cannot arrive as a structured value this field never promised to hold", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        codeLanguage: { name: "js" },
      }).success,
    ).toBe(false);
  });
});

describe("ContentParagraph preformatted", () => {
  it("parses a paragraph whose whitespace must survive verbatim, independent of codeLanguage", () => {
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "line one\nline two" }],
      preformatted: true,
    });
    expect(parsed.preformatted).toBe(true);
    expect("codeLanguage" in parsed).toBe(false);
  });

  it("leaves the field optional, so an ordinary paragraph parses exactly as before", () => {
    const plain = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [{ text: "text" }],
    });
    expect("preformatted" in plain).toBe(false);
  });

  it("refuses a non-boolean, so the flag cannot arrive as a structured or string value this field never promised to hold", () => {
    expect(
      ContentParagraphSchema.safeParse({
        kind: "paragraph",
        runs: [],
        preformatted: "true",
      }).success,
    ).toBe(false);
  });
});

describe("clampHeadingLevel", () => {
  it("leaves a level already within 1-6 untouched", () => {
    expect(clampHeadingLevel(1)).toBe(1);
    expect(clampHeadingLevel(3)).toBe(3);
    expect(clampHeadingLevel(6)).toBe(6);
  });

  it("clamps a level above 6 down to 6", () => {
    expect(clampHeadingLevel(7)).toBe(6);
    expect(clampHeadingLevel(10)).toBe(6);
    expect(clampHeadingLevel(999)).toBe(6);
  });

  it("clamps a level below 1 up to 1", () => {
    expect(clampHeadingLevel(0)).toBe(1);
    expect(clampHeadingLevel(-5)).toBe(1);
  });

  it("rounds a fractional level to the nearest integer before clamping", () => {
    expect(clampHeadingLevel(2.4)).toBe(2);
    expect(clampHeadingLevel(2.6)).toBe(3);
  });
});

describe("frames (the FusedNode pattern)", () => {
  it("accepts a LayoutFrame array on every content-kind leaf that carries one", () => {
    const frame = {
      pageIndex: 0,
      xPt: 10,
      yPt: 700,
      widthPt: 100,
      heightPt: 12,
    };

    expect(
      ContentRunSchema.parse({ text: "Fused", frames: [frame] }).frames,
    ).toEqual([frame]);
    expect(
      ContentParagraphSchema.parse({
        kind: "paragraph",
        runs: [],
        frames: [frame],
      }).frames,
    ).toEqual([frame]);
    expect(
      ContentBlockSchema.parse({
        kind: "image",
        format: "png",
        base64: "AA==",
        widthPt: 1,
        heightPt: 1,
        frames: [frame],
      }),
    ).toMatchObject({ frames: [frame] });
    expect(
      ContentBlockSchema.parse({ kind: "pageBreak", frames: [frame] }),
    ).toMatchObject({ frames: [frame] });

    const shape = ContentShapeSchema.parse({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [],
      frames: [frame],
    });
    expect(shape.frames).toEqual([frame]);

    const cell = ContentSheetCellSchema.parse({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      frames: [frame],
    });
    expect(cell.frames).toEqual([frame]);
  });

  it("accepts a node with multiple frames -- one node appearing at more than one rendered position", () => {
    const frames = [
      { pageIndex: 0, xPt: 72, yPt: 60, widthPt: 468, heightPt: 24 },
      { pageIndex: 1, xPt: 72, yPt: 720, widthPt: 200, heightPt: 12 },
    ];
    const parsed = ContentParagraphSchema.parse({
      kind: "paragraph",
      runs: [],
      frames,
    });
    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames?.map((f) => f.pageIndex)).toEqual([0, 1]);
  });

  it("parses correctly when frames is omitted, matching every other optional field", () => {
    expect(
      ContentRunSchema.parse({ text: "No frames" }).frames,
    ).toBeUndefined();
  });

  it("rejects a malformed frame (negative pageIndex, missing fields)", () => {
    expect(
      LayoutFrameSchema.safeParse({
        pageIndex: -1,
        xPt: 0,
        yPt: 0,
        widthPt: 1,
        heightPt: 1,
      }).success,
    ).toBe(false);
    expect(
      LayoutFrameSchema.safeParse({ pageIndex: 0, xPt: 0, yPt: 0 }).success,
    ).toBe(false);
    expect(
      ContentRunSchema.safeParse({
        text: "Bad",
        frames: [{ pageIndex: -1, xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("ContentSheetCell comment", () => {
  it("accepts a legacy-style note -- text alone, or with author and createdAt, no replies", () => {
    const bare = ContentSheetCellSchema.parse({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      comment: { text: "Check this figure." },
    });
    expect(bare.comment).toEqual({ text: "Check this figure." });

    const attributed = ContentSheetCellSchema.parse({
      row: 0,
      column: 0,
      value: { kind: "string", value: "x" },
      displayText: "x",
      comment: {
        text: "Check this figure.",
        author: "Robin Achebe",
        createdAt: "2026-08-17T09:30:00Z",
      },
    });
    expect(attributed.comment?.replies).toBeUndefined();
  });

  it("accepts a threaded comment and preserves reply order", () => {
    const parsed = ContentSheetCellSchema.parse({
      row: 3,
      column: 7,
      value: { kind: "number", value: 42 },
      displayText: "42",
      comment: {
        text: "Excludes the late Q4 bookings.",
        author: "Joseph Mearman",
        replies: [
          { text: "Confirmed against the ledger.", author: "Robin Achebe" },
          { text: "Noted.", author: "Joseph Mearman" },
        ],
      },
    });
    expect(parsed.comment?.replies?.map((reply) => reply.text)).toEqual([
      "Confirmed against the ledger.",
      "Noted.",
    ]);
  });

  it("parses correctly when comment is omitted, matching every other optional field", () => {
    expect(
      ContentSheetCellSchema.parse({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
      }).comment,
    ).toBeUndefined();
  });

  it("rejects a comment with no text, and a reply with no text", () => {
    expect(
      ContentSheetCellSchema.safeParse({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
        comment: { author: "Robin Achebe" },
      }).success,
    ).toBe(false);
    expect(
      ContentSheetCellSchema.safeParse({
        row: 0,
        column: 0,
        value: { kind: "empty" },
        displayText: "",
        comment: { text: "Root", replies: [{ author: "Robin Achebe" }] },
      }).success,
    ).toBe(false);
  });
});

describe("ContentDocumentSchema round trips", () => {
  it("deep-equals the original wordprocessing document after a JSON round trip", () => {
    const original = wordprocessingDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it("deep-equals the original presentation document after a JSON round trip", () => {
    const original = presentationDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it("deep-equals the original spreadsheet document after a JSON round trip", () => {
    const original = spreadsheetDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it("deep-equals the original drawing document after a JSON round trip", () => {
    const original = drawingDocument();
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it("rejects an unknown discriminant", () => {
    expect(ContentDocumentSchema.safeParse({ kind: "bogus" }).success).toBe(
      false,
    );
  });
});

// Deliberately deep nesting for ContentEmbeddedObjectSchema's own recursive guard, mirroring the discipline already applied to ContentTable's three-level recursion test above: a formula embedded inside a drawing embedded inside a spreadsheet, three levels deep, exercising both anchoring mechanisms (ContentSheetSchema.embeddedObjects at level 1->2, and the ContentBlock 'embeddedObject' variant at level 2->3) in the same structure. The innermost document is a genuine 'formula'-kind ContentDocument (reusing the fixture above), so this also drives the recursion down through the real, self-recursive MathMlNodeSchema (src/mathml.ts), not only through the block model.
const formulaEmbeddedBlock: ContentBlock = {
  kind: "embeddedObject",
  objectKind: "formula",
  document: formulaDocument(),
  frame: { xPt: 10, yPt: 10, widthPt: 80, heightPt: 20 },
};

const drawingWithFormula: ContentDocument = {
  kind: "drawing",
  metadata: {},
  pages: [
    {
      size: { widthPt: 400, heightPt: 300 },
      shapes: [
        {
          frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [formulaEmbeddedBlock],
        },
      ],
      vectors: [],
    },
  ],
};

const drawingEmbeddedObject: ContentEmbeddedObject = {
  objectKind: "drawing",
  document: drawingWithFormula,
  frame: { xPt: 100, yPt: 100, widthPt: 200, heightPt: 150 },
};

const spreadsheetWithDrawing: ContentDocument = {
  kind: "spreadsheet",
  metadata: {},
  sheets: [
    {
      name: "Sheet1",
      cells: [],
      columns: [],
      rows: [],
      images: [],
      printSettings: {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
        gridlines: true,
        headers: true,
        pageOrder: "downThenOver",
      },
      embeddedObjects: [drawingEmbeddedObject],
    },
  ],
};

describe("ContentEmbeddedObjectSchema deep recursion", () => {
  it("accepts a formula embedded inside a drawing embedded inside a spreadsheet, three levels deep", () => {
    expect(isContentBlock(formulaEmbeddedBlock)).toBe(true);
    expect(
      ContentDocumentSchema.safeParse(spreadsheetWithDrawing).success,
    ).toBe(true);
  });

  it("genuinely walks every level, not just the outermost shell", () => {
    const parsed = ContentDocumentSchema.parse(spreadsheetWithDrawing);
    if (parsed.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet document");
    }
    const sheet = parsed.sheets[0];
    if (sheet === undefined) {
      throw new Error("expected a sheet");
    }
    const embeddedDrawing = sheet.embeddedObjects?.[0];
    if (embeddedDrawing?.document.kind !== "drawing") {
      throw new Error(
        "expected the level-2 embedded object to be a drawing document",
      );
    }
    const page = embeddedDrawing.document.pages[0];
    if (page === undefined) {
      throw new Error("expected a drawing page");
    }
    const shape = page.shapes[0];
    if (shape === undefined) {
      throw new Error("expected a shape");
    }
    const embeddedFormulaBlock = shape.blocks[0];
    if (embeddedFormulaBlock?.kind !== "embeddedObject") {
      throw new Error("expected the level-3 block to be an embedded object");
    }
    expect(embeddedFormulaBlock.objectKind).toBe("formula");
    if (embeddedFormulaBlock.document.kind !== "formula") {
      throw new Error(
        "expected the level-3 embedded document to be a formula document",
      );
    }
    expect(embeddedFormulaBlock.document.formula.starMath).toBe(
      "a^2 + b^2 = c^2",
    );
    const mathRoot = embeddedFormulaBlock.document.formula.mathml[2];
    if (mathRoot?.type !== "element") {
      throw new Error(
        "expected the third MathML node to be the <math> element",
      );
    }
    expect(mathRoot.tag).toBe("math");
    expect(mathRoot.children[0]?.type).toBe("element");
  });

  it("survives a JSON round trip at full depth", () => {
    const parsed = ContentDocumentSchema.parse(spreadsheetWithDrawing);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(
      spreadsheetWithDrawing,
    );
  });

  it("accepts a sheet-anchored embedded object carrying anchorRow/anchorColumn/offsetXPt/offsetYPt", () => {
    const cellAnchoredEmbeddedObject: ContentEmbeddedObject = {
      ...drawingEmbeddedObject,
      anchorRow: 3,
      anchorColumn: 1,
      offsetXPt: 4.5,
      offsetYPt: -2,
    };
    const sheetWithAnchoredObject: ContentDocument = {
      ...spreadsheetWithDrawing,
      sheets: [
        {
          ...spreadsheetWithDrawing.sheets[0]!,
          embeddedObjects: [cellAnchoredEmbeddedObject],
        },
      ],
    };
    const parsed = ContentDocumentSchema.parse(sheetWithAnchoredObject);
    if (parsed.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet document");
    }
    const embedded = parsed.sheets[0]?.embeddedObjects?.[0];
    expect(embedded?.anchorRow).toBe(3);
    expect(embedded?.anchorColumn).toBe(1);
    expect(embedded?.offsetXPt).toBe(4.5);
    expect(embedded?.offsetYPt).toBe(-2);
  });

  it("still accepts an embedded object with no cell-anchor fields at all (a wordprocessing/presentation/drawing context, which never sets them)", () => {
    expect(drawingEmbeddedObject.anchorRow).toBeUndefined();
    expect(
      ContentEmbeddedObjectSchema.safeParse(drawingEmbeddedObject).success,
    ).toBe(true);
  });

  // 'chart' is the one kind whose payload is not a whole document of the same name -- a chart has no ContentDocument variant -- so its document is whatever data projection the producing codec could express and its chart-specific serialisation rides the residue channel. The schema's own job here is only to admit the member; what a chart's document holds is the producing codec's verdict, pinned in that codec's own suite rather than here.
  it("accepts objectKind 'chart', the one member with no same-named ContentDocument variant", () => {
    const chartEmbeddedObject: ContentEmbeddedObject = {
      objectKind: "chart",
      document: { kind: "wordprocessing", metadata: {}, sections: [] },
      frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 120 },
      source: { format: "ods", xml: '<chart:chart chart:class="bar"/>' },
    };
    expect(
      ContentEmbeddedObjectSchema.safeParse(chartEmbeddedObject).success,
    ).toBe(true);
    const parsed = ContentEmbeddedObjectSchema.parse(chartEmbeddedObject);
    expect(parsed.objectKind).toBe("chart");
  });

  it("rejects a negative or non-integer anchorRow/anchorColumn", () => {
    expect(
      ContentEmbeddedObjectSchema.safeParse({
        ...drawingEmbeddedObject,
        anchorRow: -1,
      }).success,
    ).toBe(false);
    expect(
      ContentEmbeddedObjectSchema.safeParse({
        ...drawingEmbeddedObject,
        anchorColumn: 1.5,
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed embedded object buried three levels deep, not just at the outermost shell", () => {
    const deeplyMalformed: unknown = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
            gridlines: true,
            headers: true,
            pageOrder: "downThenOver",
          },
          embeddedObjects: [
            {
              objectKind: "drawing",
              frame: { xPt: 100, yPt: 100, widthPt: 200, heightPt: 150 },
              document: {
                kind: "drawing",
                metadata: {},
                pages: [
                  {
                    size: { widthPt: 400, heightPt: 300 },
                    vectors: [],
                    shapes: [
                      {
                        frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 },
                        insetLeftPt: 0,
                        insetTopPt: 0,
                        insetRightPt: 0,
                        insetBottomPt: 0,
                        blocks: [
                          {
                            kind: "embeddedObject",
                            objectKind: "formula",
                            frame: {
                              xPt: 10,
                              yPt: 10,
                              widthPt: 80,
                              heightPt: 20,
                            },
                            document: {
                              kind: "formula",
                              metadata: {},
                              formula: {
                                mathml: [
                                  {
                                    type: "element",
                                    tag: "math",
                                    attributes: [],
                                    // malformed: an element's own attributes must each be a {name, value} string pair -- must still fail even though every ancestor around it is well-formed.
                                    children: [
                                      {
                                        type: "element",
                                        tag: "mi",
                                        attributes: [{ name: "a" }],
                                        children: [],
                                      },
                                    ],
                                  },
                                ],
                              },
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(ContentDocumentSchema.safeParse(deeplyMalformed).success).toBe(
      false,
    );
  });
});

// -- Construct boundary markers (the flat form's encoding of a fidelity construct) --
//
// Every construct region below is spelled as a real one from the codec inventories the descriptor vocabulary was built from, so these read as the shapes a codec will actually emit rather than as synthetic bracket exercises.

function constructStart(descriptor: ConstructDescriptor): ContentBlock {
  return { kind: "constructStart", descriptor };
}

const constructEnd: ContentBlock = { kind: "constructEnd" };

// A tracked insertion inside a docx content control, with a footnote anchor beside it -- one region nested inside another, which is the case a pairing key would have existed to handle and bracket matching handles for free.
const nestedConstructBlocks: ContentBlock[] = [
  constructStart({
    kind: "contentControl",
    controlType: "richText",
    tag: "ClientBlock",
    lock: "container",
  }),
  { kind: "paragraph", runs: [{ text: "Before the tracked change." }] },
  constructStart({
    kind: "provenance",
    change: "insertion",
    author: "A. Reviewer",
    dateIso: "2026-08-18T09:00:00Z",
  }),
  { kind: "paragraph", runs: [{ text: "Inserted sentence." }] },
  constructEnd,
  constructStart({
    kind: "anchor",
    anchorType: "footnote",
    name: "1",
    definition: "n1",
  }),
  constructEnd,
  constructEnd,
];

describe("construct boundary markers", () => {
  it("accepts an open marker carrying each of the six descriptor kinds", () => {
    const descriptors: ConstructDescriptor[] = [
      { kind: "contentControl", controlType: "checkbox", checked: true },
      { kind: "field", instruction: "PAGE \\* MERGEFORMAT", cachedResult: "3" },
      { kind: "anchor", anchorType: "bookmark", name: "intro" },
      {
        kind: "link",
        target: { kind: "internal", anchor: "intro" },
        title: "Back to the introduction",
      },
      { kind: "provenance", change: "deletion", author: "A. Reviewer" },
      {
        kind: "division",
        name: "Chapter 1",
        columnCount: 2,
        linked: { href: "chapter-1.odt" },
      },
    ];
    for (const descriptor of descriptors) {
      const marker = constructStart(descriptor);
      expect(ContentConstructStartSchema.safeParse(marker).success).toBe(true);
      expect(isContentConstructStart(marker)).toBe(true);
      expect(isContentBlock(marker)).toBe(true);
    }
  });

  it("accepts a close marker whose kind is its whole payload", () => {
    expect(ContentConstructEndSchema.safeParse(constructEnd).success).toBe(
      true,
    );
    expect(isContentConstructEnd(constructEnd)).toBe(true);
    expect(isContentBlock(constructEnd)).toBe(true);
  });

  it("rejects an open marker with no descriptor, a malformed one, or a descriptor kind the vocabulary does not carry", () => {
    expect(isContentBlock({ kind: "constructStart" })).toBe(false);
    expect(
      isContentBlock({
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote" },
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "constructStart",
        descriptor: { kind: "residue", xml: "<w:custom/>" },
      }),
    ).toBe(false);
    expect(isContentConstructStart({ kind: "constructEnd" })).toBe(false);
    expect(
      isContentConstructEnd({
        kind: "constructStart",
        descriptor: { kind: "field", instruction: "PAGE" },
      }),
    ).toBe(false);
  });

  it("carries no position of its own: a frames array smuggled onto a marker does not survive a parse", () => {
    const parsed = ContentConstructEndSchema.parse({
      kind: "constructEnd",
      frames: [{ pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
    });
    expect(parsed).toStrictEqual({ kind: "constructEnd" });
  });

  it("nests inside a wordprocessing document and deep-equals itself after a JSON round trip", () => {
    const original: ContentDocument = {
      kind: "wordprocessing",
      metadata: { title: "Constructs" },
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: nestedConstructBlocks,
        },
      ],
    };
    const parsed = ContentDocumentSchema.parse(original);
    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
    expect(ContentDocumentSchema.parse(roundTripped)).toEqual(original);
  });

  it("brackets a region inside a table cell, the only place a construct inside a table is expressible", () => {
    const cellTable: ContentBlock = {
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                constructStart({
                  kind: "field",
                  instruction: "DOCPROPERTY Title",
                }),
                { kind: "paragraph", runs: [{ text: "Constructs" }] },
                constructEnd,
              ],
            },
          ],
        },
      ],
      columnWidthsPt: [200],
    };
    expect(isContentBlock(cellTable)).toBe(true);
    expect(ContentBlockSchema.safeParse(cellTable).success).toBe(true);
  });

  // Pins a deliberate schema-level gap: an unmatched constructEnd is malformed input by the bracket-matching contract above, but ContentDocumentSchema carries no refinement that rejects it. findConstructMarkerImbalance (tested below) is the one place balance is actually checked -- decompose calls it and throws on what this schema accepts. A Zod-only refinement here would validate against a rule the published content-document.schema.json fragment cannot express (JSON Schema has no way to state "these array members pair up"), so adding one would silently diverge from that published face -- the exact guard-versus-published-face misalignment the TreeBlockLeaf JSON Schema fragment exists to avoid on the tree side. This test exists so a future change reintroducing balance as a Zod refinement fails it rather than sliding in unnoticed.
  it("parses a section whose blocks carry an unmatched constructEnd -- balance belongs to findConstructMarkerImbalance, not the schema", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "No open marker precedes this close." }],
      },
      constructEnd,
    ];
    const unbalanced: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    };
    expect(ContentDocumentSchema.safeParse(unbalanced).success).toBe(true);
    expect(findConstructMarkerImbalance(blocks)).toStrictEqual({
      kind: "unmatchedEnd",
      index: 1,
    });
  });
});

describe("findConstructMarkerImbalance", () => {
  it("finds nothing in a balanced list, however deeply the regions nest", () => {
    expect(findConstructMarkerImbalance(nestedConstructBlocks)).toBeUndefined();
  });

  it("finds nothing in a list with no markers at all, empty or otherwise", () => {
    expect(findConstructMarkerImbalance([])).toBeUndefined();
    expect(
      findConstructMarkerImbalance([paragraph, image, pageBreak]),
    ).toBeUndefined();
  });

  it("finds nothing across two sibling regions that open and close in turn", () => {
    expect(
      findConstructMarkerImbalance([
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "a" }),
        constructEnd,
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "b" }),
        constructEnd,
      ]),
    ).toBeUndefined();
  });

  it("reports the close that had nothing open, at its own index", () => {
    expect(
      findConstructMarkerImbalance([paragraph, constructEnd]),
    ).toStrictEqual({ kind: "unmatchedEnd", index: 1 });
    expect(
      findConstructMarkerImbalance([
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "a" }),
        constructEnd,
        constructEnd,
      ]),
    ).toStrictEqual({ kind: "unmatchedEnd", index: 2 });
  });

  it("reports the outermost still-open start, not the innermost, when the list ends mid-region", () => {
    expect(
      findConstructMarkerImbalance([
        constructStart({ kind: "division", name: "Chapter 1" }),
        constructStart({ kind: "provenance", change: "insertion" }),
        { kind: "paragraph", runs: [{ text: "Never closed." }] },
        constructEnd,
      ]),
    ).toStrictEqual({ kind: "unclosedStart", index: 0 });
  });

  it("reports the earlier fault when a list is unbalanced in both directions", () => {
    expect(
      findConstructMarkerImbalance([
        constructEnd,
        constructStart({ kind: "anchor", anchorType: "bookmark", name: "a" }),
      ]),
    ).toStrictEqual({ kind: "unmatchedEnd", index: 0 });
  });
});

// -- Run-level construct extents (the flat form's encoding of a construct whose extent is a sub-sequence of one paragraph's runs) --

// A mid-paragraph bookmark over the middle two runs of four, a point anchor between runs, and a field over the paragraph's tail -- the three shapes the run-level mechanism exists for, each spelled as the descriptor-plus-half-open-run-range entry ContentParagraph.constructs carries.
const runExtentParagraph: ContentBlock = {
  kind: "paragraph",
  runs: [
    { text: "before " },
    { text: "marked " },
    { text: "words" },
    { text: " after" },
  ],
  constructs: [
    {
      descriptor: { kind: "anchor", anchorType: "bookmark", name: "midway" },
      startRun: 1,
      endRun: 3,
    },
    {
      descriptor: {
        kind: "anchor",
        anchorType: "footnote",
        name: "1",
        definition: "n1",
      },
      startRun: 3,
      endRun: 3,
    },
  ],
};

describe("run-level construct extents", () => {
  it("parses a paragraph carrying construct extents and deep-equals itself after a JSON round trip", () => {
    const parsed = ContentParagraphSchema.parse(runExtentParagraph);
    expect(parsed).toEqual(runExtentParagraph);
    expect(
      ContentParagraphSchema.parse(JSON.parse(JSON.stringify(parsed))),
    ).toEqual(runExtentParagraph);
  });

  it("accepts each of the six descriptor kinds inside a run extent", () => {
    const descriptors: ConstructDescriptor[] = [
      { kind: "contentControl", controlType: "plainText", tag: "name" },
      { kind: "field", instruction: "PAGE", cachedResult: "3" },
      { kind: "anchor", anchorType: "bookmark", name: "intro" },
      {
        kind: "link",
        target: { kind: "external", uri: "https://example.invalid/" },
      },
      { kind: "provenance", change: "insertion", author: "A. Reviewer" },
      { kind: "division", name: "Chapter 1" },
    ];
    for (const descriptor of descriptors) {
      const extent: RunConstructExtent = { descriptor, startRun: 0, endRun: 1 };
      expect(isRunConstructExtent(extent)).toBe(true);
      expect(
        isContentBlock({
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [extent],
        }),
      ).toBe(true);
    }
  });

  it("lets two extents cross freely -- ranges, not brackets, have no nesting constraint", () => {
    const crossing: ContentBlock = {
      kind: "paragraph",
      runs: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "first" },
          startRun: 0,
          endRun: 3,
        },
        {
          descriptor: {
            kind: "anchor",
            anchorType: "bookmark",
            name: "second",
          },
          startRun: 1,
          endRun: 4,
        },
      ],
    };
    expect(ContentParagraphSchema.parse(crossing)).toEqual(crossing);
    expect(findRunConstructFault(crossing)).toBeUndefined();
  });

  it("rejects, through the block guard, an extent entry with no descriptor, a malformed one, or non-integer bounds", () => {
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [],
        constructs: [{ startRun: 0, endRun: 0 }],
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [{ text: "x" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote" },
            startRun: 0,
            endRun: 1,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isContentBlock({
        kind: "paragraph",
        runs: [{ text: "x" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "bookmark", name: "a" },
            startRun: 0.5,
            endRun: 1,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isRunConstructExtent({
        descriptor: { kind: "residue", xml: "<w:custom/>" },
        startRun: 0,
        endRun: 0,
      }),
    ).toBe(false);
  });

  // The run-level twin of the marker-imbalance gap test above: an inverted or out-of-range run range is malformed by the extent contract, but ContentParagraphSchema carries no refinement that rejects it -- a Zod refinement would validate against a rule the published content-document.schema.json fragment cannot express (the range bound is the paragraph's own runs.length, not a fact any single object states), so it would silently diverge from that published face. findRunConstructFault (tested below) is the one place range validity is checked; this test exists so a future change reintroducing it as a Zod refinement fails rather than sliding in unnoticed.
  it("parses an inverted and an out-of-range extent -- range validity belongs to findRunConstructFault, not the schema", () => {
    const inverted: ContentBlock = {
      kind: "paragraph",
      runs: [{ text: "x" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "a" },
          startRun: 2,
          endRun: 1,
        },
      ],
    };
    expect(ContentParagraphSchema.safeParse(inverted).success).toBe(true);
    expect(findRunConstructFault(inverted)).toStrictEqual({
      kind: "invertedRange",
      index: 0,
    });
  });
});

describe("findRunConstructFault", () => {
  it("finds nothing in a paragraph with no constructs field or an empty one", () => {
    expect(
      findRunConstructFault({ kind: "paragraph", runs: [{ text: "x" }] }),
    ).toBeUndefined();
    expect(
      findRunConstructFault({ kind: "paragraph", runs: [], constructs: [] }),
    ).toBeUndefined();
  });

  it("accepts a point extent, one covering the whole run list, and several extents at once", () => {
    expect(findRunConstructFault(runExtentParagraph)).toBeUndefined();
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }, { text: "b" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "whole",
            },
            startRun: 0,
            endRun: 2,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("reports an end preceding its start, at the entry's own index", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "fine",
            },
            startRun: 0,
            endRun: 1,
          },
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "inverted",
            },
            startRun: 1,
            endRun: 0,
          },
        ],
      }),
    ).toStrictEqual({ kind: "invertedRange", index: 1 });
  });

  it("reports an end beyond the paragraph's runs, at the entry's own index", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "beyond",
            },
            startRun: 0,
            endRun: 2,
          },
        ],
      }),
    ).toStrictEqual({ kind: "beyondRuns", index: 0 });
  });

  it("reports a negative bound as beyond the runs it must name", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "negative",
            },
            startRun: -1,
            endRun: 1,
          },
        ],
      }),
    ).toStrictEqual({ kind: "beyondRuns", index: 0 });
  });

  it("reports the earlier fault when a paragraph carries both kinds at once", () => {
    expect(
      findRunConstructFault({
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "beyond",
            },
            startRun: 0,
            endRun: 5,
          },
          {
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "inverted",
            },
            startRun: 1,
            endRun: 0,
          },
        ],
      }),
    ).toStrictEqual({ kind: "beyondRuns", index: 0 });
  });
});

describe("ContentSection.breakType (the section-break kind)", () => {
  it("accepts each break kind a section can begin with, and rejects anything else", () => {
    for (const breakType of [
      "nextPage",
      "continuous",
      "evenPage",
      "oddPage",
    ] as const) {
      expect(
        ContentSectionSchema.parse({
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
          breakType,
        }),
      ).toMatchObject({ breakType });
    }
    expect(() =>
      ContentSectionSchema.parse({
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [],
        breakType: "column",
      }),
    ).toThrow();
  });

  it("stays optional, so a section spelling no break kind parses exactly as before", () => {
    const section = ContentSectionSchema.parse({
      pageSize: { widthPt: 612, heightPt: 792 },
      margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
      blocks: [],
    });
    expect(section).not.toHaveProperty("breakType");
  });

  it("rides the package boundary untouched, since the section descriptor is built by omit+extend", () => {
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
          breakType: "continuous",
        },
      ],
    };
    const flat = flattenTree(assembleTree(content));
    expect(flat).toMatchObject({
      kind: "wordprocessing",
      sections: [{ breakType: "continuous" }],
    });
  });
});
