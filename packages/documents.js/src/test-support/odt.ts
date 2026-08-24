import type { Package } from "odf.js";
import { decodePackage, ODF_MEDIA_TYPES, zipPackage } from "odf.js";

// Never imported by src/index.ts and never reaches dist/. See docx.ts's top-of-file comment -- the same reasoning applies here: hand-authored ODF XML zipped via odf.js's own zipPackage/decodePackage, never via this package's own createEmptyOdtPackage (src/edit/odt/scaffold.ts), so a bug in that scaffold cannot hide behind a fixture built with the same code. zipPackage's entry order matters here in a way it never does for docx/pptx.ts's own OOXML fixtures: ODF requires the "mimetype" part to be the very first zip entry, stored uncompressed (see src/model/bytes.ts's own OdtBytesSchema note), so `stored: true` on that entry alone, first in the array, is load-bearing.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const MIMETYPE = enc(ODF_MEDIA_TYPES.odt);

// One heading, one paragraph with a bold text:span, and a 2x1 table with explicit column widths -- the same paragraph/run/table block shapes docx.ts's own minimalDocxPackage fixture exercises, so odtToPdf's tests prove readOdtContent feeds convertWordprocessingToLayout something more than a single bare paragraph. text:outline-level="1" on the heading exercises readOdt's own Heading1 styleId synthesis; the Bold text style and the two table-column styles are automatic styles (office:automatic-styles), resolved by odf.js's own single-level findStyleElement/cascade lookups exactly as a real LibreOffice-authored content.xml would resolve them.
const CONTENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><office:automatic-styles><style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="Col1" style:family="table-column"><style:table-column-properties style:column-width="3cm"/></style:style><style:style style:name="Col2" style:family="table-column"><style:table-column-properties style:column-width="3cm"/></style:style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">Hello from odt</text:h><text:p>Second paragraph with <text:span text:style-name="Bold">bold text</text:span> inside.</text:p><table:table><table:table-column table:style-name="Col1"/><table:table-column table:style-name="Col2"/><table:table-row><table:table-cell><text:p>A1</text:p></table:table-cell><table:table-cell><text:p>B1</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>',
);

function odtEntries(): (readonly [
  string,
  { readonly bytes: Uint8Array<ArrayBuffer>; readonly stored?: boolean },
])[] {
  return [
    ["mimetype", { bytes: MIMETYPE, stored: true }],
    ["content.xml", { bytes: CONTENT_XML }],
  ];
}

// A minimal but structurally authentic odt package (mimetype part first and stored, a real office:document-content with automatic styles) -- enough to round-trip through decodePackage and readOdtContent without needing a real LibreOffice-exported binary.
export function minimalOdtPackage(): Package {
  return decodePackage(minimalOdtBytes());
}

export function minimalOdtBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage(odtEntries());
}
