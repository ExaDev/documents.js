import type { DocumentPackage } from 'document-schema.js';
import type { PdfDiagnostic, WinAnsiSubstitution } from 'pdf-codec';
import type { FontSubstitution } from 'document-schema.js';
import { UnsupportedConversionError } from './capability';
import { convertDocument, resolveCompositionPlan } from './composition';
import { odfToPdf } from './convert';
import type { ConversionOptions, ConversionRequest, ConversionResult, Diagnostic, DocumentConverter } from './port';
import { DOCUMENT_FORMATS, type DocumentFormat } from './port';

// Derived from the composition pathfinder (resolveCompositionPlan in composition.ts), not from a hand-maintained edge list: every (source, target) pair the pathfinder can route, plus the special-case odf -> pdf pair (the pathfinder deliberately excludes odf, since a standalone formula document renders through src/mathml's own formula-positioning path rather than a ContentDocument -> LayoutDocument layout engine -- local.ts routes it to the hand-written odfToPdf directly). Sorted by source then target so the array is deterministic and a test can assert it exactly.
const SUPPORTED_CONVERSIONS: readonly { readonly source: DocumentFormat; readonly target: DocumentFormat }[] = (() => {
  const pairs: { readonly source: DocumentFormat; readonly target: DocumentFormat }[] = [];
  for (const source of DOCUMENT_FORMATS) {
    for (const target of DOCUMENT_FORMATS) {
      if (source === target) {
        continue;
      }
      if (resolveCompositionPlan(source, target) !== undefined) {
        pairs.push({ source, target });
      }
    }
  }
  pairs.push({ source: 'odf', target: 'pdf' });
  pairs.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return pairs;
})();

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
    // 2 added ConversionResult's optional `package` field (see port.ts), which the local implementation below populates from every conversion function's own onDocument callback; 3 added convert()'s own ConversionOptions.fonts/onFontSubstitution, which an implementation is now expected to honour for every conversion that lays text out; 4 added ConversionOptions.images (a MarkdownImageResolver), honoured by the markdown-sourced to-PDF and bridge edges; 5 added ConversionOptions.clock, forwarded to every X-to-PDF conversion's /CreationDate and /ModDate stamping; 6 added ConversionOptions.page, forwarded to any svg-target hop (drawing pages are anonymous, so an index selects the page the way `sheet` names a sheet); 7 changed ConversionResult.package's TYPE to the tree-form DocumentPackage of document-schema.js 4.0.0 (children carry the decomposed group tree plus the minted styles table, where it previously carried the flat { content, pages } envelope) -- a consumer reading the field must flatten (document-schema.js exports flattenPackage) or walk the tree.
    contractVersion: 7,
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

      // odf -> pdf is a SPECIAL case: odf is deliberately excluded from the composition engine (src/convert/composition.ts's own module doc), since a standalone formula document renders through src/mathml's own formula-positioning path rather than a ContentDocument -> LayoutDocument layout engine. resolveCompositionPlan consequently returns undefined for it, so it is routed to the real odfToPdf function directly rather than through convertDocument. onDocument is forwarded (matching the normal path's own wiring), so odfToPdf reports a genuine 'formula'-kind ContentDocument alongside an empty-items LayoutDocument (formula positioning happens inside writePdf, not as page items) -- `package` is populated for this pair just like every other X->pdf.
      if (source.format === 'odf' && targetFormat === 'pdf') {
        const bytes = odfToPdf(source.bytes, { signal: options.signal, fonts: options.fonts, onFontSubstitution, onDocument, clock: options.clock });
        return Promise.resolve({ document: { format: targetFormat, bytes }, diagnostics, package: documentPackage });
      }

      // resolveCompositionPlan (src/convert/composition.ts) returns the minimum-cost hop plan for a supported pair, or undefined for an unsupported one. An undefined result is an UnsupportedConversionError rather than a plain Error, so a caller can branch on it.
      const plan = resolveCompositionPlan(source.format, targetFormat);
      if (plan === undefined) {
        return Promise.reject(new UnsupportedConversionError(source.format, targetFormat));
      }

      // convertDocument runs the resolved plan end to end, threading the port's ConversionOptions through to whichever hop consumes each field: fonts/onFontSubstitution/onSubstitution/clock reach any toPdf hop (the only kind that lays text out and resolves a face), sink reaches any fromPdf hop (the only kind that reads a PDF and can report parse diagnostics), delimiter/sheet reach any csv hop, page reaches any svg-target hop, and signal/images reach every hop. The onDocument callback captures the DocumentPackage the first content-producing hop builds, mirroring the per-edge onDocument wiring the previous direct-edge path threaded into each edge kind individually.
      const bytes = convertDocument(source.format, targetFormat, source.bytes, {
        signal: options.signal,
        fonts: options.fonts,
        onFontSubstitution,
        onSubstitution: (s, c) => diagnostics.push(substitutionDiagnostic(s, c)),
        sink: (d) => diagnostics.push(fromPdfDiagnostic(d)),
        images: options.images,
        delimiter: options.delimiter,
        sheet: options.sheet,
        page: options.page,
        clock: options.clock,
        onDocument,
      });
      return Promise.resolve({ document: { format: targetFormat, bytes }, diagnostics, package: documentPackage });
    },
  };
}
