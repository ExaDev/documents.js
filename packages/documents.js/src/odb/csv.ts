import type { HsqldbTable } from '../hsqldb/script';
import { displayTextFor } from '../hsqldb/script';

// Writes exactly one named HsqldbTable as CSV bytes -- no ContentSheet/xlsx machinery involved at all, since CSV needs nothing beyond the table's own column names and each cell's own display text. RFC 4180-style quoting: a field containing a comma, double quote, or newline is wrapped in double quotes with any embedded double quote doubled; every other field is written bare.

export class OdbTableNotSpecifiedError extends Error {
  readonly availableTables: readonly string[];

  constructor(availableTables: readonly string[]) {
    super(`odbToCsv: this .odb has more than one table (${availableTables.join(', ')}) -- pass { table: '<name>' } to select one`);
    this.name = 'OdbTableNotSpecifiedError';
    this.availableTables = availableTables;
  }
}

export class OdbTableNotFoundError extends Error {
  readonly table: string;
  readonly availableTables: readonly string[];

  constructor(table: string, availableTables: readonly string[]) {
    super(`odbToCsv: table "${table}" not found -- available table(s): ${availableTables.length === 0 ? '(none)' : availableTables.join(', ')}`);
    this.name = 'OdbTableNotFoundError';
    this.table = table;
    this.availableTables = availableTables;
  }
}

const CSV_QUOTE_NEEDED_RE = /[",\n\r]/;

function csvField(value: string): string {
  return CSV_QUOTE_NEEDED_RE.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function selectTable(tables: readonly HsqldbTable[], tableName: string | undefined): HsqldbTable {
  const availableNames = tables.map((table) => table.tableName);
  if (tableName !== undefined) {
    const found = tables.find((table) => table.tableName === tableName);
    if (found === undefined) {
      throw new OdbTableNotFoundError(tableName, availableNames);
    }
    return found;
  }
  if (tables.length === 0) {
    throw new OdbTableNotFoundError('(unspecified)', availableNames);
  }
  if (tables.length > 1) {
    throw new OdbTableNotSpecifiedError(availableNames);
  }
  const only = tables[0];
  if (only === undefined) {
    throw new OdbTableNotFoundError('(unspecified)', availableNames);
  }
  return only;
}

export function buildOdbTableCsv(tables: readonly HsqldbTable[], tableName: string | undefined): Uint8Array<ArrayBuffer> {
  const table = selectTable(tables, tableName);
  const lines: string[] = [table.columns.map((column) => csvField(column.name)).join(',')];
  for (const row of table.rows) {
    lines.push(row.map((cell) => csvField(displayTextFor(cell))).join(','));
  }
  return new TextEncoder().encode(`${lines.join('\r\n')}\r\n`);
}
