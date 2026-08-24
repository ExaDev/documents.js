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
  SqlLiteral,
  SqlNameRef,
  SqlOperand,
  SqlPredicate,
  SqlSelectStatement,
  SqlSortDirection,
} from "./parser";

// Executes a parsed single-table SELECT (src/odb/sql/parser.ts) against a real HsqldbTable -- the exact table shape readOdbTables produces for every .odb tier, so a saved .odb query can be run over the data this package already extracts, with no database engine anywhere in the path. Everything happens in memory over the rows it is handed; nothing here reads a package, a file, or a network connection.
//
// It follows the same never-guess policy the parser does (see src/odb/sql/errors.ts's top-of-file comment for the src/hsqldb/script.ts precedent being followed): a statement that parsed cleanly but cannot be executed faithfully against the data -- an unresolvable table or column, a comparison between genuinely incomparable value kinds, an aggregate over non-numeric values, a select list GROUP BY cannot justify -- throws HsqldbSqlEvaluationError rather than substituting a default, skipping the row, or returning a partial result.
//
// Four semantic decisions are worth stating outright, because each is a real choice a SQL implementation has to make and each is covered by its own test:
//
// 1. NULL is ContentCellValue's own { kind: 'empty' }, and WHERE uses genuine SQL three-valued logic: a comparison with a NULL operand is UNKNOWN, not false, and a row survives WHERE only when the predicate evaluates to TRUE. NOT UNKNOWN is UNKNOWN; UNKNOWN AND FALSE is FALSE; UNKNOWN OR TRUE is TRUE. IS [NOT] NULL is the only predicate here that can never be UNKNOWN.
// 2. Value comparison and the five aggregates' own NULL handling are src/odb/values.ts's, shared verbatim with src/odb/formula/'s Report Builder engine rather than restated here: values compare within three classes and never across them, and SUM/AVG/MIN/MAX skip NULLs and return NULL for a group with no non-NULL value at all. See that module's own top-of-file comment for the full statement of both rules.
// 3. GROUP BY partitions by the grouped columns' own values, with all NULLs forming one group (SQL's own rule), and groups come back in first-appearance order -- SQL does not define an order without ORDER BY, and first-appearance is the one deterministic choice available. COUNT(*) counts rows; COUNT(column) counts non-NULL values; SUM/AVG/MIN/MAX ignore NULLs and return NULL for a group with no non-NULL value at all. An aggregate with no GROUP BY treats the whole (post-WHERE) row set as one group, and still returns exactly one row when that set is empty.
// 4. ORDER BY sorts NULLs last under ASC (and therefore first under DESC, since a descending term is the ascending comparison negated). The sort is stable, so rows tied on every ORDER BY term keep their original relative order, and a multi-column ORDER BY resolves ties left to right.

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

// SQL's own identifier rule, as both HSQLDB and Firebird implement it and as real LibreOffice-generated .odb queries rely on: a double-quoted name matches only exactly, while an unquoted one (already folded to upper case by the lexer) may also match a real name case-insensitively. An unquoted name matching more than one real name case-insensitively is genuinely ambiguous and throws rather than picking one.
function resolveName(
  candidates: readonly string[],
  ref: SqlNameRef,
  what: string,
  sql: string,
): string {
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

// Every column reference in a statement resolves to the same index on every row, so resolution happens once per reference and is memoised by the AST node's own identity -- a large table would otherwise re-scan the column list once per row per reference.
class ColumnResolver {
  private readonly cache = new Map<SqlColumnRef, number>();
  private readonly columnNames: readonly string[];

  constructor(
    private readonly table: HsqldbTable,
    private readonly sql: string,
  ) {
    this.columnNames = table.columns.map((column) => column.name);
  }

  nameAt(index: number): string {
    const name = this.columnNames[index];
    if (name === undefined) {
      throw new HsqldbSqlEvaluationError(
        `column index ${String(index)} is outside table "${this.table.tableName}"`,
        this.sql,
      );
    }
    return name;
  }

  // Resolves a column reference to its index in the table's own column list, checking any table qualifier against the single table in FROM (a qualifier naming anything else can only be a reference to a table this statement never selected from).
  indexOf(ref: SqlColumnRef): number {
    const cached = this.cache.get(ref);
    if (cached !== undefined) {
      return cached;
    }
    if (ref.qualifier !== undefined) {
      const qualifier = resolveName(
        [this.table.tableName],
        ref.qualifier,
        "table qualifier",
        this.sql,
      );
      if (qualifier !== this.table.tableName) {
        throw new HsqldbSqlEvaluationError(
          `table qualifier "${ref.qualifier.name}" does not name the table in FROM ("${this.table.tableName}")`,
          this.sql,
        );
      }
    }
    const index = this.columnNames.indexOf(
      resolveName(this.columnNames, ref.column, "column", this.sql),
    );
    this.cache.set(ref, index);
    return index;
  }

  valueAt(index: number, row: readonly ContentCellValue[]): ContentCellValue {
    const value = row[index];
    if (value === undefined) {
      throw new HsqldbSqlEvaluationError(
        `malformed table "${this.table.tableName}": a row carries ${String(row.length)} values but the table declares ${String(this.columnNames.length)} columns`,
        this.sql,
      );
    }
    return value;
  }

  valueOf(
    ref: SqlColumnRef,
    row: readonly ContentCellValue[],
  ): ContentCellValue {
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
    case "not":
      return notTruth(
        evaluatePredicate(predicate.predicate, row, resolver, sql),
      );
    case "and":
      return andTruth(
        evaluatePredicate(predicate.left, row, resolver, sql),
        evaluatePredicate(predicate.right, row, resolver, sql),
      );
    case "or":
      return orTruth(
        evaluatePredicate(predicate.left, row, resolver, sql),
        evaluatePredicate(predicate.right, row, resolver, sql),
      );
  }
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

// The select list, resolved against the real table once: a plain column becomes its own index, an aggregate its function plus (for the four that take one) its argument's index, and SELECT * expands to every column index in declaration order. Resolving up front is what lets both projection paths below run with no unreachable branches for shapes that were already ruled out.
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
  table: HsqldbTable,
  resolver: ColumnResolver,
): readonly PlanItem[] {
  const plan: PlanItem[] = [];
  for (const item of statement.items) {
    switch (item.kind) {
      case "star":
        for (const [index] of table.columns.entries()) {
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

export function evaluateSelect(
  statement: SqlSelectStatement,
  tables: readonly HsqldbTable[],
): SqlResultSet {
  const table = resolveTable(tables, statement.from, statement.sql);
  const resolver = new ColumnResolver(table, statement.sql);
  const plan = planSelectList(statement, table, resolver);

  const where = statement.where;
  const matching =
    where === undefined
      ? table.rows
      : table.rows.filter(
          (row) =>
            evaluatePredicate(where, row, resolver, statement.sql) === "true",
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
