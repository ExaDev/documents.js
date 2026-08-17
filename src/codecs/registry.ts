import type { ContentCodec, LayoutCodec } from 'document-schema.js';
import { buildXlsxPackage, readXlsxContent } from 'ooxml.js';
import { readPdf, writePdf } from 'pdf-codec';
import type { DocumentFormat } from '../convert/port';
import { buildDocxPackage } from '../edit/docx/content';
import { buildOdgPackage } from '../edit/odg/content';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdsPackage } from '../edit/ods/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { decodeMarkdownText, encodeMarkdownText } from '../markdown/text';
import type { MarkdownImageResolver } from 'markdown-codec';
import { readMarkdownContent } from '../markdown/read';
import { buildMarkdownText } from '../markdown/write';
import { decodeCsvText, encodeCsvText } from '../csv/text';
import { readCsvContent } from '../csv/read';
import { buildCsvText } from '../csv/write';
import { decodeSvgText, encodeSvgText } from '../svg/text';
import { readSvgContent } from '../svg/read';
import { buildSvgText } from '../svg/write';
import { readOdfFormulaContent } from '../odf/formula/read';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { decodeDocumentPackage, encodeDocumentPackage } from '../package-codec';
import { throwIfAborted } from '../ports/abort';

// document-schema.js's ContentCodec/LayoutCodec declare `read(bytes: Uint8Array, ...)`/`write(...): Uint8Array` with TypeScript's default (SharedArrayBuffer-or-ArrayBuffer-backed) Uint8Array generic, one step broader than this package's own Uint8Array<ArrayBuffer> convention that decodeDocumentPackage/readPdf/every public entry point in this package's own index.ts requires. A real, narrow runtime check (not an assertion) proves the narrowing at this exact boundary rather than casting past it. Exported so every caller of a DOCUMENT_FORMAT_CODECS entry's own `write` (src/metadata/write.ts, src/convert/from-package.ts) can narrow its return value the same way, rather than each re-deriving the identical check.
export function isArrayBufferBacked(bytes: Uint8Array): bytes is Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer;
}

export function requireArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!isArrayBufferBacked(bytes)) {
    throw new TypeError('expected an ArrayBuffer-backed Uint8Array, received one backed by a SharedArrayBuffer');
  }
  return bytes;
}

// The one option every registry entry's read/write genuinely needs to know about -- an AbortSignal -- plus an optional MarkdownImageResolver consulted only by the markdown content codec's read (every other codec ignores it). Matches the shape every one of this registry's own callers (readDocumentMetadata, setDocumentMetadata) already threads through this exact call path, so parameterizing ContentCodec/LayoutCodec with this concrete type (rather than the default `unknown`) lets a caller forward its own signal straight through without a cast at either end.
export interface DocumentCodecOptions {
  readonly signal?: AbortSignal;
  readonly images?: MarkdownImageResolver;
}

// Every DocumentFormat's own capability, expressed as data rather than as three independent switch statements re-deriving the same "given a format, which read/build function do I call" dispatch. A format's `content` entry wraps the identical readXContent/buildXPackage pair every ergonomic conversion in this package already uses for it (via decodeDocumentPackage/encodeDocumentPackage for the raw-package half); a format's `layout` entry wraps a LayoutDocument codec (pdf only, so far). Cancellation policy is preserved per format exactly as it was before this registry existed: docx/pptx/odt/odp/ods/odg/odf have no loop of their own to hook a signal into, so their own `read` checks it once via throwIfAborted before decoding; markdown/pdf do have one, so their own `read`/`write` forward the signal straight into the underlying reader/writer instead of checking it separately.
export interface DocumentFormatCodecs {
  readonly content?: ContentCodec<DocumentCodecOptions>;
  readonly layout?: LayoutCodec<DocumentCodecOptions>;
}

// xlsx now has a real content codec too, wrapping ooxml.js's own readXlsxContent/buildXlsxPackage exactly the way every other OPC/ODF format's entry wraps its own readXContent/buildXPackage pair. This does not contradict the README's Architecture-section statement that documents.js does not re-export readXlsxContent/buildXlsxPackage as public API: that statement is about src/index.ts's own export surface (still true -- neither name is exported from there), not about whether this internal registry may call them. Wrapping them here, behind the same DocumentFormatCodecs shape every other format already uses, is what lets readDocumentMetadata/setDocumentMetadata/buildDocumentBytes treat xlsx uniformly with the rest of DocumentFormat rather than special-casing it -- see each of those modules' own comments for exactly which xlsx special-cases this closed. odf (a standalone formula document) has a content.read but no content.write: odf.js has no write path for a formula document at all, so `write` is left unset rather than stubbed.
export const DOCUMENT_FORMAT_CODECS: Readonly<Record<DocumentFormat, DocumentFormatCodecs>> = {
  docx: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readDocxContent(decodeDocumentPackage('docx', requireArrayBufferBytes(bytes)));
      },
      write: (content) => encodeDocumentPackage('docx', buildDocxPackage(content)),
    },
  },
  pptx: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readPptxContent(decodeDocumentPackage('pptx', requireArrayBufferBytes(bytes)));
      },
      write: (content) => encodeDocumentPackage('pptx', buildPptxPackage(content)),
    },
  },
  odt: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readOdtContent(decodeDocumentPackage('odt', requireArrayBufferBytes(bytes)));
      },
      write: (content) => encodeDocumentPackage('odt', buildOdtPackage(content)),
    },
  },
  odp: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readOdpContent(decodeDocumentPackage('odp', requireArrayBufferBytes(bytes)));
      },
      write: (content) => encodeDocumentPackage('odp', buildOdpPackage(content)),
    },
  },
  ods: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readOdsContent(decodeDocumentPackage('ods', requireArrayBufferBytes(bytes)));
      },
      write: (content) => encodeDocumentPackage('ods', buildOdsPackage(content)),
    },
  },
  odg: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readOdgContent(decodeDocumentPackage('odg', requireArrayBufferBytes(bytes)));
      },
      write: (content) => encodeDocumentPackage('odg', buildOdgPackage(content)),
    },
  },
  odf: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readOdfFormulaContent(decodeDocumentPackage('odf', requireArrayBufferBytes(bytes)));
      },
    },
  },
  markdown: {
    content: {
      read: (bytes, options) => readMarkdownContent(decodeMarkdownText(bytes), { signal: options?.signal, images: options?.images }),
      write: (content) => encodeMarkdownText(buildMarkdownText(content)),
    },
  },
  // The csv entry is the markdown entry's structural twin: decode straight from bytes to text (no package), read into a ContentDocument, write the reverse. DocumentCodecOptions carries no delimiter/sheet, so this codec reads and writes the default comma dialect over a lone sheet -- a caller wanting TSV output or a named sheet of a multi-sheet document uses the named conversions (convert.ts's xlsxToCsv/odsToCsv/pdfToCsv), which thread { delimiter, sheet } through UnifiedConversionOptions; a multi-sheet write through THIS codec throws buildCsvText's own CsvSheetNotSpecifiedError rather than silently truncating. decodeCsvText is a fatal decoder with no loop of its own, so no separate signal check is needed -- the same reasoning as the markdown entry beside it.
  csv: {
    content: {
      read: (bytes) => readCsvContent(decodeCsvText(bytes)),
      write: (content) => encodeCsvText(buildCsvText(content)),
    },
  },
  // The svg entry is the csv entry's structural twin: decode straight from bytes to text (no package), read into a drawing ContentDocument, write the reverse. DocumentCodecOptions carries no page/onSvgDiagnostic, so this codec writes page 0 of a drawing with no diagnostic channel -- a caller wanting a different page of a multi-page document or the reader's scope-limit diagnostics uses the named conversions (convert.ts's svgToPdf/odgToSvg and their kin), which thread { page, onSvgDiagnostic } through UnifiedConversionOptions; a multi-page write through THIS codec throws buildSvgText's own SvgMultiPageNotSpecifiedError rather than silently truncating. decodeSvgText is a fatal decoder with no loop of its own, so no separate signal check is needed -- the same reasoning as the csv entry beside it.
  svg: {
    content: {
      read: (bytes) => readSvgContent(decodeSvgText(bytes)),
      write: (content) => encodeSvgText(buildSvgText(content)),
    },
  },
  pdf: {
    layout: {
      read: (bytes, options) => readPdf(requireArrayBufferBytes(bytes), { signal: options?.signal }),
      write: (layout, options) => writePdf(layout, { signal: options?.signal }),
    },
  },
  xlsx: {
    content: {
      read: (bytes, options) => {
        throwIfAborted(options?.signal);
        return readXlsxContent(decodeDocumentPackage('xlsx', requireArrayBufferBytes(bytes)));
      },
      write: (content) => encodeDocumentPackage('xlsx', buildXlsxPackage(content)),
    },
  },
};
