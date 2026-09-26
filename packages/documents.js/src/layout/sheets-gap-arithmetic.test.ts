import { bytesToBase64 } from "ooxml.js";
import { convertSpreadsheetToLayout } from "./sheets";
import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentImageBlock,
  ContentSheet,
  ContentSheetCell,
  ContentSheetImage,
  ContentSheetPrintSettings,
} from "document-schema.js";
import type {
  LayoutItem,
  LayoutLine,
  LayoutText,
  TextMeasurer,
} from "pdf-codec";
import { encodePng } from "byte-codec";
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

describe("step 7: gridlines (mutation gap: exact flipped y-coordinates)", () => {
  it("draws each vertical gridline at its own correctly-flipped page-space y-span, not merely the right count", () => {
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
        printSettings: {
          ...basePrintSettings,
          gridlines: true,
          margins: { topPt: 10, rightPt: 0, bottomPt: 0, leftPt: 0 },
        },
      },
    );
    const layout = convert([s]);
    const lines = lineItems(layout.pages[0]!.items);
    const vertical = lines.find((l) => l.x1Pt === l.x2Pt && l.x1Pt === 0)!;
    expect(vertical.y1Pt).toBeCloseTo(790, 5);
    expect(vertical.y2Pt).toBeCloseTo(750, 5);
  });
});

// --- Mutation-gap coverage: page-content/available-width arithmetic --------------------------------

describe("convertSheetToPages orchestration (mutation gap: margin, gutter, and repeat-width arithmetic)", () => {
  it("subtracts both left and right margins from the page width, and both top and bottom margins from the page height", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 1, "B")], {
      columns: [
        { index: 0, widthPt: 20 },
        { index: 1, widthPt: 20 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 100 },
        margins: { topPt: 3, rightPt: 7, bottomPt: 5, leftPt: 11 },
      },
    });
    const layout = convert([s]);
    const a = textItems(layout.pages[0]!.items).find((t) => t.text === "A")!;
    // gridLeftXPt = margins.left(11) + gutter(0, headers false) = 11. A's own xPt = 11 + padding(2) = 13.
    expect(a.xPt).toBeCloseTo(13, 5);
  });

  it("subtracts both the header gutter and the repeat-column width from the page content width when computing available band width", () => {
    const s = sheet(
      [stringCell(0, 0, "RPT"), stringCell(0, 1, "A"), stringCell(0, 2, "B")],
      {
        columns: [
          { index: 0, widthPt: 20 },
          { index: 1, widthPt: 35 },
          { index: 2, widthPt: 35 },
        ],
        printSettings: {
          ...basePrintSettings,
          pageSize: { widthPt: 100, heightPt: 100 },
          headers: true,
          repeatColumns: { start: 0, end: 0 },
        },
      },
    );
    const layout = convert([s]);
    // gutter width = widthOfTextAtSize('1', font, 8) + 4 = 4.8. availableWidthPt = 100 - 4.8 - 20 = 75.2, which fits both 35pt bandable columns (70) in one band.
    expect(layout.pages).toHaveLength(1);
  });
});

describe("convertSheetToPages orchestration (mutation gap: totalBandableHeightPt sums every row, not subtracts)", () => {
  it("sums two distinct bandable row heights (not subtracts one from the other) when computing the fit-to-page height ratio", () => {
    // fitToPages of {1,1} isolates the reduce's own +/- arithmetic from the separate width/height budget multiplier already covered above: a subtracted (rather than summed) total would flip totalBandableHeightPt negative, driving heightRatio negative and clamping scale down to MINIMUM_SCALE (0.01) instead of the real 0.5.
    const s = sheet([stringCell(0, 0, "A"), stringCell(1, 0, "B")], {
      columns: [{ index: 0, widthPt: 10 }],
      rows: [
        { index: 0, heightPt: 100 },
        { index: 1, heightPt: 300 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 2000, heightPt: 200 },
        fitToPages: { width: 1, height: 1 },
        gridlines: true,
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
    // totalBandableHeightPt = 100+300 = 400. budgetHeightPt = 200*1=200. heightRatio = 200/400 = 0.5. Scaled row boundaries: 0, 100*0.5=50, 400*0.5=200.
    const horizontal = lineItems(layout.pages[0]!.items).filter(
      (l) => l.y1Pt === l.y2Pt,
    );
    expect(horizontal.map((l) => l.y1Pt).sort((a, b) => a - b)).toEqual([
      0, 150, 200,
    ]);
  });
});

describe("convertSheetToPages orchestration (mutation gap: descaled available space divides, never multiplies, by scale)", () => {
  it("descales the available band width by dividing by scale, so a scaled-down page still bands at the DEscaled size, not a further-shrunk one", () => {
    // scalePercent 50 halves every column, but band boundaries are decided against descaledAvailableWidthPt = availableWidthPt/scale = 60/0.5 = 120pt: comfortably more than the two 40pt columns' 80pt unscaled total, so both land in ONE band. Dividing by scale is what makes fit-to-page pagination band against the UNSCALED page content, not a doubly-shrunk one; multiplying it instead would halve the descaled budget to 15pt, well under even a single 40pt column, splitting into two bands.
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 1, "B")], {
      columns: [
        { index: 0, widthPt: 40 },
        { index: 1, widthPt: 40 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 60, heightPt: 100 },
        scalePercent: 50,
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
  });
});

// --- Mutation-gap coverage: cancellation checked at every distinct loop boundary -------------------

describe("convertSpreadsheetToLayout: cancellation (mutation gap: each throwIfAborted call site independently)", () => {
  it("throws at the very top of a sheet's own pass, before it ever resolves a print range, when the sheet has no populated content to fall back on", () => {
    const controller = new AbortController();
    controller.abort();
    const s = sheet([]); // no cells, no formulas, no images: resolvePrintRange would return undefined immediately after
    expect(() => convert([s], fakeMeasurer(), controller.signal)).toThrow();
  });

  it("throws after the header gutter is computed but before band partitioning begins, even when the sheet carries no cells to trip the per-cell check", () => {
    const controller = new AbortController();
    const base = fakeMeasurer();
    const measurer: TextMeasurer = {
      ...base,
      widthOfTextAtSize(text, font, sizePt) {
        controller.abort();
        return base.widthOfTextAtSize(text, font, sizePt);
      },
    };
    const s = sheet([], {
      images: [tinyPngImage(0, 0, 0, 0)], // widens the print range with no populated cell, so cellsByRow stays empty
      printSettings: { ...basePrintSettings, headers: true },
    });
    expect(() => convert([s], measurer, controller.signal)).toThrow();
  });

  it("throws at the top of each page's own emission, even for a page whose own row band carries no populated cell to trip the per-cell check", () => {
    const controller = new AbortController();
    const base = fakeMeasurer();
    let aborted = false;
    const measurer: TextMeasurer = {
      ...base,
      widthOfTextAtSize(text, font, sizePt) {
        if (!aborted) {
          aborted = true;
          controller.abort();
        }
        return base.widthOfTextAtSize(text, font, sizePt);
      },
    };
    const s = sheet([stringCell(0, 0, "A")], {
      printSettings: {
        ...basePrintSettings,
        printRange: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
        manualBreaks: { rows: [1], columns: [] },
      },
    });
    // Row 0 (carrying the only cell) renders on page one, triggering the abort during its own text measurement. Row 1 is explicitly in range but has no cell at all, so page two's own row loop never reaches the per-cell check. Only the top-of-page check can catch the abort there.
    expect(() => convert([s], measurer, controller.signal)).toThrow();
  });
});

// --- Mutation-gap coverage round 2: resolvePrintRange's early-return short-circuits everything -----

describe("step 1: resolve the print range (mutation gap: the early return actually short-circuits)", () => {
  it("never computes any downstream layout geometry when the sheet is genuinely empty on every axis", () => {
    let measurerCalls = 0;
    const base = fakeMeasurer();
    const measurer: TextMeasurer = {
      ...base,
      widthOfTextAtSize(text, font, sizePt) {
        measurerCalls++;
        return base.widthOfTextAtSize(text, font, sizePt);
      },
    };
    const s = sheet([], {
      printSettings: { ...basePrintSettings, headers: true },
    });
    const layout = convert([s], measurer);
    expect(layout.pages).toHaveLength(0);
    // headers:true would force computeHeaderGutter to call the measurer if resolvePrintRange's own early-return guard ever let execution reach it; it must not.
    expect(measurerCalls).toBe(0);
  });
});

// --- Mutation-gap coverage round 2: truncateFragmentsToWidth's per-fragment boundary checks ---------

describe("step 7: cell text truncation (mutation gap: a non-first fragment's own remaining budget subtracts its offset)", () => {
  it("computes a second fragment's remaining budget by subtracting its own offset, not adding it", () => {
    const cell: ContentSheetCell = {
      row: 0,
      column: 0,
      value: { kind: "error", value: "E" },
      displayText: "AAAABBBB",
      runs: [{ text: "AAAA" }, { text: "BBBB" }],
    };
    // avail = 10 - 2*padding = 6. "AAAA" (4pt) fits in full, leaving a real remaining budget of 6-4=2pt for "BBBB" (4pt), which truncates to its first two characters.
    const s = sheet([cell], { columns: [{ index: 0, widthPt: 10 }] });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["AAAA", "BB"]);
  });
});

describe("step 7: cell text truncation (mutation gap: a fragment starting exactly at the boundary is skipped, never remeasured)", () => {
  it("skips a fragment whose own offset lands exactly on the boundary without remeasuring it, even one that would technically fit at zero width", () => {
    const measurer: TextMeasurer = {
      ...fakeMeasurer(),
      widthOfTextAtSize: (text, font, sizePt) =>
        text === "Z" ? 0 : Array.from(text).length * (sizePt / 10),
    };
    const cell: ContentSheetCell = {
      row: 0,
      column: 0,
      value: { kind: "error", value: "E" },
      displayText: "ABZC",
      runs: [{ text: "AB" }, { text: "Z" }, { text: "C" }],
    };
    // avail = 6 - 2*padding = 2. "AB" (2pt) fills it exactly, so "Z" (a genuinely zero-width fragment) starts precisely at the 2pt boundary and must never be considered, let alone included.
    const s = sheet([cell], { columns: [{ index: 0, widthPt: 6 }] });
    const layout = convert([s], measurer);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["AB"]);
  });
});

describe("step 7: cell text truncation (mutation gap: zero characters fitting emits no fragment at all)", () => {
  it("emits nothing for an overflowing fragment whose own first character already exceeds the remaining space", () => {
    const measurer: TextMeasurer = {
      ...fakeMeasurer(),
      widthOfTextAtSize: (text, font, sizePt) =>
        text === "W" ? 10 : Array.from(text).length * (sizePt / 10),
    };
    const cell: ContentSheetCell = {
      row: 0,
      column: 0,
      value: { kind: "error", value: "E" },
      displayText: "ABW",
      runs: [{ text: "AB" }, { text: "W" }],
    };
    // avail = 7 - 2*padding = 3. "AB" (2pt) fits with 1pt of remaining space left for "W", whose own single character is 10pt wide.
    const s = sheet([cell], { columns: [{ index: 0, widthPt: 7 }] });
    const layout = convert([s], measurer);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["AB"]);
  });
});

// --- Mutation-gap coverage round 2: overflowed suppresses justify-stretch after a full spill too ----

describe("step 7: justify gap-stretching (mutation gap: suppressed after a spill fully absorbs the overflow)", () => {
  it("suppresses justify gap-stretching once a spill has fully absorbed the overflow, not just when nothing ever overflowed", () => {
    const s = sheet(
      [
        stringCell(0, 0, "aa bb\ncc dd", { alignment: "justify" }),
        { row: 0, column: 1, value: { kind: "empty" }, displayText: "" },
      ],
      {
        columns: [
          { index: 0, widthPt: 7 },
          { index: 1, widthPt: 10 },
        ],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["aa", "bb"]);
    expect(texts[0]!.xPt).toBeCloseTo(2, 5);
    expect(texts[1]!.xPt).toBeCloseTo(5, 5);
  });
});

// --- Mutation-gap coverage round 2: the string-spill branch is exclusive to string-kind cells -------

describe("step 7: overflow branch selection (mutation gap: only a string-kind cell ever spills)", () => {
  it("never takes the string-spill branch for a boolean/error cell, even when a spillable empty neighbor exists", () => {
    const s = sheet(
      [
        booleanCell(0, 0, true),
        { row: 0, column: 1, value: { kind: "empty" }, displayText: "" },
      ],
      {
        columns: [
          { index: 0, widthPt: 6 },
          { index: 1, widthPt: 10 },
        ],
      },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text).join("")).toBe("TR");
  });
});

// --- Mutation-gap coverage round 2: header-label geometry at a non-zero axis position ----------------

describe("step 3: header-gutter labels (mutation gap: a non-first position's own offset arithmetic)", () => {
  it("positions a second column's and a second row's own label using their own axis offset, not the first position's", () => {
    const s = sheet([stringCell(0, 0, "X"), stringCell(1, 1, "Y")], {
      columns: [
        { index: 0, widthPt: 40 },
        { index: 1, widthPt: 40 },
      ],
      rows: [
        { index: 0, heightPt: 30 },
        { index: 1, heightPt: 30 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 200, heightPt: 200 },
        headers: true,
      },
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    const columnLabelB = texts.find((t) => t.text === "B")!;
    const rowLabel2 = texts.find((t) => t.text === "2")!;
    // gridLeftXPt = 4.8. offsetsPt[1] = 40 (column 0's own width). labelWidth('B') = 0.8. center offset = (40-0.8)/2 = 19.6. xPt = 4.8+40+19.6 = 64.4.
    expect(columnLabelB.xPt).toBeCloseTo(64.4, 5);
    // gridTopYDownPt = 9.6. rowAxis.offsetsPt[1] = 30 (row 0's own height). rowTopYDownPt = 39.6. baselineYDownPt = 39.6 + max(0,(30-9.6)/2=10.2) + ascent(6.4) = 56.2. yPt = 200-56.2 = 143.8.
    expect(rowLabel2.yPt).toBeCloseTo(143.8, 5);
  });

  it("clamps a narrower-than-widest row label's own left inset using the wider of the two candidate widths, not the narrower", () => {
    const cells = Array.from({ length: 10 }, (_, i) =>
      stringCell(i, 0, String(i)),
    );
    const s = sheet(cells, {
      rows: Array.from({ length: 10 }, (_, i) => ({ index: i, heightPt: 20 })),
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 300, heightPt: 300 },
        headers: true,
      },
    });
    const layout = convert([s]);
    const rowLabel1 = textItems(layout.pages[0]!.items).find(
      (t) => t.text === "1",
    )!;
    // The widest label is "10" (row index 9), sizing gutter.widthPt = widthOf('10',8) + 4 = 1.6+4 = 5.6. Row 0's own label "1" is narrower: candidate = 5.6-2-0.8 = 2.8, genuinely larger than the fixed padding floor (2), so the max must pick 2.8, not 2.
    expect(rowLabel1.xPt).toBeCloseTo(2.8, 5);
  });
});

// --- Mutation-gap coverage round 2: page-content-size and available-band-width arithmetic ------------

describe("convertSheetToPages orchestration (mutation gap: page-content-width/height arithmetic crossing a real banding boundary)", () => {
  it("subtracts (never adds) both left and right margins when computing the page's own bandable width", () => {
    // Real availableWidthPt = 100-10-20 = 70; two 36pt columns (72pt) must split into two bands. Either wrong-signed margin term would instead widen availableWidthPt past 72, collapsing them into one band.
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 1, "B")], {
      columns: [
        { index: 0, widthPt: 36 },
        { index: 1, widthPt: 36 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 100 },
        margins: { topPt: 0, rightPt: 20, bottomPt: 0, leftPt: 10 },
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(2);
  });

  it("subtracts (never adds) both top and bottom margins when computing the page's own bandable height", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(1, 0, "B")], {
      rows: [
        { index: 0, heightPt: 36 },
        { index: 1, heightPt: 36 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 100 },
        margins: { topPt: 10, rightPt: 0, bottomPt: 20, leftPt: 0 },
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(2);
  });

  it("subtracts (never adds) both the header gutter and the repeat-column width from the page content width", () => {
    // Real availableWidthPt = 100 - 4.8(gutter) - 20(repeat) = 75.2; two 38pt bandable columns (76pt) must split. Either wrong-signed term would push availableWidthPt well past 76, collapsing them into one band.
    const s = sheet(
      [stringCell(0, 0, "RPT"), stringCell(0, 1, "A"), stringCell(0, 2, "B")],
      {
        columns: [
          { index: 0, widthPt: 20 },
          { index: 1, widthPt: 38 },
          { index: 2, widthPt: 38 },
        ],
        printSettings: {
          ...basePrintSettings,
          pageSize: { widthPt: 100, heightPt: 100 },
          headers: true,
          repeatColumns: { start: 0, end: 0 },
        },
      },
    );
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(2);
  });

  it("subtracts (never adds) both the header gutter and the repeat-row height from the page content height", () => {
    const s = sheet(
      [stringCell(0, 0, "RPT"), stringCell(1, 0, "A"), stringCell(2, 0, "B")],
      {
        rows: [
          { index: 0, heightPt: 20 },
          { index: 1, heightPt: 38 },
          { index: 2, heightPt: 38 },
        ],
        printSettings: {
          ...basePrintSettings,
          pageSize: { widthPt: 100, heightPt: 100 },
          headers: true,
          repeatRows: { start: 0, end: 0 },
        },
      },
    );
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(2);
  });
});

// --- Mutation-gap coverage round 2: throwIfAborted at the top of a sheet's pass, isolated from the page loop --

describe("convertSpreadsheetToLayout: cancellation (mutation gap: the pre-partition check, with zero pages to ever reach the per-page check)", () => {
  it("throws once the header gutter's own measurement trips the signal, even when every column ends up inside the repeat band and no page loop iteration ever runs", () => {
    const controller = new AbortController();
    const base = fakeMeasurer();
    const measurer: TextMeasurer = {
      ...base,
      widthOfTextAtSize(text, font, sizePt) {
        controller.abort();
        return base.widthOfTextAtSize(text, font, sizePt);
      },
    };
    const s = sheet([], {
      images: [tinyPngImage(0, 0, 0, 0)],
      printSettings: {
        ...basePrintSettings,
        headers: true,
        repeatColumns: { start: 0, end: 0 }, // the sheet's only column is entirely inside the repeat band, so bandableColumnIndices (and hence every column band, and the page loop itself) is empty
      },
    });
    expect(() => convert([s], measurer, controller.signal)).toThrow();
  });
});
