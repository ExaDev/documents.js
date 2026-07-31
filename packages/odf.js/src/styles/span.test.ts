import { describe, expect, it } from 'vitest';
import type { XmlElement } from '../model/node';
import { el, txt } from '../xml/fragment';
import { ensureSpan } from './span';

function paragraphOf(...children: XmlElement['children']): XmlElement {
  return el('text:p', {}, children);
}

function styleName(span: XmlElement): string | undefined {
  return span.attributes.find((a) => a.name === 'text:style-name')?.value;
}

function textOf(node: XmlElement['children'][number]): string {
  if (node.type !== 'text') {
    throw new Error(`expected a text node, got ${node.type}`);
  }
  return node.value;
}

describe('ensureSpan: plain text wrapping', () => {
  it('wraps a prefix of a single text node, leaving the remainder as a trailing sibling text node', () => {
    const paragraph = paragraphOf(txt('Hello world'));
    const span = ensureSpan(paragraph, 0, 5, 'T1');
    expect(styleName(span)).toBe('T1');
    expect(paragraph.children).toHaveLength(2);
    expect(paragraph.children[0]).toBe(span);
    expect(textOf(paragraph.children[1]!)).toBe(' world');
    expect(span.children).toHaveLength(1);
    expect(textOf(span.children[0]!)).toBe('Hello');
  });

  it('wraps a range in the middle, leaving both a before and an after text node', () => {
    const paragraph = paragraphOf(txt('Hello world'));
    const span = ensureSpan(paragraph, 6, 11, 'T1');
    expect(paragraph.children).toHaveLength(2);
    expect(textOf(paragraph.children[0]!)).toBe('Hello ');
    expect(paragraph.children[1]).toBe(span);
    expect(textOf(span.children[0]!)).toBe('world');
  });

  it('wraps the entire content when the range covers the whole paragraph', () => {
    const paragraph = paragraphOf(txt('abc'));
    const span = ensureSpan(paragraph, 0, 3, 'T1');
    expect(paragraph.children).toEqual([span]);
    expect(textOf(span.children[0]!)).toBe('abc');
  });

  it('is idempotent: calling it again on the exact same already-wrapped range updates the existing span\'s style rather than double-wrapping', () => {
    const paragraph = paragraphOf(txt('Hello world'));
    const first = ensureSpan(paragraph, 0, 5, 'T1');
    const second = ensureSpan(paragraph, 0, 5, 'T2');
    expect(second).toBe(first); // the very same element, mutated in place
    expect(styleName(second)).toBe('T2');
    expect(paragraph.children).toHaveLength(2); // still exactly one span + one trailing text node, never nested
    expect(second.children).toHaveLength(1);
    expect(textOf(second.children[0]!)).toBe('Hello');
  });

  it('adds a text:style-name attribute (rather than updating one) when reusing an existing span that has none yet', () => {
    const bareSpan = el('text:span', {}, [txt('Hello')]);
    const paragraph = paragraphOf(bareSpan);
    const reused = ensureSpan(paragraph, 0, 5, 'T1');
    expect(reused).toBe(bareSpan);
    expect(reused.attributes).toEqual([{ name: 'text:style-name', value: 'T1' }]);
  });

  it('treats a zero-width node (e.g. a comment) as occupying no character positions, carrying it through untouched on whichever side it falls', () => {
    const paragraph = paragraphOf(txt('ab'), { type: 'comment', value: 'marker' }, txt('cd'));
    const span = ensureSpan(paragraph, 0, 2, 'T1');
    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children[0]).toBe(span);
    expect(paragraph.children[1]).toEqual({ type: 'comment', value: 'marker' });
    expect(textOf(paragraph.children[2]!)).toBe('cd');
  });

  it('treats an unrecognised element (e.g. a bookmark) as zero-width too, contributing nothing to the character count', () => {
    // "ab" (0-1) + a zero-width bookmark + "cd" (2-3) + "ef" (4-5) -- wrapping [0,4) must capture exactly "ab"+bookmark+"cd" and stop before "ef", proving the bookmark consumed none of the 4 requested positions.
    const paragraph = paragraphOf(txt('ab'), el('text:bookmark', { 'text:name': 'mark' }), txt('cd'), txt('ef'));
    const span = ensureSpan(paragraph, 0, 4, 'T1');
    expect(paragraph.children).toHaveLength(2);
    expect(paragraph.children[0]).toBe(span);
    expect(textOf(paragraph.children[1]!)).toBe('ef');
    expect(span.children.some((c) => c.type === 'element' && c.tag === 'text:bookmark')).toBe(true);
    expect(span.children.map((c) => (c.type === 'text' ? c.value : undefined)).join('')).toBe('abcd');
  });

  it('supports an empty (zero-length) range, producing an empty span at that position', () => {
    const paragraph = paragraphOf(txt('abc'));
    const span = ensureSpan(paragraph, 1, 1, 'T1');
    expect(span.children).toEqual([]);
    expect(paragraph.children).toHaveLength(3);
    expect(textOf(paragraph.children[0]!)).toBe('a');
    expect(paragraph.children[1]).toBe(span);
    expect(textOf(paragraph.children[2]!)).toBe('bc');
  });
});

describe('ensureSpan: text:s straddling a split boundary', () => {
  it('splits a text:s that straddles the START boundary into two runs whose counts sum to the original, never merging or corrupting them', () => {
    // "abc" (0-2) + text:s count=5 (3-7) + "xyz" (8-10) -- mirrors the task's own example: a text:c="5" run split at position 5 becomes count=2 and count=3.
    const paragraph = paragraphOf(txt('abc'), el('text:s', { 'text:c': '5' }), txt('xyz'));
    const span = ensureSpan(paragraph, 5, 8, 'T1');

    // Before the span: "abc" + a text:s left over from the split (count=2, positions 3-4).
    expect(paragraph.children[0]).toEqual({ type: 'text', value: 'abc' });
    const leftoverBefore = paragraph.children[1]!;
    if (leftoverBefore.type !== 'element' || leftoverBefore.tag !== 'text:s') {
      throw new Error('expected a text:s element');
    }
    expect(leftoverBefore.attributes).toEqual([{ name: 'text:c', value: '2' }]);

    // The span itself: the other half of the split text:s (count=3, positions 5-7).
    expect(paragraph.children[2]).toBe(span);
    expect(span.children).toHaveLength(1);
    const inSpan = span.children[0]!;
    if (inSpan.type !== 'element' || inSpan.tag !== 'text:s') {
      throw new Error('expected a text:s element');
    }
    expect(inSpan.attributes).toEqual([{ name: 'text:c', value: '3' }]);

    // After the span: "xyz", entirely untouched.
    expect(paragraph.children[3]).toEqual({ type: 'text', value: 'xyz' });
    expect(paragraph.children).toHaveLength(4);
  });

  it('splits a text:s that straddles the END boundary the same way', () => {
    const paragraph = paragraphOf(txt('abc'), el('text:s', { 'text:c': '5' }), txt('xyz'));
    const span = ensureSpan(paragraph, 3, 5, 'T1'); // wraps exactly the first 2 of the 5 spaces (positions 3-4)

    expect(span.children).toEqual([{ type: 'element', tag: 'text:s', attributes: [{ name: 'text:c', value: '2' }], children: [] }]);

    // The remaining 3 spaces (positions 5-7) are left as their own sibling text:s, counts summing back to the original 5.
    const remainder = paragraph.children[2]!;
    if (remainder.type !== 'element' || remainder.tag !== 'text:s') {
      throw new Error('expected a text:s element');
    }
    expect(remainder.attributes).toEqual([{ name: 'text:c', value: '3' }]);
  });

  it('a text:s split exactly at its own boundary (not straddling) is left as a single, unsplit run', () => {
    const paragraph = paragraphOf(txt('ab'), el('text:s', { 'text:c': '3' }), txt('cd'));
    const span = ensureSpan(paragraph, 2, 5, 'T1'); // [2,5) is exactly the text:s's own span (positions 2-4)
    expect(span.children).toEqual([{ type: 'element', tag: 'text:s', attributes: [{ name: 'text:c', value: '3' }], children: [] }]);
    expect(paragraph.children).toHaveLength(3);
  });

  it('a text:s with an absent text:c defaults to a count of 1', () => {
    const paragraph = paragraphOf(txt('a'), el('text:s'), txt('b')); // "a" + 1 space + "b", positions 0,1,2
    const span = ensureSpan(paragraph, 1, 2, 'T1');
    expect(span.children).toEqual([{ type: 'element', tag: 'text:s', attributes: [], children: [] }]);
  });

  it('throws a clear error for a malformed text:c attribute', () => {
    const paragraph = paragraphOf(el('text:s', { 'text:c': 'not-a-number' }));
    expect(() => ensureSpan(paragraph, 0, 1, 'T1')).toThrow(/malformed/);
  });
});

describe('ensureSpan: text:tab and text:line-break', () => {
  it('treats text:tab and text:line-break as whole, unsplittable single-position elements', () => {
    const paragraph = paragraphOf(el('text:tab'), txt('abc'), el('text:line-break'));
    const span = ensureSpan(paragraph, 0, 1, 'T1');
    expect(span.children).toEqual([{ type: 'element', tag: 'text:tab', attributes: [], children: [] }]);
    expect(paragraph.children).toHaveLength(3); // span, "abc", line-break

    const span2 = ensureSpan(paragraph, 4, 5, 'T2'); // the line-break, now at position 4 (1 tab + 3 "abc")
    expect(span2.children).toEqual([{ type: 'element', tag: 'text:line-break', attributes: [], children: [] }]);
  });
});

describe('ensureSpan: splitting a pre-existing text:span', () => {
  it('splits an existing span that a boundary falls strictly inside, preserving its style-name on BOTH halves independently', () => {
    const existingSpan = el('text:span', { 'text:style-name': 'T1' }, [txt('CDEFGH')]);
    const paragraph = paragraphOf(txt('AB'), existingSpan, txt('IJ')); // AB=0-1, CDEFGH=2-7, IJ=8-9

    const newSpan = ensureSpan(paragraph, 4, 10, 'T2');

    // Before: "AB" + the left half of the split span ("CD"), still styled T1.
    expect(textOf(paragraph.children[0]!)).toBe('AB');
    const leftHalf = paragraph.children[1]!;
    if (leftHalf.type !== 'element') throw new Error('expected an element');
    expect(leftHalf.tag).toBe('text:span');
    expect(styleName(leftHalf)).toBe('T1');
    expect(textOf(leftHalf.children[0]!)).toBe('CD');

    // [4,10) covers the split-off right half of the original span ("EFGH") AND the trailing "IJ" text node together -- since that's more than one node, ensureSpan wraps them in a brand new outer span rather than reusing/renaming the split-off span in place.
    expect(newSpan).not.toBe(existingSpan);
    expect(styleName(newSpan)).toBe('T2');
    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children[2]).toBe(newSpan);
  });

  it('reuses (renames) an existing span in place when the requested range exactly matches it, and does not disturb a sibling split off the same original span', () => {
    const existingSpan = el('text:span', { 'text:style-name': 'T1' }, [txt('CDEFGH')]);
    const paragraph = paragraphOf(txt('AB'), existingSpan, txt('IJ')); // AB=0-1, CDEFGH=2-7, IJ=8-9

    // [4,8) is exactly the second half of a split at offset 4: "EF" no -- splitting CDEFGH (2-7) at position 4 gives "CD" (2-3) and "EFGH" (4-7); [4,8) matches "EFGH" exactly.
    const reused = ensureSpan(paragraph, 4, 8, 'T2');

    const leftHalf = paragraph.children[1]!;
    if (leftHalf.type !== 'element') throw new Error('expected an element');
    expect(styleName(leftHalf)).toBe('T1'); // untouched by the rename below
    expect(textOf(leftHalf.children[0]!)).toBe('CD');

    expect(styleName(reused)).toBe('T2');
    expect(textOf(reused.children[0]!)).toBe('EFGH');
    expect(paragraph.children[3]).toEqual({ type: 'text', value: 'IJ' });
  });
});

describe('ensureSpan: input validation', () => {
  const paragraph = () => paragraphOf(txt('abcde'));

  it('throws for a negative start', () => {
    expect(() => ensureSpan(paragraph(), -1, 2, 'T1')).toThrow(/invalid range/);
  });

  it('throws when end < start', () => {
    expect(() => ensureSpan(paragraph(), 3, 1, 'T1')).toThrow(/invalid range/);
  });

  it('throws when end exceeds the container\'s total length', () => {
    expect(() => ensureSpan(paragraph(), 0, 6, 'T1')).toThrow(/exceeds/);
  });

  it('throws for non-integer offsets', () => {
    expect(() => ensureSpan(paragraph(), 0.5, 2, 'T1')).toThrow(/invalid range/);
  });
});
