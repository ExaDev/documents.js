import type { DocumentPackage } from 'document-schema.js';
import { writePdf } from 'pdf-codec';
import { DOCUMENT_FORMAT_CODECS, requireArrayBufferBytes } from '../codecs/registry';
import type { DocumentFormat } from './port';

// Builds any DocumentFormat's own bytes from an already-assembled DocumentPackage (content + optional layout, document-schema.js) -- the reverse of what every ergonomic X-to-PDF/PDF-to-X conversion's own onDocument callback hands back. 'pdf' writes the package's own LayoutDocument half directly (no font registry, no positioned formulas -- neither survives a bare DocumentPackage, since both are side channels a DocumentPackage never carries: a formula renders as nothing and an embedded font falls back to the standard 14 or a vendored substitute; see this package's own README for the DocumentPackage-is-a-snapshot gotcha). Every other target dispatches through DOCUMENT_FORMAT_CODECS (src/codecs/registry.ts), building a fresh package from the ContentDocument half through the identical buildXPackage function the matching pdf-to-X/bridge conversion already uses, then encoding it with that format's own codec -- xlsx now goes through this exact same dispatch (DOCUMENT_FORMAT_CODECS.xlsx.content.write wraps ooxml.js's buildXlsxPackage), no longer a named exception. 'odf' still has no builder at all -- a standalone formula document has no write path from ContentDocument to begin with -- so it alone is rejected outright ahead of the registry lookup.
export function buildDocumentBytes(pkg: DocumentPackage, target: DocumentFormat): Uint8Array<ArrayBuffer> {
  if (target === 'pdf') {
    if (pkg.layout === undefined) {
      throw new Error("this DocumentPackage has no layout -- only a package dumped from a <format>-to-pdf or pdf-to-<format> conversion carries one; a bridge conversion's own dump (e.g. odt-to-docx) never does, so 'pdf' is not a reachable target from it");
    }
    return writePdf(pkg.layout);
  }
  if (target === 'odf') {
    throw new Error("'odf' (a standalone formula document) cannot be built from a DocumentPackage -- there is no ContentDocument-to-odf builder");
  }
  const content = DOCUMENT_FORMAT_CODECS[target].content;
  if (!content?.write) {
    throw new Error(`DocumentFormat '${target}' has no content.write codec in DOCUMENT_FORMAT_CODECS, and is not 'pdf'/'odf' -- this is an internal invariant violation, not a caller error`);
  }
  return requireArrayBufferBytes(content.write(pkg.content));
}
