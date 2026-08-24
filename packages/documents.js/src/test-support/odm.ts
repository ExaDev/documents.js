import type { Package } from "odf.js";
import { decodePackage, ODF_MEDIA_TYPES, zipPackage } from "odf.js";

// Never imported by src/index.ts and never reaches dist/. Hand-authored ODF XML zipped via odf.js's own zipPackage/decodePackage, matching src/test-support/odt.ts's own established convention (never built via this package's own writers, so a bug in a future .odm writer couldn't hide behind a fixture built with the same code -- there is no .odm writer in this package at all, but the same reasoning applies to odmToPdf's own reader path). The text:section/text:section-source shape below (a self-closing text:section-source, a relative "../chapterN.odt" href, text:filter-name="writer8", no xlink:show/xlink:type) is exactly what the readOdm phase's own real, unmodified LibreOffice 26.2 fixture (odf.js's own src/typed/odm/fixtures/two-chapters.odm) was empirically confirmed to produce -- see odmToPdf's own real-file verification, run directly against that genuine fixture, for independent proof this hand-authored shape matches a real producer's output.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const ODM_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';

export interface OdmChapterRef {
  readonly name: string;
  readonly href: string;
}

function odmContentXml(
  sections: readonly OdmChapterRef[],
): Uint8Array<ArrayBuffer> {
  const sectionsXml = sections
    .map(
      (section) =>
        `<text:section text:name="${section.name}"><text:section-source xlink:href="${section.href}" text:filter-name="writer8"/></text:section>`,
    )
    .join("");
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${ODM_NS}><office:body><office:text>${sectionsXml}</office:text></office:body></office:document-content>`,
  );
}

// A master document referencing each of `sections` by name/href, in the given order -- mirrors odf.js's own readOdm test fixtures' shape (text:name on the section itself, xlink:href + text:filter-name on its text:section-source child), just built by hand instead of by a real LibreOffice UNO macro.
export function odmBytes(
  sections: readonly OdmChapterRef[],
): Uint8Array<ArrayBuffer> {
  return zipPackage([
    ["mimetype", { bytes: enc(ODF_MEDIA_TYPES.odm), stored: true }],
    ["content.xml", { bytes: odmContentXml(sections) }],
  ]);
}

export function odmPackage(sections: readonly OdmChapterRef[]): Package {
  return decodePackage(odmBytes(sections));
}

const CHAPTER_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

function chapterContentXml(
  heading: string,
  body: string,
): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${CHAPTER_NS}><office:body><office:text><text:h text:outline-level="1">${heading}</text:h><text:p>${body}</text:p></office:text></office:body></office:document-content>`,
  );
}

// A minimal but structurally authentic odt chapter -- a real mimetype-first-and-stored zip, a real office:document-content with one heading and one paragraph -- matching minimalOdtBytes's own convention (src/test-support/odt.ts), just with caller-supplied text so odmToPdf's own tests can tell which chapter's content ended up where in the combined PDF.
export function chapterOdtBytes(
  heading: string,
  body: string,
): Uint8Array<ArrayBuffer> {
  return zipPackage([
    ["mimetype", { bytes: enc(ODF_MEDIA_TYPES.odt), stored: true }],
    ["content.xml", { bytes: chapterContentXml(heading, body) }],
  ]);
}
