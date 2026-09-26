import { describe, expect, it } from "vitest";
import { loadMathFont } from "pdf-codec";
import { layoutFormula } from "./layout";
import type {
  MathAssembledGlyphs,
  MathFontMetrics,
  MathGlyphRun,
  MathRule,
  MathStroke,
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
function glyphRuns(
  items: readonly { readonly kind: string }[],
): MathGlyphRun[] {
  return items.filter((i): i is MathGlyphRun => i.kind === "glyphs");
}
function rules(items: readonly { readonly kind: string }[]): MathRule[] {
  return items.filter((i): i is MathRule => i.kind === "rule");
}
function strokes(items: readonly { readonly kind: string }[]): MathStroke[] {
  return items.filter((i): i is MathStroke => i.kind === "stroke");
}
function assembled(
  items: readonly { readonly kind: string }[],
): MathAssembledGlyphs[] {
  return items.filter(
    (i): i is MathAssembledGlyphs => i.kind === "assembled-glyphs",
  );
}

// A one-element fraction, tall enough that a fence around it selects a larger construction — the same "make the content tall" trick nestedFraction uses, kept small so the tests that only need SOME stretching stay fast.
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
interface MathBoxLike {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly ascentPt: number;
  readonly descentPt: number;
  readonly items: readonly { readonly kind: string }[];
}

describe("layoutFormula: mfrac geometry", () => {
  it("centres numerator and denominator each in the fraction's own width and places the rule on the maths axis", () => {
    const m = metrics();
    const numerator = layoutRoot(mi("i")); // narrow
    const denominator = layoutRoot(mtext("denominator")); // wide
    const box = layoutRoot(el("mfrac", [mi("i"), mtext("denominator")]));
    expect(box.widthPt).toBeCloseTo(
      Math.max(numerator.widthPt, denominator.widthPt),
      6,
    );
    const runs = glyphRuns(box.items);
    const numRun = runs.find((run) => run.text.codePointAt(0) === 0x1d456)!;
    const denRun = runs.find((run) => run.text === "denominator")!;
    expect(numRun.xPt).toBeCloseTo((box.widthPt - numerator.widthPt) / 2, 6);
    expect(denRun.xPt).toBeCloseTo((box.widthPt - denominator.widthPt) / 2, 6);
    // The rule's own vertical centre sits exactly on the maths axis below the fraction's own baseline.
    const [rule] = rules(box.items);
    expect(rule!.yPt + rule!.heightPt / 2).toBeCloseTo(
      box.ascentPt - m.axisHeightPt,
      6,
    );
  });

  it("shifts the numerator and denominator by the display-style shifts at root level", () => {
    const m = metrics();
    const numerator = layoutRoot(mi("a"));
    const denominator = layoutRoot(mi("b"));
    const box = layoutRoot(el("mfrac", [mi("a"), mi("b")]));
    expect(box.ascentPt).toBeCloseTo(
      Math.max(
        m.fractionNumeratorDisplayShiftUpPt,
        m.axisHeightPt +
          m.fractionRuleThicknessPt / 2 +
          m.fractionNumeratorGapMinPt +
          numerator.descentPt,
      ) + numerator.ascentPt,
      6,
    );
    expect(box.descentPt).toBeCloseTo(
      Math.max(
        m.fractionDenominatorDisplayShiftDownPt,
        m.fractionRuleThicknessPt / 2 +
          m.fractionDenominatorGapMinPt +
          denominator.ascentPt -
          m.axisHeightPt,
      ) + denominator.descentPt,
      6,
    );
  });

  it("shifts by the non-display shifts inside a non-display context", () => {
    const m = metrics();
    const numerator = layoutRoot(mi("a"));
    const denominator = layoutRoot(mi("b"));
    const box = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "false" }],
      ),
    );
    expect(box.ascentPt).toBeCloseTo(
      Math.max(
        m.fractionNumeratorShiftUpPt,
        m.axisHeightPt +
          m.fractionRuleThicknessPt / 2 +
          m.fractionNumeratorGapMinPt +
          numerator.descentPt,
      ) + numerator.ascentPt,
      6,
    );
    expect(box.descentPt).toBeCloseTo(
      Math.max(
        m.fractionDenominatorShiftDownPt,
        m.fractionRuleThicknessPt / 2 +
          m.fractionDenominatorGapMinPt +
          denominator.ascentPt -
          m.axisHeightPt,
      ) + denominator.descentPt,
      6,
    );
  });

  it('linethickness="0pt" collapses the rule to zero height rather than falling back to the font default', () => {
    // A zero thickness is a real value (a fraction drawn with no bar), not an absence: only an unparseable or missing attribute falls back.
    const collapsed = layoutRoot(
      el(
        "mfrac",
        [mi("a"), mi("b")],
        [{ name: "linethickness", value: "0pt" }],
      ),
    );
    const [rule] = rules(collapsed.items);
    expect(rule!.heightPt).toBeCloseTo(0, 6);
  });

  it("an unparseable linethickness falls back to the font's own rule thickness", () => {
    const m = metrics();
    const bogus = layoutRoot(
      el(
        "mfrac",
        [mi("a"), mi("b")],
        [{ name: "linethickness", value: "somewhat thick" }],
      ),
    );
    const [rule] = rules(bogus.items);
    expect(rule!.heightPt).toBeCloseTo(m.fractionRuleThicknessPt, 6);
  });

  it("a thicker linethickness pushes the numerator up and the denominator down", () => {
    const m = metrics();
    const thin = layoutRoot(el("mfrac", [mi("a"), mi("b")]));
    const thick = layoutRoot(
      el(
        "mfrac",
        [mi("a"), mi("b")],
        [{ name: "linethickness", value: "6pt" }],
      ),
    );
    const numerator = layoutRoot(mi("a"));
    const denominator = layoutRoot(mi("b"));
    // With the axis-centring asserted above, the half-thickness terms land on both shifts symmetrically.
    expect(thick.ascentPt - thin.ascentPt).toBeCloseTo(
      Math.max(
        m.fractionNumeratorDisplayShiftUpPt,
        m.axisHeightPt + 3 + m.fractionNumeratorGapMinPt + numerator.descentPt,
      ) -
        Math.max(
          m.fractionNumeratorDisplayShiftUpPt,
          m.axisHeightPt +
            m.fractionRuleThicknessPt / 2 +
            m.fractionNumeratorGapMinPt +
            numerator.descentPt,
        ),
      6,
    );
    expect(thick.descentPt - thin.descentPt).toBeCloseTo(
      Math.max(
        m.fractionDenominatorDisplayShiftDownPt,
        3 +
          m.fractionDenominatorGapMinPt +
          denominator.ascentPt -
          m.axisHeightPt,
      ) -
        Math.max(
          m.fractionDenominatorDisplayShiftDownPt,
          m.fractionRuleThicknessPt / 2 +
            m.fractionDenominatorGapMinPt +
            denominator.ascentPt -
            m.axisHeightPt,
        ),
      6,
    );
  });

  it("a fraction with fewer than two children lays out to the empty box", () => {
    expect(layoutRoot(el("mfrac", [])).items).toEqual([]);
    const oneChild = layoutRoot(el("mfrac", [mi("a")]));
    expect(oneChild.items).toEqual([]);
    expect(oneChild.widthPt).toBe(0);
  });
});

describe("layoutFormula: radical geometry", () => {
  // Records every vertical stretch target the layout asks the font for, and offers no construction — forcing the hand-drawn radical sign — so the radical's own internal height arithmetic becomes directly observable without depending on which construction the real font would pick.
  function radicalTargetSpy(): {
    metrics: MathFontMetrics;
    targetsPt: number[];
  } {
    const targetsPt: number[] = [];
    const spy: MathFontMetrics = {
      ...metrics(),
      stretch(codePoint, axis, targetSizePt) {
        targetsPt.push(targetSizePt);
        return undefined;
      },
    };
    return { metrics: spy, targetsPt };
  }

  it("stretches the radical construction to the radicand's full height plus the font's own rule and gap", () => {
    const m = metrics();
    const radicand = layoutRoot(mi("x"));
    const { metrics: spy, targetsPt } = radicalTargetSpy();
    layoutFormula([el("msqrt", [mi("x")])], {
      metrics: spy,
      sizePt: SIZE_PT,
      color: BLACK,
    });
    // wrapRadical asks for signHeight - radicalExtraAscender: the construction's ink-top is placed at the extra ascender, so the reduced target keeps the hook's bottom at the radicand's bottom.
    expect(targetsPt).toHaveLength(1);
    expect(targetsPt[0]!).toBeCloseTo(
      m.radicalRuleThicknessPt + m.radicalVerticalGapPt + radicand.heightPt,
      6,
    );
  });

  it("measures every construct's box height through the radical's own target arithmetic", () => {
    // The same spy asserts each construct's heightPt (a field no other layout path consumes) through one shared observable: the stretch target includes the radicand's full height exactly as the construct reported it.
    const m = metrics();
    const constructs: readonly MathMlElement[] = [
      mtext(".["), // a token: ink union height
      el("msub", [mi("x"), mn("1")]), // scripts: corrected shift geometry
      el("munder", [mi("x"), mn("2")]), // stacking: gap + script height
      el("mfrac", [mi("a"), mi("b")]), // fraction: both shifts
      el("msqrt", [mi("x")]), // a nested radical
      el("mtable", [
        el("mtr", [el("mtd", [mn("1")]), el("mtd", [mn("2")])]),
        el("mtr", [el("mtd", [mn("3")]), el("mtd", [mn("4")])]),
      ]), // a table: row heights plus the inter-row gap
      el(
        "mspace",
        [],
        [
          { name: "width", value: "2em" },
          { name: "height", value: "1em" },
          { name: "depth", value: "0.5em" },
        ],
      ), // a space: ascent + descent
    ];
    for (const construct of constructs) {
      const { metrics: spy, targetsPt } = radicalTargetSpy();
      layoutFormula([el("msqrt", [construct])], {
        metrics: spy,
        sizePt: SIZE_PT,
        color: BLACK,
      });
      // A nested construct is itself a radicand of the outer radical, measured at full size with its own identically-offering spy (a construct like a nested msqrt asks for its own construction first, so the outer radical's own request is the LAST one recorded).
      const inner = layoutFormula([construct], {
        metrics: radicalTargetSpy().metrics,
        sizePt: SIZE_PT,
        color: BLACK,
      }).box;
      expect(targetsPt).toHaveLength(construct.tag === "msqrt" ? 2 : 1);
      expect(targetsPt.at(-1)!).toBeCloseTo(
        m.radicalRuleThicknessPt + m.radicalVerticalGapPt + inner.heightPt,
        6,
      );
    }
  });

  it("places the radicand right of the sign's advance, under the vinculum", () => {
    const box = layoutRoot(el("msqrt", [mi("x")]));
    const [sign] = assembled(box.items);
    const [rule] = rules(box.items);
    const radicandRun = glyphRuns(box.items).find(
      (run) => run.text.codePointAt(0) === 0x1d465,
    )!;
    expect(sign).toBeDefined();
    expect(rule).toBeDefined();
    // The vinculum spans the sign's own advance plus the radicand's width, the radicand starts exactly at the sign's advance (no degree to make room for), and the whole box ends with the vinculum.
    const radicandWidthPt = layoutRoot(mi("x")).widthPt;
    expect(rule!.widthPt).toBeCloseTo(
      radicandRun.xPt - rule!.xPt + radicandWidthPt,
      6,
    );
    expect(box.widthPt).toBeCloseTo(rule!.xPt + rule!.widthPt, 6);
    expect(radicandRun.xPt).toBeCloseTo(
      rule!.xPt + rule!.widthPt - radicandWidthPt,
      6,
    );
  });

  it("msqrt wraps ALL its children as one implicit radicand row", () => {
    // MathML3 3.3.6: msqrt's content model is an implicit mrow — two children render side by side under one radical, not one-as-radicand-one-as-degree.
    const box = layoutRoot(el("msqrt", [mi("x"), mo("+"), mi("y")]));
    const runs = glyphRuns(box.items);
    expect(runs.map((run) => run.text)).toEqual(["𝑥", "+", "𝑦"]); // document order
    for (const run of runs) {
      expect(run.sizePt).toBeCloseTo(SIZE_PT, 6); // every child at full radicand size — none demoted to a degree
    }
  });

  it("mroot reserves room for the degree to the left of the sign via the font's own kerns", () => {
    // The degree is two script levels deep (scriptPercent then scriptScriptPercent of the base size), and a WIDE degree is needed: the font's own kernAfterDegree is negative, so a one-digit degree's reserved width clamps to zero and the kern arithmetic would be invisible.
    const m = metrics();
    const degreeSizePt =
      m.scriptPercentScaleDown * m.scriptScriptPercentScaleDown * SIZE_PT;
    const index = layoutFormula([mtext("33")], {
      metrics: metrics(),
      sizePt: degreeSizePt,
      color: BLACK,
    }).box;
    const box = layoutRoot(el("mroot", [mi("x"), mtext("33")]));
    const [sign] = assembled(box.items);
    const degreeRun = glyphRuns(box.items).find((run) => run.text === "33")!;
    const radicandRun = glyphRuns(box.items).find(
      (run) => run.text.codePointAt(0) === 0x1d465,
    )!;
    const degreeWidthPt =
      m.radicalKernBeforeDegreePt + index.widthPt + m.radicalKernAfterDegreePt;
    expect(degreeWidthPt).toBeGreaterThan(0); // the premise: this degree genuinely pushes the sign right
    const signOriginXPt = Math.max(0, degreeWidthPt);
    expect(degreeRun.xPt).toBeCloseTo(
      Math.max(0, m.radicalKernBeforeDegreePt),
      6,
    );
    expect(sign!.placements[0]!.xPt).toBeCloseTo(signOriginXPt, 6);
    expect(radicandRun.xPt).toBeGreaterThan(sign!.placements[0]!.xPt);
  });

  it("mroot raises the degree by the font's own bottom-raise percentage of the whole radical's height", () => {
    const m = metrics();
    const box = layoutRoot(el("mroot", [mi("x"), mn("3")]));
    const degreeSizePt =
      m.scriptPercentScaleDown * m.scriptScriptPercentScaleDown * SIZE_PT;
    const index = layoutFormula([mn("3")], {
      metrics: metrics(),
      sizePt: degreeSizePt,
      color: BLACK,
    }).box;
    const degreeRun = glyphRuns(box.items).find((run) => run.text === "3")!;
    const raisePt = (box.heightPt * m.radicalDegreeBottomRaisePercent) / 100;
    const degreeBaselineFromTopPt = box.heightPt - raisePt - index.descentPt;
    expect(degreeRun.yPt).toBeCloseTo(degreeBaselineFromTopPt, 6);
  });

  it("a mroot with no radicand lays out to the empty box, and a degree-less mroot still renders", () => {
    expect(layoutRoot(el("mroot", [])).items).toEqual([]);
    expect(glyphRuns(layoutRoot(el("mroot", [mi("x")])).items)).toHaveLength(1); // no degree, but the radicand still renders under its radical
  });

  it("an msqrt with no children still draws its radical sign over an empty radicand", () => {
    // msqrt's content model is an implicit mrow, so an empty msqrt is the radical OF nothing: the sign and vinculum are real drawing, not conditional on content.
    const box = layoutRoot(el("msqrt", []));
    expect(glyphRuns(box.items)).toHaveLength(0);
    expect(assembled(box.items).length + strokes(box.items).length).toBe(1); // the sign: a font construction or a hand-drawn hook
    expect(rules(box.items)).toHaveLength(1); // the vinculum
  });
});
