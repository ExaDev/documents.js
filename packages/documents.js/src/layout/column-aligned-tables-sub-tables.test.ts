/**
 * Tests for a page that sets several tables under one caption, each under a sub-caption `(a)`, `(b)`: the earth fault loop impedance table of a wiring regulations page sets four, each with its own columns and two rows (a rating row and an impedance row), the columns of one not evidence for another's.
 */
import { describe, expect, it } from "vitest";
import { detectColumnAlignedTables } from "./column-aligned-tables";
import { cellsOf, page } from "./column-aligned-tables-fixtures";

interface Run {
  text: string;
  xPt: number;
  yPt: number;
  widthPt?: number;
}

/** A row of cells, each set at its own x, on the baseline `yPt`. */
function row(
  yPt: number,
  cells: readonly (readonly [number, string])[],
): Run[] {
  return cells.map(([xPt, text]) => ({
    text,
    xPt,
    yPt,
    widthPt: text.length * 6,
  }));
}

/** A rating row and an impedance row, the two rows of one of the page's sub-tables, from the left margin. */
function twoRows(
  topPt: number,
  ratings: readonly string[],
  impedances: readonly string[],
): Run[] {
  const columnsXPt = [141, 176, 211, 246, 282, 318, 353, 394, 434, 468, 505];
  return [
    ...row(topPt, [
      [85, "Rating"],
      ...ratings.map((r, i): [number, string] => [columnsXPt[i] ?? 0, r]),
    ]),
    ...row(topPt - 14, [
      [79, "Zs (ohms)"],
      ...impedances.map((z, i): [number, string] => [columnsXPt[i] ?? 0, z]),
    ]),
  ];
}

/** The page: a caption, sub-tables (a) of eleven ratings and (b) of six, each of two rows and each opened by a line `(x) ...`; then (c) and (d) set side by side under one line holding both of their captions; a NOTE with an indented `(a)` sub-list that opens nothing; and the page number at the far left, further left than any caption, as a printed page has it. */
function earthFaultLoopImpedancePage() {
  return page([
    ...row(710, [[269, "TABLE 41.2 - Maximum earth fault loop impedance"]]),
    ...row(666, [[75, "(a) General purpose fuses to BS 1361"]]),
    ...twoRows(
      641,
      ["2", "4", "6", "10", "16", "20", "25", "32", "40", "50", "63"],
      [
        "33.1",
        "15.6",
        "7.80",
        "4.65",
        "2.43",
        "1.68",
        "1.29",
        "0.99",
        "0.75",
        "0.57",
        "0.44",
      ],
    ),
    ...row(602, [[75, "(b) Fuses to BS 88-3"]]),
    ...twoRows(
      588,
      ["5", "16", "20", "32", "45", "63"],
      ["9.93", "2.30", "1.93", "0.91", "0.57", "0.36"],
    ),
    ...row(549, [
      [75, "(c) Fuses to BS 3036"],
      [379, "(d) Fuses to BS 1362"],
    ]),
    ...row(535, [
      [85, "Rating"],
      [386, "Rating"],
    ]),
    ...row(534, [
      [141, "5"],
      [176, "15"],
      [211, "20"],
      [246, "30"],
      [282, "45"],
      [318, "60"],
      [437, "3"],
      [468, "13"],
    ]),
    ...row(510, [
      [78, "Zs (ohms)"],
      [134, "9.10"],
      [171, "2.43"],
      [206, "1.68"],
      [242, "1.04"],
      [278, "0.56"],
      [314, "0.40"],
      [380, "Zs (ohms)"],
      [430, "15.6"],
      [463, "2.30"],
    ]),
    ...row(494, [[71, "NOTE 1: The Zs values have been determined"]]),
    ...row(467, [
      [115, "(a)"],
      [131, "the line conductor"],
    ]),
    ...row(455, [
      [115, "(b)"],
      [131, "the circuit protective conductor"],
    ]),
    ...row(22, [[48, "74"]]),
  ]);
}

describe("detectColumnAlignedTables on a page of sub-tables", () => {
  it("does not carry a sub-table of two rows as a table, nor read its figures through the columns another sub-table votes, with two sub-tables set side by side and the page number left of every caption", () => {
    const tables = detectColumnAlignedTables(
      earthFaultLoopImpedancePage(),
      new Set(),
    );

    expect(tables.size).toBe(0);
  });

  it("still reads a sub-table that has rows enough, with its own columns", () => {
    const rows = (topPt: number) =>
      [
        ["Rating", "5", "16", "20"],
        ["Zs (ohms)", "9.93", "2.30", "1.93"],
        ["Cable", "1.5", "2.5", "4"],
        ["Length", "10", "20", "30"],
      ].flatMap((cells, index) =>
        row(
          topPt - index * 14,
          cells.map((text, column): [number, string] => [
            75 + column * 60,
            text,
          ]),
        ),
      );
    const tables = detectColumnAlignedTables(
      page([
        ...row(700, [[75, "(a) General purpose fuses"]]),
        ...rows(680),
        ...row(600, [[75, "(b) Fuses to BS 88"]]),
        ...twoRows(580, ["5", "16"], ["9.93", "2.30"]),
      ]),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(cellsOf(tables?.[0])).toContainEqual(["Length", "10", "20", "30"]);
  });

  it("reads a page with no sub-caption as one table over the whole page, as before", () => {
    const tables = detectColumnAlignedTables(
      page(
        [
          ["Rating", "5", "16", "20"],
          ["Zs (ohms)", "9.93", "2.30", "1.93"],
          ["Cable", "1.5", "2.5", "4"],
          ["Length", "10", "20", "30"],
        ].flatMap((cells, index) =>
          row(
            700 - index * 14,
            cells.map((text, column): [number, string] => [
              75 + column * 60,
              text,
            ]),
          ),
        ),
      ),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
  });

  it("does not cut a page at an indented sub-list in a note", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...row(700, [[71, "NOTE 1:"]]),
        ...row(686, [
          [115, "(a)"],
          [131, "the line conductor"],
        ]),
        ...[
          ["Rating", "5", "16", "20"],
          ["Zs (ohms)", "9.93", "2.30", "1.93"],
          ["Cable", "1.5", "2.5", "4"],
          ["Length", "10", "20", "30"],
        ].flatMap((cells, index) =>
          row(
            660 - index * 14,
            cells.map((text, column): [number, string] => [
              75 + column * 60,
              text,
            ]),
          ),
        ),
      ]),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(cellsOf(tables?.[0])).toHaveLength(4);
  });
});
