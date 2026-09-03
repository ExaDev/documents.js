import { describe, expect, it } from "vitest";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { readDocContent } from "../read";
import { buildDoc } from "../test-support/doc";
import { CELL_MARK } from "../text/special";

// Every writeDocContent table test in write.test.ts reads back bytes this package's own writer produced -- a round trip proves the reader and writer agree with each other, not that either agrees with [MS-DOC] itself. These tests hand-assemble the sgc-5 (table) grpprl bytes straight from the specification's own field tables, independently of tap-write.ts's construction logic, so they exercise table/read.ts and table/tap.ts against bytes this package never wrote.

/** sprmPFInTable (0x2416), Bool8 true -- every table paragraph carries it. */
const SPRM_P_F_IN_TABLE = [0x16, 0x24, 0x01];
/** sprmPFTtp (0x2417), Bool8 true -- marks a cell mark as a row's own terminating mark. */
const SPRM_P_F_TTP = [0x17, 0x24, 0x01];

function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

// TC80, [MS-DOC] 2.9.341: tcgrf (2 bytes -- horzMerge in bits 0-1, vertMerge in bits 5-6, per TCGRF 2.9.339) + wWidth (2, unused by this reader) + four Brc80 border fields (4 bytes each), each written as Brc80MayBeNil ("no border", all bits set).
function tc80(horzMerge: number, vertMerge: number): number[] {
  const tcgrf = (horzMerge & 0x3) | ((vertMerge & 0x3) << 5);
  return [...le16(tcgrf), 0x00, 0x00, ...new Array<number>(16).fill(0xff)];
}

// sprmTDefTable, [MS-DOC] 2.6.4 (0xD608): TDefTableOperand's own cb (2 bytes -- "the number of bytes used by the remainder of this structure, incremented by 1"), NumberOfColumns, rgdxaCenter (NumberOfColumns + 1 signed 2-byte boundaries), then one TC80 per column.
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

// sprmTMerge, [MS-DOC] 2.6.4 (0x5624): an ItcFirstLim range naming the physical cells to horizontally merge, the first becoming the anchor -- a spec-conformant mechanism this reader still honours for a genuine third-party producer's row, even though this package's own writer states a horizontal merge purely through a merged row's own narrower, wider physical cells instead (see tap.ts's own note and ExaDev/documents.js#895).
function sprmTMerge(itcFirst: number, itcLim: number): number[] {
  return [0x24, 0x56, itcFirst, itcLim];
}

/** sprmPItap (0x6649): the paragraph's own table depth, a 4-byte operand. */
function sprmPItap(depth: number): number[] {
  return [0x49, 0x66, depth & 0xff, 0, 0, 0];
}

// sprmTVertMerge, [MS-DOC] 2.6.4 (0xD62B): a VertMergeOperand naming one cell (itc) and its own VerticalMergeFlag -- the incremental per-cell mechanism for a vertical merge, the vertical analogue of sprmTMerge.
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
});
