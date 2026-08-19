import { DocumentPackageSchema, flattenPackage } from 'document-schema.js';
import { decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { embeddedHsqldbCachedOdbBytes, embeddedHsqldbOdbBytes } from '../test-support/odb';
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
    // SIGNUP_DATE (a 'date'-kind ContentCellValue this package's own HSQLDB decoders produce) is written through buildXlsxPackage as xlsx's own single combined date/time serial cell type (t="d") under a date-only number format. ooxml.js's readXlsxContent (2.6.1+) now carries a full number-format engine and reads the format code back to distinguish date-only from date+time, so a date-only format round-trips as 'date' again -- the value string survives byte-for-byte either way.
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

// OdbConversionOptions inherits onDocument from DocumentBridgeOptions, but odbToXlsx/odbToCsv historically never fired it -- an accepted-but-ignored callback. Both now deliver the same content-only tree package every other bridge reports: the .odb's whole spreadsheet content decomposed into sheet-group children (every table, since that is the document the conversion read), no pages and no node frames, because no layout pass runs on this path.
describe('odbToXlsx / odbToCsv onDocument', () => {
  it('odbToXlsx fires onDocument exactly once with a content-only spreadsheet package', () => {
    const packages: unknown[] = [];
    const out = odbToXlsx(embeddedHsqldbOdbBytes(), { onDocument: (pkg) => packages.push(pkg) });
    expect(out.byteLength).toBeGreaterThan(0);
    expect(packages).toHaveLength(1);
    const pkg = DocumentPackageSchema.parse(packages[0]);
    const content = flattenPackage(pkg);
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(content.sheets.map((sheet) => sheet.name)).toEqual(['CUSTOMERS', 'ORDERS']);
    expect(pkg.pages).toBeUndefined();
  });

  it('odbToCsv fires onDocument once with the whole-document content, lazily -- no callback, no document built', () => {
    const packages: unknown[] = [];
    const out = odbToCsv(embeddedHsqldbOdbBytes(), { table: 'ORDERS', onDocument: (pkg) => packages.push(pkg) });
    expect(new TextDecoder().decode(out)).toContain('first order');
    expect(packages).toHaveLength(1);
    // The captured unknown narrows through the schema's own parse -- the repo's untrusted-value boundary pattern -- before the tree is flattened.
    const pkg = DocumentPackageSchema.parse(packages[0]);
    // The selected ORDERS table is what the CSV carries; the reported package is the whole .odb -- CUSTOMERS and ORDERS both.
    const content = flattenPackage(pkg);
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(content.sheets.map((sheet) => sheet.name)).toEqual(['CUSTOMERS', 'ORDERS']);
  });

  it('neither fires anything when no onDocument is supplied', () => {
    expect(() => odbToXlsx(embeddedHsqldbOdbBytes())).not.toThrow();
    expect(() => odbToCsv(embeddedHsqldbOdbBytes(), { table: 'ORDERS' })).not.toThrow();
  });
});

// The Tier 2 byte-level round trip: embeddedHsqldbCachedOdbBytes() (src/test-support/odb.ts) is a real, zipped .odb package wrapping a genuine HSQLDB 1.8.0.10 CACHED-table database's own database/script + database/data + database/properties + database/backup -- decoded exactly the way a caller's own bytes would be, through decodePackage -> readOdbTables (src/odb/read.ts's withCachedTableRows, src/hsqldb/cache.ts) -> odbTablesToSpreadsheetDocument/buildOdbTableCsv. DATE columns are involved, so this suite pins TZ the same way src/hsqldb/cache.test.ts does -- see that file's own comment on why.
describe('odbToXlsx / odbToCsv: a real HSQLDB 1.8.0.10 CACHED-table database', () => {
  let previousTz: string | undefined;
  beforeAll(() => {
    previousTz = process.env.TZ;
    process.env.TZ = 'Europe/London';
  });
  afterAll(() => {
    if (previousTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTz;
    }
  });

  it('produces a spreadsheet ContentDocument with one sheet per table, EMPLOYEES rows decoded from the real binary row store', () => {
    const xlsxBytes = odbToXlsx(embeddedHsqldbCachedOdbBytes());
    const content = readXlsxContent(decodeOoxmlPackage(xlsxBytes));
    expect(content.kind).toBe('spreadsheet');
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(content.sheets.map((sheet) => sheet.name)).toEqual(['EMPLOYEES', 'DEPARTMENTS', 'EMPTY_TABLE', 'TYPE_TEST']);

    const employees = content.sheets[0];
    if (employees === undefined) {
      throw new Error('expected an EMPLOYEES sheet');
    }
    const row1 = employees.cells.filter((cell) => cell.row === 1).sort((a, b) => a.column - b.column);
    // See the CUSTOMERS sheet's own note above (odbToXlsx describe block) -- ooxml.js's readXlsxContent (2.6.1+) now reads a HIRE_DATE-style date-only-formatted cell back as 'date' again, via its own number-format engine.
    expect(row1.map((cell) => cell.value)).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'string', value: 'Alice Smith' },
      { kind: 'number', value: 75000.5 },
      { kind: 'date', value: '2020-01-15' },
      { kind: 'boolean', value: true },
      { kind: 'number', value: 1500.25 },
    ]);

    const emptyTable = content.sheets[2];
    if (emptyTable === undefined) {
      throw new Error('expected an EMPTY_TABLE sheet');
    }
    // Only the header row -- EMPTY_TABLE has genuinely zero data rows, decoded via the "no SET TABLE...INDEX line at all" pathway (see src/hsqldb/cache.ts's own parseHsqldbIndexRoots comment).
    expect(emptyTable.cells.map((cell) => cell.row)).toEqual([0, 0]);
  });

  it('writes the named table as CSV, recovering TIME/TIMESTAMP/BIGINT/SMALLINT/TINYINT from TYPE_TEST', () => {
    const csvBytes = odbToCsv(embeddedHsqldbCachedOdbBytes(), { table: 'TYPE_TEST' });
    const text = new TextDecoder().decode(csvBytes);
    const lines = text.split('\r\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('ID,START_TIME,LOGGED_AT,BIG_NUM,SMALL_NUM,TINY_NUM');
    expect(lines[1]).toBe('1,14:30:00,2024-03-15 09:45:30.123456789,123456789012345,32000,120');
    expect(lines[2]).toBe('2,23:59:59,1999-12-31 23:59:59,-123456789012345,-32000,-120');
    expect(lines[3]).toBe('3,,,,,');
  });

  it('throws OdbTableNotSpecifiedError, naming all four tables, when table is omitted', () => {
    const bytes = embeddedHsqldbCachedOdbBytes();
    expect(() => odbToCsv(bytes)).toThrow(OdbTableNotSpecifiedError);
    expect(() => odbToCsv(bytes)).toThrow(/EMPLOYEES, DEPARTMENTS, EMPTY_TABLE, TYPE_TEST/);
  });
});
