import { describe, expect, it } from 'vitest';
import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import { CsvInvalidUtf8Error, decodeCsvText, encodeCsvText } from './text';
import { TSV_DELIMITER, parseCsvRecords } from './records';
import { readCsvContent } from './read';
import type { CellTypeInference } from '../layout/cell-typing';
import { buildCsvText } from './write';
import { CsvSheetNotFoundError, CsvSheetNotSpecifiedError, CsvUnsupportedDocumentKindError } from './write';

interface SheetFixture {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

function spreadsheetDocument(sheets: readonly SheetFixture[]): ContentDocument {
  return {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sheets: sheets.map(({ name, rows }) => ({
      name,
      images: [],
      columns: Array.from({ length: rows.reduce((max, row) => Math.max(max, row.length), 0) }, (_unused, index) => ({ index, widthPt: 64 })),
      rows: Array.from({ length: rows.length }, (_unused, index) => ({ index, heightPt: 15 })),
      printSettings: { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
      cells: rows.flatMap((row, rowIndex) => row.map((field, columnIndex) => ({ row: rowIndex, column: columnIndex, value: { kind: 'string' as const, value: field }, displayText: field }))),
    })),
  };
}

describe('readCsvContent', () => {
  it('writes the first record as verbatim string header cells and never re-types them', () => {
    // A header of "007" and "TRUE" -- text that inferCellValue would decline/re-type as data -- must stay a plain verbatim string at row 0, because headers are labels, not data.
    const document = readCsvContent('007,TRUE\n42.5,x\n');
    expect(document.kind).toBe('spreadsheet');
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const [sheet] = document.sheets;
    const cellAt = (row: number, column: number) => sheet?.cells.find((cell) => cell.row === row && cell.column === column);
    expect(cellAt(0, 0)?.value).toEqual({ kind: 'string', value: '007' });
    expect(cellAt(0, 1)?.value).toEqual({ kind: 'string', value: 'TRUE' });
  });

  it('re-types data cells through the shared cell-typing heuristic and declines exactly where it declines', () => {
    // "1,234" arrives as one quoted field, so the grouping-ambiguity decline is genuinely exercised rather than pre-empted by field splitting.
    const document = readCsvContent('h1,h2,h3,h4,h5,h6\n42.5,TRUE,2024-01-15,007,"1,234",plain\n');
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const [sheet] = document.sheets;
    const valueAt = (column: number) => sheet?.cells.find((cell) => cell.row === 1 && cell.column === column)?.value;
    expect(valueAt(0)).toEqual({ kind: 'number', value: 42.5 });
    expect(valueAt(1)).toEqual({ kind: 'boolean', value: true });
    expect(valueAt(2)?.kind).toBe('date');
    // All three declines stay plain strings: a leading-zero part number, a grouping-ambiguous number (the typing heuristic cannot distinguish 1234 from 1.234), and ordinary text.
    expect(valueAt(3)).toEqual({ kind: 'string', value: '007' });
    expect(valueAt(4)).toEqual({ kind: 'string', value: '1,234' });
    expect(valueAt(5)).toEqual({ kind: 'string', value: 'plain' });
  });

  it('carries the raw field text in displayText for every cell, independent of the inferred kind', () => {
    const document = readCsvContent('h1,h2\n42.5,007\n');
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    for (const cell of document.sheets[0]!.cells) {
      expect(cell.displayText).toBe(cell.row === 0 ? (cell.column === 0 ? 'h1' : 'h2') : cell.column === 0 ? '42.5' : '007');
    }
  });

  it('maps an empty data field to the empty cell and pads a short record to the grid width with empty cells', () => {
    // Row 2 has one field where the grid is three wide: columns 1 and 2 are genuine empty cells, not holes.
    const document = readCsvContent('a,b,c\n1,,3\nsolo\n');
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const [sheet] = document.sheets;
    const valueAt = (row: number, column: number) => sheet?.cells.find((cell) => cell.row === row && cell.column === column)?.value;
    expect(valueAt(1, 1)).toEqual({ kind: 'empty' });
    expect(valueAt(2, 0)).toEqual({ kind: 'string', value: 'solo' });
    expect(valueAt(2, 1)).toEqual({ kind: 'empty' });
    expect(valueAt(2, 2)).toEqual({ kind: 'empty' });
  });

  it('names the lone sheet Sheet1 and emits exactly one sheet, since a csv file is one table by construction', () => {
    const document = readCsvContent('a,b\n1,2\n');
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe('Sheet1');
  });

  it('parses with the TSV delimiter when asked', () => {
    const document = readCsvContent('a,b\t42.5\n', { delimiter: TSV_DELIMITER });
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const [sheet] = document.sheets;
    expect(sheet?.cells.find((cell) => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: 'string', value: 'a,b' });
    expect(sheet?.cells.find((cell) => cell.row === 0 && cell.column === 1)?.value).toEqual({ kind: 'string', value: '42.5' });
  });

  it('fires onCellTypeInference exactly where inferCellValue reaches a decision, never for header cells or no-candidate text', () => {
    const events: CellTypeInference[] = [];
    readCsvContent('h1,h2\n007,42.5\nYes,x\n', { onCellTypeInference: (event) => events.push(event) });
    // Header cells are never re-typed, so the header's own "007" fires nothing. "x" matches no typing rule at all, which is not a decision and fires nothing either -- the sink reports decisions (retypes and named-ambiguity declines), not every cell.
    expect(events).toEqual([
      { sheetIndex: 0, row: 1, column: 0, displayText: '007', outcome: 'declined', reason: 'leading-zero-digits' },
      { sheetIndex: 0, row: 1, column: 1, displayText: '42.5', outcome: 'retyped', value: { kind: 'number', value: 42.5 }, rule: 'plain-number' },
      { sheetIndex: 0, row: 2, column: 0, displayText: 'Yes', outcome: 'declined', reason: 'ambiguous-boolean-word' },
    ]);
  });
});

describe('buildCsvText', () => {
  it('writes the lone sheet by default, emitting displayText, and joins with CRLF plus a trailing CRLF', () => {
    const text = buildCsvText(spreadsheetDocument([{ name: 'Data', rows: [['Name', 'Amount'], ['Widget', '42.5']] }]));
    expect(text).toBe('Name,Amount\r\nWidget,42.5\r\n');
  });

  it('requires a sheet name for a multi-sheet document, naming every sheet rather than silently truncating', () => {
    const document = spreadsheetDocument([
      { name: 'First', rows: [['a']] },
      { name: 'Second', rows: [['b']] },
    ]);
    expect(() => buildCsvText(document)).toThrow(CsvSheetNotSpecifiedError);
    try {
      buildCsvText(document);
    } catch (error) {
      if (error instanceof CsvSheetNotSpecifiedError) {
        expect(error.availableSheets).toEqual(['First', 'Second']);
      }
    }
    expect(buildCsvText(document, { sheet: 'Second' })).toBe('b\r\n');
  });

  it('throws CsvSheetNotFoundError for a named sheet that does not exist, and for a document with no sheets at all', () => {
    const document = spreadsheetDocument([{ name: 'Only', rows: [['a']] }]);
    expect(() => buildCsvText(document, { sheet: 'Missing' })).toThrow(CsvSheetNotFoundError);
    expect(() => buildCsvText(spreadsheetDocument([]))).toThrow(CsvSheetNotFoundError);
  });

  it('throws CsvUnsupportedDocumentKindError for a non-spreadsheet ContentDocument', () => {
    const wordprocessing: ContentDocument = { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sections: [] };
    expect(() => buildCsvText(wordprocessing)).toThrow(CsvUnsupportedDocumentKindError);
  });

  it('writes the TSV delimiter when asked, quoting on tab rather than comma', () => {
    const text = buildCsvText(spreadsheetDocument([{ name: 'Data', rows: [['a,b', 'c\td']] }]), { delimiter: TSV_DELIMITER });
    // The comma stays bare: under the tab delimiter a comma is ordinary field text, not a split hazard.
    expect(text).toBe('a,b\t"c\td"\r\n');
  });

  it('writes empty fields for unpopulated grid positions, so a sparse sheet stays a uniform rectangle', () => {
    // Row 1 populates only column 1; the dense grid writes column 0 as an empty field rather than collapsing the row.
    const document: ContentDocument = {
      kind: 'spreadsheet',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      sheets: [{
        name: 'Sparse',
        images: [],
        columns: [{ index: 0, widthPt: 64 }, { index: 1, widthPt: 64 }],
        rows: [{ index: 0, heightPt: 15 }, { index: 1, heightPt: 15 }],
        printSettings: { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
        cells: [
          { row: 0, column: 0, value: { kind: 'string', value: 'h0' }, displayText: 'h0' },
          { row: 0, column: 1, value: { kind: 'string', value: 'h1' }, displayText: 'h1' },
          { row: 1, column: 1, value: { kind: 'string', value: 'only' }, displayText: 'only' },
        ],
      }],
    };
    expect(buildCsvText(document)).toBe('h0,h1\r\n,only\r\n');
  });
});

describe('readCsvContent -> buildCsvText round trip', () => {
  it('round-trips the parsed records field-for-field, since a re-typed value prints back as the identical digits', () => {
    const csvText = 'Name,Amount,Active\nWidget,42.5,TRUE\nGadget,7,No\n';
    const document = readCsvContent(csvText);
    const rebuilt = buildCsvText(document);
    expect(parseCsvRecords(rebuilt)).toEqual(parseCsvRecords(csvText));
  });
});

describe('decodeCsvText / encodeCsvText', () => {
  it('round-trips text through the byte boundary', () => {
    expect(decodeCsvText(encodeCsvText('a,b\r\ncafé,42.5\r\n'))).toBe('a,b\r\ncafé,42.5\r\n');
  });

  it('throws CsvInvalidUtf8Error on malformed UTF-8 rather than producing U+FFFD replacement characters', () => {
    expect(() => decodeCsvText(new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(CsvInvalidUtf8Error);
  });
});
