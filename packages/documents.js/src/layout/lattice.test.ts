import { describe, expect, it } from "vitest";
import type { LayoutItem, LayoutPath, LayoutRect } from "pdf-codec";
import {
  detectGridLattice,
  extractLineCandidates,
  findCellRegions,
  findColumnIndex,
  findRowIndex,
} from "./lattice";

const BLACK = { r: 0, g: 0, b: 0 };

function rect(overrides: {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}): LayoutRect {
  return { kind: "rect", fill: BLACK, ...overrides };
}

function line(x1Pt: number, y1Pt: number, x2Pt: number, y2Pt: number) {
  return {
    kind: "line" as const,
    x1Pt,
    y1Pt,
    x2Pt,
    y2Pt,
    color: BLACK,
    widthPt: 1,
  };
}

// A real-world publisher pattern several production PDFs use to draw a table's gridlines: a thin filled rectangle (fill only, no stroke) rather than a genuinely stroked LayoutLine/LayoutPath — confirmed directly against real documents, where every observed gridline rect measured 0.12-2.30pt thick on its short axis. extractLineCandidates must recognise this shape alongside the line/path shapes it already accepts.
describe("extractLineCandidates: thin filled rects as drawn gridlines", () => {
  it("reads a wide, thin rect as a horizontal line segment along its long axis", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 10, yPt: 99.75, widthPt: 200, heightPt: 0.5 }),
    ];
    expect(extractLineCandidates(items)).toEqual([
      { item: items[0], x1Pt: 10, y1Pt: 100, x2Pt: 210, y2Pt: 100 },
    ]);
  });

  it("reads a tall, thin rect as a vertical line segment along its long axis", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 49.75, yPt: 5, widthPt: 0.5, heightPt: 150 }),
    ];
    expect(extractLineCandidates(items)).toEqual([
      { item: items[0], x1Pt: 50, y1Pt: 5, x2Pt: 50, y2Pt: 155 },
    ]);
  });

  it("ignores a rect that is thin on neither axis (a genuine filled block, a cell shading/background)", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 100, heightPt: 40 }),
    ];
    expect(extractLineCandidates(items)).toEqual([]);
  });

  it("ignores a small square rect (thin on neither axis relative to the other — a corner-joint artefact, not a line)", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 0.72, heightPt: 0.72 }),
    ];
    expect(extractLineCandidates(items)).toEqual([]);
  });

  it("still requires the resulting segment to clear the existing minimum-length threshold once classified (extractLineCandidates itself does not filter by length, classifyAxisLine does)", () => {
    // A thin-but-short rect produces a candidate segment here; detectGridLattice below (which runs classification + the length threshold) is what actually rejects it — this test documents that division of responsibility rather than duplicating the length check in extractLineCandidates.
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 2, heightPt: 0.5 }),
    ];
    expect(extractLineCandidates(items)).toHaveLength(1);
  });
});

describe("detectGridLattice: rect-drawn lattices", () => {
  function rectLatticeItems(): LayoutItem[] {
    const THICKNESS = 0.5;
    return [
      rect({
        xPt: 0,
        yPt: 200 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
      }),
      rect({
        xPt: 0,
        yPt: 150 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
      }),
      rect({
        xPt: 0,
        yPt: 100 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
      }),
      rect({
        xPt: 0 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
      }),
      rect({
        xPt: 120 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
      }),
      rect({
        xPt: 300 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
      }),
    ];
  }

  it("detects a full lattice drawn entirely as thin filled rects", () => {
    const lattice = detectGridLattice(rectLatticeItems());
    expect(lattice?.rowBoundariesDescPt).toEqual([200, 150, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 120, 300]);
  });

  it("does not detect a lattice from a couple of large filled cells alone (no thin rects at all)", () => {
    const items: LayoutItem[] = [
      rect({ xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }),
      rect({ xPt: 100, yPt: 0, widthPt: 100, heightPt: 100 }),
    ];
    expect(detectGridLattice(items)).toBeUndefined();
  });
});

// ExaDev/documents.js#1077: detectGridLattice used to dedupe every line candidate on the WHOLE page into one shared rowLines/columnLines set before testing closure, so a rule that had nothing to do with the real table — drawn anywhere else on the page — could still corrupt the one outer-rectangle test the whole page shared. Clustering first (segmentsCross/clusterSegments) fixes this by testing closure per connected component instead: a candidate line only joins the real table's cluster if it actually crosses one of the table's own perpendicular lines.
describe("detectGridLattice: clustering keeps unrelated page furniture out of the real table's outer rectangle (ExaDev/documents.js#1077)", () => {
  // A real 3x3 (row x column) lattice, geometrically identical to rectLatticeItems() above but drawn as genuine LayoutLines.
  function tableLines() {
    return [
      line(0, 200, 300, 200),
      line(0, 150, 300, 150),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
    ];
  }

  it("ignores a page-wide header rule and footer rule that never reach any of the table's own column lines", () => {
    const items: LayoutItem[] = [
      ...tableLines(),
      line(0, 240, 300, 240), // header rule, full page width, well above the table
      line(0, 20, 300, 20), // footer rule, full page width, well below the table
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([200, 150, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 120, 300]);
  });

  it("ignores a caption underline sitting just above the table's own top edge", () => {
    const items: LayoutItem[] = [
      ...tableLines(),
      line(90, 214, 170, 214), // a caption's own underline, narrower than the table and 14pt above its real top edge
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([200, 150, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 120, 300]);
  });
});

// ExaDev/documents.js#1077: a border interrupted by one real gap (a single row whose own side rule a producer never drew) is still overwhelmingly a drawn boundary. The old bestRunCoverageRatio scored an edge by its longest unbroken run alone, so a border ~97% drawn but interrupted once by a small gap scored under 50% and failed EDGE_COVERAGE_RATIO; unionCoverageRatio sums every drawn range instead.
describe("detectGridLattice: a border interrupted by one small gap still closes the rectangle (ExaDev/documents.js#1077)", () => {
  it("detects the lattice when the left column is drawn as two segments with a small real gap between them", () => {
    const items: LayoutItem[] = [
      line(0, 300, 300, 300), // top row divider, fully drawn
      line(0, 200, 300, 200), // interior row divider, fully drawn
      line(0, 100, 300, 100), // bottom row divider, fully drawn
      line(0, 100, 0, 197), // left column, lower segment
      line(0, 203, 0, 300), // left column, upper segment — 6pt gap out of a 200pt span (97% union coverage, ~48.5% best-run)
      line(150, 100, 150, 300), // interior column divider, fully drawn
      line(300, 100, 300, 300), // right column, fully drawn
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([300, 200, 100]);
    expect(lattice?.columnBoundariesAscPt).toEqual([0, 150, 300]);
  });
});

// A real NGED specification's page (novus-power/hive#1397) crashed pdfToMarkdown with "Maximum call stack size exceeded" — not from recursion, but from Math.min(...cells.map(...))/Math.max(...cells.map(...)) spreading a merged region's cell list into a function call, which throws once the array exceeds the JS engine's own argument-count limit (V8's is roughly 65536-125000 depending on version). A page whose line detection turns up a dense or malformed grid can merge tens of thousands of atomic cells into one region with no drawn boundary between them.
describe("findCellRegions: a merged region far larger than the JS engine's argument-count limit", () => {
  it("computes the region's bounds without spreading the cell list into Math.min/max", () => {
    const rowCount = 200_000;
    // Two columns, kept apart by one fully-drawn divider at position 1; every one of the 200,000 interior row dividers is undrawn, so each column merges top-to-bottom into a single region of 200,000 cells — two regions, each far past the argument-count limit a naive Math.min(...cells) would hit. Every line needs its own distinct position: two dividers sharing a position give unionCoverageRatio a zero-length span, which it treats as fully covered regardless of ranges.
    const rowLines = Array.from({ length: rowCount + 1 }, (_, i) => ({
      position: i,
      ranges: [],
      items: [],
    }));
    const columnLines = [
      { position: 0, ranges: [], items: [] },
      { position: 1, ranges: [{ startPt: -1e12, endPt: 1e12 }], items: [] },
      { position: 2, ranges: [], items: [] },
    ];

    const regions = findCellRegions(rowLines, columnLines);

    expect(regions).toEqual([
      { rowStart: 0, rowEnd: rowCount, colStart: 0, colEnd: 1 },
      { rowStart: 0, rowEnd: rowCount, colStart: 1, colEnd: 2 },
    ]);
    // Builds and reconciles 200,000 synthetic row dividers, which is genuine work even though it completes in well under a second uncontended — under Stryker's per-statement instrumentation plus heavy concurrent host load it has measured a 5000ms-plus wall clock, the same "wall-clock dominated by scheduling, not this test's own CPU work" shape documented for read-graph.test.ts's docxToPdf timeout (ExaDev/documents.js#1039) and its sibling ODS mergeCells test (ExaDev/documents.js#1037).
  }, 60_000);
});

function stroke() {
  return { color: BLACK, widthPt: 1 };
}

function strokeLinePath(
  x1Pt: number,
  y1Pt: number,
  x2Pt: number,
  y2Pt: number,
): LayoutPath {
  return {
    kind: "path",
    subpaths: [
      {
        startXPt: x1Pt,
        startYPt: y1Pt,
        segments: [{ kind: "line", xPt: x2Pt, yPt: y2Pt }],
        closed: false,
      },
    ],
    stroke: stroke(),
  };
}

// A full 2x2 grid: rows at y = 30, 20, 10 (PDF y descending), columns at x = 10, 20, 30.
function fullGrid(): LayoutItem[] {
  return [
    line(10, 30, 30, 30),
    line(10, 20, 30, 20),
    line(10, 10, 30, 10),
    line(10, 10, 10, 30),
    line(20, 10, 20, 30),
    line(30, 10, 30, 30),
  ];
}

describe("extractLineCandidates: stroked single-line paths", () => {
  it("reads a single-line stroked subpath as a segment from its moveto to the line endpoint", () => {
    const items: LayoutItem[] = [strokeLinePath(5, 7, 25, 7)];
    expect(extractLineCandidates(items)).toEqual([
      { item: items[0], x1Pt: 5, y1Pt: 7, x2Pt: 25, y2Pt: 7 },
    ]);
  });

  it("ignores a path with two segments in one subpath", () => {
    const twoSegment: LayoutItem[] = [
      {
        kind: "path",
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            segments: [
              { kind: "line", xPt: 10, yPt: 0 },
              { kind: "line", xPt: 10, yPt: 10 },
            ],
            closed: false,
          },
        ],
        stroke: stroke(),
      },
    ];
    expect(extractLineCandidates(twoSegment)).toEqual([]);
  });

  it("ignores an unstroked path and a cubic-segment path", () => {
    const unstroked: LayoutItem[] = [
      {
        kind: "path",
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            segments: [{ kind: "line", xPt: 10, yPt: 0 }],
            closed: false,
          },
        ],
      },
    ];
    const cubic: LayoutItem[] = [
      {
        kind: "path",
        subpaths: [
          {
            startXPt: 0,
            startYPt: 0,
            segments: [
              {
                kind: "cubic",
                c1xPt: 1,
                c1yPt: 1,
                c2xPt: 2,
                c2yPt: 2,
                xPt: 10,
                yPt: 0,
              },
            ],
            closed: false,
          },
        ],
        stroke: stroke(),
      },
    ];
    expect(extractLineCandidates(unstroked)).toEqual([]);
    expect(extractLineCandidates(cubic)).toEqual([]);
  });

  it("accepts a thin rect at exactly the 3pt tolerance and rejects one just past it", () => {
    const atLimit = extractLineCandidates([
      rect({ xPt: 0, yPt: 50, widthPt: 100, heightPt: 3 }),
    ]);
    expect(atLimit).toHaveLength(1);
    const pastLimit = extractLineCandidates([
      rect({ xPt: 0, yPt: 50, widthPt: 100, heightPt: 3.01 }),
    ]);
    expect(pastLimit).toEqual([]);
  });
});

describe("classifyAxisLine tolerance boundaries (through detectGridLattice)", () => {
  it("accepts a row boundary whose endpoints differ by exactly 0.5pt and rejects 0.6pt", () => {
    const skewAccepted = fullGrid().map((item, i) =>
      i === 0 ? line(10, 30, 30, 30.5) : item,
    );
    expect(detectGridLattice(skewAccepted)).toBeDefined();
    const skewRejected = fullGrid().map((item, i) =>
      i === 0 ? line(10, 30, 30, 30.6) : item,
    );
    expect(detectGridLattice(skewRejected)).toBeUndefined();
  });

  it("accepts a middle boundary exactly 4pt long and rejects 3.9pt (the minimum-length gate)", () => {
    // The middle row drawn as one 4pt stroke still classifies (4 >= 4), so
    // three row boundaries exist; its coverage of each column is far under
    // 0.9, so both columns merge vertically into two clean regions. At 3.9pt
    // the stroke is dropped entirely and only two row boundaries remain,
    // under the per-axis minimum.
    const withMiddle = (length: number): LayoutItem[] => [
      line(10, 30, 30, 30),
      line(10, 20, 10 + length, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 30),
      line(30, 10, 30, 30),
    ];
    expect(detectGridLattice(withMiddle(4))?.regions).toEqual([
      { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 1 },
      { rowStart: 0, rowEnd: 2, colStart: 1, colEnd: 2 },
    ]);
    expect(detectGridLattice(withMiddle(3.9))).toBeUndefined();
  });

  it("normalises reversed endpoint order into startPt <= endPt", () => {
    // The top row drawn right-to-left still yields the same lattice.
    const reversed = fullGrid().map((item, i) =>
      i === 0 ? line(30, 30, 10, 30) : item,
    );
    const lattice = detectGridLattice(reversed);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });

  it("ignores a genuinely diagonal line", () => {
    const withDiagonal = [...fullGrid(), line(40, 40, 60, 60)];
    const lattice = detectGridLattice(withDiagonal);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
    expect(lattice).toBeDefined();
  });
});

describe("dedupeAxisLines and mergedRanges (through detectGridLattice)", () => {
  it("collapses two boundaries 0.4pt apart into one and keeps two 0.6pt apart apart", () => {
    const near = fullGrid().map((item, i) =>
      i === 1 ? line(10, 20.4, 30, 20.4) : item,
    );
    expect(detectGridLattice(near)?.rowBoundariesDescPt).toEqual([
      30, 20.4, 10,
    ]);
    const far = [...fullGrid(), line(10, 20.6, 30, 20.6)];
    // 20.6 sits 0.6pt from the 20 boundary, past the tolerance, so both
    // survive as distinct row boundaries and the lattice gains a row.
    expect(detectGridLattice(far)?.rowBoundariesDescPt).toEqual([
      30, 20.6, 20, 10,
    ]);
  });

  it("merges two collinear segments whose gap is exactly the touch tolerance", () => {
    // The bottom row is drawn as two strokes with a 0.5pt gap: the merged
    // range spans the full width, so the outer rectangle closes.
    const gapped = fullGrid().map((item, i) =>
      i === 2 ? line(10, 10, 19.75, 10) : item,
    );
    gapped.push(line(20.25, 10, 30, 10));
    expect(detectGridLattice(gapped)).toBeDefined();
  });

  it("keeps a real gap: two strokes each covering 40% of an edge fail the 0.9 ratio", () => {
    const gapped = fullGrid().map((item, i) =>
      i === 2 ? line(10, 10, 18, 10) : item,
    );
    gapped.push(line(22, 10, 30, 10));
    expect(detectGridLattice(gapped)).toBeUndefined();
  });
});

describe("unionCoverageRatio boundaries (through detectGridLattice)", () => {
  it("accepts an outer edge drawn to exactly 90% and rejects 89%", () => {
    const atLimit = fullGrid().map((item, i) =>
      i === 3 ? line(10, 12, 10, 30) : item,
    );
    // The left column spans y 10..30 (20pt); starting at 12 covers 18/20 = 0.9.
    expect(detectGridLattice(atLimit)).toBeDefined();
    const under = fullGrid().map((item, i) =>
      i === 3 ? line(10, 12.3, 10, 30) : item,
    );
    expect(detectGridLattice(under)).toBeUndefined();
  });
});

describe("findCellRegions merged cells", () => {
  it("merges two cells horizontally when the dividing column covers under 90% of their row", () => {
    // The middle column is drawn everywhere except the top row's own height:
    // cells (0,0) and (0,1) become one colSpan region.
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 30, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 20),
      line(30, 10, 30, 30),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.regions).toEqual([
      { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 2 },
      { rowStart: 1, rowEnd: 2, colStart: 0, colEnd: 1 },
      { rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 },
    ]);
  });

  it("merges two cells vertically when the dividing row covers under 90% of their column", () => {
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 20, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 30),
      line(30, 10, 30, 30),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.regions).toEqual([
      { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 },
      { rowStart: 0, rowEnd: 2, colStart: 1, colEnd: 2 },
      { rowStart: 1, rowEnd: 2, colStart: 0, colEnd: 1 },
    ]);
  });

  it("rejects the whole lattice when the undrawn dividers leave a non-rectangular region", () => {
    // The middle column is drawn only over the bottom row, so (0,0) and
    // (0,1) merge across; the middle row is drawn only over the left column,
    // so (0,1) and (1,1) merge down. The union {(0,0), (0,1), (1,1)} is
    // L-shaped, which no table cell can express, and the whole lattice is
    // refused rather than guessed at.
    const lShaped = [
      line(10, 30, 30, 30),
      line(10, 20, 20, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 20),
      line(30, 10, 30, 30),
    ];
    expect(detectGridLattice(lShaped)).toBeUndefined();
  });

  it("rejects a lattice whose every interior divider is undrawn", () => {
    // Only the outer rectangle is drawn: one region, no internal structure.
    const items = [
      line(10, 30, 30, 30),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(30, 10, 30, 30),
    ];
    expect(detectGridLattice(items)).toBeUndefined();
  });
});

describe("detectGridLattice cluster selection", () => {
  it("keeps the larger of two disjoint valid lattices", () => {
    const small = [
      line(100, 140, 120, 140),
      line(100, 130, 120, 130),
      line(100, 120, 120, 120),
      line(100, 120, 100, 140),
      line(110, 120, 110, 140),
      line(120, 120, 120, 140),
    ];
    const items = [...fullGrid(), ...small];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });

  it("collects every contributing item into sourceItems", () => {
    const items = fullGrid();
    const lattice = detectGridLattice(items);
    expect(lattice?.sourceItems.size).toBe(6);
  });

  it("requires at least three boundaries per axis", () => {
    const twoByTwo = [
      line(10, 30, 30, 30),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(30, 10, 30, 30),
    ].concat([line(20, 10, 20, 30), line(10, 20, 30, 20)]);
    expect(detectGridLattice(twoByTwo.slice(0, 4))).toBeUndefined();
    expect(detectGridLattice(twoByTwo)).toBeDefined();
  });
});

describe("findRowIndex / findColumnIndex", () => {
  const rows = [30, 20, 10];
  const cols = [10, 20, 30];

  it("returns undefined outside the outer 3pt tolerance and accepts exactly at it", () => {
    expect(findRowIndex(rows, 33.01)).toBeUndefined();
    expect(findRowIndex(rows, 33)).toBe(0);
    expect(findRowIndex(rows, 6.99)).toBeUndefined();
    expect(findRowIndex(rows, 7)).toBe(1);
    expect(findColumnIndex(cols, 6.99)).toBeUndefined();
    expect(findColumnIndex(cols, 7)).toBe(0);
    expect(findColumnIndex(cols, 33.01)).toBeUndefined();
    expect(findColumnIndex(cols, 33)).toBe(1);
  });

  it("partitions interior boundaries half-open: a value exactly on a boundary belongs to the band below it (rows) or left of it (columns)", () => {
    expect(findRowIndex(rows, 30)).toBe(0);
    expect(findRowIndex(rows, 29.99)).toBe(0);
    expect(findRowIndex(rows, 20)).toBe(1);
    expect(findRowIndex(rows, 20.01)).toBe(0);
    expect(findRowIndex(rows, 10)).toBe(1);
    expect(findRowIndex(rows, 12)).toBe(1);
    expect(findColumnIndex(cols, 10)).toBe(0);
    expect(findColumnIndex(cols, 19.99)).toBe(0);
    expect(findColumnIndex(cols, 20)).toBe(1);
    expect(findColumnIndex(cols, 30)).toBe(1);
  });

  it("a value past the last interior boundary but within the outer tolerance lands in the last band", () => {
    expect(findRowIndex(rows, 8)).toBe(1);
    expect(findColumnIndex(cols, 32)).toBe(1);
  });
});

describe("classifyAxisLine precedence and boundaries, round two", () => {
  it("a short diagonal (under the length gate on both axes) contributes nothing", () => {
    const items = [...fullGrid(), line(15, 15, 16.5, 16.5)];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
  });

  it("a long diagonal contributes nothing even though its span clears the length gate", () => {
    const items = [...fullGrid(), line(14, 10, 24, 30)];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });

  it("a vertical line whose x drifts by exactly the alignment tolerance still classifies", () => {
    const items = [...fullGrid(), line(15, 10, 15.5, 30)];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 15.25, 20, 30]);
  });

  it("a vertical line only 2pt long contributes nothing", () => {
    const items = [...fullGrid(), line(15, 10, 15, 12)];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });

  it("a vertical line exactly 4pt long classifies (the minimum-length gate is inclusive)", () => {
    const items = [...fullGrid(), line(15, 10, 15, 14)];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 15, 20, 30]);
  });

  it("a path with two subpaths contributes nothing even when the first is a clean line", () => {
    const items: LayoutItem[] = [
      ...fullGrid(),
      {
        kind: "path",
        subpaths: [
          {
            startXPt: 25,
            startYPt: 10,
            segments: [{ kind: "line", xPt: 25, yPt: 30 }],
            closed: false,
          },
          {
            startXPt: 40,
            startYPt: 10,
            segments: [{ kind: "line", xPt: 40, yPt: 30 }],
            closed: false,
          },
        ],
        stroke: stroke(),
      },
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });
});

describe("mergedRanges ordering", () => {
  it("merges two overlapping collinear segments presented in descending order", () => {
    // The later-drawn stroke starts LEFT of the earlier one: the sort by
    // startPt is what makes the merge see [10..25, 20..30] and fuse them
    // into one full-width boundary.
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 30, 20),
      line(20, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 30),
      line(30, 10, 30, 30),
      line(10, 10, 25, 10),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice).toBeDefined();
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
  });
});

describe("dedupeAxisLines at exactly the position tolerance", () => {
  it("two boundaries exactly 0.5pt apart collapse into one", () => {
    const items = [...fullGrid(), line(10, 20.5, 30, 20.5)];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20.5, 10]);
  });
});

describe("hasClosedOuterRectangle: every edge independently", () => {
  it("accepts each outer edge drawn to exactly 90% (top row, bottom row, right column)", () => {
    const topAtLimit = fullGrid().map((item, i) =>
      i === 0 ? line(10, 30, 28, 30) : item,
    );
    expect(detectGridLattice(topAtLimit)).toBeDefined();
    const bottomAtLimit = fullGrid().map((item, i) =>
      i === 2 ? line(12, 10, 30, 10) : item,
    );
    expect(detectGridLattice(bottomAtLimit)).toBeDefined();
    const rightAtLimit = fullGrid().map((item, i) =>
      i === 5 ? line(30, 12, 30, 30) : item,
    );
    expect(detectGridLattice(rightAtLimit)).toBeDefined();
  });

  it("rejects an under-drawn top row, bottom row, or right column", () => {
    const topUnder = fullGrid().map((item, i) =>
      i === 0 ? line(10, 30, 18, 30) : item,
    );
    topUnder.push(line(22, 30, 30, 30));
    expect(detectGridLattice(topUnder)).toBeUndefined();
    const bottomUnder = fullGrid().map((item, i) =>
      i === 2 ? line(10, 10, 18, 10) : item,
    );
    bottomUnder.push(line(22, 10, 30, 10));
    expect(detectGridLattice(bottomUnder)).toBeUndefined();
    const rightUnder = fullGrid().map((item, i) =>
      i === 5 ? line(30, 12.3, 30, 30) : item,
    );
    expect(detectGridLattice(rightUnder)).toBeUndefined();
  });
});

describe("findCellRegions divider coverage boundary", () => {
  it("an interior divider covering exactly 90% of a row keeps the cells separate", () => {
    // The middle column is drawn over the full bottom row (y 10..20) but
    // only y 20..29 of the top row's 20..30 span: 9/10 = 0.9, which is not
    // under the ratio, so no merge happens and all four cells stay atomic.
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 30, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 29),
      line(30, 10, 30, 30),
    ];
    expect(detectGridLattice(items)?.regions).toEqual([
      { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 },
      { rowStart: 0, rowEnd: 1, colStart: 1, colEnd: 2 },
      { rowStart: 1, rowEnd: 2, colStart: 0, colEnd: 1 },
      { rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 },
    ]);
  });

  it("an interior horizontal divider covering exactly 90% of a column keeps the cells separate", () => {
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 29, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 30),
      line(30, 10, 30, 30),
    ];
    expect(detectGridLattice(items)?.regions).toEqual([
      { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 },
      { rowStart: 0, rowEnd: 1, colStart: 1, colEnd: 2 },
      { rowStart: 1, rowEnd: 2, colStart: 0, colEnd: 1 },
      { rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 },
    ]);
  });
});

describe("segmentsCross at exactly the crossing tolerance", () => {
  it("a left column 0.5pt left of the rows' own start still joins the grid", () => {
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 30, 20),
      line(10, 10, 30, 10),
      line(9.5, 10, 9.5, 30),
      line(20, 10, 20, 30),
      line(30, 10, 30, 30),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([9.5, 20, 30]);
  });

  it("a right column 0.5pt right of the rows' own end still joins the grid", () => {
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 30, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 30),
      line(30.5, 10, 30.5, 30),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30.5]);
  });

  it("a vertical line far to the right of the grid never joins it", () => {
    const items = [...fullGrid(), line(100, 10, 100, 30)];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });
});

describe("detectGridLattice axis assignment and cluster order", () => {
  it("assigns rows and columns from the segment orientations, not swapped, on an asymmetric grid", () => {
    const items = [
      line(10, 40, 60, 40),
      line(10, 20, 60, 20),
      line(10, 10, 60, 10),
      line(10, 10, 10, 40),
      line(20, 10, 20, 40),
      line(60, 10, 60, 40),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([40, 20, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 60]);
  });

  it("three rows but only two columns is not a lattice", () => {
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 30, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(30, 10, 30, 30),
    ];
    expect(detectGridLattice(items)).toBeUndefined();
  });

  it("a larger lattice arriving second still wins (distinct areas, small first)", () => {
    const small = [
      line(100, 135, 110, 135),
      line(100, 127.5, 110, 127.5),
      line(100, 120, 110, 120),
      line(100, 120, 100, 135),
      line(105, 120, 105, 135),
      line(110, 120, 110, 135),
    ];
    const items = [...small, ...fullGrid()];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });
});

describe("segmentsCross lower-bound and vertical-extent boundaries", () => {
  it("a vertical line 0.5pt or more left of the rows' own start never joins", () => {
    // At exactly 4.5pt left the first operand is already false; a line at
    // x = 5 must not be pulled in by the x-upper-bound alone.
    const items = [...fullGrid(), line(5, 10, 5, 30)];
    const lattice = detectGridLattice(items);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });

  it("a top row 0.5pt above the columns' own top still joins (the inclusive upper bound)", () => {
    const items = [
      line(10, 30.5, 30, 30.5),
      line(10, 20, 30, 20),
      line(10, 10, 30, 10),
      line(10, 10, 10, 30),
      line(20, 10, 20, 30),
      line(30, 10, 30, 30),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([30.5, 20, 10]);
  });

  it("a bottom row 0.5pt below the columns' own bottom still joins (the inclusive lower bound)", () => {
    const items = [
      line(10, 30, 30, 30),
      line(10, 20, 30, 20),
      line(10, 9.5, 30, 9.5),
      line(10, 10, 10, 30),
      line(20, 10, 20, 30),
      line(30, 10, 30, 30),
    ];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 9.5]);
  });
});

describe("detectGridLattice area comparison uses the product, not a ratio", () => {
  it("a tall thin lattice with the larger aspect ratio but far smaller area loses to a wide one", () => {
    // The tall grid is 1pt wide and 20pt tall (ratio 20, area 20); the
    // wide grid is 20x20 (ratio 1, area 400). Only the product comparison
    // picks the wide one.
    const tallThin = [
      line(200, 130, 201, 130),
      line(200, 120, 201, 120),
      line(200, 110, 201, 110),
      line(200, 110, 200, 130),
      line(200.5, 110, 200.5, 130),
      line(201, 110, 201, 130),
    ];
    const items = [...tallThin, ...fullGrid()];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });
});

describe("detectGridLattice area comparison, wide-flat counter-case", () => {
  it("a wide flat lattice with the larger width/height ratio but far smaller area also loses", () => {
    // 80pt wide, 4.5pt tall (ratio ~17.8, area 360) against the 20x20 grid
    // (ratio 1, area 400): only the product picks the square, and the
    // columns stay above the 4pt minimum length.
    const wideFlat = [
      line(100, 34.5, 180, 34.5),
      line(100, 32.25, 180, 32.25),
      line(100, 30, 180, 30),
      line(100, 30, 100, 34.5),
      line(140, 30, 140, 34.5),
      line(180, 30, 180, 34.5),
    ];
    const items = [...wideFlat, ...fullGrid()];
    const lattice = detectGridLattice(items);
    expect(lattice?.rowBoundariesDescPt).toEqual([30, 20, 10]);
    expect(lattice?.columnBoundariesAscPt).toEqual([10, 20, 30]);
  });
});
