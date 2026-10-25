// Reading order for a page's positioned text: which runs of text are read as one flow, and in what order those flows come. clusterIntoLines groups every item sharing a baseline into one line across the full page width, which is right for a single column and for a table row, and wrong for running prose set in columns: two columns whose baselines line up become one line per baseline, "left-column text, right-column text", so the page reads interleaved line by line instead of one column and then the next. This module finds the column gutters the page's own geometry states and splits the text at them before any line or paragraph clustering runs, so each column is clustered as its own flow.
//
// The split is a recursive XY cut restricted to what reading order needs. A gutter is a vertical strip that no item on any of a run of consecutive lines touches, with text on both sides of it inside that run; the run of lines it holds for is a column band. Lines above and below a band (a full-width heading, a boxed passage spanning both columns, a single-column section) cross the strip, so they end the band and form bands of their own, read in page order before and after it. Each side of a band, and each band above and below it, is split again the same way, which is what reads a three-column page correctly. A page with no gutter is one flow holding exactly the items it was given, so its lines and paragraphs are byte for byte what clustering the whole page always produced.
//
// Tables are the hard case: a table's columns also leave empty vertical strips with shared baselines, but a table's rows are read across. What separates them is the geometry of running prose, tested on each side of a candidate gutter (isRunningProse below): a prose column is set to a measure many characters wide and its lines wrap, so a line stops short of the column's right edge only when the next line's first word would not have fitted. A table column holds short cells whose line ends are ragged by far more than one word, or (a column of codes or figures, every cell the same width) is a handful of characters wide. A candidate gutter splits only when the text on both sides of it passes; a table, whose columns fail, keeps the full-width lines it always had.
import type { LayoutText } from "pdf-codec";
import { afmWidthOfCode } from "pdf-codec/afm-widths";
import { resolveStandardFont } from "pdf-codec/fonts";
import { clusterIntoLines, type TextLine } from "./reconstruct-lines";

/** One flow of text in reading order: the lines clustered from it, and its position among the page's flows. */
export interface ReadingRegion {
  /** The flow's own lines, top to bottom, exactly as clusterIntoLines returns them for the flow's items. */
  readonly lines: readonly TextLine[];
  /** The flow's place in reading order: compared element by element, a smaller path is read first. */
  readonly path: readonly number[];
}

/** A page's text split into reading-order flows. */
export interface ReadingOrder {
  /** Every flow on the page, in reading order. A page with no column gutter has exactly one, holding every item. */
  readonly regions: readonly ReadingRegion[];
  /**
   * The reading-order path of a point on the page, for placing something that is not text (an image, a recovered table, a drawing) among the flows: the band its y falls in and, inside a column band, the column its x falls in.
   * @param xPt - PDF-space x of the thing being placed; `Number.NEGATIVE_INFINITY` for something with no single column, which places it in the leftmost one.
   * @param yPt - PDF-space y the caller orders that thing by among the flows' own baselines.
   */
  locate: (xPt: number, yPt: number) => readonly number[];
}

type ReadingBand =
  | {
      readonly kind: "flow";
      readonly lines: readonly TextLine[];
      readonly topPt: number;
      readonly bottomPt: number;
    }
  | {
      readonly kind: "columns";
      readonly gutterXPt: number;
      readonly left: readonly ReadingBand[];
      readonly right: readonly ReadingBand[];
      readonly topPt: number;
      readonly bottomPt: number;
    };

// The fewest lines each side of a gutter must hold. The wrap test in isRunningProse judges every line but a column's last, so with two lines it has one line to judge, and one wrapped line is exactly how a table cell holding a sentence looks; three lines is the fewest for which a majority of judged lines is more than a single line.
const MIN_COLUMN_LINES = 3;

// The narrowest measure, in characters, read as a prose column. Bringhurst gives 40 to 50 characters as the usual line length for multi-column work (The Elements of Typographic Style, section 2.1.2); half of its lower end still admits the narrow columns of newsletters and leaflets, while a table column of codes, figures or dates, whose every cell can fill the column exactly, is a handful of characters wide and stays well below it. Measured in the column's own average character advance, so it holds at any font size.
const MIN_PROSE_MEASURE_CHARS = 20;

// The space character's code, whose advance in the item's own font is the natural word space that a gutter must be wider than.
const SPACE_CHAR_CODE = 0x20;

// AFM widths are stated in thousandths of an em.
const AFM_UNITS_PER_EM = 1000;

/**
 * Splits a page's text items into reading-order flows at the column gutters the page's geometry states.
 * @param items - The page's text items in content-stream order, after any table recovery has removed the text it claimed.
 * @returns The flows in reading order, and a locator placing anything else among them. A page with no gutter yields one flow whose lines are `clusterIntoLines(items)`.
 */
export function readingOrder(items: readonly LayoutText[]): ReadingOrder {
  const bands = segment(items);
  const regions: ReadingRegion[] = [];
  collectRegions(bands, [], regions);
  return {
    regions,
    locate: (xPt, yPt) => locate(bands, xPt, yPt),
  };
}

/**
 * Orders two placed blocks for reading: by reading-order path first, then top to bottom by y.
 * @returns Negative when `a` is read first, positive when `b` is, zero when neither precedes the other.
 */
export function compareReadingPosition(
  a: { readonly path: readonly number[]; readonly yPt: number },
  b: { readonly path: readonly number[]; readonly yPt: number },
): number {
  const length = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < length; i++) {
    const difference = a.path[i]! - b.path[i]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return a.path.length - b.path.length || b.yPt - a.yPt;
}

function segment(items: readonly LayoutText[]): ReadingBand[] {
  const lines = clusterIntoLines(items);
  const split = findColumnSplit(lines);
  if (split === undefined) {
    return [flowBand(lines)];
  }
  const before = lines.slice(0, split.startLine);
  const band = lines.slice(split.startLine, split.endLine);
  const after = lines.slice(split.endLine);
  return [
    ...(before.length > 0 ? segment(itemsOf(before)) : []),
    {
      kind: "columns",
      gutterXPt: (split.loPt + split.hiPt) / 2,
      left: segment(split.left),
      right: segment(split.right),
      topPt: band[0]!.baselineY,
      bottomPt: band.at(-1)!.baselineY,
    },
    ...(after.length > 0 ? segment(itemsOf(after)) : []),
  ];
}

function flowBand(lines: readonly TextLine[]): ReadingBand {
  return {
    kind: "flow",
    lines,
    topPt: lines[0]?.baselineY ?? Number.POSITIVE_INFINITY,
    bottomPt: lines.at(-1)?.baselineY ?? Number.NEGATIVE_INFINITY,
  };
}

function itemsOf(lines: readonly TextLine[]): LayoutText[] {
  return lines.flatMap((line) => line.items);
}

function collectRegions(
  bands: readonly ReadingBand[],
  prefix: readonly number[],
  into: ReadingRegion[],
): void {
  bands.forEach((band, index) => {
    if (band.kind === "flow") {
      into.push({ lines: band.lines, path: [...prefix, index] });
    } else {
      collectRegions(band.left, [...prefix, index, 0], into);
      collectRegions(band.right, [...prefix, index, 1], into);
    }
  });
}

// The band a y falls in is the one whose extent it lies within, a y between two bands going to whichever's nearer edge it is closer to, so a block sitting in the space between a band and the next is read with the band it is nearest.
function locate(
  bands: readonly ReadingBand[],
  xPt: number,
  yPt: number,
): readonly number[] {
  let index = bands.length - 1;
  for (let i = 0; i + 1 < bands.length; i++) {
    if (yPt >= (bands[i]!.bottomPt + bands[i + 1]!.topPt) / 2) {
      index = i;
      break;
    }
  }
  const band = bands[index]!;
  if (band.kind === "flow") {
    return [index];
  }
  const side = xPt < band.gutterXPt ? 0 : 1;
  return [
    index,
    side,
    ...locate(side === 0 ? band.left : band.right, xPt, yPt),
  ];
}

interface FreeSpan {
  readonly loPt: number;
  readonly hiPt: number;
}

interface GutterRun extends FreeSpan {
  readonly startLine: number;
  readonly endLine: number; // exclusive
}

interface ColumnSplit extends GutterRun {
  readonly left: readonly LayoutText[];
  readonly right: readonly LayoutText[];
}

// Tries every gutter run, the one holding for the most lines first, then the widest, and takes the first whose two sides both read as running prose. Strips nest: the strip between two columns over their full height is narrower than the one over a few lines whose left-column ends fall short, and splitting at the shorter one first would cut the columns into bands at its ends, reading the left column's first paragraphs, then the right column's, then the rest of each.
function findColumnSplit(lines: readonly TextLine[]): ColumnSplit | undefined {
  const items = itemsOf(lines);
  if (lines.length < MIN_COLUMN_LINES || !items.every(isMeasurable)) {
    return undefined;
  }
  const narrowestSpacePt = Math.min(...items.map(spaceAdvancePt));
  const runs = gutterRuns(lines, narrowestSpacePt).sort(
    (a, b) =>
      b.endLine - b.startLine - (a.endLine - a.startLine) ||
      b.hiPt - b.loPt - (a.hiPt - a.loPt) ||
      a.startLine - b.startLine,
  );
  for (const run of runs) {
    const runItems = itemsOf(lines.slice(run.startLine, run.endLine));
    // A gutter separates text set in words; it must be wider than the natural word space of every line it holds for, or it is a gap between two words.
    if (run.hiPt - run.loPt <= Math.max(...runItems.map(spaceAdvancePt))) {
      continue;
    }
    const left = runItems.filter((item) => rightEdge(item) <= run.loPt);
    const right = runItems.filter((item) => item.xPt >= run.hiPt);
    if (
      isRunningProse(left, run.hiPt - run.loPt) &&
      isRunningProse(right, run.hiPt - run.loPt)
    ) {
      return { ...run, left, right };
    }
  }
  return undefined;
}

// A gutter is drawn from item extents, so every item needs a reported advance along the horizontal axis. An item without one, a vertically set one or a rotated one has no horizontal extent to test, and rather than guess one the page keeps the full-width lines it always had.
function isMeasurable(item: LayoutText): boolean {
  return (
    item.widthPt !== undefined &&
    item.writingMode === undefined &&
    (item.rotationDeg ?? 0) === 0
  );
}

function rightEdge(item: LayoutText): number {
  return item.xPt + (item.widthPt ?? 0);
}

function spaceAdvancePt(item: LayoutText): number {
  const { standardName } = resolveStandardFont(
    item.font.family,
    item.font.weight === "bold",
    item.font.style === "italic",
  );
  const advance = afmWidthOfCode(standardName, SPACE_CHAR_CODE);
  if (advance === undefined) {
    throw new Error(`${standardName} has no AFM width for the space glyph`);
  }
  return (advance / AFM_UNITS_PER_EM) * item.sizePt;
}

// The horizontal spans one line leaves empty: before its first item, between items that do not touch, and after its last. The outer two are unbounded, so a line holding text on only one side of a gutter (a column that ends higher than its neighbour, or a short last line) still leaves the gutter free.
function freeSpans(line: TextLine): FreeSpan[] {
  const sorted = [...line.items].sort((a, b) => a.xPt - b.xPt);
  const spans: FreeSpan[] = [];
  let reachedPt = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    if (item.xPt > reachedPt) {
      spans.push({ loPt: reachedPt, hiPt: item.xPt });
    }
    reachedPt = Math.max(reachedPt, rightEdge(item));
  }
  spans.push({ loPt: reachedPt, hiPt: Number.POSITIVE_INFINITY });
  return spans;
}

// Every maximal empty strip over a run of consecutive lines: a sweep down the lines keeping each strip still open as the intersection of the free spans of every line since it opened, wider than `minWidthPt`. A strip closes, and is recorded with the lines it held for, when the next line narrows or crosses it. Only strips bounded on both sides are gutters, since an unbounded one is the page margin; a bounded strip has text on both sides by construction, as each of its edges is some line's item edge.
function gutterRuns(
  lines: readonly TextLine[],
  minWidthPt: number,
): GutterRun[] {
  const runs: GutterRun[] = [];
  let open = new Map<string, FreeSpan & { readonly startLine: number }>();
  const record = (
    span: FreeSpan & { readonly startLine: number },
    endLine: number,
  ): void => {
    if (
      Number.isFinite(span.loPt) &&
      Number.isFinite(span.hiPt) &&
      endLine - span.startLine >= MIN_COLUMN_LINES
    ) {
      runs.push({ ...span, endLine });
    }
  };
  lines.forEach((line, lineIndex) => {
    const next = new Map<string, FreeSpan & { readonly startLine: number }>();
    const keep = (loPt: number, hiPt: number, startLine: number): void => {
      if (hiPt - loPt <= minWidthPt) {
        return;
      }
      const key = `${String(loPt)}|${String(hiPt)}`;
      const existing = next.get(key);
      if (existing === undefined || startLine < existing.startLine) {
        next.set(key, { loPt, hiPt, startLine });
      }
    };
    const spans = freeSpans(line);
    for (const strip of open.values()) {
      for (const span of spans) {
        keep(
          Math.max(strip.loPt, span.loPt),
          Math.min(strip.hiPt, span.hiPt),
          strip.startLine,
        );
      }
    }
    for (const span of spans) {
      keep(span.loPt, span.hiPt, lineIndex);
    }
    for (const [key, strip] of open) {
      if (next.get(key)?.startLine !== strip.startLine) {
        record(strip, lineIndex);
      }
    }
    open = next;
  });
  for (const strip of open.values()) {
    record(strip, lines.length);
  }
  return runs;
}

// Whether the text on one side of a candidate gutter reads as a column of running prose rather than a column of table cells: enough lines to judge, a measure at least MIN_PROSE_MEASURE_CHARS of its own characters wide, and lines that wrap. A wrapped line ends short of the column's right edge by less than the next line's first word plus a space, since that word would otherwise have been set on it; a paragraph's last line is the one ordinary exception, so a majority of the judged lines (every line but the column's last, which has no next line) must wrap. A table cell's line ends where its content does, ragged by far more than a word. The column's own word gaps must also be narrower than the gutter: two justified columns stretch their word spaces, but never to the width of the strip between the columns, while a strip a few lines long that a coincidence of stretched word gaps leaves empty (a river) is as narrow as those gaps themselves.
function isRunningProse(
  items: readonly LayoutText[],
  gutterWidthPt: number,
): boolean {
  const lines = clusterIntoLines(items);
  if (lines.length < MIN_COLUMN_LINES) {
    return false;
  }
  const characters = items.reduce((sum, item) => sum + item.text.length, 0);
  const advancePt = items.reduce((sum, item) => sum + (item.widthPt ?? 0), 0);
  if (characters === 0 || advancePt === 0) {
    return false;
  }
  const leftPt = Math.min(...items.map((item) => item.xPt));
  const rightPt = Math.max(...items.map(rightEdge));
  if ((rightPt - leftPt) / (advancePt / characters) < MIN_PROSE_MEASURE_CHARS) {
    return false;
  }
  for (const line of lines) {
    for (const span of freeSpans(line)) {
      if (
        Number.isFinite(span.loPt) &&
        Number.isFinite(span.hiPt) &&
        span.hiPt - span.loPt >= gutterWidthPt
      ) {
        return false;
      }
    }
  }
  let wrapped = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    const lineRightPt = Math.max(...lines[i]!.items.map(rightEdge));
    const nextFirst = lines[i + 1]!.items[0]!;
    if (
      rightPt - lineRightPt <
      firstWordWidthPt(nextFirst) + spaceAdvancePt(nextFirst)
    ) {
      wrapped++;
    }
  }
  return wrapped * 2 > lines.length - 1;
}

// The width of an item's first word, taken as its share of the item's advance by character count: an item can be a single word or a whole line, and a reader reports one advance for the item, not per glyph.
function firstWordWidthPt(item: LayoutText): number {
  const text = item.text.trimStart();
  const firstWord = text.split(/\s/u)[0] ?? text;
  return text.length === 0
    ? 0
    : ((item.widthPt ?? 0) * firstWord.length) / item.text.length;
}
