import { describe, expect, it } from 'vitest';
import type { Package } from '../model/package';
import type { XmlElement } from '../model/node';
import { el, txt } from '../xml/fragment';
import { StyleRegistry, type InternRequest } from './registry';

function contentPackage(rootChildren: XmlElement[] = []): Package {
  return { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, rootChildren)] } } };
}

function stylesPackage(rootChildren: XmlElement[] = []): Package {
  return { parts: { 'styles.xml': { kind: 'xml', nodes: [el('office:document-styles', {}, rootChildren)] } } };
}

function rootElementOf(pkg: Package, partPath: string): XmlElement {
  const part = pkg.parts[partPath];
  if (part?.kind !== 'xml') {
    throw new Error('expected an xml part');
  }
  const root = part.nodes.find((n): n is XmlElement => n.type === 'element');
  if (root === undefined) {
    throw new Error('expected a root element');
  }
  return root;
}

function automaticStylesOf(pkg: Package, partPath: string): XmlElement {
  const root = rootElementOf(pkg, partPath);
  const automaticStyles = root.children.find((n): n is XmlElement => n.type === 'element' && n.tag === 'office:automatic-styles');
  if (automaticStyles === undefined) {
    throw new Error('expected an office:automatic-styles element');
  }
  return automaticStyles;
}

function styleNameOf(element: XmlElement): string | undefined {
  return element.attributes.find((a) => a.name === 'style:name')?.value;
}

const BOLD: InternRequest = { properties: { bold: true }, family: 'text' };
const CENTER_PARAGRAPH: InternRequest = { properties: { alignment: 'center' }, family: 'paragraph' };

describe('StyleRegistry.forPart: construction', () => {
  it('throws for a part that is not XML', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'binary', base64: '' } } };
    expect(() => StyleRegistry.forPart(pkg, 'content.xml')).toThrow(/not an XML part/);
  });

  it('throws for a part with no root XML element at all', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [] } } };
    expect(() => StyleRegistry.forPart(pkg, 'content.xml')).toThrow(/no root XML element/);
  });

  it('throws for a part path that is neither content.xml nor styles.xml by base name', () => {
    const pkg = contentPackage();
    pkg.parts['settings.xml'] = pkg.parts['content.xml']!;
    expect(() => StyleRegistry.forPart(pkg, 'settings.xml')).toThrow(/content\.xml.*styles\.xml/);
  });

  it('creates office:automatic-styles when the part has none yet, inserted before office:body', () => {
    const body = el('office:body');
    const pkg = contentPackage([body]);
    StyleRegistry.forPart(pkg, 'content.xml');
    const root = rootElementOf(pkg, 'content.xml');
    const tags = root.children.map((c) => (c.type === 'element' ? c.tag : c.type));
    expect(tags).toEqual(['office:automatic-styles', 'office:body']);
  });

  it('appends office:automatic-styles at the end when there is nothing that must come after it', () => {
    const fontFaceDecls = el('office:font-face-decls');
    const pkg = contentPackage([fontFaceDecls]);
    StyleRegistry.forPart(pkg, 'content.xml');
    const root = rootElementOf(pkg, 'content.xml');
    const tags = root.children.map((c) => (c.type === 'element' ? c.tag : c.type));
    expect(tags).toEqual(['office:font-face-decls', 'office:automatic-styles']);
  });

  it('starts with no known names for a blank document', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    expect(registry.names()).toEqual([]);
  });
});

describe('rule (a): adoption on construction', () => {
  it('a fresh registry over a document with an existing, fully-modelled automatic style reuses that style for a matching intern() request, rather than minting a duplicate', () => {
    const existing = el('style:style', { 'style:name': 'T7', 'style:family': 'text' }, [el('style:text-properties', { 'fo:font-weight': 'bold' })]);
    const pkg = contentPackage([el('office:automatic-styles', {}, [existing])]);

    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    expect(registry.names()).toContain('T7');
    expect(registry.intern(BOLD)).toBe('T7');

    // No duplicate style:style was created.
    const automaticStyles = automaticStylesOf(pkg, 'content.xml');
    expect(automaticStyles.children).toHaveLength(1);
  });

  it('survives a repeated open/edit/save cycle: a style minted in one StyleRegistry instance is adopted and reused by a fresh instance constructed over the same (now-saved) part afterwards', () => {
    const pkg = contentPackage();
    const first = StyleRegistry.forPart(pkg, 'content.xml');
    const mintedName = first.intern(CENTER_PARAGRAPH);

    // Simulate closing and reopening the document: construct an entirely new StyleRegistry over the same, now-mutated package.
    const second = StyleRegistry.forPart(pkg, 'content.xml');
    expect(second.names()).toContain(mintedName);
    expect(second.intern(CENTER_PARAGRAPH)).toBe(mintedName);

    // And a third cycle, for good measure -- this has to keep working, not just work once.
    const third = StyleRegistry.forPart(pkg, 'content.xml');
    expect(third.intern(CENTER_PARAGRAPH)).toBe(mintedName);
    expect(automaticStylesOf(pkg, 'content.xml').children).toHaveLength(1);
  });

  it('skips non-element children and a style:style missing style:name/style:family/a recognised family, without erroring, during adoption', () => {
    const goodStyle = el('style:style', { 'style:name': 'T1', 'style:family': 'text' }, [el('style:text-properties', { 'fo:font-weight': 'bold' })]);
    const noName = el('style:style', { 'style:family': 'text' });
    const noFamily = el('style:style', { 'style:name': 'T2' });
    const unrecognisedFamily = el('style:style', { 'style:name': 'T3', 'style:family': 'ruby' }); // a real ODF family this registry does not manage
    const pkg = contentPackage([
      el('office:automatic-styles', {}, [txt('\n  '), goodStyle, noName, noFamily, unrecognisedFamily]),
    ]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    expect(registry.names()).toEqual(['T1']);
    expect(registry.intern({ properties: { bold: true }, family: 'text' })).toBe('T1');
  });

  it('when two adopted styles coincidentally share an identical fingerprint, the first one in document order wins the fingerprint match, deterministically', () => {
    const first = el('style:style', { 'style:name': 'T1', 'style:family': 'text' }, [el('style:text-properties', { 'fo:font-weight': 'bold' })]);
    const second = el('style:style', { 'style:name': 'T2', 'style:family': 'text' }, [el('style:text-properties', { 'fo:font-weight': 'bold' })]);
    const pkg = contentPackage([el('office:automatic-styles', {}, [first, second])]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    expect(registry.intern(BOLD)).toBe('T1');
  });

  it('gracefully ignores an otherPart reference whose part does not exist (or is not XML) in the given package, rather than erroring', () => {
    const pkg = contentPackage();
    const registryMissing = StyleRegistry.forPart(pkg, 'content.xml', { otherPart: { pkg, partPath: 'styles.xml' } });
    expect(registryMissing.intern(CENTER_PARAGRAPH)).toBe('P1');

    pkg.parts['styles.xml'] = { kind: 'binary', base64: '' };
    const registryBinary = StyleRegistry.forPart(contentPackage(), 'content.xml', { otherPart: { pkg, partPath: 'styles.xml' } });
    expect(registryBinary.intern(CENTER_PARAGRAPH)).toBe('P1');
  });

  it('adopts styles.xml\'s own automatic-styles when constructed for styles.xml', () => {
    const existing = el('style:style', { 'style:name': 'PS3', 'style:family': 'paragraph' }, [el('style:paragraph-properties', { 'fo:text-align': 'right' })]);
    const pkg = stylesPackage([el('office:automatic-styles', {}, [existing])]);
    const registry = StyleRegistry.forPart(pkg, 'styles.xml');
    expect(registry.intern({ properties: { alignment: 'right' }, family: 'paragraph' })).toBe('PS3');
  });
});

describe('rule (b): unknown attributes opt a style out of reuse, not out of existence', () => {
  it('reserves the name of an adopted style with an unmodelled attribute, but mints a genuinely different name for a matching intern() request', () => {
    // fo:margin-right is real, valid ODF -- and entirely unmodelled by properties.ts.
    const unmodelled = el('style:style', { 'style:name': 'P1', 'style:family': 'paragraph' }, [
      el('style:paragraph-properties', { 'fo:text-align': 'center', 'fo:margin-right': '2cm' }),
    ]);
    const pkg = contentPackage([el('office:automatic-styles', {}, [unmodelled])]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');

    expect(registry.names()).toContain('P1');

    // A request whose properties match everything parseable on P1 (alignment: center) must NOT reuse P1's name -- P1's fingerprint was never registered, precisely because of the unmodelled fo:margin-right.
    const mintedName = registry.intern(CENTER_PARAGRAPH);
    expect(mintedName).not.toBe('P1');
    expect(mintedName).toBe('P2'); // "P1" is reserved, so minting skips straight to "P2".

    const automaticStyles = automaticStylesOf(pkg, 'content.xml');
    expect(automaticStyles.children).toHaveLength(2);
    const names = automaticStyles.children.map((c) => (c.type === 'element' ? c.attributes.find((a) => a.name === 'style:name')?.value : undefined));
    expect(names).toEqual(['P1', 'P2']);
  });

  it('never re-mints the reserved name itself, even across many intern() calls for the same family', () => {
    const unmodelled = el('style:style', { 'style:name': 'P1', 'style:family': 'paragraph' }, [
      el('style:paragraph-properties', { 'fo:text-align': 'left', 'style:auto-text-indent': 'false' }),
    ]);
    const pkg = contentPackage([el('office:automatic-styles', {}, [unmodelled])]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');

    const names = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      names.add(registry.intern({ properties: { indentFirstLinePt: i + 1 }, family: 'paragraph' }));
    }
    expect(names.has('P1')).toBe(false);
    expect([...names].sort()).toEqual(['P2', 'P3', 'P4', 'P5', 'P6']);
  });
});

describe('rule (c): fingerprint includes parentStyleName, kept separate from properties', () => {
  it('two requests with identical properties but different parentStyleName never reuse each other\'s style', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const a = registry.intern({ properties: { alignment: 'center' }, family: 'paragraph', parentStyleName: 'Standard' });
    const b = registry.intern({ properties: { alignment: 'center' }, family: 'paragraph', parentStyleName: 'Text_20_body' });
    const c = registry.intern({ properties: { alignment: 'center' }, family: 'paragraph' }); // no parent at all
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('fingerprint() reflects the parentStyleName distinction directly, without needing intern()', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const withParent = registry.fingerprint({ properties: { bold: true }, family: 'text', parentStyleName: 'Standard' });
    const withoutParent = registry.fingerprint({ properties: { bold: true }, family: 'text' });
    expect(withParent).not.toBe(withoutParent);
  });

  it('two requests with identical properties and parentStyleName but different families never reuse each other\'s style', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const paragraphFp = registry.fingerprint({ properties: {}, family: 'paragraph' });
    const textFp = registry.fingerprint({ properties: {}, family: 'text' });
    expect(paragraphFp).not.toBe(textFp);
  });

  it('reusing the same (properties, family, parentStyleName) triple returns the same name every time', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const request: InternRequest = { properties: { italic: true }, family: 'text', parentStyleName: 'Standard' };
    const first = registry.intern(request);
    const second = registry.intern({ ...request, properties: { ...request.properties } });
    expect(second).toBe(first);
  });
});

describe('rule (d): name minting is collision-checked across all four containers', () => {
  it('never mints a name already present in this part\'s own office:styles', () => {
    const namedStyle = el('style:style', { 'style:name': 'P1', 'style:family': 'paragraph' });
    const pkg = contentPackage([el('office:styles', {}, [namedStyle]), el('office:automatic-styles')]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    expect(registry.intern(CENTER_PARAGRAPH)).toBe('P2');
  });

  it('never mints a name already present in the other part\'s office:automatic-styles, when given via otherPart', () => {
    const contentPkg = contentPackage();
    const stylesPkg: Package = { parts: { 'styles.xml': { kind: 'xml', nodes: [el('office:document-styles', {}, [el('office:automatic-styles', {}, [el('style:style', { 'style:name': 'P1', 'style:family': 'paragraph' })])])] } } };
    const merged: Package = { parts: { ...contentPkg.parts, ...stylesPkg.parts } };

    const registry = StyleRegistry.forPart(merged, 'content.xml', { otherPart: { pkg: merged, partPath: 'styles.xml' } });
    expect(registry.intern(CENTER_PARAGRAPH)).toBe('P2');
  });

  it('never mints a name already present in the other part\'s office:styles, when given via otherPart', () => {
    const merged: Package = {
      parts: {
        'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:automatic-styles')])] },
        'styles.xml': {
          kind: 'xml',
          nodes: [el('office:document-styles', {}, [el('office:styles', {}, [el('style:style', { 'style:name': 'P1', 'style:family': 'paragraph' })])])],
        },
      },
    };
    const registry = StyleRegistry.forPart(merged, 'content.xml', { otherPart: { pkg: merged, partPath: 'styles.xml' } });
    expect(registry.intern(CENTER_PARAGRAPH)).toBe('P2');
  });

  it('does not treat a name reserved in a DIFFERENT family as blocking that same name in the family actually being minted', () => {
    // "P1" reserved only under style:family="table" must not stop "P1" from being available to the paragraph family, since ODF's own name uniqueness is per-family.
    const otherFamilyName = el('style:style', { 'style:name': 'P1', 'style:family': 'table' });
    const pkg = contentPackage([el('office:automatic-styles', {}, [otherFamilyName])]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    expect(registry.intern(CENTER_PARAGRAPH)).toBe('P1');
  });

  it('skips non-style:style children and entries missing style:name/style:family when scanning office:styles for reservations', () => {
    const namedStyle = el('style:style', { 'style:name': 'P1', 'style:family': 'paragraph' });
    const pageLayout = el('style:page-layout', { 'style:name': 'Mpm1' }); // a real element, but not style:style -- must not crash the scan
    const nameless = el('style:style', { 'style:family': 'paragraph' });
    const pkg = contentPackage([el('office:styles', {}, [txt('\n'), pageLayout, nameless, namedStyle]), el('office:automatic-styles')]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    expect(registry.intern(CENTER_PARAGRAPH)).toBe('P2'); // "P1" reserved by the named style; "Mpm1" and the nameless entry are simply ignored, not reserved anywhere relevant
  });

  it('respects additionalReservedNames regardless of family', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml', { additionalReservedNames: ['P1'] });
    expect(registry.intern(CENTER_PARAGRAPH)).toBe('P2');
  });
});

describe('rule (e): content.xml and styles.xml registries use distinct name-minting prefixes', () => {
  it('minted names never collide between the two registries, even with no cross-part option supplied at all', () => {
    const contentRegistry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const stylesRegistry = StyleRegistry.forPart(stylesPackage(), 'styles.xml');

    const contentNames = new Set<string>();
    const stylesNames = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      contentNames.add(contentRegistry.intern({ properties: { indentFirstLinePt: i }, family: 'paragraph' }));
      stylesNames.add(stylesRegistry.intern({ properties: { indentFirstLinePt: i }, family: 'paragraph' }));
    }

    expect([...contentNames].every((n) => n.startsWith('P') && !n.startsWith('PS'))).toBe(true);
    expect([...stylesNames].every((n) => n.startsWith('PS'))).toBe(true);
    expect([...contentNames].some((n) => stylesNames.has(n))).toBe(false);
  });

  it('every family gets its own distinct prefix pair across the two parts', () => {
    const contentRegistry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const stylesRegistry = StyleRegistry.forPart(stylesPackage(), 'styles.xml');
    const families = ['paragraph', 'text', 'table', 'table-column', 'table-row', 'table-cell', 'graphic'] as const;
    const contentPrefixes = families.map((family) => contentRegistry.intern({ properties: {}, family }).replace(/\d+$/, ''));
    const stylesPrefixes = families.map((family) => stylesRegistry.intern({ properties: {}, family }).replace(/\d+$/, ''));
    expect(new Set([...contentPrefixes, ...stylesPrefixes]).size).toBe(families.length * 2);
  });
});

describe('intern: general behaviour', () => {
  it('actually writes a real style:style element into the part\'s automatic-styles, with a style:parent-style-name when given', () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    const name = registry.intern({ properties: { bold: true }, family: 'text', parentStyleName: 'Standard' });

    const automaticStyles = automaticStylesOf(pkg, 'content.xml');
    expect(automaticStyles.children).toHaveLength(1);
    const styleNode = automaticStyles.children[0]!;
    if (styleNode.type !== 'element') {
      throw new Error('expected an element');
    }
    expect(styleNode.tag).toBe('style:style');
    expect(styleNode.attributes).toEqual([
      { name: 'style:name', value: name },
      { name: 'style:family', value: 'text' },
      { name: 'style:parent-style-name', value: 'Standard' },
    ]);
    expect(styleNode.children).toHaveLength(1);
    expect(styleNode.children[0]).toMatchObject({ tag: 'style:text-properties' });
  });

  it('omits style:parent-style-name entirely when the request has none', () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    registry.intern({ properties: { bold: true }, family: 'text' });
    const styleNode = automaticStylesOf(pkg, 'content.xml').children[0]!;
    if (styleNode.type !== 'element') {
      throw new Error('expected an element');
    }
    expect(styleNode.attributes.some((a) => a.name === 'style:parent-style-name')).toBe(false);
  });

  it('different property bags mint different names', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const a = registry.intern({ properties: { bold: true }, family: 'text' });
    const b = registry.intern({ properties: { italic: true }, family: 'text' });
    expect(a).not.toBe(b);
  });
});

describe('names()', () => {
  it('reflects both adopted and newly minted names, and nothing from an unrelated part', () => {
    const existing = el('style:style', { 'style:name': 'T9', 'style:family': 'text' }, [el('style:text-properties', { 'fo:font-weight': 'bold' })]);
    const pkg = contentPackage([el('office:automatic-styles', {}, [existing])]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    const minted = registry.intern({ properties: { italic: true }, family: 'text' });
    expect(new Set(registry.names())).toEqual(new Set(['T9', minted]));
  });
});

describe('gc()', () => {
  it('is never invoked implicitly: repeated intern() calls never shrink names()', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    registry.intern({ properties: { bold: true }, family: 'text' });
    registry.intern({ properties: { italic: true }, family: 'text' });
    expect(registry.names()).toHaveLength(2);
  });

  it('removes exactly the styles absent from the referenced set, from both names() and the real XML tree, and returns the removed count', () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    const kept = registry.intern({ properties: { bold: true }, family: 'text' });
    const dropped = registry.intern({ properties: { italic: true }, family: 'text' });

    const removed = registry.gc(new Set([kept]));

    expect(removed).toBe(1);
    expect(registry.names()).toEqual([kept]);
    expect(registry.names()).not.toContain(dropped);
    const automaticStyles = automaticStylesOf(pkg, 'content.xml');
    expect(automaticStyles.children).toHaveLength(1);
    const survivor = automaticStyles.children[0]!;
    if (survivor.type !== 'element') {
      throw new Error('expected an element');
    }
    expect(styleNameOf(survivor)).toBe(kept);
  });

  it('a gc\'d name is never re-minted, even though it is no longer in names()', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const first = registry.intern({ properties: { bold: true }, family: 'text' });
    expect(first).toBe('T1');
    registry.gc(new Set());
    expect(registry.names()).toEqual([]);

    const next = registry.intern({ properties: { italic: true }, family: 'text' });
    expect(next).toBe('T2'); // not "T1" again
  });

  it('removes an adopted style that was never fingerprint-matchable (unmodelled attribute), which has no fingerprint entry to clean up', () => {
    const unmodelled = el('style:style', { 'style:name': 'P1', 'style:family': 'paragraph' }, [
      el('style:paragraph-properties', { 'fo:margin-right': '2cm' }),
    ]);
    const pkg = contentPackage([el('office:automatic-styles', {}, [unmodelled])]);
    const registry = StyleRegistry.forPart(pkg, 'content.xml');
    expect(registry.names()).toEqual(['P1']);

    const removed = registry.gc(new Set());
    expect(removed).toBe(1);
    expect(registry.names()).toEqual([]);
    expect(automaticStylesOf(pkg, 'content.xml').children).toEqual([]);
  });

  it('returns 0 and changes nothing when every known style is referenced', () => {
    const registry = StyleRegistry.forPart(contentPackage(), 'content.xml');
    const name = registry.intern({ properties: { bold: true }, family: 'text' });
    expect(registry.gc(new Set([name]))).toBe(0);
    expect(registry.names()).toEqual([name]);
  });
});
