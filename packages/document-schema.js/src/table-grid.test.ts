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

function cell(
  text: string,
  spans: { colSpan?: number; rowSpan?: number } = {},
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
    columnWidthsPt: [...columnWidthsPt],
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
    expect(tableCellColumnSpan(cell("a", { colSpan: 3 }))).toBe(3);
    expect(tableCellRowSpan(cell("a", { rowSpan: 2 }))).toBe(2);
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
      tableGridColumnCount(table([[cell("a"), cell("b")]], [100, 100])),
    ).toBe(2);
  });

  it("is the declared column count when it exceeds every row's length", () => {
    expect(tableGridColumnCount(table([[cell("a")]], [100, 100, 100]))).toBe(3);
  });

  it("is the longest row's length when a row runs past the declared columns", () => {
    expect(
      tableGridColumnCount(
        table([[cell("a")], [cell("b"), cell("c"), cell("d")]], [100]),
      ),
    ).toBe(3);
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
          [10, 10],
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
        table([[cell("wide", { colSpan: 2 }), EMPTY, cell("c")]], [10, 10, 10]),
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
          [10, 10],
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
          [10, 10, 10],
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
          [10, 10],
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
    const walked = walkTableGrid(table([[anchor, covered]], [10, 10]));
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
        [10, 10],
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

describe("denseTableRows", () => {
  it("fills every position no cell was placed at with an empty cell", () => {
    const wide = cell("wide", { colSpan: 2 });
    const tail = cell("tail");
    const rows = denseTableRows(
      [
        {
          cells: [
            { columnIndex: 0, cell: wide },
            { columnIndex: 2, cell: tail },
          ],
        },
      ],
      3,
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
    const rows = denseTableRows(
      [
        { cells: [{ columnIndex: 0, cell: cell("a") }] },
        { cells: [{ columnIndex: 3, cell: cell("b") }] },
      ],
      1,
    );
    expect(rows.map((row) => row.cells.length)).toEqual([4, 4]);
  });

  it("gives each row a distinct empty cell rather than one shared instance", () => {
    const rows = denseTableRows([{ cells: [] }, { cells: [] }], 1);
    expect(rows[0]?.cells[0]).not.toBe(rows[1]?.cells[0]);
  });

  it("carries the row's own properties through unchanged", () => {
    const rows = denseTableRows(
      [
        {
          cells: [{ columnIndex: 0, cell: cell("a") }],
          heightPt: 24,
          direction: "rtl",
        },
      ],
      1,
    );
    expect(rows[0]?.heightPt).toBe(24);
    expect(rows[0]?.direction).toBe("rtl");
  });
});

describe("placeAnchorTableRows", () => {
  it("places anchors left to right, skipping the columns a horizontal span consumed", () => {
    const wide = cell("Region", { colSpan: 2 });
    const tail = cell("Revenue");
    const rows = placeAnchorTableRows([{ cells: [wide, tail] }], 3);
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
    const rows = placeAnchorTableRows(
      [{ cells: [block, beside] }, { cells: [below] }],
      3,
    );
    expect(rows).toEqual([
      { cells: [block, { blocks: [] }, beside] },
      { cells: [{ blocks: [] }, { blocks: [] }, below] },
    ]);
  });

  it("derives the width from the placement when the source declares no columns", () => {
    const rows = placeAnchorTableRows(
      [{ cells: [cell("a", { colSpan: 2 }), cell("b")] }],
      0,
    );
    expect(rows[0]?.cells.length).toBe(3);
  });

  it("carries the row's own properties through unchanged", () => {
    const rows = placeAnchorTableRows(
      [{ cells: [cell("a")], heightPt: 18, direction: "ltr" }],
      1,
    );
    expect(rows[0]?.heightPt).toBe(18);
    expect(rows[0]?.direction).toBe("ltr");
  });

  it("places a second anchor past a first one's own columns", () => {
    const wide = cell("wide", { colSpan: 3 });
    const after = cell("after");
    const rows = placeAnchorTableRows([{ cells: [wide, after] }], 4);
    expect(rows[0]?.cells[3]).toBe(after);
  });

  it("agrees with walkTableGrid: every cell it places is classified as an anchor", () => {
    const rows = placeAnchorTableRows(
      [
        { cells: [cell("a", { colSpan: 2, rowSpan: 2 }), cell("b")] },
        { cells: [cell("c")] },
        { cells: [cell("d"), cell("e"), cell("f")] },
      ],
      3,
    );
    expect(
      classifyGrid({ kind: "table", rows, columnWidthsPt: [10, 10, 10] }),
    ).toEqual([
      ["anchor", "covered by 0,0", "anchor"],
      ["covered by 0,0", "covered by 0,0", "anchor"],
      ["anchor", "anchor", "anchor"],
    ]);
  });
});
