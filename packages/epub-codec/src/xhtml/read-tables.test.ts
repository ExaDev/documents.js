// The table suite split from read.test.ts: it consumes the readTableGrid/describeCell grid-summary harness that suite carries, restated here with it.

import type { ContentTableCell, ContentTableRow } from "document-schema.js";
import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic, EpubDiagnosticSink } from "../diagnostics";
import { readXhtmlBody } from "./read";

const CONTENT_WIDTH_PT = 451.28;
const FAKE_IMAGE_WIDTH_PX = 96; // A4 minus 1in margins each side, matching src/read.ts's own default section geometry
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
    const columnCount = 3;
    const { grid, columnWidthsPt } = readTableGrid(
      '<table><tr><td colspan="3">wide</td></tr></table>',
    );
    expect(grid).toEqual([["wide|c3", "", ""]]);
    expect(columnWidthsPt).toEqual([
      CONTENT_WIDTH_PT / columnCount,
      CONTENT_WIDTH_PT / columnCount,
      CONTENT_WIDTH_PT / columnCount,
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
    const expectedColumnCount = 3;
    expect(columnWidthsPt).toHaveLength(expectedColumnCount);
  });

  it("treats a zero or negative colspan or rowspan as absent, rather than a real span", () => {
    // One cell per row, so that a wrongly retained zero span could not be masked by a neighbouring cell being placed over the same grid column.
    const expectedRowCount = 4;
    const table = read(
      body(
        '<table><tr><td colspan="0">a</td></tr><tr><td colspan="-1">b</td></tr><tr><td rowspan="0">c</td></tr><tr><td rowspan="-1">d</td></tr></table>',
      ),
    ).find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    expect(table.rows).toHaveLength(expectedRowCount);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(1);
      for (const cell of row.cells) {
        expect(Object.hasOwn(cell, "colSpan")).toBe(false);
        expect(Object.hasOwn(cell, "rowSpan")).toBe(false);
      }
    }
  });

  it("honours a cell's own rowspan attribute, distinctly from colspan", () => {
    const expectedRowSpan = 3;
    const table = read(
      body('<table><tr><td rowspan="3">tall</td></tr></table>'),
    ).find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    const cell = table.rows[0]?.cells[0];
    expect(cell?.rowSpan).toBe(expectedRowSpan);
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
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
    const expectedBlockCount = 3;
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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
    expect(blocks).toHaveLength(expectedBlockCount);
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const sink = vi.fn<EpubDiagnosticSink>();
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
    const sink = vi.fn<EpubDiagnosticSink>();
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
