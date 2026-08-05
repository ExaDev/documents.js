import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { buildOdtPackage } from '../edit/odt/content';
import { buildDocxPackage } from '../edit/docx/content';

function docWithHyperlink(): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sections: [{
      pageSize: { widthPt: 612, heightPt: 792 },
      margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
      blocks: [
        { kind: 'paragraph', runs: [{ text: 'Visit ', hyperlink: 'https://example.org' }] },
      ],
    }],
  };
}

describe('hyperlink write: odt text:a', () => {
  it('buildOdtPackage wraps a hyperlinked run in text:a xlink:href', () => {
    const pkg = buildOdtPackage(docWithHyperlink());
    const contentPart = pkg.parts['content.xml'];
    expect(contentPart?.kind).toBe('xml');
    const xml = JSON.stringify(contentPart);
    expect(xml).toContain('text:a');
    expect(xml).toContain('https://example.org');
    expect(xml).toContain('xlink:type');
  });
});

describe('hyperlink write: docx w:hyperlink', () => {
  it('buildDocxPackage wraps a hyperlinked run in w:hyperlink with an external relationship', () => {
    const pkg = buildDocxPackage(docWithHyperlink());
    const docPart = pkg.parts['word/document.xml'];
    expect(docPart?.kind).toBe('xml');
    const docXml = JSON.stringify(docPart);
    expect(docXml).toContain('w:hyperlink');
    // The relationship exists in document.xml.rels targeting the URL with TargetMode External.
    const rels = pkg.parts['word/_rels/document.xml.rels'];
    expect(rels?.kind).toBe('xml');
    const relsXml = JSON.stringify(rels);
    expect(relsXml).toContain('https://example.org');
    expect(relsXml).toContain('TargetMode');
  });
});
