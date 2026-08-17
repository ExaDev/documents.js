import { describe, expect, it } from 'vitest';
import { buildOutline } from './build';
import { isOutlineChild, isOutlineLeaf, isOutlineNode, OutlineNodeSchema } from './node';
import {
  drawPage,
  drawingDoc,
  embeddedObject,
  formulaDoc,
  imageBlock,
  pageBreak,
  paragraph,
  presentationDoc,
  sheet,
  sheetImage,
  slide,
  spreadsheetDoc,
  table,
  vectorLine,
  wordprocessingDoc,
} from '../test-support/fixtures';

describe('isOutlineNode guard', () => {
  it('accepts builder output for every document kind', () => {
    const documents = [
      wordprocessingDoc([
        [
          paragraph('before'),
          paragraph('Chapter', { headingLevel: 1 }),
          paragraph('A', { listLevel: 0 }),
          paragraph('B', { listLevel: 1 }),
          table([['cell']]),
          paragraph('Deep', { headingLevel: 4 }),
        ],
      ]),
      presentationDoc([slide([[paragraph('A', { listLevel: 0 }), imageBlock('a picture'), paragraph('B', { listLevel: 1 })]])]),
      spreadsheetDoc([sheet({ name: 'Revenue', images: [sheetImage('a chart')], embeddedObjects: [embeddedObject()] })]),
      drawingDoc([drawPage([[paragraph('text box')]], [vectorLine()])]),
      formulaDoc('x^2'),
    ];
    for (const doc of documents) {
      // The wordprocessing root mixes a pre-heading leaf with groups; every other kind's root is pure groups. isOutlineChild covers both classes.
      const outline = buildOutline(doc);
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
    const leaves = [
      paragraph('text'),
      table([['cell']]),
      imageBlock('a picture'),
      pageBreak(),
      blockEmbedded,
      sheetImage('a chart'),
      embeddedObject(),
      vectorLine(),
      formulaDoc('x^2').formula,
    ];
    for (const leaf of leaves) {
      expect(isOutlineLeaf(leaf)).toBe(true);
    }
    expect(isOutlineLeaf({ nonsense: true })).toBe(false);
  });
});

describe('OutlineNodeSchema', () => {
  it('round-trips builder output through parse unchanged', () => {
    const doc = wordprocessingDoc([
      [
        paragraph('before'),
        paragraph('Chapter', { headingLevel: 1 }),
        paragraph('A', { listLevel: 0 }),
        paragraph('B', { listLevel: 1 }),
        table([['cell']]),
      ],
    ]);
    const outline = buildOutline(doc);
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
