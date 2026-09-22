import { describe, expect, it } from "vitest";
import { readDocContent, readDocStreams, type DocContent } from "../read";
import { parseClx } from "../text/piece-table";
import { CELL_MARK, PARAGRAPH_MARK, SECTION_MARK } from "../text/special";
import {
  appendParagraphs,
  appendSubdocument,
  buildDoc,
  buildInlinePictureBytes,
  buildPlcfSedBytes,
  buildStsh,
  dataStreamParts,
  mainDocumentPageBreakCps,
  mergeChpxRuns,
  PIECE_BOUNDARY_MISSING_MESSAGE,
  pieceBoundaries,
  recordHeaderBytes,
  requireArrayEntry,
  requireMapEntry,
  sameGrpprl,
  SEPX_OFFSET_MISSING_MESSAGE,
  tablePartOffsetMissingMessage,
  TEXT_FC,
  type DocSpec,
  type ParagraphAccumulator,
} from "./doc";

const BOLD_ON = [0x35, 0x08, 0x01];
const ITALIC_ON = [0x36, 0x08, 0x01];

// Every fixture here is a genuine wordprocessing document (buildDoc never produces anything else), so this narrows once rather than repeating a kind check in every test.
function build(spec: DocSpec): DocContent & { kind: "wordprocessing" } {
  const doc = readDocContent(buildDoc(spec));
  if (doc.kind !== "wordprocessing") {
    throw new Error("buildDoc always produces a wordprocessing document");
  }
  return doc;
}

describe("buildDoc", () => {
  it("round-trips compressed (8-bit) text", () => {
    const doc = build({
      compressed: true,
      paragraphs: [{ runs: [{ text: "Plain ASCII text" }] }],
    });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      "Plain ASCII text",
    );
  });

  it("round-trips text split across several pieces", () => {
    const text = "One two three four five six seven eight";
    const doc = build({ pieces: 4, paragraphs: [{ runs: [{ text }] }] });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      text,
    );
  });

  it("round-trips compressed text split across several pieces together", () => {
    const text = "compressed and split";
    const doc = build({
      compressed: true,
      pieces: 3,
      paragraphs: [{ runs: [{ text }] }],
    });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      text,
    );
  });

  it("distinguishes two adjacent runs with different, same-length grpprl instead of merging them", () => {
    const doc = build({
      paragraphs: [
        {
          runs: [
            { text: "Bold", grpprl: BOLD_ON },
            { text: "Italic", grpprl: ITALIC_ON },
          ],
        },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    const runs = block?.kind === "paragraph" ? block.runs : [];
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ text: "Bold", bold: true });
    expect(runs[0]).not.toMatchObject({ italic: true });
    expect(runs[1]).toMatchObject({ text: "Italic", italic: true });
    expect(runs[1]).not.toMatchObject({ bold: true });
  });

  it("merges two adjacent runs that share byte-identical grpprl into one exception", () => {
    const doc = build({
      paragraphs: [
        {
          runs: [
            { text: "Bold ", grpprl: BOLD_ON },
            { text: "still bold", grpprl: BOLD_ON },
          ],
        },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    const runs = block?.kind === "paragraph" ? block.runs : [];
    // Merged into one Chpx exception — and since both source runs carried the identical formatting, they still read back as one run of the concatenated text.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: "Bold still bold", bold: true });
  });

  it("does not merge a formatted run with an adjacent unformatted one", () => {
    const doc = build({
      paragraphs: [
        { runs: [{ text: "Bold", grpprl: BOLD_ON }, { text: "Plain" }] },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    const runs = block?.kind === "paragraph" ? block.runs : [];
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ bold: true });
    expect(runs[1]?.bold).toBeUndefined();
  });

  it("does not merge an unformatted run followed by a formatted one", () => {
    const doc = build({
      paragraphs: [
        { runs: [{ text: "Plain" }, { text: "Bold", grpprl: BOLD_ON }] },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    const runs = block?.kind === "paragraph" ? block.runs : [];
    expect(runs).toHaveLength(2);
    expect(runs[0]?.bold).toBeUndefined();
    expect(runs[1]).toMatchObject({ bold: true });
  });

  it("skips an empty-text run entirely rather than emitting a zero-length formatting exception", () => {
    const doc = build({
      paragraphs: [
        {
          runs: [
            { text: "Before", grpprl: BOLD_ON },
            { text: "" },
            { text: "After", grpprl: BOLD_ON },
          ],
        },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    const runs = block?.kind === "paragraph" ? block.runs : [];
    // The empty run contributes nothing, and the two real runs share the identical grpprl either side of it, so they still merge into one.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: "BeforeAfter", bold: true });
  });

  it("round-trips multiple sections, each with their own page size", () => {
    const doc = build({
      paragraphs: [
        { runs: [{ text: "Section one" }], mark: SECTION_MARK },
        { runs: [{ text: "Section two" }] },
      ],
      sections: [
        [0x1f, 0xb0, 0x40, 0x1f], // sprmSXaPage, twips 8000 (0x1f40).
        [0x1f, 0xb0, 0x80, 0x1f], // sprmSXaPage, twips 8064 (0x1f80).
      ],
    });
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]?.pageSize.widthPt).toBeCloseTo(400, 1);
    expect(doc.sections[1]?.pageSize.widthPt).toBeCloseTo(403.2, 1);
  });

  it("round-trips a manual page break as distinct from a real section boundary", () => {
    const doc = build({
      paragraphs: [
        {
          runs: [{ text: "Before break" }],
          mark: SECTION_MARK,
          pageBreak: true,
        },
        { runs: [{ text: "After break" }] },
      ],
    });
    // A page break inside one section, not two sections.
    expect(doc.sections).toHaveLength(1);
    const blocks = doc.sections[0]?.blocks ?? [];
    const kinds = blocks.map((block) => block.kind);
    expect(kinds).toContain("pageBreak");
    expect(kinds).toContain("paragraph");
  });

  it("round-trips footnotes with a mix of an empty and a non-empty story", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Main text" }] }],
      footnotes: [[{ runs: [{ text: "First footnote" }] }], []],
    });
    expect(doc.footnotes).toHaveLength(2);
    expect(doc.footnotes[0]?.text).toBe("First footnote");
    expect(doc.footnotes[1]?.text).toBe("");
  });

  it("round-trips a bare (guard-less) note story identically to a guarded one", () => {
    const guarded = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      footnotes: [[{ runs: [{ text: "Note text" }] }]],
      bareNoteStories: false,
    });
    const bare = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      footnotes: [[{ runs: [{ text: "Note text" }] }]],
      bareNoteStories: true,
    });
    expect(guarded.footnotes[0]?.text).toBe("Note text");
    expect(bare.footnotes[0]?.text).toBe("Note text");
  });

  it("keeps a header/footer story that is itself a single blank paragraph, distinct from an absent one", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      sectionGrpprl: [],
      headerFooterStories: [
        [],
        [],
        [],
        [],
        [],
        [], // the six fixed separator stories.
        [{ runs: [] }], // evenHeader: a single blank paragraph, not an empty story.
        [], // oddHeader: genuinely empty/absent.
        [], // evenFooter.
        [], // oddFooter.
        [], // firstHeader.
        [], // firstFooter.
      ],
    });
    const evenHeader = doc.headerFooterStories.find(
      (story) => story.slot === "evenHeader",
    );
    expect(evenHeader).toBeDefined();
    expect(evenHeader?.blocks).toHaveLength(1);
    const oddHeader = doc.headerFooterStories.find(
      (story) => story.slot === "oddHeader",
    );
    expect(oddHeader).toBeUndefined();
  });

  it("produces no header/footer document at all when headerFooterStories is omitted", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
    });
    expect(doc.headerFooterStories).toHaveLength(0);
  });

  it("produces no comment document at all when comments is omitted", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
    });
    expect(doc.comments).toHaveLength(0);
  });

  it("produces no endnote document at all when endnotes is omitted", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
    });
    expect(doc.endnotes).toHaveLength(0);
  });

  it("round-trips a bare (guard-less) comment story identically to a guarded one", () => {
    const guarded = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      comments: [[{ runs: [{ text: "Comment text" }] }]],
      bareNoteStories: false,
    });
    const bare = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      comments: [[{ runs: [{ text: "Comment text" }] }]],
      bareNoteStories: true,
    });
    expect(guarded.comments[0]?.text).toBe("Comment text");
    expect(bare.comments[0]?.text).toBe("Comment text");
  });

  it("round-trips a bare (guard-less) endnote story identically to a guarded one", () => {
    const guarded = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      endnotes: [[{ runs: [{ text: "Endnote text" }] }]],
      bareNoteStories: false,
    });
    const bare = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      endnotes: [[{ runs: [{ text: "Endnote text" }] }]],
      bareNoteStories: true,
    });
    expect(guarded.endnotes[0]?.text).toBe("Endnote text");
    expect(bare.endnotes[0]?.text).toBe("Endnote text");
  });

  it("round-trips footnotes, comments, and endnotes together with a preceding header/footer document, exercising every subdocument's own ccp arithmetic", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Main" }] }],
      sectionGrpprl: [],
      footnotes: [[{ runs: [{ text: "Footnote one" }] }]],
      headerFooterStories: [
        [],
        [],
        [],
        [],
        [],
        [],
        [{ runs: [{ text: "Header" }] }],
        [],
        [],
        [],
        [],
        [],
      ],
      comments: [[{ runs: [{ text: "Comment one" }] }]],
      endnotes: [[{ runs: [{ text: "Endnote one" }] }]],
    });
    expect(doc.footnotes[0]?.text).toBe("Footnote one");
    expect(doc.comments[0]?.text).toBe("Comment one");
    expect(doc.endnotes[0]?.text).toBe("Endnote one");
    const header = doc.headerFooterStories.find(
      (story) => story.slot === "evenHeader",
    );
    expect(header).toBeDefined();
  });

  it("round-trips a paragraph style (stk 1) carrying odd-length direct-formatting grpprls", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Styled" }], istd: 1 }],
      styles: [
        { name: "Normal", stk: 1 },
        {
          name: "MyStyle",
          stk: 1,
          // sprmCFBold's ToggleOperand is one byte after the two-byte opcode — three bytes, odd.
          papxGrpprl: [0x2a, 0x24, 0x01],
          chpxGrpprl: BOLD_ON,
        },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.styleId : undefined).toBe(
      "MyStyle",
    );
  });

  it("round-trips a character style (stk 2) with its own chpxGrpprl", () => {
    const doc = build({
      paragraphs: [
        {
          runs: [
            {
              text: "Run",
              grpprl: [0x30, 0x4a, 1, 0], // sprmCIstd -> istd 1 (the character style below).
            },
          ],
        },
      ],
      styles: [
        { name: "Normal", stk: 1 },
        { name: "CharStyle", stk: 2, chpxGrpprl: BOLD_ON },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    const run = block?.kind === "paragraph" ? block.runs[0] : undefined;
    expect(run?.bold).toBe(true);
  });

  it("round-trips more than one style, exercising the STSHI's own latent-style array", () => {
    const doc = build({
      paragraphs: [
        { runs: [{ text: "A" }], istd: 1 },
        { runs: [{ text: "B" }], istd: 2 },
      ],
      styles: [
        { name: "Normal", stk: 1 },
        { name: "First", stk: 1 },
        { name: "Second", stk: 1 },
      ],
    });
    const styleIds = doc.sections[0]?.blocks.map((block) =>
      block.kind === "paragraph" ? block.styleId : undefined,
    );
    expect(styleIds).toEqual(["First", "Second"]);
  });

  it("round-trips a container carrying a Data stream", () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    // A doc with no picture anchor still parses fine with a Data stream present; this exercises buildDoc's own conditional inclusion of the "Data" part.
    const doc = build({
      paragraphs: [{ runs: [{ text: "Has data stream" }] }],
      data,
    });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      "Has data stream",
    );
  });

  it("degrades a lone CELL_MARK-terminated paragraph with no row-ending mark to a real read error, distinguishing it from an ordinary PARAGRAPH_MARK", () => {
    // [MS-DOC] 2.4.3's own table ABNF requires a TTP row mark to close a row; a cell mark with nothing following it is genuinely malformed rather than a plain paragraph, and this is what confirms buildDoc's own CELL_MARK constant writes the real 0x07 terminator rather than silently falling back to PARAGRAPH_MARK (0x0D, which would read back as an ordinary paragraph with no error at all).
    expect(() =>
      readDocContent(
        buildDoc({
          paragraphs: [
            {
              runs: [{ text: "Cell" }],
              mark: CELL_MARK,
              grpprl: [0x16, 0x24, 0x01], // sprmPFInTable.
            },
          ],
        }),
      ),
    ).toThrow(/row-ending mark/);
  });

  it("round-trips a character style (stk 2) whose own sti differs from its istd", () => {
    // style.sti defaults to istd when absent; giving it an explicit, different value exercises the STSHI word0 (style.sti ?? istd) branch genuinely, rather than the two always coinciding.
    const doc = build({
      paragraphs: [
        { runs: [{ text: "Run", grpprl: [0x30, 0x4a, 1, 0] }] }, // sprmCIstd -> istd 1.
      ],
      styles: [
        { name: "Normal", stk: 1 },
        { name: "CharStyle", stk: 2, sti: 200, chpxGrpprl: BOLD_ON },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    const run = block?.kind === "paragraph" ? block.runs[0] : undefined;
    expect(run?.bold).toBe(true);
  });

  it("round-trips a style that inherits from another by istdBase", () => {
    const doc = build({
      paragraphs: [{ runs: [{ text: "Styled" }], istd: 2 }],
      styles: [
        { name: "Normal", stk: 1 },
        { name: "Base", stk: 1, chpxGrpprl: BOLD_ON },
        { name: "Derived", stk: 1, istdBase: 1 },
      ],
    });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.styleId : undefined).toBe(
      "Derived",
    );
  });

  it("splits text into an odd number of pieces that does not divide the character count evenly", () => {
    const text = "an odd length piece split across five pieces exactly";
    const doc = build({ pieces: 5, paragraphs: [{ runs: [{ text }] }] });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      text,
    );
  });

  it("round-trips a paragraph whose own mark defaults to PARAGRAPH_MARK when unstated", () => {
    const doc = build({ paragraphs: [{ runs: [{ text: "Default mark" }] }] });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      "Default mark",
    );
    expect(PARAGRAPH_MARK).toBe(0x0d);
  });

  it("writes measurably fewer text bytes when compressed is true than when it is false, for identical text", () => {
    // Both builds' own "compressed" flag drives every place that needs it (the byte-writing loop, and the piece table's own FcCompressed bit) self-consistently, so a wrong flag still round-trips its OWN text correctly regardless of what the spec actually asked for — only the raw stream size (or, for the opposite direction, truncation of a character wider than one byte, exercised separately below) can tell the two apart.
    const text = "x".repeat(600);
    const compressedLength = readDocStreams(
      buildDoc({ compressed: true, paragraphs: [{ runs: [{ text }] }] }),
    ).wordDocument.length;
    const uncompressedLength = readDocStreams(
      buildDoc({ compressed: false, paragraphs: [{ runs: [{ text }] }] }),
    ).wordDocument.length;
    expect(compressedLength).toBeLessThan(uncompressedLength);
  });

  it("preserves a character too wide for one byte when compressed is false, rather than silently truncating it", () => {
    const text = `A${String.fromCharCode(0x4e2d)}B`; // U+4E2D ("中"), well past the 0xff a compressed byte could hold.
    const doc = build({
      compressed: false,
      paragraphs: [{ runs: [{ text }] }],
    });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      text,
    );
  });

  it("writes exactly one byte per character when compressed, never spilling a second byte past the last one", () => {
    // Every position within the compressed text is self-healing regardless of which branch runs: the position for character k receives a stray high byte from character k-1's own write (if the wrong, two-byte branch were taken) before character k's own correct low-byte write lands on top of it last, since the loop always runs in increasing index order. Only the byte one past the very last character has nothing after it to self-heal that way — so the paragraph's own trailing mark (always the actual last character buildDoc writes here, with no footnotes/headers/etc appended after it) is given an arbitrary code whose high byte (0x12) is non-zero, purely to make that one spillover byte observable; readDocStreams reads the raw stream directly; no downstream parse of this arbitrary mark value is needed.
    const streams = readDocStreams(
      buildDoc({
        compressed: true,
        paragraphs: [{ runs: [{ text: "a" }], mark: 0x1234 }],
      }),
    );
    const ccpText = 2; // "a" (1 character) plus its own trailing mark (1).
    expect(streams.wordDocument[TEXT_FC + ccpText]).toBe(0);
  });

  it("round-trips a long paragraph whose own byte length crosses more FKP page boundaries than a short one would", () => {
    // textByteLength (text.length * bytesPerCharacter) decides where the FKP pages land; a short text's own page placement doesn't shift even if this were computed wrongly (both round down to the same page), so this needs enough characters to actually cross an extra 512-byte FKP_PAGE_SIZE boundary.
    const text = "y".repeat(600);
    const doc = build({ paragraphs: [{ runs: [{ text }] }] });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      text,
    );
  });

  it("never treats a subdocument's own text as containing a section boundary, even when it happens to carry the identical SECTION_MARK byte", () => {
    // The main document's own section-boundary scan is bounded to [0, ccpText) precisely so a footnote/header/comment/endnote paragraph's own text — appended right after, in the same shared logical stream — can never be mistaken for one. An off-by-one bound here would read this footnote's own leading SECTION_MARK as a real boundary, and buildPlcfSedBytes would then throw on the resulting section-start-CP/Sepx-offset count mismatch (this test's own sectionGrpprl states exactly one section).
    expect(() =>
      buildDoc({
        paragraphs: [{ runs: [{ text: "Main" }] }],
        sectionGrpprl: [],
        footnotes: [[{ runs: [{ text: String.fromCharCode(SECTION_MARK) }] }]],
      }),
    ).not.toThrow();
  });

  it("actually splits the piece table into the requested number of pieces, not silently collapsing to one", () => {
    // parseClx's own reassembled text reads back identically regardless of piece count (readDocContent's own "round-trips text split across several pieces" tests already cover that), so the piece count itself has to be checked directly.
    const text = "twenty-four characters!!";
    const streams = readDocStreams(
      buildDoc({ pieces: 4, paragraphs: [{ runs: [{ text }] }] }),
    );
    const clx = streams.table.slice(
      streams.fib.fcClx,
      streams.fib.fcClx + streams.fib.lcbClx,
    );
    expect(parseClx(clx).pieces).toHaveLength(4);
  });

  it("produces no Data stream at all when spec.data is omitted", () => {
    const streams = readDocStreams(
      buildDoc({ paragraphs: [{ runs: [{ text: "No data" }] }] }),
    );
    expect(streams.data).toBeUndefined();
  });

  it("gives the footnote document one more character when guarded than when bare, for the identical story", () => {
    const story = {
      paragraphs: [{ runs: [{ text: "Main" }] }],
      footnotes: [[{ runs: [{ text: "Note" }] }]],
    };
    const guarded = readDocStreams(
      buildDoc({ ...story, bareNoteStories: false }),
    ).fib.ccpFtn;
    const bare = readDocStreams(buildDoc({ ...story, bareNoteStories: true }))
      .fib.ccpFtn;
    expect(guarded).toBe(bare + 1);
  });

  it("gives the comment document one more character when guarded than when bare, for the identical story", () => {
    const story = {
      paragraphs: [{ runs: [{ text: "Main" }] }],
      comments: [[{ runs: [{ text: "Note" }] }]],
    };
    const guarded = readDocStreams(
      buildDoc({ ...story, bareNoteStories: false }),
    ).fib.ccpAtn;
    const bare = readDocStreams(buildDoc({ ...story, bareNoteStories: true }))
      .fib.ccpAtn;
    expect(guarded).toBe(bare + 1);
  });

  it("gives the endnote document one more character when guarded than when bare, for the identical story", () => {
    const story = {
      paragraphs: [{ runs: [{ text: "Main" }] }],
      endnotes: [[{ runs: [{ text: "Note" }] }]],
    };
    const guarded = readDocStreams(
      buildDoc({ ...story, bareNoteStories: false }),
    ).fib.ccpEdn;
    const bare = readDocStreams(buildDoc({ ...story, bareNoteStories: true }))
      .fib.ccpEdn;
    expect(guarded).toBe(bare + 1);
  });
});

describe("sameGrpprl", () => {
  it("treats two absent grpprls as the same exception", () => {
    expect(sameGrpprl(undefined, undefined)).toBe(true);
  });

  it("treats byte-identical arrays as the same exception, even as two distinct array objects", () => {
    expect(sameGrpprl([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("treats a shorter array as different from a longer one it happens to prefix", () => {
    expect(sameGrpprl([1, 2], [1, 2, 3])).toBe(false);
  });

  it("treats one absent and one present grpprl as different", () => {
    expect(sameGrpprl([1], undefined)).toBe(false);
    expect(sameGrpprl(undefined, [1])).toBe(false);
  });
});

describe("appendParagraphs", () => {
  function accumulator(): ParagraphAccumulator {
    return { text: "", paragraphs: [], runRanges: [] };
  }

  it("merges a single run's own trailing mark into one run range covering both", () => {
    const acc = accumulator();
    appendParagraphs(acc, [{ runs: [{ text: "a" }] }]);
    expect(acc.runRanges).toEqual([{ start: 0, end: 2, grpprl: undefined }]);
  });

  it("pushes a run range for the mark alone when the paragraph has no runs at all", () => {
    const acc = accumulator();
    appendParagraphs(acc, [{ runs: [] }]);
    expect(acc.runRanges).toEqual([{ start: 0, end: 1, grpprl: undefined }]);
  });
});

describe("appendSubdocument", () => {
  it("adds no guard paragraph and no text at all for a genuinely empty story", () => {
    const acc: ParagraphAccumulator = {
      text: "",
      paragraphs: [],
      runRanges: [],
    };
    const keys = appendSubdocument(acc, [[]], false);
    expect(acc.text.length).toBe(0);
    expect(keys).toEqual([0, 0, 0]);
  });

  it("computes each key relative to the subdocument's own start, not the whole accumulator, and adds a guard paragraph when bareStories is false", () => {
    const acc: ParagraphAccumulator = {
      text: "existing",
      paragraphs: [],
      runRanges: [],
    };
    const keys = appendSubdocument(acc, [[{ runs: [{ text: "hi" }] }]], false);
    // "hi" (2 chars) + its own paragraph mark (1) + the guard paragraph's own mark (1) = 4, local to the subdocument's own start (8), not the accumulator's whole length (12).
    expect(keys).toEqual([0, 4, 4]);
  });

  it("appends a story's own content with no guard paragraph when bareStories is true", () => {
    const acc: ParagraphAccumulator = {
      text: "existing",
      paragraphs: [],
      runRanges: [],
    };
    const keys = appendSubdocument(acc, [[{ runs: [{ text: "hi" }] }]], true);
    // "hi" (2 chars) + its own paragraph mark (1) = 3, no guard.
    expect(keys).toEqual([0, 3, 3]);
  });
});

describe("mergeChpxRuns", () => {
  it("starts from nothing, producing exactly the source's own run count when none merge", () => {
    expect(mergeChpxRuns([{ start: 0, end: 1 }])).toEqual([
      { start: 0, end: 1 },
    ]);
  });

  it("merges two adjacent runs sharing byte-identical formatting into one", () => {
    expect(
      mergeChpxRuns([
        { start: 0, end: 1, grpprl: [1] },
        { start: 1, end: 2, grpprl: [1] },
      ]),
    ).toEqual([{ start: 0, end: 2, grpprl: [1] }]);
  });

  it("does not merge two adjacent runs with different formatting", () => {
    expect(
      mergeChpxRuns([
        { start: 0, end: 1, grpprl: [1] },
        { start: 1, end: 2, grpprl: [2] },
      ]),
    ).toHaveLength(2);
  });

  it("does not merge two non-adjacent runs, even with identical formatting", () => {
    expect(
      mergeChpxRuns([
        { start: 0, end: 1, grpprl: [1] },
        { start: 2, end: 3, grpprl: [1] },
      ]),
    ).toHaveLength(2);
  });
});

describe("mainDocumentPageBreakCps", () => {
  it("registers a main-document paragraph's own pageBreak end CP", () => {
    const cps = mainDocumentPageBreakCps(
      [{ spec: { runs: [], pageBreak: true }, end: 5 }],
      10,
    );
    expect(cps.has(5)).toBe(true);
  });

  it("ignores a pageBreak paragraph whose end lies past ccpText, a subdocument paragraph sharing the same accumulator", () => {
    const cps = mainDocumentPageBreakCps(
      [{ spec: { runs: [], pageBreak: true }, end: 15 }],
      10,
    );
    expect(cps.size).toBe(0);
  });

  it("ignores an ordinary paragraph with no pageBreak of its own", () => {
    const cps = mainDocumentPageBreakCps([{ spec: { runs: [] }, end: 5 }], 10);
    expect(cps.size).toBe(0);
  });

  it("registers a paragraph ending exactly at ccpText, the main document's own last paragraph", () => {
    const cps = mainDocumentPageBreakCps(
      [{ spec: { runs: [], pageBreak: true }, end: 10 }],
      10,
    );
    expect(cps.has(10)).toBe(true);
  });
});

describe("requireArrayEntry", () => {
  it("returns the value at index, even when it is 0", () => {
    expect(requireArrayEntry([0, 5], 0, "should not throw")).toBe(0);
  });

  it("throws the given message when the index holds no value", () => {
    expect(() => requireArrayEntry([], 0, "custom message")).toThrow(
      "custom message",
    );
  });
});

describe("requireMapEntry", () => {
  it("returns the value for an existing key, even when it is 0", () => {
    expect(requireMapEntry(new Map([["a", 0]]), "a", "should not throw")).toBe(
      0,
    );
  });

  it("throws the given message when the key does not exist", () => {
    expect(() =>
      requireMapEntry(new Map<string, number>(), "missing", "custom message"),
    ).toThrow("custom message");
  });
});

describe("pieceBoundaries", () => {
  it("splits evenly into the requested number of pieces", () => {
    expect(pieceBoundaries(100, 4)).toEqual([0, 25, 50, 75, 100]);
  });

  it("floors an uneven split rather than throwing", () => {
    expect(pieceBoundaries(7, 3)).toEqual([0, 2, 4, 7]);
  });

  it("collapses a boundary that coincides with characterCount itself, rather than duplicating it", () => {
    expect(pieceBoundaries(10, 1)).toEqual([0, 10]);
  });
});

describe("buildPlcfSedBytes", () => {
  it("throws naming the exact mismatched counts when startCps and fcSepxList disagree in length", () => {
    expect(() => buildPlcfSedBytes([0, 10], 20, [100])).toThrow(
      "buildPlcfSedBytes was given 2 section start CPs but 1 Sepx offsets — these must be the same length",
    );
  });

  it("encodes each section's own sed.fcSepx at its own 12-byte Sed, right after the key array, without any field bleeding into an adjacent one", () => {
    const bytes = buildPlcfSedBytes([0x00ff0000], 0x01000000, [0x11223344]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x00ff0000); // the section's own start CP, untouched by anything the Sed record writes.
    expect(view.getUint32(4, true)).toBe(0x01000000); // the trailing ccpText terminator.
    expect(view.getUint16(8, true)).toBe(0); // sed.fn — ignored.
    expect(view.getUint32(10, true)).toBe(0x11223344); // sed.fcSepx.
    expect(view.getUint16(14, true)).toBe(0); // sed.fnMpr — ignored.
    expect(view.getUint32(16, true)).toBe(0xffffffff); // sed.fcMpr — ignored.
  });
});

describe("doc.ts's own internal-defect messages", () => {
  // These name invariants each call site's own comment already explains as unreachable for real input (an array/map lookup that can never actually miss, given how the looked-up key was itself derived) — tested against a hardcoded duplicate of the exact text, the same discipline table/read.ts's own internal-defect messages follow.
  it("carries SEPX_OFFSET_MISSING_MESSAGE's own exact text", () => {
    expect(SEPX_OFFSET_MISSING_MESSAGE).toBe("Sepx offset missing");
  });

  it("carries PIECE_BOUNDARY_MISSING_MESSAGE's own exact text", () => {
    expect(PIECE_BOUNDARY_MISSING_MESSAGE).toBe("piece boundary missing");
  });

  it("carries tablePartOffsetMissingMessage's own exact text", () => {
    expect(tablePartOffsetMissingMessage("clx")).toBe(
      "table part offset missing for clx",
    );
  });
});

describe("dataStreamParts", () => {
  it("is empty when data is absent", () => {
    expect(dataStreamParts(undefined)).toEqual([]);
  });

  it("carries exactly one Data entry when data is present", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(dataStreamParts(data)).toEqual([{ path: "Data", bytes: data }]);
  });
});

describe("buildInlinePictureBytes", () => {
  it("writes PICF's own mfpf.mm as MM_SHAPE (0x0064) little-endian", () => {
    const { dataStreamBytes } = buildInlinePictureBytes(
      0,
      new Uint8Array([1, 2, 3]),
      100,
      100,
    );
    expect(dataStreamBytes[6]).toBe(0x64);
    expect(dataStreamBytes[7]).toBe(0x00);
  });

  it("writes the shape record's own OfficeArtRecordHeader bytes between PICF and the blip", () => {
    const { dataStreamBytes } = buildInlinePictureBytes(
      0,
      new Uint8Array([9]),
      10,
      10,
    );
    // PICF is 68 bytes; the shape header (an 8-byte OfficeArtRecordHeader, recType 0xf004) follows immediately.
    const view = new DataView(
      dataStreamBytes.buffer,
      dataStreamBytes.byteOffset + 68,
      8,
    );
    expect(view.getUint16(2, true)).toBe(0xf004);
  });
});

describe("recordHeaderBytes", () => {
  it("packs recType and recLen little-endian at their own fixed offsets", () => {
    const bytes = recordHeaderBytes(0xf01e, 0x06e0, 0x1234);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(2, true)).toBe(0xf01e);
    expect(view.getUint32(4, true)).toBe(0x1234);
  });
});

describe("buildStsh", () => {
  it("sizes cbStshi to include exactly stiMax latent-style entries, 4 bytes each", () => {
    const stsh = buildStsh([{ name: "A" }, { name: "B" }]);
    const view = new DataView(stsh.buffer, stsh.byteOffset, stsh.byteLength);
    // 11 fixed 2-byte STSHI fields (22 bytes) plus 2 styles * 2 push16 calls (4 bytes each) = 30.
    expect(view.getUint16(0, true)).toBe(30);
  });

  it("writes an identically-sized STD for a table-kind style (stk 3) whether or not chpxGrpprl is given, since neither branch applies to it", () => {
    const withChpx = buildStsh([
      { name: "Normal" },
      { name: "Table Grid", stk: 3, chpxGrpprl: [0x35, 0x08, 0x01] },
    ]);
    const withoutChpx = buildStsh([
      { name: "Normal" },
      { name: "Table Grid", stk: 3 },
    ]);
    expect(withChpx.length).toBe(withoutChpx.length);
  });

  it("writes an empty chpxGrpprl for a character style (stk 2) that specifies none, not a placeholder byte", () => {
    const withDefault = buildStsh([
      { name: "Normal" },
      { name: "Plain", stk: 2 },
    ]);
    const withExplicitEmpty = buildStsh([
      { name: "Normal" },
      { name: "Plain", stk: 2, chpxGrpprl: [] },
    ]);
    expect(withDefault).toEqual(withExplicitEmpty);
  });

  it("packs word0's own sti from style.sti when given, not silently falling back to istd", () => {
    const stsh = buildStsh([{ name: "A", sti: 200 }, { name: "B" }]);
    const view = new DataView(stsh.buffer, stsh.byteOffset, stsh.byteLength);
    const cbStshi = view.getUint16(0, true);
    // Each STD entry is preceded by its own 2-byte length prefix; word0 is the first 2 bytes of the STD payload itself.
    const firstStdWord0Offset = 2 + cbStshi + 2;
    expect(view.getUint16(firstStdWord0Offset, true) & 0x0fff).toBe(200);
  });

  it("packs word0's own sti as istd when style.sti is absent", () => {
    const stsh = buildStsh([{ name: "A" }, { name: "B" }]);
    const view = new DataView(stsh.buffer, stsh.byteOffset, stsh.byteLength);
    const cbStshi = view.getUint16(0, true);
    const firstStdLength = view.getUint16(2 + cbStshi, true);
    // "B" is istd 1; its own STD follows "A"'s own entire entry (2-byte length prefix + payload).
    const secondStdWord0Offset = 2 + cbStshi + 2 + firstStdLength + 2;
    expect(view.getUint16(secondStdWord0Offset, true) & 0x0fff).toBe(1);
  });
});
