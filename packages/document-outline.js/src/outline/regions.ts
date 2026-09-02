import {
  cellReference,
  type CellRange,
  type ContentSheetCell,
} from "document-schema.js";

// Region segmentation (ExaDev/documents.js#823, "Ask 2"): a real sheet is a canvas, not a table -- a table in one corner, a column of unrelated prose commentary elsewhere, a sheet that is entirely narrative, label/value pairs scattered in margins. segmentSheetRegions finds the connected components of a sheet's populated cells and gives each a best-effort classification and confidence, PURELY AS AN ADDITIONAL, OPT-IN ARTEFACT alongside the lossless cell data ContentSheetCell[]/SheetDescriptor.cells already carries: this module never mutates its input and a consumer who never calls it loses nothing -- every cell is still there, unclassified. Classification ADDS information; it never gates what is emitted, because the failure mode of a structure-gated reader is silently dropping what it did not recognise, and a consumer cannot tell "the sheet does not say that" from "the reader did not understand that part" (the issue's own words, and the reason a region with no confident classification still comes back as 'unknown' rather than being omitted).
//
// The input is deliberately just the sparse cell array, not a whole ContentSheet/SheetDescriptor/SheetGroupNode: a consumer holding any one of those three (the flat codec-exchange sheet, its tree-form descriptor, or the tree group wrapper) reaches its own `cells` field and passes that straight through, and this module never needs column widths, print settings, or the sheet's images/embedded objects to do its job.
//
// RegionClassification is deliberately NOT spreadsheet-scoped in its name (unlike SheetRegion, whose `range`/`cells` genuinely are sheet-shaped): the issue is explicit that "regions with confidence" is a document-model concept, not a spreadsheet one -- a PDF's columns/tables/figures/captions have the identical shape (a spatial region, a kind, a confidence), and this is the vocabulary a future PDF region pass would reuse rather than re-mint under its own name. Only the spreadsheet case is implemented here; the shared vocabulary costs nothing extra to keep generic.
export type RegionClassification =
  "table" | "prose" | "model" | "mixed" | "unknown";

// One connected component of populated cells, its bounding box, and a best-effort classification. `range` is the bounding box of `cells` (min/max row and column actually populated) -- it may itself include blank gap rows/columns the tolerance rule bridged over, so a consumer wanting only the genuinely populated positions should read `cells`, not iterate `range`. `confidence` is this module's own new 0 (no signal either way) to 1 (unambiguous) scale -- there is no prior numeric confidence convention elsewhere in this workspace to match (documents.js's own PDF-reconstruction cell-typing reports a boolean accept/decline per cell, never a score), so 0..1 is introduced here and reused verbatim by deriveNeighbourLabels' own distance-based confidence in labels.ts, for consistency between the two advisory outputs this issue asks for.
export interface SheetRegion {
  readonly range: CellRange;
  readonly cells: readonly ContentSheetCell[];
  readonly classification: RegionClassification;
  readonly confidence: number;
}

// Segments a sheet's populated cells into regions. ADJACENCY RULE (the precise reading of the issue's "tolerating a blank row or column inside a block"): two populated cells connect directly when they share a column and are at most 2 rows apart (0 blank rows between them, i.e. immediately adjacent, or exactly 1 blank row between them), OR share a row and are at most 2 columns apart (the same tolerance on the other axis) -- never both at once. A region is the transitive closure of that relation (ordinary connected-component labelling), so a long unbroken run of same-column or same-row cells chains together even though no single hop in the chain skips more than one gap.
//
// This is a narrower rule than either 4-connectivity or 8-connectivity flood fill, and deliberately so: a pair of cells that are one row AND one column apart (an exact diagonal touch, e.g. (0,0) and (1,1)) shares neither a row nor a column, so it does NOT connect directly under this rule -- and a pair that is two rows AND two columns apart (a "diagonal-only jump across both a blank row and a blank column") does not connect either, for the same reason. Both of those are still reachable transitively through a real block (a dense table's neighbouring cells already provide same-row and same-column hops in every direction), so an ordinary rectangular table is unaffected; what this rule refuses to bridge is two cells that are ONLY diagonally near each other with nothing else populated between them -- exactly the "loose flood fill" the issue's wording warns against, and exactly what keeps a legitimately separate table and an unrelated scattered annotation a few rows and columns away from merging into one region merely because they happen to sit near one another on both axes at once.
//
// Cell footprints are NOT expanded across a merged cell's rowSpan/colSpan for this connectivity check: a merged cell's `row`/`column` (its anchor position, the only position document-schema.js's sparse cell model actually materialises -- colSpan/rowSpan "are set on the anchor cell only", per ContentSheetCellSchema's own doc comment) is its one position for adjacency purposes, the same way every other per-cell computation in this ecosystem reads a merged cell at its anchor. A real table's own data rows already provide same-row/same-column hops to a merged header regardless (the header's anchor sits at the header row's own gap-tolerant distance from the data below), so this is a scope boundary rather than a gap in a common case: full merged-span occupancy is additional complexity with no concrete case in this issue's test list that needs it.
export function segmentSheetRegions(
  cells: readonly ContentSheetCell[],
): SheetRegion[] {
  const components = connectedComponents(cells);
  return components
    .map((componentCells) => {
      const range = boundingRange(componentCells);
      const { classification, confidence } = classifyRegion(
        computeSignals(componentCells),
      );
      return { range, cells: componentCells, classification, confidence };
    })
    .sort(
      (a, b) =>
        a.range.startRow - b.range.startRow ||
        a.range.startColumn - b.range.startColumn,
    );
}

// The row/column gap the adjacency rule tolerates: a difference of 1 (immediately adjacent, 0 blank cells between) or 2 (exactly 1 blank cell between) connects; 3 or more (2+ blank cells between) does not.
const GAP_TOLERANCE = 2;

// A minimal union-find over cellReference() keys -- string keys rather than a numeric index, since the input is a sparse cell array with no dense id space to allocate from. find() applies path compression on every call so a long chain (a full column or row of cells) never re-walks its whole prior structure per union.
class DisjointCellSet {
  private readonly parent = new Map<string, string>();

  private root(key: string): string {
    let current = key;
    let next = this.parent.get(current);
    while (next !== undefined && next !== current) {
      current = next;
      next = this.parent.get(current);
    }
    // Path compression: point every visited node directly at the discovered root.
    let walk = key;
    let step = this.parent.get(walk);
    while (step !== undefined && step !== current) {
      this.parent.set(walk, current);
      walk = step;
      step = this.parent.get(walk);
    }
    return current;
  }

  ensure(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  union(a: string, b: string): void {
    const rootA = this.root(a);
    const rootB = this.root(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  find(key: string): string {
    return this.root(key);
  }
}

function keyOf(cell: ContentSheetCell): string {
  return cellReference(cell.row, cell.column);
}

// Groups populated cells into connected components under the adjacency rule documented on segmentSheetRegions above. Runs in O(n log n): grouping by column/row and sorting each group is the only ordering work, and only CONSECUTIVE pairs within one column's row-sorted list (or one row's column-sorted list) are ever compared -- sufficient because any pair further apart in the same column/row that the tolerance would connect is already bridged transitively through the cells sorted between them, and any pair the tolerance would NOT connect can only become connected (if at all) through a different column/row's own chain, which this same per-group pass also covers.
function connectedComponents(
  cells: readonly ContentSheetCell[],
): ContentSheetCell[][] {
  const dsu = new DisjointCellSet();
  for (const cell of cells) dsu.ensure(keyOf(cell));

  const byColumn = new Map<number, ContentSheetCell[]>();
  const byRow = new Map<number, ContentSheetCell[]>();
  for (const cell of cells) {
    const column = byColumn.get(cell.column);
    if (column === undefined) byColumn.set(cell.column, [cell]);
    else column.push(cell);
    const row = byRow.get(cell.row);
    if (row === undefined) byRow.set(cell.row, [cell]);
    else row.push(cell);
  }

  for (const column of byColumn.values()) {
    const sorted = [...column].sort((a, b) => a.row - b.row);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (
        previous !== undefined &&
        current !== undefined &&
        current.row - previous.row <= GAP_TOLERANCE
      ) {
        dsu.union(keyOf(previous), keyOf(current));
      }
    }
  }
  for (const row of byRow.values()) {
    const sorted = [...row].sort((a, b) => a.column - b.column);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (
        previous !== undefined &&
        current !== undefined &&
        current.column - previous.column <= GAP_TOLERANCE
      ) {
        dsu.union(keyOf(previous), keyOf(current));
      }
    }
  }

  const components = new Map<string, ContentSheetCell[]>();
  for (const cell of cells) {
    const root = dsu.find(keyOf(cell));
    const component = components.get(root);
    if (component === undefined) components.set(root, [cell]);
    else component.push(cell);
  }
  return [...components.values()];
}

function boundingRange(cells: readonly ContentSheetCell[]): CellRange {
  let startRow = Number.POSITIVE_INFINITY;
  let startColumn = Number.POSITIVE_INFINITY;
  let endRow = Number.NEGATIVE_INFINITY;
  let endColumn = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    if (cell.row < startRow) startRow = cell.row;
    if (cell.row > endRow) endRow = cell.row;
    if (cell.column < startColumn) startColumn = cell.column;
    if (cell.column > endColumn) endColumn = cell.column;
  }
  return { startRow, startColumn, endRow, endColumn };
}

// The value-kind vocabulary treated as "numeric" for classification purposes: the three ContentCellValue variants that carry a computed magnitude. Deliberately excludes 'date'/'time'/'dateTime' (structured, but not what distinguishes a calculation-heavy 'model' region from a plain data 'table') and 'boolean'/'error' (neither is a signal either way for this heuristic).
const NUMERIC_VALUE_KINDS = new Set(["number", "percentage", "currency"]);

interface RegionSignals {
  readonly cellCount: number;
  readonly rowSpan: number;
  readonly colSpan: number;
  readonly distinctRows: number;
  readonly distinctColumns: number;
  readonly formulaFraction: number;
  readonly numericFraction: number;
  readonly textFraction: number;
  readonly averageTextLength: number;
  readonly rowRegularity: number;
  readonly hasHeaderLikeRow: boolean;
}

// Computes the statistics classifyRegion's heuristics read. Each is a plain, cheap-to-explain measurement over the region's own cells -- no external corpus, no learned weights, just the signals a human skimming the sheet would themselves reach for.
function computeSignals(cells: readonly ContentSheetCell[]): RegionSignals {
  const rows = new Set<number>();
  const columns = new Set<number>();
  const rowCounts = new Map<number, number>();
  let formulaCount = 0;
  let numericCount = 0;
  let stringCount = 0;
  let totalTextLength = 0;
  for (const cell of cells) {
    rows.add(cell.row);
    columns.add(cell.column);
    rowCounts.set(cell.row, (rowCounts.get(cell.row) ?? 0) + 1);
    if (cell.formula !== undefined) formulaCount++;
    if (NUMERIC_VALUE_KINDS.has(cell.value.kind)) numericCount++;
    if (cell.value.kind === "string") {
      stringCount++;
      totalTextLength += cell.displayText.length;
    }
  }

  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);

  // Row regularity: a coefficient-of-variation-style uniformity score over how many populated cells each row carries. A rectangular table's rows all carry the same count (regularity 1); a sheet whose rows carry wildly different counts (a ragged, hand-filled area) scores low. A region spanning at most one populated row is trivially "regular" -- there is nothing to vary.
  const perRowCounts = [...rowCounts.values()];
  const meanRowCount =
    perRowCounts.reduce((sum, count) => sum + count, 0) / perRowCounts.length;
  const rowRegularity =
    perRowCounts.length <= 1
      ? 1
      : clamp01(
          1 -
            Math.sqrt(
              perRowCounts.reduce(
                (sum, count) => sum + (count - meanRowCount) ** 2,
                0,
              ) / perRowCounts.length,
            ) /
              meanRowCount,
        );

  // Header-row heuristic: the SIGNAL a table's header row actually provides is that it is text where the rows below it are not -- so this checks the region's own topmost populated row is predominantly text (>= 80%, tolerating one stray non-text header cell) AND at least one other row in the region is predominantly numeric/formula (>= 50%). Neither threshold is load-bearing on its own; the pair together is what separates "the first row happens to be text" (also true of a single-column prose block) from "the first row is uniquely textual among otherwise-numeric rows" (a real header).
  const topRowCells = cells.filter((cell) => cell.row === minRow);
  const topRowTextFraction =
    topRowCells.filter((cell) => cell.value.kind === "string").length /
    topRowCells.length;
  const hasNumericOtherRow = [...rowCounts.keys()]
    .filter((row) => row !== minRow)
    .some((row) => {
      const rowCells = cells.filter((cell) => cell.row === row);
      const numericLike = rowCells.filter(
        (cell) =>
          NUMERIC_VALUE_KINDS.has(cell.value.kind) ||
          cell.formula !== undefined,
      ).length;
      return numericLike / rowCells.length >= 0.5;
    });

  return {
    cellCount: cells.length,
    rowSpan: maxRow - minRow + 1,
    colSpan: maxColumn - minColumn + 1,
    distinctRows: rows.size,
    distinctColumns: columns.size,
    formulaFraction: formulaCount / cells.length,
    numericFraction: numericCount / cells.length,
    textFraction: stringCount / cells.length,
    averageTextLength: stringCount === 0 ? 0 : totalTextLength / stringCount,
    rowRegularity,
    hasHeaderLikeRow: topRowTextFraction >= 0.8 && hasNumericOtherRow,
  };
}

// A region below this many cells carries no structural signal at all -- one populated cell alone could be a title, a stray label, or a lone value, and anything a heuristic reported beyond "unknown" here would be guessing.
const MIN_CELLS_FOR_SIGNAL = 2;
// The score a candidate classification must clear before it is trusted at all; below this, nothing has enough evidence and the region is 'unknown'.
const SIGNAL_THRESHOLD = 0.35;
// How close the top two candidate scores must be (both already having cleared SIGNAL_THRESHOLD) before the region is called 'mixed' rather than confidently the top candidate -- a genuine tie in what the region looks like, not merely "another candidate also had some evidence".
const MIXED_MARGIN = 0.15;
// A cell whose average string length reaches this many characters is treated as fully "sentence-like" for the prose signal (a short label like a header cell contributes far less prose evidence than a genuine sentence of commentary); chosen as a rough sentence-fragment length, not a corpus-fitted constant.
const PROSE_LENGTH_NORM = 40;

function classifyRegion(signals: RegionSignals): {
  classification: RegionClassification;
  confidence: number;
} {
  if (signals.cellCount < MIN_CELLS_FOR_SIGNAL) {
    return { classification: "unknown", confidence: 1 };
  }

  const density = signals.cellCount / (signals.rowSpan * signals.colSpan);

  // table: a genuine 2D grid (more than one populated row AND more than one populated column -- a single row or single column is a list, not a table), weighted mostly by row regularity (a table's rows are the same width) and the header-row signal, with density as a smaller tie-breaker (a table with real internal gaps is still a table, just a slightly less certain one).
  const tableScore =
    signals.distinctRows > 1 && signals.distinctColumns > 1
      ? clamp01(
          0.5 * signals.rowRegularity +
            0.3 * (signals.hasHeaderLikeRow ? 1 : 0) +
            0.2 * density,
        )
      : 0;

  // prose: long, string-valued cells. A region of short text cells (a single stray label, a column of short codes) scores low even at 100% text fraction -- the averageTextLength factor is what distinguishes "text" from "prose".
  const proseScore = clamp01(
    signals.textFraction *
      clamp01(signals.averageTextLength / PROSE_LENGTH_NORM),
  );

  // model: weighted mostly toward formulas (the actual signal of "this is a calculation", not merely "this is a number" -- a plain numeric table full of literal values is still a table) with a smaller numeric contribution, since a region that is heavily formula-driven is virtually always numeric too and a formula-free region of plain numbers alone should not out-score a real table's own structural signal.
  const modelScore = clamp01(
    0.7 * signals.formulaFraction + 0.3 * signals.numericFraction,
  );

  const scored = (
    [
      { kind: "table", score: tableScore },
      { kind: "prose", score: proseScore },
      { kind: "model", score: modelScore },
    ] satisfies { kind: RegionClassification; score: number }[]
  ).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  if (top === undefined || second === undefined) {
    // Unreachable: the literal array above always has exactly three entries.
    return { classification: "unknown", confidence: 1 };
  }

  if (top.score < SIGNAL_THRESHOLD) {
    return { classification: "unknown", confidence: clamp01(1 - top.score) };
  }
  if (
    second.score >= SIGNAL_THRESHOLD &&
    top.score - second.score < MIXED_MARGIN
  ) {
    return {
      classification: "mixed",
      confidence: clamp01(1 - (top.score - second.score) / MIXED_MARGIN),
    };
  }
  return { classification: top.kind, confidence: clamp01(top.score) };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
