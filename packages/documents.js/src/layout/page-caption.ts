/**
 * The heading a PDF page carries above its own table -- what that table is OF.
 *
 * A recovered table reaches a reader as a section of the extracted text's own appendix
 * (`withPdfTableAugmentation`'s `## Extracted Tables`), which until now labelled every one of them `### Table` and
 * nothing more. That is enough while a reader can see the whole document at once and correlate a
 * table with the prose that introduced it, and not enough as soon as it cannot: a reader that splits an over-long document into pieces can be handed a piece holding only appendix tables, with no prose at all. Measured on the SPEL Puraceptor brochure, the rows up to `P280 1C/SC` were named
 * `SPEL Puraceptor Class 1 Single Chamber...` and every row from `P300 1C/SC` on came back with no
 * name and four candidates, because the heading naming that family sits ~2,000 characters earlier in
 * the prose and landed in a different piece (novus-power/hive#918).
 *
 * Read from FONT SIZE rather than position, because position cannot tell a heading from the running
 * header that sits above it. On that brochure's page 13 the body and the table are 7pt (631 of 700
 * items), the running header is 7pt too, and the three lines that actually name the table are 24pt,
 * 18pt and 12pt -- so "larger than what this page is mostly set in" isolates them exactly, while
 * "topmost on the page" returns `SPEL Products Data Manual`. The same rule reads
 * `Constant Current Discharge Performance Data` off an EnerSys datasheet and `General Specifications`
 * off a Clivet manual, and correctly returns `Contents` for a contents page, which is worth knowing
 * about a table too.
 */
import type { LayoutItem } from "pdf-codec";

export type TextItem = Extract<LayoutItem, { kind: "text" }>;

/** How much larger than the page's own body text a run must be set to count as a heading rather than as content. Half again, not merely larger: a table's own header row is routinely a half-point above its figures, and a caption made of the table's own column names says nothing the table does not already say. */
export const CAPTION_SIZE_RATIO = 1.5;

/** Vertical tolerance, in points, for treating two runs as sitting on the same line -- the same bar `column-detection.ts` uses for a row, and for the same reason. */
const CAPTION_ROW_TOLERANCE_PT = 3;

/** Longest a caption may be. Past this it has stopped identifying the table and started reproducing the page: a note, a disclaimer or a paragraph set large enough to qualify. Truncated rather than dropped, since its opening words are the identifying part. */
const CAPTION_MAX_CHARS = 200;

/** A run carrying no letter at all -- a rule, a bullet, a lone `®`, a page number -- names nothing, whatever size it is set in. */
const CAPTION_WORDLIKE = /\p{L}/u;

/** Font sizes bucketed to the nearest half point, so two runs the writer set identically are not split apart by floating-point noise. */
function sizeBucket(item: TextItem): number {
  return Math.round(item.sizePt * 2) / 2;
}

/**
 * The size most of this page's TEXT is set in -- its body text, and on a table page its table too. The modal size by characters, not by runs, and not the mean either, which a handful of very large runs would drag upwards.
 *
 * Counting runs makes the answer depend on how the writer split the text, not on how much of it there is. A slide's chart labels every tick separately, so a handful of short runs outnumber the few long lines of the slide's own body text, and the modal size becomes the tick labels' 5pt: the 12pt body then clears the half-again bar and the slide's first paragraph is read as its heading (novus-power/hive#2566). Characters weigh a paragraph as the paragraph it is; on a table page the table's cells are still most of the characters, so the datasheets this rule was built on read as before.
 */
function bodySizePt(items: readonly TextItem[]): number {
  const tally = new Map<number, number>();
  for (const item of items) {
    const size = sizeBucket(item);
    tally.set(size, (tally.get(size) ?? 0) + item.text.trim().length);
  }
  let body = 0;
  let seen = 0;
  for (const [size, characters] of tally) {
    // Ties broken towards the SMALLER size: body text is the smaller of any two equally common runs.
    if (characters > seen || (characters === seen && size < body)) {
      body = size;
      seen = characters;
    }
  }
  return body;
}

/** A word space, as a share of the type size: the advance a Latin text face gives the space glyph is about a quarter of an em. */
const WORD_SPACE_EM = 0.25;

/** Whether `right` is set apart from `left`, the run before it on the same row, by more than a word space: two runs a writer positioned apart, rather than one phrase it set as two runs (a figure and its degree sign, a word and its bold continuation). Unknown, and so `false`, when `left` reports no width, since then where it ends cannot be read. */
export function setApart(left: TextItem, right: TextItem): boolean {
  if (left.widthPt === undefined) {
    return false;
  }
  return right.xPt - (left.xPt + left.widthPt) > left.sizePt * WORD_SPACE_EM;
}

/**
 * `items` grouped into the lines a reader sees, in reading order: down the page, then left to right across each line (the same ordering `groupIntoRows` produces), so text reads the way the page does rather than the way the PDF writer happened to emit its runs. Grouped into lines FIRST rather than sorted by a single comparator that falls back to x within a y tolerance: such a comparator is intransitive (a and b on one line, b and c on one line, a and c not), which leaves the result dependent on the engine's own sort and therefore not reproducible.
 */
export function readingOrderLines(items: readonly TextItem[]): TextItem[][] {
  const lines: { anchorYPt: number; items: TextItem[] }[] = [];
  for (const item of [...items].sort((a, b) => b.yPt - a.yPt)) {
    const open = lines[lines.length - 1];
    if (
      open !== undefined &&
      Math.abs(open.anchorYPt - item.yPt) <= CAPTION_ROW_TOLERANCE_PT
    ) {
      open.items.push(item);
      continue;
    }
    lines.push({ anchorYPt: item.yPt, items: [item] });
  }
  return lines.map((line) => [...line.items].sort((a, b) => a.xPt - b.xPt));
}

/**
 * The heading text of `page`, in reading order, or undefined when the page carries none.
 *
 * Never throws and never returns an empty string: a page whose every run is the same size has no
 * heading to report, which is a fact about the page rather than a failure to read it.
 */
export function readPageCaption(page: {
  items: readonly LayoutItem[];
}): string | undefined {
  const items = page.items.filter(
    (item): item is TextItem => item.kind === "text",
  );
  const body = bodySizePt(items);
  if (body <= 0) {
    return undefined;
  }
  const heading = items
    .filter((item) => sizeBucket(item) >= body * CAPTION_SIZE_RATIO)
    .filter((item) => CAPTION_WORDLIKE.test(item.text));
  const ordered = readingOrderLines(heading).flat();
  const caption = ordered
    .map((item) => item.text.trim())
    .filter((text) => text !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (caption === "") {
    return undefined;
  }
  return caption.length > CAPTION_MAX_CHARS
    ? `${caption.slice(0, CAPTION_MAX_CHARS).trimEnd()}...`
    : caption;
}
