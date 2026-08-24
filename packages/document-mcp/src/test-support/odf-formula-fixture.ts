// A real odf (a standalone ODF formula document) built at the byte level, matching this repo's own src/test-support/odm-fixture.ts convention -- neither odf.js nor documents.js exposes an odf writer at all (documents.js's own dist/index.d.ts has buildOdgPackage/buildOdpPackage/buildOdsPackage/buildOdtPackage but no buildOdfPackage), so this hand-authors the real office:document-content > office:body > office:math > math:math structure a genuine LibreOffice-authored .odf uses, mirroring documents.js's own internal src/test-support/odf.ts fixture (never exported, so not reusable directly from this package).
import { ODF_MEDIA_TYPES, zipPackage } from "odf.js";

function enc(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

const MATH_NS = 'xmlns:math="http://www.w3.org/1998/Math/MathML"';
const OFFICE_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';

// A minimal but structurally authentic odf: a real mimetype-first-and-stored zip wrapping one math:math element (a bare identifier, under the real "math:" namespace prefix real LibreOffice output uses).
export function odfFormulaBytes(): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${MATH_NS}><office:body><office:math><math:math ${MATH_NS}><math:semantics><math:mi>x</math:mi></math:semantics></math:math></office:math></office:body></office:document-content>`,
  );
  return zipPackage([
    ["mimetype", { bytes: enc(ODF_MEDIA_TYPES.odf), stored: true }],
    ["content.xml", { bytes: contentXml }],
  ]);
}
