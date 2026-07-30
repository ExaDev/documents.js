import { decodePackage, encodePackage, rootElement } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { createEmptyPptxPackage } from './scaffold';

describe('createEmptyPptxPackage', () => {
  it('has every part a minimal pptx needs, with no slides yet', () => {
    const pkg = createEmptyPptxPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'].sort(),
    );
  });

  it('round-trips through encodePackage/decodePackage unchanged', () => {
    const pkg = createEmptyPptxPackage();
    expect(decodePackage(encodePackage(pkg))).toEqual(pkg);
  });

  it('declares the default 16:9 widescreen slide size', () => {
    const pkg = createEmptyPptxPackage();
    const root = rootElement(pkg.parts['ppt/presentation.xml']);
    const sldSz = root?.children.find((c) => c.type === 'element' && c.tag === 'p:sldSz');
    expect(sldSz?.type === 'element' ? sldSz.attributes : undefined).toContainEqual({ name: 'cx', value: '12192000' });
  });
});
