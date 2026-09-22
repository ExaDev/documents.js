import { elementsWithTag, findElement } from "../xml/query";
import { attrValue, findChildElement, rootElement } from "../xml/query";
import { parseXml } from "../xml/parse";
import type { XmlElement } from "../xml/node";

// EPUB 3.3 section 5.3.2's navigation document: a plain XHTML document whose <nav epub:type="toc"> element carries the table of contents as a nested <ol>/<li>/<a href> outline. This module reads only what src/read.ts needs to reconcile the nav against the spine's own reading order (see src/nav/reconcile.ts) — a real hierarchical outline model is document-outline.js's own projection off a DocumentTree, not something this package's reader stores anywhere in ContentDocument or DocumentTree itself.

// Every href inside the toc nav's own <a> elements, in document order, with any "#fragment" suffix stripped (the reconciliation compares against the spine's own manifest-href sequence, which carries no fragment). Returns undefined when the document has no <nav epub:type="toc"> at all — EPUB 3.3 requires exactly one, but a malformed or landmarks-only nav document is this package's own NAV_DOCUMENT_MISSING diagnostic to report, not a thrown error (the spine already has everything needed to read the book's content).
export function readNav3TocHrefs(navXhtml: string): string[] | undefined {
  const nodes = parseXml(navXhtml);
  const html = rootElement(nodes);
  const body =
    html === undefined ? undefined : findChildElement(html.children, "body");
  if (body === undefined) {
    return undefined;
  }
  const tocNav = findElement(
    body.children,
    (element) => element.tag === "nav" && hasTocEpubType(element),
  );
  if (tocNav === undefined) {
    return undefined;
  }
  return elementsWithTag(tocNav.children, "a")
    .map((a) => attrValue(a, "href"))
    .filter((href): href is string => href !== undefined)
    .map(stripFragment);
}

// Whether the element's epub:type attribute names "toc" as one of its space-separated tokens, matched with explicit start/end-of-token boundaries rather than a split-then-filter tokenizer: a split on a whitespace RUN (`\s+`) produces the identical set of non-empty tokens as a split on a single whitespace character (`\s`) would, so splitting first can never distinguish a real "toc" token from a same-value regex that only matches whitespace one character at a time — the token identity is unaffected either way. Matching boundaries directly makes each `\s` load-bearing on its own.
function hasTocEpubType(element: XmlElement): boolean {
  const epubType = attrValue(element, "epub:type");
  return epubType !== undefined && /(?:^|\s)toc(?:\s|$)/u.test(epubType);
}

function stripFragment(href: string): string {
  const index = href.indexOf("#");
  return index === -1 ? href : href.slice(0, index);
}
