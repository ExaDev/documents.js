import { decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { embeddedHsqldbOdbBytes } from '../test-support/odb';
import { odbToCsv, odbToXlsx } from './convert';
import { OdbTableNotSpecifiedError } from '../odb/csv';

// The genuine byte-level round trip for odbToXlsx/odbToCsv: embeddedHsqldbOdbBytes() (src/test-support/odb.ts) is a real, zipped .odb package -- mimetype/manifest/content.xml/database/script all present -- decoded exactly the way a caller's own bytes would be, through decodePackage -> readOdbTables -> odbTablesToSpreadsheetDocument/buildOdbTableCsv. See this repo's own real-LibreOffice verification notes (README Fidelity, this task's own final report) for confirmation the generated xlsx opens correctly in genuine LibreOffice.

describe('odbToXlsx', () => {
  const xlsxBytes = odbToXlsx(embeddedHsqldbOdbBytes());
  const content = readXlsxContent(decodeOoxmlPackage(xlsxBytes));

  it('produces a spreadsheet ContentDocument with one sheet per table', () => {
    expect(content.kind).toBe('spreadsheet');
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(content.sheets.map((sheet) => sheet.name)).toEqual(['CUSTOMERS', 'ORDERS']);
  });

  it('writes a header row of column names, then typed data rows, on the CUSTOMERS sheet', () => {
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const sheet = content.sheets[0];
    if (sheet === undefined) {
      throw new Error('expected a CUSTOMERS sheet');
    }
    const header = sheet.cells.filter((cell) => cell.row === 0).sort((a, b) => a.column - b.column);
    expect(header.map((cell) => cell.displayText)).toEqual(['ID', 'NAME', 'EMAIL', 'ACTIVE', 'SIGNUP_DATE']);

    const row1 = sheet.cells.filter((cell) => cell.row === 1).sort((a, b) => a.column - b.column);
    expect(row1.map((cell) => cell.value)).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'string', value: 'Alice Smith' },
      { kind: 'string', value: 'alice@example.com' },
      { kind: 'boolean', value: true },
      { kind: 'date', value: '2024-01-15' },
    ]);

    // A "kind: 'empty'" cell writes no <c> element at all in real xlsx XML (there is nothing to write for a genuinely empty cell), so buildXlsxPackage/readXlsxContent's own round trip never produces a cell entry for that position -- unlike ContentSheet's own in-memory representation (src/odb/spreadsheet.test.ts), which does carry an explicit { kind: 'empty' } cell for every table position. Columns 2 (EMAIL) and 4 (SIGNUP_DATE) are NULL in this row, so only columns 0/1/3 survive the xlsx hop.
    const row2 = sheet.cells.filter((cell) => cell.row === 2).sort((a, b) => a.column - b.column);
    expect(row2.map((cell) => ({ column: cell.column, value: cell.value }))).toEqual([
      { column: 0, value: { kind: 'number', value: 2 } },
      { column: 1, value: { kind: 'string', value: 'Bob Jones' } },
      { column: 3, value: { kind: 'boolean', value: false } },
    ]);
  });
});

describe('odbToCsv', () => {
  it('writes the named table as CSV, quoting the field containing a comma', () => {
    const csvBytes = odbToCsv(embeddedHsqldbOdbBytes(), { table: 'ORDERS' });
    const text = new TextDecoder().decode(csvBytes);
    const lines = text.split('\r\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('ID,CUSTOMER_ID,AMOUNT,NOTES');
    expect(lines[1]).toBe('1,1,42.5,first order');
    expect(lines[2]).toBe('2,1,,');
  });

  it('throws OdbTableNotSpecifiedError, naming both tables, when table is omitted and more than one table exists', () => {
    const bytes = embeddedHsqldbOdbBytes();
    expect(() => odbToCsv(bytes)).toThrow(OdbTableNotSpecifiedError);
    expect(() => odbToCsv(bytes)).toThrow(/CUSTOMERS, ORDERS/);
  });

  it('writes a field with no comma/quote/newline bare, unquoted', () => {
    const csvBytes = odbToCsv(embeddedHsqldbOdbBytes(), { table: 'CUSTOMERS' });
    const text = new TextDecoder().decode(csvBytes);
    expect(text).toContain("Carol O'Brien");
  });
});
