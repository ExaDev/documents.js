import type { DocumentPackage } from 'document-schema.js';
import { encodePackage as encodeOdfPackage } from 'odf.js';
import { encodePackage } from 'ooxml.js';
import { writePdf } from 'pdf-codec';
import { buildDocxPackage } from '../edit/docx/content';
import { buildOdgPackage } from '../edit/odg/content';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdsPackage } from '../edit/ods/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { encodeMarkdownText } from '../markdown/text';
import { buildMarkdownText } from '../markdown/write';
import type { DocumentFormat } from './port';

// Builds any DocumentFormat's own bytes from an already-assembled DocumentPackage (content + optional layout, document-schema.js) -- the reverse of what every ergonomic X-to-PDF/PDF-to-X conversion's own onDocument callback hands back. 'pdf' writes the package's own LayoutDocument half directly (no font registry, no positioned formulas -- neither survives a bare DocumentPackage, since both are side channels a DocumentPackage never carries: a formula renders as nothing and an embedded font falls back to the standard 14 or a vendored substitute; see this package's own README for the DocumentPackage-is-a-snapshot gotcha). Every other target builds a fresh package from the ContentDocument half through the identical buildXPackage function the matching pdf-to-X/bridge conversion already uses, then encodes it with that format's own codec (ooxml.js's for docx/pptx, odf.js's for odt/odp/ods/odg). 'xlsx' and 'odf' have no builder at all -- this package deliberately never re-exports ooxml.js's buildXlsxPackage (see the README's own Architecture note), and a formula document has no write path from ContentDocument to begin with -- so both are rejected outright rather than attempted.
export function buildDocumentBytes(pkg: DocumentPackage, target: DocumentFormat): Uint8Array<ArrayBuffer> {
  if (target === 'pdf') {
    if (pkg.layout === undefined) {
      throw new Error("this DocumentPackage has no layout -- only a package dumped from a <format>-to-pdf or pdf-to-<format> conversion carries one; a bridge conversion's own dump (e.g. odt-to-docx) never does, so 'pdf' is not a reachable target from it");
    }
    return writePdf(pkg.layout);
  }
  switch (target) {
    case 'docx':
      return encodePackage(buildDocxPackage(pkg.content));
    case 'pptx':
      return encodePackage(buildPptxPackage(pkg.content));
    case 'odt':
      return encodeOdfPackage(buildOdtPackage(pkg.content));
    case 'odp':
      return encodeOdfPackage(buildOdpPackage(pkg.content));
    case 'ods':
      return encodeOdfPackage(buildOdsPackage(pkg.content));
    case 'odg':
      return encodeOdfPackage(buildOdgPackage(pkg.content));
    case 'markdown':
      return encodeMarkdownText(buildMarkdownText(pkg.content));
    case 'xlsx':
      throw new Error("'xlsx' cannot be built from a DocumentPackage directly -- this package does not re-export a ContentDocument-to-xlsx builder; convert to 'ods' here, then call odsToXlsx on the result instead");
    case 'odf':
      throw new Error("'odf' (a standalone formula document) cannot be built from a DocumentPackage -- there is no ContentDocument-to-odf builder");
  }
}
