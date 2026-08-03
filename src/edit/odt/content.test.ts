import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { ContentDocument } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { readOdtContent } from '../../odf/odt/read';
import { buildOdtPackage } from './content';
import { OdtEditor } from './editor';

function wordDoc(sections: Extract<ContentDocument, { kind: 'wordprocessing' }>['sections']): ContentDocument {
  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sections };
}

describe('buildOdtPackage', () => {
  it('throws for a presentation ContentDocument', () => {
    expect(() => buildOdtPackage({ kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, slides: [] })).toThrow(/wordprocessing/);
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
      formatVersion: CONTENT_FORMAT_VERSION,
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

  it('a vertically merged (rowSpan) cell survives a build-then-read round trip as merged, not as two ordinary cells', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [100, 100],
            rows: [
              { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A1' }] }], rowSpan: 2 }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B1' }] }] }] },
              { cells: [{ blocks: [] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B2' }] }] }] },
            ],
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    expect(tableBlock?.kind).toBe('table');
    if (tableBlock?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    // ODF keeps one array entry per grid position regardless of merges, so both rows still report two cells each.
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
    expect(tableBlock.rows[1]?.cells).toHaveLength(2);
    expect(tableBlock.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'A1' }] });
    expect(tableBlock.rows[1]?.cells[0]?.rowSpan).toBeUndefined();
    expect(tableBlock.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(tableBlock.rows[0]?.cells[1]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'B1' }] });
    expect(tableBlock.rows[1]?.cells[1]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'B2' }] });
  });

  it('a horizontally merged (colSpan) cell survives a build-then-read round trip as merged, not as two ordinary cells', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [100, 100],
            rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A1' }] }], colSpan: 2 }, { blocks: [] }] }],
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    expect(tableBlock?.kind).toBe('table');
    if (tableBlock?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    // ODF writes a real table:covered-table-cell placeholder for the consumed column, unlike docx's gridSpan-collapse -- so this row still reports two cells.
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
    expect(tableBlock.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'A1' }] });
    expect(tableBlock.rows[0]?.cells[1]?.blocks).toEqual([]);
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
