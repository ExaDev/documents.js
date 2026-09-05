import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { buildXml } from "../xml/build";
import { readXhtmlBody } from "./read";
import { MONOSPACE_FONT_FAMILY } from "./style-constants";
import { writeXhtmlBody } from "./write";

const CONTENT_WIDTH_PT = 451.28;

function write(blocks: ContentBlock[]): string {
  const body = writeXhtmlBody(blocks, {
    registerImage: () => "images/img1.png",
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
  });
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">${buildXml([body])}</html>`;
}

function roundTrip(blocks: ContentBlock[]): ContentBlock[] {
  const xml = write(blocks);
  return readXhtmlBody(xml, {
    resolveImage: () => undefined,
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
    contentWidthPt: CONTENT_WIDTH_PT,
  }).blocks;
}

describe("writeXhtmlBody", () => {
  it("writes and re-reads a heading and a paragraph", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", headingLevel: 1, runs: [{ text: "Title" }] },
      { kind: "paragraph", runs: [{ text: "Body text." }] },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // ExaDev/documents.js#994's round-10 regression: writeHeading briefly routed through the same horizontal-rule/preformatted/ordinary-runs dispatch writeParagraph and writeList use, which let a heading styled entirely in a monospace font with an embedded newline -- isPreBlockParagraph's own legacy heuristic for a foreign producer's <pre> that never set the preformatted flag -- write a <pre> nested inside an <hN>. h1-h6 permit only phrasing content per the HTML Standard; <pre> is flow content, so that shape is non-conformant XHTML no real EPUB validator accepts, and a heading's own content model already rules it out regardless of what produced the input. A plain string check on the writer's own output, not a round trip: reading a <br>-split heading back always produces more than the single run this heuristic keys on, so a full round trip would prove nothing about the shape this test exists to rule out.
  it("keeps a heading's own runs as phrasing content even when they would otherwise trip the <pre> heuristic", () => {
    const xml = write([
      {
        kind: "paragraph",
        headingLevel: 1,
        runs: [
          { text: "line one\nline two", fontFamily: MONOSPACE_FONT_FAMILY },
        ],
      },
    ]);
    expect(xml).not.toContain("<pre>");
    expect(xml).toContain("<h1><code>line one<br");
  });

  it("writes and re-reads bold/italic/underline/strike/monospace runs", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "bold", bold: true },
          { text: "italic", italic: true },
          { text: "under", underline: true },
          { text: "strike", strike: true },
          { text: "mono", fontFamily: "Courier New" },
        ],
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a hyperlink", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "site", hyperlink: "https://example.com" }],
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a bullet list", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item2" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads an ordered list with a non-default start", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:ordered@3", level: 0, itemId: "item1" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a nested list, preserving level", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "a1" }],
        list: { numId: "epub1:bullet", level: 1, itemId: "item2" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a table with colspan", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
                colSpan: 2,
              },
            ],
          },
        ],
        columnWidthsPt: [100, 100],
      },
    ];
    const result = roundTrip(blocks);
    expect(result).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
                colSpan: 2,
              },
            ],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
  });

  it("writes and re-reads a horizontal rule", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [], styleId: "HorizontalRule" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a code block with a language", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "const x = 1;\nconsole.log(x);", fontFamily: "Courier New" },
        ],
        preformatted: true,
        codeLanguage: "js",
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // ExaDev/documents.js#994's round-8 regression: a <pre> containing a footnote reference and no language class produces 2+ runs on read (readPreRuns splits the reference into its own run range), which write.ts's own isPreBlockParagraph used to misclassify as an ordinary paragraph (its old heuristic only recognised a lone monospace run) -- silently rewriting the block as a <p> and destroying the verbatim whitespace <pre> exists to preserve. The paragraph's own `preformatted: true` flag is what makes this round-trip correctly regardless of run count.
  it("writes and re-reads a <pre> carrying a footnote reference and no language class, preserving both the verbatim block and the construct", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "line one\nsee", fontFamily: "Courier New" },
          { text: "1", fontFamily: "Courier New" },
          { text: "\nline two", fontFamily: "Courier New" },
        ],
        preformatted: true,
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 2,
          },
        ],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // ExaDev/documents.js#994's round-9 regression: writeList built a list item's own anchor content via writeRunsToNodes alone, never consulting isPreBlockParagraph the way writeParagraph itself does for every other paragraph -- so a <pre> nested directly inside an <li> (ordinary, valid HTML5: <li>'s content model is flow content) read back correctly as a preformatted paragraph but was then written out as an ordinary run sequence, destroying the block's own verbatim whitespace exactly like the round-8 regression above, just reached through a list item rather than a section's own top-level blocks.
  it("writes and re-reads a <pre> nested directly inside a list item, preserving its verbatim block", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "const x = 1;\nconsole.log(x);", fontFamily: "Courier New" },
        ],
        preformatted: true,
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // The same writeList gap also swallowed a horizontal rule nested inside an <li>: the horizontal-rule sentinel (an empty-runs paragraph carrying HORIZONTAL_RULE_STYLE_ID) is not "ordinary runs" either, and writeRunsToNodes on a paragraph with zero runs and no constructs produces zero XML nodes -- so the <hr> vanished entirely from the written <li>, with no diagnostic, rather than degrading or round-tripping.
  it("writes and re-reads a horizontal rule nested directly inside a list item", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [],
        styleId: "HorizontalRule",
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a blockquote as a division construct pair", () => {
    const blocks: ContentBlock[] = [
      { kind: "constructStart", descriptor: { kind: "division" } },
      { kind: "paragraph", runs: [{ text: "quoted" }] },
      { kind: "constructEnd" },
    ];
    const result = roundTrip(blocks);
    // The read side re-applies Quote styling + indent from the blockquote wrapper alone -- a fact the write side deliberately does not need to have carried through the input for the wrapper to round-trip.
    expect(result).toEqual([
      { kind: "constructStart", descriptor: { kind: "division" } },
      {
        kind: "paragraph",
        runs: [{ text: "quoted" }],
        indentLeftPt: 36,
        styleId: "Quote",
      },
      { kind: "constructEnd" },
    ]);
  });

  it("writes and re-reads a footnote reference and body", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "1" }, { text: "." }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 2,
          },
        ],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // ExaDev/documents.js#994's round-10 regression: writeRunRangeNodes's own while loop only iterated while there was at least one run left (`index < runs.length`), so a paragraph with zero runs never reached its own construct extents at all -- the read side already recovers a bare footnote-reference anchor sitting alone between two block siblings (readContainerChildren's own segment flush) as exactly this shape (runs: [], one construct extent with startRun === endRun === 0), but the writer silently dropped the construct on write, producing an empty <p></p> and orphaning the footnote body it once pointed at.
  it("writes and re-reads a bare footnote reference construct sitting alone between two paragraphs, with no runs of its own", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "Before" }] },
      {
        kind: "paragraph",
        runs: [],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 0,
            endRun: 0,
          },
        ],
      },
      { kind: "paragraph", runs: [{ text: "After" }] },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // The identical writer gap also orphaned a table caption whose only content is a footnote reference: readTableCaption's own construct check (src/xhtml/read.ts) recovers `<caption><a epub:type="noteref" href="#fn1"></a></caption>` as this same runs: [], construct-only shape, read immediately before the table -- the writer's bug was in the shared run-range walk, not anything caption-specific, so this proves the fix holds for that read shape too rather than only the bare-segment one above.
  it("writes and re-reads a bare footnote reference construct in a paragraph sitting immediately before a table, matching a caption's own read shape", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 0,
            endRun: 0,
          },
        ],
      },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // A pre-existing bug in the same writer function, made more reachable by this round's own point-anchor-producing read fixes above: a point anchor (startRun === endRun, "a point anchor at the boundary before run startRun" per document-schema.js's own RunConstructExtent) sitting strictly inside a paragraph's run sequence -- not just at its very start -- used to advance the write loop past the run at that same index without ever rendering it, silently deleting that run's own text rather than merely failing to wrap it in the anchor.
  it("writes and re-reads a point-anchor footnote reference sitting between two runs, preserving the run at that index", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "1." }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 1,
          },
        ],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes an image using the registered manifest href", () => {
    const xml = write([
      {
        kind: "image",
        format: "png",
        base64: "aGVsbG8=",
        widthPt: 72,
        heightPt: 72,
        altText: "alt",
      },
    ]);
    expect(xml).toContain('src="images/img1.png"');
    expect(xml).toContain('alt="alt"');
  });
});
