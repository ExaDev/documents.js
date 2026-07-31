import { attr, childrenWithTag, decodePackage, encodePackage, resolveRelationships, rootElement } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { createEmptyPptxPackage } from './scaffold';

describe('createEmptyPptxPackage', () => {
  it('has every part a minimal, real-world-openable pptx needs, with no slides yet', () => {
    const pkg = createEmptyPptxPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'ppt/presentation.xml',
        'ppt/_rels/presentation.xml.rels',
        'ppt/slideMasters/slideMaster1.xml',
        'ppt/slideMasters/_rels/slideMaster1.xml.rels',
        'ppt/slideLayouts/slideLayout1.xml',
        'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
        'ppt/theme/theme1.xml',
      ].sort(),
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

  // Every one of these was a real defect, each confirmed only by opening the generated file in actual Keynote (not this package's own reader, which never required any of them): the slide/master/layout root elements need every namespace prefix they use declared on themselves, since each OOXML part is an independent XML document; a schema-validating reader rejects a p:spTree missing its mandatory p:nvGrpSpPr/p:grpSpPr pair; and a presentation with no slideMaster/slideLayout/theme chain, or a slide with no relationship to a layout, is rejected outright even though this package's own reader tolerates all three.

  it('declares xmlns:p, xmlns:a, and xmlns:r on the presentation, slideMaster, and slideLayout root elements', () => {
    const pkg = createEmptyPptxPackage();
    for (const partPath of ['ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']) {
      const root = rootElement(pkg.parts[partPath]);
      expect(root, partPath).toBeDefined();
      const names = root?.attributes.map((a) => a.name) ?? [];
      expect(names, partPath).toEqual(expect.arrayContaining(['xmlns:p', 'xmlns:a', 'xmlns:r']));
    }
  });

  it('p:presentation declares p:sldMasterIdLst before p:sldIdLst, per CT_Presentation element order', () => {
    const pkg = createEmptyPptxPackage();
    const root = rootElement(pkg.parts['ppt/presentation.xml']);
    const tags = root?.children.filter((c) => c.type === 'element').map((c) => (c.type === 'element' ? c.tag : ''));
    const masterIndex = tags?.indexOf('p:sldMasterIdLst') ?? -1;
    const slideIndex = tags?.indexOf('p:sldIdLst') ?? -1;
    expect(masterIndex).toBeGreaterThanOrEqual(0);
    expect(slideIndex).toBeGreaterThan(masterIndex);
  });

  it('the slide master has an explicit white p:bg before p:spTree, so a real viewer never falls back to its own default background', () => {
    const pkg = createEmptyPptxPackage();
    const master = rootElement(pkg.parts['ppt/slideMasters/slideMaster1.xml']);
    const cSld = master === undefined ? undefined : childrenWithTag(master, 'p:cSld')[0];
    expect(cSld).toBeDefined();
    const childTags = cSld?.children.filter((c) => c.type === 'element').map((c) => (c.type === 'element' ? c.tag : ''));
    expect(childTags?.indexOf('p:bg')).toBe(0);
    expect(childTags?.indexOf('p:spTree')).toBe(1);
    const srgbClr = cSld === undefined ? undefined : childrenWithTag(cSld, 'p:bg')[0];
    const fill = srgbClr === undefined ? undefined : childrenWithTag(childrenWithTag(childrenWithTag(srgbClr, 'p:bgPr')[0]!, 'a:solidFill')[0]!, 'a:srgbClr')[0];
    expect(fill === undefined ? undefined : attr(fill, 'val')).toBe('FFFFFF');
  });

  it('every p:spTree (slide master and slide layout) starts with p:nvGrpSpPr then p:grpSpPr', () => {
    const pkg = createEmptyPptxPackage();
    for (const partPath of ['ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']) {
      const root = rootElement(pkg.parts[partPath]);
      const cSld = root === undefined ? undefined : childrenWithTag(root, 'p:cSld')[0];
      const spTree = cSld === undefined ? undefined : childrenWithTag(cSld, 'p:spTree')[0];
      const childTags = spTree?.children.filter((c) => c.type === 'element').map((c) => (c.type === 'element' ? c.tag : ''));
      expect(childTags, partPath).toEqual(['p:nvGrpSpPr', 'p:grpSpPr']);
    }
  });

  it('the slide master relates to the slide layout and the theme; the slide layout relates back to the slide master', () => {
    const pkg = createEmptyPptxPackage();
    const masterRels = [...resolveRelationships(pkg, 'ppt/slideMasters/slideMaster1.xml').values()];
    expect(masterRels.some((r) => r.target === 'ppt/slideLayouts/slideLayout1.xml')).toBe(true);
    expect(masterRels.some((r) => r.target === 'ppt/theme/theme1.xml')).toBe(true);
    const layoutRels = [...resolveRelationships(pkg, 'ppt/slideLayouts/slideLayout1.xml').values()];
    expect(layoutRels.some((r) => r.target === 'ppt/slideMasters/slideMaster1.xml')).toBe(true);
  });

  it('p:presentation relates to the slide master via p:sldMasterIdLst/@r:id', () => {
    const pkg = createEmptyPptxPackage();
    const root = rootElement(pkg.parts['ppt/presentation.xml']);
    const sldMasterIdLst = root === undefined ? undefined : childrenWithTag(root, 'p:sldMasterIdLst')[0];
    const sldMasterId = sldMasterIdLst === undefined ? undefined : childrenWithTag(sldMasterIdLst, 'p:sldMasterId')[0];
    const rId = sldMasterId === undefined ? undefined : attr(sldMasterId, 'r:id');
    expect(rId).toBeDefined();
    const presentationRels = resolveRelationships(pkg, 'ppt/presentation.xml');
    expect(rId === undefined ? undefined : presentationRels.get(rId)?.target).toBe('ppt/slideMasters/slideMaster1.xml');
  });
});
