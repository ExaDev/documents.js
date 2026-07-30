import type { Package, XmlElement } from 'ooxml.js';
import { attr, rootElement } from 'ooxml.js';
import { el } from '../xml/fragment';
import { relsPathFor } from './paths';

const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELATIONSHIP_ID_PATTERN = /^rId(\d+)$/;

export interface NewRelationship {
  readonly type: string;
  readonly target: string;
  readonly targetMode?: 'External';
}

// Finds partPath's .rels root element, creating an empty <Relationships/> part first if none exists.
function ensureRelationshipsRoot(pkg: Package, partPath: string): XmlElement {
  const relsPath = relsPathFor(partPath);
  const existingRoot = rootElement(pkg.parts[relsPath]);
  if (existingRoot !== undefined) {
    return existingRoot;
  }
  const root = el('Relationships', { xmlns: RELATIONSHIPS_NAMESPACE });
  pkg.parts[relsPath] = { kind: 'xml', nodes: [root] };
  return root;
}

// The next unused rId in a Relationships root, scanning existing Id attributes for the highest numeric suffix -- never reusing or guessing an id that might already be referenced elsewhere.
function allocateRelationshipId(relationshipsRoot: XmlElement): string {
  let max = 0;
  for (const child of relationshipsRoot.children) {
    if (child.type !== 'element' || child.tag !== 'Relationship') {
      continue;
    }
    const id = attr(child, 'Id');
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

// Adds a new relationship from `partPath` to `rel.target`, creating the .rels part if it doesn't yet exist, and returns the allocated relationship id.
export function addRelationship(pkg: Package, partPath: string, rel: NewRelationship): string {
  const root = ensureRelationshipsRoot(pkg, partPath);
  const id = allocateRelationshipId(root);
  const attrs: Record<string, string> = { Id: id, Type: rel.type, Target: rel.target };
  if (rel.targetMode !== undefined) {
    attrs.TargetMode = rel.targetMode;
  }
  root.children.push(el('Relationship', attrs));
  return id;
}
