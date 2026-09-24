import { describe, expect, it } from "vitest";
import {
  DocumentTreeSchema,
  isSheetGroupNode,
  type ContentSheetCell,
} from "document-schema.js";
import {
  boundingRange,
  classifyRegion,
  computeSignals,
  segmentSheetRegions,
  type RegionSignals,
} from "./regions";
import { buildOutline } from "./build";
import {
  sheetCell,
  sheetGroup,
  spreadsheetPackage,
} from "../test-support/fixtures";

// Builders local to this test file: sheetCell() from test-support/fixtures only takes value+displayText, so cells that need `formula` are built by spreading its result — the same pattern the fixtures module documents for options it does not itself parameterise.
function textCell(row: number, column: number, text: string): ContentSheetCell {
  return sheetCell(row, column, { kind: "string", value: text }, text);
}

function numberCell(
  row: number,
  column: number,
  value: number,
  formula?: string,
): ContentSheetCell {
  return {
    ...sheetCell(row, column, { kind: "number", value }, String(value)),
    ...(formula !== undefined ? { formula } : {}),
  };
}

// Mirrors regions.ts's own private tuning constants (see regions.ts's own comments for what each represents) so the hand-checked assertions below stay tied to the real weights rather than restating their computed output as independent literals.
const MIXED_MARGIN = 0.15;
const PROSE_LENGTH_NORM = 40;
const TABLE_ROW_REGULARITY_WEIGHT = 0.5;
const TABLE_DENSITY_WEIGHT = 0.2;
// vitest's own toBeCloseTo precision (decimal digits), reused everywhere a floating-point score is checked.
const PRECISION_DIGITS = 10;
// The confidence floor a "high confidence" classification test asserts against.
const HIGH_CONFIDENCE_THRESHOLD = 0.9;

// A text-valued cell that also carries a `formula` field (e.g. a text-producing formula like =CONCATENATE(...)): the one shape that lets a test separately control "is this cell string-kind" (relevant to topRowTextFraction) from "does this cell count as numeric-like" (NUMERIC_VALUE_KINDS.has(kind) || formula !== undefined — true here purely because of the formula, independent of its string kind).
function formulaTextCell(
  row: number,
  column: number,
  text: string,
  formula: string,
): ContentSheetCell {
  return {
    ...sheetCell(row, column, { kind: "string", value: text }, text),
    formula,
  };
}

describe("segmentSheetRegions adjacency rule", () => {
  it("connects cells in the same column across a single blank row", () => {
    const cells = [textCell(0, 0, "a"), textCell(2, 0, "b")];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.cells).toHaveLength(2);
  });

  it("does not connect cells in the same column across two blank rows", () => {
    const rowBeyondTolerance = 3;
    const cells = [textCell(0, 0, "a"), textCell(rowBeyondTolerance, 0, "b")];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(2);
  });

  it("does not connect cells in the same column across two blank rows, however they are ordered on input", () => {
    // The reverse insertion order of the test above: connectivity is judged after sorting each column by row, so an unsorted (descending) input must not let a large negative row difference slip past the gap-tolerance check as if it were adjacent.
    const farRow = 5;
    const cells = [numberCell(farRow, 0, 1), numberCell(0, 0, 2)];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(2);
  });

  it("does not connect cells in the same row across two blank columns, however they are ordered on input", () => {
    const farColumn = 5;
    const cells = [numberCell(0, farColumn, 1), numberCell(0, 0, 2)];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(2);
  });

  it("connects cells in the same row across a single blank column", () => {
    const cells = [textCell(0, 0, "a"), textCell(0, 2, "b")];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.cells).toHaveLength(2);
  });

  it("does not connect cells in the same row across two blank columns", () => {
    const columnBeyondTolerance = 3;
    const cells = [
      textCell(0, 0, "a"),
      textCell(0, columnBeyondTolerance, "b"),
    ];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(2);
  });

  it("does not connect a diagonal jump across both a blank row and a blank column", () => {
    // (0,0) and (2,2): one blank row (row 1) AND one blank column (column 1) simultaneously — the "not both at once" case the adjacency rule's own doc comment names explicitly.
    const cells = [textCell(0, 0, "a"), textCell(2, 2, "b")];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(2);
  });

  it("chains a dense rectangular block together even though no cell is diagonally adjacent to another", () => {
    // A fully dense 3x3 grid: every cell has a same-row or same-column immediate neighbour, so the whole block is one region via transitivity even though the adjacency rule itself never directly connects a diagonal pair.
    const gridSize = 3;
    const cells: ContentSheetCell[] = [];
    for (let row = 0; row < gridSize; row++) {
      for (let column = 0; column < gridSize; column++) {
        cells.push(numberCell(row, column, row * gridSize + column));
      }
    }
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.cells).toHaveLength(gridSize * gridSize);
  });
});

describe("segmentSheetRegions classification", () => {
  it("classifies a regular grid with a header row as a table, with high confidence", () => {
    const lastColumn = 3;
    const cells: ContentSheetCell[] = [
      textCell(0, 0, "Region"),
      textCell(0, 1, "Quarter"),
      textCell(0, 2, "Revenue"),
      textCell(0, lastColumn, "Cost"),
    ];
    const gridRows = 4;
    const gridColumns = 4;
    const valueStride = 10;
    for (let row = 1; row <= gridRows; row++) {
      for (let column = 0; column < gridColumns; column++) {
        cells.push(numberCell(row, column, row * valueStride + column));
      }
    }
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("table");
    expect(regions[0]?.confidence).toBeGreaterThanOrEqual(
      HIGH_CONFIDENCE_THRESHOLD,
    );
  });

  it("classifies a column of long commentary as prose, with high confidence", () => {
    const commentary = [
      "The board reviewed quarterly performance and raised several concerns about margin.",
      "Management responded with a plan to reduce overhead across three regions by year end.",
      "No further action was agreed pending the next scheduled review meeting in the spring.",
      "A follow-up session will revisit these figures once the revised forecast is available.",
    ];
    const cells = commentary.map((text, row) => textCell(row, 0, text));
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("prose");
    expect(regions[0]?.confidence).toBeGreaterThanOrEqual(
      HIGH_CONFIDENCE_THRESHOLD,
    );
  });

  it("classifies a formula-heavy numeric grid as a model, with high confidence", () => {
    const cells: ContentSheetCell[] = [];
    const modelRows = 3;
    const modelColumns = 2;
    for (let row = 0; row < modelRows; row++) {
      for (let column = 0; column < modelColumns; column++) {
        cells.push(
          numberCell(
            row,
            column,
            row * column,
            `=A${String(row)}*B${String(column)}`,
          ),
        );
      }
    }
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("model");
    expect(regions[0]?.confidence).toBeGreaterThanOrEqual(
      HIGH_CONFIDENCE_THRESHOLD,
    );
  });

  it("classifies a region with comparably strong formula and prose signal as mixed", () => {
    const lastColumn = 3;
    const longText =
      "This single row carries both a calculation and a full sentence of commentary side by side.";
    const arbitraryValueA = 42;
    const arbitraryValueB = 7;
    const cells: ContentSheetCell[] = [
      numberCell(0, 0, arbitraryValueA, "=SUM(A1:A10)"),
      numberCell(0, 1, arbitraryValueB, "=B1*2"),
      textCell(0, 2, longText),
      textCell(0, lastColumn, longText),
    ];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("mixed");
  });

  it("classifies a lone populated cell as unknown, since one cell carries no structural signal", () => {
    const orphanPosition = 5;
    const regions = segmentSheetRegions([
      textCell(orphanPosition, orphanPosition, "orphan"),
    ]);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("unknown");
  });
});

describe("segmentSheetRegions region discovery", () => {
  it("keeps a table and a comfortably separate prose column as two distinct regions", () => {
    const lastColumn = 3;
    const tableCells: ContentSheetCell[] = [
      textCell(0, 0, "Region"),
      textCell(0, 1, "Quarter"),
      textCell(0, 2, "Revenue"),
      textCell(0, lastColumn, "Cost"),
    ];
    const gridRows = 4;
    const gridColumns = 4;
    const valueStride = 10;
    for (let row = 1; row <= gridRows; row++) {
      for (let column = 0; column < gridColumns; column++) {
        tableCells.push(numberCell(row, column, row * valueStride + column));
      }
    }
    // Column 7 sits 4 columns past the table's rightmost column (3) — comfortably past the adjacency rule's own 2-column tolerance, so no per-row alignment between the two blocks can bridge them regardless of which rows the commentary happens to occupy.
    const proseColumn = 7;
    const proseCells = [
      textCell(
        0,
        proseColumn,
        "This column is unrelated commentary sitting well away from the table above.",
      ),
      textCell(
        1,
        proseColumn,
        "It shares no row or column proximity with the table within the tolerance rule.",
      ),
      textCell(
        2,
        proseColumn,
        "So it must remain its own separate region rather than merging into the table.",
      ),
    ];
    const regions = segmentSheetRegions([...tableCells, ...proseCells]);
    expect(regions).toHaveLength(2);
    const [table, prose] = regions;
    expect(table?.classification).toBe("table");
    expect(table?.cells).toHaveLength(tableCells.length);
    expect(prose?.classification).toBe("prose");
    expect(prose?.cells).toHaveLength(proseCells.length);
  });
});

describe("segmentSheetRegions ordering", () => {
  it("sorts regions by startRow first, then by startColumn for a tie, regardless of discovery order", () => {
    // Three well-separated single-cell regions, deliberately listed out of the expected output order: B and A share a startRow (a tie the comparator's second clause must resolve), and C sits at a later row entirely.
    const farPosition = 20;
    const expectedRegionCount = 3;
    const valueC = 3;
    const cells = [
      numberCell(0, farPosition, 2), // B: row 0, column farPosition
      numberCell(farPosition, 0, valueC), // C: row farPosition, column 0
      numberCell(0, 0, 1), // A: row 0, column 0
    ];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(expectedRegionCount);
    expect(
      regions.map((region) => [
        region.range.startRow,
        region.range.startColumn,
      ]),
    ).toEqual([
      [0, 0], // A
      [0, farPosition], // B
      [farPosition, 0], // C
    ]);
  });
});

describe("boundingRange", () => {
  it("computes the min/max row and column independently, not by summing or defaulting to the first cell", () => {
    // No single cell carries both the min and the max of either axis, so a broken implementation that summed or picked the first cell's own row/column could not coincidentally pass.
    const minRow = 1;
    const maxRow = 7;
    const minColumn = 2;
    const maxColumn = 9;
    // Every row/column not named above is an "other" position: not itself a min or max on either axis, present only to prove the four bounds are read independently rather than by coincidence. Cell values themselves are arbitrary and unrelated to any bound.
    const otherRow1 = 5;
    const otherColumn1 = 3;
    const otherRow2 = 4;
    const otherColumn2 = 8;
    const cellValueC = 3;
    const cellValueD = 4;
    const cells = [
      numberCell(otherRow1, maxColumn, 1),
      numberCell(minRow, otherColumn1, 2),
      numberCell(maxRow, minColumn, cellValueC),
      numberCell(otherRow2, otherColumn2, cellValueD),
    ];
    expect(boundingRange(cells)).toEqual({
      startRow: minRow,
      startColumn: minColumn,
      endRow: maxRow,
      endColumn: maxColumn,
    });
  });
});

describe("computeSignals", () => {
  // Shared column/value positions for the header-row threshold tests below: a 5-cell top row (columns 0-4) and a shorter "other" row.
  const fourthTextColumn = 3;
  const numberColumn = 4;
  const otherRowValueA = 5;
  const otherRowValueB = 6;

  it("computes every signal precisely for a small, hand-checked sheet", () => {
    // Rows/columns deliberately start away from zero (headerRow/col0) so rowSpan/colSpan's own `max - min + 1` can't coincide with a broken `max + min + 1` the way it would if min were 0.
    const headerRow = 10;
    const dataRow = 11;
    const col0 = 20;
    const col1 = 21;
    const col2 = 22;
    const col3 = 23;
    const cellCount = 6;
    const expectedRowSpan = 2; // dataRow - headerRow + 1
    const expectedColSpan = 4; // col3 - col0 + 1
    const expectedDistinctRows = 2;
    const expectedDistinctColumns = 4;
    const headerTextLength = 7; // "Header1".length, "Header2".length
    const dataValue0 = 10;
    const dataValue1 = 20;
    const dataValue2 = 30;
    const dataValue3 = 40;
    const cells: ContentSheetCell[] = [
      textCell(headerRow, col0, "Header1"), // 7 chars
      textCell(headerRow, col1, "Header2"), // 7 chars
      numberCell(dataRow, col0, dataValue0),
      numberCell(dataRow, col1, dataValue1, "=X"),
      numberCell(dataRow, col2, dataValue2),
      numberCell(dataRow, col3, dataValue3),
    ];
    const signals = computeSignals(cells);
    expect(signals.cellCount).toBe(cellCount);
    expect(signals.rowSpan).toBe(expectedRowSpan);
    expect(signals.colSpan).toBe(expectedColSpan);
    expect(signals.distinctRows).toBe(expectedDistinctRows);
    expect(signals.distinctColumns).toBe(expectedDistinctColumns);
    expect(signals.formulaFraction).toBeCloseTo(
      1 / cellCount,
      PRECISION_DIGITS,
    );
    expect(signals.numericFraction).toBeCloseTo(
      expectedDistinctColumns / cellCount,
      PRECISION_DIGITS,
    );
    expect(signals.textFraction).toBeCloseTo(2 / cellCount, PRECISION_DIGITS);
    expect(signals.averageTextLength).toBe(headerTextLength); // (7 + 7) / 2
    // rowRegularity: row counts [2, 4], mean 3, variance ((2-3)^2+(4-3)^2)/2 = 1, so 1 - sqrt(1)/3.
    const meanRowCount = 3;
    expect(signals.rowRegularity).toBeCloseTo(
      1 - Math.sqrt(1) / meanRowCount,
      PRECISION_DIGITS,
    );
    // Top row is 100% text, and the only other row is 100% numeric — a genuine header shape.
    expect(signals.hasHeaderLikeRow).toBe(true);
  });

  it("treats every row as trivially regular when only one row is populated", () => {
    const columnCount = 3;
    const cells = Array.from({ length: columnCount }, (_, column) =>
      numberCell(0, column, column + 1),
    );
    expect(computeSignals(cells).rowRegularity).toBe(1);
  });

  it("divides the top row's string count by its own cell count, not the product, when checking the header-row text fraction", () => {
    const arbitraryValueC = 3;
    const arbitraryValueD = 4;
    const cells: ContentSheetCell[] = [
      // Top row: 1 text of 5 cells = 0.2 text fraction, well below the 0.8 threshold.
      textCell(0, 0, "a"),
      numberCell(0, 1, 1),
      numberCell(0, 2, 2),
      numberCell(0, fourthTextColumn, arbitraryValueC),
      numberCell(0, numberColumn, arbitraryValueD),
      // Other row: trivially satisfies the numeric-fraction half on its own.
      numberCell(1, 0, otherRowValueA),
      numberCell(1, 1, otherRowValueB),
    ];
    expect(computeSignals(cells).hasHeaderLikeRow).toBe(false);
  });

  it("needs only one other row to be predominantly numeric, not every other row", () => {
    const cells: ContentSheetCell[] = [
      textCell(0, 0, "a"),
      textCell(0, 1, "b"),
      textCell(0, 2, "c"),
      textCell(0, fourthTextColumn, "d"),
      numberCell(0, numberColumn, 1), // top row: 0.8 text fraction
      numberCell(1, 0, otherRowValueA),
      numberCell(1, 1, otherRowValueB), // row 1: fully numeric, qualifies
      textCell(2, 0, "x"),
      textCell(2, 1, "y"), // row 2: fully text, does NOT qualify
    ];
    expect(computeSignals(cells).hasHeaderLikeRow).toBe(true);
  });

  it("divides numericLike by the row's own cell count, not the product, when checking a row's numeric fraction", () => {
    const cells: ContentSheetCell[] = [
      textCell(0, 0, "a"),
      textCell(0, 1, "b"),
      textCell(0, 2, "c"),
      textCell(0, fourthTextColumn, "d"),
      numberCell(0, numberColumn, 1), // top row: 0.8 text fraction
      // Other row: 1 numeric of 3 cells = 0.333, below the 0.5 threshold.
      numberCell(1, 0, otherRowValueA),
      textCell(1, 1, "x"),
      textCell(1, 2, "y"),
    ];
    expect(computeSignals(cells).hasHeaderLikeRow).toBe(false);
  });

  it("hits the header-row thresholds exactly at their own inclusive boundaries (0.8 top-text fraction, 0.5 other-row numeric fraction)", () => {
    const cells: ContentSheetCell[] = [
      // Top row: 4 text + 1 number = exactly 0.8 text fraction.
      textCell(0, 0, "a"),
      textCell(0, 1, "b"),
      textCell(0, 2, "c"),
      textCell(0, fourthTextColumn, "d"),
      numberCell(0, numberColumn, 1),
      // Other row: 1 numeric + 1 plain text = exactly 0.5 numeric-like fraction.
      numberCell(1, 0, otherRowValueA),
      textCell(1, 1, "e"),
    ];
    expect(computeSignals(cells).hasHeaderLikeRow).toBe(true);
  });

  it("is not a header row when the only other row falls short of the numeric-fraction threshold", () => {
    const cells: ContentSheetCell[] = [
      textCell(0, 0, "a"),
      textCell(0, 1, "b"),
      textCell(0, 2, "c"),
      textCell(0, fourthTextColumn, "d"),
      numberCell(0, numberColumn, 1),
      textCell(1, 0, "e"), // the other row is entirely non-numeric
      textCell(1, 1, "f"),
    ];
    expect(computeSignals(cells).hasHeaderLikeRow).toBe(false);
  });

  it("never treats the top row itself as one of the 'other' rows checked for a numeric signal", () => {
    // Row 0 (the top row) is itself 100% "numeric-like" via a formula on an otherwise string-kind cell, so a check that failed to exclude the top row from its own "other rows" scan would find its own formula cells and wrongly report a header shape. Row 1, the only genuine other row, is entirely non-numeric with no formula, so a correct scan finds no qualifying other row at all.
    const cells: ContentSheetCell[] = [
      formulaTextCell(0, 0, "a", "=A1"),
      formulaTextCell(0, 1, "b", "=A2"),
      textCell(1, 0, "c"),
      textCell(1, 1, "d"),
    ];
    expect(computeSignals(cells).hasHeaderLikeRow).toBe(false);
  });

  it("counts a formula-carrying string cell as numeric-like via its formula, not its (string) value kind", () => {
    const cells: ContentSheetCell[] = [
      textCell(0, 0, "a"),
      textCell(0, 1, "b"),
      textCell(0, 2, "c"),
      textCell(0, fourthTextColumn, "d"),
      numberCell(0, numberColumn, 1),
      formulaTextCell(1, 0, "e", "=CONCAT(A1,A2)"),
      formulaTextCell(1, 1, "f", "=CONCAT(B1,B2)"),
    ];
    expect(computeSignals(cells).hasHeaderLikeRow).toBe(true);
  });
});

describe("classifyRegion", () => {
  it("returns unknown with full confidence below the minimum cell-count signal, at the exact boundary", () => {
    const oneCellSignals = computeSignals([numberCell(0, 0, 1)]);
    expect(classifyRegion(oneCellSignals)).toEqual({
      classification: "unknown",
      confidence: 1,
    });
  });

  it("does not treat exactly two cells as below the minimum-signal threshold", () => {
    const twoCellSignals = computeSignals([
      numberCell(0, 0, 1, "=A"),
      numberCell(0, 1, 2, "=B"),
    ]);
    expect(classifyRegion(twoCellSignals)).toEqual({
      classification: "model",
      confidence: 1,
    });
  });

  it("computes tableScore as a weighted blend of row regularity, header signal, and density — never a table from a single row or column", () => {
    const arbitraryValue = 3;
    const singleRow = computeSignals([
      numberCell(0, 0, 1),
      numberCell(0, 1, 2),
      numberCell(0, 2, arbitraryValue),
    ]);
    expect(classifyRegion(singleRow).classification).not.toBe("table");

    const cellCount = 3;
    const rowSpan = 2;
    const colSpan = 2;
    const rowRegularity = 0.6;
    const signals: RegionSignals = {
      cellCount,
      rowSpan,
      colSpan,
      distinctRows: 2,
      distinctColumns: 2,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: 0,
      averageTextLength: 0,
      rowRegularity,
      hasHeaderLikeRow: false,
    };
    const result = classifyRegion(signals);
    expect(result.classification).toBe("table");
    const density = cellCount / (rowSpan * colSpan);
    expect(result.confidence).toBeCloseTo(
      TABLE_ROW_REGULARITY_WEIGHT * rowRegularity +
        TABLE_DENSITY_WEIGHT * density,
      PRECISION_DIGITS,
    );
  });

  it("never scores a single-column region as a table, however regular or dense its other signals look", () => {
    const signals: RegionSignals = {
      cellCount: 1000000,
      rowSpan: 1,
      colSpan: 1,
      distinctRows: 5,
      distinctColumns: 1,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: 1,
      averageTextLength: 1000,
      rowRegularity: 1,
      hasHeaderLikeRow: true,
    };
    // Extreme rowRegularity/density values would swamp every other score if the distinctColumns > 1 guard were ever bypassed — so a correct guard must keep this a clean prose call, not table or mixed.
    expect(classifyRegion(signals)).toEqual({
      classification: "prose",
      confidence: 1,
    });
  });

  it("divides averageTextLength by PROSE_LENGTH_NORM, not the reverse, when scoring prose", () => {
    const textFraction = 0.9;
    const signals: RegionSignals = {
      cellCount: 10,
      rowSpan: 1,
      colSpan: 1,
      distinctRows: 1,
      distinctColumns: 5,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction,
      averageTextLength: textFraction * PROSE_LENGTH_NORM,
      rowRegularity: 1,
      hasHeaderLikeRow: false,
    };
    const result = classifyRegion(signals);
    expect(result.classification).toBe("prose");
    expect(result.confidence).toBeCloseTo(
      textFraction * textFraction,
      PRECISION_DIGITS,
    );
  });

  it("does not treat a score exactly at the signal threshold as too weak to trust", () => {
    const signals: RegionSignals = {
      cellCount: 10,
      rowSpan: 1,
      colSpan: 1,
      distinctRows: 1,
      distinctColumns: 5,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: 1,
      averageTextLength: 14, // 14 / 40 = 0.35, exactly SIGNAL_THRESHOLD
      rowRegularity: 1,
      hasHeaderLikeRow: false,
    };
    expect(classifyRegion(signals)).toEqual({
      classification: "prose",
      confidence: 0.35,
    });
  });

  it("computes an unknown classification's confidence as the shortfall below the threshold, not the sum with it", () => {
    const signals: RegionSignals = {
      cellCount: 10,
      rowSpan: 1,
      colSpan: 1,
      distinctRows: 1,
      distinctColumns: 5,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: 1,
      averageTextLength: 8, // 8 / 40 = 0.2, below SIGNAL_THRESHOLD
      rowRegularity: 1,
      hasHeaderLikeRow: false,
    };
    expect(classifyRegion(signals)).toEqual({
      classification: "unknown",
      confidence: 0.8,
    });
  });

  it("calls it mixed when two scores clear the signal threshold within the mixed margin of each other", () => {
    const signals: RegionSignals = {
      cellCount: 2,
      rowSpan: 2,
      colSpan: 1,
      distinctRows: 2,
      distinctColumns: 2,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: 0.8,
      averageTextLength: 32, // 32/40 = 0.8, prose = 0.8*0.8 = 0.64
      rowRegularity: 1,
      hasHeaderLikeRow: false,
    };
    // table = 0.5*1 + 0.3*0 + 0.2*(2/2) = 0.7; prose = 0.64; gap = 0.06 < MIXED_MARGIN (0.15)
    const gap = 0.06;
    const result = classifyRegion(signals);
    expect(result.classification).toBe("mixed");
    expect(result.confidence).toBeCloseTo(
      1 - gap / MIXED_MARGIN,
      PRECISION_DIGITS,
    );
  });

  it("does not call it mixed when the second-highest score itself falls short of the signal threshold", () => {
    const cellCount = 20;
    const rowSpan = 10;
    const colSpan = 10;
    const rowRegularity = 0.8;
    const signals: RegionSignals = {
      cellCount,
      rowSpan,
      colSpan,
      distinctRows: 2,
      distinctColumns: 2,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: 0.5,
      averageTextLength: 24, // 24/40 = 0.6, prose = 0.5*0.6 = 0.3, below threshold
      rowRegularity,
      hasHeaderLikeRow: false,
    };
    const result = classifyRegion(signals);
    expect(result.classification).toBe("table");
    const density = cellCount / (rowSpan * colSpan);
    expect(result.confidence).toBeCloseTo(
      TABLE_ROW_REGULARITY_WEIGHT * rowRegularity +
        TABLE_DENSITY_WEIGHT * density,
      PRECISION_DIGITS,
    );
  });

  it("treats a second-highest score exactly at the threshold as strong enough to call the region mixed", () => {
    const signals: RegionSignals = {
      cellCount: 2,
      rowSpan: 2,
      colSpan: 2,
      distinctRows: 2,
      distinctColumns: 2,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: 1,
      averageTextLength: 14, // prose = 1 * 0.35 = 0.35, exactly SIGNAL_THRESHOLD
      rowRegularity: 0.7,
      hasHeaderLikeRow: false,
    };
    // table = 0.5*0.7 + 0.2*(2/4) = 0.45; gap = 0.1 < MIXED_MARGIN
    const gap = 0.1;
    const result = classifyRegion(signals);
    expect(result.classification).toBe("mixed");
    expect(result.confidence).toBeCloseTo(
      1 - gap / MIXED_MARGIN,
      PRECISION_DIGITS,
    );
  });

  it("does not call it mixed when the top score sits exactly at the second score plus the mixed margin", () => {
    // Constructed so the comparison's two sides are BIT-IDENTICAL, not merely numerically close: proseScore is set directly via textFraction (multiplying by clamp01(40/40) = 1 introduces no rounding), and tableScore is built as (proseScore + 0.15) * 2 halved back by its own 0.5 weight — doubling then halving a normal-range double is exact, so tableScore ends up EXACTLY equal to `proseScore + 0.15`, the identical expression classifyRegion's own comparison evaluates. A gap-based `top - second < MIXED_MARGIN` formulation can never be pinned this precisely: with both scores held to [SIGNAL_THRESHOLD, 1], their difference always lands on a coarser float grid than 0.15's own stored value needs, so no achievable pair of scores can make that subtraction hit 0.15 bit-for-bit — see classifyRegion's own comment on why it compares `top < second + MIXED_MARGIN` instead. rowSpan/colSpan are set enormous purely so density's own 0.2 contribution underflows to nothing when added to the dominant term, keeping tableScore's construction exact.
    const second = 0.4;
    const rowRegularity = (second + MIXED_MARGIN) * 2;
    const signals: RegionSignals = {
      cellCount: 2,
      rowSpan: 1e8,
      colSpan: 1e8,
      distinctRows: 2,
      distinctColumns: 2,
      formulaFraction: 0,
      numericFraction: 0,
      textFraction: second,
      averageTextLength: 40,
      rowRegularity,
      hasHeaderLikeRow: false,
    };
    const result = classifyRegion(signals);
    expect(result.classification).toBe("table");
    expect(result.confidence).toBeCloseTo(
      second + MIXED_MARGIN,
      PRECISION_DIGITS,
    );
  });
});

describe("advisory contract", () => {
  it("never mutates its input, and a consumer who never calls it still sees every cell unchanged", () => {
    const cells: ContentSheetCell[] = [
      textCell(0, 0, "Header"),
      numberCell(1, 0, 1),
      numberCell(2, 0, 2),
    ];
    const snapshot = structuredClone(cells);
    const pkg = spreadsheetPackage([sheetGroup({ name: "Sheet1", cells })]);
    expect(DocumentTreeSchema.safeParse(pkg).success).toBe(true);
    const outlineBefore = buildOutline(pkg);

    segmentSheetRegions(cells);

    expect(cells).toEqual(snapshot);
    expect(buildOutline(pkg)).toEqual(outlineBefore);
    const sheetNode = pkg.children[0];
    if (!isSheetGroupNode(sheetNode))
      throw new Error("expected a sheet group node");
    expect(sheetNode.node.cells).toEqual(snapshot);
  });

  it("reuses the same cell objects in its output rather than cloning them", () => {
    const arbitraryValue = 5;
    const a = textCell(0, 0, "a");
    const b = numberCell(2, 0, arbitraryValue);
    const regions = segmentSheetRegions([a, b]);
    expect(regions[0]?.cells).toContain(a);
    expect(regions[0]?.cells).toContain(b);
  });
});
