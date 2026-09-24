import type { ContentBorder } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readDocContent } from "../read";
import { buildDoc, type DocParagraphSpec } from "../test-support/doc";
import { CELL_MARK } from "../text/special";
import {
  BOTTOM,
  INSIDE_H,
  INSIDE_V,
  LEFT,
  RIGHT,
  SPRM_P_F_IN_TABLE,
  SPRM_P_F_TTP,
  TOP,
  brc,
  cellText,
  sprmTDefTable,
  sprmTTableBorders,
  tableBlock,
  tableBordersSprm,
} from "../test-support/table";

describe("readDocContent tables, merge-aware bottom-border cascade resolution (sprmTTableBorders, ExaDev/documents.js#945)", () => {
  it("gives a vertically merged anchor the table's real bottom border when its own merge chain — not the anchor's own physical row — reaches the table's last row", () => {
    // Column 0 is vertically merged across all three rows (restart in row 0, continuation in rows 1 and 2); column 1 is plain in every row, purely to give the table a real second column. Every row states the identical six-side cascade, so brcBottom only ever reaches a cell whose own visual bottom edge is genuinely the table's last row — which, for the anchor, is row 2, not the anchor's own row 0.
    const restart = { horzMerge: 0, vertMerge: 3 }; // VerticalMergeFlag.fvmRestart.
    const continuation = { horzMerge: 0, vertMerge: 1 }; // fvmMerge.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const boundaries = [0, 1000, 2000];
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [restart, plain]),
      ...tableBordersSprm,
    ];
    const rowTwoGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [continuation, plain]),
      ...tableBordersSprm,
    ];
    const rowThreeGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [continuation, plain]),
      ...tableBordersSprm,
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "top" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "right-1" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowOneGrpprl, mark: CELL_MARK },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          {
            runs: [{ text: "right-2" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowTwoGrpprl, mark: CELL_MARK },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          {
            runs: [{ text: "right-3" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowThreeGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(3);
    const anchor = block.rows[0]?.cells[0];
    // The merge structure itself: a 3-row rowSpan, anchored in row 0.
    expect(anchor?.rowSpan).toBe(3);
    expect(cellText(anchor)).toBe("top");
    // The anchor's own row (0) is not the table's last row, so its top edge is still the ordinary first-row border — unaffected by this fix. Its bottom edge, though, IS the table's real bottom edge, because the merge chain it anchors reaches row 2 — the table's actual last row — even though row 0 itself is not that row. Before this fix, a merge anchor sitting in a non-final row always got the row cascade's insideHorizontal on its bottom side instead.
    expect(anchor?.borders).toEqual({
      top: TOP,
      left: LEFT,
      right: INSIDE_V,
      bottom: BOTTOM,
    });
    // The continuation cell physically sitting in the table's last row carries no decoration of its own — the shared schema's own convention for a vertical-merge continuation — so the table's real bottom border is carried by the anchor above, not duplicated here.
    expect(block.rows[2]?.cells[0]?.blocks).toEqual([]);
    // The plain, unmerged column still cascades ordinarily: row 2 is genuinely its own last row too.
    expect(block.rows[2]?.cells[1]?.borders).toEqual({
      top: INSIDE_H,
      left: INSIDE_V,
      right: RIGHT,
      bottom: BOTTOM,
    });
  });

  it("resolves a vertMerge anchor's real bottom edge by the table's shared grid position, not a raw physical-cell index, when the table's last row states genuinely different boundaries", () => {
    // Three grid columns (colX, col0, the vertMerge target); row 0 states all three as separate physical cells, so the target sits at physical index 2. Row 1 — the table's own last row — merges colX+col0 into one genuinely wider physical cell instead (LibreOffice's own encoding, ExaDev/documents.js#895: no TCGRF.horzMerge flag, just wider boundaries), which shifts the target's own continuation down to physical index 1 there. A cascade that matched rows by raw physical-cell index rather than shared-grid position would look at row 1's own (nonexistent) index 2 and never see the continuation's own vertMerge flag at all — exactly the divergence between array position and grid position cellReachesTableBottom's own note describes. The target's own bottom edge must still resolve to the table's real bcBottom, because its continuation reaches row 1 by grid position regardless of row 1's differently-shaped boundary array.
    const restart = { horzMerge: 0, vertMerge: 3 }; // VerticalMergeFlag.fvmRestart.
    const continuation = { horzMerge: 0, vertMerge: 1 }; // fvmMerge.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const rowZeroGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000, 3000], [plain, plain, restart]),
      ...tableBordersSprm,
    ];
    // Row 1's own rgdxaCenter has only two columns: [0, 2000] replaces colX's and col0's own separate [0, 1000, 2000] boundaries with one merged span, while the vertMerge target keeps its own width unchanged. Row 1 — the table's own real last row — states the identical tableBordersSprm too: this test is about grid-position resolution for the vertMerge chain, not about which row's own operand brcBottom is read from (a genuinely different bottom value per row is exercised by its own dedicated test below), so both rows agree here.
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 2000, 3000], [plain, continuation]),
      ...tableBordersSprm,
    ];
    const cell = (text: string): DocParagraphSpec => ({
      runs: [{ text }],
      grpprl: SPRM_P_F_IN_TABLE,
      mark: CELL_MARK,
    });
    const rowEnd = (grpprl: readonly number[]): DocParagraphSpec => ({
      runs: [],
      grpprl,
      mark: CELL_MARK,
    });
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          cell("x0"),
          cell("c0"),
          cell("anchor"),
          rowEnd(rowZeroGrpprl),
          cell("merged"),
          cell(""),
          rowEnd(rowOneGrpprl),
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(2);
    // The shared grid still reconstructs three columns even though row 1's own array only ever states two — the merged cell's own boundaries cover two of the canonical grid's segments at once.
    expect(block.columns).toHaveLength(3);
    expect(block.rows[0]?.cells).toHaveLength(3);
    expect(block.rows[1]?.cells).toHaveLength(3);
    const mergedCell = block.rows[1]?.cells[0];
    expect(mergedCell?.colSpan).toBe(2);
    expect(cellText(mergedCell)).toBe("merged");
    const anchor = block.rows[0]?.cells[2];
    expect(cellText(anchor)).toBe("anchor");
    // The core assertion: despite sitting at physical index 2 in row 0 and physical index 1 in row 1, the anchor's own continuation is still matched by grid position, giving a 2-row rowSpan and the table's real bcBottom on its own bottom edge — not the row cascade's insideHorizontal, which is what a raw physical-index match would have produced the moment it looked at row 1's own nonexistent cell 2.
    expect(anchor?.rowSpan).toBe(2);
    expect(anchor?.borders).toEqual({
      top: TOP,
      left: INSIDE_V,
      right: RIGHT,
      bottom: BOTTOM,
    });
    // The continuation cell physically sitting in the table's last row still carries no decoration of its own, exactly as the identical-boundaries case above already established.
    expect(block.rows[1]?.cells[1]?.blocks).toEqual([]);
  });

  it("gives a vertically merged anchor the table's real LAST ROW's own brcBottom, not its own row's, when the two rows state genuinely different bottom borders", () => {
    // [MS-DOC] 2.9.302's own field text: a row's brcBottom "specifies the bottom border of the row, if it is the last row in the table" — so when the anchor's own row (0) and the table's real last row (2) state genuinely DIFFERENT bottom borders, the anchor must read row 2's value, never its own row's. Column 0 is vertically merged across all three rows; column 1 is plain, purely to confirm the identical row-2 value reaches a genuinely ordinary cell too.
    const restart = { horzMerge: 0, vertMerge: 3 }; // VerticalMergeFlag.fvmRestart.
    const continuation = { horzMerge: 0, vertMerge: 1 }; // fvmMerge.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const boundaries = [0, 1000, 2000];
    const ANCHOR_ROW_BOTTOM: ContentBorder = {
      color: { r: 1, g: 0, b: 0 },
      widthPt: 2,
    };
    const TABLE_BOTTOM: ContentBorder = {
      color: { r: 0, g: 0, b: 1 },
      widthPt: 3,
    };
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [restart, plain]),
      ...sprmTTableBorders({ bottom: brc([0xff, 0x00, 0x00], 16) }),
    ];
    // The middle row states no sprmTTableBorders of its own at all — it is neither the anchor's own row nor the table's real last row, so nothing should ever read a bottom border from it.
    const rowTwoGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [continuation, plain]),
    ];
    const rowThreeGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [continuation, plain]),
      ...sprmTTableBorders({ bottom: brc([0x00, 0x00, 0xff], 24) }),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "top" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "right-1" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowOneGrpprl, mark: CELL_MARK },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          {
            runs: [{ text: "right-2" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowTwoGrpprl, mark: CELL_MARK },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          {
            runs: [{ text: "right-3" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowThreeGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(3);
    const anchor = block.rows[0]?.cells[0];
    expect(anchor?.rowSpan).toBe(3);
    // The core assertion: the anchor's own bottom border is the table's real last row's own brcBottom (blue), not its own row's (red) — before this fix, a merge anchor always inherited its own row's bottom border, which [MS-DOC] 2.9.302's own text never licenses for a row that is not genuinely the table's last.
    expect(anchor?.borders?.bottom).toEqual(TABLE_BOTTOM);
    expect(anchor?.borders?.bottom).not.toEqual(ANCHOR_ROW_BOTTOM);
    // The plain, unmerged column's own cell in the table's real last row agrees exactly — both cells' visual bottom edge is genuinely the table's own bottom edge, so both must carry the identical value.
    expect(block.rows[2]?.cells[1]?.borders?.bottom).toEqual(TABLE_BOTTOM);
  });

  it("gives a NON-merged cell in a ragged table's earlier row the table's real bottom border when no later row covers its column at all", () => {
    // Row 0 states three columns (A, B, C); row 1 — the table's own real last row — is genuinely narrower and states only two (A, B), never mentioning C at all. Nothing this reader can find sits beneath row 0's own column C, so its visual bottom edge IS the table's real bottom edge in that column, even though row 0 is not the table's last physical row and column C is not part of any vertical merge.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const rowZeroGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000, 3000], [plain, plain, plain]),
      ...tableBordersSprm,
    ];
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [plain, plain]),
      ...tableBordersSprm,
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "a0" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "b0" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "c0" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowZeroGrpprl, mark: CELL_MARK },
          {
            runs: [{ text: "a1" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "b1" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowOneGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(2);
    const columnA = block.rows[0]?.cells[0];
    const columnB = block.rows[0]?.cells[1];
    const columnC = block.rows[0]?.cells[2];
    expect(cellText(columnC)).toBe("c0");
    // Columns A and B are covered by row 1 immediately below, so their own bottom edge is still an ordinary interior one — unaffected by this fix.
    expect(columnA?.borders?.bottom).toEqual(INSIDE_H);
    expect(columnB?.borders?.bottom).toEqual(INSIDE_H);
    // The core assertion: column C's own bottom edge is the table's real bcBottom, not insideHorizontal, because row 1 never states a cell reaching that far right at all.
    expect(columnC?.borders).toEqual({
      top: TOP,
      left: INSIDE_V,
      right: RIGHT,
      bottom: BOTTOM,
    });
  });

  it("still gives a vertMerge anchor the table's real bottom border when its own chain ends before a later, ragged row drops its column", () => {
    // ExaDev/documents.js#945's own follow-up bug: the ragged-table path above only ever checked coverage starting from the ANCHOR's own row, so a merge chain's own continuation in the very next row always counted as "coverage" and permanently blocked this path for any merged cell. Column 0 is plain throughout; column 1 is vertically merged across rows 0-1, then row 2 — the table's own real last row — drops column 1 entirely, exactly as the plain-cell ragged test above drops its own last column. Nothing this reader can find sits beneath the merge chain's own last row (row 1) in column 1, so the anchor's visual bottom edge IS the table's real bottom edge there, even though the anchor's own chain never reaches row 2 at all.
    const restart = { horzMerge: 0, vertMerge: 3 }; // VerticalMergeFlag.fvmRestart.
    const continuation = { horzMerge: 0, vertMerge: 1 }; // fvmMerge.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const cell = (text: string): DocParagraphSpec => ({
      runs: [{ text }],
      grpprl: SPRM_P_F_IN_TABLE,
      mark: CELL_MARK,
    });
    const rowEnd = (grpprl: readonly number[]): DocParagraphSpec => ({
      runs: [],
      grpprl,
      mark: CELL_MARK,
    });
    const rowZeroGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [plain, restart]),
      ...tableBordersSprm,
    ];
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [plain, continuation]),
      ...tableBordersSprm,
    ];
    const rowTwoGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000], [plain]),
      ...tableBordersSprm,
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          cell("a0"),
          cell("anchor"),
          rowEnd(rowZeroGrpprl),
          cell("a1"),
          cell(""),
          rowEnd(rowOneGrpprl),
          cell("a2"),
          rowEnd(rowTwoGrpprl),
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(3);
    const anchor = block.rows[0]?.cells[1];
    expect(cellText(anchor)).toBe("anchor");
    expect(anchor?.rowSpan).toBe(2);
    // The core assertion: before this fix, row 1's own continuation cell always counted as "coverage" for column 1 when checked from the anchor's own row (0), permanently blocking this path for a merged cell — the anchor's bottom edge came back as insideHorizontal instead of the table's real bcBottom.
    expect(anchor?.borders).toEqual({
      top: TOP,
      left: INSIDE_V,
      right: RIGHT,
      bottom: BOTTOM,
    });
    // The continuation cell physically sitting in row 1 carries no decoration of its own, exactly as every other vertMerge continuation in this file.
    expect(block.rows[1]?.cells[1]?.blocks).toEqual([]);
    // The plain column is genuinely unaffected: row 2 is its own real last row directly (the first path cellReachesTableBottom checks), never touching the ragged/vertMerge paths at all.
    expect(block.rows[2]?.cells[0]?.borders?.bottom).toEqual(BOTTOM);
  });

  it("does not treat an earlier row's cell as reaching the table's bottom when a later row states a column starting further right, not just a narrower one ending sooner", () => {
    // Row 0 has two ordinary columns, [0,1000) and [1000,2000). Row 1 (the table's real last row) states only [1000,2000) — missing its FIRST column rather than its last, so column 0 has nothing beneath it in row 1 even though row 1's own single cell's startGridIndex (1) is strictly greater than column 0's own gridIndex (0), not merely equal-or-past a shorter row's end.
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowZeroGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...tableBordersSprm,
    ];
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([1000, 2000], [unmerged]),
      ...tableBordersSprm,
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "A" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "B" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowZeroGrpprl, mark: CELL_MARK },
          { runs: [{ text: "C" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowOneGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    // Column 0 has nothing beneath it in the real last row, so its own bottom edge IS the table's real bottom edge.
    expect(block.rows[0]?.cells[0]?.borders?.bottom).toEqual(BOTTOM);
  });

  it("gives a zero-width cell a colSpan of exactly 1 for later-row coverage purposes, not 0", () => {
    // Row 0 states two ordinary columns, [0,1000) and [1000,2000). Row 1 (the real last row) states THREE physical cells over the identical two boundaries, [0,1000) and a genuine zero-width [1000,1000) — [MS-DOC] 2.9.321 permits rgdxaCenter to repeat a boundary. If the zero-width cell's own colSpan were computed as 0 rather than the documented fallback of 1, row 1 would appear to leave column 1 uncovered, and row 0's own column-1 cell would incorrectly read as reaching the table's real bottom edge instead of the ordinary interior border.
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowZeroGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...tableBordersSprm,
    ];
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 1000], [unmerged, unmerged]),
      ...tableBordersSprm,
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "A" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "B" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowZeroGrpprl, mark: CELL_MARK },
          { runs: [{ text: "C" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowOneGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows[0]?.cells[1]?.borders?.bottom).toEqual(INSIDE_H);
  });

  it("gives a vertically merged anchor its own real rowSpan even when the anchor is not the table's first row", () => {
    // Anchor at row 1 (not row 0), continuing into row 2 — distinguishes lastRowInChain - rowIndex + 1 from lastRowInChain + rowIndex + 1, which agree only when rowIndex is 0.
    const restart = { horzMerge: 0, vertMerge: 3 };
    const continuation = { horzMerge: 0, vertMerge: 1 };
    const plain = { horzMerge: 0, vertMerge: 0 };
    const boundaries = [0, 1000];
    const rowZeroGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [plain]),
    ];
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [restart]),
    ];
    const rowTwoGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [continuation]),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "r0" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowZeroGrpprl, mark: CELL_MARK },
          {
            runs: [{ text: "anchor" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowOneGrpprl, mark: CELL_MARK },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowTwoGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(3);
    expect(cellText(block.rows[1]?.cells[0])).toBe("anchor");
    expect(block.rows[1]?.cells[0]?.rowSpan).toBe(2);
  });

  it("cascades a row's own brcRight onto a legacy TCGRF.horzMerge anchor, not literally the row's last physical cell", () => {
    // The identical three-cell legacy shape as the horzMerge tests above (a plain column, an anchor, and its own trailing continuation) but with the row's own sprmTTableBorders cascade applied too, so cascadeRowBorders' own isRightmostPhysicalCell check is exercised directly: the anchor (physical index 1) must still be treated as the row's real rightmost cell for brcRight, even though a further physical cell (the continuation) follows it.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const anchor = { horzMerge: 2, vertMerge: 0 };
    const continuation = { horzMerge: 1, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000, 3000], [plain, anchor, continuation]),
      ...tableBordersSprm,
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "a" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "b" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows[0]?.cells).toHaveLength(3);
    expect(cellText(block.rows[0]?.cells[1])).toBe("b");
    expect(block.rows[0]?.cells[1]?.colSpan).toBe(2);
    expect(block.rows[0]?.cells[1]?.borders?.right).toEqual(RIGHT);
  });
});
