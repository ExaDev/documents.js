import { describe, expect, it } from "vitest";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { readDocContent } from "../read";
import { buildDoc, type DocParagraphSpec } from "../test-support/doc";
import { CELL_MARK } from "../text/special";

// Every writeDocContent table test in write.test.ts reads back bytes this package's own writer produced -- a round trip proves the reader and writer agree with each other, not that either agrees with [MS-DOC] itself. These tests hand-assemble the sgc-5 (table) grpprl bytes straight from the specification's own field tables, independently of tap-write.ts's construction logic, so they exercise table/read.ts and table/tap.ts against bytes this package never wrote.

/** sprmPFInTable (0x2416), Bool8 true -- every table paragraph carries it. */
const SPRM_P_F_IN_TABLE = [0x16, 0x24, 0x01];
/** sprmPFTtp (0x2417), Bool8 true -- marks a cell mark as a row's own terminating mark. */
const SPRM_P_F_TTP = [0x17, 0x24, 0x01];

function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

// TC80, [MS-DOC] 2.9.313: tcgrf (2 bytes -- horzMerge in bits 0-1, vertMerge in bits 5-6, per TCGRF 2.9.317) + wWidth (2, unused by this reader) + four Brc80 border fields (4 bytes each), each written as Brc80MayBeNil ("no border", all bits set).
function tc80(horzMerge: number, vertMerge: number): number[] {
  const tcgrf = (horzMerge & 0x3) | ((vertMerge & 0x3) << 5);
  return [...le16(tcgrf), 0x00, 0x00, ...new Array<number>(16).fill(0xff)];
}

// sprmTDefTable, [MS-DOC] 2.6.3 (0xD608): TDefTableOperand's own cb (2 bytes -- "the number of bytes used by the remainder of this structure, incremented by 1"), NumberOfColumns, rgdxaCenter (NumberOfColumns + 1 signed 2-byte boundaries), then one TC80 per column.
function sprmTDefTable(
  columnBoundariesTwips: readonly number[],
  cells: readonly { horzMerge: number; vertMerge: number }[],
): number[] {
  const remainder = [
    cells.length,
    ...columnBoundariesTwips.flatMap(le16),
    ...cells.flatMap((cell) => tc80(cell.horzMerge, cell.vertMerge)),
  ];
  const cb = remainder.length + 1;
  return [0x08, 0xd6, ...le16(cb), ...remainder];
}

// sprmTMerge, [MS-DOC] 2.6.3 (0x5624): an ItcFirstLim range naming the physical cells to horizontally merge, the first becoming the anchor -- a spec-conformant mechanism this reader still honours for a genuine third-party producer's row, even though this package's own writer states a horizontal merge purely through a merged row's own narrower, wider physical cells instead (see tap.ts's own note and ExaDev/documents.js#895).
function sprmTMerge(itcFirst: number, itcLim: number): number[] {
  return [0x24, 0x56, itcFirst, itcLim];
}

/** sprmPItap (0x6649): the paragraph's own table depth, a 4-byte operand. */
function sprmPItap(depth: number): number[] {
  return [0x49, 0x66, depth & 0xff, 0, 0, 0];
}

// sprmTVertMerge, [MS-DOC] 2.6.3 (0xD62B): a VertMergeOperand naming one cell (itc) and its own VerticalMergeFlag -- the incremental per-cell mechanism for a vertical merge, the vertical analogue of sprmTMerge.
function sprmTVertMerge(itc: number, vertMergeFlags: number): number[] {
  return [0x2b, 0xd6, 0x02, itc, vertMergeFlags];
}

function tableBlock(document: ReturnType<typeof readDocContent>) {
  if (document.kind !== "wordprocessing") {
    throw new Error("a .doc always reads as a wordprocessing document");
  }
  const block = document.sections[0]?.blocks[0];
  if (block?.kind !== "table") throw new Error("expected a table block");
  return block;
}

function cellText(
  cell:
    ReturnType<typeof tableBlock>["rows"][number]["cells"][number] | undefined,
): string {
  if (cell === undefined) throw new Error("expected a cell");
  return cell.blocks
    .map((paragraphBlock) => {
      if (paragraphBlock.kind !== "paragraph") {
        throw new Error(`expected a paragraph, got '${paragraphBlock.kind}'`);
      }
      return paragraphBlock.runs.map((run) => run.text).join("");
    })
    .join(",");
}

describe("readDocContent tables, from hand-assembled bytes", () => {
  it("reads a row's sprmTDefTable column layout and a horizontal merge stated purely through sprmTMerge", () => {
    // Three columns, none merged by TC80.tcgrf itself -- the merge across columns 0-1 comes entirely from the row mark's own sprmTMerge, folded on top per tap.ts's documented precedence.
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
    expect(block.columnWidthsPt).toEqual([50, 50, 50]);
    expect(block.rows).toHaveLength(1);
    const cells = block.rows[0]?.cells ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[0]?.colSpan).toBe(2);
    expect(cellText(cells[0])).toBe("AB");
    expect(cells[1]?.colSpan).toBeUndefined();
    expect(cellText(cells[1])).toBe("C");
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
    expect(cells).toHaveLength(1);
    expect(cells[0]?.colSpan).toBe(2);
    expect(cellText(cells[0])).toBe("AB");
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

  it("refuses a table nested inside a table cell, detected from sprmPItap's own table depth", () => {
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [
            {
              runs: [{ text: "nested" }],
              grpprl: [...SPRM_P_F_IN_TABLE, ...sprmPItap(2)],
              mark: CELL_MARK,
            },
          ],
        }),
      ),
    ).toThrow(DocUnsupportedError);
  });

  // A row-ending mark with no direct sprmTDefTable is a real producer's own legal choice (sprmPTableProps' indirect TAP, per the README's own scope note) that this reader does not follow -- degrading the run back to flat paragraphs rather than refusing the whole document, exactly as an indirect Papx elsewhere in this package already degrades a paragraph's own properties rather than failing its read.
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

  // The genuine third-party encoding ExaDev/documents.js#895 fixed: two rows with no TCGRF.horzMerge/sprmTMerge signal anywhere, but each declaring its own, differently-shaped rgdxaCenter -- row one's own narrower, wider physical cell states a horizontal merge purely as a real per-row column layout, exactly as a genuine LibreOffice-authored .doc does (see the README's own third-party verification finding). This exercises table/read.ts's own column-grid union directly, independently of write.ts's round trips against this package's own writer.
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
    expect(block.columnWidthsPt).toEqual([50, 50, 50]);
    expect(block.rows).toHaveLength(2);
    const rowOneCells = block.rows[0]?.cells ?? [];
    expect(rowOneCells).toHaveLength(2);
    expect(rowOneCells[0]?.colSpan).toBe(2);
    expect(cellText(rowOneCells[0])).toBe("wide");
    expect(rowOneCells[1]?.colSpan).toBeUndefined();
    expect(cellText(rowOneCells[1])).toBe("narrow");
    const rowTwoCells = block.rows[1]?.cells ?? [];
    expect(rowTwoCells).toHaveLength(3);
    expect(rowTwoCells.map((cell) => cell.colSpan)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(rowTwoCells.map((cell) => cellText(cell))).toEqual(["a", "b", "c"]);
  });
});

// The tolerance the reconstruction snaps boundaries within is one point, and ContentTable.columnWidthsPt is stated in points, so every expectation below is written in points and every drift is written as a fraction of one -- restated here from the point's own definition rather than imported from table/read.ts, so the two agree only if both are right.
const TWIPS_PER_POINT = 20;

// The exact rgdxaCenter a real LibreOffice 26.2.5.2-authored three-column table states, taken from a 2.5cm/3.1cm/4.7cm .fodt converted with `soffice --headless --convert-to doc` -- widths deliberately chosen not to land on whole twips, and still byte-identical in every one of that table's rows. That is why no LibreOffice-derived fixture in this package ever exercises per-row drift: LibreOffice rounds a table's columns to twips once for the whole table, not once per row (ExaDev/documents.js#898).
const LIBREOFFICE_ROW_BOUNDARIES = [0, 2338, 5238, 9638];
/** The same table's columns in points, the shape a reconstruction that recognises its rows as sharing one grid produces: 2338/20, 2900/20, 4400/20. */
const LIBREOFFICE_COLUMN_WIDTHS_PT = [116.9, 145, 220];
/** That middle column's own width, 145pt: the distance the zero-width-cell case below pulls its right boundary back by so the two coincide. */
const MIDDLE_COLUMN_WIDTH_TWIPS = 2900;
/** The boundary between that table's first and second columns: the single int16 the tolerance sweep patched inside a real LibreOffice-authored file's second row, and the one a row merging those two columns omits from its own array entirely. */
const INTERIOR_BOUNDARY_INDEX = 1;
/** Word's own default for an unindented table's first rgdxaCenter entry, confirmed against LibreOffice's WW8 importer source (a named -108 constant, "Word sets the first nCenter value to -108 when no indent is used") -- plausibly the format's own 108-twip default cell margin, sprmTCellPaddingDefault ([MS-DOC] 2.6.3), compensated for, though neither source states that link outright (see the README's own identical hedge). Also the size of the real-world one-row leading indent the mode-2 case below uses. */
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

// Builds a whole table's paragraph sequence from nothing but each row's own rgdxaCenter array and its cells' text. No cell carries a TC80.tcgrf merge flag and no sprmTMerge or sprmTVertMerge is written, so any colSpan that comes back was reconstructed purely by comparing these boundary arrays against each other -- which is exactly what the column-grid union does, and the only thing these tests are about.
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

// [MS-DOC] 2.6.3 states a table's column layout per row, and 2.9.321's rgdxaCenter is a plain array of twip offsets from the page margin with no coarser quantum defined anywhere -- so two rows meaning the identical grid may legally disagree by a twip or two, and reconstructing the shared grid from them needs a tolerance rather than exact integer equality (ExaDev/documents.js#898). The threshold is one point, matching what a real, independent [MS-DOC] implementation applies to the identical per-row-boundaries-to-shared-grid problem: LibreOffice's `#define COLFUZZY 20` twips (sw/source/filter/inc/wrtswtbl.hxx), applied by its own ODF export -- the point at which its per-row table model is projected onto one shared grid, not its .doc importer, which preserves per-row drift untouched -- whose changeover was confirmed empirically at exactly 20/21 by round-tripping a single patched int16 through LibreOffice 26.2.5.2's own .doc import followed by that ODF export.
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
    expect(block.columnWidthsPt).toEqual(LIBREOFFICE_COLUMN_WIDTHS_PT);
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
    expect(block.columnWidthsPt).toEqual(LIBREOFFICE_COLUMN_WIDTHS_PT);
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
    expect(block.columnWidthsPt).toEqual(LIBREOFFICE_COLUMN_WIDTHS_PT);
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
  });

  // One twip past the tolerance the rows genuinely do describe different grids, and the reconstruction says so rather than absorbing the difference: the sliver between the two boundaries becomes its own column, with each row's first cell spanning whichever pair of segments its own boundaries cover. This is the same shape LibreOffice's own importer produces from the identical bytes at the identical threshold -- the tolerance moves where the split happens, it does not remove the split.
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
    expect(block.columnWidthsPt).toEqual([116.9, 1.05, 143.95, 220]);
    expect(colSpansPerRow(block)).toEqual([
      [undefined, 2, undefined],
      [2, undefined, undefined],
    ]);
  });

  // Word writes -108 rather than 0 as an unindented table's first rgdxaCenter entry (LibreOffice's own WW8 importer carries the fact as a named comment in ww8par2.cxx's CalcDefaults), compensating for [MS-DOC]'s own 108-twip default cell margin. Every row states it, so the rows still describe one grid -- and the indent itself has nowhere to land, since ContentTable carries only rows and columnWidthsPt (see the README's own note).
  it("reads rows sharing Word's own -108 leading offset as one grid, carrying the column widths and dropping the offset", () => {
    const wordUnindented = LIBREOFFICE_ROW_BOUNDARIES.map(
      (boundary) => boundary - WORD_DEFAULT_CELL_MARGIN_TWIPS,
    );
    const block = readTableFromRowBoundaries([
      { boundariesTwips: wordUnindented, cells: ["a1", "b1", "c1"] },
      { boundariesTwips: wordUnindented, cells: ["a2", "b2", "c2"] },
    ]);
    expect(block.columnWidthsPt).toEqual(LIBREOFFICE_COLUMN_WIDTHS_PT);
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
  });

  // A leading indent that only ONE row carries is not drift and is not absorbed: sprmTWidthBefore ([MS-DOC] 2.6.3) makes a per-row leading indent a first-class construct, and rgdxaCenter's own first entry is "the horizontal position of the logical left edge of the table, as indented from the logical left page margin" (2.9.321) -- so rows disagreeing about it genuinely occupy different horizontal extents. The reconstructed grid honestly carries the extra boundary, with the rows that begin further left spanning both segments. LibreOffice 26.2.5.2 reads the identical bytes into the identical shape: four columns, a table:number-columns-spanned="2" anchor and a real table:covered-table-cell on those rows.
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
    expect(block.columnWidthsPt).toEqual([5.4, 111.5, 145, 220]);
    expect(colSpansPerRow(block)).toEqual([
      [2, undefined, undefined],
      [undefined, undefined, undefined],
      [2, undefined, undefined],
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
    expect(block.columnWidthsPt).toEqual(LIBREOFFICE_COLUMN_WIDTHS_PT);
    expect(colSpansPerRow(block)).toEqual([
      [2, undefined],
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
    expect(cellText(block.rows[0]?.cells[0])).toBe("merged");
  });

  // rgdxaCenter's entries "MUST be in non-decreasing order" ([MS-DOC] 2.9.321) -- equal adjacent entries, and so a genuine zero-width physical cell, are explicitly legal. Such a cell covers no segment of the reconstructed grid, and ContentTableCell has no way to say "zero columns wide", so it comes back carrying its own content as an ordinary un-spanned cell rather than as a cell claiming a span of zero.
  it("carries a legal zero-width physical cell as an ordinary un-spanned cell rather than one spanning no columns", () => {
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
    expect(block.columnWidthsPt).toEqual([116.9, 365]);
    expect(colSpansPerRow(block)).toEqual([[undefined, undefined, undefined]]);
    expect(block.rows[0]?.cells.map((cell) => cellText(cell))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  // The clamp effectiveColumnBoundaryTolerance exists for: this writer has no equivalent of LibreOffice's own MINLAY minimum-cell-width widening, so nothing stops a real producer's rgdxaCenter from stating a column genuinely narrower than the tolerance's own one-point default -- and a single row's own adjacent boundaries are never ambiguous about how many columns that row states, whatever the gap between them. A single-row table with no cross-row drift at all isolates this: if the tolerance folded a real narrow column into its neighbour here, that would be exactly the same defect the drift tolerance exists to fix, applied to the wrong pair of boundaries.
  it("keeps a genuinely narrow column intact rather than folding it into its neighbour", () => {
    const block = readTableFromRowBoundaries([
      {
        boundariesTwips: [0, 1000, 1010, 3000],
        cells: ["a", "b", "c"],
      },
    ]);
    expect(block.columnWidthsPt).toEqual([50, 0.5, 99.5]);
    expect(colSpansPerRow(block)).toEqual([[undefined, undefined, undefined]]);
  });

  it("still applies the ordinary one-point tolerance to cross-row drift when no row states a narrower real column", () => {
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 2000, 3000], cells: ["a", "b"] },
      { boundariesTwips: [0, 2001, 3000], cells: ["a", "b"] },
    ]);
    expect(block.columnWidthsPt).toEqual([100, 50]);
    expect(colSpansPerRow(block)).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("narrows the drift tolerance to below a real column any row in the same table states, rather than the fixed one-point default", () => {
    // Row 1 states a genuine 10-twip column (0.5pt) between 1000 and 1010, so the table-wide tolerance clamps to 9 twips -- one less than that gap. Row 2's own boundary at 1025 is 15 twips from row 1's 1010, further than the clamped 9-twip tolerance but within the un-clamped one-point (20-twip) default: without the clamp this boundary would fold into 1010 and silently widen the real narrow column into whatever gap it shares with 1025. With it, 1025 stays its own boundary.
    const block = readTableFromRowBoundaries([
      { boundariesTwips: [0, 1000, 1010, 3000], cells: ["a", "b", "c"] },
      { boundariesTwips: [0, 1025, 3000], cells: ["a", "b"] },
    ]);
    expect(block.columnWidthsPt).toEqual([50, 0.5, 0.75, 98.75]);
  });
});
