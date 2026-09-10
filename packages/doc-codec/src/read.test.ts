import {
  createXorObfuscationArray,
  createXorObfuscationKey,
  createXorObfuscationPasswordVerifier,
  decryptOfficeRc4,
  decryptXorObfuscationMethod2,
  deriveOfficeRc4BaseHash,
  md5,
  OFFICE_RC4_DOC_BLOCK_SIZE,
  OFFICE_RC4_VERIFIER_LENGTH,
  readCompoundFile,
  writeCompoundFile,
  writeSummaryInformationStream,
  XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
} from "archive-codec";
import { ContentDocumentSchema } from "document-schema.js";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { isDocBytes } from "./detect";
import { DocFormatError, DocUnsupportedError } from "./errors";
import {
  FC_LCB_VALUE_INDEX,
  FIB_FC_LCB_BLOB_OFFSET,
  FIB_LKEY_OFFSET,
} from "./fib/offsets";
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
  SECTION_MARK,
} from "./text/special";

// Sprm byte sequences, each written little-endian from its own opcode: the two-byte sprm then its operand.
const BOLD_ON = [0x35, 0x08, 0x01]; // sprmCFBold, ToggleOperand 0x01.
const ITALIC_ON = [0x36, 0x08, 0x01]; // sprmCFItalic.
const SIZE_24PT = [0x43, 0x4a, 0x30, 0x00]; // sprmCHps, 48 half-points.
const RED_TEXT = [0x42, 0x2a, 0x06]; // sprmCIco, palette entry 6.
const CENTRED = [0x61, 0x24, 0x01]; // sprmPJc, logical centre.
const SPACE_BEFORE_12PT = [0x13, 0xa4, 0xf0, 0x00]; // sprmPDyaBefore, 240 twips.
const PAGE_BREAK_BEFORE = [0x07, 0x24, 0x01]; // sprmPFPageBreakBefore, Bool8 true.
// A section grpprl stating a page 600x800pt with a 90/54/45/36pt left/right/top/bottom margin -- one Prl per sprm, none of them the format's own default value, so a test reading them back proves the real field rather than coincidentally matching a fallback.
const SECTION_GEOMETRY = [
  0x1f,
  0xb0,
  0xe0,
  0x2e, // sprmSXaPage, 12000 twips (600pt).
  0x20,
  0xb0,
  0x80,
  0x3e, // sprmSYaPage, 16000 twips (800pt).
  0x21,
  0xb0,
  0x08,
  0x07, // sprmSDxaLeft, 1800 twips (90pt).
  0x22,
  0xb0,
  0x38,
  0x04, // sprmSDxaRight, 1080 twips (54pt).
  0x23,
  0x90,
  0x84,
  0x03, // sprmSDyaTop, 900 twips (45pt).
  0x24,
  0x90,
  0xd0,
  0x02, // sprmSDyaBottom, 720 twips (36pt).
];

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

  it("reads a fixed (negative YAS) top/bottom margin as its absolute size, the same as a minimum one", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "text" }] }],
        sectionGrpprl: [
          0x23,
          0x90,
          0x30,
          0xfd, // sprmSDyaTop, -720 twips fixed (36pt).
          0x24,
          0x90,
          0x60,
          0xfa, // sprmSDyaBottom, -1440 twips fixed (72pt).
        ],
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const section = document.sections[0];
    if (section === undefined) throw new Error("a section must be present");
    expect(section.margins.topPt).toBe(36);
    expect(section.margins.bottomPt).toBe(72);
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

  it("reads a section's own page size and margins from its Sepx", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "text" }] }],
        sectionGrpprl: SECTION_GEOMETRY,
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const section = document.sections[0];
    if (section === undefined) throw new Error("a section must be present");
    expect(section.pageSize).toEqual({ widthPt: 600, heightPt: 800 });
    expect(section.margins).toEqual({
      leftPt: 90,
      rightPt: 54,
      topPt: 45,
      bottomPt: 36,
    });
  });

  it("falls back to Word's own new-document default when the file carries no PlcfSed at all", () => {
    const document = readDocContent(
      buildDoc({ paragraphs: [{ runs: [{ text: "text" }] }] }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const section = document.sections[0];
    if (section === undefined) throw new Error("a section must be present");
    expect(section.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section.margins).toEqual({
      leftPt: 72,
      rightPt: 72,
      topPt: 72,
      bottomPt: 72,
    });
  });

  it("reads a genuine multi-section document, each section's own PlcfSed/Sepx giving its own page size and margins", () => {
    // A second section's own geometry, deliberately different from SECTION_GEOMETRY above in every field, so a test reading either back proves it resolved the right Sed rather than reusing the first's.
    const SECTION_GEOMETRY_TWO = [
      0x1f,
      0xb0,
      0x40,
      0x1f, // sprmSXaPage, 8000 twips (400pt).
      0x20,
      0xb0,
      0xa0,
      0x27, // sprmSYaPage, 10144 twips (~507.2pt, an arbitrary non-round value).
      0x21,
      0xb0,
      0xb4,
      0x00, // sprmSDxaLeft, 180 twips (9pt).
      0x22,
      0xb0,
      0xb4,
      0x00, // sprmSDxaRight, 180 twips (9pt).
      0x23,
      0x90,
      0xb4,
      0x00, // sprmSDyaTop, 180 twips (9pt).
      0x24,
      0x90,
      0xb4,
      0x00, // sprmSDyaBottom, 180 twips (9pt).
    ];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "first section" }] },
          { runs: [{ text: "still first section" }] },
          // The section boundary: this paragraph's own mark is the end-of-section character (0x000C), [MS-DOC] 2.8.26's "an end-of-section character MUST be the final character in the text range of all but the last section".
          { runs: [{ text: "end of first" }], mark: SECTION_MARK },
          { runs: [{ text: "second section" }] },
        ],
        sections: [SECTION_GEOMETRY, SECTION_GEOMETRY_TWO],
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    expect(document.sections).toHaveLength(2);
    const [first, second] = document.sections;
    if (first === undefined || second === undefined) {
      throw new Error("both sections must be present");
    }
    expect(first.pageSize).toEqual({ widthPt: 600, heightPt: 800 });
    expect(first.margins).toEqual({
      leftPt: 90,
      rightPt: 54,
      topPt: 45,
      bottomPt: 36,
    });
    expect(
      first.blocks.map((block) =>
        block.kind === "paragraph"
          ? block.runs.map((run) => run.text).join("")
          : "",
      ),
    ).toEqual(["first section", "still first section", "end of first"]);

    expect(second.pageSize).toEqual({ widthPt: 400, heightPt: 507.2 });
    expect(second.margins).toEqual({
      leftPt: 9,
      rightPt: 9,
      topPt: 9,
      bottomPt: 9,
    });
    expect(
      second.blocks.map((block) =>
        block.kind === "paragraph"
          ? block.runs.map((run) => run.text).join("")
          : "",
      ),
    ).toEqual(["second section"]);
  });

  it("reads a manual page break -- a 0x000C where no section ends -- as a pageBreak block after the paragraph it terminates", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [{ text: "before the break" }],
            mark: SECTION_MARK,
            pageBreak: true,
          },
          { runs: [{ text: "after the break" }] },
        ],
        // One section only: the page break's 0x000C opens no section boundary, which is exactly what distinguishes it from the end-of-section character of the identical value ([MS-DOC]'s own PlcfSed.aCP text: "An end-of-section character (0x0C) which occurs at a CP and which is not the last character in a section specifies a manual page break").
        sectionGrpprl: SECTION_GEOMETRY,
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before the break" }] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "after the break" }] },
    ]);
  });

  it("reads a manual page break and a genuine section boundary in the same document without conflating the two", () => {
    // A second geometry, deliberately different from SECTION_GEOMETRY in every field, so the two sections' own properties prove the boundary landed where the real section mark is, not where the page break is.
    const SECOND_GEOMETRY = [0x1f, 0xb0, 0x40, 0x1f, 0x20, 0xb0, 0xa0, 0x27];
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "one" }], mark: SECTION_MARK, pageBreak: true },
          { runs: [{ text: "two" }], mark: SECTION_MARK },
          { runs: [{ text: "three" }] },
        ],
        sections: [SECTION_GEOMETRY, SECOND_GEOMETRY],
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(document.sections).toHaveLength(2);
    // The first 0x000C is a page break (no PlcfSed boundary follows it), so its paragraph carries the break block and stays inside section one; the second is the real end of section one, which never gains a break block of its own.
    expect(document.sections[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "two" }] },
    ]);
    expect(document.sections[1]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "three" }] },
    ]);
  });

  it("reads an empty paragraph terminated by a manual page break as [empty paragraph, pageBreak], the shape a break with no preceding text has", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [], mark: SECTION_MARK, pageBreak: true },
          { runs: [{ text: "following" }] },
        ],
        sectionGrpprl: SECTION_GEOMETRY,
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(document.sections[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "following" }] },
    ]);
  });

  it("reads footnotes, endnotes, and comments as plain text, one story per subdocument", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "main text" }] }],
        footnotes: [
          [{ runs: [{ text: "first footnote" }] }],
          [{ runs: [{ text: "second footnote" }] }],
        ],
        endnotes: [[{ runs: [{ text: "an endnote" }] }]],
        comments: [[{ runs: [{ text: "a reviewer comment" }] }]],
      }),
    );
    expect(document.footnotes).toEqual([
      { id: "1", text: "first footnote" },
      { id: "2", text: "second footnote" },
    ]);
    expect(document.endnotes).toEqual([{ id: "1", text: "an endnote" }]);
    expect(document.comments).toEqual([
      { id: "1", text: "a reviewer comment" },
    ]);
  });

  it("reads a footnote/endnote/comment story spanning more than one paragraph as newline-joined text", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "main" }] }],
        footnotes: [
          [
            { runs: [{ text: "first line" }] },
            { runs: [{ text: "second line" }] },
          ],
        ],
      }),
    );
    expect(document.footnotes).toEqual([
      { id: "1", text: "first line\nsecond line" },
    ]);
  });

  // The spelling a real producer writes for note stories: no separate guard paragraph, the story ending at its own final content mark (confirmed against a LibreOffice-authored .doc -- without this fix, that producer's single-paragraph footnotes read as "" and its multi-paragraph ones lost their last paragraph). The guard spelling every test above uses is the other legal shape and must keep reading identically.
  it("reads a note story with no separate guard paragraph -- the real-producer spelling -- without dropping its last paragraph", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "main" }] }],
        bareNoteStories: true,
        footnotes: [
          [{ runs: [{ text: "single-paragraph note" }] }],
          [
            { runs: [{ text: "first paragraph" }] },
            { runs: [{ text: "second paragraph" }] },
          ],
        ],
        endnotes: [[{ runs: [{ text: "an endnote" }] }]],
        comments: [[{ runs: [{ text: "a comment" }] }]],
      }),
    );
    expect(document.footnotes).toEqual([
      { id: "1", text: "single-paragraph note" },
      { id: "2", text: "first paragraph\nsecond paragraph" },
    ]);
    expect(document.endnotes).toEqual([{ id: "1", text: "an endnote" }]);
    expect(document.comments).toEqual([{ id: "1", text: "a comment" }]);
  });

  it("reads an empty footnote story as empty text without absorbing the next story's content", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "main" }] }],
        footnotes: [[], [{ runs: [{ text: "real footnote" }] }]],
      }),
    );
    expect(document.footnotes).toEqual([
      { id: "1", text: "" },
      { id: "2", text: "real footnote" },
    ]);
  });

  it("reads header/footer stories as real block flow, positioned by section and slot, with an empty story omitted entirely", () => {
    // Plcfhdd's own fixed layout: six separator stories (all empty here, since nothing under test needs them), then one section's own six -- evenHeader, oddHeader, evenFooter, oddFooter, firstHeader, firstFooter -- only the odd header and odd footer given real content, the rest left empty.
    const document = readDocContent(
      buildDoc({
        paragraphs: [{ runs: [{ text: "main text" }] }],
        headerFooterStories: [
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [{ runs: [{ text: "the odd header" }] }],
          [],
          [{ runs: [{ text: "the odd footer" }] }],
          [],
          [],
        ],
      }),
    );
    expect(document.headerFooterStories).toHaveLength(2);
    const header = document.headerFooterStories.find(
      (story) => story.slot === "oddHeader",
    );
    const footer = document.headerFooterStories.find(
      (story) => story.slot === "oddFooter",
    );
    if (header === undefined || footer === undefined) {
      throw new Error("both the odd header and odd footer must be present");
    }
    expect(header.section).toBe(0);
    expect(footer.section).toBe(0);
    expect(
      header.blocks.map((block) =>
        block.kind === "paragraph"
          ? block.runs.map((run) => run.text).join("")
          : "",
      ),
    ).toEqual(["the odd header"]);
    expect(
      footer.blocks.map((block) =>
        block.kind === "paragraph"
          ? block.runs.map((run) => run.text).join("")
          : "",
      ),
    ).toEqual(["the odd footer"]);
  });

  it("positions header/footer stories against the right section in a multi-section document", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          { runs: [{ text: "first section" }] },
          { runs: [{ text: "end of first" }], mark: SECTION_MARK },
          { runs: [{ text: "second section" }] },
        ],
        sections: [SECTION_GEOMETRY, SECTION_GEOMETRY],
        headerFooterStories: [
          [],
          [],
          [],
          [],
          [],
          [],
          // Section 0's own six slots.
          [],
          [{ runs: [{ text: "section one header" }] }],
          [],
          [],
          [],
          [],
          // Section 1's own six slots.
          [],
          [{ runs: [{ text: "section two header" }] }],
          [],
          [],
          [],
          [],
        ],
      }),
    );
    expect(document.headerFooterStories).toHaveLength(2);
    const first = document.headerFooterStories.find(
      (story) => story.section === 0,
    );
    const second = document.headerFooterStories.find(
      (story) => story.section === 1,
    );
    if (first === undefined || second === undefined) {
      throw new Error("both sections' own headers must be present");
    }
    expect(first.slot).toBe("oddHeader");
    expect(second.slot).toBe("oddHeader");
    const textOfStory = (
      story: (typeof document.headerFooterStories)[number],
    ) =>
      story.blocks.map((block) =>
        block.kind === "paragraph"
          ? block.runs.map((run) => run.text).join("")
          : "",
      );
    expect(textOfStory(first)).toEqual(["section one header"]);
    expect(textOfStory(second)).toEqual(["section two header"]);
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

  // Issue #1005: a style's own grLPUpxSw was read for identity only (name, kind, base) and never for its own formatting sets, so a "heading 1" paragraph carried its styleId but none of the boldness, size, or spacing the style itself supplies. These pin the fix -- both the paragraph-level and run-level halves of a style's own formatting, the "more specific wins" precedence up an istdBase inheritance chain, and every layer's own precedence over the one beneath it.
  describe("resolves a style's own formatting (#1005)", () => {
    it("folds a paragraph style's own grpprlPapx into the paragraph, with no direct exception present", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", papxGrpprl: SPACE_BEFORE_12PT },
          ],
          paragraphs: [{ runs: [{ text: "Title" }], istd: 1 }],
        }),
      );
      expect(paragraphAt(document, 0).spacingBeforePt).toBe(12);
    });

    it("folds a paragraph style's own grpprlChpx into every run of the paragraph, with no direct run exception present", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", chpxGrpprl: [...BOLD_ON, ...SIZE_24PT] },
          ],
          paragraphs: [{ runs: [{ text: "Title" }], istd: 1 }],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(24);
    });

    it("lets a paragraph's own direct PAPX exception override its style's grpprlPapx", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", papxGrpprl: SPACE_BEFORE_12PT },
          ],
          paragraphs: [{ runs: [{ text: "Title" }], istd: 1, grpprl: CENTRED }],
        }),
      );
      const paragraph = paragraphAt(document, 0);
      // The style's own spacing still applies -- direct formatting overrides only the properties it actually touches, not the whole style.
      expect(paragraph.spacingBeforePt).toBe(12);
      expect(paragraph.alignment).toBe("center");
    });

    it("lets a run's own direct CHPX exception override its paragraph style's grpprlChpx", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", chpxGrpprl: [...BOLD_ON, ...SIZE_24PT] },
          ],
          paragraphs: [
            {
              istd: 1,
              runs: [{ text: "Title", grpprl: ITALIC_ON }],
            },
          ],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      // The style's own bold and size still apply -- the run's own exception only touches italic.
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(24);
      expect(run?.italic).toBe(true);
    });

    it("resolves an istdBase inheritance chain with the more specific (derived) style's own property winning", () => {
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            // heading 1: bold + 24pt, no base.
            { name: "heading 1", chpxGrpprl: [...BOLD_ON, ...SIZE_24PT] },
            // heading 2: based on heading 1, overrides only the size to 12pt (half-points 24) -- bold must still come from the base, and 12pt (not 24pt) must win for size.
            {
              name: "heading 2",
              istdBase: 1,
              chpxGrpprl: [0x43, 0x4a, 0x18, 0x00],
            },
          ],
          paragraphs: [{ runs: [{ text: "Subtitle" }], istd: 2 }],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(12);
    });

    it("folds a run's own referenced character style (sprmCIstd) between the paragraph style and the run's own direct exception", () => {
      const CHARACTER_STYLE_ISTD = [0x30, 0x4a, 0x02, 0x00]; // sprmCIstd, istd 2.
      const document = readDocContent(
        buildDoc({
          styles: [
            { name: "Normal" },
            { name: "heading 1", chpxGrpprl: [...BOLD_ON] },
            { name: "Strong", stk: 2, chpxGrpprl: [...SIZE_24PT] },
          ],
          paragraphs: [
            {
              istd: 1,
              runs: [
                {
                  text: "Title",
                  grpprl: [...CHARACTER_STYLE_ISTD, ...ITALIC_ON],
                },
              ],
            },
          ],
        }),
      );
      const run = paragraphAt(document, 0).runs[0];
      // heading 1's own bold, Strong's own size, and the run's own direct italic all survive together.
      expect(run?.bold).toBe(true);
      expect(run?.sizePt).toBe(24);
      expect(run?.italic).toBe(true);
    });

    it("resolves no formatting at all for a table- or numbering-kind style, without throwing", () => {
      // stk 3 (table) and 4 (numbering) carry StkTableGRLPUPX/StkListGRLPUPX, a differently-shaped formatting set parseGrLPUpxSw does not read -- a paragraph naming one as its istd (an unusual document, but not a malformed one) must still read cleanly, with nothing folded in from the style.
      const document = readDocContent(
        buildDoc({
          styles: [{ name: "Normal" }, { name: "Table Grid", stk: 3 }],
          paragraphs: [{ runs: [{ text: "Cell text" }], istd: 1 }],
        }),
      );
      const paragraph = paragraphAt(document, 0);
      expect(paragraph.styleId).toBe("Table Grid");
      expect(paragraph.runs[0]?.bold).toBeUndefined();
    });

    it("throws when an istdBase chain loops back on itself, rather than recursing forever", () => {
      const document = buildDoc({
        styles: [
          { name: "Normal" },
          { name: "A", istdBase: 2 },
          { name: "B", istdBase: 1 },
        ],
        paragraphs: [{ runs: [{ text: "Text" }], istd: 1 }],
      });
      expect(() => readDocContent(document)).toThrow(DocFormatError);
      expect(() => readDocContent(document)).toThrow(/loops back/);
    });
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

describe("RC4-encrypted documents", () => {
  const PASSWORD = "correct horse";
  const SALT = new Uint8Array(16).map((_, index) => index * 7 + 1);
  const WORD_DOCUMENT_PREFIX_LENGTH = 68;

  /**
   * Takes a plain (unencrypted) .doc's compound-file bytes and turns them into a genuinely RC4-encrypted one: sets FibBase.fEncrypted and lKey, writes a real EncryptionHeader at the start of the Table stream, and encrypts WordDocument from byte 68 and Table from lKey on -- each independently, its own block-number counter starting fresh at that stream's own byte 0, exactly as [MS-DOC] 2.2.6.2 requires and encryption.ts's own top comment documents.
   *
   * RC4's XOR symmetry makes "encrypt" and "decrypt" the identical operation, so this reuses decryptOfficeRc4 -- the same primitive readDocContent decrypts with -- rather than a separate encryption routine; the two directions cancelling out is exactly what makes RC4 what it is, not a shortcut that only looks like a round trip. What this test actually proves is read.ts's own orchestration: locating the right Table stream before a full Fib exists, decrypting at the right offsets, and handing the result to parseFib correctly -- the crypto itself is already independently verified (archive-codec's own office-rc4.test.ts, this package's own encryption.test.ts).
   */
  function encryptDoc(
    plainDoc: Uint8Array<ArrayBuffer>,
    password: string,
    salt: Uint8Array<ArrayBuffer>,
  ): Uint8Array<ArrayBuffer> {
    const streams = readCompoundFile(plainDoc);
    const wordDocumentStream = streams.find(
      (stream) => stream.path === "WordDocument",
    );
    const tableStream = streams.find((stream) => stream.path === "1Table");
    if (wordDocumentStream === undefined || tableStream === undefined) {
      throw new Error("buildDoc always writes WordDocument and 1Table");
    }

    const baseHash = deriveOfficeRc4BaseHash(password, salt);
    const verifier = new Uint8Array(16).map((_, index) => index * 3 + 11);
    const verifierHash = md5(verifier);
    const encryptedVerifier = decryptOfficeRc4(
      baseHash,
      0,
      verifier,
      OFFICE_RC4_DOC_BLOCK_SIZE,
    );
    const encryptedVerifierHash = decryptOfficeRc4(
      baseHash,
      OFFICE_RC4_VERIFIER_LENGTH,
      verifierHash,
      OFFICE_RC4_DOC_BLOCK_SIZE,
    );
    const headerSize = 4 + OFFICE_RC4_VERIFIER_LENGTH * 3;
    const header = new Uint8Array(headerSize);
    const headerView = new DataView(header.buffer);
    headerView.setUint16(0, 1, true); // vMajor
    headerView.setUint16(2, 1, true); // vMinor
    header.set(salt, 4);
    header.set(encryptedVerifier, 20);
    header.set(encryptedVerifierHash, 36);

    // A plaintext copy of WordDocument, patched before any encryption happens: fEncrypted/lKey (both in the always-unencrypted 68-byte prefix, so either order would do), and every fc offset FibRgFcLcb97 states relative to the Table stream's own byte 0 -- which, in a real encrypted file, the producer writes already accounting for the EncryptionHeader occupying the first lKey bytes there, exactly as it would for any other structure sharing the stream. buildDoc computed these assuming no header at all, so inserting one here means shifting every fc value (never the matching lcb, a length rather than a position) by the same headerSize this fixture is about to prepend -- the one piece of this fixture that is not simply "encrypt bytes 68 onward", and the reason this helper reads real field offsets from fib/offsets.ts rather than reimplementing them. This has to happen on the plaintext, not the ciphertext: the FibRgFcLcb97 blob itself sits well past byte 68 (FIB_FC_LCB_BLOB_OFFSET is 154), so it is encrypted content like any other -- patching it after encryption would be overwriting ciphertext bytes with a plaintext-shaped value instead of shifting the value the encryption itself protects.
    const shiftedWordDocument = new Uint8Array(wordDocumentStream.bytes);
    const shiftedView = new DataView(shiftedWordDocument.buffer);
    const existingFlags = shiftedView.getUint16(10, true);
    shiftedView.setUint16(10, existingFlags | 0x0100, true); // fEncrypted
    shiftedView.setUint32(FIB_LKEY_OFFSET, headerSize, true); // lKey
    // Shifted unconditionally, even where the existing value happens to be 0: 0 is a genuinely valid Table-stream offset (a real producer often places the Clx at the very start), not a sentinel for "field unused" -- every real reader (read.ts's own `fib.lcbStshf > 0 ? ... : undefined`, and the same pattern for every other fc/lcb pair) gates on the matching *lcb* being positive, never on the fc value itself, so shifting an unused field's fc (whose lcb is 0 regardless) changes nothing anything actually reads.
    for (const [name, valueIndex] of Object.entries(FC_LCB_VALUE_INDEX)) {
      if (!name.startsWith("fc")) continue;
      const offset = FIB_FC_LCB_BLOB_OFFSET + valueIndex * 4;
      const existing = shiftedView.getUint32(offset, true);
      shiftedView.setUint32(offset, existing + headerSize, true);
    }

    const wordDocument = new Uint8Array(shiftedWordDocument.length);
    wordDocument.set(
      shiftedWordDocument.subarray(0, WORD_DOCUMENT_PREFIX_LENGTH),
      0,
    );
    wordDocument.set(
      decryptOfficeRc4(
        baseHash,
        WORD_DOCUMENT_PREFIX_LENGTH,
        shiftedWordDocument.subarray(WORD_DOCUMENT_PREFIX_LENGTH),
        OFFICE_RC4_DOC_BLOCK_SIZE,
      ),
      WORD_DOCUMENT_PREFIX_LENGTH,
    );

    const table = new Uint8Array(headerSize + tableStream.bytes.length);
    table.set(header, 0);
    table.set(
      decryptOfficeRc4(
        baseHash,
        headerSize,
        tableStream.bytes,
        OFFICE_RC4_DOC_BLOCK_SIZE,
      ),
      headerSize,
    );

    return writeCompoundFile(
      streams.map((stream) => {
        if (stream.path === "WordDocument")
          return { ...stream, bytes: wordDocument };
        if (stream.path === "1Table") return { ...stream, bytes: table };
        return stream;
      }),
    );
  }

  it("refuses an encrypted document when no password is given", () => {
    const doc = encryptDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
      SALT,
    );
    expect(() => readDocContent(doc)).toThrow(DocUnsupportedError);
  });

  it("refuses an encrypted document given the wrong password", () => {
    const doc = encryptDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
      SALT,
    );
    expect(() => readDocContent(doc, "the wrong password")).toThrow(
      DocUnsupportedError,
    );
  });

  it("decrypts an encrypted document given the correct password", () => {
    const plainDoc = buildDoc({
      paragraphs: [{ runs: [{ text: "Secret meeting notes." }] }],
    });
    const encrypted = encryptDoc(plainDoc, PASSWORD, SALT);

    const plainResult = readDocContent(plainDoc);
    const decryptedResult = readDocContent(encrypted, PASSWORD);

    expect(decryptedResult).toEqual(plainResult);
  });
});

describe("XOR-obfuscated documents", () => {
  const PASSWORD = "correct horse";
  const WORD_DOCUMENT_PREFIX_LENGTH = 68;

  /**
   * Takes a plain (unencrypted) .doc's compound-file bytes and turns them into a genuinely XOR-obfuscated one: sets FibBase.fEncrypted/fObfuscated and lKey (the 32-bit password verifier itself here, not a header byte length -- see encryption.ts's own top comment), and obfuscates WordDocument from byte 68 and Table from byte 0 -- each independently, exactly as [MS-DOC]'s own XOR Obfuscation section requires.
   *
   * Unlike RC4, XOR obfuscation needs no EncryptionHeader occupying space at the start of the Table stream, so FibRgFcLcb97's own fc offsets (computed by buildDoc assuming no header) need no shifting here -- the one genuine simplification over the sibling RC4 fixture above. Method 2's data transform (plain XOR with a zero-byte exception) is its own inverse, so this reuses decryptXorObfuscationMethod2 -- the same primitive readDocContent decrypts with -- rather than a separate encryption routine, mirroring RC4's own XOR-symmetry reuse above.
   */
  function obfuscateDoc(
    plainDoc: Uint8Array<ArrayBuffer>,
    password: string,
  ): Uint8Array<ArrayBuffer> {
    const streams = readCompoundFile(plainDoc);
    const wordDocumentStream = streams.find(
      (stream) => stream.path === "WordDocument",
    );
    const tableStream = streams.find((stream) => stream.path === "1Table");
    if (wordDocumentStream === undefined || tableStream === undefined) {
      throw new Error("buildDoc always writes WordDocument and 1Table");
    }

    const array = createXorObfuscationArray(
      password,
      XOR_OBFUSCATION_ROTATE_DISTANCE_METHOD2,
    );
    const lKey =
      (createXorObfuscationKey(password) << 16) |
      createXorObfuscationPasswordVerifier(password);

    const shiftedWordDocument = new Uint8Array(wordDocumentStream.bytes);
    const shiftedView = new DataView(shiftedWordDocument.buffer);
    const existingFlags = shiftedView.getUint16(10, true);
    shiftedView.setUint16(10, existingFlags | 0x8100, true); // fEncrypted (0x0100) | fObfuscated (0x8000)
    shiftedView.setUint32(FIB_LKEY_OFFSET, lKey, true);

    const wordDocument = new Uint8Array(shiftedWordDocument.length);
    wordDocument.set(
      shiftedWordDocument.subarray(0, WORD_DOCUMENT_PREFIX_LENGTH),
      0,
    );
    wordDocument.set(
      decryptXorObfuscationMethod2(
        array,
        shiftedWordDocument.subarray(WORD_DOCUMENT_PREFIX_LENGTH),
        WORD_DOCUMENT_PREFIX_LENGTH % 16,
      ),
      WORD_DOCUMENT_PREFIX_LENGTH,
    );

    const table = decryptXorObfuscationMethod2(array, tableStream.bytes, 0);

    return writeCompoundFile(
      streams.map((stream) => {
        if (stream.path === "WordDocument")
          return { ...stream, bytes: wordDocument };
        if (stream.path === "1Table") return { ...stream, bytes: table };
        return stream;
      }),
    );
  }

  it("refuses an obfuscated document when no password is given", () => {
    const doc = obfuscateDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
    );
    expect(() => readDocContent(doc)).toThrow(DocUnsupportedError);
  });

  it("refuses an obfuscated document given the wrong password", () => {
    const doc = obfuscateDoc(
      buildDoc({ paragraphs: [{ runs: [{ text: "Secret." }] }] }),
      PASSWORD,
    );
    expect(() => readDocContent(doc, "the wrong password")).toThrow(
      DocUnsupportedError,
    );
  });

  it("decrypts an obfuscated document given the correct password", () => {
    const plainDoc = buildDoc({
      paragraphs: [{ runs: [{ text: "Secret meeting notes." }] }],
    });
    const obfuscated = obfuscateDoc(plainDoc, PASSWORD);

    const plainResult = readDocContent(plainDoc);
    const decryptedResult = readDocContent(obfuscated, PASSWORD);

    expect(decryptedResult).toEqual(plainResult);
  });
});
