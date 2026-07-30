import { describe, expect, it } from 'vitest';
import { WINANSI_GLYPH_NAMES, winAnsiGlyphName } from './encoding';

describe('WINANSI_GLYPH_NAMES', () => {
  it('has exactly 256 entries', () => {
    expect(WINANSI_GLYPH_NAMES).toHaveLength(256);
  });

  it('matches known reference code points', () => {
    expect(WINANSI_GLYPH_NAMES[32]).toBe('space');
    expect(WINANSI_GLYPH_NAMES[65]).toBe('A');
    expect(WINANSI_GLYPH_NAMES[97]).toBe('a');
    expect(WINANSI_GLYPH_NAMES[128]).toBe('Euro');
    expect(WINANSI_GLYPH_NAMES[233]).toBe('eacute');
    expect(WINANSI_GLYPH_NAMES[0xe9]).toBe('eacute');
  });

  it('leaves control codes (0-31) unassigned', () => {
    for (let code = 0; code < 32; code++) {
      expect(WINANSI_GLYPH_NAMES[code]).toBe('');
    }
  });
});

describe('winAnsiGlyphName', () => {
  it('returns the glyph name for an assigned code', () => {
    expect(winAnsiGlyphName(65)).toBe('A');
  });

  it('returns undefined for an unassigned control code', () => {
    expect(winAnsiGlyphName(1)).toBeUndefined();
  });

  it('returns undefined for a code outside the table', () => {
    expect(winAnsiGlyphName(300)).toBeUndefined();
  });
});
