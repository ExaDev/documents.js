import { describe, expect, it } from 'vitest';
import { parseOdfColor, formatOdfColor } from './color';

describe('parseOdfColor', () => {
  it('parses a real fo:color hex value (LibreOffice output, style P2)', () => {
    expect(parseOdfColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseOdfColor('#004586')).toEqual({ r: 0, g: 0.27058823529411763, b: 0.5254901960784314 });
  });

  it('is case-insensitive on hex digits', () => {
    expect(parseOdfColor('#FF0000')).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('returns undefined for a value without the leading "#"', () => {
    expect(parseOdfColor('ff0000')).toBeUndefined();
  });

  it('returns undefined for a 3-digit CSS shorthand -- ODF has no such shorthand', () => {
    expect(parseOdfColor('#f00')).toBeUndefined();
  });

  it('returns undefined for a CSS named colour -- ODF never uses one', () => {
    expect(parseOdfColor('red')).toBeUndefined();
  });

  it('returns undefined for an rgb() function -- ODF never uses one', () => {
    expect(parseOdfColor('rgb(255, 0, 0)')).toBeUndefined();
  });

  it('returns undefined for malformed hex digits', () => {
    expect(parseOdfColor('#gggggg')).toBeUndefined();
  });
});

describe('formatOdfColor', () => {
  it('formats a colour as a lowercase 6-digit hex string with a leading "#"', () => {
    expect(formatOdfColor({ r: 1, g: 0, b: 0 })).toBe('#ff0000');
  });

  it('round-trips through parseOdfColor unchanged', () => {
    const color = { r: 0.2, g: 0.4, b: 0.6 };
    expect(parseOdfColor(formatOdfColor(color))).toEqual(color);
  });
});
