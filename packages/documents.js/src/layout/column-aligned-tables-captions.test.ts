import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutItem } from "pdf-codec";
import { detectColumnAlignedTables } from "./column-aligned-tables";
import { cellsOf } from "./column-aligned-tables-fixtures";

function text(
  content: string,
  xPt: number,
  yPt: number,
  bold = false,
): LayoutItem {
  return {
    kind: "text",
    text: content,
    xPt,
    yPt,
    font: {
      family: "Helvetica",
      weight: bold ? "bold" : "normal",
      style: "normal",
    },
    sizePt: 10,
    color: { r: 0, g: 0, b: 0 },
    widthPt: content.length * 5,
  };
}

function pageOf(...items: LayoutItem[]): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages: [{ widthPt: 612, heightPt: 792, items }],
    images: {},
  };
}

/** Rows of a label and three figures, the first row at `topYPt` and each next 14pt below it. */
function figureRows(
  topYPt: number,
  rows: readonly (readonly [string, string, string, string])[],
): LayoutItem[] {
  return rows.flatMap(([label, a, b, c], index) => {
    const yPt = topYPt - index * 14;
    return [
      text(label, 54, yPt),
      text(a, 250, yPt),
      text(b, 350, yPt),
      text(c, 450, yPt),
    ];
  });
}

const WIDGETS = [
  ["2", "0.75", "0.80", "0.85"],
  ["3", "0.65", "0.70", "0.75"],
  ["4", "0.60", "0.60", "0.70"],
  ["5", "0.55", "0.55", "0.65"],
] as const;

const GADGETS = [
  ["2", "0.85", "0.90", "0.95"],
  ["3", "0.75", "0.85", "0.90"],
  ["4", "0.70", "0.80", "0.85"],
  ["5", "0.65", "0.80", "0.85"],
] as const;

describe("detectColumnAlignedTables, tables under captions (novus-power/hive#4091)", () => {
  it("labels a table with the caption set above its first row", () => {
    const tables = detectColumnAlignedTables(
      pageOf(
        text("TABLE 9A - Widget factors", 54, 740, true),
        ...figureRows(700, WIDGETS),
      ),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(tables?.[0]?.caption).toBe("TABLE 9A - Widget factors");
    expect(cellsOf(tables?.[0])).toHaveLength(WIDGETS.length);
  });

  it("splits a page's rows into one table per caption, each labelled by the caption above it and keeping every row once", () => {
    const tables = detectColumnAlignedTables(
      pageOf(
        text("TABLE 9A - Widget factors", 54, 740, true),
        ...figureRows(700, WIDGETS),
        text("TABLE 9B - Gadget factors", 54, 600, true),
        text("Reference Method D1", 54, 588.5, true),
        ...figureRows(560, GADGETS),
      ),
      new Set(),
    ).get(0);

    expect(tables?.map((table) => table.caption)).toEqual([
      "TABLE 9A - Widget factors",
      "TABLE 9B - Gadget factors Reference Method D1",
    ]);
    expect(tables?.map((table) => cellsOf(table))).toEqual([
      WIDGETS.map((row) => [...row]),
      GADGETS.map((row) => [...row]),
    ]);
  });

  it("leaves the rows above the first caption in a table of their own, with no label", () => {
    const tables = detectColumnAlignedTables(
      pageOf(
        ...figureRows(740, WIDGETS),
        text("TABLE 9B - Gadget factors", 54, 640, true),
        ...figureRows(600, GADGETS),
      ),
      new Set(),
    ).get(0);

    expect(tables?.map((table) => table.caption)).toEqual([
      undefined,
      "TABLE 9B - Gadget factors",
    ]);
    expect(tables?.map((table) => cellsOf(table).length)).toEqual([
      WIDGETS.length,
      GADGETS.length,
    ]);
  });

  it("keeps a run of rows above the first caption that is too short to be a table with the captioned table, so no row is lost or set apart", () => {
    const tables = detectColumnAlignedTables(
      pageOf(
        ...figureRows(740, WIDGETS.slice(0, 2)),
        text("TABLE 9B - Gadget factors", 54, 700, true),
        ...figureRows(660, GADGETS),
      ),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(tables?.[0]?.caption).toBe("TABLE 9B - Gadget factors");
    expect(cellsOf(tables?.[0]).map((row) => row[1])).toEqual([
      "0.75",
      "0.65",
      "0.85",
      "0.75",
      "0.70",
      "0.65",
    ]);
  });

  it("does not split at, or label from, a caption below the last row", () => {
    const tables = detectColumnAlignedTables(
      pageOf(
        ...figureRows(740, WIDGETS),
        text("TABLE 9B - Gadget factors", 54, 640, true),
      ),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(tables?.[0]?.caption).toBeUndefined();
  });

  it("does not split an index page at the tables its entries cite", () => {
    const entries = Array.from({ length: 12 }, (_, index) => {
      const yPt = 700 - index * 10;
      return [
        text(`Entry ${String(index)}`, 70, yPt),
        text(`52${String(index)}.1`, 212, yPt),
        text(`Other ${String(index)}`, 309, yPt),
        text(`70${String(index)}.2`, 450, yPt),
      ];
    }).flat();
    const tables = detectColumnAlignedTables(
      pageOf(
        ...entries,
        text("Table 7", 212, 635),
        text("Table 41.1", 212, 575),
        text("Barriers -", 309, 572.5),
      ),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(tables?.[0]?.caption).toBeUndefined();
    expect(cellsOf(tables?.[0])).toHaveLength(12);
  });
});
