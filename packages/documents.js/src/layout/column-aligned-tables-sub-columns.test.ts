import { describe, expect, it } from "vitest";
import { detectColumnAlignedTables } from "./column-aligned-tables";
import {
  cellsOf,
  FIXTURE_SIZE_PT,
  page,
} from "./column-aligned-tables-fixtures";

/** Distance between two rows. */
const ROW_PITCH_PT = 14;

/** Where the first row sits. */
const FIRST_ROW_Y_PT = 700;

/** An advance for `text` as a proportional face gives it: half an em a character. */
const advanceOf = (text: string): number => text.length * FIXTURE_SIZE_PT * 0.5;

/** One run per cell, each at its own x, every row a pitch below the one before, each run stating its advance. */
function positionedRows(
  rows: readonly (readonly (readonly [text: string, xPt: number])[])[],
): { text: string; xPt: number; yPt: number; widthPt: number }[] {
  return rows.flatMap((cells, index) =>
    cells.map(([text, xPt]) => ({
      text,
      xPt,
      yPt: FIRST_ROW_Y_PT - index * ROW_PITCH_PT,
      widthPt: advanceOf(text),
    })),
  );
}

/** Where each column starts: the size, the first heading's one column, then the second heading's `r`, `x` and `z`. */
const LABEL_X = 54;
const DC_X = 150;
const R_X = 250;
const X_X = 310;
const Z_X = 370;

/** A voltage-drop table with a multi-level header: the second heading and the smaller sizes' one figure under it are set over the middle of its sub-columns, and the larger sizes state its `r`, `x` and `z` apart. The sub-columns hold fewer rows than the vote asks for, which is what used to lose them (novus-power/hive#4078). */
const SUB_COLUMN_TABLE = [
  [
    ["Size", LABEL_X],
    ["DC", DC_X],
    ["AC", X_X],
  ],
  [
    ["r", R_X],
    ["x", X_X],
    ["z", Z_X],
  ],
  ...(
    [
      ["1.5", "31", "32"],
      ["2.5", "19", "20"],
      ["4", "12", "12.5"],
      ["6", "7.9", "8.1"],
      ["10", "4.7", "4.8"],
      ["16", "2.9", "3.0"],
    ] as const
  ).map(
    ([size, dc, ac]) =>
      [
        [size, LABEL_X],
        [dc, DC_X],
        [ac, X_X],
      ] as const,
  ),
  ...(
    [
      ["25", "1.85", "1.80", "0.175", "1.85"],
      ["35", "1.30", "1.30", "0.170", "1.35"],
      ["50", "0.97", "0.96", "0.165", "0.98"],
      ["70", "0.67", "0.66", "0.160", "0.68"],
      ["95", "0.49", "0.48", "0.155", "0.51"],
    ] as const
  ).map(
    ([size, dc, r, x, z]) =>
      [
        [size, LABEL_X],
        [dc, DC_X],
        [r, R_X],
        [x, X_X],
        [z, Z_X],
      ] as const,
  ),
] as const;

describe("detectColumnAlignedTables, sub-columns fewer rows use than the vote asks for", () => {
  it("keeps each sub-column's figures in their own column rather than joining them into the column to their left", () => {
    const table = detectColumnAlignedTables(
      page(positionedRows(SUB_COLUMN_TABLE)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table)).toEqual([
      ["Size", "DC", "", "AC", ""],
      ["", "", "r", "x", "z"],
      ["1.5", "31", "", "32", ""],
      ["2.5", "19", "", "20", ""],
      ["4", "12", "", "12.5", ""],
      ["6", "7.9", "", "8.1", ""],
      ["10", "4.7", "", "4.8", ""],
      ["16", "2.9", "", "3.0", ""],
      ["25", "1.85", "1.80", "0.175", "1.85"],
      ["35", "1.30", "1.30", "0.170", "1.35"],
      ["50", "0.97", "0.96", "0.165", "0.98"],
      ["70", "0.67", "0.66", "0.160", "0.68"],
      ["95", "0.49", "0.48", "0.155", "0.51"],
    ]);
  });

  it("does not part a cell between two words set apart, which divides a heading rather than a column", () => {
    const rows = [
      ...["A", "B", "C", "D"].map(
        (name) =>
          [
            [`Type ${name}`, LABEL_X],
            ["see", DC_X],
            ["clause", DC_X + 60],
            ["12", Z_X],
          ] as const,
      ),
      ...["E", "F", "G", "H", "J", "K", "L", "M"].map(
        (name, index) =>
          [
            [`Type ${name}`, LABEL_X],
            [String(index + 20), DC_X],
            [String(index + 40), Z_X],
          ] as const,
      ),
    ];

    const table = detectColumnAlignedTables(
      page(positionedRows(rows)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).slice(0, 2)).toEqual([
      ["Type A", "see clause", "12"],
      ["Type B", "see clause", "12"],
    ]);
  });

  it("keeps a figure only a few rows set apart folded into the column to its left, as a stray annotation is", () => {
    const rows = ["E", "F", "G", "H", "J", "K", "L", "M"].map((name, index) => [
      [`Type ${name}`, LABEL_X] as const,
      [String(index + 20), DC_X] as const,
      ...(index < 3 ? [["1", DC_X + 60] as const] : []),
      [String(index + 40), Z_X] as const,
    ]);

    const table = detectColumnAlignedTables(
      page(positionedRows(rows)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table)[0]).toEqual(["Type E", "20 1", "40"]);
  });
});
