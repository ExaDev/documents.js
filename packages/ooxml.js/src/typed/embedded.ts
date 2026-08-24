import {
  isCompoundFile,
  isZipArchive,
  readCompoundFile,
  readOlePackage,
  walkArchive,
  type ArchiveWalkEntry,
} from "archive-codec";
import type { ContentDocument } from "document-schema.js";
import type { XmlElement } from "../model/node";
import type { BinaryPart, Package } from "../model/package";
import { packageFromEntries } from "../package-io/read";
import type { ContentEmbeddedObjectKind } from "document-schema.js";
import { base64ToBytes } from "../util/base64";
import { readDocxContent } from "./docx/read";
import { readPptxContent } from "./pptx/read";
import { readXlsxContent } from "./xlsx/content";
import { childrenWithTag, rootElement } from "./util";

// The shared embedded-object decode: an OOXML package's OLE embeddings (pptx's p:oleObj/@r:id target part, docx's o:OLEObject/@r:id target part) hold either a whole nested OOXML package zipped into the part's bytes (every modern producer's spelling), or a classic OLE compound-file blob (.bin) whose root storage carries the real file as an OLE-packaged 'Package' stream. This module recovers both: payload magic checked up front (archive-codec's isZipArchive and isCompoundFile -- byte checks, never a parse-and-catch), a .bin unwrapped through archive-codec's CFB reader and OLE-package parser to the ZIP a modern embed packages, the ZIP bytes walked through archive-codec's guarded recursive walk (the bounded inflate -- see readEmbeddedOoxmlPayload's own comment) with the walk's root entries assembled into a nested Package, the flavour detected from the nested package's own entry part, and the matching typed reader run to produce the nested ContentDocument that ContentEmbeddedObject.document carries.
//
// Flavour detection is by entry-part path, not [Content_Types].xml overrides, for two reasons: the three entry paths are exactly what the readers themselves dispatch on (readDocxContent throws without word/document.xml, readSlidePathsInOrder reads ppt/presentation.xml, resolveSheetEntries reads xl/workbook.xml), so detection by the same paths -- plus the one further precondition a reader of the three has, readDocxContent's w:body (hasDocxBody below) -- guarantees the chosen reader's precondition already holds; and the macro-enabled variants (docm/pptm/xlsm) share these exact paths -- the macro payload is an extra vbaProject.bin part, not a different entry -- so they map onto the same three content kinds with no separate case.
//
// This module imports all three format readers while pptx/read.ts and docx/read.ts both import this module back -- module cycles that are safe under one discipline: every cross-use is call-time only, both sides export hoisted function declarations, and nothing at module-evaluation time may read a cycle partner's bindings (a top-level const whose initialiser touched a partner would TDZ, because ESM initialises a cycle's modules in an order the import graph does not pin). odf.js's equivalent (typed/draw/embedded.ts) first broke its analogous cycle by moving dispatch into each calling format reader -- a split that only stood while odf's embedding edges all pointed one way -- and later inverted itself into this same central-dispatch shape once odt's own frame reading made odf's embedding symmetric too (a Writer document embeds a Calc sheet exactly as a Calc sheet embeds a Writer document), because symmetric embedding leaves no acyclic per-reader arrangement: per-reader dispatch would trade each reader's single edge to the dispatch module for direct docx-to-pptx reader edges that re-create the cycle. Injecting the dispatch through a read context instead would change the public readDocxContent/readPptxContent signatures, which construct their own contexts and stand alone.

// The ContentEmbeddedObjectKind members an OOXML embedding can produce -- 'formula' and 'drawing' have no OOXML producer here (they are ODF/MathML spellings), so they are not in this union.
export type EmbeddedOoxmlKind = Extract<
  ContentEmbeddedObjectKind,
  "wordprocessing" | "presentation" | "spreadsheet"
>;

export interface EmbeddedOoxmlPayload {
  readonly objectKind: EmbeddedOoxmlKind;
  readonly document: ContentDocument;
}

// readDocxContent is the only one of the three readers with a precondition beyond its entry part existing: it throws when word/document.xml carries no w:body to walk. Detection verifies that precondition up front, so a malformed nested docx degrades to no flavour at detection time rather than reaching a dispatch that would throw. The presentation and spreadsheet readers have no throw preconditions of their own.
function hasDocxBody(root: XmlElement): boolean {
  return childrenWithTag(root, "w:body").length > 0;
}

const ENTRY_PARTS: readonly {
  readonly partPath: string;
  readonly objectKind: EmbeddedOoxmlKind;
  readonly readerPrecondition?: (root: XmlElement) => boolean;
}[] = [
  {
    partPath: "word/document.xml",
    objectKind: "wordprocessing",
    readerPrecondition: hasDocxBody,
  },
  { partPath: "ppt/presentation.xml", objectKind: "presentation" },
  { partPath: "xl/workbook.xml", objectKind: "spreadsheet" },
];

// A real OOXML package has exactly one main document part, so at most one entry part is ever present; a fixed probe order keeps detection deterministic even for a hand-built package that somehow carries two. A row only matches when its reader's own precondition holds too, so flavour detection genuinely guarantees the chosen reader's precondition already holds and the dispatch below cannot throw for precondition reasons.
function detectFlavour(nested: Package): EmbeddedOoxmlKind | undefined {
  return ENTRY_PARTS.find((candidate) => {
    const root = rootElement(nested.parts[candidate.partPath]);
    return (
      root !== undefined &&
      (candidate.readerPrecondition === undefined ||
        candidate.readerPrecondition(root))
    );
  })?.objectKind;
}

// The root-level entries of a walk -- exactly the entry set unzipping the payload's own archive would produce, with everything the walk found nested INSIDE those entries (ZIP-in-ZIP parts) excluded: the nested package's readers see the payload as one flat archive, the same view parsePackage ever gave them. Root-entry duplicates collapse last-wins, matching unzipSync's own Record semantics.
function rootEntriesOf(
  walk: readonly ArchiveWalkEntry[],
): Record<string, Uint8Array<ArrayBuffer>> {
  const entries: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const entry of walk) {
    if (entry.ancestors.length === 0) {
      entries[entry.path] = entry.bytes;
    }
  }
  return entries;
}

// Decodes an embedded-object payload part's bytes into the ContentEmbeddedObject payload (objectKind + the whole nested ContentDocument). The payload takes one of three shapes: bytes that are a ZIP directly (a modern producer's embedded xlsx/docx/pptx), bytes that are a classic OLE compound file (the .bin spelling) whose root storage carries the real file as an OLE-packaged 'Package' stream -- unwrapped through archive-codec's CFB reader and OLE-package parser, then decoded as the ZIP a modern embed packages -- or bytes that are neither, which keep whatever behaviour the caller had before. Returns undefined whenever there is no nested document to recover: a non-ZIP non-CFB payload, a compound file with no Package stream (native legacy streams such as BIFF stay opaque by scope), a Package stream whose file is not a ZIP, a ZIP that does not decode into one of the three OOXML flavours, structurally corrupt zip data, a payload outside archive-codec's walk guards, or a nested document a reader refuses (a docx without a w:body). An embedded payload is second-order content -- the caller chose to open the host document, not whatever bytes sit in its embeddings part -- so under the family's tiered read policy every one of those is a degrade-tier non-event (odf.js's embedded precedent resolves unknown kinds to undefined rather than throwing), and this function is total: one bad embedded object can never fail the whole host read.
export function readEmbeddedOoxmlPayload(
  bytes: Uint8Array<ArrayBuffer>,
): EmbeddedOoxmlPayload | undefined {
  if (!isZipArchive(bytes) && !isCompoundFile(bytes)) {
    return undefined;
  }
  try {
    // The nested inflate runs behind archive-codec's recursive-walk guards rather than through this package's own unbounded unzip: fflate's unzipSync carries no size cap, an embeddings part is untrusted second-order bytes in which a small host entry can declare an unbounded decompressed body, and a bomb's leverage is exactly what the walk's one shared cumulative decompressed-bytes budget (MAX_WALK_TOTAL_BYTES) and depth cap bound -- the outer package parse keeps its own direct unzip because that is the file the caller chose to open. A walk that hits a guard throws (the guards truncate nothing), which the catch below degrades like any other undecodable payload; building the nested Package from the walk's own root entries (packageFromEntries) means the bytes are inflated exactly once, not once for the walk and again for the parse.
    const zipBytes = zipBytesOfPayload(bytes);
    if (zipBytes === undefined) {
      return undefined;
    }
    const nested = packageFromEntries(rootEntriesOf(walkArchive(zipBytes)));
    const objectKind = detectFlavour(nested);
    return objectKind === undefined
      ? undefined
      : { objectKind, document: readNestedDocument(objectKind, nested) };
  } catch {
    // The one catch in this package's runtime source, existing because a payload's structural soundness cannot be probed without parsing it: the magic-byte gates above see a handful of bytes, and corruption anywhere past them only surfaces as a throw from inside the parse -- the walk's own unzip, a walk guard refusing an out-of-contract payload, archive-codec's CompoundFileFormatError on a malformed compound file, or its OlePackageFormatError on a malformed Package stream. It marks the same boundary a caught inflate failure already marks elsewhere in the family (byte-codec's inflateTolerant catches over untrusted PDF/PNG streams) and converts a property of the embedded payload into the degrade-tier undefined above -- nothing about the host document is silenced, because the host read continues outside this function whatever happens in here.
    return undefined;
  }
}

// The ZIP bytes to decode for a payload part: the part's own bytes when it is a ZIP directly, and otherwise -- for the classic OLE compound-file .bin spelling -- the file carried in its root storage's 'Package' stream. Returns undefined for every legitimate no-recovery shape (no Package stream, or a packaged file that is not a ZIP); a malformed compound file or Package stream throws, which readEmbeddedOoxmlPayload's catch degrades exactly like corrupt ZIP data.
function zipBytesOfPayload(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> | undefined {
  if (isZipArchive(bytes)) {
    return bytes;
  }
  const packageStream = readCompoundFile(bytes).find(
    (stream) => stream.path === "Package",
  );
  if (packageStream === undefined) {
    return undefined;
  }
  const fileBytes = readOlePackage(packageStream.bytes).fileBytes;
  return isZipArchive(fileBytes) ? fileBytes : undefined;
}

// One embeddings part decodes once per package read, however many OLE frames point at it (copy-pasted objects are the common case): the decoded payload is memoised on the Part object itself, so the cache lives exactly as long as the decoded package does and frames sharing a part carry the same nested document object -- reader output is immutable throughout this family, and structural sharing is exactly what "the same embedded object twice" means. Only successful decodes are cached; a payload that decodes to nothing costs its magic-byte checks per frame, plus -- for the compound-file spelling -- one guarded CFB parse per frame, still bounded work by construction.
const payloadByPart = new WeakMap<BinaryPart, EmbeddedOoxmlPayload>();

// The reader-facing entry: an embeddings part (already narrowed to its binary arm by the caller's kind check) decoded through readEmbeddedOoxmlPayload, memoised per part so the shared-part case decodes once.
export function readEmbeddedPayloadPart(
  part: BinaryPart,
): EmbeddedOoxmlPayload | undefined {
  const cached = payloadByPart.get(part);
  if (cached !== undefined) {
    return cached;
  }
  const payload = readEmbeddedOoxmlPayload(base64ToBytes(part.base64));
  if (payload !== undefined) {
    payloadByPart.set(part, payload);
  }
  return payload;
}

// The wordprocessing and presentation arms rebuild the ContentDocument envelope the same way readDocx/readPptx (typed/document-tree.ts) do: readDocxContent/readPptxContent return their own per-format shapes whose extras (comments, footnotes, header/footer parts, numbering on DocxDocument) have no ContentDocument spelling and so do not ride the embedded document. The spreadsheet arm needs no wrap -- readXlsxContent already returns a full ContentDocument.
function readNestedDocument(
  objectKind: EmbeddedOoxmlKind,
  nested: Package,
): ContentDocument {
  switch (objectKind) {
    case "wordprocessing": {
      const { metadata, sections } = readDocxContent(nested);
      return { kind: "wordprocessing", metadata, sections };
    }
    case "presentation": {
      const { metadata, slides } = readPptxContent(nested);
      return { kind: "presentation", metadata, slides };
    }
    case "spreadsheet":
      return readXlsxContent(nested);
  }
}
