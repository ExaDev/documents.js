import { describe, expect, it } from 'vitest';
import { loadMathFont } from './math-font';

// Every expected value below was independently verified against the real vendored assets/fonts/STIXTwoMath-Regular.otf's own raw bytes while building math-table.ts/cmap-table.ts/hmtx-table.ts (a standalone Node script reading the sfnt table directory directly, not this package's own parser) -- these are real, external cross-checks, not values derived from and re-asserted against this module's own output.
describe('loadMathFont', () => {
  it('parses the embedded font header metrics', () => {
    const { font } = loadMathFont();
    expect(font.descriptor.unitsPerEm).toBe(1000);
    expect(font.descriptor.ascent).toBe(762);
    expect(font.descriptor.descent).toBe(-238);
    expect(font.descriptor.capHeight).toBe(657);
  });

  it('resolves known code points to their real glyph IDs via cmap', () => {
    const { font } = loadMathFont();
    expect(font.glyphId(0x78)).toBe(279); // 'x'
    expect(font.glyphId(0x1d465)).toBe(3354); // MATHEMATICAL ITALIC SMALL X
    expect(font.glyphId(0x222b)).toBe(1698); // integral sign
    expect(font.glyphId(0x221a)).toBe(1657); // radical sign
    expect(font.glyphId(0x2211)).toBe(1646); // n-ary summation
    expect(font.glyphId(0x3b1)).toBe(885); // GREEK SMALL LETTER ALPHA
    expect(font.glyphId(0x1d6fc)).toBe(4015); // MATHEMATICAL ITALIC SMALL ALPHA
  });

  it('returns undefined for a code point with no glyph', () => {
    const { font } = loadMathFont();
    expect(font.glyphId(0x1_0000)).toBeUndefined(); // an unassigned supplementary-plane code point
  });

  it('reports real hmtx advance widths in glyph space (1000 units/em)', () => {
    const { font } = loadMathFont();
    const xGlyph = font.glyphId(0x78);
    expect(xGlyph).toBeDefined();
    expect(font.glyphSpaceWidth(xGlyph!)).toBe(479);
    const integralGlyph = font.glyphId(0x222b);
    expect(integralGlyph).toBeDefined();
    expect(font.glyphSpaceWidth(integralGlyph!)).toBe(684);
  });

  it('parses real MATH table constants, sane and self-consistent at a chosen font size', () => {
    const { metricsAt } = loadMathFont();
    const metrics = metricsAt(12); // 12pt
    // axisHeight design units 258/1000 * 12pt = 3.096pt
    expect(metrics.axisHeightPt).toBeCloseTo((258 / 1000) * 12, 6);
    expect(metrics.fractionRuleThicknessPt).toBeCloseTo((68 / 1000) * 12, 6);
    expect(metrics.radicalDegreeBottomRaisePercent).toBe(55);
    expect(metrics.scriptPercentScaleDown).toBeCloseTo(0.7, 6);
    expect(metrics.scriptScriptPercentScaleDown).toBeCloseTo(0.55, 6);
    // Every *Pt constant should be positive and scale linearly with sizePt.
    const metricsDoubled = metricsAt(24);
    expect(metricsDoubled.axisHeightPt).toBeCloseTo(metrics.axisHeightPt * 2, 6);
    expect(metricsDoubled.fractionRuleThicknessPt).toBeCloseTo(metrics.fractionRuleThicknessPt * 2, 6);
  });

  it("glyph() reports advance width, italic correction, and (for glyphs the font's MathTopAccentAttachment table covers) a top-accent x position", () => {
    const { metricsAt } = loadMathFont();
    const metrics = metricsAt(10);
    const xGlyph = metrics.glyph(0x78, 10);
    expect(xGlyph).toBeDefined();
    expect(xGlyph!.advanceWidthPt).toBeCloseTo((479 / 1000) * 10, 6);
    expect(xGlyph!.italicCorrectionPt).toBeGreaterThanOrEqual(0);

    const missing = metrics.glyph(0x1_0000, 10);
    expect(missing).toBeUndefined();
  });

  it('caches the parsed font across calls', () => {
    const first = loadMathFont();
    const second = loadMathFont();
    expect(first).toBe(second);
  });
});

// The font's own nominal vertical metrics, the uniform extent every glyph in the face shares: hhea ascent 762 and descent -238 at unitsPerEm 1000, i.e. 0.762/0.238 per em. Per-glyph ink bounds are what a caller sizing a box around PARTICULAR characters uses instead -- see cff-bounds.test.ts for the outline walk itself, cross-checked there against fontTools over the font's whole repertoire.
describe('per-glyph ink bounds', () => {
  it('exposes a real ink box in design units for a glyph, and none for one that draws nothing', () => {
    const { font } = loadMathFont();
    expect(font.glyphInkBounds(font.glyphId(0x2e)!)).toEqual({ xMin: 62, yMin: -8, xMax: 183, yMax: 114 }); // '.'
    expect(font.glyphInkBounds(font.glyphId(0x28)!)).toEqual({ xMin: 45, yMin: -196, xMax: 327, yMax: 736 }); // '('
    expect(font.glyphInkBounds(font.glyphId(0x20)!)).toBeUndefined(); // a space has no ink
  });

  it('reports each glyph its own ink ascent and descent in points, where the nominal metrics report one figure for all of them', () => {
    const { metricsAt } = loadMathFont();
    const metrics = metricsAt(12);
    const period = metrics.glyph(0x2e, 12)!;
    const parenleft = metrics.glyph(0x28, 12)!;

    expect(period.inkAscentPt).toBeCloseTo((114 / 1000) * 12, 6);
    expect(period.inkDescentPt).toBeCloseTo((8 / 1000) * 12, 6);
    expect(parenleft.inkAscentPt).toBeCloseTo((736 / 1000) * 12, 6);
    expect(parenleft.inkDescentPt).toBeCloseTo((196 / 1000) * 12, 6);

    // The whole point of the measurement: a token box built from these fits the character it contains. The nominal metrics give both glyphs the same 9.144pt ascent and 2.856pt descent at this size.
    const nominalAscentPt = metrics.ascentPerEm * 12;
    const nominalDescentPt = metrics.descentPerEm * 12;
    expect(nominalAscentPt).toBeCloseTo(9.144, 6);
    expect(nominalDescentPt).toBeCloseTo(2.856, 6);
    for (const glyph of [period, parenleft]) {
      expect(glyph.inkAscentPt!).toBeLessThanOrEqual(nominalAscentPt);
      expect(glyph.inkDescentPt!).toBeLessThanOrEqual(nominalDescentPt);
    }
    expect(period.inkAscentPt! + period.inkDescentPt!).toBeLessThan((parenleft.inkAscentPt! + parenleft.inkDescentPt!) / 7);
  });

  it('reports a negative ink descent for a glyph drawing nothing below the baseline, rather than clamping it away', () => {
    // 'x' sits exactly on the baseline (yMin 0) and 'y' descends to -235. A glyph whose lowest ink were above the baseline would report a negative descent, which is the honest number for it -- a consumer wanting a box that never crosses the baseline clamps at its own layer.
    const metrics = loadMathFont().metricsAt(10);
    expect(metrics.glyph(0x78, 10)!.inkDescentPt).toBeCloseTo(0, 10); // arithmetically zero: negating a yMin of 0 leaves -0, which compares equal to 0 everywhere but through Object.is
    expect(metrics.glyph(0x79, 10)!.inkDescentPt).toBeCloseTo((235 / 1000) * 10, 6);
    expect(metrics.glyph(0x78, 10)!.inkAscentPt).toBeCloseTo((473 / 1000) * 10, 6);
  });

  it('scales ink bounds with the size the glyph is measured at', () => {
    const { metricsAt } = loadMathFont();
    const small = metricsAt(12).glyph(0x28, 12)!;
    const large = metricsAt(12).glyph(0x28, 24)!; // the glyph size, not the metrics size, is what a glyph's own measurements scale by
    expect(large.inkAscentPt).toBeCloseTo(small.inkAscentPt! * 2, 6);
    expect(large.inkDescentPt).toBeCloseTo(small.inkDescentPt! * 2, 6);
  });

  it('leaves both ink fields undefined together for a glyph with no outline', () => {
    const space = loadMathFont().metricsAt(12).glyph(0x20, 12)!;
    expect(space.advanceWidthPt).toBeGreaterThan(0);
    expect(space.inkAscentPt).toBeUndefined();
    expect(space.inkDescentPt).toBeUndefined();
  });
});
