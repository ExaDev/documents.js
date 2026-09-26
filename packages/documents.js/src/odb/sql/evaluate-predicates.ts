// The predicate-evaluation half of the SQL engine, split from evaluate.ts: three-valued logic over compared values, literal conversion, LIKE patterns, and the WHERE/ON predicate walk (IN lists, IN subqueries, EXISTS). evaluate.ts keeps result-set assembly, aggregation and orchestration.
import type { ContentCellValue } from "document-schema.js";
import type { HsqldbTable } from "../../hsqldb/script";
import { CELL_NULL, cellComparisonKey, compareCellValues } from "../values";
import { HsqldbSqlEvaluationError } from "./errors";
import type { SqlComparisonOperator } from "./lexer";
import type { ColumnResolver } from "./evaluate-columns";
import { evaluateSelectInScope } from "./evaluate";
import {
  assertNeverLiteralKind,
  assertNeverOperator,
  assertNeverPredicateKind,
} from "./evaluate";
import type {
  SqlLiteral,
  SqlOperand,
  SqlPredicate,
  SqlSelectStatement,
} from "./parser";

export type Truth = "true" | "false" | "unknown";

// Turns a src/odb/values.ts failure into this engine's own error, carrying the statement that produced it. Shared value semantics, engine-specific error class — see that module's own top-of-file comment for why the split exists.
export function sqlFailure(sql: string): (message: string) => Error {
  return (message: string) => new HsqldbSqlEvaluationError(message, sql);
}

export function compareValues(
  left: ContentCellValue,
  right: ContentCellValue,
  sql: string,
): number {
  return compareCellValues(left, right, sqlFailure(sql));
}

export function truthOfComparison(
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
  return assertNeverOperator(operator);
}

export function notTruth(truth: Truth): Truth {
  if (truth === "true") {
    return "false";
  }
  return truth === "false" ? "true" : "unknown";
}

export function andTruth(left: Truth, right: Truth): Truth {
  if (left === "false" || right === "false") {
    return "false";
  }
  return left === "true" && right === "true" ? "true" : "unknown";
}

export function orTruth(left: Truth, right: Truth): Truth {
  if (left === "true" || right === "true") {
    return "true";
  }
  return left === "false" && right === "false" ? "false" : "unknown";
}

export function literalToValue(literal: SqlLiteral): ContentCellValue {
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
  return assertNeverLiteralKind(literal);
}

// SQL LIKE, with % matching any run of characters (including none) and _ matching exactly one. Case-sensitive, matching both HSQLDB's and Firebird's own default LIKE behaviour. Every other character in the pattern matches literally, including regular-expression metacharacters, which is what the escaping below is for; a LIKE ... ESCAPE clause is rejected outright by the parser rather than approximated here.
export function likePatternToRegExp(pattern: string): RegExp {
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

export function operandValue(
  operand: SqlOperand,
  row: readonly ContentCellValue[],
  resolver: ColumnResolver,
): ContentCellValue {
  return operand.kind === "literal"
    ? literalToValue(operand.literal)
    : resolver.valueOf(operand.column, row);
}

export function evaluateLike(
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

export function evaluateIn(
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
  // SQL's own rule, and the one most easily got wrong: a non-match against a list containing NULL is UNKNOWN, not FALSE — which is why "x NOT IN (1, NULL)" excludes every row rather than keeping the ones where x is not 1.
  return sawNull ? "unknown" : "false";
}

export function evaluatePredicate(
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
  return assertNeverPredicateKind(predicate);
}

// IN (SELECT ...): the inner query must produce exactly one column (SQL's own rule — a row-valued or multi-column IN needs a row constructor on the left, which this grammar has no expression syntax for at all), and this follows evaluateIn's own three-valued rule identically: a NULL left operand is UNKNOWN regardless of what the subquery produces, and a non-match against a result set containing a NULL is UNKNOWN rather than FALSE. `outerResolver`/`outerRow` give the subquery a correlation fallback (this module's own top-of-file comment, point 6) — used whether or not the subquery actually turns out to reference an outer column, since re-evaluating an uncorrelated subquery with a harmless, unused fallback in place produces the identical result.
export function evaluateInSubquery(
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

// EXISTS (SELECT ...): true precisely when the inner query produces at least one row, regardless of that row's own column values — unlike IN, EXISTS never inspects what the subquery selects, so an arbitrary select list (SELECT 1, SELECT *, SELECT COUNT(*)) is equally valid here. Never UNKNOWN: existence is a plain fact about the row set, not a comparison a NULL operand can leave undecided — NOT EXISTS negates it through the ordinary "not" predicate kind (parser.ts's own grammar note on EXISTS), which is exactly right since notTruth never turns a "true"/"false" input into "unknown".
export function evaluateExists(
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
