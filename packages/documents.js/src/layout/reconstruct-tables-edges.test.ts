import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutPage } from "pdf-codec";
import {
  reconstructSpreadsheet,
  reconstructWordprocessing,
} from "./reconstruct";

// The measurement and emission edges of table recovery: which x positions count as recurring columns (exactly at the recurrence threshold), how the last column's width falls back when its items state no advance, the exact measured row heights with the modal-spacing tail, joining within a cell with and without a word gap, the cell an empty text item never emits, the tagged table's structure-order rows with a ragged row's empty cell, and the exact frames both recovery paths stamp.

const BLACK = { r: 0, g: 0, b: 0 };

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt?: number;
  structure?: string;
}): LayoutItem {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 12,
    color: BLACK,
    ...(overrides.widthPt !== undefined ? { widthPt: overrides.widthPt } : {}),
    ...(overrides.structure !== undefined
      ? { structure: overrides.structure }
      : {}),
  };
}

function line(
  x1Pt: number,
  y1Pt: number,
  x2Pt: number,
  y2Pt: number,
): LayoutItem {
  return { kind: "line", x1Pt, y1Pt, x2Pt, y2Pt, color: BLACK, widthPt: 0.5 };
}

function sheet(items: LayoutItem[]) {
  const doc = reconstructSpreadsheet({
    formatVersion: 1,
    metadata: {},
    images: {},
    pages: [{ widthPt: 300, heightPt: 300, items }],
  });
  if (doc.kind !== "spreadsheet" || doc.sheets[0] === undefined) {
    throw new Error("expected a spreadsheet with one sheet");
  }
  return doc.sheets[0];
}

describe("reconstructSpreadsheet: column anchors and measurements", () => {
  it("an x position recurring exactly at the threshold is still a column anchor", () => {
    const s = sheet([
      text({ text: "a", xPt: 48, yPt: 200, widthPt: 10 }),
      text({ text: "b", xPt: 48, yPt: 180, widthPt: 10 }),
      text({ text: "c", xPt: 150, yPt: 200, widthPt: 10 }),
      text({ text: "d", xPt: 150, yPt: 180, widthPt: 10 }),
      text({ text: "e", xPt: 150, yPt: 160, widthPt: 10 }),
    ]);
    expect(s.columns).toEqual([
      { index: 0, widthPt: 102 },
      { index: 1, widthPt: 10 },
    ]);
    expect(s.cells.map((c) => [c.row, c.column, c.displayText])).toEqual([
      [0, 0, "a"],
      [0, 1, "c"],
      [1, 0, "b"],
      [1, 1, "d"],
      [2, 1, "e"],
    ]);
  });

  it("the last column whose items state no advance falls back to the default width", () => {
    const s = sheet([
      text({ text: "L", xPt: 48, yPt: 200, widthPt: 10 }),
      text({ text: "L2", xPt: 48, yPt: 180, widthPt: 10 }),
      text({ text: "R", xPt: 150, yPt: 200 }),
      text({ text: "R2", xPt: 150, yPt: 180 }),
    ]);
    expect(s.columns).toEqual([
      { index: 0, widthPt: 102 },
      { index: 1, widthPt: 40 },
    ]);
    const r = s.cells.find((c) => c.displayText === "R");
    expect(r?.column).toBe(1);
  });

  it("row heights are the measured baseline gaps, with the last row on the modal spacing", () => {
    const s = sheet([
      text({ text: "r1", xPt: 48, yPt: 200, widthPt: 20 }),
      text({ text: "r2", xPt: 48, yPt: 176, widthPt: 20 }),
      text({ text: "r3", xPt: 48, yPt: 140, widthPt: 20 }),
    ]);
    expect(s.rows).toEqual([
      { index: 0, heightPt: 24 },
      { index: 1, heightPt: 36 },
      { index: 2, heightPt: 24 },
    ]);
  });
});

describe("reconstructSpreadsheet: cell emission", () => {
  it("adjacent fragments of one cell join without a space, apart stays apart", () => {
    const s = sheet([
      text({ text: "hel", xPt: 48, yPt: 200, widthPt: 15 }),
      text({ text: "lo", xPt: 63, yPt: 200, widthPt: 10 }),
      text({ text: "x", xPt: 48, yPt: 180, widthPt: 5 }),
      text({ text: "y", xPt: 150, yPt: 180, widthPt: 5 }),
    ]);
    expect(s.cells.map((c) => c.displayText)).toEqual(["hello", "x y"]);
  });

  it("a cell whose items carry no text at all is never emitted", () => {
    const s = sheet([
      text({ text: "", xPt: 48, yPt: 200, widthPt: 10 }),
      text({ text: "keep", xPt: 48, yPt: 180, widthPt: 20 }),
      text({ text: "k2", xPt: 150, yPt: 180, widthPt: 20 }),
    ]);
    expect(s.cells).toHaveLength(1);
    expect(s.cells[0]?.displayText).toBe("keep k2");
  });
});

describe("reconstructWordprocessing: table frames and order", () => {
  function word(
    pages: LayoutPage[],
    structure?: unknown,
  ): {
    kinds: string[];
    table: Record<string, unknown> & { rows: unknown[] };
  } {
    const doc = reconstructWordprocessing({
      formatVersion: 1,
      metadata: {},
      images: {},
      pages,
      ...(structure !== undefined ? { structure: structure as never } : {}),
    });
    if (doc.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    const blocks = doc.sections.flatMap((sec) => [...sec.blocks]);
    const table = blocks.find(
      (b): b is Extract<(typeof blocks)[number], { kind: "table" }> =>
        b.kind === "table",
    );
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    return {
      kinds: blocks.map((b) => b.kind),
      table: table as unknown as Record<string, unknown> & {
        rows: unknown[];
      },
    };
  }

  it("a tagged table orders rows and cells by structure despite scrambled items, stamps exact frames, and sorts above the paragraph below it", () => {
    const { kinds, table } = word(
      [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            // Deliberately out of structure order: the second row's cell, then the first row's second cell, then the first row's first cell.
            text({
              text: "cc",
              xPt: 50,
              yPt: 660,
              widthPt: 20,
              structure: "c3",
            }),
            text({
              text: "bb",
              xPt: 150,
              yPt: 700,
              widthPt: 20,
              structure: "c2",
            }),
            text({
              text: "aa",
              xPt: 50,
              yPt: 700,
              widthPt: 20,
              structure: "c1",
            }),
            text({ text: "below", xPt: 50, yPt: 600, widthPt: 40 }),
          ],
        },
      ],
      [
        {
          id: "t1",
          type: "Table",
          children: [
            {
              id: "r1",
              type: "TR",
              children: [
                { id: "c1", type: "TD", children: [] },
                { id: "c2", type: "TD", children: [] },
              ],
            },
            {
              id: "r2",
              type: "TR",
              children: [{ id: "c3", type: "TD", children: [] }],
            },
          ],
        },
        { id: "p1", type: "P", children: [] },
      ],
    );
    expect(kinds).toEqual(["table", "paragraph"]);
    const rows = table.rows as {
      cells: { blocks: { runs?: { text?: string }[] }[] }[];
    }[];
    const rowTexts = rows.map((row) =>
      row.cells.map((cell) => cell.blocks[0]?.runs?.[0]?.text ?? null),
    );
    expect(rowTexts).toEqual([
      ["aa", "bb"],
      ["cc", null],
    ]);
    // The ragged row's missing cell is exactly an empty cell, with no frame.
    expect(rows[1]?.cells[1]).toStrictEqual({ blocks: [] });
    expect(table.frames).toEqual([
      {
        pageIndex: 0,
        xPt: 50,
        yPt: 657.516,
        widthPt: 120,
        heightPt: 51.10000000000002,
      },
    ]);
    expect(table.columns).toEqual([{ widthPt: 20 }, { widthPt: 20 }]);
  });

  it("a drawn lattice's table frame spans the boundary box exactly", () => {
    const { table } = word([
      {
        widthPt: 300,
        heightPt: 300,
        items: [
          line(0, 200, 300, 200),
          line(0, 150, 300, 150),
          line(0, 100, 300, 100),
          line(0, 100, 0, 200),
          line(120, 100, 120, 200),
          line(300, 100, 300, 200),
          text({ text: "R0C0", xPt: 10, yPt: 180, widthPt: 30 }),
          text({ text: "R1C1", xPt: 130, yPt: 130, widthPt: 20 }),
        ],
      },
    ]);
    expect(table.frames).toEqual([
      { pageIndex: 0, xPt: 0, yPt: 100, widthPt: 300, heightPt: 100 },
    ]);
  });
});
