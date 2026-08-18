import { describe, expect, it } from 'vitest';

import type { ContentDocument } from 'document-schema.js';
import type { XmlElement } from 'ooxml.js';
import { attr } from 'ooxml.js';
import { buildDocxPackage } from './content';

function wordprocessingDocWithList(): ContentDocument {
  return {
    kind: 'wordprocessing',
    metadata: {},
    sections: [{
      pageSize: { widthPt: 612, heightPt: 792 },
      margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
      blocks: [
        { kind: 'paragraph', runs: [{ text: 'First item' }], list: { numId: 'list-1', level: 0 } },
        { kind: 'paragraph', runs: [{ text: 'Second item' }], list: { numId: 'list-1', level: 0 } },
        { kind: 'paragraph', runs: [{ text: 'Nested' }], list: { numId: 'list-1', level: 1 } },
        { kind: 'paragraph', runs: [{ text: 'Plain paragraph' }] },
      ],
    }],
  };
}

function findElement(root: XmlElement, tag: string): XmlElement | undefined {
  if (root.tag === tag) { return root; }
  for (const child of root.children) {
    if (child.type === 'element') {
      const found = findElement(child, tag);
      if (found !== undefined) { return found; }
    }
  }
  return undefined;
}

function findAllElements(root: XmlElement, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  if (root.tag === tag) { out.push(root); }
  for (const child of root.children) {
    if (child.type === 'element') {
      out.push(...findAllElements(child, tag));
    }
  }
  return out;
}

describe('buildDocxPackage list numbering synthesis', () => {
  it('creates a word/numbering.xml part with resolving abstractNum/num definitions when the content has list paragraphs', () => {
    const pkg = buildDocxPackage(wordprocessingDocWithList());

    // The numbering part exists.
    const numberingPart = pkg.parts['word/numbering.xml'];
    expect(numberingPart).toBeDefined();
    expect(numberingPart?.kind).toBe('xml');

    // [Content_Types].xml has the numbering override.
    const ct = pkg.parts['[Content_Types].xml'];
    expect(ct?.kind).toBe('xml');
    const ctText = JSON.stringify(ct);
    expect(ctText).toContain('numbering+xml');

    // document.xml.rels has the numbering relationship.
    const rels = pkg.parts['word/_rels/document.xml.rels'];
    expect(rels?.kind).toBe('xml');
    const relsText = JSON.stringify(rels);
    expect(relsText).toContain('relationships/numbering');

    // Every w:numId in document.xml resolves to a w:num in numbering.xml.
    const numberingRoot = numberingPart?.kind === 'xml' ? numberingPart.nodes.find((n): n is XmlElement => n.type === 'element' && n.tag === 'w:numbering') : undefined;
    expect(numberingRoot).toBeDefined();
    if (numberingRoot === undefined) { return; }

    const numElements = findAllElements(numberingRoot, 'w:num');
    const validNumIds = new Set(numElements.map((n) => attr(n, 'w:numId')));
    expect(validNumIds.size).toBeGreaterThan(0);

    const docRoot = pkg.parts['word/document.xml']?.kind === 'xml'
      ? pkg.parts['word/document.xml'].nodes.find((n): n is XmlElement => n.type === 'element' && n.tag === 'w:document')
      : undefined;
    expect(docRoot).toBeDefined();
    if (docRoot === undefined) { return; }

    const numIdElements = findAllElements(docRoot, 'w:numId');
    for (const numIdEl of numIdElements) {
      const val = attr(numIdEl, 'w:val');
      expect(val).toBeDefined();
      expect(validNumIds.has(val)).toBe(true); // every numId in the document resolves
    }

    // The abstractNum has at least level 0 and level 1 (both used by the fixture).
    const abstractNum = findElement(numberingRoot, 'w:abstractNum');
    expect(abstractNum).toBeDefined();
    const levels = findAllElements(abstractNum!, 'w:lvl');
    const levelIndices = levels.map((lvl) => attr(lvl, 'w:ilvl'));
    expect(levelIndices).toContain('0');
    expect(levelIndices).toContain('1');
  });

  it('does NOT create a numbering part when the content has no list paragraphs (byte-identical to today)', () => {
    const doc: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [{
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [{ kind: 'paragraph', runs: [{ text: 'Just text' }] }],
      }],
    };
    const pkg = buildDocxPackage(doc);
    expect(pkg.parts['word/numbering.xml']).toBeUndefined();
  });
});
