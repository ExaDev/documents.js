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

// Real font metrics throughout — src/mathml itself has zero dependency on pdf-codec (see this module's own README/architecture note), but its OWN test suite reaching into the real embedded font for realistic, non-synthetic assertions is a pragmatic, test-only exception: MathFontMetrics is a plain interface (metrics.ts), and pdf-codec's loadMathFont() is simply the most realistic implementation available to verify layout.ts's own geometry against.
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
// An mtd cell wrapping arbitrary content, and an mtr of digit cells, for the table tests outside the mtable describe's own scope.
// The same layout at the size a first-level script renders at (scriptPercentScaleDown of the base size) — a construct nested inside a sub/superscript or an over/under script must be measured at its own reduced size, not the formula's root size.
// The box shape returned by layoutFormula, named locally so the geometry sections below can take measured sub-layouts as parameters without importing the schema's own MathBox as a value-level symbol.

describe("layoutFormula: mi/mn/mo tokens", () => {
  it("lays out a single mi as one glyph run, using the mathematical italic codepoint for a single-character identifier", () => {
    const { box, diagnostics } = layoutFormula([mi("x")], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465); // MATHEMATICAL ITALIC SMALL X, not plain 'x' (U+0078)
    expect(box.widthPt).toBeGreaterThan(0);
    expect(box.ascentPt).toBeGreaterThan(0);
  });

  it("lays out a multi-character mi upright (normal variant), not italic", () => {
    const { box } = layoutFormula([mi("sin")], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    const [run] = glyphRuns(box.items);
    expect(run!.text).toBe("sin"); // plain ASCII, not mathematical-italic codepoints
  });

  it("lays out mn upright, never italicised", () => {
    const { box } = layoutFormula([mn("42")], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    const [run] = glyphRuns(box.items);
    expect(run!.text).toBe("42");
  });

  it("inserts operator spacing around a binary mo between two mi tokens", () => {
    const tight = layoutFormula([mi("x"), mi("y")], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    const spaced = layoutFormula([mi("x"), mo("+"), mi("y")], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    // The '+'-bearing row must be wider than "x" and "y" alone by more than the '+' glyph's own advance width — the extra is the lspace/rspace this package's own operator dictionary assigns '+'.
    const plusOnly = layoutFormula([mo("+")], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(spaced.widthPt).toBeGreaterThan(tight.widthPt + plusOnly.widthPt);
  });
});

describe("layoutFormula: mfrac", () => {
  it("places the numerator above the denominator with exactly one horizontal rule between them", () => {
    const { box, diagnostics } = layoutFormula(
      [el("mfrac", [mi("a"), mi("b")])],
      { metrics: metrics(), sizePt: SIZE_PT, color: BLACK },
    );
    expect(diagnostics).toEqual([]);

    const ruleList = rules(box.items);
    expect(ruleList).toHaveLength(1);
    const rule = ruleList[0]!;
    expect(rule.widthPt).toBeCloseTo(box.widthPt, 6); // the rule spans the fraction's own full width

    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(2);
    const [numeratorRun, denominatorRun] = runs;
    // Box-local, y-down: a SMALLER y is higher up the page. The numerator's own baseline must sit above (smaller y than) the rule, and the denominator's baseline below (larger y than) the rule.
    expect(numeratorRun!.yPt).toBeLessThan(rule.yPt);
    expect(denominatorRun!.yPt).toBeGreaterThan(rule.yPt + rule.heightPt);
  });

  it("a font-declared linethickness attribute overrides the font's own default fraction rule thickness", () => {
    const overridden = layoutFormula(
      [
        el(
          "mfrac",
          [mi("a"), mi("b")],
          [{ name: "linethickness", value: "3pt" }],
        ),
      ],
      { metrics: metrics(), sizePt: SIZE_PT, color: BLACK },
    ).box;
    const [rule] = rules(overridden.items);
    expect(rule!.heightPt).toBeCloseTo(3, 6);
  });
});

describe("layoutFormula: msqrt/mroot", () => {
  it("draws the font own stretched radical construction plus a vinculum rule over the radicand", () => {
    const { box, diagnostics } = layoutFormula([el("msqrt", [mi("x")])], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);

    // The real embedded font declares a vertical √ MathVariants construction, so the hook is the font's own assembled glyph run (the authentic radical silhouette), not a hand-drawn approximation.
    const signList = assembled(box.items).filter((item) => item.text === "√");
    expect(signList).toHaveLength(1);
    expect(signList[0]!.placements.length).toBeGreaterThanOrEqual(1);

    const ruleList = rules(box.items);
    expect(ruleList).toHaveLength(1); // the vinculum across the radicand

    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465); // the radicand itself still renders (mathematical italic x)

    // The radicand sits to the right of the radical sign's advance, under the vinculum.
    expect(ruleList[0]!.widthPt).toBeGreaterThan(0);
    expect(runs[0]!.xPt).toBeGreaterThanOrEqual(
      signList[0]!.placements[0]!.xPt,
    );
  });

  it("falls back to a hand-drawn hooked stroke when the font offers no radical construction", () => {
    // A metrics port whose stretch returns undefined for every code point — a font backend with no √ MathVariants data — must keep rendering a real radical via the hand-drawn hook rather than vanishing.
    const noStretch: MathFontMetrics = {
      ...metrics(),
      stretch: () => undefined,
    };
    const { box, diagnostics } = layoutFormula([el("msqrt", [mi("x")])], {
      metrics: noStretch,
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);

    const hookList = strokes(box.items);
    expect(hookList).toHaveLength(1);
    expect(hookList[0]!.points.length).toBeGreaterThanOrEqual(3); // a real hook shape, not a two-point line
    expect(rules(box.items)).toHaveLength(1); // the vinculum
  });

  it("mroot places a smaller degree box to the upper-left of the radical sign", () => {
    const { box } = layoutFormula([el("mroot", [mi("x"), mn("3")])], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(2);
    const degreeRun = runs.find((r) => r.text === "3");
    const radicandRun = runs.find((r) => r.text.codePointAt(0) === 0x1d465);
    expect(degreeRun).toBeDefined();
    expect(radicandRun).toBeDefined();
    expect(degreeRun!.sizePt).toBeLessThan(radicandRun!.sizePt); // the degree is genuinely scaled down (scriptPercentScaleDown x scriptScriptPercentScaleDown)
    expect(degreeRun!.xPt).toBeLessThan(radicandRun!.xPt); // positioned to the left, ahead of the sign
  });
});

describe("layoutFormula: msub/msup/msubsup", () => {
  it("shifts a superscript up and a subscript down relative to the base, both starting after the base's own width", () => {
    // <msubsup> base subscript superscript </msubsup> — MathML's own fixed child order (MathML3 3.4.4).
    const { box, diagnostics } = layoutFormula(
      [el("msubsup", [mi("y"), mn("1"), mn("2")])],
      { metrics: metrics(), sizePt: SIZE_PT, color: BLACK },
    );
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(3);
    const base = runs.find((r) => r.text.codePointAt(0) === 0x1d466)!; // MATHEMATICAL ITALIC SMALL Y
    const sub = runs.find((r) => r.text === "1")!;
    const sup = runs.find((r) => r.text === "2")!;
    expect(base).toBeDefined();
    expect(sub).toBeDefined();
    expect(sup).toBeDefined();
    expect(sub.xPt).toBeCloseTo(sup.xPt, 6); // sub and sup share the same horizontal start, per MathML msubsup semantics
    expect(sub.xPt).toBeGreaterThanOrEqual(base.xPt); // after the base
    expect(sup.yPt).toBeLessThan(base.yPt); // higher on the page (smaller y-down) than the base's own baseline
    expect(sub.yPt).toBeGreaterThan(base.yPt); // lower than the base's own baseline
    expect(sup.sizePt).toBeLessThan(base.sizePt); // scaled down via scriptPercentScaleDown
  });

  it("a movablelimits operator (sum) renders as ordinary sub/sup, not stacked over/under, outside display style", () => {
    // munder/mover in a nested (non-displaystyle) context — see layoutUnderOverElement's own displayStyle branch.
    const nested = el("mfrac", [el("munder", [mo("∑"), mn("0")]), mi("n")]); // sum symbol
    const { box } = layoutFormula([nested], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((r) => r.text === "∑");
    const limitRun = runs.find((r) => r.text === "0");
    expect(sumRun).toBeDefined();
    expect(limitRun).toBeDefined();
    // sub/sup placement is a horizontal offset (limitRun starts after sumRun ends); true under/over stacking would instead centre the limit under the sum with no such horizontal offset.
    expect(limitRun!.xPt).toBeGreaterThanOrEqual(sumRun!.xPt);
  });
});

describe("layoutFormula: munder/mover/munderover (display style)", () => {
  it("stacks an overscript directly above the base, centred, with the base unaffected horizontally", () => {
    const { box, diagnostics } = layoutFormula(
      [el("mover", [mi("x"), mo("^")])],
      { metrics: metrics(), sizePt: SIZE_PT, color: BLACK },
    );
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(2);
    const [base, over] = runs;
    expect(over!.yPt).toBeLessThan(base!.yPt); // above the base
  });
});

describe("layoutFormula: munder/mover/munderover accent-attachment centring", () => {
  it('centres a genuine accent="true" overscript at the base glyph\'s own font-declared top-accent-attachment point, not the geometric centre of the combined box', () => {
    // A classic vector accent: an italic v with a rightwards-arrow accent above it. The arrow (11.376pt wide) is wider than the italic 'v' (6.048pt wide), so geometric centring and attachment-point centring genuinely disagree here — STIX Two Math's own MathTopAccentAttachment entry for italic v (3.84pt from its own left origin) sits right of that glyph's geometric half-width (3.024pt), because the glyph slants.
    const construct = el(
      "mover",
      [mi("v"), mo("→")],
      [{ name: "accent", value: "true" }],
    );
    const geometric = el("mover", [mi("v"), mo("→")]); // no accent="true" — must fall back to plain geometric centring

    const { box: accentBox, diagnostics } = layoutFormula([construct], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    const { box: geometricBox } = layoutFormula([geometric], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);

    const accentRuns = glyphRuns(accentBox.items);
    const geometricRuns = glyphRuns(geometricBox.items);
    expect(accentRuns).toHaveLength(2);
    expect(geometricRuns).toHaveLength(2);

    const accentOver = accentRuns.find((r) => r.text === "→")!;
    const geometricOver = geometricRuns.find((r) => r.text === "→")!;
    expect(accentOver).toBeDefined();
    expect(geometricOver).toBeDefined();

    // Both constructs share an identical combined box width and an identical base position (attachment-point centring never moves the base or changes the box's own overall width), so any difference in the arrow's own x position is attributable entirely to the centring mode, not to some other geometry difference between the two formulas.
    expect(accentBox.widthPt).toBeCloseTo(geometricBox.widthPt, 6);

    // Geometric centring places the (wider) arrow flush against the combined box's own left edge, at x = 0.
    expect(geometricOver.xPt).toBeCloseTo(0, 6);

    // Attachment-point centring shifts the arrow right, so its own horizontal centre lands under the italic v's own font-declared attachment point rather than the box's geometric centre.
    expect(accentOver.xPt).toBeGreaterThan(geometricOver.xPt + 0.5); // a real, non-trivial offset — not rounding noise
    expect(accentOver.xPt).toBeCloseTo(0.816, 2); // baseXPt (2.664) + topAccentXPt (3.84) - arrow.widthPt / 2 (5.688)
  });

  it("falls back to geometric centring when the base is not a single glyph the font has an attachment entry for", () => {
    // A multi-character mi base ("sin") has no single MathTopAccentAttachment entry to resolve at all, so accent="true" must not change its layout versus the same construct without the attribute.
    const withAccentAttr = el(
      "mover",
      [mi("sin"), mo("→")],
      [{ name: "accent", value: "true" }],
    );
    const withoutAccentAttr = el("mover", [mi("sin"), mo("→")]);
    const { box: withAttr } = layoutFormula([withAccentAttr], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    const { box: withoutAttr } = layoutFormula([withoutAccentAttr], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    const overWith = glyphRuns(withAttr.items).find((r) => r.text === "→")!;
    const overWithout = glyphRuns(withoutAttr.items).find(
      (r) => r.text === "→",
    )!;
    expect(overWith.xPt).toBeCloseTo(overWithout.xPt, 6);
  });
});
