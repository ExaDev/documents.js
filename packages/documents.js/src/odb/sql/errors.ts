// The three failure classes src/odb/sql/'s bounded SELECT engine can report, shared by its lexer, parser, and evaluator. Every one of them is a hard failure: this engine never degrades an input it cannot fully handle into a best-effort or partial result set.
//
// The policy being followed here is src/hsqldb/script.ts's own, stated in that module's top-of-file comment: "Statement recognition is a closed allowlist on both sides ... A statement matching NEITHER list throws HsqldbScriptParseError rather than being silently skipped -- an unrecognised statement might carry data this bounded parser doesn't know how to interpret, and silently dropping it would risk exactly the 'accuracy compromised' failure mode this module is required to avoid." The same reasoning applies with more force to a query engine: silently ignoring a JOIN, a DISTINCT, or a HAVING clause would return rows that look plausible and are wrong, which is strictly worse than returning nothing at all.
//
// Where script.ts has two lists (statements it extracts data from, and statements it deliberately skips), this engine has two too, and they map onto the two error classes below: HsqldbSqlUnsupportedError is thrown for real SQL that this engine RECOGNISES and deliberately does not implement (JOIN, subquery, UNION, DISTINCT, HAVING, a scalar function, an alias, arithmetic -- each named individually in the message), and HsqldbSqlParseError for input that is not well-formed SQL at all under this grammar. HsqldbSqlEvaluationError is the third, later failure: a statement that parsed cleanly but cannot be executed against the table it was given (an unknown table or column, a type mismatch across a comparison, an aggregate misuse).

const MESSAGE_SQL_PREVIEW_LENGTH = 200;

function truncateForMessage(sql: string): string {
  return sql.length > MESSAGE_SQL_PREVIEW_LENGTH
    ? `${sql.slice(0, MESSAGE_SQL_PREVIEW_LENGTH)}...`
    : sql;
}

// A real SQL construct this engine recognises and deliberately does not implement. `construct` names exactly which one (e.g. 'JOIN', 'subquery', 'DISTINCT', 'scalar function UPPER'), so a caller can branch on the category rather than pattern-matching the message text; `sql` is the offending statement's own full source text, verbatim.
export class HsqldbSqlUnsupportedError extends Error {
  readonly construct: string;
  readonly sql: string;

  constructor(construct: string, sql: string) {
    super(
      `HSQLDB SQL: ${construct} is not supported by this bounded single-table query engine -- in statement: ${truncateForMessage(sql)}`,
    );
    this.name = "HsqldbSqlUnsupportedError";
    this.construct = construct;
    this.sql = sql;
  }
}

// Input that is not well-formed SQL at all under this engine's grammar -- a missing FROM, an unterminated string literal, a stray token. `offset` is the source position the failure was detected at, so a caller can point at it.
export class HsqldbSqlParseError extends Error {
  readonly sql: string;
  readonly offset: number;

  constructor(message: string, sql: string, offset: number) {
    super(
      `HSQLDB SQL parse error at offset ${String(offset)}: ${message} -- in statement: ${truncateForMessage(sql)}`,
    );
    this.name = "HsqldbSqlParseError";
    this.sql = sql;
    this.offset = offset;
  }
}

// A statement that parsed cleanly but cannot be executed against the table data it was handed: an unresolvable table or column name, a comparison between two genuinely incomparable value kinds, an aggregate applied to a non-numeric column, or a select list that GROUP BY cannot justify.
export class HsqldbSqlEvaluationError extends Error {
  readonly sql: string;

  constructor(message: string, sql: string) {
    super(
      `HSQLDB SQL evaluation error: ${message} -- in statement: ${truncateForMessage(sql)}`,
    );
    this.name = "HsqldbSqlEvaluationError";
    this.sql = sql;
  }
}
