import type {
  ContentBlock,
  ContentDocument,
  ContentEmbeddedObject,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { latexToFormula } from "../latex/lower";
import {
  buildFormulaBlock,
  collectDocumentFormulas,
  formulaDocument,
  formulaOfBlock,
} from "./formula";

// collectDocumentFormulas is the shared walk latex/lint.ts's lintMathCoherence and document-mcp's compute_formula tool both consume (ExaDev/documents.js#928's round-1 review) -- these tests exercise every ContentDocument arm directly against hand-built content, the same way src/latex/lint.test.ts already exercises table-cell recursion, rather than round-tripping through a format writer. That is a deliberate choice, not a shortcut: no writer in this package (docx/odt/pptx/odp/odg) carries a formula embeddedObject block through a table cell or a drawing page's own shape yet (each cell/shape writer's own appendCellBlock/appendShape silently skips a non-paragraph/non-image block), so a real byte-level document exercising those two arms does not exist to build. The presentation-slide-shape and spreadsheet arms DO have a real writer (buildPptxPackage's appendShape, OdsSheet.addEmbeddedObject), and are covered end-to-end through real bytes in document-mcp's own compute-formula.test.ts instead.

const FRAME = { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 };

// ContentSheetSchema's own images/printSettings fields are required (unlike embeddedObjects, which is optional), so every hand-built ContentSheet literal below spreads this rather than restating the boilerplate each time. `as const` sits on printSettings alone, not the whole object: ContentSheet.images is a mutable array type, and a top-level `as const` would infer `images` as `readonly []`, which does not structurally satisfy it.
const SHEET_DEFAULTS = {
  images: [],
  printSettings: {
    pageSize: { widthPt: 595, heightPt: 842 },
    margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
    gridlines: true,
    headers: true,
    pageOrder: "downThenOver",
  } as const,
};

function formulaBlock(latex: string) {
  return buildFormulaBlock(
    latexToFormula(latex, { source: "test:formula" }).formula,
    FRAME,
    "test:formula",
  );
}

describe("formulaOfBlock", () => {
  it("narrows a bare ContentEmbeddedObject (no kind/sourcePath), not just the block-level wrapper", () => {
    // A spreadsheet's cell-anchored embedded objects are exactly this shape: ContentEmbeddedObject, never wrapped in a ContentEmbeddedObjectBlock. formulaOfBlock reads only `.document`, a field the base interface already carries, so this must narrow correctly with no block wrapper present at all.
    const bareObject: ContentEmbeddedObject = {
      objectKind: "formula",
      document: formulaDocument({ mathml: [] }),
      frame: FRAME,
    };
    expect(formulaOfBlock(bareObject)?.mathml).toEqual([]);
  });

  it("returns undefined for a non-formula document", () => {
    const bareObject: ContentEmbeddedObject = {
      objectKind: "drawing",
      document: { kind: "drawing", metadata: {}, pages: [] },
      frame: FRAME,
    };
    expect(formulaOfBlock(bareObject)).toBeUndefined();
  });
});

describe("collectDocumentFormulas", () => {
  it("walks a wordprocessing section's block flow, including formulas nested inside table cells", () => {
    const topLevel = formulaBlock("1 + 1");
    const nested = formulaBlock("2 + 2");
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
          blocks: [
            {
              kind: "table",
              columnWidthsPt: [100],
              rows: [{ cells: [{ blocks: [nested] }] }],
            } satisfies ContentBlock,
            topLevel,
          ],
        },
      ],
    };
    const entries = collectDocumentFormulas(document);
    expect(entries.map((entry) => entry.formula.presentation?.latex)).toEqual([
      "2 + 2",
      "1 + 1",
    ]);
    expect(entries.map((entry) => entry.sourcePath)).toEqual([
      "test:formula",
      "test:formula",
    ]);
    // Both formulas share the identical sourcePath the fixture helper stamps on every formula -- exactly the shape a real markdown-authored document produces too (a constant sourcePath, or none at all). locate is the field that still tells them apart: derived from container/index position, not from sourcePath, so the nested table-cell formula and its top-level sibling come back with genuinely distinct structural paths.
    expect(entries.map((entry) => entry.locate)).toEqual([
      "sections[0]/blocks[0].rows[0].cells[0]/blocks[0]",
      "sections[0]/blocks[1]",
    ]);
  });

  it("recurses into a non-formula embedded object's own nested document when the top-level block itself is not a formula", () => {
    // document-schema.js's own content.ts comment on ContentEmbeddedObject names this exact shape: "a formula embedded inside a drawing embedded inside a spreadsheet". This test covers the wordprocessing block-flow arm's half of that recursion -- a drawing embedded directly in a section's own blocks, carrying a formula one level further in.
    const nestedFormula = formulaBlock("a^2 + b^2 = c^2");
    const drawingBlock: ContentBlock = {
      kind: "embeddedObject",
      objectKind: "drawing",
      document: {
        kind: "drawing",
        metadata: {},
        pages: [
          {
            size: { widthPt: 720, heightPt: 540 },
            shapes: [
              {
                frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 40 },
                insetLeftPt: 0,
                insetTopPt: 0,
                insetRightPt: 0,
                insetBottomPt: 0,
                blocks: [nestedFormula],
              },
            ],
            vectors: [],
          },
        ],
      },
      frame: FRAME,
    };
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
          blocks: [drawingBlock],
        },
      ],
    };
    const entries = collectDocumentFormulas(document);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.formula.presentation?.latex).toBe("a^2 + b^2 = c^2");
    expect(entries[0]?.locate).toBe(
      "sections[0]/blocks[0]/pages[0].shapes[0]/blocks[0]",
    );
  });

  it("walks a presentation slide's shapes", () => {
    const document: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          notes: "",
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 40 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [formulaBlock("m \\times a")],
            },
          ],
        },
      ],
    };
    const entries = collectDocumentFormulas(document);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.formula.presentation?.latex).toBe("m \\times a");
  });

  it("walks a drawing page's shapes", () => {
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 40 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [formulaBlock("x^2")],
            },
          ],
          vectors: [],
        },
      ],
    };
    const entries = collectDocumentFormulas(document);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.formula.presentation?.latex).toBe("x^2");
  });

  it("walks a spreadsheet's cell-anchored embeddedObjects array -- the exact case ExaDev/documents.js#928's round-1 review found silently unwalked (formulaCount: 0 on a real .ods)", () => {
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          ...SHEET_DEFAULTS,
          embeddedObjects: [
            {
              objectKind: "formula",
              document: formulaDocument(
                latexToFormula("f(x) = x^2", { source: "test:formula" })
                  .formula,
              ),
              frame: FRAME,
              anchorRow: 3,
              anchorColumn: 2,
            },
          ],
        },
      ],
    };
    const entries = collectDocumentFormulas(document);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.formula.presentation?.latex).toBe("f(x) = x^2");
    // ContentEmbeddedObject (the spreadsheet shape) carries no sourcePath field at all -- structurally, not merely because none was assigned.
    expect(entries[0]?.sourcePath).toBeUndefined();
    // locate is derived from sheet/object position, not from sourcePath -- so a spreadsheet's formulas are still individually locatable even though this arm never has a sourcePath to fall back on.
    expect(entries[0]?.locate).toBe("sheets[0].embeddedObjects[0]");
  });

  it("skips a spreadsheet's non-formula embedded objects that carry no formula of their own, but still recurses into their nested document", () => {
    // A drawing embedded object is not itself a formula, but ContentEmbeddedObject.document is unconditionally a whole ContentDocument -- an EMPTY nested document (pages: []) would pass this assertion whether or not the walk actually recurses, so it pins nothing about the recursion this test exists to cover. A real formula nested inside the drawing's own shape is the only way to prove the walk reaches it.
    const nestedFormula = formulaBlock("y = mx + b");
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          ...SHEET_DEFAULTS,
          embeddedObjects: [
            {
              objectKind: "drawing",
              document: {
                kind: "drawing",
                metadata: {},
                pages: [
                  {
                    size: { widthPt: 720, heightPt: 540 },
                    shapes: [
                      {
                        frame: {
                          xPt: 0,
                          yPt: 0,
                          widthPt: 200,
                          heightPt: 40,
                        },
                        insetLeftPt: 0,
                        insetTopPt: 0,
                        insetRightPt: 0,
                        insetBottomPt: 0,
                        blocks: [nestedFormula],
                      },
                    ],
                    vectors: [],
                  },
                ],
              },
              frame: FRAME,
            },
          ],
        },
      ],
    };
    const entries = collectDocumentFormulas(document);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.formula.presentation?.latex).toBe("y = mx + b");
    // The nested walk's own locate (relative to the drawing document's root) rides after the embedding object's own locate, so the full path names both the spreadsheet-level embedding position and the formula's position inside the nested drawing.
    expect(entries[0]?.locate).toBe(
      "sheets[0].embeddedObjects[0]/pages[0].shapes[0]/blocks[0]",
    );
  });

  it("recurses through a wordprocessing document embedded inside a spreadsheet's own embeddedObjects array -- the shape a real LibreOffice .ods embedding a Writer document containing an equation produces", () => {
    const nestedFormula = formulaBlock("E = mc^2");
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [],
          columns: [],
          rows: [],
          ...SHEET_DEFAULTS,
          embeddedObjects: [
            {
              objectKind: "wordprocessing",
              document: {
                kind: "wordprocessing",
                metadata: {},
                sections: [
                  {
                    pageSize: { widthPt: 595, heightPt: 842 },
                    margins: {
                      topPt: 20,
                      rightPt: 20,
                      bottomPt: 20,
                      leftPt: 20,
                    },
                    blocks: [nestedFormula],
                  },
                ],
              },
              frame: FRAME,
            },
          ],
        },
      ],
    };
    const entries = collectDocumentFormulas(document);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.formula.presentation?.latex).toBe("E = mc^2");
    expect(entries[0]?.locate).toBe(
      "sheets[0].embeddedObjects[0]/sections[0]/blocks[0]",
    );
  });

  it("returns a sheet with no embeddedObjects array at all as an empty result, not a crash", () => {
    const document: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        { name: "Sheet1", cells: [], columns: [], rows: [], ...SHEET_DEFAULTS },
      ],
    };
    expect(collectDocumentFormulas(document)).toEqual([]);
  });

  it("treats the standalone 'formula' document kind as its own single entry, with no sourcePath (no embedding block exists at all)", () => {
    const formula = latexToFormula("2 + 3", { source: "test:formula" }).formula;
    const document = formulaDocument(formula);
    const entries = collectDocumentFormulas(document);
    expect(entries).toEqual([
      { formula, sourcePath: undefined, locate: "formula" },
    ]);
  });

  it("returns an empty array for a document with no formulas anywhere", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
          blocks: [{ kind: "paragraph", runs: [{ text: "No math here." }] }],
        },
      ],
    };
    expect(collectDocumentFormulas(document)).toEqual([]);
  });

  it("throws rather than silently returning an empty list for an unrecognised ContentDocument kind", () => {
    const bogus = { kind: "bogus" } as unknown as ContentDocument;
    expect(() => collectDocumentFormulas(bogus)).toThrow(/bogus/);
  });
});
