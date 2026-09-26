import { describe, expect, it } from "vitest";
import type { SourceResidue } from "./source";
import { COLOR_BLACK } from "./color";
import {
  type ContentBlock,
  ContentBlockSchema,
  ContentConstructEndSchema,
  ContentConstructStartSchema,
  type ContentDocument,
  ContentDocumentSchema,
  type ContentEmbeddedObject,
  ContentParagraphSchema,
  type ContentTable,
  isContentBlock,
} from "./content";
import {
  ContentEmbeddedObjectSchema,
  ContentRunSchema,
} from "./content-vocabulary";
import {} from "./content-sheet";
import { ContentShapeSchema } from "./content-drawing";

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
      columns: [{ widthPt: 100 }],
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

// Deliberately deep nesting for ContentEmbeddedObjectSchema's own recursive guard, mirroring the discipline already applied to ContentTable's three-level recursion test above: a formula embedded inside a drawing embedded inside a spreadsheet, three levels deep, exercising both anchoring mechanisms (ContentSheetSchema.embeddedObjects at level 1->2, and the ContentBlock 'embeddedObject' variant at level 2->3) in the same structure. The innermost document is a genuine 'formula'-kind ContentDocument (reusing the fixture above), so this also drives the recursion down through the real, self-recursive MathMlNodeSchema (src/mathml.ts), not only through the block model.

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
      columns: [{ widthPt: 100 }],
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
        images: sheet.images.map((sheetImage) => ({
          ...sheetImage,
          source: odfResidue,
        })),
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

  it("keeps the construct boundary markers bare — a smuggled source is not part of either marker's shape", () => {
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
