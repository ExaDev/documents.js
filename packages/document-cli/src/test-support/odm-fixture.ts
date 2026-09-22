// A minimal, hand-authored .odm fixture for exercising odm-to-pdf's own CLI wiring (commands/odm.ts), built the same way documents.js's own internal test-support/odm.ts does: zipPackage'd ODF XML rather than any real writer (there is no .odm writer in this ecosystem to build one with). Only the one shape odm-to-pdf's own resolveSubDocument callback needs — a single text:section/text:section-source referencing one chapter by href.
import { zipPackage } from "documents.js";

const ODM_MEDIA_TYPE = "application/vnd.oasis.opendocument.text-master";

const ODM_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// A single-chapter .odm referencing `href` (e.g. "chapter1.odt") by a text:section-source, matching the shape a real LibreOffice-authored .odm declares (see documents.js's own odmToPdf real-file verification).
export function singleChapterOdmBytes(href: string): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${ODM_NS}><office:body><office:text><text:section text:name="Chapter1"><text:section-source xlink:href="${href}" text:filter-name="writer8"/></text:section></office:text></office:body></office:document-content>`,
  );
  // documents.js re-exports ooxml.js's own zipPackage (a plain path -> bytes Record), not odf.js's (an ordered array of [path, {bytes, stored}] tuples) — there is no ODF-specific zip builder in documents.js's own public surface, and this fixture only needs to be readable, not a byte-for-byte-authentic ODF part layout.
  return zipPackage({
    mimetype: enc(ODM_MEDIA_TYPE),
    "content.xml": contentXml,
  });
}
