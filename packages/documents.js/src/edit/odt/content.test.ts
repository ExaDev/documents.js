import { describe, expect, it } from 'vitest';
import type { ContentDocument } from '../../model/content';
import { buildOdtPackage } from './content';
import { OdtEditor } from './editor';

function wordDoc(sections: Extract<ContentDocument, { kind: 'wordprocessing' }>['sections']): ContentDocument {
  return { kind: 'wordprocessing', formatVersion: 1, metadata: {}, sections };
}

describe('buildOdtPackage', () => {
  it('throws for a presentation ContentDocument', () => {
    expect(() => buildOdtPackage({ kind: 'presentation', formatVersion: 1, metadata: {}, slides: [] })).toThrow(/wordprocessing/);
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
    const editor = new OdtEditor(buildOdtPackage(content));
    const [paragraph] = editor.paragraphs();
    expect(paragraph?.text).toBe('Bold red plain');
    expect(paragraph?.alignment).toBe('center');
    const runs = paragraph!.runs();
    expect(runs[0]).toMatchObject({ text: 'Bold red ', bold: true, color: { r: 1, g: 0, b: 0 } });
    expect(runs[1]).toMatchObject({ text: 'plain', fontFamily: 'Georgia', sizePt: 14 });
  });

  it('inserts a real text:tab element for a run whose text is exactly a tab character', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'paragraph', runs: [{ text: 'Left' }, { text: '\t' }, { text: 'Right' }] }],
      },
    ]);
    const editor = new OdtEditor(buildOdtPackage(content));
    const [paragraph] = editor.paragraphs();
    // runs() only surfaces text:span children, and the tab was written as a bare text:tab (not wrapped in a span) -- so paragraph.text (which does see it, via decodeOdfText) carries the tab, but runs() shows only the two real spans.
    expect(paragraph!.runs().map((r) => r.text)).toEqual(['Left', 'Right']);
    expect(paragraph!.text).toBe('Left\tRight');
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
    const editor = new OdtEditor(buildOdtPackage(content));
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
    const editor = new OdtEditor(buildOdtPackage(content));
    const [table] = editor.tables();
    const rows = table!.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells()).toHaveLength(2);
    expect(rows[0]!.cells()[0]!.text).toBe('A1');
    expect(rows[1]!.cells()[1]!.text).toBe('B2');
  });

  it('skips image blocks (documented gap: odf.js readOdt does not read them back)', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          { kind: 'paragraph', runs: [{ text: 'Before' }] },
          { kind: 'image', format: 'png', base64: 'AAAA', widthPt: 100, heightPt: 50 },
          { kind: 'paragraph', runs: [{ text: 'After' }] },
        ],
      },
    ]);
    expect(() => buildOdtPackage(content)).not.toThrow();
    const editor = new OdtEditor(buildOdtPackage(content));
    expect(editor.paragraphs().map((p) => p.text)).toEqual(['Before', 'After']);
  });
});
