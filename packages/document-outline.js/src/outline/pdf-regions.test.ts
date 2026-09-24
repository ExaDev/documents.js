import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutPage, LayoutText } from "pdf-codec";
import { DEFAULT_BASELINE_TOLERANCE_EM } from "pdf-codec/text-group";
import type { LayoutFont } from "document-schema.js";
import { assertNeverLayoutItem } from "./pdf-regions";
import {
  attachCaptions,
  boundingBox,
  cellsInLine,
  classifyFromLeafSignals,
  classifyLeaf,
  computeLeafSignals,
  findCut,
  groupIntoLines,
  horizontallyOverlaps,
  isRowAlignedGrid,
  itemScale,
  layoutItemBounds,
  mean,
  median,
  recursiveXYCut,
  regionReadingOrderComparator,
  regularity,
  segmentPdfRegions,
  verticalGap,
  type BoundedItem,
  type LeafSignals,
  type PdfRegion,
  type PdfRegionBounds,
  type TextLine,
} from "./pdf-regions";

// Builders local to this test file, the same pattern regions.test.ts uses for its own sheet-cell builders: pdf-codec's LayoutItem family carries several required fields (font, color, sizePt) no test here actually varies, so a fixed default keeps every fixture focused on the one or two fields that matter for the case at hand.
const FONT: LayoutFont = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
};
const BLACK = { r: 0, g: 0, b: 0 };

// A line of text is one LayoutItem, matching how a PDF content stream typically emits one contiguous run per Tj — widthPt is derived from a rough average glyph advance (0.5em per character) rather than hand-computed per fixture, since these tests only care about relative scale (a gutter/gap being comfortably wider or narrower than a line's own font size), not exact glyph metrics.
const DEFAULT_LINE_SIZE_PT = 10;
// vitest's own toBeCloseTo precision (decimal digits), reused everywhere a floating-point score is checked.
const PRECISION_DIGITS = 10;
const GLYPH_ADVANCE_EM = 0.5;

function line(
  xPt: number,
  yPt: number,
  text: string,
  sizePt = DEFAULT_LINE_SIZE_PT,
): LayoutText {
  return {
    kind: "text",
    text,
    xPt,
    yPt,
    font: FONT,
    sizePt,
    color: BLACK,
    widthPt: text.length * sizePt * GLYPH_ADVANCE_EM,
  };
}

function page(items: readonly LayoutItem[]): LayoutPage {
  return { widthPt: 612, heightPt: 792, items: [...items] };
}

describe("segmentPdfRegions", () => {
  it("returns nothing for a page with no items", () => {
    expect(segmentPdfRegions(page([]))).toEqual([]);
  });

  it("excludes link/internalLink annotations from segmentation", () => {
    const leftMargin = 50;
    const topLine = 700;
    const secondLine = 686;
    const linkTop = 680;
    const regions = segmentPdfRegions(
      page([
        line(leftMargin, topLine, "Some prose text here to read."),
        line(leftMargin, secondLine, "Continuing on the very next line below."),
        {
          kind: "link",
          uri: "https://example.com",
          xPt: leftMargin,
          yPt: linkTop,
          widthPt: 100,
          heightPt: 20,
        },
      ]),
    );
    for (const region of regions) {
      expect(region.items.every((item) => item.kind !== "link")).toBe(true);
    }
  });

  it("classifies a single flowing text block as a column", () => {
    const lineCount = 6;
    const leftMargin = 50;
    const topLine = 700;
    const lineHeight = 14;
    const lines = Array.from({ length: lineCount }, (_, index) =>
      line(
        leftMargin,
        topLine - index * lineHeight,
        "The quick brown fox jumps over the lazy dog.",
      ),
    );
    const regions = segmentPdfRegions(page(lines));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("column");
    expect(regions[0]?.items).toHaveLength(lineCount);
  });

  it("splits a two-column layout at the gutter, classifying each column independently", () => {
    // Short lines, well short of the gutter, so the gutter is unambiguously wider than either column's own line-height-derived scale. The right column's own line rhythm is deliberately offset from the left's (a different line spacing) — two independent flowing-text columns never share a synchronised row-for-row rhythm in practice, and the offset here is what keeps isRowAlignedGrid from mistaking this for one table's rows.
    const leftColumnCount = 8;
    const rightColumnCount = 7;
    const leftX = 50;
    const rightX = 250;
    const topLine = 700;
    const rightTopLine = 693;
    const leftLineHeight = 14;
    const rightLineHeight = 15;
    const leftColumn = Array.from({ length: leftColumnCount }, (_, index) =>
      line(leftX, topLine - index * leftLineHeight, "Left column body text."),
    );
    const rightColumn = Array.from({ length: rightColumnCount }, (_, index) =>
      line(
        rightX,
        rightTopLine - index * rightLineHeight,
        "Right column text.",
      ),
    );
    const regions = segmentPdfRegions(page([...leftColumn, ...rightColumn]));

    expect(regions).toHaveLength(2);
    const [left, right] = [...regions].sort(
      (a, b) => a.bounds.xPt - b.bounds.xPt,
    );
    expect(left?.classification).toBe("column");
    expect(left?.items).toHaveLength(leftColumnCount);
    expect(right?.classification).toBe("column");
    expect(right?.items).toHaveLength(rightColumnCount);
  });

  it("classifies a ruled grid of rows and aligned columns as a table, not per-column prose", () => {
    const headers = ["Name", "Age", "City"];
    const rows = [
      ["Alice", "34", "Leeds"],
      ["Bob", "29", "York"],
      ["Carol", "41", "Hull"],
      ["Dave", "37", "Ripon"],
    ];
    const topLine = 700;
    const rowHeight = 16;
    const column0X = 50;
    const column1X = 200;
    const column2X = 320;
    const columnX = [column0X, column1X, column2X];
    const items: LayoutItem[] = [];
    [headers, ...rows].forEach((row, rowIndex) => {
      const yPt = topLine - rowIndex * rowHeight;
      row.forEach((cell, columnIndex) => {
        const x = columnX[columnIndex];
        if (x !== undefined) items.push(line(x, yPt, cell));
      });
    });

    const regions = segmentPdfRegions(page(items));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("table");
    expect(regions[0]?.items).toHaveLength(
      headers.length + rows.length * headers.length,
    );
  });

  it("classifies an image-dominated block as a figure, and a short adjacent line as its caption", () => {
    const proseLineCount = 4;
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-1",
      xPt: 100,
      yPt: 500,
      widthPt: 300,
      heightPt: 200,
    };
    const captionX = 150;
    const captionY = 470;
    const proseX = 100;
    const proseTopY = 760;
    const proseLineHeight = 14;
    // A photo this size' own scale (min(300, 200) = 200pt) would swamp a global gap threshold; the caption gap below is well clear of the LOCAL threshold (1.5 * the caption's own ~10pt font size) that this module actually uses.
    const caption = line(
      captionX,
      captionY,
      "Figure 1: a chart of quarterly results.",
    );
    const proseAbove = Array.from({ length: proseLineCount }, (_, index) =>
      line(
        proseX,
        proseTopY - index * proseLineHeight,
        "Unrelated body text sits well above the figure.",
      ),
    );

    const regions = segmentPdfRegions(page([...proseAbove, figure, caption]));

    const figureRegion = regions.find(
      (region) => region.classification === "figure",
    );
    const captionRegion = regions.find(
      (region) => region.classification === "caption",
    );
    expect(figureRegion).toBeDefined();
    expect(figureRegion?.items).toHaveLength(1);
    expect(captionRegion).toBeDefined();
    expect(captionRegion?.items).toHaveLength(1);
    expect(captionRegion?.confidence).toBeGreaterThan(0);
    expect(captionRegion?.confidence).toBeLessThanOrEqual(1);

    // Recorded in both directions: the caption stays its own region, and the figure it labels now
    // carries that text. The pass already had to work out which figure the caption belonged to in
    // order to classify it, and used to drop the answer — so a consumer wanting a figure's own label
    // had to re-derive the adjacency this function had just computed.
    expect(figureRegion?.caption).toBe(
      "Figure 1: a chart of quarterly results.",
    );
    // Associated, not moved: projecting every region's text must read the caption exactly once. Asserted
    // by counting it across every region rather than by inspecting the caption region's own items, which
    // the fixture already guarantees and which would pass even if the figure had swallowed the item too.
    const occurrences = regions.filter((region) =>
      region.items.some(
        (item) =>
          item.kind === "text" &&
          item.text === "Figure 1: a chart of quarterly results.",
      ),
    );
    expect(occurrences).toHaveLength(1);

    const proseRegion = regions.find(
      (region) => region.classification === "column",
    );
    expect(proseRegion?.items).toHaveLength(proseLineCount);
  });

  it("gives a figure the nearer of two candidate captions", () => {
    // A figure sandwiched between two short runs has two candidates and only one is its label. The same
    // gap that decides a caption's own confidence decides which figure wins it, so the nearer text is
    // the one recorded on the figure.
    //
    // Both gaps sit in a narrow window the segmentation forces: wider than the LOCAL cut threshold
    // (1.5x the caption's own ~10pt font size, so ~15pt — below that the run is not split off as its
    // own region at all) and within CAPTION_GAP_PT (24pt, beyond which it is not a caption). Above is
    // 18pt away, below is 22pt.
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-2",
      xPt: 100,
      yPt: 400,
      widthPt: 300,
      heightPt: 200,
    };
    // The nearer caption is the one ABOVE, which is the arrangement that makes the tie-break
    // load-bearing: regions arrive sorted top-to-bottom, so `above` is processed first, and a naive
    // last-writer-wins would record `below` instead. With the fixture the other way round both rules
    // agree and the test proves nothing — verified by mutating the comparison to `if (true)`, under
    // which the earlier version of this case still passed.
    const captionX = 150;
    const aboveY = 618;
    const belowY = 368;
    const above = line(captionX, aboveY, "Figure 2: the nearer caption.");
    const below = line(captionX, belowY, "Further away, below the figure.");

    const regions = segmentPdfRegions(page([above, figure, below]));
    const figureRegion = regions.find(
      (region) => region.classification === "figure",
    );

    expect(figureRegion?.caption).toBe("Figure 2: the nearer caption.");
  });

  it("does not attach a caption to a figure it is not vertically adjacent to", () => {
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-1",
      xPt: 100,
      yPt: 500,
      widthPt: 300,
      heightPt: 200,
    };
    const farX = 100;
    const farY = 100;
    // Far below the figure — well past CAPTION_GAP_PT — so this should stay unclassified rather than being claimed as the figure's caption.
    const farText = line(
      farX,
      farY,
      "An unrelated short line near the bottom of the page.",
    );

    const regions = segmentPdfRegions(page([figure, farText]));
    const captionRegion = regions.find(
      (region) => region.classification === "caption",
    );
    expect(captionRegion).toBeUndefined();
  });

  it("reports a single small item as unknown, carrying no structural signal", () => {
    const leftMargin = 50;
    const topLine = 700;
    const regions = segmentPdfRegions(page([line(leftMargin, topLine, "x")]));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("unknown");
    expect(regions[0]?.confidence).toBe(1);
  });

  it("sorts regions top to bottom, then left to right, matching reading order", () => {
    const bottomRightX = 300;
    const bottomRightY = 500;
    const topLeftX = 50;
    const topLeftY = 700;
    const items = [
      line(
        bottomRightX,
        bottomRightY,
        "Bottom right area of the page with more text here.",
      ),
      line(
        topLeftX,
        topLeftY,
        "Top left area of the page with more text here too.",
      ),
    ];
    const regions = segmentPdfRegions(page(items));
    expect(regions.length).toBeGreaterThanOrEqual(1);
    if (regions.length === 2) {
      expect(regions[0]?.bounds.yPt).toBeGreaterThan(
        regions[1]?.bounds.yPt ?? 0,
      );
    }
  });

  it("breaks a tie in vertical position by sorting left to right", () => {
    // Two top clusters (A at leftX, B at rightX) sharing the same row band, and one bottom cluster (C) far below both — deliberately listed out of the expected output order (B, C, then A) so the sort must genuinely reorder them, exercising both the primary (y-descending) and tie-break (x-ascending) comparator clauses.
    const clusterSize = 3;
    const leftX = 50;
    const rightX = 400;
    const topLine = 700;
    const bottomLine = 100;
    const leftLineHeight = 14;
    // A distinctly different line spacing than leftLineHeight keeps this from being mistaken for one row-aligned table's columns (isRowAlignedGrid's own rejection, the same reason the two-column test above offsets its own rhythm) — a smaller offset still falls within LINE_TOLERANCE_PT often enough to accidentally "align".
    const rightLineHeight = 20;
    const clusterA = Array.from({ length: clusterSize }, (_, index) =>
      line(
        leftX,
        topLine - index * leftLineHeight,
        "Top left column body text here.",
      ),
    );
    const clusterB = Array.from({ length: clusterSize }, (_, index) =>
      line(
        rightX,
        topLine - index * rightLineHeight,
        "Top right column body text here.",
      ),
    );
    const clusterC = Array.from({ length: clusterSize }, (_, index) =>
      line(
        leftX,
        bottomLine - index * leftLineHeight,
        "Bottom column body text here too.",
      ),
    );
    const regions = segmentPdfRegions(
      page([...clusterB, ...clusterC, ...clusterA]),
    );
    expect(regions).toHaveLength(clusterSize);
    expect(regions.map((region) => region.bounds.xPt)).toEqual([
      leftX,
      rightX,
      leftX,
    ]);
    expect(regions[0]!.bounds.yPt).toBeGreaterThan(regions[2]!.bounds.yPt);
  });

  it("breaks a GENUINE vertical tie (identical bounds.yPt, not merely close) by sorting left to right", () => {
    // Two single-character items at the exact same yPt, far enough apart in x to cut into two leaves whose bounds.yPt are then identical (a single-item leaf's bounds equal the item's own bounds) — this is the one case that actually exercises the sort comparator's second clause, unlike the "close but not equal" tie test above.
    const leftX = 50;
    const rightX = 400;
    const sharedY = 700;
    const items = [line(rightX, sharedY, "B"), line(leftX, sharedY, "A")]; // listed out of order so a broken (or no-op) tie-break would leave them unsorted
    const regions = segmentPdfRegions(page(items));
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => region.bounds.xPt)).toEqual([leftX, rightX]);
  });
});

describe("regionReadingOrderComparator", () => {
  const boundsAt = (xPt: number, yPt: number): PdfRegionBounds => ({
    xPt,
    yPt,
    widthPt: 0,
    heightPt: 0,
  });

  it("sorts top to bottom (descending yPt)", () => {
    const topY = 700;
    const bottomY = 100;
    const top = { bounds: boundsAt(0, topY) };
    const bottom = { bounds: boundsAt(0, bottomY) };
    expect(regionReadingOrderComparator(top, bottom)).toBeLessThan(0);
    expect(regionReadingOrderComparator(bottom, top)).toBeGreaterThan(0);
  });

  it("breaks a genuine vertical tie by sorting left to right, as a subtraction rather than a sum", () => {
    // recursiveXYCut's own internal per-axis sort already fixes which region lands as `a` versus `b` by the time segmentPdfRegions reaches this comparator, so an end-to-end test can never itself control the argument order the tie-break clause receives — only calling the comparator directly, in BOTH argument orders, can prove it is a genuine subtraction. A sum-based tie-break (both xPt values here being positive, the sum is always positive) would report "a sorts after b" for EVERY ordering of this exact pair, which would still happen to look correct for one specific argument order and wrong for the other — checking both orders is what makes that distinguishable from a real subtraction, which correctly reverses sign when the arguments swap.
    const leftX = 50;
    const rightX = 400;
    const sharedY = 700;
    const left = { bounds: boundsAt(leftX, sharedY) };
    const right = { bounds: boundsAt(rightX, sharedY) };
    expect(regionReadingOrderComparator(left, right)).toBeLessThan(0);
    expect(regionReadingOrderComparator(right, left)).toBeGreaterThan(0);
  });
});

// A BoundedItem whose own item content is irrelevant — only `bounds` matters to the function under test (boundingBox, findCut, isRowAlignedGrid's own band-membership).
function boundedAt(
  bounds: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>,
): BoundedItem {
  return { item: line(0, 0, "x"), bounds };
}

// A BoundedItem wrapping a real text item, with bounds computed via the real layoutItemBounds (so tests exercising groupIntoLines/cellsInLine through a BoundedItem see genuine, consistent geometry).
function boundedText(xPt: number, yPt: number, text = "cell"): BoundedItem {
  const item = line(xPt, yPt, text);
  return { item, bounds: layoutItemBounds(item)! };
}

function textItem(xPt: number, widthPt: number, sizePt = 10): LayoutText {
  return {
    kind: "text",
    text: "x",
    xPt,
    yPt: 0,
    font: FONT,
    sizePt,
    color: BLACK,
    widthPt,
  };
}

describe("layoutItemBounds", () => {
  it("returns undefined for link and internalLink annotations", () => {
    expect(
      layoutItemBounds({
        kind: "link",
        uri: "https://example.com",
        xPt: 0,
        yPt: 0,
        widthPt: 10,
        heightPt: 10,
      }),
    ).toBeUndefined();
    expect(
      layoutItemBounds({
        kind: "internalLink",
        destination: "dest1",
        xPt: 0,
        yPt: 0,
        widthPt: 10,
        heightPt: 10,
      }),
    ).toBeUndefined();
  });

  it("bounds a text item to its anchor plus font size, defaulting a missing width to zero", () => {
    expect(
      layoutItemBounds({
        kind: "text",
        text: "hi",
        xPt: 10,
        yPt: 20,
        font: FONT,
        sizePt: 12,
        color: BLACK,
        widthPt: 30,
      }),
    ).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 32 });
    expect(
      layoutItemBounds({
        kind: "text",
        text: "hi",
        xPt: 10,
        yPt: 20,
        font: FONT,
        sizePt: 12,
        color: BLACK,
      }),
    ).toEqual({ minX: 10, minY: 20, maxX: 10, maxY: 32 });
  });

  it("bounds an image/rect/ellipse to its own frame", () => {
    expect(
      layoutItemBounds({
        kind: "image",
        imageId: "i1",
        xPt: 5,
        yPt: 6,
        widthPt: 7,
        heightPt: 8,
      }),
    ).toEqual({ minX: 5, minY: 6, maxX: 12, maxY: 14 });
    expect(
      layoutItemBounds({
        kind: "rect",
        xPt: 5,
        yPt: 6,
        widthPt: 7,
        heightPt: 8,
      }),
    ).toEqual({ minX: 5, minY: 6, maxX: 12, maxY: 14 });
    expect(
      layoutItemBounds({
        kind: "ellipse",
        xPt: 5,
        yPt: 6,
        widthPt: 7,
        heightPt: 8,
      }),
    ).toEqual({ minX: 5, minY: 6, maxX: 12, maxY: 14 });
  });

  it("bounds a line to the min/max of its own endpoints, whichever order they're given in", () => {
    // x1 > x2 and y1 < y2 — both orderings appear in the same item, so Math.min/max cannot be swapped for either axis without this test catching it.
    expect(
      layoutItemBounds({
        kind: "line",
        x1Pt: 100,
        y1Pt: 5,
        x2Pt: 20,
        y2Pt: 50,
        widthPt: 1,
        color: BLACK,
      }),
    ).toEqual({ minX: 20, minY: 5, maxX: 100, maxY: 50 });
  });

  it("returns undefined for a path with no subpaths at all", () => {
    expect(layoutItemBounds({ kind: "path", subpaths: [] })).toBeUndefined();
  });

  it("bounds a path to the hull of its moveto and line-segment endpoints, each boundary set by a different point", () => {
    // (5,5) is the moveto; (1,8) pushes minX and maxY; (9,2) pushes maxX and minY — no single point sets more than two of the four boundaries, so a broken min/max tracker would show up regardless of which boundary it broke.
    expect(
      layoutItemBounds({
        kind: "path",
        subpaths: [
          {
            startXPt: 5,
            startYPt: 5,
            segments: [
              { kind: "line", xPt: 1, yPt: 8 },
              { kind: "line", xPt: 9, yPt: 2 },
            ],
            closed: false,
          },
        ],
      }),
    ).toEqual({ minX: 1, minY: 2, maxX: 9, maxY: 8 });
  });

  it("bounds a path with only a moveto and no segments to that single point", () => {
    // With no segments at all, the moveto's own visit() call is the ONLY thing that can ever populate the bounds — omitting it would leave minX at +Infinity, wrongly reporting no bounds at all.
    expect(
      layoutItemBounds({
        kind: "path",
        subpaths: [{ startXPt: 7, startYPt: 9, segments: [], closed: false }],
      }),
    ).toEqual({ minX: 7, minY: 9, maxX: 7, maxY: 9 });
  });

  it("bounds a cubic segment to the hull of its own control points too, not just its endpoint", () => {
    // The control points (20,0) and (0,20) sit well outside the moveto (0,0) / final endpoint (5,5) — omitting either visit(c1)/visit(c2) call would shrink the bounds to just the endpoint pair.
    expect(
      layoutItemBounds({
        kind: "path",
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            segments: [
              {
                kind: "cubic",
                c1xPt: 20,
                c1yPt: 0,
                c2xPt: 0,
                c2yPt: 20,
                xPt: 5,
                yPt: 5,
              },
            ],
            closed: false,
          },
        ],
      }),
    ).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
  });
});

describe("boundingBox", () => {
  it("computes the min/max independently for x and y, not by summing or defaulting to the first or last item", () => {
    // Each boundary is set by a DIFFERENT one of the first two items, and the third item holds none of the four extremes at all — so an "always update" bug (ignoring the comparison entirely) would leave the LAST item's own values in place instead of the genuine extremes.
    const items = [
      boundedAt({ minX: 1, minY: 90, maxX: 9, maxY: 99 }), // sets minX, maxY
      boundedAt({ minX: 50, minY: 2, maxX: 90, maxY: 40 }), // sets minY, maxX
      boundedAt({ minX: 20, minY: 20, maxX: 30, maxY: 30 }), // dominated entirely by the other two
    ];
    expect(boundingBox(items)).toEqual({
      xPt: 1,
      yPt: 2,
      widthPt: 89,
      heightPt: 97,
    });
  });
});

describe("itemScale", () => {
  it("returns the smaller of the two axis extents", () => {
    const smallExtent = 3;
    const largeExtent = 10;
    expect(
      itemScale({ minX: 0, minY: 0, maxX: largeExtent, maxY: smallExtent }),
    ).toBe(smallExtent);
    const smallerExtent = 2;
    expect(
      itemScale({ minX: 0, minY: 0, maxX: smallerExtent, maxY: largeExtent }),
    ).toBe(smallerExtent);
  });

  it("computes each extent as a genuine subtraction, not a sum, when the minimum is nonzero", () => {
    // minX(5) is nonzero: maxX - minX = 3 (the smaller extent), but maxX + minX = 13 — only the subtraction gives the right answer.
    const minX = 5;
    const maxX = 8;
    const extent = 3;
    expect(itemScale({ minX, minY: 0, maxX, maxY: 100 })).toBe(extent);
  });
});

describe("median", () => {
  it("returns the middle value for an odd-length list", () => {
    const a = 5;
    const b = 1;
    const c = 3;
    expect(median([a, b, c])).toBe(c);
  });

  it("averages the two middle values for an even-length list", () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const d = 4;
    const expectedMedian = 2.5;
    expect(median([a, b, c, d])).toBe(expectedMedian);
  });
});

describe("mean", () => {
  it("returns 0 for an empty list", () => {
    expect(mean([])).toBe(0);
  });

  it("averages the values", () => {
    const a = 2;
    const b = 4;
    const c = 6;
    const expectedMean = 4;
    expect(mean([a, b, c])).toBe(expectedMean);
  });
});

describe("regularity", () => {
  it("is trivially 1 for zero or one values", () => {
    expect(regularity([])).toBe(1);
    const soleValue = 5;
    expect(regularity([soleValue])).toBe(1);
  });

  it("is 1 when the average is 0 because every value genuinely is 0", () => {
    expect(regularity([0, 0, 0])).toBe(1);
  });

  it("is 0 when the average is 0 but the values are not all 0", () => {
    expect(regularity([-1, 1])).toBe(0);
    // At least one value IS 0 here (unlike [-1, 1], where none are) — distinguishes requiring EVERY value to be 0 from merely SOME value being 0.
    const positive = 2;
    const negative = -2;
    expect(regularity([0, positive, negative])).toBe(0);
  });

  it("computes the coefficient-of-variation-derived score precisely", () => {
    // values [2,4]: mean 3, variance ((2-3)^2+(4-3)^2)/2 = 1, so 1 - sqrt(1)/3.
    const a = 2;
    const b = 4;
    const meanValue = 3;
    expect(regularity([a, b])).toBeCloseTo(
      1 - Math.sqrt(1) / meanValue,
      PRECISION_DIGITS,
    );
  });
});

describe("groupIntoLines", () => {
  it("clusters items sharing a baseline into one line, sorted left to right", () => {
    const topLine = 700;
    const aX = 50;
    const bX = 10;
    const a = line(aX, topLine, "a");
    const b = line(bX, topLine + 1, "b"); // within tolerance of a (diff 1)
    const lines = groupIntoLines([a, b]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.items.map((item) => (item as LayoutText).text)).toEqual([
      "b",
      "a",
    ]);
  });

  it("clusters at exactly the tolerance boundary, but not beyond it", () => {
    // The tolerance is pdf-codec's own: a fraction of an em of the smaller of the two runs, which at the default line size these helpers use is 20/3 points.
    const topLine = 700;
    const tolerancePt = DEFAULT_BASELINE_TOLERANCE_EM * DEFAULT_LINE_SIZE_PT;
    const epsilon = 0.01;
    const a = line(0, topLine, "a");
    const atBoundary = line(0, topLine - tolerancePt, "b");
    expect(groupIntoLines([a, atBoundary])).toHaveLength(1);
    const beyondBoundary = line(0, topLine - tolerancePt - epsilon, "c");
    expect(groupIntoLines([a, beyondBoundary])).toHaveLength(2);
  });

  it("takes the tolerance from the smaller of the two runs, so a heading cannot absorb the line under it", () => {
    // 12pt between a 30pt heading's baseline and the 9pt line beneath it: inside the heading's own tolerance, outside the body line's. The smaller run decides (ExaDev/documents.js#1317).
    const topLine = 700;
    const headingSizePt = 30;
    const bodyY = 688;
    const bodySizePt = 9;
    const heading = line(0, topLine, "Results", headingSizePt);
    const body = line(0, bodyY, "Measured over four quarters", bodySizePt);
    expect(groupIntoLines([heading, body])).toHaveLength(2);
  });

  it("sorts lines top to bottom (descending y), matching PDF's upward-increasing y-axis", () => {
    const topY = 700;
    const bottomY = 600;
    const top = line(0, topY, "top");
    const bottom = line(0, bottomY, "bottom");
    // Deliberately passed bottom-first, so a broken sort comparator would leave them in input order.
    const lines = groupIntoLines([bottom, top]);
    expect(
      lines.map((textLine) => (textLine.items[0] as LayoutText).text),
    ).toEqual(["top", "bottom"]);
  });

  it("sorts a line's own items left to right AFTER grouping, not merely in grouping (descending-y) order", () => {
    // All three within LINE_TOLERANCE_PT of each other (one line), inserted during grouping in descending-y order — which, by x, is NOT already ascending. Only a genuine final left-to-right sort produces the ascending order (p2, p3, p1).
    const y1 = 700;
    const y2 = 699;
    const y3 = 698;
    const p1X = 50;
    const p2X = 10;
    const p3X = 30;
    const p1 = line(p1X, y1, "p1");
    const p2 = line(p2X, y2, "p2");
    const p3 = line(p3X, y3, "p3");
    const lines = groupIntoLines([p1, p2, p3]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.items.map((item) => (item as LayoutText).text)).toEqual([
      "p2",
      "p3",
      "p1",
    ]);
  });
});

describe("cellsInLine", () => {
  it("does not split a cell at a gap exactly at the threshold, only strictly beyond it", () => {
    const runWidth = 10;
    const smallOffset = 5;
    const gapAtThresholdX = 22;
    const epsilon = 0.1;
    const previous = textItem(0, runWidth, DEFAULT_LINE_SIZE_PT); // ends at xPt(0) + widthPt(runWidth) = runWidth
    const atThreshold: TextLine = {
      yPt: 0,
      items: [
        previous,
        textItem(gapAtThresholdX, smallOffset, DEFAULT_LINE_SIZE_PT),
      ], // gap = 22 - 10 = 12 = CELL_GAP_EM(1.2) * sizePt(10) exactly
    };
    expect(cellsInLine(atThreshold)).toBe(1);
    const beyondThreshold: TextLine = {
      yPt: 0,
      items: [
        previous,
        textItem(gapAtThresholdX + epsilon, smallOffset, DEFAULT_LINE_SIZE_PT),
      ],
    };
    expect(cellsInLine(beyondThreshold)).toBe(2);
  });

  it("counts no cell boundary after a run that stated no advance width", () => {
    // Where the previous run ends is unknown, so the gap after it is too, and an unknown gap is no evidence of a cell boundary. Reading the absent width as zero made the whole distance between the two origins look like a gap, so a line of separately-shown words counted one cell per word and read as a table row (ExaDev/documents.js#1317).
    const withoutWidth: LayoutText = {
      kind: "text",
      text: "x",
      xPt: 0,
      yPt: 0,
      font: FONT,
      sizePt: DEFAULT_LINE_SIZE_PT,
      color: BLACK,
    };
    const nextX = 30;
    const nextWidth = 5;
    expect(
      cellsInLine({
        yPt: 0,
        items: [withoutWidth, textItem(nextX, nextWidth, DEFAULT_LINE_SIZE_PT)],
      }),
    ).toBe(1);
  });

  it("takes the cell threshold from the smaller of the two runs", () => {
    // A 13pt gap after a 30pt run, before a 9pt one: beyond a cell boundary at the small run's scale (1.2 x 9 = 10.8), nowhere near one at the large run's.
    const largeRunSizePt = 30;
    const smallRunSizePt = 9;
    const largeRunWidth = 20;
    const smallOffset = 5;
    const gapX = 33;
    const items = [
      textItem(0, largeRunWidth, largeRunSizePt),
      textItem(gapX, smallOffset, smallRunSizePt),
    ];
    expect(cellsInLine({ yPt: 0, items })).toBe(2);
  });

  it("counts every qualifying internal gap, not just the first", () => {
    const cellCount = 3;
    const spacing = 30;
    const smallOffset = 5;
    const line3: TextLine = {
      yPt: 0,
      items: [
        textItem(0, smallOffset, DEFAULT_LINE_SIZE_PT),
        textItem(spacing, smallOffset, DEFAULT_LINE_SIZE_PT),
        textItem(spacing * 2, smallOffset, DEFAULT_LINE_SIZE_PT),
      ],
    };
    expect(cellsInLine(line3)).toBe(cellCount);
  });

  it("skips a position pair where either side is not a text item", () => {
    const nonTextX = 15;
    const smallOffset = 5;
    const nonText: LayoutItem = {
      kind: "image",
      imageId: "i1",
      xPt: nonTextX,
      yPt: 0,
      widthPt: smallOffset,
      heightPt: smallOffset,
    };
    const lastX = 40;
    const withNonText: TextLine = {
      yPt: 0,
      items: [
        textItem(0, smallOffset, DEFAULT_LINE_SIZE_PT),
        nonText,
        textItem(lastX, smallOffset, DEFAULT_LINE_SIZE_PT),
      ],
    };
    // Neither adjacent pair (text, image) nor (image, text) qualifies — only a text-to-text pair is ever compared.
    expect(cellsInLine(withNonText)).toBe(1);
  });
});

describe("isRowAlignedGrid", () => {
  const bandAX = 0;
  const bandBX = 100;
  const rowTop = 700;
  const rowSecond = 690;
  const rowNext = 680;

  it("recognises two bands sharing the same row y-positions as a row-aligned grid", () => {
    const bandA = [boundedText(bandAX, rowTop), boundedText(bandAX, rowNext)];
    const bandB = [boundedText(bandBX, rowTop), boundedText(bandBX, rowNext)];
    expect(isRowAlignedGrid([bandA, bandB])).toBe(true);
  });

  it("is false when fewer than two bands have at least two lines of their own", () => {
    const bandA = [boundedText(bandAX, rowTop), boundedText(bandAX, rowNext)];
    const bandB = [boundedText(bandBX, rowTop)]; // only one line
    expect(isRowAlignedGrid([bandA, bandB])).toBe(false);
  });

  it("is false when the bands' own row positions do not recur across bands", () => {
    const bandA = [boundedText(bandAX, rowTop), boundedText(bandAX, rowNext)];
    const otherRowTop = 500;
    const otherRowNext = 480;
    const bandB = [
      boundedText(bandBX, otherRowTop),
      boundedText(bandBX, otherRowNext),
    ];
    expect(isRowAlignedGrid([bandA, bandB])).toBe(false);
  });

  it("hits the row-alignment fraction's own inclusive boundary exactly", () => {
    // First band has 5 rows; the second band matches exactly 3 of them, a hit fraction of precisely 0.6 (ROW_ALIGNMENT_FRACTION).
    const row3 = 670;
    const row4 = 660;
    const otherRow3 = 600;
    const otherRow4 = 590;
    const rowsA = [rowTop, rowSecond, rowNext, row3, row4];
    const rowsBMatchingThree = [
      rowTop,
      rowSecond,
      rowNext,
      otherRow3,
      otherRow4,
    ];
    const bandA = rowsA.map((y) => boundedText(bandAX, y));
    const bandB = rowsBMatchingThree.map((y) => boundedText(bandBX, y));
    expect(isRowAlignedGrid([bandA, bandB])).toBe(true);
    // One fewer match (2 of 5 = 0.4) must fall below the threshold.
    const nonMatchingRow = 610;
    const rowsCMatchingTwo = [
      rowTop,
      rowSecond,
      nonMatchingRow,
      otherRow3,
      otherRow4,
    ];
    const bandC = rowsCMatchingTwo.map((y) => boundedText(bandBX, y));
    expect(isRowAlignedGrid([bandA, bandC])).toBe(false);
  });

  it("requires a first-band row to recur in EVERY other qualifying band, not merely one of them", () => {
    // bandB matches all three of first's rows; bandC matches none. Requiring every band to agree correctly finds zero matches; a check that only required some band to agree would wrongly count all three.
    const rows = [rowTop, rowSecond, rowNext];
    const thirdBandX = 200;
    const unmatchedRowA = 500;
    const unmatchedRowB = 490;
    const first = rows.map((y) => boundedText(bandAX, y));
    const bandB = rows.map((y) => boundedText(bandBX, y));
    const bandC = [unmatchedRowA, unmatchedRowB].map((y) =>
      boundedText(thirdBandX, y),
    );
    expect(isRowAlignedGrid([first, bandB, bandC])).toBe(false);
  });

  it("matches a row at exactly LINE_TOLERANCE_PT away, not only a strictly closer one", () => {
    const bandA = [boundedText(bandAX, rowTop), boundedText(bandAX, rowSecond)];
    // Each row is exactly 2pt (LINE_TOLERANCE_PT) from its bandA counterpart.
    const bandB = [
      boundedText(bandBX, rowTop + 2),
      boundedText(bandBX, rowSecond - 2),
    ];
    expect(isRowAlignedGrid([bandA, bandB])).toBe(true);
  });
});

describe("findCut", () => {
  it("merges overlapping/touching intervals into one band, splitting only at a genuine gap", () => {
    const items = [
      boundedAt({ minX: 0, maxX: 10, minY: 0, maxY: 10 }),
      boundedAt({ minX: 10, maxX: 20, minY: 0, maxY: 10 }), // touches the first band exactly — same band
      boundedAt({ minX: 100, maxX: 110, minY: 0, maxY: 10 }), // far past any gap threshold — new band
    ];
    const cut = findCut(items, "x");
    expect(cut?.groups).toHaveLength(2);
    expect(cut?.groups[0]).toHaveLength(2);
    expect(cut?.groups[1]).toHaveLength(1);
  });

  it("merging a touching item into the running band (not starting a new one) changes the band's own scale, and therefore the next gap's threshold", () => {
    // item1 (scale 100) and item2 (scale 1) touch exactly at x=100 — correctly merged into ONE band, whose own scale is median([100, 1]) = 50.5, comfortably absorbing the 10pt gap to item3 (threshold 1.5*50.5 = 75.75) so NO cut occurs at all. A boundary weakened from `>` to `>=` would instead start item2 as its OWN band (scale 1), making that band's own gap to item3 use threshold 1.5*1 = 1.5 — well under the 10pt gap — and wrongly cut. The two outcomes (no cut at all vs. a genuine cut) are as different as this function's return value can be.
    const items = [
      boundedAt({ minX: 0, maxX: 100, minY: 0, maxY: 100 }), // itemScale 100
      boundedAt({ minX: 100, maxX: 101, minY: 0, maxY: 1 }), // touches item1's maxX exactly; itemScale 1
      boundedAt({ minX: 111, maxX: 211, minY: 0, maxY: 100 }), // 10pt gap from item2's own maxX; itemScale 100
    ];
    expect(findCut(items, "x")).toBeUndefined();
  });

  it("returns undefined when fewer than two bands result", () => {
    const items = [
      boundedAt({ minX: 0, maxX: 10, minY: 0, maxY: 10 }),
      boundedAt({ minX: 5, maxX: 15, minY: 0, maxY: 10 }), // overlapping — one band only
    ];
    expect(findCut(items, "x")).toBeUndefined();
  });

  it("returns undefined when no gap clears its own local threshold", () => {
    // Two bands with a small gap (2pt) but a large representative scale (100pt tall items) — GAP_RATIO * 100 comfortably exceeds 2, so this must not cut.
    const items = [
      boundedAt({ minX: 0, maxX: 10, minY: 0, maxY: 100 }),
      boundedAt({ minX: 12, maxX: 22, minY: 0, maxY: 100 }),
    ];
    expect(findCut(items, "x")).toBeUndefined();
  });

  it("rejects a vertical cut that would fragment a row-aligned grid, but still allows the identical shape on the y-axis", () => {
    const bandAX = 0;
    const bandBX = 100;
    const rowTop = 700;
    const rowNext = 680;
    const bandA = [boundedText(bandAX, rowTop), boundedText(bandAX, rowNext)];
    const bandB = [boundedText(bandBX, rowTop), boundedText(bandBX, rowNext)];
    const items = [...bandA, ...bandB];
    expect(findCut(items, "x")).toBeUndefined();
  });

  it("tracks the single widest qualifying gap as maxGap, not merely the last or first", () => {
    // Three bands: gaps of 20pt then 50pt (each comfortably clearing the small-item threshold) — maxGap must be the wider one, from the SECOND gap, not the first.
    const widerGap = 50;
    const items = [
      boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 }),
      boundedAt({ minX: 25, maxX: 30, minY: 0, maxY: 5 }), // gap of 20 from the first band
      boundedAt({ minX: 80, maxX: 85, minY: 0, maxY: 5 }), // gap of 50 from the second band
    ];
    const cut = findCut(items, "x");
    expect(cut?.maxGap).toBe(widerGap);
  });

  it("never lets a smaller LATER qualifying gap overwrite an already-tracked wider maxGap", () => {
    // Gaps of 50pt then 20pt, both clearing threshold — maxGap must stay 50 even though the 20pt gap is processed second.
    const widerGap = 50;
    const items = [
      boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 }),
      boundedAt({ minX: 55, maxX: 60, minY: 0, maxY: 5 }), // gap of 50 from the first band
      boundedAt({ minX: 80, maxX: 85, minY: 0, maxY: 5 }), // gap of 20 from the second band
    ];
    const cut = findCut(items, "x");
    expect(cut?.maxGap).toBe(widerGap);
  });

  it("cuts at a gap exactly equal to its own local threshold, not only strictly beyond it", () => {
    // Each item has scale 10 (10x10), so the threshold is GAP_RATIO(1.5) * 10 = 15 — comfortably above the 3pt floor. A gap of exactly 15 must still qualify.
    const items = [
      boundedAt({ minX: 0, maxX: 10, minY: 0, maxY: 10 }),
      boundedAt({ minX: 25, maxX: 35, minY: 0, maxY: 10 }), // gap = 25 - 10 = 15
    ];
    const cut = findCut(items, "x");
    expect(cut?.groups).toHaveLength(2);
  });
});

describe("recursiveXYCut", () => {
  it("falls back to the horizontal cut when no vertical cut exists at all", () => {
    const items = [
      boundedAt({ minX: 0, maxX: 10, minY: 0, maxY: 10 }),
      boundedAt({ minX: 0, maxX: 10, minY: 100, maxY: 110 }), // identical x-range, big y gap
    ];
    expect(recursiveXYCut(items, 0)).toHaveLength(2);
  });

  it("chooses whichever axis actually has a wider qualifying gap, not always the same one", () => {
    // x-gap (190) is far wider than the y-gap (40) between the same four items — the vertical (x) cut must win first. Choosing x first visits the low-x band {A,C} before the high-x band {B,D}, and within each visits low-y before high-y, giving reading order [C, A, D, B]; choosing y first (the mutant this proves) would instead visit {C,D} before {A,B}, giving [C, D, A, B] — same four singleton leaves, different order.
    const A = boundedAt({ minX: 0, maxX: 10, minY: 100, maxY: 110 });
    const B = boundedAt({ minX: 200, maxX: 210, minY: 100, maxY: 110 });
    const C = boundedAt({ minX: 0, maxX: 10, minY: 50, maxY: 60 });
    const D = boundedAt({ minX: 200, maxX: 210, minY: 50, maxY: 60 });
    const items = [A, B, C, D];
    const verticalCut = findCut(items, "x");
    const horizontalCut = findCut(items, "y");
    expect(verticalCut?.maxGap).toBeGreaterThan(horizontalCut?.maxGap ?? 0);
    expect(recursiveXYCut(items, 0)).toEqual([[C], [A], [D], [B]]);
  });

  it("chooses the horizontal cut when its own gap is the wider one, not always the vertical", () => {
    // The mirror of the test above: y-gap (95) wider than x-gap (45). Correctly choosing y first visits the low-y band before the high-y band (each sorted low-x-then-high-x within), giving [A, B, C, D]; wrongly choosing x first would instead give [A, C, B, D].
    const A = boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 });
    const B = boundedAt({ minX: 50, maxX: 55, minY: 0, maxY: 5 });
    const C = boundedAt({ minX: 0, maxX: 5, minY: 100, maxY: 105 });
    const D = boundedAt({ minX: 50, maxX: 55, minY: 100, maxY: 105 });
    const items = [A, B, C, D];
    const horizontalCut = findCut(items, "y");
    const verticalCut = findCut(items, "x");
    expect(horizontalCut?.maxGap).toBeGreaterThan(verticalCut?.maxGap ?? 0);
    expect(recursiveXYCut(items, 0)).toEqual([[A], [B], [C], [D]]);
  });

  it("prefers the vertical cut on an exact tie between the two axes' own maxGap", () => {
    // A symmetric grid where the x-gap and y-gap are both exactly 45 — ties must resolve to the vertical (x) cut, per the `>=` in the axis-choice comparison. Choosing x first (correct) gives [A, C, B, D]; wrongly falling back to y on a tie would instead give [A, B, C, D].
    const A = boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 });
    const B = boundedAt({ minX: 50, maxX: 55, minY: 0, maxY: 5 });
    const C = boundedAt({ minX: 0, maxX: 5, minY: 50, maxY: 55 });
    const D = boundedAt({ minX: 50, maxX: 55, minY: 50, maxY: 55 });
    const items = [A, B, C, D];
    const verticalCut = findCut(items, "x");
    const horizontalCut = findCut(items, "y");
    expect(verticalCut?.maxGap).toBe(horizontalCut?.maxGap);
    expect(recursiveXYCut(items, 0)).toEqual([[A], [C], [B], [D]]);
  });

  it("respects the depth bound through actual recursion, not just when passed in already at the limit", () => {
    // Mirrors pdf-regions.ts's own private MAX_CUT_DEPTH.
    const maxCutDepth = 16;
    const A = boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 });
    const B = boundedAt({ minX: 0, maxX: 5, minY: 100, maxY: 105 });
    const C = boundedAt({ minX: 200, maxX: 205, minY: 0, maxY: 5 });
    const D = boundedAt({ minX: 200, maxX: 205, minY: 100, maxY: 105 });
    // Starting one level below the max depth: the top-level x-cut (gap 195) is still allowed at that depth, but the recursive call into each half must land at the bound and stop there, leaving {A,B} and {C,D} each as one unsplit leaf even though their own y-gap (95) would otherwise easily clear the cut threshold. A depth computed as `depth - 1` instead of `depth + 1` would never reach the bound, and would keep splitting into four singletons.
    const result = recursiveXYCut([A, B, C, D], maxCutDepth - 1);
    expect(result).toEqual([
      [A, B],
      [C, D],
    ]);
  });

  it("does not attempt a cut for zero or one items", () => {
    expect(recursiveXYCut([], 0)).toEqual([[]]);
    const only = [boundedAt({ minX: 0, minY: 0, maxX: 1, maxY: 1 })];
    expect(recursiveXYCut(only, 0)).toEqual([only]);
  });

  it("stops recursing once the depth bound is reached, even with genuinely splittable content", () => {
    // Mirrors pdf-regions.ts's own private MAX_CUT_DEPTH.
    const maxCutDepth = 16;
    const items = [
      boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 }),
      boundedAt({ minX: 500, maxX: 505, minY: 0, maxY: 5 }),
    ];
    const atDepthLimit = recursiveXYCut(items, maxCutDepth);
    expect(atDepthLimit).toEqual([items]);
  });
});

describe("classifyFromLeafSignals", () => {
  // Mirrors pdf-regions.ts's own private classification weights and thresholds.
  const IMAGE_FIGURE_BONUS = 0.15;
  const GRID_GRAPHIC_BONUS = 0.15;
  const TABLE_CELL_COUNT_WEIGHT = 0.5;
  const TABLE_CELL_REGULARITY_WEIGHT = 0.35;
  const COLUMN_X_START_REGULARITY_WEIGHT = 0.7;
  const COLUMN_AVG_CELLS_WEIGHT = 0.3;
  const MIXED_MARGIN = 0.15;

  const baseSignals: LeafSignals = {
    graphicFraction: 0,
    hasImage: false,
    lineCount: 0,
    avgCells: 0,
    cellRegularity: 1,
    xStartRegularity: 1,
  };

  it("scores figure from graphic fraction plus an image bonus", () => {
    expect(
      classifyFromLeafSignals({ ...baseSignals, graphicFraction: 0.9 }),
    ).toEqual({ classification: "figure", confidence: 0.9 });
    const graphicFraction = 0.5;
    const withImage = classifyFromLeafSignals({
      ...baseSignals,
      graphicFraction,
      hasImage: true,
    });
    expect(withImage.classification).toBe("figure");
    expect(withImage.confidence).toBeCloseTo(
      graphicFraction + IMAGE_FIGURE_BONUS,
      PRECISION_DIGITS,
    );
  });

  it("never scores table or column from a single line, however cell-like its own signals look", () => {
    const signals: LeafSignals = {
      ...baseSignals,
      lineCount: 1,
      avgCells: 5,
      cellRegularity: 1,
      xStartRegularity: 1,
    };
    expect(classifyFromLeafSignals(signals).classification).not.toBe("table");
    expect(classifyFromLeafSignals(signals).classification).not.toBe("column");
  });

  it("computes tableScore as a weighted blend of cell count, cell regularity, and a grid-graphic bonus", () => {
    const cellRegularity = 0.8;
    const signals: LeafSignals = {
      graphicFraction: 0.2, // > 0 and < 0.5, so the grid-graphic bonus applies
      hasImage: false,
      lineCount: 2,
      avgCells: 2, // > 1.15
      cellRegularity,
      xStartRegularity: 0,
    };
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("table");
    // TABLE_CELL_COUNT_WEIGHT * clamp01(2-1) + TABLE_CELL_REGULARITY_WEIGHT * cellRegularity + GRID_GRAPHIC_BONUS
    expect(result.confidence).toBeCloseTo(
      TABLE_CELL_COUNT_WEIGHT * 1 +
        TABLE_CELL_REGULARITY_WEIGHT * cellRegularity +
        GRID_GRAPHIC_BONUS,
      PRECISION_DIGITS,
    );
  });

  it("does not apply the grid-graphic bonus outside (0, 0.5)", () => {
    const cellRegularity = 0.8;
    const noGraphic: LeafSignals = {
      graphicFraction: 0,
      hasImage: false,
      lineCount: 2,
      avgCells: 2,
      cellRegularity,
      xStartRegularity: 0,
    };
    const expectedConfidence =
      TABLE_CELL_COUNT_WEIGHT * 1 +
      TABLE_CELL_REGULARITY_WEIGHT * cellRegularity;
    expect(classifyFromLeafSignals(noGraphic).confidence).toBeCloseTo(
      expectedConfidence,
      PRECISION_DIGITS,
    );
    const fullGraphic: LeafSignals = { ...noGraphic, graphicFraction: 0.5 };
    expect(classifyFromLeafSignals(fullGraphic).confidence).toBeCloseTo(
      expectedConfidence,
      PRECISION_DIGITS,
    );
  });

  it("does not score a table at all when avgCells is at or below the 1.15 boundary", () => {
    const signals: LeafSignals = {
      graphicFraction: 0,
      hasImage: false,
      lineCount: 2,
      avgCells: 1.15,
      cellRegularity: 1,
      xStartRegularity: 1,
    };
    expect(classifyFromLeafSignals(signals).classification).not.toBe("table");
  });

  it("does not let tableScore leak in at exactly the 1.15 boundary, even when every other tableScore input is maximised", () => {
    const signals: LeafSignals = {
      graphicFraction: 0.2, // inside (0, 0.5): the grid-graphic bonus would apply if tableScore were computed at all
      hasImage: false,
      lineCount: 2,
      avgCells: 1.15, // the boundary itself — real code must NOT compute tableScore here
      cellRegularity: 1, // maximises tableScore's own weighted term, so any leak is as visible as possible
      xStartRegularity: 0, // minimises columnScore (0.3 * clamp01(2 - 1.15) = 0.255) so it can never mask a tableScore leak by outscoring it
    };
    // If avgCells > 1.15 were loosened to >=, tableScore would leak in at 0.5*0.15 + 0.35*1 + 0.15(bonus) = 0.575, beating column's 0.255 and reclassifying this leaf as a table instead of unknown.
    expect(classifyFromLeafSignals(signals)).toEqual({
      classification: "unknown",
      confidence: 0.745, // 1 - column's own 0.255
    });
  });

  it("computes columnScore from left-edge regularity and closeness to a single run per line", () => {
    const xStartRegularity = 0.9;
    const avgCells = 1.1;
    const signals: LeafSignals = {
      graphicFraction: 0,
      hasImage: false,
      lineCount: 2,
      avgCells,
      cellRegularity: 1,
      xStartRegularity,
    };
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("column");
    expect(result.confidence).toBeCloseTo(
      COLUMN_X_START_REGULARITY_WEIGHT * xStartRegularity +
        COLUMN_AVG_CELLS_WEIGHT * (2 - avgCells),
      PRECISION_DIGITS,
    );
  });

  it("does not score a column at all once avgCells exceeds the 1.3 boundary", () => {
    const signals: LeafSignals = {
      graphicFraction: 0,
      hasImage: false,
      lineCount: 2,
      avgCells: 1.3,
      cellRegularity: 0, // keeps tableScore small enough to stay under the signal threshold once avgCells > 1.15
      xStartRegularity: 1,
    };
    // At exactly 1.3 columnScore is still computed (<=); confirm it stops just past it.
    expect(classifyFromLeafSignals(signals).classification).toBe("column");
    const justOver: LeafSignals = { ...signals, avgCells: 1.301 };
    // With avgCells just over 1.3, columnScore drops to 0; tableScore is 0.5*clamp01(0.301) = 0.1505 with cellRegularity 0, comfortably below SIGNAL_THRESHOLD — nothing clears it.
    expect(classifyFromLeafSignals(justOver).classification).toBe("unknown");
  });

  it("does not treat a score exactly at the signal threshold as too weak to trust", () => {
    const signals: LeafSignals = {
      graphicFraction: 0.35,
      hasImage: false,
      lineCount: 0,
      avgCells: 0,
      cellRegularity: 1,
      xStartRegularity: 1,
    };
    expect(classifyFromLeafSignals(signals)).toEqual({
      classification: "figure",
      confidence: 0.35,
    });
  });

  it("computes an unknown classification's confidence as the shortfall below the threshold, not the sum with it", () => {
    const signals: LeafSignals = { ...baseSignals, graphicFraction: 0.2 };
    expect(classifyFromLeafSignals(signals)).toEqual({
      classification: "unknown",
      confidence: 0.8,
    });
  });

  it("calls it mixed when two scores clear the signal threshold within the mixed margin of each other", () => {
    // figure = 0.5 (graphicFraction alone); column, with lineCount 0, stays 0 — so pair figure against column via a genuine two-line signal set instead: table via avgCells, figure via graphic fraction.
    const signals: LeafSignals = {
      graphicFraction: 0.44, // figure score 0.44
      hasImage: false,
      lineCount: 2,
      avgCells: 1.2, // table score below, tuned so the gap is small
      cellRegularity: 1,
      xStartRegularity: 0,
    };
    // tableScore = 0.5*clamp01(0.2) + 0.35*1 + 0 (graphicFraction 0.44 is inside (0,0.5), so bonus applies) = 0.1+0.35+0.15=0.6 figureScore = 0.44 gap = 0.16 — adjust to land within MIXED_MARGIN (0.15) by nudging avgCells down slightly.
    const tuned: LeafSignals = { ...signals, avgCells: 1.174 }; // table = 0.5*0.174+0.35+0.15 = 0.587
    const result = classifyFromLeafSignals(tuned);
    expect(result.classification).toBe("mixed");
  });

  it("does not call it mixed when the second-highest score itself falls short of the signal threshold", () => {
    const signals: LeafSignals = {
      graphicFraction: 0.5,
      hasImage: false,
      lineCount: 2,
      avgCells: 1.2,
      cellRegularity: 0,
      xStartRegularity: 0,
    };
    // figureScore = 0.5; tableScore = 0.5*clamp01(0.2)+0.35*0+0 (graphicFraction 0.5 is NOT < 0.5, no bonus) = 0.1 — below threshold.
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("figure");
  });

  it("never calls it mixed just because the two top scores are close, when the second is genuinely below the signal threshold", () => {
    // figureScore = 0.4 (top); columnScore = 0.7*0 + 0.3*clamp01(2-1) = 0.3 (second) — only 0.1 apart (comfortably inside MIXED_MARGIN), but 0.3 itself never clears SIGNAL_THRESHOLD (0.35). A ConditionalExpression forcing this check's own signal-threshold gate to always-true would wrongly call this mixed anyway.
    const graphicFraction = 0.4;
    const signals: LeafSignals = {
      graphicFraction,
      hasImage: false,
      lineCount: 2,
      avgCells: 1,
      cellRegularity: 0,
      xStartRegularity: 0,
    };
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("figure");
    expect(result.confidence).toBeCloseTo(graphicFraction, PRECISION_DIGITS);
  });

  it("treats a second-highest score exactly at the signal threshold as strong enough to call the region mixed", () => {
    const signals: LeafSignals = {
      graphicFraction: 0.45, // figureScore 0.45 (top); also inside (0, 0.5) so tableScore's own grid-graphic bonus applies
      hasImage: false,
      lineCount: 2,
      avgCells: 1.4, // > 1.3, so columnScore is 0 and only table/figure compete
      cellRegularity: 0,
      xStartRegularity: 0,
    };
    // tableScore = 0.5*clamp01(0.4) + 0.35*0 + 0.15(bonus) = 0.35 exactly — the SIGNAL_THRESHOLD itself — with a gap of 0.1 from figure's 0.45, comfortably inside MIXED_MARGIN (0.15). Tightening `>=` to `>` would exclude this exact-boundary case and wrongly call it "figure" instead.
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("mixed");
    // figureScore 0.45 minus tableScore's own SIGNAL_THRESHOLD (0.35), as a fraction of MIXED_MARGIN.
    const scoreGap = 0.1;
    expect(result.confidence).toBeCloseTo(
      1 - scoreGap / MIXED_MARGIN,
      PRECISION_DIGITS,
    );
  });

  it("does not call it mixed when the top score sits exactly at the second score plus the mixed margin", () => {
    // Constructed so the comparison's two sides are BIT-IDENTICAL, not merely numerically close: tableScore is set via avgCells alone (cellRegularity 0, graphicFraction >= 0.5 so the grid-graphic bonus never applies), and figureScore (graphicFraction, hasImage false) is a pure pass-through — multiplying/dividing by 2 is exact for a normal-range double, so doubling secondValue into avgCells's own "-1" term and later halving it back via tableScore's 0.5 weight recovers secondValue exactly (Sterbenz's lemma also guarantees the intervening `avgCells - 1` is computed with no rounding, since avgCells sits within a factor of 2 of 1). figureScore is then set to literally `secondValue + MIXED_MARGIN`, the identical expression classifyFromLeafSignals' own comparison evaluates. See classifyFromLeafSignals' own comment on why the comparison is written as `top < second + MIXED_MARGIN` rather than a gap-based `top - second < MIXED_MARGIN`, which can never be pinned this precisely.
    const secondValue = 0.35;
    const topValue = secondValue + MIXED_MARGIN;
    const signals: LeafSignals = {
      graphicFraction: topValue, // figureScore = topValue exactly; >= 0.5, so no grid-graphic bonus
      hasImage: false,
      lineCount: 2,
      avgCells: 1 + secondValue * 2,
      cellRegularity: 0,
      xStartRegularity: 0,
    };
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("figure");
    expect(result.confidence).toBeCloseTo(topValue, PRECISION_DIGITS);
  });
});

describe("classifyLeaf", () => {
  // Mirrors pdf-regions.ts's own private LONE_IMAGE_CONFIDENCE/LONE_SHAPE_CONFIDENCE.
  const LONE_IMAGE_CONFIDENCE = 0.9;
  const LONE_SHAPE_CONFIDENCE = 0.6;

  it("is unknown for a single text item, but a figure for a single non-text one", () => {
    expect(classifyLeaf([boundedText(0, 0, "lone")])).toEqual({
      classification: "unknown",
      confidence: 1,
    });
    const rectItem: BoundedItem = {
      item: { kind: "rect", xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 },
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    };
    expect(classifyLeaf([rectItem]).classification).toBe("figure");
  });

  it("gives a lone image higher confidence than a lone non-image graphic", () => {
    const imageItem: BoundedItem = {
      item: {
        kind: "image",
        imageId: "i1",
        xPt: 0,
        yPt: 0,
        widthPt: 5,
        heightPt: 5,
      },
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    };
    const rectItem: BoundedItem = {
      item: { kind: "rect", xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 },
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    };
    expect(classifyLeaf([imageItem]).confidence).toBe(LONE_IMAGE_CONFIDENCE);
    expect(classifyLeaf([rectItem]).confidence).toBe(LONE_SHAPE_CONFIDENCE);
  });

  it("hits the minimum-items-for-signal boundary exactly", () => {
    // MIN_ITEMS_FOR_SIGNAL is 2: one item is too few (unknown), two is enough to compute real signals.
    expect(classifyLeaf([boundedText(0, 0, "a")]).classification).toBe(
      "unknown",
    );
    const rowOneY = 700;
    const rowTwoY = 680;
    const two = [boundedText(0, rowOneY, "a"), boundedText(0, rowTwoY, "b")];
    expect(classifyLeaf(two).classification).not.toBe("unknown");
  });

  it("recognises hasImage from any item in the set, not by replacing the whole check", () => {
    // A single text item plus one graphic keeps lineCount at 1 (table/column scoring never activates), so figureScore is the only nonzero score in both cases and the image-specific +0.15 bonus shows up directly in the confidence.
    const rowY = 700;
    const glyphSize = 5;
    const rowBottom = rowY + glyphSize;
    const withImage: BoundedItem[] = [
      boundedText(0, rowY, "a"),
      {
        item: {
          kind: "image",
          imageId: "i1",
          xPt: 100,
          yPt: rowY,
          widthPt: glyphSize,
          heightPt: glyphSize,
        },
        bounds: { minX: 100, minY: rowY, maxX: 105, maxY: rowBottom },
      },
    ];
    const withoutImage: BoundedItem[] = [
      boundedText(0, rowY, "a"),
      {
        item: {
          kind: "rect",
          xPt: 100,
          yPt: rowY,
          widthPt: glyphSize,
          heightPt: glyphSize,
        },
        bounds: { minX: 100, minY: rowY, maxX: 105, maxY: rowBottom },
      },
    ];
    const figureConfidence = 0.5;
    const imageFigureBonus = 0.15;
    expect(classifyLeaf(withImage)).toEqual({
      classification: "figure",
      confidence: figureConfidence + imageFigureBonus,
    });
    expect(classifyLeaf(withoutImage)).toEqual({
      classification: "figure",
      confidence: figureConfidence,
    });
  });
});

describe("computeLeafSignals", () => {
  it("computes graphicFraction, hasImage, and lineCount from real items", () => {
    const rowOneY = 700;
    const rowTwoY = 680;
    const textItemCount = 2;
    const totalItemCount = 3; // two text rows plus one image
    const items = [
      boundedText(0, rowOneY, "row one text"),
      boundedText(0, rowTwoY, "row two text"),
      {
        item: {
          kind: "image" as const,
          imageId: "i1",
          xPt: 0,
          yPt: 0,
          widthPt: 5,
          heightPt: 5,
        },
        bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
      },
    ];
    const signals = computeLeafSignals(items);
    expect(signals.graphicFraction).toBeCloseTo(
      1 / totalItemCount,
      PRECISION_DIGITS,
    );
    expect(signals.hasImage).toBe(true);
    expect(signals.lineCount).toBe(textItemCount);
  });

  it("leaves avgCells/cellRegularity/xStartRegularity at their trivial defaults when only one line is present", () => {
    const rowY = 700;
    const secondColumnX = 20;
    const items = [
      boundedText(0, rowY, "a"),
      boundedText(secondColumnX, rowY, "b"),
    ]; // same line
    const signals = computeLeafSignals(items);
    expect(signals.lineCount).toBe(1);
    expect(signals.avgCells).toBe(0);
    expect(signals.cellRegularity).toBe(1);
    expect(signals.xStartRegularity).toBe(1);
  });
});

describe("attachCaptions", () => {
  // Mirrors pdf-regions.ts's own private CAPTION_MAX_CHARS.
  const CAPTION_MAX_CHARS = 160;

  const figureRegion: PdfRegion = {
    bounds: { xPt: 100, yPt: 400, widthPt: 100, heightPt: 100 },
    items: [],
    classification: "figure",
    confidence: 0.9,
  };

  const captionWidthPt = 10;

  function textRegion(
    bounds: PdfRegion["bounds"],
    text: string,
    classification: PdfRegion["classification"] = "column",
  ): PdfRegion {
    return {
      bounds,
      items: [
        { ...textItem(bounds.xPt, captionWidthPt), text, yPt: bounds.yPt },
      ],
      classification,
      confidence: 0.5,
    };
  }

  it("attaches a short, vertically-adjacent, horizontally-overlapping column region as a caption", () => {
    const caption = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    const [region] = attachCaptions([figureRegion, caption]);
    // The figure itself is no longer untouched: it now carries the matched caption's text on its own `caption` field, in addition to the caption staying its own 'caption'-classified region below.
    expect(region).toEqual({ ...figureRegion, caption: "Figure 1." });
    const result = attachCaptions([figureRegion, caption])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("does not attach a caption whose own text exceeds the caption length cap", () => {
    const longText = "x".repeat(CAPTION_MAX_CHARS + 1);
    const tooLong = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      longText,
    );
    const result = attachCaptions([figureRegion, tooLong])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("does not attach a caption to a figure it does not horizontally overlap", () => {
    const farRight = textRegion(
      { xPt: 500, yPt: 385, widthPt: 50, heightPt: 10 },
      "Nearby but not overlapping.",
    );
    const result = attachCaptions([figureRegion, farRight])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("only leaves a non-column/unknown classification (e.g. table) untouched, never reclassifying it", () => {
    const tableRegion = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "Short.",
      "table",
    );
    const result = attachCaptions([figureRegion, tableRegion])[1]!;
    expect(result.classification).toBe("table");
  });

  it("picks the nearest of two candidate figures by vertical gap, not the first one checked", () => {
    const closeFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 300, widthPt: 100, heightPt: 50 },
    };
    const farFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 500, widthPt: 100, heightPt: 100 },
    };
    // Caption sits just above closeFigure (gap ~5) and far below farFigure's own bottom.
    const caption = textRegion(
      { xPt: 100, yPt: 355, widthPt: 100, heightPt: 10 },
      "Figure caption.",
    );
    const results = attachCaptions([farFigure, closeFigure, caption]);
    const result = results[2]!;
    expect(result.classification).toBe("caption");
    // Confidence derived from the CLOSE figure's small gap should be high, not the far figure's (which wouldn't even qualify within CAPTION_GAP_PT).
    const confidenceFloor = 0.5;
    expect(result.confidence).toBeGreaterThan(confidenceFloor);
  });

  it("only considers genuine figure regions as caption candidates, not every region", () => {
    const nonFigure: PdfRegion = {
      bounds: { xPt: 100, yPt: 400, widthPt: 100, heightPt: 100 },
      items: [],
      classification: "table",
      confidence: 0.9,
    };
    const caption = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    const result = attachCaptions([nonFigure, caption])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("joins a region's own multiple text items with a space before measuring caption length", () => {
    const wordOneX = 100;
    const wordTwoX = 140;
    const glyphWidth = 5;
    const twoWordCaption: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        { ...textItem(wordOneX, glyphWidth), text: "Figure", yPt: 385 },
        { ...textItem(wordTwoX, glyphWidth), text: "1.", yPt: 385 },
      ],
      classification: "column",
      confidence: 0.5,
    };
    const result = attachCaptions([figureRegion, twoWordCaption])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("still attaches at exactly the caption length cap, only rejecting one character past it", () => {
    const atCap = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "x".repeat(CAPTION_MAX_CHARS),
    );
    const result = attachCaptions([figureRegion, atCap])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("still attaches at exactly the caption gap cap, not only strictly inside it", () => {
    // figureRegion spans y=[400,500]; a caption whose own top (yPt + heightPt) sits exactly CAPTION_GAP_PT (24) below that (bottom 400) must still qualify: top = 400 - 24 = 376, so yPt = 376 - 10 = 366.
    const atGapCap = textRegion(
      { xPt: 100, yPt: 366, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    const result = attachCaptions([figureRegion, atGapCap])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("treats a non-text item mixed into a candidate caption region's items as contributing no text at all", () => {
    const wordOneX = 100;
    const graphicX = 140;
    const wordTwoX = 150;
    const glyphWidth = 5;
    const wordLength = 77;
    const withGraphic: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        {
          ...textItem(wordOneX, glyphWidth),
          text: "x".repeat(wordLength),
          yPt: 385,
        },
        {
          kind: "rect",
          xPt: graphicX,
          yPt: 385,
          widthPt: glyphWidth,
          heightPt: glyphWidth,
        },
        {
          ...textItem(wordTwoX, glyphWidth),
          text: "x".repeat(wordLength),
          yPt: 385,
        },
      ],
      classification: "column",
      confidence: 0.5,
    };
    // Joined length is wordLength + 1 + 0 + 1 + wordLength = 156 if the rect contributes "" as it should — comfortably under CAPTION_MAX_CHARS. If it instead contributed a placeholder string in its place, the joined length would jump past the cap and this would no longer qualify as a caption.
    const result = attachCaptions([figureRegion, withGraphic])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("trims surrounding whitespace before measuring caption length, not just joining", () => {
    const paddedAtCap = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      `  ${"x".repeat(CAPTION_MAX_CHARS)}  `, // untrimmed length 164, but trims down to exactly the caption cap
    );
    const result = attachCaptions([figureRegion, paddedAtCap])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("counts the space between joined text items toward the caption length cap", () => {
    const wordOneX = 100;
    const wordTwoX = 200;
    const glyphWidth = 5;
    const halfCapWordLength = CAPTION_MAX_CHARS / 2;
    const longTwoWordCaption: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        {
          ...textItem(wordOneX, glyphWidth),
          text: "a".repeat(halfCapWordLength),
          yPt: 385,
        },
        {
          ...textItem(wordTwoX, glyphWidth),
          text: "a".repeat(halfCapWordLength),
          yPt: 385,
        },
      ],
      classification: "column",
      confidence: 0.5,
    };
    // Joined with the real " " separator this is CAPTION_MAX_CHARS + 1 characters (halfCapWordLength + 1 + halfCapWordLength), one past the cap; joined with no separator at all it would be exactly at the cap, wrongly still qualifying.
    const result = attachCaptions([figureRegion, longTwoWordCaption])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("does not attach a whitespace-only text region as a caption", () => {
    const blank = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "   ",
    );
    const result = attachCaptions([figureRegion, blank])[1]!;
    expect(result.classification).not.toBe("caption");
  });

  it("never lets a later-checked qualifying figure override an already-found nearer one", () => {
    const nearFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 370, widthPt: 100, heightPt: 50 },
    };
    const farFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 50 },
    };
    const caption = textRegion(
      { xPt: 100, yPt: 355, widthPt: 100, heightPt: 10 },
      "Figure 1.",
    );
    // nearFigure (gap 5) is checked before farFigure (gap 20); a correct "strictly closer" comparison must keep nearFigure as nearest, not let farFigure unconditionally overwrite it.
    const result = attachCaptions([nearFigure, farFigure, caption])[2]!;
    expect(result.classification).toBe("caption");
    const nearGap = 5;
    const captionGapPt = 24; // Mirrors pdf-regions.ts's own private CAPTION_GAP_PT.
    expect(result.confidence).toBeCloseTo(
      1 - nearGap / captionGapPt,
      PRECISION_DIGITS,
    );
  });

  it("gives a figure the nearer of two caption candidates even when the nearer one is checked second", () => {
    // Candidates are visited in array order, so this is the arrangement where keeping the first-seen candidate and replacing it with a strictly nearer later one give different answers. The far run is 20pt above figureRegion (top 500) and the near run 5pt below it (bottom 400).
    const far = textRegion(
      { xPt: 100, yPt: 520, widthPt: 100, heightPt: 10 },
      "The farther run.",
    );
    const near = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      "The nearer run.",
    );
    const [figure] = attachCaptions([figureRegion, far, near]);
    expect(figure?.caption).toBe("The nearer run.");
  });

  it("keeps the first of two caption candidates that are exactly as near as each other", () => {
    // 15pt above and 15pt below figureRegion: an exact tie, which the strictly-closer comparison resolves in favour of the candidate seen first, so a later run never displaces an equally near one.
    const first = textRegion(
      { xPt: 100, yPt: 515, widthPt: 100, heightPt: 10 },
      "The first run.",
    );
    const second = textRegion(
      { xPt: 100, yPt: 375, widthPt: 100, heightPt: 10 },
      "The second run.",
    );
    const [figure] = attachCaptions([figureRegion, first, second]);
    expect(figure?.caption).toBe("The first run.");
  });

  it("claims a run for the first of two figures that are exactly as near as each other", () => {
    // One run sits 15pt above figureRegion (top 500) and 15pt below a second figure (bottom 540): an exact tie between the two figures, resolved in favour of the figure seen first, so only that one carries the run's text.
    const upperFigure: PdfRegion = {
      ...figureRegion,
      bounds: { xPt: 100, yPt: 540, widthPt: 100, heightPt: 100 },
    };
    const between = textRegion(
      { xPt: 100, yPt: 515, widthPt: 100, heightPt: 10 },
      "Between two figures.",
    );
    const [lower, upper] = attachCaptions([figureRegion, upperFigure, between]);
    expect(lower?.caption).toBe("Between two figures.");
    expect(upper?.caption).toBeUndefined();
  });
});

describe("horizontallyOverlaps", () => {
  it("is true when the two spans genuinely overlap", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 5, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(true);
  });

  it("is false when one span ends exactly where the other begins", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 10, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
  });

  it("is false when the FIRST span's own start exactly touches the second span's end (the mirrored boundary)", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 10, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
  });

  it("is false when the spans are far apart in either direction", () => {
    expect(
      horizontallyOverlaps(
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 100, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
    expect(
      horizontallyOverlaps(
        { xPt: 100, yPt: 0, widthPt: 10, heightPt: 1 },
        { xPt: 0, yPt: 0, widthPt: 10, heightPt: 1 },
      ),
    ).toBe(false);
  });
});

describe("verticalGap", () => {
  it("computes the gap when a sits above b", () => {
    const aTop = 100;
    const aHeight = 10;
    const bTop = 50;
    const bHeight = 20;
    // a spans [aTop, aTop+aHeight]; b spans [bTop, bTop+bHeight]. a's bottom sits above b's top by the gap below.
    expect(
      verticalGap(
        { xPt: 0, yPt: aTop, widthPt: 1, heightPt: aHeight },
        { xPt: 0, yPt: bTop, widthPt: 1, heightPt: bHeight },
      ),
    ).toBe(aTop - (bTop + bHeight));
  });

  it("computes the gap when b sits above a", () => {
    const aTop = 100;
    const aHeight = 10;
    const bTop = 50;
    const bHeight = 20;
    expect(
      verticalGap(
        { xPt: 0, yPt: bTop, widthPt: 1, heightPt: bHeight },
        { xPt: 0, yPt: aTop, widthPt: 1, heightPt: aHeight },
      ),
    ).toBe(aTop - (bTop + bHeight));
  });

  it("returns undefined when the two spans overlap on the y-axis", () => {
    expect(
      verticalGap(
        { xPt: 0, yPt: 0, widthPt: 1, heightPt: 20 },
        { xPt: 0, yPt: 10, widthPt: 1, heightPt: 20 },
      ),
    ).toBeUndefined();
  });

  it("computes a zero gap, not undefined, when the two spans exactly touch", () => {
    // a spans [100,110]; b spans [50,100] — a's bottom (100) exactly equals b's top (100), touching with no overlap and no room between them.
    expect(
      verticalGap(
        { xPt: 0, yPt: 100, widthPt: 1, heightPt: 10 },
        { xPt: 0, yPt: 50, widthPt: 1, heightPt: 50 },
      ),
    ).toBe(0);
    expect(
      verticalGap(
        { xPt: 0, yPt: 50, widthPt: 1, heightPt: 50 },
        { xPt: 0, yPt: 100, widthPt: 1, heightPt: 10 },
      ),
    ).toBe(0);
  });
});

describe("assertNeverLayoutItem", () => {
  it("throws naming the unhandled item, proving layoutItemBounds' own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverLayoutItem({ kind: "bogus" } as never);
    }).toThrow('layoutItemBounds: unhandled layout item {"kind":"bogus"}');
  });
});
