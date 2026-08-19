import { describe, expect, it } from 'vitest';
import { STANDARD_METRICS, widthOfCode } from './afm-widths';
import { WINANSI_GLYPH_NAMES } from './encoding';

// Spot-check values against the published Adobe Core-14 AFM data (cross-verified during implementation against the Hopding/standard-fonts mirror -- see the module's own provenance comment), not trusted from memory alone.
describe('STANDARD_METRICS spot checks', () => {
  it('Helvetica: space=278, A=667, M=833, W=944, i=222', () => {
    const w = STANDARD_METRICS.Helvetica.widths;
    expect(w.get('space')).toBe(278);
    expect(w.get('A')).toBe(667);
    expect(w.get('M')).toBe(833);
    expect(w.get('W')).toBe(944);
    expect(w.get('i')).toBe(222);
  });

  it('Times-Roman: space=250, A=722', () => {
    const w = STANDARD_METRICS['Times-Roman'].widths;
    expect(w.get('space')).toBe(250);
    expect(w.get('A')).toBe(722);
  });

  it('every Courier face is a fixed 600 units wide', () => {
    for (const face of ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'] as const) {
      expect(STANDARD_METRICS[face].fixedWidth).toBe(600);
    }
  });

  it('Helvetica ascender/descender/capHeight/xHeight/underline metrics match the AFM', () => {
    const m = STANDARD_METRICS.Helvetica;
    expect(m.ascender).toBe(718);
    expect(m.descender).toBe(-207);
    expect(m.capHeight).toBe(718);
    expect(m.xHeight).toBe(523);
    expect(m.underlinePosition).toBe(-100);
    expect(m.underlineThickness).toBe(50);
  });

  it('every WinAnsi code 32-255 with a non-empty glyph name resolves to a width for every proportional face', () => {
    const proportionalFaces = [
      'Helvetica',
      'Helvetica-Bold',
      'Helvetica-Oblique',
      'Helvetica-BoldOblique',
      'Times-Roman',
      'Times-Bold',
      'Times-Italic',
      'Times-BoldItalic',
    ] as const;
    for (const face of proportionalFaces) {
      for (let code = 32; code < 256; code++) {
        const glyphName = WINANSI_GLYPH_NAMES[code];
        if (glyphName === undefined || glyphName === '') {
          continue;
        }
        expect(STANDARD_METRICS[face].widths.get(glyphName)).toBeDefined();
      }
    }
  });
});

describe('widthOfCode', () => {
  it('returns the fixed width for Courier regardless of code', () => {
    expect(widthOfCode('Courier', 65)).toBe(600);
    expect(widthOfCode('Courier', 105)).toBe(600);
  });

  it('returns the AFM width for a proportional face', () => {
    expect(widthOfCode('Helvetica', 65)).toBe(667); // 'A'
  });

  it('throws for a code with no WinAnsi glyph mapping', () => {
    expect(() => widthOfCode('Helvetica', 1)).toThrow(/WinAnsi/);
  });
});
