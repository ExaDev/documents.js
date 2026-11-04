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

/** Where each column starts: the size, then two columns of ratings. */
const LABEL_X = 54;
const FIRST_X = 150;
const SECOND_X = 250;

/** Where the second column's three-figure ratings end, which is where a dash under them starts. */
const SECOND_END_X = SECOND_X + advanceOf("130");

/** A column heading set over the right half of the second column's ratings, further from their start than the column tolerance. */
const SECOND_HEADING_X = SECOND_END_X - advanceOf("B");

/** A ratings table whose second column is centred: its heading is set over the right half of its figures, and the smaller sizes, which it does not apply to, state a dash starting where the figures end. */
const CENTRED_COLUMN_TABLE = [
  [
    ["Size", LABEL_X],
    ["A", FIRST_X],
    ["B", SECOND_HEADING_X],
  ],
  ...(
    [
      ["1", "11"],
      ["1.5", "14"],
      ["2.5", "20"],
    ] as const
  ).map(
    ([size, first]) =>
      [
        [size, LABEL_X],
        [first, FIRST_X],
        ["-", SECOND_END_X],
      ] as const,
  ),
  ...(
    [
      ["25", "80", "130"],
      ["35", "99", "162"],
      ["50", "119", "197"],
      ["70", "151", "254"],
    ] as const
  ).map(
    ([size, first, second]) =>
      [
        [size, LABEL_X],
        [first, FIRST_X],
        [second, SECOND_X],
      ] as const,
  ),
] as const;

/** Where a note set in the margin beside the table starts: the second column's start plus its widest figure's advance several times over, well clear of the column. */
const MARGIN_NOTE_X = SECOND_X + 4 * advanceOf("130");

/** The gap between two words of one line: a quarter of an em, well under a column gutter. */
const WORD_SPACE_PT = FIXTURE_SIZE_PT * 0.25;

/** The gap between a figure and a marker set against it: a tenth of an em, well under the quarter-em word space that would set it apart. */
const MARKER_GAP_PT = FIXTURE_SIZE_PT * 0.1;

describe("detectColumnAlignedTables, a column's extent and the text beside a table (novus-power/hive#4222)", () => {
  it("keeps a centred column whole when its dashes and its heading start where its figures end, rather than giving them a column of their own", () => {
    const table = detectColumnAlignedTables(
      page(positionedRows(CENTRED_COLUMN_TABLE)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table)).toEqual([
      ["Size", "A", "B"],
      ["1", "11", "-"],
      ["1.5", "14", "-"],
      ["2.5", "20", "-"],
      ["25", "80", "130"],
      ["35", "99", "162"],
      ["50", "119", "197"],
      ["70", "151", "254"],
    ]);
  });

  it("leaves a margin note sharing the table's baselines out of its last column, words and numbers alike", () => {
    const note = ["NOTE: see", "Regulation", "512.1.5)."];
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) => {
      const line = note[index - 1];
      return line === undefined
        ? cells
        : [...cells, [line, MARGIN_NOTE_X] as const];
    });
    // A line of the note set between two of the table's rows, at the note's own leading, holding nothing else.
    const lineOfItsOwn = "Section 2.4 of";
    const noteLine = {
      text: lineOfItsOwn,
      xPt: MARGIN_NOTE_X,
      yPt: FIRST_ROW_Y_PT - ROW_PITCH_PT * 1.5,
      widthPt: advanceOf(lineOfItsOwn),
    };

    const table = detectColumnAlignedTables(
      page([...positionedRows(rows), noteLine]),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).slice(0, 4)).toEqual([
      ["Size", "A", "B"],
      ["1", "11", "-"],
      ["1.5", "14", "-"],
      ["2.5", "20", "-"],
    ]);
  });

  it("leaves out every word of a margin note the page sets word by word, not only the first word the note's own lines start at", () => {
    const note = ["For", "cables", "having", "flexible", "conductors"];
    // Each word starts a word space after the one before ends, as the words of one line of text do.
    let nextX = MARGIN_NOTE_X;
    const wordsOfNote = note.map((word) => {
      const placed = [word, nextX] as const;
      nextX += advanceOf(word) + WORD_SPACE_PT;
      return placed;
    });
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) =>
      index === 1 ? [...cells, ...wordsOfNote] : cells,
    );
    // The next line of the note, set between two rows and starting where the first word of the first line does.
    const lineOfItsOwn = "Section 2.4 of this Appendix";
    const noteLine = {
      text: lineOfItsOwn,
      xPt: MARGIN_NOTE_X,
      yPt: FIRST_ROW_Y_PT - ROW_PITCH_PT * 1.5,
      widthPt: advanceOf(lineOfItsOwn),
    };

    const table = detectColumnAlignedTables(
      page([...positionedRows(rows), noteLine]),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).slice(1, 3)).toEqual([
      ["1", "11", "-"],
      ["1.5", "14", "-"],
    ]);
  });

  it("starts a margin note at its first word when a space set after the table's last cell lies in a block's run of positions, so the marker and the words are still the note's", () => {
    const markerX = MARGIN_NOTE_X + 8 * WORD_SPACE_PT;
    const noteTextX = markerX + advanceOf("3. ") + MARKER_GAP_PT;
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) => {
      if (index === 2) {
        return [
          ...cells,
          // A space a writer sets after the cell's figure, inside the run of positions the note's own lines start at.
          [" ", MARGIN_NOTE_X + 1] as const,
          ["3. ", markerX] as const,
          ["For cables", noteTextX] as const,
        ];
      }
      // Other rows set a word of the note at the first run of positions, which makes it a block's.
      return index === 3 || index === 4
        ? [...cells, ["NOTE: see", MARGIN_NOTE_X] as const]
        : cells;
    });
    // Two lines of the note on lines of their own: one at the first run of positions, one at the words' own.
    const lonelyLines = [
      { text: "Section 2.4 of this", xPt: MARGIN_NOTE_X, offset: 1.5 },
      { text: "of this Appendix for", xPt: noteTextX, offset: 2.5 },
    ].map(({ text, xPt, offset }) => ({
      text,
      xPt,
      yPt: FIRST_ROW_Y_PT - ROW_PITCH_PT * offset,
      widthPt: advanceOf(text),
    }));

    const table = detectColumnAlignedTables(
      page([...positionedRows(rows), ...lonelyLines]),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table)[2]).toEqual(["1.5", "14", "-"]);
  });

  it("keeps a figure a gutter right of a margin note's word in the table's last cell, since only the words that follow the note's word in its line are the note's", () => {
    const noteWord = "For";
    const gutterPt = 4 * FIXTURE_SIZE_PT;
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) =>
      index === 2
        ? [
            ...cells,
            [noteWord, MARGIN_NOTE_X] as const,
            ["7", MARGIN_NOTE_X + advanceOf(noteWord) + gutterPt] as const,
          ]
        : cells,
    );
    const noteLine = {
      text: "Section 2.4 of this Appendix",
      xPt: MARGIN_NOTE_X,
      yPt: FIRST_ROW_Y_PT - ROW_PITCH_PT * 1.5,
      widthPt: advanceOf("Section 2.4 of this Appendix"),
    };

    const table = detectColumnAlignedTables(
      page([...positionedRows(rows), noteLine]),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table)[2]).toEqual(["1.5", "14", "- 7"]);
  });

  it("leaves out the hanging marker of a margin note, which states a figure and so is no run of the note's words, with the note", () => {
    const markerWidthPt = advanceOf("3. ");
    const noteTextX = MARGIN_NOTE_X + markerWidthPt + MARKER_GAP_PT;
    const markerWords = "For cables having flexible conductors";
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) =>
      index === 2
        ? [
            ...cells,
            ["3. ", MARGIN_NOTE_X] as const,
            [markerWords, noteTextX] as const,
          ]
        : cells,
    );
    const noteLine = {
      text: "Section 2.4 of this Appendix",
      xPt: noteTextX,
      yPt: FIRST_ROW_Y_PT - ROW_PITCH_PT * 1.5,
      widthPt: advanceOf("Section 2.4 of this Appendix"),
    };

    const table = detectColumnAlignedTables(
      page([...positionedRows(rows), noteLine]),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).slice(1, 4)).toEqual([
      ["1", "11", "-"],
      ["1.5", "14", "-"],
      ["2.5", "20", "-"],
    ]);
  });

  it("keeps a figure that abuts a cell of the last column in that column, since only the block's own left edge is its marker", () => {
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) =>
      index === 2
        ? [...cells, ["7", SECOND_END_X + MARKER_GAP_PT] as const]
        : cells,
    );

    const table = detectColumnAlignedTables(
      page(positionedRows(rows)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table)[2]).toEqual(["1.5", "14", "- 7"]);
  });

  it("starts a margin note's block at the line that holds it alone even when a blank run is set on that line too, since a blank run states nothing", () => {
    const note = ["NOTE: see", "Regulation", "512.1.5)."];
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) => {
      const line = note[index - 1];
      return line === undefined
        ? cells
        : [...cells, [line, MARGIN_NOTE_X] as const];
    });
    // The note's own line, with a space run set before its text as a typesetter's list marker leaves one.
    const lineOfItsOwn = "Section 2.4 of";
    const lineY = FIRST_ROW_Y_PT - ROW_PITCH_PT * 1.5;
    const noteLine = [
      { text: " ", xPt: MARGIN_NOTE_X - 12, yPt: lineY, widthPt: 2 },
      {
        text: lineOfItsOwn,
        xPt: MARGIN_NOTE_X,
        yPt: lineY,
        widthPt: advanceOf(lineOfItsOwn),
      },
    ];

    const table = detectColumnAlignedTables(
      page([...positionedRows(rows), ...noteLine]),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).slice(1, 4)).toEqual([
      ["1", "11", "-"],
      ["1.5", "14", "-"],
      ["2.5", "20", "-"],
    ]);
  });

  it("still files words right of the last column under it when they are on the table's rows alone, as a column the vote passed over is, so no cell leaves its row", () => {
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) =>
      index >= 1 && index <= 3
        ? [...cells, ["Yes", MARGIN_NOTE_X] as const]
        : cells,
    );

    const table = detectColumnAlignedTables(
      page(positionedRows(rows)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).slice(1, 4)).toEqual([
      ["1", "11", "- Yes"],
      ["1.5", "14", "- Yes"],
      ["2.5", "20", "- Yes"],
    ]);
  });

  it("still files figures right of the last column under it when too few rows set them there to make a column, so no figure leaves its row", () => {
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) =>
      index >= 1 && index <= 3
        ? [...cells, ["7", MARGIN_NOTE_X] as const]
        : cells,
    );

    const table = detectColumnAlignedTables(
      page(positionedRows(rows)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).slice(1, 4)).toEqual([
      ["1", "11", "- 7"],
      ["1.5", "14", "- 7"],
      ["2.5", "20", "- 7"],
    ]);
  });

  it("keeps a marker set against the last column's figure in that figure's cell, since it is not set apart from it", () => {
    const rows = CENTRED_COLUMN_TABLE.map((cells, index) =>
      index === CENTRED_COLUMN_TABLE.length - 1
        ? [...cells, ["a", SECOND_END_X + MARKER_GAP_PT] as const]
        : cells,
    );

    const table = detectColumnAlignedTables(
      page(positionedRows(rows)),
      new Set(),
    ).get(0)?.[0];

    expect(cellsOf(table).at(-1)).toEqual(["70", "151", "254 a"]);
  });
});
