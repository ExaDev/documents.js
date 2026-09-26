import { convertSpreadsheetToLayout } from "./sheets";
import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import type {
  LayoutItem,
  LayoutLine,
  LayoutRect,
  LayoutText,
  TextMeasurer,
} from "pdf-codec";
import { loadMathFont } from "pdf-codec";
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
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

const RED = { r: 1, g: 0, b: 0 };

const basePrintSettings: ContentSheetPrintSettings = {
  pageSize: { widthPt: 600, heightPt: 800 },
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

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

function lineItems(items: readonly LayoutItem[]): LayoutLine[] {
  return items.filter((i): i is LayoutLine => i.kind === "line");
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

function doc(
  sheets: ContentSheet[],
): Extract<ContentDocument, { kind: "spreadsheet" }> {
  return { kind: "spreadsheet", metadata: {}, sheets };
}

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

function rectItems(items: readonly LayoutItem[]): LayoutRect[] {
  return items.filter((i): i is LayoutRect => i.kind === "rect");
}

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
    // Without the manual break, all three 10pt columns fit easily in a 100pt page — one band. The break at column 1 forces a second.
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
    // Confirmed as a real bug via this module's own real-file verification against a genuine LibreOffice-generated .ods: odf.js's readOdsContent populates `runs` for every cell with any text at all (not only genuinely mixed-formatting cells), and those runs carry no sizePt — 'Acme Corp' (9 chars) at 18pt (90pt) overflows an 85pt-wide real column and gets wrongly truncated to 'Acme Cor', even though the very same text at the intended 10pt nominal size (50pt) fits comfortably.
    const s = sheet([stringCell(0, 0, "Acme Corp")], {
      columns: [{ index: 0, widthPt: 85 }],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    // wrapRunsToWidth atomises on whitespace — glue (space) atoms advance the cursor but produce no rendered fragment of their own, so the two words join with no space between them here; the point under test is that BOTH full words ('Acme' and 'Corp') survive unclipped, not the exact inter-word spacing.
    expect(texts.map((t) => t.text).join("")).toBe("AcmeCorp");
  });

  it("still respects a run's own explicit sizePt when it has one", () => {
    // At the 10pt nominal default, 'Big' (3 chars * 1pt = 3pt) fits an 20pt column (16pt available) untouched. At the run's own explicit 60pt (3 chars * 6pt = 18pt), it overflows and truncates to 'Bi' (2 chars * 6pt = 12pt <= 16pt; a 3rd char would take it to 18pt > 16pt) — proves the explicit size, not the nominal default, drove the overflow decision.
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
    // The neighbor cell is present but genuinely empty (kind 'empty', no displayText) — both to exercise isCellVisuallyEmpty's own "present but valueless" branch, and so the print range's own populated-cell extent reaches column 1 at all (an absent cell at column 1 would leave nothing for the print range to widen the sheet's own bandable columns to).
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
    // The cell's own source text carries an explicit line break ("aa bb\ncc dd"), the one way this module's own single-line-per-cell scope (see its top-of-file doc comment) ever produces more than one WrappedLine — only the FIRST ("aa bb") is ever rendered, and since lines.length > 1 it counts as a genuinely non-final line for justification purposes. Column width 11pt minus 2*2pt padding = 7pt available — "aa bb" is naturally 5pt wide (2 + 1 + 2, each word 2pt, the space 1pt), so it stretches to fill the remaining 2pt of slack across its own one gap, exactly as engine.ts's own justify test does.
    const s = sheet(
      [stringCell(0, 0, "aa bb\ncc dd", { alignment: "justify" })],
      {
        columns: [{ index: 0, widthPt: 11 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["aa", "bb"]); // only the first line ever renders — 'cc dd' never appears
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

  it("emits no rect at all for a pattern fill that resolves to no colour, rather than a fill-less no-op one", () => {
    // A 'pattern' fill stating neither foregroundColor nor backgroundColor (the reserved gray125 scaffolding pattern, or a theme/indexed colour this reader could not resolve) is exactly the case resolveCellFillColor's own doc comment names as returning undefined — genuinely no fill, not a reason to still push a rect item that would render invisibly.
    const s = sheet(
      [
        stringCell(0, 0, "A", {
          background: { kind: "pattern", patternType: "gray125" },
        }),
      ],
      {
        columns: [{ index: 0, widthPt: 50 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    expect(rectItems(convert([s]).pages[0]!.items)).toHaveLength(0);
  });
});
