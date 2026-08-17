import { describe, expect, it } from 'vitest';
import type { ContentBlock } from 'document-schema.js';
import { buildOutline } from './build';
import { flattenOutline, leafContentHash, outlineLeafText } from './helpers';
import {
  embeddedObject,
  formulaDoc,
  imageBlock,
  pageBreak,
  paragraph,
  table,
  vectorLine,
  wordprocessingDoc,
} from '../test-support/fixtures';

describe('flattenOutline', () => {
  it('flattens to leaves in document order, skipping group nodes', () => {
    const before = paragraph('before');
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const listA = paragraph('A', { listLevel: 0 });
    const listB = paragraph('B', { listLevel: 1 });
    const nestedTable = table([['cell']]);
    const h2 = paragraph('Section', { headingLevel: 2 });
    const after = paragraph('after');
    const doc = wordprocessingDoc([[before, h1, listA, listB, nestedTable, h2, after]]);
    // The table attaches at the current depth -- under list item B -- and the H2 pops the list nesting back under the chapter, so document order is before, the table, then after.
    expect(flattenOutline(buildOutline(doc))).toEqual([before, nestedTable, after]);
  });

  it('returns an empty array for an outline of empty groups', () => {
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const h2 = paragraph('Section', { headingLevel: 2 });
    const doc = wordprocessingDoc([[h1, h2]]);
    expect(flattenOutline(buildOutline(doc))).toEqual([]);
  });
});

describe('outlineLeafText', () => {
  it('concatenates a paragraph run texts with no separator', () => {
    const block: ContentBlock = {
      kind: 'paragraph',
      runs: [{ text: 'Hello ' }, { text: 'world' }],
    };
    expect(outlineLeafText(block)).toBe('Hello world');
  });

  it('joins table cell paragraphs within a row by space and rows by newline', () => {
    expect(outlineLeafText(table([['a', 'b'], ['c', 'd']]))).toBe('a b\nc d');
  });

  it('returns an image altText, empty when absent', () => {
    expect(outlineLeafText(imageBlock('A chart'))).toBe('A chart');
    expect(outlineLeafText(imageBlock())).toBe('');
  });

  it('returns the empty string for the textless leaves', () => {
    expect(outlineLeafText(pageBreak())).toBe('');
    expect(outlineLeafText(embeddedObject())).toBe('');
    expect(outlineLeafText(vectorLine())).toBe('');
  });

  it('returns a formula LaTeX linearisation, empty when absent', () => {
    expect(outlineLeafText(formulaDoc('x^2').formula)).toBe('x^2');
    expect(outlineLeafText(formulaDoc().formula)).toBe('');
  });
});

describe('leafContentHash', () => {
  it('hashes independently constructed identical content identically regardless of key order', () => {
    const first = paragraph('same text');
    const second: ContentBlock = { runs: [{ text: 'same text' }], kind: 'paragraph' };
    expect(leafContentHash(first)).toBe(leafContentHash(second));
  });

  it('is deterministic across repeated calls', () => {
    const leaf = paragraph('same text');
    expect(leafContentHash(leaf)).toBe(leafContentHash(leaf));
  });

  it('differs when the content differs', () => {
    expect(leafContentHash(paragraph('a'))).not.toBe(leafContentHash(paragraph('b')));
    const styled: ContentBlock = { kind: 'paragraph', runs: [{ text: 'same text', bold: true }] };
    expect(leafContentHash(paragraph('same text'))).not.toBe(leafContentHash(styled));
  });

  it('treats an explicitly undefined optional field as absent', () => {
    const first = paragraph('same text');
    const second: ContentBlock = { kind: 'paragraph', runs: [{ text: 'same text' }], styleId: undefined };
    expect(leafContentHash(first)).toBe(leafContentHash(second));
  });
});
