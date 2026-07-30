import type { PdfDiagnostic } from '../pdf/diagnostics';
import type { WinAnsiSubstitution } from '../pdf/winansi';
import { docxToPdf, pdfToDocx, pdfToPptx, pptxToPdf } from './convert';
import type { ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat } from './port';

const SUPPORTED_CONVERSIONS: readonly { readonly source: DocumentFormat; readonly target: DocumentFormat }[] = [
  { source: 'docx', target: 'pdf' },
  { source: 'pptx', target: 'pdf' },
  { source: 'pdf', target: 'docx' },
  { source: 'pdf', target: 'pptx' },
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
      if (source.format === 'pdf' && targetFormat === 'docx') {
        const bytes = pdfToDocx(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'docx', bytes }, diagnostics });
      }
      if (source.format === 'pdf' && targetFormat === 'pptx') {
        const bytes = pdfToPptx(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)) });
        return Promise.resolve({ document: { format: 'pptx', bytes }, diagnostics });
      }
      return Promise.reject(new Error(`unsupported conversion: ${source.format} -> ${targetFormat}`));
    },
  };
}
