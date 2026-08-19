import { describe, expect, it } from 'vitest';
import { parseOdfLength, formatOdfLength } from './units';

// The cm-based fixtures below ("real LibreOffice output") are copied verbatim from a real style:paragraph-properties element produced by `soffice --headless --convert-to odt` (LibreOffice 26.2.5.2), the same fixture referenced by src/styles/properties.test.ts -- see that file's own top-of-file note.

describe('parseOdfLength', () => {
  it('parses every ODF length unit into points', () => {
    expect(parseOdfLength('12pt')).toBe(12);
    expect(parseOdfLength('1in')).toBe(72);
    expect(parseOdfLength('1pc')).toBe(12); // pica -- the unit most likely to be misremembered; 1pc = 12pt, not 6pt or 10pt.
    expect(parseOdfLength('2pc')).toBe(24);
    expect(parseOdfLength('100px')).toBe(75); // CSS reference pixel: 96px = 1in = 72pt.
    expect(parseOdfLength('96px')).toBe(72);
    expect(parseOdfLength('2.54cm')).toBeCloseTo(72, 10);
    expect(parseOdfLength('25.4mm')).toBeCloseTo(72, 10);
  });

  it('parses negative and fractional lengths', () => {
    expect(parseOdfLength('-0.5pt')).toBe(-0.5);
    expect(parseOdfLength('.5pt')).toBe(0.5);
  });

  it('parses real LibreOffice cm-based margins to the points the original pt-based CSS source specified', () => {
    // Fixture's CSS source was margin-top:12pt / margin-bottom:6pt / text-indent:18pt; LibreOffice re-expressed them in cm on round trip.
    expect(parseOdfLength('0.423cm')).toBeCloseTo(12, 1);
    expect(parseOdfLength('0.212cm')).toBeCloseTo(6, 1);
    expect(parseOdfLength('0.635cm')).toBeCloseTo(18, 1);
  });

  it('returns undefined for a malformed or unitless length', () => {
    expect(parseOdfLength('12')).toBeUndefined();
    expect(parseOdfLength('12em')).toBeUndefined();
    expect(parseOdfLength('auto')).toBeUndefined();
    expect(parseOdfLength('')).toBeUndefined();
    expect(parseOdfLength('12 pt')).toBeUndefined();
  });
});

describe('formatOdfLength', () => {
  it('defaults to "pt" when no unit is given', () => {
    expect(formatOdfLength(12)).toBe('12pt');
    expect(formatOdfLength(-4.5)).toBe('-4.5pt');
  });

  it('formats every unit, each round-tripping back through parseOdfLength to the original point value', () => {
    for (const unit of ['cm', 'mm', 'in', 'pt', 'pc', 'px'] as const) {
      const formatted = formatOdfLength(72, unit);
      expect(formatted.endsWith(unit)).toBe(true);
      expect(parseOdfLength(formatted)).toBeCloseTo(72, 9);
    }
  });

  it('formats a known exact value per unit', () => {
    expect(formatOdfLength(72, 'in')).toBe('1in');
    expect(formatOdfLength(12, 'pc')).toBe('1pc');
    expect(formatOdfLength(72, 'px')).toBe('96px');
  });
});
