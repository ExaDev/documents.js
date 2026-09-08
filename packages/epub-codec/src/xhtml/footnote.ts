import type { XmlElement } from "../xml/node";
import { attrValue } from "../xml/query";

// Footnote recognition for both EPUB 3's structured epub:type vocabulary and EPUB 2's older, unstructured "linked anchor" idiom (a plain <a href="#noteN"> pointing at a plain element carrying id="noteN", with nothing in the markup itself naming the relationship as a footnote). Both idioms map onto document-schema.js's harmonised `anchor` construct (anchorType: 'footnote') -- see src/xhtml/read.ts for how a recognised reference becomes a run-level point extent and a recognised body becomes a block-scoped constructStart/constructEnd pair.
//
// A footnote reference and its own body need not live in the same XHTML content document (ExaDev/documents.js#963): the reference is a run-level point extent in ITS OWN section's block list, and the body is a block-scoped constructStart/constructEnd pair in the TARGET document's own section -- two independently well-formed markers in two different block lists, sharing one name, never one marker pair straddling a block-list boundary (document-schema.js's own construct-marker contract forbids exactly that, and this was never that). src/read.ts's own whole-spine pass resolves a cross-document href to its target element before this module's own isFootnoteReference ever runs, so the functions below need only decide "does this anchor/target pair look like a footnote", never where either one lives.

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

// Whether an <a> element, already resolved to a specific target element (same-document or cross-document -- the caller's own job, src/xhtml/link-target.ts's resolveHrefTarget), looks like a footnote/endnote reference: EPUB 3's own epub:type="noteref" (the structured spelling every retrofitted EPUB 2-to-3 conversion adds), or, absent that, the EPUB 2 idiom's own class-name convention ("footnote"/"noteref", case-insensitive -- the real-world spelling this package's own hand-authored EPUB 2 fixture uses, matching common producer output). A target that carries neither signal is an ordinary internal link, not a guessed footnote.
export function isFootnoteReference(
  anchor: XmlElement,
  target: XmlElement,
): boolean {
  const isStructuredNoteref = epubTypeValues(anchor).some((v) =>
    /noteref/i.test(v),
  );
  if (isStructuredNoteref) {
    return true;
  }
  return hasFootnoteClass(anchor) || hasFootnoteClass(target);
}

// Whether an <aside> element is an EPUB 3 footnote/endnote body -- epub:type carrying "footnote" or "rearnote" (EPUB 3.3's own two note-role values, 5.1 vocabulary), read from the aside itself rather than inferred from anything pointing at it.
export function isFootnoteAside(element: XmlElement): boolean {
  if (element.tag !== "aside") {
    return false;
  }
  return epubTypeValues(element).some((v) => /footnote|rearnote/i.test(v));
}
