import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { readDrawObjectReference } from './embedded';

// The real shape this reader targets is proven end to end against genuine LibreOffice output in typed/ods/read.test.ts (src/typed/ods/fixtures/sheet-anchors.ods, a real Calc sheet with a real embedded Draw document anchored to a cell). This suite covers the reference-resolution edges that file cannot: a linked (not embedded) object, a broken href, and each representable/unrepresentable body kind.

function subDocumentPart(bodyChild: XmlElement): Package['parts'][string] {
  return { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [bodyChild])])] };
}

function packageWithObject(prefix: string, bodyChild: XmlElement): Package {
  return { parts: { [`${prefix}/content.xml`]: subDocumentPart(bodyChild) } };
}

function objectFrame(href: string): XmlElement {
  return el('draw:frame', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' }, [el('draw:object', { 'xlink:href': href })]);
}

describe('readDrawObjectReference', () => {
  it('resolves the "./Object 1" href real LibreOffice writes into that directory\'s own re-keyed sub-Package', () => {
    const pkg = packageWithObject('Object 1', el('office:drawing', {}, [el('draw:page', { 'draw:name': 'page1' })]));
    const reference = readDrawObjectReference(objectFrame('./Object 1'), pkg);
    expect(reference?.href).toBe('Object 1');
    expect(reference?.objectKind).toBe('drawing');
    expect(Object.keys(reference?.package.parts ?? {})).toEqual(['content.xml']);
  });

  it('resolves each ContentDocument-representable office:body content child to its own objectKind', () => {
    const cases = [
      { bodyChild: el('office:text'), objectKind: 'wordprocessing' },
      { bodyChild: el('office:spreadsheet'), objectKind: 'spreadsheet' },
      { bodyChild: el('office:presentation'), objectKind: 'presentation' },
      { bodyChild: el('office:drawing'), objectKind: 'drawing' },
    ];
    for (const { bodyChild, objectKind } of cases) {
      const reference = readDrawObjectReference(objectFrame('Object 1'), packageWithObject('Object 1', bodyChild));
      expect(reference?.objectKind).toBe(objectKind);
    }
  });

  it('returns undefined for an office:database sub-document -- a .odb front-end is not a ContentDocument at all', () => {
    expect(readDrawObjectReference(objectFrame('Object 1'), packageWithObject('Object 1', el('office:database')))).toBeUndefined();
  });

  it('returns undefined for an embedded FORMULA sub-document: its content.xml root is a bare <math> element with no office:body, and ContentDocument has no MathML-shaped variant to carry it in', () => {
    const pkg: Package = { parts: { 'Object 1/content.xml': { kind: 'xml', nodes: [el('math', {}, [el('semantics', {}, [el('mi', {}, [txt('x')])])])] } } };
    expect(readDrawObjectReference(objectFrame('./Object 1'), pkg)).toBeUndefined();
  });

  it('returns undefined for a frame carrying no draw:object at all', () => {
    const frame = el('draw:frame', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' }, [el('draw:image', { 'xlink:href': 'Pictures/img.png' })]);
    expect(readDrawObjectReference(frame, { parts: {} })).toBeUndefined();
  });

  it('returns undefined for a LINKED object -- an absolute URL, or a path escaping the package root, is content this package genuinely does not hold', () => {
    const pkg = packageWithObject('Object 1', el('office:drawing'));
    expect(readDrawObjectReference(objectFrame('http://example.invalid/chart.odg'), pkg)).toBeUndefined();
    expect(readDrawObjectReference(objectFrame('../sibling.odg'), pkg)).toBeUndefined();
    expect(readDrawObjectReference(objectFrame('/absolute.odg'), pkg)).toBeUndefined();
  });

  it('returns undefined (never throws) for an href naming a directory the package holds no content.xml for', () => {
    expect(readDrawObjectReference(objectFrame('./Object 7'), packageWithObject('Object 1', el('office:drawing')))).toBeUndefined();
  });

  it('tolerates a trailing slash on the href, resolving the same directory', () => {
    const reference = readDrawObjectReference(objectFrame('./Object 1/'), packageWithObject('Object 1', el('office:text')));
    expect(reference?.href).toBe('Object 1');
    expect(reference?.objectKind).toBe('wordprocessing');
  });
});
