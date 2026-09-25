// The footnote suites (EPUB 3 aside+noteref and the EPUB 2 linked-anchor idiom) split from read.test.ts, sharing its read/body harness.

import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic, EpubDiagnosticSink } from "../diagnostics";
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
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(body("<aside><p>Just a sidebar.</p></aside>"), sink);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "Just a sidebar." }] },
    ]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("reads a footnote <aside> with no id as ordinary content, with a diagnostic naming the loss", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
