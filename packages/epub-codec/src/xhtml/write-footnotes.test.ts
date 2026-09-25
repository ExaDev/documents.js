// The footnote write suites split from write.test.ts, sharing its write/re-read harness.

import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { EpubDiagnosticCodes } from "../diagnostics";
import type { EpubDiagnostic } from "../diagnostics";
import { buildXml } from "../xml/build";
import { readXhtmlBody } from "./read";
import { writeXhtmlBody } from "./write";

const CONTENT_WIDTH_PT = 451.28;

function xhtmlDocument(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${inner}</body></html>`;
}

function writeWithSink(
  blocks: readonly ContentBlock[],
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
    resolveAnchorHref: (name) => `#${name}`,
  });
  const xml = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">${buildXml([body])}</html>`;
  return { xml, diagnostics };
}

function write(blocks: readonly ContentBlock[]): string {
  return writeWithSink(blocks, () => undefined).xml;
}

function roundTrip(blocks: readonly ContentBlock[]): ContentBlock[] {
  const xml = write(blocks);
  return readXhtmlBody(xml, {
    resolveImage: () => undefined,
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
    contentWidthPt: CONTENT_WIDTH_PT,
  }).blocks;
}

describe("writeXhtmlBody: footnotes", () => {
  it("joins a multi-run footnote range's own text verbatim inside a <pre>, with no separator between runs", () => {
    const xml = write([
      {
        kind: "paragraph",
        preformatted: true,
        runs: [{ text: "a" }, { text: "b" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 0,
            endRun: 2,
          },
        ],
      },
    ]);
    expect(xml).toContain('epub:type="noteref" href="#fn1">ab</a>');
  });

  it("drops an embeddedObject block with the exact ELEMENT_UNMAPPED message naming the loss", () => {
    const { diagnostics } = writeWithSink(
      [
        {
          kind: "embeddedObject",
          objectKind: "wordprocessing",
          frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
          document: { kind: "wordprocessing", metadata: {}, sections: [] },
        },
      ],
      () => undefined,
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: EpubDiagnosticCodes.ELEMENT_UNMAPPED,
        message:
          "an embedded object has no XHTML representation in this package's writer and was dropped",
      }),
    );
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

  // ExaDev/documents.js#994's round-8 regression: a <pre> containing a footnote reference and no language class produces 2+ runs on read (readPreRuns splits the reference into its own run range), which write.ts's own isPreBlockParagraph used to misclassify as an ordinary paragraph (its old heuristic only recognised a lone monospace run) — silently rewriting the block as a <p> and destroying the verbatim whitespace <pre> exists to preserve. The paragraph's own `preformatted: true` flag is what makes this round-trip correctly regardless of run count.
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

  // ExaDev/documents.js#994's round-9 regression: writeList built a list item's own anchor content via writeRunsToNodes alone, never consulting isPreBlockParagraph the way writeParagraph itself does for every other paragraph — so a <pre> nested directly inside an <li> (ordinary, valid HTML5: <li>'s content model is flow content) read back correctly as a preformatted paragraph but was then written out as an ordinary run sequence, destroying the block's own verbatim whitespace exactly like the round-8 regression above, just reached through a list item rather than a section's own top-level blocks.
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

  // The same writeList gap also swallowed a horizontal rule nested inside an <li>: the horizontal-rule sentinel (an empty-runs paragraph carrying HORIZONTAL_RULE_STYLE_ID) is not "ordinary runs" either, and writeRunsToNodes on a paragraph with zero runs and no constructs produces zero XML nodes — so the <hr> vanished entirely from the written <li>, with no diagnostic, rather than degrading or round-tripping.
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

  // ExaDev/documents.js#994's round-11 regression: writeList wrote one <li> per ListGroupNode entry, never consulting each entry's own list.itemId — so a genuinely multi-block list item (readList mints ONE itemId per real <li> and shares it across every block readContainerChildren produces from that <li>'s own children) round-tripped back out as several separate, sibling <li> elements instead of the single item the source document actually had. document-schema.js's own ContentListMembership.itemId comment names exactly this distinction ("one item, several blocks" vs "several items"), which the writer was silently not honouring.
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

  // ExaDev/documents.js#996's own round-7 regression: the round-11 fix above regrouped a multi-block list item's entries correctly, but writeParagraphAsEmbeddedNodes returns an ORDINARY paragraph's own run nodes bare, with no wrapper — so flattening a second entry's bare nodes straight onto a first entry's, with nothing in between, silently fused two distinct paragraphs into one undelimited text run: "First para" and "Second para" became the single word "First paraSecond para", losing the word boundary itself, not merely the paragraph break. The pre-round-11 output (two sibling <li> elements) at least kept every word readable; this was strictly worse. <li>'s content model is Flow content per the HTML Standard, so wrapping every entry after a group's first in its own <p> closes this the same way the horizontal-rule/preformatted cases above are already wrapped in their own self-delimiting elements.
  it("writes and re-reads a multi-paragraph list item without fusing the paragraphs' own text together", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "First para" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "Second para" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ];
    const xml = write(blocks);
    expect(xml).not.toContain("First paraSecond para");
    expect(xml.match(/<li>/gu)).toHaveLength(1);
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // The identical fusion, reached from raw XHTML input rather than a hand-built ContentBlock[] — an EPUB->EPUB round trip through a <li> that already wraps each of its own blocks in a <p>, exactly as ExaDev/documents.js#996's own reported repro described.
  it("re-reads a written multi-<p> list item as two separate paragraphs, not one fused run", () => {
    const { blocks } = readXhtmlBody(
      xhtmlDocument("<ul><li><p>Alpha</p><p>Beta</p></li></ul>"),
      {
        resolveImage: () => undefined,
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    const xml = write(blocks);
    expect(xml).not.toContain("AlphaBeta");
    expect(xml.match(/<li>/gu)).toHaveLength(1);
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  // ExaDev/documents.js#1022, now fixed at the document-schema.js decomposeSection level: walkSectionBlocks previously closed list nesting on a heading or a plain paragraph, but never on a constructStart, so a footnote reference sitting in the last block of a list item — with that footnote's own body immediately following in the flat stream and nothing plain in between to close the list first — attached the footnote's own construct group as a CHILD of that still-open list item rather than at the section root. constructStart now closes the list scope the same way a plain paragraph already did, so the <aside> lands as a section-level sibling after </ul> closes, exactly where it belongs. The fix lives in decomposeSection, not writeList — this pins the effect through the whole pipeline, on every codec built on it, not just here. The noteref anchor's own <p> wrapper is ExaDev/documents.js#996's round-7 fix (unrelated): it is the second of two entries sharing itemId "item1", and every entry after a group's first is delimited this way to stop it fusing with the entry before it.
  it("attaches a footnote's own aside as a section-level sibling after the list, not nested inside the <li> it follows (ExaDev/documents.js#1022)", () => {
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
      '<ul><li>before<p><a epub:type="noteref" href="#fn1"></a></p></li></ul><aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
    );
  });

  it("writes and re-reads a blockquote as a division construct pair", () => {
    const blocks: ContentBlock[] = [
      { kind: "constructStart", descriptor: { kind: "division" } },
      { kind: "paragraph", runs: [{ text: "quoted" }] },
      { kind: "constructEnd" },
    ];
    const result = roundTrip(blocks);
    // The read side re-applies Quote styling + indent from the blockquote wrapper alone — a fact the write side deliberately does not need to have carried through the input for the wrapper to round-trip.
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

  // ExaDev/documents.js#994's round-10 regression: writeRunRangeNodes's own while loop only iterated while there was at least one run left (`index < runs.length`), so a paragraph with zero runs never reached its own construct extents at all — the read side already recovers a bare footnote-reference anchor sitting alone between two block siblings (readContainerChildren's own segment flush) as exactly this shape (runs: [], one construct extent with startRun === endRun === 0), but the writer silently dropped the construct on write, producing an empty <p></p> and orphaning the footnote body it once pointed at.
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

  it("never reports CONSTRUCT_UNREPRESENTED for a single, cleanly-written point-anchor footnote reference", () => {
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
    ];
    const { diagnostics } = writeWithSink(blocks, () => undefined);
    expect(
      diagnostics.some(
        (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toBe(false);
  });

  it("never reports CONSTRUCT_UNREPRESENTED for a single, cleanly-written range footnote reference", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "1" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 2,
          },
        ],
      },
    ];
    const { xml, diagnostics } = writeWithSink(blocks, () => undefined);
    expect(
      diagnostics.some(
        (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toBe(false);
    expect(xml).toContain('href="#fn1"');
  });

  // The identical writer gap also orphaned a table caption whose only content is a footnote reference: readTableCaption's own construct check (src/xhtml/read.ts) recovers `<caption><a epub:type="noteref" href="#fn1"></a></caption>` as this same runs: [], construct-only shape, read immediately before the table — the writer's bug was in the shared run-range walk, not anything caption-specific, so this proves the fix holds for that read shape too rather than only the bare-segment one above.
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
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
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

  // A pre-existing bug in the same writer function, made more reachable by this round's own point-anchor-producing read fixes above: a point anchor (startRun === endRun, "a point anchor at the boundary before run startRun" per document-schema.js's own RunConstructExtent) sitting strictly inside a paragraph's run sequence — not just at its very start — used to advance the write loop past the run at that same index without ever rendering it, silently deleting that run's own text rather than merely failing to wrap it in the anchor.
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

  // ExaDev/documents.js#994's round-11 regression: writeRunRangeNodes's own extent lookup used Array.prototype.find, which resolves at most one extent per startRun — so two point-anchor footnote references sitting back-to-back at the identical run boundary (nothing between them, both startRun === endRun === the same index) silently dropped the second one, with no diagnostic, orphaning its own footnote body. document-schema.js's own RunConstructExtentSchema comment states extents are "data, not brackets" precisely so two of them CAN legitimately share a boundary like this; the writer must collect every extent at an index, not just the first.
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
});
