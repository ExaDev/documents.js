// The link/image-title, nested-style-ordering and diagnostic-gap suites split from emit.test.ts, sharing the doc/diagnostics harness.

import type {
  ContentBlock,
  ContentDocument,
  ContentTable,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARGINS } from "../defaults/defaults";
import {
  MarkdownDiagnosticCodes,
  MarkdownInvalidRunConstructExtentError,
} from "../diagnostics/diagnostics";
import { lowerMarkdown } from "../lower/lower";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import { emitMarkdown } from "./emit";

function doc(blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      { pageSize: PAGE_SIZE_A4, margins: DEFAULT_MARGINS, blocks: [...blocks] },
    ],
  };
}

describe("link and image titles (the `link` construct annotation)", () => {
  it('renders a titled link group as [text](dest "title"), reading the title from the covering run-level extent', () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "text", hyperlink: "/u" }],
          constructs: [
            {
              descriptor: {
                kind: "link",
                target: { kind: "external", uri: "/u" },
                title: "the title",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(markdown).toBe('[text](/u "the title")');
  });

  it("uses the bracket form for an autolink-shaped run when a title extent covers it, since <...> has no title slot, and the text escapes as ordinary link text does", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "http://x", hyperlink: "http://x" }],
          constructs: [
            {
              descriptor: {
                kind: "link",
                target: { kind: "external", uri: "http://x" },
                title: "t",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(markdown).toBe('[http\\:\\/\\/x](http://x "t")');
  });

  it("escapes double quotes and backslashes inside a rendered title", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "text", hyperlink: "/u" }],
          constructs: [
            {
              descriptor: {
                kind: "link",
                target: { kind: "external", uri: "/u" },
                title: 'say "hi" \\ done',
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(markdown).toBe('[text](/u "say \\"hi\\" \\\\ done")');
  });

  it("preserves a titled link byte for byte across a full lower -> emit -> lower round trip", () => {
    for (const source of [
      '[text](/u "the title")',
      '[one](/1 "a") middle [two](/2 "b")',
    ]) {
      const first = lowerMarkdown(source);
      const markdown = emitMarkdown(first);
      expect(markdown).toBe(source);
      expect(lowerMarkdown(markdown)).toEqual(first);
    }
  });

  it("preserves a titled link inside emphasis semantically — the emit side re-spells the emphasis boundaries around the hyperlink group exactly as it already does for an untitled one, and the reparse reproduces the identical document", () => {
    const first = lowerMarkdown('a **b [c](/u "t") d** e');
    const markdown = emitMarkdown(first);
    expect(lowerMarkdown(markdown)).toEqual(first);
  });

  it('renders a link construct wrapping exactly one image block as ![alt](dest "title"), restoring the original destination instead of re-embedding bytes', () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: {
          kind: "link",
          target: { kind: "external", uri: "https://example.com/a.png" },
          title: "img title",
        },
      },
      {
        kind: "image",
        format: "png",
        base64: "AAAA",
        widthPt: 1,
        heightPt: 1,
        altText: "alt",
      },
      { kind: "constructEnd" },
    ];
    // A remote destination carries no bytes, so images: false (an "omit the bytes" switch) still renders it.
    expect(emitMarkdown(doc(blocks), { images: false })).toBe(
      '![alt](https://example.com/a.png "img title")',
    );
    expect(emitMarkdown(doc(blocks))).toBe(
      '![alt](https://example.com/a.png "img title")',
    );
  });

  it("does NOT render the image-shortcut spelling for a link construct wrapping MORE than one child, even when the first of them is an image — the mint condition is exactly one child, not merely 'starts with an image'", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "constructStart",
          descriptor: {
            kind: "link",
            target: { kind: "external", uri: "https://example.com/a.png" },
          },
        },
        {
          kind: "image",
          format: "png",
          base64: "AAAA",
          widthPt: 1,
          heightPt: 1,
          altText: "alt",
        },
        { kind: "paragraph", runs: [{ text: "caption" }] },
        { kind: "constructEnd" },
      ]),
      { sink: collector.sink },
    );
    // The construct falls through to the generic, transparent rendering — its own image child renders as ITSELF (a plain data: URI image, not the link-shortcut's own remote-destination spelling), and the caption follows as an ordinary paragraph.
    expect(markdown).toBe("![alt](data:image/png;base64,AAAA)\n\ncaption");
    expect(collector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED)).toBe(
      true,
    );
  });

  it("falls back to the plain no-bytes image rendering when the construct destination is itself a data: URI and images: false asks for no bytes", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: {
          kind: "link",
          target: { kind: "external", uri: "data:image/png;base64,QQ==" },
          title: "t",
        },
      },
      {
        kind: "image",
        format: "png",
        base64: "QQ==",
        widthPt: 1,
        heightPt: 1,
        altText: "alt",
      },
      { kind: "constructEnd" },
    ];
    const collector = createDiagnosticCollector();
    expect(
      emitMarkdown(doc(blocks), { images: false, sink: collector.sink }),
    ).toBe("![alt]()");
    // The pair still renders through its own image shortcut here, just without the bytes, and it never falls through to the transparent path that reports an unrepresented construct.
    expect(collector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED)).toBe(
      false,
    );
  });

  it("emits an empty alt slot for a link construct wrapping an image block that carries no altText of its own", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "constructStart",
            descriptor: {
              kind: "link",
              target: {
                kind: "external",
                uri: "https://example.com/a.png",
              },
              title: "img title",
            },
          },
          {
            kind: "image",
            format: "png",
            base64: "AAAA",
            widthPt: 1,
            heightPt: 1,
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toBe('![](https://example.com/a.png "img title")');
  });

  it("omits the title slot entirely for a link construct wrapping an image whose descriptor carries no title", () => {
    expect(
      emitMarkdown(
        doc([
          {
            kind: "constructStart",
            descriptor: {
              kind: "link",
              target: {
                kind: "external",
                uri: "https://example.com/a.png",
              },
            },
          },
          {
            kind: "image",
            format: "png",
            base64: "AAAA",
            widthPt: 1,
            heightPt: 1,
            altText: "alt",
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toBe("![alt](https://example.com/a.png)");
  });

  it("throws for a paragraph whose run-level construct extent does not name real runs", () => {
    let beyondRuns: unknown;
    try {
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "text", hyperlink: "/u" }],
            constructs: [
              {
                descriptor: {
                  kind: "link",
                  target: { kind: "external", uri: "/u" },
                  title: "t",
                },
                startRun: 0,
                endRun: 5,
              },
            ],
          },
        ]),
      );
    } catch (error) {
      beyondRuns = error;
    }
    expect(beyondRuns).toBeInstanceOf(MarkdownInvalidRunConstructExtentError);
    const beyondRunsTyped =
      beyondRuns as MarkdownInvalidRunConstructExtentError;
    expect(beyondRunsTyped.name).toBe("MarkdownInvalidRunConstructExtentError");
    expect(beyondRunsTyped.faultKind).toBe("beyondRuns");
    expect(beyondRunsTyped.entryIndex).toBe(0);
    expect(beyondRunsTyped.code).toBe("md/run-construct-extent-invalid");
    expect(beyondRunsTyped.message).toBe(
      "a paragraph's run-level construct extent reaches outside the paragraph's own runs (constructs entry 0); a run extent must name real runs in 0..runs.length",
    );

    let invertedRange: unknown;
    try {
      emitMarkdown(
        doc([
          {
            kind: "paragraph",
            runs: [{ text: "text", hyperlink: "/u" }],
            constructs: [
              {
                descriptor: {
                  kind: "link",
                  target: { kind: "external", uri: "/u" },
                  title: "t",
                },
                startRun: 2,
                endRun: 1,
              },
            ],
          },
        ]),
      );
    } catch (error) {
      invertedRange = error;
    }
    expect(invertedRange).toBeInstanceOf(
      MarkdownInvalidRunConstructExtentError,
    );
    const invertedRangeTyped =
      invertedRange as MarkdownInvalidRunConstructExtentError;
    expect(invertedRangeTyped.faultKind).toBe("invertedRange");
    expect(invertedRangeTyped.entryIndex).toBe(0);
    expect(invertedRangeTyped.message).toBe(
      "a paragraph's run-level construct extent ends before it starts (constructs entry 0); a run extent must name real runs in 0..runs.length",
    );
  });

  it("also throws for an invalid run-level construct extent buried inside a TABLE CELL's own paragraph, not just a top-level one — validateRunConstructExtents must actually recurse into every row's every cell", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "text", hyperlink: "/u" }],
                  constructs: [
                    {
                      descriptor: {
                        kind: "link",
                        target: { kind: "external", uri: "/u" },
                        title: "t",
                      },
                      startRun: 0,
                      endRun: 5,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    let inCell: unknown;
    try {
      emitMarkdown(doc([table]));
    } catch (error) {
      inCell = error;
    }
    expect(inCell).toBeInstanceOf(MarkdownInvalidRunConstructExtentError);
    expect((inCell as MarkdownInvalidRunConstructExtentError).faultKind).toBe(
      "beyondRuns",
    );
  });
});

describe("nested style ordering (ExaDev/markdown-codec#957)", () => {
  it("wraps an italic span outermost when it stays constant across a bold sub-span (CommonMark spec 0.31.2 example 393)", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "(", italic: true },
            { text: "foo", italic: true, bold: true },
            { text: ")", italic: true },
          ],
        },
      ]),
      { emphasisMarker: "*" },
    );
    expect(markdown).toBe("*(**foo**)*");
  });

  it("wraps a bold span outermost when it stays constant across an italic sub-span", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "(", bold: true },
            { text: "foo", italic: true, bold: true },
            { text: ")", bold: true },
          ],
        },
      ]),
      { emphasisMarker: "*" },
    );
    expect(markdown).toBe("**(*foo*)**");
  });

  it("still renders an ordinary single-style span unwrapped by any other key, keeping the common case unchanged", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "foo " }, { text: "bar", bold: true }],
        },
      ]),
      { emphasisMarker: "*" },
    );
    expect(markdown).toBe("foo **bar**");
  });

  it("round-trips a whole hyperlink group's own inner emphasis/strong/code-span nesting (CommonMark spec 0.31.2 example 516)", () => {
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "link ", hyperlink: "/uri" },
            { text: "foo ", italic: true, hyperlink: "/uri" },
            { text: "bar", italic: true, bold: true, hyperlink: "/uri" },
            { text: " ", italic: true, hyperlink: "/uri" },
            {
              text: "#",
              italic: true,
              hyperlink: "/uri",
              fontFamily: "Courier New",
            },
          ],
        },
      ]),
      { emphasisMarker: "*" },
    );
    expect(markdown).toBe("[link *foo **bar** `#`*](/uri)");
  });
});

describe("gaps (MarkdownDiagnosticCodes)", () => {
  it("HEADING_LEVEL_CLAMPED fires when a styleId exceeds Heading6", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([{ kind: "paragraph", runs: [{ text: "x" }], styleId: "Heading9" }]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("###### x");
    expect(collector.has(MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED)).toBe(
      true,
    );
    const diagnostic = collector.diagnostics.find(
      (d) => d.code === MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED,
    );
    expect(diagnostic?.message).toContain("9");
    expect(diagnostic?.message).toContain("6");
  });

  it("ADJACENT_LINKS_MERGED fires when two consecutive runs share a hyperlink", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [
            { text: "a", hyperlink: "http://x" },
            { text: "b", hyperlink: "http://x" },
          ],
        },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("[ab](http://x)");
    expect(collector.has(MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED)).toBe(
      true,
    );
  });

  it("CODE_SPAN_AS_MONOSPACE_RUN fires for a Courier New run", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "x", fontFamily: "Courier New" }] },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("`x`");
    expect(
      collector.has(MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN),
    ).toBe(true);
  });

  it("PARAGRAPH_INDENT_DROPPED fires for indentLeftPt with no quotable styleId, and the indent is dropped", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([{ kind: "paragraph", runs: [{ text: "x" }], indentLeftPt: 20 }]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("x");
    expect(
      collector.has(MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED),
    ).toBe(true);
    expect(
      collector.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED,
      )?.message,
    ).toBe(
      "paragraph carries indentLeftPt (20pt) with no styleId this package recognises as quotable; the indent has no other markdown representation and is dropped",
    );
  });

  it("does NOT report PARAGRAPH_INDENT_DROPPED for a paragraph carrying no indent at all, whose quote depth is already zero before any styleId question arises", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([{ kind: "paragraph", runs: [{ text: "x" }] }]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("x");
    expect(
      collector.has(MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED),
    ).toBe(false);
  });

  it("PARAGRAPH_INDENT_DROPPED also fires for a DEFINED but unrecognised styleId carrying indentLeftPt, not only an absent styleId — isQuotableStyle's own QUOTABLE_STYLE_IDS/heading check must actually run, not just its undefined short-circuit", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          styleId: "SomeUnrecognisedStyle",
          indentLeftPt: 36,
        },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("x");
    expect(markdown).not.toContain(">");
    expect(
      collector.has(MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED),
    ).toBe(true);
  });

  it("LIST_NUMID_FALLBACK fires for a numId this package never minted, falling back to a plain bullet", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          list: { numId: "list1", level: 0 },
        },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("- x");
    expect(collector.has(MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK)).toBe(
      true,
    );
    const diagnostic = collector.diagnostics.find(
      (d) => d.code === MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
    );
    expect(diagnostic?.message).toContain("list1");
    expect(diagnostic?.message).toContain("not minted");
  });

  it("LIST_NUMID_FALLBACK fires only once for two items sharing the SAME never-minted numId, not once per item", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "list1", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "list1", level: 0 },
        },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("- a\n- b");
    expect(
      collector.diagnostics.filter(
        (d) => d.code === MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
      ),
    ).toHaveLength(1);
  });

  it("LIST_NUMID_FALLBACK fires once for depth-only memberships with no numId, falling back to one tight plain-bullet list", () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([
        { kind: "paragraph", runs: [{ text: "x" }], list: { level: 0 } },
        { kind: "paragraph", runs: [{ text: "y" }], list: { level: 1 } },
      ]),
      { sink: collector.sink },
    );
    expect(markdown).toBe("- x\n  - y");
    const fallbacks = collector.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
    );
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.message).toContain("no numId");
  });

  it("TABLE_CELL_FORMATTING_DROPPED fires for a non-paragraph/non-image/non-lone-nested-table cell block even inside the HTML-table fallback, once colSpan already triggers it", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "i" }] }] },
          ],
        },
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "x" }] },
                { kind: "pageBreak" },
              ],
              colSpan: 2,
            },
            { blocks: [] },
          ],
        },
      ],
    };
    const markdown = emitMarkdown(doc([table]), { sink: collector.sink });
    expect(markdown).toContain('colspan="2"');
    expect(collector.has(MarkdownDiagnosticCodes.TABLE_HTML_FALLBACK)).toBe(
      true,
    );
    expect(
      collector.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === MarkdownDiagnosticCodes.TABLE_HTML_FALLBACK,
      )?.message,
    ).toBe(
      "a cell in this table needs colSpan/rowSpan/background, or holds a block a GFM table cell cannot represent at all (most commonly a nested table); GFM's own table extension holds inline content only (github.github.com/gfm, \"Tables (extension)\"), so no single cell can carry an HTML sub-block inside an otherwise pipe-syntax table — the whole table is rendered as a raw HTML <table> block instead (CommonMark spec 0.31.2, HTML blocks condition 6, https://spec.commonmark.org/0.31.2/#html-blocks), which src/html/html-table.ts's own reader recognises back into an equal ContentTable",
    );
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED),
    ).toBe(true);
  });

  it("TABLE_CELL_MULTI_PARAGRAPH_JOINED fires for a cell with more than one paragraph, and the text joins with a literal <br>", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "one" }] },
                { kind: "paragraph", runs: [{ text: "two" }] },
              ],
            },
          ],
        },
      ],
    };
    const markdown = emitMarkdown(doc([table]), { sink: collector.sink });
    expect(markdown).toContain("one<br>two");
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED),
    ).toBe(true);
    expect(
      collector.diagnostics.find(
        (diagnostic) =>
          diagnostic.code ===
          MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED,
      )?.message,
    ).toBe(
      "a table cell with 2 blocks has no multi-paragraph equivalent in a GFM table cell; their own rendered text is joined with a literal <br> line break",
    );
  });

  it("does not fire TABLE_CELL_MULTI_PARAGRAPH_JOINED for a cell with exactly one block", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "one" }] }] }],
        },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED),
    ).toBe(false);
  });

  it("TABLE_CELL_IMAGE_DEGRADED fires for an image-kind cell block, which emits inline rather than being dropped", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                {
                  kind: "image",
                  format: "png",
                  base64: "aGVsbG8=",
                  widthPt: 10,
                  heightPt: 10,
                  altText: "a cell image",
                },
              ],
            },
          ],
        },
      ],
    };
    const markdown = emitMarkdown(doc([table]), { sink: collector.sink });
    expect(markdown).toContain(
      "![a cell image](data:image/png;base64,aGVsbG8=)",
    );
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_CELL_IMAGE_DEGRADED),
    ).toBe(true);
    expect(
      collector.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === MarkdownDiagnosticCodes.TABLE_CELL_IMAGE_DEGRADED,
      )?.message,
    ).toBe(
      "a table cell's own image block has no GFM table equivalent; it emits inline instead, degrading on read-back to a run carrying the alt text with the image's data as that run's hyperlink",
    );
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED),
    ).toBe(false);
  });

  it("joins a cell's own paragraphs skipping any that render to empty text, without an extra <br>", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [] },
                { kind: "paragraph", runs: [{ text: "one" }] },
              ],
            },
          ],
        },
      ],
    };
    expect(emitMarkdown(doc([table]))).toContain("| one |");
  });

  it("round-trips a table cell image as a run carrying the alt text with the image's own data as that run's hyperlink, the same shape a nested image inside emphasis/a link already degrades to", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                {
                  kind: "image",
                  format: "png",
                  base64: "aGVsbG8=",
                  widthPt: 10,
                  heightPt: 10,
                  altText: "a cell image",
                },
              ],
            },
          ],
        },
      ],
    };
    const markdown = emitMarkdown(doc([table]));
    const reread = lowerMarkdown(markdown);
    if (reread.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const rereadTable = reread.sections[0]?.blocks[0];
    if (rereadTable?.kind !== "table") {
      throw new Error("expected a table block");
    }
    const cell = rereadTable.rows[1]?.cells[0];
    const run =
      cell?.blocks[0]?.kind === "paragraph"
        ? cell.blocks[0].runs[0]
        : undefined;
    expect(run?.text).toBe("a cell image");
    expect(run?.hyperlink).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("round-trips a <br>-joined multi-paragraph cell as one run whose text contains a literal <br>, quarantined as raw-HTML residue rather than corrupting the surrounding text", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "one" }] },
                { kind: "paragraph", runs: [{ text: "two" }] },
              ],
            },
          ],
        },
      ],
    };
    const markdown = emitMarkdown(doc([table]));
    const reread = lowerMarkdown(markdown);
    if (reread.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const rereadTable = reread.sections[0]?.blocks[0];
    if (rereadTable?.kind !== "table") {
      throw new Error("expected a table block");
    }
    const cell = rereadTable.rows[1]?.cells[0];
    const text =
      cell?.blocks[0]?.kind === "paragraph"
        ? cell.blocks[0].runs.map((run) => run.text).join("")
        : undefined;
    expect(text).toBe("one<br>two");
  });
});
