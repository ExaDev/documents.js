import type { DocumentPackage } from 'document-schema.js';
import type { PdfDiagnostic, WinAnsiSubstitution } from 'pdf-codec';
import {
  docxToOdt,
  docxToPdf,
  odfToPdf,
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
  { source: 'odf', target: 'pdf' }, // odfToPdf's own one-way direction -- see port.ts's own note on why there is no pdf -> odf entry.
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
    // ConversionResult now carries an optional `package` field (see port.ts) -- the local implementation below populates it from every conversion function's own onDocument callback.
    contractVersion: 2,
    conversions: SUPPORTED_CONVERSIONS,
    convert(request: ConversionRequest, options: { readonly signal: AbortSignal }): Promise<ConversionResult> {
      const { source, targetFormat } = request;
      const diagnostics: Diagnostic[] = [];
      let documentPackage: DocumentPackage | undefined;
      const onDocument = (pkg: DocumentPackage): void => {
        documentPackage = pkg;
      };

      if (source.format === 'docx' && targetFormat === 'pdf') {
        const bytes = docxToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pptx' && targetFormat === 'pdf') {
        const bytes = pptxToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'odt' && targetFormat === 'pdf') {
        const bytes = odtToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'odp' && targetFormat === 'pdf') {
        const bytes = odpToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'ods' && targetFormat === 'pdf') {
        const bytes = odsToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'odg' && targetFormat === 'pdf') {
        const bytes = odgToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'odf' && targetFormat === 'pdf') {
        // odfToPdf accepts onDocument (it shares docx/odt/pptx/odp/ods/odg's own options type) but never invokes it -- see that function's own comment -- so `documentPackage` stays undefined here, and `package` on the returned result is correctly omitted.
        const bytes = odfToPdf(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: 'pdf', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pdf' && targetFormat === 'docx') {
        const bytes = pdfToDocx(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: 'docx', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pdf' && targetFormat === 'pptx') {
        const bytes = pdfToPptx(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: 'pptx', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pdf' && targetFormat === 'odt') {
        const bytes = pdfToOdt(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: 'odt', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pdf' && targetFormat === 'odp') {
        const bytes = pdfToOdp(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: 'odp', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pdf' && targetFormat === 'ods') {
        const bytes = pdfToOds(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: 'ods', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pdf' && targetFormat === 'odg') {
        const bytes = pdfToOdg(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: 'odg', bytes }, diagnostics, package: documentPackage });
      }
      // The six PDF-bypassing cross-format bridges: no diagnostics, since there is no font substitution or PDF-parse degradation to report -- a direct ContentDocument-pivot copy either succeeds outright or throws (an input of the wrong kind). Each still reports a package (content populated, layout always undefined -- see DocumentBridgeOptions.onDocument).
      if (source.format === 'odt' && targetFormat === 'docx') {
        const bytes = odtToDocx(source.bytes, { signal: options.signal, onDocument });
        return Promise.resolve({ document: { format: 'docx', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'docx' && targetFormat === 'odt') {
        const bytes = docxToOdt(source.bytes, { signal: options.signal, onDocument });
        return Promise.resolve({ document: { format: 'odt', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'odp' && targetFormat === 'pptx') {
        const bytes = odpToPptx(source.bytes, { signal: options.signal, onDocument });
        return Promise.resolve({ document: { format: 'pptx', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'pptx' && targetFormat === 'odp') {
        const bytes = pptxToOdp(source.bytes, { signal: options.signal, onDocument });
        return Promise.resolve({ document: { format: 'odp', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'ods' && targetFormat === 'xlsx') {
        const bytes = odsToXlsx(source.bytes, { signal: options.signal, onDocument });
        return Promise.resolve({ document: { format: 'xlsx', bytes }, diagnostics, package: documentPackage });
      }
      if (source.format === 'xlsx' && targetFormat === 'ods') {
        const bytes = xlsxToOds(source.bytes, { signal: options.signal, onDocument });
        return Promise.resolve({ document: { format: 'ods', bytes }, diagnostics, package: documentPackage });
      }
      return Promise.reject(new Error(`unsupported conversion: ${source.format} -> ${targetFormat}`));
    },
  };
}
