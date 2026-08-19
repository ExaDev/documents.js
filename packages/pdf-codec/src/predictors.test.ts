import { describe, expect, it } from 'vitest';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { pdfDict, pdfNum } from './objects';
import { applyPredictor, readPredictorParams } from './predictors';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

describe('readPredictorParams', () => {
  it('defaults every field when parms is undefined', () => {
    expect(readPredictorParams(undefined)).toEqual({ predictor: 1, colors: 1, bitsPerComponent: 8, columns: 1 });
  });

  it('reads explicit values from a parms dict', () => {
    const parms = pdfDict({ Predictor: pdfNum(12), Colors: pdfNum(3), BitsPerComponent: pdfNum(8), Columns: pdfNum(10) });
    expect(readPredictorParams(parms)).toEqual({ predictor: 12, colors: 3, bitsPerComponent: 8, columns: 10 });
  });
});

describe('applyPredictor', () => {
  it('returns the data unchanged when the predictor is 1 (none) or absent', () => {
    const { sink } = collectDiagnostics();
    const data = new Uint8Array([1, 2, 3]);
    expect(applyPredictor(data, { predictor: 1, colors: 1, bitsPerComponent: 8, columns: 3 }, sink)).toBe(data);
  });

  it('undoes TIFF Predictor 2 (8-bit, single component): horizontal differencing per row', () => {
    const { sink, diagnostics } = collectDiagnostics();
    // Original row samples [10, 12, 15, 20], encoded as [10, 2, 3, 5] (each after the first differenced against its predecessor).
    const encoded = new Uint8Array([10, 2, 3, 5]);
    const result = applyPredictor(encoded, { predictor: 2, colors: 1, bitsPerComponent: 8, columns: 4 }, sink);
    expect(Array.from(result)).toEqual([10, 12, 15, 20]);
    expect(diagnostics).toEqual([]);
  });

  it('undoes TIFF Predictor 2 (8-bit, interleaved components): differences per component, not per byte', () => {
    const { sink } = collectDiagnostics();
    // Two pixels of (A, B) pairs: pixel0=(5,7), pixel1=(9,13). Encoded: [5, 7, 9-5, 13-7] = [5, 7, 4, 6].
    const encoded = new Uint8Array([5, 7, 4, 6]);
    const result = applyPredictor(encoded, { predictor: 2, colors: 2, bitsPerComponent: 8, columns: 2 }, sink);
    expect(Array.from(result)).toEqual([5, 7, 9, 13]);
  });

  it('undoes TIFF Predictor 2 (16-bit components, big-endian)', () => {
    const { sink } = collectDiagnostics();
    // Samples [300, 500]: encoded as [300, 500-300] = [300, 200] -> bytes [0x01,0x2C, 0x00,0xC8].
    const encoded = new Uint8Array([0x01, 0x2c, 0x00, 0xc8]);
    const result = applyPredictor(encoded, { predictor: 2, colors: 1, bitsPerComponent: 16, columns: 2 }, sink);
    expect(Array.from(result)).toEqual([0x01, 0x2c, 0x01, 0xf4]); // 300, 500
  });

  it('degrades TIFF Predictor 2 at an unsupported bit depth with a diagnostic, leaving data unpredicted', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const data = new Uint8Array([9, 9, 9]);
    const result = applyPredictor(data, { predictor: 2, colors: 1, bitsPerComponent: 4, columns: 4 }, sink);
    expect(Array.from(result)).toEqual([9, 9, 9]);
    expect(diagnostics[0]?.code).toBe('pdf/unsupported-predictor');
  });

  it('delegates predictor values 10+ to PNG scanline unfiltering', () => {
    const { sink, diagnostics } = collectDiagnostics();
    // Two rows, each prefixed by a "None" (0) filter-type byte, 3 samples per row.
    const data = new Uint8Array([0, 1, 2, 3, 0, 4, 5, 6]);
    const result = applyPredictor(data, { predictor: 12, colors: 1, bitsPerComponent: 8, columns: 3 }, sink);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(diagnostics).toEqual([]);
  });

  it('degrades an unrecognised predictor value with a diagnostic, leaving data unpredicted', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const data = new Uint8Array([9, 9, 9]);
    const result = applyPredictor(data, { predictor: 5, colors: 1, bitsPerComponent: 8, columns: 3 }, sink);
    expect(Array.from(result)).toEqual([9, 9, 9]);
    expect(diagnostics[0]?.code).toBe('pdf/unsupported-predictor');
  });
});
