// The table suites split from emit.test.ts, sharing the doc/diagnostics harness and carrying the grid-fault cases.

import type {
  ContentBlock,
  ContentDocument,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARGINS } from "../defaults/defaults";
import {
  MarkdownDiagnosticCodes,
  MarkdownTableGridFaultError,
  MarkdownWriteError,
} from "../diagnostics/diagnostics";
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

describe("tables", () => {
  it("emits an empty string for a table with no rows at all, rather than a header/delimiter line of nothing", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [],
      rows: [],
    };
    expect(emitMarkdown(doc([table]))).toBe("");
  });

  it("renders a table whose header row is not the first through the HTML fallback, where the flag can be stated", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }] },
        {
          cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }],
          isHeader: true,
        },
      ],
    };
    const out = emitMarkdown(doc([table]));
    expect(out).toContain("<tr><td>a</td></tr>");
    expect(out).toContain("<tr><th>h</th></tr>");
  });

  it("renders a table whose only header row is the first as an ordinary pipe table", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        {
          cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }],
          isHeader: true,
        },
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }] },
      ],
    };
    expect(emitMarkdown(doc([table]))).toContain("| h |");
  });

  it("does NOT fire TABLE_HEADER_ROW_SYNTHESISED when the first row states isHeader: true", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        {
          cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }],
          isHeader: true,
        },
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }] },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_HEADER_ROW_SYNTHESISED),
    ).toBe(false);
  });

  it("fires TABLE_HEADER_ROW_SYNTHESISED with a message naming the synthesis when the first row states no header at all", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] }] },
        { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] }] },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    const [diagnostic] = collector.diagnostics.filter(
      (entry) =>
        entry.code === MarkdownDiagnosticCodes.TABLE_HEADER_ROW_SYNTHESISED,
    );
    expect(diagnostic?.message).toContain("states no header row");
  });

  it("does NOT fire TABLE_HEADER_COLUMN_DROPPED when no column states isHeader", () => {
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
          isHeader: true,
        },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED),
    ).toBe(false);
  });

  it("fires TABLE_HEADER_COLUMN_DROPPED with a message naming the drop when even one column states isHeader", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100, isHeader: true }],
      rows: [
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "i" }] }] },
          ],
          isHeader: true,
        },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    const [diagnostic] = collector.diagnostics.filter(
      (entry) =>
        entry.code === MarkdownDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
    );
    expect(diagnostic?.message).toContain("header column");
  });

  it("fires TABLE_HEADER_COLUMN_DROPPED through the HTML fallback path too, since that grammar cannot state a header column either", () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            {
              blocks: [{ kind: "paragraph", runs: [{ text: "h" }] }],
              colSpan: 2,
            },
            { blocks: [] },
          ],
          isHeader: true,
        },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.TABLE_HTML_FALLBACK)).toBe(
      true,
    );
    expect(
      collector.has(MarkdownDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED),
    ).toBe(true);
  });

  it("emits alignment markers read from the header row's own cell alignment", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            {
              blocks: [
                { kind: "paragraph", runs: [{ text: "a" }], alignment: "left" },
              ],
            },
            {
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "b" }],
                  alignment: "right",
                },
              ],
            },
          ],
        },
        {
          cells: [
            { blocks: [{ kind: "paragraph", runs: [{ text: "1" }] }] },
            { blocks: [{ kind: "paragraph", runs: [{ text: "2" }] }] },
          ],
        },
      ],
    };
    expect(emitMarkdown(doc([table]))).toBe(
      "| a | b |\n| :--- | ---: |\n| 1 | 2 |",
    );
  });

  it("collapses a soft-break residue run to a space rather than a literal newline that would corrupt the row", () => {
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
                  runs: [
                    { text: "foo" },
                    { text: " ", source: { format: "markdown", xml: "\n" } },
                    { text: "bar" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const markdown = emitMarkdown(doc([table]));
    expect(markdown).toBe("| foo bar |\n| --- |");
    expect(markdown.split("\n")).toHaveLength(2);
  });

  it.each([
    { name: "a bare CR", xml: "\r" },
    { name: "a bare CRLF", xml: "\r\n" },
  ])(
    "collapses $name residue run to a space rather than a raw line ending that would fracture the row (ExaDev/documents.js#940)",
    ({ xml }) => {
      // CommonMark's own line-ending grammar (spec 0.31.2, "Lines") is LF, CRLF, or a lone CR — not LF alone. renderParagraphBody's own ATX-heading collapse already treats all three as a genuine line ending (LINE_ENDING_PATTERN); emitRunsSingleLine has to as well, since a foreign producer's own markdown residue (re-emitted verbatim, unescaped, by src/emit/inline.ts's renderLeaf) can carry a bare CR or CRLF just as legitimately as the LF the existing soft-break test above already covers, and an LF-only collapse would leak either one, un-collapsed, into what must be a single GFM table-row physical line. The residue channel (rather than embedding the CR/CRLF in a run's own plain text field) keeps this test scoped to emitRunsSingleLine's own collapse alone — a literal CR/CRLF inside a PLAIN text run instead goes through escapeMarkdownText first, which normalises it to the same backslash-LF hard-break spelling a literal '\n' gets (see the plain-text-run describe block below for that path's own coverage).
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
                    runs: [
                      { text: "foo" },
                      { text: " ", source: { format: "markdown", xml } },
                      { text: "bar" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      const markdown = emitMarkdown(doc([table]));
      expect(markdown).toBe("| foo bar |\n| --- |");
      expect(markdown.split("\n")).toHaveLength(2);
    },
  );

  it.each([
    { name: "an escaped hard break spelled with a bare CR", xml: "\\\r" },
    { name: "an escaped hard break spelled with a CRLF", xml: "\\\r\n" },
  ])(
    "collapses $name residue run to a plain space, not a space plus a leftover literal backslash (ExaDev/documents.js#940)",
    ({ xml }) => {
      // This package's own escapeMarkdownText always spells an escaped hard break with a trailing LF ('\\\n'), but a foreign producer's own markdown residue can carry the identical backslash-escape spelling against a CRLF or lone CR just as legitimately, re-emitted verbatim (unescaped) by src/emit/inline.ts's renderLeaf. Stripping only the LF-spelled escape (a bare /\\\n/ regex) leaves this backslash unmatched — the LINE_ENDING_PATTERN split that follows then removes the CRLF/CR line ending out from under it, leaving the backslash behind as a spurious literal character in the row.
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
                    runs: [
                      { text: "foo" },
                      { text: "\n", source: { format: "markdown", xml } },
                      { text: "bar" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      const markdown = emitMarkdown(doc([table]));
      expect(markdown).toBe("| foo bar |\n| --- |");
      expect(markdown).not.toContain("\\");
    },
  );

  it.each([
    { name: "a bare CR", text: "foo\rbar" },
    { name: "a CRLF", text: "foo\r\nbar" },
  ])(
    "collapses $name hard break in a run's own PLAIN text field to a single space, not two (ExaDev/documents.js#940)",
    ({ text }) => {
      // Unlike the residue-run cases above, this hard break lives in the run's own `text` field and goes through escapeMarkdownText first. That function used to recognise only a bare '\n' as a hard break, leaving a preceding lone CR (from a bare CR, or from the first half of a CRLF) to fall through unescaped as a literal character; ESCAPED_HARD_BREAK_PATTERN then collapsed the backslash-LF pair it produced for the second half into one space, and the LINE_ENDING_PATTERN split immediately after collapsed the still-unescaped, un-consumed CR into a SECOND space — doubling a single hard break into two spaces in this single-physical-line table-cell context. escapeMarkdownText now recognises a bare CR as a hard break in its own right (and consumes both halves of a CRLF together), so it always spells the break as a single backslash-LF pair regardless of which of the three line-ending forms the source used, leaving nothing for the LINE_ENDING_PATTERN split to double-collapse.
      const table: ContentTable = {
        kind: "table",
        columns: [{ widthPt: 100 }],
        rows: [
          { cells: [{ blocks: [{ kind: "paragraph", runs: [{ text }] }] }] },
        ],
      };
      expect(emitMarkdown(doc([table]))).toBe("| foo bar |\n| --- |");
    },
  );
});

describe("a table breaking the grid rule", () => {
  const textCell = (text: string): ContentTableCell => ({
    blocks: [{ kind: "paragraph", runs: [{ text }] }],
  });
  // A merged header whose covered position carries a second copy of the anchor's content, which neither a pipe row nor an HTML row has a cell to hold.
  const coveredContentTable: ContentTable = {
    kind: "table",
    columns: [{ widthPt: 100 }, { widthPt: 100 }],
    rows: [
      { cells: [{ ...textCell("anchor"), colSpan: 2 }, textCell("copy")] },
    ],
  };

  function thrownBy(table: ContentTable): unknown {
    try {
      emitMarkdown(doc([table]));
    } catch (error) {
      return error;
    }
    return expect.unreachable("emitMarkdown should have thrown");
  }

  it("throws MarkdownTableGridFaultError from the HTML fallback, rather than dropping the covered content", () => {
    const error = thrownBy(coveredContentTable);
    expect(error).toBeInstanceOf(MarkdownTableGridFaultError);
    expect(error).toBeInstanceOf(MarkdownWriteError);
    if (!(error instanceof MarkdownTableGridFaultError)) {
      throw new Error("unreachable");
    }
    expect(error.name).toBe("MarkdownTableGridFaultError");
    expect(error.code).toBe("md/table-grid-fault");
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

  it("throws from the plain pipe renderer for rows of differing lengths", () => {
    const error = thrownBy({
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        { cells: [textCell("a"), textCell("b")] },
        { cells: [textCell("c")] },
      ],
    });
    expect(error).toBeInstanceOf(MarkdownTableGridFaultError);
  });

  it("throws for a faulty table that is the whole content of another table's cell", () => {
    const error = thrownBy({
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [{ cells: [{ blocks: [coveredContentTable] }] }],
    });
    expect(error).toBeInstanceOf(MarkdownTableGridFaultError);
  });
});
