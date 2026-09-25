// The list-shaped suites (ordered and unordered lists, inert elements, definition lists) split from read.test.ts, sharing its read/body harness.

import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic, EpubDiagnosticSink } from "../diagnostics";
import { readXhtmlBody } from "./read";

const CONTENT_WIDTH_PT = 451.28;
const FAKE_IMAGE_WIDTH_PX = 96;

const PNG_SIG_HIGH_BIT_MARKER = 0x89;
const PNG_SIG_P = 0x50;
const PNG_SIG_N = 0x4e;
const PNG_SIG_G = 0x47;
const PNG_SIG_CR = 0x0d;
const PNG_SIG_LF = 0x0a;
const PNG_SIG_LINE_ENDING_DETECTOR = 0x1a;
const PNG_SIG = [
  PNG_SIG_HIGH_BIT_MARKER,
  PNG_SIG_P,
  PNG_SIG_N,
  PNG_SIG_G,
  PNG_SIG_CR,
  PNG_SIG_LF,
  PNG_SIG_LINE_ENDING_DETECTOR,
  PNG_SIG_LF,
];
const IHDR_TAG_I = 0x49;
const IHDR_TAG_H = 0x48;
const IHDR_TAG_D = 0x44;
const IHDR_TAG_R = 0x52;
const IHDR_TAG_BYTES = [IHDR_TAG_I, IHDR_TAG_H, IHDR_TAG_D, IHDR_TAG_R];
const UINT32_BYTES = 4;
const PNG_CHUNK_TYPE_OFFSET = PNG_SIG.length + UINT32_BYTES; // 12
const PNG_IHDR_WIDTH_OFFSET = PNG_CHUNK_TYPE_OFFSET + UINT32_BYTES; // 16
const PNG_IHDR_HEIGHT_OFFSET = PNG_IHDR_WIDTH_OFFSET + UINT32_BYTES; // 20
const PNG_HEADER_BYTES = PNG_IHDR_HEIGHT_OFFSET + UINT32_BYTES; // 24
const IHDR_TRAILING_FIELD_BYTES = 5;
const PNG_IHDR_CHUNK_DATA_BYTES =
  UINT32_BYTES + UINT32_BYTES + IHDR_TRAILING_FIELD_BYTES; // 13
const FAKE_PNG_TOTAL_BYTES =
  PNG_HEADER_BYTES + IHDR_TRAILING_FIELD_BYTES + UINT32_BYTES; // 33
const PNG_BIT_DEPTH_8 = 8;
const PNG_COLOUR_TYPE_TRUECOLOR_ALPHA = 6;

// A minimal PNG carrying only what src/image/dimensions.ts reads: the 8-byte signature plus an IHDR chunk.
function fakePng(widthPx: number, heightPx: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(FAKE_PNG_TOTAL_BYTES);
  bytes.set(PNG_SIG, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(PNG_SIG.length, PNG_IHDR_CHUNK_DATA_BYTES);
  bytes.set(IHDR_TAG_BYTES, PNG_CHUNK_TYPE_OFFSET);
  view.setUint32(PNG_IHDR_WIDTH_OFFSET, widthPx);
  view.setUint32(PNG_IHDR_HEIGHT_OFFSET, heightPx);
  bytes.set(
    [PNG_BIT_DEPTH_8, PNG_COLOUR_TYPE_TRUECOLOR_ALPHA, 0, 0, 0],
    PNG_HEADER_BYTES,
  );
  return bytes;
} // A4 minus 1in margins each side, matching src/read.ts's own default section geometry
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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

  // division constructStart + image + constructEnd, plus the preceding <li>'s own paragraph.
  const blockquoteConstructBlockCount = 4;

  it.each([
    ["figure", '<figure><img src="a.png" alt=""/></figure>', 2],
    ["p", '<p><img src="a.png" alt=""/></p>', 2],
    [
      "blockquote",
      '<blockquote><img src="a.png" alt=""/></blockquote>',
      blockquoteConstructBlockCount,
    ],
  ] as const)(
    "recovers a stray <%s> wrapping only a resolved, alt-less image",
    (_tag, fragment, expectedBlockCount) => {
      const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
      const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
