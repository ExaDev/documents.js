import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  EpubDiagnosticCodes,
  EpubTableGridFaultError,
  EpubWriteError,
  type EpubDiagnostic,
} from "../diagnostics";
import { buildXml } from "../xml/build";
import { readXhtmlBody } from "./read";
import { MONOSPACE_FONT_FAMILY } from "./style-constants";
import { writeXhtmlBody } from "./write";

const CONTENT_WIDTH_PT = 451.28;

// A minimal XHTML content document wrapping raw <body> content, for the one test below that needs to read a hand-written fragment rather than a hand-built ContentBlock[] — matching read.test.ts's own identical helper.
function xhtmlDocument(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>${inner}</body></html>`;
}

function write(blocks: ContentBlock[]): string {
  return writeWithSink(blocks, () => undefined).xml;
}

// The raw XmlElement tree, for the handful of tests that need to inspect writer-internal node structure (e.g. whether a spurious empty text node exists between two sibling elements) directly — a distinction the serialized XML string itself can lose, since an empty text node contributes zero characters to the output either way.
function writeBody(blocks: ContentBlock[]) {
  return writeXhtmlBody(blocks, {
    registerImage: () => "images/img1.png",
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
    resolveAnchorHref: (name) => `#${name}`,
  });
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
    resolveAnchorHref: (name) => `#${name}`,
  });
  const xml = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">${buildXml([body])}</html>`;
  return { xml, diagnostics };
}

// The number of cell tags in each <tr>, in document order.
function cellTagCountsPerRow(markup: string): number[] {
  return [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map(
    (row) => (row[1] ?? "").split("<td").length - 1,
  );
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
              { blocks: [] },
            ],
          },
        ],
        columns: [{ widthPt: 100 }, { widthPt: 100 }],
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

  it("reports TABLE_HEADER_COLUMN_DROPPED with the exact message when a column states isHeader", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "table",
        columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "b" }] }] },
            ],
          },
        ],
      },
    ];
    const { diagnostics } = writeWithSink(blocks, () => undefined);
    const diagnostic = diagnostics.find(
      (d) => d.code === EpubDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
    );
    expect(diagnostic?.message).toBe(
      "this table states one or more header columns, and this writer has no XHTML construct for a column repeating at the left of each printed page, so the flag is dropped and will not read back",
    );
  });

  it("writes and re-reads a table cell's own rowspan attribute", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "tall" }] }],
                rowSpan: 3,
              },
            ],
          },
          { cells: [{ blocks: [] }] },
          { cells: [{ blocks: [] }] },
        ],
        columns: [{ widthPt: 100 }],
      },
    ];
    const xml = write(blocks);
    expect(xml).toContain('rowspan="3"');
  });

  it("writes no cell tag for a covered entry of a colspan", () => {
    const xml = write([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
                colSpan: 2,
              },
              { blocks: [] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] },
            ],
          },
        ],
        columns: [{ widthPt: 100 }, { widthPt: 100 }, { widthPt: 100 }],
      },
    ]);
    expect(cellTagCountsPerRow(xml)).toEqual([2]);
    expect(xml).toContain('colspan="2"');
  });

  it("writes no cell tag in the row below for the position a rowspan covers", () => {
    const xml = write([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "tall" }] }],
                rowSpan: 2,
              },
              { blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] },
            ],
          },
          {
            cells: [
              { blocks: [] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "b" }] }] },
            ],
          },
        ],
        columns: [{ widthPt: 100 }, { widthPt: 100 }],
      },
    ]);
    expect(cellTagCountsPerRow(xml)).toEqual([2, 1]);
    expect(xml).toContain('rowspan="2"');
  });

  it("writes a header row's cells as th and every other row's as td", () => {
    const xml = write([
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }],
            isHeader: true,
          },
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }],
          },
        ],
        columns: [{ widthPt: 100 }],
      },
    ]);
    expect(xml).toContain("<th><p>h</p></th>");
    expect(xml).toContain("<td><p>a</p></td>");
  });

  it("round-trips a header row that is not the first row, since th states the row rather than a thead block", () => {
    const source = "<table><tr><td>a</td></tr><tr><th>h</th></tr></table>";
    const blocks = readXhtmlBody(xhtmlDocument(source), {
      resolveImage: () => undefined,
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    }).blocks;
    const table = blocks[0];
    if (table?.kind !== "table") throw new Error("expected a table block");
    expect(table.rows.map((row) => row.isHeader)).toEqual([undefined, true]);
    const xml = write(blocks);
    expect(xml).toContain("<tr><td><p>a</p></td></tr>");
    expect(xml).toContain("<tr><th><p>h</p></th></tr>");
  });

  it("writes one cell tag for a 2x2 merge, carrying both spans", () => {
    const xml = write([
      {
        kind: "table",
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "m" }] }],
                colSpan: 2,
                rowSpan: 2,
              },
              { blocks: [] },
            ],
          },
          { cells: [{ blocks: [] }, { blocks: [] }] },
        ],
        columns: [{ widthPt: 100 }, { widthPt: 100 }],
      },
    ]);
    expect(cellTagCountsPerRow(xml)).toEqual([1, 0]);
    expect(xml).toContain('colspan="2"');
    expect(xml).toContain('rowspan="2"');
  });

  it("round-trips a merged HTML table with the same number of cell tags per row as the source", () => {
    const source =
      '<table><tr><td colspan="2" rowspan="2">m</td><td>x</td></tr><tr><td>y</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>';
    const blocks = readXhtmlBody(xhtmlDocument(source), {
      resolveImage: () => undefined,
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    }).blocks;
    const xml = write(blocks);
    expect(cellTagCountsPerRow(xml)).toEqual(cellTagCountsPerRow(source));
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("never reports ELEMENT_UNMAPPED for an ordinary table cell carrying only real leaf blocks", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "table",
        rows: [
          {
            cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] }],
          },
        ],
        columns: [{ widthPt: 100 }],
      },
    ];
    const { diagnostics } = writeWithSink(blocks, () => undefined);
    expect(
      diagnostics.some((d) => d.code === EpubDiagnosticCodes.ELEMENT_UNMAPPED),
    ).toBe(false);
  });

  // The comment above writeTable's own isTreeBlockLeaf filter used to claim this package's own reader never puts a construct-boundary marker inside a table cell's blocks — it does, whenever read.ts's own flushStrayCell recovers a stray <blockquote> (or a footnote-target element) sitting directly inside a <tr>: readBlockquote wraps its recovered content in a division construct pair, and that recovered ContentBlock[] becomes the stray cell's own blocks. This exercises that exact path end to end.
  it("drops a construct-boundary marker recovered into a stray table cell, with a diagnostic", () => {
    const sink = () => undefined;
    const blocks = readXhtmlBody(
      xhtmlDocument(
        "<table><tr><blockquote><p>q</p></blockquote><td>x</td></tr></table>",
      ),
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    ).blocks;
    const table = blocks.find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    expect(
      table.rows[0]?.cells[0]?.blocks.some(
        (b) => b.kind === "constructStart" || b.kind === "constructEnd",
      ),
    ).toBe(true);
    const { xml, diagnostics } = writeWithSink([table], () => undefined);
    // One diagnostic per dropped marker (constructStart and constructEnd) — the division construct's own pairing is lost, but the paragraph the pair wrapped is still a real leaf block and survives.
    expect(
      diagnostics.filter(
        (d) =>
          d.code === EpubDiagnosticCodes.ELEMENT_UNMAPPED &&
          d.message.includes("construct-boundary marker inside a table cell"),
      ),
    ).toHaveLength(2);
    expect(xml).toContain("<td><p>q</p></td>");
  });

  it("writes and re-reads a horizontal rule", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [], styleId: "HorizontalRule" },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("never treats a paragraph carrying the horizontal-rule styleId but real runs as an <hr>", () => {
    const xml = write([
      {
        kind: "paragraph",
        runs: [{ text: "not empty" }],
        styleId: "HorizontalRule",
      },
    ]);
    expect(xml).not.toContain("<hr");
    expect(xml).toContain("not empty");
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

  // The overlapping-range twin of the point-anchor case immediately above: two NON-point footnote extents sharing the same startRun. Unlike two point anchors (which wrap zero runs each and never conflict), two range extents both claiming the identical starting run cannot both become sibling <a> elements — <a> is interactive content and HTML forbids nesting one inside another, so at most one can actually wrap the runs. This is the "genuinely unrepresentable overlap" the fix reports through the diagnostic sink rather than silently dropping: the first extent in the input's own constructs array wins and is written normally, the second is reported via CONSTRUCT_UNREPRESENTED, and — the property that actually matters — every run's own text still survives in the output either way, since the losing extent's own runs are already covered by the winner's range.
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

describe("writeXhtmlBody: a table breaking the grid rule", () => {
  const paragraph = (text: string): ContentBlock => ({
    kind: "paragraph",
    runs: [{ text }],
  });
  // A merged header whose covered position carries a second copy of the anchor's content, which an HTML table has no cell to hold.
  const coveredContentTable: ContentBlock = {
    kind: "table",
    columns: [{ widthPt: 100 }, { widthPt: 100 }],
    rows: [
      {
        cells: [
          { blocks: [paragraph("anchor")], colSpan: 2 },
          { blocks: [paragraph("second copy")] },
        ],
      },
    ],
  };

  function thrownBy(blocks: ContentBlock[]): unknown {
    try {
      write(blocks);
    } catch (error) {
      return error;
    }
    return expect.unreachable("writeXhtmlBody should have thrown");
  }

  it("throws EpubTableGridFaultError naming the fault, rather than dropping the covered content", () => {
    const error = thrownBy([coveredContentTable]);
    expect(error).toBeInstanceOf(EpubTableGridFaultError);
    expect(error).toBeInstanceOf(EpubWriteError);
    if (!(error instanceof EpubTableGridFaultError)) {
      throw new Error("unreachable");
    }
    expect(error.name).toBe("EpubTableGridFaultError");
    expect(error.code).toBe("epub/table-grid-fault");
    expect(error.fault).toEqual({
      kind: "coveredContent",
      rowIndex: 0,
      columnIndex: 1,
      anchorRowIndex: 0,
      anchorColumnIndex: 0,
    });
    expect(error.message).toBe(
      "a table breaks the grid rule: the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor",
    );
  });

  it("throws for rows of differing lengths", () => {
    const error = thrownBy([
      {
        kind: "table",
        columns: [{ widthPt: 100 }, { widthPt: 100 }],
        rows: [
          {
            cells: [{ blocks: [paragraph("a")] }, { blocks: [paragraph("b")] }],
          },
          { cells: [{ blocks: [paragraph("c")] }] },
        ],
      },
    ]);
    expect(error).toBeInstanceOf(EpubTableGridFaultError);
  });

  it("throws for a table nested inside a cell", () => {
    const error = thrownBy([
      {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [{ cells: [{ blocks: [coveredContentTable] }] }],
      },
    ]);
    expect(error).toBeInstanceOf(EpubTableGridFaultError);
  });
});
