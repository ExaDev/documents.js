import type { XmlElement, XmlNode } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import {
  directChildElement,
  getOrCreateChildElement,
  insertAfter,
  insertBefore,
  insertInSchemaOrder,
  removeAttr,
  removeChild,
  setAttr,
} from './edit';
import { el } from './fragment';

describe('setAttr / removeAttr', () => {
  it('appends a new attribute', () => {
    const element = el('w:sz');
    setAttr(element, 'w:val', '24');
    expect(element.attributes).toEqual([{ name: 'w:val', value: '24' }]);
  });

  it('updates an existing attribute in place rather than duplicating it', () => {
    const element = el('w:sz', { 'w:val': '24' });
    setAttr(element, 'w:val', '28');
    expect(element.attributes).toEqual([{ name: 'w:val', value: '28' }]);
  });

  it('removeAttr removes an existing attribute and is a no-op otherwise', () => {
    const element = el('w:sz', { 'w:val': '24' });
    removeAttr(element, 'w:val');
    expect(element.attributes).toEqual([]);
    expect(() => { removeAttr(element, 'w:val'); }).not.toThrow();
  });
});

describe('removeChild / insertBefore / insertAfter', () => {
  it('removeChild splices the node out and reports success', () => {
    const a = el('a');
    const b = el('b');
    const container: XmlNode[] = [a, b];
    expect(removeChild(container, a)).toBe(true);
    expect(container).toEqual([b]);
  });

  it('removeChild returns false and leaves the container untouched when the node is absent', () => {
    const container: XmlNode[] = [el('a')];
    const stray = el('b');
    expect(removeChild(container, stray)).toBe(false);
    expect(container).toHaveLength(1);
  });

  it('insertBefore and insertAfter place a node relative to a reference sibling', () => {
    const a = el('a');
    const b = el('b');
    const container: XmlNode[] = [a, b];
    const before = el('before');
    const after = el('after');
    insertBefore(container, b, before);
    insertAfter(container, b, after);
    expect(container).toEqual([a, before, b, after]);
  });
});

describe('insertInSchemaOrder', () => {
  // CT_RPr's ECMA-376-mandated sequence, abbreviated to the fields exercised here.
  const RPR_ORDER = ['w:rFonts', 'w:b', 'w:i', 'w:color', 'w:sz'];

  it('inserts a child before the first existing sibling that ranks later in the schema order', () => {
    const parent = el('w:rPr', {}, [el('w:rFonts'), el('w:sz')]);
    insertInSchemaOrder(parent, el('w:color'), RPR_ORDER);
    expect(parent.children.map((c) => (c.type === 'element' ? c.tag : c.type))).toEqual([
      'w:rFonts',
      'w:color',
      'w:sz',
    ]);
  });

  it('appends when every existing sibling ranks earlier', () => {
    const parent = el('w:rPr', {}, [el('w:rFonts'), el('w:b')]);
    insertInSchemaOrder(parent, el('w:sz'), RPR_ORDER);
    expect(parent.children.map((c) => (c.type === 'element' ? c.tag : c.type))).toEqual([
      'w:rFonts',
      'w:b',
      'w:sz',
    ]);
  });

  it('appends when the parent has no children yet', () => {
    const parent = el('w:rPr');
    insertInSchemaOrder(parent, el('w:b'), RPR_ORDER);
    expect(parent.children.map((c) => (c.type === 'element' ? c.tag : c.type))).toEqual(['w:b']);
  });

  it('appends a tag not present in the order list rather than misplacing it', () => {
    const parent = el('w:rPr', {}, [el('w:rFonts')]);
    insertInSchemaOrder(parent, el('w:rPrChange'), RPR_ORDER);
    expect(parent.children.map((c) => (c.type === 'element' ? c.tag : c.type))).toEqual([
      'w:rFonts',
      'w:rPrChange',
    ]);
  });

  it('inserting every field out of order still yields the schema order', () => {
    const parent = el('w:rPr');
    for (const tag of ['w:sz', 'w:rFonts', 'w:color', 'w:b', 'w:i']) {
      insertInSchemaOrder(parent, el(tag), RPR_ORDER);
    }
    expect(parent.children.map((c) => (c.type === 'element' ? c.tag : c.type))).toEqual(RPR_ORDER);
  });
});

describe('directChildElement / getOrCreateChildElement', () => {
  const ORDER = ['w:rFonts', 'w:b'];

  it('directChildElement finds an existing direct child by tag', () => {
    const bold = el('w:b');
    const parent: XmlElement = el('w:rPr', {}, [bold]);
    expect(directChildElement(parent, 'w:b')).toBe(bold);
    expect(directChildElement(parent, 'w:i')).toBeUndefined();
  });

  it('getOrCreateChildElement returns the existing child without creating a duplicate', () => {
    const bold = el('w:b');
    const parent: XmlElement = el('w:rPr', {}, [bold]);
    const found = getOrCreateChildElement(parent, 'w:b', ORDER, () => el('w:b'));
    expect(found).toBe(bold);
    expect(parent.children).toHaveLength(1);
  });

  it('getOrCreateChildElement creates and schema-order-inserts a missing child', () => {
    const parent: XmlElement = el('w:rPr', {}, [el('w:b')]);
    const created = getOrCreateChildElement(parent, 'w:rFonts', ORDER, () => el('w:rFonts', { 'w:ascii': 'Arial' }));
    expect(created.tag).toBe('w:rFonts');
    expect(parent.children.map((c) => (c.type === 'element' ? c.tag : c.type))).toEqual(['w:rFonts', 'w:b']);
  });
});
