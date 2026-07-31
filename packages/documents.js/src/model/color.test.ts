import { describe, expect, it } from 'vitest';
import { colorToRgbHex, rgbHexToColor } from './color';

// rgbHexToColor/colorToRgbHex are re-exported/aliased from ooxml.js (see color.ts's top-of-file comment) -- their own exhaustive coverage, and applyColorTransforms/ColorTransform's, now lives there. These tests confirm only that the re-export resolves and behaves as documents.js callers expect.

describe('color', () => {
  it('rgbHexToColor parses with and without a leading #', () => {
    expect(rgbHexToColor('#FF0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(rgbHexToColor('00FF00')).toEqual({ r: 0, g: 1, b: 0 });
    expect(rgbHexToColor('0000ff')).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('colorToRgbHex is the exact inverse of rgbHexToColor for byte-aligned values', () => {
    for (const hex of ['ff0000', '00ff00', '0000ff', 'abcdef', '000000', 'ffffff']) {
      expect(colorToRgbHex(rgbHexToColor(hex))).toBe(hex);
    }
  });

  it('throws on a malformed hex colour rather than substituting a default', () => {
    expect(() => rgbHexToColor('not-a-color')).toThrow();
    expect(() => rgbHexToColor('#fff')).toThrow();
  });
});
