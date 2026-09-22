import { describe, expect, it } from "vitest";

import type { ContentDocument } from "documents.js";

import { contentSummary } from "./contentCounts";

const MARGINS = { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 };
const PAGE_SIZE = { widthPt: 595, heightPt: 842 };

function wordprocessing(
  sections: number,
  blocksPerSection: number,
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: Array.from({ length: sections }, () => ({
      pageSize: PAGE_SIZE,
      margins: MARGINS,
      blocks: Array.from({ length: blocksPerSection }, () => ({
        kind: "paragraph",
        runs: [{ text: "x" }],
      })),
    })),
  };
}

const SHAPE_INSETS = {
  insetLeftPt: 0,
  insetTopPt: 0,
  insetRightPt: 0,
  insetBottomPt: 0,
};

function presentation(slides: number, shapesPerSlide: number): ContentDocument {
  return {
    kind: "presentation",
    metadata: {},
    slides: Array.from({ length: slides }, () => ({
      size: PAGE_SIZE,
      notes: "",
      shapes: Array.from({ length: shapesPerSlide }, () => ({
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        ...SHAPE_INSETS,
        blocks: [],
      })),
    })),
  };
}

function drawing(
  pages: number,
  shapesPerPage: number,
  vectorsPerPage: number,
): ContentDocument {
  return {
    kind: "drawing",
    metadata: {},
    pages: Array.from({ length: pages }, () => ({
      size: PAGE_SIZE,
      shapes: Array.from({ length: shapesPerPage }, () => ({
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        ...SHAPE_INSETS,
        blocks: [],
      })),
      vectors: Array.from({ length: vectorsPerPage }, () => ({
        kind: "rect" as const,
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      })),
    })),
  };
}

function spreadsheet(sheets: number, cellsPerSheet: number): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: Array.from({ length: sheets }, (_, i) => ({
      name: `Sheet${i}`,
      cells: Array.from({ length: cellsPerSheet }, (_, j) => ({
        row: j,
        column: 0,
        value: { kind: "string", value: "x" },
        displayText: "x",
      })),
      columns: [],
      rows: [],
      images: [],
      printSettings: {
        pageSize: PAGE_SIZE,
        margins: MARGINS,
        gridlines: false,
        headers: false,
        pageOrder: "downThenOver",
      },
    })),
  };
}

describe("contentSummary", () => {
  it("summarises a wordprocessing document with section and block counts", () => {
    expect(contentSummary(wordprocessing(3, 10))).toEqual([
      "3 sections",
      "30 blocks",
    ]);
  });

  it("uses the singular form for a count of one", () => {
    expect(contentSummary(wordprocessing(1, 1))).toEqual([
      "1 section",
      "1 block",
    ]);
  });

  it("counts blocks inside table cells, not just the table itself", () => {
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE,
          margins: MARGINS,
          blocks: [
            { kind: "paragraph", runs: [{ text: "intro" }] },
            {
              kind: "table",
              rows: [
                {
                  cells: [
                    {
                      blocks: [
                        { kind: "paragraph", runs: [{ text: "a" }] },
                        { kind: "paragraph", runs: [{ text: "b" }] },
                      ],
                    },
                    { blocks: [{ kind: "paragraph", runs: [{ text: "c" }] }] },
                  ],
                },
              ],
              columns: [{ widthPt: 100 }, { widthPt: 100 }],
            },
          ],
        },
      ],
    };
    // 1 intro paragraph + 1 table + 3 paragraphs inside cells = 5 blocks total (table counts as 1, plus its 3 nested).
    expect(contentSummary(doc)).toEqual(["1 section", "5 blocks"]);
  });

  it("counts a merged region's blocks once, since its covered entries hold none", () => {
    const doc: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE,
          margins: MARGINS,
          blocks: [
            {
              kind: "table",
              rows: [
                {
                  cells: [
                    {
                      colSpan: 2,
                      rowSpan: 2,
                      blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }],
                    },
                    { blocks: [] },
                  ],
                },
                { cells: [{ blocks: [] }, { blocks: [] }] },
              ],
              columns: [{ widthPt: 100 }, { widthPt: 100 }],
            },
          ],
        },
      ],
    };
    // 1 table + the anchor's 1 paragraph; the 3 covered entries add nothing.
    expect(contentSummary(doc)).toEqual(["1 section", "2 blocks"]);
  });

  it("summarises a spreadsheet with sheet and cell counts", () => {
    expect(contentSummary(spreadsheet(2, 50))).toEqual([
      "2 sheets",
      "100 cells",
    ]);
  });

  it("uses the singular form for a spreadsheet with exactly one sheet and one cell", () => {
    expect(contentSummary(spreadsheet(1, 1))).toEqual(["1 sheet", "1 cell"]);
  });

  it("summarises a presentation with slide and shape counts", () => {
    expect(contentSummary(presentation(4, 3))).toEqual([
      "4 slides",
      "12 shapes",
    ]);
  });

  it("uses the singular form for a presentation with exactly one slide and one shape", () => {
    expect(contentSummary(presentation(1, 1))).toEqual(["1 slide", "1 shape"]);
  });

  it("summarises a drawing with page, shape, and vector counts", () => {
    expect(contentSummary(drawing(2, 3, 5))).toEqual([
      "2 pages",
      "6 shapes",
      "10 vectors",
    ]);
  });

  it("uses the singular form for a drawing with exactly one page, one shape, and one vector", () => {
    expect(contentSummary(drawing(1, 1, 1))).toEqual([
      "1 page",
      "1 shape",
      "1 vector",
    ]);
  });

  it("summarises a formula document", () => {
    const doc: ContentDocument = {
      kind: "formula",
      metadata: {},
      formula: { mathml: [] },
    };
    expect(contentSummary(doc)).toEqual(["formula"]);
  });
});
