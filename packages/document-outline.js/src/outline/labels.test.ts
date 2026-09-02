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
    const cells = [
      textCell(0, 1, "Revenue"),
      textCell(1, 0, "Q1"),
      numberCell(1, 1, 1000),
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
    // Row 1, column 0 is blank -- the nearest text cell above (0,0) is two rows away, not adjacent, and the row gap (1) is within the tolerance rule's own connectivity, so the two cells share a region.
    const cells = [textCell(0, 0, "Label"), numberCell(2, 0, 99)];
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
    const cells = [numberCell(5, 5, 1)];
    const label = labelFor(deriveNeighbourLabels(cells), 5, 5);
    expect(label.above).toBeUndefined();
    expect(label.left).toBeUndefined();
  });

  it("does not cross into a different, disconnected region to find a label", () => {
    // Row gap of 10 puts these two cells in separate regions (segmentSheetRegions' own adjacency tolerance is 2), so the text cell above must not be reported as a label for the far-away numeric cell even though it is the nearest text cell in that column on the sheet as a whole.
    const cells = [textCell(0, 0, "Distant"), numberCell(10, 0, 99)];
    const label = labelFor(deriveNeighbourLabels(cells), 10, 0);
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

  it("never mutates its input", () => {
    const cells = [textCell(0, 0, "Header"), numberCell(1, 0, 1)];
    const snapshot = structuredClone(cells);
    deriveNeighbourLabels(cells);
    expect(cells).toEqual(snapshot);
  });
});
