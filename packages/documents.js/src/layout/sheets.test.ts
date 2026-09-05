import { bytesToBase64 } from "ooxml.js";
import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentEmbeddedObject,
  ContentImageBlock,
  ContentSheet,
  ContentSheetCell,
  ContentSheetImage,
  ContentSheetPrintSettings,
  MathMlNode,
} from "document-schema.js";

import type {
  LayoutImage,
  LayoutItem,
  LayoutLine,
  LayoutRect,
  LayoutText,
  TextMeasurer,
} from "pdf-codec";
import { encodePng } from "byte-codec";
import { loadMathFont } from "pdf-codec";
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import { convertSpreadsheetToLayout } from "./sheets";

// Every character is sizePt/10 pt wide; lineHeightAtSize is 1.2x, ascender 0.8x, descender -0.2x -- the same fake-measurer convention already used across src/layout/engine.test.ts and src/layout/slides.test.ts.
function fakeMeasurer(): TextMeasurer {
  return {
    widthOfTextAtSize: (text, _font, sizePt) =>
      Array.from(text).length * (sizePt / 10),
    lineHeightAtSize: (_font, sizePt) => sizePt * 1.2,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({
      offsetPt: -sizePt * 0.1,
      thicknessPt: sizePt * 0.05,
    }),
    horizontalScaleFor: () => 1,
  };
}

function stringCell(
  row: number,
  column: number,
  text: string,
  overrides: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return {
    row,
    column,
    value: { kind: "string", value: text },
    displayText: text,
    ...overrides,
  };
}
function numberCell(
  row: number,
  column: number,
  value: number,
  displayText = String(value),
  overrides: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return {
    row,
    column,
    value: { kind: "number", value },
    displayText,
    ...overrides,
  };
}
function booleanCell(
  row: number,
  column: number,
  value: boolean,
  overrides: Partial<ContentSheetCell> = {},
): ContentSheetCell {
  return {
    row,
    column,
    value: { kind: "boolean", value },
    displayText: value ? "TRUE" : "FALSE",
    ...overrides,
  };
}

const basePrintSettings: ContentSheetPrintSettings = {
  pageSize: { widthPt: 600, heightPt: 800 },
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

function sheet(
  cells: ContentSheetCell[],
  overrides: Partial<ContentSheet> = {},
): ContentSheet {
  return {
    name: "Sheet1",
    cells,
    columns: [],
    rows: [],
    images: [],
    printSettings: basePrintSettings,
    ...overrides,
  };
}

function doc(
  sheets: ContentSheet[],
): Extract<ContentDocument, { kind: "spreadsheet" }> {
  return { kind: "spreadsheet", metadata: {}, sheets };
}

function convertResult(
  sheets: ContentSheet[],
  measurer: TextMeasurer = fakeMeasurer(),
  signal?: AbortSignal,
) {
  return convertSpreadsheetToLayout(doc(sheets), {
    measurer,
    mathMetricsAt,
    signal,
  });
}

// The LayoutDocument half alone, which is all every geometry/text/gridline assertion below cares about -- the formula half has its own dedicated describe block, and reads convertResult directly.
function convert(
  sheets: ContentSheet[],
  measurer: TextMeasurer = fakeMeasurer(),
  signal?: AbortSignal,
) {
  return convertResult(sheets, measurer, signal).document;
}

function textItems(items: readonly LayoutItem[]): LayoutText[] {
  return items.filter((i): i is LayoutText => i.kind === "text");
}
function lineItems(items: readonly LayoutItem[]): LayoutLine[] {
  return items.filter((i): i is LayoutLine => i.kind === "line");
}
function rectItems(items: readonly LayoutItem[]): LayoutRect[] {
  return items.filter((i): i is LayoutRect => i.kind === "rect");
}

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

// --- Step 1: resolve the print range -------------------------------------------------------------

describe("step 1: resolve the print range", () => {
  it("uses the sheet's own explicit printRange verbatim, excluding cells outside it", () => {
    const s = sheet([stringCell(0, 0, "In"), stringCell(5, 5, "Out")], {
      printSettings: {
        ...basePrintSettings,
        printRange: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      },
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages.flatMap((p) => p.items));
    expect(texts.map((t) => t.text)).toEqual(["In"]);
  });

  it("falls back to the full extent of populated cells, including a merged anchor's own colSpan/rowSpan reach", () => {
    const s = sheet([stringCell(2, 3, "Anchor", { colSpan: 2, rowSpan: 2 })]);
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "Anchor",
    ]);
  });

  it("produces no pages for a sheet with no cells and no explicit print range", () => {
    const layout = convert([sheet([])]);
    expect(layout.pages).toHaveLength(0);
  });
});

// --- Step 2: cumulative column/row offset arrays skip hidden entirely -----------------------------

describe("step 2: column/row offset arrays skip hidden entirely", () => {
  it("a hidden column contributes zero width to the cumulative offset, regardless of its own declared width", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 2, "B")], {
      columns: [
        { index: 0, widthPt: 50 },
        { index: 1, widthPt: 9999, hidden: true },
        { index: 2, widthPt: 50 },
      ],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    const a = texts.find((t) => t.text === "A")!;
    const b = texts.find((t) => t.text === "B")!;
    expect(b.xPt - a.xPt).toBeCloseTo(50, 5);
  });

  it("a cell anchored in a hidden column is not rendered at all, not merely rendered at zero width", () => {
    // Zero available width would otherwise still trigger the numeric-overflow ###/string-truncate path -- confirmed as a real bug via this module's own real-file verification (a genuine hidden ODS column produced a stray '###' overlapping the next visible column). The fix checks hidden-ness directly, not the incidental zero-width side effect.
    const s = sheet([stringCell(0, 0, "Visible"), numberCell(0, 1, 42, "42")], {
      columns: [
        { index: 0, widthPt: 50 },
        { index: 1, widthPt: 50, hidden: true },
      ],
    });
    const layout = convert([s]);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "Visible",
    ]);
  });

  it("a cell anchored in a hidden row is not rendered at all, not merely rendered at zero height", () => {
    const s = sheet([stringCell(0, 0, "Visible"), stringCell(1, 0, "Hidden")], {
      rows: [
        { index: 0, heightPt: 30 },
        { index: 1, heightPt: 30, hidden: true },
      ],
    });
    const layout = convert([s]);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "Visible",
    ]);
  });

  it("a hidden row contributes zero height to the cumulative offset, regardless of its own declared height", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(2, 0, "B")], {
      rows: [
        { index: 0, heightPt: 30 },
        { index: 1, heightPt: 9999, hidden: true },
        { index: 2, heightPt: 30 },
      ],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    const a = texts.find((t) => t.text === "A")!;
    const b = texts.find((t) => t.text === "B")!;
    // y-up: row B sits BELOW row A by exactly one visible row height (30pt) -- the hidden row between contributes nothing.
    expect(a.yPt - b.yPt).toBeCloseTo(30, 5);
  });
});

// --- Step 3: header-gutter and repeat-row/column reservation --------------------------------------

describe("step 3: header-gutter and repeat-row/column reservation", () => {
  it("reserves a row-number/column-letter gutter sized from real header-label metrics when headers is true", () => {
    const s = sheet([stringCell(0, 0, "X")], {
      printSettings: { ...basePrintSettings, headers: true },
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    // gutter width = widthOfTextAtSize('1', font, 8) + 2*2 = 0.8 + 4 = 4.8; cell text x = 0(margin) + 4.8(gutter) + 2(cell padding) = 6.8.
    expect(texts.find((t) => t.text === "X")!.xPt).toBeCloseTo(6.8, 5);
    expect(texts.some((t) => t.text === "A")).toBe(true); // column-letter label
    expect(texts.some((t) => t.text === "1")).toBe(true); // row-number label
  });

  it("re-emits the repeat column band, at identical geometry, on every page", () => {
    const cells = [
      stringCell(0, 0, "Label"),
      stringCell(0, 1, "C1"),
      stringCell(0, 2, "C2"),
      stringCell(0, 3, "C3"),
    ];
    const s = sheet(cells, {
      columns: [
        { index: 0, widthPt: 30 },
        { index: 1, widthPt: 40 },
        { index: 2, widthPt: 40 },
        { index: 3, widthPt: 40 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 100 },
        repeatColumns: { start: 0, end: 0 },
        pageOrder: "downThenOver",
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(3);
    const labelXPositions = layout.pages.map(
      (p) => textItems(p.items).find((t) => t.text === "Label")!.xPt,
    );
    expect(labelXPositions).toEqual([
      labelXPositions[0],
      labelXPositions[0],
      labelXPositions[0],
    ]);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "Label",
      "C1",
    ]);
    expect(textItems(layout.pages[1]!.items).map((t) => t.text)).toEqual([
      "Label",
      "C2",
    ]);
    expect(textItems(layout.pages[2]!.items).map((t) => t.text)).toEqual([
      "Label",
      "C3",
    ]);
  });
});

// --- Step 4: resolve scale -------------------------------------------------------------------------

describe("step 4: resolve scale", () => {
  it("applies an explicit printSettings.scalePercent as a raw percentage", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 1, "B")], {
      columns: [
        { index: 0, widthPt: 50 },
        { index: 1, widthPt: 50 },
      ],
      printSettings: { ...basePrintSettings, scalePercent: 200 },
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    const a = texts.find((t) => t.text === "A")!;
    const b = texts.find((t) => t.text === "B")!;
    expect(b.xPt - a.xPt).toBeCloseTo(100, 5); // 50pt column scaled 2x
  });

  it("computes a non-iterative fit-to-page scale via min(availableWidth*pagesWide/contentWidth, availableHeight*pagesTall/contentHeight)", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      columns: [{ index: 0, widthPt: 300 }],
      rows: [{ index: 0, heightPt: 15 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 100 },
        fitToPages: { width: 1, height: 1 },
        gridlines: true,
      },
    });
    const layout = convert([s]);
    // widthRatio = (100*1)/300 = 1/3; heightRatio = (100*1)/15 clamped to 1 -> min(1/3, 1, 1) = 1/3. Scaled column width = 300/3 = 100.
    const lines = lineItems(layout.pages[0]!.items).filter(
      (l) => l.x1Pt === l.x2Pt,
    );
    expect(lines.map((l) => l.x1Pt).sort((x, y) => x - y)).toEqual([0, 100]);
  });

  it("never upscales past 1 even when fit-to-page has abundant available space", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      columns: [{ index: 0, widthPt: 10 }],
      rows: [{ index: 0, heightPt: 10 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 1000, heightPt: 1000 },
        fitToPages: { width: 5, height: 5 },
        gridlines: true,
      },
    });
    const layout = convert([s]);
    const lines = lineItems(layout.pages[0]!.items).filter(
      (l) => l.x1Pt === l.x2Pt,
    );
    expect(lines.map((l) => l.x1Pt).sort((x, y) => x - y)).toEqual([0, 10]); // NOT scaled up to 50
  });
});

// --- Step 5: partition into column/row bands -------------------------------------------------------

describe("step 5: band partitioning, manual breaks, and the oversized-item guarantee", () => {
  it("forces an early band boundary at a manual break, regardless of remaining space", () => {
    const s = sheet(
      [stringCell(0, 0, "A"), stringCell(0, 1, "B"), stringCell(0, 2, "C")],
      {
        columns: [
          { index: 0, widthPt: 10 },
          { index: 1, widthPt: 10 },
          { index: 2, widthPt: 10 },
        ],
        printSettings: {
          ...basePrintSettings,
          pageSize: { widthPt: 100, heightPt: 100 },
          manualBreaks: { rows: [], columns: [1] },
        },
      },
    );
    const layout = convert([s]);
    // Without the manual break, all three 10pt columns fit easily in a 100pt page -- one band. The break at column 1 forces a second.
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual(["A"]);
    expect(textItems(layout.pages[1]!.items).map((t) => t.text)).toEqual([
      "B",
      "C",
    ]);
  });

  it("gives an oversized column its own band and lets it overflow, rather than looping forever", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 1, "B")], {
      columns: [
        { index: 0, widthPt: 5000 },
        { index: 1, widthPt: 10 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 100 },
      },
    });
    const start = performance.now();
    const layout = convert([s]);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual(["A"]);
    expect(textItems(layout.pages[1]!.items).map((t) => t.text)).toEqual(["B"]);
  });
});

// --- Step 6: page emission order -----------------------------------------------------------------

describe("step 6: page emission order across the column-band x row-band grid", () => {
  function grid(pageOrder: "downThenOver" | "overThenDown"): ContentSheet {
    return sheet(
      [
        stringCell(0, 0, "TL"),
        stringCell(0, 1, "TR"),
        stringCell(1, 0, "BL"),
        stringCell(1, 1, "BR"),
      ],
      {
        columns: [
          { index: 0, widthPt: 60 },
          { index: 1, widthPt: 60 },
        ],
        rows: [
          { index: 0, heightPt: 60 },
          { index: 1, heightPt: 60 },
        ],
        printSettings: {
          ...basePrintSettings,
          pageSize: { widthPt: 100, heightPt: 100 },
          pageOrder,
        },
      },
    );
  }

  it("downThenOver completes each column band down through every row band before moving to the next column band", () => {
    const layout = convert([grid("downThenOver")]);
    const firstTextPerPage = layout.pages.map(
      (p) => textItems(p.items)[0]!.text,
    );
    expect(firstTextPerPage).toEqual(["TL", "BL", "TR", "BR"]);
  });

  it("overThenDown completes each row band across every column band before moving to the next row band", () => {
    const layout = convert([grid("overThenDown")]);
    const firstTextPerPage = layout.pages.map(
      (p) => textItems(p.items)[0]!.text,
    );
    expect(firstTextPerPage).toEqual(["TL", "TR", "BL", "BR"]);
  });
});

// --- Step 7: per-page z-order ---------------------------------------------------------------------

describe("step 7: gridlines are one line per boundary, never one per cell", () => {
  it("draws exactly (columns+1) vertical and (rows+1) horizontal lines for a 2x2 grid, not one per cell", () => {
    const s = sheet(
      [
        stringCell(0, 0, "A"),
        stringCell(0, 1, "B"),
        stringCell(1, 0, "C"),
        stringCell(1, 1, "D"),
      ],
      {
        columns: [
          { index: 0, widthPt: 20 },
          { index: 1, widthPt: 20 },
        ],
        rows: [
          { index: 0, heightPt: 20 },
          { index: 1, heightPt: 20 },
        ],
        printSettings: { ...basePrintSettings, gridlines: true },
      },
    );
    const layout = convert([s]);
    const lines = lineItems(layout.pages[0]!.items);
    expect(lines).toHaveLength(6); // 3 vertical + 3 horizontal, NOT 4 cells x 4 edges
  });
});

describe("cell text sizing: a run with no sizePt of its own defaults to the nominal CELL size, not shared.ts's docx-paragraph nominal size", () => {
  it("does not truncate real-world-shaped text (runs present, no sizePt) that comfortably fits at the 10pt cell default but would overflow at shared.ts's 18pt paragraph default", () => {
    // Confirmed as a real bug via this module's own real-file verification against a genuine LibreOffice-generated .ods: odf.js's readOdsContent populates `runs` for every cell with any text at all (not only genuinely mixed-formatting cells), and those runs carry no sizePt -- 'Acme Corp' (9 chars) at 18pt (90pt) overflows an 85pt-wide real column and gets wrongly truncated to 'Acme Cor', even though the very same text at the intended 10pt nominal size (50pt) fits comfortably.
    const s = sheet([stringCell(0, 0, "Acme Corp")], {
      columns: [{ index: 0, widthPt: 85 }],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    // wrapRunsToWidth atomises on whitespace -- glue (space) atoms advance the cursor but produce no rendered fragment of their own, so the two words join with no space between them here; the point under test is that BOTH full words ('Acme' and 'Corp') survive unclipped, not the exact inter-word spacing.
    expect(texts.map((t) => t.text).join("")).toBe("AcmeCorp");
  });

  it("still respects a run's own explicit sizePt when it has one", () => {
    // At the 10pt nominal default, 'Big' (3 chars * 1pt = 3pt) fits an 20pt column (16pt available) untouched. At the run's own explicit 60pt (3 chars * 6pt = 18pt), it overflows and truncates to 'Bi' (2 chars * 6pt = 12pt <= 16pt; a 3rd char would take it to 18pt > 16pt) -- proves the explicit size, not the nominal default, drove the overflow decision.
    const s = sheet(
      [stringCell(0, 0, "Big", { runs: [{ text: "Big", sizePt: 60 }] })],
      { columns: [{ index: 0, widthPt: 20 }] },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text).join("")).toBe("Bi");
  });
});

describe("step 7: cell text alignment, overflow, and vertical positioning", () => {
  it("renders ### for a numeric value that overflows its own column", () => {
    const s = sheet([numberCell(0, 0, 123456789, "123456789")], {
      columns: [{ index: 0, widthPt: 5 }],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text).join("")).toBe("###");
  });

  it("spills a left-aligned string into an empty neighbor cell to the right when it overflows", () => {
    // The neighbor cell is present but genuinely empty (kind 'empty', no displayText) -- both to exercise isCellVisuallyEmpty's own "present but valueless" branch, and so the print range's own populated-cell extent reaches column 1 at all (an absent cell at column 1 would leave nothing for the print range to widen the sheet's own bandable columns to).
    const s = sheet(
      [
        stringCell(0, 0, "HelloWorld"),
        { row: 0, column: 1, value: { kind: "empty" }, displayText: "" },
      ],
      {
        columns: [
          { index: 0, widthPt: 5 },
          { index: 1, widthPt: 30 },
        ],
      },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text).join("")).toBe("HelloWorld"); // full text survives, unspilled-truncated
  });

  it("truncates a left-aligned string overflow when the neighbor cell is not genuinely empty", () => {
    const s = sheet([stringCell(0, 0, "HelloWorld"), stringCell(0, 1, "X")], {
      columns: [
        { index: 0, widthPt: 5 },
        { index: 1, widthPt: 30 },
      ],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    const cell0Text = texts.find((t) => t.text !== "X")!;
    expect(cell0Text.text).toBe("H"); // available width after padding = 5 - 2*2 = 1pt = exactly 1 char at size 10
  });

  it("defaults alignment by value type when the cell has none of its own: numeric right, boolean/error center, string left", () => {
    const s = sheet(
      [
        stringCell(0, 0, "Str"),
        numberCell(1, 0, 42, "42"),
        booleanCell(2, 0, true),
      ],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [
          { index: 0, heightPt: 20 },
          { index: 1, heightPt: 20 },
          { index: 2, heightPt: 20 },
        ],
      },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.find((t) => t.text === "Str")!.xPt).toBeCloseTo(2, 5); // left: xLeft(0) + padding(2)
    expect(texts.find((t) => t.text === "42")!.xPt).toBeCloseTo(46, 5); // right: padding(2) + (avail(46) - width(2))
    expect(texts.find((t) => t.text === "TRUE")!.xPt).toBeCloseTo(23, 5); // center: padding(2) + (avail(46) - width(4))/2
  });

  it("stretches inter-word gaps on a justified cell's own rendered (first, non-final) line, mirroring src/layout/engine.ts's own identical justify behaviour", () => {
    // The cell's own source text carries an explicit line break ("aa bb\ncc dd"), the one way this module's own single-line-per-cell scope (see its top-of-file doc comment) ever produces more than one WrappedLine -- only the FIRST ("aa bb") is ever rendered, and since lines.length > 1 it counts as a genuinely non-final line for justification purposes. Column width 11pt minus 2*2pt padding = 7pt available -- "aa bb" is naturally 5pt wide (2 + 1 + 2, each word 2pt, the space 1pt), so it stretches to fill the remaining 2pt of slack across its own one gap, exactly as engine.ts's own justify test does.
    const s = sheet(
      [stringCell(0, 0, "aa bb\ncc dd", { alignment: "justify" })],
      {
        columns: [{ index: 0, widthPt: 11 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["aa", "bb"]); // only the first line ever renders -- 'cc dd' never appears
    expect(texts[0]?.xPt).toBeCloseTo(2, 5); // xLeft(0) + padding(2), no justify stretch on the first fragment
    expect(texts[1]?.xPt).toBeCloseTo(7, 5); // padding(2) + natural offset(3) + 2pt of distributed slack
  });

  it("leaves an ordinary single-line justified cell at its own natural, unstretched spacing (no wrapped non-final line to stretch)", () => {
    const s = sheet([stringCell(0, 0, "aa bb", { alignment: "justify" })], {
      columns: [{ index: 0, widthPt: 11 }],
      rows: [{ index: 0, heightPt: 20 }],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["aa", "bb"]);
    expect(texts[0]?.xPt).toBeCloseTo(2, 5); // xLeft(0) + padding(2)
    expect(texts[1]?.xPt).toBeCloseTo(5, 5); // padding(2) + natural offset(3), no stretch: lines.length === 1
  });

  it("defaults vertical alignment to bottom: the baseline sits near the cell's own bottom edge, not its top", () => {
    const s = sheet([stringCell(0, 0, "X")], {
      rows: [{ index: 0, heightPt: 100 }],
      columns: [{ index: 0, widthPt: 50 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 200, heightPt: 200 },
      },
    });
    const layout = convert([s]);
    const [text] = textItems(layout.pages[0]!.items);
    // lineHeight = 10*1.2 = 12; lineTopYDown = max(2, 100-2-12) = 86; baselineYDown = 86 + ascent(8) = 94; y = 200 - 94 = 106.
    expect(text!.yPt).toBeCloseTo(106, 5);
  });
});

// --- Step 7: per-cell background/borders, and explicit alignment/verticalAlignment overrides -----

describe("step 7: a cell's own background paints as a real LayoutRect", () => {
  it("emits one LayoutRect covering the cell's exact frame, attributed to that cell's own sourcePath", () => {
    const s = sheet(
      [
        stringCell(0, 0, "A", {
          background: { kind: "solid", color: RED },
          sourcePath: "sheets[0].cells[0]",
        }),
      ],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    const rects = rectItems(convert([s]).pages[0]!.items);
    expect(rects).toHaveLength(1);
    // Grid origin is (0, 0) y-down with zero margins and no gutter, so the cell's frame is (0, 0, 50, 20) y-down -> (0, 800-0-20, 50, 20) in PDF space.
    expect(rects[0]).toMatchObject({
      xPt: 0,
      yPt: 780,
      widthPt: 50,
      heightPt: 20,
      fill: RED,
      sourcePath: "sheets[0].cells[0]",
    });
  });

  it("spans the whole merged region for a colSpan/rowSpan anchor cell, not just its own single row/column", () => {
    const s = sheet(
      [
        stringCell(0, 0, "Merged", {
          background: { kind: "solid", color: RED },
          colSpan: 2,
          rowSpan: 2,
        }),
      ],
      {
        columns: [
          { index: 0, widthPt: 30 },
          { index: 1, widthPt: 40 },
        ],
        rows: [
          { index: 0, heightPt: 10 },
          { index: 1, heightPt: 15 },
        ],
      },
    );
    const [rect] = rectItems(convert([s]).pages[0]!.items);
    expect(rect).toMatchObject({ widthPt: 70, heightPt: 25 });
  });

  it("emits no rect at all for a cell with no background of its own", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      columns: [{ index: 0, widthPt: 50 }],
      rows: [{ index: 0, heightPt: 20 }],
    });
    expect(rectItems(convert([s]).pages[0]!.items)).toHaveLength(0);
  });
});

describe("step 7: a cell's own borders paint as real LayoutLines, one per declared edge", () => {
  it("emits exactly one line per DECLARED edge, at that edge's own position, with the border's own colour and width", () => {
    const s = sheet(
      [
        stringCell(0, 0, "A", {
          borders: {
            top: { color: RED, widthPt: 2 },
            left: { color: BLUE, widthPt: 3 },
          },
        }),
      ],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    const lines = lineItems(convert([s]).pages[0]!.items);
    expect(lines).toHaveLength(2); // top and left only -- right/bottom were never declared
    // The cell's y-down frame is (0, 0, 50, 20); its top edge is y-down 0 -> PDF y 800, its left edge x 0 running from PDF y 800 down to 780.
    expect(lines).toContainEqual(
      expect.objectContaining({
        x1Pt: 0,
        y1Pt: 800,
        x2Pt: 50,
        y2Pt: 800,
        color: RED,
        widthPt: 2,
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        x1Pt: 0,
        y1Pt: 800,
        x2Pt: 0,
        y2Pt: 780,
        color: BLUE,
        widthPt: 3,
      }),
    );
  });

  it("carries a declared border's own dash style through onto the emitted LayoutLine, as of document-schema.js 2.1.0", () => {
    const s = sheet(
      [
        stringCell(0, 0, "A", {
          borders: { bottom: { color: RED, widthPt: 2, style: "dashed" } },
        }),
      ],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    const [line] = lineItems(convert([s]).pages[0]!.items);
    expect(line).toMatchObject({ style: "dashed", color: RED, widthPt: 2 });
  });

  it("emits all four edges when all four are declared", () => {
    const border = { color: RED, widthPt: 1 };
    const s = sheet(
      [
        stringCell(0, 0, "A", {
          borders: { top: border, right: border, bottom: border, left: border },
        }),
      ],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    expect(lineItems(convert([s]).pages[0]!.items)).toHaveLength(4);
  });

  it("paints a cell border AFTER the generic gridlines, so a declared border wins over the gridline underneath it", () => {
    const s = sheet(
      [
        stringCell(0, 0, "A", {
          borders: { bottom: { color: RED, widthPt: 2 } },
        }),
      ],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [{ index: 0, heightPt: 20 }],
        printSettings: { ...basePrintSettings, gridlines: true },
      },
    );
    const { items } = convert([s]).pages[0]!;
    const lines = lineItems(items);
    const borderLine = lines.find((l) => l.widthPt === 2)!;
    const gridlineIndices = lines
      .filter((l) => l.widthPt !== 2)
      .map((l) => items.indexOf(l));
    expect(gridlineIndices.every((i) => i < items.indexOf(borderLine))).toBe(
      true,
    );
  });

  it("paints a cell background BEFORE the gridlines and all cell text AFTER them", () => {
    const s = sheet(
      [stringCell(0, 0, "A", { background: { kind: "solid", color: RED } })],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [{ index: 0, heightPt: 20 }],
        printSettings: { ...basePrintSettings, gridlines: true },
      },
    );
    const { items } = convert([s]).pages[0]!;
    const backgroundIndex = items.indexOf(rectItems(items)[0]!);
    const firstGridlineIndex = items.indexOf(lineItems(items)[0]!);
    const textIndex = items.indexOf(textItems(items)[0]!);
    expect(backgroundIndex).toBeLessThan(firstGridlineIndex);
    expect(firstGridlineIndex).toBeLessThan(textIndex);
  });
});

describe("step 7: a cell's own alignment/verticalAlignment override the defaults", () => {
  it("honours an explicit alignment instead of the value-kind default (a left-aligned NUMBER sits at the left inset, not the right edge)", () => {
    const s = sheet([numberCell(0, 0, 42, "42", { alignment: "left" })], {
      columns: [{ index: 0, widthPt: 50 }],
      rows: [{ index: 0, heightPt: 20 }],
    });
    const [text] = textItems(convert([s]).pages[0]!.items);
    expect(text!.xPt).toBeCloseTo(2, 5); // left: xLeft(0) + padding(2) -- the value-kind default would have put it at 46
  });

  it("honours an explicit alignment on a STRING cell too (right, not the string default of left)", () => {
    const s = sheet([stringCell(0, 0, "Str", { alignment: "right" })], {
      columns: [{ index: 0, widthPt: 50 }],
      rows: [{ index: 0, heightPt: 20 }],
    });
    const [text] = textItems(convert([s]).pages[0]!.items);
    expect(text!.xPt).toBeCloseTo(45, 5); // right: padding(2) + (avail(46) - width(3))
  });

  it("honours verticalAlignment top: the baseline sits near the cell's own TOP edge", () => {
    const s = sheet([stringCell(0, 0, "X", { verticalAlignment: "top" })], {
      rows: [{ index: 0, heightPt: 100 }],
      columns: [{ index: 0, widthPt: 50 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 200, heightPt: 200 },
      },
    });
    const [text] = textItems(convert([s]).pages[0]!.items);
    // lineTopYDown = 0 + padding(2) = 2; baselineYDown = 2 + ascent(8) = 10; y = 200 - 10 = 190.
    expect(text!.yPt).toBeCloseTo(190, 5);
  });

  it("honours verticalAlignment middle: the baseline sits centred between the cell's own top and bottom", () => {
    const s = sheet([stringCell(0, 0, "X", { verticalAlignment: "middle" })], {
      rows: [{ index: 0, heightPt: 100 }],
      columns: [{ index: 0, widthPt: 50 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 200, heightPt: 200 },
      },
    });
    const [text] = textItems(convert([s]).pages[0]!.items);
    // lineHeight = 12; lineTopYDown = max(2, (100-12)/2) = 44; baselineYDown = 44 + ascent(8) = 52; y = 200 - 52 = 148.
    expect(text!.yPt).toBeCloseTo(148, 5);
  });

  it("still falls back to bottom when the cell declares no verticalAlignment, unchanged from before the field existed", () => {
    const s = sheet([stringCell(0, 0, "X")], {
      rows: [{ index: 0, heightPt: 100 }],
      columns: [{ index: 0, widthPt: 50 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 200, heightPt: 200 },
      },
    });
    const [text] = textItems(convert([s]).pages[0]!.items);
    expect(text!.yPt).toBeCloseTo(106, 5);
  });

  it("keeps overflow keyed to the VALUE kind, not the resolved alignment: an explicitly left-aligned numeric overflow still renders ###", () => {
    const s = sheet(
      [numberCell(0, 0, 123456789, "123456789", { alignment: "left" })],
      { columns: [{ index: 0, widthPt: 5 }] },
    );
    expect(
      textItems(convert([s]).pages[0]!.items)
        .map((t) => t.text)
        .join(""),
    ).toBe("###");
  });
});

// --- Cancellation ------------------------------------------------------------------------------

describe("convertSpreadsheetToLayout: cancellation", () => {
  it("throws when the signal is already aborted before layout begins", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      convert(
        [sheet([stringCell(0, 0, "A")])],
        fakeMeasurer(),
        controller.signal,
      ),
    ).toThrow();
  });

  it("honors cancellation raised mid-run, from inside the main cell-emission loop -- not merely checked once at the top of the function", () => {
    const controller = new AbortController();
    const cellCount = 200;
    const cells = Array.from({ length: cellCount }, (_, i) =>
      stringCell(0, i, "x"),
    );
    const columns = cells.map((_, i) => ({ index: i, widthPt: 10 }));
    let measureCalls = 0;
    const base = fakeMeasurer();
    const measurer: TextMeasurer = {
      ...base,
      widthOfTextAtSize(text, font, sizePt) {
        measureCalls++;
        if (measureCalls === 20) {
          controller.abort();
        }
        return base.widthOfTextAtSize(text, font, sizePt);
      },
    };
    const s = sheet(cells, {
      columns,
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100_000, heightPt: 800 },
      },
    });
    expect(() => convert([s], measurer, controller.signal)).toThrow();
    // Proves the loop stopped well short of processing all 200 cells' worth of measurement calls, rather than running to completion and only checking the signal once at the very top.
    expect(measureCalls).toBeLessThan(50);
  });
});

// --- Cross-sheet: multiple sheets concatenate their own pages in order --------------------------

describe("convertSpreadsheetToLayout: multiple sheets", () => {
  it("concatenates each sheet's own pages, in sheet order", () => {
    const layout = convert([
      sheet([stringCell(0, 0, "First")], { name: "One" }),
      sheet([stringCell(0, 0, "Second")], { name: "Two" }),
    ]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "First",
    ]);
    expect(textItems(layout.pages[1]!.items).map((t) => t.text)).toEqual([
      "Second",
    ]);
  });
});

// --- Cell-anchored embedded formulas -----------------------------------------------------------

// Real MathML rather than a stub: layoutFormula is genuinely invoked here (loadMathFont/the STIX MATH table drive the box), so an assertion on the resulting box's own dimensions would be an assertion about that font, not about this module. What this module owns is WHERE the box lands and WHETHER it is emitted at all, which is what every test below checks.
const MI_X: MathMlNode[] = [
  {
    type: "element",
    tag: "mi",
    attributes: [],
    children: [{ type: "text", value: "x" }],
  },
];

// A genuinely STACKED formula (a fraction inside a square root): its total height is well over twice its base font size, the case the single-pass height/2 heuristic over-estimates badly for -- the two-pass fit exists to size it to the declared frame instead.
const SQRT_FRAC: MathMlNode[] = [
  {
    type: "element",
    tag: "msqrt",
    attributes: [],
    children: [
      {
        type: "element",
        tag: "mfrac",
        attributes: [],
        children: [
          {
            type: "element",
            tag: "mn",
            attributes: [],
            children: [{ type: "text", value: "123" }],
          },
          {
            type: "element",
            tag: "mn",
            attributes: [],
            children: [{ type: "text", value: "456" }],
          },
        ],
      },
    ],
  },
];

function formulaObject(
  anchorRow: number,
  anchorColumn: number,
  offsetXPt: number,
  offsetYPt: number,
  overrides: Partial<ContentEmbeddedObject> = {},
): ContentEmbeddedObject {
  return {
    objectKind: "formula",
    document: { kind: "formula", metadata: {}, formula: { mathml: MI_X } },
    frame: { xPt: offsetXPt, yPt: offsetYPt, widthPt: 40, heightPt: 24 },
    anchorRow,
    anchorColumn,
    offsetXPt,
    offsetYPt,
    ...overrides,
  };
}

const COLUMNS_20 = [0, 1, 2, 3].map((index) => ({ index, widthPt: 20 }));
const ROWS_10 = [0, 1, 2, 3].map((index) => ({ index, heightPt: 10 }));

describe("convertSpreadsheetToLayout: cell-anchored embedded formulas", () => {
  it("positions a formula at its own anchor cell plus its cell-relative offset, flipped into PDF page space", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(3, 3, "D")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      embeddedObjects: [formulaObject(2, 1, 3, 4)],
    });
    const { formulas } = convertResult([s]);
    expect(formulas).toHaveLength(1);
    const [positioned] = formulas;
    expect(positioned!.pageIndex).toBe(0);
    // Column 1 starts one 20pt column in; the 3pt offset is a cell-local inset, applied unscaled.
    expect(positioned!.xPt).toBeCloseTo(0 + 20 + 3, 6);
    // Row 2 starts two 10pt rows down from the grid top; y-down 20 + 4, flipped through the 800pt page against the box's own height.
    expect(positioned!.yPt).toBeCloseTo(
      800 - (0 + 20 + 4) - positioned!.box.heightPt,
      6,
    );
  });

  it("sizes a stacked formula to fit its declared frame in both dimensions, rather than overflowing it", () => {
    // A fraction-inside-a-square-root has a total height well over twice its base font size, so the old height/2 heuristic over-estimates and the laid-out box overflows the frame. The frame carries a real width+height (the ODF draw:frame geometry readOdsContent provides); a docx OMML equation has widthPt 0 and falls back to the height-only path, which this test does not exercise.
    const stacked = formulaObject(0, 0, 0, 0, {
      document: {
        kind: "formula",
        metadata: {},
        formula: { mathml: SQRT_FRAC },
      },
      frame: { xPt: 0, yPt: 0, widthPt: 60, heightPt: 30 },
    });
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      embeddedObjects: [stacked],
    });
    const { formulas } = convertResult([s]);
    expect(formulas).toHaveLength(1);
    // The fit invariant: the laid-out box must sit within the frame's declared width AND height, whichever is the binding constraint.
    expect(formulas[0]!.box.heightPt).toBeLessThanOrEqual(30);
    expect(formulas[0]!.box.widthPt).toBeLessThanOrEqual(60);
  });

  it("widens the print range to cover an anchor cell beyond the populated-cell extent, so the formula still renders", () => {
    // The only populated cell is A1; without the anchor participating in the range, column 3/row 3 would sit in no band at all and the formula would silently never be emitted.
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      embeddedObjects: [formulaObject(3, 3, 0, 0)],
    });
    const { document: layout, formulas } = convertResult([s]);
    expect(formulas).toHaveLength(1);
    expect(formulas[0]!.xPt).toBeCloseTo(60, 6);
    expect(formulas[0]!.yPt).toBeCloseTo(
      800 - 30 - formulas[0]!.box.heightPt,
      6,
    );
    // The cell content itself is unaffected -- widening the range adds no text of its own.
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual(["A"]);
  });

  it("renders a sheet carrying nothing but an anchored formula, which would otherwise have no print range at all", () => {
    const s = sheet([], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      embeddedObjects: [formulaObject(0, 0, 0, 0)],
    });
    const { document: layout, formulas } = convertResult([s]);
    expect(layout.pages).toHaveLength(1);
    expect(formulas).toHaveLength(1);
  });

  it("honors an explicit printRange rather than widening it, leaving an anchor outside that range unrendered", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      printSettings: {
        ...basePrintSettings,
        printRange: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      },
      embeddedObjects: [formulaObject(3, 3, 0, 0)],
    });
    expect(convertResult([s]).formulas).toEqual([]);
  });

  it("accounts for the header gutter and page margins, since it reads the already-positioned axes rather than recomputing them", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      printSettings: {
        ...basePrintSettings,
        headers: true,
        margins: { topPt: 5, rightPt: 0, bottomPt: 0, leftPt: 7 },
      },
      embeddedObjects: [formulaObject(0, 0, 1, 2)],
    });
    const measurer = fakeMeasurer();
    const { formulas } = convertResult([s], measurer);
    // Header gutter: as wide as the widest row label plus two paddings, as tall as one header line -- read back from the measurer rather than restated as a literal.
    const gutterWidthPt =
      measurer.widthOfTextAtSize("1", DEFAULT_LAYOUT_FONT, 8) + 2 * 2;
    const gutterHeightPt = measurer.lineHeightAtSize(DEFAULT_LAYOUT_FONT, 8);
    expect(formulas[0]!.xPt).toBeCloseTo(7 + gutterWidthPt + 1, 6);
    expect(formulas[0]!.yPt).toBeCloseTo(
      800 - (5 + gutterHeightPt + 2) - formulas[0]!.box.heightPt,
      6,
    );
  });

  it("skips an anchor in a hidden column or a hidden row, exactly as it skips that cell's own content", () => {
    const hiddenColumns = [
      { index: 0, widthPt: 20 },
      { index: 1, widthPt: 20, hidden: true },
      { index: 2, widthPt: 20 },
      { index: 3, widthPt: 20 },
    ];
    const hiddenRows = [
      { index: 0, heightPt: 10 },
      { index: 1, heightPt: 10, hidden: true },
      { index: 2, heightPt: 10 },
      { index: 3, heightPt: 10 },
    ];
    const hiddenColumnSheet = sheet([stringCell(0, 0, "A")], {
      columns: hiddenColumns,
      rows: ROWS_10,
      embeddedObjects: [formulaObject(0, 1, 0, 0)],
    });
    const hiddenRowSheet = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: hiddenRows,
      embeddedObjects: [formulaObject(1, 0, 0, 0)],
    });
    expect(convertResult([hiddenColumnSheet]).formulas).toEqual([]);
    expect(convertResult([hiddenRowSheet]).formulas).toEqual([]);
  });

  it("skips an embedded object that is not a formula, one whose document carries no MathML, and one with no anchor", () => {
    const notFormula: ContentEmbeddedObject = {
      ...formulaObject(0, 0, 0, 0),
      objectKind: "drawing",
    };
    const emptyMathml: ContentEmbeddedObject = {
      ...formulaObject(0, 0, 0, 0),
      document: {
        kind: "formula",
        metadata: {},
        formula: { mathml: [], starMath: "x" },
      },
    };
    const anchorless: ContentEmbeddedObject = {
      objectKind: "formula",
      document: { kind: "formula", metadata: {}, formula: { mathml: MI_X } },
      frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 24 },
    };
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      embeddedObjects: [notFormula, emptyMathml, anchorless],
    });
    expect(convertResult([s]).formulas).toEqual([]);
  });

  it("emits a formula anchored inside a repeat row band once per page carrying that band", () => {
    // Two row bands (four 10pt rows, 20pt of bandable height available after the repeat row) means two pages; the repeat row -- and therefore its anchored formula -- appears on both.
    const cells = [0, 1, 2, 3, 4].map((row) => stringCell(row, 0, `r${row}`));
    const s = sheet(cells, {
      columns: COLUMNS_20,
      rows: [0, 1, 2, 3, 4].map((index) => ({ index, heightPt: 10 })),
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 600, heightPt: 30 },
        repeatRows: { start: 0, end: 0 },
      },
      embeddedObjects: [formulaObject(0, 0, 0, 0)],
    });
    const { document: layout, formulas } = convertResult([s]);
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(formulas).toHaveLength(layout.pages.length);
    expect(formulas.map((f) => f.pageIndex)).toEqual(
      layout.pages.map((_, index) => index),
    );
  });

  it("numbers pageIndex across the whole document, not per sheet", () => {
    const first = sheet([stringCell(0, 0, "First")], {
      name: "One",
      columns: COLUMNS_20,
      rows: ROWS_10,
    });
    const second = sheet([stringCell(0, 0, "Second")], {
      name: "Two",
      columns: COLUMNS_20,
      rows: ROWS_10,
      embeddedObjects: [formulaObject(0, 0, 0, 0)],
    });
    const { document: layout, formulas } = convertResult([first, second]);
    expect(layout.pages).toHaveLength(2);
    expect(formulas.map((f) => f.pageIndex)).toEqual([1]);
  });
});

// A ContentSheetImage carries the identical anchor quartet a cell-anchored formula does, and resolves through the same axis lookup -- these tests hold that it now reaches the LayoutDocument as a real LayoutImage (it used to render nothing at all: sheets.ts emitted no image items, and convertSpreadsheetToLayout hardcoded images: {}).
function tinyPngImage(
  anchorRow: number,
  anchorColumn: number,
  offsetXPt: number,
  offsetYPt: number,
  overrides: Partial<ContentSheetImage> = {},
): ContentSheetImage {
  const bytes = encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  });
  const base: ContentImageBlock = {
    kind: "image",
    format: "png",
    base64: bytesToBase64(bytes),
    widthPt: 50,
    heightPt: 30,
  };
  return {
    ...base,
    anchorRow,
    anchorColumn,
    offsetXPt,
    offsetYPt,
    ...overrides,
  };
}

function imageItems(items: readonly LayoutItem[]): LayoutImage[] {
  return items.filter((i): i is LayoutImage => i.kind === "image");
}

describe("convertSpreadsheetToLayout: cell-anchored images (ContentSheet.images)", () => {
  it("renders a floating image at its own anchor cell plus its cell-relative offset, and registers the asset", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      images: [tinyPngImage(0, 0, 3, 4)],
    });
    const { document: layout } = convertResult([s]);

    // The asset is registered exactly once in the document-wide image registry.
    expect(Object.keys(layout.images)).toHaveLength(1);
    const [asset] = Object.values(layout.images);
    expect(asset!.format).toBe("png");

    const images = imageItems(layout.pages[0]!.items);
    expect(images).toHaveLength(1);
    const [image] = images;
    // Column 0 / row 0 both start at offset 0; the (3, 4) offset is a cell-local inset. x is unaffected by the y-flip; y flips the box's own top through the 800pt page.
    expect(image!.xPt).toBeCloseTo(3, 6);
    expect(image!.yPt).toBeCloseTo(800 - 4 - 30, 6);
    expect(image!.widthPt).toBe(50);
    expect(image!.heightPt).toBe(30);
    // The imageId references the one registered asset, not a bare literal.
    expect(image!.imageId).toBe(Object.keys(layout.images)[0]);
  });

  it("skips an image anchored in a hidden column or row, exactly as it skips that cell's own content and an anchored formula", () => {
    const hiddenColumns = [
      { index: 0, widthPt: 20 },
      { index: 1, widthPt: 20, hidden: true },
      { index: 2, widthPt: 20 },
      { index: 3, widthPt: 20 },
    ];
    const hiddenRows = [
      { index: 0, heightPt: 10 },
      { index: 1, heightPt: 10, hidden: true },
      { index: 2, heightPt: 10 },
      { index: 3, heightPt: 10 },
    ];
    const hiddenColumnSheet = sheet([stringCell(0, 0, "A")], {
      columns: hiddenColumns,
      rows: ROWS_10,
      images: [tinyPngImage(0, 1, 0, 0)],
    });
    const hiddenRowSheet = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: hiddenRows,
      images: [tinyPngImage(1, 0, 0, 0)],
    });
    expect(imageItems(convert([hiddenColumnSheet]).pages[0]!.items)).toEqual(
      [],
    );
    expect(imageItems(convert([hiddenRowSheet]).pages[0]!.items)).toEqual([]);
  });

  it("widens the print range to cover an image anchor beyond the populated-cell extent, so the image still renders", () => {
    // Only A1 is populated; without the image anchor participating in the range, column 3/row 3 would sit in no band and the image would silently never emit.
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      images: [tinyPngImage(3, 3, 0, 0)],
    });
    const { document: layout } = convertResult([s]);
    const images = imageItems(layout.pages[0]!.items);
    expect(images).toHaveLength(1);
    // Column 3 starts three 20pt columns in; row 3 three 10pt rows down.
    expect(images[0]!.xPt).toBeCloseTo(60, 6);
    expect(images[0]!.yPt).toBeCloseTo(800 - 30 - 30, 6);
  });

  it("honors an explicit printRange rather than widening it, leaving an image anchored outside that range unrendered", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      columns: COLUMNS_20,
      rows: ROWS_10,
      printSettings: {
        ...basePrintSettings,
        printRange: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 },
      },
      images: [tinyPngImage(3, 3, 0, 0)],
    });
    expect(imageItems(convert([s]).pages[0]!.items)).toEqual([]);
  });
});
