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

/** The x each column of a two-up layout starts at: a term, its reference, then the second term and reference. */
const COLUMN_X = [60, 200, 310, 450] as const;

/** Positions `rows` from `topYPt` down at an index's line pitch, each cell in its column and an empty cell left out, as a PDF writer leaves no run there. */
function rowsAt(
  topYPt: number,
  rows: readonly (readonly string[])[],
): LayoutItem[] {
  return rows.flatMap((cells, index) =>
    cells.flatMap((cell, column) => {
      const xPt = COLUMN_X[column];
      return cell === "" || xPt === undefined
        ? []
        : [text(cell, xPt, topYPt - index * 11)];
    }),
  );
}

/** A made-up gardening handbook's index, set two-up: each entry a term and the pages, ranges, figures or cross-reference it points at, sub-entries led by a dash under their head term, and the references in no order, since the entries run alphabetically. */
const GARDEN_INDEX = [
  ["Aeration, lawns", "41", "Bamboo canes", "21"],
  ["Allotments -", "Sec 2", "Bark mulch", "9, 44"],
  ["-   access paths", "17-19", "Basil", "57"],
  ["-   water supply", "8", "Bedding plants -", "3"],
  ["Annual planting", "52, 60", "-   hardening off", "36"],
  ["Aphids see Pests", "", "-   watering", "14-15"],
  ["Apple trees", "33", "Berries", "40"],
  ["-   pruning", "12", "Birch", "27"],
  ["-   storage of fruit", "64", "Blackfly", "see Pests"],
  ["Arches, rose", "Fig 7", "Bonfires", "6"],
  ["Ash, wood", "25", "Borders, mixed", "38"],
  ["Asparagus beds", "48-50", "Box hedging", "Table 3"],
  ["Autumn sowing", "5", "Brambles", "19"],
  ["Azaleas", "29", "Broad beans", "62"],
] as const;

/** A made-up table of sowing depths: a crop and one figure, in no order, so its rows read exactly like an index's entries. */
const SOWING_DEPTHS = [
  ["Broad beans", "50"],
  ["Beetroot", "25"],
  ["Carrots", "12"],
  ["Peas", "40"],
  ["Lettuce", "6"],
  ["Parsnips", "20"],
  ["Onions", "15"],
  ["Spinach", "25"],
  ["Radish", "10"],
  ["Sweetcorn", "30"],
  ["Leeks", "13"],
  ["Turnips", "18"],
] as const;

/** A made-up table of soil readings: a sample depth and the moisture read there, figures in both columns and the second in no order, so no row is a term beside a reference. */
const SOIL_READINGS = [
  ["0.5", "17"],
  ["1.0", "9"],
  ["1.5", "24"],
  ["2.0", "12"],
  ["2.5", "31"],
  ["3.0", "8"],
  ["3.5", "27"],
  ["4.0", "14"],
  ["4.5", "22"],
  ["5.0", "11"],
  ["5.5", "29"],
  ["6.0", "16"],
] as const;

/** A made-up index set one-up, whose only reference column gives most entries as a range written with no spaces (`17-19`, en dash included), so the range alone has to read as a reference. */
const RANGE_INDEX = [
  ["Compost heaps", "17-19"],
  ["Cordons", "44-46"],
  ["Courgettes", "8"],
  ["Crop rotation", "52-55"],
  ["Cuttings", "3\u20135"],
  ["Damping off", "61-62"],
  ["Deadheading", "26-28"],
  ["Digging", "11-14"],
  ["Drainage", "39"],
  ["Drills, seed", "30-31"],
  ["Earthing up", "6-7"],
  ["Edging", "48-50"],
  ["Espaliers", "21-24"],
  ["Evergreens", "35-37"],
] as const;

describe("detectColumnAlignedTables, index pages (novus-power/hive#4149)", () => {
  it("leaves an index page, whose rows are entries ending in references in no order, as running text and not a table", () => {
    expect(
      detectColumnAlignedTables(
        pageOf(text("Index", 60, 760, true), ...rowsAt(700, GARDEN_INDEX)),
        new Set(),
      ).size,
    ).toBe(0);
  });

  it("still recovers a table whose rows read like an index's entries when a caption names it, so the caption is what keeps it", () => {
    const tables = detectColumnAlignedTables(
      pageOf(
        text("TABLE 6 - Sowing depths (mm)", 60, 740, true),
        ...rowsAt(700, SOWING_DEPTHS),
      ),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(tables?.[0]?.caption).toBe("TABLE 6 - Sowing depths (mm)");
    expect(cellsOf(tables?.[0])).toEqual(SOWING_DEPTHS.map((row) => [...row]));
  });

  it("reads the same rows with no caption and no column headings as an index, the cost of a page that states nothing else about itself", () => {
    expect(
      detectColumnAlignedTables(
        pageOf(...rowsAt(700, SOWING_DEPTHS)),
        new Set(),
      ).size,
    ).toBe(0);
  });

  it("still recovers them under a row of column headings, which a table prints and an index never does", () => {
    const tables = detectColumnAlignedTables(
      pageOf(...rowsAt(700, [["Crop", "Depth"], ...SOWING_DEPTHS])),
      new Set(),
    ).get(0);

    expect(cellsOf(tables?.[0])[0]).toEqual(["Crop", "Depth"]);
    expect(cellsOf(tables?.[0])).toHaveLength(SOWING_DEPTHS.length + 1);
  });

  it("still recovers a list of figures with no caption, whose page numbers run in order as an index's references do not", () => {
    const figures = Array.from({ length: 12 }, (_, index) => [
      `Figure ${String(index + 1)} - Bed layout ${String(index + 1)}`,
      String(10 + index * 4),
    ]);

    const tables = detectColumnAlignedTables(
      pageOf(...rowsAt(700, figures)),
      new Set(),
    ).get(0);

    expect(cellsOf(tables?.[0])).toEqual(figures);
  });

  it("still recovers a table of figures with no caption whose last column runs in no order, since no row is an entry with a term beside its reference", () => {
    const tables = detectColumnAlignedTables(
      pageOf(...rowsAt(700, SOIL_READINGS)),
      new Set(),
    ).get(0);

    expect(cellsOf(tables?.[0])).toEqual(SOIL_READINGS.map((row) => [...row]));
  });

  it("leaves an index whose only reference column gives its references as unspaced ranges as running text and not a table", () => {
    expect(
      detectColumnAlignedTables(
        pageOf(text("Index", 60, 760, true), ...rowsAt(700, RANGE_INDEX)),
        new Set(),
      ).size,
    ).toBe(0);
  });
});
