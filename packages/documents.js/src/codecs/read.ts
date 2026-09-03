import type { ContentDocument } from "document-schema.js";
import { readXlsxContent } from "ooxml.js";
import { readPdf } from "pdf-codec/read";
import type { LayoutDocument } from "pdf-codec";
import type { DocumentFormat } from "../convert/port";
import { decodeMarkdownText } from "../markdown/text";
import { readMarkdownContent } from "../markdown/read";
import type { MarkdownImageResolver } from "markdown-codec";
import { decodeCsvText } from "../csv/text";
import { readCsvContent } from "../csv/read";
import { decodeSvgText } from "../svg/text";
import { readSvgContent } from "../svg/read";
import { readRtfContent } from "rtf-codec";
import { readDocContent } from "doc-codec";
import { readXlsContent } from "xls-codec";
import { readPptContent } from "../ppt/read";
import { readWpdContent } from "wpd-codec";
import { readOdfFormulaContent } from "../odf/formula/read";
import { readOdgContent } from "../odf/odg/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdsContent } from "../odf/ods/read";
import { readOdtContent } from "../odf/odt/read";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { decodeDocumentPackage } from "../package-codec";
import { requireArrayBufferBytes } from "../model/bytes";
import { throwIfAborted } from "../ports/abort";

// The read-only half of DOCUMENT_FORMAT_CODECS (src/codecs/registry.ts), split from it by direction for the identical reason the composition engine split (src/convert/composition.ts versus composition-to-pdf.ts): the registry's write halves legitimately import writePdf from the pdf-codec ROOT barrel, whose own font-registry/math-font imports put every vendored font asset one import away -- so any module that values the registry cannot sit on the read-only documents.js/read entry (src/convert/from-pdf.ts), whose graph src/read-graph.test.ts holds free of exactly those modules. Everything here is the same per-format read wiring the registry wraps, in a module a read-only consumer may safely reach: readPdf arrives from 'pdf-codec/read' (the read pipeline's own owning module) rather than the root barrel, and no buildXPackage/encode/write import appears.
//
// readDocumentMetadata (defined on the read entry itself, src/convert/from-pdf.ts) dispatches through THIS module rather than the registry for that reason (#744), which is what lets metadata reads join the read entry without dragging the write path back into its graph.

// The one option every read here genuinely needs to know about -- an AbortSignal -- plus an optional MarkdownImageResolver consulted only by the markdown read (every other format ignores it). Identical to the shape the registry declares (moved here when the read halves were, so both modules state one options type rather than two that could drift); matches the parameterisation every registry consumer already threads through this exact call path, so a caller can forward its own signal straight through without a cast at either end.
export interface DocumentCodecOptions {
  readonly signal?: AbortSignal;
  readonly images?: MarkdownImageResolver;
}

// Every format whose bytes decode into a ContentDocument -- all sixteen DocumentFormat members except pdf, the one layout format (its read produces a LayoutDocument through readDocumentLayout below instead, mirroring the registry's content/layout entry split).
export type ReadContentFormat = Exclude<DocumentFormat, "pdf">;

export type ContentReader = (
  bytes: Uint8Array,
  options?: DocumentCodecOptions,
) => ContentDocument;

// The fifteen per-format read closures, moved verbatim from the registry: each wraps the identical decode/read pair every ergonomic conversion in this package already uses for that format, with each format's own cancellation policy preserved exactly (docx/pptx/odt/odp/ods/odg/odf/xlsx have no loop of their own to hook a signal into, so their read checks it once via throwIfAborted before decoding; markdown does have one, so its read forwards the signal straight into the reader instead of checking it separately; csv/svg decoders are fatal one-pass functions with no loop, needing no separate check; rtf's own readRtfContent takes bytes directly and checks the signal itself internally, once, before tokenizing -- matching markdown's own single-check-inside-the-reader shape, so rtf's closure forwards the signal straight through rather than checking it twice; doc-codec's readDocContent, xls-codec's readXlsContent, and this package's own src/ppt/read.ts wrapper over ppt-codec's readPptContent take no options at all -- none of the three legacy binary codecs has a loop or a diagnostic sink of its own yet -- so each of their closures checks the signal once via throwIfAborted before decoding, the identical no-loop-format shape docx/pptx/odt/odp/ods/odg/odf/xlsx already get). The registry composes its content entries from these, so there is exactly one place the "which reader for which format" dispatch lives.
export const CONTENT_READERS: Readonly<
  Record<ReadContentFormat, ContentReader>
> = {
  docx: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readDocxContent(
      decodeDocumentPackage("docx", requireArrayBufferBytes(bytes)),
    );
  },
  pptx: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readPptxContent(
      decodeDocumentPackage("pptx", requireArrayBufferBytes(bytes)),
    );
  },
  odt: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readOdtContent(
      decodeDocumentPackage("odt", requireArrayBufferBytes(bytes)),
    );
  },
  odp: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readOdpContent(
      decodeDocumentPackage("odp", requireArrayBufferBytes(bytes)),
    );
  },
  ods: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readOdsContent(
      decodeDocumentPackage("ods", requireArrayBufferBytes(bytes)),
    );
  },
  odg: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readOdgContent(
      decodeDocumentPackage("odg", requireArrayBufferBytes(bytes)),
    );
  },
  odf: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readOdfFormulaContent(
      decodeDocumentPackage("odf", requireArrayBufferBytes(bytes)),
    );
  },
  markdown: (bytes, options) =>
    readMarkdownContent(decodeMarkdownText(bytes), {
      signal: options?.signal,
      images: options?.images,
    }),
  csv: (bytes) => readCsvContent(decodeCsvText(bytes)),
  svg: (bytes) => readSvgContent(decodeSvgText(bytes)),
  // readRtfContent takes bytes directly -- RTF is byte-oriented, not text (a \binN run can carry arbitrary raw picture bytes), so unlike markdown/csv/svg there is no well-formed-UTF-8 decode step to run first. It checks options.signal itself, once, before tokenizing, matching the single-check shape every no-loop format above gets from throwIfAborted.
  rtf: (bytes, options) =>
    readRtfContent(bytes, { signal: options?.signal }).document,
  // doc-codec's readDocContent takes bytes directly and no options -- the pre-2007 Word Binary File Format is genuinely binary ([MS-CFB] + [MS-DOC]), not text, so like rtf there is no well-formed-UTF-8 decode step, and unlike rtf there is no signal to forward at all, so throwIfAborted is the whole cancellation policy.
  doc: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readDocContent(requireArrayBufferBytes(bytes));
  },
  xlsx: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readXlsxContent(
      decodeDocumentPackage("xlsx", requireArrayBufferBytes(bytes)),
    );
  },
  // xls-codec's readXlsContent takes bytes directly and no options -- the legacy Excel Binary File Format (BIFF8) is genuinely binary, matching doc's own no-decode-step, no-signal-of-its-own shape above. XlsContentDocument (a plain Extract<ContentDocument, {kind:'spreadsheet'}>) is fully interchangeable with ContentReader's own return type at this call site, with no narrowing needed.
  xls: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readXlsContent(requireArrayBufferBytes(bytes));
  },
  // src/ppt/read.ts wraps ppt-codec's own flat readPptContent (metadata + slides, matching ooxml.js's/odf.js's own upstream flat readers) into a full 'presentation'-kind ContentDocument, the identical envelope wrap readPptxContent/readOdpContent above already do for their own formats -- see that module's own comment. Genuinely binary bytes ([MS-CFB] + [MS-PPT]), no options of its own, so the same no-decode-step, throwIfAborted-only cancellation policy as doc/xls above.
  ppt: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readPptContent(requireArrayBufferBytes(bytes));
  },
  // readWpdContent takes bytes directly -- a WordPerfect file is a prefix and a function-code stream, not a package this workspace's own decodeDocumentPackage knows, and its own container detection (a bare file versus an OLE compound wrapper) happens inside the reader. It has no loop of its own to hook a signal into, so its read checks the signal once before decoding, the shape every no-package format above gets from throwIfAborted. There is no matching entry in the registry's write half at all: wpd-codec ships no writer, which is what makes wpd a read-only format everywhere else in this package.
  wpd: (bytes, options) => {
    throwIfAborted(options?.signal);
    return readWpdContent(bytes);
  },
};

// pdf's own read half, also moved verbatim from the registry: readPdf from 'pdf-codec/read' (never the root barrel -- see the module comment), forwarding the signal since readPdf has a page loop of its own.
export function readDocumentLayout(
  bytes: Uint8Array,
  options?: DocumentCodecOptions,
): LayoutDocument {
  return readPdf(requireArrayBufferBytes(bytes), { signal: options?.signal });
}
