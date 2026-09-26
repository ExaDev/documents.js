import { describe, expect, it } from "vitest";
import { COLOR_BLACK } from "./color";
import {
  type ContentBlock,
  type ContentDocument,
  ContentDocumentSchema,
  type ContentEmbeddedObject,
  type ContentTable,
  isContentBlock,
} from "./content";
import { ContentEmbeddedObjectSchema } from "./content-vocabulary";
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
    const anchorRow = 3;
    const anchorColumn = 1;
    const offsetXPt = 4.5;
    const offsetYPt = -2;
    const cellAnchoredEmbeddedObject: ContentEmbeddedObject = {
      ...drawingEmbeddedObject,
      anchorRow,
      anchorColumn,
      offsetXPt,
      offsetYPt,
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
    expect(embedded?.anchorRow).toBe(anchorRow);
    expect(embedded?.anchorColumn).toBe(anchorColumn);
    expect(embedded?.offsetXPt).toBe(offsetXPt);
    expect(embedded?.offsetYPt).toBe(offsetYPt);
  });

  it("still accepts an embedded object with no cell-anchor fields at all (a wordprocessing/presentation/drawing context, which never sets them)", () => {
    expect(drawingEmbeddedObject.anchorRow).toBeUndefined();
    expect(
      ContentEmbeddedObjectSchema.safeParse(drawingEmbeddedObject).success,
    ).toBe(true);
  });

  // 'chart' is the one kind whose payload is not a whole document of the same name — a chart has no ContentDocument variant — so its document is whatever data projection the producing codec could express and its chart-specific serialisation rides the residue channel. The schema's own job here is only to admit the member; what a chart's document holds is the producing codec's verdict, pinned in that codec's own suite rather than here.
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
                                    // malformed: an element's own attributes must each be a {name, value} string pair — must still fail even though every ancestor around it is well-formed.
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

// — Construct boundary markers (the flat form's encoding of a fidelity construct) --
//
// Every construct region below is spelled as a real one from the codec inventories the descriptor vocabulary was built from, so these read as the shapes a codec will actually emit rather than as synthetic bracket exercises.

// A tracked insertion inside a docx content control, with a footnote anchor beside it — one region nested inside another, which is the case a pairing key would have existed to handle and bracket matching handles for free.
