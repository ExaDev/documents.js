import { describe, expect, it } from "vitest";
import {
  DocumentTreeSchema,
  isSheetGroupNode,
  type ContentSheetCell,
} from "document-schema.js";
import { segmentSheetRegions } from "./regions";
import { buildOutline } from "./build";
import {
  sheetCell,
  sheetGroup,
  spreadsheetPackage,
} from "../test-support/fixtures";

// Builders local to this test file: sheetCell() from test-support/fixtures only takes value+displayText, so cells that need `formula` are built by spreading its result -- the same pattern the fixtures module documents for options it does not itself parameterise.
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

describe("segmentSheetRegions adjacency rule", () => {
  it("connects cells in the same column across a single blank row", () => {
    const cells = [textCell(0, 0, "a"), textCell(2, 0, "b")];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.cells).toHaveLength(2);
  });

  it("does not connect cells in the same column across two blank rows", () => {
    const cells = [textCell(0, 0, "a"), textCell(3, 0, "b")];
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
    const cells = [textCell(0, 0, "a"), textCell(0, 3, "b")];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(2);
  });

  it("does not connect a diagonal jump across both a blank row and a blank column", () => {
    // (0,0) and (2,2): one blank row (row 1) AND one blank column (column 1) simultaneously -- the "not both at once" case the adjacency rule's own doc comment names explicitly.
    const cells = [textCell(0, 0, "a"), textCell(2, 2, "b")];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(2);
  });

  it("chains a dense rectangular block together even though no cell is diagonally adjacent to another", () => {
    // A fully dense 3x3 grid: every cell has a same-row or same-column immediate neighbour, so the whole block is one region via transitivity even though the adjacency rule itself never directly connects a diagonal pair.
    const cells: ContentSheetCell[] = [];
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        cells.push(numberCell(row, column, row * 3 + column));
      }
    }
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.cells).toHaveLength(9);
  });
});

describe("segmentSheetRegions classification", () => {
  it("classifies a regular grid with a header row as a table, with high confidence", () => {
    const cells: ContentSheetCell[] = [
      textCell(0, 0, "Region"),
      textCell(0, 1, "Quarter"),
      textCell(0, 2, "Revenue"),
      textCell(0, 3, "Cost"),
    ];
    for (let row = 1; row <= 4; row++) {
      for (let column = 0; column < 4; column++) {
        cells.push(numberCell(row, column, row * 10 + column));
      }
    }
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("table");
    expect(regions[0]?.confidence).toBeGreaterThanOrEqual(0.9);
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
    expect(regions[0]?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies a formula-heavy numeric grid as a model, with high confidence", () => {
    const cells: ContentSheetCell[] = [];
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 2; column++) {
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
    expect(regions[0]?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies a region with comparably strong formula and prose signal as mixed", () => {
    const longText =
      "This single row carries both a calculation and a full sentence of commentary side by side.";
    const cells: ContentSheetCell[] = [
      numberCell(0, 0, 42, "=SUM(A1:A10)"),
      numberCell(0, 1, 7, "=B1*2"),
      textCell(0, 2, longText),
      textCell(0, 3, longText),
    ];
    const regions = segmentSheetRegions(cells);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("mixed");
  });

  it("classifies a lone populated cell as unknown, since one cell carries no structural signal", () => {
    const regions = segmentSheetRegions([textCell(5, 5, "orphan")]);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("unknown");
  });
});

describe("segmentSheetRegions region discovery", () => {
  it("keeps a table and a comfortably separate prose column as two distinct regions", () => {
    const tableCells: ContentSheetCell[] = [
      textCell(0, 0, "Region"),
      textCell(0, 1, "Quarter"),
      textCell(0, 2, "Revenue"),
      textCell(0, 3, "Cost"),
    ];
    for (let row = 1; row <= 4; row++) {
      for (let column = 0; column < 4; column++) {
        tableCells.push(numberCell(row, column, row * 10 + column));
      }
    }
    // Column 7 sits 4 columns past the table's rightmost column (3) -- comfortably past the adjacency rule's own 2-column tolerance, so no per-row alignment between the two blocks can bridge them regardless of which rows the commentary happens to occupy.
    const proseCells = [
      textCell(
        0,
        7,
        "This column is unrelated commentary sitting well away from the table above.",
      ),
      textCell(
        1,
        7,
        "It shares no row or column proximity with the table within the tolerance rule.",
      ),
      textCell(
        2,
        7,
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
    const a = textCell(0, 0, "a");
    const b = numberCell(2, 0, 5);
    const regions = segmentSheetRegions([a, b]);
    expect(regions[0]?.cells).toContain(a);
    expect(regions[0]?.cells).toContain(b);
  });
});
