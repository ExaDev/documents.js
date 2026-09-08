// The HTML-table fallback end to end (ExaDev/documents.js#1089): a ContentTable carrying colSpan/rowSpan/background/a nested block -- none of which GFM's own pipe-table grammar can express (github.github.com/gfm, "Tables (extension)": a cell holds inline content only) -- written through src/emit/html-table.ts and read back through src/html/html-table.ts. The point of this file is the round trip specifically: not that each direction works in isolation (src/emit/emit.test.ts and src/html/html-table.test.ts already cover that construct by construct), but that a table written via the fallback reads back into an EQUAL ContentTable, which is the entire gap ExaDev/documents.js#977 left open -- see that issue and this package's own README "HTML-table fallback" section for the full framing.

import type { ContentDocument, ContentTable } from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARGINS } from "./defaults/defaults";
import { readMarkdownContent } from "./read";
import { writeMarkdownContent } from "./write";

const CONTENT_WIDTH_PT =
  PAGE_SIZE_A4.widthPt - DEFAULT_MARGINS.leftPt - DEFAULT_MARGINS.rightPt;

function evenWidths(columnCount: number): number[] {
  return Array.from(
    { length: columnCount },
    () => CONTENT_WIDTH_PT / columnCount,
  );
}

function doc(table: ContentTable): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      { pageSize: PAGE_SIZE_A4, margins: DEFAULT_MARGINS, blocks: [table] },
    ],
  };
}

// Round-trips `table` through the real public surface (writeMarkdownContent -> readMarkdownContent, the identical pair src/footnote.test.ts's own round-trip tests use) and returns the ContentTable that comes back, plus the markdown text itself for callers that also want to assert on the raw HTML shape.
function roundTrip(table: ContentTable): {
  readonly markdown: string;
  readonly table: ContentTable;
} {
  const markdown = writeMarkdownContent(doc(table));
  const { document } = readMarkdownContent(markdown);
  if (document.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing document, got '${document.kind}'`,
    );
  }
  const block = document.sections[0]?.blocks[0];
  if (block?.kind !== "table") {
    throw new Error(`expected a table block, got '${block?.kind}'`);
  }
  return { markdown, table: block };
}

describe("HTML-table fallback round trip", () => {
  it("colSpan survives write -> read as an equal ContentTable", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(2),
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
          ],
        },
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "merged" }] }],
              colSpan: 2,
            },
          ],
        },
      ],
    };
    const { markdown, table: read } = roundTrip(table);
    expect(markdown).toContain('colspan="2"');
    expect(read).toEqual(table);
  });

  it("rowSpan survives write -> read as an equal ContentTable", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(2),
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
          ],
        },
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "spans down" }] }],
              rowSpan: 2,
            },
            { blocks: [{ kind: "paragraph", runs: [{ text: "1" }] }] },
          ],
        },
        {
          cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "2" }] }] }],
        },
      ],
    };
    const { markdown, table: read } = roundTrip(table);
    expect(markdown).toContain('rowspan="2"');
    expect(read).toEqual(table);
  });

  it("a solid cell background survives write -> read as an equal ContentTable", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(1),
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "highlighted" }] }],
              background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
            },
          ],
        },
      ],
    };
    const { markdown, table: read } = roundTrip(table);
    expect(markdown).toContain("background-color:#ff0000");
    expect(read).toEqual(table);
  });

  it("a nested table as a cell's entire content survives write -> read as an equal ContentTable", () => {
    const nested: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(2),
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "n1" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "n2" }] }] },
          ],
        },
      ],
    };
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(2),
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "outer" }] }] },
            { blocks: [nested] },
          ],
        },
      ],
    };
    const { markdown, table: read } = roundTrip(table);
    // Two <table> elements: the outer fallback and the nested one inside its own cell.
    expect(markdown.match(/<table>/g)).toHaveLength(2);
    expect(read).toEqual(table);
  });

  it("a nested table forces the fallback even when no cell anywhere needs colSpan/rowSpan/background", () => {
    const nested: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(1),
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "n" }] }] }] },
      ],
    };
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(1),
      rows: [{ cells: [{ blocks: [nested] }] }],
    };
    const { markdown, table: read } = roundTrip(table);
    expect(markdown).not.toContain("| n |");
    expect(read).toEqual(table);
  });

  it("multi-paragraph cell content joins with <br> and survives write -> read once the table is already using the HTML fallback for another reason", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(1),
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "first" }] },
                { kind: "paragraph", runs: [{ text: "second" }] },
              ],
              colSpan: 1,
            },
          ],
        },
      ],
    };
    const { markdown, table: read } = roundTrip(table);
    expect(markdown).toContain("first<br>second");
    expect(read).toEqual(table);
  });

  it("bold/italic/strike/hyperlink run formatting round-trips through real HTML tags rather than markdown syntax", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(2),
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
          ],
        },
        {
          cells: [
            {
              blocks: [
                {
                  kind: "paragraph",
                  runs: [
                    { text: "bold", bold: true },
                    { text: "italic", italic: true },
                    { text: "struck", strike: true },
                    { text: "link", hyperlink: "https://example.com" },
                  ],
                },
              ],
              colSpan: 2,
            },
          ],
        },
      ],
    };
    const { markdown, table: read } = roundTrip(table);
    expect(markdown).toContain("<strong>bold</strong>");
    expect(markdown).toContain("<em>italic</em>");
    expect(markdown).toContain("<del>struck</del>");
    expect(markdown).toContain('<a href="https://example.com">link</a>');
    expect(read).toEqual(table);
  });

  it("a table with none of these needs still writes as plain GFM pipe syntax, unaffected by this fallback", () => {
    const table: ContentTable = {
      kind: "table",
      columnWidthsPt: evenWidths(1),
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }] },
      ],
    };
    const { markdown } = roundTrip(table);
    expect(markdown).toBe("| a |\n| --- |");
  });
});
