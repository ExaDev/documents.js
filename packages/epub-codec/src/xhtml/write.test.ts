import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { EpubDiagnosticCodes, type EpubDiagnostic } from "../diagnostics";
import { buildXml } from "../xml/build";
import { readXhtmlBody } from "./read";
import { MONOSPACE_FONT_FAMILY } from "./style-constants";
import { writeXhtmlBody } from "./write";

const CONTENT_WIDTH_PT = 451.28;

function write(blocks: ContentBlock[]): string {
  return writeWithSink(blocks, () => undefined).xml;
}

function writeWithSink(
  blocks: ContentBlock[],
  sink: (d: EpubDiagnostic) => void,
): { xml: string; diagnostics: EpubDiagnostic[] } {
  const diagnostics: EpubDiagnostic[] = [];
  const body = writeXhtmlBody(blocks, {
    registerImage: () => "images/img1.png",
    sink: (d) => {
      diagnostics.push(d);
      sink(d);
    },
    sourceHref: "chapter1.xhtml",
  });
  const xml = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">${buildXml([body])}</html>`;
  return { xml, diagnostics };
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

  // ExaDev/documents.js#994's round-11 regression: writeList wrote one <li> per ListGroupNode entry, never consulting each entry's own list.itemId -- so a genuinely multi-block list item (readList mints ONE itemId per real <li> and shares it across every block readContainerChildren produces from that <li>'s own children) round-tripped back out as several separate, sibling <li> elements instead of the single item the source document actually had. document-schema.js's own ContentListMembership.itemId comment names exactly this distinction ("one item, several blocks" vs "several items"), which the writer was silently not honouring.
  it("writes and re-reads a multi-block list item (a horizontal rule followed by a paragraph) as one <li>, not two", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [],
        styleId: "HorizontalRule",
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "after the rule" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ];
    const xml = write(blocks);
    expect(xml.match(/<li>/gu)).toHaveLength(1);
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // The one gap the round-11 itemId-grouping fix above does NOT close, pinned here rather than fixed: a document-schema.js decomposeSection defect (ExaDev/documents.js#1022), not something writeList alone can correct. walkSectionBlocks only closes list nesting on a heading or a PLAIN paragraph -- never on a constructStart -- so a footnote reference sitting in the last block of a list item, with that footnote's own body immediately following in the flat stream and nothing plain in between to close the list first, attaches the footnote's own construct group as a CHILD of that still-open list item rather than at the section root. The output below is the current, known-incorrect shape (the <aside> nested inside the <li>) -- tracked in #1022 as a decompose-level fix affecting every codec built on decomposeSection, not an epub-codec-only one.
  it("nests a footnote's own aside inside the enclosing <li> when it immediately follows a list item's last block (ExaDev/documents.js#1022, tracked separately)", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "before" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
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
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ];
    const xml = write(blocks);
    expect(xml).toContain(
      '<li>before<a epub:type="noteref" href="#fn1"></a><aside epub:type="footnote" id="fn1"><p>Note body.</p></aside></li>',
    );
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

  // ExaDev/documents.js#994's round-11 regression: writeRunRangeNodes's own extent lookup used Array.prototype.find, which resolves at most one extent per startRun -- so two point-anchor footnote references sitting back-to-back at the identical run boundary (nothing between them, both startRun === endRun === the same index) silently dropped the second one, with no diagnostic, orphaning its own footnote body. document-schema.js's own RunConstructExtentSchema comment states extents are "data, not brackets" precisely so two of them CAN legitimately share a boundary like this; the writer must collect every extent at an index, not just the first.
  it("writes and re-reads two point-anchor footnote references sitting at the same run boundary, preserving both", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "." }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 1,
          },
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn2" },
            startRun: 1,
            endRun: 1,
          },
        ],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
      },
      { kind: "paragraph", runs: [{ text: "First note." }] },
      { kind: "constructEnd" },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "fn2" },
      },
      { kind: "paragraph", runs: [{ text: "Second note." }] },
      { kind: "constructEnd" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // The overlapping-range twin of the point-anchor case immediately above: two NON-point footnote extents sharing the same startRun. Unlike two point anchors (which wrap zero runs each and never conflict), two range extents both claiming the identical starting run cannot both become sibling <a> elements -- <a> is interactive content and HTML forbids nesting one inside another, so at most one can actually wrap the runs. This is the "genuinely unrepresentable overlap" the fix reports through the diagnostic sink rather than silently dropping: the first extent in the input's own constructs array wins and is written normally, the second is reported via CONSTRUCT_UNREPRESENTED, and -- the property that actually matters -- every run's own text still survives in the output either way, since the losing extent's own runs are already covered by the winner's range.
  it("reports CONSTRUCT_UNREPRESENTED and preserves all run text when two overlapping footnote extents share a startRun", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "this" }, { text: "." }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 0,
            endRun: 2,
          },
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn2" },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ];
    const { xml, diagnostics } = writeWithSink(blocks, () => undefined);
    expect(
      diagnostics.some(
        (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toBe(true);
    // No run text is lost: the winning extent (fn1) wraps the first two runs, and the third run -- past fn1's own endRun -- is still written on its own.
    expect(xml).toContain('href="#fn1"');
    expect(xml).not.toContain('href="#fn2"');
    expect(xml).toContain("See");
    expect(xml).toContain("this");
    expect(xml).toContain(".");
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
