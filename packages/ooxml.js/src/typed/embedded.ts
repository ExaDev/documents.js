import { isZipArchive } from 'archive-codec';
import type { ContentDocument } from 'document-schema.js';
import type { Package } from '../model/package';
import { parsePackage } from '../package-io/read';
import type { ContentEmbeddedObjectKind } from 'document-schema.js';
import { readDocxContent } from './docx/read';
import { readPptxContent } from './pptx/read';
import { readXlsxContent } from './xlsx/content';
import { rootElement } from './util';

// The shared embedded-object decode: an OOXML package's OLE embeddings (pptx's p:oleObj/@r:id target part, docx's o:OLEObject/@r:id target part) hold either a classic OLE compound-file blob (.bin -- opaque external-application data this ecosystem has no reader for) or, as every modern producer writes an OOXML embeddee, a whole nested OOXML package zipped into the part's bytes. This module recovers that second case: ZIP magic checked up front (archive-codec's isZipArchive -- a byte check, never a parse-and-catch), the bytes unzipped into a nested Package via parsePackage, the flavour detected from the nested package's own entry part, and the matching typed reader run to produce the nested ContentDocument that ContentEmbeddedObject.document carries.
//
// Flavour detection is by entry-part path, not [Content_Types].xml overrides, for two reasons: the three entry paths are exactly what the readers themselves dispatch on (readDocxContent throws without word/document.xml, readSlidePathsInOrder reads ppt/presentation.xml, resolveSheetEntries reads xl/workbook.xml), so detection by the same paths guarantees the chosen reader's precondition already holds; and the macro-enabled variants (docm/pptm/xlsm) share these exact paths -- the macro payload is an extra vbaProject.bin part, not a different entry -- so they map onto the same three content kinds with no separate case.
//
// This module imports all three format readers while pptx/read.ts imports this module back (the OLE branch calls it) -- a module cycle that is safe because every cross-use is call-time only: both sides export hoisted function declarations and run nothing at evaluation time. odf.js's equivalent (typed/draw/embedded.ts) instead moved dispatch into each calling format reader to break the analogous cycle; that split is not taken here because the dispatch would then be written twice (pptx now, docx in the #734 follow-up) over one three-row table.

// The ContentEmbeddedObjectKind members an OOXML embedding can produce -- 'formula' and 'drawing' have no OOXML producer here (they are ODF/MathML spellings), so they are not in this union.
export type EmbeddedOoxmlKind = Extract<ContentEmbeddedObjectKind, 'wordprocessing' | 'presentation' | 'spreadsheet'>;

// Thrown when the payload IS a ZIP but not a recognisable OOXML package: a valid archive with none of the three entry parts is a real input a caller must hear about (a silently skipped payload is indistinguishable from an absent one), so it fails loudly rather than degrading. A non-ZIP payload is NOT this error -- it is the classic OLE compound-file case, a documented non-event returned as undefined below.
export class UnrecognisedOoxmlPackageError extends Error {
  constructor() {
    super('readEmbeddedOoxmlPayload: the embedded ZIP archive is not a recognisable OOXML package (none of word/document.xml, ppt/presentation.xml, xl/workbook.xml is present as an XML part)');
    this.name = 'UnrecognisedOoxmlPackageError';
  }
}

export interface EmbeddedOoxmlPayload {
  readonly objectKind: EmbeddedOoxmlKind;
  readonly document: ContentDocument;
}

const ENTRY_PARTS: readonly { readonly partPath: string; readonly objectKind: EmbeddedOoxmlKind }[] = [
  { partPath: 'word/document.xml', objectKind: 'wordprocessing' },
  { partPath: 'ppt/presentation.xml', objectKind: 'presentation' },
  { partPath: 'xl/workbook.xml', objectKind: 'spreadsheet' },
];

// A real OOXML package has exactly one main document part, so at most one entry part is ever present; a fixed probe order keeps detection deterministic even for a hand-built package that somehow carries two.
function detectFlavour(nested: Package): EmbeddedOoxmlKind | undefined {
  return ENTRY_PARTS.find((candidate) => rootElement(nested.parts[candidate.partPath]) !== undefined)?.objectKind;
}

// Decodes an embedded-object payload part's bytes into the ContentEmbeddedObject payload (objectKind + the whole nested ContentDocument). Returns undefined when the bytes are not a ZIP at all -- the classic OLE compound-file payload, whose recovery is out of scope and whose caller keeps whatever behaviour it had before. Throws UnrecognisedOoxmlPackageError when the bytes are a ZIP but no OOXML entry part is present.
export function readEmbeddedOoxmlPayload(bytes: Uint8Array<ArrayBuffer>): EmbeddedOoxmlPayload | undefined {
  if (!isZipArchive(bytes)) {
    return undefined;
  }
  const nested = parsePackage(bytes);
  const objectKind = detectFlavour(nested);
  if (objectKind === undefined) {
    throw new UnrecognisedOoxmlPackageError();
  }
  return { objectKind, document: readNestedDocument(objectKind, nested) };
}

// The wordprocessing and presentation arms rebuild the ContentDocument envelope the same way readDocx/readPptx (typed/document-package.ts) do: readDocxContent/readPptxContent return their own per-format shapes whose extras (comments, footnotes, headers, footers, numbering on DocxDocument) have no ContentDocument spelling and so do not ride the embedded document. The spreadsheet arm needs no wrap -- readXlsxContent already returns a full ContentDocument.
function readNestedDocument(objectKind: EmbeddedOoxmlKind, nested: Package): ContentDocument {
  switch (objectKind) {
    case 'wordprocessing': {
      const { metadata, sections } = readDocxContent(nested);
      return { kind: 'wordprocessing', metadata, sections };
    }
    case 'presentation': {
      const { metadata, slides } = readPptxContent(nested);
      return { kind: 'presentation', metadata, slides };
    }
    case 'spreadsheet':
      return readXlsxContent(nested);
  }
}
