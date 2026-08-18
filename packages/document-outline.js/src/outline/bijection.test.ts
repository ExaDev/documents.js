import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_PACKAGE_FORMAT_VERSION,
  ContentDocumentSchema,
  type ContentDocument,
  type DocumentPackage,
} from 'document-schema.js';
import { decompose } from './decompose';
import { documentEnvelope, flatten } from './flatten';
import { effectiveTree } from './effective';
import { isPackageNode, isSectionGroup } from './package-node';
import { canonicalise } from './hash';
import { paragraph, wordprocessingDoc } from '../test-support/fixtures';
import { corpus } from '../test-support/bijection-corpus';

// The three bijection laws that gate the whole DocumentPackage promotion (ExaDev/document-schema.js#20's amended statement, ExaDev/document-outline.js#2's phase 1): (i) strict structural equality in both directions, up to one declared normalisation (a present-but-empty embeddedObjects array normalises to the field absent -- see normaliseEmbeddedObjects below); (ii) effective-property equality universally, resolve-then-compare; (iii) minting idempotence, decompose(flatten(decompose(x))) === decompose(x). Today every corpus document is styles-table-free by construction (factorStyles does not exist yet), so law (i) holds unconditionally up to that normalisation and law (ii) reduces to structural equality -- the assertions are shaped so the styles round-trip checks slot into the marked places without rewriting: law (ii) already compares through effective/effectiveTree, and the flat encoding's zero-style-refs invariant is already asserted.

// The comparator, per the promotion plan's rules: canonicalise rebuilds every object with sorted keys (hash.ts's own recipe step 1, so the comparator and the hash can never drift apart), and one JSON-parse cycle collapses absent-versus-explicitly-undefined before comparison. Never an identity assertion: decompose embeds the source's own node objects, so toBe would pass even for an implementation that mutated its input -- structural comparison over a pre-roundtrip structuredClone snapshot is what actually pins the values.
function canon(value: unknown): unknown {
  return JSON.parse(JSON.stringify(normaliseEmbeddedObjects(canonicalise(value))));
}

// The bijection's one declared normalisation: decompose concatenates a sheet's images and embedded objects into a single children array and flatten rebuilds embeddedObjects only when an embedded object exists, so a present-but-empty array -- schema-legal (the field is z.array().optional()), emitted by no codec today -- cannot survive the round trip and normalises to the field absent. Applied to BOTH sides of every comparison so law (i) stays an equivalence over canonical forms rather than a one-way coercion; the direction (present-empty round-trips to absent) is pinned outright in decompose.test.ts, and the law statements name the normalisation so the phase-3 documents.js gate inherits it as a declared rule instead of discovering it as an undeclared failure. Recursive because a sheet can sit inside an embedded document, whose own sheets can carry the same field.
function normaliseEmbeddedObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseEmbeddedObjects);
  if (typeof value !== 'object' || value === null) return value;
  const normalised: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'embeddedObjects' && Array.isArray(child) && child.length === 0) continue;
    normalised[key] = normaliseEmbeddedObjects(child);
  }
  return normalised;
}

function expectStructurallyEqual(actual: unknown, expected: unknown): void {
  expect(canon(actual)).toEqual(canon(expected));
}

function wrap(content: ContentDocument): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content };
}

// True when any object anywhere in the value carries a `style` key. Today that is trivially false (ContentDocument carries no style-ref field at all); the assertion exists now because "the flat encoding is always fully materialised, refs live only on tree nodes" is the invariant the future styles mint depends on, and it must already hold before that mint arrives.
function containsStyleRef(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsStyleRef);
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'style') return true;
      if (containsStyleRef(child)) return true;
    }
  }
  return false;
}

describe('decompose/flatten bijection laws', () => {
  describe.each(corpus)('$name', ({ pkg }) => {
    it('produces a tree of valid package nodes over schema-valid content', () => {
      expect(ContentDocumentSchema.safeParse(pkg.content).success).toBe(true);
      for (const root of decompose(pkg)) {
        // isPackageNode recurses through children, so this validates each whole tree, not just its root.
        expect(isPackageNode(root)).toBe(true);
      }
    });

    it('law (i): flatten(decompose(pkg)) reproduces pkg.content exactly', () => {
      const snapshot = structuredClone(pkg.content);
      const flat = flatten(decompose(pkg), documentEnvelope(pkg.content));
      expect(ContentDocumentSchema.safeParse(flat).success).toBe(true);
      expectStructurallyEqual(flat, snapshot);
      // decompose embeds the source's own nodes, so re-comparing the source against its snapshot also pins that neither direction of the round trip mutated the input in place.
      expectStructurallyEqual(pkg.content, snapshot);
    });

    it('law (ii): effective properties are identical in both encodings', () => {
      const snapshot = structuredClone(pkg.content);
      const tree = decompose(pkg);
      const flat = flatten(tree, documentEnvelope(pkg.content));
      // Resolve-then-compare: both sides pass through effective/effectiveTree, so today (no style layer, resolution is identity) this is structural equality, and when the styles major lands the same assertion compares overlay-resolved properties without being rewritten. This is also where factorStyles' minting checks slot in later: effective-of-factored deep-equals effective-of-unfactored, asserted against the same snapshot.
      expectStructurallyEqual(effectiveTree(decompose(wrap(flat))), effectiveTree(tree));
      expect(containsStyleRef(flat)).toBe(false);
      expectStructurallyEqual(pkg.content, snapshot);
    });

    it('law (iii): decompose(flatten(decompose(pkg))) === decompose(pkg)', () => {
      const first = decompose(pkg);
      const second = decompose(wrap(flatten(first, documentEnvelope(pkg.content))));
      expectStructurallyEqual(second, first);
    });
  });

  // The ownership rule as a positive identity check, separate from the structural laws above: decompose embeds the document's own objects (leaves are the same references, never copies), and flatten emits those same objects back into block flow. The laws deliberately never use toBe; this one deliberately does, because sharing IS the contract being pinned -- a consumer holding both views sees an edit through either.
  it('embeds the source nodes themselves, not copies', () => {
    const heading = paragraph('Chapter', { headingLevel: 1 });
    const body = paragraph('body');
    const doc = wordprocessingDoc([[heading, body]]);
    const [sectionGroup] = decompose(wrap(doc));
    if (sectionGroup === undefined || !isSectionGroup(sectionGroup)) {
      throw new Error('expected a section group at the root');
    }
    const [headingGroup] = sectionGroup.children;
    if (headingGroup === undefined || !('node' in headingGroup) || !('children' in headingGroup)) {
      throw new Error('expected the heading paragraph to open the section flow');
    }
    expect(headingGroup.node).toBe(heading);
    const flat = flatten(decompose(wrap(doc)), documentEnvelope(doc));
    if (flat.kind !== 'wordprocessing') throw new Error('expected a wordprocessing document back');
    const [section] = flat.sections;
    if (section === undefined) throw new Error('expected one section back');
    const [firstBlock, secondBlock] = section.blocks;
    expect(firstBlock).toBe(heading);
    expect(secondBlock).toBe(body);
  });
});
