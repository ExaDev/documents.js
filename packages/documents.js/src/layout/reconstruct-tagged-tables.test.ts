import { describe, expect, it } from "vitest";
import type { ContentBlock } from "document-schema.js";
import type {
  LayoutItem,
  LayoutPage,
  LayoutStructureElement,
  LayoutText,
} from "pdf-codec";
import { reconstructWordprocessing } from "./reconstruct";

// The companion to reconstruct-structure.test.ts's tagged-table recovery: the order, extent, and fallback boundaries the structural assertions leave unpinned. Tagged rows are recovered in the structure tree's own document order, column widths come from the extremes of every item in the column, and a column with no measurable extent takes the named fallback.

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  structure?: string;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
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
  return {
    kind: "line",
    x1Pt,
    y1Pt,
    x2Pt,
    y2Pt,
    color: { r: 0, g: 0, b: 0 },
    widthPt: 0.5,
  };
}

function page(items: LayoutItem[]): LayoutPage {
  return { widthPt: 612, heightPt: 792, items };
}

function docFrom(pages: LayoutPage[], structure?: LayoutStructureElement[]) {
  return {
    formatVersion: 1 as const,
    metadata: {},
    pages,
    images: {},
    ...(structure !== undefined ? { structure } : {}),
  };
}

function tables(doc: ReturnType<typeof reconstructWordprocessing>) {
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections.flatMap((s) =>
    s.blocks.filter(
      (b): b is Extract<ContentBlock, { kind: "table" }> => b.kind === "table",
    ),
  );
}

describe("reconstructWordprocessing: tagged table order and extents", () => {
  it("recovers rows in the structure tree's own order, not the page's item order", () => {
    // The page draws row 2's text physically ABOVE row 1's; the tree names row 1 first. Recovery follows the tree.
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Second",
              xPt: 50,
              yPt: 700,
              widthPt: 50,
              structure: "c3",
            }),
            text({
              text: "First",
              xPt: 50,
              yPt: 660,
              widthPt: 40,
              structure: "c1",
            }),
          ]),
        ],
        [
          {
            id: "t1",
            type: "Table",
            children: [
              {
                id: "r1",
                type: "TR",
                children: [{ id: "c1", type: "TD", children: [] }],
              },
              {
                id: "r2",
                type: "TR",
                children: [{ id: "c3", type: "TD", children: [] }],
              },
            ],
          },
        ],
      ),
    );
    const [table] = tables(doc);
    const texts = table!.rows.map((row) =>
      row.cells.map((cell) =>
        cell.blocks
          .flatMap((b) =>
            b.kind === "paragraph" ? b.runs.map((r) => r.text) : [],
          )
          .join(""),
      ),
    );
    expect(texts).toEqual([["First"], ["Second"]]);
  });

  it("recovers cells within a row in the tree's cell order, not the page's x order", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Right",
              xPt: 150,
              yPt: 700,
              widthPt: 40,
              structure: "c2",
            }),
            text({
              text: "Left",
              xPt: 50,
              yPt: 700,
              widthPt: 40,
              structure: "c1",
            }),
          ]),
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
                  { id: "c2", type: "TD", children: [] },
                  { id: "c1", type: "TD", children: [] },
                ],
              },
            ],
          },
        ],
      ),
    );
    const [table] = tables(doc);
    const texts = table!.rows[0]!.cells.map((cell) =>
      cell.blocks
        .flatMap((b) =>
          b.kind === "paragraph" ? b.runs.map((r) => r.text) : [],
        )
        .join(""),
    );
    expect(texts).toEqual(["Right", "Left"]);
  });

  it("pads a ragged row to the widest row's cell count, with an empty blocks array and no frame", () => {
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "A",
              xPt: 50,
              yPt: 700,
              widthPt: 10,
              structure: "c1",
            }),
            text({
              text: "B",
              xPt: 150,
              yPt: 700,
              widthPt: 10,
              structure: "c2",
            }),
            text({
              text: "C",
              xPt: 50,
              yPt: 660,
              widthPt: 10,
              structure: "c3",
            }),
          ]),
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
        ],
      ),
    );
    const [table] = tables(doc);
    expect(table!.columns).toHaveLength(2);
    expect(table!.rows[1]!.cells).toHaveLength(2);
    expect(table!.rows[1]!.cells[1]!.blocks).toEqual([]);
    expect(table!.rows[1]!.cells[1]!.frames).toBeUndefined();
    // The present cell is stamped; the padded one is not.
    expect(table!.rows[1]!.cells[0]!.frames?.[0]?.pageIndex).toBe(0);
  });

  it("measures a column's width from every item in it, min edge to max edge", () => {
    // Two items in one column: the second starts further right and ends further right again, so the column spans from the first item's left to the second's right edge, wider than either item alone.
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({
              text: "Wide",
              xPt: 50,
              yPt: 700,
              widthPt: 10,
              structure: "c1",
            }),
            text({
              text: "than",
              xPt: 60,
              yPt: 699,
              widthPt: 15,
              structure: "c1",
            }),
          ]),
        ],
        [
          {
            id: "t1",
            type: "Table",
            children: [
              {
                id: "r1",
                type: "TR",
                children: [{ id: "c1", type: "TD", children: [] }],
              },
            ],
          },
        ],
      ),
    );
    const [table] = tables(doc);
    expect(table!.columns).toEqual([{ widthPt: 25 }]);
  });

  it("takes the named fallback width for a column whose items measure no extent", () => {
    // The only item sits exactly at the anchor with no width of its own: nothing measurable, so the fallback applies.
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            text({ text: "X", xPt: 50, yPt: 700, widthPt: 0, structure: "c1" }),
          ]),
        ],
        [
          {
            id: "t1",
            type: "Table",
            children: [
              {
                id: "r1",
                type: "TR",
                children: [{ id: "c1", type: "TD", children: [] }],
              },
            ],
          },
        ],
      ),
    );
    const [table] = tables(doc);
    expect(table!.columns).toEqual([{ widthPt: 40 }]);
  });
});

describe("reconstructWordprocessing: tagged beats lattice", () => {
  it("a structure with no table elements still recovers a drawn lattice table", () => {
    // The structure tree exists (a lone P element) but names no Table, so the lattice path must still run rather than returning the empty tagged result.
    const doc = reconstructWordprocessing(
      docFrom(
        [
          page([
            line(0, 200, 300, 200),
            line(0, 150, 300, 150),
            line(0, 100, 300, 100),
            line(0, 100, 0, 200),
            line(120, 100, 120, 200),
            line(300, 100, 300, 200),
            text({
              text: "Cell",
              xPt: 20,
              yPt: 130,
              widthPt: 20,
              structure: "p1",
            }),
          ]),
        ],
        [{ id: "p1", type: "P", children: [] }],
      ),
    );
    expect(tables(doc)).toHaveLength(1);
  });
});
