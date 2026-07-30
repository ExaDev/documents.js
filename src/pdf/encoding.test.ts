import { describe, expect, it } from 'vitest';
import { WINANSI_GLYPH_NAMES, glyphNameToUnicode, winAnsiGlyphName } from './encoding';

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

describe('glyphNameToUnicode', () => {
  it('resolves an ASCII glyph name to its own code point', () => {
    expect(glyphNameToUnicode('A')).toBe(0x41);
  });

  it('resolves a CP1252-extension glyph name to its real Unicode value', () => {
    expect(glyphNameToUnicode('eacute')).toBe(0xe9);
    expect(glyphNameToUnicode('Euro')).toBe(0x20ac);
  });

  it('resolves the one real "bullet" entry, unclobbered by the placeholder duplicates in WINANSI_GLYPH_NAMES', () => {
    expect(glyphNameToUnicode('bullet')).toBe(0x2022);
  });

  it('resolves "space" to the ordinary space, not the non-breaking space that shares the same glyph name at 0xA0', () => {
    expect(glyphNameToUnicode('space')).toBe(0x20);
  });

  it('returns undefined for a name outside the WinAnsi set', () => {
    expect(glyphNameToUnicode('not-a-real-glyph-name')).toBeUndefined();
  });
});
