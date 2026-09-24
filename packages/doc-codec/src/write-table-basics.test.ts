import type { ContentDocument, ContentTable } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { isDocBytes } from "./detect";
import { readDocContent } from "./read";
import { writeDocContent } from "./write";
import {
  blocksOf,
  cellText,
  coveredCells,
  document,
  paragraph,
  roundTrip,
  tableAt,
} from "./test-support/write";

describe("writeDocContent tables: basic assembly, header flags and lost-boundary recovery", () => {
  it("round-trips a simple table's rows, cells and column widths", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100 }, { widthPt: 150 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "A1" }])] },
              { blocks: [paragraph([{ text: "B1" }])] },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "A2" }])] },
              { blocks: [paragraph([{ text: "B2" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.columns.map((c) => c.widthPt)).toEqual([100, 150]);
    expect(block.rows).toHaveLength(2);
    expect(block.rows[0]?.cells.map((cell) => cellText(cell))).toEqual([
      "A1",
      "B1",
    ]);
    expect(block.rows[1]?.cells.map((cell) => cellText(cell))).toEqual([
      "A2",
      "B2",
    ]);
  });

  it("round-trips a cell holding more than one paragraph", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 200 }],
        rows: [
          {
            cells: [
              {
                blocks: [
                  paragraph([{ text: "first" }]),
                  paragraph([{ text: "second" }]),
                ],
              },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    const cell = block.rows[0]?.cells[0];
    if (cell === undefined) throw new Error("expected a cell");
    expect(cell.blocks).toHaveLength(2);
    expect(cellText(cell)).toBe("first,second");
  });

  it("round-trips a table's own row height", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [
          {
            cells: [{ blocks: [paragraph([{ text: "tall" }])] }],
            heightPt: 40,
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.rows[0]?.heightPt).toBe(40);
  });

  it("round-trips a row's own header flag, and structurally omits the key for an ordinary row rather than carrying it through as an explicit false or undefined", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [
          {
            cells: [{ blocks: [paragraph([{ text: "head" }])] }],
            isHeader: true,
          },
          {
            cells: [{ blocks: [paragraph([{ text: "body" }])] }],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.rows[0]?.isHeader).toBe(true);
    expect(block.rows[1]?.isHeader).toBeUndefined();
    expect(Object.hasOwn(block.rows[0] ?? {}, "isHeader")).toBe(true);
    expect(Object.hasOwn(block.rows[1] ?? {}, "isHeader")).toBe(false);
  });

  it("reports a column's own header flag through onWarning, rather than silently dropping it, and still writes the column's cells unchanged (ExaDev/documents.js#1398)", () => {
    // Unlike a row's own isHeader (sprmTTableHeader, stated directly per row above), [MS-DOC]'s own table grid has no header-column marker at all — the column's own cells are written exactly like any other column, and only the flag itself is reported as dropped.
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "Name" }])] },
              { blocks: [paragraph([{ text: "Score" }])] },
            ],
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    expect(warnings).toEqual([
      "doc-codec: table at block 0, column 0 is a header column, and that is dropped; this format's table grid has no header-column marker, so the column is written exactly as any other",
    ]);
    const block = tableAt(readDocContent(bytes), 0);
    expect(block.columns[0]?.isHeader).toBeUndefined();
    expect(block.rows[0]?.cells.map((cell) => cellText(cell))).toEqual([
      "Name",
      "Score",
    ]);
  });

  it("writing without an onWarning callback still succeeds instead of throwing, for a table whose column states a header flag", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100, isHeader: true }],
        rows: [{ cells: [{ blocks: [paragraph([{ text: "Name" }])] }] }],
      },
    ]);
    expect(() => writeDocContent(input)).not.toThrow();
  });

  it("reports a warning per flagged column, naming each one's own index, for non-adjacent header columns", () => {
    const input = document([
      {
        kind: "table",
        columns: [
          { widthPt: 100, isHeader: true },
          { widthPt: 100 },
          { widthPt: 100, isHeader: true },
        ],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "a" }])] },
              { blocks: [paragraph([{ text: "b" }])] },
              { blocks: [paragraph([{ text: "c" }])] },
            ],
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    expect(warnings).toEqual([
      "doc-codec: table at block 0, column 0 is a header column, and that is dropped; this format's table grid has no header-column marker, so the column is written exactly as any other",
      "doc-codec: table at block 0, column 2 is a header column, and that is dropped; this format's table grid has no header-column marker, so the column is written exactly as any other",
    ]);
  });

  it("round-trips a horizontally merged cell's colSpan via the merged row's own narrower, wider physical cells", () => {
    // A real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed not to read TCGRF.horzMerge/sprmTMerge at all for a horizontal merge — it states one purely through a merged row's own physical cell layout: fewer, wider cells than an unmerged row in the same table (ExaDev/documents.js#895). This writer matches that encoding whenever some other row in the table would otherwise reveal the merged boundary anyway, so the merged row genuinely has 2 physical cells here, not 3 — the reader recovers colSpan by comparing this row's own boundaries against the second, unmerged row's, which is what reveals that the table has 3 conceptual columns at all (see the dedicated "recovers colSpan and columns" test below for the fallback this writer uses instead when no row ever reveals that boundary on its own).
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "narrow" }])] },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "A2" }])] },
              { blocks: [paragraph([{ text: "B2" }])] },
              { blocks: [paragraph([{ text: "C2" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells).toHaveLength(3);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("wide");
    expect(block.rows[0]?.cells[1]).toEqual({ blocks: [] });
    expect(block.rows[0]?.cells[2]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[2])).toBe("narrow");
    expect(block.rows[1]?.cells.map((cell) => cellText(cell))).toEqual([
      "A2",
      "B2",
      "C2",
    ]);
  });

  it("recovers colSpan and columns via a horizontal-merge continuation cell when no row in the table ever states the boundary a merge crosses (ExaDev/documents.js#992)", () => {
    // [MS-DOC]'s own physical model (see the previous test's note) states a table's column grid entirely through the boundaries each row's own TDefTableOperand declares. When literally every row merges across the identical span — as a single-row table with one merged cell necessarily does, having no other row to compare against — the merged-pair boundary is never stated by the ordinary narrower/wider physical-cell encoding at all. table/write.ts's own lost-boundary fallback detects exactly this and keeps the boundary physically present instead: the merged cell is written as 2 physical cells, the first carrying the real content, the second an empty TCGRF.horzMerge continuation — so the row's own rgdxaCenter states all 3 of the table's columns after all.
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "narrow" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells).toHaveLength(3);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("wide");
    expect(block.rows[0]?.cells[1]).toEqual({ blocks: [] });
    expect(block.rows[0]?.cells[2]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[2])).toBe("narrow");
  });

  it("recovers colSpan and columns when every row of a multi-row table merges across the identical boundary (ExaDev/documents.js#992)", () => {
    // The previous test's single row is the simplest case of this gap; the issue itself names the general one — a boundary every row merges across identically, however many rows the table has. Both rows here merge columns 0-1 into one cell, so neither row's own rgdxaCenter would ever state that boundary under the ordinary narrower/wider encoding: the fallback must apply to both rows, not just one, since either row on its own is a table with no other row to compare against.
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "R1-wide" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "R1-narrow" }])] },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "R2-wide" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "R2-narrow" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("R1-wide");
    expect(cellText(block.rows[0]?.cells[2])).toBe("R1-narrow");
    expect(block.rows[1]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[1]?.cells[0])).toBe("R2-wide");
    expect(cellText(block.rows[1]?.cells[2])).toBe("R2-narrow");
  });

  it("recovers two adjacent lost boundaries inside a single colSpan-3 cell", () => {
    // A single-row table has no other row to state a boundary through, so both of the wide cell's own internal boundaries are lost at once — splitAtLostBoundaries must break the one cell into three physical sub-cells (content, continuation, continuation), not just one.
    const input = document([
      {
        kind: "table",
        columns: [
          { widthPt: 50 },
          { widthPt: 50 },
          { widthPt: 50 },
          { widthPt: 50 },
        ],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 3 },
              ...coveredCells(2),
              { blocks: [paragraph([{ text: "narrow" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = tableAt(result, 0);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50, 50]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(3);
    expect(cellText(block.rows[0]?.cells[0])).toBe("wide");
    expect(block.rows[0]?.cells[3]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[3])).toBe("narrow");
  });

  it("recovers non-contiguous lost boundaries when a third row states the boundary in between two that stay lost", () => {
    // Rows A and B both merge columns 0-3 into one cell, identically, so neither boundary 1 nor boundary 3 (columns 0|1 and 2|3) is ever stated by either of them. Row C merges only columns 0-1 and 2-3, which states the boundary in between (2) but not the ones either side (1 and 3) — so the table's own lost set is {1, 3}, a non-contiguous pair with a recoverable gap between them, rather than the single contiguous run every other test in this suite exercises.
    const input = document([
      {
        kind: "table",
        columns: [
          { widthPt: 20 },
          { widthPt: 20 },
          { widthPt: 20 },
          { widthPt: 20 },
          { widthPt: 20 },
        ],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "A-wide" }])], colSpan: 4 },
              ...coveredCells(3),
              { blocks: [paragraph([{ text: "A-narrow" }])] },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "B-wide" }])], colSpan: 4 },
              ...coveredCells(3),
              { blocks: [paragraph([{ text: "B-narrow" }])] },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "C-left" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "C-right" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "C-narrow" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = tableAt(result, 0);
    expect(block.columns.map((c) => c.widthPt)).toEqual([20, 20, 20, 20, 20]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(4);
    expect(cellText(block.rows[0]?.cells[0])).toBe("A-wide");
    expect(block.rows[1]?.cells[0]?.colSpan).toBe(4);
    expect(cellText(block.rows[1]?.cells[0])).toBe("B-wide");
    expect(block.rows[2]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[2]?.cells[0])).toBe("C-left");
    expect(block.rows[2]?.cells[2]?.colSpan).toBe(2);
    expect(cellText(block.rows[2]?.cells[2])).toBe("C-right");
  });

  it("keeps a cell's own background and borders on the content sub-cell after a lost-boundary split", () => {
    // The lost-boundary fallback's own content sub-cell (subIndex 0) carries the cell's real decoration exactly as an unsplit cell would; the continuation sub-cell carries none, matching a genuine TCGRF.horzMerge continuation's own contents-and-formatting-not-rendered rule.
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "wide" }])],
                colSpan: 2,
                background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
                borders: {
                  top: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
                  left: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
                  bottom: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
                  right: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
                },
              },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "narrow" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = tableAt(result, 0);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(block.rows[0]?.cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
    expect(block.rows[0]?.cells[0]?.borders?.top?.color).toEqual({
      r: 1,
      g: 0,
      b: 0,
    });
  });

  it("recovers colSpan and rowSpan together when a vertical-merge anchor's own colSpan crosses a lost boundary (ExaDev/documents.js#992)", () => {
    // The anchor (row 0) and its own vertical-merge continuation (row 1) are the table's only two rows, and both merge columns 0-2 identically — there is no third row to reveal either internal boundary, so both are lost. The fallback must split the rowSpan anchor itself, not just an ordinary cell, and must split the continuation's own inherited span the same way.
    const input = document([
      {
        kind: "table",
        columns: [
          { widthPt: 20 },
          { widthPt: 20 },
          { widthPt: 20 },
          { widthPt: 20 },
        ],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "anchor" }])],
                colSpan: 3,
                rowSpan: 2,
              },
              ...coveredCells(2),
              { blocks: [paragraph([{ text: "top-right" }])] },
            ],
          },
          {
            cells: [
              ...coveredCells(3),
              { blocks: [paragraph([{ text: "bottom-right" }])] },
            ],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = tableAt(result, 0);
    expect(block.columns.map((c) => c.widthPt)).toEqual([20, 20, 20, 20]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(3);
    expect(block.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("anchor");
    expect(cellText(block.rows[0]?.cells[3])).toBe("top-right");
    expect(block.rows.map((row) => row.cells.length)).toEqual([4, 4]);
    expect(block.rows[1]?.cells.slice(0, 3)).toEqual(coveredCells(3));
    expect(cellText(block.rows[1]?.cells[3])).toBe("bottom-right");
  });

  it("writes an ordinary, fully unmerged 20-column table without the lost-boundary fallback touching it", () => {
    // No cell here ever merges, so recoverableBoundaries states every internal boundary itself and the fallback assigns nothing to any row — an ordinary wide table stays exactly as costly as it always was, unaffected by the boundary-distribution logic that exists only for merged tables. Every one of the table's own 19 internal boundaries must come back stated: a recoverableBoundaries or column-tracking defect that silently treated some of them as unrecoverable would surface here as a spurious onWarning, not as wrong content, since flattenTable's own fallback machinery would otherwise engage for a table that never needed it at all.
    const columnCount = 20;
    const input = document([
      {
        kind: "table",
        columns: Array.from({ length: columnCount }, () => ({ widthPt: 30 })),
        rows: [
          {
            cells: Array.from({ length: columnCount }, (_unused, index) => ({
              blocks: [paragraph([{ text: `c${index}` }])],
            })),
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    const result = readDocContent(bytes);
    expect(warnings).toEqual([]);
    const block = tableAt(result, 0);
    expect(block.columns).toHaveLength(columnCount);
    expect(block.rows[0]?.cells).toHaveLength(columnCount);
    for (let index = 0; index < columnCount; index += 1) {
      expect(cellText(block.rows[0]?.cells[index])).toBe(`c${index}`);
    }
  });

  it("writes a wide table where every row merges across the entire grid without exceeding any single row's own PapxInFkp budget (ExaDev/documents.js#992 regression)", () => {
    // Every row here has exactly one cell spanning the whole grid, so none of the table's 23 internal boundaries is ever stated by any row — all 23 are lost. Splitting every row at every lost boundary (this writer's own pre-fix behaviour) would make each of the 3 rows state all 24 columns physically, which alone exceeds a PapxInFkp's own 510-byte GrpPrlAndIstd ceiling (see the README's own 15 + 22 × columns <= 487 arithmetic, which gives 21 columns as the exact per-row ceiling) even though the table has rows enough to share the work; the fix must spread the 23 boundaries across the 3 rows instead of restating every one of them in every row.
    const columnCount = 24;
    const rowCount = 3;
    const columns = Array.from({ length: columnCount }, () => ({
      widthPt: 20,
    }));
    const rows = Array.from({ length: rowCount }, (_unused, rowIndex) => ({
      cells: [
        {
          blocks: [paragraph([{ text: `row ${rowIndex}` }])],
          colSpan: columnCount,
        },
        ...coveredCells(columnCount - 1),
      ],
    }));
    const input = document([{ kind: "table", columns, rows }]);
    const result = roundTrip(input);
    const block = tableAt(result, 0);
    expect(block.columns).toHaveLength(columnCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      expect(block.rows[rowIndex]?.cells).toHaveLength(columnCount);
      expect(block.rows[rowIndex]?.cells[0]?.colSpan).toBe(columnCount);
      expect(cellText(block.rows[rowIndex]?.cells[0])).toBe(`row ${rowIndex}`);
    }
  });

  it("keeps every row's own #992 fix when a table is wide enough that one row's assigned split sits right at the per-row PapxInFkp budget (ExaDev/documents.js#1013)", () => {
    // 41 columns, 2 rows, every row merging across the whole grid: 40 internal boundaries are lost and distributed round-robin, 20 to each row. A row assigned 20 boundaries splits into 21 physical TC80 cells — exactly the ceiling an undecorated row's own row-mark grpprl can still fit alone on a PapxFkp page (15 fixed bytes — sprmPFInTable and sprmPFTtp at 3 bytes each, sprmTDefTable's own opcode and cb at 2 bytes each with no istd field of its own, TDefTableOperand's own NumberOfColumns byte and the extra (n+1)th rgdxaCenter boundary every row's TAP carries beyond the per-cell figure, and GrpPrlAndIstd's own istd prefix that buildPapxPage adds ahead of the grpprl — plus 22 bytes per physical cell+boundary pair, must stay at or under the 487-byte grpPrlAndIstd a lone paragraph can actually claim once a page's own front-reserved rgfc/BxPap bytes are subtracted from the raw 510-byte MAX_GRP_PRL_AND_ISTD ceiling — see fkp-write.ts's own fitsAloneOnPapxPage). Neither row here needs the new per-row fallback, so both keep #992's own fix intact: no warning, and the full 41-column grid recovers on read.
    const columnCount = 41;
    const rowCount = 2;
    const columns = Array.from({ length: columnCount }, () => ({
      widthPt: 20,
    }));
    const rows = Array.from({ length: rowCount }, (_unused, rowIndex) => ({
      cells: [
        {
          blocks: [paragraph([{ text: `row ${rowIndex}` }])],
          colSpan: columnCount,
        },
        ...coveredCells(columnCount - 1),
      ],
    }));
    const input = document([{ kind: "table", columns, rows }]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    expect(isDocBytes(bytes)).toBe(true);
    const block = tableAt(readDocContent(bytes), 0);
    expect(warnings).toEqual([]);
    expect(block.columns).toHaveLength(columnCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      expect(block.rows[rowIndex]?.cells[0]?.colSpan).toBe(columnCount);
    }
  });

  it("trims one over-budget row down to what fits instead of dropping all of its assigned boundaries, reporting the degradation via onWarning (ExaDev/documents.js#1013, #992 follow-up)", () => {
    // One column wider than the previous test: 41 internal boundaries now, round-robin distribution gives row 0 the extra one (21 boundaries, the odd remainder always lands on row 0) and row 1 the other 20. Row 0's own full 21-boundary split would produce 22 physical cells — one past the 21-cell ceiling the previous test sits exactly at — so flattenTable's own per-row budget check (table/write.ts) rejects it, but rather than dropping every one of row 0's assigned boundaries (this fallback's own original, all-or-nothing behaviour), it trims from the end until what remains fits: 20 of row 0's 21 boundaries survive, only the single highest-valued one is dropped. Row 1 is untouched and still states its own 20 boundaries. Combined, the two rows' own boundaries cover all but one of the table's 41 internal boundaries — 41 of 42 columns recover, not the 21 an all-or-nothing fallback would leave — and both rows' colSpan correctly reflects that near-complete, honestly-recovered grid.
    const columnCount = 42;
    const rowCount = 2;
    const columns = Array.from({ length: columnCount }, () => ({
      widthPt: 20,
    }));
    const rows = Array.from({ length: rowCount }, (_unused, rowIndex) => ({
      cells: [
        {
          blocks: [paragraph([{ text: `row ${rowIndex}` }])],
          colSpan: columnCount,
        },
        ...coveredCells(columnCount - 1),
      ],
    }));
    const input = document([{ kind: "table", columns, rows }]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    expect(isDocBytes(bytes)).toBe(true);
    const block = tableAt(readDocContent(bytes), 0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("table at block 0, row 0");
    expect(warnings[0]).toMatch(
      /could only state 20 of its 21 assigned lost column boundaries/,
    );
    expect(warnings[0]).toMatch(
      /without exceeding a PapxInFkp record's own byte budget or the format's own 63-cell-per-row ceiling/,
    );
    expect(warnings[0]).toMatch(/dropping the other 1 \(narrowing/);
    const recoveredColumnCount = columnCount - 1;
    expect(block.columns).toHaveLength(recoveredColumnCount);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(recoveredColumnCount);
    expect(block.rows[1]?.cells[0]?.colSpan).toBe(recoveredColumnCount);
    expect(cellText(block.rows[0]?.cells[0])).toBe("row 0");
    expect(cellText(block.rows[1]?.cells[0])).toBe("row 1");
  });

  it("writes a single-row table whose one merged cell's split exactly fits the per-row budget, and trims to what fits one column past it, instead of throwing or dropping every boundary (ExaDev/documents.js#1013 regression: this writer used to throw DocFormatError above 21 columns here)", () => {
    // A single-row table has no other row to share lost boundaries with, so every one of its internal boundaries is assigned to that one row (distributeLostBoundaries' own single-bucket case). 21 columns means 20 lost boundaries, splitting the merged cell into 21 physical cells — the same per-row ceiling the two-row test above sits at — and still gets #992's own fix in full. 22 columns means 21 lost boundaries, one physical cell past that ceiling: table/write.ts's own budget check now trims the assignment down to what fits instead of throwing or dropping every boundary — 20 of the 21 survive, recovering 21 of the table's 22 columns even with no sibling row to share the work with.
    const withinBudget = 21;
    const overBudget = 22;

    const buildSingleRowTable = (columnCount: number): ContentDocument =>
      document([
        {
          kind: "table",
          columns: Array.from({ length: columnCount }, () => ({ widthPt: 20 })),
          rows: [
            {
              cells: [
                {
                  blocks: [paragraph([{ text: "wide" }])],
                  colSpan: columnCount,
                },
                ...coveredCells(columnCount - 1),
              ],
            },
          ],
        },
      ]);

    const fittingWarnings: string[] = [];
    const fittingBytes = writeDocContent(buildSingleRowTable(withinBudget), {
      onWarning: (message) => {
        fittingWarnings.push(message);
      },
    });
    const fittingBlock = tableAt(readDocContent(fittingBytes), 0);
    expect(fittingWarnings).toEqual([]);
    expect(fittingBlock.columns).toHaveLength(withinBudget);
    expect(fittingBlock.rows[0]?.cells[0]?.colSpan).toBe(withinBudget);

    const overflowingWarnings: string[] = [];
    const overflowingBytes = writeDocContent(buildSingleRowTable(overBudget), {
      onWarning: (message) => {
        overflowingWarnings.push(message);
      },
    });
    expect(isDocBytes(overflowingBytes)).toBe(true);
    const overflowingBlock = tableAt(readDocContent(overflowingBytes), 0);
    expect(overflowingWarnings).toHaveLength(1);
    expect(overflowingWarnings[0]).toContain("table at block 0, row 0");
    expect(overflowingWarnings[0]).toMatch(
      /could only state 20 of its 21 assigned lost column boundaries/,
    );
    const recoveredColumnCount = overBudget - 1;
    expect(overflowingBlock.columns).toHaveLength(recoveredColumnCount);
    expect(overflowingBlock.rows[0]?.cells[0]?.colSpan).toBe(
      recoveredColumnCount,
    );
    expect(cellText(overflowingBlock.rows[0]?.cells[0])).toBe("wide");
  });

  it("falls back for a lost-boundary split past the format's own 63-cell-per-row ceiling instead of throwing, trimming to what the row-ending mark's own byte budget still allows (ExaDev/documents.js#992 follow-up: this writer used to throw DocFormatError, not fall back, past 63 physical cells here)", () => {
    // A single-row table with one cell spanning all 64 columns assigns every one of the table's 63 internal boundaries to that one row (no sibling to share with). The full split would need 64 physical cells — one past TDefTableOperand's own hard NumberOfColumns ceiling ([MS-DOC] 2.9.321's own "MUST NOT exceed 63", not 2.4.3's separate "between 1 and 63 table cells" limit) — which table/write.ts's own trial encoding used to hand straight to encodeTableRowGrpprl, throwing before the row-ending mark's own byte budget was ever tested. rowSplitFits now checks the cell count first and treats an over-ceiling split as "doesn't fit" like any other, so the same trimming loop that recovers a byte-budget overflow also recovers this one: it lands at the row-ending mark's own byte-budget ceiling (20 of the 63 assigned boundaries, 21 physical cells) long before the 63-cell limit itself would ever bind for an undecorated row.
    const columnCount = 64;
    const input = document([
      {
        kind: "table",
        columns: Array.from({ length: columnCount }, () => ({ widthPt: 20 })),
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "wide" }])],
                colSpan: columnCount,
              },
              ...coveredCells(columnCount - 1),
            ],
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    expect(isDocBytes(bytes)).toBe(true);
    const block = tableAt(readDocContent(bytes), 0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("table at block 0, row 0");
    expect(warnings[0]).toMatch(
      /could only state 20 of its 63 assigned lost column boundaries/,
    );
    expect(warnings[0]).toMatch(/63-cell-per-row ceiling/);
    const recoveredColumnCount = 21;
    expect(block.columns).toHaveLength(recoveredColumnCount);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(recoveredColumnCount);
    expect(cellText(block.rows[0]?.cells[0])).toBe("wide");
  });

  it("writing without an onWarning callback still falls back silently instead of throwing (ExaDev/documents.js#1013)", () => {
    // The degradation is reported, not gated: an onWarning-less caller must still get working bytes back, not a thrown DocFormatError, for the identical over-budget table the previous tests pass an onWarning to.
    const columnCount = 22;
    const input = document([
      {
        kind: "table",
        columns: Array.from({ length: columnCount }, () => ({ widthPt: 20 })),
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: columnCount },
              ...coveredCells(columnCount - 1),
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).not.toThrow();
  });

  it("names the degraded table by its own block index, so two over-budget tables in one document report distinguishable warnings (containing-block-index diagnostic)", () => {
    // Two tables past the same 21-column ceiling, separated by an ordinary paragraph: without a table identity in the warning, both would report the indistinguishable "table row 0", leaving a caller no way to tell which table actually degraded. Naming each by its own position in the section's blocks (1 and 3, since the leading and separating paragraphs are blocks 0 and 2) is what makes the two warnings tell apart.
    const columnCount = 22;
    const overBudgetTable: ContentTable = {
      kind: "table",
      columns: Array.from({ length: columnCount }, () => ({ widthPt: 20 })),
      rows: [
        {
          cells: [
            { blocks: [paragraph([{ text: "wide" }])], colSpan: columnCount },
            ...coveredCells(columnCount - 1),
          ],
        },
      ],
    };
    const input = document([
      paragraph([{ text: "before" }]),
      overBudgetTable,
      paragraph([{ text: "between" }]),
      overBudgetTable,
    ]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => {
        warnings.push(message);
      },
    });
    expect(isDocBytes(bytes)).toBe(true);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("table at block 1, row 0");
    expect(warnings[1]).toContain("table at block 3, row 0");
  });
});
