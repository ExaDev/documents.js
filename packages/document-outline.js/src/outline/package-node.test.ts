import { describe, expect, it } from 'vitest';
import { DOCUMENT_PACKAGE_FORMAT_VERSION, type ContentDocument, type DocumentPackage } from 'document-schema.js';
import { decompose } from './decompose';
import { isPackageGroup, isPackageLeaf, isPackageNode, PackageGroupSchema, PackageLeafSchema, PackageNodeSchema } from './package-node';
import { paragraph, shape, wordprocessingDoc } from '../test-support/fixtures';
import { corpus } from '../test-support/bijection-corpus';

// Pins the package tree's discrimination rule itself, which the bijection laws do not: they exercise only the positive path (isPackageNode over decompose output), while this file mirrors node.test.ts's OutlineNodeSchema block -- round-trip through the zod face plus the near-miss rejections -- for the three exported package-node schemas and the guards behind them. The rejection paths are the load-bearing half: the encoding has no discriminator field, so "what refuses to validate" is the whole contract.

function wrap(content: ContentDocument): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content };
}

// One real section group, taken straight from decompose so every near-miss below varies a single field of genuine builder output rather than a hand-copied descriptor that could drift from the encoding.
const firstRoot = decompose(wrap(wordprocessingDoc([[paragraph('Chapter', { headingLevel: 1 }), paragraph('body')]])))[0];
if (firstRoot === undefined || !('node' in firstRoot)) throw new Error('expected a section group at the root');
const sectionGroup = firstRoot;

describe('isPackageGroup guard', () => {
  it('accepts decompose output for every corpus document, group or leaf', () => {
    for (const { pkg } of corpus) {
      for (const root of decompose(pkg)) {
        expect(isPackageGroup(root) || isPackageLeaf(root)).toBe(true);
        expect(isPackageNode(root)).toBe(true);
      }
    }
  });

  it('rejects near-misses', () => {
    expect(isPackageGroup(null)).toBe(false);
    expect(isPackageGroup('group')).toBe(false);
    expect(isPackageGroup({ node: sectionGroup.node })).toBe(false);
    expect(isPackageGroup({ children: [] })).toBe(false);
    // The anchor rule: a plain paragraph with neither grouping signal is block-flow content, not a group anchor, so wrapping it in { node, children } must not validate as a group.
    expect(isPackageGroup({ node: paragraph('no grouping signal'), children: [] })).toBe(false);
    // The shape-descriptor rule: a raw ContentShape still carrying blocks must not validate as its own descriptor (the !('blocks' in value) check) or as anything else.
    expect(isPackageGroup({ node: shape([paragraph('inner block')]), children: [] })).toBe(false);
    // The children rule: a valid descriptor with a child that is neither a group nor a leaf payload.
    expect(isPackageGroup({ node: sectionGroup.node, children: [{ nonsense: true }] })).toBe(false);
    // A group nested one level down carrying the defect -- the guard must recurse, not check only the top level.
    expect(isPackageGroup({ node: sectionGroup.node, children: [{ node: paragraph('no grouping signal'), children: [] }] })).toBe(false);
  });

  it('never confuses the two classes: a group is not a leaf, a leaf is not a group', () => {
    expect(isPackageGroup(sectionGroup)).toBe(true);
    expect(isPackageLeaf(sectionGroup)).toBe(false);
    const leaf = paragraph('a plain leaf');
    expect(isPackageLeaf(leaf)).toBe(true);
    expect(isPackageGroup(leaf)).toBe(false);
    // The zod faces agree with the guards on the same cross-class cases.
    expect(PackageGroupSchema.safeParse(leaf).success).toBe(false);
    expect(PackageLeafSchema.safeParse(sectionGroup).success).toBe(false);
    expect(PackageGroupSchema.safeParse(sectionGroup).success).toBe(true);
    expect(PackageLeafSchema.safeParse(leaf).success).toBe(true);
  });
});

describe('PackageNodeSchema', () => {
  it('round-trips decompose roots for every corpus document through parse unchanged', () => {
    for (const { pkg } of corpus) {
      for (const root of decompose(pkg)) {
        expect(PackageNodeSchema.parse(root)).toEqual(root);
      }
    }
  });

  it('rejects a near-miss through safeParse', () => {
    expect(PackageNodeSchema.safeParse({ node: paragraph('no grouping signal'), children: [] }).success).toBe(false);
    expect(PackageNodeSchema.safeParse({ node: shape([paragraph('inner block')]), children: [] }).success).toBe(false);
    expect(PackageNodeSchema.safeParse({ node: sectionGroup.node, children: [{ nonsense: true }] }).success).toBe(false);
  });
});
