import { describe, expect, it } from 'vitest';
import { el, txt } from './fragment';
import { rootElement, findChildElement, childrenWithTag, attrValue } from './query';

describe('rootElement', () => {
  it('returns the first element node, skipping a leading declaration', () => {
    const root = el('office:document-content');
    expect(rootElement([{ type: 'declaration', attributes: [] }, root])).toBe(root);
  });

  it('returns undefined when there is no element node at all', () => {
    expect(rootElement([{ type: 'declaration', attributes: [] }])).toBeUndefined();
    expect(rootElement([])).toBeUndefined();
  });
});

describe('findChildElement', () => {
  it('returns the first direct child element with the given tag', () => {
    const target = el('office:meta');
    const nodes = [txt('\n'), el('office:font-face-decls'), target, el('office:meta')];
    expect(findChildElement(nodes, 'office:meta')).toBe(target);
  });

  it('returns undefined when no direct child matches', () => {
    expect(findChildElement([el('office:font-face-decls')], 'office:meta')).toBeUndefined();
  });

  it('does not descend into grandchildren', () => {
    const nested = el('office:document-meta', {}, [el('office:meta')]);
    expect(findChildElement([nested], 'office:meta')).toBeUndefined();
  });
});

describe('childrenWithTag', () => {
  it('returns every direct child with the given tag, in document order', () => {
    const first = el('meta:keyword', {}, [txt('alpha')]);
    const second = el('meta:keyword', {}, [txt('beta')]);
    const container = el('office:meta', {}, [el('dc:title'), first, second]);
    expect(childrenWithTag(container, 'meta:keyword')).toEqual([first, second]);
  });

  it('returns an empty array when no child matches', () => {
    expect(childrenWithTag(el('office:meta'), 'meta:keyword')).toEqual([]);
  });
});

describe('attrValue', () => {
  it('returns the value of a present attribute', () => {
    expect(attrValue(el('style:style', { 'style:name': 'P1' }), 'style:name')).toBe('P1');
  });

  it('returns undefined for a missing attribute', () => {
    expect(attrValue(el('style:style'), 'style:name')).toBeUndefined();
  });
});
