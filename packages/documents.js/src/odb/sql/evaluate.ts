import type { ContentCellValue } from "document-schema.js";
import {
  columnAt,
  ColumnResolver,
  resolveColumnIndex,
  resolveTable,
  valueAtIndex,
  type OuterScope,
  type ResolvedColumn,
  type SharedColumnPair,
} from "./evaluate-columns";
import {
  compareValues,
  evaluatePredicate,
  sqlFailure,
} from "./evaluate-predicates";
import type { HsqldbTable } from "../../hsqldb/script";
import { aggregateCellValues, CELL_NULL } from "../values";
import { HsqldbSqlEvaluationError } from "./errors";
import type {
  SqlAggregateFunction,
  SqlFromClause,
  SqlFromSource,
  SqlJoinClause,
  SqlPredicate,
  SqlSelectStatement,
  SqlSortDirection,
} from "./parser";

// Executes a parsed SELECT (src/odb/sql/parser.ts) — one table (or one derived table), plus zero or more JOINs of any kind, plus IN/EXISTS subqueries in WHERE or a JOIN's own ON — against real HsqldbTables, the exact table shape readOdbTables produces for every .odb tier, so a saved .odb query can be run over the data this package already extracts, with no database engine anywhere in the path. Everything happens in memory over the rows it is handed; nothing here reads a package, a file, or a network connection.
//
// It follows the same never-guess policy the parser does (see src/odb/sql/errors.ts's top-of-file comment for the src/hsqldb/script.ts precedent being followed): a statement that parsed cleanly but cannot be executed faithfully against the data — an unresolvable table or column, an ambiguous unqualified reference two joined tables both declare, a comparison between genuinely incomparable value kinds, an aggregate over non-numeric values, a select list GROUP BY cannot justify, an IN (SELECT ...) whose subquery produces more or less than one column — throws HsqldbSqlEvaluationError rather than substituting a default, skipping the row, or returning a partial result.
//
// Six semantic decisions are worth stating outright, because each is a real choice a SQL implementation has to make and each is covered by its own test:
//
// 1. NULL is ContentCellValue's own { kind: 'empty' }, and both WHERE and a JOIN's own ON use genuine SQL three-valued logic: a comparison with a NULL operand is UNKNOWN, not false, and a row (or row pair) survives only when the predicate evaluates to TRUE. NOT UNKNOWN is UNKNOWN; UNKNOWN AND FALSE is FALSE; UNKNOWN OR TRUE is TRUE. IS [NOT] NULL and EXISTS/NOT EXISTS are the only predicates here that can never be UNKNOWN.
// 2. Value comparison and the five aggregates' own NULL handling are src/odb/values.ts's, shared verbatim with src/odb/formula/'s Report Builder engine rather than restated here: values compare within three classes and never across them, and SUM/AVG/MIN/MAX skip NULLs and return NULL for a group with no non-NULL value at all. See that module's own top-of-file comment for the full statement of both rules.
// 3. GROUP BY partitions by the grouped columns' own values, with all NULLs forming one group (SQL's own rule), and groups come back in first-appearance order — SQL does not define an order without ORDER BY, and first-appearance is the one deterministic choice available. COUNT(*) counts rows; COUNT(column) counts non-NULL values; SUM/AVG/MIN/MAX ignore NULLs and return NULL for a group with no non-NULL value at all. An aggregate with no GROUP BY treats the whole (post-WHERE) row set as one group, and still returns exactly one row when that set is empty.
// 4. ORDER BY sorts NULLs last under ASC (and therefore first under DESC, since a descending term is the ascending comparison negated). The sort is stable, so rows tied on every ORDER BY term keep their original relative order, and a multi-column ORDER BY resolves ties left to right.
// 5. Each JOIN clause is a plain nested-loop join, folded into the row set left to right in the order written (joinTables/applyJoinClause below): the first JOIN's own condition tests every (base row, joined row) pair, the second JOIN's own condition then tests every (surviving pair, its joined row) triple, and so on. For INNER and CROSS, a row with no match on the other side is simply absent from the result; for LEFT/RIGHT/FULL, an unmatched row on the side that join kind preserves is kept, padded with NULL for every column the other side would have contributed. A USING or NATURAL join's shared columns are merged into one output column each, COALESCE(left, right) — see applyJoinClause and mergeSharedColumns' own comments for the full column-ordering and qualifier rules, and src/odb/sql/parser.ts's own top-of-file comment for the PostgreSQL semantics this follows.
// 6. A subquery (a derived table in FROM, or the operand of IN/EXISTS) is evaluated by this identical pipeline, recursively — evaluateSelectInScope below is what both the exported evaluateSelect and every subquery position actually call. A derived table never correlates with its enclosing query (real SQL's own rule for a plain, non-LATERAL derived table): it is evaluated once, standalone, with no outer scope at all. An IN/EXISTS subquery MAY correlate — it can reference a column its own FROM/JOIN cannot resolve, meaning the enclosing row — so it is evaluated once per outer row, with that row's own resolver and values available as a fallback (ColumnResolver.valueOf's own `outer` parameter): a column reference resolves locally first, and only falls back to the outer row when nothing in the subquery's own FROM/JOIN declares it at all, exactly as SQL's own scoping rule requires. This engine does not distinguish "provably uncorrelated" from "provably correlated" up front and cache the former's single result — every IN/EXISTS subquery is simply re-evaluated once per outer row, which is correct in both cases (an uncorrelated subquery is a pure function of `tables` alone, so re-running it produces the identical result every time) at the cost of doing so needlessly for the uncorrelated case; see this directory's own evaluate.test.ts (a correlated and an uncorrelated case, hand-built) for both shapes proven correct.

export interface SqlResultSet {
  // The result-set column labels, in order: a real table column's own name for a plain column item, or the aggregate's own rendering (COUNT(*), SUM(AMOUNT)) for an aggregate item.
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ContentCellValue[])[];
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
  // Array.prototype.sort is stable (ES2019 onward), which is exactly what carries tied rows through in their original order — nothing else here preserves it.
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
      return assertNeverValueKind(value);
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
        `column "${item.text}" is neither grouped nor aggregated—add it to GROUP BY or wrap it in an aggregate`,
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
        `ORDER BY column "${term.column.text}" is not a GROUP BY column—a grouped result has no single value for it`,
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
          // COUNT(*) counts rows, not values — the only aggregate that never looks at a column at all.
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

// A row of NULLs the width of one side of a join, used to pad the side an unmatched LEFT/RIGHT/FULL row has no partner on. Every entry is the identical CELL_NULL constant — safe to share by reference, since a ContentCellValue is never mutated in place anywhere in this module.
function nullRow(count: number): readonly ContentCellValue[] {
  return new Array<ContentCellValue>(count).fill(CELL_NULL);
}

// Every column NATURAL JOIN's left and right sides share, matched by real column name alone (never case-folded or quoted, unlike a user-typed identifier — these are structural properties of the tables themselves, not something the query spelled out). Iterates the left side in column order, which is what fixes the shared columns' own left-to-right order in the merged result (see mergeSharedColumns). A name appearing more than once on either side — two already-joined tables both declaring it, or (defensively) a table declaring it twice — cannot be matched to a single unambiguous partner, so it is refused rather than guessed at, the same "never guess" policy this module's own top-of-file comment states for every other ambiguous reference.
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
        `NATURAL JOIN cannot determine a unique match for column "${leftColumn.columnName}"—more than one column shares that name on one side of the join`,
        sql,
      );
    }
    seenNames.add(leftColumn.columnName);
    pairs.push({ leftIndex, rightIndex, columnName: leftColumn.columnName });
  });
  return pairs;
}

// Whether a row pair matches a USING/NATURAL join's implicit condition: every shared column pair equal, under the identical three-valued NULL logic WHERE and ON already use (a NULL on either side makes that pair's comparison UNKNOWN, which — like an ON clause — excludes the row pair rather than matching it).
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

// Collapses a USING/NATURAL join's shared column pairs into one output column each, exactly as PostgreSQL documents JOIN USING doing (see src/odb/sql/parser.ts's own top-of-file comment for the citation): the merged columns come first, in the order `sharedPairs` gives them, followed by the left side's own remaining columns, then the right side's remaining columns. Each merged column's value is COALESCE(left, right) — the left side's value when it is not NULL, otherwise the right's, which only differs from either side alone when an outer join has padded one side with NULL — and it may be qualified by either side's own qualifying name, since the merge is exactly what makes the two references the same column. The merged column keeps the LEFT side's own real column name; the two sides are only reachable this way because USING/NATURAL requires them to share a name in the first place, so this is a naming choice, not a semantic one.
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

// Folds one JOIN clause into the running joined row set, left to right (joinTables calls this once per clause): a plain nested loop over (left row, right row) pairs, tested against the clause's own condition — an ON predicate (reusing evaluatePredicate's own three-valued logic directly), a USING/NATURAL equi-join over shared columns (evaluateSharedColumnMatch), or, for CROSS, no condition at all. LEFT/FULL then re-adds every left row that matched nothing, padded with NULL for the right side's columns; RIGHT/FULL mirrors that for unmatched right rows. A USING/NATURAL join's raw (unmerged) result is finally collapsed by mergeSharedColumns; an ON or CROSS join's is not, since only USING/NATURAL ever declare two columns "the same".
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

// Resolves the statement's own base FROM source to a JoinResult: a real table resolves the ordinary way (resolveTable + tableColumns, exactly as joinTables always did), and a derived table is materialised by recursively evaluating its own inner query — always standalone, with no outer scope of its own, since a plain (non-LATERAL) derived table can never reference the enclosing query's own columns (this module's own top-of-file comment, point 6). The materialised result's own columns carry the derived table's alias as their one qualifying name, exactly as tableColumns gives a real table's own columns their table (or alias) name.
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

// Folds every JOIN clause into the base table's own row set, left to right in the order written, via applyJoinClause — each clause sees every table joined so far, not only the two tables its own clause names, which is exactly what src/odb/sql/parser.ts's own grammar note on self-joins relies on when a table repeats under two different aliases. `outer` (see this module's own top-of-file comment, point 6) is threaded through to every ON clause's own resolver, so a JOIN inside a correlated subquery can reference the enclosing row exactly as its WHERE clause can.
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

// The shared implementation behind both the public evaluateSelect (a top-level statement, no enclosing scope) and every subquery position this engine supports: a derived table in FROM (always evaluated with outer undefined — see resolveFromSource above) and the operand of IN/EXISTS (evaluated once per outer row, with outer giving that row's own resolver and values as a correlation fallback — see evaluateInSubquery/evaluateExists above and ColumnResolver.valueOf's own comment). A subquery is exactly as capable as a top-level statement — JOINs of any kind, WHERE, GROUP BY, aggregates, ORDER BY, and further nested subqueries all work identically, since this is the identical pipeline either way.
export function evaluateSelectInScope(
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
        "SELECT * is not valid with GROUP BY—name the grouped columns and the aggregates explicitly",
        statement.sql,
      );
    }
    return evaluateGrouped(statement, plan, matching, resolver);
  }
  return evaluateUngrouped(statement, plan, matching, resolver);
}

// Reached only if the union behind `operator` ever gains a member the switch above does not match: every current member has a case there, so `operator` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's own exhaustiveness, proven by the type checker rather than by a catch-all default that would silently accept a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so a test can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverOperator(value: never): never {
  throw new Error(`documents.js: unhandled operator ${JSON.stringify(value)}`);
}

// Reached only if the union behind `literal.kind` ever gains a member the switch above does not match: every current member has a case there, so `literal.kind` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's own exhaustiveness, proven by the type checker rather than by a catch-all default that would silently accept a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so a test can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverLiteralKind(value: never): never {
  throw new Error(`documents.js: unhandled literal ${JSON.stringify(value)}`);
}

// Reached only if the union behind `predicate.kind` ever gains a member the switch above does not match: every current member has a case there, so `predicate.kind` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's own exhaustiveness, proven by the type checker rather than by a catch-all default that would silently accept a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so a test can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverPredicateKind(value: never): never {
  throw new Error(`documents.js: unhandled predicate ${JSON.stringify(value)}`);
}

// Reached only if the union behind `value.kind` ever gains a member the switch above does not match: every current member has a case there, so `value.kind` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's own exhaustiveness, proven by the type checker rather than by a catch-all default that would silently accept a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so a test can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverValueKind(value: never): never {
  throw new Error(`documents.js: unhandled value ${JSON.stringify(value)}`);
}
