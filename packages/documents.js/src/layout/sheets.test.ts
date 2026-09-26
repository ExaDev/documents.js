import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";

import type { LayoutItem, LayoutText, TextMeasurer } from "pdf-codec";
import { loadMathFont } from "pdf-codec";
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { convertSpreadsheetToLayout } from "./sheets";

// Every character is sizePt/10 pt wide; lineHeightAtSize is 1.2x, ascender 0.8x, descender -0.2x — the same fake-measurer convention already used across src/layout/engine.test.ts and src/layout/slides.test.ts.
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

// The LayoutDocument half alone, which is all every geometry/text/gridline assertion below cares about — the formula half has its own dedicated describe block, and reads convertResult directly.
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
    // Zero available width would otherwise still trigger the numeric-overflow ###/string-truncate path — confirmed as a real bug via this module's own real-file verification (a genuine hidden ODS column produced a stray '###' overlapping the next visible column). The fix checks hidden-ness directly, not the incidental zero-width side effect.
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
    // y-up: row B sits BELOW row A by exactly one visible row height (30pt) — the hidden row between contributes nothing.
    expect(a.yPt - b.yPt).toBeCloseTo(30, 5);
  });
});

// --- Step 3: header-gutter and repeat-row/column reservation --------------------------------------
