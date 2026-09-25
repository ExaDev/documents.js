import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutText } from "pdf-codec";
import { DEFAULT_BASELINE_TOLERANCE_EM } from "pdf-codec/text-group";
import {
  cellsInLine,
  groupIntoLines,
  isRowAlignedGrid,
  mean,
  median,
  regularity,
  type TextLine,
} from "./pdf-regions";
import {
  BLACK,
  boundedText,
  DEFAULT_LINE_SIZE_PT,
  FONT,
  line,
  PRECISION_DIGITS,
  textItem,
} from "../test-support/pdf-region-fixtures";

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
