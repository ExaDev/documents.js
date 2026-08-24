import type { Package, XmlElement } from "ooxml.js";
import { attr, rootElement } from "ooxml.js";
import { el } from "../xml/fragment";
import { relsPathFor } from "./paths";

const RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const RELATIONSHIP_ID_PATTERN = /^rId(\d+)$/;
const ROOT_RELS_PART_PATH = "_rels/.rels";

export interface NewRelationship {
  readonly type: string;
  readonly target: string;
  readonly targetMode?: "External";
}

// Finds the .rels part at relsPath's root element, creating an empty <Relationships/> part first if none exists. Takes the already-resolved .rels path directly (rather than a part path to derive one from) so it serves both addRelationship (which derives it via relsPathFor) and addRootRelationship (which uses the fixed ROOT_RELS_PART_PATH directly -- see that function's own note on why relsPathFor('') is not the same path).
function ensureRelationshipsRootAtPath(
  pkg: Package,
  relsPath: string,
): XmlElement {
  const existingRoot = rootElement(pkg.parts[relsPath]);
  if (existingRoot !== undefined) {
    return existingRoot;
  }
  const root = el("Relationships", { xmlns: RELATIONSHIPS_NAMESPACE });
  pkg.parts[relsPath] = { kind: "xml", nodes: [root] };
  return root;
}

// The next unused rId in a Relationships root, scanning existing Id attributes for the highest numeric suffix -- never reusing or guessing an id that might already be referenced elsewhere.
function allocateRelationshipId(relationshipsRoot: XmlElement): string {
  let max = 0;
  for (const child of relationshipsRoot.children) {
    if (child.type !== "element" || child.tag !== "Relationship") {
      continue;
    }
    const id = attr(child, "Id");
    if (id === undefined) {
      continue;
    }
    const match = RELATIONSHIP_ID_PATTERN.exec(id);
    if (match === null) {
      continue;
    }
    const digits = match[1];
    if (digits === undefined) {
      continue;
    }
    const n = Number.parseInt(digits, 10);
    if (n > max) {
      max = n;
    }
  }
  return `rId${max + 1}`;
}

function addRelationshipAtPath(
  pkg: Package,
  relsPath: string,
  rel: NewRelationship,
): string {
  const root = ensureRelationshipsRootAtPath(pkg, relsPath);
  const id = allocateRelationshipId(root);
  const attrs: Record<string, string> = {
    Id: id,
    Type: rel.type,
    Target: rel.target,
  };
  if (rel.targetMode !== undefined) {
    attrs.TargetMode = rel.targetMode;
  }
  root.children.push(el("Relationship", attrs));
  return id;
}

// Adds a new relationship from `partPath` to `rel.target`, creating the .rels part if it doesn't yet exist, and returns the allocated relationship id.
export function addRelationship(
  pkg: Package,
  partPath: string,
  rel: NewRelationship,
): string {
  return addRelationshipAtPath(pkg, relsPathFor(partPath), rel);
}

// Adds a new relationship from the PACKAGE ROOT (not from any particular part) to rel.target, creating _rels/.rels if it doesn't yet exist, and returns the allocated relationship id. A root relationship's own .rels path is always the fixed "_rels/.rels" -- deliberately NOT relsPathFor(''), which derives "/_rels/.rels" (a leading slash, and therefore a different Package.parts key from the one every scaffold in this codebase, and every real OOXML package writer, actually uses for the root rels part -- see src/fonts/ooxml.ts's own comment describing exactly this trap on the read side). Before this function existed, addRelationship(pkg, '', rel) was the only way to add a root relationship, and it silently created an orphaned second .rels part at "/_rels/.rels" that no real reader -- including this package's own resolveRelationships -- would ever look at.
export function addRootRelationship(
  pkg: Package,
  rel: NewRelationship,
): string {
  return addRelationshipAtPath(pkg, ROOT_RELS_PART_PATH, rel);
}
