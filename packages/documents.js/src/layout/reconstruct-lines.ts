// The shared text-reconstruction vocabulary, split from reconstruct.ts: clustering positioned text items into lines (with duplicate-paint and fuzzy-redraw-pass collapsing), measuring per-item vertical extent from real AFM ascent/descent, and clustering lines into paragraphs. Every reconstruction direction (wordprocessing, spreadsheet, presentation, drawing) builds on these; nothing here imports back from any of them, so this module is the leaf of the reconstruction graph.
import type {
  ContentParagraph,
  ContentRun,
  LayoutFrame,
} from "document-schema.js";
import type { Alignment } from "document-schema.js";
import type { LayoutText } from "pdf-codec";
import { resolveStandardFont } from "pdf-codec/fonts";
import { STANDARD_METRICS } from "pdf-codec/afm-widths";
import { runGapPt, runsShareBaseline } from "pdf-codec/text-group";
import { stampFrame } from "./shared";

// --- Shared: cluster positioned text into lines, then measure per-item vertical extent from real AFM ascent/descent (not a generic guess — afm-widths.ts already carries verified per-face metrics from the same data the write path itself uses). ---

export interface TextLine {
  readonly items: readonly LayoutText[]; // left-to-right
  readonly baselineY: number;
}

// Baseline-proximity tolerance of 0.5x font size — wide enough to catch superscripts into their own line, tight enough to never merge two genuinely separate lines (plan Step 10). The fraction stays at this package's own tuned value rather than pdf-codec's looser default, but the em it is a fraction of now comes from the SMALLER of the two runs being compared rather than from whichever of them happened to supply it (ExaDev/documents.js#1317): taken from the larger, a 30pt heading's own 15pt window swallowed the 9pt line 12pt beneath it, and the merged line's runs then sorted by x into a sequence whose gaps were negative, which pushRunsForLine reads as one word, concatenating the two lines into run-together text.
const LINE_BASELINE_TOLERANCE_FACTOR = 0.5;

// AFM font metrics are stated in thousandths of an em, the factor that turns them into points at a given size.
const AFM_UNITS_PER_EM = 1000;

// Font sizes and line gaps are clustered into half-point buckets: fine enough that genuine sizes stay distinct, coarse enough that float noise in repeated paints lands in one bucket.
export const HALF_POINT_BUCKET_PT = 0.5;

// Whether `item` belongs on the line `anchor` opened. The comparison is always against a line's own anchor, never its most recently admitted run, so a line cannot walk down the page one near-miss at a time.
function sharesBaseline(anchor: LayoutText, item: LayoutText): boolean {
  return runsShareBaseline(anchor, item, {
    baselineToleranceEm: LINE_BASELINE_TOLERANCE_FACTOR,
  });
}

// --- Duplicate-paint collapsing (ExaDev/documents.js#1062) ---
//
// Some PDF producers' content streams paint the exact same text-showing operation more than once at the exact same position — confirmed against a real corpus PDF assembled from several merged source editions, where whole sentences were redrawn two to four times, each repeat landing within a thousandth of a point of the last (float noise from re-deriving the identical operator's own position, not a deliberate second location). A viewer only ever sees the LAST paint; repeated ink at the same pixels changes nothing on the rendered page. Counting each repeat as separate content corrupts reading order the moment it matters: every text-showing operation on the page is duplicated the same way, so a densely-packed region (a table row, several short adjacent labels) ends up with many runs sharing one clustered line, each with its own two to four near-identical copies — clusterIntoLines groups them all onto that one line by baseline alone, sorts strictly by x, and pushRunsForLine's own zero-gap "no space needed" rule (items this close together are read as the same word) then concatenates each run's own repeats back-to-back before moving on to the next run's repeats, producing exactly the "wordwordword" then "nextrunnextrunnextrun" pattern that reads as scrambled interleaving once several such runs share a baseline.
//
// A tenth of a point is comfortably above the sub-thousandth-point float noise a duplicate paint's own repeated interpretation introduces, and comfortably below the smallest real spacing this package's own layout ever produces between two genuinely distinct pieces of content (MIN_WORD_GAP_PT alone is 0.5pt) — so bucketing position to this precision can never merge two adjacent-but-distinct occurrences of the same word, only a paint of the identical text repeated on top of itself.
const DUPLICATE_PAINT_BUCKET_PT = 0.1;

// Trimmed, not the raw string: two paints of what is otherwise the identical run sometimes differ by only a trailing space (confirmed directly — two items at the exact same xPt/yPt, one measuring 10pt wider than the other purely from that one extra character), which is itself further evidence these are two independent re-derivations of the same content rather than two Tj calls sharing a literal byte-for-byte-identical operand. Requiring exact equality would let a repeat like that survive both of this section's dedup passes solely because of a trailing space neither reader nor writer would ever notice.
function duplicatePaintKey(item: LayoutText): string {
  const xBucket = Math.round(item.xPt / DUPLICATE_PAINT_BUCKET_PT);
  const yBucket = Math.round(item.yPt / DUPLICATE_PAINT_BUCKET_PT);
  return `${item.text.trim()}|${String(xBucket)}|${String(yBucket)}`;
}

// Keeps each item's first occurrence and drops every later one whose text and position both land in the same duplicate-paint bucket as something already kept — an O(n) pass (a Set lookup per item) rather than an O(n^2) nested scan, since a page carrying this defect can hold thousands of text items and every one of them needs checking.
function dropDuplicatePaints(
  items: readonly LayoutText[],
): readonly LayoutText[] {
  const seen = new Set<string>();
  const kept: LayoutText[] = [];
  for (const item of items) {
    const key = duplicatePaintKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

// A second, coarser duplicate-paint case dropDuplicatePaints' own tight position bucket deliberately does not catch: the SAME complete text-showing run redrawn several times across a wider span, one paint per underlying table column, rather than once as a genuinely spanning cell — confirmed directly against the source PDF's own content stream, which wraps every text run in its own self-contained `q <rect> re W n BT ... Tj ET Q` block, each already correctly and tightly clipped to its own content. Clipping is not the mechanism producing the repeats (every clip already fully contains its own text, so none of this is a truncated sliver of a longer string); the content stream genuinely repeats the whole block, verbatim, several times at different x positions.
//
// Two occurrences of the identical text sharing one already-clustered line are treated as one such repeat, not two independently laid-out cells that merely happen to hold the same short value, exactly when the earlier occurrence's own rendered width already extends past where the next one starts — a real table never lays out two cells so close together that their own text would visually collide, so an overlap this direct is only possible when both paint the identical content on top of, or straddling into, one another. A short status code genuinely repeated once per column (a grade table's "NP"/"Op" across several narrow columns) never trips this: its own rendered width sits well inside the gap to the next column, with no overlap at all — so this rule can tell a redundant redraw of a long fragment apart from a legitimately repeated short cell value without needing a length threshold of its own.
function dropOverlappingRepeatsWithinLine(
  items: readonly LayoutText[],
): LayoutText[] {
  const rightEdgeByText = new Map<string, number>();
  const kept: LayoutText[] = [];
  for (const item of items) {
    // Trimmed for the same reason duplicatePaintKey above trims: two repeats of one run sometimes differ by only a trailing space.
    const textKey = item.text.trim();
    const priorRightEdge = rightEdgeByText.get(textKey);
    if (priorRightEdge !== undefined && item.xPt < priorRightEdge) {
      continue;
    }
    rightEdgeByText.set(textKey, item.xPt + (item.widthPt ?? 0));
    kept.push(item);
  }
  return kept;
}

// --- Fuzzy duplicate-redraw collapsing (ExaDev/documents.js#1066) ---
//
// dropDuplicatePaints and dropOverlappingRepeatsWithinLine above both assume a repeated paint tokenizes identically each time it is redrawn: the same text-showing operator boundaries, producing items whose text (once trimmed) matches exactly. Some PDF producers redraw the same underlying sentence several times with DIFFERENT operator boundaries per redraw — confirmed against a real production PDF (novus-power/hive#1543) where kerning/positioning differs enough between redraws that no two occurrences ever land at the same position or split the sentence into the same fragments, so neither dedup pass above ever fires; sorted by x, the redraws' fragments interleave with each other exactly the way #1062's same-position repeats used to, except here the corruption survives that fix too.
//
// This pass runs on items in their ORIGINAL document-encounter order — the order interpret.ts's own content-stream walk produced them in, preserved end to end through page.items into reconstructPageBlocks' own textItems filter above — before anything sorts by position. Within one baseline, a legitimate paint pass advances left to right; a later item whose x has fallen well behind the rightmost extent the current pass had already reached is the signature of a fresh redraw beginning again near the same left margin, not of the same sentence continuing. Two such passes on one baseline, occupying overlapping x-ranges, whose concatenated text is a close (not necessarily exact) match, are the redraw this section exists to collapse — every later matching pass is dropped, keeping only the first, the same convention dropOverlappingRepeatsWithinLine above already uses.
//
// The corpus PDF this was confirmed against is a confidential licensed standard and could not be attached to this package's own test fixtures — the tests below instead model the reported failure shape directly (a sentence redrawn with different fragment splits and a little wording drift, with legitimate distinct prose left untouched nearby).

// Comfortably above the sub-thousandth-point float noise a paint's own repeated interpretation introduces (see DUPLICATE_PAINT_BUCKET_PT above), and comfortably below any genuine redraw restart, which begins again from (approximately) the same left margin the current pass itself started from — tens of points behind wherever the pass has already reached. A within-pass kerning wobble never falls back this far; only a fresh redraw does.
const REDRAW_PASS_REWIND_TOLERANCE_PT = 2;

// Below this length, two short strings can land close in edit distance by coincidence (e.g. "Op"/"No"), and dropOverlappingRepeatsWithinLine above already owns genuinely repeated short values — restricting this pass to sentence-length text keeps it from ever competing with that decision.
const MIN_REDRAW_PASS_TEXT_LENGTH = 12;

// A redraw re-deriving the same underlying content can differ from the occurrence kept — not just in fragment boundaries, but in the odd character here and there (confirmed directly against the corpus PDF: its own repeats sometimes disagree by a character where source editions were merged). Requiring more than half of each pass's own text to participate in transforming one into the other is comfortably above what two unrelated sentences of comparable length would share by chance, and comfortably below where two independent re-derivations of the same content, drift and all, actually land.
const REDRAW_PASS_SIMILARITY_THRESHOLD = 0.6;

interface RedrawPass {
  readonly items: LayoutText[];
  readonly startXPt: number;
  endXPt: number;
}

// Mirrors clusterIntoLines' own baseline-tolerance bucketing below, but walks items in the order given rather than sorting first — each group's own items therefore stay in document order, which splitIntoPasses needs to detect a restart.
function groupByBaselineInDocumentOrder(
  items: readonly LayoutText[],
): LayoutText[][] {
  const groups: { anchor: LayoutText; items: LayoutText[] }[] = [];
  for (const item of items) {
    const group = groups.find((g) => sharesBaseline(g.anchor, item));
    if (group === undefined) {
      groups.push({ anchor: item, items: [item] });
    } else {
      group.items.push(item);
    }
  }
  return groups.map((g) => g.items);
}

// Splits one baseline's items (in document order) into candidate redraw passes: a new pass starts whenever an item's x has fallen well behind the rightmost extent the current pass has already reached (see REDRAW_PASS_REWIND_TOLERANCE_PT above).
function splitIntoPasses(group: readonly LayoutText[]): RedrawPass[] {
  const passes: RedrawPass[] = [];
  for (const item of group) {
    const current = passes.at(-1);
    const itemRightPt = item.xPt + (item.widthPt ?? 0);
    if (
      current !== undefined &&
      item.xPt >= current.endXPt - REDRAW_PASS_REWIND_TOLERANCE_PT
    ) {
      current.items.push(item);
      current.endXPt = Math.max(current.endXPt, itemRightPt);
    } else {
      passes.push({
        items: [item],
        startXPt: item.xPt,
        endXPt: itemRightPt,
      });
    }
  }
  return passes;
}

// Raw concatenation, not the gap-aware spacing pushRunsForLine below produces — this text exists only to compare two passes for similarity, and different redraws sometimes insert whitespace differently around the same words, which a fuzzy comparison already absorbs without needing faithful spacing.
function passText(pass: RedrawPass): string {
  return pass.items
    .map((item) => item.text)
    .join("")
    .trim();
}

// Whether two passes on the same baseline occupy overlapping page-space — the same "would visually collide" reasoning dropOverlappingRepeatsWithinLine above uses, applied to a pass' full span rather than one item's own width.
function passesOverlap(a: RedrawPass, b: RedrawPass): boolean {
  return a.startXPt < b.endXPt && b.startXPt < a.endXPt;
}

// Classic memoized edit distance. Recurses on plain string indices rather than indexing into a rolling DP array or a character array, using String.prototype.charAt (always a string, empty past the end — never undefined) for the per-character comparison and a Map keyed by "i:j" for memoization, so this needs neither a non-null assertion nor a type assertion to satisfy noUncheckedIndexedAccess.
function levenshteinDistance(a: string, b: string): number {
  const memo = new Map<string, number>();
  function distance(i: number, j: number): number {
    if (i === 0) {
      return j;
    }
    if (j === 0) {
      return i;
    }
    const key = `${String(i)}:${String(j)}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
    const result = Math.min(
      distance(i - 1, j) + 1,
      distance(i, j - 1) + 1,
      distance(i - 1, j - 1) + cost,
    );
    memo.set(key, result);
    return result;
  }
  return distance(a.length, b.length);
}

// No zero-length guard: both of dropFuzzyRedrawnPasses' own call sites already reject a text shorter than MIN_REDRAW_PASS_TEXT_LENGTH before ever reaching here, so maxLength is always >= that floor and the division can never see a 0 denominator.
function textSimilarity(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  return 1 - levenshteinDistance(a, b) / maxLength;
}

// Drops every later pass on a baseline that is a fuzzy redraw of the first: a restart in x within one baseline's own document-order sequence (splitIntoPasses), long enough text on both sides to rule out coincidental short-string similarity, overlapping x-ranges, and a similarity ratio clearing REDRAW_PASS_SIMILARITY_THRESHOLD against the first (kept) pass. Falling short of any one of these leaves every item on that baseline untouched — this pass would rather miss a real redraw than risk dropping content that only looked like one, exactly the "editorial amendment text, not corrupted noise" distinction ExaDev/documents.js#1066 itself calls for.
function dropFuzzyRedrawnPasses(
  items: readonly LayoutText[],
): readonly LayoutText[] {
  const toDrop = new Set<LayoutText>();
  for (const group of groupByBaselineInDocumentOrder(items)) {
    const passes = splitIntoPasses(group);
    if (passes.length < 2) {
      continue;
    }
    const [first, ...rest] = passes;
    if (first === undefined) {
      continue;
    }
    const firstText = passText(first);
    if (firstText.length < MIN_REDRAW_PASS_TEXT_LENGTH) {
      continue;
    }
    for (const candidate of rest) {
      const candidateText = passText(candidate);
      if (candidateText.length < MIN_REDRAW_PASS_TEXT_LENGTH) {
        continue;
      }
      if (!passesOverlap(first, candidate)) {
        continue;
      }
      if (
        textSimilarity(firstText, candidateText) <
        REDRAW_PASS_SIMILARITY_THRESHOLD
      ) {
        continue;
      }
      for (const item of candidate.items) {
        toDrop.add(item);
      }
    }
  }
  if (toDrop.size === 0) {
    return items;
  }
  return items.filter((item) => !toDrop.has(item));
}

// The one place every reconstruction direction clusters positioned text into lines — wordprocessing paragraphs and presentation blocks call this directly, and both table-cell paths (recoverTaggedTables, recoverTable) reach it indirectly through cellBlocksFromItems — so collapsing duplicate paints here, before any of them sees the items, fixes every one of those consumers from one place rather than needing a matching guard at each call site.
export function clusterIntoLines(items: readonly LayoutText[]): TextLine[] {
  const sorted = [...dropDuplicatePaints(dropFuzzyRedrawnPasses(items))].sort(
    (a, b) => b.yPt - a.yPt || a.xPt - b.xPt,
  );
  const working: {
    items: LayoutText[];
    baselineY: number;
    anchor: LayoutText;
  }[] = [];
  for (const item of sorted) {
    const line = working.find((l) => sharesBaseline(l.anchor, item));
    if (line === undefined) {
      working.push({ items: [item], baselineY: item.yPt, anchor: item });
    } else {
      line.items.push(item);
    }
  }
  for (const line of working) {
    line.items.sort((a, b) => a.xPt - b.xPt);
    line.items = dropOverlappingRepeatsWithinLine(line.items);
  }
  working.sort((a, b) => b.baselineY - a.baselineY);
  return working;
}

export function textItemVerticalExtent(item: LayoutText): {
  ascentPt: number;
  descentPt: number;
} {
  const { standardName } = resolveStandardFont(
    item.font.family,
    item.font.weight === "bold",
    item.font.style === "italic",
  );
  const metrics = STANDARD_METRICS[standardName];
  return {
    ascentPt: (metrics.ascender / AFM_UNITS_PER_EM) * item.sizePt,
    descentPt: (Math.abs(metrics.descender) / AFM_UNITS_PER_EM) * item.sizePt,
  };
}

export function textItemToContentRun(item: LayoutText): ContentRun {
  // Absent bold/italic are omitted rather than written as explicit undefined keys, so every run this reconstruction produces has the same shape whether the flag was dropped by the heading inference above or never present — and a consumer's toStrictEqual against a key-absent run object holds.
  return {
    text: item.text,
    ...(item.font.weight === "bold" ? { bold: true } : {}),
    ...(item.font.style === "italic" ? { italic: true } : {}),
    fontFamily: item.font.family,
    sizePt: item.sizePt,
    color: item.color,
  };
}

// A small absolute floor (not font-size-relative) below which two adjacent items are treated as directly continuing the same word (e.g. a bold/italic sub-run split mid-word) rather than separate words needing a space — guards against float-rounding noise producing a spurious tiny positive gap.
export const MIN_WORD_GAP_PT = 0.5;

// Whether the gap between two consecutive items on one line clears `thresholdPt`. False whenever the gap is not derivable at all, which is what an absent advance width on the earlier item means (ExaDev/documents.js#1317): reading that absence as zero put the previous item's end at its own start, so its whole advance read as a gap and spaces appeared inside words, "Com plete ly". An unknown gap is no evidence of a space, a tab, or a cell boundary.
export function gapExceeds(
  previous: LayoutText,
  next: LayoutText,
  thresholdPt: number,
): boolean {
  const gap = runGapPt(previous, next);
  return gap !== undefined && gap > thresholdPt;
}

// The PDF-space box one recovered text item occupied — the exact frame stamped onto the ContentRun node rebuilt from it (and, aggregated over a line's items, onto the paragraph that line became). Uses the same real AFM ascent/descent metrics textItemVerticalExtent derives, so a run's own frame matches the geometry its source glyph run was rendered with.
export function textBoxOfItem(
  item: LayoutText,
  pageIndex: number,
): LayoutFrame {
  const { ascentPt, descentPt } = textItemVerticalExtent(item);
  return {
    pageIndex,
    xPt: item.xPt,
    yPt: item.yPt - descentPt,
    widthPt: item.widthPt ?? 0,
    heightPt: ascentPt + descentPt,
  };
}

// The PDF-space bounding box of a whole clustered line — the frame stamped onto the ContentParagraph a line (or a one-line block) became.
export function lineBox(line: TextLine, pageIndex: number): LayoutFrame {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const item of line.items) {
    const { ascentPt, descentPt } = textItemVerticalExtent(item);
    minX = Math.min(minX, item.xPt);
    maxX = Math.max(maxX, item.xPt + (item.widthPt ?? 0));
    minY = Math.min(minY, item.yPt - descentPt);
    maxY = Math.max(maxY, item.yPt + ascentPt);
  }
  return {
    pageIndex,
    xPt: minX,
    yPt: minY,
    widthPt: maxX - minX,
    heightPt: maxY - minY,
  };
}

// Appends ContentRuns for one line's items, inserting the word-space or tab a caller reading the reconstructed text needs between them: PDF text extraction carries no literal space characters between separately-shown words (interpret.ts's word-wrapping and per-item positioning use xOffsetPt, not embedded spaces), so a positive gap between consecutive items must be turned back into an actual space (or, when it's large enough to read as tabbed/columnar content, a tab) rather than silently concatenating adjacent words together.
// pageIndex threads through so every run rebuilt from an item carries that item's own rendered position as its frame — the PDF->X half of the frames fusion, where each reconstructed node's frames are exactly the items it was clustered from (sourcePath survives on items as traceability only).
export function pushRunsForLine(
  runs: ContentRun[],
  line: TextLine,
  pageIndex: number,
): void {
  line.items.forEach((item, itemIndex) => {
    if (itemIndex > 0) {
      const prevItem = line.items[itemIndex - 1]!;
      if (gapExceeds(prevItem, item, LARGE_GAP_EM_MULTIPLIER * item.sizePt)) {
        runs.push({ text: "\t" });
      } else if (gapExceeds(prevItem, item, MIN_WORD_GAP_PT)) {
        runs[runs.length - 1]!.text += " ";
      }
    }
    const run = textItemToContentRun(item);
    stampFrame(run, pageIndex, textBoxOfItem(item, pageIndex));
    runs.push(run);
  });
}

export function bucketCounts(
  values: readonly number[],
  bucketSize: number,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const v of values) {
    const bucket = Math.round(v / bucketSize) * bucketSize;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return counts;
}

export function modeOf(values: readonly number[], bucketSize: number): number {
  if (values.length === 0) {
    return 0;
  }
  const counts = bucketCounts(values, bucketSize);
  let bestBucket = values[0]!;
  let bestCount = 0;
  for (const [bucket, count] of counts) {
    if (count > bestCount) {
      bestBucket = bucket;
      bestCount = count;
    }
  }
  return bestBucket;
}

// A "mode" with no actual repetition (every gap in the sample distinct) isn't a meaningful modal line spacing — with all counts tied at 1, modeOf would just return whichever bucket happened to be inserted first, which is arbitrary. The smallest observed gap is a more defensible "this counts as normal line spacing" baseline in that case, since a paragraph or section break is by definition larger than ordinary single-line spacing, never smaller.
function modalLineGap(gaps: readonly number[]): number {
  const counts = bucketCounts(gaps, HALF_POINT_BUCKET_PT);
  let bestBucket = gaps[0]!;
  let bestCount = 0;
  for (const [bucket, count] of counts) {
    if (count > bestCount) {
      bestBucket = bucket;
      bestCount = count;
    }
  }
  return bestCount > 1 ? bestBucket : Math.min(...gaps);
}

// A vertical gap exceeding 1.25x the page's own modal line spacing reads as a paragraph break in docx, or as leaving one pptx text block for another (plan Step 10) — the same underlying "is this still the same flow of text" signal in both directions, so both reuse this one constant.
export const LARGE_GAP_EM_MULTIPLIER = 2;

// Two font sizes are "close" when they differ by at most a fixed point tolerance or a small ratio, whichever is wider; the shared merge condition for both the docx paragraph clusterer and the presentation direction's block clusterer.
const FONT_SIZE_CLOSE_TOLERANCE_PT = 1;
const FONT_SIZE_CLOSE_TOLERANCE_RATIO = 0.15;

export function fontSizesClose(a: number, b: number): boolean {
  return (
    Math.abs(a - b) <= FONT_SIZE_CLOSE_TOLERANCE_PT ||
    Math.abs(a - b) / Math.max(a, b) <= FONT_SIZE_CLOSE_TOLERANCE_RATIO
  );
}

export const PARAGRAPH_GAP_MULTIPLIER = 1.25;

// A typical single-line leading ratio (matching the general range of afm-widths.ts's own per-face lineHeightEm values, 1.133-1.150), used as the "normal spacing" baseline when there are too few lines on the page to derive a meaningful mode from their own gaps.
const NOMINAL_LINE_SPACING_RATIO = 1.2;
// Below this many lines, the mode of the observed gaps is not a meaningful sample — with exactly one gap, it trivially equals its own mode, so nothing could ever be classified as "larger than normal" no matter how large the gap actually is (the failure this guards against: two isolated, widely-separated lines being merged into one paragraph because the single gap between them "is" the modal spacing by definition).
const MIN_LINES_FOR_GAP_MODE = 3;

export function estimateModalLineSpacing(lines: readonly TextLine[]): number {
  if (lines.length < MIN_LINES_FOR_GAP_MODE) {
    const dominantSizePt = modeOf(
      lines.map((l) => l.items[0]!.sizePt),
      HALF_POINT_BUCKET_PT,
    );
    return dominantSizePt * NOMINAL_LINE_SPACING_RATIO;
  }
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(lines[i - 1]!.baselineY - lines[i]!.baselineY);
  }
  return modalLineGap(gaps);
}

export interface TextParagraph {
  readonly lines: TextLine[];
}

export function clusterIntoParagraphs(
  lines: readonly TextLine[],
): TextParagraph[] {
  if (lines.length === 0) {
    return [];
  }
  const modalSpacing = estimateModalLineSpacing(lines);
  const dominantLeftX = modeOf(
    lines.map((l) => l.items[0]!.xPt),
    1,
  );

  const paragraphs: TextParagraph[] = [{ lines: [lines[0]!] }];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const next = lines[i]!;
    if (startsNewParagraph(prev, next, modalSpacing, dominantLeftX)) {
      paragraphs.push({ lines: [next] });
    } else {
      paragraphs[paragraphs.length - 1]!.lines.push(next);
    }
  }
  return paragraphs;
}

// Two of the plan's four break signals (vertical gap, indent change) are implemented directly, plus the font-size discontinuity below. The other two (alignment classification changing, a justified block's short final line) need first classifying each line's own alignment from its right-margin distance — a real additional analysis this pass doesn't attempt; gap and indent already catch the large majority of real paragraph boundaries.
function startsNewParagraph(
  prev: TextLine,
  next: TextLine,
  modalSpacing: number,
  dominantLeftX: number,
): boolean {
  const gap = prev.baselineY - next.baselineY;
  if (gap > PARAGRAPH_GAP_MULTIPLIER * modalSpacing) {
    return true;
  }
  // A font-size discontinuity is a paragraph boundary even at ordinary line spacing: a heading sits tight above the body it names, so the gap signal alone merges the two into one glued paragraph (the observed "**Part 1 Scope **This is body..." failure, ExaDev/documents.js#584), and the same discontinuity is what the presentation direction's own clusterIntoBlocks already refuses to merge across — its fontSizesClose condition — so this brings the two clusterers onto one rule rather than inventing a new one.
  if (!fontSizesClose(prev.items[0]!.sizePt, next.items[0]!.sizePt)) {
    return true;
  }
  const nextLeft = next.items[0]!.xPt;
  const prevLeft = prev.items[0]!.xPt;
  const emPt = next.items[0]!.sizePt;
  const nextIndented = Math.abs(nextLeft - dominantLeftX) > emPt;
  const prevAtMargin = Math.abs(prevLeft - dominantLeftX) <= emPt;
  return nextIndented && prevAtMargin;
}

export const LEFT_ALIGN_TOLERANCE_PT = 2;

export function paragraphToContentParagraph(
  paragraph: TextParagraph,
  pageIndex: number,
  headingLevel: number | undefined,
): ContentParagraph {
  const dominantLeftX = modeOf(
    paragraph.lines.map((l) => l.items[0]!.xPt),
    1,
  );
  const alignment: Alignment | undefined = paragraph.lines.every(
    (l) => Math.abs(l.items[0]!.xPt - dominantLeftX) <= LEFT_ALIGN_TOLERANCE_PT,
  )
    ? "left"
    : undefined;

  // Both spellings of the inferred depth, matching markdown-codec's own lowerHeading: styleId is this family's producer-specific Heading{N} spelling, while headingLevel is the canonical signal the schema documents — decompose groups on headingLevel alone (a Heading styleId without it never becomes a HeadingGroupNode), the docx writer emits w:outlineLvl from it, and the tree/outline consumers read it. styleId without headingLevel would strand the heading ungrouped and unoutlined everywhere except the markdown emitter.
  const result: ContentParagraph = {
    kind: "paragraph",
    runs: [],
    alignment,
    ...(headingLevel !== undefined
      ? { styleId: `Heading${String(headingLevel)}`, headingLevel }
      : {}),
  };
  paragraph.lines.forEach((line, lineIndex) => {
    // One frame per clustered line, stamped on the paragraph node itself — the paragraph's own rendered placements, aggregated from exactly the items it was clustered from (the runs inside carry their own finer-grained frames via pushRunsForLine).
    stampFrame(result, pageIndex, lineBox(line, pageIndex));
    // Lines within a paragraph join with a single space — deliberately not de-hyphenating a trailing hyphen, since the "looks like a soft hyphen" heuristic corrupts genuine hyphenated compounds about as often as it fixes wrapped words (plan Step 10).
    if (lineIndex > 0) {
      const lastRun = result.runs[result.runs.length - 1];
      if (lastRun !== undefined) {
        lastRun.text += " ";
      }
    }
    pushRunsForLine(result.runs, line, pageIndex);
  });
  // An inferred heading's weight is structural, carried by the heading itself (both the canonical headingLevel and the Heading{N} styleId spelling) — leaving run-level bold in place would render markdown as '# **Title**', the literal '**bold** run' noise this inference exists to replace. Everything else about the runs (italic, colour, family, size) is genuine information and stays. The dropped key is omitted outright rather than written as an explicit `bold: undefined`, so the run is shape-identical to one that was never bold (an explicit-undefined key survives `'bold' in run` and trips toStrictEqual against a key-absent object).
  if (headingLevel !== undefined) {
    result.runs = result.runs.map((run) => {
      if (run.bold !== true) {
        return run;
      }
      const withoutBold: ContentRun = { ...run };
      delete withoutBold.bold;
      return withoutBold;
    });
  }

  return result;
}
