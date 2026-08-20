import { isZipArchive } from 'archive-codec';
import type { ContentDocument } from 'document-schema.js';
import type { XmlElement } from '../model/node';
import type { Package } from '../model/package';
import { parsePackage } from '../package-io/read';
import type { ContentEmbeddedObjectKind } from 'document-schema.js';
import { readDocxContent } from './docx/read';
import { readPptxContent } from './pptx/read';
import { readXlsxContent } from './xlsx/content';
import { childrenWithTag, rootElement } from './util';

// The shared embedded-object decode: an OOXML package's OLE embeddings (pptx's p:oleObj/@r:id target part, docx's o:OLEObject/@r:id target part) hold either a classic OLE compound-file blob (.bin -- opaque external-application data this ecosystem has no reader for) or, as every modern producer writes an OOXML embeddee, a whole nested OOXML package zipped into the part's bytes. This module recovers that second case: ZIP magic checked up front (archive-codec's isZipArchive -- a byte check, never a parse-and-catch), the bytes unzipped into a nested Package via parsePackage, the flavour detected from the nested package's own entry part, and the matching typed reader run to produce the nested ContentDocument that ContentEmbeddedObject.document carries.
//
// Flavour detection is by entry-part path, not [Content_Types].xml overrides, for two reasons: the three entry paths are exactly what the readers themselves dispatch on (readDocxContent throws without word/document.xml, readSlidePathsInOrder reads ppt/presentation.xml, resolveSheetEntries reads xl/workbook.xml), so detection by the same paths -- plus the one further precondition a reader of the three has, readDocxContent's w:body (hasDocxBody below) -- guarantees the chosen reader's precondition already holds; and the macro-enabled variants (docm/pptm/xlsm) share these exact paths -- the macro payload is an extra vbaProject.bin part, not a different entry -- so they map onto the same three content kinds with no separate case.
//
// This module imports all three format readers while pptx/read.ts imports this module back (the OLE branch calls it) -- a module cycle that is safe because every cross-use is call-time only: both sides export hoisted function declarations and run nothing at evaluation time. odf.js's equivalent (typed/draw/embedded.ts) instead moved dispatch into each calling format reader to break the analogous cycle; that split is not taken here because the dispatch would then be written twice (pptx now, docx in the #734 follow-up) over one three-row table.

// The ContentEmbeddedObjectKind members an OOXML embedding can produce -- 'formula' and 'drawing' have no OOXML producer here (they are ODF/MathML spellings), so they are not in this union.
export type EmbeddedOoxmlKind = Extract<ContentEmbeddedObjectKind, 'wordprocessing' | 'presentation' | 'spreadsheet'>;

export interface EmbeddedOoxmlPayload {
  readonly objectKind: EmbeddedOoxmlKind;
  readonly document: ContentDocument;
}

// readDocxContent is the only one of the three readers with a precondition beyond its entry part existing: it throws when word/document.xml carries no w:body to walk. Detection verifies that precondition up front, so a malformed nested docx degrades to no flavour at detection time rather than reaching a dispatch that would throw. The presentation and spreadsheet readers have no throw preconditions of their own.
function hasDocxBody(root: XmlElement): boolean {
  return childrenWithTag(root, 'w:body').length > 0;
}

const ENTRY_PARTS: readonly { readonly partPath: string; readonly objectKind: EmbeddedOoxmlKind; readonly readerPrecondition?: (root: XmlElement) => boolean }[] = [
  { partPath: 'word/document.xml', objectKind: 'wordprocessing', readerPrecondition: hasDocxBody },
  { partPath: 'ppt/presentation.xml', objectKind: 'presentation' },
  { partPath: 'xl/workbook.xml', objectKind: 'spreadsheet' },
];

// A real OOXML package has exactly one main document part, so at most one entry part is ever present; a fixed probe order keeps detection deterministic even for a hand-built package that somehow carries two. A row only matches when its reader's own precondition holds too, so flavour detection genuinely guarantees the chosen reader's precondition already holds and the dispatch below cannot throw for precondition reasons.
function detectFlavour(nested: Package): EmbeddedOoxmlKind | undefined {
  return ENTRY_PARTS.find((candidate) => {
    const root = rootElement(nested.parts[candidate.partPath]);
    return root !== undefined && (candidate.readerPrecondition === undefined || candidate.readerPrecondition(root));
  })?.objectKind;
}

// Decodes an embedded-object payload part's bytes into the ContentEmbeddedObject payload (objectKind + the whole nested ContentDocument). Returns undefined when the bytes are not a ZIP at all -- the classic OLE compound-file payload, whose recovery is out of scope and whose caller keeps whatever behaviour it had before -- or when the bytes are a ZIP that does not decode into one of the three OOXML flavours: a plain archive no reader recognises, structurally corrupt zip data, or a nested document a reader refuses (a docx without a w:body). An embedded payload is second-order content -- the caller chose to open the host document, not whatever bytes sit in its embeddings part -- so under the family's tiered read policy every one of those is a degrade-tier non-event (odf.js's embedded precedent resolves unknown kinds to undefined rather than throwing), and this function is total: one bad embedded object can never fail the whole host read.
export function readEmbeddedOoxmlPayload(bytes: Uint8Array<ArrayBuffer>): EmbeddedOoxmlPayload | undefined {
  if (!isZipArchive(bytes)) {
    return undefined;
  }
  try {
    const nested = parsePackage(bytes);
    const objectKind = detectFlavour(nested);
    return objectKind === undefined ? undefined : { objectKind, document: readNestedDocument(objectKind, nested) };
  } catch {
    // The one catch in this package's runtime source, existing because a ZIP's structural soundness cannot be probed without inflating it: the magic-byte gate above sees four bytes, and corruption anywhere past them only surfaces as a throw from inside the unzip. It marks the same boundary a caught inflate failure already marks elsewhere in the family (byte-codec's inflateTolerant catches over untrusted PDF/PNG streams) and converts a property of the embedded payload into the degrade-tier undefined above -- nothing about the host document is silenced, because the host read continues outside this function whatever happens in here.
    return undefined;
  }
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
