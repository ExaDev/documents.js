import { describe, expect, it } from "vitest";
import type { ContentTable, ContentTableCell } from "./content";
import {
  denseTableRows,
  describeTableGridFault,
  findTableGridFault,
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

describe("findTableGridFault", () => {
  it("finds nothing in a table with no merged region", () => {
    const grid = table(
      [
        [cell("a"), cell("b")],
        [cell("c"), cell("d")],
      ],
      [10, 10],
    );
    expect(findTableGridFault(grid)).toBeUndefined();
  });

  it("finds nothing in a table whose merged regions have block-less covered entries", () => {
    const grid = table(
      [
        [cell("a", { colSpan: 2, rowSpan: 2 }), EMPTY, cell("b")],
        [EMPTY, EMPTY, cell("c")],
      ],
      [10, 10, 10],
    );
    expect(findTableGridFault(grid)).toBeUndefined();
  });

  it("finds nothing in a table with no rows, or whose rows are all empty", () => {
    expect(findTableGridFault(table([], []))).toBeUndefined();
    expect(findTableGridFault(table([[], []], []))).toBeUndefined();
  });

  it("does not consult columnWidthsPt", () => {
    const grid = table([[cell("a"), cell("b")]], [10]);
    expect(findTableGridFault(grid)).toBeUndefined();
  });

  it("ignores an explicit span of one on a covered entry", () => {
    const grid = table(
      [
        [cell("a", { colSpan: 2, rowSpan: 2 }), { blocks: [], colSpan: 1 }],
        [{ blocks: [], rowSpan: 1 }, EMPTY],
      ],
      [10, 10],
    );
    expect(findTableGridFault(grid)).toBeUndefined();
  });

  describe("rows of differing lengths", () => {
    it("reports the first row shorter than the widest", () => {
      const grid = table(
        [[cell("a"), cell("b"), cell("c")], [cell("d")], [cell("e")]],
        [10, 10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "raggedRow",
        rowIndex: 1,
        cellCount: 1,
        gridColumnCount: 3,
      });
    });

    it("reports a short row that comes before the widest one", () => {
      const grid = table([[cell("a")], [cell("b"), cell("c")]], [10, 10]);
      expect(findTableGridFault(grid)).toEqual({
        kind: "raggedRow",
        rowIndex: 0,
        cellCount: 1,
        gridColumnCount: 2,
      });
    });

    it("reports a row with no entries at all", () => {
      const grid = table([[cell("a")], []], [10]);
      expect(findTableGridFault(grid)).toEqual({
        kind: "raggedRow",
        rowIndex: 1,
        cellCount: 0,
        gridColumnCount: 1,
      });
    });

    it("is reported ahead of a positional fault earlier in reading order", () => {
      const grid = table(
        [[cell("a", { colSpan: 2 }), cell("covered content")], [cell("b")]],
        [10, 10],
      );
      expect(findTableGridFault(grid)?.kind).toBe("raggedRow");
    });
  });

  describe("a covered position carrying blocks", () => {
    it("reports a position covered along its own row, with its anchor", () => {
      const grid = table(
        [[cell("a", { colSpan: 2 }), cell("extra"), cell("b")]],
        [10, 10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "coveredContent",
        rowIndex: 0,
        columnIndex: 1,
        anchorRowIndex: 0,
        anchorColumnIndex: 0,
      });
    });

    it("reports a position covered from a row above, with its anchor", () => {
      const grid = table(
        [
          [cell("a"), cell("b", { rowSpan: 2 })],
          [cell("c"), cell("extra")],
        ],
        [10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "coveredContent",
        rowIndex: 1,
        columnIndex: 1,
        anchorRowIndex: 0,
        anchorColumnIndex: 1,
      });
    });

    it("reports a position inside a two-dimensional region", () => {
      const grid = table(
        [
          [cell("a", { colSpan: 2, rowSpan: 2 }), EMPTY],
          [EMPTY, cell("extra")],
        ],
        [10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "coveredContent",
        rowIndex: 1,
        columnIndex: 1,
        anchorRowIndex: 0,
        anchorColumnIndex: 0,
      });
    });

    it("does not treat an unmerged cell's own blocks as a fault", () => {
      const grid = table([[cell("a"), cell("b")]], [10, 10]);
      expect(findTableGridFault(grid)).toBeUndefined();
    });
  });

  describe("a covered position carrying a span of its own", () => {
    it("reports a second anchor starting inside another's footprint along a row", () => {
      const grid = table(
        [[cell("a", { colSpan: 2 }), { blocks: [], colSpan: 2 }, EMPTY]],
        [10, 10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "coveredSpan",
        rowIndex: 0,
        columnIndex: 1,
        anchorRowIndex: 0,
        anchorColumnIndex: 0,
      });
    });

    it("reports a second anchor starting inside another's footprint down a column", () => {
      const grid = table(
        [[cell("a", { rowSpan: 2 })], [{ blocks: [], rowSpan: 2 }], [EMPTY]],
        [10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "coveredSpan",
        rowIndex: 1,
        columnIndex: 0,
        anchorRowIndex: 0,
        anchorColumnIndex: 0,
      });
    });

    it("reports a covered entry with a rowSpan alone", () => {
      const grid = table(
        [
          [cell("a", { colSpan: 2 }), { blocks: [], rowSpan: 2 }],
          [EMPTY, EMPTY],
        ],
        [10, 10],
      );
      expect(findTableGridFault(grid)?.kind).toBe("coveredSpan");
    });

    it("reports content ahead of a span on the same covered position", () => {
      const grid = table(
        [[cell("a", { colSpan: 2 }), cell("extra", { colSpan: 2 })]],
        [10, 10],
      );
      expect(findTableGridFault(grid)?.kind).toBe("coveredContent");
    });
  });

  describe("an anchor whose footprint runs past the grid", () => {
    it("accepts a colSpan that ends exactly at the last column", () => {
      const grid = table(
        [[cell("a"), cell("b", { colSpan: 2 }), EMPTY]],
        [10, 10, 10],
      );
      expect(findTableGridFault(grid)).toBeUndefined();
    });

    it("reports a colSpan reaching one column past the last", () => {
      const grid = table(
        [[cell("a"), cell("b", { colSpan: 3 }), EMPTY]],
        [10, 10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "anchorOverrunsColumns",
        rowIndex: 0,
        columnIndex: 1,
      });
    });

    it("accepts a rowSpan that ends exactly at the last row", () => {
      const grid = table([[cell("a", { rowSpan: 2 })], [EMPTY]], [10]);
      expect(findTableGridFault(grid)).toBeUndefined();
    });

    it("reports a rowSpan reaching one row past the last", () => {
      const grid = table([[cell("a")], [cell("b", { rowSpan: 2 })]], [10]);
      expect(findTableGridFault(grid)).toEqual({
        kind: "anchorOverrunsRows",
        rowIndex: 1,
        columnIndex: 0,
      });
    });

    it("reports the column overrun when the same anchor overruns both", () => {
      const grid = table(
        [[cell("a", { colSpan: 2, rowSpan: 2 })], [EMPTY]],
        [10],
      );
      expect(findTableGridFault(grid)?.kind).toBe("anchorOverrunsColumns");
    });

    it("reports the earliest fault in reading order", () => {
      const grid = table(
        [
          [cell("a"), cell("b", { rowSpan: 4 })],
          [cell("c"), EMPTY],
          [cell("d", { colSpan: 3 }), EMPTY],
        ],
        [10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "anchorOverrunsRows",
        rowIndex: 0,
        columnIndex: 1,
      });
    });
  });

  describe("two regions claiming one position", () => {
    it("reports an anchor whose footprint reaches a region anchored on an earlier row", () => {
      const grid = table(
        [
          [cell("a"), cell("b", { rowSpan: 2 })],
          [cell("c", { colSpan: 2 }), EMPTY],
        ],
        [10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "overlappingAnchors",
        rowIndex: 1,
        columnIndex: 0,
        earlierAnchorRowIndex: 0,
        earlierAnchorColumnIndex: 1,
      });
    });

    it("reports the overlap when it is only the anchor's later columns that are shared", () => {
      const grid = table(
        [
          [cell("a"), cell("b"), cell("c", { rowSpan: 2 })],
          [cell("d", { colSpan: 3 }), EMPTY, EMPTY],
        ],
        [10, 10, 10],
      );
      expect(findTableGridFault(grid)).toEqual({
        kind: "overlappingAnchors",
        rowIndex: 1,
        columnIndex: 0,
        earlierAnchorRowIndex: 0,
        earlierAnchorColumnIndex: 2,
      });
    });

    it("reports the overlap of two multi-row regions", () => {
      const grid = table(
        [
          [cell("a"), cell("b", { rowSpan: 3 })],
          [cell("c", { colSpan: 2, rowSpan: 2 }), EMPTY],
          [EMPTY, EMPTY],
        ],
        [10, 10],
      );
      expect(findTableGridFault(grid)?.kind).toBe("overlappingAnchors");
    });

    it("accepts regions that sit side by side without sharing a position", () => {
      const grid = table(
        [
          [cell("a", { rowSpan: 2 }), cell("b", { rowSpan: 2 })],
          [EMPTY, EMPTY],
          [cell("c", { colSpan: 2 }), EMPTY],
        ],
        [10, 10],
      );
      expect(findTableGridFault(grid)).toBeUndefined();
    });

    it("accepts a region whose footprint stops just before another region", () => {
      const grid = table(
        [
          [cell("a"), cell("b"), cell("c", { rowSpan: 2 })],
          [cell("d", { colSpan: 2 }), EMPTY, EMPTY],
        ],
        [10, 10, 10],
      );
      expect(findTableGridFault(grid)).toBeUndefined();
    });

    it("accepts a block-less covered entry with no span of its own", () => {
      const grid = table([[cell("a", { colSpan: 2 }), EMPTY]], [10, 10]);
      expect(findTableGridFault(grid)).toBeUndefined();
    });
  });
});

describe("describeTableGridFault", () => {
  it("states a ragged row with both counts", () => {
    expect(
      describeTableGridFault({
        kind: "raggedRow",
        rowIndex: 4,
        cellCount: 2,
        gridColumnCount: 5,
      }),
    ).toBe(
      "row 4 holds 2 cells where the widest row holds 5, but every row of a table covers the same grid",
    );
  });

  it("states covered content with the position and its anchor", () => {
    expect(
      describeTableGridFault({
        kind: "coveredContent",
        rowIndex: 3,
        columnIndex: 2,
        anchorRowIndex: 1,
        anchorColumnIndex: 0,
      }),
    ).toBe(
      "the cell at row 3, column 2 lies inside the merged region anchored at row 1, column 0 but carries content of its own, and a merged region's content belongs to its anchor",
    );
  });

  it("states a covered span with the position and its anchor", () => {
    expect(
      describeTableGridFault({
        kind: "coveredSpan",
        rowIndex: 3,
        columnIndex: 2,
        anchorRowIndex: 1,
        anchorColumnIndex: 0,
      }),
    ).toBe(
      "the cell at row 3, column 2 lies inside the merged region anchored at row 1, column 0 but states a span of its own, and only a region's anchor carries a span",
    );
  });

  it("states a column overrun with the anchor's position", () => {
    expect(
      describeTableGridFault({
        kind: "anchorOverrunsColumns",
        rowIndex: 6,
        columnIndex: 7,
      }),
    ).toBe(
      "the merged region anchored at row 6, column 7 spans past the last column of the grid",
    );
  });

  it("states a row overrun with the anchor's position", () => {
    expect(
      describeTableGridFault({
        kind: "anchorOverrunsRows",
        rowIndex: 6,
        columnIndex: 7,
      }),
    ).toBe(
      "the merged region anchored at row 6, column 7 spans past the last row of the table",
    );
  });

  it("states an overlap with both anchors' positions", () => {
    expect(
      describeTableGridFault({
        kind: "overlappingAnchors",
        rowIndex: 8,
        columnIndex: 9,
        earlierAnchorRowIndex: 2,
        earlierAnchorColumnIndex: 3,
      }),
    ).toBe(
      "the merged region anchored at row 8, column 9 overlaps the region anchored at row 2, column 3, but a grid position belongs to one region only",
    );
  });
});
