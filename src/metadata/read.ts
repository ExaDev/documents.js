import type { LayoutMetadata } from 'document-schema.js';
import { readPdf } from 'pdf-codec';
import { DOCUMENT_FORMAT_CODECS } from '../codecs/registry';
import { xlsxToPdf } from '../convert/convert';
import type { DocumentFormat } from '../convert/port';

export interface ReadDocumentMetadataOptions {
  readonly signal?: AbortSignal;
}

// Every DocumentFormat this function can pull a LayoutMetadata out of, dispatched via DOCUMENT_FORMAT_CODECS (src/codecs/registry.ts) rather than a hand-written per-format switch: docx/pptx/odt/odp/ods/odg/odf each resolve to that registry's own `content` codec, pdf to its `layout` codec -- both already carry each format's own cancellation policy (a one-time throwIfAborted for the seven synchronous single-pass readers, straight signal-forwarding for pdf, matching odtToDocx's own reasoning in src/convert/convert.ts for the identical shape of read). xlsx now has a real registry `content` codec too (DOCUMENT_FORMAT_CODECS.xlsx.content, wrapping ooxml.js's readXlsxContent), but readDocumentMetadata deliberately does NOT dispatch xlsx through it: a direct readXlsxContent(...).metadata and the xlsxToPdf-then-readPdf preview this function already used disagree on real fields, not just incidentally -- confirmed directly (src/metadata/read.test.ts's own xlsx case): a fresh readXlsxContent leaves createdIso/modifiedIso/producer unset, while the PDF-preview path fills all three in (odsToPdf's own layout/writePdf pipeline resolves timestamps and stamps a producer that a bare ContentDocument read never does). Switching to the direct codec would silently change what readDocumentMetadata('xlsx', ...) reports for those three fields, so the existing PDF-preview workaround stays -- xlsx remains a named exception here even though it no longer needs to be for setDocumentMetadata/buildDocumentBytes (see those modules' own comments), which rebuild/build rather than report a timestamp.
export function readDocumentMetadata(format: DocumentFormat, bytes: Uint8Array<ArrayBuffer>, options?: ReadDocumentMetadataOptions): LayoutMetadata {
  const signal = options?.signal;
  if (format === 'xlsx') {
    return readPdf(xlsxToPdf(bytes, { signal }), { signal }).metadata;
  }
  const codecs = DOCUMENT_FORMAT_CODECS[format];
  if (codecs.content) {
    return codecs.content.read(bytes, { signal }).metadata;
  }
  if (codecs.layout) {
    return codecs.layout.read(bytes, { signal }).metadata;
  }
  throw new Error(`DocumentFormat '${format}' has neither a content nor a layout codec in DOCUMENT_FORMAT_CODECS, and is not 'xlsx' -- this is an internal invariant violation, not a caller error`);
}
