import type {
  ContentBlock,
  ContentDocument,
  ContentTable,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { readDocContent, readDocStreams } from "./read";
import { PARAGRAPH_MARK, SECTION_MARK } from "./text/special";
import { writeDocContent } from "./write";
import {
  blocksOf,
  document,
  paragraph,
  paragraphAt,
  rawText,
  roundTrip,
} from "./test-support/write";
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
