import { describe, expect, it } from 'vitest';
import { buildOutline } from './build';
import { isOutlineChild, isOutlineLeaf, isOutlineNode, OutlineNodeSchema } from './node';
import {
  drawPageGroup,
  drawingPackage,
  embeddedObject,
  formulaPackage,
  headingGroup,
  imageBlock,
  listGroup,
  pageBreak,
  paragraph,
  presentationPackage,
  sectionGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  table,
  vectorLine,
  wordprocessingPackage,
} from '../test-support/fixtures';

describe('isOutlineNode guard', () => {
  it('accepts builder output for every package kind', () => {
    const packages = [
      wordprocessingPackage([
        sectionGroup([
          paragraph('before'),
          headingGroup('Chapter', 1, [listGroup('A', 0, [listGroup('B', 1, [table([['cell']])])])]),
          headingGroup('Deep', 4, []),
        ]),
      ]),
      presentationPackage([slideGroup([shapeGroup([listGroup('A', 0, [imageBlock('a picture')]), listGroup('B', 1, [])])])]),
      spreadsheetPackage([sheetGroup({ name: 'Revenue', images: [sheetImage('a chart')], embeddedObjects: [embeddedObject()] })]),
      drawingPackage([drawPageGroup([shapeGroup([paragraph('text box')]), vectorLine()])]),
      formulaPackage('x^2'),
    ];
    for (const pkg of packages) {
      // The wordprocessing root mixes a pre-heading leaf with groups; every other kind's root is pure groups. isOutlineChild covers both classes.
      const outline = buildOutline(pkg);
      expect(outline.every(isOutlineChild)).toBe(true);
      for (const node of outline.filter(isOutlineNode)) {
        expect(isOutlineNode(node)).toBe(true);
      }
    }
  });

  it('rejects near-misses', () => {
    expect(isOutlineNode(null)).toBe(false);
    expect(isOutlineNode('heading')).toBe(false);
    expect(isOutlineNode({ text: 'x', level: 1 })).toBe(false);
    expect(isOutlineNode({ text: 'x', level: 1, children: {} })).toBe(false);
    expect(isOutlineNode({ text: 1, level: 1, children: [] })).toBe(false);
    expect(isOutlineNode({ text: 'x', level: '1', children: [] })).toBe(false);
    expect(isOutlineNode({ text: 'x', level: Number.NaN, children: [] })).toBe(false);
    expect(isOutlineNode({ text: 'x', level: Number.POSITIVE_INFINITY, children: [] })).toBe(false);
    // A child that is neither a group nor a valid leaf payload.
    expect(isOutlineNode({ text: 'x', level: 1, children: [{ nonsense: true }] })).toBe(false);
    // A leaf-shaped child that fails its own content schema.
    expect(isOutlineNode({ text: 'x', level: 1, children: [{ kind: 'paragraph', runs: 'not-an-array' }] })).toBe(false);
    // A group nested one level down carrying the defect -- the guard must recurse, not check only the top level.
    expect(isOutlineNode({ text: 'x', level: 1, children: [{ text: 'y', level: 2, children: [42] }] })).toBe(false);
  });

  it('recognises every leaf class via isOutlineLeaf', () => {
    const blockEmbedded = { ...embeddedObject(), kind: 'embeddedObject' };
    const withLatex = formulaPackage('x^2');
    if (withLatex.kind !== 'formula') throw new Error('unreachable');
    const leaves = [
      paragraph('text'),
      table([['cell']]),
      imageBlock('a picture'),
      pageBreak(),
      blockEmbedded,
      sheetImage('a chart'),
      embeddedObject(),
      vectorLine(),
      withLatex.children[0]!,
    ];
    for (const leaf of leaves) {
      expect(isOutlineLeaf(leaf)).toBe(true);
    }
    expect(isOutlineLeaf({ nonsense: true })).toBe(false);
  });
});

describe('OutlineNodeSchema', () => {
  it('round-trips builder output through parse unchanged', () => {
    const pkg = wordprocessingPackage([
      sectionGroup([paragraph('before'), headingGroup('Chapter', 1, [listGroup('A', 0, [listGroup('B', 1, [table([['cell']])])])])]),
    ]);
    const outline = buildOutline(pkg);
    expect(outline.every(isOutlineChild)).toBe(true);
    // The pre-heading paragraph is a leaf at the root; the group nodes round-trip through the schema unchanged.
    const groups = outline.filter(isOutlineNode);
    expect(groups).toHaveLength(1);
    for (const node of groups) {
      expect(OutlineNodeSchema.parse(node)).toEqual(node);
    }
  });

  it('rejects a near-miss through safeParse', () => {
    expect(OutlineNodeSchema.safeParse({ text: 'x', level: 1 }).success).toBe(false);
    expect(OutlineNodeSchema.safeParse({ text: 'x', level: 1, children: [{ nonsense: true }] }).success).toBe(false);
  });
});
