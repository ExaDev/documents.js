// The name, table and column resolution half of the SQL engine, split from evaluate.ts: identifier matching under SQL quoting rules, table resolution, column indexing and the scope-chaining ColumnResolver that correlated subqueries delegate through. evaluate.ts keeps predicate evaluation and orchestration.
import type { ContentCellValue } from "document-schema.js";
import type { HsqldbTable } from "../../hsqldb/script";
import {} from "../values";
import { HsqldbSqlEvaluationError } from "./errors";
import type { SqlColumnRef, SqlNameRef } from "./parser";

// SQL's own identifier rule, as both HSQLDB and Firebird implement it and as real LibreOffice-generated .odb queries rely on: a double-quoted name matches only exactly, while an unquoted one (already folded to upper case by the lexer) may also match a real name case-insensitively. Reports "no match at all" as undefined rather than throwing — the fallback signal ColumnResolver.tryLocalIndexOf uses to defer to an enclosing scope for a correlated subquery (see this module's own top-of-file comment, point 6) before finally giving up — but a genuine ambiguity (an unquoted name matching more than one real name case-insensitively) is still a hard, immediate error, since it is decisive within whatever candidate set was actually searched regardless of what an outer scope might also contain.
export function tryResolveName(
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
        `${what} "${ref.name}" is ambiguous—it matches ${folded.join(", ")} case-insensitively`,
        sql,
      );
    }
    // folded has at most one element here, since more than one already threw above, so it is exactly what this function itself promises to return: the single match, or undefined for no match at all.
    return folded[0];
  }
  return undefined;
}

export function resolveName(
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
    `${what} "${ref.name}" not found—available: ${candidates.length === 0 ? "(none)" : candidates.join(", ")}`,
    sql,
  );
}

export function resolveTable(
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

// A joined-row column: the name(s) it may legally be qualified by (normally the one table or alias that declared it, but two for a column USING/NATURAL merged from both sides of a join — see mergeSharedColumns), and its own real column name.
export interface ResolvedColumn {
  readonly qualifiers: readonly string[];
  readonly columnName: string;
}

// A shared column pairing a USING or NATURAL join matched on: `leftIndex` is an index into the LEFT side's own column list (which, after prior joins, may itself already hold merged columns), `rightIndex` is an index into the newly-joined table's own column list alone (0-based, never merged), and `columnName` is the real name the merged output column keeps — see mergeSharedColumns' own comment for why it is always the left side's name.
export interface SharedColumnPair {
  readonly leftIndex: number;
  readonly rightIndex: number;
  readonly columnName: string;
}

export function columnAt(
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

export function valueAtIndex(
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

// Resolves a column name against a narrowed set of candidate indices into `columns`, the same identifier rule tryResolveName applies (exact, case-sensitive match first; an unquoted reference also matching case-insensitively as a fallback) but keyed by INDEX rather than by name, and checking ambiguity by count of matching indices rather than distinct names. tryResolveName's own return-a-name contract is safe only when candidates cannot repeat (a single table's own column list, or the table-name list) — a joined column list can legitimately hold the identical name at more than one index (two different tables both declaring an ID column, or a self-join naming the same table twice), so two tables sharing a column name must still be flagged ambiguous even though "the name" itself resolves to only one string. Reports "no match at all" as undefined for the identical reason tryResolveName does (see its own comment); a genuine ambiguity is still immediate.
export function tryResolveColumnIndex(
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
      `column "${ref.name}" is ambiguous—it matches more than one joined column named "${ref.name}"`,
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
        `column "${ref.name}" is ambiguous—it matches ${foldedNames.join(", ")} case-insensitively`,
        sql,
      );
    }
    // firstFolded is set on the identical iteration that pushes to foldedNames, so it is defined exactly when foldedNames has its one surviving element (more than one already threw above), and undefined otherwise: exactly what this function itself promises to return.
    return firstFolded;
  }
  return undefined;
}

export function resolveColumnIndex(
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
    `column "${ref.name}" not found—available: ${candidateIndices.length === 0 ? "(none)" : candidateIndices.map((candidate) => columns[candidate]?.columnName ?? "?").join(", ")}`,
    sql,
  );
}

// The enclosing query's own resolver and current row, carried by a subquery's ColumnResolver so a correlated IN/EXISTS subquery can resolve a column its own FROM/JOIN does not declare against the row it is currently being evaluated for — see ColumnResolver.valueOf below, and this module's own top-of-file comment, point 6.
export interface OuterScope {
  readonly resolver: ColumnResolver;
  readonly row: readonly ContentCellValue[];
}

// Every column reference in a statement resolves to the same index on every row, so resolution happens once per reference and is memoised by the AST node's own identity — a large table would otherwise re-scan the joined column list once per row per reference.
//
// A resolver is built over the fully-joined column list at once, never one table alone: joinTables/applyJoinClause below produce that list (and its matching row shape) by folding every JOIN left to right, so the flat index space this class resolves into is exactly the position space a joined row's own values live in, whether the statement joins zero tables or several, and regardless of whether any join along the way merged a USING/NATURAL column pair into one.
export class ColumnResolver {
  private readonly cache = new Map<SqlColumnRef, number>();
  // The joined column list this resolver was built over, in exactly the order joinTables/applyJoinClause laid the corresponding row values out in.
  private readonly columns: readonly ResolvedColumn[];
  // Every qualifying name any column in this list may be referenced by, deduplicated — a plain table's own name, an alias, or (for a USING/NATURAL merged column) both sides' names at once.
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
    const qualifierName =
      ref.qualifier === undefined
        ? undefined
        : resolveName(
            this.qualifierNames,
            ref.qualifier,
            "table qualifier",
            this.sql,
          );
    const index = resolveColumnIndex(
      this.columns,
      this.candidateIndicesFor(qualifierName),
      ref.column,
      this.sql,
    );
    this.cache.set(ref, index);
    return index;
  }

  // Like indexOf, but purely local: reports "not found here" as undefined instead of throwing, so valueOf below can fall back to an enclosing (correlated-subquery) scope before finally giving up. A genuine local ambiguity still throws immediately — see tryResolveName/tryResolveColumnIndex's own comments.
  private tryLocalIndexOf(ref: SqlColumnRef): number | undefined {
    const cached = this.cache.get(ref);
    if (cached !== undefined) {
      return cached;
    }
    let qualifierName: string | undefined;
    if (ref.qualifier !== undefined) {
      qualifierName = tryResolveName(
        this.qualifierNames,
        ref.qualifier,
        "table qualifier",
        this.sql,
      );
      if (qualifierName === undefined) {
        return undefined;
      }
    }
    const index = tryResolveColumnIndex(
      this.columns,
      this.candidateIndicesFor(qualifierName),
      ref.column,
      this.sql,
    );
    if (index === undefined) {
      return undefined;
    }
    this.cache.set(ref, index);
    return index;
  }

  // Every column index a name could plausibly refer to, shared by indexOf and tryLocalIndexOf: every already-qualifier-matched column, or, with no qualifier at all, every column in the joined list.
  private candidateIndicesFor(
    qualifierName: string | undefined,
  ): readonly number[] {
    if (qualifierName === undefined) {
      return this.columns.map((_column, index) => index);
    }
    return this.columns
      .map((column, index) =>
        column.qualifiers.includes(qualifierName) ? index : -1,
      )
      .filter((index) => index >= 0);
  }

  valueAt(index: number, row: readonly ContentCellValue[]): ContentCellValue {
    return valueAtIndex(row, index, this.sql);
  }

  // Resolves and reads a column reference's value on `row`, falling back to the enclosing scope's own resolver and row — recursively, so a subquery nested several levels deep walks outward one scope at a time until something resolves it — when this resolver's own FROM/JOIN declares no matching column at all. This is the one point correlation actually happens: every WHERE/ON predicate reads its operands through operandValue, which reads them through this method, so a correlated subquery's WHERE or ON clause gets outer-row resolution with no further plumbing. When nothing resolves anywhere, this falls through to indexOf purely to raise its own identically-worded "not found"/ambiguity error.
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
