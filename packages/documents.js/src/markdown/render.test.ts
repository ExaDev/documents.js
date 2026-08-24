import type {
  ContentBlock,
  ContentDocument,
  ContentDrawPage,
  ContentEmbeddedObject,
  ContentRun,
  ContentShape,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
  ContentSlide,
  ContentVector,
  LayoutMetadata,
  MathMlNode,
} from "document-schema.js";

import { describe, expect, it } from "vitest";
import { richMarkdownText } from "../test-support/markdown";
import type { MarkdownRenderDiagnostic } from "./render";
import {
  renderContentDocumentToMarkdown,
  MarkdownRenderDiagnosticCodes,
} from "./render";
import { buildMarkdownText } from "./write";
import { readMarkdownContent } from "./read";

const RED = { r: 1, g: 0, b: 0 };

// Mirrors the fake-fixture conventions of src/layout/slides.test.ts, src/layout/sheets.test.ts, and src/layout/drawing.test.ts: hand-built ContentDocuments with no dependency on any reader, so a bug in a reader cannot hide behind a fixture that same reader produced.
function paragraph(runs: readonly ContentRun[]): ContentBlock {
  return { kind: "paragraph", runs: [...runs] };
}

function shape(blocks: readonly ContentBlock[]): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [...blocks],
  };
}

function slide(blocks: readonly ContentBlock[], notes = ""): ContentSlide {
  return {
    size: { widthPt: 960, heightPt: 540 },
    shapes: [shape(blocks)],
    notes,
  };
}

function presentationDoc(
  slides: readonly ContentSlide[],
  metadata: LayoutMetadata = {},
): Extract<ContentDocument, { kind: "presentation" }> {
  return { kind: "presentation", metadata, slides: [...slides] };
}

function drawPage(
  shapes: readonly ContentShape[],
  vectors: readonly ContentVector[] = [],
): ContentDrawPage {
  return {
    size: { widthPt: 400, heightPt: 300 },
    shapes: [...shapes],
    vectors: [...vectors],
  };
}

function drawingDoc(
  pages: readonly ContentDrawPage[],
): Extract<ContentDocument, { kind: "drawing" }> {
  return { kind: "drawing", metadata: {}, pages: [...pages] };
}

const PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: { widthPt: 600, heightPt: 800 },
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function cell(
  row: number,
  column: number,
  displayText: string,
  overrides: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return {
    row,
    column,
    value: { kind: "string", value: displayText },
    displayText,
    ...overrides,
  };
}

function sheet(
  cells: readonly ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name: "Sheet1",
    cells: [...cells],
    columns: [],
    rows: [],
    images: [],
    printSettings: PRINT_SETTINGS,
    ...overrides,
  };
}

function spreadsheetDoc(
  sheets: readonly ContentSheet[],
): Extract<ContentDocument, { kind: "spreadsheet" }> {
  return { kind: "spreadsheet", metadata: {}, sheets: [...sheets] };
}

const MI_X: MathMlNode[] = [
  {
    type: "element",
    tag: "mi",
    attributes: [],
    children: [{ type: "text", value: "x" }],
  },
];

function formulaDocument(): Extract<ContentDocument, { kind: "formula" }> {
  return { kind: "formula", metadata: {}, formula: { mathml: MI_X } };
}

function anchoredFormulaObject(): ContentEmbeddedObject {
  return {
    objectKind: "formula",
    document: formulaDocument(),
    frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 24 },
    anchorRow: 0,
    anchorColumn: 1,
    offsetXPt: 0,
    offsetYPt: 0,
  };
}

function collect(): {
  diagnostics: MarkdownRenderDiagnostic[];
  onDiagnostic: (diagnostic: MarkdownRenderDiagnostic) => void;
} {
  const diagnostics: MarkdownRenderDiagnostic[] = [];
  return {
    diagnostics,
    onDiagnostic: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  };
}

describe("MarkdownRenderDiagnosticCodes", () => {
  it("pins all eight namespaced degrade codes this module can report, so a rename is a test failure rather than a silent wire-format change for diagnostic-filtering callers", () => {
    expect(Object.values(MarkdownRenderDiagnosticCodes)).toEqual([
      "markdown-render/presentation-slide-as-heading",
      "markdown-render/presentation-notes-dropped",
      "markdown-render/spreadsheet-sheet-as-table",
      "markdown-render/spreadsheet-hidden-cells-dropped",
      "markdown-render/spreadsheet-anchored-content-dropped",
      "markdown-render/drawing-page-as-heading",
      "markdown-render/drawing-vectors-dropped",
      "markdown-render/formula-as-placeholder",
    ]);
  });
});

describe("renderContentDocumentToMarkdown", () => {
  it("delegates a wordprocessing document straight to buildMarkdownText, byte-identically, and reports no degrade diagnostics -- there is nothing to degrade on that path", () => {
    const content = readMarkdownContent(richMarkdownText());
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(content, { onDiagnostic });
    expect(text).toBe(buildMarkdownText(content));
    expect(diagnostics).toEqual([]);
  });

  it("renders each slide under its own level-2 heading in slide order, keeping shape text in array order, and drops only non-empty speaker notes", () => {
    const document = presentationDoc([
      slide([paragraph([{ text: "Quarterly review" }])], "Remember the demo."),
      slide([paragraph([{ text: "Roadmap" }])]),
    ]);
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(document, { onDiagnostic });
    expect(text).toBe(
      "## Slide 1\n\nQuarterly review\n\n## Slide 2\n\nRoadmap",
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      MarkdownRenderDiagnosticCodes.PRESENTATION_SLIDE_AS_HEADING,
      MarkdownRenderDiagnosticCodes.PRESENTATION_NOTES_DROPPED,
      MarkdownRenderDiagnosticCodes.PRESENTATION_SLIDE_AS_HEADING,
    ]);
  });

  it("renders a sheet as one GFM table under a level-2 heading of its own name: the first visible row is the header, per-cell runs win over displayText, and cell alignment drives the delimiter row", () => {
    const document = spreadsheetDoc([
      sheet(
        [
          cell(0, 0, "Item", { alignment: "center" }),
          cell(0, 1, "Cost"),
          cell(1, 0, "Total display text ignored in favour of runs", {
            runs: [{ text: "Coffee", bold: true }],
          }),
          cell(1, 1, "350"),
          cell(1, 2, "Tax"),
        ],
        {
          name: "Budget",
          columns: [
            { index: 0, widthPt: 60 },
            { index: 1, widthPt: 60 },
            { index: 2, widthPt: 60 },
          ],
        },
      ),
    ]);
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(document, { onDiagnostic });
    expect(text).toBe(
      "## Budget\n\n| Item | Cost |  |\n| :---: | --- | --- |\n| **Coffee** | 350 | Tax |",
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      MarkdownRenderDiagnosticCodes.SPREADSHEET_SHEET_AS_TABLE,
    ]);
    // The reported shape counts VISIBLE rows x visible columns (the absent header cell at column 2 widens the table to three columns), not populated cells.
    expect(diagnostics[0]?.message).toContain("2x3");
  });

  it("excludes hidden rows and columns from the table entirely, reporting them once, and never emits the hidden cells' text", () => {
    const document = spreadsheetDoc([
      sheet(
        [
          cell(0, 0, "A"),
          cell(0, 1, "HiddenC"),
          cell(0, 2, "B"),
          cell(1, 0, "HiddenR"),
          cell(2, 0, "C"),
          cell(2, 2, "D"),
        ],
        {
          columns: [
            { index: 0, widthPt: 50 },
            { index: 1, widthPt: 9999, hidden: true },
            { index: 2, widthPt: 50 },
          ],
          rows: [
            { index: 0, heightPt: 10 },
            { index: 1, heightPt: 10, hidden: true },
            { index: 2, heightPt: 10 },
          ],
        },
      ),
    ]);
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(document, { onDiagnostic });
    expect(text).toBe("## Sheet1\n\n| A | B |\n| --- | --- |\n| C | D |");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      MarkdownRenderDiagnosticCodes.SPREADSHEET_HIDDEN_CELLS_DROPPED,
      MarkdownRenderDiagnosticCodes.SPREADSHEET_SHEET_AS_TABLE,
    ]);
    expect(diagnostics[0]?.message).toContain("1 row(s) and 1 column(s)");
  });

  it("reports anchored images and embedded objects on a sheet as dropped, while the cells still render", () => {
    const document = spreadsheetDoc([
      sheet([cell(0, 0, "A")], {
        images: [
          {
            kind: "image",
            format: "png",
            base64: "aGk=",
            widthPt: 10,
            heightPt: 10,
            anchorRow: 0,
            anchorColumn: 1,
            offsetXPt: 0,
            offsetYPt: 0,
          },
        ],
        embeddedObjects: [anchoredFormulaObject()],
      }),
    ]);
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(document, { onDiagnostic });
    expect(text).toContain("| A |");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      MarkdownRenderDiagnosticCodes.SPREADSHEET_SHEET_AS_TABLE,
      MarkdownRenderDiagnosticCodes.SPREADSHEET_ANCHORED_CONTENT_DROPPED,
    ]);
    expect(diagnostics[1]?.severity).toBe("warning");
    expect(diagnostics[1]?.message).toContain(
      "1 anchored image(s) and 1 embedded object(s)",
    );
  });

  it("renders a sheet with no cells at all as an explicit empty placeholder rather than an empty section, and reports no sheet-as-table diagnostic for it", () => {
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(spreadsheetDoc([sheet([])]), {
      onDiagnostic,
    });
    // The underscores survive markdown-codec's own escaping (a literal _ renders as \_), so the emitted source carries the backslashes and reads as _(empty sheet)_ once parsed.
    expect(text).toBe("## Sheet1\n\n\\_(empty sheet)\\_");
    expect(diagnostics).toEqual([]);
  });

  it("renders each drawing page under its own level-2 heading, keeping text-carrying shapes in shape order, and reports dropped vector primitives once per page that carries them", () => {
    const rect: ContentVector = {
      kind: "rect",
      frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 },
      fill: RED,
    };
    const document = drawingDoc([
      drawPage([shape([paragraph([{ text: "A label" }])])], [rect]),
      drawPage([]),
    ]);
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(document, { onDiagnostic });
    expect(text).toBe("## Page 1\n\nA label\n\n## Page 2");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      MarkdownRenderDiagnosticCodes.DRAWING_PAGE_AS_HEADING,
      MarkdownRenderDiagnosticCodes.DRAWING_VECTORS_DROPPED,
      MarkdownRenderDiagnosticCodes.DRAWING_PAGE_AS_HEADING,
    ]);
    expect(diagnostics[1]?.severity).toBe("warning");
    expect(diagnostics[1]?.message).toContain("1 vector primitive(s)");
  });

  it("renders a standalone formula document as its own StarMath stand-in text when the source carried one", () => {
    const document: ContentDocument = {
      kind: "formula",
      metadata: {},
      formula: { mathml: MI_X, starMath: "left ( a over b right )" },
    };
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(document, { onDiagnostic });
    expect(text).toBe("left ( a over b right )");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      MarkdownRenderDiagnosticCodes.FORMULA_AS_PLACEHOLDER,
    ]);
    expect(diagnostics[0]?.severity).toBe("warning");
  });

  it("renders a formula carrying no StarMath annotation as the literal marker stand-in, never as nothing", () => {
    const { diagnostics, onDiagnostic } = collect();
    const text = renderContentDocumentToMarkdown(formulaDocument(), {
      onDiagnostic,
    });
    // Bracket characters are markdown-codec-escaped, same as any other literal punctuation.
    expect(text).toBe("\\[formula\\]");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      MarkdownRenderDiagnosticCodes.FORMULA_AS_PLACEHOLDER,
    ]);
  });

  it("makes no diagnostic callback at all when the caller supplies no onDiagnostic -- the default sink is a genuine no-op, not a throw", () => {
    const text = renderContentDocumentToMarkdown(
      presentationDoc([
        slide([paragraph([{ text: "Solo" }])], "notes dropped silently here"),
      ]),
    );
    expect(text).toBe("## Slide 1\n\nSolo");
  });

  it("passes its options through to the underlying markdown writer on the degrade path, not just the wordprocessing passthrough: CRLF line endings reach the emitted text", () => {
    const text = renderContentDocumentToMarkdown(
      spreadsheetDoc([sheet([cell(0, 0, "A"), cell(0, 1, "B")])]),
      { lineEnding: "crlf" },
    );
    expect(text).toContain("\r\n");
    expect(text.split("\r\n").join("")).not.toContain("\n");
  });

  it("passes front matter emission through too: a degraded document with a metadata title gains a front matter block when asked", () => {
    const text = renderContentDocumentToMarkdown(
      presentationDoc([slide([paragraph([{ text: "Solo" }])])], {
        title: "Deck",
      }),
      { frontMatter: true },
    );
    expect(text.startsWith("---\ntitle: Deck\n---\n\n## Slide 1\n\nSolo")).toBe(
      true,
    );
  });

  it("forwards the abort signal into the underlying writer on the degrade path", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      renderContentDocumentToMarkdown(
        presentationDoc([slide([paragraph([{ text: "Solo" }])])]),
        { signal: controller.signal },
      ),
    ).toThrow();
  });
});
