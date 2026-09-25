// The table suite split from read.test.ts: it consumes the readTableGrid/describeCell grid-summary harness that suite carries, restated here with it.

import type { ContentTableCell, ContentTableRow } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { EpubDiagnostic } from "../diagnostics";
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
// 12 // 16 // 20 // 24 // 13; // 33;;

// A minimal PNG carrying only what src/image/dimensions.ts reads: the 8-byte signature plus an IHDR chunk.

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
});
