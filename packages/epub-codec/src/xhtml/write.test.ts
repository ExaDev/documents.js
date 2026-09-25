import { assertNeverLeafBlock } from "./write";
import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { EpubDiagnosticCodes, type EpubDiagnostic } from "../diagnostics";
import { buildXml } from "../xml/build";
import { readXhtmlBody } from "./read";
import { MONOSPACE_FONT_FAMILY } from "./style-constants";
import { writeXhtmlBody } from "./write";

const CONTENT_WIDTH_PT = 451.28;

// A minimal XHTML content document wrapping raw <body> content, for the one test below that needs to read a hand-written fragment rather than a hand-built ContentBlock[] — matching read.test.ts's own identical helper.

function write(blocks: readonly ContentBlock[]): string {
  return writeWithSink(blocks, () => undefined).xml;
}

// The raw XmlElement tree, for the handful of tests that need to inspect writer-internal node structure (e.g. whether a spurious empty text node exists between two sibling elements) directly — a distinction the serialized XML string itself can lose, since an empty text node contributes zero characters to the output either way.
function writeBody(blocks: readonly ContentBlock[]) {
  return writeXhtmlBody(blocks, {
    registerImage: () => "images/img1.png",
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
    resolveAnchorHref: (name) => `#${name}`,
  });
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

// The number of cell tags in each <tr>, in document order.

function roundTrip(blocks: readonly ContentBlock[]): ContentBlock[] {
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

  // ExaDev/documents.js#994's round-10 regression: writeHeading briefly routed through the same horizontal-rule/preformatted/ordinary-runs dispatch writeParagraph and writeList use, which let a heading styled entirely in a monospace font with an embedded newline — isPreBlockParagraph's own legacy heuristic for a foreign producer's <pre> that never set the preformatted flag — write a <pre> nested inside an <hN>. h1-h6 permit only phrasing content per the HTML Standard; <pre> is flow content, so that shape is non-conformant XHTML no real EPUB validator accepts, and a heading's own content model already rules it out regardless of what produced the input. A plain string check on the writer's own output, not a round trip: reading a <br>-split heading back always produces more than the single run this heuristic keys on, so a full round trip would prove nothing about the shape this test exists to rule out.
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

  it("writes and re-reads subscript/superscript runs", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "x" },
          { text: "2", verticalAlign: "superscript" },
          { text: " and H" },
          { text: "2", verticalAlign: "subscript" },
          { text: "O" },
        ],
      },
    ];
    const xml = write(blocks);
    expect(xml).toContain("<sup>2</sup>");
    expect(xml).toContain("<sub>2</sub>");
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("writes and re-reads a paragraph's and a run's direction", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        direction: "rtl",
        runs: [{ text: "a", direction: "rtl" }, { text: "b" }],
      },
      {
        kind: "paragraph",
        headingLevel: 2,
        direction: "ltr",
        runs: [{ text: "h" }],
      },
      {
        kind: "paragraph",
        preformatted: true,
        direction: "rtl",
        runs: [{ text: "code", fontFamily: "Courier New" }],
      },
    ];
    const xml = write(blocks);
    expect(xml).toContain('<p dir="rtl">');
    expect(xml).toContain('<span dir="rtl">a</span>');
    expect(xml).toContain('<h2 dir="ltr">');
    expect(xml).toContain('<pre dir="rtl">');
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("wraps a direction-carrying list item's anchor paragraph in its own <p dir>, rather than dropping the direction on unwrapped inline nodes", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        direction: "rtl",
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
        runs: [{ text: "item text" }],
      },
    ];
    const xml = write(blocks);
    expect(xml).toContain('<li><p dir="rtl">item text</p></li>');
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

  it("never groups two adjacent list items that both carry no itemId into a single <li>", () => {
    const xml = write([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0 },
      },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "epub1:bullet", level: 0 },
      },
    ]);
    const liCount = xml.split("<li>").length - 1;
    expect(liCount).toBe(2);
  });

  it("writes and re-reads an ordered list with the default start, carrying no explicit start attribute", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:ordered", level: 0, itemId: "item1" },
      },
    ];
    const xml = write(blocks);
    expect(xml).not.toContain("start=");
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

  it("writes a paragraph carrying only codeLanguage (no preformatted flag) as a <pre><code>", () => {
    const xml = write([
      {
        kind: "paragraph",
        runs: [{ text: "x = 1" }],
        codeLanguage: "js",
      },
    ]);
    expect(xml).toContain('<pre><code class="language-js">x = 1</code></pre>');
  });

  it("recognises a foreign producer's own <pre> via the legacy monospace-plus-newline heuristic alone, with neither preformatted nor codeLanguage set", () => {
    const xml = write([
      {
        kind: "paragraph",
        runs: [
          { text: "line one\nline two", fontFamily: MONOSPACE_FONT_FAMILY },
        ],
      },
    ]);
    expect(xml).toContain("<pre>");
  });

  it("never treats a plain paragraph as preformatted just because it happens to have one monospace run without a newline", () => {
    const xml = write([
      {
        kind: "paragraph",
        runs: [{ text: "mono", fontFamily: "Courier New" }],
      },
    ]);
    expect(xml).not.toContain("<pre>");
    expect(xml).toContain("<p>");
  });

  it("never treats a plain paragraph as preformatted just because it has a newline in a non-monospace run", () => {
    const xml = write([
      { kind: "paragraph", runs: [{ text: "line one\nline two" }] },
    ]);
    expect(xml).not.toContain("<pre>");
  });

  it("never treats a plain paragraph as preformatted when the monospace-plus-newline run is not the only run", () => {
    const xml = write([
      {
        kind: "paragraph",
        runs: [
          { text: "line one\nline two", fontFamily: "Courier New" },
          { text: " and more" },
        ],
      },
    ]);
    expect(xml).not.toContain("<pre>");
  });

  it("drops a pageBreak block entirely, with no element and no diagnostic", () => {
    const { xml, diagnostics } = writeWithSink(
      [{ kind: "pageBreak" }],
      () => undefined,
    );
    expect(xml).toBe(
      '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body></body></html>',
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("never inserts a spurious empty text node between two <br/> elements for a run's own consecutive embedded newlines", () => {
    const body = writeBody([{ kind: "paragraph", runs: [{ text: "a\n\nb" }] }]);
    const [p] = body.children;
    if (p?.type !== "element") {
      throw new Error("expected a <p> element");
    }
    expect(
      p.children.map((c) =>
        c.type === "element" ? c.tag : c.type === "text" ? c.value : c.type,
      ),
    ).toEqual(["a", "br", "br", "b"]);
  });

  it("writes a wholly empty, unformatted run as exactly one empty text node, never zero and never placeholder text", () => {
    const body = writeBody([{ kind: "paragraph", runs: [{ text: "" }] }]);
    const [p] = body.children;
    if (p?.type !== "element") {
      throw new Error("expected a <p> element");
    }
    expect(p.children).toHaveLength(1);
    expect(p.children[0]).toEqual({ type: "text", value: "" });
  });

  it("never emits a text node for an empty-text run inside a <pre>, unlike a non-empty sibling run", () => {
    const body = writeBody([
      {
        kind: "paragraph",
        preformatted: true,
        runs: [{ text: "" }, { text: "b" }],
      },
    ]);
    const [pre] = body.children;
    if (pre?.type !== "element") {
      throw new Error("expected a <pre> element");
    }
    const [code] = pre.children;
    if (code?.type !== "element") {
      throw new Error("expected a <code> element");
    }
    expect(code.children).toEqual([{ type: "text", value: "b" }]);
  });

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
    const unrepresented = diagnostics.find(
      (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    );
    expect(unrepresented?.message).toContain("footnote reference");
    expect(unrepresented?.message).toContain(
      "cannot be represented as its own <a> element",
    );
    // No run text is lost: the winning extent (fn1) wraps the first two runs, and the third run — past fn1's own endRun — is still written on its own.
    expect(xml).toContain('href="#fn1"');
    expect(xml).not.toContain('href="#fn2"');
    expect(xml).toContain("See");
    expect(xml).toContain("this");
    expect(xml).toContain(".");
  });

  it("names an unrepresented internal-link extent as an 'internal link', not a footnote reference, in its CONSTRUCT_UNREPRESENTED message", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "this" }],
        constructs: [
          {
            descriptor: {
              kind: "link",
              target: { kind: "internal", anchor: "bm1" },
            },
            startRun: 0,
            endRun: 2,
          },
          {
            descriptor: {
              kind: "link",
              target: { kind: "internal", anchor: "bm2" },
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ];
    const { diagnostics } = writeWithSink(blocks, () => undefined);
    const unrepresented = diagnostics.find(
      (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    );
    expect(unrepresented?.message).toContain("internal link");
    expect(unrepresented?.message).not.toContain("footnote reference");
  });

  it("writes a clean internal-link construct extent as its own <a href> targeting the resolved anchor", () => {
    const xml = write([
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "this" }],
        constructs: [
          {
            descriptor: {
              kind: "link",
              target: { kind: "internal", anchor: "bm1" },
            },
            startRun: 1,
            endRun: 2,
          },
        ],
      },
    ]);
    expect(xml).toContain('<a href="#bm1">this</a>');
  });

  it("never treats a run-level link construct with an external target as a representable reference extent", () => {
    // isReferenceExtent recognises only an internal link target here — an external one is the run-level ContentRun.hyperlink field's own established territory (ExaDev/document-schema.js#22), so a construct-level extent naming one is neither wrapped in its own <a> nor reported as an unhandled anchor (reportUnhandledAnchorExtents only covers descriptor.kind === "anchor").
    const { xml, diagnostics } = writeWithSink(
      [
        {
          kind: "paragraph",
          runs: [{ text: "See" }, { text: "this" }],
          constructs: [
            {
              descriptor: {
                kind: "link",
                target: { kind: "external", uri: "https://example.com" },
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ],
      () => undefined,
    );
    expect(xml).not.toContain("<a ");
    expect(xml).toContain("this");
    expect(diagnostics).toHaveLength(0);
  });

  // ExaDev/documents.js#994's round-12 regression, one input shape past the same-startRun collision immediately above: two footnote extents that genuinely CROSS — fn2's own startRun (1) falls strictly INSIDE fn1's already-winning range (runs 0-2), rather than sharing fn1's exact startRun. Because a winning range extent advances the write walk straight from its own startRun to its own endRun, index 1 is never visited at all, so the previous fix (which only looked for a collision among extents sharing the SAME startRun) never saw fn2 and dropped it with no diagnostic whatsoever — the exact silent-drop class this whole diagnostic exists to close, just reached via a different input shape. document-schema.js's own RunConstructExtentSchema comment names this precise shape ("two entries may cross freely") as real, representable input.
  it("reports CONSTRUCT_UNREPRESENTED and preserves all run text when two footnote extents genuinely cross", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [
          { text: "See" },
          { text: "this" },
          { text: "footnote" },
          { text: "text" },
        ],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 0,
            endRun: 2,
          },
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn2" },
            startRun: 1,
            endRun: 3,
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
    // fn1 wins and wraps the first two runs; fn2 is unrepresented, but every run it would have covered still appears — "this" wrapped inside fn1's own anchor, "footnote" written unwrapped past fn1's endRun.
    expect(xml).toContain('href="#fn1"');
    expect(xml).not.toContain('href="#fn2"');
    expect(xml).toContain("See");
    expect(xml).toContain("this");
    expect(xml).toContain("footnote");
    expect(xml).toContain("text");
  });

  // The point-anchor twin of the crossing-ranges case immediately above: fn2 is a POINT anchor (startRun === endRun) whose own boundary sits strictly inside fn1's already-winning range, rather than a second range extent. A point anchor wraps zero runs of its own and never conflicts with a sibling point anchor at the same boundary — but here it never gets the chance to be compared against anything, since the write walk skips straight over index 1 (fn1's own interior) without ever checking it, so fn2's own startRun===1 is never matched. Before this round's fix, this silently deleted nothing (a point anchor wraps no run text), but the anchor markup itself — and the footnote body it addresses — simply vanished from the output with no diagnostic.
  it("reports CONSTRUCT_UNREPRESENTED when a point-anchor footnote reference sits strictly inside another extent's own winning range", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "this" }, { text: "note" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 0,
            endRun: 3,
          },
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn2" },
            startRun: 1,
            endRun: 1,
          },
        ],
      },
    ];
    const { xml, diagnostics } = writeWithSink(blocks, () => undefined);
    const unrepresented = diagnostics.find(
      (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    );
    // A point anchor's own message names the boundary it marks, distinctly from a range extent's "cannot be represented as its own <a> element" wording.
    expect(unrepresented?.message).toContain(
      "marking the boundary before run 1",
    );
    expect(unrepresented?.message).toContain(
      "a point anchor wraps no run text of its own",
    );
    // fn1 wins and wraps every run; fn2's own anchor is not emitted, but no run text is lost — a point anchor never wraps any of its own.
    expect(xml).toContain('href="#fn1"');
    expect(xml).not.toContain('href="#fn2"');
    expect(xml).toContain("See");
    expect(xml).toContain("this");
    expect(xml).toContain("note");
  });

  // ExaDev/documents.js#996's own round-7 regression: writeRunRangeNodes's own `index <= runs.length` bound (needed so a point anchor can sit at the very end of a paragraph) let a RANGE extent (endRun > startRun) whose own startRun sat exactly at that same boundary slip through the same path — runs.slice(startRun, endRun) on a startRun === runs.length always yields an empty array, so the walk silently emitted a content-free <a> and never added the extent to `emittedExtents`' complement, meaning the post-walk sweep never reported it either. A range needs at least one real run at its own startRun to wrap; unlike a point extent, there is no legitimate reason for one to start exactly at the run count, so this is treated as the same kind of malformed extent an out-of-bounds startRun already was.
  it("reports CONSTRUCT_UNREPRESENTED, rather than silently emitting an empty <a>, for a range extent whose startRun sits exactly at the paragraph's own run count", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        constructs: [
          {
            descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
            startRun: 1,
            endRun: 5,
          },
        ],
      },
    ];
    const { xml, diagnostics } = writeWithSink(blocks, () => undefined);
    expect(xml).not.toContain('epub:type="noteref"');
    expect(
      diagnostics.some(
        (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      ),
    ).toBe(true);
  });

  it("restores a bookmark target as an id attribute on its single wrapped element, replacing any id the element already carries", () => {
    // A nested bookmark: the inner one wraps the paragraph first and stamps its own id onto it; the outer one must overwrite that id with its own name, not leave both id attributes in the array alongside it. The paragraph's own direction gives the wrapped <p> a second, unrelated attribute the filter must leave untouched — a plain object literal's own duplicate-key-overwrite semantics would otherwise hide a filter that removed nothing at all (an extra "id" entry collapses to the same final serialized attribute either way), so this checks the raw attributes array directly rather than the serialized XML string.
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "outer" },
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "inner" },
      },
      { kind: "paragraph", direction: "rtl", runs: [{ text: "target" }] },
      { kind: "constructEnd" },
      { kind: "constructEnd" },
    ];
    const body = writeBody(blocks);
    const [p] = body.children;
    if (p?.type !== "element") {
      throw new Error("expected a <p> element");
    }
    expect(p.attributes).toEqual([
      { name: "dir", value: "rtl" },
      { name: "id", value: "outer" },
    ]);
  });

  it("reports CONSTRUCT_UNREPRESENTED with the exact message when a bookmark wraps more than one written element", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "bm1" },
      },
      { kind: "paragraph", runs: [{ text: "one" }] },
      { kind: "paragraph", runs: [{ text: "two" }] },
      { kind: "constructEnd" },
    ];
    const { xml, diagnostics } = writeWithSink(blocks, () => undefined);
    expect(xml).toContain("one");
    expect(xml).toContain("two");
    expect(xml).not.toContain('id="bm1"');
    const diagnostic = diagnostics.find(
      (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    );
    expect(diagnostic?.message).toBe(
      "a bookmark target ('bm1') wraps more than one written element (or none); this package's writer only restores an id attribute onto a single wrapped element, so the target's own addressability is dropped",
    );
  });

  it.each(["endnote", "comment"] as const)(
    "reports CONSTRUCT_UNREPRESENTED for a block-scoped '%s' anchor construct group, distinctly from a bookmark, while still writing its content",
    (anchorType) => {
      const blocks: ContentBlock[] = [
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType, name: "x1" },
        },
        { kind: "paragraph", runs: [{ text: "body" }] },
        { kind: "constructEnd" },
      ];
      const { xml, diagnostics } = writeWithSink(blocks, () => undefined);
      expect(xml).toContain("body");
      expect(xml).not.toContain('id="x1"');
      const diagnostic = diagnostics.find(
        (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      );
      expect(diagnostic?.message).toBe(
        "a 'anchor' construct has no XHTML spelling in this package's writer; its extent is written, the construct itself is not",
      );
    },
  );

  // ExaDev/documents.js#1025: a run-level anchor extent whose anchorType is anything but "footnote" (a bookmark or comment range docx documents can and do carry at run scope, e.g. ooxml.js's own runRangeMarkerExtents) has no representable EPUB spelling this reader's own read side understands yet, so it is reported through the diagnostic sink rather than silently dropped with nothing in the output naming it ever happened. The run text it wraps is unaffected either way — only the anchor's own marker goes unwritten.
  it.each(["bookmark", "endnote", "comment"] as const)(
    "reports CONSTRUCT_UNREPRESENTED for a run-level '%s' anchor extent, preserving the run text underneath it",
    (anchorType) => {
      const blocks: ContentBlock[] = [
        {
          kind: "paragraph",
          runs: [{ text: "marked" }],
          constructs: [
            {
              descriptor: { kind: "anchor", anchorType, name: "x1" },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ];
      const { xml, diagnostics } = writeWithSink(blocks, () => undefined);
      expect(xml).toContain("marked");
      expect(xml).not.toContain('href="#x1"');
      const diagnostic = diagnostics.find(
        (d) => d.code === EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      );
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.message).toContain(anchorType);
    },
  );

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

  it("writes an image with no altText as an empty alt attribute, never a placeholder", () => {
    const xml = write([
      {
        kind: "image",
        format: "png",
        base64: "aGVsbG8=",
        widthPt: 72,
        heightPt: 72,
      },
    ]);
    expect(xml).toContain('alt=""');
  });
});

describe("assertNeverLeafBlock", () => {
  it("throws naming the unhandled leaf block, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverLeafBlock({ kind: "bogus" } as never);
    }).toThrow('epub-codec: unhandled leaf block {"kind":"bogus"}');
  });
});
