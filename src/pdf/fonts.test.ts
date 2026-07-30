import { describe, expect, it } from 'vitest';
import { resolveFontFamily, resolveStandardFont } from './fonts';

describe('resolveFontFamily', () => {
  it('maps common sans-serif fonts (including Word\'s modern defaults) to Helvetica', () => {
    for (const name of ['Calibri', 'Aptos', 'Arial', 'Segoe UI', 'Verdana']) {
      expect(resolveFontFamily(name)).toEqual({ family: 'helvetica', matched: true });
    }
  });

  it('maps common serif fonts to Times', () => {
    for (const name of ['Times New Roman', 'Georgia', 'Cambria', 'Garamond']) {
      expect(resolveFontFamily(name)).toEqual({ family: 'times', matched: true });
    }
  });

  it('maps common monospace fonts to Courier', () => {
    for (const name of ['Consolas', 'Courier New', 'Menlo']) {
      expect(resolveFontFamily(name)).toEqual({ family: 'courier', matched: true });
    }
  });

  it('is case- and punctuation-insensitive', () => {
    expect(resolveFontFamily('  ARIAL  ')).toEqual({ family: 'helvetica', matched: true });
    expect(resolveFontFamily('Times-New-Roman')).toEqual({ family: 'times', matched: true });
  });

  it('falls back to a substring heuristic for an unknown name containing "mono" or "serif"', () => {
    expect(resolveFontFamily('SomeCustomMonoFont')).toEqual({ family: 'courier', matched: true });
    expect(resolveFontFamily('SomeCustomSerifFace')).toEqual({ family: 'times', matched: true });
  });

  it('falls back to Helvetica with matched:false for a genuinely unknown name', () => {
    expect(resolveFontFamily('Wingdings')).toEqual({ family: 'helvetica', matched: false });
  });
});

describe('resolveStandardFont', () => {
  it('picks the right variant for each bold/italic combination', () => {
    expect(resolveStandardFont('Arial', false, false).standardName).toBe('Helvetica');
    expect(resolveStandardFont('Arial', true, false).standardName).toBe('Helvetica-Bold');
    expect(resolveStandardFont('Arial', false, true).standardName).toBe('Helvetica-Oblique');
    expect(resolveStandardFont('Arial', true, true).standardName).toBe('Helvetica-BoldOblique');
  });

  it('uses "Italic" (not "Oblique") for the Times family', () => {
    expect(resolveStandardFont('Times New Roman', false, true).standardName).toBe('Times-Italic');
  });

  it('propagates the matched flag from resolveFontFamily', () => {
    expect(resolveStandardFont('Arial', false, false).matched).toBe(true);
    expect(resolveStandardFont('SomeMadeUpFont', false, false).matched).toBe(false);
  });
});
