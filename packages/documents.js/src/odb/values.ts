import type { ContentCellValue } from "document-schema.js";

// The ContentCellValue comparison and aggregation semantics shared by both .odb expression engines: src/odb/sql/ (a bounded single-table SELECT) and src/odb/formula/ (Report Builder rpt formulas). Both compare values, both implement the identical five aggregates over the identical NULL-skipping rules, and both are handed exactly the ContentCellValue[] rows readOdbTables produces -- so the semantics live here once rather than being restated in each, where a fix to one would silently leave the other wrong.
//
// The one thing this module deliberately does NOT own is which error a violation raises: a comparison failure inside a SELECT is an HsqldbSqlEvaluationError quoting the offending statement, and the same failure inside a report formula is an RptFormulaEvaluationError quoting the offending formula. Each function therefore takes a `fail` factory and throws what the caller builds, rather than owning an error type neither engine would want.
//
// Two semantic rules are stated here rather than in either caller, because both callers depend on them being the same:
//
// 1. Values compare within three classes -- numeric (number/percentage/currency), boolean (false < true), and text (string/date/time/dateTime/error) -- and a comparison ACROSS classes throws rather than coercing, since coercing is exactly how an expression engine silently produces a wrong answer. Text comparison is UTF-16 code-unit order, not a locale collation: correct for the ISO-8601 date/time strings this package's readers produce, and deliberately not pretending to implement a database's own collation rules.
// 2. COUNT counts non-NULL values; SUM/AVG/MIN/MAX skip NULLs and return NULL for a set with no non-NULL value at all -- SQL's own rule, and the reason AVG over an all-NULL column is NULL rather than a division by zero. (SQL's COUNT(*), which counts ROWS rather than values, never reaches here: src/odb/sql/evaluate.ts answers it directly from the group's own row count.)

export type CellValueClass = "numeric" | "boolean" | "text";

export type CellComparisonKey =
  | { readonly valueClass: "numeric"; readonly numeric: number }
  | { readonly valueClass: "boolean"; readonly boolean: boolean }
  | { readonly valueClass: "text"; readonly text: string };

// The five aggregates both engines implement. Named without an engine prefix because it genuinely is one set: SQL's COUNT/SUM/AVG/MIN/MAX and Report Builder's rpt:COUNT/rpt:SUM/rpt:AVG/rpt:MIN/rpt:MAX are the same five functions over the same value model.
export type CellAggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

// Builds the error a caller wants thrown for a comparison or aggregation it cannot perform. Returning rather than throwing keeps the caller's own error class, message prefix, and carried context (the SQL statement, the rpt formula) out of this module entirely.
export type CellValueFailure = (message: string) => Error;

export const CELL_NULL: ContentCellValue = { kind: "empty" };

// A value's comparison class and comparable payload, or undefined for NULL -- every caller resolves NULL to its own answer (UNKNOWN in a SQL predicate, a sort position, a skipped aggregate input) before comparing.
export function cellComparisonKey(
  value: ContentCellValue,
): CellComparisonKey | undefined {
  switch (value.kind) {
    case "number":
    case "percentage":
    case "currency":
      return { valueClass: "numeric", numeric: value.value };
    case "boolean":
      return { valueClass: "boolean", boolean: value.value };
    case "date":
    case "time":
    case "dateTime":
    case "string":
    case "error":
      return { valueClass: "text", text: value.value };
    case "empty":
      return undefined;
  }
}

export function compareCellKeys(
  left: CellComparisonKey,
  right: CellComparisonKey,
  fail: CellValueFailure,
): number {
  if (left.valueClass === "numeric" && right.valueClass === "numeric") {
    return left.numeric === right.numeric
      ? 0
      : left.numeric < right.numeric
        ? -1
        : 1;
  }
  if (left.valueClass === "boolean" && right.valueClass === "boolean") {
    return left.boolean === right.boolean ? 0 : left.boolean ? 1 : -1;
  }
  if (left.valueClass === "text" && right.valueClass === "text") {
    return left.text === right.text ? 0 : left.text < right.text ? -1 : 1;
  }
  throw fail(
    `cannot compare a ${left.valueClass} value with a ${right.valueClass} value`,
  );
}

// Both operands are known non-NULL by the time this runs -- every caller resolves NULL to its own answer (or to a sort position) before comparing.
export function compareCellValues(
  left: ContentCellValue,
  right: ContentCellValue,
  fail: CellValueFailure,
): number {
  const leftKey = cellComparisonKey(left);
  const rightKey = cellComparisonKey(right);
  if (leftKey === undefined || rightKey === undefined) {
    throw fail(
      "a NULL value reached a comparison that had already ruled NULL out",
    );
  }
  return compareCellKeys(leftKey, rightKey, fail);
}

// Whether two values are the same value. Total where compareCellValues is partial: two values of different classes are unambiguously not equal, so this answers false rather than throwing the way an ordering comparison across classes has to. Two NULLs are equal to each other and to nothing else. It lives beside compareCellKeys because the two rules must agree wherever both apply -- equal here exactly when compareCellKeys would return 0 -- and src/odb/formula/'s rpt:HASCHANGED, which is nothing but "is this row's value different from the last row's", is what needs the total version.
export function cellValuesEqual(
  left: ContentCellValue,
  right: ContentCellValue,
): boolean {
  const leftKey = cellComparisonKey(left);
  const rightKey = cellComparisonKey(right);
  if (leftKey === undefined || rightKey === undefined) {
    return leftKey === rightKey;
  }
  if (leftKey.valueClass === "numeric" && rightKey.valueClass === "numeric") {
    return leftKey.numeric === rightKey.numeric;
  }
  if (leftKey.valueClass === "boolean" && rightKey.valueClass === "boolean") {
    return leftKey.boolean === rightKey.boolean;
  }
  return (
    leftKey.valueClass === "text" &&
    rightKey.valueClass === "text" &&
    leftKey.text === rightKey.text
  );
}

function numericOf(
  value: ContentCellValue,
  aggregate: CellAggregateFunction,
  fail: CellValueFailure,
): number {
  const key = cellComparisonKey(value);
  if (key?.valueClass !== "numeric") {
    throw fail(
      `${aggregate} requires numeric values, but found a ${value.kind} value`,
    );
  }
  return key.numeric;
}

// Aggregates a set of values that has already been gathered -- a GROUP BY partition's own column values in the SQL engine, a group instance's own row range in the report engine. Equality of the two callers' semantics is the point of this function existing.
export function aggregateCellValues(
  aggregate: CellAggregateFunction,
  values: readonly ContentCellValue[],
  fail: CellValueFailure,
): ContentCellValue {
  const present = values.filter((value) => value.kind !== "empty");
  if (aggregate === "COUNT") {
    return { kind: "number", value: present.length };
  }
  const first = present[0];
  if (first === undefined) {
    return CELL_NULL;
  }
  if (aggregate === "SUM" || aggregate === "AVG") {
    const total = present.reduce(
      (sum, value) => sum + numericOf(value, aggregate, fail),
      0,
    );
    return {
      kind: "number",
      value: aggregate === "SUM" ? total : total / present.length,
    };
  }
  return present.reduce(
    (best, value) =>
      (
        aggregate === "MIN"
          ? compareCellValues(value, best, fail) < 0
          : compareCellValues(value, best, fail) > 0
      )
        ? value
        : best,
    first,
  );
}
