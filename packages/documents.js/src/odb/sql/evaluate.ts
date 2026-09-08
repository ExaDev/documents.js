import type { ContentCellValue } from "document-schema.js";
import type { HsqldbTable } from "../../hsqldb/script";
import {
  aggregateCellValues,
  CELL_NULL,
  cellComparisonKey,
  compareCellValues,
} from "../values";
import { HsqldbSqlEvaluationError } from "./errors";
import type { SqlComparisonOperator } from "./lexer";
import type {
  SqlAggregateFunction,
  SqlColumnRef,
  SqlFromClause,
  SqlFromSource,
  SqlJoinClause,
  SqlLiteral,
  SqlNameRef,
  SqlOperand,
  SqlPredicate,
  SqlSelectStatement,
  SqlSortDirection,
} from "./parser";

// Executes a parsed SELECT (src/odb/sql/parser.ts) -- one table (or one derived table), plus zero or more JOINs of any kind, plus IN/EXISTS subqueries in WHERE or a JOIN's own ON -- against real HsqldbTables, the exact table shape readOdbTables produces for every .odb tier, so a saved .odb query can be run over the data this package already extracts, with no database engine anywhere in the path. Everything happens in memory over the rows it is handed; nothing here reads a package, a file, or a network connection.
//
// It follows the same never-guess policy the parser does (see src/odb/sql/errors.ts's top-of-file comment for the src/hsqldb/script.ts precedent being followed): a statement that parsed cleanly but cannot be executed faithfully against the data -- an unresolvable table or column, an ambiguous unqualified reference two joined tables both declare, a comparison between genuinely incomparable value kinds, an aggregate over non-numeric values, a select list GROUP BY cannot justify, an IN (SELECT ...) whose subquery produces more or less than one column -- throws HsqldbSqlEvaluationError rather than substituting a default, skipping the row, or returning a partial result.
//
// Six semantic decisions are worth stating outright, because each is a real choice a SQL implementation has to make and each is covered by its own test:
//
// 1. NULL is ContentCellValue's own { kind: 'empty' }, and both WHERE and a JOIN's own ON use genuine SQL three-valued logic: a comparison with a NULL operand is UNKNOWN, not false, and a row (or row pair) survives only when the predicate evaluates to TRUE. NOT UNKNOWN is UNKNOWN; UNKNOWN AND FALSE is FALSE; UNKNOWN OR TRUE is TRUE. IS [NOT] NULL and EXISTS/NOT EXISTS are the only predicates here that can never be UNKNOWN.
// 2. Value comparison and the five aggregates' own NULL handling are src/odb/values.ts's, shared verbatim with src/odb/formula/'s Report Builder engine rather than restated here: values compare within three classes and never across them, and SUM/AVG/MIN/MAX skip NULLs and return NULL for a group with no non-NULL value at all. See that module's own top-of-file comment for the full statement of both rules.
// 3. GROUP BY partitions by the grouped columns' own values, with all NULLs forming one group (SQL's own rule), and groups come back in first-appearance order -- SQL does not define an order without ORDER BY, and first-appearance is the one deterministic choice available. COUNT(*) counts rows; COUNT(column) counts non-NULL values; SUM/AVG/MIN/MAX ignore NULLs and return NULL for a group with no non-NULL value at all. An aggregate with no GROUP BY treats the whole (post-WHERE) row set as one group, and still returns exactly one row when that set is empty.
// 4. ORDER BY sorts NULLs last under ASC (and therefore first under DESC, since a descending term is the ascending comparison negated). The sort is stable, so rows tied on every ORDER BY term keep their original relative order, and a multi-column ORDER BY resolves ties left to right.
// 5. Each JOIN clause is a plain nested-loop join, folded into the row set left to right in the order written (joinTables/applyJoinClause below): the first JOIN's own condition tests every (base row, joined row) pair, the second JOIN's own condition then tests every (surviving pair, its joined row) triple, and so on. For INNER and CROSS, a row with no match on the other side is simply absent from the result; for LEFT/RIGHT/FULL, an unmatched row on the side that join kind preserves is kept, padded with NULL for every column the other side would have contributed. A USING or NATURAL join's shared columns are merged into one output column each, COALESCE(left, right) -- see applyJoinClause and mergeSharedColumns' own comments for the full column-ordering and qualifier rules, and src/odb/sql/parser.ts's own top-of-file comment for the PostgreSQL semantics this follows.
// 6. A subquery (a derived table in FROM, or the operand of IN/EXISTS) is evaluated by this identical pipeline, recursively -- evaluateSelectInScope below is what both the exported evaluateSelect and every subquery position actually call. A derived table never correlates with its enclosing query (real SQL's own rule for a plain, non-LATERAL derived table): it is evaluated once, standalone, with no outer scope at all. An IN/EXISTS subquery MAY correlate -- it can reference a column its own FROM/JOIN cannot resolve, meaning the enclosing row -- so it is evaluated once per outer row, with that row's own resolver and values available as a fallback (ColumnResolver.valueOf's own `outer` parameter): a column reference resolves locally first, and only falls back to the outer row when nothing in the subquery's own FROM/JOIN declares it at all, exactly as SQL's own scoping rule requires. This engine does not distinguish "provably uncorrelated" from "provably correlated" up front and cache the former's single result -- every IN/EXISTS subquery is simply re-evaluated once per outer row, which is correct in both cases (an uncorrelated subquery is a pure function of `tables` alone, so re-running it produces the identical result every time) at the cost of doing so needlessly for the uncorrelated case; see this directory's own evaluate.test.ts (a correlated and an uncorrelated case, hand-built) for both shapes proven correct.

export interface SqlResultSet {
  // The result-set column labels, in order: a real table column's own name for a plain column item, or the aggregate's own rendering (COUNT(*), SUM(AMOUNT)) for an aggregate item.
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ContentCellValue[])[];
}

type Truth = "true" | "false" | "unknown";

// Turns a src/odb/values.ts failure into this engine's own error, carrying the statement that produced it. Shared value semantics, engine-specific error class -- see that module's own top-of-file comment for why the split exists.
function sqlFailure(sql: string): (message: string) => Error {
  return (message: string) => new HsqldbSqlEvaluationError(message, sql);
}

function compareValues(
  left: ContentCellValue,
  right: ContentCellValue,
  sql: string,
): number {
  return compareCellValues(left, right, sqlFailure(sql));
}

function truthOfComparison(
  ordering: number,
  operator: SqlComparisonOperator,
): Truth {
  switch (operator) {
    case "=":
      return ordering === 0 ? "true" : "false";
    case "<>":
      return ordering === 0 ? "false" : "true";
    case "<":
      return ordering < 0 ? "true" : "false";
    case ">":
      return ordering > 0 ? "true" : "false";
    case "<=":
      return ordering <= 0 ? "true" : "false";
    case ">=":
      return ordering >= 0 ? "true" : "false";
  }
}

function notTruth(truth: Truth): Truth {
  if (truth === "true") {
    return "false";
  }
  return truth === "false" ? "true" : "unknown";
}

function andTruth(left: Truth, right: Truth): Truth {
  if (left === "false" || right === "false") {
    return "false";
  }
  return left === "true" && right === "true" ? "true" : "unknown";
}

function orTruth(left: Truth, right: Truth): Truth {
  if (left === "true" || right === "true") {
    return "true";
  }
  return left === "false" && right === "false" ? "false" : "unknown";
}

function literalToValue(literal: SqlLiteral): ContentCellValue {
  switch (literal.kind) {
    case "number":
      return { kind: "number", value: literal.value };
    case "string":
      return { kind: "string", value: literal.value };
    case "boolean":
      return { kind: "boolean", value: literal.value };
    case "null":
      return CELL_NULL;
  }
}

// SQL LIKE, with % matching any run of characters (including none) and _ matching exactly one. Case-sensitive, matching both HSQLDB's and Firebird's own default LIKE behaviour. Every other character in the pattern matches literally, including regular-expression metacharacters, which is what the escaping below is for; a LIKE ... ESCAPE clause is rejected outright by the parser rather than approximated here.
function likePatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const character of pattern) {
    if (character === "%") {
      source += "[\\s\\S]*";
    } else if (character === "_") {
      source += "[\\s\\S]";
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

// SQL's own identifier rule, as both HSQLDB and Firebird implement it and as real LibreOffice-generated .odb queries rely on: a double-quoted name matches only exactly, while an unquoted one (already folded to upper case by the lexer) may also match a real name case-insensitively. Reports "no match at all" as undefined rather than throwing -- the fallback signal ColumnResolver.tryLocalIndexOf uses to defer to an enclosing scope for a correlated subquery (see this module's own top-of-file comment, point 6) before finally giving up -- but a genuine ambiguity (an unquoted name matching more than one real name case-insensitively) is still a hard, immediate error, since it is decisive within whatever candidate set was actually searched regardless of what an outer scope might also contain.
function tryResolveName(
  candidates: readonly string[],
  ref: SqlNameRef,
  what: string,
  sql: string,
): string | undefined {
  const exact = candidates.find((candidate) => candidate === ref.name);
  if (exact !== undefined) {
    return exact;
  }
  if (!ref.quoted) {
    const folded = candidates.filter(
      (candidate) => candidate.toUpperCase() === ref.name,
    );
    if (folded.length > 1) {
      throw new HsqldbSqlEvaluationError(
        `${what} "${ref.name}" is ambiguous -- it matches ${folded.join(", ")} case-insensitively`,
        sql,
      );
    }
    const only = folded[0];
    if (only !== undefined) {
      return only;
    }
  }
  return undefined;
}

function resolveName(
  candidates: readonly string[],
  ref: SqlNameRef,
  what: string,
  sql: string,
): string {
  const found = tryResolveName(candidates, ref, what, sql);
  if (found !== undefined) {
    return found;
  }
  throw new HsqldbSqlEvaluationError(
    `${what} "${ref.name}" not found -- available: ${candidates.length === 0 ? "(none)" : candidates.join(", ")}`,
    sql,
  );
}

function resolveTable(
  tables: readonly HsqldbTable[],
  ref: SqlNameRef,
  sql: string,
): HsqldbTable {
  const resolvedName = resolveName(
    tables.map((table) => table.tableName),
    ref,
    "table",
    sql,
  );
  const table = tables.find(
    (candidate) => candidate.tableName === resolvedName,
  );
  if (table === undefined) {
    throw new HsqldbSqlEvaluationError(
      `table "${resolvedName}" not found`,
      sql,
    );
  }
  return table;
}

// A joined-row column: the name(s) it may legally be qualified by (normally the one table or alias that declared it, but two for a column USING/NATURAL merged from both sides of a join -- see mergeSharedColumns), and its own real column name.
interface ResolvedColumn {
  readonly qualifiers: readonly string[];
  readonly columnName: string;
}

// A shared column pairing a USING or NATURAL join matched on: `leftIndex` is an index into the LEFT side's own column list (which, after prior joins, may itself already hold merged columns), `rightIndex` is an index into the newly-joined table's own column list alone (0-based, never merged), and `columnName` is the real name the merged output column keeps -- see mergeSharedColumns' own comment for why it is always the left side's name.
interface SharedColumnPair {
  readonly leftIndex: number;
  readonly rightIndex: number;
  readonly columnName: string;
}

function columnAt(
  columns: readonly ResolvedColumn[],
  index: number,
  sql: string,
): ResolvedColumn {
  const column = columns[index];
  if (column === undefined) {
    throw new HsqldbSqlEvaluationError(
      `column index ${String(index)} is outside the joined column list`,
      sql,
    );
  }
  return column;
}

function valueAtIndex(
  row: readonly ContentCellValue[],
  index: number,
  sql: string,
): ContentCellValue {
  const value = row[index];
  if (value === undefined) {
    throw new HsqldbSqlEvaluationError(
      `malformed joined row: it carries ${String(row.length)} values but index ${String(index)} was expected`,
      sql,
    );
  }
  return value;
}

// Resolves a column name against a narrowed set of candidate indices into `columns`, the same identifier rule tryResolveName applies (exact, case-sensitive match first; an unquoted reference also matching case-insensitively as a fallback) but keyed by INDEX rather than by name, and checking ambiguity by count of matching indices rather than distinct names. tryResolveName's own return-a-name contract is safe only when candidates cannot repeat (a single table's own column list, or the table-name list) -- a joined column list can legitimately hold the identical name at more than one index (two different tables both declaring an ID column, or a self-join naming the same table twice), so two tables sharing a column name must still be flagged ambiguous even though "the name" itself resolves to only one string. Reports "no match at all" as undefined for the identical reason tryResolveName does (see its own comment); a genuine ambiguity is still immediate.
function tryResolveColumnIndex(
  columns: readonly ResolvedColumn[],
  candidateIndices: readonly number[],
  ref: SqlNameRef,
  sql: string,
): number | undefined {
  let firstExact: number | undefined;
  let exactCount = 0;
  for (const index of candidateIndices) {
    if (columns[index]?.columnName === ref.name) {
      exactCount += 1;
      firstExact ??= index;
    }
  }
  if (exactCount > 1) {
    throw new HsqldbSqlEvaluationError(
      `column "${ref.name}" is ambiguous -- it matches more than one joined column named "${ref.name}"`,
      sql,
    );
  }
  if (firstExact !== undefined) {
    return firstExact;
  }
  if (!ref.quoted) {
    let firstFolded: number | undefined;
    const foldedNames: string[] = [];
    for (const index of candidateIndices) {
      const name = columns[index]?.columnName;
      if (name?.toUpperCase() !== ref.name) {
        continue;
      }
      foldedNames.push(name);
      firstFolded ??= index;
    }
    if (foldedNames.length > 1) {
      throw new HsqldbSqlEvaluationError(
        `column "${ref.name}" is ambiguous -- it matches ${foldedNames.join(", ")} case-insensitively`,
        sql,
      );
    }
    if (firstFolded !== undefined) {
      return firstFolded;
    }
  }
  return undefined;
}

function resolveColumnIndex(
  columns: readonly ResolvedColumn[],
  candidateIndices: readonly number[],
  ref: SqlNameRef,
  sql: string,
): number {
  const index = tryResolveColumnIndex(columns, candidateIndices, ref, sql);
  if (index !== undefined) {
    return index;
  }
  throw new HsqldbSqlEvaluationError(
    `column "${ref.name}" not found -- available: ${candidateIndices.length === 0 ? "(none)" : candidateIndices.map((index) => columns[index]?.columnName ?? "?").join(", ")}`,
    sql,
  );
}

// The enclosing query's own resolver and current row, carried by a subquery's ColumnResolver so a correlated IN/EXISTS subquery can resolve a column its own FROM/JOIN does not declare against the row it is currently being evaluated for -- see ColumnResolver.valueOf below, and this module's own top-of-file comment, point 6.
interface OuterScope {
  readonly resolver: ColumnResolver;
  readonly row: readonly ContentCellValue[];
}

// Every column reference in a statement resolves to the same index on every row, so resolution happens once per reference and is memoised by the AST node's own identity -- a large table would otherwise re-scan the joined column list once per row per reference.
//
// A resolver is built over the fully-joined column list at once, never one table alone: joinTables/applyJoinClause below produce that list (and its matching row shape) by folding every JOIN left to right, so the flat index space this class resolves into is exactly the position space a joined row's own values live in, whether the statement joins zero tables or several, and regardless of whether any join along the way merged a USING/NATURAL column pair into one.
class ColumnResolver {
  private readonly cache = new Map<SqlColumnRef, number>();
  // The joined column list this resolver was built over, in exactly the order joinTables/applyJoinClause laid the corresponding row values out in.
  private readonly columns: readonly ResolvedColumn[];
  // Every qualifying name any column in this list may be referenced by, deduplicated -- a plain table's own name, an alias, or (for a USING/NATURAL merged column) both sides' names at once.
  private readonly qualifierNames: readonly string[];

  constructor(
    columns: readonly ResolvedColumn[],
    private readonly sql: string,
    private readonly outer?: OuterScope,
  ) {
    this.columns = columns;
    this.qualifierNames = [
      ...new Set(columns.flatMap((column) => column.qualifiers)),
    ];
  }

  get columnCount(): number {
    return this.columns.length;
  }

  nameAt(index: number): string {
    return columnAt(this.columns, index, this.sql).columnName;
  }

  // Resolves a column reference to its index in the joined column list, checking any table qualifier against every qualifying name in scope (a qualifier naming anything else can only be a reference to a table this statement never selected from) and, when unqualified, searching across every column at once.
  indexOf(ref: SqlColumnRef): number {
    const cached = this.cache.get(ref);
    if (cached !== undefined) {
      return cached;
    }
    let candidateIndices: readonly number[];
    if (ref.qualifier !== undefined) {
      const qualifierName = resolveName(
        this.qualifierNames,
        ref.qualifier,
        "table qualifier",
        this.sql,
      );
      candidateIndices = this.columns
        .map((column, index) =>
          column.qualifiers.includes(qualifierName) ? index : -1,
        )
        .filter((index) => index >= 0);
    } else {
      candidateIndices = this.columns.map((_column, index) => index);
    }
    const index = resolveColumnIndex(
      this.columns,
      candidateIndices,
      ref.column,
      this.sql,
    );
    this.cache.set(ref, index);
    return index;
  }

  // Like indexOf, but purely local: reports "not found here" as undefined instead of throwing, so valueOf below can fall back to an enclosing (correlated-subquery) scope before finally giving up. A genuine local ambiguity still throws immediately -- see tryResolveName/tryResolveColumnIndex's own comments.
  private tryLocalIndexOf(ref: SqlColumnRef): number | undefined {
    const cached = this.cache.get(ref);
    if (cached !== undefined) {
      return cached;
    }
    let candidateIndices: readonly number[];
    if (ref.qualifier !== undefined) {
      const qualifierName = tryResolveName(
        this.qualifierNames,
        ref.qualifier,
        "table qualifier",
        this.sql,
      );
      if (qualifierName === undefined) {
        return undefined;
      }
      candidateIndices = this.columns
        .map((column, index) =>
          column.qualifiers.includes(qualifierName) ? index : -1,
        )
        .filter((index) => index >= 0);
    } else {
      candidateIndices = this.columns.map((_column, index) => index);
    }
    const index = tryResolveColumnIndex(
      this.columns,
      candidateIndices,
      ref.column,
      this.sql,
    );
    if (index === undefined) {
      return undefined;
    }
    this.cache.set(ref, index);
    return index;
  }

  valueAt(index: number, row: readonly ContentCellValue[]): ContentCellValue {
    return valueAtIndex(row, index, this.sql);
  }

  // Resolves and reads a column reference's value on `row`, falling back to the enclosing scope's own resolver and row -- recursively, so a subquery nested several levels deep walks outward one scope at a time until something resolves it -- when this resolver's own FROM/JOIN declares no matching column at all. This is the one point correlation actually happens: every WHERE/ON predicate reads its operands through operandValue, which reads them through this method, so a correlated subquery's WHERE or ON clause gets outer-row resolution with no further plumbing. When nothing resolves anywhere, this falls through to indexOf purely to raise its own identically-worded "not found"/ambiguity error.
  valueOf(
    ref: SqlColumnRef,
    row: readonly ContentCellValue[],
  ): ContentCellValue {
    const localIndex = this.tryLocalIndexOf(ref);
    if (localIndex !== undefined) {
      return this.valueAt(localIndex, row);
    }
    if (this.outer !== undefined) {
      return this.outer.resolver.valueOf(ref, this.outer.row);
    }
    return this.valueAt(this.indexOf(ref), row);
  }
}

function operandValue(
  operand: SqlOperand,
  row: readonly ContentCellValue[],
  resolver: ColumnResolver,
): ContentCellValue {
  return operand.kind === "literal"
    ? literalToValue(operand.literal)
    : resolver.valueOf(operand.column, row);
}

function evaluateLike(
  value: ContentCellValue,
  pattern: string,
  sql: string,
): Truth {
  const key = cellComparisonKey(value);
  if (key === undefined) {
    return "unknown";
  }
  if (key.valueClass !== "text") {
    throw new HsqldbSqlEvaluationError(
      `LIKE requires a text value, but its left operand is a ${key.valueClass} value`,
      sql,
    );
  }
  return likePatternToRegExp(pattern).test(key.text) ? "true" : "false";
}

function evaluateIn(
  value: ContentCellValue,
  values: readonly SqlLiteral[],
  sql: string,
): Truth {
  if (value.kind === "empty") {
    return "unknown";
  }
  let sawNull = false;
  for (const literal of values) {
    const candidate = literalToValue(literal);
    if (candidate.kind === "empty") {
      sawNull = true;
      continue;
    }
    if (compareValues(value, candidate, sql) === 0) {
      return "true";
    }
  }
  // SQL's own rule, and the one most easily got wrong: a non-match against a list containing NULL is UNKNOWN, not FALSE -- which is why "x NOT IN (1, NULL)" excludes every row rather than keeping the ones where x is not 1.
  return sawNull ? "unknown" : "false";
}

function evaluatePredicate(
  predicate: SqlPredicate,
  row: readonly ContentCellValue[],
  resolver: ColumnResolver,
  tables: readonly HsqldbTable[],
  sql: string,
): Truth {
  switch (predicate.kind) {
    case "comparison": {
      const left = operandValue(predicate.left, row, resolver);
      const right = operandValue(predicate.right, row, resolver);
      if (left.kind === "empty" || right.kind === "empty") {
        return "unknown";
      }
      return truthOfComparison(
        compareValues(left, right, sql),
        predicate.operator,
      );
    }
    case "isNull": {
      const isNull =
        operandValue(predicate.operand, row, resolver).kind === "empty";
      return (predicate.negated ? !isNull : isNull) ? "true" : "false";
    }
    case "like": {
      const truth = evaluateLike(
        operandValue(predicate.operand, row, resolver),
        predicate.pattern,
        sql,
      );
      return predicate.negated ? notTruth(truth) : truth;
    }
    case "in": {
      const truth = evaluateIn(
        operandValue(predicate.operand, row, resolver),
        predicate.values,
        sql,
      );
      return predicate.negated ? notTruth(truth) : truth;
    }
    case "inSubquery": {
      const truth = evaluateInSubquery(
        operandValue(predicate.operand, row, resolver),
        predicate.query,
        tables,
        resolver,
        row,
        sql,
      );
      return predicate.negated ? notTruth(truth) : truth;
    }
    case "between": {
      const value = operandValue(predicate.operand, row, resolver);
      const lower = operandValue(predicate.lower, row, resolver);
      const upper = operandValue(predicate.upper, row, resolver);
      if (
        value.kind === "empty" ||
        lower.kind === "empty" ||
        upper.kind === "empty"
      ) {
        return "unknown";
      }
      const truth = andTruth(
        truthOfComparison(compareValues(value, lower, sql), ">="),
        truthOfComparison(compareValues(value, upper, sql), "<="),
      );
      return predicate.negated ? notTruth(truth) : truth;
    }
    case "exists":
      return evaluateExists(predicate.query, tables, resolver, row);
    case "not":
      return notTruth(
        evaluatePredicate(predicate.predicate, row, resolver, tables, sql),
      );
    case "and":
      return andTruth(
        evaluatePredicate(predicate.left, row, resolver, tables, sql),
        evaluatePredicate(predicate.right, row, resolver, tables, sql),
      );
    case "or":
      return orTruth(
        evaluatePredicate(predicate.left, row, resolver, tables, sql),
        evaluatePredicate(predicate.right, row, resolver, tables, sql),
      );
  }
}

// IN (SELECT ...): the inner query must produce exactly one column (SQL's own rule -- a row-valued or multi-column IN needs a row constructor on the left, which this grammar has no expression syntax for at all), and this follows evaluateIn's own three-valued rule identically: a NULL left operand is UNKNOWN regardless of what the subquery produces, and a non-match against a result set containing a NULL is UNKNOWN rather than FALSE. `outerResolver`/`outerRow` give the subquery a correlation fallback (this module's own top-of-file comment, point 6) -- used whether or not the subquery actually turns out to reference an outer column, since re-evaluating an uncorrelated subquery with a harmless, unused fallback in place produces the identical result.
function evaluateInSubquery(
  value: ContentCellValue,
  query: SqlSelectStatement,
  tables: readonly HsqldbTable[],
  outerResolver: ColumnResolver,
  outerRow: readonly ContentCellValue[],
  sql: string,
): Truth {
  if (value.kind === "empty") {
    return "unknown";
  }
  const result = evaluateSelectInScope(query, tables, {
    resolver: outerResolver,
    row: outerRow,
  });
  if (result.columns.length !== 1) {
    throw new HsqldbSqlEvaluationError(
      `IN (SELECT ...) requires the subquery to produce exactly one column, but it produced ${String(result.columns.length)} (${result.columns.length === 0 ? "none" : result.columns.join(", ")})`,
      sql,
    );
  }
  let sawNull = false;
  for (const candidateRow of result.rows) {
    const candidate = candidateRow[0];
    if (candidate === undefined) {
      throw new HsqldbSqlEvaluationError(
        "malformed subquery row: it declares one column but carries none",
        sql,
      );
    }
    if (candidate.kind === "empty") {
      sawNull = true;
      continue;
    }
    if (compareValues(value, candidate, sql) === 0) {
      return "true";
    }
  }
  return sawNull ? "unknown" : "false";
}

// EXISTS (SELECT ...): true precisely when the inner query produces at least one row, regardless of that row's own column values -- unlike IN, EXISTS never inspects what the subquery selects, so an arbitrary select list (SELECT 1, SELECT *, SELECT COUNT(*)) is equally valid here. Never UNKNOWN: existence is a plain fact about the row set, not a comparison a NULL operand can leave undecided -- NOT EXISTS negates it through the ordinary "not" predicate kind (parser.ts's own grammar note on EXISTS), which is exactly right since notTruth never turns a "true"/"false" input into "unknown".
function evaluateExists(
  query: SqlSelectStatement,
  tables: readonly HsqldbTable[],
  outerResolver: ColumnResolver,
  outerRow: readonly ContentCellValue[],
): Truth {
  const result = evaluateSelectInScope(query, tables, {
    resolver: outerResolver,
    row: outerRow,
  });
  return result.rows.length > 0 ? "true" : "false";
}

// COUNT(*) never reaches src/odb/values.ts's aggregateCellValues: it counts rows, not values, and is answered directly from the group's own row count. Everything routed here is the "over a column's values" case, where NULLs are skipped by every aggregate.
function aggregateOverValues(
  aggregate: SqlAggregateFunction,
  values: readonly ContentCellValue[],
  sql: string,
): ContentCellValue {
  return aggregateCellValues(aggregate, values, sqlFailure(sql));
}

// NULL sorts after every non-NULL value under an ascending term; a descending term negates the whole comparison, which puts NULLs first. Stated as one rule rather than two so the two directions can never drift apart.
function compareForSort(
  left: ContentCellValue,
  right: ContentCellValue,
  sql: string,
): number {
  const leftNull = left.kind === "empty";
  const rightNull = right.kind === "empty";
  if (leftNull || rightNull) {
    if (leftNull && rightNull) {
      return 0;
    }
    return leftNull ? 1 : -1;
  }
  return compareValues(left, right, sql);
}

interface SortableRow {
  readonly output: readonly ContentCellValue[];
  readonly sortKeys: readonly ContentCellValue[];
}

function sortRows(
  rows: readonly SortableRow[],
  directions: readonly SqlSortDirection[],
  sql: string,
): readonly (readonly ContentCellValue[])[] {
  // Array.prototype.sort is stable (ES2019 onward), which is exactly what carries tied rows through in their original order -- nothing else here preserves it.
  return [...rows]
    .sort((left, right) => {
      for (const [index, direction] of directions.entries()) {
        const leftKey = left.sortKeys[index];
        const rightKey = right.sortKeys[index];
        if (leftKey === undefined || rightKey === undefined) {
          throw new HsqldbSqlEvaluationError(
            "an ORDER BY term has no sort key on this row",
            sql,
          );
        }
        const ordering = compareForSort(leftKey, rightKey, sql);
        if (ordering !== 0) {
          return direction === "asc" ? ordering : -ordering;
        }
      }
      return 0;
    })
    .map((row) => row.output);
}

// A group's identity: the grouped columns' own values, kind-tagged so a numeric 1 and the string '1' never collapse into one group, and with NULL a single group of its own (SQL's own GROUP BY rule).
function groupKeyOf(values: readonly ContentCellValue[]): string {
  return values
    .map((value) => {
      switch (value.kind) {
        case "empty":
          return "null";
        case "boolean":
          return `boolean:${String(value.value)}`;
        case "number":
        case "percentage":
        case "currency":
          return `numeric:${String(value.value)}`;
        case "date":
        case "time":
        case "dateTime":
        case "string":
        case "error":
          return `text:${value.value}`;
      }
    })
    .join(" ");
}

// The select list, resolved against the joined column list once: a plain column becomes its own index, an aggregate its function plus (for the four that take one) its argument's index, and SELECT * expands to every joined column index in table-then-column order (the FROM table's own columns, then each JOIN's, in the order written). Resolving up front is what lets both projection paths below run with no unreachable branches for shapes that were already ruled out.
type PlanItem =
  | { readonly kind: "column"; readonly index: number; readonly text: string }
  | {
      readonly kind: "aggregate";
      readonly aggregate: SqlAggregateFunction;
      readonly argumentIndex: number | undefined;
      readonly outputName: string;
    };

function planSelectList(
  statement: SqlSelectStatement,
  resolver: ColumnResolver,
): readonly PlanItem[] {
  const plan: PlanItem[] = [];
  for (const item of statement.items) {
    switch (item.kind) {
      case "star":
        for (let index = 0; index < resolver.columnCount; index += 1) {
          plan.push({ kind: "column", index, text: resolver.nameAt(index) });
        }
        break;
      case "column":
        plan.push({
          kind: "column",
          index: resolver.indexOf(item.column),
          text: item.column.text,
        });
        break;
      case "aggregate":
        plan.push({
          kind: "aggregate",
          aggregate: item.aggregate,
          argumentIndex:
            item.argument.kind === "star"
              ? undefined
              : resolver.indexOf(item.argument.column),
          outputName: item.outputName,
        });
        break;
    }
  }
  return plan;
}

function planColumnNames(
  plan: readonly PlanItem[],
  resolver: ColumnResolver,
): readonly string[] {
  return plan.map((item) =>
    item.kind === "column" ? resolver.nameAt(item.index) : item.outputName,
  );
}

function evaluateUngrouped(
  statement: SqlSelectStatement,
  plan: readonly PlanItem[],
  matching: readonly (readonly ContentCellValue[])[],
  resolver: ColumnResolver,
): SqlResultSet {
  const projection = plan.map((item) => {
    if (item.kind !== "column") {
      throw new HsqldbSqlEvaluationError(
        `${item.outputName} is an aggregate, so every other select-list item must be grouped`,
        statement.sql,
      );
    }
    return item.index;
  });
  const orderIndices = statement.orderBy.map((term) =>
    resolver.indexOf(term.column),
  );
  const sortable = matching.map((row) => ({
    output: projection.map((index) => resolver.valueAt(index, row)),
    sortKeys: orderIndices.map((index) => resolver.valueAt(index, row)),
  }));
  return {
    columns: planColumnNames(plan, resolver),
    rows: sortRows(
      sortable,
      statement.orderBy.map((term) => term.direction),
      statement.sql,
    ),
  };
}

interface RowGroup {
  readonly keyValues: readonly ContentCellValue[];
  readonly rows: (readonly ContentCellValue[])[];
}

function partitionIntoGroups(
  rows: readonly (readonly ContentCellValue[])[],
  groupIndices: readonly number[],
  resolver: ColumnResolver,
): readonly RowGroup[] {
  const groups = new Map<string, RowGroup>();
  for (const row of rows) {
    const keyValues = groupIndices.map((index) => resolver.valueAt(index, row));
    const key = groupKeyOf(keyValues);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { keyValues, rows: [row] });
    } else {
      existing.rows.push(row);
    }
  }
  return [...groups.values()];
}

function evaluateGrouped(
  statement: SqlSelectStatement,
  plan: readonly PlanItem[],
  matching: readonly (readonly ContentCellValue[])[],
  resolver: ColumnResolver,
): SqlResultSet {
  const groupIndices = statement.groupBy.map((ref) => resolver.indexOf(ref));

  for (const item of plan) {
    if (item.kind === "column" && !groupIndices.includes(item.index)) {
      throw new HsqldbSqlEvaluationError(
        `column "${item.text}" is neither grouped nor aggregated -- add it to GROUP BY or wrap it in an aggregate`,
        statement.sql,
      );
    }
  }

  // An aggregate with no GROUP BY treats the whole post-WHERE row set as one group, and still produces exactly one row when that set is empty (COUNT(*) = 0, every other aggregate NULL).
  const groups =
    groupIndices.length === 0
      ? [{ keyValues: [], rows: [...matching] }]
      : partitionIntoGroups(matching, groupIndices, resolver);

  const orderPositions = statement.orderBy.map((term) => {
    const position = groupIndices.indexOf(resolver.indexOf(term.column));
    if (position < 0) {
      throw new HsqldbSqlEvaluationError(
        `ORDER BY column "${term.column.text}" is not a GROUP BY column -- a grouped result has no single value for it`,
        statement.sql,
      );
    }
    return position;
  });

  const sortable = groups.map((group) => ({
    output: plan.map((item): ContentCellValue => {
      if (item.kind === "aggregate") {
        const argumentIndex = item.argumentIndex;
        if (argumentIndex === undefined) {
          // COUNT(*) counts rows, not values -- the only aggregate that never looks at a column at all.
          return { kind: "number", value: group.rows.length };
        }
        return aggregateOverValues(
          item.aggregate,
          group.rows.map((row) => resolver.valueAt(argumentIndex, row)),
          statement.sql,
        );
      }
      const keyValue = group.keyValues[groupIndices.indexOf(item.index)];
      if (keyValue === undefined) {
        throw new HsqldbSqlEvaluationError(
          `grouped column "${item.text}" has no value on this group`,
          statement.sql,
        );
      }
      return keyValue;
    }),
    sortKeys: orderPositions.map((position) => {
      const keyValue = group.keyValues[position];
      if (keyValue === undefined) {
        throw new HsqldbSqlEvaluationError(
          "an ORDER BY term resolved to a GROUP BY column with no value on this group",
          statement.sql,
        );
      }
      return keyValue;
    }),
  }));

  return {
    columns: planColumnNames(plan, resolver),
    rows: sortRows(
      sortable,
      statement.orderBy.map((term) => term.direction),
      statement.sql,
    ),
  };
}

interface JoinResult {
  readonly columns: readonly ResolvedColumn[];
  readonly rows: readonly (readonly ContentCellValue[])[];
}

function tableColumns(
  qualifier: string,
  table: HsqldbTable,
): readonly ResolvedColumn[] {
  return table.columns.map((column) => ({
    qualifiers: [qualifier],
    columnName: column.name,
  }));
}

// A row of NULLs the width of one side of a join, used to pad the side an unmatched LEFT/RIGHT/FULL row has no partner on. Every entry is the identical CELL_NULL constant -- safe to share by reference, since a ContentCellValue is never mutated in place anywhere in this module.
function nullRow(count: number): readonly ContentCellValue[] {
  return new Array<ContentCellValue>(count).fill(CELL_NULL);
}

// Every column NATURAL JOIN's left and right sides share, matched by real column name alone (never case-folded or quoted, unlike a user-typed identifier -- these are structural properties of the tables themselves, not something the query spelled out). Iterates the left side in column order, which is what fixes the shared columns' own left-to-right order in the merged result (see mergeSharedColumns). A name appearing more than once on either side -- two already-joined tables both declaring it, or (defensively) a table declaring it twice -- cannot be matched to a single unambiguous partner, so it is refused rather than guessed at, the same "never guess" policy this module's own top-of-file comment states for every other ambiguous reference.
function computeNaturalSharedPairs(
  leftColumns: readonly ResolvedColumn[],
  rightColumns: readonly ResolvedColumn[],
  sql: string,
): readonly SharedColumnPair[] {
  const rightIndexByName = new Map<string, number>();
  const ambiguousRightNames = new Set<string>();
  rightColumns.forEach((column, index) => {
    if (rightIndexByName.has(column.columnName)) {
      ambiguousRightNames.add(column.columnName);
    } else {
      rightIndexByName.set(column.columnName, index);
    }
  });

  const pairs: SharedColumnPair[] = [];
  const seenNames = new Set<string>();
  leftColumns.forEach((leftColumn, leftIndex) => {
    const rightIndex = rightIndexByName.get(leftColumn.columnName);
    if (rightIndex === undefined) {
      return;
    }
    if (
      ambiguousRightNames.has(leftColumn.columnName) ||
      seenNames.has(leftColumn.columnName)
    ) {
      throw new HsqldbSqlEvaluationError(
        `NATURAL JOIN cannot determine a unique match for column "${leftColumn.columnName}" -- more than one column shares that name on one side of the join`,
        sql,
      );
    }
    seenNames.add(leftColumn.columnName);
    pairs.push({ leftIndex, rightIndex, columnName: leftColumn.columnName });
  });
  return pairs;
}

// Whether a row pair matches a USING/NATURAL join's implicit condition: every shared column pair equal, under the identical three-valued NULL logic WHERE and ON already use (a NULL on either side makes that pair's comparison UNKNOWN, which -- like an ON clause -- excludes the row pair rather than matching it).
function evaluateSharedColumnMatch(
  combined: readonly ContentCellValue[],
  pairs: readonly SharedColumnPair[],
  leftColumnCount: number,
  sql: string,
): boolean {
  return pairs.every((pair) => {
    const left = valueAtIndex(combined, pair.leftIndex, sql);
    const right = valueAtIndex(
      combined,
      leftColumnCount + pair.rightIndex,
      sql,
    );
    return (
      left.kind !== "empty" &&
      right.kind !== "empty" &&
      compareValues(left, right, sql) === 0
    );
  });
}

// Collapses a USING/NATURAL join's shared column pairs into one output column each, exactly as PostgreSQL documents JOIN USING doing (see src/odb/sql/parser.ts's own top-of-file comment for the citation): the merged columns come first, in the order `sharedPairs` gives them, followed by the left side's own remaining columns, then the right side's remaining columns. Each merged column's value is COALESCE(left, right) -- the left side's value when it is not NULL, otherwise the right's, which only differs from either side alone when an outer join has padded one side with NULL -- and it may be qualified by either side's own qualifying name, since the merge is exactly what makes the two references the same column. The merged column keeps the LEFT side's own real column name; the two sides are only reachable this way because USING/NATURAL requires them to share a name in the first place, so this is a naming choice, not a semantic one.
function mergeSharedColumns(
  rawColumns: readonly ResolvedColumn[],
  rows: readonly (readonly ContentCellValue[])[],
  sharedPairs: readonly SharedColumnPair[],
  leftColumnCount: number,
  sql: string,
): JoinResult {
  const sharedLeftIndices = new Set(sharedPairs.map((pair) => pair.leftIndex));
  const sharedRightIndices = new Set(
    sharedPairs.map((pair) => leftColumnCount + pair.rightIndex),
  );
  const remainingIndices = rawColumns
    .map((_column, index) => index)
    .filter(
      (index) =>
        !sharedLeftIndices.has(index) && !sharedRightIndices.has(index),
    );

  const mergedColumns: ResolvedColumn[] = sharedPairs.map((pair) => {
    const leftColumn = columnAt(rawColumns, pair.leftIndex, sql);
    const rightColumn = columnAt(
      rawColumns,
      leftColumnCount + pair.rightIndex,
      sql,
    );
    return {
      qualifiers: [
        ...new Set([...leftColumn.qualifiers, ...rightColumn.qualifiers]),
      ],
      columnName: leftColumn.columnName,
    };
  });
  const columns = [
    ...mergedColumns,
    ...remainingIndices.map((index) => columnAt(rawColumns, index, sql)),
  ];

  const mergedRows = rows.map((row) => {
    const mergedValues = sharedPairs.map((pair) => {
      const leftValue = valueAtIndex(row, pair.leftIndex, sql);
      const rightValue = valueAtIndex(
        row,
        leftColumnCount + pair.rightIndex,
        sql,
      );
      return leftValue.kind !== "empty" ? leftValue : rightValue;
    });
    const remainingValues = remainingIndices.map((index) =>
      valueAtIndex(row, index, sql),
    );
    return [...mergedValues, ...remainingValues];
  });

  return { columns, rows: mergedRows };
}

// Folds one JOIN clause into the running joined row set, left to right (joinTables calls this once per clause): a plain nested loop over (left row, right row) pairs, tested against the clause's own condition -- an ON predicate (reusing evaluatePredicate's own three-valued logic directly), a USING/NATURAL equi-join over shared columns (evaluateSharedColumnMatch), or, for CROSS, no condition at all. LEFT/FULL then re-adds every left row that matched nothing, padded with NULL for the right side's columns; RIGHT/FULL mirrors that for unmatched right rows. A USING/NATURAL join's raw (unmerged) result is finally collapsed by mergeSharedColumns; an ON or CROSS join's is not, since only USING/NATURAL ever declare two columns "the same".
function applyJoinClause(
  left: JoinResult,
  join: SqlJoinClause,
  tables: readonly HsqldbTable[],
  sql: string,
  outer: OuterScope | undefined,
): JoinResult {
  const rightTable = resolveTable(tables, join.table, sql);
  const rightQualifier =
    join.alias !== undefined ? join.alias.name : rightTable.tableName;
  const rightColumns = tableColumns(rightQualifier, rightTable);
  const leftColumnCount = left.columns.length;
  const rawColumns = [...left.columns, ...rightColumns];

  let onPredicate: SqlPredicate | undefined;
  let sharedPairs: readonly SharedColumnPair[] = [];
  if (join.condition.kind === "on") {
    onPredicate = join.condition.predicate;
  } else if (join.condition.kind === "using") {
    const allLeftIndices = left.columns.map((_column, index) => index);
    const allRightIndices = rightColumns.map((_column, index) => index);
    sharedPairs = join.condition.columns.map((ref) => {
      const leftIndex = resolveColumnIndex(
        left.columns,
        allLeftIndices,
        ref,
        sql,
      );
      const rightIndex = resolveColumnIndex(
        rightColumns,
        allRightIndices,
        ref,
        sql,
      );
      return {
        leftIndex,
        rightIndex,
        columnName: columnAt(left.columns, leftIndex, sql).columnName,
      };
    });
  } else if (join.condition.kind === "natural") {
    sharedPairs = computeNaturalSharedPairs(left.columns, rightColumns, sql);
    if (sharedPairs.length === 0) {
      throw new HsqldbSqlEvaluationError(
        "NATURAL JOIN found no columns shared between the joined tables",
        sql,
      );
    }
  }
  // join.condition.kind === "none" (CROSS): onPredicate stays undefined and sharedPairs stays empty, so isMatch below is unconditionally true for every pair.

  const rawResolver = new ColumnResolver(rawColumns, sql, outer);
  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();
  const paired: (readonly ContentCellValue[])[] = [];

  left.rows.forEach((leftRow, leftIndex) => {
    rightTable.rows.forEach((rightRow, rightIndex) => {
      const combined = [...leftRow, ...rightRow];
      const isMatch =
        onPredicate !== undefined
          ? evaluatePredicate(
              onPredicate,
              combined,
              rawResolver,
              tables,
              sql,
            ) === "true"
          : sharedPairs.length > 0
            ? evaluateSharedColumnMatch(
                combined,
                sharedPairs,
                leftColumnCount,
                sql,
              )
            : true;
      if (isMatch) {
        paired.push(combined);
        matchedLeft.add(leftIndex);
        matchedRight.add(rightIndex);
      }
    });
  });

  if (join.joinKind === "left" || join.joinKind === "full") {
    left.rows.forEach((leftRow, leftIndex) => {
      if (!matchedLeft.has(leftIndex)) {
        paired.push([...leftRow, ...nullRow(rightColumns.length)]);
      }
    });
  }
  if (join.joinKind === "right" || join.joinKind === "full") {
    rightTable.rows.forEach((rightRow, rightIndex) => {
      if (!matchedRight.has(rightIndex)) {
        paired.push([...nullRow(leftColumnCount), ...rightRow]);
      }
    });
  }

  if (join.condition.kind === "using" || join.condition.kind === "natural") {
    return mergeSharedColumns(
      rawColumns,
      paired,
      sharedPairs,
      leftColumnCount,
      sql,
    );
  }
  return { columns: rawColumns, rows: paired };
}

// Resolves the statement's own base FROM source to a JoinResult: a real table resolves the ordinary way (resolveTable + tableColumns, exactly as joinTables always did), and a derived table is materialised by recursively evaluating its own inner query -- always standalone, with no outer scope of its own, since a plain (non-LATERAL) derived table can never reference the enclosing query's own columns (this module's own top-of-file comment, point 6). The materialised result's own columns carry the derived table's alias as their one qualifying name, exactly as tableColumns gives a real table's own columns their table (or alias) name.
function resolveFromSource(
  source: SqlFromSource,
  tables: readonly HsqldbTable[],
  sql: string,
): JoinResult {
  if (source.kind === "table") {
    const table = resolveTable(tables, source.table, sql);
    const qualifier =
      source.alias !== undefined ? source.alias.name : table.tableName;
    return { columns: tableColumns(qualifier, table), rows: table.rows };
  }
  const result = evaluateSelectInScope(source.query, tables, undefined);
  return {
    columns: result.columns.map((name) => ({
      qualifiers: [source.alias.name],
      columnName: name,
    })),
    rows: result.rows,
  };
}

// Folds every JOIN clause into the base table's own row set, left to right in the order written, via applyJoinClause -- each clause sees every table joined so far, not only the two tables its own clause names, which is exactly what src/odb/sql/parser.ts's own grammar note on self-joins relies on when a table repeats under two different aliases. `outer` (see this module's own top-of-file comment, point 6) is threaded through to every ON clause's own resolver, so a JOIN inside a correlated subquery can reference the enclosing row exactly as its WHERE clause can.
function joinTables(
  from: SqlFromClause,
  tables: readonly HsqldbTable[],
  sql: string,
  outer: OuterScope | undefined,
): JoinResult {
  let result: JoinResult = resolveFromSource(from.source, tables, sql);
  for (const join of from.joins) {
    result = applyJoinClause(result, join, tables, sql, outer);
  }
  return result;
}

export function evaluateSelect(
  statement: SqlSelectStatement,
  tables: readonly HsqldbTable[],
): SqlResultSet {
  return evaluateSelectInScope(statement, tables, undefined);
}

// The shared implementation behind both the public evaluateSelect (a top-level statement, no enclosing scope) and every subquery position this engine supports: a derived table in FROM (always evaluated with outer undefined -- see resolveFromSource above) and the operand of IN/EXISTS (evaluated once per outer row, with outer giving that row's own resolver and values as a correlation fallback -- see evaluateInSubquery/evaluateExists above and ColumnResolver.valueOf's own comment). A subquery is exactly as capable as a top-level statement -- JOINs of any kind, WHERE, GROUP BY, aggregates, ORDER BY, and further nested subqueries all work identically, since this is the identical pipeline either way.
function evaluateSelectInScope(
  statement: SqlSelectStatement,
  tables: readonly HsqldbTable[],
  outer: OuterScope | undefined,
): SqlResultSet {
  const { columns, rows } = joinTables(
    statement.from,
    tables,
    statement.sql,
    outer,
  );
  const resolver = new ColumnResolver(columns, statement.sql, outer);
  const plan = planSelectList(statement, resolver);

  const where = statement.where;
  const matching =
    where === undefined
      ? rows
      : rows.filter(
          (row) =>
            evaluatePredicate(where, row, resolver, tables, statement.sql) ===
            "true",
        );

  const hasAggregate = plan.some((item) => item.kind === "aggregate");
  if (statement.groupBy.length > 0 || hasAggregate) {
    if (
      statement.groupBy.length > 0 &&
      statement.items.some((item) => item.kind === "star")
    ) {
      throw new HsqldbSqlEvaluationError(
        "SELECT * is not valid with GROUP BY -- name the grouped columns and the aggregates explicitly",
        statement.sql,
      );
    }
    return evaluateGrouped(statement, plan, matching, resolver);
  }
  return evaluateUngrouped(statement, plan, matching, resolver);
}
