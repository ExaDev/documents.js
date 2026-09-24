import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { readDocContent } from "../read";
import { buildDoc } from "../test-support/doc";
import { CELL_MARK } from "../text/special";
import {
  SPRM_P_F_IN_TABLE,
  SPRM_P_F_TTP,
  cellText,
  sprmPFInnerTableCell,
  sprmPFInnerTtp,
  sprmPItap,
  sprmTDefTable,
  sprmTMerge,
  sprmTVertMerge,
  tableBlock,
} from "../test-support/table";
describe("readDocContent tables, from hand-assembled bytes", () => {
  it("reads a row's sprmTDefTable column layout and a horizontal merge stated purely through sprmTMerge", () => {
    // Three columns, none merged by TC80.tcgrf itself — the merge across columns 0-1 comes entirely from the row mark's own sprmTMerge, folded on top per tap.ts's documented precedence.
    const boundaries = [0, 1000, 2000, 3000];
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [unmerged, unmerged, unmerged]),
      ...sprmTMerge(0, 2),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "AB" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "C" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows).toHaveLength(1);
    const cells = block.rows[0]?.cells ?? [];
    expect(cells).toHaveLength(3);
    expect(cells[0]?.colSpan).toBe(2);
    expect(cellText(cells[0])).toBe("AB");
    expect(cells[1]).toEqual({ blocks: [] });
    expect(cells[2]?.colSpan).toBeUndefined();
    expect(cellText(cells[2])).toBe("C");
  });

  it("folds sprmTMerge onto the column layout even when it precedes sprmTDefTable in the grpprl", () => {
    const boundaries = [0, 1000, 2000];
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTMerge(0, 2),
      ...sprmTDefTable(boundaries, [unmerged, unmerged]),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "AB" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    const cells = block.rows[0]?.cells ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[0]?.colSpan).toBe(2);
    expect(cellText(cells[0])).toBe("AB");
    expect(cells[1]).toEqual({ blocks: [] });
  });

  it("reads a row's own TC80.tcgrf vertical merge across two rows with no sprmTMerge involved", () => {
    const boundaries = [0, 1000, 2000];
    const restart = { horzMerge: 0, vertMerge: 3 }; // VerticalMergeFlag.fvmRestart.
    const continuation = { horzMerge: 0, vertMerge: 1 }; // fvmMerge.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [restart, plain]),
    ];
    const rowTwoGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [continuation, plain]),
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
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(2);
    const anchor = block.rows[0]?.cells[0];
    expect(anchor?.rowSpan).toBe(2);
    expect(cellText(anchor)).toBe("top");
    expect(block.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(cellText(block.rows[1]?.cells[1])).toBe("right-2");
  });

  it("reads a vertical merge stated incrementally through sprmTVertMerge rather than TC80.tcgrf", () => {
    const boundaries = [0, 1000, 2000];
    const plain = { horzMerge: 0, vertMerge: 0 };
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [plain, plain]),
      ...sprmTVertMerge(0, 3), // fvmRestart on cell 0.
    ];
    const rowTwoGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(boundaries, [plain, plain]),
      ...sprmTVertMerge(0, 1), // fvmMerge (continuation) on cell 0.
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
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows).toHaveLength(2);
    const anchor = block.rows[0]?.cells[0];
    expect(anchor?.rowSpan).toBe(2);
    expect(cellText(anchor)).toBe("top");
    expect(block.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(cellText(block.rows[1]?.cells[1])).toBe("right-2");
  });

  it("recurses into a table nested inside a table cell, at the depth sprmPItap and sprmPFInnerTableCell/sprmPFInnerTtp state", () => {
    // [MS-DOC] 2.4.3: at depth 1, a cell mark is a real 0x0007 character; at depth 2, the identical role is played by an ordinary paragraph mark (0x000D) carrying sprmPFInnerTableCell (a cell boundary) or sprmPFInnerTtp (the row's own terminating mark) instead — so every nested paragraph below defaults to the ordinary PARAGRAPH_MARK (buildDoc's own default) rather than setting `mark` at all.
    const nestedBoundaries = [0, 1000, 2000];
    const nestedUnmerged = { horzMerge: 0, vertMerge: 0 };
    const nestedRowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...sprmPItap(2),
      ...sprmPFInnerTtp,
      ...sprmTDefTable(nestedBoundaries, [nestedUnmerged, nestedUnmerged]),
    ];
    const outerRowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 3000], [nestedUnmerged]),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "N1" }],
            grpprl: [
              ...SPRM_P_F_IN_TABLE,
              ...sprmPItap(2),
              ...sprmPFInnerTableCell,
            ],
          },
          {
            runs: [{ text: "N2" }],
            grpprl: [
              ...SPRM_P_F_IN_TABLE,
              ...sprmPItap(2),
              ...sprmPFInnerTableCell,
            ],
          },
          { runs: [], grpprl: nestedRowGrpprl },
          // The outer cell's own cell mark: a separate, empty depth-1 paragraph closing the outer cell after its nested table, exactly as an ordinary depth-1 cell's own trailing empty paragraph already does elsewhere in this file.
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: outerRowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const outer = tableBlock(document);
    expect(outer.rows).toHaveLength(1);
    const outerCell = outer.rows[0]?.cells[0];
    if (outerCell === undefined) throw new Error("expected the outer cell");
    const nested = outerCell.blocks[0];
    if (nested?.kind !== "table") {
      throw new Error(`expected a nested table, got '${nested?.kind}'`);
    }
    expect(nested.columns.map((c) => c.widthPt)).toEqual([50, 50]);
    expect(nested.rows).toHaveLength(1);
    expect(cellText(nested.rows[0]?.cells[0])).toBe("N1");
    expect(cellText(nested.rows[0]?.cells[1])).toBe("N2");
  });

  // A row-ending mark with no direct sprmTDefTable is a real producer's own legal choice (sprmPTableProps' indirect TAP, per the README's own scope note) that this reader does not follow — degrading the run back to flat paragraphs rather than refusing the whole document, exactly as an indirect Papx elsewhere in this package already degrades a paragraph's own properties rather than failing its read.
  it("degrades to flat paragraphs, rather than refusing the whole document, when a row's own terminating mark carries no sprmTDefTable", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "cell" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [],
            grpprl: [...SPRM_P_F_IN_TABLE, ...SPRM_P_F_TTP],
            mark: CELL_MARK,
          },
          { runs: [{ text: "after" }] },
        ],
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.every((block) => block.kind === "paragraph")).toBe(true);
    expect(
      blocks.map((block) =>
        block.kind === "paragraph"
          ? block.runs.map((run) => run.text).join("")
          : "",
      ),
    ).toEqual(["cell", "", "after"]);
  });

  it("degrades to flat paragraphs when a row's own cell marks disagree with its TAP's declared column count", () => {
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable(
        [0, 1000, 2000],
        [
          { horzMerge: 0, vertMerge: 0 },
          { horzMerge: 0, vertMerge: 0 },
        ],
      ),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "only cell" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.every((block) => block.kind === "paragraph")).toBe(true);
  });

  it("still throws when a table's paragraphs end without a row-ending mark to close the last cell, since the stream itself is truncated", () => {
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [
            {
              runs: [{ text: "unclosed" }],
              grpprl: SPRM_P_F_IN_TABLE,
              mark: CELL_MARK,
            },
          ],
        }),
      ),
    ).toThrow(DocFormatError);
  });

  // The genuine third-party encoding ExaDev/documents.js#895 fixed: two rows with no TCGRF.horzMerge/sprmTMerge signal anywhere, but each declaring its own, differently-shaped rgdxaCenter — row one's own narrower, wider physical cell states a horizontal merge purely as a real per-row column layout, exactly as a genuine LibreOffice-authored .doc does (see the README's own third-party verification finding). This exercises table/read.ts's own column-grid union directly, independently of write.ts's round trips against this package's own writer.
  it("reconstructs colSpan from a row's own narrower, wider physical cells against a second row's fuller column layout, with no merge flag anywhere", () => {
    const unmerged = { horzMerge: 0, vertMerge: 0 };
    const rowOneGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 2000, 3000], [unmerged, unmerged]),
    ];
    const rowTwoGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000, 3000], [unmerged, unmerged, unmerged]),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "wide" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          {
            runs: [{ text: "narrow" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowOneGrpprl, mark: CELL_MARK },
          { runs: [{ text: "a" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "b" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "c" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowTwoGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows).toHaveLength(2);
    const rowOneCells = block.rows[0]?.cells ?? [];
    expect(rowOneCells).toHaveLength(3);
    expect(rowOneCells[0]?.colSpan).toBe(2);
    expect(cellText(rowOneCells[0])).toBe("wide");
    expect(rowOneCells[1]).toEqual({ blocks: [] });
    expect(rowOneCells[2]?.colSpan).toBeUndefined();
    expect(cellText(rowOneCells[2])).toBe("narrow");
    const rowTwoCells = block.rows[1]?.cells ?? [];
    expect(rowTwoCells).toHaveLength(3);
    expect(rowTwoCells.map((cell) => cell.colSpan)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(rowTwoCells.map((cell) => cellText(cell))).toEqual(["a", "b", "c"]);
  });

  it("finds a legacy TCGRF.horzMerge anchor's own right edge even when it is not the row's last physical cell", () => {
    // Three physical cells: a plain column, an anchor, and a legacy continuation of that anchor — so the anchor (physical index 1) is the row's real rightmost cell, even though a further physical cell (the continuation) follows it.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const anchor = { horzMerge: 2, vertMerge: 0 };
    const continuation = { horzMerge: 1, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000, 3000], [plain, anchor, continuation]),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "a" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "b" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows[0]?.cells).toHaveLength(3);
    expect(block.rows[0]?.cells[1]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[1])).toBe("b");
    expect(block.rows[0]?.cells[2]).toEqual({ blocks: [] });
  });

  it("skips an orphaned legacy TCGRF.horzMerge continuation cell that has no anchor before it", () => {
    const orphan = { horzMerge: 1, vertMerge: 0 }; // the row's own first physical cell, with nothing before it to anchor.
    const plain = { horzMerge: 0, vertMerge: 0 };
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000, 2000], [orphan, plain]),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          {
            runs: [{ text: "kept" }],
            grpprl: SPRM_P_F_IN_TABLE,
            mark: CELL_MARK,
          },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    // The orphan states no cell of its own, so its grid column is filled with a block-less entry and "kept" stays at the column its own boundaries name.
    expect(block.rows[0]?.cells).toHaveLength(2);
    expect(block.rows[0]?.cells[0]).toEqual({ blocks: [] });
    expect(cellText(block.rows[0]?.cells[1])).toBe("kept");
  });

  it("omits heightPt entirely from a row that states no sprmTDyaRowHeight, rather than stating it as undefined", () => {
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000], [{ horzMerge: 0, vertMerge: 0 }]),
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "a" }], grpprl: SPRM_P_F_IN_TABLE, mark: CELL_MARK },
          { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
        ],
      }),
    );
    const block = tableBlock(document);
    expect(block.rows[0]).not.toHaveProperty("heightPt");
  });

  it("refuses a table whose paragraphs dangle mid-row after a real row already closed, even though the wider stream continues", () => {
    const rowGrpprl = [
      ...SPRM_P_F_IN_TABLE,
      ...SPRM_P_F_TTP,
      ...sprmTDefTable([0, 1000], [{ horzMerge: 0, vertMerge: 0 }]),
    ];
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [
            {
              runs: [{ text: "closed" }],
              grpprl: SPRM_P_F_IN_TABLE,
              mark: CELL_MARK,
            },
            { runs: [], grpprl: rowGrpprl, mark: CELL_MARK },
            {
              runs: [{ text: "dangling" }],
              grpprl: SPRM_P_F_IN_TABLE,
              mark: CELL_MARK,
            },
            { runs: [{ text: "after" }] },
          ],
        }),
      ),
    ).toThrow(
      /a table's paragraphs end without a row-ending mark to close the row's last cell/,
    );
  });
});
