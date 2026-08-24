import { bytesToBase64 } from "ooxml.js";
import { describe, expect, it } from "vitest";
import type {
  ContentCellBorders,
  ContentRun,
  ContentTableRow,
} from "document-schema.js";
import type { TextMeasurer } from "document-schema.js";
import { encodePng } from "byte-codec";
import { wrapRunsToWidth } from "./text-layout";
import {
  alignmentOffsetPt,
  effectiveStyledRuns,
  estimateRowHeightPt,
  justifyLineGapsPt,
  lineNaturalHeightPt,
  NOMINAL_TEXT_SIZE_PT,
  pushCellBorderLines,
  registerImage,
  runFont,
  sumColumnWidthsPt,
  toStyledRuns,
} from "./shared";
import type { LayoutImageAsset, LayoutItem, LayoutLine } from "pdf-codec";

const RED = { r: 1, g: 0, b: 0 };

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

function run(text: string, overrides: Partial<ContentRun> = {}): ContentRun {
  return { text, ...overrides };
}

describe("runFont", () => {
  it("maps bold/italic to weight/style, defaulting to normal", () => {
    expect(runFont(run("x"))).toEqual({
      family: "Helvetica",
      weight: "normal",
      style: "normal",
    });
    expect(runFont(run("x", { bold: true, italic: true }))).toEqual({
      family: "Helvetica",
      weight: "bold",
      style: "italic",
    });
  });

  it("uses the run's own fontFamily when present", () => {
    expect(runFont(run("x", { fontFamily: "Georgia" })).family).toBe("Georgia");
  });
});

describe("toStyledRuns", () => {
  it("scales size by fontScale and falls back to black for an unset colour", () => {
    const [styled] = toStyledRuns([run("x", { sizePt: 20 })], 0.5);
    expect(styled?.sizePt).toBe(10);
    expect(styled?.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("defaults fontScale to 1 when omitted", () => {
    const [styled] = toStyledRuns([run("x", { sizePt: 20 })]);
    expect(styled?.sizePt).toBe(20);
  });

  it("substitutes the nominal size for a run with no sizePt of its own", () => {
    const [styled] = toStyledRuns([run("x")]);
    expect(styled?.sizePt).toBe(NOMINAL_TEXT_SIZE_PT);
  });
});

describe("effectiveStyledRuns", () => {
  it("synthesises a single nominal-size run for an empty run list", () => {
    const runs = effectiveStyledRuns([]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe("");
    expect(runs[0]?.sizePt).toBe(NOMINAL_TEXT_SIZE_PT);
  });

  it("applies fontScale to the synthesised fallback too", () => {
    const runs = effectiveStyledRuns([], 0.5);
    expect(runs[0]?.sizePt).toBe(NOMINAL_TEXT_SIZE_PT * 0.5);
  });

  it("passes non-empty runs through toStyledRuns unchanged in count", () => {
    expect(effectiveStyledRuns([run("a"), run("b")])).toHaveLength(2);
  });
});

describe("lineNaturalHeightPt", () => {
  it("takes the max lineHeightAtSize across a line's fragments", () => {
    const measurer = fakeMeasurer();
    const line = {
      fragments: [
        {
          text: "a",
          font: {
            family: "Helvetica",
            weight: "normal",
            style: "normal",
          } as const,
          sizePt: 10,
          color: { r: 0, g: 0, b: 0 },
          xOffsetPt: 0,
        },
        {
          text: "b",
          font: {
            family: "Helvetica",
            weight: "normal",
            style: "normal",
          } as const,
          sizePt: 20,
          color: { r: 0, g: 0, b: 0 },
          xOffsetPt: 1,
        },
      ],
      widthPt: 2,
      maxSizePt: 20,
      ascentPt: 16,
      descentPt: -4,
    };
    expect(
      lineNaturalHeightPt(line, measurer, {
        text: "",
        font: { family: "Helvetica", weight: "normal", style: "normal" },
        sizePt: 10,
        color: { r: 0, g: 0, b: 0 },
      }),
    ).toBe(24); // 20*1.2
  });

  it("falls back to the given fallback run's own height for a fragment-less (empty) line", () => {
    const measurer = fakeMeasurer();
    const emptyLine = {
      fragments: [],
      widthPt: 0,
      maxSizePt: 0,
      ascentPt: 0,
      descentPt: 0,
    };
    const fallback = {
      text: "",
      font: { family: "Helvetica", weight: "normal", style: "normal" } as const,
      sizePt: 10,
      color: { r: 0, g: 0, b: 0 },
    };
    expect(lineNaturalHeightPt(emptyLine, measurer, fallback)).toBe(12); // 10*1.2
  });
});

describe("alignmentOffsetPt", () => {
  it("centers, right-aligns, and defaults to left -- justify's own whole-line offset is 0 too, since its real stretching is a per-fragment concern handled by justifyLineGapsPt, not this function", () => {
    expect(alignmentOffsetPt("center", 100, 20)).toBe(40);
    expect(alignmentOffsetPt("right", 100, 20)).toBe(80);
    expect(alignmentOffsetPt("left", 100, 20)).toBe(0);
    expect(alignmentOffsetPt("justify", 100, 20)).toBe(0);
    expect(alignmentOffsetPt(undefined, 100, 20)).toBe(0);
  });

  it("never returns a negative offset for a line wider than the content area", () => {
    expect(alignmentOffsetPt("center", 10, 20)).toBe(0);
    expect(alignmentOffsetPt("right", 10, 20)).toBe(0);
  });
});

describe("justifyLineGapsPt", () => {
  const font = {
    family: "Helvetica",
    weight: "normal",
    style: "normal",
  } as const;
  const color = { r: 0, g: 0, b: 0 };

  it("distributes slack evenly across every inter-word gap, leaving the first fragment unshifted and each later one offset by its own share of every gap before it", () => {
    const measurer = fakeMeasurer();
    const [line] = wrapRunsToWidth(
      [{ text: "aa bb cc", font, sizePt: 10, color }],
      measurer,
      Number.POSITIVE_INFINITY,
    );
    // Natural layout: aa@0 (w2), bb@3 (w2), cc@6 (w2) -- natural width 8. Target 14 -> 6pt of slack across 2 gaps -> 3pt each.
    expect(justifyLineGapsPt(line!, 14, measurer)).toEqual([0, 3, 6]);
  });

  it("never shifts anything on a single-word line -- there is no gap to distribute slack across", () => {
    const measurer = fakeMeasurer();
    const [line] = wrapRunsToWidth(
      [{ text: "aaaa", font, sizePt: 10, color }],
      measurer,
      Number.POSITIVE_INFINITY,
    );
    expect(justifyLineGapsPt(line!, 20, measurer)).toEqual([0]);
  });

  it("never shifts anything when the line's own natural width already meets or exceeds the target -- this function only ever adds space, never compresses", () => {
    const measurer = fakeMeasurer();
    const [line] = wrapRunsToWidth(
      [{ text: "aa bb", font, sizePt: 10, color }],
      measurer,
      Number.POSITIVE_INFINITY,
    );
    expect(justifyLineGapsPt(line!, 5, measurer)).toEqual([0, 0]); // natural width is already exactly 5
  });

  it("treats two fragments of one run-split word (no space between them) as ungapped, not stretching between them", () => {
    const measurer = fakeMeasurer();
    // A word split across a run boundary (bold change mid-word) stays one unbreakable box atom with two touching fragments and zero gap -- see text-layout.ts's own atomizeRuns.
    const [line] = wrapRunsToWidth(
      [
        { text: "ab", font, sizePt: 10, color },
        { text: "cd", font: { ...font, weight: "bold" }, sizePt: 10, color },
      ],
      measurer,
      Number.POSITIVE_INFINITY,
    );
    expect(justifyLineGapsPt(line!, 20, measurer)).toEqual([0, 0]);
  });
});

describe("registerImage", () => {
  function tinyPngBlock() {
    const bytes = encodePng({
      width: 2,
      height: 2,
      channels: 3,
      data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
    });
    return {
      kind: "image" as const,
      format: "png" as const,
      base64: bytesToBase64(bytes),
      widthPt: 10,
      heightPt: 10,
    };
  }

  it("registers a new image and returns a stable, deterministic id for identical content", () => {
    const images: Record<string, LayoutImageAsset> = {};
    const block = tinyPngBlock();
    const id1 = registerImage(block, images);
    const id2 = registerImage(block, images);
    expect(id1).toBe(id2);
    expect(Object.keys(images)).toHaveLength(1);
    expect(images[id1]?.widthPx).toBe(2);
    expect(images[id1]?.heightPx).toBe(2);
  });
});

describe("sumColumnWidthsPt", () => {
  it("sums a span of columns starting at an index", () => {
    expect(sumColumnWidthsPt([10, 20, 30, 40], 1, 2)).toBe(50);
  });

  it("clamps to the array bounds rather than reading past the end", () => {
    expect(sumColumnWidthsPt([10, 20], 1, 5)).toBe(20);
  });
});

describe("estimateRowHeightPt", () => {
  it("falls back to a nominal minimum for an empty row", () => {
    const measurer = fakeMeasurer();
    const row: ContentTableRow = { cells: [{ blocks: [] }] };
    expect(estimateRowHeightPt(row, measurer, [100], 1)).toBeGreaterThan(0);
  });

  it("grows to fit the tallest wrapped line across all cells", () => {
    const measurer = fakeMeasurer();
    const row: ContentTableRow = {
      cells: [
        { blocks: [{ kind: "paragraph", runs: [run("hi", { sizePt: 100 })] }] },
      ],
    };
    const height = estimateRowHeightPt(row, measurer, [100], 1);
    expect(height).toBeCloseTo(100 * 1.2, 6); // lineHeightAtSize(100) via the fake measurer
  });
});

function isLine(item: LayoutItem): item is LayoutLine {
  return item.kind === "line";
}

describe("pushCellBorderLines", () => {
  it("carries a declared border's own dash style through onto the emitted LayoutLine, as of document-schema.js 2.1.0 adding that field to LayoutLineSchema", () => {
    const borders: ContentCellBorders = {
      top: { color: RED, widthPt: 2, style: "dashed" },
    };
    const out: LayoutItem[] = [];
    pushCellBorderLines(
      borders,
      { xPt: 0, yPt: 0, widthPt: 50, heightPt: 20 },
      800,
      undefined,
      out,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "line",
      style: "dashed",
      color: RED,
      widthPt: 2,
    });
  });

  it("leaves style undefined for a border that never declared one, rather than defaulting it to 'solid'", () => {
    const borders: ContentCellBorders = { left: { color: RED, widthPt: 1 } };
    const out: LayoutItem[] = [];
    pushCellBorderLines(
      borders,
      { xPt: 0, yPt: 0, widthPt: 50, heightPt: 20 },
      800,
      undefined,
      out,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "line", color: RED, widthPt: 1 });
    const [line] = out.filter(isLine);
    expect(line?.style).toBeUndefined();
  });

  it("carries each edge's own distinct style independently -- a mix of dotted/double/solid on one cell does not collapse to one shared style", () => {
    const borders: ContentCellBorders = {
      top: { color: RED, widthPt: 1, style: "dotted" },
      right: { color: RED, widthPt: 1, style: "double" },
      bottom: { color: RED, widthPt: 1 },
    };
    const out: LayoutItem[] = [];
    pushCellBorderLines(
      borders,
      { xPt: 0, yPt: 0, widthPt: 50, heightPt: 20 },
      800,
      undefined,
      out,
    );
    const styles = out.filter(isLine).map((item) => item.style);
    // Emission order is top, bottom, left, right (pushCellBorderLines' own fixed edge order); left was never declared, so only top/bottom/right appear, in that order.
    expect(styles).toEqual(["dotted", undefined, "double"]);
  });
});
