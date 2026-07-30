import { describe, expect, it } from 'vitest';
import { styleFromBaseFontName } from './font-style';

describe('styleFromBaseFontName', () => {
  it('strips a subset tag', () => {
    expect(styleFromBaseFontName('ABCDEF+Arial').baseFamily).toBe('Arial');
  });

  it('detects bold/italic from a hyphenated suffix and strips it from the family', () => {
    expect(styleFromBaseFontName('Arial-BoldItalic')).toEqual({ baseFamily: 'Arial', bold: true, italic: true });
    expect(styleFromBaseFontName('Arial-Bold')).toEqual({ baseFamily: 'Arial', bold: true, italic: false });
    expect(styleFromBaseFontName('Times-Italic')).toEqual({ baseFamily: 'Times', bold: false, italic: true });
  });

  it('detects bold/italic from a comma-separated suffix', () => {
    expect(styleFromBaseFontName('Arial,BoldItalic')).toEqual({ baseFamily: 'Arial', bold: true, italic: true });
    expect(styleFromBaseFontName('Times New Roman,Bold')).toEqual({ baseFamily: 'Times New Roman', bold: true, italic: false });
  });

  it('treats "Oblique" as italic', () => {
    expect(styleFromBaseFontName('Helvetica-Oblique')).toEqual({ baseFamily: 'Helvetica', bold: false, italic: true });
  });

  it('leaves a plain regular name untouched', () => {
    expect(styleFromBaseFontName('Helvetica')).toEqual({ baseFamily: 'Helvetica', bold: false, italic: false });
  });

  it('both strips a subset tag and detects a style suffix together', () => {
    expect(styleFromBaseFontName('XYZABC+Calibri-Bold')).toEqual({ baseFamily: 'Calibri', bold: true, italic: false });
  });

  it('falls back to /FontDescriptor flags when the name gives no signal', () => {
    expect(styleFromBaseFontName('CustomFont', { forceBold: true })).toMatchObject({ bold: true });
    expect(styleFromBaseFontName('CustomFont', { italicFlag: true })).toMatchObject({ italic: true });
  });

  it('treats a nonzero /ItalicAngle as italic', () => {
    expect(styleFromBaseFontName('CustomFont', { italicAngle: -12 })).toMatchObject({ italic: true });
    expect(styleFromBaseFontName('CustomFont', { italicAngle: 0 })).toMatchObject({ italic: false });
  });

  it('combines a name-based signal with flags rather than letting one override the other', () => {
    // The name alone says bold; flags alone say italic -- both should be honoured.
    expect(styleFromBaseFontName('Arial-Bold', { italicFlag: true })).toEqual({ baseFamily: 'Arial', bold: true, italic: true });
  });
});
