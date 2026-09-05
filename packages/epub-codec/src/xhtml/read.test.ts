import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic } from "../diagnostics";
import { readXhtmlBody } from "./read";

const CONTENT_WIDTH_PT = 451.28; // A4 minus 1in margins each side, matching src/read.ts's own default section geometry

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
    const sink = vi.fn();
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

  it("degrades sub/sup to plain text with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<p>x<sup>2</sup></p>"), sink);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "x" }, { text: "2" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/element-unmapped" }),
    );
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
    const sink = vi.fn();
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

describe("lists", () => {
  it("maps a simple unordered list", () => {
    const blocks = read(body("<ul><li>a</li><li>b</li></ul>"));
    expect(blocks).toEqual([
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
    ]);
  });

  it("increments level for a nested list, sharing the outer numId", () => {
    const blocks = read(body("<ul><li>a<ul><li>a1</li></ul></li></ul>"));
    expect(blocks).toEqual([
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
    ]);
  });

  it("mints a fresh numId for each separate top-level list", () => {
    const blocks = read(body("<ul><li>a</li></ul><ul><li>b</li></ul>"));
    expect(blocks[0]).toMatchObject({ list: { numId: "epub1:bullet" } });
    expect(blocks[1]).toMatchObject({ list: { numId: "epub2:bullet" } });
  });

  it("encodes an <ol> and its start attribute into the minted numId", () => {
    const blocks = read(body('<ol start="3"><li>a</li></ol>'));
    expect(blocks[0]).toMatchObject({ list: { numId: "epub1:ordered@3" } });
  });

  it("recovers a <ul> nested directly as a sibling of <li> rather than inside one, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<ul><li>a</li><ul><li>b</li></ul></ul>"), sink);
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "epub1:bullet", level: 1, itemId: "item2" },
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("recovers a stray <img> sitting directly inside a <ul> as a continuation of the preceding <li>", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<ul><li>a</li><img src="a.png" alt="ulpic"/></ul>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "ulpic" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-unresolved" }),
    );
  });

  it("drops content that sits before the very first <li>, unchanged from prior behaviour", () => {
    const blocks = read(body("<ul>stray<li>a</li></ul>"));
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ]);
  });

  it("ignores inter-element whitespace between <li> siblings, firing no diagnostic, for the pretty-printed shape essentially all real-world HTML uses", () => {
    const sink = vi.fn();
    const blocks = read(body("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>"), sink);
    expect(blocks).toEqual([
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
    ]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("ignores inter-element whitespace across a multi-item indented <ol>, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<ol>\n  <li>a</li>\n  <li>b</li>\n  <li>c</li>\n</ol>"),
      sink,
    );
    expect(blocks.map((b) => (b as { runs: { text: string }[] }).runs)).toEqual(
      [[{ text: "a" }], [{ text: "b" }], [{ text: "c" }]],
    );
    expect(sink).not.toHaveBeenCalled();
  });

  it("skips a <script> script-supporting element sitting directly inside a <ul> entirely, never leaking it into content", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<ul><li>a</li><script>var x = 1;</script><li>b</li></ul>"),
      sink,
    );
    expect(blocks).toEqual([
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
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("skips a <template> script-supporting element sitting directly inside an <ol> entirely", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<ol><li>a</li><template><li>fake</li></template><li>b</li></ol>"),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:ordered", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "epub1:ordered", level: 0, itemId: "item2" },
      },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("preserves a genuine inter-element space between two stray inline siblings rather than joining them", () => {
    const blocks = read(
      body("<ul><li>a</li><span>foo</span> <span>bar</span></ul>"),
    );
    expect(blocks).toHaveLength(2);
    const strayParagraph = blocks[1] as { runs: { text: string }[] };
    expect(strayParagraph.runs.map((run) => run.text).join("")).toBe("foo bar");
  });

  it("never leaks a <script>'s raw source as document text even when nested inside a stray wrapper the list-recovery path recurses into", () => {
    const blocks = read(
      body("<ul><li>a</li><div><script>var x=1;</script></div></ul>"),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ]);
  });

  // Regression coverage for the emptiness-probe defect: flushListStrayContent used to decide whether to recover its collected stray nodes by building their inline runs (buildInlineRuns, which only ever produces TEXT) and checking whether that text was blank -- so any stray block-level content whose text projection happens to be empty (a resolved image with no alt text, an <hr>, a table or nested list whose only content is such an image) was misjudged as "whitespace-only" and silently dropped, with no diagnostic, exactly like real pretty-printed whitespace. The fix asks the real question instead: does readContainerChildren's own result carry any blocks at all. Each case below recovers a resolved image inline PNG (fakePng, defined further down this file -- a function declaration, hoisted) so the stray content's own text projection is genuinely empty while its block projection is not.
  it("recovers a stray, resolved <img> with no alt attribute as a real image block, not judging it whitespace-only by its absent text projection", () => {
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body('<ul><li>a</li><img src="a.png"/></ul>'),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ kind: "image" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it('recovers a stray, resolved <img alt=""> as a real image block', () => {
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body('<ul><li>a</li><img src="a.png" alt=""/></ul>'),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ kind: "image" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("recovers a nested <ul> stray sibling whose only <li> content is a resolved image with no text -- issue #994's own headline shape, which the emptiness-probe regression defeated", () => {
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body('<ul><li>a</li><ul><li><img src="a.png" alt=""/></li></ul></ul>'),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: "paragraph",
      list: { numId: "epub1:bullet", level: 0 },
    });
    expect(blocks[1]).toMatchObject({ kind: "image" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("recovers a stray <hr/> sitting directly inside a <ul> as a real paragraph block, not empty-runs judged whitespace-only", () => {
    const sink = vi.fn();
    const blocks = read(body("<ul><li>a</li><hr/></ul>"), sink);
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [],
        styleId: "HorizontalRule",
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("recovers a stray <table> whose only cell content is a resolved image with no alt text -- readTable always yields a real table block regardless of its cells' own text", () => {
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body(
        '<ul><li>a</li><table><tr><td><img src="a.png" alt=""/></td></tr></table></ul>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ kind: "table" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it.each([
    ["figure", '<figure><img src="a.png" alt=""/></figure>', 2],
    ["p", '<p><img src="a.png" alt=""/></p>', 2],
    ["blockquote", '<blockquote><img src="a.png" alt=""/></blockquote>', 4], // division constructStart + image + constructEnd, plus the preceding <li>'s own paragraph
  ] as const)(
    "recovers a stray <%s> wrapping only a resolved, alt-less image",
    (_tag, fragment, expectedBlockCount) => {
      const bytes = fakePng(96, 96);
      const sink = vi.fn();
      const { blocks } = readXhtmlBody(body(`<ul><li>a</li>${fragment}</ul>`), {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      });
      expect(blocks).toHaveLength(expectedBlockCount);
      expect(blocks.some((block) => block.kind === "image")).toBe(true);
      expect(sink).toHaveBeenCalledWith(
        expect.objectContaining({ code: "epub/list-content-outside-item" }),
      );
    },
  );
});

describe("script-supporting elements outside lists", () => {
  it("never leaks a <script>'s raw source as document text when it sits directly inside a <p>", () => {
    const blocks = read(body("<p>before<script>var x=1;</script>after</p>"));
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before" }, { text: "after" }] },
    ]);
  });

  it("never leaks a <template>'s inert content as document text when it sits directly inside a table cell", () => {
    const blocks = read(
      body(
        "<table><tr><td>before<template><li>fake</li></template>after</td></tr></table>",
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [
                  {
                    kind: "paragraph",
                    runs: [{ text: "before" }, { text: "after" }],
                  },
                ],
              },
            ],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
  });
});

describe("definition lists", () => {
  it("maps dt to a plain paragraph and dd to an indented one", () => {
    const blocks = read(body("<dl><dt>Term</dt><dd>Definition</dd></dl>"));
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
  });

  it("degrades a dt's own direct-child <img> to alt text with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        '<dl><dt>Term <img src="a.png" alt="term pic"/></dt><dd>Definition</dd></dl>',
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term " }, { text: "term pic" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-inline-unsupported" }),
    );
  });

  it("degrades a dd's own direct-child <img> to alt text with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        '<dl><dt>Term</dt><dd>Definition <img src="a.png" alt="def pic"/></dd></dl>',
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      {
        kind: "paragraph",
        runs: [{ text: "Definition " }, { text: "def pic" }],
        indentLeftPt: 36,
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-inline-unsupported" }),
    );
  });

  it("recurses into a <div> wrapping a dt/dd pair, a legal HTML5 per-entry styling hook", () => {
    const blocks = read(
      body("<dl><div><dt>Term</dt><dd>Definition</dd></div></dl>"),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
  });

  it("recurses into several <div>-wrapped groups in sequence", () => {
    const blocks = read(
      body(
        "<dl><div><dt>A</dt><dd>a</dd></div><div><dt>B</dt><dd>b</dd></div></dl>",
      ),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "A" }] },
      { kind: "paragraph", runs: [{ text: "a" }], indentLeftPt: 36 },
      { kind: "paragraph", runs: [{ text: "B" }] },
      { kind: "paragraph", runs: [{ text: "b" }], indentLeftPt: 36 },
    ]);
  });
});

describe("tables", () => {
  it("maps rows/cells, with th cells bold and colspan/rowspan honoured", () => {
    const blocks = read(
      body(
        '<table><tr><th>H1</th><th>H2</th></tr><tr><td colspan="2">wide</td></tr></table>',
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [
                  { kind: "paragraph", runs: [{ text: "H1", bold: true }] },
                ],
              },
              {
                blocks: [
                  { kind: "paragraph", runs: [{ text: "H2", bold: true }] },
                ],
              },
            ],
          },
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
                colSpan: 2,
              },
            ],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT / 2, CONTENT_WIDTH_PT / 2],
      },
    ]);
  });

  it("reads rows nested inside thead/tbody", () => {
    const blocks = read(
      body(
        "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>",
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [
                  { kind: "paragraph", runs: [{ text: "H", bold: true }] },
                ],
              },
            ],
          },
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "d" }] }] }],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
  });

  it("degrades a table cell's own direct-child <img> to alt text with a diagnostic, rather than treating it as a schema limitation", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        '<table><tr><td><img src="a.png" alt="cell pic"/></td></tr></table>',
      ),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "cell pic" }] }],
              },
            ],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-inline-unsupported" }),
    );
  });

  it("reads a <caption> as a paragraph before the table, with a diagnostic, instead of dropping it", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        '<table><caption>Cap <img src="a.png" alt="cappic"/></caption><tr><td>cell</td></tr></table>',
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Cap " }, { text: "cappic" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
            ],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-caption-unsupported" }),
    );
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-inline-unsupported" }),
    );
  });

  it("drops an empty <caption> entirely, firing no diagnostic, matching the package's own empty-paragraph-drop rule", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<table><caption></caption><tr><td>x</td></tr></table>"),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-caption-unsupported" }),
    );
  });

  it("drops a whitespace-only <caption> entirely, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<table><caption>   </caption><tr><td>x</td></tr></table>"),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columnWidthsPt: [CONTENT_WIDTH_PT],
      },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-caption-unsupported" }),
    );
  });

  it("keeps a footnote reference construct carried by a <caption>'s own inline content, rather than discarding it", () => {
    const blocks = read(
      body(
        '<table><caption>Cap<a epub:type="noteref" href="#fn1">1</a></caption><tr><td>x</td></tr></table>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Cap" }, { text: "1" }],
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
        codeLanguage: "js",
      },
    ]);
  });

  it("splices an <img>'s alt text into the extracted text with a diagnostic, instead of vanishing", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<pre>code <img src="a.png" alt="pic"/> more</pre>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "code pic more", fontFamily: "Courier New" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-pre-unsupported" }),
    );
  });

  it("reaches an <img> nested a level deeper, inside <code>", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<pre><code>x<img src="a.png"/>y</code></pre>'),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "xy", fontFamily: "Courier New" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-pre-unsupported" }),
    );
  });
});

describe("hr", () => {
  it("maps to an empty-runs paragraph with the HorizontalRule styleId", () => {
    expect(read(body("<hr/>"))).toEqual([
      { kind: "paragraph", runs: [], styleId: "HorizontalRule" },
    ]);
  });
});

// A minimal PNG carrying only what src/image/dimensions.ts reads: the 8-byte signature plus an IHDR chunk.
function fakePng(widthPx: number, heightPx: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

describe("images", () => {
  it("resolves a manifest image to base64 with pt dimensions derived from its pixel size", () => {
    const bytes = fakePng(96, 192);
    const { blocks } = readXhtmlBody(
      body('<p><img src="a.png" alt="a picture"/></p>'),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    const [block] = blocks;
    expect(block?.kind).toBe("image");
    if (block?.kind === "image") {
      expect(typeof block.base64).toBe("string");
      expect(block.base64.length).toBeGreaterThan(0);
      expect({ ...block, base64: undefined }).toEqual({
        kind: "image",
        format: "png",
        base64: undefined,
        widthPt: 72, // 96px * 72/96
        heightPt: 144,
        altText: "a picture",
      });
    }
  });

  it("degrades to alt text with a diagnostic when the manifest has no such part", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<img src="missing.png" alt="fallback text"/>'),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "fallback text" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-unresolved" }),
    );
  });

  it("degrades to alt text with a diagnostic for a resolved but unsupported format", () => {
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(body('<img src="a.gif" alt="a gif"/>'), {
      resolveImage: () => new Uint8Array([0x47, 0x49, 0x46, 0x38]),
      sink,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "a gif" }] }]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-format-unsupported" }),
    );
  });

  it("degrades an <img> nested inside a <span> to its alt text with a diagnostic, instead of vanishing", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<p>before <span><img src="a.png" alt="nested"/></span> after</p>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "before " }, { text: "nested" }, { text: " after" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-inline-unsupported",
      }),
    );
  });

  it("degrades an <img> nested inside an <a> to its alt text, carrying the same hyperlink", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        '<p><a href="https://example.com"><img src="a.png" alt="linked"/></a></p>',
      ),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "linked", hyperlink: "https://example.com" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-inline-unsupported",
      }),
    );
  });

  it("produces no run but still diagnoses an <img> nested inline with no alt text", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<p>before <span><img src="a.png"/></span> after</p>'),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before " }, { text: " after" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-inline-unsupported",
      }),
    );
  });

  it("does not fabricate a src attribute in the diagnostic message for a nested <img> with no src at all", () => {
    let diagnostic: EpubDiagnostic | undefined;
    read(body('<p><span><img alt="no src at all"/></span></p>'), (d) => {
      diagnostic = d;
    });
    expect(diagnostic?.code).toBe("epub/image-inline-unsupported");
    expect(diagnostic?.message).toContain("<img> is reached");
    expect(diagnostic?.message).not.toContain('src=""');
  });
});

describe("figure/figcaption", () => {
  it("reads the caption as a plain paragraph following the image", () => {
    const bytes = new Uint8Array([1]);
    const { blocks } = readXhtmlBody(
      body(
        '<figure><img src="a.png" alt="alt text"/><figcaption>Caption text</figcaption></figure>',
      ),
      {
        resolveImage: () => bytes,
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    // The fake single-byte image is neither a real PNG nor JPEG, so it degrades to its alt text -- this test is about figure/figcaption structure, not image decoding (covered separately).
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "alt text" }] },
      { kind: "paragraph", runs: [{ text: "Caption text" }] },
    ]);
  });

  it("degrades a figcaption's own direct-child <img> to alt text with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        '<figure><figcaption>Caption <img src="a.png" alt="inline pic"/></figcaption></figure>',
      ),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "Caption " }, { text: "inline pic" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-inline-unsupported" }),
    );
  });
});

describe("div/section passthrough", () => {
  it("reads a div's children transparently", () => {
    const blocks = read(body("<div><p>inside</p></div>"));
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "inside" }] }]);
  });
});

describe("footnotes: EPUB 3 aside + noteref", () => {
  it("wraps the aside body in a footnote anchor construct and marks the reference site", () => {
    const blocks = read(
      body(
        '<p>See<a epub:type="noteref" href="#fn1">1</a>.</p>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks).toEqual([
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
    ]);
  });
});

describe("footnotes: EPUB 2 linked-anchor idiom", () => {
  it("recognises a class=footnote reference/target pair with no epub:type at all", () => {
    const blocks = read(
      body(
        '<p>See<a class="footnote" href="#note1">1</a>.</p>' +
          '<p id="note1">Note body.</p>',
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "See" }, { text: "1" }, { text: "." }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "footnote",
              name: "note1",
            },
            startRun: 1,
            endRun: 2,
          },
        ],
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "footnote", name: "note1" },
      },
      { kind: "paragraph", runs: [{ text: "Note body." }] },
      { kind: "constructEnd" },
    ]);
  });

  it("recognises the target-side class convention alone (reference carries no class)", () => {
    const blocks = read(
      body(
        '<p>See<a href="#note1">1</a>.</p>' +
          '<p id="note1" class="footnote">Note body.</p>',
      ),
    );
    expect(blocks[1]).toEqual({
      kind: "constructStart",
      descriptor: { kind: "anchor", anchorType: "footnote", name: "note1" },
    });
  });
});
