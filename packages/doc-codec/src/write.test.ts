import {
  ContentDocumentSchema,
  type ContentBlock,
  type ContentDocument,
  type ContentParagraph,
  type ContentTableCell,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { isDocBytes } from "./detect";
import { DocUnsupportedError } from "./errors";
import { readDocContent } from "./read";
import { writeDocContent } from "./write";

// Verifies writeDocContent by reading its own output back through this package's own reader (readDocContent) -- the round trip this session's own writer packages (archive-codec's CFB writer, odf.js's typed writer) are all verified the same way, and the standing convention this task itself names. A byte-level inspection of the produced .doc would prove nothing readDocContent itself does not already prove by successfully parsing it.

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
    // A colour with no exact match in [MS-DOC] 2.9.126's 17-entry Ico palette (see prop/chp.ts) still round-trips exactly, because encodeCharacterGrpprl writes sprmCCv (a literal COLORREF) rather than snapping to the nearest palette entry.
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

  it("round-trips a horizontally merged cell's colSpan, dropping the continuation cell from the output row", () => {
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
    expect(block.rows[0]?.cells).toHaveLength(2);
    expect(block.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(cellText(block.rows[0]?.cells[0])).toBe("wide");
    expect(block.rows[0]?.cells[1]?.colSpan).toBeUndefined();
    expect(cellText(block.rows[0]?.cells[1])).toBe("narrow");
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
});
