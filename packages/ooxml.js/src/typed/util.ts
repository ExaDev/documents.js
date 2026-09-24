import type { XmlElement, XmlNode } from "../model/node";
import type { Package, Part } from "../model/package";

// Depth-first walk over a node forest, yielding every node and descending into element children.
export function* walk(nodes: readonly XmlNode[]): Generator<XmlNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === "element") {
      yield* walk(node.children);
    }
  }
}

// Recursive descendant search by tag.
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

// Direct-child search by tag, for elements whose OOXML schema fixes the parent.
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

export function attr(element: XmlElement, name: string): string | undefined {
  for (const a of element.attributes) {
    if (a.name === name) {
      return a.value;
    }
  }
  return undefined;
}

// The root element of a part, skipping the leading <?xml ?> declaration node; undefined for a missing or binary part.
export function rootElement(part: Part | undefined): XmlElement | undefined {
  if (part?.kind !== "xml") {
    return undefined;
  }
  for (const node of part.nodes) {
    if (node.type === "element") {
      return node;
    }
  }
  return undefined;
}

// The lossless layer keeps XML entities raw (e.g. &amp;) for fidelity; this typed reading view decodes the five standard entities so projected text is human-readable.
export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
    switch (entity) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default:
        return entity;
    }
  });
}

// Flattened, entity-decoded character content of an element: every descendant text and cdata value concatenated in document order.
export function textContent(element: XmlElement): string {
  let text = "";
  for (const node of walk(element.children)) {
    if (node.type === "text" || node.type === "cdata") {
      text += node.value;
    }
  }
  return decodeEntities(text);
}

export interface Relationship {
  type: string;
  target: string;
  targetMode?: string;
}

// The package root's own relationships part, the one .rels path in an OPC package that is fixed rather than derived from a part path.
export const ROOT_RELS_PART_PATH = "_rels/.rels";

// The .rels part for a given part path: word/document.xml -> word/_rels/document.xml.rels. Exported purely for direct unit coverage — resolveRelationships is its only real caller.
export function relsPathFor(partPath: string): string {
  const lastSlash = partPath.lastIndexOf("/");
  // slice(-1 + 1) is slice(0), which returns the whole string unchanged — exactly what a part sitting directly at the package root needs.
  const fileName = partPath.slice(lastSlash + 1);
  if (lastSlash === -1) {
    // A root-level part ("document2.xml", which OPC permits and the officeDocument relationship can legitimately name) keeps its relationships at "_rels/document2.xml.rels" with no leading slash: Package.parts is keyed by ZIP entry name, and no OPC package spells an entry with one. Prefixing an empty directory would produce "/_rels/document2.xml.rels", a key nothing in the package ever matches.
    return `_rels/${fileName}.rels`;
  }
  return `${partPath.slice(0, lastSlash)}/_rels/${fileName}.rels`;
}

// A part path's own directory: everything up to its last slash, or no directory at all for a root-level part path with none.
function dirnameOf(partPath: string): string {
  const lastSlash = partPath.lastIndexOf("/");
  return lastSlash === -1 ? "" : partPath.slice(0, lastSlash);
}

// Resolve a relationship Target (relative to the subject part's directory, or package-rooted with a leading slash) to a package-relative part path. `partPath` is undefined for the package root, which has no directory of its own to resolve against — the same empty directory a root-level part's own path (no slash) already resolves to via dirnameOf. Exported purely for direct unit coverage — resolveRelationships is its only real caller.
export function resolveRelTarget(
  partPath: string | undefined,
  target: string,
): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  const baseDir = partPath === undefined ? "" : dirnameOf(partPath);
  const resolved: string[] = [];
  for (const segment of `${baseDir}/${target}`.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

// Resolve a part's relationships to a Map of r:id -> { type, target, targetMode? }. Internal targets become package-relative part paths; an external target (TargetMode="External", e.g. a hyperlink URL) keeps whatever the producer wrote, minus its XML encoding.
//
// The Target attribute is entity-decoded before anything else happens to it, since this is the typed (lossy) projection and the lossless layer stores every attribute value exactly as it appeared in the source (parseXml runs with processEntities:false). Without that, an internal target containing '&' never matches its own part key — package keys are the ZIP entry names, which carry no XML encoding — and an external one hands a caller a URL still spelled '&amp;', which then re-encodes to '&amp;amp;' the moment anything writes it back out.
export function resolveRelationships(
  pkg: Package,
  partPath: string,
): Map<string, Relationship> {
  return relationshipsFrom(pkg, relsPathFor(partPath), partPath);
}

// The package root's own relationships, read from the fixed "_rels/.rels". The root is not itself a part, so its .rels path is stated rather than derived, and it has no directory of its own for its targets to resolve against — modelled as an absent base path, not an empty one, so a root Relationship spelling "/word/document.xml", "word/document.xml" or even "./word/document.xml" all land on the same part key via resolveRelTarget's own undefined-partPath branch.
export function resolveRootRelationships(
  pkg: Package,
): Map<string, Relationship> {
  return relationshipsFrom(pkg, ROOT_RELS_PART_PATH, undefined);
}

// Shared body of the two resolvers above: `relsPartPath` says which .rels part to read, `basePartPath` says what its Targets resolve against — undefined for the package root, which has none.
function relationshipsFrom(
  pkg: Package,
  relsPartPath: string,
  basePartPath: string | undefined,
): Map<string, Relationship> {
  const map = new Map<string, Relationship>();
  const rels = rootElement(pkg.parts[relsPartPath]);
  if (rels === undefined) {
    return map;
  }
  for (const rel of childrenWithTag(rels, "Relationship")) {
    const id = attr(rel, "Id");
    const type = attr(rel, "Type");
    const rawTarget = attr(rel, "Target");
    if (id === undefined || type === undefined || rawTarget === undefined) {
      continue;
    }
    const target = decodeEntities(rawTarget);
    const targetMode = attr(rel, "TargetMode");
    map.set(id, {
      type: decodeEntities(type),
      target:
        targetMode === "External"
          ? target
          : resolveRelTarget(basePartPath, target),
      targetMode,
    });
  }
  return map;
}
