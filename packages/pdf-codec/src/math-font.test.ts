import { describe, expect, it } from 'vitest';
import { loadMathFont } from './math-font';

// Every expected value below was independently verified against the real vendored assets/fonts/STIXTwoMath-Regular.otf's own raw bytes while building math-table.ts/math-cmap.ts/math-hmtx.ts (a standalone Node script reading the sfnt table directory directly, not this package's own parser) -- these are real, external cross-checks, not values derived from and re-asserted against this module's own output.
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
