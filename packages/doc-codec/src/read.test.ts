import { ContentDocumentSchema } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readUint32LE } from "./bytes";
import { FC_LCB_VALUE_INDEX, FIB_FC_LCB_BLOB_OFFSET } from "./fib/offsets";
import { readDocContent, readDocStreams } from "./read";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";
import { SECTION_MARK } from "./text/special";
import {
  BOLD_ON,
  CENTRED,
  ITALIC_ON,
  PAGE_BREAK_BEFORE,
  RED_TEXT,
  SECTION_GEOMETRY,
  SIZE_24PT,
  SPACE_BEFORE_12PT,
  paragraphAt,
  paragraphs,
  textOf,
} from "./test-support/read";

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

  it("reads a manual page break — a 0x000C where no section ends — as a pageBreak block after the paragraph it terminates", () => {
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

  it("never treats the first section's own startCp as a manual-page-break boundary, even if PlcfSed's own aCp[0] were corrupted off its structural 0", () => {
    // The first section's startCp is always 0 in any real file (nothing precedes the document's own first character), so no ordinary construction can ever place a real paragraph's endCp on it — corrupting PlcfSed's own aCp[0] directly is the only way to prove markManualPageBreaks genuinely excludes the first section rather than happening to never collide with it.
    const SECOND_GEOMETRY = [0x1f, 0xb0, 0x40, 0x1f, 0x20, 0xb0, 0xa0, 0x27];
    const bytes = buildDoc({
      paragraphs: [
        { runs: [{ text: "one" }], mark: SECTION_MARK, pageBreak: true },
        { runs: [{ text: "two" }], mark: SECTION_MARK },
        { runs: [{ text: "three" }] },
      ],
      sections: [SECTION_GEOMETRY, SECOND_GEOMETRY],
    });
    const { wordDocument, table } = readDocStreams(bytes);
    const fcPlcfSed = readUint32LE(
      wordDocument,
      FIB_FC_LCB_BLOB_OFFSET + FC_LCB_VALUE_INDEX.fcPlcfSed * 4,
    );
    const patchedTable = new Uint8Array(table);
    // PlcfSed's own aCp[0] sits at its first 4 bytes — corrupted here from the real 0 to 4, "one"'s own endCp (3 characters plus its own terminator).
    new DataView(patchedTable.buffer).setUint32(fcPlcfSed, 4, true);
    const document = readDocContent(
      compoundFile([
        { path: "WordDocument", bytes: new Uint8Array(wordDocument) },
        { path: "1Table", bytes: patchedTable },
      ]),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads back as a wordprocessing document");
    }
    expect(document.sections[0]?.blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "two" }] },
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

  // The spelling a real producer writes for note stories: no separate guard paragraph, the story ending at its own final content mark (confirmed against a LibreOffice-authored .doc — without this fix, that producer's single-paragraph footnotes read as "" and its multi-paragraph ones lost their last paragraph). The guard spelling every test above uses is the other legal shape and must keep reading identically.
  it("reads a note story with no separate guard paragraph — the real-producer spelling — without dropping its last paragraph", () => {
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
    // Plcfhdd's own fixed layout: six separator stories (all empty here, since nothing under test needs them), then one section's own six — evenHeader, oddHeader, evenFooter, oddFooter, firstHeader, firstFooter — only the odd header and odd footer given real content, the rest left empty.
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
});
