/**
 * What a table cell states: a measurement, or an explicit not-applicable. Shared by `column-aligned-tables.ts`, which reads a table's value columns by them, and the contents-list reader, which reads an index's terms as the cells that are neither. The functions and constants the comments below name (`findColumns`, MIN_NUMERIC_COLUMNS, MIN_COLUMN_NUMERIC_SHARE) are `column-detection.ts`'s.
 */

/**
 * A cell stating a figure the table actually measures -- what a specification table's value columns are made of.
 *
 * Wider than a bare number on purpose, because a real manufacturer datasheet's value column is not made of bare numbers. Alongside `2150` and `10` it states ranges (`220~240-1-50`), pairs and ratios (`2035/3255`, `2.40/5.65`, `1150/850/700`), and dimensions (`21x13.37`); a column of those is unmistakably a column of measurements, and a test that accepts only a bare number (`-?\d+(?:[.,]\d+)?`) scores it at a third numeric and throws the whole table away.
 *
 * That this needed widening at all was hidden until column drift was fixed (see `findColumns`). While a value column was being split, the wider strings -- which, being wider, start further left -- fell outside the surviving bucket and into the row-label column, which MIN_NUMERIC_COLUMNS skips; what was left behind was a truncated column of bare numbers that cleared MIN_COLUMN_NUMERIC_SHARE by accident. Reading the column correctly puts its own compound values back in it, and the strict test then rejects tables it had only ever been passing on a partial view of (novus-power/hive#918).
 *
 * Still never a word: no letter is admitted beyond a dimension's own `x`, which is what keeps a contents page's `Product Overview` and a marketing block's prose out, exactly as the bare-number test did. And it must BEGIN with the figure -- a digit, or a sign and a digit -- not merely contain one somewhere. Accepting any cell that held a digit was measured against the corpus and let a contents page back in by its leaders: `. . . . . . . 667` is dots, spaces and a page number, so it satisfies "has a digit, has no letters" perfectly, and a whole column of them reads as a column of measurements. A figure a table states starts with the figure.
 */
const MEASUREMENT_CELL = /^[-+]?\d[\d\s.,;:/~x×*+\-()%°]*$/i;

/** Whether `content` states a measurement (see MEASUREMENT_CELL). */
export const isMeasurement = (content: string): boolean =>
  MEASUREMENT_CELL.test(content);

/** A cell stating outright that a value does not apply: `N/A`, or a lone hyphen, en dash or em dash. A stated value like any other, rather than an absence: the author wrote it to say this row was measured against this column and the measurement does not apply. */
const NOT_APPLICABLE_CELL = /^(?:n\/?a|[-\u2013\u2014])$/i;

/** Whether `content` states a value a table cell holds: a measurement, or an explicit not-applicable. */
export const statesValue = (content: string): boolean =>
  isMeasurement(content) || NOT_APPLICABLE_CELL.test(content);
