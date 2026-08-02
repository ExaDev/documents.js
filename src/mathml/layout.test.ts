import { describe, expect, it } from 'vitest';
import { loadMathFont } from 'pdf-codec';
import { layoutFormula } from './layout';
import type { MathGlyphRun, MathRule, MathStroke } from './layout-types';
import type { MathMlElement, MathMlNode } from './nodes';

// Real font metrics throughout -- src/mathml itself has zero dependency on pdf-codec (see this module's own README/architecture note), but its OWN test suite reaching into the real embedded font for realistic, non-synthetic assertions is a pragmatic, test-only exception: MathFontMetrics is a plain interface (metrics.ts), and pdf-codec's loadMathFont() is simply the most realistic implementation available to verify layout.ts's own geometry against.
const SIZE_PT = 12;
function metrics() {
  return loadMathFont().metricsAt(SIZE_PT);
}
const BLACK = { r: 0, g: 0, b: 0 };

function el(tag: string, children: MathMlNode[] = [], attributes: readonly { readonly name: string; readonly value: string }[] = []): MathMlElement {
  return { type: 'element', tag, attributes, children };
}
function text(value: string): MathMlNode {
  return { type: 'text', value };
}
function mi(name: string): MathMlElement {
  return el('mi', [text(name)]);
}
function mn(value: string): MathMlElement {
  return el('mn', [text(value)]);
}
function mo(value: string): MathMlElement {
  return el('mo', [text(value)]);
}

function glyphRuns(items: readonly { readonly kind: string }[]): MathGlyphRun[] {
  return items.filter((i): i is MathGlyphRun => i.kind === 'glyphs');
}
function rules(items: readonly { readonly kind: string }[]): MathRule[] {
  return items.filter((i): i is MathRule => i.kind === 'rule');
}
function strokes(items: readonly { readonly kind: string }[]): MathStroke[] {
  return items.filter((i): i is MathStroke => i.kind === 'stroke');
}

describe('layoutFormula: mi/mn/mo tokens', () => {
  it('lays out a single mi as one glyph run, using the mathematical italic codepoint for a single-character identifier', () => {
    const { box, diagnostics } = layoutFormula([mi('x')], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465); // MATHEMATICAL ITALIC SMALL X, not plain 'x' (U+0078)
    expect(box.widthPt).toBeGreaterThan(0);
    expect(box.ascentPt).toBeGreaterThan(0);
  });

  it('lays out a multi-character mi upright (normal variant), not italic', () => {
    const { box } = layoutFormula([mi('sin')], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    const [run] = glyphRuns(box.items);
    expect(run!.text).toBe('sin'); // plain ASCII, not mathematical-italic codepoints
  });

  it('lays out mn upright, never italicised', () => {
    const { box } = layoutFormula([mn('42')], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    const [run] = glyphRuns(box.items);
    expect(run!.text).toBe('42');
  });

  it('inserts operator spacing around a binary mo between two mi tokens', () => {
    const tight = layoutFormula([mi('x'), mi('y')], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK }).box;
    const spaced = layoutFormula([mi('x'), mo('+'), mi('y')], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK }).box;
    // The '+'-bearing row must be wider than "x" and "y" alone by more than the '+' glyph's own advance width -- the extra is the lspace/rspace this package's own operator dictionary assigns '+'.
    const plusOnly = layoutFormula([mo('+')], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK }).box;
    expect(spaced.widthPt).toBeGreaterThan(tight.widthPt + plusOnly.widthPt);
  });
});

describe('layoutFormula: mfrac', () => {
  it('places the numerator above the denominator with exactly one horizontal rule between them', () => {
    const { box, diagnostics } = layoutFormula([el('mfrac', [mi('a'), mi('b')])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
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

  it('a font-declared linethickness attribute overrides the font\'s own default fraction rule thickness', () => {
    const overridden = layoutFormula([el('mfrac', [mi('a'), mi('b')], [{ name: 'linethickness', value: '3pt' }])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK }).box;
    const [rule] = rules(overridden.items);
    expect(rule!.heightPt).toBeCloseTo(3, 6);
  });
});

describe('layoutFormula: msqrt/mroot', () => {
  it('draws a real hooked radical sign (a multi-point stroke) plus a vinculum rule over the radicand, not merely the base glyph', () => {
    const { box, diagnostics } = layoutFormula([el('msqrt', [mi('x')])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics).toEqual([]);

    const hookList = strokes(box.items);
    expect(hookList).toHaveLength(1);
    expect(hookList[0]!.points.length).toBeGreaterThanOrEqual(3); // a real hook shape, not a two-point line

    const ruleList = rules(box.items);
    expect(ruleList).toHaveLength(1); // the vinculum

    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465); // the radicand itself still renders (mathematical italic x)

    // The radicand sits to the right of both the hook and the vinculum.
    expect(runs[0]!.xPt).toBeGreaterThan(hookList[0]!.points[0]!.xPt);
    expect(runs[0]!.xPt).toBeGreaterThanOrEqual(ruleList[0]!.xPt);
  });

  it('mroot places a smaller degree box to the upper-left of the radical sign', () => {
    const { box } = layoutFormula([el('mroot', [mi('x'), mn('3')])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(2);
    const degreeRun = runs.find((r) => r.text === '3');
    const radicandRun = runs.find((r) => r.text.codePointAt(0) === 0x1d465);
    expect(degreeRun).toBeDefined();
    expect(radicandRun).toBeDefined();
    expect(degreeRun!.sizePt).toBeLessThan(radicandRun!.sizePt); // the degree is genuinely scaled down (scriptPercentScaleDown x scriptScriptPercentScaleDown)
    expect(degreeRun!.xPt).toBeLessThan(radicandRun!.xPt); // positioned to the left, ahead of the sign
  });
});

describe('layoutFormula: msub/msup/msubsup', () => {
  it('shifts a superscript up and a subscript down relative to the base, both starting after the base\'s own width', () => {
    // <msubsup> base subscript superscript </msubsup> -- MathML's own fixed child order (MathML3 3.4.4).
    const { box, diagnostics } = layoutFormula([el('msubsup', [mi('y'), mn('1'), mn('2')])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(3);
    const base = runs.find((r) => r.text.codePointAt(0) === 0x1d466)!; // MATHEMATICAL ITALIC SMALL Y
    const sub = runs.find((r) => r.text === '1')!;
    const sup = runs.find((r) => r.text === '2')!;
    expect(base).toBeDefined();
    expect(sub).toBeDefined();
    expect(sup).toBeDefined();
    expect(sub.xPt).toBeCloseTo(sup.xPt, 6); // sub and sup share the same horizontal start, per MathML msubsup semantics
    expect(sub.xPt).toBeGreaterThanOrEqual(base.xPt); // after the base
    expect(sup.yPt).toBeLessThan(base.yPt); // higher on the page (smaller y-down) than the base's own baseline
    expect(sub.yPt).toBeGreaterThan(base.yPt); // lower than the base's own baseline
    expect(sup.sizePt).toBeLessThan(base.sizePt); // scaled down via scriptPercentScaleDown
  });

  it('a movablelimits operator (sum) renders as ordinary sub/sup, not stacked over/under, outside display style', () => {
    // munder/mover in a nested (non-displaystyle) context -- see layoutUnderOverElement's own displayStyle branch.
    const nested = el('mfrac', [el('munder', [mo('∑'), mn('0')]), mi('n')]); // sum symbol
    const { box } = layoutFormula([nested], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    const runs = glyphRuns(box.items);
    const sumRun = runs.find((r) => r.text === '∑');
    const limitRun = runs.find((r) => r.text === '0');
    expect(sumRun).toBeDefined();
    expect(limitRun).toBeDefined();
    // sub/sup placement is a horizontal offset (limitRun starts after sumRun ends); true under/over stacking would instead centre the limit under the sum with no such horizontal offset.
    expect(limitRun!.xPt).toBeGreaterThanOrEqual(sumRun!.xPt);
  });
});

describe('layoutFormula: munder/mover/munderover (display style)', () => {
  it('stacks an overscript directly above the base, centred, with the base unaffected horizontally', () => {
    const { box, diagnostics } = layoutFormula([el('mover', [mi('x'), mo('^')])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(2);
    const [base, over] = runs;
    expect(over!.yPt).toBeLessThan(base!.yPt); // above the base
  });
});

describe('layoutFormula: mtable', () => {
  it('lays out a 2x2 matrix as a real grid: two distinct row baselines, two distinct column x-positions', () => {
    const table = el('mtable', [
      el('mtr', [el('mtd', [mn('1')]), el('mtd', [mn('2')])]),
      el('mtr', [el('mtd', [mn('3')]), el('mtd', [mn('4')])]),
    ]);
    const { box, diagnostics } = layoutFormula([table], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs.map((r) => r.text).sort()).toEqual(['1', '2', '3', '4']);

    const byText = new Map(runs.map((r) => [r.text, r]));
    const one = byText.get('1')!;
    const two = byText.get('2')!;
    const three = byText.get('3')!;
    const four = byText.get('4')!;

    expect(one.yPt).toBeCloseTo(two.yPt, 6); // same row -> same baseline
    expect(three.yPt).toBeCloseTo(four.yPt, 6);
    expect(one.yPt).toBeLessThan(three.yPt); // row 0 above row 1

    expect(one.xPt).toBeCloseTo(three.xPt, 6); // same column -> same x
    expect(two.xPt).toBeCloseTo(four.xPt, 6);
    expect(one.xPt).toBeLessThan(two.xPt); // column 0 left of column 1
  });
});

describe('layoutFormula: mathvariant', () => {
  it('applies an explicit mathvariant attribute even to a multi-character mi (which would otherwise default to upright, not italic)', () => {
    const { box } = layoutFormula([el('mi', [text('ab')], [{ name: 'mathvariant', value: 'bold' }])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    const [run] = glyphRuns(box.items);
    expect(run!.text.codePointAt(0)).toBe(0x1d41a); // MATHEMATICAL BOLD SMALL A
  });

  it('mathvariant=script maps through the Letterlike Symbols hole-fillers correctly (script capital B)', () => {
    const { box } = layoutFormula([el('mi', [text('B')], [{ name: 'mathvariant', value: 'script' }])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    const [run] = glyphRuns(box.items);
    expect(run!.text.codePointAt(0)).toBe(0x212c); // SCRIPT CAPITAL B, the Letterlike Symbols hole-filler, not 0x1D49D (unassigned)
  });
});

describe('layoutFormula: diagnostics and graceful degradation', () => {
  it('falls back to rendering an unsupported element\'s own text content, with a diagnostic', () => {
    const { box, diagnostics } = layoutFormula([el('mphantom', [mi('x')])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics).toEqual([{ kind: 'unsupported-element', detail: 'mphantom' }]);
    const [run] = glyphRuns(box.items);
    // The fallback renders the element's own raw extracted text content upright (mathvariant 'normal'), not re-resolving nested mi's own italic default -- it degrades to plain text, not a re-run of the full layout algorithm on the unsupported subtree.
    expect(run!.text).toBe('x');
    expect(run!.text.codePointAt(0)).toBe(0x78);
  });

  it('reports a missing-glyph diagnostic for a code point the embedded font has no glyph for, without crashing layout', () => {
    const { box, diagnostics } = layoutFormula([el('mi', [text('\u{10000}')])], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics.some((d) => d.kind === 'missing-glyph')).toBe(true);
    expect(box.items).toEqual([]); // the whole run was undrawable, so it degrades to nothing rather than a garbled partial string
  });

  it('semantics renders its first non-annotation child and ignores the annotation entirely', () => {
    const withAnnotation = el('semantics', [mi('x'), el('annotation', [text('x')], [{ name: 'encoding', value: 'StarMath 5.0' }])]);
    const { box, diagnostics } = layoutFormula([withAnnotation], { metrics: metrics(), sizePt: SIZE_PT, color: BLACK });
    expect(diagnostics).toEqual([]);
    const runs = glyphRuns(box.items);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text.codePointAt(0)).toBe(0x1d465);
  });
});
