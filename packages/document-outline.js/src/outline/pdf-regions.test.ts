import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutPage, LayoutText } from "pdf-codec";
import type { LayoutFont } from "document-schema.js";
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

// A line of text is one LayoutItem, matching how a PDF content stream typically emits one contiguous run per Tj -- widthPt is derived from a rough average glyph advance (0.5em per character) rather than hand-computed per fixture, since these tests only care about relative scale (a gutter/gap being comfortably wider or narrower than a line's own font size), not exact glyph metrics.
function line(xPt: number, yPt: number, text: string, sizePt = 10): LayoutText {
  return {
    kind: "text",
    text,
    xPt,
    yPt,
    font: FONT,
    sizePt,
    color: BLACK,
    widthPt: text.length * sizePt * 0.5,
  };
}

function page(items: LayoutItem[]): LayoutPage {
  return { widthPt: 612, heightPt: 792, items };
}

describe("segmentPdfRegions", () => {
  it("returns nothing for a page with no items", () => {
    expect(segmentPdfRegions(page([]))).toEqual([]);
  });

  it("excludes link/internalLink annotations from segmentation", () => {
    const regions = segmentPdfRegions(
      page([
        line(50, 700, "Some prose text here to read."),
        line(50, 686, "Continuing on the very next line below."),
        {
          kind: "link",
          uri: "https://example.com",
          xPt: 50,
          yPt: 680,
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
    const lines = Array.from({ length: 6 }, (_, index) =>
      line(
        50,
        700 - index * 14,
        "The quick brown fox jumps over the lazy dog.",
      ),
    );
    const regions = segmentPdfRegions(page(lines));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("column");
    expect(regions[0]?.items).toHaveLength(6);
  });

  it("splits a two-column layout at the gutter, classifying each column independently", () => {
    // Short lines, well short of the 200pt gutter, so the gutter is unambiguously wider than either column's own line-height-derived scale. The right column's own line rhythm is deliberately offset from the left's (a different line spacing, 15pt vs 14pt) -- two independent flowing-text columns never share a synchronised row-for-row rhythm in practice, and the offset here is what keeps isRowAlignedGrid from mistaking this for one table's rows.
    const leftColumn = Array.from({ length: 8 }, (_, index) =>
      line(50, 700 - index * 14, "Left column body text."),
    );
    const rightColumn = Array.from({ length: 7 }, (_, index) =>
      line(250, 693 - index * 15, "Right column text."),
    );
    const regions = segmentPdfRegions(page([...leftColumn, ...rightColumn]));

    expect(regions).toHaveLength(2);
    const [left, right] = [...regions].sort(
      (a, b) => a.bounds.xPt - b.bounds.xPt,
    );
    expect(left?.classification).toBe("column");
    expect(left?.items).toHaveLength(8);
    expect(right?.classification).toBe("column");
    expect(right?.items).toHaveLength(7);
  });

  it("classifies a ruled grid of rows and aligned columns as a table, not per-column prose", () => {
    const headers = ["Name", "Age", "City"];
    const rows = [
      ["Alice", "34", "Leeds"],
      ["Bob", "29", "York"],
      ["Carol", "41", "Hull"],
      ["Dave", "37", "Ripon"],
    ];
    const columnX = [50, 200, 320];
    const items: LayoutItem[] = [];
    [headers, ...rows].forEach((row, rowIndex) => {
      const yPt = 700 - rowIndex * 16;
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
    const figure: LayoutItem = {
      kind: "image",
      imageId: "img-1",
      xPt: 100,
      yPt: 500,
      widthPt: 300,
      heightPt: 200,
    };
    // A photo this size' own scale (min(300, 200) = 200pt) would swamp a global gap threshold; the caption gap below is well clear of the LOCAL threshold (1.5 * the caption's own ~10pt font size) that this module actually uses.
    const caption = line(150, 470, "Figure 1: a chart of quarterly results.");
    const proseAbove = Array.from({ length: 4 }, (_, index) =>
      line(
        100,
        760 - index * 14,
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

    const proseRegion = regions.find(
      (region) => region.classification === "column",
    );
    expect(proseRegion?.items).toHaveLength(4);
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
    // Far below the figure -- well past CAPTION_GAP_PT -- so this should stay unclassified rather than being claimed as the figure's caption.
    const farText = line(
      100,
      100,
      "An unrelated short line near the bottom of the page.",
    );

    const regions = segmentPdfRegions(page([figure, farText]));
    const captionRegion = regions.find(
      (region) => region.classification === "caption",
    );
    expect(captionRegion).toBeUndefined();
  });

  it("reports a single small item as unknown, carrying no structural signal", () => {
    const regions = segmentPdfRegions(page([line(50, 700, "x")]));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classification).toBe("unknown");
    expect(regions[0]?.confidence).toBe(1);
  });

  it("sorts regions top to bottom, then left to right, matching reading order", () => {
    const items = [
      line(300, 500, "Bottom right area of the page with more text here."),
      line(50, 700, "Top left area of the page with more text here too."),
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
    // Two top clusters (A at x=50, B at x=400) sharing the same row band, and one bottom cluster (C) far below both -- deliberately listed out of the expected output order (B, C, then A) so the sort must genuinely reorder them, exercising both the primary (y-descending) and tie-break (x-ascending) comparator clauses.
    const clusterA = Array.from({ length: 3 }, (_, index) =>
      line(50, 700 - index * 14, "Top left column body text here."),
    );
    // A distinctly different line spacing (20pt vs clusterA's 14pt) keeps this from being mistaken for one row-aligned table's columns (isRowAlignedGrid's own rejection, the same reason the two-column test above offsets its own rhythm) -- a smaller offset still falls within LINE_TOLERANCE_PT often enough to accidentally "align".
    const clusterB = Array.from({ length: 3 }, (_, index) =>
      line(400, 700 - index * 20, "Top right column body text here."),
    );
    const clusterC = Array.from({ length: 3 }, (_, index) =>
      line(50, 100 - index * 14, "Bottom column body text here too."),
    );
    const regions = segmentPdfRegions(
      page([...clusterB, ...clusterC, ...clusterA]),
    );
    expect(regions).toHaveLength(3);
    expect(regions.map((region) => region.bounds.xPt)).toEqual([50, 400, 50]);
    expect(regions[0]!.bounds.yPt).toBeGreaterThan(regions[2]!.bounds.yPt);
  });

  it("breaks a GENUINE vertical tie (identical bounds.yPt, not merely close) by sorting left to right", () => {
    // Two single-character items at the exact same yPt, far enough apart in x to cut into two leaves whose bounds.yPt are then identical (a single-item leaf's bounds equal the item's own bounds) -- this is the one case that actually exercises the sort comparator's second clause, unlike the "close but not equal" tie test above.
    const items = [line(400, 700, "B"), line(50, 700, "A")]; // listed out of order so a broken (or no-op) tie-break would leave them unsorted
    const regions = segmentPdfRegions(page(items));
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => region.bounds.xPt)).toEqual([50, 400]);
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
    const top = { bounds: boundsAt(0, 700) };
    const bottom = { bounds: boundsAt(0, 100) };
    expect(regionReadingOrderComparator(top, bottom)).toBeLessThan(0);
    expect(regionReadingOrderComparator(bottom, top)).toBeGreaterThan(0);
  });

  it("breaks a genuine vertical tie by sorting left to right, as a subtraction rather than a sum", () => {
    // recursiveXYCut's own internal per-axis sort already fixes which region lands as `a` versus `b` by the time segmentPdfRegions reaches this comparator, so an end-to-end test can never itself control the argument order the tie-break clause receives -- only calling the comparator directly, in BOTH argument orders, can prove it is a genuine subtraction. A sum-based tie-break (both xPt values here being positive, the sum is always positive) would report "a sorts after b" for EVERY ordering of this exact pair, which would still happen to look correct for one specific argument order and wrong for the other -- checking both orders is what makes that distinguishable from a real subtraction, which correctly reverses sign when the arguments swap.
    const left = { bounds: boundsAt(50, 700) };
    const right = { bounds: boundsAt(400, 700) };
    expect(regionReadingOrderComparator(left, right)).toBeLessThan(0);
    expect(regionReadingOrderComparator(right, left)).toBeGreaterThan(0);
  });
});

// A BoundedItem whose own item content is irrelevant -- only `bounds` matters to the function under test (boundingBox, findCut, isRowAlignedGrid's own band-membership).
function boundedAt(bounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): BoundedItem {
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
    // x1 > x2 and y1 < y2 -- both orderings appear in the same item, so Math.min/max cannot be swapped for either axis without this test catching it.
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
    // (5,5) is the moveto; (1,8) pushes minX and maxY; (9,2) pushes maxX and minY -- no single point sets more than two of the four boundaries, so a broken min/max tracker would show up regardless of which boundary it broke.
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
    // With no segments at all, the moveto's own visit() call is the ONLY thing that can ever populate the bounds -- omitting it would leave minX at +Infinity, wrongly reporting no bounds at all.
    expect(
      layoutItemBounds({
        kind: "path",
        subpaths: [{ startXPt: 7, startYPt: 9, segments: [], closed: false }],
      }),
    ).toEqual({ minX: 7, minY: 9, maxX: 7, maxY: 9 });
  });

  it("bounds a cubic segment to the hull of its own control points too, not just its endpoint", () => {
    // The control points (20,0) and (0,20) sit well outside the moveto (0,0) / final endpoint (5,5) -- omitting either visit(c1)/visit(c2) call would shrink the bounds to just the endpoint pair.
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
    // Each boundary is set by a DIFFERENT one of the first two items, and the third item holds none of the four extremes at all -- so an "always update" bug (ignoring the comparison entirely) would leave the LAST item's own values in place instead of the genuine extremes.
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
    expect(itemScale({ minX: 0, minY: 0, maxX: 10, maxY: 3 })).toBe(3);
    expect(itemScale({ minX: 0, minY: 0, maxX: 2, maxY: 10 })).toBe(2);
  });

  it("computes each extent as a genuine subtraction, not a sum, when the minimum is nonzero", () => {
    // minX(5) is nonzero: maxX - minX = 3 (the smaller extent), but maxX + minX = 13 -- only the subtraction gives the right answer.
    expect(itemScale({ minX: 5, minY: 0, maxX: 8, maxY: 100 })).toBe(3);
  });
});

describe("median", () => {
  it("returns the middle value for an odd-length list", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("mean", () => {
  it("returns 0 for an empty list", () => {
    expect(mean([])).toBe(0);
  });

  it("averages the values", () => {
    expect(mean([2, 4, 6])).toBe(4);
  });
});

describe("regularity", () => {
  it("is trivially 1 for zero or one values", () => {
    expect(regularity([])).toBe(1);
    expect(regularity([5])).toBe(1);
  });

  it("is 1 when the average is 0 because every value genuinely is 0", () => {
    expect(regularity([0, 0, 0])).toBe(1);
  });

  it("is 0 when the average is 0 but the values are not all 0", () => {
    expect(regularity([-1, 1])).toBe(0);
    // At least one value IS 0 here (unlike [-1, 1], where none are) -- distinguishes requiring EVERY value to be 0 from merely SOME value being 0.
    expect(regularity([0, 2, -2])).toBe(0);
  });

  it("computes the coefficient-of-variation-derived score precisely", () => {
    // values [2,4]: mean 3, variance ((2-3)^2+(4-3)^2)/2 = 1, so 1 - sqrt(1)/3.
    expect(regularity([2, 4])).toBeCloseTo(1 - Math.sqrt(1) / 3, 10);
  });
});

describe("groupIntoLines", () => {
  it("clusters items within LINE_TOLERANCE_PT into one line, sorted left to right", () => {
    const a = line(50, 700, "a");
    const b = line(10, 701, "b"); // within tolerance of a (diff 1)
    const lines = groupIntoLines([a, b]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.items.map((item) => (item as LayoutText).text)).toEqual([
      "b",
      "a",
    ]);
  });

  it("clusters at exactly the tolerance boundary, but not one point beyond it", () => {
    const a = line(0, 700, "a");
    const atBoundary = line(0, 698, "b"); // diff exactly 2 (LINE_TOLERANCE_PT)
    expect(groupIntoLines([a, atBoundary])).toHaveLength(1);
    const beyondBoundary = line(0, 697, "c"); // diff 3, past tolerance
    expect(groupIntoLines([a, beyondBoundary])).toHaveLength(2);
  });

  it("sorts lines top to bottom (descending y), matching PDF's upward-increasing y-axis", () => {
    const top = line(0, 700, "top");
    const bottom = line(0, 600, "bottom");
    // Deliberately passed bottom-first, so a broken sort comparator would leave them in input order.
    const lines = groupIntoLines([bottom, top]);
    expect(
      lines.map((textLine) => (textLine.items[0] as LayoutText).text),
    ).toEqual(["top", "bottom"]);
  });

  it("sorts a line's own items left to right AFTER grouping, not merely in grouping (descending-y) order", () => {
    // All three within LINE_TOLERANCE_PT of each other (one line), inserted during grouping in descending-y order (700, 699, 698) -- which, by x, is [50, 10, 30], NOT already ascending. Only a genuine final left-to-right sort produces [10, 30, 50] (p2, p3, p1).
    const p1 = line(50, 700, "p1");
    const p2 = line(10, 699, "p2");
    const p3 = line(30, 698, "p3");
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
    const previous = textItem(0, 10, 10); // ends at xPt(0) + widthPt(10) = 10
    const atThreshold: TextLine = {
      yPt: 0,
      items: [previous, textItem(22, 5, 10)], // gap = 22 - 10 = 12 = CELL_GAP_EM(1.2) * sizePt(10) exactly
    };
    expect(cellsInLine(atThreshold)).toBe(1);
    const beyondThreshold: TextLine = {
      yPt: 0,
      items: [previous, textItem(22.1, 5, 10)],
    };
    expect(cellsInLine(beyondThreshold)).toBe(2);
  });

  it("counts every qualifying internal gap, not just the first", () => {
    const line3: TextLine = {
      yPt: 0,
      items: [textItem(0, 5, 10), textItem(30, 5, 10), textItem(60, 5, 10)],
    };
    expect(cellsInLine(line3)).toBe(3);
  });

  it("skips a position pair where either side is not a text item", () => {
    const nonText: LayoutItem = {
      kind: "image",
      imageId: "i1",
      xPt: 15,
      yPt: 0,
      widthPt: 5,
      heightPt: 5,
    };
    const withNonText: TextLine = {
      yPt: 0,
      items: [textItem(0, 5, 10), nonText, textItem(40, 5, 10)],
    };
    // Neither adjacent pair (text, image) nor (image, text) qualifies -- only a text-to-text pair is ever compared.
    expect(cellsInLine(withNonText)).toBe(1);
  });
});

describe("isRowAlignedGrid", () => {
  it("recognises two bands sharing the same row y-positions as a row-aligned grid", () => {
    const bandA = [boundedText(0, 700), boundedText(0, 680)];
    const bandB = [boundedText(100, 700), boundedText(100, 680)];
    expect(isRowAlignedGrid([bandA, bandB])).toBe(true);
  });

  it("is false when fewer than two bands have at least two lines of their own", () => {
    const bandA = [boundedText(0, 700), boundedText(0, 680)];
    const bandB = [boundedText(100, 700)]; // only one line
    expect(isRowAlignedGrid([bandA, bandB])).toBe(false);
  });

  it("is false when the bands' own row positions do not recur across bands", () => {
    const bandA = [boundedText(0, 700), boundedText(0, 680)];
    const bandB = [boundedText(100, 500), boundedText(100, 480)];
    expect(isRowAlignedGrid([bandA, bandB])).toBe(false);
  });

  it("hits the row-alignment fraction's own inclusive boundary exactly", () => {
    // First band has 5 rows; the second band matches exactly 3 of them (700, 690, 680), a hit fraction of precisely 0.6 (ROW_ALIGNMENT_FRACTION).
    const bandA = [700, 690, 680, 670, 660].map((y) => boundedText(0, y));
    const bandB = [700, 690, 680, 600, 590].map((y) => boundedText(100, y));
    expect(isRowAlignedGrid([bandA, bandB])).toBe(true);
    // One fewer match (2 of 5 = 0.4) must fall below the threshold.
    const bandC = [700, 690, 610, 600, 590].map((y) => boundedText(100, y));
    expect(isRowAlignedGrid([bandA, bandC])).toBe(false);
  });

  it("requires a first-band row to recur in EVERY other qualifying band, not merely one of them", () => {
    // bandB matches all three of first's rows; bandC matches none. Requiring every band to agree correctly finds zero matches; a check that only required some band to agree would wrongly count all three.
    const first = [700, 690, 680].map((y) => boundedText(0, y));
    const bandB = [700, 690, 680].map((y) => boundedText(100, y));
    const bandC = [500, 490].map((y) => boundedText(200, y));
    expect(isRowAlignedGrid([first, bandB, bandC])).toBe(false);
  });

  it("matches a row at exactly LINE_TOLERANCE_PT away, not only a strictly closer one", () => {
    const bandA = [boundedText(0, 700), boundedText(0, 690)];
    // Each row is exactly 2pt (LINE_TOLERANCE_PT) from its bandA counterpart: 702 vs 700, 688 vs 690.
    const bandB = [boundedText(100, 702), boundedText(100, 688)];
    expect(isRowAlignedGrid([bandA, bandB])).toBe(true);
  });
});

describe("findCut", () => {
  it("merges overlapping/touching intervals into one band, splitting only at a genuine gap", () => {
    const items = [
      boundedAt({ minX: 0, maxX: 10, minY: 0, maxY: 10 }),
      boundedAt({ minX: 10, maxX: 20, minY: 0, maxY: 10 }), // touches the first band exactly -- same band
      boundedAt({ minX: 100, maxX: 110, minY: 0, maxY: 10 }), // far past any gap threshold -- new band
    ];
    const cut = findCut(items, "x");
    expect(cut?.groups).toHaveLength(2);
    expect(cut?.groups[0]).toHaveLength(2);
    expect(cut?.groups[1]).toHaveLength(1);
  });

  it("merging a touching item into the running band (not starting a new one) changes the band's own scale, and therefore the next gap's threshold", () => {
    // item1 (scale 100) and item2 (scale 1) touch exactly at x=100 -- correctly merged into ONE band, whose own scale is median([100, 1]) = 50.5, comfortably absorbing the 10pt gap to item3 (threshold 1.5*50.5 = 75.75) so NO cut occurs at all. A boundary weakened from `>` to `>=` would instead start item2 as its OWN band (scale 1), making that band's own gap to item3 use threshold 1.5*1 = 1.5 -- well under the 10pt gap -- and wrongly cut. The two outcomes (no cut at all vs. a genuine cut) are as different as this function's return value can be.
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
      boundedAt({ minX: 5, maxX: 15, minY: 0, maxY: 10 }), // overlapping -- one band only
    ];
    expect(findCut(items, "x")).toBeUndefined();
  });

  it("returns undefined when no gap clears its own local threshold", () => {
    // Two bands with a small gap (2pt) but a large representative scale (100pt tall items) -- GAP_RATIO * 100 comfortably exceeds 2, so this must not cut.
    const items = [
      boundedAt({ minX: 0, maxX: 10, minY: 0, maxY: 100 }),
      boundedAt({ minX: 12, maxX: 22, minY: 0, maxY: 100 }),
    ];
    expect(findCut(items, "x")).toBeUndefined();
  });

  it("rejects a vertical cut that would fragment a row-aligned grid, but still allows the identical shape on the y-axis", () => {
    const bandA = [boundedText(0, 700), boundedText(0, 680)];
    const bandB = [boundedText(100, 700), boundedText(100, 680)];
    const items = [...bandA, ...bandB];
    expect(findCut(items, "x")).toBeUndefined();
  });

  it("tracks the single widest qualifying gap as maxGap, not merely the last or first", () => {
    // Three bands: gaps of 20pt then 50pt (each comfortably clearing the small-item threshold) -- maxGap must be 50, from the SECOND gap, not the first.
    const items = [
      boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 }),
      boundedAt({ minX: 25, maxX: 30, minY: 0, maxY: 5 }), // gap of 20 from the first band
      boundedAt({ minX: 80, maxX: 85, minY: 0, maxY: 5 }), // gap of 50 from the second band
    ];
    const cut = findCut(items, "x");
    expect(cut?.maxGap).toBe(50);
  });

  it("never lets a smaller LATER qualifying gap overwrite an already-tracked wider maxGap", () => {
    // Gaps of 50pt then 20pt, both clearing threshold -- maxGap must stay 50 even though the 20pt gap is processed second.
    const items = [
      boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 }),
      boundedAt({ minX: 55, maxX: 60, minY: 0, maxY: 5 }), // gap of 50 from the first band
      boundedAt({ minX: 80, maxX: 85, minY: 0, maxY: 5 }), // gap of 20 from the second band
    ];
    const cut = findCut(items, "x");
    expect(cut?.maxGap).toBe(50);
  });

  it("cuts at a gap exactly equal to its own local threshold, not only strictly beyond it", () => {
    // Each item has scale 10 (10x10), so the threshold is GAP_RATIO(1.5) * 10 = 15 -- comfortably above the 3pt floor. A gap of exactly 15 must still qualify.
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
    // x-gap (190) is far wider than the y-gap (40) between the same four items -- the vertical (x) cut must win first. Choosing x first visits the low-x band {A,C} before the high-x band {B,D}, and within each visits low-y before high-y, giving reading order [C, A, D, B]; choosing y first (the mutant this proves) would instead visit {C,D} before {A,B}, giving [C, D, A, B] -- same four singleton leaves, different order.
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
    // A symmetric grid where the x-gap and y-gap are both exactly 45 -- ties must resolve to the vertical (x) cut, per the `>=` in the axis-choice comparison. Choosing x first (correct) gives [A, C, B, D]; wrongly falling back to y on a tie would instead give [A, B, C, D].
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
    const A = boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 });
    const B = boundedAt({ minX: 0, maxX: 5, minY: 100, maxY: 105 });
    const C = boundedAt({ minX: 200, maxX: 205, minY: 0, maxY: 5 });
    const D = boundedAt({ minX: 200, maxX: 205, minY: 100, maxY: 105 });
    // Starting one level below MAX_CUT_DEPTH (16): the top-level x-cut (gap 195) is still allowed at depth 15, but the recursive call into each half must land at depth 16 and stop there, leaving {A,B} and {C,D} each as one unsplit leaf even though their own y-gap (95) would otherwise easily clear the cut threshold. A depth computed as `depth - 1` instead of `depth + 1` would never reach the bound, and would keep splitting into four singletons.
    const result = recursiveXYCut([A, B, C, D], 15);
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
    const items = [
      boundedAt({ minX: 0, maxX: 5, minY: 0, maxY: 5 }),
      boundedAt({ minX: 500, maxX: 505, minY: 0, maxY: 5 }),
    ];
    const atDepthLimit = recursiveXYCut(items, 16); // MAX_CUT_DEPTH
    expect(atDepthLimit).toEqual([items]);
  });
});

describe("classifyFromLeafSignals", () => {
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
    const withImage = classifyFromLeafSignals({
      ...baseSignals,
      graphicFraction: 0.5,
      hasImage: true,
    });
    expect(withImage.classification).toBe("figure");
    expect(withImage.confidence).toBeCloseTo(0.65, 10); // 0.5 + 0.15
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
    const signals: LeafSignals = {
      graphicFraction: 0.2, // > 0 and < 0.5, so the grid-graphic bonus applies
      hasImage: false,
      lineCount: 2,
      avgCells: 2, // > 1.15
      cellRegularity: 0.8,
      xStartRegularity: 0,
    };
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("table");
    // 0.5 * clamp01(2-1) + 0.35 * 0.8 + 0.15 (bonus)
    expect(result.confidence).toBeCloseTo(0.5 * 1 + 0.35 * 0.8 + 0.15, 10);
  });

  it("does not apply the grid-graphic bonus outside (0, 0.5)", () => {
    const noGraphic: LeafSignals = {
      graphicFraction: 0,
      hasImage: false,
      lineCount: 2,
      avgCells: 2,
      cellRegularity: 0.8,
      xStartRegularity: 0,
    };
    expect(classifyFromLeafSignals(noGraphic).confidence).toBeCloseTo(
      0.5 * 1 + 0.35 * 0.8,
      10,
    );
    const fullGraphic: LeafSignals = { ...noGraphic, graphicFraction: 0.5 };
    expect(classifyFromLeafSignals(fullGraphic).confidence).toBeCloseTo(
      0.5 * 1 + 0.35 * 0.8,
      10,
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
      avgCells: 1.15, // the boundary itself -- real code must NOT compute tableScore here
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
    const signals: LeafSignals = {
      graphicFraction: 0,
      hasImage: false,
      lineCount: 2,
      avgCells: 1.1,
      cellRegularity: 1,
      xStartRegularity: 0.9,
    };
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("column");
    expect(result.confidence).toBeCloseTo(0.7 * 0.9 + 0.3 * (2 - 1.1), 10);
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
    // With avgCells just over 1.3, columnScore drops to 0; tableScore is 0.5*clamp01(0.301) = 0.1505 with cellRegularity 0, comfortably below SIGNAL_THRESHOLD -- nothing clears it.
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
    // figure = 0.5 (graphicFraction alone); column, with lineCount 0, stays 0 -- so pair figure against column via a genuine two-line signal set instead: table via avgCells, figure via graphic fraction.
    const signals: LeafSignals = {
      graphicFraction: 0.44, // figure score 0.44
      hasImage: false,
      lineCount: 2,
      avgCells: 1.2, // table score below, tuned so the gap is small
      cellRegularity: 1,
      xStartRegularity: 0,
    };
    // tableScore = 0.5*clamp01(0.2) + 0.35*1 + 0 (graphicFraction 0.44 is inside (0,0.5), so bonus applies) = 0.1+0.35+0.15=0.6 figureScore = 0.44 gap = 0.16 -- adjust to land within MIXED_MARGIN (0.15) by nudging avgCells down slightly.
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
    // figureScore = 0.5; tableScore = 0.5*clamp01(0.2)+0.35*0+0 (graphicFraction 0.5 is NOT < 0.5, no bonus) = 0.1 -- below threshold.
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("figure");
  });

  it("never calls it mixed just because the two top scores are close, when the second is genuinely below the signal threshold", () => {
    // figureScore = 0.4 (top); columnScore = 0.7*0 + 0.3*clamp01(2-1) = 0.3 (second) -- only 0.1 apart (comfortably inside MIXED_MARGIN), but 0.3 itself never clears SIGNAL_THRESHOLD (0.35). A ConditionalExpression forcing this check's own signal-threshold gate to always-true would wrongly call this mixed anyway.
    const signals: LeafSignals = {
      graphicFraction: 0.4,
      hasImage: false,
      lineCount: 2,
      avgCells: 1,
      cellRegularity: 0,
      xStartRegularity: 0,
    };
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("figure");
    expect(result.confidence).toBeCloseTo(0.4, 10);
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
    // tableScore = 0.5*clamp01(0.4) + 0.35*0 + 0.15(bonus) = 0.35 exactly -- the SIGNAL_THRESHOLD itself -- with a gap of 0.1 from figure's 0.45, comfortably inside MIXED_MARGIN (0.15). Tightening `>=` to `>` would exclude this exact-boundary case and wrongly call it "figure" instead.
    const result = classifyFromLeafSignals(signals);
    expect(result.classification).toBe("mixed");
    expect(result.confidence).toBeCloseTo(1 - 0.1 / 0.15, 10);
  });

  it("does not call it mixed when the top score sits exactly at the second score plus the mixed margin", () => {
    // Constructed so the comparison's two sides are BIT-IDENTICAL, not merely numerically close: tableScore is set via avgCells alone (cellRegularity 0, graphicFraction >= 0.5 so the grid-graphic bonus never applies), and figureScore (graphicFraction, hasImage false) is a pure pass-through -- multiplying/dividing by 2 is exact for a normal-range double, so doubling secondValue into avgCells's own "-1" term and later halving it back via tableScore's 0.5 weight recovers secondValue exactly (Sterbenz's lemma also guarantees the intervening `avgCells - 1` is computed with no rounding, since avgCells sits within a factor of 2 of 1). figureScore is then set to literally `secondValue + MIXED_MARGIN`, the identical expression classifyFromLeafSignals' own comparison evaluates. See classifyFromLeafSignals' own comment on why the comparison is written as `top < second + MIXED_MARGIN` rather than a gap-based `top - second < MIXED_MARGIN`, which can never be pinned this precisely.
    const secondValue = 0.35;
    const MIXED_MARGIN = 0.15;
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
    expect(result.confidence).toBeCloseTo(topValue, 10);
  });
});

describe("classifyLeaf", () => {
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
    expect(classifyLeaf([imageItem]).confidence).toBe(0.9);
    expect(classifyLeaf([rectItem]).confidence).toBe(0.6);
  });

  it("hits the minimum-items-for-signal boundary exactly", () => {
    // MIN_ITEMS_FOR_SIGNAL is 2: one item is too few (unknown), two is enough to compute real signals.
    expect(classifyLeaf([boundedText(0, 0, "a")]).classification).toBe(
      "unknown",
    );
    const two = [boundedText(0, 700, "a"), boundedText(0, 680, "b")];
    expect(classifyLeaf(two).classification).not.toBe("unknown");
  });

  it("recognises hasImage from any item in the set, not by replacing the whole check", () => {
    // A single text item plus one graphic keeps lineCount at 1 (table/column scoring never activates), so figureScore is the only nonzero score in both cases and the image-specific +0.15 bonus shows up directly in the confidence.
    const withImage: BoundedItem[] = [
      boundedText(0, 700, "a"),
      {
        item: {
          kind: "image",
          imageId: "i1",
          xPt: 100,
          yPt: 700,
          widthPt: 5,
          heightPt: 5,
        },
        bounds: { minX: 100, minY: 700, maxX: 105, maxY: 705 },
      },
    ];
    const withoutImage: BoundedItem[] = [
      boundedText(0, 700, "a"),
      {
        item: { kind: "rect", xPt: 100, yPt: 700, widthPt: 5, heightPt: 5 },
        bounds: { minX: 100, minY: 700, maxX: 105, maxY: 705 },
      },
    ];
    expect(classifyLeaf(withImage)).toEqual({
      classification: "figure",
      confidence: 0.65, // clamp01(0.5 + 0.15)
    });
    expect(classifyLeaf(withoutImage)).toEqual({
      classification: "figure",
      confidence: 0.5,
    });
  });
});

describe("computeLeafSignals", () => {
  it("computes graphicFraction, hasImage, and lineCount from real items", () => {
    const items = [
      boundedText(0, 700, "row one text"),
      boundedText(0, 680, "row two text"),
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
    expect(signals.graphicFraction).toBeCloseTo(1 / 3, 10);
    expect(signals.hasImage).toBe(true);
    expect(signals.lineCount).toBe(2);
  });

  it("leaves avgCells/cellRegularity/xStartRegularity at their trivial defaults when only one line is present", () => {
    const items = [boundedText(0, 700, "a"), boundedText(20, 700, "b")]; // same line
    const signals = computeLeafSignals(items);
    expect(signals.lineCount).toBe(1);
    expect(signals.avgCells).toBe(0);
    expect(signals.cellRegularity).toBe(1);
    expect(signals.xStartRegularity).toBe(1);
  });
});

describe("attachCaptions", () => {
  const figureRegion: PdfRegion = {
    bounds: { xPt: 100, yPt: 400, widthPt: 100, heightPt: 100 },
    items: [],
    classification: "figure",
    confidence: 0.9,
  };

  function textRegion(
    bounds: PdfRegion["bounds"],
    text: string,
    classification: PdfRegion["classification"] = "column",
  ): PdfRegion {
    return {
      bounds,
      items: [{ ...textItem(bounds.xPt, 10), text, yPt: bounds.yPt }],
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
    expect(region).toBe(figureRegion); // unaffected, non-column/unknown region passes through
    const result = attachCaptions([figureRegion, caption])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("does not attach a caption whose own text exceeds the caption length cap", () => {
    const longText = "x".repeat(161);
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
    expect(result.confidence).toBeGreaterThan(0.5);
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
    const twoWordCaption: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        { ...textItem(100, 5), text: "Figure", yPt: 385 },
        { ...textItem(140, 5), text: "1.", yPt: 385 },
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
      "x".repeat(160),
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
    const withGraphic: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        { ...textItem(100, 5), text: "x".repeat(77), yPt: 385 },
        { kind: "rect", xPt: 140, yPt: 385, widthPt: 5, heightPt: 5 },
        { ...textItem(150, 5), text: "x".repeat(77), yPt: 385 },
      ],
      classification: "column",
      confidence: 0.5,
    };
    // Joined length is 77 + 1 + 0 + 1 + 77 = 156 if the rect contributes "" as it should -- comfortably under CAPTION_MAX_CHARS (160). If it instead contributed a placeholder string in its place, the joined length would jump past the cap and this would no longer qualify as a caption.
    const result = attachCaptions([figureRegion, withGraphic])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("trims surrounding whitespace before measuring caption length, not just joining", () => {
    const paddedAtCap = textRegion(
      { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      `  ${"x".repeat(160)}  `, // untrimmed length 164, but trims down to exactly the 160-char cap
    );
    const result = attachCaptions([figureRegion, paddedAtCap])[1]!;
    expect(result.classification).toBe("caption");
  });

  it("counts the space between joined text items toward the caption length cap", () => {
    const longTwoWordCaption: PdfRegion = {
      bounds: { xPt: 100, yPt: 385, widthPt: 100, heightPt: 10 },
      items: [
        { ...textItem(100, 5), text: "a".repeat(80), yPt: 385 },
        { ...textItem(200, 5), text: "a".repeat(80), yPt: 385 },
      ],
      classification: "column",
      confidence: 0.5,
    };
    // Joined with the real " " separator this is 161 characters (80 + 1 + 80), one past CAPTION_MAX_CHARS; joined with no separator at all it would be exactly 160, wrongly still qualifying.
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
    expect(result.confidence).toBeCloseTo(1 - 5 / 24, 10);
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
    // a: yPt 100, height 10 -> spans [100,110]; b: yPt 50, height 20 -> spans [50,70]. a's bottom (100) is above b's top (70) by 30.
    expect(
      verticalGap(
        { xPt: 0, yPt: 100, widthPt: 1, heightPt: 10 },
        { xPt: 0, yPt: 50, widthPt: 1, heightPt: 20 },
      ),
    ).toBe(30);
  });

  it("computes the gap when b sits above a", () => {
    expect(
      verticalGap(
        { xPt: 0, yPt: 50, widthPt: 1, heightPt: 20 },
        { xPt: 0, yPt: 100, widthPt: 1, heightPt: 10 },
      ),
    ).toBe(30);
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
    // a spans [100,110]; b spans [50,100] -- a's bottom (100) exactly equals b's top (100), touching with no overlap and no room between them.
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
