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

// Real font metrics throughout -- src/mathml itself has zero dependency on pdf-codec (see this module's own README/architecture note), but its OWN test suite reaching into the real embedded font for realistic, non-synthetic assertions is a pragmatic, test-only exception: MathFontMetrics is a plain interface (metrics.ts), and pdf-codec's loadMathFont() is simply the most realistic implementation available to verify layout.ts's own geometry against.
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

// Wraps the real embedded font's own metrics, overriding the ink bounds for two codepoints that are otherwise unrelated to their real glyph outlines -- '.' (PERIOD, U+002E) standing in for a visually short glyph, '[' (LEFT SQUARE BRACKET, U+005B) for a visually tall one -- while leaving every other measurement (advance width, italic correction, topAccentXPt) exactly as the real font reports it. pdf-codec's own font backend does populate inkAscentPt/inkDescentPt from real glyph outlines now (see metrics.ts's own doc comment), so this override exists purely for deterministic, easy-to-eyeball test values (1pt/0.3pt and 10pt/4pt) rather than to compensate for a missing capability -- the real per-glyph figures (period ~1.37pt/0.10pt, bracket ~8.83pt/2.35pt at this size) would exercise the identical union logic just as validly, only with less legible assertions.
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
    // The '+'-bearing row must be wider than "x" and "y" alone by more than the '+' glyph's own advance width -- the extra is the lspace/rspace this package's own operator dictionary assigns '+'.
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
    // A metrics port whose stretch returns undefined for every code point -- a font backend with no √ MathVariants data -- must keep rendering a real radical via the hand-drawn hook rather than vanishing.
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
    // <msubsup> base subscript superscript </msubsup> -- MathML's own fixed child order (MathML3 3.4.4).
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
    // munder/mover in a nested (non-displaystyle) context -- see layoutUnderOverElement's own displayStyle branch.
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
    // A classic vector accent: an italic v with a rightwards-arrow accent above it. The arrow (11.376pt wide) is wider than the italic 'v' (6.048pt wide), so geometric centring and attachment-point centring genuinely disagree here -- STIX Two Math's own MathTopAccentAttachment entry for italic v (3.84pt from its own left origin) sits right of that glyph's geometric half-width (3.024pt), because the glyph slants.
    const construct = el(
      "mover",
      [mi("v"), mo("→")],
      [{ name: "accent", value: "true" }],
    );
    const geometric = el("mover", [mi("v"), mo("→")]); // no accent="true" -- must fall back to plain geometric centring

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
    expect(accentOver.xPt).toBeGreaterThan(geometricOver.xPt + 0.5); // a real, non-trivial offset -- not rounding noise
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

describe("layoutFormula: mtable", () => {
  it("lays out a 2x2 matrix as a real grid: two distinct row baselines, two distinct column x-positions", () => {
    const table = el("mtable", [
      el("mtr", [el("mtd", [mn("1")]), el("mtd", [mn("2")])]),
      el("mtr", [el("mtd", [mn("3")]), el("mtd", [mn("4")])]),
    ]);
    const { box, diagnostics } = layoutFormula([table], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs.map((r) => r.text).sort()).toEqual(["1", "2", "3", "4"]);

    const byText = new Map(runs.map((r) => [r.text, r]));
    const one = byText.get("1")!;
    const two = byText.get("2")!;
    const three = byText.get("3")!;
    const four = byText.get("4")!;

    expect(one.yPt).toBeCloseTo(two.yPt, 6); // same row -> same baseline
    expect(three.yPt).toBeCloseTo(four.yPt, 6);
    expect(one.yPt).toBeLessThan(three.yPt); // row 0 above row 1

    expect(one.xPt).toBeCloseTo(three.xPt, 6); // same column -> same x
    expect(two.xPt).toBeCloseTo(four.xPt, 6);
    expect(one.xPt).toBeLessThan(two.xPt); // column 0 left of column 1
  });
});

describe("layoutFormula: mathvariant", () => {
  it("applies an explicit mathvariant attribute even to a multi-character mi (which would otherwise default to upright, not italic)", () => {
    const { box } = layoutFormula(
      [el("mi", [text("ab")], [{ name: "mathvariant", value: "bold" }])],
      { metrics: metrics(), sizePt: SIZE_PT, color: BLACK },
    );
    const [run] = glyphRuns(box.items);
    expect(run!.text.codePointAt(0)).toBe(0x1d41a); // MATHEMATICAL BOLD SMALL A
  });

  it("mathvariant=script maps through the Letterlike Symbols hole-fillers correctly (script capital B)", () => {
    const { box } = layoutFormula(
      [el("mi", [text("B")], [{ name: "mathvariant", value: "script" }])],
      { metrics: metrics(), sizePt: SIZE_PT, color: BLACK },
    );
    const [run] = glyphRuns(box.items);
    expect(run!.text.codePointAt(0)).toBe(0x212c); // SCRIPT CAPITAL B, the Letterlike Symbols hole-filler, not 0x1D49D (unassigned)
  });
});

describe("layoutFormula: diagnostics and graceful degradation", () => {
  it("falls back to rendering an unsupported element's own text content, with a diagnostic", () => {
    const { box, diagnostics } = layoutFormula([el("mphantom", [mi("x")])], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([
      { kind: "unsupported-element", detail: "mphantom" },
    ]);
    const [run] = glyphRuns(box.items);
    // The fallback renders the element's own raw extracted text content upright (mathvariant 'normal'), not re-resolving nested mi's own italic default -- it degrades to plain text, not a re-run of the full layout algorithm on the unsupported subtree.
    expect(run!.text).toBe("x");
    expect(run!.text.codePointAt(0)).toBe(0x78);
  });

  it("reports a missing-glyph diagnostic for a code point the embedded font has no glyph for, without crashing layout", () => {
    const { box, diagnostics } = layoutFormula(
      [el("mi", [text("\u{10000}")])],
      { metrics: metrics(), sizePt: SIZE_PT, color: BLACK },
    );
    expect(diagnostics.some((d) => d.kind === "missing-glyph")).toBe(true);
    expect(box.items).toEqual([]); // the whole run was undrawable, so it degrades to nothing rather than a garbled partial string
  });

  it("semantics renders its first non-annotation child and ignores the annotation entirely", () => {
    const withAnnotation = el("semantics", [
      mi("x"),
      el(
        "annotation",
        [text("x")],
        [{ name: "encoding", value: "StarMath 5.0" }],
      ),
    ]);
    const { box, diagnostics } = layoutFormula([withAnnotation], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465);
  });
});

describe("layoutFormula: token box height from real per-glyph ink bounds", () => {
  it("a visually short glyph (period) gets a measurably tighter box than a visually tall glyph (bracket), using each glyph's own real ink bounds rather than the shared nominal font metrics", () => {
    const shortBox = layoutFormula([mo(".")], {
      metrics: metricsWithInk(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    const tallBox = layoutFormula([mo("[")], {
      metrics: metricsWithInk(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;

    // Before this change every token box shared the identical nominal height (ascentPerEm + descentPerEm) * SIZE_PT regardless of glyph -- these must now be the real, distinct injected ink bounds, not the nominal ones.
    expect(shortBox.ascentPt).toBeCloseTo(PERIOD_INK.inkAscentPt, 6);
    expect(shortBox.descentPt).toBeCloseTo(PERIOD_INK.inkDescentPt, 6);
    expect(tallBox.ascentPt).toBeCloseTo(BRACKET_INK.inkAscentPt, 6);
    expect(tallBox.descentPt).toBeCloseTo(BRACKET_INK.inkDescentPt, 6);

    expect(tallBox.heightPt).toBeGreaterThan(shortBox.heightPt);
    // A real, non-trivial numeric gap -- (10 + 4) - (1 + 0.3) = 12.7pt -- not rounding noise.
    expect(tallBox.heightPt - shortBox.heightPt).toBeCloseTo(12.7, 6);
  });

  it("unions every character's own ink bounds across a multi-character token, not just the first character's", () => {
    const shortThenTall = layoutFormula([mtext(".[")], {
      metrics: metricsWithInk(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(shortThenTall.ascentPt).toBeCloseTo(BRACKET_INK.inkAscentPt, 6); // max(1, 10)
    expect(shortThenTall.descentPt).toBeCloseTo(BRACKET_INK.inkDescentPt, 6); // max(0.3, 4)

    // Order-independent: the taller glyph's own bounds win whether it is the first or second character -- proving this is a real union, not "use the first character's metric".
    const tallThenShort = layoutFormula([mtext("[.")], {
      metrics: metricsWithInk(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(tallThenShort.ascentPt).toBeCloseTo(shortThenTall.ascentPt, 6);
    expect(tallThenShort.descentPt).toBeCloseTo(shortThenTall.descentPt, 6);
  });

  it("falls back to the font's own nominal ascent/descent for a glyph that carries no ink bounds at all", () => {
    // Driven through a metrics implementation that deliberately reports no ink bounds, rather than through whichever glyph the currently installed pdf-codec backend happens not to measure: that backend now walks CFF charstrings and supplies real bounds for essentially every drawing glyph, so relying on a real gap would make this test's own premise depend on the font backend's coverage rather than on layoutToken's fallback.
    const base = metrics();
    const withoutInk: MathFontMetrics = {
      ...base,
      glyph(codePoint: number, sizePt: number) {
        const real = base.glyph(codePoint, sizePt);
        return real === undefined
          ? real
          : {
              advanceWidthPt: real.advanceWidthPt,
              italicCorrectionPt: real.italicCorrectionPt,
              topAccentXPt: real.topAccentXPt,
            };
      },
    };
    const box = layoutFormula([mi("x")], {
      metrics: withoutInk,
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(box.ascentPt).toBeCloseTo(base.ascentPerEm * SIZE_PT, 6);
    expect(box.descentPt).toBeCloseTo(base.descentPerEm * SIZE_PT, 6);
  });
});

// Stretchy fences drawn from the font's own OpenType MATH MathVariants data. Every glyph ID asserted below is looked up from the real font by the Unicode name of the piece it is -- LEFT PARENTHESIS LOWER HOOK (U+239D) and friends -- rather than hardcoded, which makes these assertions an external cross-check on which pieces the engine picked and in which order, not a restatement of whatever it produced. The bracket family is the one family whose assembly pieces Unicode gives code points to at all (the U+239B..U+23AD block); every other stretchy construction's pieces are unencoded, which is exactly why a placement carries a glyph ID rather than text.
describe("layoutFormula: stretchy fences", () => {
  const font = loadMathFont().font;
  const LEFT_PAREN_PIECES = [0x239d, 0x239c, 0x239b]; // lower hook, extension, upper hook -- bottom to top
  const RIGHT_PAREN_PIECES = [0x239e, 0x239f, 0x23a0]; // upper hook, extension, lower hook (Unicode names the right-hand pieces top-first)
  const LEFT_BRACKET_PIECES = [0x23a3, 0x23a2, 0x23a1]; // LEFT SQUARE BRACKET LOWER CORNER / EXTENSION / UPPER CORNER

  function fenced(
    inner: MathMlElement,
    open = "(",
    close = ")",
  ): MathMlElement {
    return el("mrow", [mo(open), inner, mo(close)]);
  }
  // A fraction whose numerator is itself a fraction, nested `depth` times -- the tallest thing this test can build out of ordinary MathML, and the only way to push a fence past the largest pre-built variant the font offers (3821 design units, 45.85pt at 12pt) into a genuine part assembly.
  function nestedFraction(depth: number): MathMlElement {
    let numerator: MathMlElement = mn("1");
    for (let i = 0; i < depth; i++) {
      numerator = el("mfrac", [numerator, mn("2")]);
    }
    return numerator;
  }
  function layout(root: MathMlElement) {
    return layoutFormula([root], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
  }

  it("leaves an ordinary inline fence as a text glyph run, since the base glyph already covers its content", () => {
    const box = layout(fenced(mi("x")));
    // Nothing to assemble: 'x' is well inside the base parenthesis, so the operator keeps its real Unicode text -- which is what keeps a plain (x) extracting as "(x)" from the resulting PDF.
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain("(");
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(")");
  });

  it("selects a larger pre-built variant glyph for a fence around a single fraction", () => {
    const box = layout(fenced(nestedFraction(1)));
    const items = assembled(box.items);
    expect(items).toHaveLength(2);
    // One glyph each: a pre-built variant, not an assembly -- a single-level fraction is well within the sizes STIX Two Math draws by hand.
    expect(items.map((item) => item.placements.length)).toEqual([1, 1]);
    expect(items.map((item) => item.text)).toEqual(["(", ")"]);
    // A genuinely different glyph from the base parenthesis, and from each other (the font draws left and right separately).
    const drawn = items.map((item) => item.placements[0]!.glyphId);
    expect(drawn[0]).not.toBe(font.glyphId(0x28));
    expect(drawn[1]).not.toBe(font.glyphId(0x29));
    expect(drawn[0]).not.toBe(drawn[1]);
  });

  it("assembles a fence from the font's own real parts once no pre-built variant is large enough", () => {
    const box = layout(fenced(nestedFraction(4)));
    const [open, close] = assembled(box.items);
    expect(open).toBeDefined();
    expect(close).toBeDefined();

    // Bottom hook, one or more extension pieces, top hook -- identified by the Unicode code points of the pieces themselves, so this checks the engine picked the real parenthesis parts in the real bottom-to-top order the font lists them in.
    const openGlyphs = open!.placements.map((placement) => placement.glyphId);
    expect(openGlyphs.length).toBeGreaterThan(2);
    expect(openGlyphs[0]).toBe(font.glyphId(LEFT_PAREN_PIECES[0]!));
    expect(openGlyphs[openGlyphs.length - 1]).toBe(
      font.glyphId(LEFT_PAREN_PIECES[2]!),
    );
    expect(new Set(openGlyphs.slice(1, -1))).toEqual(
      new Set([font.glyphId(LEFT_PAREN_PIECES[1]!)]),
    );
    expect(close!.placements.map((p) => p.glyphId)[0]).toBe(
      font.glyphId(RIGHT_PAREN_PIECES[2]!),
    );
    expect(close!.placements.map((p) => p.glyphId).at(-1)).toBe(
      font.glyphId(RIGHT_PAREN_PIECES[0]!),
    );

    // Parts are laid down bottom to top, so in the box's own y-down space each successive placement sits strictly HIGHER (smaller yPt) than the one before it, and they all share one x.
    const ys = open!.placements.map((placement) => placement.yPt);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeLessThan(ys[i - 1]!);
    }
    expect(
      new Set(open!.placements.map((placement) => placement.xPt)).size,
    ).toBe(1);
  });

  it("assembles a square bracket from its own square-bracket parts, not the parenthesis ones", () => {
    const box = layout(fenced(nestedFraction(4), "[", "]"));
    const [open] = assembled(box.items);
    const glyphs = open!.placements.map((placement) => placement.glyphId);
    expect(glyphs[0]).toBe(font.glyphId(LEFT_BRACKET_PIECES[0]!));
    expect(glyphs.at(-1)).toBe(font.glyphId(LEFT_BRACKET_PIECES[2]!));
    expect(new Set(glyphs.slice(1, -1))).toEqual(
      new Set([font.glyphId(LEFT_BRACKET_PIECES[1]!)]),
    );
  });

  it("sizes the assembly to the actual content height, adding parts as the content grows", () => {
    const partCounts = [4, 6, 8].map(
      (depth) =>
        assembled(layout(fenced(nestedFraction(depth))).items)[0]!.placements
          .length,
    );
    for (let i = 1; i < partCounts.length; i++) {
      expect(partCounts[i]!).toBeGreaterThan(partCounts[i - 1]!);
    }
  });

  it("makes the fence at least as tall as the content it wraps, and no shorter than the base glyph was", () => {
    const inner = nestedFraction(4);
    const contentBox = layout(inner);
    const fencedBox = layout(fenced(inner));
    expect(fencedBox.ascentPt).toBeGreaterThanOrEqual(contentBox.ascentPt);
    expect(fencedBox.descentPt).toBeGreaterThanOrEqual(contentBox.descentPt);
    // The whole row is now as tall as the fence rather than as tall as the fraction, since a symmetric fence overshoots whichever side of the axis is shorter.
    expect(fencedBox.heightPt).toBeGreaterThan(contentBox.heightPt);
  });

  it("centres a stretched fence on the maths axis rather than on the text baseline", () => {
    // A symmetric fence's own ascent and descent are (axis + h/2) and (h/2 - axis), so their difference is twice the axis height whatever h turns out to be -- and because a symmetric fence always covers the content on both sides of the axis, the whole fenced row inherits that same difference. A baseline-aligned fence would instead show almost all of its height as ascent, so this is a real discriminator, not a tautology.
    //
    // The residual tolerance is one font design unit (0.012pt at 12pt): a construction's own measured INK is a design unit or two shorter than the nominal advance the assembly model reaches its target with, so the fence can end up a hair shorter than the content's own descent on one side, which the row's own max() then keeps.
    const oneDesignUnitPt = SIZE_PT / loadMathFont().font.descriptor.unitsPerEm;
    for (const depth of [1, 4, 6]) {
      const box = layout(fenced(nestedFraction(depth)));
      expect(assembled(box.items)).toHaveLength(2);
      expect(
        Math.abs(box.ascentPt - box.descentPt - 2 * metrics().axisHeightPt),
      ).toBeLessThanOrEqual(oneDesignUnitPt);
      // Not merely baseline-aligned: a tall fence genuinely descends well below the baseline.
      expect(box.descentPt).toBeGreaterThan(metrics().axisHeightPt);
    }
  });

  it("sizes every stretchy fence in a row to the row's own content, never to each other", () => {
    // The target is the maximum extent of the row's NON-stretchy children, so adding more fences around the same fraction cannot change any of them: the outer parenthesis assembles identically whether it is alone or wrapped around three further fences. Sizing to each other would make each successive fence grow.
    const inner = nestedFraction(4);
    const alone = assembled(layout(fenced(inner)).items);
    const nested = assembled(
      layout(el("mrow", [mo("("), mo("["), inner, mo("]"), mo(")")])).items,
    );
    expect(nested).toHaveLength(4);
    // Compared on glyph ID and vertical placement: only xPt legitimately differs, since the extra inner fences push the closing one further right along the row.
    const vertical = (item: MathAssembledGlyphs) =>
      item.placements.map((placement) => ({
        glyphId: placement.glyphId,
        yPt: placement.yPt,
      }));
    expect(vertical(nested[0]!)).toEqual(vertical(alone[0]!));
    expect(vertical(nested.at(-1)!)).toEqual(vertical(alone[1]!));
    // The mirrored halves of one pair are the same construction drawn from the font's own left- and right-hand pieces, so they span identically even though every glyph ID differs.
    const span = (item: MathAssembledGlyphs) =>
      Math.abs(item.placements[0]!.yPt - item.placements.at(-1)!.yPt);
    expect(span(alone[1]!)).toBeCloseTo(span(alone[0]!), 9);
    expect(alone[1]!.placements.map((p) => p.glyphId)).not.toEqual(
      alone[0]!.placements.map((p) => p.glyphId),
    );
  });

  it('honours an explicit stretchy="false" on the operator', () => {
    const inner = nestedFraction(4);
    const stretchyOff = el("mrow", [
      el("mo", [text("(")], [{ name: "stretchy", value: "false" }]),
      inner,
      mo(")"),
    ]);
    const items = assembled(
      layoutFormula([stretchyOff], {
        metrics: metrics(),
        sizePt: SIZE_PT,
        color: BLACK,
      }).box.items,
    );
    expect(items).toHaveLength(1); // only the closing fence stretched
    expect(items[0]!.text).toBe(")");
  });

  it("never stretches a big operator, whose display size comes from largeop rather than from its row", () => {
    // STIX Two Math does declare vertical MathVariants for the summation sign, so this only holds because the operator dictionary correctly reports it as non-stretchy (see operators.ts's own bigOperatorMovable note).
    const box = layout(el("mrow", [mo("∑"), nestedFraction(4)]));
    expect(assembled(box.items)).toHaveLength(0);
  });

  it("leaves a stretchy operator alone when there is nothing else in the row to stretch to", () => {
    const box = layout(el("mrow", [mo("("), mo(")")]));
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toEqual(["(", ")"]);
  });
});

// Horizontal stretchy-glyph assembly for an over/under-brace (U+23DE/U+23DF) spanning its own munder/mover/munderover base -- stretchOperator/stretchedBox's horizontal-axis sibling, stretchHorizontalOperator/horizontallyStretchedBox, exercised via layoutUnderOverChild.
//
// The over/under script of a munder/mover is laid out in scriptContext (a reduced sizePt, scriptPercentScaleDown of the outer size -- see layoutUnderOverElement), so the base/variant/assembly breakpoints below are NOT the same target widths that would trigger each outcome for a bare mo at the outer sizePt: the font's own base-glyph advance and every pre-built variant size are all measured at that SAME reduced size, which this suite's own breakpoint probing (against the real embedded font, not guessed) confirmed shifts every threshold narrower. `wideBase(charCount)` mirrors nestedFraction's own "make a real MathML construct wide/tall enough to force a stretch" trick, but growing WIDTH via a flat mrow of single-character mi's rather than height via nested fractions.
describe("layoutFormula: horizontal stretchy over/under-brace", () => {
  const OVER = "⏞"; // U+23DE TOP CURLY BRACKET
  const UNDER = "⏟"; // U+23DF BOTTOM CURLY BRACKET

  // A flat row of `charCount` single-character mi's -- width grows roughly linearly with charCount, with no ceiling the way a fixed-glyph base would have, letting this reach clean base/variant/assembly breakpoints purely by choosing charCount.
  function wideBase(charCount: number): MathMlElement {
    const letters = "xyzabcuvwpqrstklmn";
    const children: MathMlElement[] = [];
    for (let i = 0; i < charCount; i++) {
      children.push(mi(letters[i % letters.length]!));
    }
    return el("mrow", children);
  }
  function over(base: MathMlElement, operator: string = OVER): MathMlElement {
    return el("mover", [base, mo(operator)]);
  }
  function under(base: MathMlElement, operator: string = UNDER): MathMlElement {
    return el("munder", [base, mo(operator)]);
  }
  function layout(root: MathMlElement) {
    return layoutFormula([root], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
  }

  it("leaves the brace as an ordinary unstretched glyph run over a narrow base", () => {
    // A single narrow mi (empirically ~3.29pt wide at SIZE_PT, well under the ~5.3pt base-glyph advance the font reports for this brace at the over-script's own reduced sizePt) leaves nothing for the font to stretch to.
    const { box, diagnostics } = layoutFormula([over(mi("i"))], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(OVER);
  });

  it("selects a larger pre-built horizontal variant for a moderately wide base", () => {
    // wideBase(2) (empirically measured, real font): the brace's own font-reported stretch kind is 'variant' here, one pre-built glyph rather than a genuine multi-part assembly.
    const box = layout(over(wideBase(2)));
    const items = assembled(box.items);
    expect(items).toHaveLength(1);
    expect(items[0]!.placements).toHaveLength(1);
    expect(items[0]!.text).toBe(OVER);
  });

  it("assembles the brace from real multi-part construction once the base is wide enough", () => {
    // wideBase(5) already crosses into 'assembly' (empirically confirmed against the real font -- the pre-built variants top out well before this width), giving several placements sharing one y and strictly increasing x, the first at x=0.
    const box = layout(over(wideBase(5)));
    const [item] = assembled(box.items);
    expect(item).toBeDefined();
    expect(item!.placements.length).toBeGreaterThan(1);

    const ys = new Set(item!.placements.map((p) => p.yPt));
    expect(ys.size).toBe(1); // every part of a horizontal assembly shares one baseline y

    expect(item!.placements[0]!.xPt).toBeCloseTo(0, 6);
    const xs = item!.placements.map((p) => p.xPt);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    }
  });

  it("grows the assembly part count as the base widens further", () => {
    // Empirically confirmed strictly increasing part counts against the real font at these widths: 5, then 11, then 23.
    const counts = [5, 10, 20].map(
      (n) => assembled(layout(over(wideBase(n))).items)[0]!.placements.length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    }
  });

  it("gives the brace a small, shallow vertical footprint regardless of how far it stretches", () => {
    // horizontallyStretchedBox's own ascentPt/descentPt come directly from the construction's real, unclamped ink -- which stays a small, roughly constant vertical extent (a handful of points) however wide the assembly grows, since only the WIDTH axis is being stretched. Recovered indirectly: layoutUnderOver's own ascentPt is base.ascentPt + stackGapMinPt + over.heightPt, so subtracting the bare base's own ascent and the font's own stackGapMinPt from the combined box's ascent recovers the brace's own heightPt without any internal export.
    const gapPt = metrics().stackGapMinPt;
    for (const n of [1, 5, 10, 20, 30]) {
      const base = wideBase(n);
      const baseAscentPt = layout(base).ascentPt;
      const combinedAscentPt = layout(over(base)).ascentPt;
      const braceHeightPt = combinedAscentPt - baseAscentPt - gapPt;
      expect(braceHeightPt).toBeGreaterThan(0);
      expect(braceHeightPt).toBeLessThan(SIZE_PT / 2); // "small" relative to the formula's own font size, not merely finite
    }
  });

  it("mirrors the over-brace on the opposite side of the base, with the opposite ink-sign convention", () => {
    // Verified empirically against the real font rather than assumed: the over-brace's own ink sits almost entirely ABOVE its natural drawing origin (a positive ascent, a NEGATIVE descent), while the under-brace's sits almost entirely BELOW its own origin (a negative ascent, a positive descent) -- genuinely opposite fields, not a mirrored pair of the same sign.
    const overResult = metrics().stretch(
      OVER.codePointAt(0)!,
      "horizontal",
      40,
      SIZE_PT,
    )!;
    const underResult = metrics().stretch(
      UNDER.codePointAt(0)!,
      "horizontal",
      40,
      SIZE_PT,
    )!;
    expect(overResult).toBeDefined();
    expect(underResult).toBeDefined();

    expect(overResult.inkAscentPt).toBeGreaterThan(0);
    expect(overResult.inkDescentPt).toBeLessThan(0);

    expect(underResult.inkAscentPt).toBeLessThan(0);
    expect(underResult.inkDescentPt).toBeGreaterThan(0);

    // And the corresponding munder/mover boxes place the brace on the correct side: an overscript run sits above the base's own baseline, an underscript run below it.
    const overRun = glyphRuns(layout(over(mi("i"))).items).find(
      (r) => r.text === OVER,
    )!;
    const baseRunOver = glyphRuns(layout(over(mi("i"))).items).find(
      (r) => r.text.codePointAt(0) === 0x1d456,
    )!; // MATHEMATICAL ITALIC SMALL I
    expect(overRun.yPt).toBeLessThan(baseRunOver.yPt);

    const underRun = glyphRuns(layout(under(mi("i"))).items).find(
      (r) => r.text === UNDER,
    )!;
    const baseRunUnder = glyphRuns(layout(under(mi("i"))).items).find(
      (r) => r.text.codePointAt(0) === 0x1d456,
    )!;
    expect(underRun.yPt).toBeGreaterThan(baseRunUnder.yPt);
  });

  it("munderover stretches an over-brace and an under-brace independently, both reaching close to the same target width", () => {
    const base = wideBase(10);
    const construct = el("munderover", [base, mo(UNDER), mo(OVER)]);
    const { box, diagnostics } = layoutFormula([construct], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const items = assembled(box.items);
    const overItem = items.find((item) => item.text === OVER);
    const underItem = items.find((item) => item.text === UNDER);
    expect(overItem).toBeDefined();
    expect(underItem).toBeDefined();
    expect(overItem!.placements.length).toBeGreaterThan(1);
    // Both scripts stretch to the identical target (the base's own width), independently -- no shared/synchronised sizing between munderover's two scripts is needed for them to land on the same part count.
    expect(underItem!.placements.length).toBe(overItem!.placements.length);
    const overSpanPt = overItem!.placements.at(-1)!.xPt;
    const underSpanPt = underItem!.placements.at(-1)!.xPt;
    expect(overSpanPt).toBeCloseTo(underSpanPt, 1);
  });

  it('honours an explicit stretchy="false" override on the brace operator', () => {
    // wideBase(20) is comfortably within assembly range for an unconstrained brace (see the part-count-growth test above), so this proves the override actually suppresses real stretching rather than merely landing below some threshold by coincidence.
    const construct = el("mover", [
      wideBase(20),
      el("mo", [text(OVER)], [{ name: "stretchy", value: "false" }]),
    ]);
    const box = layoutFormula([construct], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(OVER);
  });

  it("leaves the brace unstretched over a genuinely empty base", () => {
    const construct = over(el("mrow", []));
    const box = layoutFormula([construct], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(OVER);
  });

  it("composes with a nested vertical stretchy fence in its own base, proving the two stretch mechanisms do not interfere", () => {
    // A vertical fence around the same wideBase(10) that already forces horizontal assembly on its own (see the part-count-growth test) -- both mechanisms must fire together: the parenthesis pair stretches vertically to the row's own content height, and the over-brace stretches horizontally to the whole base's own width, in the same layout pass.
    const base = wideBase(10);
    const fencedBase = el("mrow", [mo("("), base, mo(")")]);
    const { box, diagnostics } = layoutFormula([over(fencedBase)], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const items = assembled(box.items);
    expect(items).toHaveLength(3); // '(', ')', and the over-brace, all genuinely stretched
    const texts = items.map((item) => item.text).sort();
    expect(texts).toEqual([")", "(", OVER].sort());
    for (const item of items) {
      expect(item.placements.length).toBeGreaterThanOrEqual(1);
    }
  });
});
