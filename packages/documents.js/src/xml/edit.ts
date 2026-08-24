import type { XmlElement, XmlNode } from "ooxml.js";

// Sets an attribute's value, updating it in place if already present, or appending it if not.
export function setAttr(
  element: XmlElement,
  name: string,
  value: string,
): void {
  for (const a of element.attributes) {
    if (a.name === name) {
      a.value = value;
      return;
    }
  }
  element.attributes.push({ name, value });
}

export function removeAttr(element: XmlElement, name: string): void {
  const index = element.attributes.findIndex((a) => a.name === name);
  if (index !== -1) {
    element.attributes.splice(index, 1);
  }
}

// Removes `child` from `container` in place. Returns whether it was found and removed.
export function removeChild(container: XmlNode[], child: XmlNode): boolean {
  const index = container.indexOf(child);
  if (index === -1) {
    return false;
  }
  container.splice(index, 1);
  return true;
}

export function insertBefore(
  container: XmlNode[],
  reference: XmlNode,
  newNode: XmlNode,
): void {
  const index = container.indexOf(reference);
  container.splice(index === -1 ? container.length : index, 0, newNode);
}

export function insertAfter(
  container: XmlNode[],
  reference: XmlNode,
  newNode: XmlNode,
): void {
  const index = container.indexOf(reference);
  container.splice(index === -1 ? container.length : index + 1, 0, newNode);
}

// Inserts `child` into `parent.children` at the position ECMA-376's element sequence for `parent`'s content model dictates, given as `order` (an array of tag names in schema-defined order). Word rejects a file whose ordered content model (e.g. CT_RPr: w:rFonts before w:b before w:i before w:color before w:sz) is violated, so property setters must never simply append.
//
// A tag not present in `order` is treated as unordered and left where document order otherwise placed it: the search only ever compares against siblings whose own tag *is* in `order`.
export function insertInSchemaOrder(
  parent: XmlElement,
  child: XmlElement,
  order: readonly string[],
): void {
  const childRank = order.indexOf(child.tag);
  if (childRank === -1) {
    parent.children.push(child);
    return;
  }
  for (const sibling of parent.children) {
    if (sibling.type !== "element") {
      continue;
    }
    const siblingRank = order.indexOf(sibling.tag);
    if (siblingRank !== -1 && siblingRank > childRank) {
      insertBefore(parent.children, sibling, child);
      return;
    }
  }
  parent.children.push(child);
}

// The first direct child element with the given tag, or undefined if none exists -- a convenience for property accessors that need to find-or-create a single child (e.g. w:rPr on a w:r).
export function directChildElement(
  parent: XmlElement,
  tag: string,
): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

// Finds the first direct child element with the given tag, creating and schema-order-inserting one (via `build`) if none exists.
export function getOrCreateChildElement(
  parent: XmlElement,
  tag: string,
  order: readonly string[],
  build: () => XmlElement,
): XmlElement {
  const existing = directChildElement(parent, tag);
  if (existing !== undefined) {
    return existing;
  }
  const created = build();
  insertInSchemaOrder(parent, created, order);
  return created;
}
