/**
 * Recovers a `ContentTable` from a page's own text POSITIONS, for a table that is aligned by whitespace rather than drawn with rules. The counterpart to the gridline lattice (`detectGridLattice`, which `reconstructWordprocessing` reads a drawn table through): that path is better wherever it fires, because a lattice states the author's own cell boundaries outright instead of inferring them, so this one only ever runs for a page that path did not claim.
 *
 * Why both are needed. A drawn lattice is not how most manufacturer datasheets build a table. Measured against four real Prysmian cable datasheets at documents.js 6.1.1, the lattice path recovers no table on any of them, and `reconstructWordprocessing` collapses 205-325 positioned text items into 11-12 paragraph blocks. Two of the four (11kV-SACXB-58-115AWS-PE, 33kV-AL-XS35PE) nevertheless hold 35 and 31 rows in perfectly consistent x columns -- five and eight of them -- on pages carrying just 6 and 3 `rect` primitives, far too few to bound a table. Flattened to prose, a row reading `10.8  14.7  18.8` loses the only thing that says which figure belongs to which product, and no downstream consumer can recover it at any pattern quality (novus-power/hive#1233, novus-power/hive#1023, novus-power/hive#1298).
 *
 * Deliberately conservative: a false table is worse than a missed one here, because a caller renders what this returns as a real table and a reader trusts it. Every bar the constants below set must be cleared together (enough rows and columns, columns recurring across enough rows, rows filling enough columns, few enough glyph-only and leader-dot cells, and enough measurement columns), and anything short of all of them leaves the page untouched on its existing prose path rather than emitting a half-recovered guess.
 */
import type { ContentTable } from "document-schema.js";
import {
  sourcePageIndex,
  type LayoutDocument,
  type LayoutItem,
} from "pdf-codec";
import { setApart } from "./page-caption";
import { isMeasurement, statesValue } from "./table-cell-values";

/** Minimum rows sharing a column structure before this is called a table rather than coincidence. Two lines that happen to align prove nothing -- a heading above a paragraph aligns. Four is high enough that a real table's own header plus three data rows still qualifies, while a title block sitting above a caption does not. */
export const MIN_TABLE_ROWS = 4;

type TextItem = Extract<LayoutItem, { kind: "text" }>;

/** Vertical tolerance, in points, for treating two text items as sitting on the SAME row. Generous enough to absorb the sub-point baseline jitter a PDF writer introduces across one visual row (and the genuine few-tenths difference between a superscript unit and the figure beside it), tight enough that two consecutive 12pt lines -- which sit at least ~12pt apart -- can never collapse into one. */
const ROW_TOLERANCE_PT = 3;

/** Horizontal tolerance, in points, for treating two text items as belonging to the SAME column. Wider than the row tolerance on purpose: a column of numbers is commonly centred or right-aligned rather than left-aligned, so the x of each cell's own first glyph legitimately drifts by a few points down the column even though the column itself is fixed. */
const COLUMN_TOLERANCE_PT = 6;

/** Minimum columns before this is called a table at all. A single-column run of positioned text is just prose that happens to be left-aligned, which is the overwhelmingly common case on every page and must stay on the prose path. */
const MIN_TABLE_COLUMNS = 2;

/**
 * Fewest columns that must be predominantly numeric before this is called a table.
 *
 * The single most effective discriminator, and it was learned the hard way: on a real document corpus
 * the row/column bars below were cleared by page LAYOUT rather than by tables. A brochure's contents
 * page (`3.1 | Product Overview`), a two-column marketing block
 * (`APPLICATION | CABLE THIRD-PARTY ACCREDITATIONS`), and a decoratively-set title whose every glyph
 * is separately positioned (`i | n | s | t | a | l | l | a | t | i o | n`) all produce recurring x
 * positions across many rows, and all three were emitted as tables -- one of them as a long list of "products".
 *
 * A specification table states measurements, so at least one of its columns is figures (see
 * `table-cell-values.ts`'s MEASUREMENT_CELL). Prose and per-glyph text have no such column, which rejects both without needing
 * to describe what either looks like. Deliberately about the figures rather than the shape: a layout
 * can imitate any shape, but it cannot imitate a column of figures it does not contain.
 *
 * Counted among the columns AFTER the first, which is what separates a specification table from a
 * contents page. `3.1 | Product Overview` parses `3.1` as a number perfectly well, so a contents page
 * does have a numeric column -- its leftmost one. A specification table's leftmost column is the row
 * LABEL (`Overall diameter mm`), and the numbers it states sit to the right of it; a table whose only
 * numeric column is the first is an enumerated list, not a measurement.
 */
const MIN_NUMERIC_COLUMNS = 1;

/** Share of a column's own populated rows that must be measurements before that column counts as a measurement column. Half, not all, because a real value column carries the odd `-`, `N/A`, model code or footnote marker. The same half is the bar for most of a run of positions' values sharing an edge with the column to its left (`sharesAnEdge`), and for a run of positions right of a table's last column holding mostly words (`liesBesideTable`): in each, the odd value that does not follow the rest is noise and a share below half is no pattern. */
const MIN_COLUMN_NUMERIC_SHARE = 0.5;

/**
 * Share of a column's own populated rows that must repeat an earlier column's cell in the same row before that column is read as a copy, not as measurements.
 *
 * Two charts set side by side put their y-axis ticks on the same baselines, so their labels align into a two-column, many-row "table" of figures (`2.00 | 2.00`, `1.50 | 1.50`, ...) that clears every bar above. A chart's ticks are figures like any other, but a table's value column states something its row label does not, and a column that repeats another states nothing further, however many figures it holds. Half, for the same reason as MIN_COLUMN_NUMERIC_SHARE: the rows that break the repeat are noise, here a caption line and an x-axis label row that share a baseline with a tick.
 *
 * A genuine table is not affected by a column that happens to repeat another in a few rows (a nominal and a maximum that agree on some ratings), and one whose only other measurement column is a copy of the row label is missed, which the conservative stance above accepts.
 */
const MAX_REPEATED_COLUMN_SHARE = 0.5;

/** A run of leader dots, spaced or not, as a contents page draws between an entry and its folio. Four is past any ellipsis or abbreviation a real table cell carries. */
const LEADER_DOTS = /(?:\.\s?){4,}/;

/** Share of a table's rows that may carry leader dots before it is rejected as a contents page. A contents page whose folios are set in their own column passes every other bar: the folio column is all figures, so it reads as a measurement column. What gives it away is that nearly every row joins its entry to that folio with leaders, which no specification table does. Half, because a contents page's section headings and wrapped titles carry none. Measured on the reference manuals behind novus-power/hive#918: five contents pages (a meter guide, a resistor datasheet, a switchgear manual and two pages of a numbering handbook) were emitted as tables before this. */
const MAX_LEADER_ROW_SHARE = 0.5;

/** Longest a cell can be and still be one glyph of decoratively-set text rather than a value. */
const GLYPH_CELL_LENGTH = 1;

/** Share of a table's populated cells that may be single characters stating no value before it is rejected as per-glyph text rather than a table. A real table's cells are words and values; `i | n | s | t | a` is a title the PDF positioned letter by letter. A cell stating a value (`statesValue`) is excluded from the count deliberately: a single digit is a value, and counting it as a glyph rejected a perfectly ordinary table whose columns read `1 | 2 | 3` (caught by this module's own reading-order test), and so is a not-applicable dash, which a ratings table states in every column a size has no rating in, one dash to a cell, so that counting dashes rejected BS 7671's Tables 4F1B and 4F2B once each dash arrived as a run of its own rather than fused with its neighbours (novus-power/hive#4222). */
const MAX_GLYPH_CELL_SHARE = 0.3;

/** Minimum share of a table's detected columns that a row must actually populate before it is emitted as one of that table's rows, unless it states sparse data (see `statesSparseData`). Rows clearing MIN_TABLE_COLUMNS are enough to VOTE on where the columns are, but not enough to be a row: a wiring diagram's callout legend sits in positioned text like everything else, and on the real Prysmian datasheets its labels land two-to-a-row against a five- or eight-column table, arriving as rows that are 60-75% empty. Emitting those alongside the real data rows would hand a reader cells to mine properties out of that were never tabular at all, the precise false-table risk this module's own header comment refuses. A genuine data row fills 80-100% of its columns; a legend line fills 25-40%. */
const MIN_ROW_COLUMN_SHARE = 0.6;

/** Minimum share of the page's own candidate rows that a column must appear in before it counts as one of that table's columns. Below this, an x is an outlier -- a footnote marker, a stray annotation, one row's wrapped continuation -- and folding it in as a column would give every other row an empty cell there. Measured against every row on the page carrying MIN_TABLE_COLUMNS items, not against the table's own rows alone, which is stricter than it sounds: a page holding a small table among many non-tabular two-item rows can outvote a column every one of that table's rows uses (novus-power/hive#918). */
const MIN_COLUMN_ROW_SHARE = 0.5;

/** Groups a page's text items into visual rows by `yPt`, each row's own items ordered left to right. Rows themselves are returned top-down, which for PDF user space (y increasing UPWARD from the bottom of the page) means descending y -- so a caller reading the result top to bottom reads the page in reading order, not upside down. */
function groupIntoRows(items: readonly TextItem[]): TextItem[][] {
  // Each row keeps the y of the item that opened it, so a row is judged against its own first item's baseline without re-reading that item out of an array.
  const rows: { anchorYPt: number; items: TextItem[] }[] = [];
  for (const item of [...items].sort((a, b) => b.yPt - a.yPt)) {
    const open = rows[rows.length - 1];
    if (
      open !== undefined &&
      Math.abs(open.anchorYPt - item.yPt) <= ROW_TOLERANCE_PT
    ) {
      open.items.push(item);
      continue;
    }
    rows.push({ anchorYPt: item.yPt, items: [item] });
  }
  return rows.map((row) => [...row.items].sort((a, b) => a.xPt - b.xPt));
}

/** A span of x positions, both ends included. */
interface XSpan {
  readonly fromXPt: number;
  readonly toXPt: number;
}

/** A page's columns as `findColumns` finds them. */
interface Columns {
  /** The x of each column's start, ascending. */
  readonly starts: readonly number[];
  /** The runs of positions right of the last column that hold a block of text set beside the table rather than cells of it (`liesBesideTable`). */
  readonly beside: readonly XSpan[];
}

/** A run holding white space between two of its characters: several words or several figures, which a writer can set across more than one column as one run. */
const SEVERAL_PARTS = /\S\s+\S/;

/** Where a value ends and where its middle is: the edges a right-aligned and a centred column align their cells on. */
interface ValueEdges {
  readonly endXPt: number;
  readonly centreXPt: number;
}

/** The edges of a run stating one value (`ValueEdges`); `undefined` for a run that states no value, states several (`SEVERAL_PARTS`) or reports no width. */
function valueEdgesOf(item: TextItem): ValueEdges | undefined {
  const text = item.text.trim();
  if (
    item.widthPt === undefined ||
    !statesValue(text) ||
    SEVERAL_PARTS.test(text)
  ) {
    return undefined;
  }
  return {
    endXPt: item.xPt + item.widthPt,
    centreXPt: item.xPt + item.widthPt / 2,
  };
}

/** A run of x positions `findColumns` reads as one column before the vote: where it starts and ends, the edges of the values in it, the rows using it, and how many of its runs hold text and how many state a value. */
interface PositionRun {
  readonly xPt: number;
  lastXPt: number;
  readonly edges: ValueEdges[];
  readonly rows: Set<number>;
  runs: number;
  values: number;
}

/** Whether most values of `right`, at least MIN_COLUMN_NUMERIC_SHARE of them, end or have their middle within COLUMN_TOLERANCE_PT of where a value of `left` does: the two are one right-aligned or centred column. Most, not one, since a column's cells share its alignment edge as its figures do, while a value elsewhere on the page meets an edge of another column only by coincidence. */
function sharesAnEdge(left: PositionRun, right: PositionRun): boolean {
  const aligned = right.edges.filter((r) =>
    left.edges.some(
      (l) =>
        Math.abs(l.endXPt - r.endXPt) <= COLUMN_TOLERANCE_PT ||
        Math.abs(l.centreXPt - r.centreXPt) <= COLUMN_TOLERANCE_PT,
    ),
  );
  return (
    aligned.length > 0 &&
    aligned.length >= right.edges.length * MIN_COLUMN_NUMERIC_SHARE
  );
}

/**
 * The x positions that recur across enough of `rows` to be that block's real column starts, ascending, and the runs of positions right of the last of them that hold a block of text beside the table (`liesBesideTable`), which `lineStarts`, where each of the page's lines holding a single run starts, helps tell from a column. Every run of x positions each no more than COLUMN_TOLERANCE_PT from the one before is taken as one column, reported at its leftmost x, a column whose values end or centre where the values of the column to its left do (`sharesAnEdge`) is joined to that column, and a column appearing in MIN_COLUMN_ROW_SHARE of the rows survives the vote.
 *
 * Joining by a shared end or middle is what keeps a right-aligned or centred column whole however narrow one of its cells is. A cell narrower than its column's figures starts right of them, by up to their width, so a not-applicable dash under a column of three- and four-figure ratings starts as far right as the figures end, more than the tolerance from any of their starts, and a column heading or unit set over the figures' right half starts there too. Read by start alone those cells form a run of their own, which the rows holding a dash or the header rows can carry through the vote, giving the table a column the page never printed, with the dashes or the heading in it and the figures beside it under an empty heading (BS 7671's Table 4D1A, novus-power/hive#4222). The dash ends where the figures end, or is centred where they are, as every cell of a right-aligned or centred column is, while the cells of the next column are set apart from them and share neither edge. Only a run stating one value has edges that say where its column is: a heading or a run of several figures can span columns. Only neighbouring runs of positions are joined, and only by their own values, so the columns of two tables stacked on one page with their columns at different positions stay apart: a cell of one table's column can start inside a figure of the other's, but its end and middle are elsewhere.
 *
 * Clustering every position on the page at once, rather than bucketing them row by row as they arrive, is what makes a column's own internal drift harmless. A value column is commonly centred or right-aligned, so each cell's first glyph sits a little further left as its figure gets wider -- on the SPEL Puraceptor brochure's range table the silt column runs from `400`\@x253 down to `20,000`\@x248, and the catchment column from x185 down to x176. Bucketing row by row pins a bucket's anchor to the first cell it meets, which -- rows being walked top-down -- is whichever cell sits highest on the page, normally the header's own; every cell drifting more than the tolerance away from that one arbitrary x then splits off into a bucket of its own, and because each half now polls only part of the rows, the split is usually fatal to at least one of them. Measured on that page, three of the table's seven value columns split, and five of the six resulting halves lost the vote. (Deterministic, for the avoidance of doubt: `groupIntoRows` has already sorted the page into rows by descending y and each row by ascending x, so neither detector depends on the order documents.js itself emits items -- confirmed by re-running both over this corpus with each page's items permuted.) `columnIndexFor` then files their figures under the nearest surviving column to the LEFT, so `2,000 | 20,000` arrives as the single cell `2,000 20,000` with a blank beside it -- one of the two values gone, and the other under the wrong heading (novus-power/hive#918).
 */
function findColumns(
  rows: readonly TextItem[][],
  lineStarts: readonly number[],
): Columns {
  const started: PositionRun[] = [];
  const items = rows.flat().sort((a, b) => a.xPt - b.xPt);
  for (const item of items) {
    const open = started[started.length - 1];
    const edges = valueEdgesOf(item);
    const text = item.text.trim();
    const runs = text === "" ? 0 : 1;
    const values = statesValue(text) ? 1 : 0;
    if (open !== undefined && item.xPt - open.lastXPt <= COLUMN_TOLERANCE_PT) {
      open.lastXPt = item.xPt;
      if (edges !== undefined) {
        open.edges.push(edges);
      }
      open.runs += runs;
      open.values += values;
      continue;
    }
    started.push({
      xPt: item.xPt,
      lastXPt: item.xPt,
      edges: edges === undefined ? [] : [edges],
      rows: new Set(),
      runs,
      values,
    });
  }
  const columns: PositionRun[] = [];
  for (const run of started) {
    const left = columns[columns.length - 1];
    if (left !== undefined && sharesAnEdge(left, run)) {
      left.lastXPt = run.lastXPt;
      left.edges.push(...run.edges);
      left.runs += run.runs;
      left.values += run.values;
      continue;
    }
    columns.push(run);
  }
  rows.forEach((row, rowIndex) => {
    for (const item of row) {
      // Ascending and contiguous by construction -- every position on the page falls in exactly one -- so the last column starting at or left of this item is the one holding its own position.
      columns.findLast((column) => item.xPt >= column.xPt)?.rows.add(rowIndex);
    }
  });
  const kept = columns
    .filter((column) => column.rows.size >= rows.length * MIN_COLUMN_ROW_SHARE)
    .map((column) => column.xPt);
  const starts = withSubColumns(
    kept,
    columns
      .filter((column) => !kept.includes(column.xPt))
      .map((column) => column.xPt),
    rows,
  );
  const lastStart = starts[starts.length - 1];
  return {
    starts,
    beside: columns
      .filter(
        (column) =>
          lastStart !== undefined &&
          column.xPt > lastStart &&
          column.values < column.runs * MIN_COLUMN_NUMERIC_SHARE &&
          lineStarts.some(
            (xPt) =>
              xPt >= column.xPt - COLUMN_TOLERANCE_PT &&
              xPt <= column.lastXPt + COLUMN_TOLERANCE_PT,
          ),
      )
      .map((column) => ({ fromXPt: column.xPt, toXPt: column.lastXPt })),
  };
}

/**
 * `kept` with every voted-out column of `outvoted` restored that at least MIN_TABLE_ROWS of `rows` need to keep two of their own runs apart, ascending.
 *
 * The vote counts how many of the page's rows use a column, which loses a column that only the lower half of a table has: a table with a multi-level header states one figure per heading for its small sizes and splits each heading into sub-columns (`r`, `x`, `z`) for the larger ones (BS 7671's voltage-drop tables, novus-power/hive#4078), and its sub-columns are used by fewer rows than the vote asks. `columnIndexFor` then files each sub-column's figure under the column to its left, so `1.75` and `0.170` arrive as one cell, two figures under one heading and the next heading's figures under the wrong one. A value set apart from the value before it (`setApart`, each a measurement or an explicit not-applicable, `statesValue`) is a cell of its own, so a column a row needs to hold such a value is that row's column whatever the vote said. Only values count: a header's wrapped words are set apart as freely as its headings are, and splitting a cell between two of them divides a heading, not a column. Restoring a column only when MIN_TABLE_ROWS rows need it, the same bar as a table having rows at all, keeps a stray annotation one row carries folded into its neighbour. Restored left to right, so a sub-column whose left neighbour is itself restored is judged against it.
 */
function withSubColumns(
  kept: readonly number[],
  outvoted: readonly number[],
  rows: readonly TextItem[][],
): number[] {
  let columns = [...kept].sort((a, b) => a - b);
  for (const candidate of [...outvoted].sort((a, b) => a - b)) {
    const withCandidate = [...columns, candidate].sort((a, b) => a - b);
    // A row needs the candidate when two runs it sets apart share a cell without it and are parted by it.
    const needing = rows.filter((row) =>
      row.some((item, index) => {
        const left = row[index - 1];
        return (
          left !== undefined &&
          statesValue(left.text.trim()) &&
          statesValue(item.text.trim()) &&
          setApart(left, item) &&
          columnIndexFor(item, columns) === columnIndexFor(left, columns) &&
          columnIndexFor(item, withCandidate) !==
            columnIndexFor(left, withCandidate)
        );
      }),
    );
    if (needing.length >= MIN_TABLE_ROWS) {
      columns = withCandidate;
    }
  }
  return columns;
}

/** The index in `columns` that `item` belongs to -- the nearest column start at or left of it, since a cell's own text begins at its column and runs rightward. Falls back to the first column for an item sitting left of every detected column start (a row-label indented less than the label column itself), rather than dropping its text. */
function columnIndexFor(item: TextItem, columns: readonly number[]): number {
  let index = 0;
  columns.forEach((columnX, candidate) => {
    if (item.xPt >= columnX - COLUMN_TOLERANCE_PT) {
      index = candidate;
    }
  });
  return index;
}

/**
 * Whether `item` lies beside the table rather than in it: it starts in one of `columns.beside`, a run of positions right of the table's last column that is a block of text set beside the table. Such a run holds mostly words, fewer than MIN_COLUMN_NUMERIC_SHARE of its runs stating a value (`statesValue`), and the block runs on in lines of its own: at least one line of the page holding nothing else starts there.
 *
 * A note set in the page's margin beside a table (`NOTE: See Section 2.4 ...`, `(see Regulation 512.1.5).`) shares its baselines with the table's rows, so its lines arrive as the last runs of those rows. Its x is a run of positions of its own, too few rows use it to be a column, and `columnIndexFor` would file it under the column to its left, the table's last, where the note's words, and the clause number a line of it ends on, read as part of a rating (`54 512.1.5).`, BS 7671's Tables 4D1A, 4E2A and 4E4A, novus-power/hive#4222). A run of positions right of the last column shares no end or middle with that column's values, or it would have been joined to that column (`findColumns`), so it is no part of the last column's cells. A note is set in lines at its own leading, so some of them fall between the table's rows, on lines of their own, while a column of the table, words or figures, has text only on the table's rows: a run of words there that the vote passed over (a `Yes` column the header rows outnumber) is still filed under the last column, as is a run of figures (a short table on a page of prose whose own columns the vote passed over), so no cell of a table leaves its row. A note is left to the page's running text, which keeps it whole, every run of it, figures included.
 */
function liesBesideTable(item: TextItem, columns: Columns): boolean {
  return columns.beside.some(
    (span) => item.xPt >= span.fromXPt && item.xPt <= span.toXPt,
  );
}

/** Whether `item` ends where `next` begins, to within COLUMN_TOLERANCE_PT: the two are runs of one line of text that the writer split where its font or style changed, such as a hanging list marker (`3. `) and the words it numbers. An item that reports no width abuts nothing. */
function abuts(item: TextItem, next: TextItem): boolean {
  return (
    item.widthPt !== undefined &&
    next.xPt - (item.xPt + item.widthPt) <= COLUMN_TOLERANCE_PT
  );
}

/**
 * The items of `row`, ordered left to right, that belong to a note set beside the table: every item that lies beside it (`liesBesideTable`), the words that follow the first of them that states anything in the same line of text, and the marker that abuts that first word on its left.
 *
 * A note is a line of text, so its next words follow its first run on the table's own baseline. A writer that sets a note a word at a time puts only the first word of each line at the x the note's lines start at (`For cables having ﬂexible conductors, see` on the first row of BS 7671's Table 4D1A), and the words after it each start at an x of their own, which no run of positions covers; they are still the note's, and `columnIndexFor` would file them under the table's last column. A word belongs to the line when it abuts the run before it (`abuts`): the gap between two words of a line is a word space, where the gap between two cells of a table is a gutter, so a column of the table right of the block is not taken for words of the note.
 *
 * A note numbered with a hanging marker sets the marker (`3. `) and its words as two runs, and the marker states a figure, so it lies in no run of words and was filed under the last column as a rating's tail (`75 3.`, Table 4E2A). A marker is the block's own when it abuts the block's first run and starts right of the last column, which a cell of the last column does not (novus-power/hive#4222).
 */
function itemsBeside(
  row: readonly TextItem[],
  columns: Columns,
): ReadonlySet<TextItem> {
  const beside = new Set(row.filter((item) => liesBesideTable(item, columns)));
  // A run of white space in a block's run of positions is no word of a note: a space set after a cell of the table can lie there, and the note's words start at the first run that states any.
  const first = row.findIndex(
    (item) => beside.has(item) && item.text.trim() !== "",
  );
  if (first < 0) {
    return beside;
  }
  for (let index = first + 1; index < row.length; index += 1) {
    const item = row[index];
    const before = row[index - 1];
    if (item === undefined || before === undefined || !abuts(before, item)) {
      break;
    }
    beside.add(item);
  }
  const lastStart = columns.starts[columns.starts.length - 1];
  for (let index = first - 1; index >= 0; index -= 1) {
    const item = row[index];
    const next = row[index + 1];
    if (
      item === undefined ||
      next === undefined ||
      !beside.has(next) ||
      !abuts(item, next) ||
      lastStart === undefined ||
      item.xPt <= lastStart + COLUMN_TOLERANCE_PT
    ) {
      break;
    }
    beside.add(item);
  }
  return beside;
}

/** One recovered row: every column's own cell text, in column order, with an empty string where that row has no text in that column, so every row in the returned table carries the identical cell count and a consumer can index columns positionally. Text sharing a cell is joined with a space, in left-to-right order; text beside the table (`itemsBeside`) is in no cell. */
function rowCellsFrom(row: readonly TextItem[], columns: Columns): string[] {
  const cells: string[][] = columns.starts.map(() => []);
  const beside = itemsBeside(row, columns);
  for (const item of row) {
    if (!beside.has(item)) {
      cells[columnIndexFor(item, columns.starts)]?.push(item.text.trim());
    }
  }
  return cells.map((parts) => parts.join(" ").trim());
}

/**
 * Whether `row` is a data row however few of its columns it fills: it states a measurement under one of the page's `measurementColumns`, and states something (a measurement or an explicit not-applicable) in at least MIN_TABLE_COLUMNS of the columns after the first.
 *
 * MIN_ROW_COLUMN_SHARE measures how full a row is, which is a proxy for what actually separates a data row from a legend line: a legend line states no figure, and a data row does. The proxy fails for a sparse but genuine table, whose rows report one test's figures and `N/A` for the next and leave the rest blank, so fill five of nine columns (the Sungrow SG350HX certificate's page 44, novus-power/hive#2494). An explicit `N/A` already counts toward the fill bar, since it is text, so counting it as populated alone changes nothing; what it adds here is a second stated value beside the figure, which a folio or an axis label never has.
 */
function statesSparseData(
  row: readonly string[],
  measurementColumns: readonly number[],
): boolean {
  const values = row.filter(
    (content, index) => index > 0 && statesValue(content),
  );
  return (
    // Fewest value columns a sparse row must state something in (a measurement or an explicit not-applicable, `statesValue`) before `statesSparseData` keeps it. One figure pinned to a column by its position is what a folio beside a running footer, or a chart's axis labels, also is; stating across two columns is the least that makes a row across columns at all, the same reason MIN_TABLE_COLUMNS is two. Measured on the reference manuals, the one-figure rows the fill bar drops are exactly those: `Amendment - February 2016 | 16` and a battery guide's discharge-curve axis `0.010.11 10 50`, both of which a one-figure test readmitted into real tables.
    values.length >= MIN_TABLE_COLUMNS &&
    measurementColumns.some((index) => {
      const content = row[index];
      return content !== undefined && isMeasurement(content);
    })
  );
}

/** Whether the cells of `rows` in column `index` repeat an earlier column's cell in the same row for more than MAX_REPEATED_COLUMN_SHARE of the column's populated cells (see MAX_REPEATED_COLUMN_SHARE). */
function repeatsEarlierColumn(
  rows: readonly string[][],
  index: number,
): boolean {
  const populated = rows.filter((row) => (row[index] ?? "") !== "");
  return (
    populated.filter((row) => row.slice(0, index).includes(row[index] ?? ""))
      .length >
    populated.length * MAX_REPEATED_COLUMN_SHARE
  );
}

/** The indices of the measurement columns among `columnCount` columns of `rows`: every column after the first (the row label, see MIN_NUMERIC_COLUMNS) whose populated cells are at least MIN_COLUMN_NUMERIC_SHARE measurements and which does not merely repeat an earlier column (see MAX_REPEATED_COLUMN_SHARE). */
function measurementColumnsOf(
  rows: readonly string[][],
  columnCount: number,
): number[] {
  return Array.from({ length: columnCount }, (_, index) => index).filter(
    (index) => {
      if (index === 0) return false;
      const populated = rows.flatMap((row) => {
        const content = row[index];
        return content === undefined || content === "" ? [] : [content];
      });
      return (
        populated.length > 0 &&
        populated.filter(isMeasurement).length >=
          populated.length * MIN_COLUMN_NUMERIC_SHARE &&
        !repeatsEarlierColumn(rows, index)
      );
    },
  );
}

/** One recovered row and where it sits on its page. */
interface PlacedRow {
  readonly cells: readonly string[];
  /** The baseline of the row's topmost run, in the page's own coordinates (increasing upwards). */
  readonly yPt: number;
}

/** One table recovered from a page's text positions: its `ContentTable`, and the caption the page prints directly above it (`TABLE 4H2A Current-carrying capacity`), absent when it prints none. */
export interface ColumnAlignedTable {
  readonly table: ContentTable;
  readonly caption?: string;
}

/** `rows`, one page's table rows top to bottom, as the `ContentTable` they form: a dense grid (`ContentTable`'s grid rule) of text cells, one column per detected column start. The last column's width is not stated by the positions this reads, so it is 0, the width a producer gives a column it cannot resolve. */
function tableFrom(
  rows: readonly PlacedRow[],
  starts: readonly number[],
): ContentTable {
  return {
    kind: "table",
    columns: starts.map((start, index) => ({
      widthPt: Math.max(0, (starts[index + 1] ?? start) - start),
    })),
    rows: rows.map((row) => ({
      cells: row.cells.map((content) => ({
        blocks: [{ kind: "paragraph", runs: [{ text: content }] }],
      })),
    })),
  };
}

/**
 * Where each of `rows`' lines that holds a single run of text starts: the lines of a block set beside a table, which `findColumns` tells from a column by.
 *
 * A line is one run, or one run with white space set before it: a note set with a hanging indent starts its first line with a space run, a typesetter's indent, and the line holds nothing else (the notes under BS 7671's Table 4E4A, novus-power/hive#4222). White space set after a run is not counted as nothing, since a writer that closes every run with a space (a Word export) would then make every line of a page one run and every column of it a block beside a table.
 */
function lineStartsOf(rows: readonly TextItem[][]): number[] {
  return rows.flatMap((row) => {
    if (row.length < MIN_TABLE_COLUMNS) {
      return row.map((item) => item.xPt);
    }
    const runs = row.filter((item) => item.text.trim() !== "");
    const [run] = runs;
    return runs.length === 1 &&
      run !== undefined &&
      row.every((item) => item === run || item.xPt < run.xPt)
      ? [run.xPt]
      : [];
  });
}

/** Every page whose text positions form a whitespace-aligned table, keyed by the page's 0-based index in the source document (`sourcePageIndex`, which is its position for a whole-document read), each carrying the recovered tables (`ColumnAlignedTable`; never the page's prose, unlike the full-page reconstruction of `reconstructWordprocessing`, since this detector infers a table from positions and has no business also deciding which of the page's remaining text is a paragraph). One table per page, and a page with none is absent. `skipPages` names the pages the lattice path already claimed, which are left entirely alone. Never throws: a page whose items this cannot make sense of is simply absent from the result. */
export function detectColumnAlignedTables(
  layoutDoc: LayoutDocument,
  skipPages: ReadonlySet<number>,
): Map<number, ColumnAlignedTable[]> {
  const result = new Map<number, ColumnAlignedTable[]>();
  layoutDoc.pages.forEach((page, position) => {
    const pageIndex = sourcePageIndex(page, position);
    if (skipPages.has(pageIndex)) {
      return;
    }
    const rows = groupIntoRows(
      page.items.filter((item): item is TextItem => item.kind === "text"),
    );
    // Only rows that could be a table row at all are evidence of a column structure: a run of prose lines carrying one item each would otherwise dominate the x-frequency count and drown out the real table's own columns.
    const candidateRows = rows.filter((row) => row.length >= MIN_TABLE_COLUMNS);
    if (candidateRows.length < MIN_TABLE_ROWS) {
      return;
    }
    const columns = findColumns(candidateRows, lineStartsOf(rows));
    if (columns.starts.length < MIN_TABLE_COLUMNS) {
      return;
    }
    // Voting on the columns and being a row are two different bars (see MIN_ROW_COLUMN_SHARE). Applied after findColumns deliberately: a sparse row still legitimately evidences where a column sits, it just isn't itself tabular unless it states sparse data (see `statesSparseData`). The measurement columns that test uses are read over every candidate row, not only the full ones, because a sparse table can have too few full rows to establish them at all. That lets a stray figure on a dropped row (a folio, an axis label) count toward a column's measurement share here, which is why the final measurement check below reads the kept rows instead, and why a readmitted row must also state MIN_TABLE_COLUMNS values: a noise row with one figure never qualifies whatever the column shares say.
    const placedRows: PlacedRow[] = candidateRows.map((row) => ({
      cells: rowCellsFrom(row, columns),
      yPt: Math.max(...row.map((item) => item.yPt)),
    }));
    const cellRows = placedRows.map((row) => [...row.cells]);
    const measurementColumns = measurementColumnsOf(
      cellRows,
      columns.starts.length,
    );
    const keptRows = placedRows.filter(
      (row) =>
        row.cells.filter((cell) => cell.length > 0).length >=
          columns.starts.length * MIN_ROW_COLUMN_SHARE ||
        statesSparseData(row.cells, measurementColumns),
    );
    const tableRows = keptRows.map((row) => [...row.cells]);
    // Re-checked against the row count, not the candidate count: whatever survives that bar is the real table, and if only a line or two does then this page never had one.
    if (tableRows.length < MIN_TABLE_ROWS) {
      return;
    }
    const cells = tableRows.flatMap((row) =>
      row.filter((content) => content !== ""),
    );
    // Per-glyph text, not a table -- see MAX_GLYPH_CELL_SHARE.
    if (
      cells.filter(
        (cell) => cell.length <= GLYPH_CELL_LENGTH && !statesValue(cell),
      ).length >
      cells.length * MAX_GLYPH_CELL_SHARE
    ) {
      return;
    }
    // A contents page, whose folio column would otherwise pass as measurements (see MAX_LEADER_ROW_SHARE).
    if (
      tableRows.filter((row) => row.some((cell) => LEADER_DOTS.test(cell)))
        .length >=
      tableRows.length * MAX_LEADER_ROW_SHARE
    ) {
      return;
    }
    // And it must actually state measurements somewhere (see MIN_NUMERIC_COLUMNS). Re-read over the kept rows alone, not the candidates the fill bar was deciding between.
    if (
      measurementColumnsOf(tableRows, columns.starts.length).length <
      MIN_NUMERIC_COLUMNS
    ) {
      return;
    }
    result.set(pageIndex, [{ table: tableFrom(keptRows, columns.starts) }]);
  });
  return result;
}
