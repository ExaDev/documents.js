import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { childrenWithTag } from '../../xml/query';
import { findStyleElement, resolveStyle, resolveStyleElementChain } from './cascade';

function contentPackage(automaticStyleChildren: XmlNode[] = []): Package['parts'][string] {
  return { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:automatic-styles', {}, automaticStyleChildren)])] };
}

function stylesPackage(officeStylesChildren: XmlElement[] = [], automaticStyleChildren: XmlElement[] = []): Package['parts'][string] {
  const children: XmlElement[] = [el('office:styles', {}, officeStylesChildren)];
  if (automaticStyleChildren.length > 0) {
    children.push(el('office:automatic-styles', {}, automaticStyleChildren));
  }
  return { kind: 'xml', nodes: [el('office:document-styles', {}, children)] };
}

function styleStyle(name: string, family: string, extra: Record<string, string>, children: XmlElement[] = []): XmlElement {
  return el('style:style', { 'style:name': name, 'style:family': family, ...extra }, children);
}

function textProps(attrs: Record<string, string>): XmlElement {
  return el('style:text-properties', attrs);
}

function paragraphProps(attrs: Record<string, string>): XmlElement {
  return el('style:paragraph-properties', attrs);
}

describe('resolveStyle: no styleName', () => {
  it('resolves to an empty bag when there is no default-style and no styleName', () => {
    const pkg: Package = { parts: {} };
    expect(resolveStyle(undefined, 'paragraph', pkg)).toEqual({ properties: {}, diagnostics: [] });
  });

  it('resolves to just the family default-style when styleName is undefined -- a bare, unstyled element is ordinary valid ODF, not a diagnostic', () => {
    const defaultStyle = el('style:default-style', { 'style:family': 'paragraph' }, [textProps({ 'fo:font-weight': 'bold' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([defaultStyle]) } };
    expect(resolveStyle(undefined, 'paragraph', pkg)).toEqual({ properties: { bold: true }, diagnostics: [] });
  });

  it('does not apply a default-style from a DIFFERENT family', () => {
    const defaultStyle = el('style:default-style', { 'style:family': 'text' }, [textProps({ 'fo:font-weight': 'bold' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([defaultStyle]) } };
    expect(resolveStyle(undefined, 'paragraph', pkg)).toEqual({ properties: {}, diagnostics: [] });
  });
});

describe('resolveStyle: single-layer resolution (no parent chain)', () => {
  it('overrides default-style with the referenced automatic style\'s own properties (content.xml only)', () => {
    const defaultStyle = el('style:default-style', { 'style:family': 'paragraph' }, [paragraphProps({ 'fo:text-align': 'left' })]);
    const p1 = styleStyle('P1', 'paragraph', {}, [paragraphProps({ 'fo:text-align': 'center' })]);
    const pkg: Package = {
      parts: {
        'content.xml': contentPackage([p1]),
        'styles.xml': stylesPackage([defaultStyle]),
      },
    };
    expect(resolveStyle('P1', 'paragraph', pkg)).toEqual({ properties: { alignment: 'center' }, diagnostics: [] });
  });

  it('merges default-style and the referenced style field-by-field, referenced style winning on overlap', () => {
    const defaultStyle = el('style:default-style', { 'style:family': 'text' }, [textProps({ 'fo:font-weight': 'bold', 'fo:font-size': '12pt' })]);
    const t1 = styleStyle('T1', 'text', {}, [textProps({ 'fo:font-size': '18pt' })]);
    const pkg: Package = {
      parts: {
        'content.xml': contentPackage([t1]),
        'styles.xml': stylesPackage([defaultStyle]),
      },
    };
    expect(resolveStyle('T1', 'text', pkg)).toEqual({ properties: { bold: true, sizePt: 18 }, diagnostics: [] });
  });
});

describe('resolveStyle: parent chain, root-first application', () => {
  it('applies a two-level chain (content.xml automatic style -> styles.xml named style) root-first, target last', () => {
    // Standard (root, no parent) -> Text_20_body (parent: Standard) -> P1 (parent: Text_20_body, automatic in content.xml).
    const standard = styleStyle('Standard', 'paragraph', {}, [textProps({ 'fo:font-weight': 'normal' })]);
    const textBody = styleStyle('Text_20_body', 'paragraph', { 'style:parent-style-name': 'Standard' }, [
      paragraphProps({ 'fo:margin-bottom': '6pt' }),
    ]);
    const p1 = styleStyle('P1', 'paragraph', { 'style:parent-style-name': 'Text_20_body' }, [paragraphProps({ 'fo:text-align': 'right' })]);
    const pkg: Package = {
      parts: {
        'content.xml': contentPackage([p1]),
        'styles.xml': stylesPackage([standard, textBody]),
      },
    };
    expect(resolveStyle('P1', 'paragraph', pkg)).toEqual({
      properties: { bold: false, spacingAfterPt: 6, alignment: 'right' },
      diagnostics: [],
    });
  });

  it('lets the most specific ancestor in the chain override an earlier, less specific one on the same field', () => {
    const grandparent = styleStyle('GP', 'text', {}, [textProps({ 'fo:font-size': '10pt' })]);
    const parent = styleStyle('P', 'text', { 'style:parent-style-name': 'GP' }, [textProps({ 'fo:font-size': '12pt' })]);
    const child = styleStyle('C', 'text', { 'style:parent-style-name': 'P' }, []);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([grandparent, parent, child]) } };
    expect(resolveStyle('C', 'text', pkg)).toEqual({ properties: { sizePt: 12 }, diagnostics: [] });
  });

  it('applies no fourth "direct formatting" layer -- the referenced style\'s own properties are the final word, exactly as parsed', () => {
    const parent = styleStyle('P', 'paragraph', {}, [paragraphProps({ 'fo:text-align': 'left' })]);
    const child = styleStyle('C', 'paragraph', { 'style:parent-style-name': 'P' }, [paragraphProps({ 'fo:text-align': 'right' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([parent, child]) } };
    expect(resolveStyle('C', 'paragraph', pkg).properties.alignment).toBe('right');
  });
});

describe('resolveStyle: cycle guard', () => {
  it('detects a direct two-style cycle (A -> B -> A), breaks it, and reports a warning diagnostic instead of throwing or hanging', () => {
    const a = styleStyle('A', 'paragraph', { 'style:parent-style-name': 'B' }, [paragraphProps({ 'fo:text-align': 'left' })]);
    const b = styleStyle('B', 'paragraph', { 'style:parent-style-name': 'A' }, [paragraphProps({ 'fo:text-align': 'right' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([a, b]) } };

    const result = resolveStyle('A', 'paragraph', pkg);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.diagnostics[0]?.message).toMatch(/cyclic/i);
    // Both A and B were visited before the cycle was detected, so both still contributed their properties -- but A (the originally-requested target) is still applied LAST in the merge, since the walk collects target-to-root (A, then its parent B) and reverses before applying, exactly as the non-cyclic case does. A's own alignment ("left") is therefore still the final, most-specific value, not B's.
    expect(result.properties.alignment).toBe('left');
  });

  it('detects a self-referential style (A -> A) as a cycle of length one', () => {
    const a = styleStyle('A', 'text', { 'style:parent-style-name': 'A' }, [textProps({ 'fo:font-weight': 'bold' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([a]) } };

    const result = resolveStyle('A', 'text', pkg);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.properties.bold).toBe(true);
  });

  it('does not falsely flag a long but genuinely acyclic chain', () => {
    const root = styleStyle('L0', 'text', {}, [textProps({ 'fo:font-weight': 'normal' })]);
    const l1 = styleStyle('L1', 'text', { 'style:parent-style-name': 'L0' }, []);
    const l2 = styleStyle('L2', 'text', { 'style:parent-style-name': 'L1' }, []);
    const l3 = styleStyle('L3', 'text', { 'style:parent-style-name': 'L2' }, [textProps({ 'fo:font-style': 'italic' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([root, l1, l2, l3]) } };

    const result = resolveStyle('L3', 'text', pkg);

    expect(result.diagnostics).toEqual([]);
    expect(result.properties).toEqual({ bold: false, italic: true });
  });
});

describe('resolveStyle: missing style', () => {
  it('reports a warning diagnostic and stops when the referenced styleName does not exist anywhere', () => {
    const pkg: Package = { parts: {} };
    const result = resolveStyle('Ghost', 'paragraph', pkg);
    expect(result.properties).toEqual({});
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.diagnostics[0]?.message).toMatch(/not found/i);
  });

  it('reports a warning and stops when an ANCESTOR further up an otherwise-valid chain is missing, but still applies what was found before that point', () => {
    const child = styleStyle('C', 'paragraph', { 'style:parent-style-name': 'GhostParent' }, [paragraphProps({ 'fo:text-align': 'center' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([child]) } };

    const result = resolveStyle('C', 'paragraph', pkg);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toMatch(/GhostParent/);
    expect(result.properties.alignment).toBe('center');
  });
});

describe('resolveStyle: cross-part resolution', () => {
  it('resolves a parent-style-name reference that crosses from content.xml into styles.xml', () => {
    const namedParent = styleStyle('Heading', 'paragraph', {}, [textProps({ 'fo:font-weight': 'bold' })]);
    const automaticChild = styleStyle('P5', 'paragraph', { 'style:parent-style-name': 'Heading' }, [paragraphProps({ 'fo:text-align': 'center' })]);
    const pkg: Package = {
      parts: {
        'content.xml': contentPackage([automaticChild]),
        'styles.xml': stylesPackage([namedParent]),
      },
    };
    expect(resolveStyle('P5', 'paragraph', pkg)).toEqual({ properties: { bold: true, alignment: 'center' }, diagnostics: [] });
  });

  it('does not let a same-name, different-family style collide -- family scoping is respected during lookup', () => {
    const paragraphNamed = styleStyle('Shared', 'paragraph', {}, [paragraphProps({ 'fo:text-align': 'left' })]);
    const tableNamed = styleStyle('Shared', 'table-cell', {}, [textProps({ 'fo:font-weight': 'bold' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([paragraphNamed, tableNamed]) } };
    expect(resolveStyle('Shared', 'paragraph', pkg)).toEqual({ properties: { alignment: 'left' }, diagnostics: [] });
  });
});

describe('resolveStyle: missing parts', () => {
  it('returns an empty result with no diagnostics when neither content.xml nor styles.xml exist and styleName is undefined', () => {
    expect(resolveStyle(undefined, 'graphic', { parts: {} })).toEqual({ properties: {}, diagnostics: [] });
  });

  it('ignores a non-XML content.xml/styles.xml part rather than throwing', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'binary', base64: '' }, 'styles.xml': { kind: 'binary', base64: '' } } };
    expect(resolveStyle(undefined, 'paragraph', pkg)).toEqual({ properties: {}, diagnostics: [] });
  });

  it('ignores an XML part with no root element at all (e.g. an empty node list)', () => {
    const pkg: Package = { parts: { 'styles.xml': { kind: 'xml', nodes: [] } } };
    expect(resolveStyle(undefined, 'paragraph', pkg)).toEqual({ properties: {}, diagnostics: [] });
  });
});

describe('resolveStyle: malformed style entries during collection', () => {
  it('ignores a style:style missing style:name, missing style:family, or carrying an unrecognised family, without throwing', () => {
    const noName = el('style:style', { 'style:family': 'paragraph' }, [paragraphProps({ 'fo:text-align': 'left' })]);
    const noFamily = el('style:style', { 'style:name': 'NoFamily' }, [paragraphProps({ 'fo:text-align': 'left' })]);
    const badFamily = styleStyle('BadFamily', 'not-a-real-family', {}, [paragraphProps({ 'fo:text-align': 'left' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([noName, noFamily, badFamily]) } };

    // None of the three malformed entries ever get indexed under any real family -- looking any of their names up under a real family finds nothing, rather than throwing on the malformed attribute.
    expect(resolveStyle('NoFamily', 'paragraph', pkg).diagnostics[0]?.message).toMatch(/not found/i);
    expect(resolveStyle('BadFamily', 'paragraph', pkg).diagnostics[0]?.message).toMatch(/not found/i);
  });

  it('ignores a style:default-style missing style:family or carrying an unrecognised family, without throwing', () => {
    const noFamily = el('style:default-style', {}, [paragraphProps({ 'fo:text-align': 'left' })]);
    const badFamily = el('style:default-style', { 'style:family': 'not-a-real-family' }, [paragraphProps({ 'fo:text-align': 'left' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([noFamily, badFamily]) } };
    expect(resolveStyle(undefined, 'paragraph', pkg)).toEqual({ properties: {}, diagnostics: [] });
  });

  it('skips a non-element child (e.g. formatting whitespace between style:style elements) while collecting styles', () => {
    const p1 = styleStyle('P1', 'paragraph', {}, [paragraphProps({ 'fo:text-align': 'center' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([txt('\n  '), p1]) } };
    expect(resolveStyle('P1', 'paragraph', pkg)).toEqual({ properties: { alignment: 'center' }, diagnostics: [] });
  });

  it('ignores an element child that is neither style:style nor style:default-style while collecting styles (e.g. text:notes-configuration, a real office:styles sibling)', () => {
    const p1 = styleStyle('P1', 'paragraph', {}, [paragraphProps({ 'fo:text-align': 'center' })]);
    const notesConfig = el('text:notes-configuration', { 'text:note-class': 'footnote' });
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([p1, notesConfig]) } };
    expect(resolveStyle('P1', 'paragraph', pkg)).toEqual({ properties: { alignment: 'center' }, diagnostics: [] });
  });

  it('keeps the FIRST style:default-style for a family when a (malformed) document has more than one, ignoring the rest', () => {
    const first = el('style:default-style', { 'style:family': 'paragraph' }, [paragraphProps({ 'fo:text-align': 'left' })]);
    const second = el('style:default-style', { 'style:family': 'paragraph' }, [paragraphProps({ 'fo:text-align': 'right' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([first, second]) } };
    expect(resolveStyle(undefined, 'paragraph', pkg)).toEqual({ properties: { alignment: 'left' }, diagnostics: [] });
  });
});

describe('resolveStyleElementChain', () => {
  it('returns the same root-first element order resolveStyle folds through, for a caller that needs a property vocabulary StyleProperties does not model', () => {
    const grandparent = styleStyle('GP', 'graphic', {}, [el('style:graphic-properties', { 'fo:padding-left': '0.25cm' })]);
    const parent = styleStyle('P', 'graphic', { 'style:parent-style-name': 'GP' }, [el('style:graphic-properties', { 'fo:padding-top': '0.125cm' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([grandparent, parent]) } };

    const result = resolveStyleElementChain('P', 'graphic', pkg);
    expect(result.diagnostics).toEqual([]);
    expect(result.elements.map((element) => element.attributes.find((a) => a.name === 'style:name')?.value)).toEqual(['GP', 'P']);
  });

  it('returns just the family default-style element when styleName is undefined', () => {
    const defaultStyle = el('style:default-style', { 'style:family': 'graphic' }, [el('style:graphic-properties', { 'fo:padding-left': '0.25cm' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([defaultStyle]) } };
    expect(resolveStyleElementChain(undefined, 'graphic', pkg).elements).toEqual([defaultStyle]);
  });

  it('reports the same cyclic-chain diagnostic resolveStyle itself reports, since resolveStyle is now a thin wrapper over this', () => {
    const a = styleStyle('A', 'graphic', { 'style:parent-style-name': 'B' }, []);
    const b = styleStyle('B', 'graphic', { 'style:parent-style-name': 'A' }, []);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([a, b]) } };
    expect(resolveStyleElementChain('A', 'graphic', pkg).diagnostics[0]?.message).toMatch(/cyclic/i);
  });
});

describe('findStyleElement', () => {
  it('finds a style:style by (name, family) without walking any parent chain', () => {
    const target = styleStyle('ce1', 'table-cell', {}, [el('style:table-cell-properties', { 'fo:background-color': '#ff0000' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([target]) } };
    expect(findStyleElement('ce1', 'table-cell', pkg)).toBe(target);
  });

  it('finds a style defined in styles.xml, not just content.xml', () => {
    const target = styleStyle('co1', 'table-column', {}, [el('style:table-column-properties', { 'style:column-width': '5cm' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([], [target]) } };
    expect(findStyleElement('co1', 'table-column', pkg)).toBe(target);
  });

  it('returns undefined for a name that does not exist under the given family', () => {
    const target = styleStyle('ce1', 'table-cell', {}, []);
    const pkg: Package = { parts: { 'content.xml': contentPackage([target]) } };
    expect(findStyleElement('ce1', 'table-row', pkg)).toBeUndefined();
  });
});

// Sanity check that resolveStyleElementChain's extraction is exercised by exactly one child-element lookup pattern real callers (table.ts, shapes.ts) actually use: reading a specific properties child off each element in the chain.
describe('resolveStyleElementChain: real-world consumption pattern', () => {
  it('lets a caller fold an arbitrary properties child across the whole chain, root-first, later entries overriding earlier ones', () => {
    const standard = styleStyle('standard', 'graphic', {}, [el('style:graphic-properties', { 'fo:padding-left': '0.25cm', 'fo:padding-top': '0.125cm' })]);
    const gr1 = styleStyle('gr1', 'graphic', { 'style:parent-style-name': 'standard' }, [el('style:graphic-properties', { 'fo:padding-top': '0.5cm' })]);
    const pkg: Package = { parts: { 'styles.xml': stylesPackage([standard]), 'content.xml': contentPackage([gr1]) } };

    const { elements } = resolveStyleElementChain('gr1', 'graphic', pkg);
    let paddingLeft: string | undefined;
    let paddingTop: string | undefined;
    for (const element of elements) {
      const props = childrenWithTag(element, 'style:graphic-properties')[0];
      paddingLeft = props?.attributes.find((a) => a.name === 'fo:padding-left')?.value ?? paddingLeft;
      paddingTop = props?.attributes.find((a) => a.name === 'fo:padding-top')?.value ?? paddingTop;
    }
    expect(paddingLeft).toBe('0.25cm'); // inherited from "standard", never overridden by gr1
    expect(paddingTop).toBe('0.5cm'); // gr1's own value wins over "standard"'s
  });
});
