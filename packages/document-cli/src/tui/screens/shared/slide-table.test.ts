import { createOdp, createPptx, type ContentTable } from "documents.js";
import { describe, expect, it } from "vitest";
import type { OdpOpenDocument, PptxOpenDocument } from "../../state/types.js";
import {
  resolveSlideTable,
  segmentContains,
  segmentText,
  slideTableCellText,
  slideTableRowSegments,
  summarizeSlideTables,
} from "./slide-table";

function pptxWithTable(): PptxOpenDocument {
  const editor = createPptx();
  const slide = editor.addSlide();
  slide.addTable({
    frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 150 },
    table: { rows: 2, columns: 3 },
  });
  return { format: "pptx", editor, path: undefined };
}

function odpWithTable(): OdpOpenDocument {
  const editor = createOdp();
  const slide = editor.addSlide();
  slide.addTable({
    frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 150 },
    table: { rows: 2, columns: 3 },
  });
  return { format: "odp", editor, path: undefined };
}

describe("resolveSlideTable", () => {
  it("resolves a real table on a pptx slide via readPptxContent", () => {
    const doc = pptxWithTable();
    const table = resolveSlideTable(doc, 0, 0);
    expect(table).toBeDefined();
    expect(table?.kind).toBe("table");
  });

  it("resolves a real table on an odp slide via readOdpContent", () => {
    const doc = odpWithTable();
    const table = resolveSlideTable(doc, 0, 0);
    expect(table).toBeDefined();
    expect(table?.kind).toBe("table");
  });

  it("returns undefined for a slide index beyond the deck", () => {
    const doc = pptxWithTable();
    expect(resolveSlideTable(doc, 5, 0)).toBeUndefined();
  });

  it("returns undefined for a table index beyond the slide's own tables", () => {
    const doc = pptxWithTable();
    expect(resolveSlideTable(doc, 0, 5)).toBeUndefined();
  });

  it("skips a preceding non-table shape's own blocks rather than counting them as tables", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
      text: "Not a table",
    });
    slide.addTable({
      frame: { xPt: 10, yPt: 60, widthPt: 300, heightPt: 150 },
      table: { rows: 2, columns: 3 },
    });
    const doc: PptxOpenDocument = { format: "pptx", editor, path: undefined };
    // A dropped `block.kind === "table"` check would count the text box's own paragraph block as tableIndex 0, returning it in place of the real table.
    const table = resolveSlideTable(doc, 0, 0);
    expect(table?.kind).toBe("table");
  });
});

describe("slideTableCellText", () => {
  it("joins multiple paragraphs in a cell with a newline", () => {
    const cell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "first" }] },
        { kind: "paragraph", runs: [{ text: "second" }] },
      ],
    } as unknown as Parameters<typeof slideTableCellText>[0];
    expect(slideTableCellText(cell)).toBe("first\nsecond");
  });

  it("concatenates multiple runs within one paragraph with no separator", () => {
    const cell = {
      blocks: [
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }],
        },
      ],
    } as unknown as Parameters<typeof slideTableCellText>[0];
    expect(slideTableCellText(cell)).toBe("ab");
  });

  it("ignores non-paragraph blocks", () => {
    const cell = {
      blocks: [
        { kind: "image" },
        { kind: "paragraph", runs: [{ text: "text" }] },
      ],
    } as unknown as Parameters<typeof slideTableCellText>[0];
    expect(slideTableCellText(cell)).toBe("text");
  });

  it("returns an empty string for a cell with no paragraph blocks", () => {
    const cell = { blocks: [] } as unknown as Parameters<
      typeof slideTableCellText
    >[0];
    expect(slideTableCellText(cell)).toBe("");
  });
});

describe("summarizeSlideTables", () => {
  it("summarizes a pptx slide's own tables by row/column count", () => {
    const doc = pptxWithTable();
    expect(summarizeSlideTables(doc, 0)).toEqual([
      { index: 0, rowCount: 2, columnCount: 3 },
    ]);
  });

  it("summarizes an odp slide's own tables by row/column count", () => {
    const doc = odpWithTable();
    expect(summarizeSlideTables(doc, 0)).toEqual([
      { index: 0, rowCount: 2, columnCount: 3 },
    ]);
  });

  it("reports the full grid width of an odp table whose first row has a horizontal merge", () => {
    const doc = odpWithTable();
    doc.editor.slides()[0]?.tables()[0]?.table.mergeCells(0, 0, 1, 2);
    expect(summarizeSlideTables(doc, 0)).toEqual([
      { index: 0, rowCount: 2, columnCount: 3 },
    ]);
  });

  it("reports the full grid width of a pptx table whose first row has a horizontal merge", () => {
    const doc = pptxWithTable();
    const cells = doc.editor.slides()[0]?.tables()[0]?.rows()[0]?.cells();
    const anchor = cells?.[0];
    const covered = cells?.[1];
    if (anchor === undefined || covered === undefined) {
      throw new Error("expected a table with at least two columns");
    }
    anchor.colSpan = 2;
    covered.horizontalMerge = true;
    expect(summarizeSlideTables(doc, 0)).toEqual([
      { index: 0, rowCount: 2, columnCount: 3 },
    ]);
  });

  it("returns an empty array for a slide index beyond the deck", () => {
    const doc = pptxWithTable();
    expect(summarizeSlideTables(doc, 9)).toEqual([]);
  });

  it("returns an empty array for a slide with no tables at all", () => {
    const editor = createPptx();
    editor.addSlide();
    const doc: PptxOpenDocument = { format: "pptx", editor, path: undefined };
    expect(summarizeSlideTables(doc, 0)).toEqual([]);
  });
});

describe("slideTableRowSegments", () => {
  const covered = { blocks: [] };
  const plain = { blocks: [] };
  const grid = (
    rows: readonly (readonly ContentTable["rows"][number]["cells"][number][])[],
  ): ContentTable => ({
    kind: "table",
    columnWidthsPt: rows[0]?.map(() => 10) ?? [],
    rows: rows.map((cells) => ({ cells: [...cells] })),
  });
  const shape = (table: ContentTable) =>
    slideTableRowSegments(table).map((row) =>
      row.map((segment) => [
        segment.columnIndex,
        segment.columnSpan,
        segment.cell !== undefined,
      ]),
    );

  it("draws every entry of an unmerged table as its own single-column box", () => {
    expect(shape(grid([[plain, plain, plain]]))).toEqual([
      [
        [0, 1, true],
        [1, 1, true],
        [2, 1, true],
      ],
    ]);
  });

  it("absorbs the positions a horizontal merge covers into the anchor's own box", () => {
    expect(shape(grid([[{ blocks: [], colSpan: 2 }, covered, plain]]))).toEqual(
      [
        [
          [0, 2, true],
          [2, 1, true],
        ],
      ],
    );
  });

  it("draws the positions a vertical merge covers in later rows as continuation boxes with no cell", () => {
    expect(
      shape(
        grid([
          [{ blocks: [], rowSpan: 3 }, plain],
          [covered, plain],
          [covered, plain],
        ]),
      ),
    ).toEqual([
      [
        [0, 1, true],
        [1, 1, true],
      ],
      [
        [0, 1, false],
        [1, 1, true],
      ],
      [
        [0, 1, false],
        [1, 1, true],
      ],
    ]);
  });

  it("draws a two by two merge as one wide anchor box over one wide continuation box", () => {
    expect(
      shape(
        grid([
          [{ blocks: [], colSpan: 2, rowSpan: 2 }, covered, plain],
          [covered, covered, plain],
        ]),
      ),
    ).toEqual([
      [
        [0, 2, true],
        [2, 1, true],
      ],
      [
        [0, 2, false],
        [2, 1, true],
      ],
    ]);
  });

  it("keeps two side by side regions continuing from different anchors as separate continuation boxes", () => {
    expect(
      shape(
        grid([
          [
            { blocks: [], rowSpan: 2 },
            { blocks: [], rowSpan: 2 },
          ],
          [covered, covered],
        ]),
      ),
    ).toEqual([
      [
        [0, 1, true],
        [1, 1, true],
      ],
      [
        [0, 1, false],
        [1, 1, false],
      ],
    ]);
  });
});

describe("segmentContains", () => {
  const segment = {
    rowIndex: 2,
    columnIndex: 1,
    columnSpan: 2,
    cell: undefined,
  };

  it("holds every grid column the box occupies on its own row", () => {
    expect(segmentContains(segment, { row: 2, column: 1 })).toBe(true);
    expect(segmentContains(segment, { row: 2, column: 2 })).toBe(true);
  });

  it("excludes the columns either side of the box on its own row", () => {
    expect(segmentContains(segment, { row: 2, column: 0 })).toBe(false);
    expect(segmentContains(segment, { row: 2, column: 3 })).toBe(false);
  });

  it("excludes the same columns on any other row", () => {
    expect(segmentContains(segment, { row: 1, column: 1 })).toBe(false);
    expect(segmentContains(segment, { row: 3, column: 2 })).toBe(false);
  });

  it("holds nothing when there is no position", () => {
    expect(segmentContains(segment, undefined)).toBe(false);
  });
});

describe("slideTableRowSegments row indices", () => {
  it("stamps each box with the grid row it is drawn in", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: [10, 10],
      rows: [
        { cells: [{ blocks: [], rowSpan: 2 }, { blocks: [] }] },
        { cells: [{ blocks: [] }, { blocks: [] }] },
      ],
    };
    expect(
      slideTableRowSegments(table).map((row) =>
        row.map((segment) => segment.rowIndex),
      ),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe("segmentText", () => {
  const paragraphCell = (text: string) => ({
    blocks: [{ kind: "paragraph" as const, runs: [{ text }] }],
  });

  it("shows an up arrow in a continuation box, whose text is displayed at its anchor", () => {
    expect(
      segmentText(
        { rowIndex: 1, columnIndex: 0, columnSpan: 1, cell: undefined },
        30,
      ),
    ).toBe("↑");
  });

  it("shows a cell's own text when it fits the width", () => {
    expect(
      segmentText(
        {
          rowIndex: 0,
          columnIndex: 0,
          columnSpan: 1,
          cell: paragraphCell("short"),
        },
        14,
      ),
    ).toBe("short");
  });

  it("truncates a cell's text with an ellipsis to fit the width", () => {
    expect(
      segmentText(
        {
          rowIndex: 0,
          columnIndex: 0,
          columnSpan: 1,
          cell: paragraphCell("x".repeat(20)),
        },
        14,
      ),
    ).toBe(`${"x".repeat(13)}…`);
  });

  it("shows the empty marker for a cell with no text", () => {
    expect(
      segmentText(
        { rowIndex: 0, columnIndex: 0, columnSpan: 1, cell: { blocks: [] } },
        14,
      ),
    ).toBe("(empty)");
  });
});
