import type { PdfDiagnostic } from '../pdf/diagnostics';
import type { WinAnsiSubstitution } from '../pdf/winansi';
import {
  docxToOdt,
  docxToPdf,
  odgToPdf,
  odpToPdf,
  odpToPptx,
  odsToPdf,
  odsToXlsx,
  odtToDocx,
  odtToPdf,
  pdfToDocx,
  pdfToOdg,
  pdfToOdp,
  pdfToOds,
  pdfToOdt,
  pdfToPptx,
  pptxToOdp,
  pptxToPdf,
  xlsxToOds,
} from './convert';
import type { ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat } from './port';

const SUPPORTED_CONVERSIONS: readonly { readonly source: DocumentFormat; readonly target: DocumentFormat }[] = [
  { source: 'docx', target: 'pdf' },
  { source: 'pptx', target: 'pdf' },
  { source: 'odt', target: 'pdf' },
  { source: 'odp', target: 'pdf' },
  { source: 'ods', target: 'pdf' },
  { source: 'odg', target: 'pdf' },
  { source: 'pdf', target: 'docx' },
  { source: 'pdf', target: 'pptx' },
  { source: 'pdf', target: 'odt' },
  { source: 'pdf', target: 'odp' },
  { source: 'pdf', target: 'ods' },
  { source: 'pdf', target: 'odg' },
  // The six PDF-bypassing cross-format bridges (src/convert/convert.ts's own dedicated section) -- direct ContentDocument-pivot conversions, not routed through pdf.
  { source: 'odt', target: 'docx' },
  { source: 'docx', target: 'odt' },
  { source: 'odp', target: 'pptx' },
  { source: 'pptx', target: 'odp' },
  { source: 'ods', target: 'xlsx' },
  { source: 'xlsx', target: 'ods' },
];

function substitutionDiagnostic(substitution: WinAnsiSubstitution, context: { readonly pageIndex: number }): Diagnostic {
  return {
    severity: 'info',
    code: 'char/substituted',
    message: `"${substitution.from}" is not representable in a standard-14 font; substituted "${substitution.to}"`,
    pageIndex: context.pageIndex,
  };
}

function fromPdfDiagnostic(diagnostic: PdfDiagnostic): Diagnostic {
  return { severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message, pageIndex: diagnostic.pageIndex };
}

export function createLocalDocumentConverter(): DocumentConverter {
  return {
    contractVersion: 1,
    conversions: SUPPORTED_CONVERSIONS,
    convert(request: ConversionRequest, options: { readonly signal: AbortSignal }): Promise<ConversionResult> {
      const { source, targetFormat } = request;
      const diagnostics: Diagnostic[] = [];

      if (source.format === 'docx' && targetFormat === 'pdf') {
        const bytes = docxToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)) });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics });
      }
      if (source.format === 'pptx' && targetFormat === 'pdf') {
        const bytes = pptxToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)) });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics });
      }
      if (source.format === 'odt' && targetFormat === 'pdf') {
        const bytes = odtToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)) });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics });
      }
      if (source.format === 'odp' && targetFormat === 'pdf') {
        const bytes = odpToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)) });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics });
      }
      if (source.format === 'ods' && targetFormat === 'pdf') {
        const bytes = odsToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)) });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics });
      }
      if (source.format === 'odg' && targetFormat === 'pdf') {
        const bytes = odgToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)) });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics });
      }
      if (source.format === 'pdf' && targetFormat === 'docx') {
        const bytes = pdfToDocx(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'docx', bytes }, diagnostics });
      }
      if (source.format === 'pdf' && targetFormat === 'pptx') {
        const bytes = pdfToPptx(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'pptx', bytes }, diagnostics });
      }
      if (source.format === 'pdf' && targetFormat === 'odt') {
        const bytes = pdfToOdt(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'odt', bytes }, diagnostics });
      }
      if (source.format === 'pdf' && targetFormat === 'odp') {
        const bytes = pdfToOdp(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'odp', bytes }, diagnostics });
      }
      if (source.format === 'pdf' && targetFormat === 'ods') {
        const bytes = pdfToOds(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'ods', bytes }, diagnostics });
      }
      if (source.format === 'pdf' && targetFormat === 'odg') {
        const bytes = pdfToOdg(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'odg', bytes }, diagnostics });
      }
      // The six PDF-bypassing cross-format bridges: no diagnostics, since there is no font substitution or PDF-parse degradation to report -- a direct ContentDocument-pivot copy either succeeds outright or throws (an input of the wrong kind).
      if (source.format === 'odt' && targetFormat === 'docx') {
        const bytes = odtToDocx(source.bytes, { signal: options.signal });
        return Promise.resolve({ document: { format: 'docx', bytes }, diagnostics });
      }
      if (source.format === 'docx' && targetFormat === 'odt') {
        const bytes = docxToOdt(source.bytes, { signal: options.signal });
        return Promise.resolve({ document: { format: 'odt', bytes }, diagnostics });
      }
      if (source.format === 'odp' && targetFormat === 'pptx') {
        const bytes = odpToPptx(source.bytes, { signal: options.signal });
        return Promise.resolve({ document: { format: 'pptx', bytes }, diagnostics });
      }
      if (source.format === 'pptx' && targetFormat === 'odp') {
        const bytes = pptxToOdp(source.bytes, { signal: options.signal });
        return Promise.resolve({ document: { format: 'odp', bytes }, diagnostics });
      }
      if (source.format === 'ods' && targetFormat === 'xlsx') {
        const bytes = odsToXlsx(source.bytes, { signal: options.signal });
        return Promise.resolve({ document: { format: 'xlsx', bytes }, diagnostics });
      }
      if (source.format === 'xlsx' && targetFormat === 'ods') {
        const bytes = xlsxToOds(source.bytes, { signal: options.signal });
        return Promise.resolve({ document: { format: 'ods', bytes }, diagnostics });
      }
      return Promise.reject(new Error(`unsupported conversion: ${source.format} -> ${targetFormat}`));
    },
  };
}
