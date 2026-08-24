import { base64ToBytes } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { BLOB_FIXTURE_FBK_BASE64, ORIGINAL_FIXTURE_FBK_BASE64, RICH_FIXTURE_FBK_BASE64 } from '../test-support/firebird';
import { FirebirdBackupFormatError, readFirebirdBackup, SUPPORTED_BACKUP_FORMAT_VERSION } from './backup';
import { FirebirdCompositeRecordUnsupportedError } from './data';

// Tests against two genuinely LibreOffice-generated Firebird embedded-database backup streams (src/test-support/firebird.ts documents exactly how each was produced and verified) -- not hand-authored gbak bytes, since the whole value of this reader is that it decodes REAL output correctly, not output shaped to match this reader's own assumptions.

describe('readFirebirdBackup: the rich fixture (four EMPLOYEES rows, three DEPARTMENTS rows, deliberate NULLs)', () => {
  const bytes = base64ToBytes(RICH_FIXTURE_FBK_BASE64);

  it('reports the backup summary this reader was built and verified against', () => {
    const { summary } = readFirebirdBackup(bytes);
    expect(summary.backupFormatVersion).toBe(SUPPORTED_BACKUP_FORMAT_VERSION);
    expect(summary.transportable).toBe(true);
    expect(summary.compressed).toBe(true);
    expect(summary.pageSizeBytes).toBe(8192);
  });

  it('discovers both user tables purely from the backup stream, in creation order', () => {
    const { tables } = readFirebirdBackup(bytes);
    expect(tables.map((table) => table.tableName)).toEqual(['EMPLOYEES', 'DEPARTMENTS']);
  });

  it('extracts every EMPLOYEES column name, without any side-channel knowledge of the schema', () => {
    const { tables } = readFirebirdBackup(bytes);
    const employees = tables.find((table) => table.tableName === 'EMPLOYEES');
    const columnNames = employees?.columns.map((column) => column.name).sort();
    expect(columnNames).toEqual(['ACTIVE', 'BONUS', 'HIRE_DATE', 'ID', 'NAME', 'SALARY']);
  });

  // Row-by-row values, cross-checked field-by-field against a real LibreOffice SDBC SELECT * query run against this exact fixture (see src/test-support/firebird.ts's own doc comment) -- every value below matched that independent query exactly.
  it('decodes every EMPLOYEES row correctly, including NULLs, a negative DECIMAL, and an escaped apostrophe', () => {
    const { tables } = readFirebirdBackup(bytes);
    const employees = tables.find((table) => table.tableName === 'EMPLOYEES');
    expect(employees).toBeDefined();
    if (employees === undefined) {
      return;
    }
    const byId = (id: number) => {
      const idIndex = employees.columns.findIndex((column) => column.name === 'ID');
      const row = employees.rows.find((candidate) => {
        const idCell = candidate[idIndex];
        return idCell?.kind === 'number' && idCell.value === id;
      });
      if (row === undefined) {
        throw new Error(`no row found for ID ${id}`);
      }
      const cell = (columnName: string) => row[employees.columns.findIndex((column) => column.name === columnName)];
      return { salary: cell('SALARY'), bonus: cell('BONUS'), name: cell('NAME'), hireDate: cell('HIRE_DATE'), active: cell('ACTIVE') };
    };

    expect(employees.rows).toHaveLength(4);

    const alice = byId(1);
    expect(alice.name).toEqual({ kind: 'string', value: 'Alice Smith' });
    expect(alice.salary).toEqual({ kind: 'number', value: 75000.5 });
    expect(alice.bonus).toEqual({ kind: 'number', value: 1500.25 });
    expect(alice.hireDate).toEqual({ kind: 'date', value: '2020-01-15' });
    expect(alice.active).toEqual({ kind: 'boolean', value: true });

    const bob = byId(2);
    expect(bob.name).toEqual({ kind: 'string', value: 'Bob Jones' });
    expect(bob.salary).toEqual({ kind: 'number', value: 62000 });
    expect(bob.bonus).toEqual({ kind: 'number', value: -250.5 });
    expect(bob.hireDate).toEqual({ kind: 'date', value: '2019-06-01' });
    expect(bob.active).toEqual({ kind: 'boolean', value: false });

    const carol = byId(3);
    expect(carol.name).toEqual({ kind: 'string', value: 'Carol NULL Case' });
    expect(carol.salary).toEqual({ kind: 'empty' });
    expect(carol.bonus).toEqual({ kind: 'empty' });
    expect(carol.hireDate).toEqual({ kind: 'empty' });
    expect(carol.active).toEqual({ kind: 'empty' });

    const dave = byId(4);
    expect(dave.name).toEqual({ kind: 'string', value: "Dave O'Brien" });
    expect(dave.salary).toEqual({ kind: 'number', value: 0 });
    expect(dave.bonus).toEqual({ kind: 'number', value: 0 });
    expect(dave.hireDate).toEqual({ kind: 'date', value: '2024-12-31' });
    expect(dave.active).toEqual({ kind: 'boolean', value: true });
  });

  it('decodes every DEPARTMENTS row correctly, including a NULL NUMERIC column', () => {
    const { tables } = readFirebirdBackup(bytes);
    const departments = tables.find((table) => table.tableName === 'DEPARTMENTS');
    expect(departments).toBeDefined();
    if (departments === undefined) {
      return;
    }
    const deptIdIndex = departments.columns.findIndex((column) => column.name === 'DEPT_ID');
    const nameIndex = departments.columns.findIndex((column) => column.name === 'DEPT_NAME');
    const budgetIndex = departments.columns.findIndex((column) => column.name === 'BUDGET');

    expect(departments.rows).toHaveLength(3);
    const byDeptId = (id: number) => departments.rows.find((row) => {
      const idCell = row[deptIdIndex];
      return idCell?.kind === 'number' && idCell.value === id;
    });

    const engineering = byDeptId(10);
    expect(engineering?.[nameIndex]).toEqual({ kind: 'string', value: 'Engineering' });
    expect(engineering?.[budgetIndex]).toEqual({ kind: 'number', value: 500000 });

    const sales = byDeptId(20);
    expect(sales?.[nameIndex]).toEqual({ kind: 'string', value: 'Sales' });
    expect(sales?.[budgetIndex]).toEqual({ kind: 'number', value: 250000.75 });

    const noBudget = byDeptId(30);
    expect(noBudget?.[nameIndex]).toEqual({ kind: 'string', value: 'No Budget Dept' });
    expect(noBudget?.[budgetIndex]).toEqual({ kind: 'empty' });
  });
});

describe('readFirebirdBackup: format guards, never a silent wrong result', () => {
  // rec_burp(0) + att_backup_format(2)=4-byte-int32 + att_end(0) + rec_end(10) -- the minimal valid-shaped stream this reader's own guards can reject on purpose.
  function minimalBurpStream(formatVersion: number, extraAttributes: number[] = []): Uint8Array<ArrayBuffer> {
    const formatBytes = new Uint8Array(4);
    new DataView(formatBytes.buffer).setInt32(0, formatVersion, true);
    return new Uint8Array([0, 2, 4, ...formatBytes, ...extraAttributes, 0, 10]);
  }

  it('throws FirebirdBackupFormatError for a backup format version this reader has not verified', () => {
    expect(() => readFirebirdBackup(minimalBurpStream(11))).toThrow(FirebirdBackupFormatError);
    expect(() => readFirebirdBackup(minimalBurpStream(11))).toThrow(/format version 11 is not supported/);
  });

  it('throws FirebirdBackupFormatError for a non-transportable (native binary) backup', () => {
    // No att_backup_transportable attribute present at all -- mvol.cpp only ever writes it when true, so its absence IS "false" (see reader.ts's own Encoding 1 note).
    expect(() => readFirebirdBackup(minimalBurpStream(SUPPORTED_BACKUP_FORMAT_VERSION))).toThrow(FirebirdBackupFormatError);
    expect(() => readFirebirdBackup(minimalBurpStream(SUPPORTED_BACKUP_FORMAT_VERSION))).toThrow(/non-transportable/);
  });

  it('throws FirebirdBackupFormatError for a stream that does not even open with rec_burp', () => {
    expect(() => readFirebirdBackup(new Uint8Array([99]))).toThrow(FirebirdBackupFormatError);
    expect(() => readFirebirdBackup(new Uint8Array([99]))).toThrow(/expected the stream to open with rec_burp/);
  });

  it('throws FirebirdCompositeRecordUnsupportedError, not a silent skip, for a genuinely unrecognised top-level record kind', () => {
    // Valid rec_burp header (transportable=true) followed immediately by an unrecognised record type (250) instead of rec_end.
    const transportableAttr = [5, 4, 1, 0, 0, 0];
    const bytes = new Uint8Array([0, 2, 4, SUPPORTED_BACKUP_FORMAT_VERSION, 0, 0, 0, ...transportableAttr, 0, 250]);
    expect(() => readFirebirdBackup(bytes)).toThrow(FirebirdCompositeRecordUnsupportedError);
  });
});

describe('readFirebirdBackup: the odf.js original fixture (two empty tables, no row data at all)', () => {
  const bytes = base64ToBytes(ORIGINAL_FIXTURE_FBK_BASE64);

  it('discovers both tables and their columns with zero rows -- a second, independently-generated real file', () => {
    const { tables } = readFirebirdBackup(bytes);
    expect(tables).toEqual([
      { tableName: 'Customers', columns: [{ name: 'ID', type: 'INTEGER' }, { name: 'Name', type: 'VARCHAR(400)' }], rows: [] },
      { tableName: 'Orders', columns: [{ name: 'ID', type: 'INTEGER' }, { name: 'CustomerID', type: 'INTEGER' }], rows: [] },
    ]);
  });
});

describe('readFirebirdBackup: the blob fixture (a text blob, a binary blob, and NULL blobs)', () => {
  const bytes = base64ToBytes(BLOB_FIXTURE_FBK_BASE64);

  // Every expectation below matched LibreOffice's own SDBC SELECT * over this exact saved file, run in a separate process that reopened it fresh from disk -- see src/test-support/firebird.ts's own doc comment.
  function blobTestRows() {
    const { tables } = readFirebirdBackup(bytes);
    const table = tables.find((entry) => entry.tableName === 'BLOB_TEST');
    if (table === undefined) {
      throw new Error('fixture has no BLOB_TEST table');
    }
    const columnIndex = (name: string) => table.columns.findIndex((column) => column.name === name);
    return { table, columnIndex };
  }

  it('labels a blob column with its own declared sub-type', () => {
    const { table } = blobTestRows();
    const byName = new Map(table.columns.map((column) => [column.name, column.type]));
    expect(byName.get('NOTES')).toBe('BLOB SUB_TYPE 1');
    expect(byName.get('PAYLOAD')).toBe('BLOB SUB_TYPE 0');
  });

  it('recovers a text blob\'s full content as an ordinary string', () => {
    const { table, columnIndex } = blobTestRows();
    const expected = 'The quick brown fox jumps over the lazy dog. '.repeat(3).trimEnd();
    expect(table.rows[0]?.[columnIndex('NOTES')]).toEqual({ kind: 'string', value: expected });
    expect(table.rows[2]?.[columnIndex('NOTES')]).toEqual({ kind: 'string', value: 'short' });
  });

  it('recovers a binary blob byte-for-byte, as a base64 data URI', () => {
    const { table, columnIndex } = blobTestRows();
    const value = table.rows[0]?.[columnIndex('PAYLOAD')];
    expect(value?.kind).toBe('string');
    if (value?.kind !== 'string') {
      return;
    }
    const prefix = 'data:application/octet-stream;base64,';
    expect(value.value.startsWith(prefix)).toBe(true);
    const decoded = base64ToBytes(value.value.slice(prefix.length));
    // The fixture's own binary blob is every byte value 0x00..0xFF in order.
    expect(Array.from(decoded)).toEqual(Array.from({ length: 256 }, (_unused, index) => index));
  });

  it('leaves a NULL blob empty, since gbak writes no blob record at all for one', () => {
    const { table, columnIndex } = blobTestRows();
    expect(table.rows[1]?.[columnIndex('NOTES')]).toEqual({ kind: 'empty' });
    expect(table.rows[1]?.[columnIndex('PAYLOAD')]).toEqual({ kind: 'empty' });
    expect(table.rows[2]?.[columnIndex('PAYLOAD')]).toEqual({ kind: 'empty' });
  });

  it('keeps every non-blob column of a blob-bearing row correct', () => {
    const { table, columnIndex } = blobTestRows();
    expect(table.rows.map((row) => row[columnIndex('ID')])).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'number', value: 2 },
      { kind: 'number', value: 3 },
    ]);
    expect(table.rows.map((row) => row[columnIndex('LABEL')])).toEqual([
      { kind: 'string', value: 'first' },
      { kind: 'string', value: 'second' },
      { kind: 'string', value: 'third' },
    ]);
    expect(table.rows.map((row) => row[columnIndex('AMOUNT')])).toEqual([
      { kind: 'number', value: 42 },
      { kind: 'number', value: 7 },
      { kind: 'number', value: 0 },
    ]);
  });

  it('stays aligned past the blob-bearing table, decoding the ordinary table that follows it', () => {
    const { tables } = readFirebirdBackup(bytes);
    const plain = tables.find((entry) => entry.tableName === 'PLAIN');
    expect(plain?.rows).toEqual([
      [{ kind: 'number', value: 1 }, { kind: 'string', value: 'alpha' }],
      [{ kind: 'number', value: 2 }, { kind: 'string', value: 'beta' }],
    ]);
  });
});
