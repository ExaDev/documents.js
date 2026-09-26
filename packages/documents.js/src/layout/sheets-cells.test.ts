import { bytesToBase64 } from "ooxml.js";
import { convertSpreadsheetToLayout } from "./sheets";
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

const BLUE = { r: 0, g: 0, b: 1 };

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
    expect(lines).toHaveLength(2); // top and left only — right/bottom were never declared
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
    expect(text!.xPt).toBeCloseTo(2, 5); // left: xLeft(0) + padding(2) — the value-kind default would have put it at 46
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

  it("honors cancellation raised mid-run, from inside the main cell-emission loop — not merely checked once at the top of the function", () => {
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

// A genuinely STACKED formula (a fraction inside a square root): its total height is well over twice its base font size, the case the single-pass height/2 heuristic over-estimates badly for — the two-pass fit exists to size it to the declared frame instead.
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
    // The cell content itself is unaffected — widening the range adds no text of its own.
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
    // Header gutter: as wide as the widest row label plus two paddings, as tall as one header line — read back from the measurer rather than restated as a literal.
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
    // Two row bands (four 10pt rows, 20pt of bandable height available after the repeat row) means two pages; the repeat row — and therefore its anchored formula — appears on both.
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

// A ContentSheetImage carries the identical anchor quartet a cell-anchored formula does, and resolves through the same axis lookup — these tests hold that it now reaches the LayoutDocument as a real LayoutImage (it used to render nothing at all: sheets.ts emitted no image items, and convertSpreadsheetToLayout hardcoded images: {}).
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
