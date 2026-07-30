import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from 'ooxml.js';
import type { ContentDocument } from '../../model/content';
import { buildDocxPackage } from './content';
import { DocxEditor } from './editor';

function wordDoc(sections: Extract<ContentDocument, { kind: 'wordprocessing' }>['sections']): ContentDocument {
  return { kind: 'wordprocessing', formatVersion: 1, metadata: {}, sections };
}

describe('buildDocxPackage', () => {
  it('throws for a presentation ContentDocument', () => {
    expect(() => buildDocxPackage({ kind: 'presentation', formatVersion: 1, metadata: {}, slides: [] })).toThrow(/wordprocessing/);
  });

  it('builds a paragraph with styled runs', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'paragraph',
            alignment: 'center',
            runs: [
              { text: 'Bold red ', bold: true, color: { r: 1, g: 0, b: 0 } },
              { text: 'plain', fontFamily: 'Georgia', sizePt: 14 },
            ],
          },
        ],
      },
    ]);
    const editor = new DocxEditor(buildDocxPackage(content));
    const [paragraph] = editor.paragraphs();
    expect(paragraph?.text).toBe('Bold red plain');
    expect(paragraph?.alignment).toBe('center');
    const runs = paragraph!.runs();
    expect(runs[0]).toMatchObject({ text: 'Bold red ', bold: true, color: { r: 1, g: 0, b: 0 } });
    expect(runs[1]).toMatchObject({ text: 'plain', fontFamily: 'Georgia', sizePt: 14 });
  });

  it('inserts a real w:tab element for a run whose text is exactly a tab character', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'paragraph', runs: [{ text: 'Left' }, { text: '\t' }, { text: 'Right' }] }],
      },
    ]);
    const editor = new DocxEditor(buildDocxPackage(content));
    const [paragraph] = editor.paragraphs();
    // runs() matches every w:r regardless of content, so the tab's own w:r (holding a bare w:tab, no w:t) still appears -- as an empty-text run between the two real ones.
    expect(paragraph!.runs().map((r) => r.text)).toEqual(['Left', '', 'Right']);
    expect(paragraph!.text).toBe('LeftRight'); // textContent has no WordprocessingML-specific knowledge of w:tab, so it contributes no characters
  });

  it('inserts an image block as media, referenced from its own paragraph', () => {
    const pngBytes = new Uint8Array([1, 2, 3, 4]);
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'image', format: 'png', base64: bytesToBase64(pngBytes), widthPt: 100, heightPt: 50 }],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) => p.startsWith('word/media/'));
    expect(mediaParts).toHaveLength(1);
  });

  it('inserts a page break between sections', () => {
    const content: ContentDocument = {
      kind: 'wordprocessing',
      formatVersion: 1,
      metadata: {},
      sections: [
        { pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, blocks: [{ kind: 'paragraph', runs: [{ text: 'Section one' }] }] },
        { pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, blocks: [{ kind: 'paragraph', runs: [{ text: 'Section two' }] }] },
      ],
    };
    const editor = new DocxEditor(buildDocxPackage(content));
    const paragraphTexts = editor.paragraphs().map((p) => p.text);
    expect(paragraphTexts).toContain('Section one');
    expect(paragraphTexts).toContain('Section two');
  });

  it('builds a table with the right row/column count and cell text', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [100, 100],
            rows: [
              { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A1' }] }] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B1' }] }] }] },
              { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A2' }] }] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B2' }] }] }] },
            ],
          },
        ],
      },
    ]);
    const editor = new DocxEditor(buildDocxPackage(content));
    const [table] = editor.tables();
    const rows = table!.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells()).toHaveLength(2);
    expect(rows[0]!.cells()[0]!.text).toBe('A1');
    expect(rows[1]!.cells()[1]!.text).toBe('B2');
  });
});
