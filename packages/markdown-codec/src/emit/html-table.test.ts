// Construct-by-construct tests for the write-side HTML-table fallback itself (ExaDev/documents.js#1089). src/table-html-fallback.test.ts covers the full write -> read round trip through the public surface, and src/html/html-table.test.ts does the same for the read side; this file exercises emitHtmlTable/tableNeedsHtmlFallback directly, so each attribute, each escape, and each degradation this bounded writer reports rather than represents gets its own assertion on the exact HTML produced.

import type {
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics";
import { MONOSPACE_FONT_FAMILY } from "../shared/style-constants";
import type { DiagnosticCollector } from "../test-support/diagnostics";
import { createDiagnosticCollector } from "../test-support/diagnostics";
import { emitHtmlTable, tableNeedsHtmlFallback } from "./html-table";

// This writer never reads a table's own columnWidthsPt (an HTML table carries no absolute column widths it attempts to write), so every fixture here shares one arbitrary but schema-valid width.
const COLUMN_WIDTH_PT = 100;

// The emphasis marker belongs to the shared InlineEmitContext this module's own context extends, but nothing in the HTML writer consults it: a cell's inline formatting is written as real HTML tags, never markdown punctuation.
const EMPHASIS_MARKER = "*";

// A real, minimal 1x1 PNG, the identical fixture src/html/html-table.test.ts's own image tests already use.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// A 1x1 PNG measures one CSS reference pixel each way, which document-schema.js's own point-based geometry records as 72/96 pt.
const ONE_PIXEL_PT = 72 / 96;

// Every fixture below puts the cell under test in a BODY row behind one fixed header row, so each assertion reads the <td> spelling rather than the header row's own <th>.
const HEADER_TEXT = "h";

function paragraphCell(text: string): ContentTableCell {
  return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
}

// A covered position of a merged region: a real cell that holds no blocks, its content belonging to the anchor.
const COVERED_CELL: ContentTableCell = { blocks: [] };

// The number of cell tags (<th> or <td>) in each <tr>, in document order.
function cellTagCountsPerRow(markup: string): number[] {
  return [...markup.matchAll(/<tr>(.*?)<\/tr>/g)].map(
    (row) => (row[1] ?? "").split(/<t[dh]\b/).length - 1,
  );
}

function tableOfRows(rows: readonly ContentTableRow[]): ContentTable {
  return { kind: "table", columnWidthsPt: [COLUMN_WIDTH_PT], rows: [...rows] };
}

function tableWithBodyCell(cell: ContentTableCell): ContentTable {
  return tableOfRows([
    { cells: [paragraphCell(HEADER_TEXT)] },
    { cells: [cell] },
  ]);
}

// The complete HTML tableWithBodyCell's own fixture renders to, given the body row's own inner markup. It is spelled out here independently of the writer so the surrounding scaffolding (the <table> wrapper, the header row's own <th>, the line breaks between rows) is asserted by every case rather than assumed.
function expectedHtml(bodyRowInner: string): string {
  return [
    "<table>",
    `<tr><th>${HEADER_TEXT}</th></tr>`,
    `<tr>${bodyRowInner}</tr>`,
    "</table>",
  ].join("\n");
}

interface EmitResult {
  readonly html: string;
  readonly collector: DiagnosticCollector;
}

function emit(table: ContentTable, embedImages = true): EmitResult {
  const collector = createDiagnosticCollector();
  const html = emitHtmlTable(table, {
    sink: collector.sink,
    emphasisMarker: EMPHASIS_MARKER,
    embedImages,
  });
  return { html, collector };
}

describe("tableNeedsHtmlFallback", () => {
  it("is false when every cell holds only paragraph blocks and no span or background", () => {
    expect(tableNeedsHtmlFallback(tableWithBodyCell(paragraphCell("a")))).toBe(
      false,
    );
  });

  it("is true for a cell mixing a representable block with one a plain GFM cell cannot hold", () => {
    const cell: ContentTableCell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "a" }] },
        { kind: "pageBreak" },
      ],
    };
    expect(tableNeedsHtmlFallback(tableWithBodyCell(cell))).toBe(true);
  });

  it("is false for a table with an empty cell but no span or background, since a block-less cell alone needs nothing a plain GFM cell cannot hold", () => {
    expect(
      tableNeedsHtmlFallback(
        tableOfRows([
          { cells: [paragraphCell("h"), COVERED_CELL] },
          { cells: [paragraphCell("a"), paragraphCell("b")] },
        ]),
      ),
    ).toBe(false);
  });

  it("is true for a merged table, whose covered entries are block-less but whose anchor carries the span", () => {
    expect(
      tableNeedsHtmlFallback(
        tableOfRows([
          { cells: [paragraphCell("h"), paragraphCell("i")] },
          { cells: [{ ...paragraphCell("wide"), colSpan: 2 }, COVERED_CELL] },
        ]),
      ),
    ).toBe(true);
  });

  it("is true for a colSpan, a rowSpan or a background on any cell anywhere", () => {
    expect(
      tableNeedsHtmlFallback(
        tableWithBodyCell({ ...paragraphCell("a"), colSpan: 2 }),
      ),
    ).toBe(true);
    expect(
      tableNeedsHtmlFallback(
        tableWithBodyCell({ ...paragraphCell("a"), rowSpan: 2 }),
      ),
    ).toBe(true);
    expect(
      tableNeedsHtmlFallback(
        tableWithBodyCell({
          ...paragraphCell("a"),
          background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
        }),
      ),
    ).toBe(true);
  });
});

describe("emitHtmlTable", () => {
  it("writes a header row of <th> and every later row of <td>, one row per line", () => {
    const { html, collector } = emit(tableWithBodyCell(paragraphCell("a")));
    expect(html).toBe(expectedHtml("<td>a</td>"));
    expect(collector.diagnostics).toEqual([]);
  });

  it("writes a table with no rows at all as a bare empty <table> element", () => {
    const { html } = emit(tableOfRows([]));
    expect(html).toBe("<table>\n</table>");
  });

  it("escapes &, < and > in a cell's own text", () => {
    const { html } = emit(tableWithBodyCell(paragraphCell("a & b < c > d")));
    expect(html).toBe(expectedHtml("<td>a &amp; b &lt; c &gt; d</td>"));
  });

  it("escapes a double quote in an attribute value, on top of that same text escaping", () => {
    const cell: ContentTableCell = {
      blocks: [
        {
          kind: "paragraph",
          runs: [{ text: "link", hyperlink: 'https://example.com/?q="x"&y' }],
        },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell));
    expect(html).toBe(
      expectedHtml(
        '<td><a href="https://example.com/?q=&quot;x&quot;&amp;y">link</a></td>',
      ),
    );
  });

  it("wraps a run's own styles in real HTML tags, the code span innermost and the hyperlink outermost", () => {
    const cell: ContentTableCell = {
      blocks: [
        {
          kind: "paragraph",
          runs: [
            {
              text: "all",
              bold: true,
              italic: true,
              strike: true,
              fontFamily: MONOSPACE_FONT_FAMILY,
              hyperlink: "https://example.com",
            },
          ],
        },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell));
    expect(html).toBe(
      expectedHtml(
        '<td><a href="https://example.com"><strong><em><del><code>all</code></del></em></strong></a></td>',
      ),
    );
  });

  it("writes a Courier New run as a code span and nothing else", () => {
    const cell: ContentTableCell = {
      blocks: [
        {
          kind: "paragraph",
          runs: [{ text: "mono", fontFamily: MONOSPACE_FONT_FAMILY }],
        },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell));
    expect(html).toBe(expectedHtml("<td><code>mono</code></td>"));
  });

  it("embeds an image block's own bytes as a data: URI when the emitter is embedding images", () => {
    const cell: ContentTableCell = {
      blocks: [
        {
          kind: "image",
          format: "png",
          base64: ONE_PIXEL_PNG_BASE64,
          widthPt: ONE_PIXEL_PT,
          heightPt: ONE_PIXEL_PT,
          altText: "a pixel",
        },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell));
    expect(html).toBe(
      expectedHtml(
        `<td><img src="data:image/png;base64,${ONE_PIXEL_PNG_BASE64}" alt="a pixel"></td>`,
      ),
    );
  });

  it("writes an <img> carrying no src at all when the emitter is not embedding images", () => {
    const cell: ContentTableCell = {
      blocks: [
        {
          kind: "image",
          format: "png",
          base64: ONE_PIXEL_PNG_BASE64,
          widthPt: ONE_PIXEL_PT,
          heightPt: ONE_PIXEL_PT,
          altText: "a pixel",
        },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell), false);
    expect(html).toBe(expectedHtml('<td><img alt="a pixel"></td>'));
  });

  it("writes an empty alt for an image block carrying no altText of its own", () => {
    const cell: ContentTableCell = {
      blocks: [
        {
          kind: "image",
          format: "png",
          base64: ONE_PIXEL_PNG_BASE64,
          widthPt: ONE_PIXEL_PT,
          heightPt: ONE_PIXEL_PT,
        },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell));
    expect(html).toBe(
      expectedHtml(
        `<td><img src="data:image/png;base64,${ONE_PIXEL_PNG_BASE64}" alt=""></td>`,
      ),
    );
  });

  it("writes colspan and rowspan as attributes, in that order, ahead of any style", () => {
    const anchor: ContentTableCell = {
      ...paragraphCell("a"),
      colSpan: 2,
      rowSpan: 2,
      background: { kind: "solid", color: { r: 0, g: 0, b: 1 } },
    };
    const { html } = emit(
      tableOfRows([
        { cells: [paragraphCell("h"), paragraphCell("i")] },
        { cells: [anchor, COVERED_CELL] },
        { cells: [COVERED_CELL, COVERED_CELL] },
      ]),
    );
    expect(html).toBe(
      [
        "<table>",
        "<tr><th>h</th><th>i</th></tr>",
        '<tr><td colspan="2" rowspan="2" style="background-color:#0000ff">a</td></tr>',
        "<tr></tr>",
        "</table>",
      ].join("\n"),
    );
  });

  it("writes no cell tag for the covered entry of a colspan", () => {
    const { html } = emit(
      tableOfRows([
        { cells: [paragraphCell("h"), paragraphCell("i"), paragraphCell("j")] },
        {
          cells: [
            { ...paragraphCell("wide"), colSpan: 2 },
            COVERED_CELL,
            paragraphCell("x"),
          ],
        },
      ]),
    );
    expect(cellTagCountsPerRow(html)).toEqual([3, 2]);
    expect(html).toContain('<td colspan="2">wide</td><td>x</td>');
  });

  it("writes no cell tag in the row below for the position a rowspan covers", () => {
    const { html } = emit(
      tableOfRows([
        { cells: [paragraphCell("h"), paragraphCell("i")] },
        {
          cells: [{ ...paragraphCell("tall"), rowSpan: 2 }, paragraphCell("a")],
        },
        { cells: [COVERED_CELL, paragraphCell("b")] },
      ]),
    );
    expect(cellTagCountsPerRow(html)).toEqual([2, 2, 1]);
    expect(html).toContain("<tr><td>b</td></tr>");
  });

  it("writes a covered position in the header row as no tag, and the row below as ordinary <td>", () => {
    const { html } = emit(
      tableOfRows([
        { cells: [{ ...paragraphCell("h"), rowSpan: 2 }, paragraphCell("i")] },
        { cells: [COVERED_CELL, paragraphCell("a")] },
      ]),
    );
    expect(html).toBe(
      [
        "<table>",
        '<tr><th rowspan="2">h</th><th>i</th></tr>',
        "<tr><td>a</td></tr>",
        "</table>",
      ].join("\n"),
    );
  });

  it("writes a cell's own first paragraph's alignment as a text-align style", () => {
    const cell: ContentTableCell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "a" }], alignment: "center" },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell));
    expect(html).toBe(expectedHtml('<td style="text-align:center">a</td>'));
  });

  it("writes no text-align for a cell whose own first block is not a paragraph at all", () => {
    const cell: ContentTableCell = {
      blocks: [
        {
          kind: "image",
          format: "png",
          base64: ONE_PIXEL_PNG_BASE64,
          widthPt: ONE_PIXEL_PT,
          heightPt: ONE_PIXEL_PT,
          altText: "a pixel",
        },
      ],
    };
    const { html } = emit(tableWithBodyCell(cell), false);
    expect(html).toBe(expectedHtml('<td><img alt="a pixel"></td>'));
  });

  it("joins a solid background and an alignment into one semicolon-separated style attribute", () => {
    const cell: ContentTableCell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "a" }], alignment: "right" },
      ],
      background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
    };
    const { html } = emit(tableWithBodyCell(cell));
    expect(html).toBe(
      expectedHtml(
        '<td style="background-color:#ff0000;text-align:right">a</td>',
      ),
    );
  });

  it("reports a pattern background fill as dropped and writes no style attribute for it", () => {
    const cell: ContentTableCell = {
      ...paragraphCell("x"),
      background: { kind: "pattern", patternType: "percent25" },
    };
    const { html, collector } = emit(tableWithBodyCell(cell));
    expect(html).toBe(expectedHtml("<td>x</td>"));
    expect(collector.diagnostics).toEqual([
      {
        code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
        severity: "info",
        message:
          "a table cell's own pattern background fill has no CSS equivalent this package's bounded HTML-table writer attempts (only a solid fill maps onto a plain background-color); the cell still renders as an ordinary unstyled cell",
      },
    ]);
  });

  it("joins a multi-block cell's own rendered content with a literal <br> and reports the join", () => {
    const cell: ContentTableCell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "first" }] },
        { kind: "paragraph", runs: [{ text: "second" }] },
      ],
    };
    const { html, collector } = emit(tableWithBodyCell(cell));
    expect(html).toBe(expectedHtml("<td>first<br>second</td>"));
    expect(collector.diagnostics).toEqual([
      {
        code: MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED,
        severity: "info",
        message:
          "a table cell with 2 blocks has no multi-block equivalent in an HTML table cell either; their own rendered content is joined with a literal <br> line break",
      },
    ]);
  });

  it("renders a cell whose entire content is one nested table as a nested <table> element", () => {
    const nested: ContentTable = tableOfRows([{ cells: [paragraphCell("n")] }]);
    const { html, collector } = emit(tableWithBodyCell({ blocks: [nested] }));
    expect(html).toBe(
      expectedHtml("<td><table>\n<tr><th>n</th></tr>\n</table></td>"),
    );
    expect(collector.diagnostics).toEqual([]);
  });

  it("drops a nested table mixed with sibling content in the same cell, keeping the sibling", () => {
    const nested: ContentTable = tableOfRows([{ cells: [paragraphCell("n")] }]);
    const cell: ContentTableCell = {
      blocks: [nested, { kind: "paragraph", runs: [{ text: "kept" }] }],
    };
    const { html, collector } = emit(tableWithBodyCell(cell));
    expect(html).toBe(expectedHtml("<td>kept</td>"));
    expect(collector.codes()).toEqual([
      MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED,
      MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
    ]);
    expect(collector.diagnostics[1]?.message).toBe(
      "a nested table mixed with other content in the same cell has no HTML representation this package attempts (a cell's own nested table must be its entire content); it is dropped, the cell's other content still renders",
    );
  });

  it("drops a block kind the fallback has no equivalent for, naming that kind in the diagnostic", () => {
    const cell: ContentTableCell = {
      blocks: [
        { kind: "paragraph", runs: [{ text: "kept" }] },
        { kind: "pageBreak" },
      ],
    };
    const { html, collector } = emit(tableWithBodyCell(cell));
    expect(html).toBe(expectedHtml("<td>kept</td>"));
    expect(collector.codes()).toEqual([
      MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED,
      MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
    ]);
    expect(collector.diagnostics[1]?.message).toBe(
      'a table cell containing a "pageBreak" block has no HTML-table equivalent this package attempts; it is dropped entirely',
    );
  });
});
