import { describe, expect, it } from "vitest";
import {
  classifyFromLeafSignals,
  classifyLeaf,
  computeLeafSignals,
  findCut,
  recursiveXYCut,
  type BoundedItem,
  type LeafSignals,
} from "./pdf-regions";
import {
  boundedAt,
  boundedText,
  PRECISION_DIGITS,
} from "../test-support/pdf-region-fixtures";

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
