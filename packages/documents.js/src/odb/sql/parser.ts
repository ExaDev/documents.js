import { HsqldbSqlParseError, HsqldbSqlUnsupportedError } from "./errors";
import type { SqlComparisonOperator, SqlToken } from "./lexer";
import { tokenizeSql } from "./lexer";

// A real recursive-descent grammar for the one statement shape src/odb/sql/ implements -- a single-table SELECT:
//
// - statement  := SELECT selectList FROM table [WHERE predicate] [GROUP BY columnList] [ORDER BY orderTerm {, orderTerm}] [;]
// - selectList := '*' | selectItem {, selectItem}
// - selectItem := columnRef | COUNT '(' ('*' | columnRef) ')' | (SUM|AVG|MIN|MAX) '(' columnRef ')'
// - predicate  := orExpr ; orExpr := andExpr {OR andExpr} ; andExpr := notExpr {AND notExpr} ; notExpr := NOT notExpr | primary
// - primary    := '(' predicate ')' | operand (compareOp operand | IS [NOT] NULL | [NOT] LIKE string | [NOT] IN '(' literal {, literal} ')' | [NOT] BETWEEN operand AND operand)
// - compareOp  := '=' | '<>' | '<' | '>' | '<=' | '>='
// - operand    := columnRef | literal ; literal := ['-'] number | string | TRUE | FALSE | NULL
// - columnRef  := identifier ['.' identifier] ; orderTerm := columnRef [ASC | DESC]
//
// JOINs, subqueries, UNION/INTERSECT/EXCEPT, DISTINCT, HAVING, row limits, aliases, CASE expressions, and every scalar function (anything beyond the five aggregates above) are deliberately NOT supported, and none of them is silently ignored: each is recognised by name and throws HsqldbSqlUnsupportedError. This is src/hsqldb/script.ts's own closed-allowlist policy applied to a grammar rather than to a statement list -- see src/odb/sql/errors.ts's top-of-file comment, which quotes that module's policy statement in full as the precedent being followed. Anything that is neither in the grammar above nor in the recognised out-of-scope vocabulary throws HsqldbSqlParseError. There is no path through this parser that discards part of a statement and returns the rest.

export type SqlAggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

const AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set<SqlAggregateFunction>([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
]);

function isAggregateFunction(keyword: string): keyword is SqlAggregateFunction {
  return AGGREGATE_FUNCTIONS.has(keyword);
}

// A name as written in the statement, not yet resolved against any real table. `quoted` records whether it arrived double-quoted, because that decides how it may be matched: see src/odb/sql/evaluate.ts's resolution rule (a quoted name matches case-sensitively and only exactly; an unquoted one, already folded to upper case by the lexer, may also match a real name case-insensitively).
export interface SqlNameRef {
  readonly name: string;
  readonly quoted: boolean;
}

export interface SqlColumnRef {
  // The table qualifier, when the reference was written as "SALES"."REGION" rather than bare REGION.
  readonly qualifier: SqlNameRef | undefined;
  readonly column: SqlNameRef;
  // The reference's own source text, verbatim, for error messages.
  readonly text: string;
}

export type SqlLiteral =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "null" };

export type SqlOperand =
  | { readonly kind: "column"; readonly column: SqlColumnRef }
  | { readonly kind: "literal"; readonly literal: SqlLiteral };

export type SqlPredicate =
  | {
      readonly kind: "comparison";
      readonly operator: SqlComparisonOperator;
      readonly left: SqlOperand;
      readonly right: SqlOperand;
    }
  | {
      readonly kind: "isNull";
      readonly operand: SqlOperand;
      readonly negated: boolean;
    }
  | {
      readonly kind: "like";
      readonly operand: SqlOperand;
      readonly pattern: string;
      readonly negated: boolean;
    }
  | {
      readonly kind: "in";
      readonly operand: SqlOperand;
      readonly values: readonly SqlLiteral[];
      readonly negated: boolean;
    }
  | {
      readonly kind: "between";
      readonly operand: SqlOperand;
      readonly lower: SqlOperand;
      readonly upper: SqlOperand;
      readonly negated: boolean;
    }
  | { readonly kind: "not"; readonly predicate: SqlPredicate }
  | {
      readonly kind: "and";
      readonly left: SqlPredicate;
      readonly right: SqlPredicate;
    }
  | {
      readonly kind: "or";
      readonly left: SqlPredicate;
      readonly right: SqlPredicate;
    };

export type SqlAggregateArgument =
  | { readonly kind: "star" }
  | { readonly kind: "column"; readonly column: SqlColumnRef };

export type SqlSelectItem =
  | { readonly kind: "star" }
  | { readonly kind: "column"; readonly column: SqlColumnRef }
  // `outputName` is this item's own result-set column label: COUNT(*), SUM(AMOUNT) -- built from the argument's own written column name, so SUM(AMOUNT) and SUM("SALES"."AMOUNT") both label their column SUM(AMOUNT).
  | {
      readonly kind: "aggregate";
      readonly aggregate: SqlAggregateFunction;
      readonly argument: SqlAggregateArgument;
      readonly outputName: string;
    };

export type SqlSortDirection = "asc" | "desc";

export interface SqlOrderByTerm {
  readonly column: SqlColumnRef;
  readonly direction: SqlSortDirection;
}

export interface SqlSelectStatement {
  // The statement's own source text, verbatim -- carried through so an evaluation failure can quote the statement that produced it.
  readonly sql: string;
  readonly items: readonly SqlSelectItem[];
  readonly from: SqlNameRef;
  readonly where: SqlPredicate | undefined;
  readonly groupBy: readonly SqlColumnRef[];
  readonly orderBy: readonly SqlOrderByTerm[];
}

// Every keyword this engine recognises as real SQL and deliberately does not implement, mapped to the construct name reported to the caller. Scanned across the whole token stream before parsing starts (see rejectOutOfScopeConstructs), so a JOIN or a HAVING is named as itself rather than surfacing as a baffling "unexpected keyword" from wherever the recursive descent happened to stop.
const OUT_OF_SCOPE_KEYWORDS: ReadonlyMap<string, string> = new Map([
  ["JOIN", "a JOIN"],
  ["INNER", "a JOIN"],
  ["OUTER", "a JOIN"],
  ["LEFT", "a JOIN"],
  ["RIGHT", "a JOIN"],
  ["FULL", "a JOIN"],
  ["CROSS", "a JOIN"],
  ["NATURAL", "a JOIN"],
  ["ON", "a JOIN"],
  ["USING", "a JOIN"],
  ["UNION", "UNION"],
  ["INTERSECT", "INTERSECT"],
  ["EXCEPT", "EXCEPT"],
  ["MINUS", "EXCEPT (MINUS)"],
  ["DISTINCT", "DISTINCT"],
  ["ALL", "the ALL quantifier"],
  ["HAVING", "HAVING"],
  ["LIMIT", "a row-limit clause (LIMIT)"],
  ["OFFSET", "a row-limit clause (OFFSET)"],
  ["FETCH", "a row-limit clause (FETCH)"],
  ["TOP", "a row-limit clause (TOP)"],
  ["AS", "a column or table alias (AS)"],
  ["CASE", "a CASE expression"],
  ["WHEN", "a CASE expression"],
  ["THEN", "a CASE expression"],
  ["ELSE", "a CASE expression"],
  ["END", "a CASE expression"],
  ["EXISTS", "an EXISTS subquery"],
  ["ANY", "a quantified subquery predicate (ANY)"],
  ["SOME", "a quantified subquery predicate (SOME)"],
  ["WITH", "a common table expression (WITH)"],
  ["INTO", "a SELECT ... INTO clause"],
  ["INSERT", "a non-SELECT statement (INSERT)"],
  ["UPDATE", "a non-SELECT statement (UPDATE)"],
  ["DELETE", "a non-SELECT statement (DELETE)"],
  ["CREATE", "a non-SELECT statement (CREATE)"],
  ["DROP", "a non-SELECT statement (DROP)"],
  ["ALTER", "a non-SELECT statement (ALTER)"],
  ["ESCAPE", "a LIKE ... ESCAPE clause"],
  ["COLLATE", "a COLLATE clause"],
  ["NULLS", "an ORDER BY NULLS FIRST/LAST clause"],
]);

function describeToken(token: SqlToken): string {
  switch (token.kind) {
    case "keyword":
      return `keyword "${token.keyword}"`;
    case "identifier":
      return `identifier "${token.text}"`;
    case "string":
      return `string literal ${token.text}`;
    case "number":
      return `numeric literal ${token.text}`;
    case "operator":
      return `operator "${token.operator}"`;
    case "punctuation":
      return `"${token.punctuation}"`;
    case "end":
      return "end of statement";
  }
}

// The pre-scan half of this module's closed allowlist: walk every token once and reject each recognised out-of-scope construct by name before the grammar below ever runs. Three rules, in the order a reader would want them reported: a named out-of-scope keyword; a SELECT anywhere but the first token (a subquery, whatever syntactic position it sits in); and an identifier immediately followed by "(" -- necessarily a scalar function call, since the only function calls this grammar has are the five aggregates, and those lex as keywords rather than identifiers.
function rejectOutOfScopeConstructs(
  tokens: readonly SqlToken[],
  sql: string,
): void {
  tokens.forEach((token, index) => {
    if (token.kind === "keyword") {
      const construct = OUT_OF_SCOPE_KEYWORDS.get(token.keyword);
      if (construct !== undefined) {
        throw new HsqldbSqlUnsupportedError(construct, sql);
      }
      if (token.keyword === "SELECT" && index > 0) {
        throw new HsqldbSqlUnsupportedError("a subquery", sql);
      }
      return;
    }
    if (token.kind === "identifier") {
      const next = tokens[index + 1];
      if (next?.kind === "punctuation" && next.punctuation === "(") {
        throw new HsqldbSqlUnsupportedError(
          `a scalar function (${token.text})`,
          sql,
        );
      }
    }
  });
}

class SqlParser {
  private readonly tokens: readonly SqlToken[];
  private readonly sql: string;
  private index = 0;

  constructor(sql: string) {
    this.sql = sql;
    this.tokens = tokenizeSql(sql);
    rejectOutOfScopeConstructs(this.tokens, sql);
  }

  // Never returns undefined: tokenizeSql always terminates the stream with an 'end' token, and nothing below advances past it -- an index beyond that is a bug in this parser, and throws rather than being papered over.
  private peek(): SqlToken {
    const token = this.tokens[this.index];
    if (token === undefined) {
      throw new HsqldbSqlParseError(
        "unexpected end of statement",
        this.sql,
        this.sql.length,
      );
    }
    return token;
  }

  private advance(): SqlToken {
    const token = this.peek();
    if (token.kind !== "end") {
      this.index += 1;
    }
    return token;
  }

  private fail(expected: string): never {
    const token = this.peek();
    throw new HsqldbSqlParseError(
      `expected ${expected}, found ${describeToken(token)}`,
      this.sql,
      token.start,
    );
  }

  private atKeyword(keyword: string): boolean {
    const token = this.peek();
    return token.kind === "keyword" && token.keyword === keyword;
  }

  private atPunctuation(punctuation: string): boolean {
    const token = this.peek();
    return token.kind === "punctuation" && token.punctuation === punctuation;
  }

  private takeKeyword(keyword: string): void {
    if (!this.atKeyword(keyword)) {
      this.fail(`keyword ${keyword}`);
    }
    this.advance();
  }

  private takePunctuation(punctuation: string): void {
    if (!this.atPunctuation(punctuation)) {
      this.fail(`"${punctuation}"`);
    }
    this.advance();
  }

  private takeName(what: string): SqlNameRef {
    const token = this.peek();
    if (token.kind !== "identifier") {
      this.fail(what);
    }
    this.advance();
    return { name: token.name, quoted: token.quoted };
  }

  private parseColumnRef(): SqlColumnRef {
    const start = this.peek().start;
    const first = this.takeName("a column name");
    if (this.atPunctuation(".")) {
      this.advance();
      const second = this.takeName('a column name after "."');
      return {
        qualifier: first,
        column: second,
        text: this.sql.slice(start, this.previousEnd()),
      };
    }
    return {
      qualifier: undefined,
      column: first,
      text: this.sql.slice(start, this.previousEnd()),
    };
  }

  // The source offset just past the token most recently consumed, so a multi-token construct can quote its own exact source text.
  private previousEnd(): number {
    const previous = this.tokens[this.index - 1];
    if (previous === undefined) {
      throw new HsqldbSqlParseError(
        "unexpected end of statement",
        this.sql,
        this.sql.length,
      );
    }
    return previous.start + previous.text.length;
  }

  private parseAggregate(aggregate: SqlAggregateFunction): SqlSelectItem {
    this.advance();
    this.takePunctuation("(");
    if (this.atPunctuation("*")) {
      if (aggregate !== "COUNT") {
        this.fail(
          `a column name -- ${aggregate}(*) is not valid SQL, only COUNT(*) is`,
        );
      }
      this.advance();
      this.takePunctuation(")");
      return {
        kind: "aggregate",
        aggregate,
        argument: { kind: "star" },
        outputName: "COUNT(*)",
      };
    }
    const column = this.parseColumnRef();
    this.takePunctuation(")");
    return {
      kind: "aggregate",
      aggregate,
      argument: { kind: "column", column },
      outputName: `${aggregate}(${column.column.name})`,
    };
  }

  private parseSelectItem(): SqlSelectItem {
    const token = this.peek();
    if (token.kind === "keyword" && isAggregateFunction(token.keyword)) {
      return this.parseAggregate(token.keyword);
    }
    return { kind: "column", column: this.parseColumnRef() };
  }

  private parseSelectList(): readonly SqlSelectItem[] {
    if (this.atPunctuation("*")) {
      this.advance();
      if (this.atPunctuation(",")) {
        throw new HsqldbSqlUnsupportedError(
          'a select list mixing "*" with named columns',
          this.sql,
        );
      }
      return [{ kind: "star" }];
    }
    const items: SqlSelectItem[] = [this.parseSelectItem()];
    while (this.atPunctuation(",")) {
      this.advance();
      if (this.atPunctuation("*")) {
        throw new HsqldbSqlUnsupportedError(
          'a select list mixing "*" with named columns',
          this.sql,
        );
      }
      items.push(this.parseSelectItem());
    }
    return items;
  }

  private parseLiteral(): SqlLiteral {
    const token = this.peek();
    if (token.kind === "punctuation" && token.punctuation === "-") {
      this.advance();
      const number = this.peek();
      if (number.kind !== "number") {
        throw new HsqldbSqlUnsupportedError(
          "an arithmetic expression",
          this.sql,
        );
      }
      this.advance();
      return { kind: "number", value: -number.value };
    }
    if (token.kind === "number") {
      this.advance();
      return { kind: "number", value: token.value };
    }
    if (token.kind === "string") {
      this.advance();
      return { kind: "string", value: token.value };
    }
    if (
      token.kind === "keyword" &&
      (token.keyword === "TRUE" || token.keyword === "FALSE")
    ) {
      this.advance();
      return { kind: "boolean", value: token.keyword === "TRUE" };
    }
    if (token.kind === "keyword" && token.keyword === "NULL") {
      this.advance();
      return { kind: "null" };
    }
    this.fail("a literal value");
  }

  private parseOperand(): SqlOperand {
    const token = this.peek();
    if (token.kind === "identifier") {
      return { kind: "column", column: this.parseColumnRef() };
    }
    if (token.kind === "punctuation" && token.punctuation === "(") {
      throw new HsqldbSqlUnsupportedError(
        "a parenthesised value expression",
        this.sql,
      );
    }
    return { kind: "literal", literal: this.parseLiteral() };
  }

  private parseInList(operand: SqlOperand, negated: boolean): SqlPredicate {
    this.takePunctuation("(");
    const values: SqlLiteral[] = [];
    for (;;) {
      if (this.peek().kind === "identifier") {
        throw new HsqldbSqlUnsupportedError(
          "a column reference inside an IN list",
          this.sql,
        );
      }
      values.push(this.parseLiteral());
      if (this.atPunctuation(",")) {
        this.advance();
        continue;
      }
      break;
    }
    this.takePunctuation(")");
    return { kind: "in", operand, values, negated };
  }

  private parseLike(operand: SqlOperand, negated: boolean): SqlPredicate {
    const token = this.peek();
    if (token.kind !== "string") {
      if (token.kind === "identifier") {
        throw new HsqldbSqlUnsupportedError(
          "a non-literal LIKE pattern",
          this.sql,
        );
      }
      this.fail("a string literal LIKE pattern");
    }
    this.advance();
    return { kind: "like", operand, pattern: token.value, negated };
  }

  private parseBetween(operand: SqlOperand, negated: boolean): SqlPredicate {
    const lower = this.parseOperand();
    this.takeKeyword("AND");
    const upper = this.parseOperand();
    return { kind: "between", operand, lower, upper, negated };
  }

  private parseNegatedPostfix(operand: SqlOperand): SqlPredicate {
    this.advance();
    if (this.atKeyword("LIKE")) {
      this.advance();
      return this.parseLike(operand, true);
    }
    if (this.atKeyword("IN")) {
      this.advance();
      return this.parseInList(operand, true);
    }
    if (this.atKeyword("BETWEEN")) {
      this.advance();
      return this.parseBetween(operand, true);
    }
    this.fail("keyword LIKE, IN or BETWEEN after NOT");
  }

  private parsePostfix(operand: SqlOperand): SqlPredicate {
    const token = this.peek();
    if (token.kind === "operator") {
      this.advance();
      return {
        kind: "comparison",
        operator: token.operator,
        left: operand,
        right: this.parseOperand(),
      };
    }
    if (
      token.kind === "punctuation" &&
      (token.punctuation === "*" || token.punctuation === "-")
    ) {
      throw new HsqldbSqlUnsupportedError("an arithmetic expression", this.sql);
    }
    if (token.kind === "keyword") {
      if (token.keyword === "IS") {
        this.advance();
        const negated = this.atKeyword("NOT");
        if (negated) {
          this.advance();
        }
        this.takeKeyword("NULL");
        return { kind: "isNull", operand, negated };
      }
      if (token.keyword === "LIKE") {
        this.advance();
        return this.parseLike(operand, false);
      }
      if (token.keyword === "IN") {
        this.advance();
        return this.parseInList(operand, false);
      }
      if (token.keyword === "BETWEEN") {
        this.advance();
        return this.parseBetween(operand, false);
      }
      if (token.keyword === "NOT") {
        return this.parseNegatedPostfix(operand);
      }
    }
    this.fail("a comparison operator, or keyword IS, LIKE, IN or BETWEEN");
  }

  private parsePrimary(): SqlPredicate {
    if (this.atPunctuation("(")) {
      this.advance();
      const predicate = this.parsePredicate();
      this.takePunctuation(")");
      return predicate;
    }
    return this.parsePostfix(this.parseOperand());
  }

  private parseNot(): SqlPredicate {
    if (this.atKeyword("NOT")) {
      this.advance();
      return { kind: "not", predicate: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parseAnd(): SqlPredicate {
    let predicate = this.parseNot();
    while (this.atKeyword("AND")) {
      this.advance();
      predicate = { kind: "and", left: predicate, right: this.parseNot() };
    }
    return predicate;
  }

  private parsePredicate(): SqlPredicate {
    let predicate = this.parseAnd();
    while (this.atKeyword("OR")) {
      this.advance();
      predicate = { kind: "or", left: predicate, right: this.parseAnd() };
    }
    return predicate;
  }

  private parseGroupBy(): readonly SqlColumnRef[] {
    this.takeKeyword("GROUP");
    this.takeKeyword("BY");
    const columns: SqlColumnRef[] = [this.parseGroupByColumn()];
    while (this.atPunctuation(",")) {
      this.advance();
      columns.push(this.parseGroupByColumn());
    }
    return columns;
  }

  private parseGroupByColumn(): SqlColumnRef {
    const token = this.peek();
    if (token.kind === "keyword" && isAggregateFunction(token.keyword)) {
      this.fail(
        "a column name -- an aggregate function is not valid in GROUP BY",
      );
    }
    return this.parseColumnRef();
  }

  private parseOrderBy(): readonly SqlOrderByTerm[] {
    this.takeKeyword("ORDER");
    this.takeKeyword("BY");
    const terms: SqlOrderByTerm[] = [this.parseOrderByTerm()];
    while (this.atPunctuation(",")) {
      this.advance();
      terms.push(this.parseOrderByTerm());
    }
    return terms;
  }

  private parseOrderByTerm(): SqlOrderByTerm {
    const token = this.peek();
    if (token.kind === "keyword" && isAggregateFunction(token.keyword)) {
      throw new HsqldbSqlUnsupportedError(
        "an aggregate function in ORDER BY",
        this.sql,
      );
    }
    if (token.kind === "number") {
      throw new HsqldbSqlUnsupportedError(
        "an ordinal column reference in ORDER BY (ORDER BY 1)",
        this.sql,
      );
    }
    const column = this.parseColumnRef();
    if (this.atKeyword("ASC")) {
      this.advance();
      return { column, direction: "asc" };
    }
    if (this.atKeyword("DESC")) {
      this.advance();
      return { column, direction: "desc" };
    }
    return { column, direction: "asc" };
  }

  parseStatement(): SqlSelectStatement {
    const first = this.peek();
    if (!(first.kind === "keyword" && first.keyword === "SELECT")) {
      this.fail("keyword SELECT");
    }
    this.advance();

    const items = this.parseSelectList();
    this.takeKeyword("FROM");
    if (this.atPunctuation("(")) {
      throw new HsqldbSqlUnsupportedError("a derived table in FROM", this.sql);
    }
    const from = this.takeName("a table name");
    if (this.atPunctuation(".")) {
      // A schema-qualified table name (PUBLIC.SALES) resolves against a schema catalogue this engine has no model of at all -- readOdbTables hands it a flat table list with no schema dimension.
      throw new HsqldbSqlUnsupportedError(
        "a schema-qualified table name",
        this.sql,
      );
    }
    if (this.atPunctuation(",")) {
      throw new HsqldbSqlUnsupportedError("a JOIN", this.sql);
    }
    if (this.peek().kind === "identifier") {
      throw new HsqldbSqlUnsupportedError("a table alias", this.sql);
    }

    let where: SqlPredicate | undefined;
    if (this.atKeyword("WHERE")) {
      this.advance();
      where = this.parsePredicate();
    }
    const groupBy = this.atKeyword("GROUP") ? this.parseGroupBy() : [];
    const orderBy = this.atKeyword("ORDER") ? this.parseOrderBy() : [];

    if (this.atPunctuation(";")) {
      this.advance();
    }
    if (this.peek().kind !== "end") {
      this.fail("end of statement");
    }

    return { sql: this.sql, items, from, where, groupBy, orderBy };
  }
}

export function parseSelect(sql: string): SqlSelectStatement {
  return new SqlParser(sql).parseStatement();
}
