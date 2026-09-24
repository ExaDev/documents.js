import { describe, expect, it } from "vitest";
import type { ContentSheetCell } from "document-schema.js";
import { deriveNeighbourLabels } from "./labels";
import { sheetCell } from "../test-support/fixtures";

function textCell(row: number, column: number, text: string): ContentSheetCell {
  return sheetCell(row, column, { kind: "string", value: text }, text);
}

function numberCell(
  row: number,
  column: number,
  value: number,
): ContentSheetCell {
  return sheetCell(row, column, { kind: "number", value }, String(value));
}

function labelFor(
  labels: readonly ReturnType<typeof deriveNeighbourLabels>[number][],
  row: number,
  column: number,
) {
  const found = labels.find(
    (label) => label.cell.row === row && label.cell.column === column,
  );
  if (found === undefined)
    throw new Error(`no label entry for (${String(row)},${String(column)})`);
  return found;
}

describe("deriveNeighbourLabels", () => {
  it("finds an immediately adjacent above label and left label, each at distance 1 and confidence 1", () => {
    const arbitraryValue = 1000;
    const cells = [
      textCell(0, 1, "Revenue"),
      textCell(1, 0, "Q1"),
      numberCell(1, 1, arbitraryValue),
    ];
    const label = labelFor(deriveNeighbourLabels(cells), 1, 1);
    expect(label.above).toEqual({
      ref: { row: 0, column: 1 },
      text: "Revenue",
      distance: 1,
      confidence: 1,
    });
    expect(label.left).toEqual({
      ref: { row: 1, column: 0 },
      text: "Q1",
      distance: 1,
      confidence: 1,
    });
  });

  it("looks past a blank immediate neighbour to find the nearest text cell further away", () => {
    // Row 1, column 0 is blank — the nearest text cell above (0,0) is two rows away, not adjacent, and the row gap (1) is within the tolerance rule's own connectivity, so the two cells share a region.
    const arbitraryValue = 99;
    const cells = [textCell(0, 0, "Label"), numberCell(2, 0, arbitraryValue)];
    const label = labelFor(deriveNeighbourLabels(cells), 2, 0);
    expect(label.above).toEqual({
      ref: { row: 0, column: 0 },
      text: "Label",
      distance: 2,
      confidence: 0.5,
    });
    expect(label.left).toBeUndefined();
  });

  it("gets no label at all for a cell with nothing findable above or left, rather than a fabricated one", () => {
    const row = 5;
    const column = 5;
    const cells = [numberCell(row, column, 1)];
    const label = labelFor(deriveNeighbourLabels(cells), row, column);
    expect(label.above).toBeUndefined();
    expect(label.left).toBeUndefined();
    // Absence must be a genuinely missing key, not a key present with value undefined — the module's own documented "no fabricated placeholder" contract.
    expect("above" in label).toBe(false);
    expect("left" in label).toBe(false);
  });

  it("never treats a text cell's own position as a candidate for its own label", () => {
    const cells = [textCell(0, 0, "Solo")];
    const label = labelFor(deriveNeighbourLabels(cells), 0, 0);
    expect(label.above).toBeUndefined();
    expect(label.left).toBeUndefined();
  });

  it("excludes non-string cells from neighbour search even when they sit closer than the nearest text cell", () => {
    const distance = 3;
    const arbitraryNearValue = 50;
    const arbitraryTargetValue = 99;
    const cells = [
      textCell(0, 0, "Header"),
      numberCell(1, 0, arbitraryNearValue),
      numberCell(distance, 0, arbitraryTargetValue), // target
    ];
    const label = labelFor(deriveNeighbourLabels(cells), distance, 0);
    expect(label.above).toEqual({
      ref: { row: 0, column: 0 },
      text: "Header",
      distance,
      confidence: 1 / distance,
    });
  });

  it("finds the nearest of two text cells sharing a column via the above search", () => {
    // "Near" must be the SECOND text cell inserted into column 0's own candidate list — so that if the second-and-later push into that list's array were ever dropped, "Near" would be missing entirely and "Far" would wrongly win by default, rather than merely losing a tie-break it was never going to win anyway.
    const targetRow = 4;
    const cells = [
      textCell(0, 0, "Far"),
      textCell(2, 0, "Near"),
      numberCell(targetRow, 0, 1), // target
    ];
    const label = labelFor(deriveNeighbourLabels(cells), targetRow, 0);
    expect(label.above).toEqual({
      ref: { row: 2, column: 0 },
      text: "Near",
      distance: 2,
      confidence: 0.5,
    });
  });

  it("finds the nearest of two text cells sharing a row via the left search", () => {
    // Same ordering requirement as the column case above, mirrored onto row 0's own candidate list.
    const targetColumn = 4;
    const cells = [
      textCell(0, 0, "Far"),
      textCell(0, 2, "Near"),
      numberCell(0, targetColumn, 1), // target
    ];
    const label = labelFor(deriveNeighbourLabels(cells), 0, targetColumn);
    expect(label.left).toEqual({
      ref: { row: 0, column: 2 },
      text: "Near",
      distance: 2,
      confidence: 0.5,
    });
  });

  it("never lets a farther candidate overwrite an already-found nearer one", () => {
    // Processed in an order where the genuinely nearest candidate (row 6) comes FIRST — a check that failed to skip farther candidates afterward would let row 2 or row 4 wrongly overwrite it, landing on the wrong (farther) row instead of silently agreeing by coincidence of processing order.
    const closestRow = 6;
    const farRow2 = 4;
    const targetRow = 8;
    const arbitraryTargetValue = 99;
    const cells = [
      textCell(closestRow, 0, "Closest"),
      textCell(2, 0, "Far1"),
      textCell(farRow2, 0, "Far2"),
      numberCell(targetRow, 0, arbitraryTargetValue), // target
    ];
    const label = labelFor(deriveNeighbourLabels(cells), targetRow, 0);
    expect(label.above).toEqual({
      ref: { row: closestRow, column: 0 },
      text: "Closest",
      distance: 2,
      confidence: 0.5,
    });
  });

  it("computes distance as the gap between positions, not their sum, when the nearest label sits away from position zero", () => {
    const targetRow = 4;
    const cells = [
      numberCell(0, 0, 1),
      textCell(2, 0, "Mid"),
      numberCell(targetRow, 0, 2), // target
    ];
    const label = labelFor(deriveNeighbourLabels(cells), targetRow, 0);
    expect(label.above).toEqual({
      ref: { row: 2, column: 0 },
      text: "Mid",
      distance: 2,
      confidence: 0.5,
    });
  });

  it("does not cross into a different, disconnected region to find a label", () => {
    // Row gap of 10 puts these two cells in separate regions (segmentSheetRegions' own adjacency tolerance is 2), so the text cell above must not be reported as a label for the far-away numeric cell even though it is the nearest text cell in that column on the sheet as a whole.
    const targetRow = 10;
    const arbitraryValue = 99;
    const cells = [
      textCell(0, 0, "Distant"),
      numberCell(targetRow, 0, arbitraryValue),
    ];
    const label = labelFor(deriveNeighbourLabels(cells), targetRow, 0);
    expect(label.above).toBeUndefined();
  });

  it("emits exactly one label entry per populated cell", () => {
    const cells = [
      textCell(0, 0, "Header"),
      numberCell(1, 0, 1),
      numberCell(2, 0, 2),
    ];
    expect(deriveNeighbourLabels(cells)).toHaveLength(cells.length);
  });

  it("keeps the first candidate on a genuine position tie, never the second", () => {
    // Two distinct text cells sharing the identical row and column: real documents never produce two cells at the same coordinate, but nothing in ContentSheetCell's own shape forbids a hand-built array from carrying one, and nearestTextCell's tie-break reduce must still be pinned to a specific, deterministic winner rather than left to whichever comparison direction happens to compile.
    const targetRow = 4;
    const cells = [
      textCell(2, 0, "First"),
      textCell(2, 0, "Second"),
      numberCell(targetRow, 0, 1), // target
    ];
    const label = labelFor(deriveNeighbourLabels(cells), targetRow, 0);
    expect(label.above?.text).toBe("First");
  });

  it("never mutates its input", () => {
    const cells = [textCell(0, 0, "Header"), numberCell(1, 0, 1)];
    const snapshot = structuredClone(cells);
    deriveNeighbourLabels(cells);
    expect(cells).toEqual(snapshot);
  });
});
