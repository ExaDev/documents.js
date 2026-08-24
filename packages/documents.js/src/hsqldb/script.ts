import type { ContentCellValue } from "document-schema.js";

// HSQLDB's historical TEXT script format (hsqldb.script_format=0, the default LibreOffice's embedded engine writes) renders an entire database as literal SQL text: CREATE TABLE/CREATE USER/GRANT/INSERT INTO statements, one per logical statement, human-readable. This module is a bounded DDL/DML text parser over exactly that format -- a small SQL SUBSET, not a database engine -- extracting column names/types from CREATE TABLE and row values from INSERT INTO, and tolerating (skipping) every other statement kind this package has no use for (users, grants, sequences, indexes, views, schema/session SET commands). It deliberately imports nothing beyond document-schema.js's own ContentCellValue type: no odf.js Package/XmlElement knowledge belongs here at all -- the caller (src/odb/read.ts) is responsible for extracting database/script's own raw bytes from a real .odb package and handing them to parseHsqldbScript; this module never sees a Package.
//
// Statement recognition is a closed allowlist on both sides: CREATE TABLE (any of MEMORY/CACHED/TEXT/TEMP/TEMPORARY/GLOBAL TEMPORARY) and INSERT INTO are the two statement kinds this module extracts data from; a second, explicit allowlist (IGNORABLE_STATEMENT_PREFIXES) names every statement kind real HSQLDB script output is known to emit that carries no table/row data this package models. A statement matching NEITHER list throws HsqldbScriptParseError rather than being silently skipped -- an unrecognised statement might carry data this bounded parser doesn't know how to interpret, and silently dropping it would risk exactly the "accuracy compromised" failure mode this module is required to avoid.

export class HsqldbScriptParseError extends Error {
  readonly statement: string;

  constructor(message: string, statement: string) {
    super(
      `HSQLDB script parse error: ${message} -- in statement: ${truncateForMessage(statement)}`,
    );
    this.name = "HsqldbScriptParseError";
    this.statement = statement;
  }
}

const MESSAGE_STATEMENT_PREVIEW_LENGTH = 200;

function truncateForMessage(statement: string): string {
  return statement.length > MESSAGE_STATEMENT_PREVIEW_LENGTH
    ? `${statement.slice(0, MESSAGE_STATEMENT_PREVIEW_LENGTH)}...`
    : statement;
}

export interface HsqldbColumn {
  readonly name: string;
  // The column's own declared type clause, verbatim from CREATE TABLE (e.g. "INTEGER NOT NULL PRIMARY KEY", "VARCHAR(50)", "DECIMAL(10,2)") -- kept whole rather than parsed into a structured type, since this module's only use for it is disambiguating a bare quoted literal's DATE/TIME bucket (see typeBucket below); nothing here models SQL constraints.
  readonly type: string;
}

export interface HsqldbTable {
  readonly tableName: string;
  readonly columns: readonly HsqldbColumn[];
  readonly rows: readonly (readonly ContentCellValue[])[];
}

// Mirrors src/edit/ods/cell.ts's own OdsCell.value setter default-displayText convention exactly (number -> String(value); boolean -> 'TRUE'/'FALSE'; date/time/string/error -> the value's own string verbatim; empty -> '') -- this module has no ODF cell to write into, but the same "what would a human reading this cell see" rule applies to both the ContentSheet-mapping step (src/odb/spreadsheet.ts) and CSV serialisation (src/odb/csv.ts), so it lives here once rather than being redefined twice.
export function displayTextFor(value: ContentCellValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value);
    case "percentage":
      return `${value.value * 100}%`;
    case "currency":
      return value.currency === undefined
        ? String(value.value)
        : `${value.value} ${value.currency}`;
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "date":
    case "time":
    case "dateTime":
    case "string":
    case "error":
      return value.value;
    case "empty":
      return "";
  }
}

// Statement kinds real HSQLDB TEXT-format script output is known to emit that carry no table/row data this package models -- session/database configuration (SET *), users and grants, schema and sequence management, and index/view/trigger/routine definitions. Checked as a case-insensitive, whitespace-collapsed PREFIX match against a statement's own start, not a full parse -- these statements are never inspected further once matched.
const IGNORABLE_STATEMENT_PREFIXES: readonly string[] = [
  "SET DATABASE",
  "SET FILES",
  "SET SCHEMA",
  "SET TABLE",
  "SET WRITE_DELAY",
  "SET AUTOCOMMIT",
  "SET IGNORECASE",
  "SET REFERENTIAL_INTEGRITY",
  "SET PROPERTY",
  "SET PASSWORD",
  "SET LOGSIZE",
  "SET SCALE",
  "SET LOCAL",
  "CREATE USER",
  "ALTER USER",
  "DROP USER",
  "CREATE SCHEMA",
  "DROP SCHEMA",
  "GRANT",
  "REVOKE",
  "CREATE SEQUENCE",
  "ALTER SEQUENCE",
  "DROP SEQUENCE",
  "CREATE INDEX",
  "CREATE UNIQUE INDEX",
  "DROP INDEX",
  "ALTER TABLE",
  "CREATE VIEW",
  "DROP VIEW",
  "CREATE TRIGGER",
  "DROP TRIGGER",
  "CREATE FUNCTION",
  "CREATE PROCEDURE",
  "CREATE AGGREGATE FUNCTION",
  "DROP FUNCTION",
  "DROP PROCEDURE",
  "CREATE TYPE",
  "CREATE DOMAIN",
  "COMMENT ON",
  "CHECKPOINT",
  "CONNECT",
  "DISCONNECT",
  "SHUTDOWN",
];

function isIgnorableStatement(statement: string): boolean {
  const normalized = statement.replace(/\s+/g, " ").trim().toUpperCase();
  return IGNORABLE_STATEMENT_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

const CREATE_TABLE_RE =
  /^CREATE\s+(?:(?:MEMORY|CACHED|TEXT|TEMP|TEMPORARY|GLOBAL\s+TEMPORARY)\s+)?TABLE\s+/i;
const INSERT_INTO_RE = /^INSERT\s+INTO\s+/i;
const TABLE_CONSTRAINT_KEYWORDS = new Set([
  "PRIMARY",
  "FOREIGN",
  "UNIQUE",
  "CHECK",
  "CONSTRAINT",
]);

// Splits the whole script into individual statements at newline characters that occur OUTSIDE a single-quoted string or double-quoted identifier -- a character-level scan rather than a naive per-line split, so a string literal that happens to contain a literal embedded newline is never mistaken for a statement boundary. Blank (whitespace-only) lines are dropped.
function splitStatements(text: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inSingleQuote) {
      current += ch;
      if (ch === "'") {
        if (text.charAt(i + 1) === "'") {
          current += text.charAt(i + 1);
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }
    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          current += text.charAt(i + 1);
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      continue;
    }
    if (ch === "\n") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

function skipWs(s: string, start: number): number {
  let i = start;
  while (i < s.length && /\s/.test(s.charAt(i))) {
    i++;
  }
  return i;
}

// Reads a single identifier at `start`: a double-quoted identifier (with "" doubling for an embedded quote), or a plain run of letters/digits/underscore/$/# -- HSQLDB's own unquoted-identifier character set.
function readIdentifier(
  s: string,
  start: number,
): { readonly name: string; readonly next: number } {
  const i0 = skipWs(s, start);
  if (s.charAt(i0) === '"') {
    let name = "";
    let i = i0 + 1;
    while (i < s.length) {
      const ch = s.charAt(i);
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') {
          name += '"';
          i += 2;
          continue;
        }
        i++;
        break;
      }
      name += ch;
      i++;
    }
    return { name, next: i };
  }
  let i = i0;
  while (i < s.length && /[A-Za-z0-9_$#]/.test(s.charAt(i))) {
    i++;
  }
  return { name: s.slice(i0, i), next: i };
}

// A qualified name (e.g. PUBLIC.CUSTOMERS or PUBLIC."My Table") is a dot-separated identifier chain -- only the LAST segment (the table's own bare name) is kept; the schema-qualifying segments are discarded, since HsqldbTable has no schema field of its own.
function readQualifiedName(
  s: string,
  start: number,
): { readonly last: string; readonly next: number } {
  const first = readIdentifier(s, start);
  let last = first.name;
  let i = first.next;
  while (s.charAt(i) === ".") {
    const segment = readIdentifier(s, i + 1);
    last = segment.name;
    i = segment.next;
  }
  return { last, next: i };
}

// Scans from `openIndex` (which must hold '(') to its matching ')', tracking nested parens and quote state so a nested type argument (VARCHAR(50)) or a value containing a literal ')' inside a quoted string never terminates the scan early. Returns the substring strictly between the outer parens.
function readBalancedParens(
  s: string,
  openIndex: number,
): { readonly inner: string; readonly next: number } {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = openIndex;
  for (; i < s.length; i++) {
    const ch = s.charAt(i);
    if (inSingleQuote) {
      if (ch === "'") {
        if (s.charAt(i + 1) === "'") {
          i++;
          continue;
        }
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') {
          i++;
          continue;
        }
        inDoubleQuote = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) {
        return { inner: s.slice(openIndex + 1, i), next: i + 1 };
      }
    }
  }
  throw new HsqldbScriptParseError("unterminated parenthesis", s);
}

// Splits `s` on top-level occurrences of `sep` only -- never inside nested parens or a quoted string/identifier -- so "VARCHAR(50)" and "'a, b'" each survive as one field.
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (inSingleQuote) {
      current += ch;
      if (ch === "'") {
        if (s.charAt(i + 1) === "'") {
          current += s.charAt(i + 1);
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }
    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') {
          current += s.charAt(i + 1);
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      current += ch;
      continue;
    }
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function unescapeSingleQuotes(s: string): string {
  return s.replace(/''/g, "'");
}

// The column-type-clause bucket this module cares about: only DATE and TIME change how a bare (un-prefixed) quoted literal is interpreted -- every other declared type (INTEGER, VARCHAR, DECIMAL, BOOLEAN, ...) falls to 'other', where a bare quoted literal is always a plain string.
function typeBucket(typeText: string): "date" | "time" | "other" {
  const leading = /^([A-Za-z_]+)/.exec(typeText.trim());
  const word = leading?.[1]?.toUpperCase();
  if (word === "DATE") {
    return "date";
  }
  if (word === "TIME") {
    return "time";
  }
  return "other";
}

const NUMBER_LITERAL_RE = /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

// A single VALUES-tuple field -> ContentCellValue. Recognises: NULL; DATE/TIME/TIMESTAMP 'literal' (HSQLDB's own typed-literal rendering for date/time-valued columns -- TIMESTAMP has no ContentCellValue kind of its own, so it maps onto 'date' the same way ooxml.js's own xlsx writer collapses date/time into one wire kind, see this package's README); a bare quoted string, disambiguated into 'date'/'time'/'string' by the owning column's own declared type; TRUE/FALSE; and a plain signed/decimal/exponent number. Anything else throws -- a literal form this bounded parser does not recognise is not silently coerced to a string, since that could misrepresent the source data.
function parseLiteral(
  raw: string,
  bucket: "date" | "time" | "other",
): ContentCellValue {
  const trimmed = raw.trim();
  if (/^NULL$/i.test(trimmed)) {
    return { kind: "empty" };
  }
  const dateTyped = /^DATE\s*'((?:[^']|'')*)'$/i.exec(trimmed);
  if (dateTyped?.[1] !== undefined) {
    return { kind: "date", value: unescapeSingleQuotes(dateTyped[1]) };
  }
  const timeTyped = /^TIME\s*'((?:[^']|'')*)'$/i.exec(trimmed);
  if (timeTyped?.[1] !== undefined) {
    return { kind: "time", value: unescapeSingleQuotes(timeTyped[1]) };
  }
  const timestampTyped = /^TIMESTAMP\s*'((?:[^']|'')*)'$/i.exec(trimmed);
  if (timestampTyped?.[1] !== undefined) {
    return { kind: "date", value: unescapeSingleQuotes(timestampTyped[1]) };
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const text = unescapeSingleQuotes(trimmed.slice(1, -1));
    if (bucket === "date") {
      return { kind: "date", value: text };
    }
    if (bucket === "time") {
      return { kind: "time", value: text };
    }
    return { kind: "string", value: text };
  }
  if (/^TRUE$/i.test(trimmed)) {
    return { kind: "boolean", value: true };
  }
  if (/^FALSE$/i.test(trimmed)) {
    return { kind: "boolean", value: false };
  }
  if (NUMBER_LITERAL_RE.test(trimmed)) {
    return { kind: "number", value: Number(trimmed) };
  }
  throw new HsqldbScriptParseError(`unrecognised literal "${trimmed}"`, raw);
}

interface MutableTable {
  readonly tableName: string;
  readonly columns: HsqldbColumn[];
  readonly rows: ContentCellValue[][];
}

function parseCreateTable(statement: string): {
  readonly tableName: string;
  readonly columns: HsqldbColumn[];
} {
  const match = CREATE_TABLE_RE.exec(statement);
  if (match === null) {
    throw new HsqldbScriptParseError(
      "expected a CREATE TABLE statement",
      statement,
    );
  }
  const afterKeyword = match[0].length;
  const { last: tableName, next } = readQualifiedName(statement, afterKeyword);
  const openIndex = skipWs(statement, next);
  if (statement.charAt(openIndex) !== "(") {
    throw new HsqldbScriptParseError(
      `CREATE TABLE "${tableName}": expected "(" to start the column list`,
      statement,
    );
  }
  const { inner } = readBalancedParens(statement, openIndex);

  const columns: HsqldbColumn[] = [];
  for (const rawPart of splitTopLevel(inner, ",")) {
    const part = rawPart.trim();
    if (part.length === 0) {
      continue;
    }
    const leadingWord = /^([A-Za-z_][A-Za-z0-9_]*)/
      .exec(part)?.[1]
      ?.toUpperCase();
    if (
      leadingWord !== undefined &&
      TABLE_CONSTRAINT_KEYWORDS.has(leadingWord)
    ) {
      continue; // a table-level constraint clause (PRIMARY KEY(...), FOREIGN KEY(...), ...), not a column definition.
    }
    const { name, next: afterName } = readIdentifier(part, 0);
    if (name.length === 0) {
      throw new HsqldbScriptParseError(
        `CREATE TABLE "${tableName}": could not read a column name from "${part}"`,
        statement,
      );
    }
    columns.push({ name, type: part.slice(afterName).trim() });
  }
  if (columns.length === 0) {
    throw new HsqldbScriptParseError(
      `CREATE TABLE "${tableName}": no columns found`,
      statement,
    );
  }
  return { tableName, columns };
}

function parseInsertInto(statement: string): {
  readonly tableName: string;
  readonly explicitColumns: readonly string[] | undefined;
  readonly values: readonly string[];
} {
  const match = INSERT_INTO_RE.exec(statement);
  if (match === null) {
    throw new HsqldbScriptParseError(
      "expected an INSERT INTO statement",
      statement,
    );
  }
  const { last: tableName, next } = readQualifiedName(
    statement,
    match[0].length,
  );
  let i = skipWs(statement, next);

  let explicitColumns: string[] | undefined;
  if (statement.charAt(i) === "(") {
    const { inner, next: afterCols } = readBalancedParens(statement, i);
    explicitColumns = splitTopLevel(inner, ",").map(
      (part) => readIdentifier(part.trim(), 0).name,
    );
    i = skipWs(statement, afterCols);
  }

  const valuesMatch = /^VALUES\s*/i.exec(statement.slice(i));
  if (valuesMatch === null) {
    throw new HsqldbScriptParseError(
      `INSERT INTO "${tableName}": expected the VALUES keyword`,
      statement,
    );
  }
  i = skipWs(statement, i + valuesMatch[0].length);

  if (statement.charAt(i) !== "(") {
    throw new HsqldbScriptParseError(
      `INSERT INTO "${tableName}": expected "(" to start the VALUES tuple`,
      statement,
    );
  }
  const { inner, next: afterTuple } = readBalancedParens(statement, i);
  const trailing = statement.slice(afterTuple).trim();
  if (trailing.length > 0) {
    throw new HsqldbScriptParseError(
      `INSERT INTO "${tableName}": unexpected trailing content after the VALUES tuple ("${trailing}") -- multiple tuples per INSERT are outside this bounded parser's scope`,
      statement,
    );
  }

  return {
    tableName,
    explicitColumns,
    values: splitTopLevel(inner, ",").map((value) => value.trim()),
  };
}

function resolveColumnOrder(
  table: MutableTable,
  explicitColumns: readonly string[] | undefined,
  statement: string,
): readonly number[] {
  if (explicitColumns === undefined) {
    return table.columns.map((_, index) => index);
  }
  return explicitColumns.map((name) => {
    const index = table.columns.findIndex(
      (column) => column.name.toUpperCase() === name.toUpperCase(),
    );
    if (index === -1) {
      throw new HsqldbScriptParseError(
        `INSERT INTO "${table.tableName}": column "${name}" is not declared on this table`,
        statement,
      );
    }
    return index;
  });
}

// Parses HSQLDB TEXT-format script bytes (hsqldb.script_format=0) into one HsqldbTable per CREATE TABLE statement, populated by whatever INSERT INTO statements follow it in the script -- a bounded DDL/DML subset, not a database engine. Throws HsqldbScriptParseError for any statement that is neither CREATE TABLE, INSERT INTO, nor a recognised ignorable statement kind, or for a CREATE TABLE/INSERT INTO statement whose own shape this parser cannot follow (an unrecognised literal, a column-count mismatch, an INSERT referencing an undeclared table or column) -- never a silent partial or empty result.
export function parseHsqldbScript(bytes: Uint8Array): HsqldbTable[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const tablesByKey = new Map<string, MutableTable>();
  const order: string[] = [];

  for (const statement of splitStatements(text)) {
    if (CREATE_TABLE_RE.test(statement)) {
      const { tableName, columns } = parseCreateTable(statement);
      const key = tableName.toUpperCase();
      if (tablesByKey.has(key)) {
        throw new HsqldbScriptParseError(
          `duplicate CREATE TABLE for "${tableName}"`,
          statement,
        );
      }
      tablesByKey.set(key, { tableName, columns, rows: [] });
      order.push(key);
      continue;
    }

    if (INSERT_INTO_RE.test(statement)) {
      const { tableName, explicitColumns, values } = parseInsertInto(statement);
      const key = tableName.toUpperCase();
      const table = tablesByKey.get(key);
      if (table === undefined) {
        throw new HsqldbScriptParseError(
          `INSERT INTO references unknown table "${tableName}" (no prior CREATE TABLE seen for it)`,
          statement,
        );
      }
      const columnOrder = resolveColumnOrder(table, explicitColumns, statement);
      if (values.length !== columnOrder.length) {
        throw new HsqldbScriptParseError(
          `INSERT INTO "${tableName}": expected ${columnOrder.length} value(s), found ${values.length}`,
          statement,
        );
      }
      const row: ContentCellValue[] = table.columns.map(
        (): ContentCellValue => ({ kind: "empty" }),
      );
      columnOrder.forEach((columnIndex, position) => {
        const column = table.columns[columnIndex];
        const rawValue = values[position];
        if (column === undefined || rawValue === undefined) {
          throw new HsqldbScriptParseError(
            `INSERT INTO "${tableName}": internal column/value alignment failure`,
            statement,
          );
        }
        row[columnIndex] = parseLiteral(rawValue, typeBucket(column.type));
      });
      table.rows.push(row);
      continue;
    }

    if (isIgnorableStatement(statement)) {
      continue;
    }

    throw new HsqldbScriptParseError(
      "unrecognised statement (not CREATE TABLE, INSERT INTO, or a known ignorable statement kind)",
      statement,
    );
  }

  return order.map((key) => {
    const table = tablesByKey.get(key);
    if (table === undefined) {
      throw new HsqldbScriptParseError(
        `internal error: table "${key}" missing from tracking map`,
        "",
      );
    }
    return {
      tableName: table.tableName,
      columns: table.columns,
      rows: table.rows,
    };
  });
}
