import { describe, expect, it } from "vitest";
import type { LayoutFont, TextMeasurer } from "document-schema.js";
import {
  atomizeForWrap,
  firstWrappedLineOf,
  wrapRunsToWidth,
} from "./text-layout";
import type { SourcedRun, WrapAtom } from "./text-layout";

// A deterministic measurer: every character is 5pt wide at 10pt (6pt bold),
// scaling linearly with size, so every width below is hand-derivable.
const FONT: LayoutFont = {
  family: "TestSans",
  weight: "normal",
  style: "normal",
};
const BOLD: LayoutFont = {
  family: "TestSans",
  weight: "bold",
  style: "normal",
};

function measurer(): TextMeasurer {
  return {
    widthOfTextAtSize: (text, font, sizePt) =>
      Array.from(text).length *
      (font.weight === "bold" ? 6 : 5) *
      (sizePt / 10),
    lineHeightAtSize: (_font, sizePt) => sizePt,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({
      offsetPt: -sizePt * 0.1,
      thicknessPt: sizePt * 0.05,
    }),
    horizontalScaleFor: () => 1,
  };
}

function run(
  text: string,
  sizePt = 10,
  font: LayoutFont = FONT,
  runIndex?: number,
): SourcedRun {
  return {
    text,
    font,
    sizePt,
    color: { r: 0, g: 0, b: 0 },
    runIndex,
  };
}

function atomsOf(runs: readonly SourcedRun[]): WrapAtom[] {
  return atomizeForWrap(runs, measurer());
}

// One line as [widthPt, maxSizePt, ascentPt, descentPt, [[text, xOffsetPt], ...]].
function shape(line: {
  widthPt: number;
  maxSizePt: number;
  ascentPt: number;
  descentPt: number;
  fragments: readonly { text: string; xOffsetPt: number }[];
}): unknown[] {
  return [
    line.widthPt,
    line.maxSizePt,
    line.ascentPt,
    line.descentPt,
    line.fragments.map((f) => [f.text, f.xOffsetPt]),
  ];
}

function shapes(lines: readonly Parameters<typeof shape>[0][]): unknown[][] {
  return lines.map((line) => shape(line));
}

describe("wrapRunsToWidth", () => {
  it("splits at word boundaries with exact fragment offsets and metrics", () => {
    expect(shapes(wrapRunsToWidth([run("aaa bbb")], measurer(), 20))).toEqual([
      [15, 10, 8, -2, [["aaa", 0]]],
      [15, 10, 8, -2, [["bbb", 0]]],
    ]);
  });

  it("emits an empty styled line when only the glue cannot follow a word", () => {
    // Width 19 fits "aaa" (15) but not the following glue (15+5 > 19); the
    // glue is then the sole content of line 2 and is stripped to an empty
    // line carrying the paragraph's own run metrics.
    expect(shapes(wrapRunsToWidth([run("aaa bbb")], measurer(), 19))).toEqual([
      [15, 10, 8, -2, [["aaa", 0]]],
      [0, 10, 8, -2, []],
      [15, 10, 8, -2, [["bbb", 0]]],
    ]);
  });

  it("fits two words that exactly fill the line, glue included", () => {
    // 5 + 5 + 5 = 15 <= 15: the boundary is inclusive, so "a b" is one line.
    expect(
      shapes(wrapRunsToWidth([run("a"), run(" b")], measurer(), 15)),
    ).toEqual([
      [
        15,
        10,
        8,
        -2,
        [
          ["a", 0],
          ["b", 10],
        ],
      ],
    ]);
  });

  it("emergency-splits a long word at the character boundary, always progressing", () => {
    // At 10pt each character is 5pt wide, so width 10 splits after exactly
    // two characters; the exact-fill prefix ("ab" = 10 <= 10) stays on line 1.
    expect(shapes(wrapRunsToWidth([run("abcdef")], measurer(), 10))).toEqual([
      [10, 10, 8, -2, [["ab", 0]]],
      [10, 10, 8, -2, [["cd", 0]]],
      [10, 10, 8, -2, [["ef", 0]]],
    ]);
  });

  it("keeps a single over-wide character as one over-wide line with no residue", () => {
    const lines = wrapRunsToWidth([run("z")], measurer(), 3);
    expect(shapes(lines)).toEqual([[5, 10, 8, -2, [["z", 0]]]]);
    expect(lines).toHaveLength(1);
  });

  it("splits long words by default without any options object", () => {
    expect(wrapRunsToWidth([run("abcdef")], measurer(), 10)).toHaveLength(3);
  });

  it("keeps a too-wide word unsplit when breakLongWords is false", () => {
    expect(
      shapes(
        wrapRunsToWidth([run("bigbig")], measurer(), 15, {
          breakLongWords: false,
        }),
      ),
    ).toEqual([[30, 10, 8, -2, [["bigbig", 0]]]]);
  });

  it("swallows an over-wide glue as one empty styled line", () => {
    // Four spaces measure 20pt against width 15: placed anyway (forward
    // progress), then stripped as trailing glue, leaving the empty line.
    expect(shapes(wrapRunsToWidth([run("    ")], measurer(), 15))).toEqual([
      [0, 10, 8, -2, []],
    ]);
  });

  it("collapses a space-only paragraph to one empty styled line", () => {
    expect(shapes(wrapRunsToWidth([run(" ")], measurer(), 100))).toEqual([
      [0, 10, 8, -2, []],
    ]);
  });

  it("strips trailing glue from a line that otherwise fits", () => {
    expect(shapes(wrapRunsToWidth([run("aaa ")], measurer(), 100))).toEqual([
      [15, 10, 8, -2, [["aaa", 0]]],
    ]);
  });

  it("treats an explicit break as a line boundary and drops the trailing empty line", () => {
    const lines = wrapRunsToWidth([run("ab\n")], measurer(), 100);
    expect(shapes(lines)).toEqual([[10, 10, 8, -2, [["ab", 0]]]]);
    expect(lines).toHaveLength(1);
  });

  it("emits one empty line for empty input, styled by the first run when present", () => {
    expect(shapes(wrapRunsToWidth([run("")], measurer(), 100))).toEqual([
      [0, 10, 8, -2, []],
    ]);
    expect(shapes(wrapRunsToWidth([], measurer(), 100))).toEqual([
      [0, 0, 0, 0, []],
    ]);
  });

  it("at zero width returns one unwrapped line with breaks dropped", () => {
    expect(shapes(wrapRunsToWidth([run("a\nb c")], measurer(), 0))).toEqual([
      [
        20,
        10,
        8,
        -2,
        [
          ["a", 0],
          ["b", 5],
          ["c", 15],
        ],
      ],
    ]);
  });

  it("at negative width takes the same degenerate unwrapped branch", () => {
    expect(shapes(wrapRunsToWidth([run("ab")], measurer(), -5))).toEqual([
      [10, 10, 8, -2, [["ab", 0]]],
    ]);
  });

  it("at zero width an all-break input reports the first run's metrics", () => {
    expect(shapes(wrapRunsToWidth([run("\n\n")], measurer(), 0))).toEqual([
      [0, 10, 8, -2, []],
    ]);
  });

  it("at zero width a glue-only input reports the glue width and no font metrics", () => {
    // The degenerate branch keeps glue atoms (only breaks are dropped), and
    // buildLine derives nothing from a glue: width 5, metrics all zero.
    expect(shapes(wrapRunsToWidth([run(" ")], measurer(), 0))).toEqual([
      [5, 0, 0, 0, []],
    ]);
  });

  it("merges a word split across runs into one atom and resplits it whole", () => {
    // One box of three fragments totalling 15pt against width 10: fragments
    // "a" and "b" fill the budget exactly (5+5 <= 10), so the split budget for
    // "c" is zero and splitTextToWidth's progress guarantee swallows it
    // whole: one over-wide line carrying all three fragments.
    expect(
      shapes(wrapRunsToWidth([run("a"), run("b"), run("c")], measurer(), 10)),
    ).toEqual([
      [
        15,
        10,
        8,
        -2,
        [
          ["a", 0],
          ["b", 5],
          ["c", 10],
        ],
      ],
    ]);
  });

  it("emergency-splits a multi-fragment word fragment by fragment", () => {
    // Fragments measure 5, 10, 10 against width 12: "a" fits, "bb" does
    // not, so "bb" splits at the 7pt remainder (one character), and the tail
    // requeues for the next line, where the same arithmetic repeats.
    expect(
      shapes(wrapRunsToWidth([run("a"), run("bb"), run("cc")], measurer(), 12)),
    ).toEqual([
      [
        10,
        10,
        8,
        -2,
        [
          ["a", 0],
          ["b", 5],
        ],
      ],
      [
        10,
        10,
        8,
        -2,
        [
          ["b", 0],
          ["c", 5],
        ],
      ],
      [5, 10, 8, -2, [["c", 0]]],
    ]);
  });

  it("derives line metrics from the largest and deepest fragments", () => {
    // A 10pt "a" (width 5) followed by a 20pt "bc" (width 20): the line's
    // size is the max (20), its ascent 0.8 * 20, its descent -0.2 * 20.
    expect(
      shapes(wrapRunsToWidth([run("a", 10), run("bc", 20)], measurer(), 100)),
    ).toEqual([
      [
        25,
        20,
        16,
        -4,
        [
          ["a", 0],
          ["bc", 5],
        ],
      ],
    ]);
  });

  it("measures bold runs through the injected font", () => {
    expect(
      shapes(wrapRunsToWidth([run("aaa", 10, BOLD)], measurer(), 100)),
    ).toEqual([[18, 10, 8, -2, [["aaa", 0]]]]);
  });

  it("keeps a multi-space run as one glue atom, stripped at the line end", () => {
    // "a  b": the two spaces form one 10pt glue. Against width 15 the glue
    // exactly fills the line after "a", so "b" wraps and the glue is
    // stripped: line 1 is "a" alone, not "a" plus trailing spaces.
    expect(shapes(wrapRunsToWidth([run("a  b")], measurer(), 15))).toEqual([
      [5, 10, 8, -2, [["a", 0]]],
      [5, 10, 8, -2, [["b", 0]]],
    ]);
  });
});

describe("atomizeForWrap", () => {
  it("atomises words, glue and breaks, merging words across runs", () => {
    const atoms = atomsOf([run("ab cd", 10, FONT, 0), run("ef", 10, FONT, 1)]);
    expect(atoms.map((a) => a.kind)).toEqual(["box", "glue", "box"]);
    expect(
      atoms.map((a) =>
        a.kind === "box" ? a.fragments.map((f) => f.text) : a.widthPt,
      ),
    ).toEqual([["ab"], 5, ["cd", "ef"]]);
    expect(
      atoms
        .flatMap((a) => (a.kind === "box" ? a.fragments : []))
        .map((f) => f.runIndex),
    ).toEqual([0, 0, 1]);
  });

  it("keeps a multi-space token as a single glue atom", () => {
    const atoms = atomsOf([run("a  b")]);
    expect(atoms.map((a) => a.kind)).toEqual(["box", "glue", "box"]);
    expect(atoms[1]?.kind === "glue" ? atoms[1].widthPt : undefined).toBe(10);
  });

  it("emits break atoms for explicit newlines", () => {
    expect(atomsOf([run("a\nb")]).map((a) => a.kind)).toEqual([
      "box",
      "break",
      "box",
    ]);
  });
});

describe("firstWrappedLineOf", () => {
  it("returns the first line and the atoms remaining after a break", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("aaa\nbbb")]),
      measurer(),
      100,
    );
    expect(shape(line)).toEqual([15, 10, 8, -2, [["aaa", 0]]]);
    expect(rest.map((a) => a.kind)).toEqual(["box"]);
    expect(
      rest[0]?.kind === "box" ? rest[0].fragments[0]?.text : undefined,
    ).toBe("bbb");
  });

  it("wraps one line and leaves the overflow atom queued", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("aaa bbb")]),
      measurer(),
      20,
    );
    expect(shape(line)).toEqual([15, 10, 8, -2, [["aaa", 0]]]);
    expect(rest.map((a) => a.kind)).toEqual(["box"]);
  });

  it("splits a long word and splices the tail back into the queue", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("abcdef")]),
      measurer(),
      12,
    );
    expect(shape(line)).toEqual([10, 10, 8, -2, [["ab", 0]]]);
    expect(rest).toHaveLength(1);
    expect(
      rest[0]?.kind === "box"
        ? rest[0].fragments.map((f) => f.text).join("")
        : undefined,
    ).toBe("cdef");
  });

  it("consumes a single over-wide character completely with nothing remaining", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("z")]),
      measurer(),
      3,
    );
    expect(shape(line)).toEqual([5, 10, 8, -2, [["z", 0]]]);
    expect(rest).toEqual([]);
  });

  it("keeps a long word whole on one over-wide line when splitting is disallowed", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("bigbig")]),
      measurer(),
      15,
      { breakLongWords: false },
    );
    expect(shape(line)).toEqual([30, 10, 8, -2, [["bigbig", 0]]]);
    expect(rest).toEqual([]);
  });

  it("produces an empty line styled from the first box when an over-wide glue leads", () => {
    // The 20pt glue exceeds width 15 on its own, is placed anyway for
    // forward progress, and is then stripped; the empty line's metrics come
    // from the first box atom ("x", 10pt), and "x" remains queued.
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("    x")]),
      measurer(),
      15,
    );
    expect(shape(line)).toEqual([0, 10, 8, -2, []]);
    expect(rest.map((a) => a.kind)).toEqual(["box"]);
  });

  it("produces an empty styled line when a leading glue fits but the box cannot follow", () => {
    // Glue (5) fits width 6; the box (5 more) does not, so the line breaks
    // and the glue is stripped, leaving the empty line and "x" queued.
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run(" x")]),
      measurer(),
      6,
    );
    expect(shape(line)).toEqual([0, 10, 8, -2, []]);
    expect(rest.map((a) => a.kind)).toEqual(["box"]);
  });

  it("at zero width returns everything on one line with breaks dropped", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("a\nb c")]),
      measurer(),
      0,
    );
    expect(shape(line)).toEqual([
      20,
      10,
      8,
      -2,
      [
        ["a", 0],
        ["b", 5],
        ["c", 15],
      ],
    ]);
    expect(rest).toEqual([]);
  });

  it("at zero width an all-break input reports no metrics and nothing remaining", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("\n\n")]),
      measurer(),
      0,
    );
    expect(shape(line)).toEqual([0, 0, 0, 0, []]);
    expect(rest).toEqual([]);
  });

  it("at zero width a glue-only input reports the glue width", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run(" ")]),
      measurer(),
      0,
    );
    expect(shape(line)).toEqual([5, 0, 0, 0, []]);
    expect(rest).toEqual([]);
  });

  it("at negative width takes the degenerate branch like zero", () => {
    const { line, rest } = firstWrappedLineOf(
      atomsOf([run("ab")]),
      measurer(),
      -1,
    );
    expect(shape(line)).toEqual([10, 10, 8, -2, [["ab", 0]]]);
    expect(rest).toEqual([]);
  });
});
