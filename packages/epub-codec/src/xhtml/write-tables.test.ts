// The table write suites split from write.test.ts: the table round-trip cases and the grid-rule cases move together, sharing that suite's write/re-read harness.

import type { ContentBlock } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { EpubDiagnostic } from "../diagnostics";
import {
  EpubDiagnosticCodes,
  EpubTableGridFaultError,
  EpubWriteError,
} from "../diagnostics";
import { readXhtmlBody } from "./read";
import { buildXml } from "../xml/build";
import { writeXhtmlBody } from "./write";

const CONTENT_WIDTH_PT = 451.28;

function xhtmlDocument(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${inner}</body></html>`;
}

function write(blocks: readonly ContentBlock[]): string {
  return writeWithSink(blocks, () => undefined).xml;
}

function writeWithSink(
  blocks: readonly ContentBlock[],
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

function cellTagCountsPerRow(markup: string): number[] {
  return [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map(
    (row) => (row[1] ?? "").split("<td").length - 1,
  );
}

function roundTrip(blocks: readonly ContentBlock[]): ContentBlock[] {
  const xml = write(blocks);
  return readXhtmlBody(xml, {
    resolveImage: () => undefined,
    sink: () => undefined,
    sourceHref: "chapter1.xhtml",
    contentWidthPt: CONTENT_WIDTH_PT,
  }).blocks;
}

describe("writeXhtmlBody: tables", () => {
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

  function thrownBy(blocks: readonly ContentBlock[]): unknown {
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
