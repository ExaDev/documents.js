import { describe, expect, it } from 'vitest';
import { widthOfCode } from './afm-widths';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { createFontResolver } from './font-read';
import type { PdfObjectResolver } from './interpret';
import type { PdfDict, PdfObject } from './objects';
import { asDict, pdfArray, pdfDict, pdfName, pdfNum, pdfRef, pdfStream } from './objects';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined => (obj?.kind === 'ref' ? objects.get(obj.num) : obj);
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined => asDict(resolve(obj));
  return { resolve, resolveDict };
}

describe('createFontResolver: simple fonts', () => {
  it('reads widths from an explicit /Widths array, falling back to /FontDescriptor /MissingWidth outside its range', () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('Arial-Bold'), FirstChar: pdfNum(65), LastChar: pdfNum(66), Widths: pdfArray([pdfNum(700), pdfNum(650)]) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font?.widthOf(65)).toBe(700);
    expect(font?.widthOf(66)).toBe(650);
    expect(font?.widthOf(67)).toBe(0); // outside FirstChar..LastChar, no FontDescriptor -> MissingWidth defaults to 0
  });

  it('derives family and bold/italic from /BaseFont', () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('ABCDEF+Arial-BoldItalic'), Widths: pdfArray([]) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font).toMatchObject({ composite: false, family: 'Arial', bold: true, italic: true });
  });

  it('falls back to standard-14 AFM widths when /Widths is entirely absent, matching a recognised family', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('Helvetica') });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font?.widthOf(0x41)).toBe(widthOfCode('Helvetica', 0x41));
    expect(diagnostics.some((d) => d.code === 'pdf/font-widths-missing')).toBe(false);
  });

  it('reports a diagnostic when falling back for a family that does not match any standard-14 face', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('SomeVeryObscureFont') });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    resolve('F1', resources);
    expect(diagnostics.some((d) => d.code === 'pdf/font-widths-missing')).toBe(true);
  });

  it('decodes text via a /ToUnicode CMap when present', () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([[9, pdfStream(pdfDict({}), textBytes('beginbfchar\n<0041> <0058>\nendbfchar'))]]);
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('Helvetica'), ToUnicode: pdfRef(9, 0) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(objects), sink });
    const font = resolve('F1', resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x41]))).toBe('X');
  });

  it('decodes text via /Encoding /Differences when no /ToUnicode is present', () => {
    const { sink } = collectDiagnostics();
    const encodingDict = pdfDict({ Differences: pdfArray([pdfNum(65), pdfName('B')]) });
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('Helvetica'), Encoding: encodingDict });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font?.decodeToUnicode(new Uint8Array([65]))).toBe('B');
  });

  it('falls back to the WinAnsi base encoding for a code /Differences does not override', () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('Helvetica') });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font?.decodeToUnicode(new Uint8Array([65]))).toBe('A');
  });

  it('reports a diagnostic and substitutes the replacement character for a genuinely unmappable code', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('Helvetica') });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font?.decodeToUnicode(new Uint8Array([1]))).toBe('�');
    expect(diagnostics.some((d) => d.code === 'text/unmapped-encoding')).toBe(true);
  });
});

describe('createFontResolver: composite (Type0) fonts', () => {
  it('reads CID widths from both array and range forms of /W, with /DW as the default', () => {
    const { sink } = collectDiagnostics();
    const descendant = pdfDict({ Subtype: pdfName('CIDFontType2'), DW: pdfNum(600), W: pdfArray([pdfNum(3), pdfArray([pdfNum(500), pdfNum(600)]), pdfNum(10), pdfNum(12), pdfNum(1000)]) });
    const fontDict = pdfDict({ Subtype: pdfName('Type0'), BaseFont: pdfName('ABCDEF+Calibri'), Encoding: pdfName('Identity-H'), DescendantFonts: pdfArray([descendant]) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font?.composite).toBe(true);
    expect(font?.widthOf(3)).toBe(500);
    expect(font?.widthOf(4)).toBe(600);
    expect(font?.widthOf(10)).toBe(1000);
    expect(font?.widthOf(12)).toBe(1000);
    expect(font?.widthOf(999)).toBe(600); // falls back to /DW
  });

  it('decodes 2-byte codes via /ToUnicode', () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([[9, pdfStream(pdfDict({}), textBytes('beginbfchar\n<0003> <0041>\nendbfchar'))]]);
    const descendant = pdfDict({ Subtype: pdfName('CIDFontType2') });
    const fontDict = pdfDict({ Subtype: pdfName('Type0'), BaseFont: pdfName('Calibri'), DescendantFonts: pdfArray([descendant]), ToUnicode: pdfRef(9, 0) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(objects), sink });
    const font = resolve('F1', resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x00, 0x03]))).toBe('A');
  });

  it('substitutes the replacement character with a diagnostic when there is no /ToUnicode at all', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const descendant = pdfDict({ Subtype: pdfName('CIDFontType2') });
    const fontDict = pdfDict({ Subtype: pdfName('Type0'), BaseFont: pdfName('Calibri'), DescendantFonts: pdfArray([descendant]) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    const font = resolve('F1', resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x00, 0x03]))).toBe('�');
    expect(diagnostics.some((d) => d.code === 'text/unmapped-encoding')).toBe(true);
  });
});

describe('createFontResolver: the FontMetricsPort adapter', () => {
  it('reports the correct byte length and width for a simple font', () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({ Subtype: pdfName('Type1'), BaseFont: pdfName('Helvetica'), FirstChar: pdfNum(65), LastChar: pdfNum(65), Widths: pdfArray([pdfNum(700)]) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { metrics } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    expect(metrics.glyphAdvance('F1', resources, new Uint8Array([65]), 0)).toEqual({ widthPer1000: 700, byteLengthConsumed: 1 });
  });

  it('reports 2-byte consumption for a composite font', () => {
    const { sink } = collectDiagnostics();
    const descendant = pdfDict({ Subtype: pdfName('CIDFontType2'), DW: pdfNum(1000) });
    const fontDict = pdfDict({ Subtype: pdfName('Type0'), BaseFont: pdfName('Calibri'), DescendantFonts: pdfArray([descendant]) });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { metrics } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    expect(metrics.glyphAdvance('F1', resources, new Uint8Array([0x00, 0x41]), 0)).toEqual({ widthPer1000: 1000, byteLengthConsumed: 2 });
  });

  it('returns undefined for a font resource that does not resolve', () => {
    const { sink } = collectDiagnostics();
    const resources = pdfDict({ Font: pdfDict({}) });
    const { metrics } = createFontResolver({ resolver: makeResolver(new Map()), sink });
    expect(metrics.glyphAdvance('Missing', resources, new Uint8Array([65]), 0)).toBeUndefined();
  });
});
