import type { XmlElement } from "../xml/node";
import { attrValue } from "../xml/query";

// Footnote recognition for both EPUB 3's structured epub:type vocabulary and EPUB 2's older, unstructured "linked anchor" idiom (a plain <a href="#noteN"> pointing at a plain element carrying id="noteN", with nothing in the markup itself naming the relationship as a footnote). Both idioms map onto document-schema.js's harmonised `anchor` construct (anchorType: 'footnote') -- see src/xhtml/read.ts for how a recognised reference becomes a run-level point extent and a recognised body becomes a block-scoped constructStart/constructEnd pair.
//
// SCOPE: this module only ever recognises a SAME-DOCUMENT footnote (the reference and its body both inside the one XHTML content document this package maps to one ContentSection). A cross-document footnote/endnote -- reference in one spine item, body in a separate "notes.xhtml" the EPUB 2 idiom commonly used -- has no encoding here: document-schema.js's own construct-marker contract states plainly that a block list's bracket pair can never straddle a block list boundary, and each ContentSection is its own block list. A cross-document reference falls through to this package's ordinary internal-hyperlink handling instead (the href round-trips through ContentRun.hyperlink, exactly as any other internal link does) -- a documented, honest degrade rather than an attempt to bracket something the schema cannot express.

const FOOTNOTE_CLASS_PATTERN = /footnote|noteref/i;

function epubTypeValues(element: XmlElement): readonly string[] {
  const value = attrValue(element, "epub:type");
  return value === undefined
    ? []
    : value.split(/\s+/u).filter((v) => v.length > 0);
}

function hasFootnoteClass(element: XmlElement): boolean {
  const className = attrValue(element, "class");
  return className !== undefined && FOOTNOTE_CLASS_PATTERN.test(className);
}

// Extracts the fragment name from a same-document href ("#note1" -> "note1"). Returns undefined for anything else (an empty href, an external URL, a cross-document reference "chapter2.xhtml#note1") -- the caller's own generic internal/external hyperlink handling covers those instead.
export function sameDocumentFragment(
  href: string | undefined,
): string | undefined {
  if (href === undefined || !href.startsWith("#") || href.length < 2) {
    return undefined;
  }
  return href.slice(1);
}

// Whether an <a> element is a footnote/endnote reference: EPUB 3's own epub:type="noteref" (the structured spelling every retrofitted EPUB 2-to-3 conversion adds), or, absent that, the EPUB 2 idiom's own class-name convention ("footnote"/"noteref", case-insensitive -- the real-world spelling this package's own hand-authored EPUB 2 fixture uses, matching common producer output). A same-document target is required either way: a noteref pointing at nothing this document defines, or at a target with no recognisable footnote shape, degrades to an ordinary internal hyperlink rather than a guessed construct.
export function isFootnoteReferenceAnchor(
  anchor: XmlElement,
  idElements: ReadonlyMap<string, XmlElement>,
): string | undefined {
  const fragment = sameDocumentFragment(attrValue(anchor, "href"));
  if (fragment === undefined) {
    return undefined;
  }
  const target = idElements.get(fragment);
  if (target === undefined) {
    return undefined;
  }
  const isStructuredNoteref = epubTypeValues(anchor).some((v) =>
    /noteref/i.test(v),
  );
  if (isStructuredNoteref) {
    return fragment;
  }
  if (hasFootnoteClass(anchor) || hasFootnoteClass(target)) {
    return fragment;
  }
  return undefined;
}

// Whether an <aside> element is an EPUB 3 footnote/endnote body -- epub:type carrying "footnote" or "rearnote" (EPUB 3.3's own two note-role values, 5.1 vocabulary), read from the aside itself rather than inferred from anything pointing at it.
export function isFootnoteAside(element: XmlElement): boolean {
  if (element.tag !== "aside") {
    return false;
  }
  return epubTypeValues(element).some((v) => /footnote|rearnote/i.test(v));
}
