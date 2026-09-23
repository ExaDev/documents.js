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
import { DataStreamBuilder } from "./data-stream";
import { isDocBytes } from "./detect";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { PropertyBinTable } from "./prop/fkp";
import { readGrpprl } from "./prop/sprm";
import { readDocContent, readDocStreams } from "./read";
import { applyTableSprms, VERT_MERGE_RESTART } from "./table/tap";
import { MAX_TABLE_ROW_CELLS } from "./table/tap-write";
import {
  DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE,
  EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE,
  exceedsMaxTableRowCells,
  flattenSectionBlocks,
  LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE,
} from "./table/write";
import { readTextRange } from "./text/characters";
import { parseClx } from "./text/piece-table";
import { PARAGRAPH_MARK, SECTION_MARK } from "./text/special";
import {
  CLOSE_SECTION_TRAILING_PARAGRAPH_LOST_MESSAGE,
  EMPTY_SECTION_LIST_MESSAGE,
  layoutParagraphText,
  mergeChpxRuns,
  NO_ILFO_MINTED_MESSAGE,
  PARAGRAPH_ISTD_LOST_MESSAGE,
  PARAGRAPH_START_LOST_MESSAGE,
  sameGrpprl,
  SECTION_START_CP_LOST_MESSAGE,
  SEPX_PLACEMENT_LOST_MESSAGE,
  writeDocContent,
} from "./write";

// Verifies writeDocContent by reading its own output back through this package's own reader (readDocContent) — the round trip this session's own writer packages (archive-codec's CFB writer, odf.js's typed writer) are all verified the same way, and the standing convention this task itself names. This round trip alone cannot prove third-party conformance, though: ExaDev/documents.js#892 is the confirmed counterexample — a table passed this exact suite for the whole time LibreOffice's own .doc import filter rejected it outright, because readDocContent tolerated a document whose Main Document text did not end in the ordinary paragraph mark [MS-DOC] requires. Byte-level and real-reader verification for the table writer specifically lives in the README's own "Third-party verification" paragraph and its accompanying LibreOffice checks, not here.

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

/** `count` block-less entries: the positions a merged region covers besides its anchor, in a dense row (ContentTableCell's grid rule). */
function coveredCells(count: number): ContentTableCell[] {
  return Array.from({ length: count }, () => ({ blocks: [] }));
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

/** The one cell a single-cell, single-row table round-trips to — the shape most decoration assertions below want, since a border or fill is a per-cell fact and needs no other cell to state it. */
function onlyCell(result: ContentDocument): ContentTableCell {
  const cell = tableAt(result, 0).rows[0]?.cells[0];
  if (cell === undefined) throw new Error("expected one cell");
  return cell;
}

/** The whole Main Document text stream, control characters included — the only way to observe which exact terminator character (a section mark vs. an ordinary paragraph mark) writeDocContent chose at a given position, since readDocContent's own section split relies on PlcfSed's cp boundaries rather than on this specific character value. */
function rawText(bytes: Uint8Array<ArrayBuffer>): string {
  const { wordDocument, table, fib } = readDocStreams(bytes);
  const pieceTable = parseClx(slice(table, fib.fcClx, fib.lcbClx, "Clx"));
  return readTextRange(wordDocument, pieceTable, 0, fib.ccpText).text;
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
    // bold:false must survive as a genuine ToggleOperand 0x00, not be silently equivalent to omitting the sprm — distinguished here by writing it adjacent to a bold:true run, which would otherwise merge with an "absent" run into one Chpx exception.
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
    const { fib } = readDocStreams(bytes);
    expect(fib.lcbSttbfFfn).toBe(0);
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
      paragraph([{ text: "right-indented" }], { indentRightPt: 24 }),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).alignment).toBe("center");
    expect(paragraphAt(result, 1).indentLeftPt).toBe(36);
    expect(paragraphAt(result, 1).indentFirstLinePt).toBe(-18);
    expect(paragraphAt(result, 2).spacingBeforePt).toBe(12);
    expect(paragraphAt(result, 2).spacingAfterPt).toBe(6);
    expect(paragraphAt(result, 3).lineSpacing).toBe(1.5);
    expect(paragraphAt(result, 4).pageBreakBefore).toBe(true);
    expect(paragraphAt(result, 5).indentRightPt).toBe(24);
  });

  it("round-trips a paragraph's own left and right indent together", () => {
    // sprmPDxaLeft (0x845E) and sprmPDxaRight (0x845D) differ by one bit — a regression here would show up as one indent silently overwriting the other rather than as a missing property, so this pins both present at once with different, sign-distinct values.
    const input = document([
      paragraph([{ text: "boxed" }], {
        indentLeftPt: 18,
        indentRightPt: -9,
      }),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).indentLeftPt).toBe(18);
    expect(paragraphAt(result, 0).indentRightPt).toBe(-9);
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
    // This writer only ever emits 16-bit (uncompressed) pieces (see text/piece-table-write.ts), so a character the reader's own COMPRESSED_CHARACTER_MAP has no entry for is never at risk — a surrogate pair is simply two ordinary UTF-16 code units to a 16-bit piece.
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

  it("does not write past the text stream's own end when its length lands exactly on the next page boundary", () => {
    // TEXT_FC (0x400) plus a 256-character text stream (512 bytes of 16-bit units) lands exactly on the next 512-byte FKP page boundary, leaving zero padding before the first ChpxFkp page begins — if the text-writing loop's own bound wrote one character too many, the spurious extra code unit would land in that page's own first two bytes rather than in harmless padding.
    const text = "A".repeat(255); // + the paragraph's own terminator makes 256 characters.
    const input = document([paragraph([{ text }])]);
    const result = roundTrip(input);
    expect(
      paragraphAt(result, 0)
        .runs.map((run) => run.text)
        .join(""),
    ).toBe(text);
  });

  it("refuses a non-wordprocessing document", () => {
    const spreadsheet: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    };
    expect(() => writeDocContent(spreadsheet)).toThrow(DocUnsupportedError);
    expect(() => writeDocContent(spreadsheet)).toThrow(
      "doc-codec writes wordprocessing documents only; got a 'spreadsheet' document",
    );
  });

  it("refuses a wordprocessing document with no sections at all", () => {
    const empty: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    expect(() => writeDocContent(empty)).toThrow(DocFormatError);
    expect(() => writeDocContent(empty)).toThrow(
      "a wordprocessing document must carry at least one section",
    );
  });

  it("refuses a block kind it does not yet write, such as a construct-end marker", () => {
    // A pageBreak used to be this test's refused kind and now writes (see the page-break describe below), so the generic non-paragraph-block refusal is exercised through a construct-boundary marker, which stays refused until ExaDev/documents.js#1122 lands. A close marker carries only its kind — no descriptor, which is the open half's payload.
    const input = document([{ kind: "constructEnd" }]);
    expect(() => writeDocContent(input)).toThrow(
      /doc-codec's writer does not yet support 'constructEnd' blocks/,
    );
  });

  it("refuses a non-paragraph block inside a table cell, such as a nested table", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }],
        rows: [
          {
            cells: [
              {
                blocks: [
                  {
                    kind: "table",
                    columns: [{ widthPt: 10 }],
                    rows: [{ cells: [{ blocks: [] }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /doc-codec's writer does not support a 'table' block inside a table cell/,
    );
  });

  it("refuses an embedded-object block, a genuinely separate undertaking this reader does not implement either (ExaDev/documents.js#971)", () => {
    const input = document([
      {
        kind: "embeddedObject",
        objectKind: "chart",
        document: { kind: "spreadsheet", metadata: {}, sheets: [] },
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });

  it("refuses a construct-boundary marker block, tracked separately on ExaDev/documents.js#1122", () => {
    const input = document([
      { kind: "constructStart", descriptor: { kind: "division" } },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });
});

// A manual page break is the end-of-section character (0x000C) placed where no section ends, per [MS-DOC]'s own PlcfSed.aCP text ("An end-of-section character (0x0C) which occurs at a CP and which is not the last character in a section specifies a manual page break"), and the writer's spelling retargets the preceding paragraph's own terminator to 0x000C — so the ordinary case round-trips exactly, while a break with no ordinary paragraph before it to carry it mints the empty 0x000C-terminated paragraph the format requires (see appendPageBreak's own comment for why that empty paragraph is the format's own limit, not a loss).
describe("writeDocContent page breaks", () => {
  it("round-trips a page break between two paragraphs as [paragraph, pageBreak, paragraph]", () => {
    const result = roundTrip(
      document([
        paragraph([{ text: "alpha" }]),
        { kind: "pageBreak" },
        paragraph([{ text: "beta" }]),
      ]),
    );
    expect(blocksOf(result)).toEqual([
      { kind: "paragraph", runs: [{ text: "alpha" }] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "beta" }] },
    ]);
  });

  it("round-trips a page break carrying paragraph formatting on the paragraph it terminates, and a second break after it", () => {
    const result = roundTrip(
      document([
        paragraph([{ text: "kept" }], { alignment: "center" }),
        { kind: "pageBreak" },
        { kind: "pageBreak" },
        paragraph([{ text: "after two breaks" }]),
      ]),
    );
    // The first break retargets "kept"'s own terminator; the second has no ordinary paragraph mark behind it any more, so it mints its own empty 0x000C-terminated paragraph — visible in the round trip as the empty paragraph between the two breaks, exactly as appendPageBreak's comment states.
    expect(blocksOf(result)).toEqual([
      { kind: "paragraph", runs: [{ text: "kept" }], alignment: "center" },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "after two breaks" }] },
    ]);
  });

  it("writes a leading page break as its own empty break paragraph, which reads back with that empty paragraph stated", () => {
    const result = roundTrip(
      document([{ kind: "pageBreak" }, paragraph([{ text: "beta" }])]),
    );
    expect(blocksOf(result)).toEqual([
      { kind: "paragraph", runs: [] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "beta" }] },
    ]);
  });

  it("writes a page break after a table as its own empty break paragraph, never retargeting the table's row mark", () => {
    const result = roundTrip(
      document([
        {
          kind: "table",
          rows: [
            {
              cells: [
                { blocks: [paragraph([{ text: "cell" }])] },
                { blocks: [paragraph([{ text: "mate" }])] },
              ],
            },
          ],
          columns: [{ widthPt: 100 }, { widthPt: 100 }],
        },
        { kind: "pageBreak" },
        paragraph([{ text: "after the table" }]),
      ]),
    );
    // A row-ending mark is a cell mark (0x0007) and MUST stay one, so the break cannot retarget it: the empty break paragraph follows the table's own trailing closing paragraph instead.
    const blocks = blocksOf(result);
    expect(blocks[0]?.kind).toBe("table");
    expect(blocks.slice(1)).toEqual([
      { kind: "paragraph", runs: [] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "after the table" }] },
    ]);
  });

  it("writes a page break as a non-final section's last block without disturbing the end-of-section character after it", () => {
    const input: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            paragraph([{ text: "ending on a break" }]),
            { kind: "pageBreak" },
          ],
        },
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          blocks: [paragraph([{ text: "section two" }])],
        },
      ],
    };
    const result = roundTrip(input);
    if (result.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(result.sections).toHaveLength(2);
    // The break's 0x000C lands immediately before the section's own end-of-section character, and closeSection's existing trailing-paragraph guarantee supplies the ordinary paragraph mark the section boundary needs — so the break itself survives, with the paragraph it forced stated in the round trip.
    expect(result.sections[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "ending on a break" }] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [] },
    ]);
    expect(result.sections[1]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "section two" }] },
    ]);
  });
});

// ExaDev/documents.js#971: writeDocContent used to refuse a document with more than one section outright. Now every section writes its own real PlcfSed/Sepx entry with its own page size and margins, and the boundary between two sections is a genuine end-of-section character (0x000C, [MS-DOC] 2.4.4), never merged into one.
describe("writeDocContent multiple sections", () => {
  function twoSectionDocument(): ContentDocument {
    return {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [paragraph([{ text: "section one" }])],
        },
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          blocks: [paragraph([{ text: "section two" }])],
        },
      ],
    };
  }

  it("terminates every section but the last on a real end-of-section character, and the last on an ordinary paragraph mark", () => {
    const bytes = writeDocContent(twoSectionDocument());
    const text = rawText(bytes);
    // "section one" (11 chars) ends the first, non-final section; its own terminator must be SECTION_MARK, never PARAGRAPH_MARK.
    expect(text.codePointAt(11)).toBe(SECTION_MARK);
    // The Main Document's own final character, closing the last section, must be an ordinary paragraph mark.
    expect(text.codePointAt(text.length - 1)).toBe(PARAGRAPH_MARK);
  });

  it("round-trips each section's own page size, margins and blocks independently", () => {
    const result = roundTrip(twoSectionDocument());
    if (result.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(result.sections).toHaveLength(2);
    const [first, second] = result.sections;
    if (first === undefined || second === undefined) {
      throw new Error("expected two sections");
    }
    expect(first.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(first.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
    expect(second.pageSize).toEqual({ widthPt: 595, heightPt: 842 });
    expect(second.margins).toEqual({
      topPt: 36,
      rightPt: 36,
      bottomPt: 36,
      leftPt: 36,
    });
    if (
      first.blocks[0]?.kind !== "paragraph" ||
      second.blocks[0]?.kind !== "paragraph"
    ) {
      throw new Error("expected a paragraph block in each section");
    }
    expect(first.blocks[0].runs.map((run) => run.text)).toEqual([
      "section one",
    ]);
    expect(second.blocks[0].runs.map((run) => run.text)).toEqual([
      "section two",
    ]);
  });

  it("round-trips three sections, keeping every boundary distinct", () => {
    const input: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [0, 1, 2].map((index) => ({
        pageSize: { widthPt: 500 + index, heightPt: 700 },
        margins: { topPt: 40, rightPt: 40, bottomPt: 40, leftPt: 40 },
        blocks: [paragraph([{ text: `section ${String(index)}` }])],
      })),
    };
    const result = roundTrip(input);
    if (result.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(result.sections).toHaveLength(3);
    result.sections.forEach((section, index) => {
      expect(section.pageSize.widthPt).toBe(500 + index);
      const block = section.blocks[0];
      if (block?.kind !== "paragraph") {
        throw new Error(`expected a paragraph in section ${String(index)}`);
      }
      expect(block.runs.map((run) => run.text)).toEqual([
        `section ${String(index)}`,
      ]);
    });
  });

  it("ends a non-final section on an ordinary paragraph mark even when its own last block is a table", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [{ cells: [{ blocks: [paragraph([{ text: "cell" }])] }] }],
    };
    const input: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [table],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [paragraph([{ text: "after" }])],
        },
      ],
    };
    const result = roundTrip(input);
    if (result.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(result.sections).toHaveLength(2);
    // The section's own end-of-section character may not land on the table's own row-ending mark (closeSection's own guarantee — see writeDocContent's own comment), so a trailing empty paragraph closes it first, exactly as [MS-DOC] 2.4.4's worked example requires.
    expect(result.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "table",
      "paragraph",
    ]);
    const second = result.sections[1]?.blocks[0];
    if (second?.kind !== "paragraph") {
      throw new Error("expected a paragraph in the second section");
    }
    expect(second.runs.map((run) => run.text)).toEqual(["after"]);
  });
});

// ExaDev/documents.js#971: writeDocContent used to throw DocUnsupportedError for every image block. Now a 'png'/'jpeg' inline picture writes a genuine PICFAndOfficeArtData blob into a real Data stream, matching pictures.ts's own read-side byte layout exactly in reverse.
describe("writeDocContent stories", () => {
  // writeDocContent's own output read back through readDocContent: the WritableDocContent fields a DocContent carries are the round trip's own subject, so this helper hands the reader's full output shape straight back to the writer rather than rebuilding it.
  function roundTripStories(
    input: Parameters<typeof writeDocContent>[0],
  ): ReturnType<typeof readDocContent> {
    return readDocContent(writeDocContent(input));
  }

  function baseDocument(
    blocks: readonly ContentBlock[],
  ): Parameters<typeof writeDocContent>[0] {
    return document(blocks);
  }

  it("round-trips footnotes, endnotes, and comments as plain-text story bodies", () => {
    const result = roundTripStories({
      ...baseDocument([paragraph([{ text: "body" }])]),
      footnotes: [
        { id: "1", text: "first footnote" },
        { id: "2", text: "second footnote" },
      ],
      endnotes: [{ id: "1", text: "an endnote" }],
      comments: [{ id: "1", text: "a comment" }],
    });
    expect(result.footnotes).toEqual([
      { id: "1", text: "first footnote" },
      { id: "2", text: "second footnote" },
    ]);
    expect(result.endnotes).toEqual([{ id: "1", text: "an endnote" }]);
    expect(result.comments).toEqual([{ id: "1", text: "a comment" }]);
  });

  it("round-trips a note whose text carries newlines, including a trailing one", () => {
    // The trailing "\n" is the case the guard spelling exists for: the note's own last (empty) paragraph is a content paragraph, and the writer's separate guard mark beyond it is what lets the reader's guard-drop rule invert the text exactly.
    const result = roundTripStories({
      ...baseDocument([paragraph([{ text: "body" }])]),
      footnotes: [{ id: "1", text: "line one\nline two\n" }],
    });
    expect(result.footnotes).toEqual([
      { id: "1", text: "line one\nline two\n" },
    ]);
  });

  it("round-trips an empty note text as an empty story", () => {
    const result = roundTripStories({
      ...baseDocument([paragraph([{ text: "body" }])]),
      footnotes: [{ id: "1", text: "" }],
    });
    expect(result.footnotes).toEqual([{ id: "1", text: "" }]);
  });

  it("writes no subdocument at all for a document that states no stories", () => {
    const bytes = writeDocContent(
      baseDocument([paragraph([{ text: "plain" }])]),
    );
    const { fib } = readDocStreams(bytes);
    expect(fib.ccpFtn).toBe(0);
    expect(fib.ccpHdd).toBe(0);
    expect(fib.ccpAtn).toBe(0);
    expect(fib.ccpEdn).toBe(0);
    const result = readDocContent(bytes);
    expect(result.footnotes).toEqual([]);
    expect(result.endnotes).toEqual([]);
    expect(result.comments).toEqual([]);
    expect(result.headerFooterStories).toEqual([]);
  });

  it("round-trips header/footer stories per section and slot, with absent slots staying absent", () => {
    const result = roundTripStories({
      kind: "wordprocessing",
      metadata: {},
      footnotes: [{ id: "1", text: "a footnote riding along" }],
      headerFooterStories: [
        {
          section: 0,
          slot: "oddHeader",
          blocks: [paragraph([{ text: "the odd header" }])],
        },
        {
          section: 1,
          slot: "oddFooter",
          blocks: [paragraph([{ text: "second section footer" }])],
        },
      ],
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [paragraph([{ text: "section one" }])],
        },
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          blocks: [paragraph([{ text: "section two" }])],
        },
      ],
    });
    expect(result.headerFooterStories).toEqual([
      {
        section: 0,
        slot: "oddHeader",
        blocks: [{ kind: "paragraph", runs: [{ text: "the odd header" }] }],
      },
      {
        section: 1,
        slot: "oddFooter",
        blocks: [
          { kind: "paragraph", runs: [{ text: "second section footer" }] },
        ],
      },
    ]);
  });

  it("round-trips a header story carrying a table, through the identical table pipeline the main document uses", () => {
    const result = roundTripStories({
      ...baseDocument([paragraph([{ text: "body" }])]),
      headerFooterStories: [
        {
          section: 0,
          slot: "oddHeader",
          blocks: [
            paragraph([{ text: "header intro" }]),
            {
              kind: "table",
              rows: [
                {
                  cells: [
                    { blocks: [paragraph([{ text: "left" }])] },
                    { blocks: [paragraph([{ text: "right" }])] },
                  ],
                },
              ],
              columns: [{ widthPt: 100 }, { widthPt: 100 }],
            },
          ],
        },
      ],
    });
    expect(result.headerFooterStories).toHaveLength(1);
    const story = result.headerFooterStories[0];
    expect(story?.slot).toBe("oddHeader");
    expect(story?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "header intro" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "left" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "right" }] }] },
            ],
          },
        ],
        columns: [{ widthPt: 100 }, { widthPt: 100 }],
      },
    ]);
  });

  it("round-trips a story whose blocks flatten to nothing as present-but-blank, not as an absent slot", () => {
    const result = roundTripStories({
      ...baseDocument([paragraph([{ text: "body" }])]),
      headerFooterStories: [{ section: 0, slot: "evenFooter", blocks: [] }],
    });
    expect(result.headerFooterStories).toEqual([
      {
        section: 0,
        slot: "evenFooter",
        blocks: [{ kind: "paragraph", runs: [] }],
      },
    ]);
  });

  it("refuses a header/footer story naming a section this document does not have", () => {
    expect(() =>
      writeDocContent({
        ...baseDocument([paragraph([{ text: "body" }])]),
        headerFooterStories: [
          {
            section: 3,
            slot: "oddHeader",
            blocks: [paragraph([{ text: "nowhere" }])],
          },
        ],
      }),
    ).toThrow(DocFormatError);
  });

  it("refuses two stories for the same section and slot", () => {
    expect(() =>
      writeDocContent({
        ...baseDocument([paragraph([{ text: "body" }])]),
        headerFooterStories: [
          {
            section: 0,
            slot: "oddHeader",
            blocks: [paragraph([{ text: "one" }])],
          },
          {
            section: 0,
            slot: "oddHeader",
            blocks: [paragraph([{ text: "two" }])],
          },
        ],
      }),
    ).toThrow(DocFormatError);
  });

  it("re-writes a full readDocContent output unchanged — a genuine DocContent assigns straight across", () => {
    const first = roundTripStories({
      ...baseDocument([paragraph([{ text: "body" }])]),
      footnotes: [{ id: "1", text: "note" }],
      headerFooterStories: [
        {
          section: 0,
          slot: "oddHeader",
          blocks: [paragraph([{ text: "hdr" }])],
        },
      ],
    });
    const second = roundTripStories(first);
    expect(second.footnotes).toEqual(first.footnotes);
    expect(second.endnotes).toEqual(first.endnotes);
    expect(second.comments).toEqual(first.comments);
    expect(second.headerFooterStories).toEqual(first.headerFooterStories);
    if (first.kind !== "wordprocessing" || second.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(second.sections[0]?.blocks).toEqual(first.sections[0]?.blocks);
  });
});

describe("writeDocContent inline pictures", () => {
  function base64Of(bytes: readonly number[]): string {
    return btoa(String.fromCharCode(...bytes));
  }

  it("round-trips a PNG image's own bytes, format and size", () => {
    const pngBytes = [137, 80, 78, 71, 1, 2, 3, 4, 5, 6, 7, 8];
    const input = document([
      {
        kind: "image",
        format: "png",
        base64: base64Of(pngBytes),
        widthPt: 72,
        heightPt: 36,
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "image") {
      throw new Error(`expected an image block, got '${block?.kind}'`);
    }
    expect(block.format).toBe("png");
    expect(block.widthPt).toBe(72);
    expect(block.heightPt).toBe(36);
    expect(
      Array.from(atob(block.base64), (char) => char.charCodeAt(0)),
    ).toEqual(pngBytes);
  });

  it("round-trips a JPEG image", () => {
    const jpegBytes = [0xff, 0xd8, 0xff, 0xd9];
    const input = document([
      {
        kind: "image",
        format: "jpeg",
        base64: base64Of(jpegBytes),
        widthPt: 10,
        heightPt: 20,
      },
    ]);
    const result = roundTrip(input);
    const block = blocksOf(result)[0];
    if (block?.kind !== "image") {
      throw new Error(`expected an image block, got '${block?.kind}'`);
    }
    expect(block.format).toBe("jpeg");
    expect(
      Array.from(atob(block.base64), (char) => char.charCodeAt(0)),
    ).toEqual(jpegBytes);
  });

  it("splits a paragraph carrying real text around an inline picture into separate blocks", () => {
    const input = document([
      paragraph([{ text: "before " }]),
      {
        kind: "image",
        format: "png",
        base64: base64Of([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
        widthPt: 10,
        heightPt: 10,
      },
      paragraph([{ text: "after" }]),
    ]);
    const result = roundTrip(input);
    const blocks = blocksOf(result);
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
  });

  it("writes more than one picture into the same Data stream at distinct offsets", () => {
    const input = document([
      {
        kind: "image",
        format: "png",
        base64: base64Of([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]),
        widthPt: 10,
        heightPt: 10,
      },
      {
        kind: "image",
        format: "png",
        base64: base64Of([0x89, 0x50, 0x4e, 0x47, 2, 2, 2, 2]),
        widthPt: 20,
        heightPt: 20,
      },
    ]);
    const result = roundTrip(input);
    const blocks = blocksOf(result);
    expect(blocks.map((block) => block.kind)).toEqual(["image", "image"]);
    const [first, second] = blocks;
    if (first?.kind !== "image" || second?.kind !== "image") {
      throw new Error("expected two image blocks");
    }
    expect(
      Array.from(atob(first.base64), (char) => char.charCodeAt(0)),
    ).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]);
    expect(
      Array.from(atob(second.base64), (char) => char.charCodeAt(0)),
    ).toEqual([0x89, 0x50, 0x4e, 0x47, 2, 2, 2, 2]);
  });

  it("refuses an image format it cannot write, such as svg", () => {
    const input = document([
      {
        kind: "image",
        format: "svg",
        base64: "",
        widthPt: 10,
        heightPt: 10,
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });

  it('writes no "Data" stream at all when the document carries no pictures', () => {
    const bytes = writeDocContent(document([paragraph([{ text: "plain" }])]));
    expect(readDocStreams(bytes).data).toBeUndefined();
  });
});

// ExaDev/documents.js#1059: writeDocContent used to hardcode istd 0 for every paragraph, so styleId/headingLevel never round-tripped at all. These pin the mint-a-real-STSH-entry fix — identity only, no formatting of a style's own (every property still writes as a direct exception, unchanged).
describe("writeDocContent style identity", () => {
  it("round-trips a heading's own styleId and headingLevel through a real STSH entry", () => {
    const input = document([
      paragraph([{ text: "Title" }], { styleId: "heading 1", headingLevel: 1 }),
      paragraph([{ text: "Body" }]),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).styleId).toBe("heading 1");
    expect(paragraphAt(result, 0).headingLevel).toBe(1);
    // An ordinary paragraph with neither field keeps neither — istd 0 stays an unnamed hole rather than a real "Normal" entry, so an absent styleId round-trips as absent, not as the string "Normal".
    expect(paragraphAt(result, 1).styleId).toBeUndefined();
    expect(paragraphAt(result, 1).headingLevel).toBeUndefined();
  });

  it("mints one real STSH entry per distinct named style, reused across every paragraph that shares it", () => {
    const input = document([
      paragraph([{ text: "First" }], { styleId: "Quote" }),
      paragraph([{ text: "Second" }], { styleId: "Quote" }),
      paragraph([{ text: "Third" }], { styleId: "Caption" }),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).styleId).toBe("Quote");
    expect(paragraphAt(result, 1).styleId).toBe("Quote");
    expect(paragraphAt(result, 2).styleId).toBe("Caption");
  });

  it("round-trips several distinct heading levels each to their own istd, honouring headingLevelFromIstd's 1-9 rule", () => {
    const input = document([
      paragraph([{ text: "Title" }], { styleId: "heading 1", headingLevel: 1 }),
      paragraph([{ text: "Subtitle" }], {
        styleId: "heading 2",
        headingLevel: 2,
      }),
      paragraph([{ text: "Body" }]),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).headingLevel).toBe(1);
    expect(paragraphAt(result, 1).headingLevel).toBe(2);
    expect(paragraphAt(result, 2).headingLevel).toBeUndefined();
  });

  it("treats a styleId of literally 'Normal' as an ordinary named style, distinct from an absent styleId", () => {
    const input = document([
      paragraph([{ text: "Explicit" }], { styleId: "Normal" }),
      paragraph([{ text: "Implicit" }]),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).styleId).toBe("Normal");
    expect(paragraphAt(result, 1).styleId).toBeUndefined();
  });

  it("writes every paragraph's own properties as a direct exception regardless of its styleId, since a mint-only style carries no formatting of its own", () => {
    const input = document([
      paragraph([{ text: "Title" }], {
        styleId: "heading 1",
        headingLevel: 1,
        alignment: "center",
      }),
    ]);
    const result = roundTrip(input);
    expect(paragraphAt(result, 0).alignment).toBe("center");
  });
});

describe("writeDocContent numbering", () => {
  it("writes a multi-level numbered list and reads back every level's own format and text", () => {
    const input = document([
      paragraph([{ text: "first" }], {
        list: { numId: "1", level: 0, format: "decimal" },
      }),
      paragraph([{ text: "nested" }], {
        list: { numId: "1", level: 1, format: "upperRoman" },
      }),
      paragraph([{ text: "second" }], {
        list: { numId: "1", level: 0, format: "decimal" },
      }),
    ]);
    const bytes = writeDocContent(input);
    const result = readDocContent(bytes);
    expect(paragraphAt(result, 0).list).toEqual({ numId: "1", level: 0 });
    expect(paragraphAt(result, 1).list).toEqual({ numId: "1", level: 1 });
    expect(paragraphAt(result, 2).list).toEqual({ numId: "1", level: 0 });
    expect(result.numbering["1"]?.levels["0"]).toMatchObject({
      format: "decimal",
      text: "%1.",
    });
    expect(result.numbering["1"]?.levels["1"]).toMatchObject({
      format: "upperRoman",
      text: "%2.",
    });
  });

  it("writes a bulleted list and reads back its glyph rather than a numbered placeholder", () => {
    const input = document([
      paragraph([{ text: "one" }], {
        list: { numId: "1", level: 0, format: "bullet" },
      }),
      paragraph([{ text: "two" }], {
        list: { numId: "1", level: 0, format: "bullet" },
      }),
    ]);
    const bytes = writeDocContent(input);
    const result = readDocContent(bytes);
    expect(result.numbering["1"]?.levels["0"]?.format).toBe("bullet");
    expect(result.numbering["1"]?.levels["0"]?.text).toBe("•");
  });

  it("mints a separate ilfo per distinct numId, in first-occurrence order", () => {
    const input = document([
      paragraph([{ text: "a" }], {
        list: { numId: "5", level: 0, format: "decimal" },
      }),
      paragraph([{ text: "b" }], {
        list: { numId: "9", level: 0, format: "lowerLetter" },
      }),
    ]);
    const bytes = writeDocContent(input);
    const result = readDocContent(bytes);
    // Neither original numId ("5"/"9") survives: [MS-DOC] addresses a list by a one-based ilfo, not an opaque identifier, so this package's own writer renumbers to whichever ilfo it mints — see list/numbering-write.ts's own top comment.
    expect(paragraphAt(result, 0).list).toEqual({ numId: "1", level: 0 });
    expect(paragraphAt(result, 1).list).toEqual({ numId: "2", level: 0 });
    expect(result.numbering["1"]?.levels["0"]?.format).toBe("decimal");
    expect(result.numbering["2"]?.levels["0"]?.format).toBe("lowerLetter");
  });

  it("writes no numbering tables at all when no paragraph belongs to a list", () => {
    const bytes = writeDocContent(document([paragraph([{ text: "plain" }])]));
    const result = readDocContent(bytes);
    expect(result.numbering).toEqual({});
  });

  it("round-trips a list membership inside a table cell", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 200 }],
        rows: [
          {
            cells: [
              {
                blocks: [
                  paragraph([{ text: "cell item" }], {
                    list: { numId: "1", level: 0, format: "decimal" },
                  }),
                ],
              },
            ],
          },
        ],
      },
    ]);
    const bytes = writeDocContent(input);
    const result = readDocContent(bytes);
    const block = blocksOf(result)[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    const cell = block.rows[0]?.cells[0];
    const cellParagraph = cell?.blocks[0];
    if (cellParagraph?.kind !== "paragraph") {
      throw new Error("expected a paragraph inside the cell");
    }
    expect(cellParagraph.list).toEqual({ numId: "1", level: 0 });
    expect(result.numbering["1"]?.levels["0"]?.format).toBe("decimal");
  });
});

describe("writeDocContent tables", () => {
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
      onWarning: (message) => warnings.push(message),
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
    writeDocContent(input, { onWarning: (message) => warnings.push(message) });
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
      onWarning: (message) => warnings.push(message),
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
      onWarning: (message) => warnings.push(message),
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
      onWarning: (message) => warnings.push(message),
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
      onWarning: (message) => fittingWarnings.push(message),
    });
    const fittingBlock = tableAt(readDocContent(fittingBytes), 0);
    expect(fittingWarnings).toEqual([]);
    expect(fittingBlock.columns).toHaveLength(withinBudget);
    expect(fittingBlock.rows[0]?.cells[0]?.colSpan).toBe(withinBudget);

    const overflowingWarnings: string[] = [];
    const overflowingBytes = writeDocContent(buildSingleRowTable(overBudget), {
      onWarning: (message) => overflowingWarnings.push(message),
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
      onWarning: (message) => warnings.push(message),
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
      onWarning: (message) => warnings.push(message),
    });
    expect(isDocBytes(bytes)).toBe(true);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("table at block 1, row 0");
    expect(warnings[1]).toContain("table at block 3, row 0");
  });

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

  it("throws when a row's own cells cover more columns than the table declares", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              { blocks: [paragraph([{ text: "wide" }])], colSpan: 2 },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "extra" }])] },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table cell's own colSpan runs past the table's 2-column grid/,
    );
  });

  it("throws when a row's own cells cover fewer columns than the table declares", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [{ blocks: [paragraph([{ text: "narrow" }])] }],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table row's own cells cover 1 columns \(via colSpan\), but the table declares 3 columns/,
    );
  });

  it("throws naming the exact requirement when a table declares no columns at all", () => {
    const input = document([
      { kind: "table", columns: [], rows: [{ cells: [] }] },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table must have at least one column and one row to write/,
    );
  });

  it("throws naming the exact requirement when a table declares no rows at all", () => {
    const input = document([
      { kind: "table", columns: [{ widthPt: 50 }], rows: [] },
    ]);
    expect(() => writeDocContent(input)).toThrow(
      /a table must have at least one column and one row to write/,
    );
  });

  it("falls all the way back to writing a row wholly unsplit when even its single most valuable assigned boundary cannot fit, warning with the singular wording (ExaDev/documents.js#1013)", () => {
    // 20 ordinary, undecorated single-column cells plus one further 2-wide merged cell (21 columns, 1 row): the 20 plain cells' own boundaries are all recoverable on their own, leaving exactly the merge's own single internal boundary lost — and, being a single row, assigned entirely to this one row. Splitting it would raise the row from 21 to 22 physical cells, which — entirely from the 20 plain cells' own fixed 22-bytes-per-cell cost plus the row's own fixed 15-byte overhead — already sits close enough to the 487-byte PapxInFkp ceiling that the extra cell tips it over, while the unsplit 21-cell form still fits. rowSplitFits therefore rejects the only candidate this row could ever try (kept.length reaches 0), which is the "could not state ... at all" wording this describe block's other trimming tests never reach, since each of them still keeps at least one boundary.
    const plainColumnCount = 20;
    const columns = [
      ...Array.from({ length: plainColumnCount }, () => ({ widthPt: 20 })),
      { widthPt: 20 },
      { widthPt: 20 },
    ];
    const input = document([
      {
        kind: "table",
        columns,
        rows: [
          {
            cells: [
              ...Array.from({ length: plainColumnCount }, (_unused, index) => ({
                blocks: [paragraph([{ text: `c${index}` }])],
              })),
              {
                blocks: [paragraph([{ text: "merged" }])],
                colSpan: 2,
              },
              ...coveredCells(1),
            ],
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    const bytes = writeDocContent(input, {
      onWarning: (message) => warnings.push(message),
    });
    expect(isDocBytes(bytes)).toBe(true);
    const block = tableAt(readDocContent(bytes), 0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("table at block 0, row 0");
    expect(warnings[0]).toMatch(
      /could not state its assigned lost column boundary/,
    );
    expect(warnings[0]).toMatch(/attempting to write it unsplit instead/);
    // Unsplit: the merged cell's own internal boundary never made it into rgdxaCenter, so it reads back as one ordinary column, narrowing the table by exactly one.
    expect(block.columns).toHaveLength(plainColumnCount + 1);
    // Derived from the round-tripped table's own column count, not restated as the plainColumnCount literal: a bare literal index here trips a confirmed @typescript-eslint/no-unnecessary-condition false positive against noUncheckedIndexedAccess (it does not account for a `const`-literal-typed index into an array, even though tsc itself still reports the access as possibly undefined without its own `?.`).
    const mergedIndex = block.columns.length - 1;
    expect(block.rows[0]?.cells[mergedIndex]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[mergedIndex])).toBe("merged");
  });

  it("never engages the lost-boundary fallback at all for a row with no merges, even one whose own bare cells already overflow the format's own byte budget", () => {
    // 25 ordinary, single-column, unmerged cells: recoverableBoundaries states every internal boundary on its own (nothing merges across any of them), so this row's own assigned lost-boundary set is empty and flattenTable's own fallback code never runs for it at all — not even to try, fail, and warn. The row's own bare, undecorated cells already cost 15 + 22 x 25 = 565 bytes, past the 487-byte PapxInFkp ceiling regardless of any lost-boundary machinery, so writeDocContent still throws — but from the real, unrelated buildPapxPages call this fallback exists to route around only when boundaries are actually lost, never from this describe block's own onWarning at all.
    const columnCount = 25;
    const input = document([
      {
        kind: "table",
        columns: Array.from({ length: columnCount }, () => ({ widthPt: 20 })),
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
    expect(() =>
      writeDocContent(input, {
        onWarning: (message) => warnings.push(message),
      }),
    ).toThrow(/does not fit in one 512-byte formatted disk page/);
    expect(warnings).toEqual([]);
  });

  it("throws for a row so wide that even its own fully-unsplit merged form still overflows the format's byte budget, after warning it could not state any of its assigned boundaries", () => {
    // 30 colSpan-2 pairs (60 columns, 1 row): every pair's own internal boundary is lost (a single row states nothing any other row could corroborate), all 30 assigned to this one row. Even the fully collapsed, wholly-unsplit form — kept.length trimmed all the way to 0, the smallest this row could ever ask rowSplitFits to try — still costs 15 + 22 x 30 = 675 bytes, past the 487-byte ceiling: the trimming loop's own downward scan exhausts every candidate down to kept.length === 0 and stops there (rather than looping forever re-trying an already-empty candidate), leaving flattenRow to encode the row unsplit regardless, which writeDocContent's own later buildPapxPages call then genuinely rejects.
    const pairCount = 30;
    const input = document([
      {
        kind: "table",
        columns: Array.from({ length: pairCount * 2 }, () => ({ widthPt: 20 })),
        rows: [
          {
            cells: Array.from({ length: pairCount }, (_unused, index) => [
              {
                blocks: [paragraph([{ text: `c${index}` }])],
                colSpan: 2,
              },
              ...coveredCells(1),
            ]).flat(),
          },
        ],
      },
    ]);
    const warnings: string[] = [];
    expect(() =>
      writeDocContent(input, {
        onWarning: (message) => warnings.push(message),
      }),
    ).toThrow(/does not fit in one 512-byte formatted disk page/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      new RegExp(`any of its ${pairCount} assigned lost column boundaries`),
    );
    expect(warnings[0]).toMatch(/attempting to write it unsplit instead/);
  });

  it("writes a genuinely blank cell as blank, not as a vertical-merge continuation of the cell above it", () => {
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 80 }, { widthPt: 80 }],
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
    // The cell above a genuinely blank cell must not come back claiming a rowSpan it never had — that would be exactly the "blank cell silently mis-written as a vertical-merge continuation" defect.
    expect(block.rows[0]?.cells[0]?.rowSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[0])).toBe("A1");
    // Unlike a vertical-merge continuation (which the reader normalises back to `blocks: []` regardless of its own paragraph content, since a continuation's content is never rendered), an ordinary blank cell keeps the single empty paragraph [MS-DOC] requires every physical cell to carry — the closest a lossless round trip of "no blocks" can reach.
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
        columns: [{ widthPt: 50 }, { widthPt: 50 }, { widthPt: 50 }],
        rows: [
          {
            cells: [
              {
                blocks: [paragraph([{ text: "anchor" }])],
                colSpan: 2,
                rowSpan: 2,
              },
              ...coveredCells(1),
              { blocks: [paragraph([{ text: "C1" }])] },
            ],
          },
          {
            cells: [
              ...coveredCells(2),
              { blocks: [paragraph([{ text: "C2" }])] },
            ],
          },
          // Neither row above ever states the boundary between the anchor's own 2 merged columns, since both merge across it identically — a third, wholly unmerged row is what reveals the table genuinely has 3 columns here, so the lost-boundary fallback never triggers for this particular table (see this describe block's own "recovers colSpan and columns" tests for what the fallback does when no row reveals it at all).
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
    expect(block.columns.map((c) => c.widthPt)).toEqual([50, 50, 50]);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(block.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("anchor");
    expect(cellText(block.rows[0]?.cells[2])).toBe("C1");
    // Every row holds one entry per grid column: the row below states the 2-wide vertical continuation as two block-less entries, neither carrying a span of its own.
    expect(block.rows[1]?.cells).toHaveLength(3);
    expect(block.rows[1]?.cells.slice(0, 2)).toEqual(coveredCells(2));
    expect(cellText(block.rows[1]?.cells[2])).toBe("C2");
    expect(block.rows[2]?.cells.map((cell) => cellText(cell))).toEqual([
      "A3",
      "B3",
      "C3",
    ]);
  });

  it("appends a trailing empty paragraph when a table is the section's own last block, so the document's last character is a genuine paragraph mark rather than the table's own row-ending cell mark", () => {
    // [MS-DOC]'s own "Main Document" glossary entry: "The last character in the main document MUST be a paragraph mark (Unicode 0x000D)" — never the row-ending mark's own cell-mark character (0x0007), even though a row-ending mark is a perfectly legal paragraph-boundary terminator everywhere else. Without this, a real third-party [MS-DOC] reader (LibreOffice) does not merely lose a property — it fails to recognise the table at all (ExaDev/documents.js#892).
    const input = document([
      {
        kind: "table",
        columns: [{ widthPt: 100 }],
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
        columns: [{ widthPt: 100 }],
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
        columns: [{ widthPt: 100 }],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "table", rows: [], columns: [] }],
              },
            ],
          },
        ],
      },
    ]);
    expect(() => writeDocContent(input)).toThrow(DocUnsupportedError);
  });

  // ContentTableCell.background and .borders, through TC80's own four Brc80 fields, the sprmTSetBrc exact-colour layer beside them, and the row's own sprmTDefTableShd array (src/table/decoration.ts). Every case here was additionally checked against real LibreOffice 26.2.5.2 output in both directions — see the README's own "Third-party verification" paragraph for exactly which sub-cases that covered and which it did not.
  describe("cell decoration", () => {
    // A single-cell table carrying whatever decoration a test wants to state, so each assertion below is about the decoration alone rather than about cell structure it re-establishes every time.
    const decorated = (cell: Partial<ContentTableCell>): ContentDocument =>
      document([
        {
          kind: "table",
          columns: [{ widthPt: 120 }],
          rows: [
            { cells: [{ blocks: [paragraph([{ text: "x" }])], ...cell }] },
          ],
        },
      ]);

    it("round-trips a cell's solid background fill", () => {
      const background = {
        kind: "solid" as const,
        color: { r: 1, g: 1, b: 0 },
      };
      const result = roundTrip(decorated({ background }));
      expect(onlyCell(result).background).toEqual(background);
    });

    it("round-trips a background colour the Ico palette cannot state, through Shd's own exact COLORREFs", () => {
      // #4C7FBF is deliberately nowhere near a palette entry: Shd carries cvFore/cvBack as full COLORREFs, so unlike a Brc80 border there is no palette step to lose it at.
      const background = {
        kind: "solid" as const,
        color: { r: 0x4c / 255, g: 0x7f / 255, b: 0xbf / 255 },
      };
      const result = roundTrip(decorated({ background }));
      expect(onlyCell(result).background).toEqual(background);
    });

    it("round-trips a genuine two-colour pattern fill — a percentage grey — instead of dropping it (ExaDev/documents.js#951)", () => {
      const background = {
        kind: "pattern" as const,
        patternType: "percent20" as const,
        foregroundColor: { r: 0, g: 0, b: 0 },
        backgroundColor: { r: 1, g: 1, b: 1 },
      };
      const result = roundTrip(decorated({ background }));
      expect(onlyCell(result).background).toEqual(background);
    });

    it("round-trips a genuine two-colour crosshatch pattern fill (ExaDev/documents.js#951)", () => {
      const background = {
        kind: "pattern" as const,
        patternType: "diagonalCross" as const,
        foregroundColor: { r: 1, g: 0, b: 0 },
        backgroundColor: { r: 0, g: 0, b: 1 },
      };
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
          columns: [{ widthPt: 80 }, { widthPt: 80 }],
          rows: [
            {
              cells: [
                {
                  blocks: [paragraph([{ text: "wide" }])],
                  colSpan: 2,
                  background: { kind: "solid", color: { r: 0, g: 1, b: 1 } },
                  borders: {
                    bottom: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 },
                  },
                },
                ...coveredCells(1),
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
      expect(anchor?.background).toEqual({
        kind: "solid",
        color: { r: 0, g: 1, b: 1 },
      });
      expect(anchor?.borders?.bottom).toEqual({
        color: { r: 1, g: 0, b: 0 },
        widthPt: 1.5,
      });
    });

    it("keeps each cell's decoration its own across a row of differently decorated cells", () => {
      const input = document([
        {
          kind: "table",
          columns: [{ widthPt: 60 }, { widthPt: 60 }, { widthPt: 60 }],
          rows: [
            {
              cells: [
                {
                  blocks: [paragraph([{ text: "fill" }])],
                  background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
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
      expect(cells?.[0]?.background).toEqual({
        kind: "solid",
        color: { r: 1, g: 1, b: 0 },
      });
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

describe("writeDocContent: hyperlinks (#1187)", () => {
  it("round-trips a hyperlink run as a HYPERLINK field whose result carries the uri", () => {
    const bytes = writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "see " },
                { text: "the site", hyperlink: "https://example.com/x" },
                { text: " for more" },
              ],
            },
          ],
        },
      ],
    });
    const reread = readDocContent(bytes);
    if (reread.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(reread.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [
        { text: "see " },
        { text: "the site", hyperlink: "https://example.com/x" },
        { text: " for more" },
      ],
    });
  });

  it("joins consecutive same-uri runs into one field and splits at a differing uri", () => {
    const bytes = writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "one", hyperlink: "https://a.example/" },
                { text: "two", hyperlink: "https://a.example/" },
                { text: "three", hyperlink: "https://b.example/" },
              ],
            },
          ],
        },
      ],
    });
    const reread = readDocContent(bytes);
    if (reread.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(reread.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [
        { text: "onetwo", hyperlink: "https://a.example/" },
        { text: "three", hyperlink: "https://b.example/" },
      ],
    });
  });
});

// Every one of these names an invariant writeDocContent's own logic maintains, never one a caller's input could violate — no real call through writeDocContent's own public surface can ever reach the assertDefined each one guards (see write.ts's own top comment for why). Asserted against a hardcoded duplicate rather than by importing and comparing a constant to itself, the same discipline errors.test.ts's own assertDefined tests follow — otherwise a mutant emptying the constant's own declaration would still pass, since both sides of the comparison would be the identical mutated value.
describe("writeDocContent's own internal-defect messages", () => {
  it("names the numId NO_ILFO_MINTED_MESSAGE reports, JSON-quoted", () => {
    expect(NO_ILFO_MINTED_MESSAGE("3")).toBe(
      'internal defect: writeDocContent\'s own list-usage map has no ilfo minted for numId "3"',
    );
  });

  it("carries PARAGRAPH_START_LOST_MESSAGE's own exact text", () => {
    expect(PARAGRAPH_START_LOST_MESSAGE).toBe(
      "internal defect: writeDocContent lost a paragraph's own start position",
    );
  });

  it("carries PARAGRAPH_ISTD_LOST_MESSAGE's own exact text", () => {
    expect(PARAGRAPH_ISTD_LOST_MESSAGE).toBe(
      "internal defect: writeDocContent lost a paragraph's own minted istd",
    );
  });

  it("carries EMPTY_SECTION_LIST_MESSAGE's own exact text", () => {
    expect(EMPTY_SECTION_LIST_MESSAGE).toBe(
      "internal defect: writeDocContent built an empty section list despite the earlier at-least-one-section guard",
    );
  });

  it("names the section index SEPX_PLACEMENT_LOST_MESSAGE reports", () => {
    expect(SEPX_PLACEMENT_LOST_MESSAGE(2)).toBe(
      "internal defect: writeDocContent lost section 2's own Sepx placement",
    );
  });

  it("names the section index SECTION_START_CP_LOST_MESSAGE reports", () => {
    expect(SECTION_START_CP_LOST_MESSAGE(1)).toBe(
      "internal defect: writeDocContent lost section 1's own start CP",
    );
  });

  it("carries CLOSE_SECTION_TRAILING_PARAGRAPH_LOST_MESSAGE's own exact text", () => {
    expect(CLOSE_SECTION_TRAILING_PARAGRAPH_LOST_MESSAGE).toBe(
      "internal defect: closeSection lost its own just-ensured trailing paragraph",
    );
  });

  it("carries DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE's own exact text", () => {
    expect(DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE).toBe(
      "internal defect: distributeLostBoundaries built fewer row buckets than the row count it was given",
    );
  });

  it("carries EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE's own exact text", () => {
    expect(EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE).toBe(
      "internal defect: a table's own column-boundary array is empty despite the columnCount guard above",
    );
  });

  it("carries LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE's own exact text", () => {
    expect(LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE).toBe(
      "internal defect: distributeLostBoundaries returned fewer buckets than the table has rows",
    );
  });

  it("treats exactly MAX_TABLE_ROW_CELLS as still fitting, one cell more as exceeding it", () => {
    // rowSplitFits' own note explains why no real trial from flattenTable's own splitting search ever reaches this ceiling in practice; exercised directly here so the boundary itself (63 fits, 64 does not) stays pinned regardless.
    expect(exceedsMaxTableRowCells(MAX_TABLE_ROW_CELLS)).toBe(false);
    expect(exceedsMaxTableRowCells(MAX_TABLE_ROW_CELLS + 1)).toBe(true);
  });
});

describe("layoutParagraphText", () => {
  it("lays out a single plain-text paragraph, its own last run's exception extended over its terminator", () => {
    const { text, paragraphStarts, chpxRuns } = layoutParagraphText([
      { runs: [{ text: "Hi", grpprl: [] }], terminator: PARAGRAPH_MARK },
    ]);
    expect(text).toBe("Hi\r");
    expect(paragraphStarts).toEqual([0]);
    expect(chpxRuns).toEqual([{ start: 0, end: 3, grpprl: undefined }]);
  });

  it("extends a formatted run's own exception over its paragraph's terminator, rather than adding a second one", () => {
    const boldGrpprl = [1, 2, 3];
    const { chpxRuns } = layoutParagraphText([
      {
        runs: [{ text: "Hi", grpprl: boldGrpprl }],
        terminator: PARAGRAPH_MARK,
      },
    ]);
    expect(chpxRuns).toEqual([{ start: 0, end: 3, grpprl: boldGrpprl }]);
  });

  it("gives a paragraph with no runs of its own a fresh, plain exception for its terminator alone", () => {
    // No run at all means chpxRuns is still empty when the mark is reached — lastRun is undefined, so the extension check can never match, and the mark gets pushed as its own one-character exception rather than extending nothing.
    const { chpxRuns } = layoutParagraphText([
      { runs: [], terminator: PARAGRAPH_MARK },
    ]);
    expect(chpxRuns).toEqual([{ start: 0, end: 1, grpprl: undefined }]);
  });

  it("skips a run whose own text is empty, adding no Chpx exception for it at all", () => {
    const { text, chpxRuns } = layoutParagraphText([
      {
        runs: [
          { text: "", grpprl: [9] },
          { text: "Body", grpprl: [] },
        ],
        terminator: PARAGRAPH_MARK,
      },
    ]);
    expect(text).toBe("Body\r");
    expect(chpxRuns).toEqual([{ start: 0, end: 5, grpprl: undefined }]);
  });

  it("records each paragraph's own start position, across more than one paragraph", () => {
    const { paragraphStarts } = layoutParagraphText([
      { runs: [{ text: "AB", grpprl: [] }], terminator: PARAGRAPH_MARK },
      { runs: [{ text: "C", grpprl: [] }], terminator: PARAGRAPH_MARK },
    ]);
    expect(paragraphStarts).toEqual([0, 3]);
  });

  it("uses each paragraph's own terminator character, not always the ordinary paragraph mark", () => {
    const { text } = layoutParagraphText([
      { runs: [{ text: "Row", grpprl: [] }], terminator: 0x07 },
    ]);
    expect(text).toBe("Row");
  });
});

describe("sameGrpprl", () => {
  it("treats two absent grpprls as the same formatting", () => {
    expect(sameGrpprl(undefined, undefined)).toBe(true);
  });

  it("treats an absent grpprl and a present one as different, in either direction", () => {
    expect(sameGrpprl(undefined, [1])).toBe(false);
    expect(sameGrpprl([1], undefined)).toBe(false);
  });

  it("treats two byte-identical grpprls as the same formatting", () => {
    expect(sameGrpprl([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("treats grpprls of equal length but differing bytes as different", () => {
    expect(sameGrpprl([1, 2], [1, 3])).toBe(false);
  });

  it("treats grpprls of differing length as different, regardless of which is longer", () => {
    expect(sameGrpprl([1, 2], [1, 2, 3])).toBe(false);
    expect(sameGrpprl([1, 2, 3], [1, 2])).toBe(false);
  });
});

describe("mergeChpxRuns", () => {
  it("merges two contiguous runs carrying byte-identical grpprl into one", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1, 2] },
      { start: 2, end: 5, grpprl: [1, 2] },
    ]);
    expect(merged).toEqual([{ start: 0, end: 5, grpprl: [1, 2] }]);
  });

  it("does not merge two contiguous runs whose grpprl differs", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1, 2] },
      { start: 2, end: 5, grpprl: [3, 4] },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 2, grpprl: [1, 2] },
      { start: 2, end: 5, grpprl: [3, 4] },
    ]);
  });

  it("does not merge two runs with identical grpprl that are not actually contiguous", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1] },
      { start: 3, end: 5, grpprl: [1] },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 2, grpprl: [1] },
      { start: 3, end: 5, grpprl: [1] },
    ]);
  });

  it("merges a whole chain of contiguous, identically formatted runs into one", () => {
    const merged = mergeChpxRuns([
      { start: 0, end: 2, grpprl: [1] },
      { start: 2, end: 4, grpprl: [1] },
      { start: 4, end: 6, grpprl: [1] },
    ]);
    expect(merged).toEqual([{ start: 0, end: 6, grpprl: [1] }]);
  });

  it("returns an empty list for an empty input", () => {
    expect(mergeChpxRuns([])).toEqual([]);
  });
});
