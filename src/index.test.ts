import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { buildXlsxPackage, decodeDocumentPackage, decodePackage, encodeDocumentPackage, encodePackage, odsToXlsx, readXlsxContent } from './index';
import { richOdsBytes } from './test-support/ods';

describe('index (placeholder re-exports)', () => {
  it('re-exports ooxml.js decodePackage/encodePackage', () => {
    expect(typeof decodePackage).toBe('function');
    expect(typeof encodePackage).toBe('function');
  });
});

// readXlsxContent/buildXlsxPackage are ooxml.js's own spreadsheet ContentDocument read/build pair, re-exported directly from this package's public surface (src/index.ts) -- xlsx previously had no standalone content-read entry point of its own, unlike every other DocumentFormat. These tests exercise the re-export itself: both functions are called exactly as a real consumer of the 'documents.js' package would, through the public barrel, never by reaching into './ooxml/xlsx/*' or importing 'ooxml.js' directly.
describe('readXlsxContent / buildXlsxPackage re-export', () => {
  it('reads a real xlsx fixture -- genuine OOXML bytes produced by the ods -> xlsx bridge, not a hand-built mock -- into a spreadsheet ContentDocument', () => {
    const xlsxBytes = odsToXlsx(richOdsBytes());

    const content = readXlsxContent(decodeDocumentPackage('xlsx', xlsxBytes));

    expect(content.kind).toBe('spreadsheet');
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const sheet = content.sheets[0];
    const cellAt = (row: number, column: number) => sheet?.cells.find((cell) => cell.row === row && cell.column === column);
    // Known cells from the rich ODS fixture (src/test-support/ods.ts), carried through the real ods -> xlsx bridge -- proving the re-exported reader recovers real content, not just an empty shell.
    expect(cellAt(1, 0)?.value).toEqual({ kind: 'string', value: 'Widget' });
    expect(cellAt(1, 1)?.value).toEqual({ kind: 'number', value: 42.5 });
    expect(cellAt(1, 2)?.value).toEqual({ kind: 'boolean', value: true });
  });

  it('builds real xlsx bytes from a spreadsheet ContentDocument and reads its own content back through the same re-export', () => {
    const document: ContentDocument = {
      kind: 'spreadsheet',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      sheets: [
        {
          name: 'Sheet1',
          images: [],
          columns: [],
          rows: [],
          printSettings: { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
          cells: [
            { row: 0, column: 0, value: { kind: 'string', value: 'Round trip' }, displayText: 'Round trip' },
            { row: 0, column: 1, value: { kind: 'number', value: 7 }, formula: 'A1', displayText: '7' },
          ],
        },
      ],
    };

    const bytes = encodeDocumentPackage('xlsx', buildXlsxPackage(document));
    const roundTripped = readXlsxContent(decodeDocumentPackage('xlsx', bytes));

    expect(roundTripped.kind).toBe('spreadsheet');
    if (roundTripped.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const sheet = roundTripped.sheets[0];
    expect(sheet?.cells.find((cell) => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: 'string', value: 'Round trip' });
    const formulaCell = sheet?.cells.find((cell) => cell.row === 0 && cell.column === 1);
    expect(formulaCell?.formula).toBe('A1');
    expect(formulaCell?.value).toEqual({ kind: 'number', value: 7 });
  });
});
