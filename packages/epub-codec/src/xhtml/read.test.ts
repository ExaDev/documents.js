import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic, EpubDiagnosticSink } from "../diagnostics";
import { scanXhtmlAnchors } from "./read-block-helpers";
import { readXhtmlBody } from "./read";

const CONTENT_WIDTH_PT = 451.28; // A4 minus 1in margins each side, matching src/read.ts's own default section geometry

// The first four bytes of a GIF signature ("GIF8", common to both GIF87a and GIF89a): neither PNG nor JPEG, so detectImageFormat rejects it, exactly what these fixtures test for.

function body(inner: string, attrs = ""): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"${attrs}><body>${inner}</body></html>`;
}

function read(
  xml: string,
  sink: (d: EpubDiagnostic) => void = () => undefined,
) {
  return readXhtmlBody(xml, {
    resolveImage: () => undefined,
    sink,
    sourceHref: "chapter1.xhtml",
    contentWidthPt: CONTENT_WIDTH_PT,
  }).blocks;
}

describe("headings", () => {
  it("maps h1-h6 to a paragraph with the matching headingLevel", () => {
    const blocks = read(body("<h1>One</h1><h6>Six</h6>"));
    expect(blocks).toEqual([
      { kind: "paragraph", headingLevel: 1, runs: [{ text: "One" }] },
      { kind: "paragraph", headingLevel: 6, runs: [{ text: "Six" }] },
    ]);
  });

  it("degrades a heading's own direct-child <img> to alt text with a diagnostic, same as one reached via inline nesting", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body('<h2>Title <img src="a.png" alt="pic"/></h2>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        headingLevel: 2,
        runs: [{ text: "Title " }, { text: "pic" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-inline-unsupported" }),
    );
  });

  it("keeps a footnote reference construct carried by a heading's own inline content, rather than discarding it", () => {
    const blocks = read(
      body(
        '<h2>Title<a epub:type="noteref" href="#fn1">1</a></h2>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      headingLevel: 2,
      runs: [{ text: "Title" }, { text: "1" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });
});

describe("paragraphs and inline styling", () => {
  it("maps strong/em/code/u/s to their ContentRun fields", () => {
    const blocks = read(
      body(
        "<p><strong>bold</strong> <em>italic</em> <code>mono</code> <u>under</u> <s>strike</s></p>",
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "bold", bold: true },
          { text: " " },
          { text: "italic", italic: true },
          { text: " " },
          { text: "mono", fontFamily: "Courier New" },
          { text: " " },
          { text: "under", underline: true },
          { text: " " },
          { text: "strike", strike: true },
        ],
      },
    ]);
  });

  it("composes nested emphasis", () => {
    const blocks = read(body("<p><strong><em>both</em></strong></p>"));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "both", bold: true, italic: true }],
      },
    ]);
  });

  it("normalises internal whitespace to single spaces", () => {
    const blocks = read(body("<p>a   b\n  c</p>"));
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "a b c" }] }]);
  });

  it("maps <sub>/<sup> onto ContentRun.verticalAlign, composing with nested emphasis like the other inline styles", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body("<p>x<sup>2</sup> and <strong>H<sub>2</sub>O</strong></p>"),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "x" },
          { text: "2", verticalAlign: "superscript" },
          { text: " and " },
          { text: "H", bold: true },
          { text: "2", bold: true, verticalAlign: "subscript" },
          { text: "O", bold: true },
        ],
      },
    ]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("maps an inline dir attribute onto ContentRun.direction, leaving an unmarked sibling run unstated", () => {
    const blocks = read(
      body('<p>plain <span dir="rtl">rtl words</span> after</p>'),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "plain " },
          { text: "rtl words", direction: "rtl" },
          { text: " after" },
        ],
      },
    ]);
  });

  it("maps <br> to a run holding a literal newline", () => {
    const blocks = read(body("<p>a<br/>b</p>"));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }, { text: "\n" }, { text: "b" }],
      },
    ]);
  });

  // ExaDev/documents.js#994's round-8 systemic gap: every text-bearing walk in this package used to dispatch on node.type === "text" alone, silently dropping a CDATA section — the standard idiom a producer reaches for when its own literal text needs a raw `<`/`&` it would otherwise have to escape. xml/node.ts's isTextLikeNode is now the one shared predicate buildInlineRuns itself dispatches on.
  it("reads a CDATA section exactly like an ordinary text node, including its own literal < and &", () => {
    const blocks = read(body("<p>before <![CDATA[A & B < C]]> after</p>"));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "before " }, { text: "A & B < C" }, { text: " after" }],
      },
    ]);
  });
});

describe("hyperlinks", () => {
  it("stores an external href verbatim on ContentRun.hyperlink", () => {
    const blocks = read(body('<p><a href="https://example.com">site</a></p>'));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "site", hyperlink: "https://example.com" }],
      },
    ]);
  });

  it("stores a cross-document href verbatim, with a diagnostic", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(body('<p><a href="chapter2.xhtml">next</a></p>'), sink);
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "next", hyperlink: "chapter2.xhtml" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/link-target-external-only" }),
    );
  });
});

describe("scanXhtmlAnchors", () => {
  it("finds an id-bearing element at any depth, not just a direct child of <body>", () => {
    const xml = body('<div><section><p id="deep">text</p></section></div>');
    const scan = scanXhtmlAnchors(xml);
    expect(scan.idElements.has("deep")).toBe(true);
  });

  it("collects only real <a href> elements, never a same-tagged href-less <a> nor an unrelated element that merely carries an href attribute", () => {
    const xml = body(
      '<div href="#bogus">not a link</div><a>no href</a><a href="#target">real link</a>',
    );
    const scan = scanXhtmlAnchors(xml);
    expect(scan.anchors).toHaveLength(1);
  });
});

describe("blockquote", () => {
  it("wraps blocks in a division construct with Quote styling", () => {
    const blocks = read(body("<blockquote><p>quoted</p></blockquote>"));
    expect(blocks).toEqual([
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

  it("doubles the indent for a nested blockquote", () => {
    const blocks = read(
      body("<blockquote><blockquote><p>deep</p></blockquote></blockquote>"),
    );
    const paragraph = blocks.find((b) => b.kind === "paragraph");
    expect(paragraph).toMatchObject({ indentLeftPt: 72 });
  });

  it("adds a <dd>'s own extra indent to (not in place of) the blockquote's own quote indent", () => {
    // Distinguishes the two contributions being summed (the correct behaviour) from being subtracted or otherwise combined — a quote depth of 1 (36pt) plus one dd's own DEFINITION_BODY_INDENT_PT (36pt) must read back as 72pt, not 0pt.
    const blocks = read(
      body("<blockquote><dl><dd>text</dd></dl></blockquote>"),
    );
    const paragraph = blocks.find((b) => b.kind === "paragraph");
    expect(paragraph).toMatchObject({ indentLeftPt: 72 });
  });

  it("degrades to indent-only structure when a heading is nested arbitrarily deep, not only a direct child", () => {
    const blocks = read(
      body("<blockquote><div><h2>Heading</h2></div></blockquote>"),
    );
    expect(blocks.some((b) => b.kind === "constructStart")).toBe(false);
  });

  it("degrades to indent-only structure (no division pair) when a heading is inside", () => {
    const blocks = read(body("<blockquote><h2>Heading</h2></blockquote>"));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        headingLevel: 2,
        runs: [{ text: "Heading" }],
        indentLeftPt: 36,
        styleId: "Quote",
      },
    ]);
  });
});

describe("pre / code blocks", () => {
  it("keeps verbatim text and reads a language- class", () => {
    const blocks = read(
      body(
        '<pre><code class="language-js">const x = 1;\nconsole.log(x);</code></pre>',
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [
          { text: "const x = 1;\nconsole.log(x);", fontFamily: "Courier New" },
        ],
        preformatted: true,
        codeLanguage: "js",
      },
    ]);
  });

  it("carries no codeLanguage key at all when the <code> has no language- class", () => {
    const blocks = read(body("<pre><code>plain</code></pre>"));
    expect(Object.hasOwn(blocks[0] as object, "codeLanguage")).toBe(false);
  });

  it("requires language- to sit at the very start of the class, or right after whitespace, not merely somewhere in it", () => {
    // "xlanguage-js" has no whitespace (nor the class's own start) immediately before "language-", so this must NOT be read as a language- token the way "language-js" or "foo language-js" would be.
    const blocks = read(
      body('<pre><code class="xlanguage-js">code</code></pre>'),
    );
    expect(Object.hasOwn(blocks[0] as object, "codeLanguage")).toBe(false);
  });

  it("produces no runs at all for a genuinely empty <pre>", () => {
    const blocks = read(body("<pre></pre>"));
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [], preformatted: true },
    ]);
  });

  it("does not treat an ordinary, non-footnote <a> as a footnote reference, keeping the pre on its flat single-run path", () => {
    const blocks = read(
      body('<pre>before<a href="https://example.com">link</a>after</pre>'),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "beforelinkafter", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
  });

  it("names the <img>'s own src in its degrade diagnostic when one is present", () => {
    let diagnostic: EpubDiagnostic | undefined;
    read(body('<pre><img src="pic.png" alt="text"/></pre>'), (d) => {
      diagnostic = d;
    });
    expect(diagnostic?.message).toContain('<img src="pic.png">');
  });

  it("states the exact generic <img> label and full degrade message when the <img> has no src at all", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    read(body('<pre><img alt="text"/></pre>'), sink);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "<img> inside a <pre>/<code> block cannot become a real image block (this package reads a <pre> as a single text-content paragraph, so there is no block list to insert an image block into); degraded to its alt text",
      }),
    );
  });

  it("splices an <img>'s alt text into the extracted text with a diagnostic, instead of vanishing", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body('<pre>code <img src="a.png" alt="pic"/> more</pre>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "code pic more", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-pre-unsupported" }),
    );
  });

  it("reaches an <img> nested a level deeper, inside <code>", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body('<pre><code>x<img src="a.png"/>y</code></pre>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "xy", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-pre-unsupported" }),
    );
  });

  // readPreText is its own separate recursive walk over a <pre>'s children, not a call into src/xhtml/inline.ts's appendElement — so the script/template guard that file's own comment calls "universal" needed its own identical guard here too, since <script>/<template> are both legal children of <pre> per the HTML content model and neither's content is ever legitimate document text.
  it("skips a <script>'s raw source when it sits directly inside a <pre>, never leaking it into the extracted text", () => {
    const blocks = read(
      body("<pre>before<script>var x = 1;</script>after</pre>"),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "beforeafter", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
  });

  it("skips a <template>'s inert content when it sits directly inside a <pre>'s own <code>", () => {
    const blocks = read(
      body(
        "<pre><code>before<template><li>fake</li></template>after</code></pre>",
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "beforeafter", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
  });

  it("skips a <noscript>'s fallback markup when it sits directly inside a <pre>, but reports the drop unlike script/template", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body("<pre>before<noscript>Enable JS</noscript>after</pre>"),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "beforeafter", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/noscript-content-skipped" }),
    );
  });

  it("skips a <noscript>'s fallback markup when it sits inside a <pre> that also carries a footnote reference (readPreRuns' own run-splitting path), but reports the drop", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    read(
      body(
        '<pre>before<noscript>Enable JS</noscript><a epub:type="noteref" href="#fn1">1</a></pre>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
      sink,
    );
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/noscript-content-skipped" }),
    );
  });

  it("keeps a footnote reference construct carried by inline content inside a <pre>, rather than discarding it silently", () => {
    const blocks = read(
      body(
        '<pre>see<a epub:type="noteref" href="#fn1">1</a></pre>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "see", fontFamily: "Courier New" },
        { text: "1", fontFamily: "Courier New" },
      ],
      preformatted: true,
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });

  it("never treats a non-<a> wrapper's own href as a footnote reference, even when that same fragment is a real footnote elsewhere", () => {
    // The wrapping <span> here is not itself a footnote-reference <a>, but happens to carry an href pointing at the same #fn2 fragment a real <a epub:type="noteref"> elsewhere in the document already registers as a footnote target. Only the genuinely nested <a href="#fn1"> should produce a construct; the span's own href must never be mistaken for a second one.
    const blocks = read(
      body(
        '<p>See<a epub:type="noteref" href="#fn1">1</a>. Also<a epub:type="noteref" href="#fn2">2</a>.</p>' +
          '<pre><span href="#fn2"><a epub:type="noteref" href="#fn1">ref</a></span></pre>' +
          '<aside epub:type="footnote" id="fn1"><p>Note one.</p></aside>' +
          '<aside epub:type="footnote" id="fn2"><p>Note two.</p></aside>',
      ),
    );
    const pre = blocks.find(
      (b) => b.kind === "paragraph" && b.preformatted === true,
    );
    if (pre === undefined) {
      throw new Error("expected a preformatted paragraph block");
    }
    expect(pre).toEqual({
      kind: "paragraph",
      runs: [{ text: "ref", fontFamily: "Courier New" }],
      preformatted: true,
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 0,
          endRun: 1,
        },
      ],
    });
  });

  it("maps a <br> inside a <pre> to a literal newline rather than dropping the line break", () => {
    const blocks = read(body("<pre>line1<br/>line2</pre>"));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "line1\nline2", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
  });

  it("maps a <br> inside a <pre> to a literal newline even when the block also carries a footnote reference, taking the run-splitting readPreRuns path", () => {
    const blocks = read(
      body(
        '<pre>line1<br/>line2<a epub:type="noteref" href="#fn1">1</a></pre>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "line1\nline2", fontFamily: "Courier New" },
        { text: "1", fontFamily: "Courier New" },
      ],
      preformatted: true,
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });

  it("preserves a CDATA section's own literal content inside a <pre>, rather than silently dropping it", () => {
    const blocks = read(body("<pre><![CDATA[a & b < c]]></pre>"));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a & b < c", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
  });

  it("keeps a footnote reference construct nested inside a wrapping element inside a <pre>, and leaves surrounding non-footnote text merged into its own run", () => {
    const blocks = read(
      body(
        '<pre>before <span>middle</span> see<a epub:type="noteref" href="#fn1">1</a> after</pre>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "before middle see", fontFamily: "Courier New" },
        { text: "1", fontFamily: "Courier New" },
        { text: " after", fontFamily: "Courier New" },
      ],
      preformatted: true,
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });

  it("splices an <img>'s alt text into the run-splitting readPreRuns path too, when the same <pre> also carries a real footnote reference", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body(
        '<pre><img src="a.png" alt="pic"/><a epub:type="noteref" href="#fn1">1</a></pre>' +
          '<aside epub:type="footnote" id="fn1"><p>Note.</p></aside>',
      ),
      sink,
    );
    const preParagraph = blocks.find(
      (b) => b.kind === "paragraph" && b.preformatted === true,
    );
    expect(preParagraph).toEqual({
      kind: "paragraph",
      runs: [
        { text: "pic", fontFamily: "Courier New" },
        { text: "1", fontFamily: "Courier New" },
      ],
      preformatted: true,
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-pre-unsupported" }),
    );
  });

  it("only wraps the actual <a> footnote reference in a construct, not a same-href-resolving <span> sitting alongside it in the run-splitting readPreRuns path", () => {
    const blocks = read(
      body(
        '<pre>before<span href="#fn1">mid</span><a epub:type="noteref" href="#fn1">1</a>after</pre>' +
          '<aside epub:type="footnote" id="fn1"><p>Note.</p></aside>',
      ),
    );
    const preParagraph = blocks.find(
      (b) => b.kind === "paragraph" && b.preformatted === true,
    );
    expect(preParagraph).toEqual({
      kind: "paragraph",
      runs: [
        { text: "beforemid", fontFamily: "Courier New" },
        { text: "1", fontFamily: "Courier New" },
        { text: "after", fontFamily: "Courier New" },
      ],
      preformatted: true,
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });

  it("does not mistake a non-<a> element's own href for a footnote reference, even when that href happens to resolve to a real footnote target elsewhere in the document", () => {
    // Only a genuine <a> can carry a footnote reference (preFootnoteReferenceName/containsFootnoteReference both gate on node.tag === "a" before ever checking where the href resolves) — a <span href> pointing at the identical fragment must still take the flat, single-run readPreFlatRuns path, not the run-splitting readPreRuns path a real footnote reference would trigger.
    const blocks = read(
      body(
        '<p><a epub:type="noteref" href="#fn1">1</a></p>' +
          '<aside epub:type="footnote" id="fn1"><p>Note.</p></aside>' +
          '<pre>before<span href="#fn1">mid</span>after</pre>',
      ),
    );
    const preParagraph = blocks.find(
      (b) => b.kind === "paragraph" && b.preformatted === true,
    );
    expect(preParagraph).toEqual({
      kind: "paragraph",
      runs: [{ text: "beforemidafter", fontFamily: "Courier New" }],
      preformatted: true,
    });
  });
});

describe("hr", () => {
  it("maps to an empty-runs paragraph with the HorizontalRule styleId", () => {
    expect(read(body("<hr/>"))).toEqual([
      { kind: "paragraph", runs: [], styleId: "HorizontalRule" },
    ]);
  });
});

describe("readContainerChildren's own segment flush", () => {
  it("keeps a construct-only segment sitting bare between two block siblings, rather than dropping it as an empty segment", () => {
    const blocks = read(
      body(
        '<p>Before</p><a epub:type="noteref" href="#fn1"></a><p>After</p>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Before" }],
    });
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      runs: [],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 0,
          endRun: 0,
        },
      ],
    });
    expect(blocks[2]).toEqual({ kind: "paragraph", runs: [{ text: "After" }] });
  });
});
