import { HsqldbSqlParseError, HsqldbSqlUnsupportedError } from "./errors";

// The tokeniser for src/odb/sql/'s bounded SELECT engine: SQL text in, a flat SqlToken[] out, ending in exactly one 'end' token. It makes no grammatical decisions at all -- SELECT and JOIN are both just keyword tokens here, and it is the parser (src/odb/sql/parser.ts) that accepts the first and rejects the second.
//
// It does apply the same closed-allowlist policy src/hsqldb/script.ts's own statement recognition does (see src/odb/sql/errors.ts's top-of-file comment for the full statement of the precedent being followed), just at the character level: KEYWORDS below is the set of words that lex as keywords rather than identifiers -- deliberately including every out-of-scope word (JOIN, DISTINCT, UNION, HAVING, ...) so the parser can name the construct it is refusing rather than reporting a baffling "unexpected identifier"; UNSUPPORTED_SYMBOLS names every symbol this engine recognises as real SQL and deliberately does not implement (arithmetic, string concatenation, comments, parameter placeholders, the != operator), each throwing HsqldbSqlUnsupportedError naming itself; and any character matching neither list throws HsqldbSqlParseError rather than being skipped.
//
// Identifier folding follows SQL's own rule, which both HSQLDB and Firebird implement and which real LibreOffice-generated .odb queries depend on: an unquoted identifier is case-insensitive and folds to upper case, a double-quoted identifier is case-sensitive and is taken verbatim (with "" as an embedded double quote). `quoted` is kept on the token so the parser and evaluator can honour that distinction when resolving a name against real table/column names -- see src/odb/sql/evaluate.ts's own resolution rule.

export type SqlComparisonOperator = "=" | "<>" | "<" | ">" | "<=" | ">=";

// '-' is punctuation rather than an operator here because it is genuinely ambiguous between a numeric literal's sign and subtraction: unlike the arithmetic symbols in UNSUPPORTED_SYMBOLS below it has a legitimate use in this grammar, so it is passed through for the parser to resolve (a sign where a literal is expected, unsupported arithmetic everywhere else).
export type SqlPunctuation = "(" | ")" | "," | "." | "*" | ";" | "-";

export type SqlToken =
  | {
      readonly kind: "keyword";
      readonly keyword: string;
      readonly text: string;
      readonly start: number;
    }
  | {
      readonly kind: "identifier";
      readonly name: string;
      readonly quoted: boolean;
      readonly text: string;
      readonly start: number;
    }
  | {
      readonly kind: "string";
      readonly value: string;
      readonly text: string;
      readonly start: number;
    }
  | {
      readonly kind: "number";
      readonly value: number;
      readonly text: string;
      readonly start: number;
    }
  | {
      readonly kind: "operator";
      readonly operator: SqlComparisonOperator;
      readonly text: string;
      readonly start: number;
    }
  | {
      readonly kind: "punctuation";
      readonly punctuation: SqlPunctuation;
      readonly text: string;
      readonly start: number;
    }
  | { readonly kind: "end"; readonly text: string; readonly start: number };

// Every word that lexes as a keyword rather than an identifier. The first group is this engine's own grammar; the second is the deliberately-recognised out-of-scope vocabulary, present here for the sole purpose of letting the parser reject it by name (see this module's top-of-file comment). A word in neither group lexes as an identifier, so an ordinary column called STATUS or TOTAL is never mistaken for syntax; a column genuinely called COUNT or ORDER must be double-quoted, exactly as it must be in real HSQLDB/Firebird SQL.
const KEYWORDS: ReadonlySet<string> = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "ORDER",
  "ASC",
  "DESC",
  "AND",
  "OR",
  "NOT",
  "IS",
  "NULL",
  "LIKE",
  "IN",
  "BETWEEN",
  "TRUE",
  "FALSE",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "JOIN",
  "INNER",
  "OUTER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "NATURAL",
  "ON",
  "USING",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "MINUS",
  "DISTINCT",
  "ALL",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "FETCH",
  "TOP",
  "AS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "EXISTS",
  "ANY",
  "SOME",
  "WITH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "INTO",
  "VALUES",
  "SET",
  "ESCAPE",
  "COLLATE",
  "NULLS",
  "FIRST",
  "LAST",
]);

// Symbols this engine recognises as genuine SQL and deliberately does not implement. Checked longest-first so '||' beats '|' and '!=' beats '!'. Each entry's value is the construct name reported by HsqldbSqlUnsupportedError.
const UNSUPPORTED_SYMBOLS: readonly (readonly [string, string])[] = [
  ["--", "a SQL line comment"],
  ["/*", "a SQL block comment"],
  ["||", "the || string-concatenation operator"],
  ["!=", "the != operator (write <> instead)"],
  ["+", "an arithmetic expression"],
  ["/", "an arithmetic expression"],
  ["%", "an arithmetic expression"],
  ["?", "a parameter placeholder"],
  [":", "a named parameter"],
  ["@", "a variable reference"],
  ["#", "a variable reference"],
  ["&", "a bitwise operator"],
  ["|", "a bitwise operator"],
  ["^", "a bitwise operator"],
  ["~", "a bitwise operator"],
  ["!", "the ! operator"],
];

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isIdentifierStart(character: string): boolean {
  return (
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    character === "_"
  );
}

function isIdentifierPart(character: string): boolean {
  return (
    isIdentifierStart(character) || isDigit(character) || character === "$"
  );
}

function isWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f" ||
    character === "\v"
  );
}

// A signed numeric literal is NOT lexed here: '-' reaches the parser as its own token, which reads it as the sign of a following numeric literal in a literal position and otherwise reports it as unsupported arithmetic. Doing it this way keeps 'AMOUNT >= -100' working without also silently accepting 'AMOUNT - 100 >= 0', which this engine has no expression evaluator for.
function readNumber(
  sql: string,
  start: number,
): { readonly value: number; readonly next: number } {
  let cursor = start;
  while (cursor < sql.length && isDigit(sql.charAt(cursor))) {
    cursor += 1;
  }
  if (cursor < sql.length && sql.charAt(cursor) === ".") {
    cursor += 1;
    while (cursor < sql.length && isDigit(sql.charAt(cursor))) {
      cursor += 1;
    }
  }
  if (
    cursor < sql.length &&
    (sql.charAt(cursor) === "e" || sql.charAt(cursor) === "E")
  ) {
    const exponentStart = cursor;
    cursor += 1;
    if (
      cursor < sql.length &&
      (sql.charAt(cursor) === "+" || sql.charAt(cursor) === "-")
    ) {
      cursor += 1;
    }
    if (cursor < sql.length && isDigit(sql.charAt(cursor))) {
      while (cursor < sql.length && isDigit(sql.charAt(cursor))) {
        cursor += 1;
      }
    } else {
      // 'E' that isn't followed by a real exponent belongs to whatever comes next (a column called E1, say), not to this number.
      cursor = exponentStart;
    }
  }
  const text = sql.slice(start, cursor);
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new HsqldbSqlParseError(
      `numeric literal "${text}" is not a finite number`,
      sql,
      start,
    );
  }
  return { value, next: cursor };
}

// A '...' literal, with '' as an embedded single quote -- the same escape convention src/hsqldb/script.ts's own INSERT-literal parsing already handles for HSQLDB script text.
function readStringLiteral(
  sql: string,
  start: number,
): { readonly value: string; readonly next: number } {
  let cursor = start + 1;
  let value = "";
  while (cursor < sql.length) {
    const character = sql.charAt(cursor);
    if (character === "'") {
      if (sql.charAt(cursor + 1) === "'") {
        value += "'";
        cursor += 2;
        continue;
      }
      return { value, next: cursor + 1 };
    }
    value += character;
    cursor += 1;
  }
  throw new HsqldbSqlParseError("unterminated string literal", sql, start);
}

// A "..." delimited identifier, with "" as an embedded double quote (SQL's own escape, and what LibreOffice writes for a column whose name contains one).
function readQuotedIdentifier(
  sql: string,
  start: number,
): { readonly name: string; readonly next: number } {
  let cursor = start + 1;
  let name = "";
  while (cursor < sql.length) {
    const character = sql.charAt(cursor);
    if (character === '"') {
      if (sql.charAt(cursor + 1) === '"') {
        name += '"';
        cursor += 2;
        continue;
      }
      if (name === "") {
        throw new HsqldbSqlParseError(
          'empty quoted identifier ("")',
          sql,
          start,
        );
      }
      return { name, next: cursor + 1 };
    }
    name += character;
    cursor += 1;
  }
  throw new HsqldbSqlParseError("unterminated quoted identifier", sql, start);
}

function unsupportedSymbolAt(sql: string, cursor: number): string | undefined {
  for (const [symbol, construct] of UNSUPPORTED_SYMBOLS) {
    if (sql.startsWith(symbol, cursor)) {
      return construct;
    }
  }
  return undefined;
}

export function tokenizeSql(sql: string): readonly SqlToken[] {
  const tokens: SqlToken[] = [];
  let cursor = 0;

  while (cursor < sql.length) {
    const character = sql.charAt(cursor);

    if (isWhitespace(character)) {
      cursor += 1;
      continue;
    }

    if (character === "'") {
      const start = cursor;
      const literal = readStringLiteral(sql, cursor);
      cursor = literal.next;
      tokens.push({
        kind: "string",
        value: literal.value,
        text: sql.slice(start, cursor),
        start,
      });
      continue;
    }

    if (character === '"') {
      const start = cursor;
      const identifier = readQuotedIdentifier(sql, cursor);
      cursor = identifier.next;
      tokens.push({
        kind: "identifier",
        name: identifier.name,
        quoted: true,
        text: sql.slice(start, cursor),
        start,
      });
      continue;
    }

    if (
      isDigit(character) ||
      (character === "." && isDigit(sql.charAt(cursor + 1)))
    ) {
      const start = cursor;
      const numeric = readNumber(sql, cursor);
      cursor = numeric.next;
      tokens.push({
        kind: "number",
        value: numeric.value,
        text: sql.slice(start, cursor),
        start,
      });
      continue;
    }

    if (isIdentifierStart(character)) {
      const start = cursor;
      while (cursor < sql.length && isIdentifierPart(sql.charAt(cursor))) {
        cursor += 1;
      }
      const text = sql.slice(start, cursor);
      const folded = text.toUpperCase();
      if (KEYWORDS.has(folded)) {
        tokens.push({ kind: "keyword", keyword: folded, text, start });
      } else {
        tokens.push({
          kind: "identifier",
          name: folded,
          quoted: false,
          text,
          start,
        });
      }
      continue;
    }

    // Comparison operators, longest first so '<=' and '>=' beat '<' and '>', and '<>' beats '<'.
    if (character === "<" || character === ">" || character === "=") {
      const start = cursor;
      const twoCharacter = sql.slice(cursor, cursor + 2);
      if (
        twoCharacter === "<=" ||
        twoCharacter === ">=" ||
        twoCharacter === "<>"
      ) {
        cursor += 2;
        tokens.push({
          kind: "operator",
          operator: twoCharacter,
          text: twoCharacter,
          start,
        });
        continue;
      }
      cursor += 1;
      tokens.push({
        kind: "operator",
        operator: character,
        text: character,
        start,
      });
      continue;
    }

    // Checked before the single-character punctuation below so '--' is reported as a comment rather than lexing as two minus signs, and '/*' as a comment rather than a division.
    const unsupported = unsupportedSymbolAt(sql, cursor);
    if (unsupported !== undefined) {
      throw new HsqldbSqlUnsupportedError(unsupported, sql);
    }

    if (
      character === "(" ||
      character === ")" ||
      character === "," ||
      character === "." ||
      character === "*" ||
      character === ";" ||
      character === "-"
    ) {
      tokens.push({
        kind: "punctuation",
        punctuation: character,
        text: character,
        start: cursor,
      });
      cursor += 1;
      continue;
    }

    throw new HsqldbSqlParseError(
      `unexpected character "${character}"`,
      sql,
      cursor,
    );
  }

  tokens.push({ kind: "end", text: "", start: sql.length });
  return tokens;
}
