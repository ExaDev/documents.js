import { walkTableGrid } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readDocContent } from "../read";
import { buildDoc, type DocParagraphSpec } from "../test-support/doc";
import { CELL_MARK } from "../text/special";
import {
  SPRM_P_F_IN_TABLE,
  SPRM_P_F_TTP,
  cellText,
  sprmTDefTable,
  tableBlock,
} from "../test-support/table";
// The tolerance the reconstruction snaps boundaries within is one point, and ContentTableColumn.widthPt is stated in points, so every expectation below is written in points and every drift is written as a fraction of one — restated here from the point's own definition rather than imported from table/read.ts, so the two agree only if both are right.
const TWIPS_PER_POINT = 20;

// The exact rgdxaCenter a real LibreOffice 26.2.5.2-authored three-column table states, taken from a 2.5cm/3.1cm/4.7cm .fodt converted with `soffice --headless --convert-to doc` — widths deliberately chosen not to land on whole twips, and still byte-identical in every one of that table's rows. That is why no LibreOffice-derived fixture in this package ever exercises per-row drift: LibreOffice rounds a table's columns to twips once for the whole table, not once per row (ExaDev/documents.js#898).
const LIBREOFFICE_ROW_BOUNDARIES = [0, 2338, 5238, 9638];
/** The same table's columns in points, the shape a reconstruction that recognises its rows as sharing one grid produces: 2338/20, 2900/20, 4400/20. */
const LIBREOFFICE_COLUMN_WIDTHS_PT = [116.9, 145, 220];
/** That middle column's own width, 145pt: the distance the zero-width-cell case below pulls its right boundary back by so the two coincide. */
const MIDDLE_COLUMN_WIDTH_TWIPS = 2900;
/** The boundary between that table's first and second columns: the single int16 the tolerance sweep patched inside a real LibreOffice-authored file's second row, and the one a row merging those two columns omits from its own array entirely. */
const INTERIOR_BOUNDARY_INDEX = 1;
/** Word's own default for an unindented table's first rgdxaCenter entry, confirmed against LibreOffice's WW8 importer source (a named -108 constant, "Word sets the first nCenter value to -108 when no indent is used") — plausibly the format's own 108-twip default cell margin, sprmTCellPaddingDefault ([MS-DOC] 2.6.3), compensated for, though neither source states that link outright (see the README's own identical hedge). Also the size of the real-world one-row leading indent the mode-2 case below uses. */
const WORD_DEFAULT_CELL_MARGIN_TWIPS = 108;

function withBoundaryShifted(
  boundariesTwips: readonly number[],
  index: number,
  deltaTwips: number,
): number[] {
  return boundariesTwips.map((boundary, at) =>
    at === index ? boundary + deltaTwips : boundary,
  );
}

// Builds a whole table's paragraph sequence from nothing but each row's own rgdxaCenter array and its cells' text. No cell carries a TC80.tcgrf merge flag and no sprmTMerge or sprmTVertMerge is written, so any colSpan that comes back was reconstructed purely by comparing these boundary arrays against each other — which is exactly what the column-grid union does, and the only thing these tests are about.
function tableParagraphs(
  rows: readonly {
    boundariesTwips: readonly number[];
    cells: readonly string[];
  }[],
): DocParagraphSpec[] {
  const unmerged = { horzMerge: 0, vertMerge: 0 };
  return rows.flatMap((row): DocParagraphSpec[] => [
    ...row.cells.map((text): DocParagraphSpec => ({
      runs: [{ text }],
      grpprl: SPRM_P_F_IN_TABLE,
      mark: CELL_MARK,
    })),
    {
      runs: [],
      grpprl: [
        ...SPRM_P_F_IN_TABLE,
        ...SPRM_P_F_TTP,
        ...sprmTDefTable(
          row.boundariesTwips,
          row.cells.map(() => unmerged),
        ),
      ],
      mark: CELL_MARK,
    },
  ]);
}

function readTableFromRowBoundaries(
  rows: readonly {
    boundariesTwips: readonly number[];
    cells: readonly string[];
  }[],
) {
  return tableBlock(
    readDocContent(buildDoc({ paragraphs: tableParagraphs(rows) })),
  );
}

function colSpansPerRow(
  block: ReturnType<typeof tableBlock>,
): (number | undefined)[][] {
  return block.rows.map((row) => row.cells.map((cell) => cell.colSpan));
}

// [MS-DOC] 2.6.3 states a table's column layout per row, and 2.9.321's rgdxaCenter is a plain array of twip offsets from the page margin with no coarser quantum defined anywhere — so two rows meaning the identical grid may legally disagree by a twip or two, and reconstructing the shared grid from them needs a tolerance rather than exact integer equality (ExaDev/documents.js#898). The threshold is one point, matching what a real, independent [MS-DOC] implementation applies to the identical per-row-boundaries-to-shared-grid problem: LibreOffice's `#define COLFUZZY 20` twips (sw/source/filter/inc/wrtswtbl.hxx), applied by its own ODF export — the point at which its per-row table model is projected onto one shared grid, not its .doc importer, which preserves per-row drift untouched — whose changeover was confirmed empirically at exactly 20/21 by round-tripping a single patched int16 through LibreOffice 26.2.5.2's own .doc import followed by that ODF export.
describe("readDocContent table column grids, from hand-assembled rgdxaCenter arrays", () => {
  it("reads rows stating the identical LibreOffice-authored boundary array as one shared three-column grid", () => {
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a1", "b1", "c1"],
      },
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a2", "b2", "c2"],
      },
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a3", "b3", "c3"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual(
      LIBREOFFICE_COLUMN_WIDTHS_PT,
    );
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
  });

  it("reads a row whose interior boundary drifts a single twip as part of the same column grid, not a phantom hairline column", () => {
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a1", "b1", "c1"],
      },
      {
        boundariesTwips: withBoundaryShifted(
          LIBREOFFICE_ROW_BOUNDARIES,
          INTERIOR_BOUNDARY_INDEX,
          1,
        ),
        cells: ["a2", "b2", "c2"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual(
      LIBREOFFICE_COLUMN_WIDTHS_PT,
    );
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
    expect(
      block.rows.map((row) => row.cells.map((cell) => cellText(cell))),
    ).toEqual([
      ["a1", "b1", "c1"],
      ["a2", "b2", "c2"],
    ]);
  });

  it("still collapses a boundary drifting a full point, the widest gap the tolerance absorbs", () => {
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a1", "b1", "c1"],
      },
      {
        boundariesTwips: withBoundaryShifted(
          LIBREOFFICE_ROW_BOUNDARIES,
          INTERIOR_BOUNDARY_INDEX,
          TWIPS_PER_POINT,
        ),
        cells: ["a2", "b2", "c2"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual(
      LIBREOFFICE_COLUMN_WIDTHS_PT,
    );
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
  });

  // One twip past the tolerance the rows genuinely do describe different grids, and the reconstruction says so rather than absorbing the difference: the sliver between the two boundaries becomes its own column, with each row's first cell spanning whichever pair of segments its own boundaries cover. This is the same shape LibreOffice's own importer produces from the identical bytes at the identical threshold — the tolerance moves where the split happens, it does not remove the split.
  it("keeps a boundary drifting one point and one twip as its own column, matching where LibreOffice's own importer splits", () => {
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a1", "b1", "c1"],
      },
      {
        boundariesTwips: withBoundaryShifted(
          LIBREOFFICE_ROW_BOUNDARIES,
          INTERIOR_BOUNDARY_INDEX,
          TWIPS_PER_POINT + 1,
        ),
        cells: ["a2", "b2", "c2"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([
      116.9, 1.05, 143.95, 220,
    ]);
    expect(colSpansPerRow(block)).toEqual([
      [undefined, 2, undefined, undefined],
      [2, undefined, undefined, undefined],
    ]);
  });

  // Word writes -108 rather than 0 as an unindented table's first rgdxaCenter entry (LibreOffice's own WW8 importer carries the fact as a named comment in ww8par2.cxx's CalcDefaults), compensating for [MS-DOC]'s own 108-twip default cell margin. Every row states it, so the rows still describe one grid — and the indent itself has nowhere to land, since ContentTable carries only rows and columns (see the README's own note).
  it("reads rows sharing Word's own -108 leading offset as one grid, carrying the column widths and dropping the offset", () => {
    const wordUnindented = LIBREOFFICE_ROW_BOUNDARIES.map(
      (boundary) => boundary - WORD_DEFAULT_CELL_MARGIN_TWIPS,
    );
    const block = readTableFromRowBoundaries([
      { boundariesTwips: wordUnindented, cells: ["a1", "b1", "c1"] },
      { boundariesTwips: wordUnindented, cells: ["a2", "b2", "c2"] },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual(
      LIBREOFFICE_COLUMN_WIDTHS_PT,
    );
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
  });

  // A leading indent that only ONE row carries is not drift and is not absorbed: sprmTWidthBefore ([MS-DOC] 2.6.3) makes a per-row leading indent a first-class construct, and rgdxaCenter's own first entry is "the horizontal position of the logical left edge of the table, as indented from the logical left page margin" (2.9.321) — so rows disagreeing about it genuinely occupy different horizontal extents. The reconstructed grid honestly carries the extra boundary, with the rows that begin further left spanning both segments. LibreOffice 26.2.5.2 reads the identical bytes into the identical shape: four columns, a table:number-columns-spanned="2" anchor and a real table:covered-table-cell on those rows.
  it("keeps a leading indent only one row states as a real boundary, spanning it on the rows that begin further left", () => {
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a1", "b1", "c1"],
      },
      {
        boundariesTwips: withBoundaryShifted(
          LIBREOFFICE_ROW_BOUNDARIES,
          0,
          WORD_DEFAULT_CELL_MARGIN_TWIPS,
        ),
        cells: ["a2", "b2", "c2"],
      },
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a3", "b3", "c3"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([5.4, 111.5, 145, 220]);
    expect(colSpansPerRow(block)).toEqual([
      [2, undefined, undefined, undefined],
      [undefined, undefined, undefined, undefined],
      [2, undefined, undefined, undefined],
    ]);
  });

  // The tolerance must not swallow a genuine horizontal merge, whose own boundary gap is a whole column wide rather than a twip. These are the real arrays a LibreOffice-authored table with a merged first row states (ExaDev/documents.js#895): the merged row's own rgdxaCenter is an exact subset of the unmerged rows'.
  it("still reconstructs a horizontal merge from a real LibreOffice-authored merged row's own narrower boundary array", () => {
    const mergedRow = LIBREOFFICE_ROW_BOUNDARIES.filter(
      (_, index) => index !== INTERIOR_BOUNDARY_INDEX,
    );
    const block = readTableFromRowBoundaries([
      { boundariesTwips: mergedRow, cells: ["merged", "c1"] },
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a2", "b2", "c2"],
      },
      {
        boundariesTwips: LIBREOFFICE_ROW_BOUNDARIES,
        cells: ["a3", "b3", "c3"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual(
      LIBREOFFICE_COLUMN_WIDTHS_PT,
    );
    expect(colSpansPerRow(block)).toEqual([
      [2, undefined, undefined],
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
    expect(cellText(block.rows[0]?.cells[0])).toBe("merged");
  });

  // rgdxaCenter's entries "MUST be in non-decreasing order" ([MS-DOC] 2.9.321) — equal adjacent entries, and so a genuine zero-width physical cell, are explicitly legal. Such a cell covers no segment of the reconstructed grid, and a dense row holds one entry per grid column, so it has no entry of its own: its content moves into the cell beside it rather than being dropped.
  it("moves a legal zero-width physical cell's content into the preceding cell rather than giving it a grid column of its own", () => {
    // The same table's array with its third boundary pulled back onto its second, collapsing the middle column to nothing: 0, 2338, 2338, 9638.
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: withBoundaryShifted(
          LIBREOFFICE_ROW_BOUNDARIES,
          INTERIOR_BOUNDARY_INDEX + 1,
          -MIDDLE_COLUMN_WIDTH_TWIPS,
        ),
        cells: ["a", "b", "c"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([116.9, 365]);
    expect(colSpansPerRow(block)).toEqual([[undefined, undefined]]);
    expect(block.rows[0]?.cells.map((cell) => cellText(cell))).toEqual([
      "a,b",
      "c",
    ]);
  });

  it("moves a zero-width cell at the table's right edge, whose own boundary is the grid's last, into the preceding cell", () => {
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 1000, 1000], cells: ["a", "z"] },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50]);
    expect(block.rows[0]?.cells.map((cell) => cellText(cell))).toEqual(["a,z"]);
  });

  it("moves a leading zero-width cell's content into the first following cell only, not into every later one", () => {
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 0, 1000, 2000], cells: ["z", "x", "y"] },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50]);
    expect(block.rows[0]?.cells.map((cell) => cellText(cell))).toEqual([
      "z,x",
      "y",
    ]);
  });

  it("keeps a row's zero-width cells as they stand when no cell of the row owns a grid column to take their content", () => {
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 0], cells: ["z"] },
    ]);
    expect(block.rows[0]?.cells.map((cell) => cellText(cell))).toEqual(["z"]);
  });

  // The clamp effectiveColumnBoundaryTolerance exists for: this writer has no equivalent of LibreOffice's own MINLAY minimum-cell-width widening, so nothing stops a real producer's rgdxaCenter from stating a column genuinely narrower than the tolerance's own one-point default — and a single row's own adjacent boundaries are never ambiguous about how many columns that row states, whatever the gap between them. A single-row table with no cross-row drift at all isolates this: if the tolerance folded a real narrow column into its neighbour here, that would be exactly the same defect the drift tolerance exists to fix, applied to the wrong pair of boundaries.
  it("keeps a genuinely narrow column intact rather than folding it into its neighbour", () => {
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: [0, 1000, 1010, 3000],
        cells: ["a", "b", "c"],
      },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 0.5, 99.5]);
    expect(colSpansPerRow(block)).toEqual([[undefined, undefined, undefined]]);
  });

  it("still applies the ordinary one-point tolerance to cross-row drift when no row states a narrower real column", () => {
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 2000, 3000], cells: ["a", "b"] },
      { boundariesTwips: [0, 2001, 3000], cells: ["a", "b"] },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([100, 50]);
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("narrows the drift tolerance to below a real column any row in the same table states, rather than the fixed one-point default", () => {
    // Row 1 states a genuine 10-twip column (0.5pt) between 1000 and 1010, so the table-wide tolerance clamps to 9 twips — one less than that gap. Row 2's own boundary at 1025 is 15 twips from row 1's 1010, further than the clamped 9-twip tolerance but within the un-clamped one-point (20-twip) default: without the clamp this boundary would fold into 1010 and silently widen the real narrow column into whatever gap it shares with 1025. With it, 1025 stays its own boundary.
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 1000, 1010, 3000], cells: ["a", "b", "c"] },
      { boundariesTwips: [0, 1025, 3000], cells: ["a", "b"] },
    ]);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 0.5, 0.75, 98.75]);
  });
});

/** A cell to hand-assemble: its text, and the TC80 horizontal/vertical merge flags it states (both default to none). */
interface MergeFlaggedCell {
  readonly text: string;
  readonly horzMerge?: number;
  readonly vertMerge?: number;
}

// Like tableParagraphs, but each cell states its own TC80.tcgrf merge flags so a vertical merge can be hand-assembled alongside the boundary-derived horizontal ones.
function mergeFlaggedTableParagraphs(
  rows: readonly {
    boundariesTwips: readonly number[];
    cells: readonly MergeFlaggedCell[];
  }[],
): DocParagraphSpec[] {
  return rows.flatMap((row): DocParagraphSpec[] => [
    ...row.cells.map((cell): DocParagraphSpec => ({
      runs: [{ text: cell.text }],
      grpprl: SPRM_P_F_IN_TABLE,
      mark: CELL_MARK,
    })),
    {
      runs: [],
      grpprl: [
        ...SPRM_P_F_IN_TABLE,
        ...SPRM_P_F_TTP,
        ...sprmTDefTable(
          row.boundariesTwips,
          row.cells.map((cell) => ({
            horzMerge: cell.horzMerge ?? 0,
            vertMerge: cell.vertMerge ?? 0,
          })),
        ),
      ],
      mark: CELL_MARK,
    },
  ]);
}

// The rows' grid positions that walkTableGrid classifies as covered, as "row,column<-anchorRow,anchorColumn": the shared definition of which entries a merged region covers, run over what the reader produced.
function coveredPositions(block: ReturnType<typeof tableBlock>): string[] {
  return walkTableGrid(block)
    .flat()
    .flatMap((position) =>
      position.anchorRowIndex === undefined
        ? []
        : [
            `${position.rowIndex},${position.columnIndex}<-${position.anchorRowIndex},${position.anchorColumnIndex}`,
          ],
    );
}

const VERT_MERGE_RESTART = 3;
const VERT_MERGE_CONTINUATION_FLAG = 1;

describe("readDocContent tables state one entry per grid column (ExaDev/documents.js#1316)", () => {
  it("emits a block-less entry at each column a horizontal merge covers, with the anchor carrying colSpan", () => {
    const block = tableBlock(
      readDocContent(
        buildDoc({
          paragraphs: mergeFlaggedTableParagraphs([
            {
              boundariesTwips: [0, 2000, 3000],
              cells: [{ text: "wide" }, { text: "narrow" }],
            },
            {
              boundariesTwips: [0, 1000, 2000, 3000],
              cells: [{ text: "a" }, { text: "b" }, { text: "c" }],
            },
          ]),
        }),
      ),
    );
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows.map((row) => row.cells.length)).toEqual([3, 3]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(block.rows[0]?.cells[1]).toEqual({ blocks: [] });
    expect(cellText(block.rows[0]?.cells[2])).toBe("narrow");
    expect(coveredPositions(block)).toEqual(["0,1<-0,0"]);
  });

  it("emits a block-less entry at each row a vertical merge covers, at the anchor's own column", () => {
    const block = tableBlock(
      readDocContent(
        buildDoc({
          paragraphs: mergeFlaggedTableParagraphs([
            {
              boundariesTwips: [0, 1000, 2000],
              cells: [
                { text: "tall", vertMerge: VERT_MERGE_RESTART },
                { text: "r0" },
              ],
            },
            {
              boundariesTwips: [0, 1000, 2000],
              cells: [
                { text: "", vertMerge: VERT_MERGE_CONTINUATION_FLAG },
                { text: "r1" },
              ],
            },
            {
              boundariesTwips: [0, 1000, 2000],
              cells: [
                { text: "", vertMerge: VERT_MERGE_CONTINUATION_FLAG },
                { text: "r2" },
              ],
            },
          ]),
        }),
      ),
    );
    expect(block.rows.map((row) => row.cells.length)).toEqual([2, 2, 2]);
    expect(block.rows[0]?.cells[0]?.rowSpan).toBe(3);
    expect(block.rows[1]?.cells[0]).toEqual({ blocks: [] });
    expect(block.rows[2]?.cells[0]).toEqual({ blocks: [] });
    expect(coveredPositions(block)).toEqual(["1,0<-0,0", "2,0<-0,0"]);
  });

  it("emits a block-less entry at every position a 2x2 merge covers, however the row's own physical cells state it", () => {
    // Rows 0 and 1 state the merged region as one 2000-twip cell and a continuation of it; row 2 states the fuller grid that reveals the interior boundary.
    const block = tableBlock(
      readDocContent(
        buildDoc({
          paragraphs: mergeFlaggedTableParagraphs([
            {
              boundariesTwips: [0, 2000, 3000],
              cells: [
                { text: "big", vertMerge: VERT_MERGE_RESTART },
                { text: "x0" },
              ],
            },
            {
              boundariesTwips: [0, 2000, 3000],
              cells: [
                { text: "", vertMerge: VERT_MERGE_CONTINUATION_FLAG },
                { text: "x1" },
              ],
            },
            {
              boundariesTwips: [0, 1000, 2000, 3000],
              cells: [{ text: "a" }, { text: "b" }, { text: "c" }],
            },
          ]),
        }),
      ),
    );
    expect(block.rows.map((row) => row.cells.length)).toEqual([3, 3, 3]);
    const anchor = block.rows[0]?.cells[0];
    expect(anchor?.colSpan).toBe(2);
    expect(anchor?.rowSpan).toBe(2);
    expect(cellText(anchor)).toBe("big");
    expect(block.rows[0]?.cells[1]).toEqual({ blocks: [] });
    expect(block.rows[1]?.cells[0]).toEqual({ blocks: [] });
    expect(block.rows[1]?.cells[1]).toEqual({ blocks: [] });
    expect(cellText(block.rows[1]?.cells[2])).toBe("x1");
    expect(coveredPositions(block)).toEqual([
      "0,1<-0,0",
      "1,0<-0,0",
      "1,1<-0,0",
    ]);
  });

  it("fills a row narrower than the table's shared grid with block-less entries so every row is as long as the table's own columns array", () => {
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 1000, 2000, 3000], cells: ["a", "b", "c"] },
      { boundariesTwips: [0, 1000, 2000], cells: ["d", "e"] },
    ]);
    expect(block.rows.map((row) => row.cells.length)).toEqual([3, 3]);
    expect(block.rows[1]?.cells[2]).toEqual({ blocks: [] });
  });

  it("carries a row's own height onto its dense row", () => {
    const block = tableBlock(
      readDocContent(
        buildDoc({
          paragraphs: [
            {
              runs: [{ text: "a" }],
              grpprl: SPRM_P_F_IN_TABLE,
              mark: CELL_MARK,
            },
            {
              runs: [],
              grpprl: [
                ...SPRM_P_F_IN_TABLE,
                ...SPRM_P_F_TTP,
                ...sprmTDefTable([0, 1000], [{ horzMerge: 0, vertMerge: 0 }]),
                ...[0x07, 0x94, 0x90, 0x01], // sprmTDyaRowHeight: 400 twips.
              ],
              mark: CELL_MARK,
            },
          ],
        }),
      ),
    );
    expect(block.rows[0]?.heightPt).toBe(20);
  });

  it("carries a row's own sprmTTableHeader onto its dense row, and leaves an ordinary row unflagged", () => {
    const rowMarkGrpprl = (header: boolean): number[] => [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000], [{ horzMerge: 0, vertMerge: 0 }]),
      ...(header ? [0x04, 0x34, 0x01] : []), // sprmTTableHeader, one-byte flag.
    ];
    const block = tableBlock(
      readDocContent(
        buildDoc({
          paragraphs: [
            {
              runs: [{ text: "h" }],
              grpprl: SPRM_P_F_IN_TABLE,
              mark: CELL_MARK,
            },
            { runs: [], grpprl: rowMarkGrpprl(true), mark: CELL_MARK },
            {
              runs: [{ text: "b" }],
              grpprl: SPRM_P_F_IN_TABLE,
              mark: CELL_MARK,
            },
            { runs: [], grpprl: rowMarkGrpprl(false), mark: CELL_MARK },
          ],
        }),
      ),
    );
    expect(block.rows.map((row) => row.isHeader)).toEqual([true, undefined]);
  });
});
