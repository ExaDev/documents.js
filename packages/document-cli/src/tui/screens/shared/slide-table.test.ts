import { createOdp, createPptx } from "documents.js";
import { describe, expect, it } from "vitest";
import type { OdpOpenDocument, PptxOpenDocument } from "../../state/types.js";
import {
  resolveSlideTable,
  slideTableCellText,
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
