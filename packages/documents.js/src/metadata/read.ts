import type { LayoutMetadata } from 'document-schema.js';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage } from 'ooxml.js';
import { readPdf } from 'pdf-codec';
import { xlsxToPdf } from '../convert/convert';
import type { DocumentFormat } from '../convert/port';
import { decodeMarkdownText } from '../markdown/text';
import { readMarkdownContent } from '../markdown/read';
import { readOdfFormulaContent } from '../odf/formula/read';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { throwIfAborted } from '../ports/abort';

export interface ReadDocumentMetadataOptions {
  readonly signal?: AbortSignal;
}

// Every DocumentFormat this function can pull a LayoutMetadata out of, dispatched purely by format: docx/pptx read through ooxml.js's own decodePackage; odt/odp/ods/odg/odf through odf.js's, aliased to keep the two apart at this one call site that needs both (mirroring createDocumentFontRegistry's own callers); markdown decodes its own UTF-8 byte<->text boundary first, since readMarkdownContent takes a string, not bytes; pdf reads its metadata directly, with no ContentDocument involved at all; xlsx has no readXlsxContent re-exported from this package's own public surface (see the README's Architecture section), so it goes through the same throwaway xlsxToPdf-then-readPdf preview every other xlsx-metadata-adjacent caller in this ecosystem already uses to open an xlsx without a dedicated reader of its own. Cancellation has no loop of its own to hook into for the seven synchronous single-pass readers (docx/pptx/odt/odp/ods/odg/odf) -- the signal is checked once before dispatching, matching odtToDocx's own reasoning (src/convert/convert.ts) for the identical shape of read -- while markdown/pdf/xlsx forward it into their own readers, which do have one.
export function readDocumentMetadata(format: DocumentFormat, bytes: Uint8Array<ArrayBuffer>, options?: ReadDocumentMetadataOptions): LayoutMetadata {
  const signal = options?.signal;
  switch (format) {
    case 'docx':
      throwIfAborted(signal);
      return readDocxContent(decodeOoxmlPackage(bytes)).metadata;
    case 'pptx':
      throwIfAborted(signal);
      return readPptxContent(decodeOoxmlPackage(bytes)).metadata;
    case 'odt':
      throwIfAborted(signal);
      return readOdtContent(decodeOdfPackage(bytes)).metadata;
    case 'odp':
      throwIfAborted(signal);
      return readOdpContent(decodeOdfPackage(bytes)).metadata;
    case 'ods':
      throwIfAborted(signal);
      return readOdsContent(decodeOdfPackage(bytes)).metadata;
    case 'odg':
      throwIfAborted(signal);
      return readOdgContent(decodeOdfPackage(bytes)).metadata;
    case 'odf':
      throwIfAborted(signal);
      return readOdfFormulaContent(decodeOdfPackage(bytes)).metadata;
    case 'markdown':
      return readMarkdownContent(decodeMarkdownText(bytes), { signal }).metadata;
    case 'pdf':
      return readPdf(bytes, { signal }).metadata;
    case 'xlsx':
      return readPdf(xlsxToPdf(bytes, { signal }), { signal }).metadata;
  }
}
