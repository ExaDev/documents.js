import type { XmlElement, XmlNode } from '../model/node';

// Small, read-only XML tree query helpers shared across odf.js's typed readers (src/typed/shared/* and anything built on it). The lossless model (model/node.ts) deliberately has no parent pointers and no query API of its own -- see xml/fragment.ts's own note on why fragments are built as plain object literals -- so every reader that needs "the office:meta child of this root" or "every meta:keyword under this element" needs the same handful of tiny tree-walking functions. Centralized here so odf.js's own typed layer has one place to reach for them rather than growing a new private copy per reader.

// The first top-level element node in a part's node forest, skipping the leading <?xml ?> declaration -- i.e. a part's own root element, regardless of what it's actually called (office:document-content, office:document-styles, office:document-meta, ...). Mirrors ooxml.js's own rootElement helper (src/typed/util.ts), which establishes the same tag-agnostic convention for the equivalent OOXML concept.
export function rootElement(nodes: readonly XmlNode[]): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type === 'element') {
      return node;
    }
  }
  return undefined;
}

// The first direct child element with the given tag, or undefined if none.
export function findChildElement(nodes: readonly XmlNode[], tag: string): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type === 'element' && node.tag === tag) {
      return node;
    }
  }
  return undefined;
}

// Every direct child element with the given tag, in document order.
export function childrenWithTag(element: XmlElement, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === 'element' && child.tag === tag) {
      out.push(child);
    }
  }
  return out;
}

// Depth-first pre-order walk over a node forest, descending into every element's own children -- the shared traversal every descendant-search helper below builds on.
function* walk(nodes: readonly XmlNode[]): Generator<XmlNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === 'element') {
      yield* walk(node.children);
    }
  }
}

// Every element anywhere in the given forest (not just direct children) with the given tag, in document order -- for a schema position that isn't fixed relative to its container (e.g. a text:p that may sit directly under a draw:text-box or be nested inside a text:list-item), where childrenWithTag's direct-children-only search isn't enough. Mirrors ooxml.js's own elementsWithTag (src/typed/util.ts), which establishes the same descendant-search convention for the equivalent OOXML concept.
export function elementsWithTag(nodes: readonly XmlNode[], tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const node of walk(nodes)) {
    if (node.type === 'element' && node.tag === tag) {
      out.push(node);
    }
  }
  return out;
}

export function attrValue(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}
