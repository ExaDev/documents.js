import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DataStreamBuilder } from "./data-stream";
import { DocFormatError } from "./errors";
import { readGrpprl } from "./prop/sprm";
import { applyTableSprms, VERT_MERGE_RESTART } from "./table/tap";
import { flattenSectionBlocks } from "./table/write";
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

describe("writeDocContent tables: vertical merge, the grid rule and TCGRF continuation writing", () => {
  it("round-trips a vertically merged cell's rowSpan, with the spanned rows carrying an empty placeholder cell", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 80 }, { widthPt: 80 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "tall" }])], rowSpan: 2 },
              { blocks: [paragraph([{ text: "top-right" }])] },
            ],
          },
          {
            cells: [
              { blocks: [] },
              { blocks: [paragraph([{ text: "bottom-right" }])] },
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
    expect(block.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("tall");
    expect(block.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(cellText(block.rows[1]?.cells[1])).toBe("bottom-right");
  });

  it("ends a vertical merge exactly after its own rowSpan, treating the very next row's cell as ordinary even when it is also blank", () => {
    // The anchor's rowSpan of 3 covers itself plus 2 continuation rows (remaining decrements 2 -> 1 -> 0 across them); a 4th row's own cell at the identical column, though also blank, sits one row past where the merge already ended and must read back as its own independent, ordinary cell — not a third continuation — pinning placeCell's own remaining > 0 boundary rather than remaining >= 0.
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 80 }, { widthPt: 80 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "anchor" }])], rowSpan: 3 },
              { blocks: [paragraph([{ text: "R0" }])] },
            ],
          },
          {
            cells: [{ blocks: [] }, { blocks: [paragraph([{ text: "R1" }])] }],
          },
          {
            cells: [{ blocks: [] }, { blocks: [paragraph([{ text: "R2" }])] }],
          },
          {
            cells: [{ blocks: [] }, { blocks: [paragraph([{ text: "R3" }])] }],
          },
          // A second blank cell at the identical column, immediately after row 3's own: if row 3 were ever wrongly written as the START of its own new merge (flattenRow's own vertMerge, independent of placeCell's remaining tracking) rather than as an ordinary cell, this row would be folded into it as a continuation, giving row 3 a spurious rowSpan of 2 instead of none at all.
          {
            cells: [{ blocks: [] }, { blocks: [paragraph([{ text: "R4" }])] }],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = tableAt(result, 0);
    expect(block.rows[0]?.cells[0]?.rowSpan).toBe(3);
    expect(cellText(block.rows[0]?.cells[0])).toBe("anchor");
    // Rows 1 and 2 are genuine continuations, carrying no rowSpan or colSpan of their own.
    expect(block.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(block.rows[2]?.cells[0]?.blocks).toEqual([]);
    // Row 3's own cell is blank too, but it is NOT part of the anchor's merge: it must read back as its own ordinary cell, with no rowSpan carried over from the anchor, and must not itself anchor a further merge into row 4.
    expect(block.rows[3]?.cells[0]?.rowSpan).toBeUndefined();
    expect(block.rows[3]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [] },
    ]);
    expect(block.rows[4]?.cells[0]?.rowSpan).toBeUndefined();
    expect(block.rows[4]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [] },
    ]);
  });

  it("throws for a cell under a vertical merge that carries content of its own, rather than silently discarding it as a continuation's contents", () => {
    // The anchor's rowSpan of 2 covers row 1's cell at the same column, and a merged region's content belongs to its anchor: a covered entry holding blocks of its own is a table that contradicts the grid rule, and writing it as a continuation would lose those blocks without a trace.
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 80 }, { widthPt: 80 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "anchor" }])], rowSpan: 2 },
              { blocks: [paragraph([{ text: "R0" }])] },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "own content" }])] },
              { blocks: [paragraph([{ text: "R1" }])] },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      "doc-codec: table at block 0 breaks the grid rule: the cell at row 1, column 0 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor",
    );
  });

  it("throws for a cell under a horizontal merge that carries content of its own", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
              { blocks: [paragraph([{ text: "hidden" }])] },
              { blocks: [paragraph([{ text: "right" }])] },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      "doc-codec: table at block 0 breaks the grid rule: the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor",
    );
  });

  it("throws a DocFormatError, the type every other malformed-table refusal here uses, for a table breaking the grid rule", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
              { blocks: [paragraph([{ text: "hidden" }])] },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocFormatError);
  });

  it("names the block index of a table breaking the grid rule when other blocks precede it", () => {
    const input = document([
      paragraph([{ text: "before" }]),
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }],
        rows: [
          { cells: [{ blocks: [] }, { blocks: [] }] },
          { cells: [{ blocks: [] }] },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      "doc-codec: table at block 1 breaks the grid rule: row 1 holds 1 cells where the widest row holds 2, but every row of a table covers the same grid",
    );
  });

  it.each([
    {
      name: "a span on a covered position",
      rows: [
        {
          cells: [
            { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
            { blocks: [], colSpan: 2 },
            { blocks: [] },
          ],
        },
      ],
      columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
    },
    {
      name: "a region running past the last column",
      rows: [
        {
          cells: [
            { blocks: [paragraph([{ text: "a" }])] },
            { blocks: [paragraph([{ text: "b" }])], colSpan: 2 },
          ],
        },
      ],
      columns: [{ widthPt: 50 }, { widthPt: 50 }],
    },
    {
      name: "a region running past the last row",
      rows: [{ cells: [{ blocks: [paragraph([{ text: "a" }])], rowSpan: 2 }] }],
      columns: [{ widthPt: 50 }],
    },
    {
      name: "two regions sharing a position",
      rows: [
        {
          cells: [
            { blocks: [paragraph([{ text: "a" }])] },
            { blocks: [paragraph([{ text: "b" }])], rowSpan: 2 },
          ],
        },
        {
          cells: [
            { blocks: [paragraph([{ text: "c" }])], colSpan: 2 },
            { blocks: [] },
          ],
        },
      ],
      columns: [{ widthPt: 50 }, { widthPt: 50 }],
    },
  ])("throws for $name", ({ rows, columns }) => {
    const input = document([{ kind: "table", columns, rows }]);
    expect(() => writeDocContent(input)).toThrow(
      /^doc-codec: table at block 0 breaks the grid rule: /,
    );
  });

  it("writes a vertical continuation at the grid column of its anchor even when a colSpan anchor precedes the rowSpan anchor in the row", () => {
    // Row 0 is [wide (cols 0-1), tall (col 2, two rows)]: in the dense form the wide anchor's covered entry sits at array position 1 and the rowSpan anchor at array position 2, so an implementation keyed on array position and one keyed on grid column agree here only by accident of the covered entry; row 1's continuation must land at grid column 2, after the two ordinary cells at columns 0 and 1.
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "tall" }])], rowSpan: 2 },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "A1" }])] },
              { blocks: [paragraph([{ text: "B1" }])] },
              ...coveredCells(1),
            ],
          },
        ],
      },
    ]);
    const block = tableAt(roundTrip(input), 0);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows.map((row) => row.cells.length)).toEqual([3, 3]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(block.rows[0]?.cells[2]?.rowSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[2])).toBe("tall");
    expect(block.rows[1]?.cells.map((cell) => cellText(cell))).toEqual([
      "A1",
      "B1",
      "",
    ]);
    expect(block.rows[1]?.cells[2]).toEqual({ blocks: [] });
  });

  it("writes a vertical continuation one physical cell wide however many adjacent columns its anchor spans, apart from a neighbouring region's continuation", () => {
    // Two rowSpan anchors side by side, the first two columns wide and the second one column wide: row 1 has three covered-from-above entries, which belong to two different anchors and so become two physical continuation cells (widths 2 and 1), not one of width 3 and not three of width 1. The decoded row mark states exactly two cells, both continuations.
    const input: readonly ContentBlock[] = [
      {
        kind: "table",
        columns: [{ widthPt: 20 }, { widthPt: 20 }, { widthPt: 20 }],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "left" }])],
                colSpan: 2,
                rowSpan: 2,
              },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "right" }])], rowSpan: 2 },
            ],
          },
          { cells: [...coveredCells(3)] },
          {
            cells: [
              { blocks: [paragraph([{ text: "a" }])] },
              { blocks: [paragraph([{ text: "b" }])] },
              { blocks: [paragraph([{ text: "c" }])] },
            ],
          },
        ],
      },
    ];
    const paragraphs = flattenSectionBlocks(input, new DataStreamBuilder());
    // Row 0: two physical cells (indices 0-1) then its row mark (index 2); row 1: two continuation cells (indices 3-4) then its row mark (index 5).
    const continuationRowMark = paragraphs[5];
    if (continuationRowMark === undefined) {
      throw new Error("expected row 1's own row-mark paragraph at index 5");
    }
    const definition = applyTableSprms(
      readGrpprl(new Uint8Array(continuationRowMark.extraGrpprl)),
      {},
    ).definition;
    expect(definition?.cells).toHaveLength(2);
    expect(definition?.columnBoundariesTwips).toEqual([0, 800, 1200]);
    expect(definition?.cells.map((cell) => cell.vertMerge)).toEqual([1, 1]);
  });

  it("does not track a merge at all for an explicit rowSpan of 1, treating the next row's identical-column cell as wholly independent", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 80 }, { widthPt: 80 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "A1" }])], rowSpan: 1 },
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
    const block = tableAt(result, 0);
    expect(block.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[0])).toBe("A1");
    expect(block.rows[1]?.cells[0]?.rowSpan).toBeUndefined();
    expect(cellText(block.rows[1]?.cells[0])).toBe("A2");
  });

  it("writes a vertical-merge anchor's own TCGRF as VERT_MERGE_RESTART, an ordinary cell's as plain 0, decoded straight from each row mark's own grpprl rather than through the schema round trip", () => {
    // table/read.ts's own rowSpan computation (vertMergeChainLastRow) only ever inspects a FOLLOWING row's own vertMerge value when deciding how far a chain reaches — never the anchor's own — so this specific byte cannot be pinned by asserting anything about the round-tripped ContentTableCell (see flattenRow's own vertMerge comment for the full reasoning). It is still a real, load-bearing byte a genuine MS-DOC consumer other than this package's own reader depends on (LibreOffice's own import, and [MS-DOC] 2.9.317 itself), so it is verified here by decoding each row mark's own grpprl directly with the identical readGrpprl/applyTableSprms pair table/read.ts itself uses, rather than round-tripping through readDocContent. A third, wholly ordinary row is included alongside the anchor and its continuation specifically so a mutant collapsing the ternary to always 3 has something to disagree with: the anchor alone cannot tell "always 3" apart from the real rowSpan > 1 test.
    const input: readonly ContentBlock[] = [
      {
        kind: "table",
        columns: [{ widthPt: 80 }],
        rows: [
          {
            cells: [{ blocks: [paragraph([{ text: "anchor" }])], rowSpan: 2 }],
          },
          { cells: [{ blocks: [] }] },
          { cells: [{ blocks: [paragraph([{ text: "ordinary" }])] }] },
        ],
      },
    ];
    const paragraphs = flattenSectionBlocks(input, new DataStreamBuilder());
    // Row 0's single cell is its own one WriteParagraph (index 0), followed by row 0's own row mark (index 1); rows 1 (the continuation) and 2 (ordinary) each follow the identical shape at indices 2-3 and 4-5.
    const anchorRowMark = paragraphs[1];
    const ordinaryRowMark = paragraphs[5];
    if (anchorRowMark === undefined || ordinaryRowMark === undefined) {
      throw new Error(
        "expected the anchor and ordinary rows' own row-mark paragraphs at indices 1 and 5",
      );
    }
    const anchorDefinition = applyTableSprms(
      readGrpprl(new Uint8Array(anchorRowMark.extraGrpprl)),
      {},
    ).definition;
    const ordinaryDefinition = applyTableSprms(
      readGrpprl(new Uint8Array(ordinaryRowMark.extraGrpprl)),
      {},
    ).definition;
    expect(anchorDefinition?.cells[0]?.vertMerge).toBe(VERT_MERGE_RESTART);
    expect(ordinaryDefinition?.cells[0]?.vertMerge).toBe(0);
  });

  it("writes TCGRF.horzMerge 2 on a lost-boundary split's own first sub-cell, whether or not that cell is also a vertical-merge continuation", () => {
    // logicalCellsForRow (table/read.ts) derives a physical cell's own colSpan purely from its physical boundaries against the table's shared canonical grid — it never actually reads a NON-continuation cell's own horzMerge value at all (only a FOLLOWING cell's horzMerge === HORZ_MERGE_CONTINUATION decides whether that following cell folds into the one before it), so this specific byte cannot be pinned through the schema round trip either, for the identical reason the vertMerge test above cannot. It is still a real, spec-conformant TCGRF value ([MS-DOC] 2.9.317: "2 or 3 ... the first cell of a horizontally merged set") this writer states for a genuine third-party MS-DOC consumer, decoded here the same direct way. A single table with one rowSpan-2, colSpan-3 anchor and its own continuation row leaves both of the merge's own two internal boundaries lost (neither row states either on its own), assigned one to each row by distributeLostBoundaries' own round-robin — so both the anchor row (isContinuation false) and the continuation row (isContinuation true) each end up splitting their own inherited span at their one assigned boundary, exercising the subSpans.length > 1 ternary in both of flattenRow's own branches at once.
    const input: readonly ContentBlock[] = [
      {
        kind: "table",
        columns: [{ widthPt: 20 }, { widthPt: 20 }, { widthPt: 20 }],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "anchor" }])],
                colSpan: 3,
                rowSpan: 2,
              },
              ...coveredCells(2),
            ],
          },
          { cells: [...coveredCells(3)] },
        ],
      },
    ];
    const paragraphs = flattenSectionBlocks(input, new DataStreamBuilder());
    // Row 0's own cell splits into 2 sub-paragraphs (indices 0-1) before its row mark (index 2); row 1's own inherited continuation likewise splits into 2 (indices 3-4) before its own row mark (index 5).
    const anchorRowMark = paragraphs[2];
    const continuationRowMark = paragraphs[5];
    if (anchorRowMark === undefined || continuationRowMark === undefined) {
      throw new Error(
        "expected both rows' own row-mark paragraphs at indices 2 and 5",
      );
    }
    const anchorDefinition = applyTableSprms(
      readGrpprl(new Uint8Array(anchorRowMark.extraGrpprl)),
      {},
    ).definition;
    const continuationDefinition = applyTableSprms(
      readGrpprl(new Uint8Array(continuationRowMark.extraGrpprl)),
      {},
    ).definition;
    expect(anchorDefinition?.cells[0]?.horzMerge).toBe(2);
    expect(continuationDefinition?.cells[0]?.horzMerge).toBe(2);
  });

  it("writes TCGRF.horzMerge plain 0 on an ordinary cell that never needed a lost-boundary split at all", () => {
    // The mirror image of the split test just above: a mutant collapsing subSpans.length > 1's own ternary to always 2 has nothing in that test to disagree with, since every cell asserted on there genuinely is split. A wholly unmerged two-cell row leaves recoverableBoundaries stating its own one internal boundary on its own, so lostBoundaries is empty and neither of flattenRow's own two subSpans.length > 1 sites ever produces anything but subSpans.length === 1 here.
    const input: readonly ContentBlock[] = [
      {
        kind: "table",
        columns: [{ widthPt: 40 }, { widthPt: 40 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "left" }])] },
              { blocks: [paragraph([{ text: "right" }])] },
            ],
          },
        ],
      },
    ];
    const paragraphs = flattenSectionBlocks(input, new DataStreamBuilder());
    // Two plain, single-paragraph cells (indices 0-1), then the row's own row mark (index 2).
    const rowMark = paragraphs[2];
    if (rowMark === undefined) {
      throw new Error("expected the row's own row-mark paragraph at index 2");
    }
    const definition = applyTableSprms(
      readGrpprl(new Uint8Array(rowMark.extraGrpprl)),
      {},
    ).definition;
    expect(definition?.cells[0]?.horzMerge).toBe(0);
    expect(definition?.cells[1]?.horzMerge).toBe(0);
  });

  it("writes TCGRF.horzMerge plain 0 on a vertical-merge continuation cell that never needed a lost-boundary split either", () => {
    // The mirror image of the plain-0 test just above, but for isContinuation's own TRUE branch specifically (flattenRow's own OTHER subSpans.length > 1 site): a mutant collapsing that branch's ternary to always 2, or its >= 1 near-miss, has nothing to disagree with in the earlier "whether or not that cell is also a vertical-merge continuation" test, since the continuation cell asserted on there genuinely IS split. A single-column table can never lose a boundary at all — there is only ever one physical cell per row, nothing for a boundary to fall between — so its continuation row's own inherited span is always subSpans.length === 1.
    const input: readonly ContentBlock[] = [
      {
        kind: "table",
        columns: [{ widthPt: 80 }],
        rows: [
          {
            cells: [{ blocks: [paragraph([{ text: "anchor" }])], rowSpan: 2 }],
          },
          { cells: [{ blocks: [] }] },
        ],
      },
    ];
    const paragraphs = flattenSectionBlocks(input, new DataStreamBuilder());
    // Row 0's single cell paragraph (index 0) then its own row mark (index 1); row 1 (the continuation) follows the identical shape at indices 2-3.
    const continuationRowMark = paragraphs[3];
    if (continuationRowMark === undefined) {
      throw new Error(
        "expected the continuation row's own row-mark paragraph at index 3",
      );
    }
    const continuationDefinition = applyTableSprms(
      readGrpprl(new Uint8Array(continuationRowMark.extraGrpprl)),
      {},
    ).definition;
    expect(continuationDefinition?.cells[0]?.horzMerge).toBe(0);
  });

  it("writes a lost-boundary split's own real content on only the first sub-cell, leaving every later one empty", () => {
    // logicalCellsForRow (table/read.ts) never surfaces a continuation sub-cell's own blocks regardless (it skips a horzMerge === HORZ_MERGE_CONTINUATION physical cell entirely, so a round-trip test cannot pin this the way flattenTable's own top-of-file note already states), so this is asserted directly against the written WriteParagraph runs rather than through readDocContent. A single-row table leaves both of its wide cell's own internal boundaries lost, splitting it into three physical sub-cells (content, continuation, continuation); a mutant writing the real content on every sub-cell instead of only the first has nothing else in this suite to disagree with it.
    const input: readonly ContentBlock[] = [
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
    ];
    const paragraphs = flattenSectionBlocks(input, new DataStreamBuilder());
    // The wide cell's own three sub-cells at indices 0-2, then the narrow cell at index 3, then the row's own row mark at index 4.
    expect(paragraphs[0]?.runs).toEqual([
      { run: { text: "wide" }, extraGrpprl: [] },
    ]);
    expect(paragraphs[1]?.runs).toEqual([]);
    expect(paragraphs[2]?.runs).toEqual([]);
  });
});
