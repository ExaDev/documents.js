import { describe, expect, it } from "vitest";
import type { LayoutText } from "./layout";
import type { PdfTextRunGeometry } from "./text-group";
import {
  DEFAULT_BASELINE_TOLERANCE_EM,
  DEFAULT_COLUMN_GAP_EM,
  DEFAULT_WORD_GAP_EM,
  groupPdfTextRuns,
  runGapPt,
  runsShareBaseline,
} from "./text-group";

// A run carrying only the geometry the grouper reads. Every test states its own widths explicitly, since an absent width is itself one of the two behaviours under test and must never be supplied by a helper's default.
function run(
  text: string,
  xPt: number,
  yPt: number,
  sizePt: number,
  widthPt?: number,
  rotationDeg?: number,
): PdfTextRunGeometry {
  return {
    text,
    xPt,
    yPt,
    sizePt,
    ...(widthPt === undefined ? {} : { widthPt }),
    ...(rotationDeg === undefined ? {} : { rotationDeg }),
  };
}

describe("groupPdfTextRuns: a heading never absorbs the smaller line beneath it", () => {
  // The defect this module exists for. A 30pt heading and the 9pt line below it sit 12pt apart, which is inside half the heading's own em but well outside half the body line's. A tolerance taken from the heading merges them; taken from the smaller of the two, it cannot.
  const heading = run("Results", 72, 700, 30, 110);
  const body = run("Measured over four quarters", 72, 688, 9, 120);

  it("keeps them on separate lines", () => {
    const lines = groupPdfTextRuns([heading, body]);
    expect(lines.map((line) => line.text)).toEqual([
      "Results",
      "Measured over four quarters",
    ]);
  });

  it("does not depend on the order the runs arrive in", () => {
    const lines = groupPdfTextRuns([body, heading]);
    expect(lines.map((line) => line.text)).toEqual([
      "Results",
      "Measured over four quarters",
    ]);
  });

  it("would merge them if the tolerance came from the larger run", () => {
    // Proves the two baselines really are inside the heading's own tolerance, so the test above is exercising the min rule rather than a gap that was never close enough to matter.
    expect(Math.abs(heading.yPt - body.yPt)).toBeLessThanOrEqual(
      DEFAULT_BASELINE_TOLERANCE_EM * heading.sizePt,
    );
    expect(runsShareBaseline(heading, body)).toBe(false);
  });

  it("does not drop the space between the merged runs either", () => {
    // The knock-on failure: once merged, the runs sort by x into one sequence whose gap is negative, and a negative gap reads as "same word". Both texts start at x 72, so a merge would concatenate them with nothing between.
    const lines = groupPdfTextRuns([heading, body]);
    expect(lines.some((line) => line.text.includes("ResultsMeasured"))).toBe(
      false,
    );
  });
});

describe("groupPdfTextRuns: a run with no advance width contributes no space", () => {
  // The second defect. Three runs of one word, each starting where the last visually ended, but with no width stated. Reading a missing width as zero makes each run's whole advance look like a gap, so a space lands inside the word: "Com plete ly".
  const runs = [
    run("Com", 100, 500, 10),
    run("plete", 118, 500, 10),
    run("ly", 145, 500, 10),
  ];

  it("joins the fragments into one word", () => {
    const [line] = groupPdfTextRuns(runs);
    expect(line?.text).toBe("Completely");
  });

  it("reports them as a single word carrying all three runs", () => {
    const [line] = groupPdfTextRuns(runs);
    expect(line?.words).toHaveLength(1);
    expect(line?.words[0]?.runs).toHaveLength(3);
  });

  it("still separates the words when the widths are stated", () => {
    // The same three positions with real widths: now the gaps are derivable, and the two that are wide enough are spaces.
    const [line] = groupPdfTextRuns([
      run("Com", 100, 500, 10, 16),
      run("plete", 118, 500, 10, 24),
      run("ly", 145, 500, 10, 8),
    ]);
    expect(line?.text).toBe("Com plete ly");
  });

  it("reports no gap at all rather than a zero one", () => {
    expect(runGapPt(run("Com", 100, 500, 10), run("plete", 118, 500, 10))).toBe(
      undefined,
    );
  });

  it("leaves a word with an unknown width unmeasurable", () => {
    const [line] = groupPdfTextRuns(runs);
    expect(line?.words[0]?.bounds).toBe(undefined);
    expect(line?.bounds).toBe(undefined);
  });
});

describe("runsShareBaseline", () => {
  it("accepts two runs on the same baseline", () => {
    expect(
      runsShareBaseline(run("a", 0, 100, 10, 5), run("b", 6, 100, 10, 5)),
    ).toBe(true);
  });

  it("accepts a baseline difference exactly at the tolerance", () => {
    const offset = DEFAULT_BASELINE_TOLERANCE_EM * 12;
    expect(
      runsShareBaseline(
        run("a", 0, 100, 12, 5),
        run("b", 6, 100 + offset, 12, 5),
      ),
    ).toBe(true);
  });

  it("rejects a baseline difference just beyond the tolerance", () => {
    const offset = DEFAULT_BASELINE_TOLERANCE_EM * 12 + 0.01;
    expect(
      runsShareBaseline(
        run("a", 0, 100, 12, 5),
        run("b", 6, 100 + offset, 12, 5),
      ),
    ).toBe(false);
  });

  it("honours an explicit tolerance override", () => {
    const a = run("a", 0, 100, 12, 5);
    const b = run("b", 6, 104, 12, 5);
    expect(runsShareBaseline(a, b)).toBe(true);
    expect(runsShareBaseline(a, b, { baselineToleranceEm: 0.25 })).toBe(false);
  });

  it("rejects two runs set at different angles", () => {
    expect(
      runsShareBaseline(run("a", 0, 100, 10, 5), run("b", 0, 100, 10, 5, 90)),
    ).toBe(false);
  });

  it("treats an absent rotation as zero", () => {
    expect(
      runsShareBaseline(run("a", 0, 100, 10, 5), run("b", 6, 100, 10, 5, 0)),
    ).toBe(true);
  });

  it("measures across the baseline, not down the page, for rotated runs", () => {
    // Both runs sit on one baseline running up the page at x 200; their y values differ by far more than any tolerance, and only the rotated frame shows them as one line.
    expect(
      runsShareBaseline(
        run("a", 200, 100, 10, 20, 90),
        run("b", 200, 300, 10, 20, 90),
      ),
    ).toBe(true);
  });
});

describe("runGapPt", () => {
  it("measures from the previous run's end to the next run's start", () => {
    expect(runGapPt(run("a", 100, 50, 10, 12), run("b", 118, 50, 10, 12))).toBe(
      6,
    );
  });

  it("reports a negative gap when two runs overlap", () => {
    expect(runGapPt(run("a", 100, 50, 10, 12), run("b", 108, 50, 10, 12))).toBe(
      -4,
    );
  });

  it("reports nothing when the previous run stated no width", () => {
    expect(runGapPt(run("a", 100, 50, 10), run("b", 118, 50, 10, 12))).toBe(
      undefined,
    );
  });

  it("reports a gap when the previous run's width is a genuine zero", () => {
    // A stated zero is a fact about the run, unlike an absent width: the gap is derivable and equals the whole distance between the two origins.
    expect(runGapPt(run("a", 100, 50, 10, 0), run("b", 118, 50, 10, 12))).toBe(
      18,
    );
  });

  it("reports nothing when the two runs are set at different angles", () => {
    expect(
      runGapPt(run("a", 100, 50, 10, 12), run("b", 118, 50, 10, 12, 45)),
    ).toBe(undefined);
  });

  it("measures along the baseline for rotated runs", () => {
    expect(
      runGapPt(run("a", 200, 100, 10, 12, 90), run("b", 200, 118, 10, 12, 90)),
    ).toBeCloseTo(6, 6);
  });
});

describe("groupPdfTextRuns: word splitting", () => {
  it("splits a run's own text on the whitespace it carries", () => {
    const [line] = groupPdfTextRuns([run("one two three", 50, 200, 10, 60)]);
    expect(line?.words.map((word) => word.text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(line?.text).toBe("one two three");
  });

  it("gives a word carved out of one run no bounds of its own", () => {
    // The run states where it starts and how far it advances in total, never where each word sits inside that advance.
    const [line] = groupPdfTextRuns([run("one two", 50, 200, 10, 40)]);
    expect(line?.words.every((word) => word.bounds === undefined)).toBe(true);
  });

  it("keeps a space a run's trailing whitespace states even when the geometry says none", () => {
    const [line] = groupPdfTextRuns([
      run("one ", 50, 200, 10, 24),
      run("two", 74, 200, 10, 20),
    ]);
    expect(line?.text).toBe("one two");
  });

  it("keeps a space a run's leading whitespace states even when the geometry says none", () => {
    const [line] = groupPdfTextRuns([
      run("one", 50, 200, 10, 24),
      run(" two", 74, 200, 10, 20),
    ]);
    expect(line?.text).toBe("one two");
  });

  it("carries a pending space across a whitespace-only run", () => {
    const [line] = groupPdfTextRuns([
      run("one ", 50, 200, 10, 24),
      run(" ", 74, 200, 10, 3),
      run("two", 77, 200, 10, 20),
    ]);
    expect(line?.text).toBe("one two");
    expect(line?.words.map((word) => word.text)).toEqual(["one", "two"]);
  });

  it("never opens a line with a separator", () => {
    const [line] = groupPdfTextRuns([
      run("  ", 40, 200, 10, 6),
      run("one", 50, 200, 10, 24),
    ]);
    expect(line?.words[0]?.separatorBefore).toBe("none");
    expect(line?.text).toBe("one");
  });

  it("drops runs with no text rather than letting them anchor a line", () => {
    const lines = groupPdfTextRuns([
      run("", 50, 400, 10, 0),
      run("kept", 50, 200, 10, 24),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("kept");
  });

  it("reads whitespace inside a run's text as neither leading nor trailing it", () => {
    // Whitespace between the run's own words says nothing about its boundary with the runs either side, so two runs meeting with no gap still meet inside one word.
    const [line] = groupPdfTextRuns([
      run("x", 50, 200, 10, 5),
      run("one two", 55, 200, 10, 30),
      run("y", 85, 200, 10, 5),
    ]);
    expect(line?.text).toBe("xone twoy");
  });

  it("keeps a column boundary a column even when the run before it ended in a space", () => {
    // A space either side of a boundary can only upgrade a gap that reads as nothing; it never demotes the stronger claim a column-wide gap makes.
    const [line] = groupPdfTextRuns([
      run("Region ", 50, 200, 10, 34),
      run("Revenue", 200, 200, 10, 36),
    ]);
    expect(line?.words[1]?.separatorBefore).toBe("column");
    expect(line?.text).toBe("Region\tRevenue");
  });

  it("joins runs split mid-word by a style change into one word", () => {
    const [line] = groupPdfTextRuns([
      run("hel", 50, 200, 10, 15),
      run("lo", 65, 200, 10, 10),
    ]);
    expect(line?.words.map((word) => word.text)).toEqual(["hello"]);
  });

  it("measures a word that spans whole runs from the first run's start to the last one's end", () => {
    const [line] = groupPdfTextRuns([
      run("hel", 50, 200, 10, 15),
      run("lo", 65, 200, 10, 10),
    ]);
    expect(line?.words[0]?.bounds).toEqual({
      xPt: 50,
      yPt: 200,
      widthPt: 25,
      heightPt: 10,
    });
  });

  it("takes a spanning word's height from the largest of its runs", () => {
    const [line] = groupPdfTextRuns([
      run("hel", 50, 200, 10, 15),
      run("lo", 65, 200, 14, 10),
    ]);
    expect(line?.words[0]?.bounds?.heightPt).toBe(14);
  });

  it("leaves a single-run word with no stated width unmeasurable", () => {
    const [line] = groupPdfTextRuns([run("solo", 50, 200, 10)]);
    expect(line?.words[0]?.bounds).toBe(undefined);
  });

  it("does not recover a word's measurability from a later run that has a width", () => {
    // The first run left the word's extent unknown; a second run stating its own width says nothing about where the first one ended.
    const [line] = groupPdfTextRuns([
      run("hel", 50, 200, 10),
      run("lo", 65, 200, 10, 10),
    ]);
    expect(line?.words[0]?.text).toBe("hello");
    expect(line?.words[0]?.bounds).toBe(undefined);
  });

  it("loses a word's measurability to a later run that states no width", () => {
    const [line] = groupPdfTextRuns([
      run("hel", 50, 200, 10, 15),
      run("lo", 65, 200, 10),
    ]);
    expect(line?.words[0]?.text).toBe("hello");
    expect(line?.words[0]?.bounds).toBe(undefined);
  });

  it("loses a word's measurability to a run that gave it only part of its own text", () => {
    // The second run advances across "cd ef" in total, so nothing in it says where "cd" alone ends, and the word it completes has no derivable extent.
    const [line] = groupPdfTextRuns([
      run("ab", 50, 200, 10, 10),
      run("cd ef", 60, 200, 10, 25),
    ]);
    expect(line?.words[0]?.text).toBe("abcd");
    expect(line?.words[0]?.bounds).toBe(undefined);
  });
});

describe("groupPdfTextRuns: gap thresholds", () => {
  it("treats a gap just under a word space as the same word", () => {
    const gap = DEFAULT_WORD_GAP_EM * 10 - 0.01;
    const [line] = groupPdfTextRuns([
      run("in", 50, 200, 10, 10),
      run("to", 60 + gap, 200, 10, 10),
    ]);
    expect(line?.text).toBe("into");
  });

  it("treats a gap exactly at a word space as a space", () => {
    const gap = DEFAULT_WORD_GAP_EM * 10;
    const [line] = groupPdfTextRuns([
      run("in", 50, 200, 10, 10),
      run("to", 60 + gap, 200, 10, 10),
    ]);
    expect(line?.text).toBe("in to");
  });

  it("treats a gap just under a column as a space", () => {
    const gap = DEFAULT_COLUMN_GAP_EM * 10 - 0.01;
    const [line] = groupPdfTextRuns([
      run("in", 50, 200, 10, 10),
      run("to", 60 + gap, 200, 10, 10),
    ]);
    expect(line?.text).toBe("in to");
  });

  it("treats a gap exactly at a column as a column", () => {
    const gap = DEFAULT_COLUMN_GAP_EM * 10;
    const [line] = groupPdfTextRuns([
      run("in", 50, 200, 10, 10),
      run("to", 60 + gap, 200, 10, 10),
    ]);
    expect(line?.text).toBe("in\tto");
    expect(line?.words[1]?.separatorBefore).toBe("column");
  });

  it("scales both thresholds by the smaller of the two runs", () => {
    // A 9.5pt gap between a 30pt run and a 9pt one: past a column boundary at the small run's scale, well short of one at the large run's. The smaller run decides, so it is a column.
    const [line] = groupPdfTextRuns([
      run("Q1", 50, 200, 30, 20),
      run("2026", 79.5, 200, 9, 20),
    ]);
    expect(line?.words[1]?.separatorBefore).toBe("column");
  });

  it("honours explicit threshold overrides", () => {
    const runs = [run("in", 50, 200, 10, 10), run("to", 65, 200, 10, 10)];
    expect(groupPdfTextRuns(runs)[0]?.text).toBe("in to");
    expect(groupPdfTextRuns(runs, { wordGapEm: 1 })[0]?.text).toBe("into");
    expect(groupPdfTextRuns(runs, { columnGapEm: 0.25 })[0]?.text).toBe(
      "in\tto",
    );
  });

  it("carries an explicit baseline tolerance through to the clustering", () => {
    // 6pt apart at 10pt: one line under the default two thirds of an em, two under a quarter of one.
    const runs = [run("upper", 50, 200, 10, 30), run("lower", 50, 194, 10, 30)];
    expect(groupPdfTextRuns(runs)).toHaveLength(1);
    expect(groupPdfTextRuns(runs, { baselineToleranceEm: 0.25 })).toHaveLength(
      2,
    );
  });
});

describe("groupPdfTextRuns: reading order", () => {
  it("orders lines down the page and runs along the baseline", () => {
    const lines = groupPdfTextRuns([
      run("world", 84, 300, 10, 30),
      run("second", 50, 280, 10, 35),
      run("hello", 50, 300, 10, 30),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["hello world", "second"]);
  });

  it("reports each line's own baseline", () => {
    const lines = groupPdfTextRuns([
      run("upper", 50, 300, 10, 30),
      run("lower", 50, 280, 10, 30),
    ]);
    expect(lines.map((line) => line.baselineYPt)).toEqual([300, 280]);
  });

  it("joins a run to the nearer of two lines it is within tolerance of", () => {
    // The two lines are 10pt apart, beyond the 8pt tolerance 12pt text carries, so they stay separate. The middle run sits 4pt below the upper baseline and 6pt above the lower one, inside both. Nearest wins, so it lands on the upper line.
    const lines = groupPdfTextRuns([
      run("upper", 50, 300, 12, 30),
      run("lower", 50, 290, 12, 30),
      run("middle", 84, 296, 12, 30),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["upper middle", "lower"]);
  });

  it("lets the leftmost run of a baseline anchor its line", () => {
    // The anchor's own size sets every later candidate's tolerance, so which run anchors decides what the line can still admit. Here the 30pt run on the left admits the 30pt line 12pt below it; the 9pt run to its right would not. Passed rightmost-first, so only the sort along the baseline puts the left one in front.
    const lines = groupPdfTextRuns([
      run("note", 200, 700, 9, 20),
      run("Title", 50, 700, 30, 20),
      run("more", 50, 688, 30, 20),
    ]);
    expect(lines).toHaveLength(1);
  });

  it("measures a line's box from its leftmost start to its rightmost end", () => {
    const [line] = groupPdfTextRuns([
      run("hello", 50, 300, 10, 30),
      run("world", 90, 300, 12, 30),
    ]);
    expect(line?.bounds).toEqual({
      xPt: 50,
      yPt: 300,
      widthPt: 70,
      heightPt: 12,
    });
  });

  it("leaves a line unmeasurable when any of its runs stated no width", () => {
    const [line] = groupPdfTextRuns([
      run("hello", 50, 300, 10, 30),
      run("world", 90, 300, 10),
    ]);
    expect(line?.bounds).toBe(undefined);
  });

  it("returns nothing for no runs", () => {
    expect(groupPdfTextRuns([])).toEqual([]);
  });
});

describe("groupPdfTextRuns: superscripts and subscripts", () => {
  it("keeps a footnote marker on the line it annotates", () => {
    // 6.5pt marker raised 4pt above a 10pt body line: within two thirds of the marker's own em, so it stays on the line.
    const [line] = groupPdfTextRuns([
      run("evidence", 50, 200, 10, 40),
      run("12", 90, 204, 6.5, 6),
    ]);
    expect(line?.text).toBe("evidence12");
  });

  it("keeps a subscript on the line it belongs to", () => {
    const [line] = groupPdfTextRuns([
      run("H", 50, 200, 10, 7),
      run("2", 57, 197, 6.5, 4),
      run("O", 61, 200, 10, 7),
    ]);
    expect(line?.text).toBe("H2O");
  });

  it("still splits a genuinely separate line set at the same small size", () => {
    // 6.5pt text one solid line below a 6.5pt line: 6.5pt apart, beyond two thirds of an em, so the two stay separate.
    const lines = groupPdfTextRuns([
      run("first", 50, 200, 6.5, 20),
      run("second", 50, 193.5, 6.5, 20),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["first", "second"]);
  });
});

describe("groupPdfTextRuns: tables", () => {
  it("does not merge a row's cells into one sentence", () => {
    const lines = groupPdfTextRuns([
      run("Region", 50, 300, 9, 30),
      run("Revenue", 200, 300, 9, 36),
      run("Growth", 340, 300, 9, 30),
      run("North", 50, 286, 9, 26),
      run("4.2m", 200, 286, 9, 20),
      run("11%", 340, 286, 9, 18),
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      "Region\tRevenue\tGrowth",
      "North\t4.2m\t11%",
    ]);
  });

  it("reports each cell boundary as a column separator", () => {
    const [line] = groupPdfTextRuns([
      run("North", 50, 286, 9, 26),
      run("4.2m", 200, 286, 9, 20),
    ]);
    expect(line?.words.map((word) => word.separatorBefore)).toEqual([
      "none",
      "column",
    ]);
  });

  it("keeps ordinary prose in one run of words", () => {
    const [line] = groupPdfTextRuns([
      run("the", 50, 200, 10, 15),
      run("quick", 68, 200, 10, 25),
      run("fox", 96, 200, 10, 16),
    ]);
    expect(line?.text).toBe("the quick fox");
    expect(line?.words.map((word) => word.separatorBefore)).toEqual([
      "none",
      "space",
      "space",
    ]);
  });
});

describe("groupPdfTextRuns: multi-column body text", () => {
  it("reads a line of one column as continuing into the other when their baselines interleave", () => {
    // The documented limit of grouping by baseline alone: the right column is set 8pt lower than the left, so its first line falls within tolerance of the left column's second, and the two are one visual line as far as geometry alone can tell. The column boundary between them is reported, which is the signal a caller has to work with.
    const lines = groupPdfTextRuns([
      run("left one", 50, 300, 10, 40),
      run("right one", 320, 292, 10, 45),
      run("left two", 50, 288, 10, 40),
      run("right two", 320, 280, 10, 45),
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      "left one",
      "left two\tright one",
      "right two",
    ]);
  });

  it("recovers both columns when each column's runs are grouped separately", () => {
    // What a caller with a segmented page does, and why the grouper leaves segmentation to one: document-outline.js's segmentPdfRegions finds the gutter, and each region's own runs then group unambiguously.
    const left = [
      run("left one", 50, 300, 10, 40),
      run("left two", 50, 288, 10, 40),
    ];
    const right = [
      run("right one", 320, 292, 10, 45),
      run("right two", 320, 280, 10, 45),
    ];
    expect(groupPdfTextRuns(left).map((line) => line.text)).toEqual([
      "left one",
      "left two",
    ]);
    expect(groupPdfTextRuns(right).map((line) => line.text)).toEqual([
      "right one",
      "right two",
    ]);
  });

  it("reports a shared baseline across a gutter as one line with a column boundary", () => {
    // Two columns whose baselines do coincide genuinely are one visual line; the gutter between them is reported as a column boundary rather than a word space, which is exactly the signal a consumer needs to split them back apart.
    const [line] = groupPdfTextRuns([
      run("left", 50, 300, 10, 40),
      run("right", 320, 300, 10, 45),
    ]);
    expect(line?.text).toBe("left\tright");
  });
});

describe("groupPdfTextRuns: rotated text", () => {
  it("groups a rotated line in its own frame", () => {
    const [line] = groupPdfTextRuns([
      run("side", 200, 100, 10, 20, 90),
      run("ways", 200, 122, 10, 20, 90),
    ]);
    expect(line?.text).toBe("side ways");
    expect(line?.rotationDeg).toBe(90);
  });

  it("reports a rotated line's box with its origin in page space", () => {
    const [line] = groupPdfTextRuns([run("up", 200, 100, 10, 20, 90)]);
    expect(line?.bounds?.xPt).toBeCloseTo(200, 6);
    expect(line?.bounds?.yPt).toBeCloseTo(100, 6);
    expect(line?.bounds?.widthPt).toBeCloseTo(20, 6);
  });

  it("never groups runs set at different angles onto one line", () => {
    const lines = groupPdfTextRuns([
      run("flat", 200, 100, 10, 20),
      run("turned", 200, 100, 10, 20, 90),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("reports unrotated text first, then each further angle in ascending order", () => {
    const lines = groupPdfTextRuns([
      run("ninety", 200, 100, 10, 20, 90),
      run("forty five", 200, 100, 10, 20, 45),
      run("flat", 200, 100, 10, 20),
    ]);
    expect(lines.map((line) => line.rotationDeg)).toEqual([0, 45, 90]);
  });

  it("normalises a full turn back onto the unrotated frame", () => {
    const lines = groupPdfTextRuns([
      run("flat", 50, 200, 10, 20),
      run("also flat", 72, 200, 10, 30, 360),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.rotationDeg).toBe(0);
  });

  it("treats two angles differing only by matrix noise as one", () => {
    const lines = groupPdfTextRuns([
      run("one", 50, 200, 10, 20, 90),
      run("two", 50, 222, 10, 20, 90 + 1e-13),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("one two");
  });

  it("keeps two angles a producer meant to differ apart", () => {
    const lines = groupPdfTextRuns([
      run("one", 50, 200, 10, 20, 90),
      run("two", 50, 222, 10, 20, 89),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("orders a rotated block's own lines across its baseline", () => {
    // At 90 degrees the perpendicular points towards decreasing x, so the line at the larger x is the later one.
    const lines = groupPdfTextRuns([
      run("second", 220, 100, 10, 20, 90),
      run("first", 200, 100, 10, 20, 90),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["first", "second"]);
  });
});

describe("groupPdfTextRuns: hyphenation, ligatures and zero-width characters", () => {
  it("leaves a word hyphenated across a line end split, hyphen intact", () => {
    const lines = groupPdfTextRuns([
      run("compre-", 50, 200, 10, 35),
      run("hensive", 50, 188, 10, 35),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["compre-", "hensive"]);
  });

  it("passes a ligature through exactly as the font mapped it", () => {
    const [line] = groupPdfTextRuns([run("ﬁnd", 50, 200, 10, 18)]);
    expect(line?.text).toBe("ﬁnd");
  });

  it("keeps a zero-width character inside the word it sits in", () => {
    const [line] = groupPdfTextRuns([
      run("re", 50, 200, 10, 10),
      run("‍", 60, 200, 10, 0),
      run("do", 60, 200, 10, 10),
    ]);
    expect(line?.text).toBe("re‍do");
  });
});

describe("groupPdfTextRuns: LayoutText", () => {
  it("accepts LayoutText items and hands the originals back on the words", () => {
    const first: LayoutText = {
      kind: "text",
      text: "Hello",
      xPt: 72,
      yPt: 700,
      font: { family: "Helvetica", weight: "normal", style: "normal" },
      sizePt: 12,
      color: { r: 0, g: 0, b: 0 },
      widthPt: 30,
    };
    const second: LayoutText = { ...first, text: "world", xPt: 105 };
    const [line] = groupPdfTextRuns([first, second]);
    expect(line?.text).toBe("Hello world");
    expect(line?.words.map((word) => word.runs[0])).toEqual([first, second]);
  });
});
