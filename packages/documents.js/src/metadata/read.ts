import type { LayoutMetadata } from 'document-schema.js';
import { readPdf } from 'pdf-codec';
import { DOCUMENT_FORMAT_CODECS } from '../codecs/registry';
import { xlsxToPdf } from '../convert/convert';
import type { DocumentFormat } from '../convert/port';

export interface ReadDocumentMetadataOptions {
  readonly signal?: AbortSignal;
}

// Every DocumentFormat this function can pull a LayoutMetadata out of, dispatched via DOCUMENT_FORMAT_CODECS (src/codecs/registry.ts) rather than a hand-written per-format switch: docx/pptx/odt/odp/ods/odg/odf each resolve to that registry's own `content` codec, pdf to its `layout` codec -- both already carry each format's own cancellation policy (a one-time throwIfAborted for the seven synchronous single-pass readers, straight signal-forwarding for pdf, matching odtToDocx's own reasoning in src/convert/convert.ts for the identical shape of read). xlsx is the one format with no registry entry at all: it has no readXlsxContent re-exported from this package's own public surface (see the README's Architecture section), so it stays a named exception here, going through the same throwaway xlsxToPdf-then-readPdf preview every other xlsx-metadata-adjacent caller in this ecosystem already uses to open an xlsx without a dedicated reader of its own.
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
