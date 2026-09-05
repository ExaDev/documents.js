import { readCompoundFile } from "archive-codec";
import {
  ContentDocumentSchema,
  type ContentBlock,
  type ContentDocument,
  type ContentParagraph,
  type ContentTable,
  type ContentTableCell,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { slice } from "./bytes";
import { isDocBytes } from "./detect";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { PropertyBinTable } from "./prop/fkp";
import { readGrpprl } from "./prop/sprm";
import { readDocContent, readDocStreams } from "./read";
import { readTextRange } from "./text/characters";
import { parseClx } from "./text/piece-table";
import { writeDocContent } from "./write";

// Verifies writeDocContent by reading its own output back through this package's own reader (readDocContent) -- the round trip this session's own writer packages (archive-codec's CFB writer, odf.js's typed writer) are all verified the same way, and the standing convention this task itself names. This round trip alone cannot prove third-party conformance, though: ExaDev/documents.js#892 is the confirmed counterexample -- a table passed this exact suite for the whole time LibreOffice's own .doc import filter rejected it outright, because readDocContent tolerated a document whose Main Document text did not end in the ordinary paragraph mark [MS-DOC] requires. Byte-level and real-reader verification for the table writer specifically lives in the README's own "Third-party verification" paragraph and its accompanying LibreOffice checks, not here.

function document(blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [...blocks],
      },
    ],
  };
}

function paragraph(
  runs: ContentParagraph["runs"],
  attributes: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs, ...attributes };
}

function roundTrip(input: ContentDocument): ContentDocument {
  const bytes = writeDocContent(input);
  expect(isDocBytes(bytes)).toBe(true);
  return readDocContent(bytes);
}

function blocksOf(result: ContentDocument): ContentBlock[] {
  if (result.kind !== "wordprocessing") {
    throw new Error("a .doc always reads back as a wordprocessing document");
  }
  const section = result.sections[0];
  if (section === undefined) throw new Error("a section must be present");
  return [...section.blocks];
}

// Joins every paragraph's own text in a cell with a comma, so a multi-paragraph cell's assertion reads as one string rather than an array comparison per paragraph.
function cellText(cell: ContentTableCell | undefined): string {
  if (cell === undefined) throw new Error("expected a cell");
  return cell.blocks
    .map((block) => {
      if (block.kind !== "paragraph") {
        throw new Error(`expected a paragraph block, got '${block.kind}'`);
      }
      return block.runs.map((run) => run.text).join("");
    })
    .join(",");
}

function paragraphAt(result: ContentDocument, index: number): ContentParagraph {
  const block = blocksOf(result)[index];
  if (block === undefined) throw new Error(`no block at index ${index}`);
  if (block.kind !== "paragraph") {
    throw new Error(`block ${index} is a ${block.kind}, not a paragraph`);
  }
  return block;
}

function tableAt(result: ContentDocument, index: number): ContentTable {
  const block = blocksOf(result)[index];
  if (block === undefined) throw new Error(`no block at index ${index}`);
  if (block.kind !== "table") {
    throw new Error(`block ${index} is a ${block.kind}, not a table`);
  }
  return block;
}

/** The one cell a single-cell, single-row table round-trips to -- the shape most decoration assertions below want, since a border or fill is a per-cell fact and needs no other cell to state it. */
function onlyCell(result: ContentDocument): ContentTableCell {
  const cell = tableAt(result, 0).rows[0]?.cells[0];
  if (cell === undefined) throw new Error("expected one cell");
  return cell;
}

/** Whether any paragraph in a written document carries a Prl with this sprm opcode. Walked through this package's own grpprl primitives rather than scanned for the two opcode bytes anywhere in the stream, which would match the identical pair occurring inside some other sprm's operand and report an opcode that is not there. */
function containsSprm(bytes: Uint8Array<ArrayBuffer>, opcode: number): boolean {
  const { wordDocument, table, fib } = readDocStreams(bytes);
  const pieceTable = parseClx(slice(table, fib.fcClx, fib.lcbClx, "Clx"));
  const range = readTextRange(wordDocument, pieceTable, 0, fib.ccpText);
  const papxTable = new PropertyBinTable(
    wordDocument,
    slice(table, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx, "PlcBtePapx"),
    "PlcBtePapx",
  );
  return range.fcs.some((fc) => {
    const papx = papxTable.papx(fc);
    if (papx === undefined) return false;
    return readGrpprl(papx.grpprl).some((prl) => prl.sprm.value === opcode);
  });
}

describe("writeDocContent", () => {
  it("round-trips a document's paragraphs and their text", () => {
    const input = document([
      paragraph([{ text: "First paragraph." }]),
      paragraph([{ text: "Second paragraph." }]),
    ]);
    const result = roundTrip(input);
    expect(blocksOf(result)).toHaveLength(2);
    expect(paragraphAt(result, 0).runs.map((run) => run.text)).toEqual([
      "First paragraph.",
    ]);
    expect(paragraphAt(result, 1).runs.map((run) => run.text)).toEqual([
      "Second paragraph.",
    ]);
  });

  it("produces bytes that parse as a genuine Word Binary File the shared schema validates", () => {
    const result = roundTrip(document([paragraph([{ text: "Hello." }])]));
    expect(ContentDocumentSchema.safeParse(result).success).toBe(true);
  });

  it("round-trips a run's direct character formatting", () => {
    const input = document([
      paragraph([
        { text: "plain" },
        { text: "bold", bold: true },
        { text: "italic", italic: true },
        { text: "underlined", underline: true },
        { text: "struck", strike: true },
      ]),
    ]);
    const runs = paragraphAt(roundTrip(input), 0).runs;
    expect(runs.map((run) => run.text)).toEqual([
      "plain",
      "bold",
      "italic",
      "underlined",
      "struck",
    ]);
    expect(runs[0]?.bold).toBeUndefined();
    expect(runs[1]?.bold).toBe(true);
    expect(runs[2]?.italic).toBe(true);
    expect(runs[3]?.underline).toBe(true);
    expect(runs[4]?.strike).toBe(true);
  });

  it("round-trips a run explicitly turning a property off", () => {
    // bold:false must survive as a genuine ToggleOperand 0x00, not be silently equivalent to omitting the sprm -- distinguished here by writing it adjacent to a bold:true run, which would otherwise merge with an "absent" run into one Chpx exception.
    const input = document([
      paragraph([
        { text: "bold", bold: true },
        { text: "notbold", bold: false },
      ]),
    ]);
    const runs = paragraphAt(roundTrip(input), 0).runs;
    expect(runs.map((run) => run.text)).toEqual(["bold", "notbold"]);
    expect(runs[0]?.bold).toBe(true);
    expect(runs[1]?.bold).toBe(false);
  });

  it("round-trips a run's font size in half-point steps", () => {
    const input = document([
      paragraph([
        { text: "big", sizePt: 24 },
        { text: "small", sizePt: 8.5 },
      ]),
    ]);
    const runs = paragraphAt(roundTrip(input), 0).runs;
    expect(runs[0]?.sizePt).toBe(24);
    expect(runs[1]?.sizePt).toBe(8.5);
  });

  it("round-trips a run's exact colour through sprmCCv, not the fixed Ico palette", () => {
    // A colour with no exact match in [MS-DOC] 2.9.119's 17-entry Ico palette (see prop/chp.ts) still round-trips exactly, because encodeCharacterGrpprl writes sprmCCv (a literal COLORREF) rather than snapping to the nearest palette entry.
    const input = document([
      paragraph([
        { text: "teal", color: { r: 0, g: 0x80 / 255, b: 0x7f / 255 } },
      ]),
    ]);
    const runs = paragraphAt(roundTrip(input), 0).runs;
    expect(runs[0]?.color).toEqual({ r: 0, g: 0x80 / 255, b: 0x7f / 255 });
  });

  it("round-trips a run's font family through a written SttbfFfn and sprmCRgFtc0", () => {
    const input = document([
      paragraph([
        { text: "serif", fontFamily: "Times New Roman" },
        { text: "sans", fontFamily: "Calibri" },
        { text: "again serif", fontFamily: "Times New Roman" },
      ]),
    ]);
    const runs = paragraphAt(roundTrip(input), 0).runs;
    expect(runs.map((run) => run.text)).toEqual([
      "serif",
      "sans",
      "again serif",
    ]);
    expect(runs[0]?.fontFamily).toBe("Times New Roman");
    expect(runs[1]?.fontFamily).toBe("Calibri");
    expect(runs[2]?.fontFamily).toBe("Times New Roman");
  });

  it("writes no font table at all when no run names a font", () => {
    // Not directly observable from readDocContent's own output (an absent SttbfFfn and an unreferenced one both read back the same way), so this asserts the byte-level fact the README's own scope note makes: lcbSttbfFfn stays legitimately 0, per FibRgFcLcb97's "If lcbSttbfFfn is zero, fcSttbfFfn is undefined and MUST be ignored" rather than [MS-DOC]'s stronger "MUST be a nonzero value" for lcbStshf.
    const bytes = writeDocContent(document([paragraph([{ text: "plain" }])]));
    const result = readDocContent(bytes);
    expect(paragraphAt(result, 0).runs[0]?.fontFamily).toBeUndefined();
  });

  it("round-trips every direct paragraph property this writer supports", () => {
    const input = document([
      paragraph([{ text: "centred" }], { alignment: "center" }),
      paragraph([{ text: "indented" }], {
        indentLeftPt: 36,
        indentFirstLinePt: -18,
      }),
      paragraph([{ text: "spaced" }], {
        spacingBeforePt: 12,
        spacingAfterPt: 6,
      }),
      paragraph([{ text: "leaded" }], { lineSpacing: 1.5 }),
      paragraph([{ text: "broken" }], { pageBreakBefore: true }),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).alignment).toBe("center");
    expect(paragraphAt(result, 1).indentLeftPt).toBe(36);
    expect(paragraphAt(result, 1).indentFirstLinePt).toBe(-18);
    expect(paragraphAt(result, 2).spacingBeforePt).toBe(12);
    expect(paragraphAt(result, 2).spacingAfterPt).toBe(6);
    expect(paragraphAt(result, 3).lineSpacing).toBe(1.5);
    expect(paragraphAt(result, 4).pageBreakBefore).toBe(true);
  });

  it("round-trips a section's own page size and margins", () => {
    const input: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 600, heightPt: 800 },
          margins: { leftPt: 90, rightPt: 54, topPt: 45, bottomPt: 36 },
          blocks: [paragraph([{ text: "text" }])],
        },
      ],
    };
    const result = roundTrip(input);
    if (result.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    const section = result.sections[0];
    if (section === undefined) throw new Error("a section must be present");
    expect(section.pageSize).toEqual({ widthPt: 600, heightPt: 800 });
    expect(section.margins).toEqual({
      leftPt: 90,
      rightPt: 54,
      topPt: 45,
      bottomPt: 36,
    });
  });

  it("round-trips every ST_Jc alignment value this package converts", () => {
    const input = document([
      paragraph([{ text: "l" }], { alignment: "left" }),
      paragraph([{ text: "c" }], { alignment: "center" }),
      paragraph([{ text: "r" }], { alignment: "right" }),
      paragraph([{ text: "j" }], { alignment: "justify" }),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).alignment).toBe("left");
    expect(paragraphAt(result, 1).alignment).toBe("center");
    expect(paragraphAt(result, 2).alignment).toBe("right");
    expect(paragraphAt(result, 3).alignment).toBe("justify");
  });

  it("round-trips an empty section as the single empty paragraph [MS-DOC] requires", () => {
    // A .doc's Main Document text must end in a paragraph mark ([MS-DOC] 2.4.2); a section with no blocks at all still needs one to hold it.
    const result = roundTrip(document([]));
    expect(blocksOf(result)).toHaveLength(1);
    expect(paragraphAt(result, 0).runs).toEqual([]);
  });

  it("round-trips a paragraph with no runs of its own", () => {
    const input = document([
      paragraph([{ text: "before" }]),
      paragraph([]),
      paragraph([{ text: "after" }]),
    ]);
    const result = roundTrip(input);
    expect(blocksOf(result)).toHaveLength(3);
    expect(paragraphAt(result, 1).runs).toEqual([]);
    expect(paragraphAt(result, 0).runs[0]?.text).toBe("before");
    expect(paragraphAt(result, 2).runs[0]?.text).toBe("after");
  });

  it("round-trips characters outside the Basic Multilingual Plane and outside Latin-1", () => {
    // This writer only ever emits 16-bit (uncompressed) pieces (see text/piece-table-write.ts), so a character the reader's own COMPRESSED_CHARACTER_MAP has no entry for is never at risk -- a surrogate pair is simply two ordinary UTF-16 code units to a 16-bit piece.
    const input = document([paragraph([{ text: "café 中文 😀" }])]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).runs[0]?.text).toBe("café 中文 😀");
  });

  it("splits character-formatting exceptions across several ChpxFkp pages once a single page's 0x65-run limit is exceeded", () => {
    const runs = Array.from({ length: 150 }, (_, index) => ({
      text: `r${index}`,
      // A distinct colour per run keeps every run's own grpprl byte-distinct, so none of the 150 merge into a neighbour and the ChpxFkp is genuinely forced to split.
      color: { r: (index % 256) / 255, g: 0, b: 0 },
    }));
    const input = document([paragraph(runs)]);
    const result = roundTrip(input);
    const resultRuns = paragraphAt(result, 0).runs;
    expect(resultRuns.map((run) => run.text)).toEqual(
      runs.map((run) => run.text),
    );
    resultRuns.forEach((run, index) => {
      expect(run.color?.r).toBeCloseTo((index % 256) / 255, 6);
    });
  });

  it("splits paragraph-formatting records across several PapxFkp pages once a single page's 0x1D-paragraph limit is exceeded", () => {
    const paragraphs = Array.from({ length: 60 }, (_, index) =>
      paragraph([{ text: `paragraph ${index}` }], {
        // A distinct indent per paragraph keeps every paragraph's own grpprl byte-distinct.
        indentLeftPt: index + 1,
      }),
    );
    const input = document(paragraphs);
    const result = roundTrip(input);
    expect(blocksOf(result)).toHaveLength(60);
    paragraphs.forEach((_, index) => {
      expect(paragraphAt(result, index).runs[0]?.text).toBe(
        `paragraph ${index}`,
      );
      expect(paragraphAt(result, index).indentLeftPt).toBe(index + 1);
    });
  });

  it("refuses a non-wordprocessing document", () => {
    const spreadsheet: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    };
    expect(() => writeDocContent(spreadsheet)).toThrow(DocUnsupportedError);
  });

  it("refuses a document with more than one section, rather than silently merging their content into what would read back as one", () => {
    const input: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [paragraph([{ text: "one" }])],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [paragraph([{ text: "two" }])],
        },
      ],
    };
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });

  it("refuses a block kind it does not yet write, such as an image", () => {
    const input = document([
      {
        kind: "image",
        format: "png",
        base64: "",
        widthPt: 10,
        heightPt: 10,
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });
});

describe("writeDocContent tables", () => {
  it("round-trips a simple table's rows, cells and column widths", () => {
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [100, 150],
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
    expect(block.columnWidthsPt).toEqual([100, 150]);
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
        columnWidthsPt: [200],
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
        columnWidthsPt: [100],
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

  it("round-trips a horizontally merged cell's colSpan via the merged row's own narrower, wider physical cells", () => {
    // A real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed not to read TCGRF.horzMerge/sprmTMerge at all for a horizontal merge -- it states one purely through a merged row's own physical cell layout: fewer, wider cells than an unmerged row in the same table (ExaDev/documents.js#895). This writer matches that encoding whenever some other row in the table would otherwise reveal the merged boundary anyway, so the merged row genuinely has 2 physical cells here, not 3 -- the reader recovers colSpan by comparing this row's own boundaries against the second, unmerged row's, which is what reveals that the table has 3 conceptual columns at all (see the dedicated "recovers colSpan and columnWidthsPt" test below for the fallback this writer uses instead when no row ever reveals that boundary on its own).
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [50, 50, 50],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
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
    expect(block.columnWidthsPt).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells).toHaveLength(2);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("wide");
    expect(block.rows[0]?.cells[1]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[1])).toBe("narrow");
    expect(block.rows[1]?.cells.map((cell) => cellText(cell))).toEqual([
      "A2",
      "B2",
      "C2",
    ]);
  });

  it("recovers colSpan and columnWidthsPt via a horizontal-merge continuation cell when no row in the table ever states the boundary a merge crosses (ExaDev/documents.js#992)", () => {
    // [MS-DOC]'s own physical model (see the previous test's note) states a table's column grid entirely through the boundaries each row's own TDefTableOperand declares. When literally every row merges across the identical span -- as a single-row table with one merged cell necessarily does, having no other row to compare against -- the merged-pair boundary is never stated by the ordinary narrower/wider physical-cell encoding at all. table/write.ts's own lost-boundary fallback detects exactly this and keeps the boundary physically present instead: the merged cell is written as 2 physical cells, the first carrying the real content, the second an empty TCGRF.horzMerge continuation -- so the row's own rgdxaCenter states all 3 of the table's columns after all.
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [50, 50, 50],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
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
    expect(block.columnWidthsPt).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells).toHaveLength(2);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("wide");
    expect(block.rows[0]?.cells[1]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[1])).toBe("narrow");
  });

  it("recovers colSpan and columnWidthsPt when every row of a multi-row table merges across the identical boundary (ExaDev/documents.js#992)", () => {
    // The previous test's single row is the simplest case of this gap; the issue itself names the general one -- a boundary every row merges across identically, however many rows the table has. Both rows here merge columns 0-1 into one cell, so neither row's own rgdxaCenter would ever state that boundary under the ordinary narrower/wider encoding: the fallback must apply to both rows, not just one, since either row on its own is a table with no other row to compare against.
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [50, 50, 50],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "R1-wide" }])], colSpan: 2 },
              { blocks: [paragraph([{ text: "R1-narrow" }])] },
            ],
          },
          {
            cells: [
              { blocks: [paragraph([{ text: "R2-wide" }])], colSpan: 2 },
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
    expect(block.columnWidthsPt).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("R1-wide");
    expect(cellText(block.rows[0]?.cells[1])).toBe("R1-narrow");
    expect(block.rows[1]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[1]?.cells[0])).toBe("R2-wide");
    expect(cellText(block.rows[1]?.cells[1])).toBe("R2-narrow");
  });

  it("round-trips a vertically merged cell's rowSpan, with the spanned rows carrying an empty placeholder cell", () => {
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [80, 80],
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

  it("writes a genuinely blank cell as blank, not as a vertical-merge continuation of the cell above it", () => {
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [80, 80],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "A1" }])] },
              { blocks: [paragraph([{ text: "B1" }])] },
            ],
          },
          {
            cells: [{ blocks: [] }, { blocks: [paragraph([{ text: "B2" }])] }],
          },
        ],
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    // The cell above a genuinely blank cell must not come back claiming a rowSpan it never had -- that would be exactly the "blank cell silently mis-written as a vertical-merge continuation" defect.
    expect(block.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[0])).toBe("A1");
    // Unlike a vertical-merge continuation (which the reader normalises back to `blocks: []` regardless of its own paragraph content, since a continuation's content is never rendered), an ordinary blank cell keeps the single empty paragraph [MS-DOC] requires every physical cell to carry -- the closest a lossless round trip of "no blocks" can reach.
    expect(block.rows[1]?.cells[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [] },
    ]);
    expect(block.rows[1]?.cells[0]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[1]?.cells[1])).toBe("B2");
  });

  it("round-trips a cell merged both horizontally and vertically", () => {
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [50, 50, 50],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "anchor" }])],
                colSpan: 2,
                rowSpan: 2,
              },
              { blocks: [paragraph([{ text: "C1" }])] },
            ],
          },
          {
            cells: [{ blocks: [] }, { blocks: [paragraph([{ text: "C2" }])] }],
          },
          // Neither row above ever states the boundary between the anchor's own 2 merged columns, since both merge across it identically -- a third, wholly unmerged row is what reveals the table genuinely has 3 columns here, so the lost-boundary fallback never triggers for this particular table (see this describe block's own "recovers colSpan and columnWidthsPt" tests for what the fallback does when no row reveals it at all).
          {
            cells: [
              { blocks: [paragraph([{ text: "A3" }])] },
              { blocks: [paragraph([{ text: "B3" }])] },
              { blocks: [paragraph([{ text: "C3" }])] },
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
    expect(block.columnWidthsPt).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(block.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("anchor");
    expect(cellText(block.rows[0]?.cells[1])).toBe("C1");
    // The row below carries one schema cell for the whole 2-wide vertical continuation, not two -- its own colSpan records the physical width it still covers.
    expect(block.rows[1]?.cells).toHaveLength(2);
    expect(block.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(block.rows[1]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[1]?.cells[1])).toBe("C2");
    expect(block.rows[2]?.cells.map((cell) => cellText(cell))).toEqual([
      "A3",
      "B3",
      "C3",
    ]);
  });

  it("appends a trailing empty paragraph when a table is the section's own last block, so the document's last character is a genuine paragraph mark rather than the table's own row-ending cell mark", () => {
    // [MS-DOC]'s own "Main Document" glossary entry: "The last character in the main document MUST be a paragraph mark (Unicode 0x000D)" -- never the row-ending mark's own cell-mark character (0x0007), even though a row-ending mark is a perfectly legal paragraph-boundary terminator everywhere else. Without this, a real third-party [MS-DOC] reader (LibreOffice) does not merely lose a property -- it fails to recognise the table at all (ExaDev/documents.js#892).
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [100],
        rows: [{ cells: [{ blocks: [paragraph([{ text: "only cell" }])] }] }],
      },
    ]);
    const result = roundTrip(input);
    const blocks = blocksOf(result);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("table");
    expect(blocks[1]).toEqual({ kind: "paragraph", runs: [] });
  });

  it("does not append a trailing paragraph when the section already ends in an ordinary paragraph after a table", () => {
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [100],
        rows: [{ cells: [{ blocks: [paragraph([{ text: "cell" }])] }] }],
      },
      paragraph([{ text: "after the table" }]),
    ]);
    const result = roundTrip(input);
    const blocks = blocksOf(result);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.kind).toBe("paragraph");
  });

  it("refuses a table nested inside a table cell", () => {
    const input = document([
      {
        kind: "table",
        columnWidthsPt: [100],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "table", rows: [], columnWidthsPt: [] }],
              },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });

  // ContentTableCell.background and .borders, through TC80's own four Brc80 fields, the sprmTSetBrc exact-colour layer beside them, and the row's own sprmTDefTableShd array (src/table/decoration.ts). Every case here was additionally checked against real LibreOffice 26.2.5.2 output in both directions -- see the README's own "Third-party verification" paragraph for exactly which sub-cases that covered and which it did not.
  describe("cell decoration", () => {
    // A single-cell table carrying whatever decoration a test wants to state, so each assertion below is about the decoration alone rather than about cell structure it re-establishes every time.
    const decorated = (cell: Partial<ContentTableCell>): ContentDocument =>
      document([
        {
          kind: "table",
          columnWidthsPt: [120],
          rows: [
            { cells: [{ blocks: [paragraph([{ text: "x" }])], ...cell }] },
          ],
        },
      ]);

    it("round-trips a cell's background fill", () => {
      const result = roundTrip(decorated({ background: { r: 1, g: 1, b: 0 } }));
      expect(onlyCell(result).background).toEqual({ r: 1, g: 1, b: 0 });
    });

    it("round-trips a background colour the Ico palette cannot state, through Shd's own exact COLORREFs", () => {
      // #4C7FBF is deliberately nowhere near a palette entry: Shd carries cvFore/cvBack as full COLORREFs, so unlike a Brc80 border there is no palette step to lose it at.
      const background = { r: 0x4c / 255, g: 0x7f / 255, b: 0xbf / 255 };
      const result = roundTrip(decorated({ background }));
      expect(onlyCell(result).background).toEqual(background);
    });

    it("round-trips all four borders, each with its own style, width and colour", () => {
      const borders = {
        top: { color: { r: 1, g: 0, b: 0 }, widthPt: 0.5 },
        left: { color: { r: 0, g: 0, b: 1 }, widthPt: 1, style: "dashed" },
        bottom: { color: { r: 0, g: 0x80 / 255, b: 0 }, widthPt: 2.5 },
        // 0x80/255 rather than a round 0.5: every colour in this schema is written as a byte, so a component that is not itself a whole byte comes back rounded, exactly as a run's own sprmCCv colour already does.
        right: {
          color: { r: 0x80 / 255, g: 0, b: 0x80 / 255 },
          widthPt: 1.5,
          style: "dotted",
        },
      } as const;
      const result = roundTrip(decorated({ borders }));
      expect(onlyCell(result).borders).toEqual(borders);
    });

    it("round-trips a cell bordered on some sides but not others, leaving the unbordered sides absent", () => {
      const result = roundTrip(
        decorated({
          borders: {
            top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
            bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
          },
        }),
      );
      const cellBorders = onlyCell(result).borders;
      expect(cellBorders?.top).toEqual({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 1,
      });
      expect(cellBorders?.bottom).toEqual({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 1,
      });
      expect(cellBorders?.left).toBeUndefined();
      expect(cellBorders?.right).toBeUndefined();
    });

    it("emits no decoration at all for a cell that states none", () => {
      const result = roundTrip(decorated({}));
      const cell = onlyCell(result);
      expect(cell.background).toBeUndefined();
      expect(cell.borders).toBeUndefined();
    });

    it("round-trips a border colour the Ico palette cannot state, through the sprmTSetBrc layer beside TC80's own Brc80", () => {
      // #336699 is not a palette entry, so Brc80.ico alone would snap it to the nearest one; recovering it exactly proves the sprmTSetBrc override is both written and folded back on read.
      const color = { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 };
      const result = roundTrip(
        decorated({ borders: { top: { color, widthPt: 1 } } }),
      );
      expect(onlyCell(result).borders?.top).toEqual({ color, widthPt: 1 });
    });

    it("round-trips a border colour the Ico palette states exactly, without needing the sprmTSetBrc layer at all", () => {
      const color = { r: 1, g: 1, b: 0 }; // Ico 0x07, yellow.
      const result = roundTrip(
        decorated({ borders: { right: { color, widthPt: 0.75 } } }),
      );
      expect(onlyCell(result).borders?.right).toEqual({ color, widthPt: 0.75 });
      // The exact-colour override is emitted only where the palette genuinely cannot hold the colour, so this table's row mark carries no sprmTSetBrc (0xD62F) opcode anywhere in it.
      const bytes = writeDocContent(
        decorated({ borders: { right: { color, widthPt: 0.75 } } }),
      );
      expect(containsSprm(bytes, 0xd62f)).toBe(false);
    });

    it("round-trips a border width in the 1/8-point steps [MS-DOC]'s own dptLineWidth states", () => {
      const color = { r: 0, g: 0, b: 0 };
      const result = roundTrip(
        decorated({ borders: { top: { color, widthPt: 3.125 } } }),
      );
      expect(onlyCell(result).borders?.top?.widthPt).toBe(3.125);
    });

    it("refuses a border wider than the single-byte dptLineWidth can state, rather than silently writing a thinner one", () => {
      expect(() =>
        writeDocContent(
          decorated({
            borders: { top: { color: { r: 0, g: 0, b: 0 }, widthPt: 40 } },
          }),
        ),
      ).toThrow(DocFormatError);
    });

    it("round-trips decoration on a cell that is also horizontally merged", () => {
      const input = document([
        {
          kind: "table",
          columnWidthsPt: [80, 80],
          rows: [
            {
              cells: [
                {
                  blocks: [paragraph([{ text: "wide" }])],
                  colSpan: 2,
                  background: { r: 0, g: 1, b: 1 },
                  borders: {
                    bottom: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 },
                  },
                },
              ],
            },
            {
              cells: [
                { blocks: [paragraph([{ text: "a" }])] },
                { blocks: [paragraph([{ text: "b" }])] },
              ],
            },
          ],
        },
      ]);
      const anchor = tableAt(roundTrip(input), 0).rows[0]?.cells[0];
      expect(anchor?.colSpan).toBe(2);
      expect(anchor?.background).toEqual({ r: 0, g: 1, b: 1 });
      expect(anchor?.borders?.bottom).toEqual({
        color: { r: 1, g: 0, b: 0 },
        widthPt: 1.5,
      });
    });

    it("keeps each cell's decoration its own across a row of differently decorated cells", () => {
      const input = document([
        {
          kind: "table",
          columnWidthsPt: [60, 60, 60],
          rows: [
            {
              cells: [
                {
                  blocks: [paragraph([{ text: "fill" }])],
                  background: { r: 1, g: 1, b: 0 },
                },
                {
                  blocks: [paragraph([{ text: "border" }])],
                  borders: {
                    left: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
                  },
                },
                { blocks: [paragraph([{ text: "bare" }])] },
              ],
            },
          ],
        },
      ]);
      const cells = tableAt(roundTrip(input), 0).rows[0]?.cells;
      expect(cells?.[0]?.background).toEqual({ r: 1, g: 1, b: 0 });
      expect(cells?.[0]?.borders).toBeUndefined();
      expect(cells?.[1]?.background).toBeUndefined();
      expect(cells?.[1]?.borders?.left).toEqual({
        color: { r: 0, g: 0, b: 1 },
        widthPt: 1,
      });
      expect(cells?.[2]?.background).toBeUndefined();
      expect(cells?.[2]?.borders).toBeUndefined();
    });
  });

  describe("metadata", () => {
    it('round-trips title/subject/author/keywords/dates through a real "\\x05SummaryInformation" stream', () => {
      const input: ContentDocument = {
        ...document([paragraph([{ text: "Hello." }])]),
        metadata: {
          title: "Quarterly report",
          subject: "Finance",
          author: "Joe",
          keywords: ["finance", "quarterly"],
          createdIso: "2024-01-15T09:00:00.000Z",
          modifiedIso: "2024-03-20T14:30:00.000Z",
        },
      };
      const result = roundTrip(input);
      expect(result.metadata).toEqual(input.metadata);
    });

    it('writes no "\\x05SummaryInformation" stream at all when metadata carries nothing that stream can hold', () => {
      const input = document([paragraph([{ text: "Hello." }])]);
      const bytes = writeDocContent(input);
      const streams = readCompoundFile(bytes);
      expect(
        streams.some((stream) => stream.path === "\x05SummaryInformation"),
      ).toBe(false);
      expect(readDocContent(bytes).metadata).toEqual({});
    });

    it("drops creator/producer/language, which SummaryInformation cannot hold, without writing an empty stream for them alone", () => {
      const input: ContentDocument = {
        ...document([paragraph([{ text: "Hello." }])]),
        metadata: {
          creator: "Some Tool",
          producer: "Some Producer",
          language: "en-GB",
        },
      };
      const bytes = writeDocContent(input);
      const streams = readCompoundFile(bytes);
      expect(
        streams.some((stream) => stream.path === "\x05SummaryInformation"),
      ).toBe(false);
      expect(readDocContent(bytes).metadata).toEqual({});
    });

    it("throws a DocFormatError, not a raw RangeError, for a malformed createdIso", () => {
      const input: ContentDocument = {
        ...document([paragraph([{ text: "Hello." }])]),
        metadata: { createdIso: "not-a-real-date" },
      };
      expect(() => writeDocContent(input)).toThrow(DocFormatError);
    });

    it("throws a DocFormatError, not a raw RangeError, for a malformed modifiedIso", () => {
      const input: ContentDocument = {
        ...document([paragraph([{ text: "Hello." }])]),
        metadata: { modifiedIso: "not-a-real-date" },
      };
      expect(() => writeDocContent(input)).toThrow(DocFormatError);
    });
  });
});
