import { describe, expect, it } from "vitest";
import { COLOR_BLACK } from "./color";
import {
  type ContentBlock,
  type ContentDocument,
  ContentDocumentSchema,
  type ContentTable,
  isContentBlock,
} from "./content";
import { IMAGE_FORMATS } from "./content-vocabulary";
import {} from "./content-sheet";

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
        {
          blocks: [image],
          colSpan: 2,
          background: { kind: "solid", color: COLOR_BLACK },
        },
      ],
    },
    { cells: [{ blocks: [pageBreak] }], heightPt: 20 },
  ],
  columns: [{ widthPt: 150 }, { widthPt: 150 }],
};

// Deliberately deep nesting: a table whose cell contains a table whose cell contains a table — the highest-risk case for the hand-written recursive isContentBlock guard. Typed as ContentTable (not the broader ContentBlock union) at each level so the nested `.rows`/`.cells` access below needs no narrowing or assertion.
const level3Table: ContentTable = {
  kind: "table",
  rows: [{ cells: [{ blocks: [paragraph] }] }],
  columns: [{ widthPt: 100 }],
};
const level2Table: ContentTable = {
  kind: "table",
  rows: [{ cells: [{ blocks: [level3Table, paragraph] }] }],
  columns: [{ widthPt: 200 }],
};
const level1Table: ContentTable = {
  kind: "table",
  rows: [{ cells: [{ blocks: [level2Table] }] }],
  columns: [{ widthPt: 300 }],
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
    // Confirm the full depth is really there and each level individually validates — not just the outermost shell.
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

  it("accepts every IMAGE_FORMATS member — the guard and the schema enum read one shared tuple and cannot diverge", () => {
    // gif/svg were guard-rejected while the enum admitted them (ExaDev/documents.js#1197); the shared IMAGE_FORMATS tuple is what prevents that drift from coming back, and this pins the guard's side of it.
    for (const format of IMAGE_FORMATS) {
      expect(
        isContentBlock({
          kind: "image",
          format,
          base64: "AA==",
          widthPt: 1,
          heightPt: 1,
        }),
      ).toBe(true);
    }
  });

  it("rejects a malformed block at every level", () => {
    expect(isContentBlock({ kind: "paragraph", runs: "not-an-array" })).toBe(
      false,
    );
    expect(
      isContentBlock({
        kind: "image",
        format: "tiff",
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
                    columns: [{ widthPt: 10 }],
                  },
                ],
              },
            ],
          },
        ],
        columns: [{ widthPt: 20 }],
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

// The row index of a fixture manual page break, arbitrary beyond sitting past the fixture's own printRange.
const MANUAL_BREAK_ROW_INDEX = 20;

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
          { index: 2, hidden: true }, // an entry carrying no declared width at all — "use the application default", not a zero-width column
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
          manualBreaks: { rows: [MANUAL_BREAK_ROW_INDEX], columns: [] },
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

// The two-layer design (src/math.ts's own top comment): the same Pythagoras formula as above, carrying its verbatim LaTeX alongside an equivalent semantic tree, neither derived from the other at rest. An empty mathml array is the LaTeX-authored case — a formula whose source offered no MathML tree keeps the required field while all its meaning lives in the two layers.
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

// The formula ContentDocument kind slots straight into the pre-existing ContentEmbeddedObjectKind 'formula' mechanism — an embedded equation now carries genuine MathML instead of a wordprocessing document standing in for one.
