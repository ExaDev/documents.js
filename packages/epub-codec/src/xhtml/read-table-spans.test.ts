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

describe("tables: spans and coverage", () => {
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
});
