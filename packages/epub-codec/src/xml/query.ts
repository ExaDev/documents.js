import { decodeTextLikeNode } from "./entities";
import { isTextLikeNode, type XmlElement, type XmlNode } from "./node";

// Small, read-only XML tree query helpers shared across every reader built on the model above -- mirroring odf.js's and ooxml.js's own identical query helpers (odf.js's src/xml/query.ts, ooxml.js's src/typed/util.ts). The lossless model deliberately has no parent pointers and no query API of its own, so every caller that needs "the first dc:title child of this metadata element" or "every li anywhere under this ol" needs the same handful of tiny tree-walking functions. Centralized here so src/opf, src/nav, and src/xhtml share one place to reach for them.

// The first top-level element node in a document's own node forest, skipping the leading <?xml ?> declaration -- i.e. a part's own root element, regardless of what it's actually called (package, html, ncx). Mirrors ooxml.js's/odf.js's own rootElement helper.
export function rootElement(nodes: readonly XmlNode[]): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type === "element") {
      return node;
    }
  }
  return undefined;
}

// The first direct child element with the given tag, or undefined if none.
export function findChildElement(
  nodes: readonly XmlNode[],
  tag: string,
): XmlElement | undefined {
  for (const node of nodes) {
    if (node.type === "element" && node.tag === tag) {
      return node;
    }
  }
  return undefined;
}

// Every direct child element with the given tag, in document order.
export function childrenWithTag(
  element: XmlElement,
  tag: string,
): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === "element" && child.tag === tag) {
      out.push(child);
    }
  }
  return out;
}

// Depth-first pre-order walk over a node forest, descending into every element's own children -- the shared traversal every descendant-search helper below builds on.
function* walk(nodes: readonly XmlNode[]): Generator<XmlNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === "element") {
      yield* walk(node.children);
    }
  }
}

// Every element anywhere in the given forest (not just direct children) with the given tag, in document order -- for a schema position that isn't fixed relative to its container (an XHTML `dl` may sit directly under `body` or nested inside a `section`/`div`).
export function elementsWithTag(
  nodes: readonly XmlNode[],
  tag: string,
): XmlElement[] {
  const out: XmlElement[] = [];
  for (const node of walk(nodes)) {
    if (node.type === "element" && node.tag === tag) {
      out.push(node);
    }
  }
  return out;
}

// The first element anywhere in the given forest matching an arbitrary predicate -- used where a match is keyed on an attribute value (e.g. "the element whose id equals this fragment") rather than a fixed tag name.
export function findElement(
  nodes: readonly XmlNode[],
  predicate: (element: XmlElement) => boolean,
): XmlElement | undefined {
  for (const node of walk(nodes)) {
    if (node.type === "element" && predicate(node)) {
      return node;
    }
  }
  return undefined;
}

export function attrValue(
  element: XmlElement,
  name: string,
): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

// Concatenated, RAW (not entity-decoded) text content of every text-node descendant, in document order -- inline markup stripped, matching the "cached rendered text" reading every construct-mapping table in this family produces for a scalar field (a heading's plain-text outline label, a nav entry's link text). Deliberately narrower than decodedTextContent below (a CDATA descendant is not visited at all, so it contributes nothing rather than its raw, never-entity-encoded value): this is this package's own long-standing published export, and a caller's own idiom for using it -- decodeEntities(textContent(x)) -- is exactly what stays correct only because this walk never mixes in undecoded-by-design CDATA content for that wrap to misapply entity resolution to. Changing this function's own decode timing or its node coverage would silently break that external idiom, which is why the two concerns this docstring's own prior revision bundled together (CDATA support, decode-internally) landed instead as a distinctly named sibling function rather than a change to this one -- see ExaDev/documents.js#994's own round-9 finding.
export function textContent(nodes: readonly XmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.value;
    } else if (node.type === "element") {
      out += textContent(node.children);
    }
  }
  return out;
}

// The CDATA-aware twin of textContent above: concatenated, already-decoded text content of every text-like descendant (an ordinary text node or a CDATA section, xml/node.ts's own isTextLikeNode -- a producer reaches for the latter only when its own literal text would otherwise need escaping, and textContent's own text-node-only walk would silently lose exactly that content). Decoding happens once, here, via decodeTextLikeNode -- a caller must never run this function's own result back through decodeEntities, since a CDATA descendant's content was never entity-encoded in the first place and a second decode would corrupt it (this is also exactly why textContent above does not grow CDATA support directly: mixing raw CDATA into a result callers already decode themselves would corrupt it the moment a real CDATA-bearing document reached that path). A distinct function, not a textContent behavior change, because textContent is a published export whose existing raw-text, decode-afterwards contract external callers may already depend on; landing this CDATA/decode-internally behavior under textContent's own name would have silently double-decoded every such caller's own text nodes the moment they upgraded (a literal "&amp;amp;" round-tripping to "&" instead of the correct "&amp;").
export function decodedTextContent(nodes: readonly XmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (isTextLikeNode(node)) {
      out += decodeTextLikeNode(node);
    } else if (node.type === "element") {
      out += decodedTextContent(node.children);
    }
  }
  return out;
}
