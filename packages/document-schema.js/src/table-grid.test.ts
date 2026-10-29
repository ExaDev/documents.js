import { describe, expect, it } from "vitest";
import type { ContentTable, ContentTableCell } from "./content";

import {
  denseTableRows,
  placeAnchorTableRows,
  tableCellColumnSpan,
  tableCellRowSpan,
  tableGridColumnCount,
  walkTableGrid,
  type TableGridPosition,
} from "./table-grid";

// Every table built below cares about grid structure (spans, row/column counts) never about an actual rendered width, so every column gets this one arbitrary placeholder width rather than a distinct, individually-meaningless number per call site.
const PLACEHOLDER_WIDTH_PT = 10;

function cell(
  text: string,
  spans: Readonly<{ colSpan?: number; rowSpan?: number }> = {},
): ContentTableCell {
  return {
    blocks: [{ kind: "paragraph", runs: [{ text }] }],
    ...spans,
  };
}

const EMPTY: ContentTableCell = { blocks: [] };

function table(
  rows: readonly (readonly ContentTableCell[])[],
  columnWidthsPt: readonly number[],
): ContentTable {
  return {
    kind: "table",
    rows: rows.map((cells) => ({ cells: [...cells] })),
    columns: columnWidthsPt.map((widthPt) => ({ widthPt })),
  };
}

// The classification of one position, reduced to what every assertion below actually cares about: an anchor is its own coordinates, a covered position names the anchor reaching it.
function classify(position: TableGridPosition): string {
  return position.anchorRowIndex === undefined
    ? "anchor"
    : `covered by ${position.anchorRowIndex},${position.anchorColumnIndex}`;
}

function classifyGrid(source: ContentTable): string[][] {
  return walkTableGrid(source).map((row) => row.map(classify));
}

describe("tableCellColumnSpan / tableCellRowSpan", () => {
  it("reads an absent span as the one position the cell occupies itself", () => {
    expect(tableCellColumnSpan(EMPTY)).toBe(1);
    expect(tableCellRowSpan(EMPTY)).toBe(1);
  });

  it("reads a stated span verbatim", () => {
    const statedColSpan = 3;
    const statedRowSpan = 2;
    expect(tableCellColumnSpan(cell("a", { colSpan: statedColSpan }))).toBe(
      statedColSpan,
    );
    expect(tableCellRowSpan(cell("a", { rowSpan: statedRowSpan }))).toBe(
      statedRowSpan,
    );
  });

  it("reads each span independently of the other", () => {
    const wide = cell("a", { colSpan: 4 });
    expect(tableCellRowSpan(wide)).toBe(1);
    const tall = cell("a", { rowSpan: 5 });
    expect(tableCellColumnSpan(tall)).toBe(1);
  });
});

describe("tableGridColumnCount", () => {
  it("is the declared column count when the rows agree with it", () => {
    expect(
      tableGridColumnCount(
        table(
          [[cell("a"), cell("b")]],
          [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
        ),
      ),
    ).toBe(2);
  });

  it("is the declared column count when it exceeds every row's length", () => {
    const declaredColumnWidths = [
      PLACEHOLDER_WIDTH_PT,
      PLACEHOLDER_WIDTH_PT,
      PLACEHOLDER_WIDTH_PT,
    ];
    expect(
      tableGridColumnCount(table([[cell("a")]], declaredColumnWidths)),
    ).toBe(declaredColumnWidths.length);
  });

  it("is the longest row's length when a row runs past the declared columns", () => {
    const longestRow = [cell("b"), cell("c"), cell("d")];
    expect(
      tableGridColumnCount(
        table([[cell("a")], longestRow], [PLACEHOLDER_WIDTH_PT]),
      ),
    ).toBe(longestRow.length);
  });

  it("is zero for a table declaring no columns and holding no rows", () => {
    expect(tableGridColumnCount(table([], []))).toBe(0);
  });
});

describe("walkTableGrid", () => {
  it("classifies every position of an unmerged grid as its own anchor", () => {
    expect(
      classifyGrid(
        table(
          [
            [cell("a"), cell("b")],
            [cell("c"), cell("d")],
          ],
          [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
        ),
      ),
    ).toEqual([
      ["anchor", "anchor"],
      ["anchor", "anchor"],
    ]);
  });

  it("marks the positions a horizontal span covers, and stops at its last column", () => {
    expect(
      classifyGrid(
        table(
          [[cell("wide", { colSpan: 2 }), EMPTY, cell("c")]],
          [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
        ),
      ),
    ).toEqual([["anchor", "covered by 0,0", "anchor"]]);
  });

  it("marks the positions a vertical span covers, and stops at its last row", () => {
    expect(
      classifyGrid(
        table(
          [
            [cell("tall", { rowSpan: 2 }), cell("b")],
            [EMPTY, cell("c")],
            [cell("d"), cell("e")],
          ],
          [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
        ),
      ),
    ).toEqual([
      ["anchor", "anchor"],
      ["covered by 0,0", "anchor"],
      ["anchor", "anchor"],
    ]);
  });

  it("marks both axes of a region spanning two columns and two rows", () => {
    expect(
      classifyGrid(
        table(
          [
            [cell("block", { colSpan: 2, rowSpan: 2 }), EMPTY, cell("c")],
            [EMPTY, EMPTY, cell("f")],
            [cell("g"), cell("h"), cell("i")],
          ],
          [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
        ),
      ),
    ).toEqual([
      ["anchor", "covered by 0,0", "anchor"],
      ["covered by 0,0", "covered by 0,0", "anchor"],
      ["anchor", "anchor", "anchor"],
    ]);
  });

  it("leaves a position to the left of a vertical span uncovered", () => {
    expect(
      classifyGrid(
        table(
          [
            [cell("a"), cell("tall", { rowSpan: 2 })],
            [cell("c"), EMPTY],
          ],
          [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
        ),
      ),
    ).toEqual([
      ["anchor", "anchor"],
      ["anchor", "covered by 0,1"],
    ]);
  });

  it("carries each position's own cell through unchanged", () => {
    const anchor = cell("wide", { colSpan: 2 });
    const covered: ContentTableCell = {
      blocks: [],
      background: { kind: "solid", color: { r: 1, g: 2, b: 3 } },
    };
    const walked = walkTableGrid(
      table([[anchor, covered]], [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT]),
    );
    expect(walked[0]?.[0]?.cell).toBe(anchor);
    expect(walked[0]?.[1]?.cell).toBe(covered);
  });

  it("reports each position's own coordinates", () => {
    const walked = walkTableGrid(
      table(
        [
          [cell("a"), cell("b")],
          [cell("c"), cell("d")],
        ],
        [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
      ),
    );
    expect(
      walked.map((row) => row.map((p) => `${p.rowIndex},${p.columnIndex}`)),
    ).toEqual([
      ["0,0", "0,1"],
      ["1,0", "1,1"],
    ]);
  });
});

// The walk as it was written before it kept anchors per column: every position asks every anchor met so far, in reading order, and takes the first that covers it. Kept as the reference the per-column walk is compared against, since "the first anchor in reading order covering the position" is the rule, and the per-column lists are only a faster way to ask it.
function referenceWalk(source: ContentTable): TableGridPosition[][] {
  const anchors: {
    row: number;
    column: number;
    rowEnd: number;
    columnEnd: number;
  }[] = [];
  return source.rows.map((row, rowIndex) =>
    row.cells.map((entry, columnIndex): TableGridPosition => {
      const anchor = anchors.find(
        (candidate) =>
          rowIndex < candidate.rowEnd &&
          candidate.column <= columnIndex &&
          columnIndex < candidate.columnEnd,
      );
      if (anchor !== undefined) {
        return {
          rowIndex,
          columnIndex,
          cell: entry,
          anchorRowIndex: anchor.row,
          anchorColumnIndex: anchor.column,
        };
      }
      anchors.push({
        row: rowIndex,
        column: columnIndex,
        rowEnd: rowIndex + tableCellRowSpan(entry),
        columnEnd: columnIndex + tableCellColumnSpan(entry),
      });
      return { rowIndex, columnIndex, cell: entry };
    }),
  );
}

// A small, seeded generator (mulberry32), so the generated tables are the same on every run.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("walkTableGrid against the reference walk", () => {
  const MAX_ROWS = 7;
  const MAX_ROW_LENGTH = 7;
  const MAX_SPAN = 5;
  const GENERATED_TABLES = 2000;
  const SEED = 20261029;

  // Spans run from 0 (a span the walk must treat as covering nothing) to past the grid, rows have unequal lengths and anchors start inside other anchors' footprints: every table the rule forbids is a table the walk still has to classify as it always did.
  function generatedTable(random: () => number): ContentTable {
    const rowCount = 1 + Math.floor(random() * MAX_ROWS);
    const rows = Array.from({ length: rowCount }, (_row, rowIndex) => ({
      cells: Array.from(
        { length: 1 + Math.floor(random() * MAX_ROW_LENGTH) },
        (_entry, columnIndex) =>
          cell(`${String(rowIndex)},${String(columnIndex)}`, {
            colSpan: Math.floor(random() * (MAX_SPAN + 1)),
            rowSpan: Math.floor(random() * (MAX_SPAN + 1)),
          }),
      ),
    }));
    return { kind: "table", rows, columns: [] };
  }

  it("classifies every position as the reference walk does, tables that break the grid rule included", () => {
    const random = seededRandom(SEED);
    for (let generated = 0; generated < GENERATED_TABLES; generated++) {
      const source = generatedTable(random);
      expect(walkTableGrid(source)).toEqual(referenceWalk(source));
    }
  });

  it("classifies a span reaching past the widest row without recording the columns that are not there", () => {
    const hugeSpan = Number.MAX_SAFE_INTEGER;
    const source = table(
      [
        [cell("wide", { colSpan: hugeSpan, rowSpan: 2 }), EMPTY],
        [EMPTY, EMPTY],
      ],
      [PLACEHOLDER_WIDTH_PT, PLACEHOLDER_WIDTH_PT],
    );

    expect(classifyGrid(source)).toEqual([
      ["anchor", "covered by 0,0"],
      ["covered by 0,0", "covered by 0,0"],
    ]);
  });
});

// The work of one walk is bounded by the table's entries, not by their square: an unmerged cell's anchor reaches only its own row, so no later position asks about it. This table holds UNMERGED_ENTRIES entries, none merged, so the walk makes that many lookups of one anchor each, where asking every anchor met so far costs UNMERGED_ENTRIES squared over two comparisons, about 4.5e10 here, which is far past the budget below at any speed a machine runs at; the budget is the vitest default, named so it is not mistaken for a measurement.
describe("walkTableGrid's work on a large unmerged table", () => {
  const UNMERGED_COLUMNS = 5;
  const UNMERGED_ROWS = 60_000;
  const UNMERGED_ENTRIES = UNMERGED_COLUMNS * UNMERGED_ROWS;
  const QUADRATIC_WORK_BUDGET_MS = 5_000;

  it(
    "classifies every one of its entries as an anchor",
    () => {
      const source: ContentTable = {
        kind: "table",
        columns: [],
        rows: Array.from({ length: UNMERGED_ROWS }, () => ({
          cells: Array.from({ length: UNMERGED_COLUMNS }, () => EMPTY),
        })),
      };

      const walked = walkTableGrid(source);

      expect(walked.flat()).toHaveLength(UNMERGED_ENTRIES);
      expect(
        walked
          .flat()
          .every((position) => position.anchorRowIndex === undefined),
      ).toBe(true);
    },
    QUADRATIC_WORK_BUDGET_MS,
  );
});

describe("denseTableRows", () => {
  it("fills every position no cell was placed at with an empty cell", () => {
    const wide = cell("wide", { colSpan: 2 });
    const tail = cell("tail");
    const columnCount = 3;
    const rows = denseTableRows(
      [
        {
          cells: [
            { columnIndex: 0, cell: wide },
            { columnIndex: 2, cell: tail },
          ],
        },
      ],
      columnCount,
    );
    expect(rows).toEqual([{ cells: [wide, { blocks: [] }, tail] }]);
  });

  it("widens the grid when a placed cell runs past the declared column count", () => {
    const wide = cell("wide", { colSpan: 3 });
    const rows = denseTableRows(
      [{ cells: [{ columnIndex: 1, cell: wide }] }],
      2,
    );
    expect(rows[0]?.cells).toEqual([
      { blocks: [] },
      wide,
      { blocks: [] },
      { blocks: [] },
    ]);
  });

  it("gives every row the declared width even when one row places nothing", () => {
    const only = cell("only");
    const rows = denseTableRows(
      [{ cells: [{ columnIndex: 0, cell: only }] }, { cells: [] }],
      2,
    );
    expect(rows.map((row) => row.cells.length)).toEqual([2, 2]);
    expect(rows[1]?.cells).toEqual([{ blocks: [] }, { blocks: [] }]);
  });

  it("gives every row the same width when a later row is the widest", () => {
    const widestColumnIndex = 3;
    const widestRowWidth = widestColumnIndex + 1;
    const rows = denseTableRows(
      [
        { cells: [{ columnIndex: 0, cell: cell("a") }] },
        { cells: [{ columnIndex: widestColumnIndex, cell: cell("b") }] },
      ],
      1,
    );
    expect(rows.map((row) => row.cells.length)).toEqual([
      widestRowWidth,
      widestRowWidth,
    ]);
  });

  it("gives each row a distinct empty cell rather than one shared instance", () => {
    const rows = denseTableRows([{ cells: [] }, { cells: [] }], 1);
    expect(rows[0]?.cells[0]).not.toBe(rows[1]?.cells[0]);
  });

  it("carries the row's own properties through unchanged", () => {
    const statedHeightPt = 24;
    const rows = denseTableRows(
      [
        {
          cells: [{ columnIndex: 0, cell: cell("a") }],
          heightPt: statedHeightPt,
          direction: "rtl",
          isHeader: true,
        },
      ],
      1,
    );
    expect(rows[0]?.heightPt).toBe(statedHeightPt);
    expect(rows[0]?.direction).toBe("rtl");
    expect(rows[0]?.isHeader).toBe(true);
  });

  it("leaves a row that states no header flag without one, rather than writing false", () => {
    const rows = denseTableRows(
      [{ cells: [{ columnIndex: 0, cell: cell("a") }] }],
      1,
    );
    expect(rows[0]).toEqual({ cells: [cell("a")] });
  });
});

describe("placeAnchorTableRows", () => {
  it("places anchors left to right, skipping the columns a horizontal span consumed", () => {
    const wide = cell("Region", { colSpan: 2 });
    const tail = cell("Revenue");
    const columnCount = 3;
    const rows = placeAnchorTableRows([{ cells: [wide, tail] }], columnCount);
    expect(rows).toEqual([{ cells: [wide, { blocks: [] }, tail] }]);
  });

  it("skips the column a span from an earlier row still reaches", () => {
    const tall = cell("tall", { rowSpan: 2 });
    const beside = cell("beside");
    const below = cell("below");
    const rows = placeAnchorTableRows(
      [{ cells: [tall, beside] }, { cells: [below] }],
      2,
    );
    expect(rows).toEqual([
      { cells: [tall, beside] },
      { cells: [{ blocks: [] }, below] },
    ]);
  });

  it("releases a column once the span reaching it has ended", () => {
    const tall = cell("tall", { rowSpan: 2 });
    const third = cell("third");
    const rows = placeAnchorTableRows(
      [{ cells: [tall] }, { cells: [] }, { cells: [third] }],
      1,
    );
    expect(rows[2]).toEqual({ cells: [third] });
  });

  it("skips a region covering two columns of the row below it", () => {
    const block = cell("block", { colSpan: 2, rowSpan: 2 });
    const beside = cell("beside");
    const below = cell("below");
    const columnCount = 3;
    const rows = placeAnchorTableRows(
      [{ cells: [block, beside] }, { cells: [below] }],
      columnCount,
    );
    expect(rows).toEqual([
      { cells: [block, { blocks: [] }, beside] },
      { cells: [{ blocks: [] }, { blocks: [] }, below] },
    ]);
  });

  it("derives the width from the placement when the source declares no columns", () => {
    // The wide cell's own colSpan (2) plus the one plain cell after it.
    const derivedWidth = 3;
    const rows = placeAnchorTableRows(
      [{ cells: [cell("a", { colSpan: 2 }), cell("b")] }],
      0,
    );
    expect(rows[0]?.cells.length).toBe(derivedWidth);
  });

  it("carries the row's own properties through unchanged", () => {
    const statedHeightPt = 18;
    const rows = placeAnchorTableRows(
      [
        {
          cells: [cell("a")],
          heightPt: statedHeightPt,
          direction: "ltr",
          isHeader: true,
        },
      ],
      1,
    );
    expect(rows[0]?.heightPt).toBe(statedHeightPt);
    expect(rows[0]?.direction).toBe("ltr");
    expect(rows[0]?.isHeader).toBe(true);
  });

  it("places a second anchor past a first one's own columns", () => {
    const wideColSpan = 3;
    const wide = cell("wide", { colSpan: wideColSpan });
    const after = cell("after");
    const rows = placeAnchorTableRows(
      [{ cells: [wide, after] }],
      wideColSpan + 1,
    );
    expect(rows[0]?.cells[wideColSpan]).toBe(after);
  });

  it("agrees with walkTableGrid: every cell it places is classified as an anchor", () => {
    const columnCount = 3;
    const rows = placeAnchorTableRows(
      [
        { cells: [cell("a", { colSpan: 2, rowSpan: 2 }), cell("b")] },
        { cells: [cell("c")] },
        { cells: [cell("d"), cell("e"), cell("f")] },
      ],
      columnCount,
    );
    expect(
      classifyGrid({
        kind: "table",
        rows,
        columns: [
          { widthPt: PLACEHOLDER_WIDTH_PT },
          { widthPt: PLACEHOLDER_WIDTH_PT },
          { widthPt: PLACEHOLDER_WIDTH_PT },
        ],
      }),
    ).toEqual([
      ["anchor", "covered by 0,0", "anchor"],
      ["covered by 0,0", "covered by 0,0", "anchor"],
      ["anchor", "anchor", "anchor"],
    ]);
  });
});
