/**
 * The captions a PDF page prints above its tables, each saying which table it is: `TABLE 4H2A Current-carrying capacity (amperes)` (novus-power/hive#4091).
 *
 * A page's heading (`page-caption.ts`) is what the page is OF, found by font size, and a standard whose tables are numbered does not set the number larger than its body text: a table's own caption sits in the page's body size, so the heading is a nearby sub-heading or nothing, and a reader of the appendix alone cannot tell one numbered table from another, nor search it by number. The number is read from the text instead: a line that opens with the word `Table` and a number is the caption of the table beneath it.
 *
 * A caption is a standalone line, which a mention of a table is not, and the rule is structural. An index entry, a contents line or a sentence cites a table the same way a caption names one (`Table 4A2`, `Table 41.1 Barriers -`, `Table 4H2A gives the ratings`), so a line opening with `Table` and a number is a caption only when all of these hold:
 *
 * - what follows the number is nothing or something that does not open with a lower-case letter, since a lower-case word makes the line a sentence citing the table;
 * - nothing set in the caption's own style sits to the left of it on its line, since then it is one cell of a row and not a line of its own;
 * - it names no page: a contents line ends in a page number set apart from its title, which no caption does;
 * - it is set apart from the text above it: no text of body size sits within a line's leading above it and overlapping it horizontally, since a caption starts a block, and an entry of an index (or a line of any list) is one of many set at the same pitch in a column, each with another line directly above.
 *
 * A caption that does not fit its first line carries on in the lines below it: each next line within a line's leading, in the same style (weight, slant and no larger size, which leaves out the running tab or page number a table page sets large on the same baseline) and lying under the caption so far (a bold figure elsewhere on the page is not part of it), up to the first line that opens another caption. So `TABLE 4C2 - Rating factors for more than one circuit,` over `Reference Method D2 in Tables 4D4A to 4J4A` is one caption, whole.
 *
 * A caption states where it sits (`yPt`, the baseline of its first line), so a table can be matched to the caption above it where the table's own rows carry a position (`column-aligned-tables.ts`). A recovered table with no position can only be paired by counting: `withTableContext` pairs the page's captions with the page's tables in reading order, and only when there are as many of one as of the other; a page where they disagree names nothing here and keeps its heading.
 */
import type { LayoutItem } from "pdf-codec";
import {
  CAPTION_SIZE_RATIO,
  readingOrderLines,
  setApart,
  type TextItem,
} from "./page-caption";

/** What opens a table caption: the word `Table` in any case, then a number that may carry a letter prefix, letter suffixes and dotted or hyphenated parts (`4`, `4H2A`, `41.1`, `A.1`, `B-3`). */
const TABLE_NUMBER = /^table\s+\p{L}{0,2}[.-]?\d[\p{L}\p{N}.-]*/iu;

/** Whether `text` opens by naming a table (`TABLE 4E4A - Multicore ...`, `Table 41.1`): the opening of a caption, and of an entry in a list of tables, which cites a table the way a caption names one. The rest of a caption's rules (a standalone line, set apart, naming no page) tell a caption from such an entry and are not asked here. */
export function namesATable(text: string): boolean {
  return TABLE_NUMBER.test(text.trim());
}

/** What may follow a caption's number: nothing, or text that does not open with a lower-case letter. A lower-case word means the line is a sentence that cites the table. */
const TABLE_TITLE_START = /^\s*(?:$|[^\p{Ll}\s])/u;

/** A caption that says its table runs on from the page before names no table anew: its table is the one before it, which `carryTablesAcrossPageBreaks` already labels. */
const CONTINUATION_MARK = /\bcontinued\b|\bcont\.?\)/i;

/** How a line names the page its entry is on: a gap of two or more spaces or a run of leader dots, then the page number and nothing after it. A caption states what a table is and never what page it is on. */
const PAGE_REFERENCE_TAIL = /(?:\s{2,}|\.{3,})\s*\d+\s*$/;

/** A run that is only a page number. */
const PAGE_NUMBER = /^\d+$/;

/** Longest a caption may be: past this the line is a paragraph that happens to open with `Table`, and what identifies the table is its opening. Truncated, not dropped. */
const TABLE_CAPTION_MAX_CHARS = 200;

/** The line leading, as a share of the type size, within which a next line is read as the line before's neighbour: wrapped text sits at its face's leading, which is at most half again the size (the 1.5 of WCAG's text-spacing minimum and the top of what running text is set at), while a block set apart from another (a caption from the text above it, a table's header row from its caption) sits further away than that. */
const LINE_LEADING_EM = 1.5;

/** Vertical tolerance, in points, for two runs sitting on one baseline: the bar `readingOrderLines` reads a line by, so a subscript is part of its line. */
const SAME_LINE_TOLERANCE_PT = 3;

/** A table caption and where it sits on its page. */
export interface TableCaption {
  /** The caption's text: the number and the title, the title's wrapped lines included, runs joined by single spaces. */
  readonly text: string;
  /** The baseline of the caption's first line, in the page's own coordinates (increasing upwards). */
  readonly yPt: number;
}

function isBlank(item: TextItem): boolean {
  return item.text.trim() === "";
}

function textOf(items: readonly TextItem[]): string {
  return items
    .map((item) => item.text.trim())
    .filter((text) => text !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `a` and `b` are set the same way: weight and slant. */
function sameStyle(a: TextItem, b: TextItem): boolean {
  return a.font.weight === b.font.weight && a.font.style === b.font.style;
}

/** The horizontal span of `items`: the leftmost start to the furthest end, an item with no reported width ending where it starts. */
function spanOf(items: readonly TextItem[]): { from: number; to: number } {
  return {
    from: Math.min(...items.map((item) => item.xPt)),
    to: Math.max(...items.map((item) => item.xPt + (item.widthPt ?? 0))),
  };
}

function overlaps(
  a: { from: number; to: number },
  b: { from: number; to: number },
): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** Whether `items`, the runs of one line of a caption, end in a page number: the text says so (`PAGE_REFERENCE_TAIL`), or the last run is a bare number set apart from the run before it (`setApart`). */
function namesAPage(items: readonly TextItem[]): boolean {
  if (PAGE_REFERENCE_TAIL.test(items.map((item) => item.text).join(""))) {
    return true;
  }
  const last = items[items.length - 1];
  const before = items[items.length - 2];
  return (
    last !== undefined &&
    before !== undefined &&
    PAGE_NUMBER.test(last.text.trim()) &&
    setApart(before, last)
  );
}

/** Whether `text` opens like a caption that names its table: the number, then a title start, and no mark saying it is a continuation. */
function opensCaption(text: string): boolean {
  const number = TABLE_NUMBER.exec(text);
  return (
    number !== null &&
    TABLE_TITLE_START.test(text.slice(number[0].length)) &&
    !CONTINUATION_MARK.test(text)
  );
}

/** Whether no run of `visible` sits above `lead` within a line's leading, over the same span as `span` and set in a size short of heading size (`CAPTION_SIZE_RATIO` times the caption's): the line `lead` sits on starts a block. A run on the same baseline (`SAME_LINE_TOLERANCE_PT`) is on the line, not above it. Only a run of body size counts, because the lines of an index or a list are set in one size, and a run set as large as a heading above (a heading, or a running tab a page sets large) is not a line the caption is one of. */
function setApartFromAbove(
  visible: readonly TextItem[],
  lead: TextItem,
  span: { from: number; to: number },
): boolean {
  return !visible.some((item) => {
    const above = item.yPt - lead.yPt;
    return (
      above > SAME_LINE_TOLERANCE_PT &&
      above <= lead.sizePt * LINE_LEADING_EM &&
      item.sizePt < lead.sizePt * CAPTION_SIZE_RATIO &&
      overlaps(spanOf([item]), span)
    );
  });
}

/**
 * The lines a caption whose first line is `first` carries on in, in order, each within a line's leading of the one before it, set in `lead`'s style at no larger size, lying under the caption so far, and not opening another caption. Ends at the first line that is none of those, so a table's header row, set further down or in another style, is never taken for the rest of a title.
 */
function wrappedLines(
  visible: readonly TextItem[],
  lead: TextItem,
  first: readonly TextItem[],
): TextItem[][] {
  const styled = visible.filter(
    (item) => sameStyle(item, lead) && item.sizePt <= lead.sizePt,
  );
  const firstAnchor = Math.max(...first.map((item) => item.yPt));
  const below = readingOrderLines(styled).filter(
    (line) =>
      Math.max(...line.map((item) => item.yPt)) <
      firstAnchor - SAME_LINE_TOLERANCE_PT,
  );
  const wrapped: TextItem[][] = [];
  let anchor = firstAnchor;
  let span = spanOf(first);
  for (const line of below) {
    const lineAnchor = Math.max(...line.map((item) => item.yPt));
    if (
      anchor - lineAnchor > lead.sizePt * LINE_LEADING_EM ||
      !overlaps(spanOf(line), span) ||
      TABLE_NUMBER.test(textOf(line))
    ) {
      break;
    }
    wrapped.push(line);
    anchor = lineAnchor;
    span = spanOf(line);
  }
  return wrapped;
}

/**
 * The table captions `page` prints, in reading order, each the line it opens on with the lines it carries on in.
 *
 * Each line is the text items sharing a baseline (`readingOrderLines`) in the style of the run that opens the caption, joined left to right, so a caption the typesetter split into a bold number and a bold title reads as one; see the module comment for what makes a line a caption and what it carries on in.
 */
export function readTableCaptions(page: {
  items: readonly LayoutItem[];
}): TableCaption[] {
  const visible = page.items.filter(
    (item): item is TextItem => item.kind === "text" && !isBlank(item),
  );
  const captions: TableCaption[] = [];
  for (const line of readingOrderLines(visible)) {
    const lead = line.find((item) => TABLE_NUMBER.test(item.text.trim()));
    if (lead === undefined) {
      continue;
    }
    const own = line.filter(
      (item) => sameStyle(item, lead) && item.sizePt <= lead.sizePt,
    );
    const wrapped = wrappedLines(visible, lead, own);
    const lines = [own, ...wrapped];
    const text = textOf(lines.flat());
    if (
      // The caption's own text opens with its number, so a run of its style to the left of it, which makes the number one cell of a row, ends it here.
      !opensCaption(textOf(own)) ||
      CONTINUATION_MARK.test(text) ||
      lines.some(namesAPage) ||
      !setApartFromAbove(visible, lead, spanOf(own))
    ) {
      continue;
    }
    captions.push({
      text:
        text.length > TABLE_CAPTION_MAX_CHARS
          ? `${text.slice(0, TABLE_CAPTION_MAX_CHARS).trimEnd()}...`
          : text,
      yPt: lead.yPt,
    });
  }
  return captions;
}
