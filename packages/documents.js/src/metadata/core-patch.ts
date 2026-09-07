import type { LayoutMetadata } from "document-schema.js";
import type { Package } from "ooxml.js";
import { addCoreProperties } from "../opc/core-properties";
import type { Package as OdfPackage } from "odf.js";
import { hasCoreProperties, patchCoreProperties } from "ooxml.js";
import { hasOdfMetadata, patchOdfMetadata, writeOdfMetadata } from "odf.js";

// The pdf-codec-FREE half of this package's metadata-patching machinery, split out of ../metadata/write.ts specifically so a caller that only ever touches OOXML/ODF packages (documents.js's own live editors -- DocxEditor, PptxEditor, OdtEditor, OdpEditor, OdsEditor, OdgEditor -- and, through them, the src/convert/from-pdf.ts read entry) never pulls in pdf-codec's own write path and vendored font assets merely by importing a metadata patch primitive. src/read-graph.test.ts pins this boundary: the documents.js/read package export's own module graph must never reach pdf-codec's write.ts or its font assets, and metadata/write.ts (this file's own sibling) does reach both -- for setDocumentMetadata's own 'pdf' write path -- so anything the editors need had to live somewhere that doesn't.

export interface MetadataOverrides {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  // Mutable, matching LayoutMetadataSchema's own `keywords?: string[]` (document-schema.js) -- mergeMetadata's return must satisfy that shape exactly, and a `readonly string[]` here would not.
  readonly keywords?: string[];
}

// Object-spreads the current metadata with only the overrides the caller actually passed. A field genuinely absent from `overrides` (as opposed to present with an empty-string/empty-array value) leaves that field exactly as the source document already had it, rather than clearing it -- each override is its own conditional spread rather than a bare `title: overrides.title ?? current.title`, so a caller that never mentions a field cannot be told apart from one that explicitly wants it set to empty.
export function mergeMetadata(
  current: LayoutMetadata,
  overrides: MetadataOverrides,
): LayoutMetadata {
  return {
    ...current,
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
    ...(overrides.author !== undefined ? { author: overrides.author } : {}),
    ...(overrides.subject !== undefined ? { subject: overrides.subject } : {}),
    ...(overrides.keywords !== undefined
      ? { keywords: overrides.keywords }
      : {}),
  };
}

// Whether `overrides` would actually cause the addCoreProperties/writeOdfMetadata fallback below to write at least one element -- NOT merely whether a field is present in `overrides` at all. An empty keywords array is the gap this distinction closes: overrides.keywords !== undefined is true for `keywords: []`, but addCoreProperties/writeOdfMetadata themselves only ever emit a keywords element when the array's length is nonzero (mirroring how a from-scratch build never writes an empty keywords element), so treating "the key is present" as "something will be written" would create a real metadata part (plus, for OOXML, its Content_Types override and package-root relationship) out of an empty root element, on a document that had none -- contradicting patchOoxmlCorePropertiesOnPackage/patchOdfMetadataOnPackage's own contract that a document with no requested change stays byte-for-byte free of a part it never had. This predicate mirrors addCoreProperties'/buildOdfMetaNodes' own per-field write conditions exactly: title/author/subject count on mere presence, keywords counts only with at least one entry.
function hasWritableMetadataOverride(overrides: MetadataOverrides): boolean {
  return (
    overrides.title !== undefined ||
    overrides.author !== undefined ||
    overrides.subject !== undefined ||
    (overrides.keywords !== undefined && overrides.keywords.length > 0)
  );
}

// Patches an OOXML package's own docProps/core.xml title/author/subject/keywords directly on an ALREADY-DECODED Package, in place -- the pkg-level primitive shared by metadata/write.ts's own patchDocxMetadata (the bytes-in/bytes-out entry point, docx-only per setDocumentMetadata's own classifyWritePath), and by DocxEditor's and PptxEditor's own live `metadata` setters (src/edit/docx/editor.ts, src/edit/pptx/editor.ts, ExaDev/documents.js#933) -- docProps/core.xml uses the identical convention across every OOXML format (ooxml.js's own readCoreProperties top comment), so one pkg-level patch primitive covers all three without triplicating the hasCoreProperties/addCoreProperties fallback decision. An already-open live editor patches through the identical logic a fresh decode/patch/encode round trip does. See patchDocxMetadata's own comment (metadata/write.ts) for the full byte-fidelity rationale (comments, footnotes, header/footer parts, numbering all survive, since nothing but docProps/core.xml is ever touched) -- the same guarantee holds for pptx's own comments/notes/layout-inheritance data, none of which a docProps/core.xml patch ever touches either.
export function patchOoxmlCorePropertiesOnPackage(
  pkg: Package,
  overrides: MetadataOverrides,
): void {
  if (hasCoreProperties(pkg)) {
    patchCoreProperties(pkg, overrides);
  } else if (hasWritableMetadataOverride(overrides)) {
    addCoreProperties(pkg, mergeMetadata({}, overrides));
  }
}

// The ODF-side mirror of patchOoxmlCorePropertiesOnPackage above, shared by OdtEditor/OdpEditor/OdsEditor/OdgEditor's own live `metadata` setters (ExaDev/documents.js#933): patches meta.xml in place via odf.js's own patchOdfMetadata when the package already carries a real meta.xml part (preserving meta:generator, meta:creation-date, dc:date, and every other field/office:meta child a patch never touches), or builds one from scratch via writeOdfMetadata when it does not -- but, mirroring the OOXML path's own restraint, only when `overrides` actually names a field that would write something, so a document with no meta.xml and no requested change stays byte-for-byte free of a part it never had. `version` is the office:version ODF documents in this package are scaffolded at (each format's own scaffold.ts, e.g. "1.3") -- needed only for the from-scratch branch, since a patch never touches office:document-meta's own office:version attribute.
export function patchOdfMetadataOnPackage(
  pkg: OdfPackage,
  overrides: MetadataOverrides,
  version: string,
): void {
  if (hasOdfMetadata(pkg)) {
    patchOdfMetadata(pkg, overrides);
  } else if (hasWritableMetadataOverride(overrides)) {
    writeOdfMetadata(pkg, mergeMetadata({}, overrides), version);
  }
}
