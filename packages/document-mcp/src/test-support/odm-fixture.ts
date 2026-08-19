import { ODF_MEDIA_TYPES, zipPackage } from 'odf.js';

// Hand-authored ODF XML zipped via odf.js's own zipPackage, matching this repo's own src/test-support/docx-extras-fixture.ts convention -- a real package built at the byte level rather than through any format-specific write API, since neither odf.js nor documents.js exposes a .odm writer at all. Ported from documents.js's own src/test-support/odm.ts: the text:section/text:section-source shape below (a self-closing text:section-source, a relative "../chapterN.odt" href, text:filter-name="writer8", no xlink:show/xlink:type) is exactly what a real, unmodified LibreOffice .odm was empirically confirmed to produce -- see documents.js's own odmToPdf README/gotchas entry for the real-file verification this shape is checked against.

function enc(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

const ODM_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';

export interface OdmChapterRef {
  readonly name: string;
  readonly href: string;
}

function odmContentXml(sections: readonly OdmChapterRef[]): Uint8Array<ArrayBuffer> {
  const sectionsXml = sections
    .map((section) => `<text:section text:name="${section.name}"><text:section-source xlink:href="${section.href}" text:filter-name="writer8"/></text:section>`)
    .join('');
  return enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${ODM_NS}><office:body><office:text>${sectionsXml}</office:text></office:body></office:document-content>`);
}

// A master document referencing each of `sections` by name/href, in the given order.
export function odmBytes(sections: readonly OdmChapterRef[]): Uint8Array<ArrayBuffer> {
  return zipPackage([
    ['mimetype', { bytes: enc(ODF_MEDIA_TYPES.odm), stored: true }],
    ['content.xml', { bytes: odmContentXml(sections) }],
  ]);
}

const CHAPTER_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

function chapterContentXml(heading: string, body: string): Uint8Array<ArrayBuffer> {
  return enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${CHAPTER_NS}><office:body><office:text><text:h text:outline-level="1">${heading}</text:h><text:p>${body}</text:p></office:text></office:body></office:document-content>`);
}

// A minimal but structurally authentic odt chapter -- a real mimetype-first-and-stored zip, one heading and one paragraph -- with caller-supplied text so a test can tell which chapter's content ended up where in the combined output.
export function chapterOdtBytes(heading: string, body: string): Uint8Array<ArrayBuffer> {
  return zipPackage([
    ['mimetype', { bytes: enc(ODF_MEDIA_TYPES.odt), stored: true }],
    ['content.xml', { bytes: chapterContentXml(heading, body) }],
  ]);
}
