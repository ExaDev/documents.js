import { unfilterScanlines } from './image/png-filter';
import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfDict } from './objects';
import { asNumber, dictGet } from './objects';

// PDF's own /Predictor convention (ISO 32000-1 7.4.4.4) for Flate/LZW-filtered stream data: 1 = none; 2 = TIFF Predictor 2 (horizontal differencing between same-component samples in adjacent pixels); >=10 selects one of PNG's five per-scanline filters, chosen independently per row via a leading filter-type byte -- exactly image/png-filter.ts's own unfilterScanlines. Cross-reference streams are almost always /Predictor 12, which is why that PNG module sits on the critical path for reading modern PDFs even in documents with no images at all.
export interface PredictorParams {
  readonly predictor: number;
  readonly colors: number;
  readonly bitsPerComponent: number;
  readonly columns: number;
}

const DEFAULT_PREDICTOR = 1;
const DEFAULT_COLORS = 1;
const DEFAULT_BITS_PER_COMPONENT = 8;
const DEFAULT_COLUMNS = 1;

export function readPredictorParams(parms: PdfDict | undefined): PredictorParams {
  return {
    predictor: asNumber(parms ? dictGet(parms, 'Predictor') : undefined) ?? DEFAULT_PREDICTOR,
    colors: asNumber(parms ? dictGet(parms, 'Colors') : undefined) ?? DEFAULT_COLORS,
    bitsPerComponent: asNumber(parms ? dictGet(parms, 'BitsPerComponent') : undefined) ?? DEFAULT_BITS_PER_COMPONENT,
    columns: asNumber(parms ? dictGet(parms, 'Columns') : undefined) ?? DEFAULT_COLUMNS,
  };
}

export function applyPredictor(data: Uint8Array<ArrayBuffer>, params: PredictorParams, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> {
  if (params.predictor <= 1) {
    return data;
  }
  const bpp = Math.max(1, Math.ceil((params.colors * params.bitsPerComponent) / 8));
  const bytesPerRow = Math.ceil((params.colors * params.bitsPerComponent * params.columns) / 8);
  if (params.predictor === 2) {
    return applyTiffPredictor(data, params, bytesPerRow, sink);
  }
  if (params.predictor >= 10) {
    const height = bytesPerRow > 0 ? Math.floor(data.length / (bytesPerRow + 1)) : 0;
    return unfilterScanlines(data, height, bytesPerRow, bpp);
  }
  sink({ code: 'pdf/unsupported-predictor', severity: 'warning', message: `unsupported /Predictor value ${String(params.predictor)}; leaving data unpredicted` });
  return data;
}

// Differences each component against the same component in the previous pixel of the same row, then undoes that differencing by summing left to right -- the inverse of what an encoder's forward pass computes. Only 8- and 16-bit components are supported: TIFF predictor 2 at 1/2/4-bit depth would need sub-byte bit-packing arithmetic and is vanishingly rare in real-world PDF streams (xref streams, the dominant real-world predictor consumer, always use the PNG predictors instead).
function applyTiffPredictor(data: Uint8Array<ArrayBuffer>, params: PredictorParams, bytesPerRow: number, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> {
  if (params.bitsPerComponent !== 8 && params.bitsPerComponent !== 16) {
    sink({ code: 'pdf/unsupported-predictor', severity: 'warning', message: `TIFF predictor with ${String(params.bitsPerComponent)}-bit components is not supported; leaving data unpredicted` });
    return data;
  }
  const out = new Uint8Array(data.length);
  out.set(data);
  const rowCount = bytesPerRow > 0 ? Math.floor(out.length / bytesPerRow) : 0;
  const componentStride = params.bitsPerComponent === 16 ? 2 : 1;
  const componentsPerPixel = params.colors;
  for (let row = 0; row < rowCount; row++) {
    const rowStart = row * bytesPerRow;
    for (let component = componentsPerPixel; component * componentStride < bytesPerRow; component++) {
      const i = rowStart + component * componentStride;
      const prevI = i - componentsPerPixel * componentStride;
      if (componentStride === 1) {
        out[i] = ((out[i] ?? 0) + (out[prevI] ?? 0)) & 0xff;
      } else {
        const current = ((out[i] ?? 0) << 8) | (out[i + 1] ?? 0);
        const prev = ((out[prevI] ?? 0) << 8) | (out[prevI + 1] ?? 0);
        const sum = (current + prev) & 0xffff;
        out[i] = (sum >> 8) & 0xff;
        out[i + 1] = sum & 0xff;
      }
    }
  }
  return out;
}
