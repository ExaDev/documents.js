import type { WriteMarkdownOptions } from 'markdown-codec';
import { writeMarkdown } from 'markdown-codec';
import type { ContentDocument } from '../model/content';

// ContentDocument (the wordprocessing variant) -> markdown text. A thin adapter over markdown-codec's own writeMarkdown, lives beside read.ts rather than under src/edit/ -- there is no live-view editor for markdown the way docx/pptx/odt/odp/ods/odg each have one (src/edit/*): every one of those editors wraps a real, mutable XmlElement tree inside a decoded Package, and markdown has no such tree at all, so there is nothing for a live view to hold a reference into. writeMarkdown itself already accepts a full document-schema.js ContentDocument directly, matching ooxml.js's own buildXlsxPackage(document: ContentDocument) signature rather than odf.js's bare-shape build*Package convention (see markdown-codec's own src/write.ts module comment for the full reasoning) -- documents.js's local ContentDocument (src/model/content.ts) is structurally identical to document-schema.js's own (both are the same discriminated union over the same document-schema.js-sourced ContentSection/ContentSlide/ContentSheet/ContentDrawPage/LayoutMetadata field types, at the same formatVersion literal), so passing the local type through to writeMarkdown's document-schema.js-typed parameter needs no cast.
//
// writeMarkdown throws MarkdownUnsupportedDocumentKindError on its own for a non-'wordprocessing' input -- this adapter adds no redundant guard of its own (unlike buildDocxPackage/buildOdtPackage's own hand-written "requires a wordprocessing ContentDocument" checks): markdown-codec's own error already names the exact failure precisely, and duplicating the check here would only produce a second, less specific error for the identical condition.
export function buildMarkdownText(document: ContentDocument, options?: WriteMarkdownOptions): string {
  return writeMarkdown(document, options);
}
