import { readOds } from 'odf.js';
import { describe, expect, it } from 'vitest';
import type { ContentDocument } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';
import { buildOdsPackage } from './content';

function spreadsheetDocument(): ContentDocument {
  return {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sheets: [
      {
        name: 'Data',
        images: [],
        columns: [],
        rows: [],
        printSettings: { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
        cells: [
          { row: 0, column: 0, value: { kind: 'string', value: 'Name' }, displayText: 'Name' },
          { row: 0, column: 1, value: { kind: 'number', value: 42 }, displayText: '42' },
          { row: 1, column: 0, value: { kind: 'currency', value: 9.99, currency: 'USD' }, displayText: '$9.99' },
          { row: 1, column: 1, value: { kind: 'string', value: 'formula result' }, formula: 'of:=1+1', displayText: 'formula result' },
          { row: 2, column: 0, value: { kind: 'string', value: 'Merged' }, displayText: 'Merged', colSpan: 2 },
        ],
      },
      {
        name: 'Second',
        images: [],
        columns: [],
        rows: [],
        printSettings: { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
        cells: [{ row: 0, column: 0, value: { kind: 'boolean', value: true }, displayText: 'TRUE' }],
      },
    ],
  };
}

describe('buildOdsPackage', () => {
  it('throws for a non-spreadsheet ContentDocument', () => {
    expect(() => buildOdsPackage({ kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sections: [] })).toThrow(/requires a spreadsheet/);
  });

  it('builds a package that reads back through odf.js\'s own readOds with every sheet, cell value, and formula intact', () => {
    const pkg = buildOdsPackage(spreadsheetDocument());
    const document = readOds(pkg);
    expect(document.sheets.map((s) => s.name)).toEqual(['Data', 'Second']);

    const dataSheet = document.sheets[0]!;
    const byPosition = new Map(dataSheet.cells.map((c) => [`${c.row},${c.column}`, c]));
    expect(byPosition.get('0,0')?.value).toEqual({ kind: 'string', value: 'Name' });
    expect(byPosition.get('0,1')?.value).toEqual({ kind: 'number', value: 42 });
    expect(byPosition.get('1,0')?.value).toEqual({ kind: 'currency', value: 9.99, currency: 'USD' });
    expect(byPosition.get('1,1')?.formula).toBe('of:=1+1');
    expect(byPosition.get('2,0')?.colSpan).toBe(2);
    // The merge's covered position never appears in cells[] at all -- matching readOds's own "nothing to emit for a covered cell" convention.
    expect(byPosition.has('2,1')).toBe(false);

    const secondSheet = document.sheets[1]!;
    expect(secondSheet.cells[0]?.value).toEqual({ kind: 'boolean', value: true });
  });

  it('an empty content.sheets array keeps the scaffold\'s own single default sheet', () => {
    const pkg = buildOdsPackage({ kind: 'spreadsheet', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sheets: [] });
    const document = readOds(pkg);
    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe('Sheet1');
    expect(document.sheets[0]?.cells).toEqual([]);
  });
});
