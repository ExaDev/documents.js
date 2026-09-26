import { describe, expect, it } from "vitest";
import type { ContentSheet, ContentSheetCell } from "document-schema.js";
import type { CellTypeInference } from "./cell-typing";
import { reconstructSpreadsheet } from "./reconstruct";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";
const BLACK = { r: 0, g: 0, b: 0 };

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  sizePt?: number;
  family?: string;
  bold?: boolean;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: {
      family: overrides.family ?? "Helvetica",
      weight: overrides.bold === true ? "bold" : "normal",
      style: "normal",
    },
    sizePt: overrides.sizePt ?? 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
  };
}

function line(
  x1Pt: number,
  y1Pt: number,
  x2Pt: number,
  y2Pt: number,
): LayoutItem {
  return { kind: "line", x1Pt, y1Pt, x2Pt, y2Pt, color: BLACK, widthPt: 0.5 };
}

// The generic-path shape a stroke can still arrive in when it misses pdf-codec's own LayoutLine shape pattern (several segments in one subpath, or a subpath that is also filled), and the shape every stroke arrived in before that pattern existed. detectGridLattice accepts it alongside a genuine LayoutLine so a hand-built LayoutDocument, an older recorded one, and a freshly round-tripped one all detect identically — which the "built from stroked LayoutPath items" test below is what actually pins.
function strokedLinePath(
  x1Pt: number,
  y1Pt: number,
  x2Pt: number,
  y2Pt: number,
): LayoutItem {
  return {
    kind: "path",
    subpaths: [
      {
        startXPt: x1Pt,
        startYPt: y1Pt,
        closed: false,
        segments: [{ kind: "line", xPt: x2Pt, yPt: y2Pt }],
      },
    ],
    stroke: { color: BLACK, widthPt: 0.5 },
  };
}

function page(
  widthPt: number,
  heightPt: number,
  items: LayoutItem[],
): LayoutPage {
  return { widthPt, heightPt, items };
}

function docFrom(
  pages: LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return { formatVersion: 1, metadata: {}, pages, images };
}

function sheets(
  doc: ReturnType<typeof reconstructSpreadsheet>,
): ContentSheet[] {
  if (doc.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet document");
  }
  return doc.sheets;
}

// Groups a sheet's own sparse ContentSheetCell[] back into a dense 2D array of displayText, indexed [row][column] — the natural shape to assert a whole recovered grid against in one expect(...).toEqual(...) call.
function grid(sheet: ContentSheet): string[][] {
  const byRow = new Map<number, string[]>();
  for (const cell of sheet.cells) {
    const row = byRow.get(cell.row) ?? [];
    row[cell.column] = cell.displayText;
    byRow.set(cell.row, row);
  }
  return [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r)!);
}

describe("reconstructSpreadsheet: gridline lattice detection", () => {
  // Deliberately misaligns each row's own text x-position within its own column (row 0's items sit near the LEFT edge of each column band, row 1's sit near the RIGHT edge) — text-position clustering alone (COLUMN_ALIGNMENT_TOLERANCE_PT=3) would never merge x=10 and x=90 into the same recovered column, so a correct grouping here is only possible because the drawn gridline lattice's own boundaries — not text alignment — decided the columns.
  it("uses a drawn gridline lattice directly as cell boundaries, not text-position clustering", () => {
    const items: LayoutItem[] = [
      // Row boundaries (top=200, middle=150, bottom=100) and column boundaries (left=0, middle=120, right=300).
      line(0, 200, 300, 200),
      line(0, 150, 300, 150),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
      text({ text: "R0C0", xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: "R0C1", xPt: 200, yPt: 180, widthPt: 30 }),
      text({ text: "R1C0", xPt: 90, yPt: 130, widthPt: 20 }),
      text({ text: "R1C1", xPt: 130, yPt: 130, widthPt: 20 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(true);
    expect(sheet!.columns.map((c) => c.widthPt)).toEqual([120, 180]);
    expect(sheet!.rows.map((r) => r.heightPt)).toEqual([50, 50]);
    expect(grid(sheet!)).toEqual([
      ["R0C0", "R0C1"],
      ["R1C0", "R1C1"],
    ]);
  });

  it("drops an item sitting outside the detected lattice entirely, rather than misassigning it to the nearest cell (a header-gutter row/column label, a title above the sheet)", () => {
    const items: LayoutItem[] = [
      line(0, 200, 300, 200),
      line(0, 150, 300, 150),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
      text({ text: "Title above the grid", xPt: 0, yPt: 280, widthPt: 100 }), // well above the lattice's own top boundary (y=200)
      text({ text: "R0C0", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.cells.map((c) => c.displayText)).toEqual(["R0C0"]);
  });

  // A stroke that misses pdf-codec's own LayoutLine shape pattern still arrives as a generic single-segment stroked LayoutPath (see this file's own strokedLinePath doc comment above), and must detect identically to a genuine LayoutLine.
  it("detects a lattice built from single-segment stroked LayoutPath items, not only from genuine LayoutLine items", () => {
    const items: LayoutItem[] = [
      strokedLinePath(0, 200, 300, 200),
      strokedLinePath(0, 150, 300, 150),
      strokedLinePath(0, 100, 300, 100),
      strokedLinePath(0, 100, 0, 200),
      strokedLinePath(120, 100, 120, 200),
      strokedLinePath(300, 100, 300, 200),
      text({ text: "A", xPt: 10, yPt: 180, widthPt: 10 }),
      text({ text: "B", xPt: 200, yPt: 180, widthPt: 10 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(true);
    expect(grid(sheet!)).toEqual([["A", "B"]]);
  });

  it("does not detect a lattice from too few parallel lines (a page border, not a printed grid)", () => {
    const items: LayoutItem[] = [
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(300, 100, 300, 200),
      text({ text: "Solo", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(false);
  });
});

describe("reconstructSpreadsheet: text-position column clustering (no gridlines)", () => {
  it("clusters text into a grid via recurring x-position alignment across multiple lines when no gridline lattice is present", () => {
    const items: LayoutItem[] = [
      text({ text: "Name", xPt: 50, yPt: 200, widthPt: 40 }),
      text({ text: "Amount", xPt: 150, yPt: 200, widthPt: 50 }),
      text({ text: "Acme", xPt: 50, yPt: 180, widthPt: 35 }),
      text({ text: "10", xPt: 150, yPt: 180, widthPt: 15 }),
      text({ text: "Globex", xPt: 50, yPt: 160, widthPt: 45 }),
      text({ text: "20", xPt: 150, yPt: 160, widthPt: 15 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.printSettings.gridlines).toBe(false);
    expect(sheet!.columns).toHaveLength(2);
    expect(sheet!.rows).toHaveLength(3);
    expect(grid(sheet!)).toEqual([
      ["Name", "Amount"],
      ["Acme", "10"],
      ["Globex", "20"],
    ]);
  });

  it("treats a one-off item at a stray x position as its own column when nothing else recurs there, rather than dropping it", () => {
    const items: LayoutItem[] = [
      text({ text: "Solo", xPt: 75, yPt: 200, widthPt: 30 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(grid(sheet!)).toEqual([["Solo"]]);
  });

  it("joins multiple text items assigned to the same recovered cell with a single space, matching this module's own word-gap convention", () => {
    const items: LayoutItem[] = [
      text({ text: "Hello", xPt: 50, yPt: 200, widthPt: 30 }),
      text({ text: "World", xPt: 85, yPt: 200, widthPt: 30 }), // gap = 85-(50+30) = 5, > MIN_WORD_GAP_PT — same cell, space-joined
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.cells[0]!.displayText).toBe("Hello World");
  });

  it("re-types an unambiguously numeric cell while keeping its own rendered text verbatim", () => {
    const items: LayoutItem[] = [
      text({ text: "42.5", xPt: 50, yPt: 200, widthPt: 30 }),
    ];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]));
    const [sheet] = sheets(doc);
    expect(sheet!.cells[0]!.value).toEqual({ kind: "number", value: 42.5 });
    expect(sheet!.cells[0]!.displayText).toBe("42.5"); // the printed string is never replaced by the inferred value's own formatting
  });
});

describe("reconstructSpreadsheet: page size, sheet naming, and metadata", () => {
  it("uses each source page's own widthPt/heightPt directly as printSettings.pageSize, one sheet per LayoutPage", () => {
    const doc = reconstructSpreadsheet(
      docFrom([page(400, 300, []), page(200, 150, [])]),
    );
    const [sheetA, sheetB] = sheets(doc);
    expect(sheetA!.printSettings.pageSize).toEqual({
      widthPt: 400,
      heightPt: 300,
    });
    expect(sheetB!.printSettings.pageSize).toEqual({
      widthPt: 200,
      heightPt: 150,
    });
  });

  it("names each sheet Sheet<N> by page index, and carries document metadata through unchanged", () => {
    const doc = reconstructSpreadsheet({
      formatVersion: 1,
      metadata: { title: "My Sheet" },
      pages: [page(400, 300, []), page(400, 300, [])],
      images: {},
    });
    expect(sheets(doc).map((s) => s.name)).toEqual(["Sheet1", "Sheet2"]);
    expect(doc.metadata).toEqual({ title: "My Sheet" });
  });
});

describe("reconstructSpreadsheet: empty input and cancellation", () => {
  it("produces an empty sheet (no cells, columns, or rows) for a page with no items", () => {
    const doc = reconstructSpreadsheet(docFrom([page(400, 300, [])]));
    const [sheet] = sheets(doc);
    expect(sheet).toMatchObject({ cells: [], columns: [], rows: [] });
    expect(sheet!.printSettings.gridlines).toBe(false);
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      reconstructSpreadsheet(docFrom([page(400, 300, [])]), {
        signal: controller.signal,
      }),
    ).toThrow();
  });
});

// --- Paint order: reconstructDrawPage stamps the walk position, so an interleaved page survives the round trip ---

describe("reconstructSpreadsheet: heuristic cell re-typing", () => {
  function cellsFor(texts: readonly string[]): {
    cells: ContentSheetCell[];
    inferences: CellTypeInference[];
  } {
    const items: LayoutItem[] = texts.map((value, i) =>
      text({ text: value, xPt: 50, yPt: 200 - i * 20, widthPt: 40 }),
    );
    const inferences: CellTypeInference[] = [];
    const doc = reconstructSpreadsheet(docFrom([page(300, 300, items)]), {
      onCellTypeInference: (inference) => {
        inferences.push(inference);
      },
    });
    const [sheet] = sheets(doc);
    return { cells: sheet!.cells, inferences };
  }

  it("re-types confident cells and leaves ambiguous ones as strings, keeping every cell's own rendered text either way", () => {
    const { cells } = cellsFor([
      "42.5",
      "TRUE",
      "2024-01-15",
      "007",
      "Acme Ltd",
    ]);
    expect(cells.map((c) => c.value.kind)).toEqual([
      "number",
      "boolean",
      "date",
      "string",
      "string",
    ]);
    expect(cells.map((c) => c.displayText)).toEqual([
      "42.5",
      "TRUE",
      "2024-01-15",
      "007",
      "Acme Ltd",
    ]);
  });

  it("reports both outcomes through the sink, so a caller can tell a confident guess from a deliberate refusal", () => {
    const { inferences } = cellsFor(["42.5", "007", "Acme Ltd"]);
    expect(inferences).toEqual([
      {
        sheetIndex: 0,
        row: 0,
        column: 0,
        displayText: "42.5",
        outcome: "retyped",
        value: { kind: "number", value: 42.5 },
        rule: "plain-number",
      },
      {
        sheetIndex: 0,
        row: 1,
        column: 0,
        displayText: "007",
        outcome: "declined",
        reason: "leading-zero-digits",
      },
    ]); // 'Acme Ltd' was never number/date/boolean-shaped, so there was no inference to report at all
  });

  it("keeps the declined cell a plain string carrying the exact text it was declined on", () => {
    const { cells } = cellsFor(["1,234"]);
    expect(cells[0]!.value).toEqual({ kind: "string", value: "1,234" });
  });
});
