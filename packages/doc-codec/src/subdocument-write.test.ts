import { describe, expect, it } from "vitest";
import type { ContentDocument } from "document-schema.js";
import { DataStreamBuilder } from "./data-stream";
import { DocFormatError } from "./errors";
import {
  buildHeaderSubdocument,
  buildNoteSubdocument,
  buildStorySubdocuments,
  paragraphCharacters,
} from "./subdocument-write";
import { PARAGRAPH_MARK } from "./text/special";
import type { WriteParagraph } from "./table/write";

type Wordprocessing = Extract<ContentDocument, { kind: "wordprocessing" }>;

function paragraph(textLength: number): WriteParagraph {
  return {
    runs:
      textLength === 0
        ? []
        : [{ run: { text: "x".repeat(textLength) }, extraGrpprl: [] }],
    properties: {},
    extraGrpprl: [],
    terminator: PARAGRAPH_MARK,
  };
}

describe("paragraphCharacters", () => {
  it("counts every run's own text length plus one for the terminator", () => {
    expect(paragraphCharacters(paragraph(5))).toBe(6);
  });

  it("counts an empty (run-less) paragraph as just its terminator", () => {
    expect(paragraphCharacters(paragraph(0))).toBe(1);
  });
});

describe("buildNoteSubdocument", () => {
  it("builds an empty note as one empty paragraph plus its own guard mark", () => {
    const subdoc = buildNoteSubdocument([{ text: "" }]);
    // One content paragraph (empty) + one guard paragraph = 2 terminators.
    expect(subdoc.ccp).toBe(2 + 1); // + the subdocument's own trailing guard mark.
    expect(subdoc.paragraphs).toHaveLength(3);
    // Genuinely no runs at all, not a single run carrying an empty-string text -- the two are equal in character count but not in shape.
    expect(subdoc.paragraphs[0]?.runs).toEqual([]);
  });

  it("splits a note's own text at newlines into separate paragraphs", () => {
    const subdoc = buildNoteSubdocument([{ text: "line one\nline two" }]);
    // "line one" + "line two" content paragraphs, the story's own guard, then the subdocument's own trailing guard: 4 paragraphs total.
    expect(subdoc.paragraphs).toHaveLength(4);
    expect(subdoc.ccp).toBe(9 + 9 + 1 + 1);
  });

  it("gives each note its own story start in the plex", () => {
    const subdoc = buildNoteSubdocument([{ text: "a" }, { text: "b" }]);
    const view = new DataView(
      subdoc.plex.buffer,
      subdoc.plex.byteOffset,
      subdoc.plex.byteLength,
    );
    const keyCount = subdoc.plex.byteLength / 4;
    // 2 stories + the subdocument's own two trailing keys (ccpText, ccp).
    expect(keyCount).toBe(4);
    expect(view.getUint32(0, true)).toBe(0); // First story starts at 0.
    // "a" (1 char + its own terminator = 2) + the story's own guard paragraph (1) = 3.
    expect(view.getUint32(4, true)).toBe(3);
  });

  it("gives an empty notes array a subdocument of just the trailing guard mark", () => {
    const subdoc = buildNoteSubdocument([]);
    expect(subdoc.ccp).toBe(1);
    expect(subdoc.paragraphs).toHaveLength(1);
  });
});

describe("buildHeaderSubdocument", () => {
  it("throws when a story names a section outside the document's own section count", () => {
    expect(() =>
      buildHeaderSubdocument(
        [{ section: 1, slot: "evenHeader", blocks: [] }],
        1,
        new DataStreamBuilder(),
      ),
    ).toThrow(DocFormatError);
    expect(() =>
      buildHeaderSubdocument(
        [{ section: 1, slot: "evenHeader", blocks: [] }],
        1,
        new DataStreamBuilder(),
      ),
    ).toThrow(/names section 1, but this document has 1 sections/);
  });

  it("throws when a negative section is given", () => {
    expect(() =>
      buildHeaderSubdocument(
        [{ section: -1, slot: "evenHeader", blocks: [] }],
        1,
        new DataStreamBuilder(),
      ),
    ).toThrow(DocFormatError);
  });

  it("throws when more than one story is given for the identical section/slot pair", () => {
    expect(() =>
      buildHeaderSubdocument(
        [
          { section: 0, slot: "evenHeader", blocks: [] },
          { section: 0, slot: "evenHeader", blocks: [] },
        ],
        1,
        new DataStreamBuilder(),
      ),
    ).toThrow(/more than one header\/footer story/);
  });

  it("writes a story whose blocks flatten to nothing as a present-but-blank paragraph", () => {
    const subdoc = buildHeaderSubdocument(
      [{ section: 0, slot: "evenHeader", blocks: [] }],
      1,
      new DataStreamBuilder(),
    );
    // 6 separator stories (empty) + evenHeader (1 blank content paragraph + its own guard) + 5 other empty per-section slots. The blank content paragraph plus its guard cost 2 terminators; every other slot costs nothing.
    expect(subdoc.ccp).toBe(2 + 1); // + the subdocument's own trailing guard mark.
  });

  it("leaves a slot the model does not carry genuinely empty rather than inserting a blank paragraph", () => {
    const subdoc = buildHeaderSubdocument([], 1, new DataStreamBuilder());
    // No story at all: just the subdocument's own trailing guard mark.
    expect(subdoc.ccp).toBe(1);
    expect(subdoc.paragraphs).toHaveLength(1);
  });

  it("writes exactly one section's own worth of slot keys, not one section too many", () => {
    const subdoc = buildHeaderSubdocument([], 1, new DataStreamBuilder());
    // 6 fixed separator stories + 1 section's own 6 slots + the subdocument's own trailing ccpText/ccp pair = 14 keys, each 4 bytes -- a loop that ran one section past sectionCount would append 6 more.
    expect(subdoc.plex.byteLength / 4).toBe(6 + 6 + 2);
  });

  it("writes real block content for a story that carries some", () => {
    const subdoc = buildHeaderSubdocument(
      [
        {
          section: 0,
          slot: "oddHeader",
          blocks: [{ kind: "paragraph", runs: [{ text: "Header text" }] }],
        },
      ],
      1,
      new DataStreamBuilder(),
    );
    // "Header text" (11 chars + 1 terminator) + its own guard (1) + the subdocument's trailing guard (1).
    expect(subdoc.ccp).toBe(11 + 1 + 1 + 1);
  });
});

describe("buildStorySubdocuments", () => {
  function withSections(): { sections: Wordprocessing["sections"] } {
    return {
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
        },
      ],
    };
  }

  it("leaves every subdocument undefined when the document carries none of them", () => {
    const result = buildStorySubdocuments(
      withSections(),
      new DataStreamBuilder(),
    );
    expect(result.footnote).toBeUndefined();
    expect(result.header).toBeUndefined();
    expect(result.comment).toBeUndefined();
    expect(result.endnote).toBeUndefined();
  });

  it("leaves footnote undefined for a genuinely empty (zero-length) footnotes array", () => {
    const result = buildStorySubdocuments(
      { ...withSections(), footnotes: [] },
      new DataStreamBuilder(),
    );
    expect(result.footnote).toBeUndefined();
  });

  it("leaves comment undefined for a genuinely empty (zero-length) comments array", () => {
    const result = buildStorySubdocuments(
      { ...withSections(), comments: [] },
      new DataStreamBuilder(),
    );
    expect(result.comment).toBeUndefined();
  });

  it("leaves endnote undefined for a genuinely empty (zero-length) endnotes array", () => {
    const result = buildStorySubdocuments(
      { ...withSections(), endnotes: [] },
      new DataStreamBuilder(),
    );
    expect(result.endnote).toBeUndefined();
  });

  it("leaves header undefined for a genuinely empty (zero-length) headerFooterStories array", () => {
    const result = buildStorySubdocuments(
      { ...withSections(), headerFooterStories: [] },
      new DataStreamBuilder(),
    );
    expect(result.header).toBeUndefined();
  });

  it("builds a footnote subdocument when footnotes is non-empty", () => {
    const result = buildStorySubdocuments(
      { ...withSections(), footnotes: [{ text: "Note" }] },
      new DataStreamBuilder(),
    );
    expect(result.footnote).toBeDefined();
  });

  it("builds a comment subdocument when comments is non-empty", () => {
    const result = buildStorySubdocuments(
      { ...withSections(), comments: [{ text: "Comment" }] },
      new DataStreamBuilder(),
    );
    expect(result.comment).toBeDefined();
  });

  it("builds an endnote subdocument when endnotes is non-empty", () => {
    const result = buildStorySubdocuments(
      { ...withSections(), endnotes: [{ text: "Endnote" }] },
      new DataStreamBuilder(),
    );
    expect(result.endnote).toBeDefined();
  });

  it("builds a header subdocument when headerFooterStories is non-empty", () => {
    const result = buildStorySubdocuments(
      {
        ...withSections(),
        headerFooterStories: [{ section: 0, slot: "evenHeader", blocks: [] }],
      },
      new DataStreamBuilder(),
    );
    expect(result.header).toBeDefined();
  });
});
