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
  LayoutImage,
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

// --- Mutation-gap coverage: step 1, print range from images alone -------------------------------

describe("step 1: resolve the print range (mutation gap: images alone)", () => {
  it("computes the print range from a floating image's anchor when the sheet has no cells or formulas at all", () => {
    const s = sheet([], { images: [tinyPngImage(2, 1, 0, 0)] });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
    expect(imageItems(layout.pages[0]!.items)).toHaveLength(1);
  });
});

// --- Mutation-gap coverage: step 2, sort before resolving per-index sizes ------------------------

describe("step 2: column/row offset arrays (mutation gap: sort before applying)", () => {
  it("resolves per-index sizes correctly even when columns are declared out of index order", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 5, "B")], {
      columns: [
        { index: 5, widthPt: 99 },
        { index: 0, widthPt: 7 },
      ],
    });
    const layout = convert([s]);
    const bXPt = textItems(layout.pages[0]!.items).find(
      (t) => t.text === "B",
    )!.xPt;
    // resolveAxis carries each entry's own size forward until the NEXT entry's index: column 0's 7pt width applies to columns 0-4 too (no entry of their own), and only column 5's own 99pt entry takes over from index 5. B sits at the cumulative offset 7*5 = 35pt, plus 2pt cell padding.
    expect(bXPt).toBeCloseTo(37, 5);
  });
});

// --- Mutation-gap coverage: step 3/5, a repeat range with a non-zero start ------------------------

describe("step 5: band partitioning (mutation gap: repeat-range boundary)", () => {
  it("keeps a column strictly before a non-zero-start repeat range in the ordinary bandable set, not excluded as if inside it", () => {
    const cells = [
      stringCell(0, 0, "C0"),
      stringCell(0, 1, "C1"),
      stringCell(0, 2, "RPT"),
      stringCell(0, 3, "C3"),
      stringCell(0, 4, "C4"),
    ];
    const s = sheet(cells, {
      columns: [0, 1, 2, 3, 4].map((index) => ({ index, widthPt: 30 })),
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 90, heightPt: 100 },
        repeatColumns: { start: 2, end: 2 },
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "C0",
      "C1",
      "RPT",
    ]);
    expect(textItems(layout.pages[1]!.items).map((t) => t.text)).toEqual([
      "RPT",
      "C3",
      "C4",
    ]);
  });

  it("does not open a spurious empty leading band when the manual break falls on the very first bandable index", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 1, "B")], {
      columns: [
        { index: 0, widthPt: 10 },
        { index: 1, widthPt: 10 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 100 },
        manualBreaks: { rows: [], columns: [0] },
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "A",
      "B",
    ]);
  });

  it("keeps two columns in the same band when their combined size lands exactly on the available width, not treating an exact fit as overflow", () => {
    const s = sheet([stringCell(0, 0, "A"), stringCell(0, 1, "B")], {
      columns: [
        { index: 0, widthPt: 10 },
        { index: 1, widthPt: 10 },
      ],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 20, heightPt: 100 },
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
  });

  it("produces zero column bands, not a spurious empty one, when an explicit print range's column span is empty", () => {
    const s = sheet([stringCell(0, 0, "A")], {
      printSettings: {
        ...basePrintSettings,
        printRange: { startRow: 0, endRow: 0, startColumn: 5, endColumn: 4 },
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(0);
  });

  it("forces an early row-band boundary at a manual row break, mirroring the column case", () => {
    const s = sheet(
      [stringCell(0, 0, "A"), stringCell(1, 0, "B"), stringCell(2, 0, "C")],
      {
        rows: [
          { index: 0, heightPt: 10 },
          { index: 1, heightPt: 10 },
          { index: 2, heightPt: 10 },
        ],
        printSettings: {
          ...basePrintSettings,
          pageSize: { widthPt: 100, heightPt: 100 },
          manualBreaks: { rows: [1], columns: [] },
        },
      },
    );
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual(["A"]);
    expect(textItems(layout.pages[1]!.items).map((t) => t.text)).toEqual([
      "B",
      "C",
    ]);
  });
});

// --- Mutation-gap coverage: step 4, resolve scale --------------------------------------------------

describe("step 4: resolve scale (mutation gap: the arithmetic behind each ratio)", () => {
  it("multiplies (never divides) available width by fitToPages.width when computing the width budget", () => {
    // A single column wider than the whole page always gets its own band (the oversized-item guarantee), so this isolates the width-ratio arithmetic without any risk of the two-column case splitting into extra bands of its own.
    const s = sheet([stringCell(0, 0, "A")], {
      columns: [{ index: 0, widthPt: 500 }],
      rows: [{ index: 0, heightPt: 10 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 1000 },
        fitToPages: { width: 2, height: 100 },
        gridlines: true,
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
    // budgetWidthPt = 100*2 = 200. widthRatio = 200/500 = 0.4 (heightRatio is enormous and never binds). Scaled column width = 500*0.4 = 200.
    const vertical = lineItems(layout.pages[0]!.items).filter(
      (l) => l.x1Pt === l.x2Pt,
    );
    expect(vertical.map((l) => l.x1Pt).sort((a, b) => a - b)).toEqual([0, 200]);
  });

  it("multiplies (never divides) available height by fitToPages.height when computing the height budget", () => {
    // A single row taller than the whole page always gets its own band, mirroring the width case above.
    const s = sheet([stringCell(0, 0, "A")], {
      columns: [{ index: 0, widthPt: 10 }],
      rows: [{ index: 0, heightPt: 500 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 1000, heightPt: 100 },
        fitToPages: { width: 100, height: 2 },
        gridlines: true,
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
    // budgetHeightPt = 100*2 = 200. heightRatio = 200/500 = 0.4 (widthRatio is enormous and never binds). Scaled row boundary lands at 500*0.4 = 200.
    const horizontal = lineItems(layout.pages[0]!.items).filter(
      (l) => l.y1Pt === l.y2Pt,
    );
    expect(horizontal.map((l) => l.y1Pt).sort((a, b) => a - b)).toEqual([
      -100, 100,
    ]);
  });

  it("falls back to a width ratio of 1 when the print range's total bandable content width is exactly zero, rather than dividing by it", () => {
    const s = sheet([stringCell(0, 0, "Z")], {
      columns: [{ index: 0, widthPt: 0 }],
      rows: [{ index: 0, heightPt: 15 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 0, heightPt: 100 },
        fitToPages: { width: 1, height: 1 },
        gridlines: true,
      },
    });
    const layout = convert([s]);
    expect(layout.pages).toHaveLength(1);
    // A width ratio that falls back to 1 keeps every offset at 0*1=0, a finite number. Dividing by the genuinely zero content width instead produces NaN, which no comparison or arithmetic recovers from.
    const lines = lineItems(layout.pages[0]!.items);
    expect(
      lines.every((l) => Number.isFinite(l.x1Pt) && Number.isFinite(l.y1Pt)),
    ).toBe(true);
  });

  it("falls back to a height ratio of 1 when the print range's total bandable content height is exactly zero, rather than dividing by it", () => {
    const s = sheet([stringCell(0, 0, "Z")], {
      columns: [{ index: 0, widthPt: 60 }],
      rows: [{ index: 0, heightPt: 0 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 100, heightPt: 0 },
        fitToPages: { width: 1, height: 1 },
      },
    });
    const layout = convert([s]);
    const z = textItems(layout.pages[0]!.items).find((t) => t.text === "Z");
    expect(z).toBeDefined();
    expect(Number.isFinite(z!.yPt)).toBe(true);
  });
});

// --- Mutation-gap coverage: cellStyledRuns and value-kind classification --------------------------

describe("cell text sizing (mutation gap: an empty runs array is not the same as no runs at all)", () => {
  it("falls back to a synthetic run from displayText when a cell's own runs array is present but empty", () => {
    const cell = stringCell(0, 0, "Hello", { runs: [] });
    const layout = convert([sheet([cell])]);
    expect(textItems(layout.pages[0]!.items).map((t) => t.text)).toEqual([
      "Hello",
    ]);
  });
});

describe("step 7: numeric-natured value kinds beyond plain number (mutation gap)", () => {
  it.each([
    ["percentage", { kind: "percentage" as const, value: 0.5 }],
    ["currency", { kind: "currency" as const, value: 10 }],
    ["date", { kind: "date" as const, value: "2026-01-01" }],
    ["time", { kind: "time" as const, value: "12:00:00" }],
    ["dateTime", { kind: "dateTime" as const, value: "2026-01-01T12:00:00" }],
  ] as const)(
    "right-aligns a %s cell with no explicit alignment, same as a plain number",
    (_label, value) => {
      const cell: ContentSheetCell = {
        row: 0,
        column: 0,
        value,
        displayText: "42",
      };
      const layout = convert([
        sheet([cell], { columns: [{ index: 0, widthPt: 50 }] }),
      ]);
      const text = textItems(layout.pages[0]!.items).find(
        (t) => t.text === "42",
      )!;
      expect(text.xPt).toBeCloseTo(46, 5);
    },
  );

  it("centers an error-kind cell with no explicit alignment, same as boolean", () => {
    const cell: ContentSheetCell = {
      row: 0,
      column: 0,
      value: { kind: "error", value: "#DIV/0!" },
      displayText: "#DIV/0!",
    };
    const layout = convert([
      sheet([cell], { columns: [{ index: 0, widthPt: 50 }] }),
    ]);
    const text = textItems(layout.pages[0]!.items).find(
      (t) => t.text === "#DIV/0!",
    )!;
    // center: padding(2) + (avail(46) - width(7))/2 = 2 + 19.5 = 21.5
    expect(text.xPt).toBeCloseTo(21.5, 5);
  });
});

describe("step 7: isCellVisuallyEmpty (mutation gap: kind and displayText must BOTH indicate empty)", () => {
  it("does not spill into a neighbor whose kind is 'empty' but whose displayText is genuinely non-empty", () => {
    const s = sheet(
      [
        stringCell(0, 0, "HelloWorld"),
        {
          row: 0,
          column: 1,
          value: { kind: "empty" },
          displayText: "nonempty",
        },
      ],
      {
        columns: [
          { index: 0, widthPt: 5 },
          { index: 1, widthPt: 30 },
        ],
      },
    );
    const layout = convert([s]);
    const cell0Text = textItems(layout.pages[0]!.items).find(
      (t) => t.text !== "nonempty",
    )!;
    expect(cell0Text.text).toBe("H");
  });

  it("does not spill into a neighbor whose displayText is empty but whose kind is not 'empty'", () => {
    const s = sheet([stringCell(0, 0, "HelloWorld"), stringCell(0, 1, "")], {
      columns: [
        { index: 0, widthPt: 5 },
        { index: 1, widthPt: 30 },
      ],
    });
    const layout = convert([s]);
    const cell0Text = textItems(layout.pages[0]!.items)[0]!;
    expect(cell0Text.text).toBe("H");
  });
});

// --- Mutation-gap coverage: text truncation, spillover, and overflow arithmetic -------------------

describe("step 7: cell text truncation across multiple styled runs (mutation gap)", () => {
  it("keeps every fragment that fits in full and drops only the one that starts at or past the boundary", () => {
    const cell: ContentSheetCell = {
      row: 0,
      column: 0,
      value: { kind: "string", value: "ABCDEF" },
      displayText: "ABCDEF",
      runs: [{ text: "AB" }, { text: "CD" }, { text: "EF" }],
    };
    const layout = convert([
      sheet([cell], { columns: [{ index: 0, widthPt: 8 }] }),
    ]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["AB", "CD"]);
  });

  it("truncates (never spills or ###-overflows) a boolean/error cell whose text overflows its own column", () => {
    const layout = convert([
      sheet([booleanCell(0, 0, true)], { columns: [{ index: 0, widthPt: 6 }] }),
    ]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text).join("")).toBe("TR");
  });
});

describe("step 7: overflow boundary arithmetic (mutation gap: exact fit is never overflow)", () => {
  it("does not treat a number that fits exactly within its column as an overflow", () => {
    const layout = convert([
      sheet([numberCell(0, 0, 12, "12")], {
        columns: [{ index: 0, widthPt: 6 }],
      }),
    ]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text).join("")).toBe("12");
  });

  it("advances the spill column and stops exactly when enough neighbors have been consumed, never over- or under-spilling", () => {
    const s = sheet(
      [
        stringCell(0, 0, "ABCDEF", { alignment: "right" }),
        { row: 0, column: 1, value: { kind: "empty" }, displayText: "" },
        { row: 0, column: 2, value: { kind: "empty" }, displayText: "" },
        { row: 0, column: 3, value: { kind: "empty" }, displayText: "" },
      ],
      {
        columns: [
          { index: 0, widthPt: 6 },
          { index: 1, widthPt: 2 },
          { index: 2, widthPt: 2 },
          { index: 3, widthPt: 5 },
        ],
      },
    );
    const layout = convert([s]);
    const a = textItems(layout.pages[0]!.items).find(
      (t) => t.text === "ABCDEF",
    )!;
    // avail starts at 2 (6 - 2*padding). Spilling columns 1 and 2 (2pt each) brings it to exactly 6, matching the natural 6pt line width. Column 3 must never be consumed. Right-aligned within an exact-fit box has zero slack, so the text sits at padding(2) alone, unclipped.
    expect(a.xPt).toBeCloseTo(2, 5);
  });
});

describe("step 7: justify gap-stretching (mutation gap: both operands of the guard condition)", () => {
  it("suppresses justify gap-stretching on a genuinely overflowed (truncated) line, not just a naturally non-final one", () => {
    const s = sheet(
      [stringCell(0, 0, "aa bb\ncc dd", { alignment: "justify" })],
      {
        columns: [{ index: 0, widthPt: 7 }],
        rows: [{ index: 0, heightPt: 20 }],
      },
    );
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["aa"]);
    expect(texts[0]!.xPt).toBeCloseTo(2, 5);
  });

  it("never applies justify gap-stretching to a non-justified cell, even when its own first line is genuinely non-final", () => {
    const s = sheet([stringCell(0, 0, "aa bb\ncc dd")], {
      columns: [{ index: 0, widthPt: 20 }],
      rows: [{ index: 0, heightPt: 20 }],
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(["aa", "bb"]);
    expect(texts[0]!.xPt).toBeCloseTo(2, 5);
    expect(texts[1]!.xPt).toBeCloseTo(5, 5);
  });
});

// --- Mutation-gap coverage: header-label and gridline exact geometry ------------------------------

describe("step 3: header-gutter labels (mutation gap: exact label geometry)", () => {
  it("positions the column-letter and row-number labels at their own precisely-derived geometry", () => {
    const s = sheet([stringCell(0, 0, "X")], {
      columns: [{ index: 0, widthPt: 40 }],
      rows: [{ index: 0, heightPt: 30 }],
      printSettings: {
        ...basePrintSettings,
        pageSize: { widthPt: 200, heightPt: 200 },
        headers: true,
      },
    });
    const layout = convert([s]);
    const texts = textItems(layout.pages[0]!.items);
    const columnLabel = texts.find((t) => t.text === "A")!;
    const rowLabel = texts.find((t) => t.text === "1")!;
    expect(columnLabel.xPt).toBeCloseTo(24.4, 5);
    expect(columnLabel.yPt).toBeCloseTo(193.6, 5);
    expect(rowLabel.xPt).toBeCloseTo(2, 5);
    expect(rowLabel.yPt).toBeCloseTo(173.8, 5);
  });
});
