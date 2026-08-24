import type { ContentCellValue } from "document-schema.js";
import type { SqlResultSet } from "../sql/evaluate";
import {
  aggregateCellValues,
  CELL_NULL,
  cellComparisonKey,
  cellValuesEqual,
} from "../values";
import { RptFormulaEvaluationError } from "./errors";
import type { RptFormula, RptReference } from "./parser";
import { parseRptFormula } from "./parser";

// Runs a LibreOffice Report Builder report's own rpt formulas over a real result set -- the SqlResultSet src/odb/sql/ produces from a .odb's own saved query, or any equivalently-shaped set of named columns and rows. It resolves group breaks, opens and closes each group instance, and evaluates every band's formulas at that band's own scope, producing a flat band-instance stream a renderer can lay out. It renders nothing itself: no pages, no geometry, no styles.
//
// THE SCOPING RULE, which is the whole substance of this module.
//
// A report's groups are strictly nested: group 0 is the outermost, group 1 sits inside it, and the detail band sits inside the innermost. An aggregate is scoped to the band it appears in -- a SUM in group 1's footer totals only the rows of the group-1 instance that footer is closing, a SUM in group 0's footer totals that whole outer instance, and a SUM in the report footer totals every row. That much is uncontroversial. The part that is easy to get subtly wrong is when a group instance ENDS:
//
//     a group at level L starts a new instance at a row when its own group-expression breaks, OR when ANY ENCLOSING GROUP BREAKS
//
// The second half is what a naive implementation misses, and the checked-in fixture demonstrates exactly why it matters. Its inner group breaks on rpt:HASCHANGED("LEFT_QUARTER"), i.e. on the quarter changing. Between the rows (North, Q2) and (South, Q2) the quarter does NOT change -- so the inner group-expression is false there -- yet the region does, and a "Q2" subtotal spanning North's Q2 rows and South's Q2 rows would be a total no reader ever asked for. Every enclosing break therefore cascades inward, unconditionally. Stated as the recurrence this module implements: breaks[row][0] = ownBreak(0, row); breaks[row][L] = breaks[row][L - 1] || ownBreak(L, row); with every level breaking at row 0. That makes breaks[row] monotone across levels -- once true it stays true -- which is what lets the emission loop below find the outermost broken level and treat everything deeper as broken too.
//
// The cascade lives HERE and not in HASCHANGED. rpt:HASCHANGED(X) is implemented exactly as its name says -- X's value differs from its value on the immediately preceding row (and is true on the first row, which has no predecessor) -- with no knowledge of groups at all. Conflating the two would make HASCHANGED report true for the inner group's own expression at a row where the quarter genuinely had not changed, which is a different and wrong claim about the data. The nesting rule is a property of report structure; HASCHANGED is a property of a column. Both are tested separately.
//
// AGGREGATES ARE COMPUTED OVER A ROW RANGE, NOT ACCUMULATED ROW BY ROW. The result set is already fully in memory (readOdbTables materialises every row long before this runs), so group boundaries are computed in a first pass and each aggregate is then evaluated over its own instance's complete row range. This removes an ambiguity a streaming accumulator would otherwise force a choice about: a SUM in a group HEADER is the true total for the group about to be printed, not a running total that happens to include only the first row. Report Builder itself pre-passes for the same reason.
//
// A GROUP EXPRESSION MAY NOT DEPEND ON AN AGGREGATE, and this is checked up front rather than discovered mid-run. Group expressions decide the very instance boundaries an aggregate's row range is defined by, so a group expression reading an aggregate is genuinely circular; rather than pick one of the several plausible resolutions, this engine throws RptFormulaEvaluationError naming the dependency. The check is static (it walks the named-function reference graph before touching a row) so that an empty result set cannot make a circular report look like it succeeded.
//
// PAGE HEADERS AND PAGE FOOTERS ARE DELIBERATELY NOT PART OF THIS MODEL. Which rows land on which page is a layout decision this engine has no basis for making, so RptReportDefinition carries no page bands and runRptReport emits none; see src/odb/formula/definition.ts, which drops them explicitly rather than silently. In the real fixture both page bands carry only fixed-content labels and no rpt formula at all, so nothing evaluable is being skipped. A renderer that HAS decided its own page boundaries evaluates those bands itself, through evaluateRptBandOutsideData at the foot of this module -- the narrow entry point that exists precisely so deciding where pages fall stays the renderer's job while evaluating a formula stays this module's.

export type RptBandKind =
  | "report-header"
  | "group-header"
  | "detail"
  | "group-footer"
  | "report-footer";

// Where an aggregate in a given band draws its rows from: every row in the report, or the current instance of one group level.
export type RptScope =
  | { readonly kind: "report" }
  | { readonly kind: "group"; readonly level: number };

export interface RptNamedFunctionDefinition {
  readonly name: string;
  readonly formula: string;
}

export interface RptBandDefinition {
  // One entry per band element in document order, holding that element's own rpt:formula, or undefined for an element that has none (a rpt:fixed-content label). Positional rather than keyed because real Report Builder output names every control in a band "Formatted field", so element names are not unique enough to key on -- see src/odb/formula/definition.ts.
  readonly formulas: readonly (string | undefined)[];
}

export interface RptGroupDefinition {
  // The rpt:group-expression attribute's own formula text. Must evaluate to a boolean, which is what rpt:HASCHANGED(...) -- the only expression real Report Builder writes here -- produces; see resolveOwnBreak below for why a non-boolean is refused rather than reinterpreted.
  readonly groupExpression: string;
  // Named rpt:function definitions declared on this group. An aggregate among them is scoped to this group level, matching where it was declared.
  readonly functions: readonly RptNamedFunctionDefinition[];
  readonly header: RptBandDefinition | undefined;
  readonly footer: RptBandDefinition | undefined;
}

export interface RptReportDefinition {
  // Report-level named rpt:function definitions. An aggregate among them is scoped to the whole report.
  readonly functions: readonly RptNamedFunctionDefinition[];
  readonly reportHeader: RptBandDefinition | undefined;
  // Outermost group first. Report Builder nests groups strictly, so this is a chain rather than a tree.
  readonly groups: readonly RptGroupDefinition[];
  readonly detail: RptBandDefinition | undefined;
  readonly reportFooter: RptBandDefinition | undefined;
}

export interface RptBandInstance {
  readonly kind: RptBandKind;
  // The group level this band belongs to, for 'group-header'/'group-footer' only.
  readonly groupLevel: number | undefined;
  // The result-set row this instance was emitted against: the row itself for 'detail', the group instance's first row for 'group-header' and its last row for 'group-footer'. Undefined for the report header and footer, which belong to no row -- a per-row formula there therefore throws rather than silently reading an arbitrary row.
  readonly rowIndex: number | undefined;
  // One value per entry in the band definition's own `formulas`, in the same order; undefined wherever that entry was undefined.
  readonly values: readonly (ContentCellValue | undefined)[];
}

export interface RptReportRun {
  readonly bands: readonly RptBandInstance[];
}

interface GroupInstanceRange {
  readonly startRow: number;
  readonly endRowExclusive: number;
}

interface NamedFunction {
  readonly name: string;
  readonly formula: RptFormula;
  readonly scope: RptScope;
}

type ResolvedReference =
  | { readonly kind: "function"; readonly resolved: NamedFunction }
  | { readonly kind: "column"; readonly index: number };

// Every band's formulas, parsed once before any row is read: undefined where the band itself is absent, and undefined per entry where that element carries no rpt:formula.
type PreparedBand = readonly (RptFormula | undefined)[] | undefined;

interface PreparedBands {
  readonly reportHeader: PreparedBand;
  readonly detail: PreparedBand;
  readonly reportFooter: PreparedBand;
  readonly groups: readonly {
    readonly header: PreparedBand;
    readonly footer: PreparedBand;
  }[];
}

function fail(message: string, formula: string): never {
  throw new RptFormulaEvaluationError(message, formula);
}

// Resolution follows src/odb/sql/evaluate.ts's own unquoted-identifier rule: an exact match wins, otherwise a unique case-insensitive match, otherwise a failure naming what was available. The two reference spellings do not differ here -- see src/odb/formula/parser.ts on why [NAME] and "NAME" are one concept -- so there is no case-sensitive variant of this rule to apply. Generic over what is being matched so a function match yields the function itself rather than a name needing a second lookup.
function matchNamed<T>(
  candidates: readonly T[],
  nameOf: (candidate: T) => string,
  name: string,
): readonly T[] {
  const exact = candidates.filter((candidate) => nameOf(candidate) === name);
  return exact.length > 0
    ? exact
    : candidates.filter(
        (candidate) => nameOf(candidate).toUpperCase() === name.toUpperCase(),
      );
}

function identity(name: string): string {
  return name;
}

function prepareBandFormulas(
  band: RptBandDefinition,
): readonly (RptFormula | undefined)[] {
  return band.formulas.map((formula) =>
    formula === undefined ? undefined : parseRptFormula(formula),
  );
}

function prepareBand(band: RptBandDefinition | undefined): PreparedBand {
  return band === undefined ? undefined : prepareBandFormulas(band);
}

// The prepared, immutable half of a run: every formula parsed, every named function resolved and checked for cycles, every group expression checked for an aggregate dependency. Building this before any row is touched is what makes an unsupported function or a circular definition a failure of the report, not a failure that happens to surface on row 4.
class PreparedReport {
  readonly namedFunctions: ReadonlyMap<string, NamedFunction>;
  readonly groupExpressions: readonly RptFormula[];
  readonly bands: PreparedBands;
  readonly columnNames: readonly string[];
  // A reference resolves to the same column or function on every row, so resolution is memoised by the AST node's own identity -- the same reason src/odb/sql/evaluate.ts's ColumnResolver memoises, and it matters more here because an aggregate resolves its reference once per row of its range.
  private readonly resolutions = new Map<RptReference, ResolvedReference>();

  constructor(
    definition: RptReportDefinition,
    private readonly resultSet: SqlResultSet,
  ) {
    this.columnNames = resultSet.columns;
    const named = new Map<string, NamedFunction>();
    const declare = (
      functions: readonly RptNamedFunctionDefinition[],
      scope: RptScope,
    ): void => {
      for (const declaration of functions) {
        if (named.has(declaration.name)) {
          fail(
            `rpt:function "${declaration.name}" is declared more than once in this report`,
            declaration.formula,
          );
        }
        named.set(declaration.name, {
          name: declaration.name,
          formula: parseRptFormula(declaration.formula),
          scope,
        });
      }
    };
    declare(definition.functions, { kind: "report" });
    for (const [level, group] of definition.groups.entries()) {
      declare(group.functions, { kind: "group", level });
    }
    this.namedFunctions = named;
    this.groupExpressions = definition.groups.map((group) =>
      parseRptFormula(group.groupExpression),
    );
    this.bands = {
      reportHeader: prepareBand(definition.reportHeader),
      detail: prepareBand(definition.detail),
      reportFooter: prepareBand(definition.reportFooter),
      groups: definition.groups.map((group) => ({
        header: prepareBand(group.header),
        footer: prepareBand(group.footer),
      })),
    };
    for (const expression of this.groupExpressions) {
      this.rejectAggregateDependency(expression, expression, new Set<string>());
    }
  }

  // A group expression decides the instance boundaries an aggregate's own row range is defined by, so an aggregate anywhere in its reference graph is circular. Walked statically, before any row is read -- see this module's top-of-file comment.
  private rejectAggregateDependency(
    formula: RptFormula,
    expression: RptFormula,
    visiting: ReadonlySet<string>,
  ): void {
    if (formula.kind === "aggregate") {
      fail(
        `a group expression cannot depend on the aggregate rpt:${formula.aggregate}(${formula.reference.name}) -- an aggregate's own rows are defined by the very group boundaries this expression decides`,
        expression.text,
      );
    }
    const resolved = matchNamed(
      [...this.namedFunctions.values()],
      (candidate) => candidate.name,
      formula.reference.name,
    )[0];
    if (resolved === undefined) {
      return;
    }
    if (visiting.has(resolved.name)) {
      fail(
        `rpt:function "${resolved.name}" refers to itself, directly or through another function`,
        expression.text,
      );
    }
    this.rejectAggregateDependency(
      resolved.formula,
      expression,
      new Set([...visiting, resolved.name]),
    );
  }

  // A reference names either a declared rpt:function or a result-set column. A name that matches both is genuinely ambiguous -- nothing in the format says which wins -- so it throws rather than one silently shadowing the other, the same choice src/odb/sql/evaluate.ts makes for an ambiguous case-insensitive column match.
  resolveReference(
    reference: RptReference,
    formula: string,
  ): ResolvedReference {
    const cached = this.resolutions.get(reference);
    if (cached !== undefined) {
      return cached;
    }
    const functionMatches = matchNamed(
      [...this.namedFunctions.values()],
      (candidate) => candidate.name,
      reference.name,
    );
    const columnMatches = matchNamed(
      this.columnNames,
      identity,
      reference.name,
    );
    if (functionMatches.length + columnMatches.length > 1) {
      fail(
        `reference "${reference.name}" is ambiguous -- it matches ${[...functionMatches.map((match) => `rpt:function ${match.name}`), ...columnMatches.map((match) => `column ${match}`)].join(", ")}`,
        formula,
      );
    }
    const resolved = this.resolveSingleMatch(
      reference,
      functionMatches[0],
      columnMatches[0],
      formula,
    );
    this.resolutions.set(reference, resolved);
    return resolved;
  }

  private resolveSingleMatch(
    reference: RptReference,
    named: NamedFunction | undefined,
    columnName: string | undefined,
    formula: string,
  ): ResolvedReference {
    if (named !== undefined) {
      return { kind: "function", resolved: named };
    }
    if (columnName === undefined) {
      fail(
        `reference "${reference.name}" names neither a declared rpt:function nor a column of the report's own data -- functions: ${this.namedFunctions.size === 0 ? "(none)" : [...this.namedFunctions.keys()].join(", ")}; columns: ${this.columnNames.length === 0 ? "(none)" : this.columnNames.join(", ")}`,
        formula,
      );
    }
    return { kind: "column", index: this.columnNames.indexOf(columnName) };
  }

  valueAt(
    columnIndex: number,
    rowIndex: number,
    formula: string,
  ): ContentCellValue {
    const value = this.resultSet.rows[rowIndex]?.[columnIndex];
    if (value === undefined) {
      fail(
        `the report's own data has no value at row ${String(rowIndex)}, column ${String(columnIndex)}`,
        formula,
      );
    }
    return value;
  }
}

// The mutable half of a run: which instance of each group level is currently open. An aggregate at a group scope reads its row range from here at the moment its band is emitted, which is what makes a footer total its own instance and a header total the instance it is opening.
class RunState {
  private readonly openInstances: (GroupInstanceRange | undefined)[];

  constructor(
    levels: number,
    private readonly rowCount: number,
  ) {
    this.openInstances = Array.from({ length: levels }, () => undefined);
  }

  open(level: number, range: GroupInstanceRange): void {
    this.openInstances[level] = range;
  }

  openAt(level: number): GroupInstanceRange | undefined {
    return this.openInstances[level];
  }

  // Called only after the level's own footer has been emitted -- that footer's aggregates read this very range, so closing first would leave them with no rows to total.
  close(level: number): void {
    this.openInstances[level] = undefined;
  }

  rangeFor(scope: RptScope, formula: string): GroupInstanceRange {
    if (scope.kind === "report") {
      return { startRow: 0, endRowExclusive: this.rowCount };
    }
    const open = this.openInstances[scope.level];
    if (open === undefined) {
      fail(
        `an aggregate scoped to group level ${String(scope.level)} was evaluated while no instance of that group was open`,
        formula,
      );
    }
    return open;
  }
}

function textOf(
  value: ContentCellValue,
  formula: string,
  what: string,
): string | undefined {
  if (value.kind === "empty") {
    return undefined;
  }
  const key = cellComparisonKey(value);
  if (key?.valueClass !== "text") {
    // A report's own number formatting lives in the band cell's style, which this engine does not read, so rendering a number to text here would mean inventing a format -- exactly the silently-wrong-value failure this engine refuses.
    fail(
      `${what} requires a text value, but found a ${value.kind} value -- this engine does not format a number or a boolean into text, since a report's own number format lives in its band styles rather than in the formula`,
      formula,
    );
  }
  return key.text;
}

class FormulaEvaluator {
  constructor(
    private readonly prepared: PreparedReport,
    private readonly state: RunState,
  ) {}

  // Evaluates one formula. `rowIndex` is undefined in the report header and footer, which belong to no row; a per-row formula there fails rather than reading an arbitrary row. `scope` is the band's own scope, consulted only by aggregates. `visiting` guards the named-function graph against a cycle at evaluation time as well as at prepare time, since a cycle reachable only from a band formula never passes through the group-expression walk.
  evaluate(
    formula: RptFormula,
    rowIndex: number | undefined,
    scope: RptScope,
    visiting: ReadonlySet<string> = new Set<string>(),
  ): ContentCellValue {
    switch (formula.kind) {
      case "field":
        return this.referenceValue(
          formula.reference,
          this.requireRow(rowIndex, formula.text, "a field: reference"),
          formula.text,
          visiting,
        );
      case "hasChanged": {
        const rowOfChange = this.requireRow(
          rowIndex,
          formula.text,
          "rpt:HASCHANGED",
        );
        // The current row's value is read even on row 0, where the answer is true regardless, so that a reference naming no column and no function fails on the very first row rather than only once a second row arrives to compare against.
        const current = this.referenceValue(
          formula.reference,
          rowOfChange,
          formula.text,
          visiting,
        );
        if (rowOfChange === 0) {
          return { kind: "boolean", value: true };
        }
        const previous = this.referenceValue(
          formula.reference,
          rowOfChange - 1,
          formula.text,
          visiting,
        );
        return { kind: "boolean", value: !cellValuesEqual(current, previous) };
      }
      case "left": {
        const value = this.referenceValue(
          formula.reference,
          this.requireRow(rowIndex, formula.text, "rpt:LEFT"),
          formula.text,
          visiting,
        );
        const text = textOf(value, formula.text, "rpt:LEFT");
        // LEFT counts characters, so the prefix is taken over code points rather than UTF-16 code units -- identical for the fixture's own ASCII quarters, and correct rather than splitting a surrogate pair for anything outside the basic plane.
        return text === undefined
          ? CELL_NULL
          : {
              kind: "string",
              value: [...text].slice(0, formula.length).join(""),
            };
      }
      case "aggregate": {
        const range = this.state.rangeFor(scope, formula.text);
        const values: ContentCellValue[] = [];
        for (let row = range.startRow; row < range.endRowExclusive; row += 1) {
          values.push(
            this.referenceValue(formula.reference, row, formula.text, visiting),
          );
        }
        return aggregateCellValues(
          formula.aggregate,
          values,
          (message) => new RptFormulaEvaluationError(message, formula.text),
        );
      }
    }
  }

  private requireRow(
    rowIndex: number | undefined,
    formula: string,
    what: string,
  ): number {
    if (rowIndex === undefined) {
      fail(
        `${what} needs a data row, but the band it appears in belongs to no row (the report header and footer print outside the data)`,
        formula,
      );
    }
    return rowIndex;
  }

  // A reference is either a column of the report's own data or a declared rpt:function. A named function is evaluated in the scope it was DECLARED in, never the scope of the band that referenced it -- an aggregate declared on a group belongs to that group, exactly as if it had been written into that group's own band.
  private referenceValue(
    reference: RptReference,
    rowIndex: number,
    formula: string,
    visiting: ReadonlySet<string>,
  ): ContentCellValue {
    const resolved = this.prepared.resolveReference(reference, formula);
    if (resolved.kind === "column") {
      return this.prepared.valueAt(resolved.index, rowIndex, formula);
    }
    if (visiting.has(resolved.resolved.name)) {
      fail(
        `rpt:function "${resolved.resolved.name}" refers to itself, directly or through another function`,
        formula,
      );
    }
    return this.evaluate(
      resolved.resolved.formula,
      rowIndex,
      resolved.resolved.scope,
      new Set([...visiting, resolved.resolved.name]),
    );
  }
}

// A group expression IS the break test: true means this row opens a new instance. Real Report Builder writes rpt:HASCHANGED(...) here and nothing else, which is exactly a boolean, so a non-boolean value is refused by name rather than reinterpreted under a "group by this value's changes" rule this package has no real output to verify against.
function resolveOwnBreak(value: ContentCellValue, formula: string): boolean {
  if (value.kind !== "boolean") {
    fail(
      `a group expression must evaluate to a boolean break test (rpt:HASCHANGED(...)), but this one produced a ${value.kind} value`,
      formula,
    );
  }
  return value.value;
}

// Pass one's result: for every row and group level, whether a new instance of that level starts at that row. Built by the recurrence stated in this module's top-of-file comment, with the enclosing-break cascade making each row's flags monotone across levels. Wrapping the table in a class keeps the one place that indexes it -- and therefore the one place that has to account for an out-of-range index -- from being spread across the emission loop.
class GroupBreaks {
  private readonly rows: readonly (readonly boolean[])[];

  constructor(
    prepared: PreparedReport,
    evaluator: FormulaEvaluator,
    readonly rowCount: number,
  ) {
    const rows: boolean[][] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const flags: boolean[] = [];
      let enclosingBroke = false;
      for (const [level, expression] of prepared.groupExpressions.entries()) {
        // Evaluated on every row, row 0 included, even though row 0 opens every group regardless of what the expression says. Evaluating it there too is what makes a group expression that cannot produce a boolean break test fail on a one-row report exactly as it would on a longer one, rather than being skipped past by the short-circuit.
        const ownBreak = resolveOwnBreak(
          evaluator.evaluate(expression, rowIndex, { kind: "group", level }),
          expression.text,
        );
        const broke: boolean = enclosingBroke || rowIndex === 0 || ownBreak;
        flags.push(broke);
        enclosingBroke = broke;
      }
      rows.push(flags);
    }
    this.rows = rows;
  }

  // A plain Error rather than one of src/odb/formula/errors.ts's classes: reaching this is an internal invariant violation in the emission loop below, not anything a report or a formula could express, so there is no formula text to attribute it to.
  private flagsAt(rowIndex: number): readonly boolean[] {
    const flags = this.rows[rowIndex];
    if (flags === undefined) {
      throw new Error(
        `rpt report run: row ${String(rowIndex)} is outside the ${String(this.rowCount)} rows its group breaks were computed for`,
      );
    }
    return flags;
  }

  // The outermost level starting a new instance at this row, or -1 when none is. By the cascade rule the flags are monotone across levels, so the first true entry is the outermost break and every deeper level is broken too.
  outermostBreakAt(rowIndex: number): number {
    return this.flagsAt(rowIndex).indexOf(true);
  }

  breaksAt(rowIndex: number, level: number): boolean {
    return this.flagsAt(rowIndex)[level] === true;
  }

  // The instance of `level` that contains `rowIndex`: it starts at that row or at the nearest break before it, and ends at the next break at that level, or at the end of the data.
  instanceContaining(level: number, rowIndex: number): GroupInstanceRange {
    let startRow = rowIndex;
    while (startRow > 0 && !this.breaksAt(startRow, level)) {
      startRow -= 1;
    }
    let endRowExclusive = rowIndex + 1;
    while (
      endRowExclusive < this.rowCount &&
      !this.breaksAt(endRowExclusive, level)
    ) {
      endRowExclusive += 1;
    }
    return { startRow, endRowExclusive };
  }
}

// The scope an aggregate in the detail band draws its rows from: the innermost group it sits inside, or the whole report when the report declares no groups at all.
function detailScope(groupCount: number): RptScope {
  return groupCount === 0
    ? { kind: "report" }
    : { kind: "group", level: groupCount - 1 };
}

// Runs a report definition over a result set, producing the band instances a renderer lays out, in print order: the report header, then for each row the group headers that open at it, the detail band, and the group footers that close after it, and finally the report footer. Page headers and footers are deliberately absent -- see this module's top-of-file comment.
export function runRptReport(
  definition: RptReportDefinition,
  resultSet: SqlResultSet,
): RptReportRun {
  const rowCount = resultSet.rows.length;
  const levels = definition.groups.length;
  const prepared = new PreparedReport(definition, resultSet);
  const state = new RunState(levels, rowCount);
  const evaluator = new FormulaEvaluator(prepared, state);
  const bands: RptBandInstance[] = [];

  const emit = (
    band: PreparedBand,
    kind: RptBandKind,
    groupLevel: number | undefined,
    rowIndex: number | undefined,
    scope: RptScope,
  ): void => {
    if (band === undefined) {
      return;
    }
    bands.push({
      kind,
      groupLevel,
      rowIndex,
      values: band.map((formula) =>
        formula === undefined
          ? undefined
          : evaluator.evaluate(formula, rowIndex, scope),
      ),
    });
  };

  emit(prepared.bands.reportHeader, "report-header", undefined, undefined, {
    kind: "report",
  });

  const breaks = new GroupBreaks(prepared, evaluator, rowCount);
  // Innermost first, so a nested group's own footer prints inside its parent's.
  const closeFrom = (level: number): void => {
    for (let openLevel = levels - 1; openLevel >= level; openLevel -= 1) {
      const open = state.openAt(openLevel);
      if (open === undefined) {
        continue;
      }
      // Emitted while the instance is still open, because the footer's own aggregates total exactly this range.
      emit(
        prepared.bands.groups[openLevel]?.footer,
        "group-footer",
        openLevel,
        open.endRowExclusive - 1,
        { kind: "group", level: openLevel },
      );
      state.close(openLevel);
    }
  };

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const outermostBroken = breaks.outermostBreakAt(rowIndex);
    if (outermostBroken >= 0) {
      closeFrom(outermostBroken);
      // Outermost first, so a parent group's own header prints before the child's.
      for (let level = outermostBroken; level < levels; level += 1) {
        state.open(level, breaks.instanceContaining(level, rowIndex));
        emit(
          prepared.bands.groups[level]?.header,
          "group-header",
          level,
          rowIndex,
          { kind: "group", level },
        );
      }
    }
    emit(
      prepared.bands.detail,
      "detail",
      undefined,
      rowIndex,
      detailScope(levels),
    );
  }
  closeFrom(0);

  emit(prepared.bands.reportFooter, "report-footer", undefined, undefined, {
    kind: "report",
  });
  return { bands };
}

// Evaluates one band that prints OUTSIDE the data -- belonging to no row, at report scope -- against the same definition (and therefore the same named rpt:functions) a full run would use. The page header and page footer are the real callers: this engine models no pages at all, so a renderer that has decided its own page boundaries evaluates those two bands itself.
//
// Report scope is the right scope for them, and not an approximation, under exactly one condition: the renderer has resolved the whole report onto a SINGLE logical page. A page's own rows are then every row, so a page band's aggregate covers precisely the rows the report footer's would. Under a real multi-page model it would not be, and this function would be the wrong tool -- which is why it names the property it assumes rather than presenting itself as generic page-band evaluation.
//
// Nothing needs special-casing for the two ways a page band can hold something this scope cannot answer, because both already fail correctly by construction: a per-row formula (field:[X], rpt:HASCHANGED, rpt:LEFT) throws for belonging to no row, exactly as it does in the report header, and rpt:PAGENUMBER or any other genuinely page-dependent function throws from the parser as an unsupported function. Neither is silently rendered as a blank or a plausible-looking wrong value.
export function evaluateRptBandOutsideData(
  definition: RptReportDefinition,
  band: RptBandDefinition,
  resultSet: SqlResultSet,
): readonly (ContentCellValue | undefined)[] {
  const prepared = new PreparedReport(definition, resultSet);
  const evaluator = new FormulaEvaluator(
    prepared,
    new RunState(definition.groups.length, resultSet.rows.length),
  );
  return prepareBandFormulas(band).map((formula) =>
    formula === undefined
      ? undefined
      : evaluator.evaluate(formula, undefined, { kind: "report" }),
  );
}
