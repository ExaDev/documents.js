import {
  readCompoundFile,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import { ContentDocumentSchema } from "document-schema.js";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { isDocBytes } from "./detect";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { readDocContent, readDocStreams } from "./read";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";
import { buildFib } from "./test-support/fib";
import {
  CELL_MARK,
  FIELD_BEGIN,
  FIELD_END,
  FIELD_SEPARATOR,
  LINE_BREAK,
} from "./text/special";

// Sprm byte sequences, each written little-endian from its own opcode: the two-byte sprm then its operand.
const BOLD_ON = [0x35, 0x08, 0x01]; // sprmCFBold, ToggleOperand 0x01.
const ITALIC_ON = [0x36, 0x08, 0x01]; // sprmCFItalic.
const SIZE_24PT = [0x43, 0x4a, 0x30, 0x00]; // sprmCHps, 48 half-points.
const RED_TEXT = [0x42, 0x2a, 0x06]; // sprmCIco, palette entry 6.
const CENTRED = [0x61, 0x24, 0x01]; // sprmPJc, logical centre.
const SPACE_BEFORE_12PT = [0x13, 0xa4, 0xf0, 0x00]; // sprmPDyaBefore, 240 twips.
const PAGE_BREAK_BEFORE = [0x07, 0x24, 0x01]; // sprmPFPageBreakBefore, Bool8 true.

function paragraphs(
  document: ReturnType<typeof readDocContent>,
): ContentBlock[] {
  if (document.kind !== "wordprocessing") {
    throw new Error("a .doc always reads as a wordprocessing document");
  }
  const section = document.sections[0];
  if (section === undefined) throw new Error("a section must be present");
  return [...section.blocks];
}

// Narrows one block of the read document to a paragraph, so each assertion below reads the field it means rather than repeating a kind check and an index guard.
function paragraphAt(
  document: ReturnType<typeof readDocContent>,
  index: number,
): ContentParagraph {
  const block = paragraphs(document)[index];
  if (block === undefined) throw new Error(`no block at index ${index}`);
  if (block.kind !== "paragraph") {
    throw new Error(`block ${index} is a ${block.kind}, not a paragraph`);
  }
  return block;
}

function textOf(paragraph: ContentParagraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}

describe("readDocContent", () => {
  it("reads a document's paragraphs and their text", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "First paragraph." }] },
          { runs: [{ text: "Second paragraph." }] },
        ],
      }),
    );
    expect(document.kind).toBe("wordprocessing");
    expect(paragraphs(document)).toHaveLength(2);
    expect(paragraphAt(document, 0).runs.map((run) => run.text)).toEqual([
      "First paragraph.",
    ]);
    expect(paragraphAt(document, 1).runs.map((run) => run.text)).toEqual([
      "Second paragraph.",
    ]);
  });

  it("produces a document the shared schema validates", () => {
    const document = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "Hello." }] }] }),
    );
    expect(ContentDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("reads the same text from a compressed document, whose offsets are stored doubled", () => {
    const document = readDocContent(
      buildDoc({
        compressed: true,
        paragraphs: [{ runs: [{ text: "Compressed text." }] }],
      }),
    );
    expect(paragraphAt(document, 0).runs.map((run) => run.text)).toEqual([
      "Compressed text.",
    ]);
  });

  it("reassembles text whose logical stream is split across several pieces", () => {
    const document = readDocContent(
      buildDoc({
        pieces: 3,
        paragraphs: [
          { runs: [{ text: "One two three four five six seven eight." }] },
        ],
      }),
    );
    expect(paragraphAt(document, 0).runs.map((run) => run.text)).toEqual([
      "One two three four five six seven eight.",
    ]);
  });

  it("splits a paragraph into runs at its character-formatting boundaries", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              { text: "plain " },
              { text: "bold", grpprl: BOLD_ON },
              { text: " and " },
              { text: "italic", grpprl: ITALIC_ON },
            ],
          },
        ],
      }),
    );
    const runs = paragraphAt(document, 0).runs;
    expect(runs.map((run) => run.text)).toEqual([
      "plain ",
      "bold",
      " and ",
      "italic",
    ]);
    expect(runs[1]?.bold).toBe(true);
    expect(runs[3]?.italic).toBe(true);
    expect(runs[0]?.bold).toBeUndefined();
  });

  // A real producer writes ONE Chpx per stretch of unchanging formatting, so two consecutive bold paragraphs share a single exception that spans the paragraph mark between them. The reader has to split runs at the paragraph boundary itself rather than inheriting the split from the formatting table.
  it("splits at paragraph boundaries even when one Chpx spans several paragraphs", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "first", grpprl: BOLD_ON }] },
          { runs: [{ text: "second", grpprl: BOLD_ON }] },
          { runs: [{ text: "third", grpprl: BOLD_ON }] },
        ],
      }),
    );
    expect(paragraphs(document)).toHaveLength(3);
    for (const index of [0, 1, 2]) {
      const runs = paragraphAt(document, index).runs;
      expect(runs).toHaveLength(1);
      expect(runs[0]?.bold).toBe(true);
    }
    expect(textOf(paragraphAt(document, 0))).toBe("first");
    expect(textOf(paragraphAt(document, 2))).toBe("third");
  });

  it("reads a run's font size from sprmCHps, which states it in half-points", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "big", grpprl: SIZE_24PT }] }],
      }),
    );
    expect(paragraphAt(document, 0).runs[0]?.sizePt).toBe(24);
  });

  it("reads a run's colour through the Ico palette", () => {
    const document = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "red", grpprl: RED_TEXT }] }] }),
    );
    expect(paragraphAt(document, 0).runs[0]?.color).toEqual({
      r: 1,
      g: 0,
      b: 0,
    });
  });

  it("reads paragraph alignment, spacing and page breaks from the PAPX exception", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "centred" }], grpprl: CENTRED },
          { runs: [{ text: "spaced" }], grpprl: SPACE_BEFORE_12PT },
          { runs: [{ text: "broken" }], grpprl: PAGE_BREAK_BEFORE },
        ],
      }),
    );
    expect(paragraphAt(document, 0).alignment).toBe("center");
    expect(paragraphAt(document, 1).spacingBeforePt).toBe(12);
    expect(paragraphAt(document, 2).pageBreakBefore).toBe(true);
  });

  it("derives a heading level from the paragraph style index, as sprmPIstd's own rule states", () => {
    const document = readDocContent(
      buildDoc({
        styles: [
          { name: "Normal" },
          { name: "heading 1" },
          { name: "heading 2" },
        ],
        paragraphs: [
          { runs: [{ text: "Title" }], istd: 1 },
          { runs: [{ text: "Subtitle" }], istd: 2 },
          { runs: [{ text: "Body" }], istd: 0 },
        ],
      }),
    );
    expect(paragraphAt(document, 0).headingLevel).toBe(1);
    expect(paragraphAt(document, 1).headingLevel).toBe(2);
    expect(paragraphAt(document, 2).headingLevel).toBeUndefined();
  });

  it("carries each paragraph's style name through from the style sheet", () => {
    const document = readDocContent(
      buildDoc({
        styles: [{ name: "Normal" }, { name: "heading 1" }],
        paragraphs: [{ runs: [{ text: "Title" }], istd: 1 }],
      }),
    );
    expect(paragraphAt(document, 0).styleId).toBe("heading 1");
  });

  // No sprmPFInTable is set on either paragraph here, so these cell marks sit outside any table -- the case this asserts is a bare cell-mark character still ending a paragraph on its own account (endsParagraph's own rule), not table grouping, which table/read.test.ts covers directly.
  it("treats a cell mark outside a table as an ordinary paragraph end", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "cell one" }], mark: CELL_MARK },
          { runs: [{ text: "cell two" }], mark: CELL_MARK },
        ],
      }),
    );
    expect(paragraphs(document)).toHaveLength(2);
    expect(paragraphAt(document, 0).runs[0]?.text).toBe("cell one");
  });

  it("keeps a field's result and drops its instruction", () => {
    const instruction = `${String.fromCharCode(FIELD_BEGIN)} HYPERLINK "https://example.com" ${String.fromCharCode(FIELD_SEPARATOR)}`;
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              { text: "See " },
              { text: instruction },
              { text: "the site" },
              { text: String.fromCharCode(FIELD_END) },
              { text: " for more." },
            ],
          },
        ],
      }),
    );
    const text = textOf(paragraphAt(document, 0));
    expect(text).toBe("See the site for more.");
    expect(text).not.toContain("HYPERLINK");
  });

  // A nested field inside an OUTER field's RESULT is the case a depth counter gets wrong: when the inner field ends, the outer field is still past its own separator, so its remaining text is result text and must survive.
  it("resumes the enclosing field's result after a nested field closes inside it", () => {
    const begin = String.fromCharCode(FIELD_BEGIN);
    const separator = String.fromCharCode(FIELD_SEPARATOR);
    const end = String.fromCharCode(FIELD_END);
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              {
                text: `${begin} OUTER ${separator}before ${begin} INNER ${separator}inner${end} after${end}`,
              },
              { text: " tail." },
            ],
          },
        ],
      }),
    );
    expect(textOf(paragraphAt(document, 0))).toBe("before inner after tail.");
  });

  it("keeps a line break inside a paragraph as a newline rather than a control character", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: `one${String.fromCharCode(LINE_BREAK)}two` }] },
        ],
      }),
    );
    const text = textOf(paragraphAt(document, 0));
    expect(text).toBe("one\ntwo");
  });

  it("emits no run for an empty paragraph rather than a run of empty text", () => {
    const document = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "" }] }] }),
    );
    expect(paragraphAt(document, 0).runs).toEqual([]);
  });
});

describe("readDocStreams", () => {
  it("selects the Table stream FibBase.fWhichTblStm names", () => {
    const streams = readDocStreams(
      buildDoc({ paragraphs: [{ runs: [{ text: "x" }] }] }),
    );
    expect(streams.fib.fWhichTblStm).toBe(1);
    expect(streams.table.length).toBeGreaterThan(0);
  });

  it("rejects a compound file with no WordDocument stream", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: new Uint8Array(16) },
    ]);
    expect(() => readDocStreams(bytes)).toThrow(DocFormatError);
    expect(() => readDocStreams(bytes)).toThrow(/WordDocument/);
  });

  it("rejects a document whose FibBase selects a Table stream the file lacks", () => {
    const bytes = compoundFile([
      { path: "WordDocument", bytes: buildFib({ fWhichTblStm: 0 }) },
    ]);
    expect(() => readDocStreams(bytes)).toThrow(/0Table/);
  });

  it("refuses an encrypted document rather than reading its ciphertext", () => {
    const bytes = compoundFile([
      { path: "WordDocument", bytes: buildFib({ fEncrypted: true }) },
      { path: "1Table", bytes: new Uint8Array(16) },
    ]);
    expect(() => readDocStreams(bytes)).toThrow(DocUnsupportedError);
  });
});

describe("isDocBytes", () => {
  it("accepts a real .doc", () => {
    expect(
      isDocBytes(buildDoc({ paragraphs: [{ runs: [{ text: "x" }] }] })),
    ).toBe(true);
  });

  it("rejects bytes that are not a compound file at all", () => {
    expect(isDocBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });

  it("rejects a compound file of another format, which shares the same container", () => {
    expect(
      isDocBytes(
        compoundFile([{ path: "Workbook", bytes: new Uint8Array(16) }]),
      ),
    ).toBe(false);
  });

  it("rejects a WordDocument stream whose FibBase.wIdent is not 0xA5EC", () => {
    expect(
      isDocBytes(
        compoundFile([
          { path: "WordDocument", bytes: buildFib({ wIdent: 0x1234 }) },
        ]),
      ),
    ).toBe(false);
  });
});

describe("metadata", () => {
  // A real "\x05SummaryInformation" stream added beside the WordDocument/1Table streams a real producer would already have written -- composed here with archive-codec's own writeSummaryInformationStream/writeCompoundFile rather than by extending test-support/doc.ts's buildDoc, which stays a pure [MS-DOC]-only fixture builder.
  function withSummaryInformation(
    doc: Uint8Array<ArrayBuffer>,
    metadata: Parameters<typeof writeSummaryInformationStream>[0],
  ): Uint8Array<ArrayBuffer> {
    return writeCompoundFile([
      ...readCompoundFile(doc),
      {
        path: "\x05SummaryInformation",
        bytes: writeSummaryInformationStream(metadata),
      },
    ]);
  }

  it('reads title/author/dates from a real "\\x05SummaryInformation" stream', () => {
    const doc = withSummaryInformation(
      buildDoc({ paragraphs: [{ runs: [{ text: "Hello." }] }] }),
      {
        title: "Meeting notes",
        author: "Cornelius",
        createdIso: "2024-05-01T00:00:00.000Z",
      },
    );
    const result = readDocContent(doc);
    expect(result.metadata).toEqual({
      title: "Meeting notes",
      author: "Cornelius",
      createdIso: "2024-05-01T00:00:00.000Z",
    });
  });

  it('reads {} when the container carries no "\\x05SummaryInformation" stream', () => {
    const doc = buildDoc({ paragraphs: [{ runs: [{ text: "Hello." }] }] });
    expect(readDocContent(doc).metadata).toEqual({});
  });
});
