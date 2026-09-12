import { describe, expect, it } from "vitest";
import { readDocContent, type DocContent } from "../read";
import { CELL_MARK, PARAGRAPH_MARK, SECTION_MARK } from "../text/special";
import { buildDoc, type DocSpec } from "./doc";

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
    // Merged into one Chpx exception -- and since both source runs carried the identical formatting, they still read back as one run of the concatenated text.
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
          // sprmCFBold's ToggleOperand is one byte after the two-byte opcode -- three bytes, odd.
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

  it("round-trips a paragraph whose own mark defaults to PARAGRAPH_MARK when unstated", () => {
    const doc = build({ paragraphs: [{ runs: [{ text: "Default mark" }] }] });
    const block = doc.sections[0]?.blocks[0];
    expect(block?.kind === "paragraph" ? block.runs[0]?.text : undefined).toBe(
      "Default mark",
    );
    expect(PARAGRAPH_MARK).toBe(0x0d);
  });
});
