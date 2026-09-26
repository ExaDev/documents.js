import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import { rootElement } from "ooxml.js";
import { readDocxContent } from "../../ooxml/docx/read";
import { walkElements } from "../../xml/query";
import { buildDocxPackage } from "./content";
import { DocxWriteDiagnosticCodes } from "./diagnostics";
import type { DocxWriteDiagnostic } from "./diagnostics";
function wordDoc(
  sections: Extract<ContentDocument, { kind: "wordprocessing" }>["sections"],
): ContentDocument {
  return { kind: "wordprocessing", metadata: {}, sections };
}

function descendants(root: XmlElement, tag: string): XmlElement[] {
  return [...walkElements(root.children)]
    .filter((cursor) => cursor.node.tag === tag)
    .map((cursor) => cursor.node);
}

describe("buildDocxPackage: a table breaking the grid rule", () => {
  // A merged header whose covered position carries a second copy of the anchor's content, which a docx horizontal merge has no cell to hold.
  const coveredContentTable: ContentTable = {
    kind: "table",
    columns: [{ widthPt: 100 }, { widthPt: 100 }],
    rows: [
      {
        cells: [
          {
            blocks: [{ kind: "paragraph", runs: [{ text: "anchor" }] }],
            colSpan: 2,
          },
          { blocks: [{ kind: "paragraph", runs: [{ text: "copy" }] }] },
        ],
      },
    ],
  };

  it("refuses the table, naming the entry point and the fault, rather than dropping the covered content", () => {
    expect(() =>
      buildDocxPackage(
        wordDoc([
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
            blocks: [coveredContentTable],
          },
        ]),
      ),
    ).toThrow(
      "buildDocxPackage: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
    );
  });

  it("refuses a table with no declared columns rather than skipping it silently", () => {
    expect(() =>
      buildDocxPackage(
        wordDoc([
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
            blocks: [{ ...coveredContentTable, columns: [] }],
          },
        ]),
      ),
    ).toThrow(/^buildDocxPackage: table breaks the grid rule/);
  });
});

describe("buildDocxPackage: a table that states no column widths", () => {
  function cellOf(text: string): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
  }

  function documentOf(table: ContentTable): ContentDocument {
    return wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [table],
      },
    ]);
  }

  function writtenTable(table: ContentTable): ContentTable {
    const reread = readDocxContent(buildDocxPackage(documentOf(table)));
    if (reread.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const block = reread.sections[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the section to hold a table");
    }
    return block;
  }

  function gridColumns(table: ContentTable): number {
    const root = rootElement(
      buildDocxPackage(documentOf(table)).parts["word/document.xml"],
    );
    if (root === undefined) {
      throw new Error("expected a word/document.xml root element");
    }
    return descendants(root, "w:gridCol").length;
  }

  it("is written with one w:gridCol per grid column the rows state, rather than dropped", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [],
      rows: [
        { cells: [cellOf("a"), cellOf("b")] },
        { cells: [cellOf("c"), cellOf("d")] },
      ],
    };
    expect(gridColumns(table)).toBe(2);
    const written = writtenTable(table);
    expect(written.columns).toHaveLength(2);
    for (const column of written.columns) {
      expect(column.widthPt).toBeGreaterThan(0);
    }
    expect(written.rows.map((row) => row.cells.length)).toEqual([2, 2]);
  });

  it("writes a merged region across columns the rows state and the widths do not", () => {
    const written = writtenTable({
      kind: "table",
      columns: [],
      rows: [
        { cells: [{ ...cellOf("wide"), colSpan: 2 }, { blocks: [] }] },
        { cells: [cellOf("c"), cellOf("d")] },
      ],
    });
    expect(written.columns).toHaveLength(2);
    expect(written.rows[0]?.cells[0]).toMatchObject({ colSpan: 2 });
  });

  it("widens a grid whose stated widths are fewer than the columns the rows occupy, keeping the widths it does state", () => {
    const written = writtenTable({
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    });
    expect(written.columns).toHaveLength(2);
    expect(written.columns[0]?.widthPt).toBe(100);
  });

  it("writes the stated widths unchanged when the table states one per column", () => {
    const written = writtenTable({
      kind: "table",
      columns: [{ widthPt: 50 }, { widthPt: 70 }],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    });
    expect(written.columns).toEqual([{ widthPt: 50 }, { widthPt: 70 }]);
  });

  it("still reports a grid fault in a table with no widths, rather than dropping it", () => {
    expect(() =>
      buildDocxPackage(
        documentOf({
          kind: "table",
          columns: [],
          rows: [
            { cells: [cellOf("a"), cellOf("b")] },
            { cells: [cellOf("c")] },
          ],
        }),
      ),
    ).toThrow(
      "buildDocxPackage: table breaks the grid rule (row 1 holds 1 cells where the widest row holds 2, but every row of a table covers the same grid)",
    );
  });

  it("refuses a table with no rows, with or without stated widths, rather than dropping it", () => {
    for (const columns of [[], [{ widthPt: 100 }, { widthPt: 100 }]]) {
      expect(() =>
        buildDocxPackage(documentOf({ kind: "table", columns, rows: [] })),
      ).toThrow(
        "buildDocxPackage: table has no rows, and a table with no rows cannot be written in every word-processing format (ODF requires at least one table:table-row)",
      );
    }
  });
});

describe("buildDocxPackage: a table column's own isHeader has no w:tblGrid spelling", () => {
  function cellOf(text: string): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
  }

  function documentOf(table: ContentTable): ContentDocument {
    return wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [table],
      },
    ]);
  }

  it("reports a warning naming the column, and does not throw, when no onDiagnostic is supplied", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
      rows: [{ cells: [cellOf("Name"), cellOf("Score")] }],
    };
    expect(() => buildDocxPackage(documentOf(table))).not.toThrow();
  });

  it("passes the table's own sourcePath as the diagnostic's context", () => {
    const table: ContentTable = {
      kind: "table",
      sourcePath: "body/table[0]",
      columns: [{ widthPt: 100, isHeader: true }],
      rows: [{ cells: [cellOf("Name")] }],
    };
    const contexts: { readonly sourcePath?: string }[] = [];
    buildDocxPackage(documentOf(table), {
      onDiagnostic: (_diagnostic, context) => {
        contexts.push(context);
      },
    });
    expect(contexts).toEqual([{ sourcePath: "body/table[0]" }]);
  });

  it("calls onDiagnostic once, with TABLE_HEADER_COLUMN_DROPPED, naming the column's own index", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
      rows: [{ cells: [cellOf("Name"), cellOf("Score")] }],
    };
    const diagnostics: DocxWriteDiagnostic[] = [];
    buildDocxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      code: DocxWriteDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
      severity: "warning",
      message:
        "buildDocxPackage: table column 0 is a header column, and that is dropped; w:tblGrid has no header-column marker, so the column is written exactly as any other",
    });
  });

  it("still writes the header column's own cell content, exactly like any other column", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
      rows: [{ cells: [cellOf("Name"), cellOf("Score")] }],
    };
    const reread = readDocxContent(buildDocxPackage(documentOf(table)));
    if (reread.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const block = reread.sections[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the section to hold a table");
    }
    // The flag itself does not round-trip (w:tblGrid has no header-column marker to read it back from), but the column's own cell text survives untouched.
    expect(block.columns[0]?.isHeader).toBeUndefined();
    expect(
      block.rows[0]?.cells.map((cell) =>
        cell.blocks.flatMap((cellBlock) =>
          cellBlock.kind === "paragraph"
            ? cellBlock.runs.map((run) => run.text)
            : [],
        ),
      ),
    ).toEqual([["Name"], ["Score"]]);
  });

  it("reports a diagnostic per flagged column, naming each one's own index, for non-adjacent header columns", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [
        { widthPt: 100, isHeader: true },
        { widthPt: 100 },
        { widthPt: 100, isHeader: true },
      ],
      rows: [{ cells: [cellOf("a"), cellOf("b"), cellOf("c")] }],
    };
    const diagnostics: DocxWriteDiagnostic[] = [];
    buildDocxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining("table column 0 is a header column"),
      expect.stringContaining("table column 2 is a header column"),
    ]);
  });

  it("reports nothing at all for a table whose columns state no header flag", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [{ cells: [cellOf("a"), cellOf("b")] }],
    };
    const diagnostics: DocxWriteDiagnostic[] = [];
    buildDocxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics).toEqual([]);
  });
});
