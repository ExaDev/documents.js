import { HsqldbSqlParseError, HsqldbSqlUnsupportedError } from "./errors";
import type { SqlComparisonOperator, SqlToken } from "./lexer";
import { tokenizeSql } from "./lexer";

// A real recursive-descent grammar for the one statement shape src/odb/sql/ implements -- a SELECT over one table (or one derived table) plus zero or more JOINs of any kind:
//
// - statement  := selectBody [;]
// - selectBody := SELECT selectList FROM fromSource {joinClause} [WHERE predicate] [GROUP BY columnList] [ORDER BY orderTerm {, orderTerm}]
// - fromSource := tableRef | '(' selectBody ')' [AS] identifier
// - joinClause := [NATURAL] (INNER | LEFT [OUTER] | RIGHT [OUTER] | FULL [OUTER] | CROSS)? JOIN tableRef (ON predicate | USING '(' identifier {, identifier} ')')?
//   -- a bare JOIN (no leading keyword) is INNER; ON or USING is required for a plain/INNER/LEFT/RIGHT/FULL join unless NATURAL supplies the condition implicitly; CROSS JOIN takes none of NATURAL, ON, or USING.
// - tableRef   := identifier [[AS] identifier]
// - selectList := '*' | selectItem {, selectItem}
// - selectItem := columnRef | COUNT '(' ('*' | columnRef) ')' | (SUM|AVG|MIN|MAX) '(' columnRef ')'
// - predicate  := orExpr ; orExpr := andExpr {OR andExpr} ; andExpr := notExpr {AND notExpr} ; notExpr := NOT notExpr | primary
// - primary    := '(' predicate ')' | [NOT] EXISTS '(' selectBody ')' | operand (compareOp operand | IS [NOT] NULL | [NOT] LIKE string | [NOT] IN '(' (literal {, literal} | selectBody) ')' | [NOT] BETWEEN operand AND operand)
// - compareOp  := '=' | '<>' | '<' | '>' | '<=' | '>='
// - operand    := columnRef | literal ; literal := ['-'] number | string | TRUE | FALSE | NULL
// - columnRef  := identifier ['.' identifier] ; orderTerm := columnRef [ASC | DESC]
//
// ON's own predicate is the identical `predicate` production WHERE uses -- there is no separate join-condition grammar, so anything a WHERE clause can express (comparisons, AND/OR/NOT, IS NULL, LIKE, IN, BETWEEN, EXISTS) an ON clause can too.
//
// A table reference -- the base FROM table or any JOIN's own table -- may carry an alias, written with or without AS. Once given, the alias is the only name that reaches column-reference resolution for that table (see src/odb/sql/evaluate.ts's own qualifier-resolution rule); this is what makes a genuine self-join (FROM T t1 JOIN T t2 ON ...) resolvable at all, since without an alias two occurrences of the same table name have no way to tell their columns apart and any reference to either is ambiguous. A derived table (fromSource's parenthesised form) carries the identical alias grammar, except its own alias is REQUIRED rather than optional -- unlike a real table, it has no name of its own for a later column reference or JOIN to qualify against.
//
// USING and NATURAL JOIN both express an equi-join over columns the two sides share -- USING names them explicitly, NATURAL finds every column name both sides declare -- and src/odb/sql/evaluate.ts merges each shared pair into one output column, COALESCE(left, right), so an outer join's NULL side never hides the other. This follows PostgreSQL's own documented USING/NATURAL semantics (one merged output column per shared pair, redundant columns suppressed) rather than inventing bespoke behaviour -- see https://www.postgresql.org/docs/current/queries-table-expressions.html.
//
// `selectBody` is the identical production wherever it recurs -- a derived table's own SELECT, or an IN (SELECT ...)/EXISTS (SELECT ...) operand's own SELECT -- so a subquery can itself JOIN (of any kind), filter, group, order, and nest a further subquery to whatever depth this grammar's own recursive descent naturally reaches; nothing here imposes an artificial depth limit.
//
// UNION/INTERSECT/EXCEPT, DISTINCT, HAVING, row limits, a comma-separated FROM list, column aliases, CASE expressions, quantified subquery predicates (ANY/SOME), and every scalar function (anything beyond the five aggregates above) are deliberately NOT supported, and none of them is silently ignored: each is recognised by name and throws HsqldbSqlUnsupportedError. This is src/hsqldb/script.ts's own closed-allowlist policy applied to a grammar rather than to a statement list -- see src/odb/sql/errors.ts's top-of-file comment, which quotes that module's policy statement in full as the precedent being followed. Anything that is neither in the grammar above nor in the recognised out-of-scope vocabulary throws HsqldbSqlParseError. There is no path through this parser that discards part of a statement and returns the rest.

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
  // IN (SELECT ...) -- kept as its own predicate kind rather than folding into "in" above, since the right-hand side is a query to evaluate rather than a literal list to compare against directly; see src/odb/sql/evaluate.ts's own evaluateInSubquery.
  | {
      readonly kind: "inSubquery";
      readonly operand: SqlOperand;
      readonly query: SqlSelectStatement;
      readonly negated: boolean;
    }
  | {
      readonly kind: "between";
      readonly operand: SqlOperand;
      readonly lower: SqlOperand;
      readonly upper: SqlOperand;
      readonly negated: boolean;
    }
  // EXISTS (SELECT ...) -- no operand and no `negated` flag of its own: NOT EXISTS parses as an ordinary "not" predicate wrapping this one (see parsePrimary below), the same mechanism every other predicate here is negated through except the postfix forms (LIKE/IN/BETWEEN), which write NOT before the keyword rather than around the whole predicate.
  | { readonly kind: "exists"; readonly query: SqlSelectStatement }
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

// The five join kinds this engine implements, independent of how the join's own condition is expressed (ON, USING, NATURAL, or -- for CROSS alone -- none at all).
export type SqlJoinKind = "inner" | "left" | "right" | "full" | "cross";

// How a join clause decides which row pairs match. USING/NATURAL both name an equi-join over shared columns -- USING explicitly, NATURAL by discovering every column name both sides declare -- and src/odb/sql/evaluate.ts merges each shared pair into one output column rather than keeping both (see this module's own top-of-file comment). CROSS JOIN carries "none": every row pair matches unconditionally.
export type SqlJoinCondition =
  | { readonly kind: "on"; readonly predicate: SqlPredicate }
  | { readonly kind: "using"; readonly columns: readonly SqlNameRef[] }
  | { readonly kind: "natural" }
  | { readonly kind: "none" };

// One join clause, in the order it was written -- src/odb/sql/evaluate.ts folds joins left to right, each one widening (or, for a USING/NATURAL join, reshaping) the row set the NEXT join clause and the statement's own WHERE/select list see. `alias`, once given, is the only name that reaches column-reference resolution for this table -- see this module's own top-of-file comment on why that is what makes a self-join resolvable.
export interface SqlJoinClause {
  readonly joinKind: SqlJoinKind;
  readonly table: SqlNameRef;
  readonly alias: SqlNameRef | undefined;
  readonly condition: SqlJoinCondition;
}

// The statement's own base FROM source -- a real table (with its own optional alias, exactly as a JOIN clause's own table carries -- SqlJoinClause.alias above), or a derived table (a subquery standing in for one, which unlike a real table must carry an alias since it has no name of its own). A JOIN clause's own target (SqlJoinClause.table above) stays a plain table reference: this engine's grammar only admits a derived table in the base FROM position, not as a JOIN target.
export type SqlFromSource =
  | {
      readonly kind: "table";
      readonly table: SqlNameRef;
      readonly alias: SqlNameRef | undefined;
    }
  | {
      readonly kind: "derived";
      readonly query: SqlSelectStatement;
      readonly alias: SqlNameRef;
    };

export interface SqlFromClause {
  readonly source: SqlFromSource;
  readonly joins: readonly SqlJoinClause[];
}

export interface SqlSelectStatement {
  // The statement's own source text, verbatim -- carried through so an evaluation failure can quote the statement that produced it.
  readonly sql: string;
  readonly items: readonly SqlSelectItem[];
  readonly from: SqlFromClause;
  readonly where: SqlPredicate | undefined;
  readonly groupBy: readonly SqlColumnRef[];
  readonly orderBy: readonly SqlOrderByTerm[];
}

// Every keyword this engine recognises as real SQL and deliberately does not implement, mapped to the construct name reported to the caller. Scanned across the whole token stream before parsing starts (see rejectOutOfScopeConstructs), so a HAVING or a DISTINCT is named as itself rather than surfacing as a baffling "unexpected keyword" from wherever the recursive descent happened to stop. JOIN, INNER, ON, OUTER, LEFT, RIGHT, FULL, CROSS, NATURAL, USING, AS, and EXISTS are all deliberately absent from this map -- they are real grammar now (see this module's own top-of-file note on the JOIN, table-alias, and subquery grammar). AS is worth stating explicitly: it is legal in a table-alias position (FROM T AS t, or a derived table's own alias) but a column alias (SELECT A AS x) is still out of scope, so that one case is rejected by parseSelectItem itself, at the point it is unambiguous, rather than by this blanket pre-scan. ANY/SOME (a quantified comparison, not the same construct as IN or EXISTS) stay out of scope.
const OUT_OF_SCOPE_KEYWORDS: ReadonlyMap<string, string> = new Map([
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
  ["CASE", "a CASE expression"],
  ["WHEN", "a CASE expression"],
  ["THEN", "a CASE expression"],
  ["ELSE", "a CASE expression"],
  ["END", "a CASE expression"],
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

// The pre-scan half of this module's closed allowlist: walk every token once and reject each recognised out-of-scope construct by name before the grammar below ever runs. Two rules, in the order a reader would want them reported: a named out-of-scope keyword (checked regardless of where in the statement it sits, including inside a derived table's own SELECT -- none of these become legal anywhere just because a derived table now is), and an identifier immediately followed by "(" -- necessarily a scalar function call, since the only function calls this grammar has are the five aggregates, and those lex as keywords rather than identifiers. A SELECT keyword past the first token is no longer rejected here: a derived table's own SELECT is real grammar now (see this module's own top-of-file note), so whether a nested SELECT is legal is a question the recursive-descent grammar below answers by position -- specifically, a derived table's own FROM -- rather than something this flat pre-scan can decide. IN and EXISTS still admit only a literal list or a scalar operand respectively, at this grammar's current scope: nothing here yet parses a SELECT in either position, so a construct like `IN (SELECT ...)` still fails, just as a plain parse error (an unexpected keyword where a literal was expected) rather than a named "a subquery" HsqldbSqlUnsupportedError.
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
    const item: SqlSelectItem =
      token.kind === "keyword" && isAggregateFunction(token.keyword)
        ? this.parseAggregate(token.keyword)
        : { kind: "column", column: this.parseColumnRef() };
    // A table alias is real grammar (see parseTableRefWithAlias), but a column alias is not: AS is deliberately absent from OUT_OF_SCOPE_KEYWORDS's blanket pre-scan for exactly this reason, so it is this call site's job to reject it once it is unambiguously a column alias rather than a table one.
    if (this.atKeyword("AS")) {
      throw new HsqldbSqlUnsupportedError("a column alias (AS)", this.sql);
    }
    return item;
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
    if (this.atKeyword("SELECT")) {
      const query = this.parseSelectBody();
      this.takePunctuation(")");
      return { kind: "inSubquery", operand, query, negated };
    }
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
    if (this.atKeyword("EXISTS")) {
      this.advance();
      this.takePunctuation("(");
      const query = this.parseSelectBody();
      this.takePunctuation(")");
      return { kind: "exists", query };
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

  // One real table name in FROM or a JOIN clause, with its optional alias -- the identical checks apply to both, since neither admits a derived table or a schema qualifier (a derived table's own required alias is a different production entirely, parseFromSource below, reachable only from the base FROM position). The comma-separated-FROM-list check is NOT here: it only ever applies right after the very first table (a JOIN clause's own table can never be followed by a bare comma, since parseJoins' own loop condition already requires a join keyword or nothing next), so it stays in parseSelectBody/parseJoins where that distinction is visible.
  private parseTableRefWithAlias(): {
    readonly table: SqlNameRef;
    readonly alias: SqlNameRef | undefined;
  } {
    if (this.atPunctuation("(")) {
      throw new HsqldbSqlUnsupportedError("a derived table in FROM", this.sql);
    }
    const table = this.takeName("a table name");
    if (this.atPunctuation(".")) {
      // A schema-qualified table name (PUBLIC.SALES) resolves against a schema catalogue this engine has no model of at all -- readOdbTables hands it a flat table list with no schema dimension.
      throw new HsqldbSqlUnsupportedError(
        "a schema-qualified table name",
        this.sql,
      );
    }
    return { table, alias: this.parseOptionalTableAlias() };
  }

  // AS is optional, exactly as real SQL allows (FROM T AS t and FROM T t are equivalent) -- an identifier straight after the table name, with no AS, is unambiguously an alias too, since nothing else this grammar accepts can follow a table name at that position (the next real token is always ON, USING, a join keyword, WHERE, GROUP, ORDER, ';', or end).
  private parseOptionalTableAlias(): SqlNameRef | undefined {
    if (this.atKeyword("AS")) {
      this.advance();
      return this.takeName("a table alias after AS");
    }
    if (this.peek().kind === "identifier") {
      return this.takeName("a table alias");
    }
    return undefined;
  }

  // A derived table's own alias, optionally introduced by AS exactly as a real table's is (parseOptionalTableAlias) -- but this position never allows omitting the alias entirely, since a derived table has no name of its own for a later column reference or JOIN to qualify against (see parseFromSource's own comment).
  private parseRequiredAlias(what: string): SqlNameRef {
    if (this.atKeyword("AS")) {
      this.advance();
      return this.takeName(`${what} after AS`);
    }
    return this.takeName(what);
  }

  // The statement's own base FROM source: either a real table (parseTableRefWithAlias's own rule, unchanged -- this branch is what makes "(" the ONLY thing that distinguishes a derived table from a real one here) or a derived table, `(` selectBody `)` [AS] identifier. Unlike a real table, a derived table MUST carry an alias -- it has no name of its own for a later column reference or JOIN to qualify against -- so the identifier (with or without a leading AS) immediately following the closing ")" is required, not merely permitted.
  private parseFromSource(): SqlFromSource {
    if (this.atPunctuation("(")) {
      this.advance();
      const query = this.parseSelectBody();
      this.takePunctuation(")");
      const alias = this.parseRequiredAlias("a derived table alias");
      return { kind: "derived", query, alias };
    }
    const { table, alias } = this.parseTableRefWithAlias();
    return { kind: "table", table, alias };
  }

  // The join-kind keyword(s), if any is next -- INNER, LEFT [OUTER], RIGHT [OUTER], FULL [OUTER], CROSS, or a bare JOIN (which defaults to "inner" without consuming JOIN itself, so the caller's own takeKeyword("JOIN") still runs uniformly for every kind). Returns undefined when none of these is next, which is how parseJoins knows the join list has ended.
  private parseJoinKind(): SqlJoinKind | undefined {
    if (this.atKeyword("INNER")) {
      this.advance();
      return "inner";
    }
    if (this.atKeyword("LEFT")) {
      this.advance();
      this.consumeOptionalOuter();
      return "left";
    }
    if (this.atKeyword("RIGHT")) {
      this.advance();
      this.consumeOptionalOuter();
      return "right";
    }
    if (this.atKeyword("FULL")) {
      this.advance();
      this.consumeOptionalOuter();
      return "full";
    }
    if (this.atKeyword("CROSS")) {
      this.advance();
      return "cross";
    }
    if (this.atKeyword("JOIN")) {
      return "inner";
    }
    return undefined;
  }

  private consumeOptionalOuter(): void {
    if (this.atKeyword("OUTER")) {
      this.advance();
    }
  }

  // A join's own condition, once its kind and NATURAL-ness are already known. CROSS JOIN takes none of NATURAL, ON, or USING (guarded by the caller for the NATURAL case, and simply never offered ON/USING here); NATURAL supplies its condition implicitly, discovered against real table data rather than parsed; every other kind requires exactly one of ON or USING.
  private parseJoinCondition(
    joinKind: SqlJoinKind,
    natural: boolean,
  ): SqlJoinCondition {
    if (natural) {
      return { kind: "natural" };
    }
    if (joinKind === "cross") {
      return { kind: "none" };
    }
    if (this.atKeyword("USING")) {
      this.advance();
      this.takePunctuation("(");
      const columns: SqlNameRef[] = [this.takeName("a column name in USING")];
      while (this.atPunctuation(",")) {
        this.advance();
        columns.push(this.takeName("a column name in USING"));
      }
      this.takePunctuation(")");
      return { kind: "using", columns };
    }
    this.takeKeyword("ON");
    return { kind: "on", predicate: this.parsePredicate() };
  }

  // Zero or more join clauses, folded left to right by src/odb/sql/evaluate.ts. Stops the moment no NATURAL and no join-kind keyword is next -- including at a bare comma, which parseSelectBody's own caller checks for and reports as the deliberately-unsupported comma-separated FROM list.
  private parseJoins(): readonly SqlJoinClause[] {
    const joins: SqlJoinClause[] = [];
    for (;;) {
      const natural = this.atKeyword("NATURAL");
      if (natural) {
        this.advance();
      }
      const joinKind = this.parseJoinKind();
      if (joinKind === undefined) {
        if (natural) {
          this.fail("keyword JOIN, INNER, LEFT, RIGHT or FULL after NATURAL");
        }
        break;
      }
      if (natural && joinKind === "cross") {
        this.fail(
          "keyword JOIN, INNER, LEFT, RIGHT or FULL after NATURAL (NATURAL CROSS JOIN is not valid SQL)",
        );
      }
      this.takeKeyword("JOIN");
      const { table, alias } = this.parseTableRefWithAlias();
      const condition = this.parseJoinCondition(joinKind, natural);
      joins.push({ joinKind, table, alias, condition });
    }
    return joins;
  }

  // One SELECT ... [FROM ...] [WHERE ...] [GROUP BY ...] [ORDER BY ...] body, with no trailing ";"/end-of-input check of its own. Used both by parseStatement (the top-level entry, which adds that check once the whole input is expected to be consumed) and recursively for every subquery position this grammar supports -- a derived table's own SELECT (parseFromSource above), and an IN (SELECT ...) or EXISTS (SELECT ...) operand's own SELECT -- each of which is followed by its own closing ")" rather than end-of-input. A subquery is exactly as capable as a top-level statement, since it is parsed by the identical method: it can itself JOIN (of any kind), filter, group, order, and nest a further subquery to whatever depth the recursion naturally reaches.
  private parseSelectBody(): SqlSelectStatement {
    this.takeKeyword("SELECT");
    const items = this.parseSelectList();
    this.takeKeyword("FROM");
    const from: SqlFromClause = {
      source: this.parseFromSource(),
      joins: this.parseJoins(),
    };
    if (this.atPunctuation(",")) {
      throw new HsqldbSqlUnsupportedError(
        "a comma-separated FROM list (write an explicit JOIN instead)",
        this.sql,
      );
    }

    let where: SqlPredicate | undefined;
    if (this.atKeyword("WHERE")) {
      this.advance();
      where = this.parsePredicate();
    }
    const groupBy = this.atKeyword("GROUP") ? this.parseGroupBy() : [];
    const orderBy = this.atKeyword("ORDER") ? this.parseOrderBy() : [];

    return { sql: this.sql, items, from, where, groupBy, orderBy };
  }

  parseStatement(): SqlSelectStatement {
    const statement = this.parseSelectBody();

    if (this.atPunctuation(";")) {
      this.advance();
    }
    if (this.peek().kind !== "end") {
      this.fail("end of statement");
    }

    return statement;
  }
}

export function parseSelect(sql: string): SqlSelectStatement {
  return new SqlParser(sql).parseStatement();
}
