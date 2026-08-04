import type { ContentCodec, LayoutCodec } from 'document-schema.js';
import { readPdf, writePdf } from 'pdf-codec';
import type { DocumentFormat } from '../convert/port';
import { buildDocxPackage } from '../edit/docx/content';
import { buildOdgPackage } from '../edit/odg/content';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdsPackage } from '../edit/ods/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { decodeMarkdownText, encodeMarkdownText } from '../markdown/text';
import { readMarkdownContent } from '../markdown/read';
import { buildMarkdownText } from '../markdown/write';
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

// The one option every registry entry's read/write genuinely needs to know about -- an AbortSignal. Matches the shape every one of this registry's own callers (readDocumentMetadata, setDocumentMetadata) already threads through this exact call path, so parameterizing ContentCodec/LayoutCodec with this concrete type (rather than the default `unknown`) lets a caller forward its own signal straight through without a cast at either end.
export interface DocumentCodecOptions {
  readonly signal?: AbortSignal;
}

// Every DocumentFormat's own capability, expressed as data rather than as three independent switch statements re-deriving the same "given a format, which read/build function do I call" dispatch. A format's `content` entry wraps the identical readXContent/buildXPackage pair every ergonomic conversion in this package already uses for it (via decodeDocumentPackage/encodeDocumentPackage for the raw-package half); a format's `layout` entry wraps a LayoutDocument codec (pdf only, so far). Cancellation policy is preserved per format exactly as it was before this registry existed: docx/pptx/odt/odp/ods/odg/odf have no loop of their own to hook a signal into, so their own `read` checks it once via throwIfAborted before decoding; markdown/pdf do have one, so their own `read`/`write` forward the signal straight into the underlying reader/writer instead of checking it separately.
export interface DocumentFormatCodecs {
  readonly content?: ContentCodec<DocumentCodecOptions>;
  readonly layout?: LayoutCodec<DocumentCodecOptions>;
}

// xlsx has a real raw-package codec (decodeDocumentPackage/encodeDocumentPackage both cover it, since it's an ordinary OPC container) but no ContentDocument-level codec at all: this package deliberately does not re-export ooxml.js's own readXlsxContent/buildXlsxPackage (see the README's Architecture section), so xlsx's own entry below is genuinely empty -- a real, honest gap, not a fabricated reader/builder. odf (a standalone formula document) has a content.read but no content.write: odf.js has no write path for a formula document at all, so `write` is left unset rather than stubbed.
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
      read: (bytes, options) => readMarkdownContent(decodeMarkdownText(bytes), { signal: options?.signal }),
      write: (content) => encodeMarkdownText(buildMarkdownText(content)),
    },
  },
  pdf: {
    layout: {
      read: (bytes, options) => readPdf(requireArrayBufferBytes(bytes), { signal: options?.signal }),
      write: (layout, options) => writePdf(layout, { signal: options?.signal }),
    },
  },
  xlsx: {},
};
