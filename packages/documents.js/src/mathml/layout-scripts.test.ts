import { describe, expect, it } from "vitest";
import { loadMathFont } from "pdf-codec";
import { layoutFormula } from "./layout";
import type { MathFontMetrics, MathGlyphRun } from "document-schema.js";
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
