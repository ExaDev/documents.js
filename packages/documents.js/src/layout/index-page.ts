/**
 * Whether the rows a column-aligned page recovers are an index and not a table: a list of entries, each a term and the places it is found (novus-power/hive#4149).
 *
 * An index set in columns clears every bar `column-aligned-tables.ts` sets for a table. Its reference column is mostly figures (`41`, `17-19`, `9, 44`, `4.2.1`), so it reads as a measurement column, and two or three index columns set side by side recur at the same x on every line. Rendered as a table, each page is a block of entries under a false header row that a reader takes for a table of data, and an index runs to many pages. So the rows are read as an index when their structure says so, from the rows alone and never from what the entries say:
 *
 * - most of the rows are entries: a reference (a page or clause number, a range or list of them, a labelled reference such as `Fig 7`, or a `see` cross-reference) in a reference column with a term in the column before it, or a term carrying its own `see` cross-reference;
 * - the first row does not head the columns, since a table names its columns and an index's first row is an entry like the rest;
 * - and the references of every reference column are shown to run in no order, since an index is in the order of its terms. A contents list and a list of figures or tables are in the order of their pages, so their references ascend down the page, and they are left as the tables they were. A run too short for its order to be told either way is left as a table too.
 *
 * The caller asks only of rows with no caption: a caption names a table, so a captioned table whose last column holds page numbers, or references like an index's, stays one.
 *
 * A contents list or a list of tables is the same layout in page order, and `readsAsContentsList` names it, for one purpose only: the captions a page carries are not read as captions in it. A list of tables wraps its long entries over two lines, so the first line of an entry (`TABLE 4E4A - Multicore armoured 90 C thermosetting insulated cables`) stands alone, as a caption does, and the rows after it were cut into a table under that title and indexed as the table itself, where a search for the table found its entry in the list before the table (BS 7671's list of tables, novus-power/hive#4059). The list's rows stay a table, as they were.
 *
 * Misreading a table as an index costs that table: its rows stay in the page's running text and are not appended as a table. That happens only to a table with no caption and no row of column headings, most of whose rows are a term beside a single figure, with the figures in no order, so that nothing on the page says it is a table. The opposite mistake, an index read as a table, puts a false table on every page the index runs to, and a false table is the mistake this package refuses first (`column-aligned-tables.ts`).
 */
import { statesValue } from "./table-cell-values";

/** A parenthesised part of a reference (`(a)`, `(No 35)`), which qualifies the reference before it and is read as part of it. */
const PARENTHESISED = /\([^()]*\)/g;

/** One locator: a number that may carry a capital letter before it and letters, digits and dotted parts after it (`41`, `4.2.1`, `12n`, `A7`, `3B`), or a range of two written with no space around its hyphen, en dash or em dash (`17-19`, `A7-A9`), with the separator that follows it in a list. Each end opens with a digit, after at most one capital, so a hyphenated word is never a locator. */
const LOCATOR =
  /^\p{Lu}?\d[\p{L}\p{N}.]*(?:[-\u2013\u2014]\p{Lu}?\d[\p{L}\p{N}.]*)?[,;]?$/u;

/** The rest of a range or list a locator opened, written from a later part of the number (`.4` in `5.3.2 to .4`, `&.6`). */
const LOCATOR_CONTINUATION = /^[&.]+\d[\p{N}.]*[,;]?$/u;

/** What joins two locators of a range or a list. */
const LOCATOR_JOIN = /^(?:to|and|&|[-\u2013,;])$/i;

/** A word naming what kind of place a locator is (`Fig 7`, `Table 3`, `Sec 2`, `p. 12`), read as a label only where a locator follows it. */
const LOCATOR_LABEL = /^\p{L}[\p{L}.]*$/u;

/** A cross-reference to another entry, as an index writes one: `see` or `see also`, then the entry it points at. */
const CROSS_REFERENCE = /^\(?see(?:\s+also)?\s+\p{L}/iu;

/** A term followed by its own cross-reference (`Aphids see Pests`), in place of a reference in the column after it. */
const TRAILING_CROSS_REFERENCE = /\s\(?see(?:\s+also)?\s+\p{L}/iu;

/** Share of a column's populated cells that must be references before it is read as a reference column. More than half, the bar `column-aligned-tables.ts` reads a measurement column by and for the same reason: an index's reference column also holds the wrapped line of a long term, the head term of a run of sub-entries and the odd reference set off its own line. */
const MIN_REFERENCE_COLUMN_SHARE = 0.5;

/** Share of the rows that must be entries before the rows are read as an index. More than half: the rows of an index that are not entries are the wrapped lines of long terms and the head terms whose sub-entries carry the references, which on a page set in three columns can share a row with no entry beside them. A table has to pass the other two tests as well, so the bar is set to keep every run that is mostly entries, and no higher. */
const MIN_ENTRY_ROW_SHARE = 0.5;

/**
 * How many standard deviations above chance the references of a column must ascend before the column is read as running in order, as a contents list's do.
 *
 * In no order, each pair of neighbouring references ascends or descends with even odds, so the ascents among `n` pairs have mean `n / 2` and standard deviation `sqrt(n) / 2`. Three standard deviations is the conventional bar for a result that is not chance (a column in no order clears it about once in several hundred columns), so an index's reference column is almost never read as a contents list's, while a contents list, which ascends in nearly every pair, clears it once it has enough rows. It also sets the shortest run that can be told either way: three standard deviations above `n / 2` is reachable only when `n` is more than nine pairs, so a shorter run is never read as an index.
 */
const ORDERED_REFERENCES_SD = 3;

/** Whether `cell` is a reference an index entry points at: a cross-reference, or one or more locators, each possibly labelled, joined into ranges and lists. */
function isReference(cell: string): boolean {
  const trimmed = cell.trim();
  if (CROSS_REFERENCE.test(trimmed)) {
    return true;
  }
  const tokens = trimmed
    .replace(PARENTHESISED, " ")
    .split(/\s+/)
    .filter((token) => token !== "");
  let locators = 0;
  for (const [index, token] of tokens.entries()) {
    const next = tokens[index + 1];
    if (LOCATOR.test(token) || LOCATOR_CONTINUATION.test(token)) {
      locators += 1;
    } else if (
      !LOCATOR_JOIN.test(token) &&
      !(LOCATOR_LABEL.test(token) && next !== undefined && LOCATOR.test(next))
    ) {
      return false;
    }
  }
  return locators > 0;
}

/** Whether `cell` is an entry's term: text that is neither a reference nor a value a table states (`statesValue`). A run the PDF gives no readable characters for is a term too, since it is not a reference. */
function isTerm(cell: string): boolean {
  const trimmed = cell.trim();
  return trimmed !== "" && !isReference(trimmed) && !statesValue(trimmed);
}

/** The indices of the reference columns of `rows`: every column after the first whose populated cells are more than MIN_REFERENCE_COLUMN_SHARE references and whose column before it is not one too, since an entry's reference follows its term. */
function referenceColumnsOf(rows: readonly (readonly string[])[]): number[] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const holdsReferences = (column: number): boolean => {
    const populated = rows.flatMap((row) => {
      const cell = row[column];
      return cell === undefined || cell.trim() === "" ? [] : [cell];
    });
    return (
      populated.length > 0 &&
      populated.filter(isReference).length >
        populated.length * MIN_REFERENCE_COLUMN_SHARE
    );
  };
  const columns = Array.from({ length: width }, (_, column) => column).filter(
    (column) => column > 0 && holdsReferences(column),
  );
  return columns.filter((column) => !columns.includes(column - 1));
}

/** Whether `row` is an index entry: a reference in one of `referenceColumns` with a term in the column before it, or a term followed by its own cross-reference. */
function isEntry(
  row: readonly string[],
  referenceColumns: readonly number[],
): boolean {
  return (
    referenceColumns.some((column) => {
      const reference = row[column];
      const term = row[column - 1];
      return (
        reference !== undefined &&
        term !== undefined &&
        isReference(reference) &&
        isTerm(term)
      );
    }) ||
    row.some((cell) => isTerm(cell) && TRAILING_CROSS_REFERENCE.test(cell))
  );
}

/** The first number `reference` states, as its dotted parts (`4.2.1` is `[4, 2, 1]`), or undefined for a cross-reference, which states none. */
function firstNumberOf(reference: string): number[] | undefined {
  return /\d+(?:\.\d+)*/.exec(reference)?.[0].split(".").map(Number);
}

/** Negative, zero or positive as `a` comes before, level with or after `b`, part by part, a number that runs out of parts first coming first (`4.2` before `4.2.1`). */
function compareNumbers(a: readonly number[], b: readonly number[]): number {
  for (const [part, value] of a.entries()) {
    const other = b[part];
    if (other === undefined) {
      return 1;
    }
    if (value !== other) {
      return value - other;
    }
  }
  return a.length - b.length;
}

/** How many pairs of neighbouring references down `column` of `rows` differ, and how many of those ascend: the counts a column's order is judged by. A cross-reference states no number and is no part of a pair. */
function orderedPairsOf(
  rows: readonly (readonly string[])[],
  column: number,
): { pairs: number; ascents: number } {
  const numbers = rows.flatMap((row) => {
    const cell = row[column];
    const number =
      cell !== undefined && isReference(cell) ? firstNumberOf(cell) : undefined;
    return number === undefined ? [] : [number];
  });
  const orders = numbers
    .flatMap((number, index) => {
      const before = numbers[index - 1];
      return before === undefined ? [] : [compareNumbers(before, number)];
    })
    .filter((order) => order !== 0);
  return {
    pairs: orders.length,
    ascents: orders.filter((order) => order < 0).length,
  };
}

/** The ascents `pairs` neighbouring pairs must exceed to clear chance by ORDERED_REFERENCES_SD standard deviations: the half that ascend by chance, plus the deviations. */
function ascentsAboveChance(pairs: number): number {
  return pairs / 2 + (ORDERED_REFERENCES_SD * Math.sqrt(pairs)) / 2;
}

/** Whether the references of `column` down `rows` are shown to run in no order: the pairs of neighbouring numbers that differ are enough for a column in order to clear ORDERED_REFERENCES_SD above chance, and this one's ascents do not. */
function runsInNoOrder(
  rows: readonly (readonly string[])[],
  column: number,
): boolean {
  const { pairs, ascents } = orderedPairsOf(rows, column);
  const bar = ascentsAboveChance(pairs);
  return bar < pairs && ascents <= bar;
}

/** Whether the references of `column` down `rows` are shown to run in order: the ascents among the pairs of neighbouring numbers that differ clear ORDERED_REFERENCES_SD above chance, as a contents list's do, which an index's, in no order, never do. */
function runsInOrder(
  rows: readonly (readonly string[])[],
  column: number,
): boolean {
  const { pairs, ascents } = orderedPairsOf(rows, column);
  return ascents > ascentsAboveChance(pairs);
}

/**
 * Whether `rows`, the cells of one column-aligned table top to bottom, are a contents list or a list of tables: most of the rows are entries (a term in one column and its page in the next, `isEntry`) and the pages of every reference column ascend down the page (`runsInOrder`). A run too short for its order to be told is not one. The caller asks it of a page's rows whether or not a caption stands on the page, since a list of tables has captions of its own among its wrapped entries.
 */
export function readsAsContentsList(
  rows: readonly (readonly string[])[],
): boolean {
  const referenceColumns = referenceColumnsOf(rows);
  return (
    referenceColumns.length > 0 &&
    rows.filter((row) => isEntry(row, referenceColumns)).length >
      rows.length * MIN_ENTRY_ROW_SHARE &&
    referenceColumns.every((column) => runsInOrder(rows, column))
  );
}

/** Whether `rows`, the cells of one uncaptioned column-aligned table top to bottom, are an index and not a table (see the module comment). */
export function readsAsIndex(rows: readonly (readonly string[])[]): boolean {
  const [first] = rows;
  const referenceColumns = referenceColumnsOf(rows);
  if (
    first === undefined ||
    referenceColumns.length === 0 ||
    // A row of column headings: labels in every cell it fills.
    first.every((cell) => cell.trim() === "" || isTerm(cell))
  ) {
    return false;
  }
  return (
    rows.filter((row) => isEntry(row, referenceColumns)).length >
      rows.length * MIN_ENTRY_ROW_SHARE &&
    referenceColumns.every((column) => runsInNoOrder(rows, column))
  );
}
