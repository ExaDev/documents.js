import type { ContentTableCell, ContentTableRow } from "document-schema.js";
import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic } from "../diagnostics";
import { readXhtmlBody, scanXhtmlAnchors } from "./read";

const CONTENT_WIDTH_PT = 451.28; // A4 minus 1in margins each side, matching src/read.ts's own default section geometry

function body(inner: string, attrs = ""): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"${attrs}><body>${inner}</body></html>`;
}

// One compact descriptor per cell, so a test can state a whole grid at a glance: the cell's own text, then `|cN` / `|rN` for a colSpan / rowSpan; a covered entry holds no blocks and so reads as the empty string.
function describeCell(cell: ContentTableCell): string {
  const text = cell.blocks
    .flatMap((block) =>
      block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
    )
    .join("");
  const colSpan = cell.colSpan === undefined ? "" : `|c${String(cell.colSpan)}`;
  const rowSpan = cell.rowSpan === undefined ? "" : `|r${String(cell.rowSpan)}`;
  return `${text}${colSpan}${rowSpan}`;
}

function readTableGrid(html: string): {
  grid: string[][];
  columnWidthsPt: number[];
  rows: ContentTableRow[];
} {
  const table = read(body(html)).find((b) => b.kind === "table");
  if (table === undefined) {
    throw new Error("expected a table block");
  }
  return {
    grid: table.rows.map((row) => row.cells.map(describeCell)),
    columnWidthsPt: table.columns.map((column) => column.widthPt),
    rows: table.rows,
  };
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
    const sink = vi.fn();
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
      expect.objectContaining({
        code: "epub/list-content-outside-item",
        message:
          "content sits directly inside a <ul> rather than inside an <li> (not valid HTML5); recovered as a continuation of the preceding <li>'s own content",
      }),
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

  it("recovers stray text that sits before the very first <li>, with no list membership of its own, positioned immediately before the list's own items", () => {
    const sink = vi.fn();
    const blocks = read(body("<ul>stray<li>a</li></ul>"), sink);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/list-content-outside-item",
        message:
          "content sits directly inside a <ul> before its first <li> (not valid HTML5); recovered as ordinary content immediately before the list, inheriting whatever list membership its own enclosing context already carries (none, unless this <ul> is itself nested inside another list's <li>)",
      }),
    );
  });

  it("recovers a <ul> nested directly before the very first <li> as its own separate top-level list, rather than losing it — issue #994's own headline repro", () => {
    const sink = vi.fn();
    const blocks = read(body("<ul><ul><li>b</li></ul><li>a</li></ul>"), sink);
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "epub2:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item2" },
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("mints a numId for a nested empty <ul> that is itself discarded as stray content, skipping a value in the outer numbering sequence — cosmetic, since a numId is opaque", () => {
    const blocks = read(
      body("<ul><ul></ul><li>a</li></ul><ul><li>b</li></ul>"),
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
        list: { numId: "epub3:bullet", level: 0, itemId: "item2" },
      },
    ]);
  });

  it("fires only the stray image's own diagnostic, not an additional list-content-outside-item, when the stray content resolves to zero blocks", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<ul><li>a</li><img src="missing.png"/></ul>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/image-unresolved" }),
    );
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });

  it("mints item ids and fires diagnostics in document order, never for a recovered read whose result is then discarded", () => {
    const sink = vi.fn<(d: EpubDiagnostic) => void>();
    const blocks = read(
      body('<ul><img src="before.png" alt="before"/><li>a</li><li>b</li></ul>'),
      sink,
    );
    // "before" carries no list membership (recovered ahead of the first real <li>); "a" and "b" are item1/item2 in document order, with no gap — an itemId is minted only for a genuine <li>, and this discarded stray content contains none (contrast a discarded stray *list* with no <li> of its own, which mints and then discards a numId; see flushListStrayContent's own comment).
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before" }] },
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
    const outsideItemCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/list-content-outside-item",
    );
    expect(outsideItemCalls).toHaveLength(1);
  });

  it("still drops genuinely whitespace-only content before the very first <li>, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<ul>\n  <li>a</li>\n</ul>"), sink);
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
    ]);
    expect(sink).not.toHaveBeenCalled();
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

  it("skips a <noscript> sitting directly inside a <ul> entirely, but reports the drop unlike script/template", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<ul><li>a</li><noscript><li>fake</li></noscript><li>b</li></ul>"),
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
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/noscript-content-skipped" }),
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

  // Regression coverage for the emptiness-probe defect: flushListStrayContent used to decide whether to recover its collected stray nodes by building their inline runs (buildInlineRuns, which only ever produces TEXT) and checking whether that text was blank — so any stray block-level content whose text projection happens to be empty (a resolved image with no alt text, an <hr>, a table or nested list whose only content is such an image) was misjudged as "whitespace-only" and silently dropped, with no diagnostic, exactly like real pretty-printed whitespace. The fix asks the real question instead: does readContainerChildren's own result carry any blocks at all. Each case below recovers a resolved image inline PNG (fakePng, defined further down this file — a function declaration, hoisted) so the stray content's own text projection is genuinely empty while its block projection is not.
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

  it("recovers a nested <ul> stray sibling whose only <li> content is a resolved image with no text — issue #994's own headline shape, which the emptiness-probe regression defeated", () => {
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

  it("recovers a stray <table> whose only cell content is a resolved image with no alt text — readTable always yields a real table block regardless of its cells' own text", () => {
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

  it("recovers stray content before the first <li> of a NESTED list inheriting the outer <li>'s own list membership, not none, when the enclosing list is itself nested", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<ul><li>outer<ul>stray<li>inner</li></ul></li></ul>"),
      sink,
    );
    // "stray" sits before the inner <ul>'s own first <li>, so it has no preceding item WITHIN that inner list to attach to — but the inner <ul> is itself nested inside the outer <li>, so the recovered content inherits THAT membership rather than carrying none of its own, exactly as the diagnostic message now states.
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "outer" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "stray" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "inner" }],
        list: { numId: "epub1:bullet", level: 1, itemId: "item2" },
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/list-content-outside-item" }),
    );
  });
});

describe("inert elements outside lists (script/template/style/noscript)", () => {
  it("never leaks a <script>'s raw source as document text when it sits directly inside a <p>, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<p>before<script>var x=1;</script>after</p>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before" }, { text: "after" }] },
    ]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("never leaks a <style>'s own CSS text as document prose when it sits directly inside <body> content, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<p>before</p><style>p{color:red}</style><p>after</p>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before" }] },
      { kind: "paragraph", runs: [{ text: "after" }] },
    ]);
    expect(sink).not.toHaveBeenCalled();
  });

  // Unlike <script>/<template>/<style> (never legitimate content regardless of where reached), a <noscript>'s own children CAN be ordinary, genuinely renderable markup — this package cannot tell that case apart from a producer's own "please enable JavaScript" placeholder from the markup alone, so it fires its own dedicated diagnostic naming the drop rather than staying silent about it the way the other three do.
  it("never leaks a <noscript>'s fallback markup as document prose when it sits directly inside a <p>, but reports the drop unlike script/template/style", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<p>before<noscript>Enable JavaScript</noscript>after</p>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before" }, { text: "after" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/noscript-content-skipped" }),
    );
  });

  it("does not treat an id living only inside a <noscript> as a resolvable footnote target", () => {
    const blocks = read(
      body(
        '<p>See <a class="footnote" href="#fn1">1</a></p>' +
          '<noscript><p id="fn1">Hidden note</p></noscript>',
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "See " }, { text: "1", hyperlink: "#fn1" }],
      },
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
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
  });

  it("does not let a heading inside an inert <template> suppress a blockquote's own division construct", () => {
    const blocks = read(
      body(
        "<blockquote><template><h2>Hidden</h2></template><p>quoted</p></blockquote>",
      ),
    );
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

  it("does not treat an id living only inside an inert <template> as a resolvable footnote target", () => {
    const blocks = read(
      body(
        '<p>See <a class="footnote" href="#fn1">1</a></p>' +
          '<template><p id="fn1">Hidden note</p></template>',
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "See " }, { text: "1", hyperlink: "#fn1" }],
      },
    ]);
  });

  it("does not let a footnote-reference anchor living only inside an inert <template> mark an unrelated live element as a footnote target", () => {
    const blocks = read(
      body(
        '<template><a epub:type="noteref" href="#fn1">hidden</a></template>' +
          '<p id="fn1">Real paragraph</p>',
      ),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Real paragraph" }] },
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

  // <dt>/<dd> are Flow content (ExaDev/documents.js#1023): a direct-child <img> now splits into its own real ContentImageBlock via readContainerChildren, the same treatment a <p>'s own direct-child <img> already gets, rather than being flattened to alt text inline as if <dt>/<dd> had no block list of their own to insert it into.
  it("splits a dt's own direct-child <img> into its own real image block, not flattened to alt text", () => {
    const bytes = fakePng(96, 96);
    const { blocks } = readXhtmlBody(
      body(
        '<dl><dt>Term <img src="a.png" alt="term pic"/></dt><dd>Definition</dd></dl>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Term " }],
    });
    expect(blocks[1]).toMatchObject({ kind: "image" });
    expect(blocks[2]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Definition" }],
      indentLeftPt: 36,
    });
  });

  it("splits a dd's own direct-child <img> into its own real image block, indented like the rest of the dd's own content", () => {
    const bytes = fakePng(96, 96);
    const { blocks } = readXhtmlBody(
      body(
        '<dl><dt>Term</dt><dd>Definition <img src="a.png" alt="def pic"/></dd></dl>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: "paragraph", runs: [{ text: "Term" }] });
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Definition " }],
      indentLeftPt: 36,
    });
    expect(blocks[2]).toMatchObject({ kind: "image" });
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

  it("keeps a footnote reference construct carried by a dt's own inline content, rather than discarding it", () => {
    const blocks = read(
      body(
        '<dl><dt>Term<a epub:type="noteref" href="#fn1">1</a></dt><dd>Definition</dd></dl>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Term" }, { text: "1" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });

  it("keeps a footnote reference construct carried by a dd's own inline content, rather than discarding it", () => {
    const blocks = read(
      body(
        '<dl><dt>Term</dt><dd>Definition<a epub:type="noteref" href="#fn1">1</a></dd></dl>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Definition" }, { text: "1" }],
      indentLeftPt: 36,
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });

  it("recovers a stray <p> sitting directly inside a <dl> between dt/dd, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<dl><dt>Term</dt><p>stray</p><dd>Definition</dd></dl>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      { kind: "paragraph", runs: [{ text: "stray" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/definition-list-content-outside-entry",
        message:
          "content sits directly inside a <dl> (or one of its <div> wrappers) outside any dt/dd (not valid HTML5); recovered as ordinary content — a non-conformant wrapper's own dt/dd children, if any, lose their distinct term/definition treatment and degrade to plain concatenated text",
      }),
    );
  });

  it("flushes stray content sitting before a <div> wrapper as its own block, ahead of the div's own dt/dd content", () => {
    const blocks = read(
      body("<dl>stray<div><dt>Term</dt><dd>Definition</dd></div></dl>"),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      { kind: "paragraph", runs: [{ text: "Term" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
  });

  it("recovers stray text sitting before the very first dt inside a <dl>, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<dl>stray<dt>Term</dt></dl>"), sink);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      { kind: "paragraph", runs: [{ text: "Term" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/definition-list-content-outside-entry",
      }),
    );
  });

  it("recovers a stray, resolved <img> sitting directly inside a <dl> as a real image block, with a diagnostic", () => {
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body('<dl><dt>Term</dt><img src="a.png" alt="pic"/></dl>'),
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
      expect.objectContaining({
        code: "epub/definition-list-content-outside-entry",
      }),
    );
  });

  it("skips a <script> sitting directly inside a <dl>, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        "<dl><dt>Term</dt><script>var x=1;</script><dd>Definition</dd></dl>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/definition-list-content-outside-entry",
      }),
    );
  });

  it("skips a <noscript> sitting directly inside a <dl>, but reports the drop unlike script", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        "<dl><dt>Term</dt><noscript>Enable JS</noscript><dd>Definition</dd></dl>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/definition-list-content-outside-entry",
      }),
    );
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/noscript-content-skipped" }),
    );
  });

  it("ignores inter-element whitespace inside a <dl>, firing no diagnostic, for the pretty-printed shape essentially all real-world HTML uses", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      { kind: "paragraph", runs: [{ text: "Definition" }], indentLeftPt: 36 },
    ]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("recovers a <section> wrapping a dt/dd pair as degraded, concatenated plain text, with a diagnostic — <div> is the only wrapper HTML5's own <dl> content model actually names as legal", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<dl><section><dt>Term</dt><dd>Definition</dd></section></dl>"),
      sink,
    );
    // The section's own dt/dd children lose their distinct term/definition treatment once routed through readContainerChildren, which has no notion of dt/dd — a real, documented fidelity cost, but a text-preserving one.
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "Term" }, { text: "Definition" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/definition-list-content-outside-entry",
      }),
    );
  });
});

describe("tables", () => {
  it("maps rows/cells, marking a row of th cells as the header row rather than styling its text, with colspan/rowspan honoured", () => {
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
                blocks: [{ kind: "paragraph", runs: [{ text: "H1" }] }],
              },
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "H2" }] }],
              },
            ],
            isHeader: true,
          },
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
                colSpan: 2,
              },
              { blocks: [] },
            ],
          },
        ],
        columns: [
          { widthPt: CONTENT_WIDTH_PT / 2 },
          { widthPt: CONTENT_WIDTH_PT / 2 },
        ],
      },
    ]);
  });

  it("supplies a block-less covered entry for every grid column a colspan reaches, so the row is one cell per grid column", () => {
    const { grid, rows } = readTableGrid(
      '<table><tr><td colspan="2">wide</td><td>x</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    );
    expect(grid).toEqual([
      ["wide|c2", "", "x"],
      ["a", "b", "c"],
    ]);
    expect(rows[0]?.cells[1]).toEqual({ blocks: [] });
  });

  it("derives the column count from the dense width, so a lone colspan cell still declares every column it spans", () => {
    const { grid, columnWidthsPt } = readTableGrid(
      '<table><tr><td colspan="3">wide</td></tr></table>',
    );
    expect(grid).toEqual([["wide|c3", "", ""]]);
    expect(columnWidthsPt).toEqual([
      CONTENT_WIDTH_PT / 3,
      CONTENT_WIDTH_PT / 3,
      CONTENT_WIDTH_PT / 3,
    ]);
  });

  it("places a covered entry at the column a rowspan consumes in the row below, and places that row's own cells after it", () => {
    const { grid, columnWidthsPt, rows } = readTableGrid(
      '<table><tr><td rowspan="2">tall</td><td>a</td></tr><tr><td>b</td></tr></table>',
    );
    expect(grid).toEqual([
      ["tall|r2", "a"],
      ["", "b"],
    ]);
    expect(rows[1]?.cells[0]).toEqual({ blocks: [] });
    expect(columnWidthsPt).toEqual([
      CONTENT_WIDTH_PT / 2,
      CONTENT_WIDTH_PT / 2,
    ]);
  });

  it("covers every position of a 2x2 merge except its anchor", () => {
    const { grid } = readTableGrid(
      '<table><tr><td colspan="2" rowspan="2">m</td><td>x</td></tr><tr><td>y</td></tr></table>',
    );
    expect(grid).toEqual([
      ["m|c2|r2", "", "x"],
      ["", "", "y"],
    ]);
  });

  it("widens every row to a later row's width, and a header rowspan consumes a column below it rather than narrowing the grid", () => {
    const { grid, columnWidthsPt } = readTableGrid(
      '<table><tr><th rowspan="2">h</th></tr><tr><td>a</td><td>b</td></tr></table>',
    );
    expect(grid).toEqual([
      ["h|r2", "", ""],
      ["", "a", "b"],
    ]);
    expect(columnWidthsPt).toHaveLength(3);
  });

  it("treats a zero or negative colspan or rowspan as absent, rather than a real span", () => {
    // One cell per row, so that a wrongly retained zero span could not be masked by a neighbouring cell being placed over the same grid column.
    const table = read(
      body(
        '<table><tr><td colspan="0">a</td></tr><tr><td colspan="-1">b</td></tr><tr><td rowspan="0">c</td></tr><tr><td rowspan="-1">d</td></tr></table>',
      ),
    ).find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    expect(table.rows).toHaveLength(4);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(1);
      for (const cell of row.cells) {
        expect(Object.hasOwn(cell, "colSpan")).toBe(false);
        expect(Object.hasOwn(cell, "rowSpan")).toBe(false);
      }
    }
  });

  it("honours a cell's own rowspan attribute, distinctly from colspan", () => {
    const table = read(
      body('<table><tr><td rowspan="3">tall</td></tr></table>'),
    ).find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    const cell = table.rows[0]?.cells[0];
    expect(cell?.rowSpan).toBe(3);
    expect(
      cell === undefined ? undefined : Object.hasOwn(cell, "colSpan"),
    ).toBe(false);
  });

  it("carries neither colSpan nor rowSpan on a cell with no such attribute, rather than an undefined-valued key", () => {
    const table = read(body("<table><tr><td>plain</td></tr></table>")).find(
      (b) => b.kind === "table",
    );
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    const cell = table.rows[0]?.cells[0];
    if (cell === undefined) {
      throw new Error("expected a cell");
    }
    expect(Object.hasOwn(cell, "colSpan")).toBe(false);
    expect(Object.hasOwn(cell, "rowSpan")).toBe(false);
  });

  it("gives an empty table (no cells at all) the full content width, rather than dividing by a zero column count", () => {
    const table = read(body("<table></table>")).find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    expect(table.rows).toEqual([]);
    expect(table.columns.map((column) => column.widthPt)).toEqual([
      CONTENT_WIDTH_PT,
    ]);
  });

  it("recovers a stray <ul> sitting directly inside a <table> (not inside any row group) as a genuinely nested list, not as if it were itself a row group", () => {
    // Only tr/thead/tbody/tfoot are ever treated as row-group-shaped — a <ul> here must be routed through readContainerChildren's own block-level dispatch (readList, producing a real `list` membership) rather than through collectRowGroupRows, which would instead flatten straight to the <li>'s own bare content with no list membership at all.
    const blocks = read(
      body("<table><ul><li>item</li></ul><tr><td>x</td></tr></table>"),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "item" }],
      list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
    });
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
                blocks: [{ kind: "paragraph", runs: [{ text: "H" }] }],
              },
            ],
            isHeader: true,
          },
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "d" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
  });

  it("marks a thead's row as a header row even when its cells are td, since the row group is the statement and the cell tags are not", () => {
    const blocks = read(
      body(
        "<table><thead><tr><td>H</td></tr></thead><tbody><tr><td>d</td></tr></tbody></table>",
      ),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "H" }] }] }],
            isHeader: true,
          },
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "d" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
  });

  it("leaves a cell-less row out of header-ness, rather than counting its zero th cells as covering all zero of its cells", () => {
    const blocks = read(
      body("<table><tbody><tr></tr><tr><td>d</td></tr></tbody></table>"),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          // Header-ness is decided on the row's own collected cells, before the grid pass pads this cell-less row out to the table's one column, so the padded entry here is not a th the row could ever have been judged on.
          { cells: [{ blocks: [] }] },
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "d" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
  });

  it("leaves a row mixing th and td out of header-ness, since a th scope=row states a row label rather than a header row", () => {
    const blocks = read(
      body('<table><tr><th scope="row">L</th><td>d</td></tr></table>'),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "L" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "d" }] }] },
            ],
          },
        ],
        columns: [
          { widthPt: CONTENT_WIDTH_PT / 2 },
          { widthPt: CONTENT_WIDTH_PT / 2 },
        ],
      },
    ]);
  });

  it("reads a CDATA section's own literal content inside a <td>, rather than silently dropping it", () => {
    const blocks = read(
      body("<table><tr><td><![CDATA[cell & data]]></td></tr></table>"),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [
                  { kind: "paragraph", runs: [{ text: "cell & data" }] },
                ],
              },
            ],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
  });

  it("recovers a CDATA section sitting directly inside a <tbody> outside any <tr>, with a diagnostic, positioned immediately before the table", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        "<table><tbody><![CDATA[stray]]><tr><td>x</td></tr></tbody></table>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  // The message's own wording must actually cover this origin: content sitting INSIDE a <colgroup> fires this exact diagnostic, so a message that lists "colgroup" only as an exclusion ("outside any row, caption, or colgroup") would misstate where this instance's own content sits (ExaDev/documents.js#996's own round-7 wording fix).
  it("recovers a stray <p> sitting directly inside a <colgroup> outside any <col>, with a diagnostic naming <colgroup> as the content's own location", () => {
    let diagnostic: EpubDiagnostic | undefined;
    const blocks = read(
      body(
        "<table><colgroup><p>stray</p><col/></colgroup><tr><td>x</td></tr></table>",
      ),
      (d) => {
        diagnostic = d;
      },
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(diagnostic?.code).toBe("epub/table-content-unrecognized");
    expect(diagnostic?.message).toContain("inside a <colgroup> itself");
  });

  it("recovers stray text sitting directly inside a <tbody> outside any <tr>, with a diagnostic, positioned immediately before the table", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<table><tbody>stray<tr><td>x</td></tr></tbody></table>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  it("recovers a stray <p> sitting directly inside a <thead> outside any <tr>, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<table><thead><p>stray</p><tr><th>H</th></tr></thead></table>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "H" }] }],
              },
            ],
            isHeader: true,
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  it("recovers a stray, resolved <img> sitting directly inside a <tfoot> outside any <tr>, as a real image block, with a diagnostic", () => {
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body(
        '<table><tfoot><img src="a.png" alt="pic"/><tr><td>x</td></tr></tfoot></table>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "image" });
    expect(blocks[1]).toMatchObject({ kind: "table" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  it("recovers a nested <ul> sitting directly inside a <tbody> outside any <tr>, as a properly nested list, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        "<table><tbody><ul><li>item</li></ul><tr><td>x</td></tr></tbody></table>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "item" }],
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
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
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  // <td>/<th> are Flow content (ExaDev/documents.js#1023): a direct-child <img> now splits into its own real ContentImageBlock in the cell's own blocks array via readContainerChildren, rather than being flattened to alt text as if a cell had no block list of its own to insert it into.
  it("splits a table cell's own direct-child <img> into its own real image block in the cell's blocks", () => {
    const bytes = fakePng(96, 96);
    const { blocks } = readXhtmlBody(
      body(
        '<table><tr><td><img src="a.png" alt="cell pic"/></td></tr></table>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as { rows: { cells: { blocks: unknown[] }[] }[] };
    expect(table.rows[0]?.cells[0]?.blocks).toHaveLength(1);
    expect(table.rows[0]?.cells[0]?.blocks[0]).toMatchObject({
      kind: "image",
    });
  });

  it("reads a <caption> as one or more paragraphs before the table, splitting a direct-child <img> into its own real image block, with a diagnostic", () => {
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body(
        '<table><caption>Cap <img src="a.png" alt="cappic"/></caption><tr><td>cell</td></tr></table>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: "paragraph", runs: [{ text: "Cap " }] });
    expect(blocks[1]).toMatchObject({ kind: "image" });
    expect(blocks[2]).toEqual({
      kind: "table",
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
          ],
        },
      ],
      columns: [{ widthPt: CONTENT_WIDTH_PT }],
    });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/table-caption-unsupported",
        message:
          "<caption> has no document-schema.js table-caption field to carry its own distinct tag; read as an ordinary paragraph immediately before the table",
      }),
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
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
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
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
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

  it("keeps a caption whose only content is a construct with no surrounding text, rather than dropping it as empty", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        '<table><caption><a epub:type="noteref" href="#fn1"></a></caption><tr><td>x</td></tr></table>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
      sink,
    );
    expect(blocks[0]).toEqual({
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
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-caption-unsupported" }),
    );
  });

  it("keeps a footnote reference construct carried by a table cell's own inline content, rather than discarding it", () => {
    const blocks = read(
      body(
        '<table><tr><td>Cell<a epub:type="noteref" href="#fn1">1</a></td></tr></table>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toMatchObject({
      kind: "table",
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "Cell" }, { text: "1" }],
                  constructs: [
                    {
                      descriptor: {
                        kind: "anchor",
                        anchorType: "footnote",
                        name: "fn1",
                      },
                      startRun: 1,
                      endRun: 2,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("recovers stray text sitting directly inside a <tr> as its own cell, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<table><tr>stray<td>x</td></tr></table>"), sink);
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "stray" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] },
            ],
          },
        ],
        columns: [
          { widthPt: CONTENT_WIDTH_PT / 2 },
          { widthPt: CONTENT_WIDTH_PT / 2 },
        ],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/table-row-content-outside-cell",
        message:
          "content sits directly inside a <tr> rather than inside a <td>/<th> (not valid HTML5); recovered as its own cell in the row's own column sequence",
      }),
    );
  });

  it("recovers stray text sitting directly inside a <tr> after its last <td> as its own trailing cell, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<table><tr><td>x</td>stray</tr></table>"), sink);
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "stray" }] }] },
            ],
          },
        ],
        columns: [
          { widthPt: CONTENT_WIDTH_PT / 2 },
          { widthPt: CONTENT_WIDTH_PT / 2 },
        ],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-row-content-outside-cell" }),
    );
  });

  it("skips a <script> sitting directly inside a <tr>, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<table><tr><script>var x=1;</script><td>x</td></tr></table>"),
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
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-row-content-outside-cell" }),
    );
  });

  it("skips a <noscript> sitting directly inside a <tr>, but reports the drop unlike script", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<table><tr><noscript>Enable JS</noscript><td>x</td></tr></table>"),
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
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-row-content-outside-cell" }),
    );
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/noscript-content-skipped" }),
    );
  });

  it("recovers a stray <p> sitting directly inside a <table> outside any row/caption, with a diagnostic, positioned immediately before the table", () => {
    const sink = vi.fn();
    const blocks = read(
      body("<table><p>stray</p><tr><td>x</td></tr></table>"),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  it("recovers stray text sitting directly inside a <table> outside any row/caption, with a diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<table>stray<tr><td>x</td></tr></table>"), sink);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  it("recovers a stray <img> sitting directly inside a <colgroup> as its own real image block, not degraded to alt text", () => {
    // Distinguishes routing a <colgroup>'s own stray content through collectColgroupStrayContent (a flat list of the colgroup's OWN children, so a stray <img> reaches readContainerChildren's block-level dispatch and becomes a real ContentImageBlock) from mistakenly treating the whole <colgroup> element itself as one inline stray node (which would instead degrade the same <img> to alt text via buildInlineRuns' own inline-image fallback).
    const bytes = fakePng(96, 96);
    const sink = vi.fn();
    const { blocks } = readXhtmlBody(
      body(
        '<table><colgroup><img src="a.png" alt="colimg"/><col/></colgroup><tr><td>x</td></tr></table>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks[0]).toMatchObject({ kind: "image" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  it("skips a <colgroup>/<script> sitting directly inside a <table>, firing no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(
      body(
        "<table><colgroup><col/><col/></colgroup><script>var x=1;</script><tr><td>a</td><td>b</td></tr></table>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "b" }] }] },
            ],
          },
        ],
        columns: [
          { widthPt: CONTENT_WIDTH_PT / 2 },
          { widthPt: CONTENT_WIDTH_PT / 2 },
        ],
      },
    ]);
    expect(sink).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/table-content-unrecognized" }),
    );
  });

  it("skips a <noscript> sitting directly inside a <table>, reporting the drop exactly once, alongside a stray <p> that alone triggers the unrecognized-content diagnostic", () => {
    // If a <noscript> sitting directly inside a <table> ever fell through this guard un-skipped, it would still eventually be skipped by buildInlineRuns' own universal inert-element safety net once fed through the stray-content recovery path — so the ONLY observable trace of the guard being bypassed is the drop being reported TWICE (once from each guard) rather than once.
    const sink = vi.fn<(d: EpubDiagnostic) => void>();
    const blocks = read(
      body(
        "<table><noscript>Enable JS</noscript><p>stray</p><tr><td>a</td></tr></table>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    const noscriptCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/noscript-content-skipped",
    );
    expect(noscriptCalls).toHaveLength(1);
    const unrecognizedCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/table-content-unrecognized",
    );
    expect(unrecognizedCalls).toHaveLength(1);
  });

  it("skips a <noscript> sitting directly inside a <colgroup>, reporting the drop exactly once, alongside a stray <p> that alone triggers the unrecognized-content diagnostic", () => {
    // A <col/> and a <noscript> together rule out any single mutant that either stops recognising a real <col/> (which would wrongly turn up as unrecognized content) or stops skipping the <noscript> via its own dedicated inert-element guard (which would report the identical drop a SECOND time, once from that guard and once more from buildInlineRuns' own universal inert-element safety net once the un-skipped node is fed through it).
    const sink = vi.fn<(d: EpubDiagnostic) => void>();
    const blocks = read(
      body(
        // <col> carries no legal children of its own — a stray text node here is a synthetic probe, not real markup, checking that a genuinely recognised <col> is silently skipped WHOLESALE (its own content never even reaches the recovery path at all) rather than merely having its outer tag treated like any other unrecognised stray element.
        "<table><colgroup><col>faketext</col><noscript>Enable JS</noscript><p>stray</p></colgroup><tr><td>a</td></tr></table>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    const noscriptCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/noscript-content-skipped",
    );
    expect(noscriptCalls).toHaveLength(1);
    const unrecognizedCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/table-content-unrecognized",
    );
    expect(unrecognizedCalls).toHaveLength(1);
  });

  it("skips a <noscript> sitting directly inside a <tbody>, reporting the drop exactly once, alongside a stray <p> that alone triggers the unrecognized-content diagnostic", () => {
    const sink = vi.fn<(d: EpubDiagnostic) => void>();
    const blocks = read(
      body(
        "<table><tbody><noscript>Enable JS</noscript><p>stray</p><tr><td>a</td></tr></tbody></table>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "stray" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    const noscriptCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/noscript-content-skipped",
    );
    expect(noscriptCalls).toHaveLength(1);
    const unrecognizedCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/table-content-unrecognized",
    );
    expect(unrecognizedCalls).toHaveLength(1);
  });

  it("reads a second <caption> as its own paragraph too, with an additional duplicate-caption diagnostic, instead of silently discarding it", () => {
    const sink = vi.fn<(d: EpubDiagnostic) => void>();
    const blocks = read(
      body(
        "<table><caption>One</caption><caption>Two</caption><tr><td>x</td></tr></table>",
      ),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "One" }] },
      { kind: "paragraph", runs: [{ text: "Two" }] },
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columns: [{ widthPt: CONTENT_WIDTH_PT }],
      },
    ]);
    const duplicateCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/table-duplicate-caption",
    );
    expect(duplicateCalls).toHaveLength(1);
    expect(duplicateCalls[0]?.[0]?.message).toBe(
      "<table> carries more than one <caption> (HTML5 permits at most one); every caption beyond the first is still read as its own ordinary paragraph immediately before the table, rather than being silently discarded",
    );
    const captionUnsupportedCalls = sink.mock.calls.filter(
      ([diagnostic]) => diagnostic.code === "epub/table-caption-unsupported",
    );
    expect(captionUnsupportedCalls).toHaveLength(2);
    // The very first sink call, for the first <caption>, must never be the duplicate-caption diagnostic — only a second or later caption is a duplicate.
    expect(sink.mock.calls[0]?.[0]?.code).toBe(
      "epub/table-caption-unsupported",
    );
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
    const sink = vi.fn();
    read(body('<pre><img alt="text"/></pre>'), sink);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "<img> inside a <pre>/<code> block cannot become a real image block (this package reads a <pre> as a single text-content paragraph, so there is no block list to insert an image block into); degraded to its alt text",
      }),
    );
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
        preformatted: true,
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
    const sink = vi.fn();
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
    const sink = vi.fn();
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
    const sink = vi.fn();
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

  it("carries no altText key at all for a resolved image with an empty alt attribute", () => {
    const bytes = fakePng(96, 192);
    const { blocks } = readXhtmlBody(body('<p><img src="a.png" alt=""/></p>'), {
      resolveImage: (href) => (href === "a.png" ? bytes : undefined),
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    const [block] = blocks;
    if (block === undefined) {
      throw new Error("expected an image block");
    }
    expect(Object.hasOwn(block, "altText")).toBe(false);
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
      expect.objectContaining({
        code: "epub/image-unresolved",
        message:
          '<img src="missing.png"> names no resolvable manifest part; degraded to its alt text',
      }),
    );
  });

  it("drops an unresolved image with an empty alt attribute entirely, rather than an empty paragraph", () => {
    const blocks = read(body('<img src="missing.png" alt=""/>'));
    expect(blocks).toEqual([]);
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
      expect.objectContaining({
        code: "epub/image-format-unsupported",
        message:
          '<img src="a.gif"> is neither a PNG nor a JPEG (document-schema.js\'s ContentImageBlock supports only those two); degraded to its alt text',
      }),
    );
  });

  it("drops a resolved but unsupported-format image with an empty alt attribute entirely, rather than an empty paragraph", () => {
    const { blocks } = readXhtmlBody(body('<img src="a.gif" alt=""/>'), {
      resolveImage: () => new Uint8Array([0x47, 0x49, 0x46, 0x38]),
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    expect(blocks).toEqual([]);
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
    // The fake single-byte image is neither a real PNG nor JPEG, so it degrades to its alt text — this test is about figure/figcaption structure, not image decoding (covered separately).
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "alt text" }] },
      { kind: "paragraph", runs: [{ text: "Caption text" }] },
    ]);
  });

  // <figcaption> is Flow content (ExaDev/documents.js#1023): a direct-child <img> now splits into its own real ContentImageBlock via readContainerChildren, the same treatment a <p>'s own direct-child <img> already gets, rather than being flattened to alt text as if <figcaption> had no block list of its own to insert it into.
  it("splits a figcaption's own direct-child <img> into its own real image block, not flattened to alt text", () => {
    const bytes = fakePng(96, 96);
    const { blocks } = readXhtmlBody(
      body(
        '<figure><figcaption>Caption <img src="a.png" alt="inline pic"/></figcaption></figure>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Caption " }],
    });
    expect(blocks[1]).toMatchObject({ kind: "image" });
  });

  it("keeps a footnote reference construct carried by a <figcaption>'s own inline content, rather than discarding it", () => {
    const blocks = read(
      body(
        '<figure><figcaption>Caption<a epub:type="noteref" href="#fn1">1</a></figcaption></figure>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Caption" }, { text: "1" }],
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

describe("div/section passthrough", () => {
  it("reads a div's children transparently", () => {
    const blocks = read(body("<div><p>inside</p></div>"));
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "inside" }] }]);
  });
});

describe("text direction (the dir attribute)", () => {
  it("maps a block container's own dir onto every paragraph it produces", () => {
    const blocks = read(
      body(
        '<p dir="rtl">one</p><h2 dir="ltr">two</h2><pre dir="rtl">three</pre>',
      ),
    );
    expect(
      blocks.map((b) => (b.kind === "paragraph" ? b.direction : undefined)),
    ).toEqual(["rtl", "ltr", "rtl"]);
  });

  it("inherits a container's dir into arbitrarily nested paragraphs, with the nearest stated dir winning", () => {
    // XHTML's dir attribute inherits: a <div dir="rtl"> governs its descendants until one states a dir of its own.
    const blocks = read(
      body(
        '<div dir="rtl"><p>inherited</p><p dir="ltr">overridden</p>' +
          "<div><section><p>still inherited</p></section></div></div>" +
          "<p>outside</p>",
      ),
    );
    expect(
      blocks.map((b) => (b.kind === "paragraph" ? b.direction : undefined)),
    ).toEqual(["rtl", "ltr", "rtl", undefined]);
  });

  it("carries the dir of an li, a dt/dd, and a table cell onto their own paragraphs", () => {
    const blocks = read(
      body(
        '<ul><li dir="rtl">item</li></ul>' +
          '<dl><dt dir="rtl">term</dt><dd dir="ltr">definition</dd></dl>',
      ),
    );
    expect(
      blocks.map((b) => (b.kind === "paragraph" ? b.direction : undefined)),
    ).toEqual(["rtl", "rtl", "ltr"]);
    const table = read(
      body('<table><tr><td dir="rtl">cell</td></tr></table>'),
    ).find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    const cellParagraph = table.rows[0]?.cells[0]?.blocks[0];
    expect(
      cellParagraph?.kind === "paragraph" ? cellParagraph.direction : undefined,
    ).toBe("rtl");
  });

  it('leaves dir="auto" unmapped rather than guessing a direction for it', () => {
    // dir="auto" resolves at render time from the content's own first strong character — a fact ContentParagraph.direction's closed ltr/rtl vocabulary has no member for.
    const blocks = read(body('<p dir="auto">words</p>'));
    expect(blocks[0]).toEqual({ kind: "paragraph", runs: [{ text: "words" }] });
  });

  it("never sets a direction key at all when nothing in scope ever stated a dir", () => {
    // toEqual alone would pass even if decorateParagraph always attached a `direction: undefined` property (toEqual ignores undefined-valued keys), so this checks key presence directly.
    const blocks = read(body("<p>plain</p>"));
    expect(Object.hasOwn(blocks[0] as object, "direction")).toBe(false);
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

  // ExaDev/documents.js#1038's own repro: a footnote-reference anchor nested inside a <strong> (appendNested's own recursive buildInlineRuns call) at a point where the OUTER runs array already holds a preceding text run. The nested call counts its own runs from zero ("world" at 0, "1" at 1), so its own construct comes back as {startRun: 1, endRun: 2} relative to itself — rebasing that onto the outer array's own length (1, for "hello ") is what turns it into the correct {startRun: 2, endRun: 3} bracketing "1", not the unrebased {startRun: 1, endRun: 2} that would incorrectly bracket "world" instead.
  it("rebases a footnote-reference construct nested inside a <strong> onto the outer run array's own length, rather than leaving it relative to the nested call's zero-based count", () => {
    const blocks = read(
      body(
        '<p>hello <strong>world<a epub:type="noteref" href="#fn1">1</a></strong></p>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "hello " },
        { text: "world", bold: true },
        { text: "1", bold: true },
      ],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 2,
          endRun: 3,
        },
      ],
    });
  });

  it("rebases a footnote-reference construct nested inside a plain hyperlink onto the outer run array's own length", () => {
    const blocks = read(
      body(
        '<p>hello <a href="https://example.invalid/">world<a epub:type="noteref" href="#fn1">1</a></a></p>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [
        { text: "hello " },
        { text: "world", hyperlink: "https://example.invalid/" },
        { text: "1", hyperlink: "https://example.invalid/" },
      ],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 2,
          endRun: 3,
        },
      ],
    });
  });

  it("reads a plain, non-footnote <aside> as ordinary content, with no construct wrapper and no diagnostic", () => {
    const sink = vi.fn();
    const blocks = read(body("<aside><p>Just a sidebar.</p></aside>"), sink);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Just a sidebar." }] },
    ]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("reads a footnote <aside> with no id as ordinary content, with a diagnostic naming the loss", () => {
    const sink = vi.fn();
    const blocks = read(
      body('<aside epub:type="footnote"><p>Orphan note.</p></aside>'),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Orphan note." }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/footnote-target-unresolved",
        message:
          "a footnote <aside> carries no id and cannot be referenced; read as ordinary content",
      }),
    );
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

// A <caption>/<dt>/<dd>/<figcaption>/<td>/<th> is Flow content per the HTML Standard, so a <pre>, a nested list, or more than one paragraph inside one is real, conformant markup — these six containers used to build their content via one bare buildInlineRuns call each, flattening any of that block structure into a single paragraph (or, worse, fusing sibling paragraphs into one undelimited run with the word boundary between them lost). ExaDev/documents.js#1023's own two minimal repros, run against every one of the six containers it names.
describe("block content inside table cells, captions, dt/dd, figcaption (#1023)", () => {
  it("keeps a <pre> inside a table cell preformatted, rather than flattening it to a plain paragraph with its internal newline collapsed", () => {
    const blocks = read(
      body(
        "<table><tr><td><pre><code>line one\nline two</code></pre></td></tr></table>",
      ),
    );
    const table = blocks[0] as { rows: { cells: { blocks: unknown[] }[] }[] };
    expect(table.rows[0]?.cells[0]?.blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "line one\nline two", fontFamily: "Courier New" }],
        preformatted: true,
      },
    ]);
  });

  it("reads two sibling <p>s inside a <caption> as two distinct paragraphs, not fused into one run with the word boundary lost", () => {
    const blocks = read(
      body(
        "<table><caption><p>Alpha</p><p>Beta</p></caption><tr><td>x</td></tr></table>",
      ),
    );
    expect(blocks[0]).toEqual({ kind: "paragraph", runs: [{ text: "Alpha" }] });
    expect(blocks[1]).toEqual({ kind: "paragraph", runs: [{ text: "Beta" }] });
  });

  it("fires table-caption-unsupported exactly once for a multi-paragraph caption, not once per resulting paragraph", () => {
    const sink = vi.fn();
    read(
      body(
        "<table><caption><p>Alpha</p><p>Beta</p></caption><tr><td>x</td></tr></table>",
      ),
      sink,
    );
    const captionDiagnostics = sink.mock.calls.filter(
      ([diagnostic]) =>
        (diagnostic as { code: string }).code ===
        "epub/table-caption-unsupported",
    );
    expect(captionDiagnostics).toHaveLength(1);
  });

  it("keeps a nested list inside a <dd> as real list structure, not concatenated inline text", () => {
    const blocks = read(
      body("<dl><dt>Term</dt><dd><ul><li>a</li><li>b</li></ul></dd></dl>"),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        indentLeftPt: 36,
        list: { numId: "epub1:bullet", level: 0, itemId: "item1" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        indentLeftPt: 36,
        list: { numId: "epub1:bullet", level: 0, itemId: "item2" },
      },
    ]);
  });

  it("reads two sibling <p>s inside a <figcaption> as two distinct paragraphs, not fused into one run", () => {
    const blocks = read(
      body("<figure><figcaption><p>Alpha</p><p>Beta</p></figcaption></figure>"),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Alpha" }] },
      { kind: "paragraph", runs: [{ text: "Beta" }] },
    ]);
  });

  it("reads two sibling <p>s inside a <dt> as two distinct paragraphs, not fused into one run", () => {
    const blocks = read(body("<dl><dt><p>Alpha</p><p>Beta</p></dt></dl>"));
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Alpha" }] },
      { kind: "paragraph", runs: [{ text: "Beta" }] },
    ]);
  });

  it("keeps a <pre> inside a <dd> preformatted", () => {
    const blocks = read(
      body("<dl><dt>Term</dt><dd><pre>line one\nline two</pre></dd></dl>"),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Term" }] },
      {
        kind: "paragraph",
        runs: [{ text: "line one\nline two", fontFamily: "Courier New" }],
        preformatted: true,
        indentLeftPt: 36,
      },
    ]);
  });
});
