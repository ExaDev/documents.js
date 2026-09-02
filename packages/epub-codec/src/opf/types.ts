import type { LayoutMetadata } from "document-schema.js";

// One <manifest><item> entry: an id (referenced by the spine's own idref, and by an XHTML document's relative-path resolution), the href it names (relative to the OPF's own directory), the declared media type, and the whitespace-separated properties an EPUB 3 manifest item may carry (only "nav", identifying the single navigation document, matters to this package -- "cover-image", "scripted", "mathml", and the rest are read-and-ignored, since they name capabilities this flowable-content reader has no use for).
export interface OpfManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

// One <spine><itemref> entry: which manifest item it names, in the linear reading order the spine states, and whether it is genuinely part of that linear order ("linear=no" marks supplementary content -- a footnote/endnote page in the EPUB 2 linked-anchor idiom, most commonly -- that a reading system does not present in the primary flow). This package still reads a non-linear item's own content (so a linked-anchor footnote target is resolvable), but does not give it its own top-level ContentSection in the primary read.
export interface OpfSpineItemRef {
  readonly idref: string;
  readonly linear: boolean;
}

export interface OpfPackage {
  readonly metadata: LayoutMetadata;
  readonly manifest: readonly OpfManifestItem[];
  readonly spine: readonly OpfSpineItemRef[];
  // The spine's own "toc" attribute (EPUB 2 only -- the manifest item id of the NCX document). EPUB 3's own nav document is found by manifest properties="nav" instead, which resolveNavItem reads directly off `manifest`.
  readonly ncxId: string | undefined;
}
