import type { XmlElement, XmlNode } from "ooxml.js";

// ooxml.js's own XmlNode has no parent pointers, and its read-only helpers (walk, elementsWithTag, childrenWithTag) return bare elements with no way back to the array they live in. The live-view editor (src/edit/*) needs that array to mutate in place (remove a node, insert a sibling), so every query in this module returns a cursor carrying both the node and its containing array.
export interface ElementCursor {
  // The array `node` lives in: a parent element's `children`, or a part's own root `nodes` array.
  readonly container: XmlNode[];
  readonly node: XmlElement;
}

// The first direct child element with the given tag, if any.
export function findChildElement(
  container: XmlNode[],
  tag: string,
): ElementCursor | undefined {
  for (const node of container) {
    if (node.type === "element" && node.tag === tag) {
      return { container, node };
    }
  }
  return undefined;
}

// All direct child elements with the given tag, in document order.
export function findChildElements(
  container: XmlNode[],
  tag: string,
): ElementCursor[] {
  const out: ElementCursor[] = [];
  for (const node of container) {
    if (node.type === "element" && node.tag === tag) {
      out.push({ container, node });
    }
  }
  return out;
}

// Depth-first walk yielding a cursor for every element descendant, parent-aware unlike ooxml.js's own `walk` (src/typed/util.ts), which yields bare nodes.
export function* walkElements(container: XmlNode[]): Generator<ElementCursor> {
  for (const node of container) {
    if (node.type === "element") {
      yield { container, node };
      yield* walkElements(node.children);
    }
  }
}

// The first descendant element with the given tag, depth-first, or undefined if none exists.
export function findDescendantElement(
  container: XmlNode[],
  tag: string,
): ElementCursor | undefined {
  for (const cursor of walkElements(container)) {
    if (cursor.node.tag === tag) {
      return cursor;
    }
  }
  return undefined;
}
