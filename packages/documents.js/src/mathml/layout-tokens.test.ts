import { describe, expect, it } from "vitest";
import { loadMathFont } from "pdf-codec";
import { layoutFormula } from "./layout";
import type { MathFontMetrics, MathGlyphRun } from "document-schema.js";
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
// A one-element fraction, tall enough that a fence around it selects a larger construction — the same "make the content tall" trick nestedFraction uses, kept small so the tests that only need SOME stretching stay fast.
// An mtd cell wrapping arbitrary content, and an mtr of digit cells, for the table tests outside the mtable describe's own scope.
// The same layout at the size a first-level script renders at (scriptPercentScaleDown of the base size) — a construct nested inside a sub/superscript or an over/under script must be measured at its own reduced size, not the formula's root size.
// The box shape returned by layoutFormula, named locally so the geometry sections below can take measured sub-layouts as parameters without importing the schema's own MathBox as a value-level symbol.

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
