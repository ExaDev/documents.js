import type { ContentBorder } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readDocContent } from "../read";
import { buildDoc } from "../test-support/doc";
import { CELL_MARK } from "../text/special";
import { BORDERS_TO_APPLY, SHD_SIZE } from "./decoration";
import {
  BOTTOM,
  INSIDE_H,
  INSIDE_V,
  LEFT,
  NIL_BRC,
  NIL_BRC80,
  RIGHT,
  SPRM_P_F_IN_TABLE,
  SPRM_P_F_TTP,
  TOP,
  brc,
  brc80,
  shdBackground,
  sprmTDefTable,
  sprmTSetBrc,
  sprmTSetBrc80,
  sprmTSetShdTable,
  sprmTTableBorders,
  sprmTTableBorders80,
  tableBlock,
  tableBordersSprm,
} from "../test-support/table";

describe("readDocContent tables, border and shading cascade precedence (sprmTTableBorders, ExaDev/documents.js#945)", () => {
  it("cascades all six sides onto a 2x2 table's own cells, purely from each cell's own position in the whole table", () => {
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...tableBordersSprm,
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "B" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
          {
            runs: [{ text: "C" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "D" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(2);
    const row0 = block.rows[0]?.cells ?? [];
    const row1 = block.rows[1]?.cells ?? [];
    expect(row0[0]?.borders).toEqual({
      top: TOP,
      left: LEFT,
      right: INSIDE_V,
      bottom: INSIDE_H,
    });
    expect(row0[1]?.borders).toEqual({
      top: TOP,
      right: RIGHT,
      left: INSIDE_V,
      bottom: INSIDE_H,
    });
    expect(row1[0]?.borders).toEqual({
      top: INSIDE_H,
      left: LEFT,
      bottom: BOTTOM,
      right: INSIDE_V,
    });
    expect(row1[1]?.borders).toEqual({
      top: INSIDE_H,
      right: RIGHT,
      bottom: BOTTOM,
      left: INSIDE_V,
    });
  });

  it("lets a cell's own explicit TC80 border take precedence over the row-level cascade, regardless of which comes first in the grpprl", () => {
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const explicitTop = brc80(4, 0x02); // 0.5pt solid blue, TC80's own palette-indexed spelling — deliberately a different colour and width from tableBordersSprm's own brcTop, so a leaked cascade value is unmistakable.
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...tableBordersSprm,
      ...sprmTDefTable(
        [0, 1000, 2000],
        [{ ...unmerged, borders: { top: explicitTop } }, unmerged],
      ),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "B" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const cells = tableBlock(document).rows[0]?.cells ?? [];
    expect(cells[0]?.borders?.top).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 0.5,
    });
    expect(cells[1]?.borders?.top).toEqual(TOP);
  });

  it("cascades sprmTTableBorders80's palette-indexed Brc80 fields the same way as the modern spelling", () => {
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000], [unmerged]),
      ...sprmTTableBorders80({
        top: brc80(8, 0x06), // red
        bottom: brc80(8, 0x02), // blue
        left: brc80(8, 0x04), // green
        right: brc80(8, 0x07), // yellow
      }),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const cell = tableBlock(document).rows[0]?.cells[0];
    expect(cell?.borders).toEqual({
      top: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
      bottom: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
      left: { color: { r: 0, g: 1, b: 0 }, widthPt: 1 },
      right: { color: { r: 1, g: 1, b: 0 }, widthPt: 1 },
    });
  });

  it("cascades sprmTSetShdTable's whole-row background onto every cell in the row", () => {
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...sprmTSetShdTable(shdBackground([0xff, 0xff, 0x00])),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "B" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const cells = tableBlock(document).rows[0]?.cells ?? [];
    expect(cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
    expect(cells[1]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
  });

  it("lets a later, more specific sprmTDefTableShd override an earlier sprmTSetShdTable, the ordinary last-Prl-wins fold every other shading sprm already follows", () => {
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    // sprmTSetShdTable's own text carries none of sprmTTableBorders's "unless modified" exception, so it folds in grpprl order like every other shading sprm rather than always yielding to a per-cell one.
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...sprmTSetShdTable(shdBackground([0xff, 0xff, 0x00])),
      // sprmTDefTableShd (0xD612): a single-entry rgShd naming only cell 0 — "cells past its end keep whatever an earlier sprm left them" (tap.ts's own applyShdArray note), so cell 1's own whole-table yellow survives untouched while cell 0's is overridden.
      ...[0x12, 0xd6, SHD_SIZE, ...shdBackground([0x00, 0xff, 0x00])],
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "B" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const cells = tableBlock(document).rows[0]?.cells ?? [];
    expect(cells[0]?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
    expect(cells[1]?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
  });

  // ExaDev/documents.js#945, round-1 review: a cell's own sprmTSetBrc explicitly clearing a side (a NilBrc) must never be refilled by the row-level cascade — applyBrcToCell's own clearedSides is what makes this distinguishable from a side the cell simply never mentioned, since TC80's own Brc80 fields cannot state the difference on their own. A 1x2 row, every one of sprmTTableBorders's six sides red, plus sprmTSetBrc(itcFirst 0, itcLim 1, bordersToApply 0x01 [top], NilBrc) naming only cell 0's own top side.
  it("does not refill a cell's own top border after sprmTSetBrc explicitly clears it to a NilBrc", () => {
    const RED: ContentBorder = { color: { r: 1, g: 0, b: 0 }, widthPt: 1 };
    const redSide = brc([0xff, 0x00, 0x00], 8);
    const allRedTableBorders = sprmTTableBorders({
      top: redSide,
      left: redSide,
      bottom: redSide,
      right: redSide,
      insideHorizontal: redSide,
      insideVertical: redSide,
    });
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...allRedTableBorders,
      ...sprmTSetBrc(0, 1, BORDERS_TO_APPLY.top, NIL_BRC),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "B" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const cells = tableBlock(document).rows[0]?.cells ?? [];
    // Cell 0's own sprmTSetBrc states "no top border" explicitly — the row's own red cascade must never refill it, even though this is both the table's first and last row (so an unfixed cascade would otherwise supply rowBorders.top here).
    expect(cells[0]?.borders?.top).toBeUndefined();
    expect(cells[0]?.borders).toEqual({ left: RED, right: RED, bottom: RED });
    // Cell 1 never mentions its own top side at all, so it still inherits the row's cascade there.
    expect(cells[1]?.borders).toEqual({
      top: RED,
      left: RED,
      right: RED,
      bottom: RED,
    });
  });

  // ExaDev/documents.js#945, round-5: sprmTSetBrc80 (0xD620), the Word 97-era sibling of sprmTSetBrc, was not read at all — the SPRM_T_* constants in tap.ts covered up to 0xD62F but skipped 0xD620 entirely, so a genuine Word-97-era NilBrc80 clear never reached applyBrcToCell and clearedSides never recorded it. The identical 1x2/all-red-cascade setup as the sprmTSetBrc test immediately above, but stating the top-side clear through sprmTSetBrc80's own palette-indexed Brc80MayBeNil instead of sprmTSetBrc's exact-colour BrcMayBeNil.
  it("does not refill a cell's own top border after sprmTSetBrc80 explicitly clears it to a NilBrc80", () => {
    const RED: ContentBorder = { color: { r: 1, g: 0, b: 0 }, widthPt: 1 };
    const redSide = brc([0xff, 0x00, 0x00], 8);
    const allRedTableBorders = sprmTTableBorders({
      top: redSide,
      left: redSide,
      bottom: redSide,
      right: redSide,
      insideHorizontal: redSide,
      insideVertical: redSide,
    });
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...allRedTableBorders,
      ...sprmTSetBrc80(0, 1, BORDERS_TO_APPLY.top, NIL_BRC80),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "B" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const cells = tableBlock(document).rows[0]?.cells ?? [];
    // Cell 0's own sprmTSetBrc80 states "no top border" explicitly — the row's own red cascade must never refill it, exactly like the sprmTSetBrc case above.
    expect(cells[0]?.borders?.top).toBeUndefined();
    expect(cells[0]?.borders).toEqual({ left: RED, right: RED, bottom: RED });
    // Cell 1 never mentions its own top side at all, so it still inherits the row's cascade there.
    expect(cells[1]?.borders).toEqual({
      top: RED,
      left: RED,
      right: RED,
      bottom: RED,
    });
  });

  // The second symptom the same missing SPRM_T_SET_BRC80 case caused, worse than the clear above: a real per-cell border override stated only through sprmTSetBrc80 was silently discarded entirely (never folded into RawCell.borders at all), so cascadeRowBorders' own `cell.borders?.top ?? rowBorders.top` fallback saw an unstated side and filled in the cascade's own border instead of the cell's real one. Same 1x2/all-red-cascade setup, but cell 0's own top side is restated with a real, distinct blue border via sprmTSetBrc80 rather than cleared.
  it("lets a real border stated via sprmTSetBrc80 override the row-level cascade, not the other way round", () => {
    const RED: ContentBorder = { color: { r: 1, g: 0, b: 0 }, widthPt: 1 };
    const BLUE: ContentBorder = { color: { r: 0, g: 0, b: 1 }, widthPt: 2 };
    const redSide = brc([0xff, 0x00, 0x00], 8);
    const allRedTableBorders = sprmTTableBorders({
      top: redSide,
      left: redSide,
      bottom: redSide,
      right: redSide,
      insideHorizontal: redSide,
      insideVertical: redSide,
    });
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [unmerged, unmerged]),
      ...allRedTableBorders,
      ...sprmTSetBrc80(0, 1, BORDERS_TO_APPLY.top, brc80(16, 0x02)),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "A" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "B" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const cells = tableBlock(document).rows[0]?.cells ?? [];
    // Cell 0's own sprmTSetBrc80 states a real blue top border — the row's own red cascade must never overwrite it, even though nothing in TC80 itself states a top border for this cell.
    expect(cells[0]?.borders).toEqual({
      top: BLUE,
      left: RED,
      right: RED,
      bottom: RED,
    });
    // Cell 1 never mentions its own top side at all, so it still inherits the row's red cascade there.
    expect(cells[1]?.borders).toEqual({
      top: RED,
      left: RED,
      right: RED,
      bottom: RED,
    });
  });
});
