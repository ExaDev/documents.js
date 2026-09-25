// The inert-element and definition-list suites split from read-lists.test.ts, sharing its harness.

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

describe("inert elements outside lists (script/template/style/noscript)", () => {
  it("never leaks a <script>'s raw source as document text when it sits directly inside a <p>, firing no diagnostic", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const expectedBlockCount = 3;
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
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
    expect(blocks).toHaveLength(expectedBlockCount);
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
    const expectedBlockCount = 3;
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
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
    expect(blocks).toHaveLength(expectedBlockCount);
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
