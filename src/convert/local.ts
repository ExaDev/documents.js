import type { DocumentPackage } from 'document-schema.js';
import type { PdfDiagnostic, WinAnsiSubstitution } from 'pdf-codec';
import type { FontSubstitution } from 'document-schema.js';
import { DIRECT_EDGES, resolveConversionPath } from './capability';
import type { ConversionOptions, ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat } from './port';

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

// port.ts's own ConversionResult comment names a font substitution as the first example of what diagnostics exist for, so a face falling back is reported here whether or not the caller supplied an onFontSubstitution callback of their own. No pageIndex: a registry resolves a face once per family+bold+italic for the whole document (pdf-codec caches it), not per page, so there is no single page this belongs to.
function fontSubstitutionDiagnostic(substitution: FontSubstitution): Diagnostic {
  const requested = `${substitution.requestedFamily}${substitution.requestedBold ? ' bold' : ''}${substitution.requestedItalic ? ' italic' : ''}`;
  const detail = substitution.reason === 'vendored-substitute' ? `substituted the metric-compatible "${substitution.resolvedFamily}"` : `substituted another face of "${substitution.resolvedFamily}"`;
  return { severity: 'info', code: 'font/substituted', message: `"${requested}" is not available; ${detail}` };
}

function fromPdfDiagnostic(diagnostic: PdfDiagnostic): Diagnostic {
  return { severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message, pageIndex: diagnostic.pageIndex };
}

export function createLocalDocumentConverter(): DocumentConverter {
  return {
    // 2 added ConversionResult's optional `package` field (see port.ts), which the local implementation below populates from every conversion function's own onDocument callback; 3 added convert()'s own ConversionOptions.fonts/onFontSubstitution, which an implementation is now expected to honour for every conversion that lays text out; 4 added ConversionOptions.images (a MarkdownImageResolver), honoured by the markdown-sourced to-PDF and bridge edges; 5 added ConversionOptions.clock, forwarded to every X-to-PDF conversion's /CreationDate and /ModDate stamping.
    contractVersion: 5,
    conversions: SUPPORTED_CONVERSIONS,
    convert(request: ConversionRequest, options: ConversionOptions): Promise<ConversionResult> {
      const { source, targetFormat } = request;
      const diagnostics: Diagnostic[] = [];
      let documentPackage: DocumentPackage | undefined;
      const onDocument = (pkg: DocumentPackage): void => {
        documentPackage = pkg;
      };
      // Recorded as a diagnostic AND forwarded to the caller's own callback -- two channels for two consumers, not a duplicate: the diagnostics array is what a caller who passed no callback reads afterwards, the callback is what a caller wanting the structured FontSubstitution value receives live.
      const onFontSubstitution = (substitution: FontSubstitution): void => {
        diagnostics.push(fontSubstitutionDiagnostic(substitution));
        options.onFontSubstitution?.(substitution);
      };

      // resolveConversionPath (capability.ts) also has a composed-strategy branch, for a pair with no direct edge at all -- but every pair this package currently exposes an ergonomic conversion function for (xlsx<->pdf included, now that xlsxToPdf/pdfToXlsx exist) is registered as a direct edge in DIRECT_EDGES, and resolveConversionPath always prefers a direct match over composing one, so this strategy always resolves to 'direct' for any pair in SUPPORTED_CONVERSIONS above. Only a 'direct' strategy is ever executed below; a pair with neither a direct edge nor a one-hop composed path still rejects exactly as it always has.
      const strategy = resolveConversionPath(source.format, targetFormat);
      if (strategy?.kind !== 'direct') {
        return Promise.reject(new Error(`unsupported conversion: ${source.format} -> ${targetFormat}`));
      }

      const edge = strategy.edge;
      if (edge.kind === 'toPdf') {
        // The only edge kind that resolves a font at all: it is the one that runs a layout engine and writes glyphs. odfToPdf accepts onDocument (it shares docx/odt/pptx/odp/ods/odg's own options type) but never invokes it -- see that function's own comment -- so `documentPackage` stays undefined for that one edge, and `package` on the returned result is correctly omitted; the same comment explains why it never reports a font substitution either.
        const bytes = edge.convert(source.bytes, { signal: options.signal, onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)), onDocument, fonts: options.fonts, onFontSubstitution, images: options.images, clock: options.clock });
        return Promise.resolve({ document: { format: edge.target, bytes }, diagnostics, package: documentPackage });
      }
      if (edge.kind === 'fromPdf') {
        // No font options here: reconstruction reads a PDF's own already-positioned glyphs and never resolves a face to render with, so PdfToDocumentOptions has nothing to thread them into.
        const bytes = edge.convert(source.bytes, { signal: options.signal, sink: (d) => diagnostics.push(fromPdfDiagnostic(d)), onDocument });
        return Promise.resolve({ document: { format: edge.target, bytes }, diagnostics, package: documentPackage });
      }
      // The ten PDF-bypassing cross-format bridges: no diagnostics, since there is no font substitution or PDF-parse degradation to report -- a direct ContentDocument-pivot copy either succeeds outright or throws (an input of the wrong kind), and no layout engine runs, so no face is ever resolved. Each still reports a package (content populated, layout always undefined -- see DocumentBridgeOptions.onDocument).
      const bytes = edge.convert(source.bytes, { signal: options.signal, onDocument, images: options.images });
      return Promise.resolve({ document: { format: edge.target, bytes }, diagnostics, package: documentPackage });
    },
  };
}
