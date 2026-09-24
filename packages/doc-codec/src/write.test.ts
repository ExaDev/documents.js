import {
  ContentDocumentSchema,
  type ContentDocument,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { readDocContent, readDocStreams } from "./read";
import { writeDocContent } from "./write";
import {
  blocksOf,
  document,
  paragraph,
  paragraphAt,
  roundTrip,
} from "./test-support/write";
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
