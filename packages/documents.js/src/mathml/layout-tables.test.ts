import { describe, expect, it } from "vitest";
import { loadMathFont } from "pdf-codec";
import { layoutFormula } from "./layout";
import type {
  MathAssembledGlyphs,
  MathFontMetrics,
  MathGlyphRun,
} from "document-schema.js";
import type { MathMlElement, MathMlNode } from "./nodes";
const SIZE_PT = 12;
function metrics() {
  return loadMathFont().metricsAt(SIZE_PT);
}
const BLACK = { r: 0, g: 0, b: 0 };

function el(
  tag: string,
  children: MathMlNode[] = [],
  attributes: readonly { readonly name: string; readonly value: string }[] = [],
): MathMlElement {
  return { type: "element", tag, attributes, children };
}
function text(value: string): MathMlNode {
  return { type: "text", value };
}
function mi(name: string): MathMlElement {
  return el("mi", [text(name)]);
}
function mn(value: string): MathMlElement {
  return el("mn", [text(value)]);
}
function mo(value: string): MathMlElement {
  return el("mo", [text(value)]);
}
function mtext(value: string): MathMlElement {
  return el("mtext", [text(value)]);
}

// Wraps the real embedded font's own metrics, overriding the ink bounds for two codepoints that are otherwise unrelated to their real glyph outlines — '.' (PERIOD, U+002E) standing in for a visually short glyph, '[' (LEFT SQUARE BRACKET, U+005B) for a visually tall one — while leaving every other measurement (advance width, italic correction, topAccentXPt) exactly as the real font reports it. pdf-codec's own font backend does populate inkAscentPt/inkDescentPt from real glyph outlines now (see metrics.ts's own doc comment), so this override exists purely for deterministic, easy-to-eyeball test values (1pt/0.3pt and 10pt/4pt) rather than to compensate for a missing capability — the real per-glyph figures (period ~1.37pt/0.10pt, bracket ~8.83pt/2.35pt at this size) would exercise the identical union logic just as validly, only with less legible assertions.
const PERIOD_INK = { inkAscentPt: 1, inkDescentPt: 0.3 } as const; // well inside the font's own nominal ascent/descent at SIZE_PT (9.144pt / 2.856pt)
const BRACKET_INK = { inkAscentPt: 10, inkDescentPt: 4 } as const; // deliberately taller than the font's own nominal ascent/descent at SIZE_PT
function metricsWithInk(): MathFontMetrics {
  const base = metrics();
  return {
    ...base,
    glyph(codePoint: number, sizePt: number) {
      const real = base.glyph(codePoint, sizePt);
      if (real === undefined) {
        return real;
      }
      if (codePoint === 0x2e) {
        return { ...real, ...PERIOD_INK };
      }
      if (codePoint === 0x5b) {
        return { ...real, ...BRACKET_INK };
      }
      return real;
    },
  };
}

function glyphRuns(
  items: readonly { readonly kind: string }[],
): MathGlyphRun[] {
  return items.filter((i): i is MathGlyphRun => i.kind === "glyphs");
}
function assembled(
  items: readonly { readonly kind: string }[],
): MathAssembledGlyphs[] {
  return items.filter(
    (i): i is MathAssembledGlyphs => i.kind === "assembled-glyphs",
  );
}

// A one-element fraction, tall enough that a fence around it selects a larger construction — the same "make the content tall" trick nestedFraction uses, kept small so the tests that only need SOME stretching stay fast.
function fraction123(): MathMlElement {
  return el("mfrac", [mn("1"), mn("2")]);
}

// An mtd cell wrapping arbitrary content, and an mtr of digit cells, for the table tests outside the mtable describe's own scope.
function cellOf(content: MathMlElement): MathMlElement {
  return el("mtd", [content]);
}
function row3(values: readonly string[]): MathMlElement {
  return el(
    "mtr",
    values.map((value) => cellOf(mn(value))),
  );
}

function layoutRoot(
  root: MathMlElement,
  font: MathFontMetrics = metrics(),
): MathBoxLike {
  return layoutFormula([root], {
    metrics: font,
    sizePt: SIZE_PT,
    color: BLACK,
  }).box;
}

// The same layout at the size a first-level script renders at (scriptPercentScaleDown of the base size) — a construct nested inside a sub/superscript or an over/under script must be measured at its own reduced size, not the formula's root size.
function layoutAtScriptSize(root: MathMlElement): MathBoxLike {
  return layoutFormula([root], {
    metrics: metrics(),
    sizePt: metrics().scriptPercentScaleDown * SIZE_PT,
    color: BLACK,
  }).box;
}

// The box shape returned by layoutFormula, named locally so the geometry sections below can take measured sub-layouts as parameters without importing the schema's own MathBox as a value-level symbol.
interface MathBoxLike {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly ascentPt: number;
  readonly descentPt: number;
  readonly items: readonly { readonly kind: string }[];
}

describe("layoutFormula: mtable geometry", () => {
  function cell(value: string): MathMlElement {
    return el("mtd", [mn(value)]);
  }
  function row(values: readonly string[]): MathMlElement {
    return el("mtr", values.map(cell));
  }
  it("sizes columns to their widest cell and spaces them by a fixed share of the font size", () => {
    const wide = layoutRoot(mtext("55")).widthPt; // two digits wide
    const narrow = layoutRoot(mn("1")).widthPt;
    const box = layoutRoot(el("mtable", [row(["1", "1"]), row(["1", "1"])]));
    // Column widths measured through a one-column-per-row table would not see cross-row maxima, so drive them through cells of known widths instead.
    const mixedBox = layoutRoot(
      el("mtable", [
        el("mtr", [el("mtd", [mtext("55")]), cell("1")]),
        el("mtr", [cell("1"), cell("1")]),
      ]),
    );
    const columnGapPt = 0.8 * SIZE_PT;
    expect(mixedBox.widthPt).toBeCloseTo(
      Math.max(wide, narrow) + narrow + columnGapPt,
      6,
    );
    expect(box.widthPt).toBeCloseTo(narrow * 2 + columnGapPt, 6);
  });

  it("spaces rows by a fixed share of the font size, and never after the last row", () => {
    const single = layoutRoot(el("mtable", [row(["1"])]));
    const double = layoutRoot(el("mtable", [row(["1"]), row(["1"])]));
    const heightPerRow = single.heightPt;
    expect(double.heightPt).toBeCloseTo(heightPerRow * 2 + 0.5 * SIZE_PT, 6);
  });

  it("centres each row vertically on the maths axis, clamped so the descent never goes negative", () => {
    const m = metrics();
    // A two-row table is tall enough that h/2 - axis is positive: both halves are measured.
    const tall = layoutRoot(el("mtable", [row(["1"]), row(["1"])]));
    expect(tall.descentPt).toBeCloseTo(tall.heightPt / 2 - m.axisHeightPt, 6);
    expect(tall.ascentPt).toBeCloseTo(tall.heightPt / 2 + m.axisHeightPt, 6);

    // A single short row (the period's injected 1.3pt ink) is far shorter than twice the axis: the descent clamps to zero and the whole height is ascent.
    const short = layoutFormula(
      [el("mtable", [el("mtr", [el("mtd", [mo(".")])])])],
      { metrics: metricsWithInk(), sizePt: SIZE_PT, color: BLACK },
    ).box;
    expect(short.descentPt).toBe(0);
    expect(short.ascentPt).toBeCloseTo(short.heightPt, 6);
  });

  it("aligns cells left, right, or centred per the columnalign attribute", () => {
    const table = el(
      "mtable",
      [
        el("mtr", [el("mtd", [mtext("55")]), cell("1")]),
        el("mtr", [cell("1"), el("mtd", [mtext("55")])]),
      ],
      [{ name: "columnalign", value: "left right" }],
    );
    const box = layoutRoot(table);
    const wide = layoutRoot(mtext("55")).widthPt;
    const narrow = layoutRoot(mn("1")).widthPt;
    const columnWidthPt = Math.max(wide, narrow);
    const runs = glyphRuns(box.items);
    const topLeft = runs.find((run) => run.text === "55")!;
    const bottomLeft = runs.find(
      (run) => run.text === "1" && run.yPt > topLeft.yPt,
    )!;
    // Left column: both cells flush at x=0 regardless of their own widths.
    expect(topLeft.xPt).toBeCloseTo(0, 6);
    expect(bottomLeft.xPt).toBeCloseTo(0, 6);
    // Right column: the narrow digit is right-aligned against the wide cell's trailing edge.
    const columnGapPt = 0.8 * SIZE_PT;
    const rightColumnLeftEdge = columnWidthPt + columnGapPt;
    const topRight = runs.find(
      (run) => run.text === "1" && run.yPt === topLeft.yPt,
    )!;
    expect(topRight.xPt).toBeCloseTo(
      rightColumnLeftEdge + columnWidthPt - narrow,
      6,
    );
  });

  it("a shorter columnalign list repeats its last value for the remaining columns", () => {
    // Column 1's own width comes from its widest cell (the "55" in row 1), so the narrow digit in row 0 has slack to be right-aligned within it — without that slack, left/right/centre are indistinguishable.
    const table = el(
      "mtable",
      [
        el("mtr", [el("mtd", [mtext("55")]), cell("1")]),
        el("mtr", [cell("1"), el("mtd", [mtext("55")])]),
      ],
      [{ name: "columnalign", value: "right" }],
    );
    const box = layoutRoot(table);
    const runs = glyphRuns(box.items);
    const wide = layoutRoot(mtext("55")).widthPt;
    const narrow = layoutRoot(mn("1")).widthPt;
    const columnWidthPt = Math.max(wide, narrow);
    const columnGapPt = 0.8 * SIZE_PT;
    const topRight = runs.find((run) => run.text === "1" && run.xPt > wide)!;
    // The second column inherits "right": its cell ends at the column's right edge.
    expect(topRight.xPt).toBeCloseTo(
      columnWidthPt + columnGapPt + columnWidthPt - narrow,
      6,
    );
  });

  it("trims whitespace around columnalign values and ignores unknown align words by centring", () => {
    const padded = layoutRoot(
      el("mtable", [row(["1"])], [{ name: "columnalign", value: "  left  " }]),
    );
    const centred = layoutRoot(el("mtable", [row(["1"])]));
    // A single-cell row is exactly its column's width, so centring and left-align agree there — use a two-cell row where they differ.
    const rows = () => [
      el("mtr", [el("mtd", [mtext("55")]), cell("1")]),
      el("mtr", [cell("1"), el("mtd", [mtext("55")])]),
    ];
    const paddedWide = layoutRoot(
      el("mtable", rows(), [{ name: "columnalign", value: "  left  " }]),
    );
    const centredWide = layoutRoot(el("mtable", rows()));
    expect(padded.heightPt).toBeCloseTo(centred.heightPt, 6);
    const narrowRow = glyphRuns(paddedWide.items).find(
      (run) => run.text === "1" && run.xPt > 0,
    )!; // the narrow digit in column 1 of the padded table
    const paddedNarrowX = narrowRow.xPt;
    const centredNarrowX = glyphRuns(centredWide.items).find(
      (run) => run.text === "1" && run.xPt > 0,
    )!.xPt;
    const wide = layoutRoot(mtext("55")).widthPt;
    const narrow = layoutRoot(mn("1")).widthPt;
    const columnWidthPt = Math.max(wide, narrow);
    const columnGapPt = 0.8 * SIZE_PT;
    // Padded "left" still parses: column 1's narrow cell sits flush at the column's left edge.
    expect(paddedNarrowX).toBeCloseTo(columnWidthPt + columnGapPt, 6);
    // With no attribute at all the same cell is centred in the column instead.
    expect(centredNarrowX).toBeCloseTo(
      columnWidthPt + columnGapPt + (columnWidthPt - narrow) / 2,
      6,
    );
  });

  it("a ragged row contributes no phantom cells, and a row shorter than the table keeps its cells in their own columns", () => {
    const box = layoutRoot(el("mtable", [row(["1", "2"]), row(["3"])]));
    const runs = glyphRuns(box.items);
    const one = runs.find((run) => run.text === "1")!;
    const three = runs.find((run) => run.text === "3")!;
    const two = runs.find((run) => run.text === "2")!;
    expect(three.xPt).toBeCloseTo(one.xPt, 6); // column 0, like the cell above it
    expect(three.xPt).toBeLessThan(two.xPt);
  });

  it("ignores non-mtr children and non-mtd grandchildren entirely", () => {
    // A stray mi between rows is not a row; a stray mi inside an mtr is not a cell — neither shifts the grid nor adds spacing.
    const plain = layoutRoot(el("mtable", [row(["1"])]));
    const polluted = layoutRoot(
      el("mtable", [row(["1"]), mi("x"), el("mtr", [mi("y"), cell("2")])]),
    );
    const twoRows = layoutRoot(el("mtable", [row(["1"]), row(["2"])]));
    // The mi between the rows adds no row of its own, but the second mtr (with its stray non-mtd child ignored) is a real second row.
    expect(polluted.heightPt).toBeCloseTo(twoRows.heightPt, 6);
    expect(polluted.heightPt).not.toBeCloseTo(plain.heightPt, 6);
    expect(
      glyphRuns(polluted.items)
        .map((run) => run.text)
        .sort(),
    ).toEqual(["1", "2"].sort());
  });

  it("a table with no mtr rows, or rows with no mtd cells, lays out to the empty box", () => {
    expect(layoutRoot(el("mtable", [mi("x")])).items).toEqual([]);
    const emptyRows = layoutRoot(el("mtable", [el("mtr", []), el("mtr", [])]));
    expect(emptyRows.items).toEqual([]);
    expect(emptyRows.heightPt).toBe(0);
  });

  it("a bare mtr or mtd outside any table renders as an implicit row of its own children", () => {
    const bareMtr = layoutRoot(el("mtr", [mi("x")]));
    expect(glyphRuns(bareMtr.items)).toHaveLength(1);
    const bareMtd = layoutRoot(el("mtd", [mi("x"), mo("+"), mi("y")]));
    expect(glyphRuns(bareMtd.items).map((run) => run.text)).toEqual([
      "𝑥",
      "+",
      "𝑦",
    ]);
  });
});

describe("layoutFormula: box heightPt consumed as an over script", () => {
  // heightPt is the one box field the root row never propagates (concatBoxesHorizontally recomputes a row's own height from its children's ascent/descent), so a construct's heightPt is only observable where a layout READS it: layoutUnderOver's stack arithmetic consumes the OVER script's heightPt directly. Every expectation below is derived from injected-ink constants, declared attribute values, or the OpenType spec formulas applied to pieces measured at the right size — never from another layout run of the construct under test, which would re-run the mutated code and pass vacuously.
  const SCRIPT_SIZE_PT = metrics().scriptPercentScaleDown * SIZE_PT;

  it("a token's heightPt is its ink ascent plus ink descent", () => {
    const m = metrics();
    const base = layoutRoot(mi("x"));
    // mo(".") as the over script: metricsWithInk pins its ink to exactly 1pt/0.3pt at any size, so the over box's heightPt is exactly that sum whatever the script size is.
    const box = layoutFormula([el("mover", [mi("x"), mo(".")])], {
      metrics: metricsWithInk(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(box.ascentPt).toBeCloseTo(
      base.ascentPt +
        m.stackGapMinPt +
        (PERIOD_INK.inkAscentPt + PERIOD_INK.inkDescentPt),
      6,
    );
    // The same test also pins the over script's own descent term in the baseline distance: base.ascent + gap + over.descent, with over.descent the injected 0.3pt (a zero-descent script would hide that term).
    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d465)!;
    const overRun = runs.find((run) => run.text === ".")!;
    expect(baseRun.yPt - overRun.yPt).toBeCloseTo(
      base.ascentPt + m.stackGapMinPt + PERIOD_INK.inkDescentPt,
      6,
    );
  });

  it("an mspace's heightPt is its declared height plus depth at the script's own size", () => {
    const m = metrics();
    const base = layoutRoot(mi("x"));
    const box = layoutRoot(
      el("mover", [
        mi("x"),
        el(
          "mspace",
          [],
          [
            { name: "height", value: "1em" },
            { name: "depth", value: "0.5em" },
          ],
        ),
      ]),
    );
    expect(box.ascentPt).toBeCloseTo(
      base.ascentPt + m.stackGapMinPt + SCRIPT_SIZE_PT * 1.5,
      6,
    );
  });

  it("an msub's heightPt is its base ascent plus the larger of its own descent and the shifted subscript's", () => {
    // Only a SUPERSCRIPT raises a script box's top edge; a lone subscript extends the bottom. The base and subscript both render at the over-script's own size here, and the font's shift constants are absolute points, not size-scaled.
    const m = metrics();
    const base = layoutRoot(mi("x"));
    const scriptBase = layoutAtScriptSize(mi("y"));
    const scriptSub = layoutFormula([mn("1")], {
      metrics: metrics(),
      sizePt: m.scriptPercentScaleDown * SCRIPT_SIZE_PT,
      color: BLACK,
    }).box;
    const subShiftPt = Math.max(
      m.subscriptShiftDownPt,
      scriptBase.descentPt + m.subscriptBaselineDropMinPt,
    );
    const expectedHeightPt =
      scriptBase.ascentPt +
      Math.max(scriptBase.descentPt, subShiftPt + scriptSub.descentPt);
    const box = layoutRoot(
      el("mover", [mi("x"), el("msub", [mi("y"), mn("1")])]),
    );
    expect(box.ascentPt).toBeCloseTo(
      base.ascentPt + m.stackGapMinPt + expectedHeightPt,
      6,
    );
  });

  it("a nested mover's heightPt is its own ascent plus descent, consumed by the outer stack", () => {
    // Both levels use declared extents: the inner base is an mspace (1em height, 0.5em depth at the script size) and the inner over script is the ink-pinned period, so every term of the nested height is an injected or declared number.
    const m = metrics();
    const outerBase = layoutRoot(mi("x"));
    // 1em at the script size
    const innerBaseDescentPt = SCRIPT_SIZE_PT / 2; // 0.5em
    const innerOverHeightPt = PERIOD_INK.inkAscentPt + PERIOD_INK.inkDescentPt;
    const box = layoutFormula(
      [
        el("mover", [
          mi("x"),
          el("mover", [
            el(
              "mspace",
              [],
              [
                { name: "height", value: "1em" },
                { name: "depth", value: "0.5em" },
              ],
            ),
            mo("."),
          ]),
        ]),
      ],
      { metrics: metricsWithInk(), sizePt: SIZE_PT, color: BLACK },
    ).box;
    expect(box.ascentPt).toBeCloseTo(
      outerBase.ascentPt +
        m.stackGapMinPt +
        (SCRIPT_SIZE_PT +
          m.stackGapMinPt +
          innerOverHeightPt +
          innerBaseDescentPt),
      6,
    );
  });

  it("an mfrac's heightPt is both shifts plus both operands' extents at the script's own size", () => {
    // An over script renders non-display, so the fraction inside it uses the non-display shifts.
    const m = metrics();
    const outerBase = layoutRoot(mi("x"));
    const numerator = layoutAtScriptSize(mi("a"));
    const denominator = layoutAtScriptSize(mi("b"));
    const numShiftPt = Math.max(
      m.fractionNumeratorShiftUpPt,
      m.axisHeightPt +
        m.fractionRuleThicknessPt / 2 +
        m.fractionNumeratorGapMinPt +
        numerator.descentPt,
    );
    const denShiftPt = Math.max(
      m.fractionDenominatorShiftDownPt,
      m.fractionRuleThicknessPt / 2 +
        m.fractionDenominatorGapMinPt +
        denominator.ascentPt -
        m.axisHeightPt,
    );
    const box = layoutRoot(
      el("mover", [mi("x"), el("mfrac", [mi("a"), mi("b")])]),
    );
    expect(box.ascentPt).toBeCloseTo(
      outerBase.ascentPt +
        m.stackGapMinPt +
        (numShiftPt + numerator.ascentPt + denShiftPt + denominator.descentPt),
      6,
    );
  });

  it("a radical's heightPt is its sign headroom plus the radicand's full extent", () => {
    const m = metrics();
    const outerBase = layoutRoot(mi("x"));
    const radicand = layoutAtScriptSize(mi("a"));
    const box = layoutRoot(el("mover", [mi("x"), el("msqrt", [mi("a")])]));
    expect(box.ascentPt).toBeCloseTo(
      outerBase.ascentPt +
        m.stackGapMinPt +
        (m.radicalExtraAscenderPt +
          m.radicalRuleThicknessPt +
          m.radicalVerticalGapPt +
          radicand.ascentPt +
          radicand.descentPt),
      6,
    );
  });

  it("a short mtable's descent clamps to zero before an under script stacks against it", () => {
    // The clamp is invisible at a formula's root (the wrapping row floors any negative descent at zero through its own max), but layoutUnderOver reads the BASE box's descent directly, so an munder over a short table exposes it.
    const m = metrics();
    const under = layoutAtScriptSize(mn("2"));
    const box = layoutFormula(
      [
        el("munder", [
          el("mtable", [el("mtr", [el("mtd", [mo(".")])])]),
          mn("2"),
        ]),
      ],
      { metrics: metricsWithInk(), sizePt: SIZE_PT, color: BLACK },
    ).box;
    expect(box.descentPt).toBeCloseTo(
      0 + m.stackGapMinPt + under.heightPt, // the clamped base descent, not a negative one
      6,
    );
  });
});

describe("layoutFormula: stretched-fence placement", () => {
  it("places a selected variant fence's drawing origin from the font's own ink and the maths axis", () => {
    // The single-placement variant case isolates stretchedBox's own origin arithmetic: yPt = ascent - originAboveBaseline - offset, with ascent = axis + inkHeight/2 and origin = axis - (inkAscent - inkDescent)/2, all derivable from the very stretch result the font returns for this target.
    const m = metrics();
    const content = fraction123();
    const contentBox = layoutRoot(content);
    // The row's non-stretchy content determines the target: twice the larger half-extent about the axis.
    const targetSizePt =
      2 *
      Math.max(
        contentBox.ascentPt - m.axisHeightPt,
        contentBox.descentPt + m.axisHeightPt,
      );
    const result = m.stretch(
      "(".codePointAt(0)!,
      "vertical",
      targetSizePt,
      SIZE_PT,
    )!;
    expect(result.kind).toBe("variant"); // one placement, offsetPt 0 for a pre-built glyph
    const inkHeightPt = result.inkAscentPt + result.inkDescentPt;
    const ascentPt = m.axisHeightPt + inkHeightPt / 2;
    const originAboveBaselinePt =
      m.axisHeightPt - (result.inkAscentPt - result.inkDescentPt) / 2;
    const box = layoutRoot(el("mrow", [mo("("), content, mo(")")]));
    const [open] = assembled(box.items);
    expect(open).toBeDefined();
    expect(open!.placements[0]!.yPt).toBeCloseTo(
      ascentPt - originAboveBaselinePt - result.placements[0]!.offsetPt,
      6,
    );
  });
});

describe("layoutFormula: round-two survivor pins", () => {
  it("a padded over-brace still stretches horizontally to the base's width", () => {
    const wide = el("mrow", [mi("x"), mi("y"), mi("z"), mi("a"), mi("b")]);
    const construct = el("mover", [
      wide,
      el("mo", [text(" ⏞ ")]), // U+23DE padded with spaces
    ]);
    const box = layoutRoot(construct);
    const items = assembled(box.items);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("⏞");
    expect(items[0]!.placements.length).toBeGreaterThan(1); // a genuine assembly, not the base glyph
  });

  it('mstyle displaystyle="true" and "false" measure differently by exactly the display-vs-plain shift gap', () => {
    const m = metrics();
    const withTrue = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "true" }],
      ),
    );
    const withFalse = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "false" }],
      ),
    );
    // Both the numerator and denominator shifts change together, so the height difference is exactly twice the shift gap.
    expect(withTrue.heightPt - withFalse.heightPt).toBeCloseTo(
      2 * (m.fractionNumeratorDisplayShiftUpPt - m.fractionNumeratorShiftUpPt),
      6,
    );
    expect(withTrue.heightPt).toBeGreaterThan(withFalse.heightPt);
  });

  it("a padded movablelimits operator still takes the sub/sup branch outside display style", () => {
    const box = layoutRoot(
      el("mfrac", [el("munder", [el("mo", [text(" ∑ ")]), mn("0")]), mn("9")]),
    );
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((run) => run.text === "∑")!;
    const limitRun = runs.find((run) => run.text === "0")!;
    expect(limitRun.xPt).toBeCloseTo(
      sumRun.xPt + layoutRoot(mo("∑")).widthPt,
      6,
    );
  });

  it("centres an underscript on the combined width when no accent applies", () => {
    const base = layoutRoot(mi("x"));
    const under = layoutAtScriptSize(mn("2"));
    const box = layoutRoot(el("munder", [mi("x"), mn("2")]));
    const underRun = glyphRuns(box.items).find((run) => run.text === "2")!;
    expect(underRun.xPt).toBeCloseTo((box.widthPt - under.widthPt) / 2, 6);
    // And the wider base really is the width, so this centring is not vacuously zero.
    expect(box.widthPt).toBeCloseTo(base.widthPt, 6);
  });

  it("centres a NARROW denominator in the fraction's own width", () => {
    const denominator = layoutRoot(mn("2"));
    const box = layoutRoot(el("mfrac", [mtext("wide numerator"), mn("2")]));
    const denRun = glyphRuns(box.items).find((run) => run.text === "2")!;
    expect(denRun.xPt).toBeCloseTo((box.widthPt - denominator.widthPt) / 2, 6);
    expect(denRun.xPt).toBeGreaterThan(1); // genuinely inset, not flush at zero
  });

  it("places the radical construction's own ink at the extra-ascender line, each part offset up the axis", () => {
    const radicand = layoutRoot(mi("x"));
    const result = metrics().stretch(
      0x221a,
      "vertical",
      metrics().radicalRuleThicknessPt +
        metrics().radicalVerticalGapPt +
        radicand.heightPt,
      SIZE_PT,
    )!;
    expect(result).toBeDefined();
    const box = layoutRoot(el("msqrt", [mi("x")]));
    const [sign] = assembled(box.items);
    expect(sign).toBeDefined();
    for (const placement of sign!.placements) {
      const source = result.placements.find(
        (candidate) => candidate.glyphId === placement.glyphId,
      )!;
      expect(placement.yPt).toBeCloseTo(
        metrics().radicalExtraAscenderPt + result.inkAscentPt - source.offsetPt,
        6,
      );
    }
  });

  it("spaces three columns by two gaps, each the same fixed share of the font size", () => {
    const digit = layoutRoot(mn("1")).widthPt;
    const box = layoutRoot(el("mtable", [row3(["1", "1", "1"])]));
    expect(box.widthPt).toBeCloseTo(digit * 3 + 2 * 0.8 * SIZE_PT, 6);
  });

  it("renders a non-mtd mrow child of an mtr only when it is treated as a cell", () => {
    // The mrow child is filtered out of the row's cells: its content must not appear. A mutant that treats any child as a cell would lay the mrow's own children out and render the x.
    const box = layoutRoot(
      el("mtable", [el("mtr", [el("mrow", [mi("x")]), cellOf(mn("1"))])]),
    );
    const runs = glyphRuns(box.items);
    expect(runs.map((run) => run.text)).toEqual(["1"]);
  });

  it("measures row heights against the cells' own boxes, not the table's own output", () => {
    // The expected single-row height comes from the cell content's own layout, so a mutant that collapses a row's ascent or descent to zero (or drops the inter-row gap) cannot pass against itself.
    const cellBox = layoutRoot(mn("1"));
    const single = layoutRoot(el("mtable", [row3(["1"])]));
    expect(single.heightPt).toBeCloseTo(
      cellBox.ascentPt + cellBox.descentPt,
      6,
    );
    const double = layoutRoot(el("mtable", [row3(["1"]), row3(["1"])]));
    expect(double.heightPt).toBeCloseTo(
      2 * (cellBox.ascentPt + cellBox.descentPt) + 0.5 * SIZE_PT,
      6,
    );
  });

  it("mn renders plain text even when the case block swaps with mi's", () => {
    const [run] = glyphRuns(layoutRoot(mn("x")).items);
    expect(run!.text).toBe("x"); // U+0078, never the mathematical italic 𝑥 an mi would produce
  });

  it("mtext and bare mtr/mtd are supported constructs: no unsupported-element diagnostic", () => {
    const mtextResult = layoutFormula([mtext("plain")], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(mtextResult.diagnostics).toEqual([]);
    expect(glyphRuns(mtextResult.box.items)[0]!.text).toBe("plain");

    for (const tag of ["mtr", "mtd"]) {
      const result = layoutFormula([el(tag, [mi("x")])], {
        metrics: metrics(),
        sizePt: SIZE_PT,
        color: BLACK,
      });
      expect(result.diagnostics).toEqual([]);
    }
  });
});

describe("layoutFormula: third-pass survivor pins", () => {
  it("an over script's own context is not cramped: a superscript inside it uses the ordinary shift", () => {
    // The display-style branch builds its script context with cramped false, so an msup nested inside an over script is laid out with the font's ordinary superscript shift, not the cramped one — measurable as the baseline distance between the two runs inside the over script.
    const m = metrics();
    const scriptBase = layoutAtScriptSize(mi("y"));
    const box = layoutRoot(
      el("mover", [mi("x"), el("msup", [mi("y"), mn("2")])]),
    );
    const runs = glyphRuns(box.items);
    const scriptBaseRun = runs.find(
      (run) => run.text.codePointAt(0) === 0x1d466,
    )!;
    const supRun = runs.find((run) => run.text === "2")!;
    expect(scriptBaseRun.yPt - supRun.yPt).toBeCloseTo(
      Math.max(
        m.superscriptShiftUpPt,
        scriptBase.ascentPt - m.superscriptBaselineDropMaxPt,
      ),
      6,
    );
  });

  it("offsets each part of an ASSEMBLED radical construction up the vertical axis from the ink-top line", () => {
    // A tall radicand forces a genuine multi-part assembly whose parts carry distinct non-zero offsets; a single pre-built variant carries offset 0 and cannot distinguish the offset term's sign.
    const m = metrics();
    const radicand = el("mfrac", [
      el("mfrac", [mn("1"), mn("2")]),
      el("mfrac", [mn("3"), mn("4")]),
    ]);
    const radicandBox = layoutRoot(radicand);
    const result = m.stretch(
      0x221a,
      "vertical",
      m.radicalRuleThicknessPt + m.radicalVerticalGapPt + radicandBox.heightPt,
      SIZE_PT,
    )!;
    expect(result.placements.length).toBeGreaterThan(1);
    const box = layoutRoot(el("msqrt", [radicand]));
    const [sign] = assembled(box.items);
    expect(sign).toBeDefined();
    expect(sign!.placements).toHaveLength(result.placements.length);
    // Parts are emitted in construction order, so compare positionally rather than by glyph id (assembly parts repeat).
    sign!.placements.forEach((placement, index) => {
      expect(placement.yPt).toBeCloseTo(
        m.radicalExtraAscenderPt +
          result.inkAscentPt -
          result.placements[index]!.offsetPt,
        6,
      );
    });
  });

  it("a row's height includes each cell's descent, and the inter-row advance adds it back", () => {
    // Digits sit flat on the baseline (zero ink descent), so the row-descent arithmetic is invisible with digit cells; the period's injected 0.3pt descent makes it measurable against the cell's own box.
    const cellBox = layoutFormula([mo(".")], {
      metrics: metricsWithInk(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    const font = metricsWithInk();
    const table = (rows: number) =>
      layoutFormula(
        [
          el(
            "mtable",
            Array.from({ length: rows }, () =>
              el("mtr", [el("mtd", [mo(".")])]),
            ),
          ),
        ],
        { metrics: font, sizePt: SIZE_PT, color: BLACK },
      ).box;
    expect(table(1).heightPt).toBeCloseTo(
      cellBox.ascentPt + cellBox.descentPt,
      6,
    );
    expect(table(2).heightPt).toBeCloseTo(
      2 * (cellBox.ascentPt + cellBox.descentPt) + 0.5 * SIZE_PT,
      6,
    );
  });

  it("mn does not trim its content: the run keeps its padding, where mo would trim it away", () => {
    // mn and mo differ in exactly one way besides their names: mo trims. The space glyph exists in the font (an advance with no ink), so padded mn content survives verbatim in its run; routing mn through mo's body would silently trim the padding.
    const { box } = layoutFormula([el("mn", [text(" 1 ")])], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(glyphRuns(box.items)[0]!.text).toBe(" 1 ");
    // And mo really does trim the same content, so the two spellings are distinguishable in output, not just in intent.
    const { box: operatorBox } = layoutFormula([el("mo", [text(" 1 ")])], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(glyphRuns(operatorBox.items)[0]!.text).toBe("1");
  });
});
