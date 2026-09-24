import { describe, expect, it } from "vitest";
import type { ContentParagraph, ContentTable } from "document-schema.js";
import {
  RtfDiagnosticCodes,
  RtfTableGridFaultError,
  RtfWriteError,
} from "./diagnostics";
import { asciiText } from "./test-support/bytes";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";
import { roundTrip } from "./test-support/round-trip";

describe("round trip: table cell merges and grid rules", () => {
  it("round-trips a cell's borders, background, and both merge directions", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columns: [{ widthPt: 72 }, { widthPt: 72 }, { widthPt: 72 }],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                rowSpan: 2,
                background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
                borders: {
                  top: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 },
                  bottom: {
                    color: { r: 0, g: 0, b: 1 },
                    widthPt: 0.75,
                    style: "dashed",
                  },
                },
              },
              // colSpan 2 means this anchor occupies the second and third grid columns, and the third column keeps its own block-less entry so the row has one cell per grid column.
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
                colSpan: 2,
              },
              { blocks: [] },
            ],
          },
          {
            cells: [
              { blocks: [] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "C" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "D" }] }] },
            ],
          },
        ],
      },
    ]);
    const out = write(document);
    expect(out).toContain("\\clvmgf");
    expect(out).toContain("\\clvmrg");
    expect(out).toContain("\\clmgf");
    expect(out).toContain("\\clmrg");
    expect(out).toContain("\\clbrdrt\\brdrs\\brdrw30");
    expect(out).toContain("\\clbrdrb\\brdrdash\\brdrw15");
    expect(out).toContain("\\clcbpat");
    // colSpan 2 produces two \cellxN column marks for cell B, but its own content must be written only once, on the anchor — never repeated into the covered column too.
    expect(out.match(/\{B\}/g)).toHaveLength(1);

    const beyond = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            { cells: [{ blocks: [], rowSpan: 2 }] },
            { cells: [{ blocks: [] }] },
            { cells: [{ blocks: [] }] },
          ],
        },
      ]),
    );
    // rowSpan: 2 covers exactly one row below the anchor (row 1), never a second (row 2) — \clvmrg must appear exactly twice, both from row 1's own doubled \trowd (each row's own definition is written both before and after its cells), never a third time from row 2.
    expect(beyond.match(/\\clvmrg/g)).toHaveLength(2);

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const anchor =
      table?.kind === "table" ? table.rows[0]?.cells[0] : undefined;
    expect(anchor?.rowSpan).toBe(2);
    expect(anchor?.background).toEqual({
      kind: "solid",
      color: { r: 1, g: 1, b: 0 },
    });
    expect(anchor?.borders?.top).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 1.5,
    });
    expect(anchor?.borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 0.75,
      style: "dashed",
    });
    expect(
      table?.kind === "table" ? table.rows[0]?.cells[1]?.colSpan : undefined,
    ).toBe(2);
  });

  it("writes each grid position as one cell slot, with \\clvmrg at the grid column of a rowSpan anchor that follows a colSpan anchor", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }, { widthPt: 72 }, { widthPt: 72 }],
          rows: [
            {
              cells: [
                { blocks: [], colSpan: 2 },
                { blocks: [] },
                { blocks: [], rowSpan: 2 },
              ],
            },
            {
              cells: [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
            },
          ],
        },
      ]),
    );
    const [firstRow, secondRow] = out
      .split("\\row")
      .map((chunk) => chunk.slice(chunk.indexOf("\\trowd")));
    expect(firstRow).toContain(
      "\\clmgf\\cellx1440\\clmrg\\cellx2880\\clvmgf\\cellx4320",
    );
    // The covered cell of the rowSpan sits at grid column 2, so \clvmrg must precede the third \cellxN and no other.
    expect(secondRow).toContain("\\cellx1440\\cellx2880\\clvmrg\\cellx4320");
    expect(out.match(/\\cell(?!x)/g)).toHaveLength(6);
  });

  it("writes \\clmrg for a position covered along its own row and \\clvmrg for one covered from an earlier row, across a 2x2 merge", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }, { widthPt: 72 }],
          rows: [
            {
              cells: [{ blocks: [], colSpan: 2, rowSpan: 2 }, { blocks: [] }],
            },
            { cells: [{ blocks: [] }, { blocks: [] }] },
          ],
        },
      ]),
    );
    const [firstRow, secondRow] = out
      .split("\\row")
      .map((chunk) => chunk.slice(chunk.indexOf("\\trowd")));
    expect(firstRow).toContain("\\clvmgf\\clmgf\\cellx1440\\clmrg\\cellx2880");
    expect(secondRow).toContain("\\clvmrg\\cellx1440\\clvmrg\\cellx2880");
  });

  it("writes a covered position's own borders and shading", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }, { widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                  colSpan: 2,
                },
                {
                  blocks: [],
                  verticalAlign: "bottom",
                  borders: {
                    top: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 },
                  },
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\clmrg\\clvertalb\\clbrdrt\\brdrs\\brdrw30");
  });

  describe("a table breaking the grid rule", () => {
    const paragraphBlocks = (label: string): ContentParagraph[] => [
      { kind: "paragraph", runs: [{ text: label }] },
    ];
    // A merged header whose covered position carries a second copy of the anchor's content, which an RTF cell slot for a covered position does not hold.
    const coveredContentTable: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 72 }, { widthPt: 72 }],
      rows: [
        {
          cells: [
            { blocks: paragraphBlocks("A"), colSpan: 2 },
            { blocks: paragraphBlocks("STRAY") },
          ],
        },
      ],
    };

    function thrownBy(table: ContentTable): unknown {
      try {
        write(wordprocessing([table]));
      } catch (error) {
        return error;
      }
      return expect.unreachable("writeRtfContent should have thrown");
    }

    it("throws RtfTableGridFaultError naming the fault, rather than dropping the covered content", () => {
      const error = thrownBy(coveredContentTable);
      expect(error).toBeInstanceOf(RtfTableGridFaultError);
      expect(error).toBeInstanceOf(RtfWriteError);
      if (!(error instanceof RtfTableGridFaultError)) {
        throw new Error("unreachable");
      }
      expect(error.fault).toEqual({
        kind: "coveredContent",
        rowIndex: 0,
        columnIndex: 1,
        anchorRowIndex: 0,
        anchorColumnIndex: 0,
      });
    });

    it("throws for rows of differing lengths", () => {
      const error = thrownBy({
        kind: "table",
        columns: [{ widthPt: 72 }, { widthPt: 72 }],
        rows: [
          {
            cells: [
              { blocks: paragraphBlocks("a") },
              { blocks: paragraphBlocks("b") },
            ],
          },
          { cells: [{ blocks: paragraphBlocks("c") }] },
        ],
      });
      expect(error).toBeInstanceOf(RtfTableGridFaultError);
    });
  });

  it("round-trips a 2x2 merge through the dense grid", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columns: [{ widthPt: 72 }, { widthPt: 72 }, { widthPt: 72 }],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                colSpan: 2,
                rowSpan: 2,
              },
              { blocks: [] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
            ],
          },
          {
            cells: [
              { blocks: [] },
              { blocks: [] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "C" }] }] },
            ],
          },
        ],
      },
    ]);
    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const rows = table?.kind === "table" ? table.rows : [];
    expect(rows.map((row) => row.cells.length)).toEqual([3, 3]);
    expect(rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(rows[0]?.cells[1]?.blocks).toEqual([]);
    expect(rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(rows[1]?.cells[1]?.blocks).toEqual([]);
  });

  // ExaDev/documents.js#1024: a 'pattern' cell fill now writes its own genuine two-colour \clcbpatN/\clcfpatN/\clshdngN, not just resolveCellFillColor's single representative colour collapsed into \clcbpatN alone.
  it("round-trips a 'pattern' cell fill through \\clcbpatN/\\clcfpatN/\\clshdngN", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columns: [{ widthPt: 72 }],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                background: {
                  kind: "pattern",
                  patternType: "percent25",
                  foregroundColor: { r: 1, g: 0, b: 0 },
                  backgroundColor: { r: 0, g: 0, b: 1 },
                },
              },
            ],
          },
        ],
      },
    ]);
    const out = write(document);
    expect(out).toContain("\\clcbpat");
    expect(out).toContain("\\clcfpat");
    expect(out).toContain("\\clshdng2500");

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const cell = table?.kind === "table" ? table.rows[0]?.cells[0] : undefined;
    expect(cell?.background).toEqual({
      kind: "pattern",
      patternType: "percent25",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 0, b: 1 },
    });
  });

  it("throws when asked to write a cell fill pattern RTF's own flat shading percentage cannot state", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columns: [{ widthPt: 72 }],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                background: {
                  kind: "pattern",
                  patternType: "horizontalStripe",
                },
              },
            ],
          },
        ],
      },
    ]);
    expect(() => write(document)).toThrow(/horizontalStripe/);
  });

  // constructStart/constructEnd are not a nested destination the way embeddedObject/image/table/pageBreak are: they are the same zero-width bookmark bracket writeBlock already splices into the top-level flow, and read.ts's own cellBlockExtents/insertConstructMarkers (src/read.ts) already reconstructs the pair back out of a cell's own block list. This proves the write side can produce it, not just that the reader tolerates it.
  it("round-trips a block-scoped bookmark bracketing whole paragraphs inside a table cell", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columns: [{ widthPt: 72 }],
        rows: [
          {
            cells: [
              {
                blocks: [
                  {
                    kind: "constructStart",
                    descriptor: {
                      kind: "anchor",
                      anchorType: "bookmark",
                      name: "cellspan",
                    },
                  },
                  { kind: "paragraph", runs: [{ text: "One" }] },
                  { kind: "paragraph", runs: [{ text: "Two" }] },
                  { kind: "constructEnd" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const codes: string[] = [];
    const out = asciiText(
      writeRtfContent(document, {
        sink: (diagnostic) => {
          codes.push(diagnostic.code);
        },
      }),
    );
    expect(codes).not.toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    expect(out).toContain("{\\*\\bkmkstart cellspan}");
    expect(out).toContain("{\\*\\bkmkend cellspan}");

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("defers a paragraph's own \\par past a trailing marker with nothing else after it in the cell", () => {
    // blocks.slice(index + 1).some(...) asks only whether a REAL cell block (paragraph/image/embeddedObject) follows the marker — not whether one precedes it, and not the marker itself. A marker as the cell's own last block has nothing after it, so the deferred \par must stay deferred here (RTF's own \cell already ends the cell's last paragraph with no \par of its own needed) rather than being flushed early right before the marker's own spelling: either dropping the slice, or sliding its start back by one (both of which would then also see the PRECEDING paragraph and wrongly conclude something still follows), makes this fire when it should not.
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columns: [{ widthPt: 72 }],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    {
                      kind: "constructStart",
                      descriptor: {
                        kind: "anchor",
                        anchorType: "bookmark",
                        name: "trailing",
                      },
                    },
                    { kind: "paragraph", runs: [{ text: "One" }] },
                    { kind: "constructEnd" },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).not.toContain("{One}\\par");
    expect(out).toContain("{One}{\\*\\bkmkend trailing}");
  });

  // A marker at index 0 (the case above) can never expose a bug in flushing the PRECEDING paragraph's deferred \par, since there is no preceding paragraph. This cell instead opens the bookmark strictly between the first and second of three paragraphs, so the deferred \par writeCellBlocks owes paragraph one must be flushed before the marker rather than after it — getting this wrong widens the bookmark to cover paragraph one as well once read back.
  it("round-trips a block-scoped bookmark that starts between two cell paragraphs, not at the cell's start", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columns: [{ widthPt: 72 }],
        rows: [
          {
            cells: [
              {
                blocks: [
                  { kind: "paragraph", runs: [{ text: "One" }] },
                  {
                    kind: "constructStart",
                    descriptor: {
                      kind: "anchor",
                      anchorType: "bookmark",
                      name: "midcell",
                    },
                  },
                  { kind: "paragraph", runs: [{ text: "Two" }] },
                  { kind: "paragraph", runs: [{ text: "Three" }] },
                  { kind: "constructEnd" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const cellBlocks =
      table?.kind === "table" ? table.rows[0]?.cells[0]?.blocks : undefined;
    expect(cellBlocks?.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });
});
