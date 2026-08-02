import type { DocumentPackage } from 'document-schema.js';
import type { PdfDiagnostic, WinAnsiSubstitution } from 'pdf-codec';
import { DIRECT_EDGES, resolveConversionPath } from './capability';
import type { ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat } from './port';

// Derived from DIRECT_EDGES (capability.ts), in the identical order that module declares them -- which is itself the same order this list has always had. xlsx<->pdf (xlsxToPdf/pdfToXlsx) is now one of those direct edges too, even though the functions behind it compose the ods<->xlsx bridge with the ods<->pdf layout edge internally rather than laying xlsx out directly -- see capability.ts's own top-of-file comment and FORMAT_CAPABILITIES.xlsx for why that composition still counts as a direct edge here.
const SUPPORTED_CONVERSIONS: readonly { readonly source: DocumentFormat; readonly target: DocumentFormat }[] = DIRECT_EDGES.map((edge) => ({ source: edge.source, target: edge.target }));

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

      // resolveConversionPath (capability.ts) also has a composed-strategy branch, for a pair with no direct edge at all -- but every pair this package currently exposes an ergonomic conversion function for (xlsx<->pdf included, now that xlsxToPdf/pdfToXlsx exist) is registered as a direct edge in DIRECT_EDGES, and resolveConversionPath always prefers a direct match over composing one, so this strategy always resolves to 'direct' for any pair in SUPPORTED_CONVERSIONS above. Only a 'direct' strategy is ever executed below; a pair with neither a direct edge nor a one-hop composed path still rejects exactly as it always has.
      const strategy = resolveConversionPath(source.format, targetFormat);
      if (strategy?.kind !== 'direct') {
        return Promise.reject(new Error(`unsupported conversion: ${source.format} -> ${targetFormat}`));
      }

      const edge = strategy.edge;
      if (edge.kind === 'toPdf') {
        // odfToPdf accepts onDocument (it shares docx/odt/pptx/odp/ods/odg's own options type) but never invokes it -- see that function's own comment -- so `documentPackage` stays undefined for that one edge, and `package` on the returned result is correctly omitted.
        const bytes = edge.convert(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument });
        return Promise.resolve({ document: { format: edge.target, bytes }, diagnostics, package: documentPackage });
      }
      if (edge.kind === 'fromPdf') {
        const bytes = edge.convert(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: edge.target, bytes }, diagnostics, package: documentPackage });
      }
      // The six PDF-bypassing cross-format bridges: no diagnostics, since there is no font substitution or PDF-parse degradation to report -- a direct ContentDocument-pivot copy either succeeds outright or throws (an input of the wrong kind). Each still reports a package (content populated, layout always undefined -- see DocumentBridgeOptions.onDocument).
      const bytes = edge.convert(source.bytes, { signal: options.signal, onDocument });
      return Promise.resolve({ document: { format: edge.target, bytes }, diagnostics, package: documentPackage });
    },
  };
}
