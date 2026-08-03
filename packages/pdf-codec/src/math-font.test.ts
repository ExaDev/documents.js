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

// MathFontMetrics.stretch is the port documents.js's own MathML layout engine reaches stretchy glyphs through: math-stretch.ts already picks the variant or assembles the parts (and is tested against the real font in math-stretch.test.ts), so what is checked here is the layer this module adds on top -- converting to points at the caller's size, and MEASURING the resulting construction's real ink so a caller can place it. Every design-unit figure quoted below comes from the same raw-font values math-stretch.test.ts asserts, or from the glyph ink bounds cff-bounds.ts reads; the arithmetic is worked through in the comments rather than recorded from a run.
describe('MathFontMetrics.stretch', () => {
  const SIZE_PT = 12; // 1000 units/em, so exactly 0.012pt per design unit
  const PAREN = 0x28;

  it('reports a pre-built variant, measured from the variant glyph\'s own outline rather than its nominal advance', () => {
    const result = loadMathFont().metricsAt(SIZE_PT).stretch(PAREN, 'vertical', 20, SIZE_PT);
    expect(result).toBeDefined();
    expect(result!.kind).toBe('variant');
    // 20pt is 1666.67 design units, which the 1667-unit variant (glyph 1303) just covers.
    expect(result!.placements).toEqual([{ glyphId: 1303, offsetPt: 0 }]);
    expect(result!.sizePt).toBeCloseTo(1667 * 0.012, 9);
    // That variant's own ink runs -563..1103 and its advance width is 427 -- all three genuinely differ from the base glyph's (-196..736, 357), which is the point of selecting a variant at all.
    expect(result!.inkAscentPt).toBeCloseTo(1103 * 0.012, 9);
    expect(result!.inkDescentPt).toBeCloseTo(563 * 0.012, 9);
    expect(result!.advanceWidthPt).toBeCloseTo(427 * 0.012, 9);
  });

  it('reports the base glyph unchanged when it already reaches the target', () => {
    const { font, metricsAt } = loadMathFont();
    const result = metricsAt(SIZE_PT).stretch(PAREN, 'vertical', 10, SIZE_PT);
    expect(result!.kind).toBe('base');
    expect(result!.placements).toEqual([{ glyphId: font.glyphId(PAREN), offsetPt: 0 }]);
    expect(result!.inkAscentPt).toBeCloseTo(736 * 0.012, 9);
    expect(result!.inkDescentPt).toBeCloseTo(196 * 0.012, 9);
  });

  it('measures an assembled construction across every part, offsets included', () => {
    const result = loadMathFont().metricsAt(SIZE_PT).stretch(PAREN, 'vertical', 80, SIZE_PT);
    expect(result).toBeDefined();
    expect(result!.kind).toBe('assembly');
    // 80pt is 6666.67 design units: four repetitions of the 1252-unit extender between the 1273-unit hooks (7554 raw across six parts), with the five seams free to widen from the font's own 100-unit minimum up to the 250 the hooks' connectors allow -- (7554 - 6666.67) / 5 = 177.47 falls inside that range, so the construction lands exactly on the target.
    expect(result!.sizePt).toBeCloseTo(80, 9);
    expect(result!.placements.map((placement) => placement.glyphId)).toEqual([4862, 4861, 4861, 4861, 4861, 4860]);
    expect(result!.placements[0]!.offsetPt).toBe(0);
    // The last part's own offset is every preceding part's advance less one seam each: 1273 + 4x1252 - 5x177.4667.
    expect(result!.placements[5]!.offsetPt).toBeCloseTo((1273 + 4 * 1252 - 5 * ((7554 - 6666 - 2 / 3) / 5)) * 0.012, 6);
    // The topmost ink is the upper hook's own yMax (1272) lifted by that last offset; the lowest is the lower hook's own yMin, which is 0 -- so the construction's ink sits entirely at or above its drawing origin, which is exactly why a caller cannot centre it by assuming a symmetric extent.
    expect(result!.inkAscentPt).toBeCloseTo(result!.placements[5]!.offsetPt + 1272 * 0.012, 6);
    expect(result!.inkDescentPt).toBeCloseTo(0, 9);
    // Every part of a stretched parenthesis is drawn from the same 484-unit-wide pieces, wider than the base glyph's own 357.
    expect(result!.advanceWidthPt).toBeCloseTo(484 * 0.012, 9);
  });

  it('scales the whole construction with the size the operator is set at', () => {
    const { metricsAt } = loadMathFont();
    const small = metricsAt(12).stretch(PAREN, 'vertical', 40, 12)!;
    const large = metricsAt(24).stretch(PAREN, 'vertical', 80, 24)!;
    // The same target measured in ems, so the same construction, at twice the size.
    expect(large.placements.map((p) => p.glyphId)).toEqual(small.placements.map((p) => p.glyphId));
    expect(large.sizePt).toBeCloseTo(small.sizePt * 2, 9);
    expect(large.inkAscentPt).toBeCloseTo(small.inkAscentPt * 2, 9);
    expect(large.advanceWidthPt).toBeCloseTo(small.advanceWidthPt * 2, 9);
  });

  it('returns undefined for a glyph this font does not stretch, and for one it has no glyph for at all', () => {
    const metrics = loadMathFont().metricsAt(SIZE_PT);
    expect(metrics.stretch(0x78, 'vertical', 40, SIZE_PT)).toBeUndefined(); // 'x' -- not stretchy on either axis in this font
    expect(metrics.stretch(0x28, 'horizontal', 40, SIZE_PT)).toBeUndefined(); // a parenthesis stretches vertically only
    expect(metrics.stretch(0x1_0000, 'vertical', 40, SIZE_PT)).toBeUndefined(); // an unassigned code point
  });

  it('measures a HORIZONTAL construction across the axis it is NOT stretched along', () => {
    // The over-brace assembles left to right, so a part's own offset shifts it in x and leaves the ink extent purely vertical -- the opposite of the vertical case above, and the reason measureConstruction has to know which axis it is on.
    const result = loadMathFont().metricsAt(SIZE_PT).stretch(0x23de, 'horizontal', 60, SIZE_PT);
    expect(result).toBeDefined();
    expect(result!.kind).toBe('assembly');
    expect(result!.placements.length).toBeGreaterThan(1);
    expect(result!.inkAscentPt + result!.inkDescentPt).toBeLessThan(SIZE_PT); // a brace is a shallow band, however wide it is stretched
    expect(result!.sizePt).toBeGreaterThanOrEqual(60);
  });
});
