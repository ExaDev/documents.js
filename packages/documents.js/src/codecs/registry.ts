import type { ContentCodec } from 'document-schema.js';
import { buildXlsxPackageFromContent } from 'ooxml.js';
import { writePdf } from 'pdf-codec';
import type { LayoutDocument } from 'pdf-codec';
import type { DocumentFormat } from '../convert/port';
import { buildDocxPackage } from '../edit/docx/content';
import { buildOdgPackage } from '../edit/odg/content';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdsPackage } from '../edit/ods/content';
import { buildOdtPackage } from '../edit/odt/content';
import { buildPptxPackage } from '../edit/pptx/content';
import { encodeMarkdownText } from '../markdown/text';
import { buildMarkdownText } from '../markdown/write';
import { encodeCsvText } from '../csv/text';
import { buildCsvText } from '../csv/write';
import { encodeSvgText } from '../svg/text';
import { buildSvgText } from '../svg/write';
import { encodeDocumentPackage } from '../package-codec';
import { CONTENT_READERS, type DocumentCodecOptions, readDocumentLayout } from './read';

// The layout half of a registry entry, stated here as a plain structural type: document-schema.js's LayoutCodec port retired with the LayoutDocument demotion (the item family moved to pdf-codec at schema 4.0.0, and the schema no longer knows the type a layout codec would carry), so the registry names the two-function shape itself over pdf-codec's own LayoutDocument -- the same shape the retired port gave it, one owner over.
export interface LayoutEntryCodec {
  read(bytes: Uint8Array, options?: DocumentCodecOptions): LayoutDocument;
  write(layout: LayoutDocument, options?: DocumentCodecOptions): Uint8Array;
}

// Every DocumentFormat's own capability, expressed as data rather than as three independent switch statements re-deriving the same "given a format, which read/build function do I call" dispatch. A format's `content` entry wraps the identical readXContent/buildXPackage pair every ergonomic conversion in this package already uses for it (via decodeDocumentPackage/encodeDocumentPackage for the raw-package half); a format's `layout` entry wraps a LayoutDocument codec (pdf only, so far).
//
// Direction split (#744): every `read` closure lives in src/codecs/read.ts, imported here as CONTENT_READERS/readDocumentLayout, so this module keeps only the write halves -- and the pdf-codec ROOT barrel import (writePdf) those write halves genuinely need. That barrel's own font-registry/math-font imports put every vendored font asset one import away, which is exactly what the read-only documents.js/read entry (src/convert/from-pdf.ts) must never reach, so a read-only consumer (readDocumentMetadata, defined on the read entry) dispatches through src/codecs/read.ts directly rather than through this both-directions registry -- the identical split the composition engine already made (src/convert/composition.ts versus composition-to-pdf.ts), and the one src/read-graph.test.ts holds by walking the read entry's graph.
export interface DocumentFormatCodecs {
  readonly content?: ContentCodec<DocumentCodecOptions>;
  readonly layout?: LayoutEntryCodec;
}

// xlsx's entry wraps ooxml.js's own readXlsxContent/buildXlsxPackageFromContent (the flat ContentDocument builder; ooxml.js 4.0.0 gives the bare buildXlsxPackage name to the tree-form DocumentPackage counterpart, which this flat-form pipeline does not use) exactly the way every other OPC/ODF format's entry wraps its own readXContent/buildXPackage pair. The xlsx pair is also re-exported at the src/index.ts boundary (readXlsxContent as-is, the flat builder under this package's own buildXlsxPackage name); this internal registry calling them directly changes nothing about that public surface. Wrapping them here, behind the same DocumentFormatCodecs shape every other format already uses, is what lets readDocumentMetadata/setDocumentMetadata/buildDocumentBytes treat xlsx uniformly with the rest of DocumentFormat rather than special-casing it -- see each of those modules' own comments for exactly which xlsx special-cases this closed. odf (a standalone formula document) has a content.read but no content.write: odf.js has no write path for a formula document at all, so `write` is left unset rather than stubbed.
export const DOCUMENT_FORMAT_CODECS: Readonly<Record<DocumentFormat, DocumentFormatCodecs>> = {
  docx: {
    content: {
      read: CONTENT_READERS.docx,
      write: (content) => encodeDocumentPackage('docx', buildDocxPackage(content)),
    },
  },
  pptx: {
    content: {
      read: CONTENT_READERS.pptx,
      write: (content) => encodeDocumentPackage('pptx', buildPptxPackage(content)),
    },
  },
  odt: {
    content: {
      read: CONTENT_READERS.odt,
      write: (content) => encodeDocumentPackage('odt', buildOdtPackage(content)),
    },
  },
  odp: {
    content: {
      read: CONTENT_READERS.odp,
      write: (content) => encodeDocumentPackage('odp', buildOdpPackage(content)),
    },
  },
  ods: {
    content: {
      read: CONTENT_READERS.ods,
      write: (content) => encodeDocumentPackage('ods', buildOdsPackage(content)),
    },
  },
  odg: {
    content: {
      read: CONTENT_READERS.odg,
      write: (content) => encodeDocumentPackage('odg', buildOdgPackage(content)),
    },
  },
  odf: {
    content: {
      read: CONTENT_READERS.odf,
    },
  },
  markdown: {
    content: {
      read: CONTENT_READERS.markdown,
      write: (content) => encodeMarkdownText(buildMarkdownText(content)),
    },
  },
  // The csv entry is the markdown entry's structural twin: decode straight from bytes to text (no package), read into a ContentDocument, write the reverse. DocumentCodecOptions carries no delimiter/sheet, so this codec reads and writes the default comma dialect over a lone sheet -- a caller wanting TSV output or a named sheet of a multi-sheet document uses the named conversions (convert.ts's xlsxToCsv/odsToCsv/pdfToCsv), which thread { delimiter, sheet } through UnifiedConversionOptions; a multi-sheet write through THIS codec throws buildCsvText's own CsvSheetNotSpecifiedError rather than silently truncating.
  csv: {
    content: {
      read: CONTENT_READERS.csv,
      write: (content) => encodeCsvText(buildCsvText(content)),
    },
  },
  // The svg entry is the csv entry's structural twin: decode straight from bytes to text (no package), read into a drawing ContentDocument, write the reverse. DocumentCodecOptions carries no page/onSvgDiagnostic, so this codec writes page 0 of a drawing with no diagnostic channel -- a caller wanting a different page of a multi-page document or the reader's scope-limit diagnostics uses the named conversions (convert.ts's svgToPdf/odgToSvg and their kin), which thread { page, onSvgDiagnostic } through UnifiedConversionOptions; a multi-sheet write through THIS codec throws buildSvgText's own SvgMultiPageNotSpecifiedError rather than silently truncating.
  svg: {
    content: {
      read: CONTENT_READERS.svg,
      write: (content) => encodeSvgText(buildSvgText(content)),
    },
  },
  pdf: {
    layout: {
      read: readDocumentLayout,
      write: (layout, options) => writePdf(layout, { signal: options?.signal }),
    },
  },
  xlsx: {
    content: {
      read: CONTENT_READERS.xlsx,
      write: (content) => encodeDocumentPackage('xlsx', buildXlsxPackageFromContent(content)),
    },
  },
};
