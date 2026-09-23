import { describe, expect, it } from "vitest";
import { loadMathFont } from "pdf-codec";
import { layoutFormula } from "./layout";
import { operatorProperties } from "./operators";
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
    // The fallback renders the element's own raw extracted text content upright (mathvariant 'normal'), not re-resolving nested mi's own italic default — it degrades to plain text, not a re-run of the full layout algorithm on the unsupported subtree.
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

    // Before this change every token box shared the identical nominal height (ascentPerEm + descentPerEm) * SIZE_PT regardless of glyph — these must now be the real, distinct injected ink bounds, not the nominal ones.
    expect(shortBox.ascentPt).toBeCloseTo(PERIOD_INK.inkAscentPt, 6);
    expect(shortBox.descentPt).toBeCloseTo(PERIOD_INK.inkDescentPt, 6);
    expect(tallBox.ascentPt).toBeCloseTo(BRACKET_INK.inkAscentPt, 6);
    expect(tallBox.descentPt).toBeCloseTo(BRACKET_INK.inkDescentPt, 6);

    expect(tallBox.heightPt).toBeGreaterThan(shortBox.heightPt);
    // A real, non-trivial numeric gap — (10 + 4) - (1 + 0.3) = 12.7pt — not rounding noise.
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

    // Order-independent: the taller glyph's own bounds win whether it is the first or second character — proving this is a real union, not "use the first character's metric".
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

// Stretchy fences drawn from the font's own OpenType MATH MathVariants data. Every glyph ID asserted below is looked up from the real font by the Unicode name of the piece it is — LEFT PARENTHESIS LOWER HOOK (U+239D) and friends — rather than hardcoded, which makes these assertions an external cross-check on which pieces the engine picked and in which order, not a restatement of whatever it produced. The bracket family is the one family whose assembly pieces Unicode gives code points to at all (the U+239B..U+23AD block); every other stretchy construction's pieces are unencoded, which is exactly why a placement carries a glyph ID rather than text.
describe("layoutFormula: stretchy fences", () => {
  const font = loadMathFont().font;
  const LEFT_PAREN_PIECES = [0x239d, 0x239c, 0x239b]; // lower hook, extension, upper hook — bottom to top
  const RIGHT_PAREN_PIECES = [0x239e, 0x239f, 0x23a0]; // upper hook, extension, lower hook (Unicode names the right-hand pieces top-first)
  const LEFT_BRACKET_PIECES = [0x23a3, 0x23a2, 0x23a1]; // LEFT SQUARE BRACKET LOWER CORNER / EXTENSION / UPPER CORNER

  function fenced(
    inner: MathMlElement,
    open = "(",
    close = ")",
  ): MathMlElement {
    return el("mrow", [mo(open), inner, mo(close)]);
  }
  // A fraction whose numerator is itself a fraction, nested `depth` times — the tallest thing this test can build out of ordinary MathML, and the only way to push a fence past the largest pre-built variant the font offers (3821 design units, 45.85pt at 12pt) into a genuine part assembly.
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
    // Nothing to assemble: 'x' is well inside the base parenthesis, so the operator keeps its real Unicode text — which is what keeps a plain (x) extracting as "(x)" from the resulting PDF.
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain("(");
    expect(glyphRuns(box.items).map((run) => run.text)).toContain(")");
  });

  it("selects a larger pre-built variant glyph for a fence around a single fraction", () => {
    const box = layout(fenced(nestedFraction(1)));
    const items = assembled(box.items);
    expect(items).toHaveLength(2);
    // One glyph each: a pre-built variant, not an assembly — a single-level fraction is well within the sizes STIX Two Math draws by hand.
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

    // Bottom hook, one or more extension pieces, top hook — identified by the Unicode code points of the pieces themselves, so this checks the engine picked the real parenthesis parts in the real bottom-to-top order the font lists them in.
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
    // A symmetric fence's own ascent and descent are (axis + h/2) and (h/2 - axis), so their difference is twice the axis height whatever h turns out to be — and because a symmetric fence always covers the content on both sides of the axis, the whole fenced row inherits that same difference. A baseline-aligned fence would instead show almost all of its height as ascent, so this is a real discriminator, not a tautology.
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

// Horizontal stretchy-glyph assembly for an over/under-brace (U+23DE/U+23DF) spanning its own munder/mover/munderover base — stretchOperator/stretchedBox's horizontal-axis sibling, stretchHorizontalOperator/horizontallyStretchedBox, exercised via layoutUnderOverChild.
//
// The over/under script of a munder/mover is laid out in scriptContext (a reduced sizePt, scriptPercentScaleDown of the outer size — see layoutUnderOverElement), so the base/variant/assembly breakpoints below are NOT the same target widths that would trigger each outcome for a bare mo at the outer sizePt: the font's own base-glyph advance and every pre-built variant size are all measured at that SAME reduced size, which this suite's own breakpoint probing (against the real embedded font, not guessed) confirmed shifts every threshold narrower. `wideBase(charCount)` mirrors nestedFraction's own "make a real MathML construct wide/tall enough to force a stretch" trick, but growing WIDTH via a flat mrow of single-character mi's rather than height via nested fractions.
describe("layoutFormula: horizontal stretchy over/under-brace", () => {
  const OVER = "⏞"; // U+23DE TOP CURLY BRACKET
  const UNDER = "⏟"; // U+23DF BOTTOM CURLY BRACKET

  // A flat row of `charCount` single-character mi's — width grows roughly linearly with charCount, with no ceiling the way a fixed-glyph base would have, letting this reach clean base/variant/assembly breakpoints purely by choosing charCount.
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
    // wideBase(5) already crosses into 'assembly' (empirically confirmed against the real font — the pre-built variants top out well before this width), giving several placements sharing one y and strictly increasing x, the first at x=0.
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
    // horizontallyStretchedBox's own ascentPt/descentPt come directly from the construction's real, unclamped ink — which stays a small, roughly constant vertical extent (a handful of points) however wide the assembly grows, since only the WIDTH axis is being stretched. Recovered indirectly: layoutUnderOver's own ascentPt is base.ascentPt + stackGapMinPt + over.heightPt, so subtracting the bare base's own ascent and the font's own stackGapMinPt from the combined box's ascent recovers the brace's own heightPt without any internal export.
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
    // Verified empirically against the real font rather than assumed: the over-brace's own ink sits almost entirely ABOVE its natural drawing origin (a positive ascent, a NEGATIVE descent), while the under-brace's sits almost entirely BELOW its own origin (a negative ascent, a positive descent) — genuinely opposite fields, not a mirrored pair of the same sign.
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
    // Both scripts stretch to the identical target (the base's own width), independently — no shared/synchronised sizing between munderover's two scripts is needed for them to land on the same part count.
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
    // A vertical fence around the same wideBase(10) that already forces horizontal assembly on its own (see the part-count-growth test) — both mechanisms must fire together: the parenthesis pair stretches vertically to the row's own content height, and the over-brace stretches horizontally to the whole base's own width, in the same layout pass.
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

describe("layoutFormula: operator spacing and row gaps", () => {
  it("gives the row's own first child no leading gap: a lone operator's width is exactly its glyph advance", () => {
    // '+' carries a non-zero lspace in the operator dictionary, so this pins that lspace contributes nothing BEFORE the first child — there is nothing to its left to space against.
    const box = layoutRoot(mo("+"));
    expect(box.widthPt).toBeCloseTo(
      metrics().glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt,
      6,
    );
  });

  it("adds exactly the operator's own lspace before it when the operator follows a token", () => {
    const m = metrics();
    const plusAdvancePt = m.glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt;
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const lspacePt = operatorProperties("+").lspaceEm * SIZE_PT;
    expect(layoutRoot(el("mrow", [mi("x"), mo("+")])).widthPt).toBeCloseTo(
      xWidthPt + plusAdvancePt + lspacePt,
      6,
    );
  });

  it("adds exactly the operator's own rspace after it when a token follows the operator", () => {
    const m = metrics();
    const plusAdvancePt = m.glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt;
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const rspacePt = operatorProperties("+").rspaceEm * SIZE_PT;
    expect(layoutRoot(el("mrow", [mo("+"), mi("x")])).widthPt).toBeCloseTo(
      plusAdvancePt + rspacePt + xWidthPt,
      6,
    );
  });

  it("applies lspace and rspace independently on either side of one operator between two tokens", () => {
    const m = metrics();
    const plusAdvancePt = m.glyph("+".codePointAt(0)!, SIZE_PT)!.advanceWidthPt;
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const yWidthPt = layoutRoot(mi("y")).widthPt;
    const spacing = operatorProperties("+");
    expect(
      layoutRoot(el("mrow", [mi("x"), mo("+"), mi("y")])).widthPt,
    ).toBeCloseTo(
      xWidthPt +
        plusAdvancePt +
        yWidthPt +
        (spacing.lspaceEm + spacing.rspaceEm) * SIZE_PT,
      6,
    );
  });

  it("a non-operator element contributes no spacing of its own between two tokens", () => {
    const xWidthPt = layoutRoot(mi("x")).widthPt;
    const yWidthPt = layoutRoot(mi("y")).widthPt;
    expect(
      layoutRoot(el("mrow", [mi("x"), el("mrow", []), mi("y")])).widthPt,
    ).toBeCloseTo(xWidthPt + yWidthPt, 6);
  });

  it("trims padded operator text before both rendering it and resolving its dictionary entry", () => {
    // A producer writing <mo> + </mo> with whitespace must get the dictionary's '+' spacing and a run holding exactly "+", exactly as the unpadded spelling does.
    const padded = el("mo", [text(" + ")]);
    const unpaddedWidthPt = layoutRoot(
      el("mrow", [mi("x"), mo("+"), mi("y")]),
    ).widthPt;
    expect(
      layoutRoot(el("mrow", [mi("x"), padded, mi("y")])).widthPt,
    ).toBeCloseTo(unpaddedWidthPt, 6);
    const [run] = glyphRuns(layoutRoot(padded).items);
    expect(run!.text).toBe("+");
  });

  it("a padded stretchy fence still stretches, and its assembled text is the trimmed operator", () => {
    const paddedRow = el("mrow", [
      el("mo", [text(" ( ")]),
      fraction123(),
      el("mo", [text(" ) ")]),
    ]);
    const items = assembled(layoutRoot(paddedRow).items);
    expect(items.map((item) => item.text).sort()).toEqual(["(", ")"]);
  });
});

describe("layoutFormula: which operators stretch", () => {
  it("an mi whose content is a fence character is a token, not an operator, and never stretches", () => {
    // isStretchyOperator gates on the element's own name, not on its text: an <mi>(</mi> next to tall content stays a plain run even though "(" is stretchy in the operator dictionary.
    const row = el("mrow", [mi("("), fraction123()]);
    const box = layoutRoot(row);
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toContain("(");
  });

  it("a row consisting only of stretchy operators stretches none of them, even against a font that always offers a construction", () => {
    // The stretch target is the row's NON-stretchy children, of which this row has none — so no fence may grow, however willing the font is. The synthetic metrics port guarantees willingness, so the assertion cannot pass by the real font's coincidental inability to build a small construction.
    const alwaysStretch: MathFontMetrics = {
      ...metrics(),
      stretch: (codePoint, _axis, targetSizePt) => ({
        kind: "variant",
        sizePt: targetSizePt,
        advanceWidthPt: 4,
        inkAscentPt: targetSizePt / 2,
        inkDescentPt: targetSizePt / 2,
        placements: [{ glyphId: codePoint, offsetPt: 0 }],
      }),
    };
    const box = layoutRoot(el("mrow", [mo("("), mo(")")]), alwaysStretch);
    expect(assembled(box.items)).toHaveLength(0);
    expect(glyphRuns(box.items).map((run) => run.text)).toEqual(["(", ")"]);
  });

  it("a mixed row stretches exactly its stretchy operators and leaves the token untouched", () => {
    const alwaysStretch: MathFontMetrics = {
      ...metrics(),
      stretch: (codePoint, axis, targetSizePt) => ({
        kind: "variant",
        sizePt: targetSizePt,
        advanceWidthPt: 4,
        inkAscentPt: targetSizePt / 2,
        inkDescentPt: targetSizePt / 2,
        placements: [{ glyphId: codePoint, offsetPt: 0 }],
      }),
    };
    const items = assembled(
      layoutRoot(el("mrow", [mo("("), mi("x"), mo(")")]), alwaysStretch).items,
    );
    expect(items.map((item) => item.text).sort()).toEqual(["(", ")"]);
  });
});

describe("layoutFormula: display style and script scaling", () => {
  // The OpenType MATH fraction shifts, restated from the metrics port rather than imported from layout.ts: shift = max(font shift for the style, axis + rule/2 + gap + content extent).
  function expectedNumeratorShiftUpPt(
    m: MathFontMetrics,
    ruleThicknessPt: number,
    numeratorDescentPt: number,
    display: boolean,
  ): number {
    return Math.max(
      display
        ? m.fractionNumeratorDisplayShiftUpPt
        : m.fractionNumeratorShiftUpPt,
      m.axisHeightPt +
        ruleThicknessPt / 2 +
        m.fractionNumeratorGapMinPt +
        numeratorDescentPt,
    );
  }

  it("root level is display style: a fraction's numerator uses the font's display shift", () => {
    const m = metrics();
    const numeratorBox = layoutRoot(mi("a"));
    const shiftUpPt = expectedNumeratorShiftUpPt(
      m,
      m.fractionRuleThicknessPt,
      numeratorBox.descentPt,
      true,
    );
    expect(layoutRoot(el("mfrac", [mi("a"), mi("b")])).ascentPt).toBeCloseTo(
      shiftUpPt + numeratorBox.ascentPt,
      6,
    );
  });

  it('mstyle displaystyle="false" switches nested constructs out of display style', () => {
    const m = metrics();
    const numeratorBox = layoutRoot(mi("a"));
    const shiftUpPt = expectedNumeratorShiftUpPt(
      m,
      m.fractionRuleThicknessPt,
      numeratorBox.descentPt,
      false,
    );
    const styled = el(
      "mstyle",
      [el("mfrac", [mi("a"), mi("b")])],
      [{ name: "displaystyle", value: "false" }],
    );
    expect(layoutRoot(styled).ascentPt).toBeCloseTo(
      shiftUpPt + numeratorBox.ascentPt,
      6,
    );
  });

  it('mstyle displaystyle="true" restores display style inside an already non-display context', () => {
    // A fraction's own children are non-display; an mstyle around the inner fraction must win that back. Both variants are asserted absolutely against the measured inner boxes (each measured standalone under an mstyle forcing its own style), because the outer fraction's own shift term also reacts to the inner box's descent.
    const m = metrics();
    const numeratorWith = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "true" }],
      ),
    );
    const numeratorWithout = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "false" }],
      ),
    );
    // The outer fraction sits at root level, so its own shift uses the display term.
    const outerShift = (numerator: MathBoxLike) =>
      Math.max(
        m.fractionNumeratorDisplayShiftUpPt,
        m.axisHeightPt +
          m.fractionRuleThicknessPt / 2 +
          m.fractionNumeratorGapMinPt +
          numerator.descentPt,
      );
    const withRestore = el("mfrac", [
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "true" }],
      ),
      mi("b"),
    ]);
    const withoutRestore = el("mfrac", [
      el("mfrac", [mi("a"), mi("b")]),
      mi("b"),
    ]);
    expect(layoutRoot(withRestore).ascentPt).toBeCloseTo(
      outerShift(numeratorWith) + numeratorWith.ascentPt,
      6,
    );
    expect(layoutRoot(withoutRestore).ascentPt).toBeCloseTo(
      outerShift(numeratorWithout) + numeratorWithout.ascentPt,
      6,
    );
  });

  it("an unrecognised displaystyle value changes nothing: the inherited style stands", () => {
    const plain = layoutRoot(el("mfrac", [mi("a"), mi("b")])).ascentPt;
    const bogus = layoutRoot(
      el(
        "mstyle",
        [el("mfrac", [mi("a"), mi("b")])],
        [{ name: "displaystyle", value: "perhaps" }],
      ),
    ).ascentPt;
    expect(bogus).toBeCloseTo(plain, 6);
  });

  it("a root-level movablelimits operator stacks its limit under the base in display style", () => {
    // Display style renders \sum_{0} as a genuine under-script centred under the sign. The under script itself renders at script size, so its width is measured at that size; a sub/sup placement would instead put the limit flush after the sign's full advance.
    const sumWidthPt = layoutRoot(mo("∑")).widthPt;
    const zeroWidthPt = layoutAtScriptSize(mn("0")).widthPt;
    const box = layoutRoot(el("munder", [mo("∑"), mn("0")]));
    const zeroRun = glyphRuns(box.items).find((run) => run.text === "0")!;
    expect(zeroRun.xPt).toBeCloseTo((sumWidthPt - zeroWidthPt) / 2, 6);
  });

  it("scripts render at scriptPercentScaleDown of the base size, and script-script size at the second level", () => {
    const m = metrics();
    const sub = glyphRuns(
      layoutRoot(el("msub", [mi("x"), mn("1")])).items,
    ).find((run) => run.text === "1")!;
    expect(sub.sizePt).toBeCloseTo(m.scriptPercentScaleDown * SIZE_PT, 6);

    // mroot's degree is two script levels deep.
    const degree = glyphRuns(
      layoutRoot(el("mroot", [mi("x"), mn("3")])).items,
    ).find((run) => run.text === "3")!;
    expect(degree.sizePt).toBeCloseTo(
      m.scriptPercentScaleDown * m.scriptScriptPercentScaleDown * SIZE_PT,
      6,
    );

    // A script nested inside a script of its own reaches the second level the same way.
    const nested = glyphRuns(
      layoutRoot(el("msub", [mi("x"), el("msub", [mi("y"), mn("1")])])).items,
    ).find((run) => run.text === "1")!;
    expect(nested.sizePt).toBeCloseTo(
      m.scriptPercentScaleDown * m.scriptScriptPercentScaleDown * SIZE_PT,
      6,
    );
  });

  it("a script context is not display style: a movablelimits munder inside a subscript renders its limit as a plain subscript", () => {
    // Inside the subscript, the ∑'s own munder takes the non-display branch (limit as subscript, horizontally after the sign) rather than stacking. The whole munder renders at the script's reduced size, so the sign's advance is measured at that size too.
    const box = layoutRoot(
      el("msub", [mi("x"), el("munder", [mo("∑"), mn("0")])]),
    );
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((run) => run.text === "∑")!;
    const limitRun = runs.find((run) => run.text === "0")!;
    const sumWidthPt = layoutAtScriptSize(mo("∑")).widthPt;
    expect(limitRun.xPt).toBeCloseTo(
      sumRun.xPt + sumWidthPt, // after the full sign advance, not centred under it
      3,
    );
  });
});

describe("layoutFormula: mstyle mathvariant inheritance", () => {
  it("mstyle mathvariant overrides a descendant token's intrinsic default", () => {
    const styled = el(
      "mstyle",
      [mi("ab")],
      [{ name: "mathvariant", value: "bold" }],
    );
    const [run] = glyphRuns(layoutRoot(styled).items);
    expect(run!.text.codePointAt(0)).toBe(0x1d41a); // MATHEMATICAL BOLD SMALL A — "ab" would be upright without the inherited bold
  });

  it("an invalid mstyle mathvariant value is ignored, leaving the token's own intrinsic default", () => {
    const styled = el(
      "mstyle",
      [mi("x")],
      [{ name: "mathvariant", value: "not-a-variant" }],
    );
    const [run] = glyphRuns(layoutRoot(styled).items);
    expect(run!.text.codePointAt(0)).toBe(0x1d465); // still the mathematical italic single-letter default
  });

  it("a token's own explicit mathvariant beats the mstyle-inherited one", () => {
    const styled = el(
      "mstyle",
      [el("mi", [text("ab")], [{ name: "mathvariant", value: "fraktur" }])],
      [{ name: "mathvariant", value: "bold" }],
    );
    const [run] = glyphRuns(layoutRoot(styled).items);
    expect(run!.text.codePointAt(0)).toBe(0x1d51e); // MATHEMATICAL FRAKTUR SMALL A, not the bold the mstyle asked for
  });
});

describe("layoutFormula: mspace", () => {
  it("resolves width/height/depth attributes into an empty box of exactly that geometry", () => {
    const space = el(
      "mspace",
      [],
      [
        { name: "width", value: "2em" },
        { name: "height", value: "1em" },
        { name: "depth", value: "0.5em" },
      ],
    );
    const box = layoutRoot(space);
    expect(box.widthPt).toBeCloseTo(2 * SIZE_PT, 6);
    expect(box.ascentPt).toBeCloseTo(SIZE_PT, 6);
    expect(box.descentPt).toBeCloseTo(SIZE_PT / 2, 6);
    expect(box.heightPt).toBeCloseTo(SIZE_PT * 1.5, 6);
    expect(box.items).toEqual([]);
  });

  it("absent attributes default to zero, and negative extents clamp to zero", () => {
    const bare = layoutRoot(el("mspace", []));
    expect(bare.widthPt).toBe(0);
    expect(bare.ascentPt).toBe(0);
    expect(bare.descentPt).toBe(0);
    expect(bare.items).toEqual([]);

    const negative = layoutRoot(
      el(
        "mspace",
        [],
        [
          { name: "width", value: "-1em" },
          { name: "height", value: "-2em" },
        ],
      ),
    );
    expect(negative.widthPt).toBe(0);
    expect(negative.ascentPt).toBe(0);
  });

  it("honours non-em units through the shared length parser", () => {
    const inPt = layoutRoot(
      el("mspace", [], [{ name: "width", value: "1in" }]),
    );
    expect(inPt.widthPt).toBeCloseTo(72, 6);
  });
});

describe("layoutFormula: missing-glyph diagnostic detail", () => {
  it("formats the code point as upper-case hex, zero-padded to four digits", () => {
    // U+008C is a C1 control the embedded math font has no glyph for, and its two-hex-digit upper-case form ("8C") exercises both the padding and the case in one character: the detail must be exactly "U+008C".
    const { diagnostics } = layoutFormula([el("mi", [text("\u{8c}")])], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([{ kind: "missing-glyph", detail: "U+008C" }]);
  });

  it("does not truncate longer code points", () => {
    const { diagnostics } = layoutFormula([el("mi", [text("\u{10000}")])], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([{ kind: "missing-glyph", detail: "U+10000" }]);
  });
});

describe("layoutFormula: semantics child selection", () => {
  it("skips a leading annotation child rather than rendering it", () => {
    const wrapped = el("semantics", [
      el(
        "annotation",
        [text("a mapping, not content")],
        [{ name: "encoding", value: "StarMath 5.0" }],
      ),
      mi("x"),
    ]);
    const { box, diagnostics } = layoutFormula([wrapped], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465); // the mi's content, italic — the annotation's own text was never rendered
  });

  it("skips annotation-xml children wherever they appear", () => {
    const leading = el("semantics", [el("annotation-xml", [mi("n")]), mi("x")]);
    const trailing = el("semantics", [
      mi("x"),
      el("annotation-xml", [mi("n")]),
    ]);
    for (const wrapped of [leading, trailing]) {
      const runs = glyphRuns(
        layoutFormula([wrapped], {
          metrics: metrics(),
          sizePt: SIZE_PT,
          color: BLACK,
        }).box.items,
      );
      expect(runs).toHaveLength(1);
      expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465);
    }
  });

  it("a semantics element containing only annotations lays out to the empty box", () => {
    const onlyAnnotations = el("semantics", [
      el("annotation", [text("x")]),
      el("annotation-xml", [mi("n")]),
    ]);
    const box = layoutFormula([onlyAnnotations], {
      metrics: metrics(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    expect(box.items).toEqual([]);
    expect(box.widthPt).toBe(0);
  });
});

describe("layoutFormula: msub/msup script geometry", () => {
  // The OpenType MATH script-shift formulas, restated from the metrics port: supShift = max(shift-up (cramped or not), base.ascent - baselineDropMax); subShift = max(shift-down, base.descent + baselineDropMin). A lone script never takes a gap correction — that exists only to keep a subscript and superscript of ONE construct apart.
  function expectedSupShiftUpPt(base: MathBoxLike, cramped: boolean): number {
    const m = metrics();
    return Math.max(
      cramped ? m.superscriptShiftUpCrampedPt : m.superscriptShiftUpPt,
      base.ascentPt - m.superscriptBaselineDropMaxPt,
    );
  }
  function expectedSubShiftDownPt(base: MathBoxLike): number {
    const m = metrics();
    return Math.max(
      m.subscriptShiftDownPt,
      base.descentPt + m.subscriptBaselineDropMinPt,
    );
  }

  it("places a lone subscript exactly one shift below the base's own baseline, after the base's own width", () => {
    const m = metrics();
    const base = layoutRoot(mi("x"));
    const sub = layoutAtScriptSize(mn("1"));
    const box = layoutRoot(el("msub", [mi("x"), mn("1")]));
    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d465)!;
    const subRun = runs.find((run) => run.text === "1")!;
    expect(subRun.xPt).toBeCloseTo(base.widthPt, 6);
    // Box-local y-down: a run's own yPt is its baseline, so the subscript's baseline sits exactly subShift below the base's.
    expect(subRun.yPt - baseRun.yPt).toBeCloseTo(
      expectedSubShiftDownPt(base),
      6,
    );
    expect(box.widthPt).toBeCloseTo(
      base.widthPt + sub.widthPt + m.spaceAfterScriptPt,
      6,
    );
  });

  it("places a lone superscript exactly one shift above the base's own baseline, after the base's own width", () => {
    const base = layoutRoot(mi("x"));
    const box = layoutRoot(el("msup", [mi("x"), mn("2")]));
    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d465)!;
    const supRun = runs.find((run) => run.text === "2")!;
    expect(supRun.xPt).toBeCloseTo(base.widthPt, 6);
    expect(baseRun.yPt - supRun.yPt).toBeCloseTo(
      expectedSupShiftUpPt(base, false),
      6,
    );
  });

  it("a construct with no script at all keeps exactly the base's own width: no script space is added", () => {
    const base = layoutRoot(mi("x"));
    for (const construct of ["msub", "msup", "msubsup"]) {
      const box = layoutRoot(el(construct, [mi("x")]));
      expect(box.widthPt).toBeCloseTo(base.widthPt, 6);
      expect(glyphRuns(box.items)).toHaveLength(1);
    }
  });

  it("a script construct with no base at all lays out to the empty box", () => {
    for (const construct of ["msub", "msup", "msubsup"]) {
      const box = layoutRoot(el(construct, []));
      expect(box.items).toEqual([]);
      expect(box.widthPt).toBe(0);
    }
  });

  it("splits the sub/superscript gap correction evenly between the two scripts when they clear each other by less than the minimum", () => {
    // Tall bracket scripts (the injected 10pt/4pt ink) above and below a short base overlap each other vertically, so the font's subSuperscriptGapMin forces both shifts outward by half the deficit each. A real-font baseline/descent pair like italic y plus digits clears the minimum already, which is exactly why the injected ink exists.
    const m = metrics();
    const font = metricsWithInk();
    const layoutWithInk = (root: MathMlElement, sizePt = SIZE_PT) =>
      layoutFormula([root], { metrics: font, sizePt, color: BLACK }).box;
    const base = layoutWithInk(mi("x"));
    const sub = layoutWithInk(mo("["), m.scriptPercentScaleDown * SIZE_PT);
    const sup = layoutWithInk(mo("["), m.scriptPercentScaleDown * SIZE_PT);
    const supShiftPt = expectedSupShiftUpPt(base, false);
    const subShiftPt = expectedSubShiftDownPt(base);
    const gapPt = supShiftPt - sup.descentPt + (subShiftPt - sub.ascentPt);
    const correctionPt = Math.max(0, m.subSuperscriptGapMinPt - gapPt) / 2;
    expect(correctionPt).toBeGreaterThan(0); // the premise: this construct genuinely needs the correction

    const box = layoutWithInk(el("msubsup", [mi("x"), mo("["), mo("[")]));
    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d465)!;
    const bracketRuns = runs.filter((run) => run.text === "[");
    expect(bracketRuns).toHaveLength(2);
    const supRun = bracketRuns[0]!; // items are emitted base, then superscript, then subscript
    const subRun = bracketRuns[1]!;
    expect(subRun.yPt - baseRun.yPt).toBeCloseTo(subShiftPt + correctionPt, 6);
    expect(baseRun.yPt - supRun.yPt).toBeCloseTo(supShiftPt + correctionPt, 6);
    // The combined box grows to contain both corrected scripts.
    expect(box.ascentPt).toBeCloseTo(
      Math.max(base.ascentPt, supShiftPt + correctionPt + sup.ascentPt),
      6,
    );
    expect(box.descentPt).toBeCloseTo(
      Math.max(base.descentPt, subShiftPt + correctionPt + sub.descentPt),
      6,
    );
  });

  it("applies no correction when the two scripts already clear each other by more than the minimum", () => {
    // A short subscript (the period's injected 1pt ink ascent) sits far below a flat-descent superscript: the gap exceeds subSuperscriptGapMin and neither script may move.
    const m = metrics();
    const base = layoutRoot(mi("y"));
    const sub = layoutFormula([mo(".")], {
      metrics: metricsWithInk(),
      sizePt: m.scriptPercentScaleDown * SIZE_PT,
      color: BLACK,
    }).box;
    const sup = layoutAtScriptSize(mn("2"));
    const supShiftPt = expectedSupShiftUpPt(base, false);
    const subShiftPt = expectedSubShiftDownPt(base);
    const gapPt = supShiftPt - sup.descentPt + (subShiftPt - sub.ascentPt);
    expect(m.subSuperscriptGapMinPt - gapPt).toBeLessThan(0); // the premise: no correction is due

    const box = layoutFormula([el("msubsup", [mi("y"), mo("."), mn("2")])], {
      metrics: metricsWithInk(),
      sizePt: SIZE_PT,
      color: BLACK,
    }).box;
    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d466)!;
    const subRun = runs.find((run) => run.text === ".")!;
    expect(subRun.yPt - baseRun.yPt).toBeCloseTo(subShiftPt, 6);
  });

  it("sizes the script column to the wider of the two scripts, not their sum", () => {
    const m = metrics();
    const base = layoutRoot(mi("y"));
    const narrow = layoutAtScriptSize(mn("1"));
    const wide = layoutAtScriptSize(mtext("wider"));
    const box = layoutRoot(el("msubsup", [mi("y"), mn("1"), mtext("wider")]));
    expect(box.widthPt).toBeCloseTo(
      base.widthPt +
        Math.max(narrow.widthPt, wide.widthPt) +
        m.spaceAfterScriptPt,
      6,
    );
  });
});

describe("layoutFormula: cramped script contexts", () => {
  // The vertical gap between a script run's own baseline and its base run's baseline, recovered from any layout however deeply the construct is nested — crampedness only ever changes which superscript shift the font contributes.
  function supBaselineGapPt(box: MathBoxLike, supText: string): number {
    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d466)!; // italic y
    const supRun = runs.find((run) => run.text === supText)!;
    return baseRun.yPt - supRun.yPt;
  }
  function expectedSupGapPt(base: MathBoxLike, cramped: boolean): number {
    const m = metrics();
    return Math.max(
      cramped ? m.superscriptShiftUpCrampedPt : m.superscriptShiftUpPt,
      base.ascentPt - m.superscriptBaselineDropMaxPt,
    );
  }

  it("a fraction's numerator is not cramped: its superscript uses the ordinary shift", () => {
    // The numerator and denominator render at the fraction's own size, so both are measurable standalone at SIZE_PT.
    const base = layoutRoot(mi("y"));
    const numerator = layoutRoot(
      el("mfrac", [el("msup", [mi("y"), mn("2")]), mn("3")]),
    );
    expect(supBaselineGapPt(numerator, "2")).toBeCloseTo(
      expectedSupGapPt(base, false),
      6,
    );
  });

  it("a fraction's denominator is cramped: its superscript uses the cramped shift", () => {
    const base = layoutRoot(mi("y"));
    const denominator = layoutRoot(
      el("mfrac", [mn("3"), el("msup", [mi("y"), mn("2")])]),
    );
    expect(supBaselineGapPt(denominator, "2")).toBeCloseTo(
      expectedSupGapPt(base, true),
      6,
    );
  });

  it("a radical's radicand is cramped, in both msqrt and mroot", () => {
    const base = layoutRoot(mi("y"));
    const msqrtRadicand = layoutRoot(
      el("msqrt", [el("msup", [mi("y"), mn("2")])]),
    );
    expect(supBaselineGapPt(msqrtRadicand, "2")).toBeCloseTo(
      expectedSupGapPt(base, true),
      6,
    );
    const mrootRadicand = layoutRoot(
      el("mroot", [el("msup", [mi("y"), mn("2")]), mn("3")]),
    );
    expect(supBaselineGapPt(mrootRadicand, "2")).toBeCloseTo(
      expectedSupGapPt(base, true),
      6,
    );
  });

  it("mroot's degree script context is itself not cramped", () => {
    // The degree's own superscript (a third level of nesting) must use the ordinary shift, at the degree's own script-script size.
    const m = metrics();
    const degreeSizePt =
      m.scriptPercentScaleDown * m.scriptScriptPercentScaleDown * SIZE_PT;
    const base = layoutFormula([mi("3")], {
      metrics: metrics(),
      sizePt: degreeSizePt,
      color: BLACK,
    }).box;
    const box = layoutRoot(
      el("mroot", [mi("x"), el("msup", [mn("3"), mn("2")])]),
    );
    const runs = glyphRuns(box.items);
    const degreeRun = runs.find((run) => run.text === "3")!;
    const supRun = runs.find((run) => run.text === "2")!;
    expect(degreeRun.yPt - supRun.yPt).toBeCloseTo(
      Math.max(
        m.superscriptShiftUpPt,
        base.ascentPt - m.superscriptBaselineDropMaxPt,
      ),
      6,
    );
  });
});

describe("layoutFormula: mover/munder/munderover stacking geometry", () => {
  it("stacks an overscript exactly one stack-gap above the base's own ink, centred on the combined width", () => {
    const m = metrics();
    const base = layoutRoot(mi("x"));
    const over = layoutAtScriptSize(mn("2")); // over/under scripts render at script size
    const box = layoutRoot(el("mover", [mi("x"), mn("2")]));
    expect(box.ascentPt).toBeCloseTo(
      base.ascentPt + m.stackGapMinPt + over.heightPt,
      6,
    );
    expect(box.widthPt).toBeCloseTo(Math.max(base.widthPt, over.widthPt), 6);

    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d465)!;
    const overRun = runs.find((run) => run.text === "2")!;
    // The over script's own bottom edge sits stackGap above the base's own top edge, so the distance between the two runs' baselines is the base's ascent, the gap, and the over script's own descent.
    expect(baseRun.yPt - overRun.yPt).toBeCloseTo(
      base.ascentPt + m.stackGapMinPt + over.descentPt,
      6,
    );
    expect(overRun.xPt).toBeCloseTo((box.widthPt - over.widthPt) / 2, 6);
    // The base itself is centred in the combined width too (here the wider of the two).
    expect(baseRun.xPt).toBeCloseTo((box.widthPt - base.widthPt) / 2, 6);
  });

  it("stacks an underscript exactly one stack-gap below the base's own ink, centred on the combined width", () => {
    const m = metrics();
    const base = layoutRoot(mi("x"));
    const under = layoutAtScriptSize(mn("2"));
    const box = layoutRoot(el("munder", [mi("x"), mn("2")]));
    expect(box.descentPt).toBeCloseTo(
      base.descentPt + m.stackGapMinPt + under.heightPt,
      6,
    );

    const runs = glyphRuns(box.items);
    const baseRun = runs.find((run) => run.text.codePointAt(0) === 0x1d465)!;
    const underRun = runs.find((run) => run.text === "2")!;
    // The under script's own top edge sits stackGap below the base's own bottom edge: the baseline distance is the base's descent, the gap, and the under script's own ascent.
    expect(underRun.yPt - baseRun.yPt).toBeCloseTo(
      base.descentPt + m.stackGapMinPt + under.ascentPt,
      6,
    );
  });

  it("munderover stacks both scripts at once, each independently against the base's own edges", () => {
    const m = metrics();
    const base = layoutRoot(mi("x"));
    const under = layoutAtScriptSize(mn("1"));
    const over = layoutAtScriptSize(mn("2"));
    const box = layoutRoot(el("munderover", [mi("x"), mn("1"), mn("2")]));
    expect(box.ascentPt).toBeCloseTo(
      base.ascentPt + m.stackGapMinPt + over.heightPt,
      6,
    );
    expect(box.descentPt).toBeCloseTo(
      base.descentPt + m.stackGapMinPt + under.heightPt,
      6,
    );
    expect(box.widthPt).toBeCloseTo(
      Math.max(base.widthPt, under.widthPt, over.widthPt),
      6,
    );
  });

  it("an under or over script wider than the base centres the base inside the combined width", () => {
    const base = layoutRoot(mi("x"));
    const box = layoutRoot(el("mover", [mi("x"), mtext("wide over text")]));
    const overRun = glyphRuns(box.items).find(
      (run) => run.text === "wide over text",
    )!;
    const baseRun = glyphRuns(box.items).find(
      (run) => run.text.codePointAt(0) === 0x1d465,
    )!;
    // The widest element spans the full box from x=0, and the narrower base is centred within it.
    expect(overRun.xPt).toBeCloseTo(0, 6);
    expect(baseRun.xPt).toBeCloseTo((box.widthPt - base.widthPt) / 2, 6);
  });
});

describe("layoutFormula: accent-attachment centring details", () => {
  it('centres an accentunder="true" underscript at the base glyph\'s own attachment point', () => {
    // The arrow is far wider than the base, so geometric centring pins the arrow at x=0 while attachment-point centring shifts it right by the base's own attachment offset — measured from the same sub-layouts rather than assumed.
    const base = layoutRoot(mi("v")); // italic v: attachment point right of its half-width because the glyph slants
    const under = layoutAtScriptSize(mo("→"));
    const construct = el(
      "munder",
      [mi("v"), mo("→")],
      [{ name: "accentunder", value: "true" }],
    );
    const box = layoutRoot(construct);
    const underRun = glyphRuns(box.items).find((run) => run.text === "→")!;
    const geometricXPt = (box.widthPt - under.widthPt) / 2;
    const baseXPt = (box.widthPt - base.widthPt) / 2;
    const attachmentPt = metrics().glyph(0x1d463, SIZE_PT)!.topAccentXPt!; // italic v
    expect(underRun.xPt).toBeCloseTo(
      baseXPt + attachmentPt - under.widthPt / 2,
      6,
    );
    expect(underRun.xPt).toBeGreaterThan(geometricXPt + 0.5); // a real shift, not rounding noise
  });

  it("resolves the attachment point for mn, mtext, and mo bases, each on its own", () => {
    // A single-digit base has a genuine MathTopAccentAttachment entry slightly left of its geometric centre, so attachment-point centring and plain geometric centring disagree measurably for each token kind.
    const arrow = () => mo("→");
    const expectedXPt = (
      base: MathBoxLike,
      over: MathBoxLike,
      box: MathBoxLike,
    ) => {
      const baseXPt = (box.widthPt - base.widthPt) / 2;
      const attachmentPt = metrics().glyph(
        "1".codePointAt(0)!,
        SIZE_PT,
      )!.topAccentXPt!;
      return baseXPt + attachmentPt - over.widthPt / 2;
    };
    for (const baseElement of [mn("1"), mtext("1"), el("mo", [text(" 1 ")])]) {
      const base = layoutRoot(baseElement);
      const over = layoutAtScriptSize(mo("→"));
      const construct = el(
        "mover",
        [baseElement, arrow()],
        [{ name: "accent", value: "true" }],
      );
      const box = layoutRoot(construct);
      const overRun = glyphRuns(box.items).find((run) => run.text === "→")!;
      expect(overRun.xPt).toBeCloseTo(expectedXPt(base, over, box), 6);
    }
  });

  it("falls back to geometric centring for a base that is not a single token glyph", () => {
    // An mrow base has no single attachment entry at all, so accent="true" must not move the arrow off the geometric centre.
    const withAccent = el(
      "mover",
      [el("mrow", [mi("x")]), mo("→")],
      [{ name: "accent", value: "true" }],
    );
    const box = layoutRoot(withAccent);
    const overRun = glyphRuns(box.items).find((run) => run.text === "→")!;
    expect(overRun.xPt).toBeCloseTo(0, 6); // the arrow is the widest element, so geometric centring is flush left
  });

  it("an munderover carrying only accentunder opts exactly its under script into attachment centring", () => {
    // accentunder alone must leave the OVER script geometrically centred, the under script attachment-centred — the two flags are independent.
    const base = layoutRoot(mi("v"));
    const under = layoutAtScriptSize(mo("→"));
    const box = layoutRoot(
      el(
        "munderover",
        [mi("v"), mo("→"), mo("→")],
        [{ name: "accentunder", value: "true" }],
      ),
    );
    const runs = glyphRuns(box.items).filter((run) => run.text === "→");
    expect(runs).toHaveLength(2);
    const overRun = runs[0]!; // items are emitted base, then over, then under
    const underRun = runs[1]!;
    expect(overRun.xPt).toBeCloseTo((box.widthPt - under.widthPt) / 2, 6);
    const baseXPt = (box.widthPt - base.widthPt) / 2;
    expect(underRun.xPt).toBeCloseTo(
      baseXPt +
        metrics().glyph(0x1d463, SIZE_PT)!.topAccentXPt! -
        under.widthPt / 2,
      6,
    );
  });
});

describe("layoutFormula: movablelimits outside display style", () => {
  // A fraction's children render non-display, which is the cheapest way to push a movablelimits construct off display style.
  function nonDisplay(root: MathMlElement): MathBoxLike {
    return layoutRoot(el("mfrac", [root, mn("9")]));
  }

  it("renders munder as a plain subscript: the limit follows the base horizontally", () => {
    const box = nonDisplay(el("munder", [mo("∑"), mn("0")]));
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((run) => run.text === "∑")!;
    const limitRun = runs.find((run) => run.text === "0")!;
    const sumWidthPt = layoutRoot(mo("∑")).widthPt;
    expect(limitRun.xPt).toBeCloseTo(sumRun.xPt + sumWidthPt, 6);
    expect(limitRun.yPt).toBeGreaterThan(sumRun.yPt); // genuinely below the base's baseline, not centred under it
  });

  it("renders mover as a plain superscript: the limit follows the base horizontally, above its baseline", () => {
    const box = nonDisplay(el("mover", [mo("∑"), mn("0")]));
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((run) => run.text === "∑")!;
    const limitRun = runs.find((run) => run.text === "0")!;
    const sumWidthPt = layoutRoot(mo("∑")).widthPt;
    expect(limitRun.xPt).toBeCloseTo(sumRun.xPt + sumWidthPt, 6);
    expect(limitRun.yPt).toBeLessThan(sumRun.yPt); // above the base's baseline, not stacked over it
  });

  it("renders munderover as a sub/superscript pair sharing one horizontal start", () => {
    const box = nonDisplay(el("munderover", [mo("∑"), mn("0"), mn("1")]));
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((run) => run.text === "∑")!;
    const subRun = runs.find((run) => run.text === "0")!;
    const supRun = runs.find((run) => run.text === "1")!;
    expect(subRun.xPt).toBeCloseTo(supRun.xPt, 6);
    expect(subRun.xPt).toBeCloseTo(sumRun.xPt + layoutRoot(mo("∑")).widthPt, 6);
  });

  it("movablelimits is a property of the mo element: an mi holding the same glyph stacks instead", () => {
    // isMovableLimitsOperator must gate on the element's name: <mi>∑</mi> is a token, so its munder takes the true stacked branch even outside display style.
    const box = nonDisplay(el("munder", [mi("∑"), mn("0")]));
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((run) => run.text === "∑")!;
    const limitRun = runs.find((run) => run.text === "0")!;
    const sumWidthPt = layoutRoot(mi("∑")).widthPt;
    // Stacked: the limit is centred under the sign (its left edge well inside the sign's advance), where a subscript would start flush at the advance.
    expect(limitRun.xPt).toBeLessThan(sumRun.xPt + sumWidthPt - 1);
  });
});

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
