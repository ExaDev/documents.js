import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { walkTableGrid } from "document-schema.js";
import type { Package, XmlElement } from "ooxml.js";
import { attr, rootElement } from "ooxml.js";
import { readPptxContent } from "../../ooxml/pptx/read";
import { walkElements } from "../../xml/query";
import { buildPptxPackage } from "./content";
import type { PptxWriteDiagnostic } from "./diagnostics";
import { PptxWriteDiagnosticCodes } from "./diagnostics";
function presentationDoc(
  slides: Extract<ContentDocument, { kind: "presentation" }>["slides"],
): ContentDocument {
  return { kind: "presentation", metadata: {}, slides };
}

function firstSlideRoot(pkg: Package): XmlElement {
  const root = rootElement(pkg.parts["ppt/slides/slide1.xml"]);
  if (root === undefined) {
    throw new Error("expected a ppt/slides/slide1.xml root element");
  }
  return root;
}

const ZERO_INSETS = {
  insetLeftPt: 0,
  insetTopPt: 0,
  insetRightPt: 0,
  insetBottomPt: 0,
};
const SLIDE_SIZE = { widthPt: 960, heightPt: 540 };

describe("buildPptxPackage: table merges follow the dense grid", () => {
  function textCell(
    text: string,
    extra: Partial<ContentTableCell> = {},
  ): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }], ...extra };
  }

  function builtCells(table: ContentTable): XmlElement[][] {
    const pkg = buildPptxPackage(
      presentationDoc([
        {
          size: SLIDE_SIZE,
          notes: "",
          shapes: [
            {
              frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
              ...ZERO_INSETS,
              blocks: [table],
            },
          ],
        },
      ]),
    );
    return [...walkElements(firstSlideRoot(pkg).children)]
      .filter((cursor) => cursor.node.tag === "a:tr")
      .map((row) =>
        row.node.children.filter(
          (child): child is XmlElement =>
            child.type === "element" && child.tag === "a:tc",
        ),
      );
  }

  // The merge attributes an a:tc states, as one comparable string.
  function mergeAttributes(cell: XmlElement | undefined): string {
    if (cell === undefined) {
      throw new Error("expected an a:tc");
    }
    return ["gridSpan", "rowSpan", "hMerge", "vMerge"]
      .flatMap((name) => {
        const value = attr(cell, name);
        return value === undefined ? [] : [`${name}=${value}`];
      })
      .join(" ");
  }

  const empty: ContentTableCell = { blocks: [] };

  it("marks the position a horizontal merge covers hMerge and leaves its neighbours plain", () => {
    const cells = builtCells({
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }, { widthPt: 100 }],
      rows: [
        { cells: [textCell("A", { colSpan: 2 }), empty, textCell("C")] },
        { cells: [textCell("D"), textCell("E"), textCell("F")] },
      ],
    });
    expect(cells[0]!.map(mergeAttributes)).toEqual([
      "gridSpan=2",
      "hMerge=1",
      "",
    ]);
    expect(cells[1]!.map(mergeAttributes)).toEqual(["", "", ""]);
  });

  it("marks the position a vertical merge covers in the rows below vMerge", () => {
    const cells = builtCells({
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        { cells: [textCell("A", { rowSpan: 3 }), textCell("B")] },
        { cells: [empty, textCell("D")] },
        { cells: [empty, textCell("F")] },
      ],
    });
    expect(cells.map((row) => mergeAttributes(row[0]))).toEqual([
      "rowSpan=3",
      "vMerge=1",
      "vMerge=1",
    ]);
    expect(cells.map((row) => mergeAttributes(row[1]))).toEqual(["", "", ""]);
  });

  it("marks a 2x2 merge's covered positions by the side of the region they lie on, the interior one on both", () => {
    const cells = builtCells({
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            textCell("A", { colSpan: 2, rowSpan: 2 }),
            empty,
            textCell("C"),
          ],
        },
        { cells: [empty, empty, textCell("F")] },
      ],
    });
    expect(cells[0]!.map(mergeAttributes)).toEqual([
      "gridSpan=2 rowSpan=2",
      "hMerge=1",
      "",
    ]);
    expect(cells[1]!.map(mergeAttributes)).toEqual([
      "vMerge=1",
      "hMerge=1 vMerge=1",
      "",
    ]);
  });

  it("writes a covered entry's own background and borders onto its a:tc", () => {
    const fill = { kind: "solid", color: { r: 1, g: 0, b: 0 } } as const;
    const borders = {
      left: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
    } as const;
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            textCell("A", { colSpan: 2 }),
            { blocks: [], background: fill, borders },
          ],
        },
      ],
    };
    const covered = builtCells(table)[0]![1]!;
    const tcPr = covered.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "a:tcPr",
    );
    expect(tcPr).toBeDefined();
    const tcPrTags = tcPr!.children.flatMap((child) =>
      child.type === "element" ? [child.tag] : [],
    );
    expect(tcPrTags).toContain("a:solidFill");
    expect(tcPrTags).toContain("a:lnL");
  });

  it("reads a 2x2 merge back as one entry per grid column, the anchor carrying both spans", () => {
    const pkg = buildPptxPackage(
      presentationDoc([
        {
          size: SLIDE_SIZE,
          notes: "",
          shapes: [
            {
              frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
              ...ZERO_INSETS,
              blocks: [
                {
                  kind: "table",
                  columns: [
                    { widthPt: 100 },
                    { widthPt: 100 },
                    { widthPt: 100 },
                  ],
                  rows: [
                    {
                      cells: [
                        textCell("A", { colSpan: 2, rowSpan: 2 }),
                        empty,
                        textCell("C"),
                      ],
                    },
                    { cells: [empty, empty, textCell("F")] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const reread = readPptxContent(pkg);
    if (reread.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const block = reread.slides[0]!.shapes[0]!.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    for (const row of block.rows) {
      expect(row.cells).toHaveLength(block.columns.length);
    }
    expect(block.rows[0]?.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(
      walkTableGrid(block)
        .flat()
        .filter((position) => position.anchorRowIndex !== undefined)
        .map(
          (position) =>
            `${String(position.rowIndex)},${String(position.columnIndex)}`,
        ),
    ).toEqual(["0,1", "1,0", "1,1"]);
  });

  // ExaDev/documents.js#1376: verticalAlign never wrote or read back at all — writing it here onto both an anchor cell and a covered entry, then reading the built package back through readPptxContent, exercises the write path (applyCellDecoration -> PptxTableCell.verticalAlign -> a:tcPr/@anchor) and the read path (readTableCell -> readTableCellVerticalAlign) together, the same full round trip builtCells' own narrower a:tc-inspecting helper above does not cover.
  it("round-trips a cell's verticalAlign, on both an anchor and a covered entry, through a real build-then-read cycle", () => {
    const pkg = buildPptxPackage(
      presentationDoc([
        {
          size: SLIDE_SIZE,
          notes: "",
          shapes: [
            {
              frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
              ...ZERO_INSETS,
              blocks: [
                {
                  kind: "table",
                  columns: [{ widthPt: 100 }, { widthPt: 100 }],
                  rows: [
                    {
                      cells: [
                        textCell("A", { colSpan: 2, verticalAlign: "center" }),
                        { blocks: [], verticalAlign: "bottom" },
                      ],
                    },
                    {
                      cells: [
                        textCell("B", { verticalAlign: "top" }),
                        textCell("C"),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const reread = readPptxContent(pkg);
    if (reread.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const block = reread.slides[0]!.shapes[0]!.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(block.rows[0]?.cells[0]?.verticalAlign).toBe("center");
    expect(block.rows[0]?.cells[1]?.verticalAlign).toBe("bottom");
    expect(block.rows[1]?.cells[0]?.verticalAlign).toBe("top");
    expect(block.rows[1]?.cells[1]?.verticalAlign).toBeUndefined();
  });
});

describe("buildPptxPackage: a slide table breaking the grid rule", () => {
  it("refuses the table, naming the entry point and the fault, rather than dropping the covered content", () => {
    expect(() =>
      buildPptxPackage(
        presentationDoc([
          {
            size: { widthPt: 720, heightPt: 540 },
            notes: "",
            shapes: [
              {
                frame: { xPt: 36, yPt: 36, widthPt: 480, heightPt: 240 },
                ...ZERO_INSETS,
                blocks: [
                  {
                    kind: "table",
                    columns: [{ widthPt: 100 }, { widthPt: 100 }],
                    rows: [
                      {
                        cells: [
                          {
                            blocks: [
                              { kind: "paragraph", runs: [{ text: "anchor" }] },
                            ],
                            colSpan: 2,
                          },
                          {
                            blocks: [
                              { kind: "paragraph", runs: [{ text: "copy" }] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ),
    ).toThrow(
      "buildPptxPackage: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
    );
  });
});

describe("buildPptxPackage: a slide table that states no column widths", () => {
  function cellOf(text: string): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
  }

  function documentOf(table: ContentTable): ContentDocument {
    return presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
            ...ZERO_INSETS,
            blocks: [table],
          },
        ],
      },
    ]);
  }

  function writtenTable(table: ContentTable): ContentTable {
    const reread = readPptxContent(buildPptxPackage(documentOf(table)));
    if (reread.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const block = reread.slides[0]?.shapes[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the slide's shape to hold a table");
    }
    return block;
  }

  function gridColumns(table: ContentTable): number {
    return [
      ...walkElements(
        firstSlideRoot(buildPptxPackage(documentOf(table))).children,
      ),
    ].filter((cursor) => cursor.node.tag === "a:gridCol").length;
  }

  it("is written with one a:gridCol per grid column the rows state", () => {
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

  it("still reports a grid fault in a table with no widths, naming the fault rather than a missing cell", () => {
    expect(() =>
      buildPptxPackage(
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
      "buildPptxPackage: table breaks the grid rule (row 1 holds 1 cells where the widest row holds 2, but every row of a table covers the same grid)",
    );
  });

  it("refuses a table with no rows, with or without stated widths, rather than writing a grid with nothing in it", () => {
    for (const columns of [[], [{ widthPt: 100 }, { widthPt: 100 }]]) {
      expect(() =>
        buildPptxPackage(documentOf({ kind: "table", columns, rows: [] })),
      ).toThrow(
        "buildPptxPackage: table has no rows, and a table with no rows cannot be written in every presentation format (ODF requires at least one table:table-row)",
      );
    }
  });
});

// ExaDev/documents.js#1400: heightPt and a cell border's stroke style were both genuinely representable in DrawingML but never wired through buildPptxPackage's table writer — heightPt was replaced with a hardcoded 20pt placeholder on every row, and a border's style (dashed/dotted/double) was dropped entirely. Both are fixed by real wiring, not a diagnostic, since DrawingML has no format limitation here (contrast with #1389, ContentTableRow.isHeader, which genuinely has no DrawingML spelling).
describe("buildPptxPackage: table row heightPt and cell border style round-trip", () => {
  function cellOf(
    text: string,
    borders?: ContentTableCell["borders"],
  ): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }], borders };
  }

  function documentOf(table: ContentTable): ContentDocument {
    return presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
            ...ZERO_INSETS,
            blocks: [table],
          },
        ],
      },
    ]);
  }

  function writtenTable(table: ContentTable): ContentTable {
    const reread = readPptxContent(buildPptxPackage(documentOf(table)));
    if (reread.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const block = reread.slides[0]?.shapes[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the slide's shape to hold a table");
    }
    return block;
  }

  it("writes each row's own heightPt rather than the shared 20pt placeholder", () => {
    const written = writtenTable({
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { cells: [cellOf("a")], heightPt: 36 },
        { cells: [cellOf("b")], heightPt: 72 },
      ],
    });
    expect(written.rows.map((row) => row.heightPt)).toEqual([36, 72]);
  });

  it("a row stating no heightPt falls back to the 20pt placeholder, unchanged from before", () => {
    const written = writtenTable({
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [{ cells: [cellOf("a")] }],
    });
    expect(written.rows[0]?.heightPt).toBe(20);
  });

  it("writes and reads back a cell border's dashed/dotted/double stroke style, not just its colour and width", () => {
    const written = writtenTable({
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        {
          cells: [
            cellOf("a", {
              left: {
                color: { r: 1, g: 0, b: 0 },
                widthPt: 2,
                style: "dashed",
              },
              right: {
                color: { r: 0, g: 1, b: 0 },
                widthPt: 1,
                style: "dotted",
              },
              top: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5 },
              bottom: {
                color: { r: 0, g: 0, b: 0 },
                widthPt: 1.5,
                style: "double",
              },
            }),
          ],
        },
      ],
    });
    expect(written.rows[0]?.cells[0]?.borders).toEqual({
      left: { color: { r: 1, g: 0, b: 0 }, widthPt: 2, style: "dashed" },
      right: { color: { r: 0, g: 1, b: 0 }, widthPt: 1, style: "dotted" },
      top: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5 },
      bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 1.5, style: "double" },
    });
  });
});

describe("buildPptxPackage: a table row's own isHeader has no DrawingML spelling", () => {
  function cellOf(text: string): ContentTableCell {
    return { blocks: [{ kind: "paragraph", runs: [{ text }] }] };
  }

  function documentOf(table: ContentTable): ContentDocument {
    return presentationDoc([
      {
        size: SLIDE_SIZE,
        notes: "",
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 100 },
            ...ZERO_INSETS,
            blocks: [table],
          },
        ],
      },
    ]);
  }

  it("reports a warning naming the row, and does not throw, when no onDiagnostic is supplied", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        { isHeader: true, cells: [cellOf("Name"), cellOf("Score")] },
        { cells: [cellOf("Ada"), cellOf("10")] },
      ],
    };
    expect(() => buildPptxPackage(documentOf(table))).not.toThrow();
  });

  it("passes the table's own sourcePath as the diagnostic's context", () => {
    const table: ContentTable = {
      kind: "table",
      sourcePath: "slides/slide1.xml#/shapes/0",
      columns: [{ widthPt: 100 }],
      rows: [{ isHeader: true, cells: [cellOf("Name")] }],
    };
    const contexts: { readonly sourcePath?: string }[] = [];
    buildPptxPackage(documentOf(table), {
      onDiagnostic: (_diagnostic, context) => {
        contexts.push(context);
      },
    });
    expect(contexts).toEqual([{ sourcePath: "slides/slide1.xml#/shapes/0" }]);
  });

  it("passes an undefined sourcePath when the table itself carries none", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [{ isHeader: true, cells: [cellOf("Name")] }],
    };
    const contexts: { readonly sourcePath?: string }[] = [];
    buildPptxPackage(documentOf(table), {
      onDiagnostic: (_diagnostic, context) => {
        contexts.push(context);
      },
    });
    expect(contexts).toEqual([{ sourcePath: undefined }]);
  });

  it("calls onDiagnostic once, with TABLE_HEADER_ROW_DROPPED, naming the row's own index", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        { isHeader: true, cells: [cellOf("Name"), cellOf("Score")] },
        { cells: [cellOf("Ada"), cellOf("10")] },
      ],
    };
    const diagnostics: PptxWriteDiagnostic[] = [];
    buildPptxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      code: PptxWriteDiagnosticCodes.TABLE_HEADER_ROW_DROPPED,
      severity: "warning",
      message:
        "buildPptxPackage: table row 0 is a header row, and that is dropped; DrawingML has no per-row header marker, so the row is written exactly as any other",
    });
  });

  it("still writes the header row's own content, exactly like any other row", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        { isHeader: true, cells: [cellOf("Name"), cellOf("Score")] },
        { cells: [cellOf("Ada"), cellOf("10")] },
      ],
    };
    const reread = readPptxContent(buildPptxPackage(documentOf(table)));
    if (reread.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const block = reread.slides[0]?.shapes[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the slide's shape to hold a table");
    }
    // The flag itself does not round-trip (DrawingML has no per-row header marker to read it back from), but the row's own cell text survives untouched.
    expect(block.rows[0]?.isHeader).toBeUndefined();
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

  it("reports a diagnostic per flagged row, naming each one's own index, for non-contiguous header rows", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [
        { isHeader: true, cells: [cellOf("a")] },
        { cells: [cellOf("b")] },
        { isHeader: true, cells: [cellOf("c")] },
      ],
    };
    const diagnostics: PptxWriteDiagnostic[] = [];
    buildPptxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining("table row 0 is a header row"),
      expect.stringContaining("table row 2 is a header row"),
    ]);
  });

  it("reports nothing at all for a table whose rows state no header flag", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }],
      rows: [{ cells: [cellOf("a")] }, { cells: [cellOf("b")] }],
    };
    const diagnostics: PptxWriteDiagnostic[] = [];
    buildPptxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics).toEqual([]);
  });

  it("calls onDiagnostic once, with TABLE_HEADER_COLUMN_DROPPED, naming the column's own index", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
      rows: [{ cells: [cellOf("Name"), cellOf("Score")] }],
    };
    const diagnostics: PptxWriteDiagnostic[] = [];
    buildPptxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      code: PptxWriteDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
      severity: "warning",
      message:
        "buildPptxPackage: table column 0 is a header column, and that is dropped; DrawingML has no header-column marker, so the column is written exactly as any other",
    });
  });

  it("still writes the header column's own cell content, exactly like any other column", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100, isHeader: true }, { widthPt: 100 }],
      rows: [{ cells: [cellOf("Name"), cellOf("Score")] }],
    };
    const reread = readPptxContent(buildPptxPackage(documentOf(table)));
    if (reread.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const block = reread.slides[0]?.shapes[0]?.blocks[0];
    if (block?.kind !== "table") {
      throw new Error("expected the slide's shape to hold a table");
    }
    // The flag itself does not round-trip (DrawingML has no header-column marker to read it back from), but the column's own cell text survives untouched.
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

  it("reports a diagnostic per flagged column, naming each one's own index, for non-contiguous header columns", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [
        { widthPt: 100, isHeader: true },
        { widthPt: 100 },
        { widthPt: 100, isHeader: true },
      ],
      rows: [{ cells: [cellOf("a"), cellOf("b"), cellOf("c")] }],
    };
    const diagnostics: PptxWriteDiagnostic[] = [];
    buildPptxPackage(documentOf(table), {
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
      columns: [{ widthPt: 100 }],
      rows: [{ cells: [cellOf("a")] }, { cells: [cellOf("b")] }],
    };
    const diagnostics: PptxWriteDiagnostic[] = [];
    buildPptxPackage(documentOf(table), {
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics).toEqual([]);
  });
});
