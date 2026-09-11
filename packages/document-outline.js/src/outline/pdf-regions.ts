import type { ContentInterpretation } from "document-schema.js";
import type { LayoutItem, LayoutPage } from "pdf-codec";
import type { RegionClassification } from "./regions";

// PDF region segmentation (ExaDev/documents.js#931): pdf-codec's LayoutPage is deliberately just positioned items -- text/image/rect/line/ellipse/path/link, in PDF user space (origin bottom-left, y up, points) -- with no notion of columns, tables, figures, or captions (see pdf-codec's own README, "Architecture": semantic reconstruction from geometry is expensive, lossy, and deliberately kept out of the codec). segmentPdfRegions is the PDF-specific sibling of outline/regions.ts's segmentSheetRegions: a PURELY ADDITIONAL, OPT-IN inference over a page's own items, reusing RegionClassification (regions.ts's own doc comment already names this as the vocabulary a future PDF pass would reuse rather than re-mint) rather than mutating or gating anything -- a consumer who never calls this still has every LayoutItem exactly as readPdf reported it.
//
// The technique is the recursive X-Y cut (Nagy, G., & Seth, S., "Hierarchical representation of optically scanned documents", Proc. 7th ICPR, 1984, pp. 347-349: https://www.researchgate.net/publication/4214809 -- also summarised, with the gap-threshold variant this module adapts, in Meunier, J-L., "Optimized XY-cut for determining a page reading order", 2005: https://static.aminer.org/pdf/PDF/000/295/221/optimized_xy_cut_for_determining_a_page_reading_order.pdf), the standard top-down page-segmentation algorithm: recursively split a page's content along whichever axis (x or y) has the widest whitespace gap between item clusters, until no gap wide enough to be structural remains. It was chosen over a literal port of segmentSheetRegions' own connected-component/gap-tolerance approach because a sheet's cells already sit on a discrete row/column grid (adjacency is "how many blank grid lines apart"), whereas a PDF page has no grid at all -- only continuous coordinates -- so "how wide a gap, relative to the content around it" is the only signal available, and recursive X-Y cut is the well-established technique for exactly that continuous case. Each leaf of the cut is then classified from cheap geometric/content signals, the same "plain, cheap-to-explain measurement, no external corpus, no learned weights" philosophy regions.ts's own computeSignals/classifyRegion already use for sheets.

export interface PdfRegionBounds {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

// One leaf of the recursive X-Y cut over a page's items, with its bounding box and a best-effort classification. `bounds` is the bounding box of `items` (as `SheetRegion.range` is of `SheetRegion.cells` in regions.ts) -- a consumer wanting only the genuinely painted content should read `items`, not treat `bounds` as itself painted. `confidence` reuses the same 0 (no signal) to 1 (unambiguous) scale regions.ts introduces for SheetRegion, for the same reason: one advisory confidence convention across this package's region-inference surface, spreadsheet or PDF.
export interface PdfRegion {
  readonly bounds: PdfRegionBounds;
  readonly items: readonly LayoutItem[];
  readonly classification: RegionClassification;
  readonly confidence: number;
  // The caption text this region is labelled by, set on a 'figure' region when attachCaptions below
  // found one. Associated, not moved: the caption remains its own 'caption'-classified region in the
  // returned array, so a consumer projecting every region's text still reads it exactly once -- the same
  // rule document-schema.js's ContentImageBlock.caption follows for a docx figure, and for the same
  // reason. Absent when no adjacent short text run claimed this figure, which is the common case.
  readonly caption?: string;
  // What a consumer read out of this region, when it has read it -- the schema's own annotation channel,
  // reused here rather than re-minted (ContentInterpretationSchema is exported for exactly this).
  //
  // Never set by segmentPdfRegions: this package infers geometry, and nothing in it calls a model or
  // reads pixels. The field exists because a PDF region is the one place an interpretation of a *vector*
  // figure can attach at all -- a chart drawn as paths is dozens of sibling rect/line/path items with no
  // single content node whose extent is the chart, so the region is the only container whose content IS
  // the thing being described. A consumer that rasterises a region and reads it puts the result here.
  readonly interpretation?: ContentInterpretation;
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

// An item's axis-aligned bounds in page space, or undefined for link/internalLink: an annotation is an anchored, clickable region rather than painted stream content, the same line pdf-codec's own crop-visibility filter (read.ts's contentItemBounds) draws when deciding what a page's visible geometry actually is -- layout analysis over what a reader SEES should draw that line identically.
function layoutItemBounds(item: LayoutItem): Bounds | undefined {
  switch (item.kind) {
    case "link":
    case "internalLink":
      return undefined;
    case "text":
      // widthPt is optional (reported, not measured, on some paths); a missing width bounds the run to its anchor plus font size alone, never an unbounded extent -- the same `?? 0` convention pdf-codec's own read.ts uses for the identical field. Vertical extent runs from the baseline (yPt) to one font size above it, matching that same module's text frame convention (baseline to baseline + sizePt) rather than inventing a separate ascent/descent estimate this package has no metrics to justify.
      return {
        minX: item.xPt,
        minY: item.yPt,
        maxX: item.xPt + (item.widthPt ?? 0),
        maxY: item.yPt + item.sizePt,
      };
    case "image":
    case "rect":
    case "ellipse":
      return {
        minX: item.xPt,
        minY: item.yPt,
        maxX: item.xPt + item.widthPt,
        maxY: item.yPt + item.heightPt,
      };
    case "line":
      return {
        minX: Math.min(item.x1Pt, item.x2Pt),
        minY: Math.min(item.y1Pt, item.y2Pt),
        maxX: Math.max(item.x1Pt, item.x2Pt),
        maxY: Math.max(item.y1Pt, item.y2Pt),
      };
    case "path": {
      // A path's true ink bounds require resolving each cubic segment's extrema; the hull of its anchor points (moveto, every segment's control points and endpoint) is a safe, cheap over-approximation instead -- ink stays within the control-point hull for a Bezier curve, which errs toward keeping a boundary-straddling path in whichever leaf it visually touches, the right direction for a segmentation pass rather than a rendering one.
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const visit = (x: number, y: number): void => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      };
      for (const subpath of item.subpaths) {
        visit(subpath.startXPt, subpath.startYPt);
        for (const segment of subpath.segments) {
          if (segment.kind === "cubic") {
            visit(segment.c1xPt, segment.c1yPt);
            visit(segment.c2xPt, segment.c2yPt);
          }
          visit(segment.xPt, segment.yPt);
        }
      }
      if (!Number.isFinite(minX)) return undefined; // a path with no subpaths at all
      return { minX, minY, maxX, maxY };
    }
  }
}

interface BoundedItem {
  readonly item: LayoutItem;
  readonly bounds: Bounds;
}

// Segments a PDF page's own items into regions via recursive X-Y cut, then classifies each leaf. Link/internalLink annotations are excluded up front (see layoutItemBounds) -- they carry no painted geometry to segment by, and a caller wanting a page's link rectangles already has them at `page.items` unfiltered.
export function segmentPdfRegions(page: LayoutPage): PdfRegion[] {
  const bounded: BoundedItem[] = [];
  for (const item of page.items) {
    const bounds = layoutItemBounds(item);
    if (bounds !== undefined) bounded.push({ item, bounds });
  }
  if (bounded.length === 0) return [];

  const leaves = recursiveXYCut(bounded, 0);
  const regions = leaves
    .map((leaf): PdfRegion => {
      const bounds = boundingBox(leaf);
      const { classification, confidence } = classifyLeaf(leaf);
      return {
        bounds,
        items: leaf.map((entry) => entry.item),
        classification,
        confidence,
      };
    })
    .sort((a, b) => b.bounds.yPt - a.bounds.yPt || a.bounds.xPt - b.bounds.xPt);

  return attachCaptions(regions);
}

// Recursion depth bound: generous for any realistic page layout (a handful of column gutters nested within a handful of row bands is nowhere near this deep) while guaranteeing termination on pathological input regardless of gap-threshold edge cases.
const MAX_CUT_DEPTH = 16;

// A whitespace gap must be at least this many times the SMALLER of its two neighbouring bands' own representative scale (see itemScale below) before it counts as a structural break. Local and per-gap, not a single global figure: a page mixes fine content (body text at a small font size) with coarse content (a large photo), and the right yardstick for "is this gap structural" is whichever side of the gap is finer-grained -- a caption's own small font size, not the large figure sitting beside it, is what should decide whether a modest caption gap counts as a break; using the figure's own much larger scale would make even a genuine caption gap look insignificant by comparison.
const GAP_RATIO = 1.5;
// A small absolute floor under the ratio-derived threshold, guarding only against a degenerate near-zero scale (e.g. a cluster of single narrow characters or point-like graphics) -- comfortably under a single character's width at any realistic body text size, so it never itself decides a real cut.
const MIN_GAP_FLOOR_PT = 3;

function recursiveXYCut(
  items: readonly BoundedItem[],
  depth: number,
): BoundedItem[][] {
  if (items.length <= 1 || depth >= MAX_CUT_DEPTH) return [[...items]];

  const verticalCut = findCut(items, "x");
  const horizontalCut = findCut(items, "y");

  // Greedy axis choice, standard for recursive X-Y cut: whichever axis has the wider single gap is the more confident structural break (a column gutter is usually wider than inter-paragraph vertical whitespace, and vice versa on a page with tall figures) -- ties and near-ties both still produce a correct, if arbitrarily ordered, partition.
  const chosen =
    verticalCut !== undefined &&
    (horizontalCut === undefined || verticalCut.maxGap >= horizontalCut.maxGap)
      ? verticalCut
      : horizontalCut;
  if (chosen === undefined) return [[...items]];

  return chosen.groups.flatMap((group) =>
    group.length === items.length
      ? [group] // the cut degenerated to a single group (shouldn't happen given >=2 bands, but guards against infinite recursion if it ever does)
      : recursiveXYCut(group, depth + 1),
  );
}

// An item's representative scale for gap-threshold purposes: the SMALLER of its own two axis extents. For a text run this is almost always its font size (a line is normally wider than it is tall), independent of how long the run's text happens to be -- so a whole-line text item and a single-word one contribute the same scale, which is what lets a narrow column gutter register as a structural break even when the lines either side of it are themselves much wider than the gutter. For a graphic item it is whichever of width/height is smaller (a thin rule's own thickness, a squarish photo's shorter side).
function itemScale(bounds: Bounds): number {
  return Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

interface CutResult {
  readonly groups: BoundedItem[][];
  readonly maxGap: number;
}

// A fraction of one band's text lines that must recur, within LINE_TOLERANCE_PT, in every other qualifying band before a candidate vertical cut is rejected as fragmenting a table's own rows rather than genuinely separating independent columns -- a bare majority, not unanimity, since a table's own header or a ragged final row can legitimately miss a match in one column without the rest of the grid ceasing to be one.
const ROW_ALIGNMENT_FRACTION = 0.6;

// A vertical cut whose bands each carry the SAME set of row y-positions is a table's columns, not independent multi-column body text: two genuinely separate flowing-text columns each keep their own paragraph's line rhythm, which is essentially never synchronised row-for-row with an unrelated column beside it, whereas a table's "columns" are by definition the same rows read at different x-positions. Rejecting the cut in that case leaves the whole grid as one leaf, which is what lets classifyLeaf's own per-line cell-counting recognise it as a table at all -- a vertical cut taken eagerly would instead fragment it into as many single-column leaves as the table has columns, each looking like ordinary prose.
function isRowAlignedGrid(bands: readonly BoundedItem[][]): boolean {
  const lineSets = bands.map((band) => {
    const textItems = band
      .map((entry) => entry.item)
      .filter((item) => item.kind === "text");
    return groupIntoLines(textItems).map((line) => line.yPt);
  });
  const withLines = lineSets.filter((lines) => lines.length >= 2);
  if (withLines.length < 2) return false;
  const [first, ...rest] = withLines;
  if (first === undefined || first.length === 0) return false;
  const matches = first.filter((y) =>
    rest.every((lines) =>
      lines.some((other) => Math.abs(other - y) <= LINE_TOLERANCE_PT),
    ),
  );
  return matches.length / first.length >= ROW_ALIGNMENT_FRACTION;
}

// Merges items' intervals on one axis into bands, and -- if two or more bands result -- partitions the items along every gap between consecutive bands that clears its own local, scale-derived threshold. Returns undefined when the axis offers no qualifying cut at all (a single band, every gap too narrow, or -- on the x-axis only -- a row-aligned grid the cut would otherwise fragment).
function findCut(
  items: readonly BoundedItem[],
  axis: "x" | "y",
): CutResult | undefined {
  const minOf = (entry: BoundedItem): number =>
    axis === "x" ? entry.bounds.minX : entry.bounds.minY;
  const maxOf = (entry: BoundedItem): number =>
    axis === "x" ? entry.bounds.maxX : entry.bounds.maxY;
  const sorted = [...items].sort((a, b) => minOf(a) - minOf(b));

  // Merge into bands: a new band starts whenever the next item's min exceeds the running band's max so far.
  const bands: BoundedItem[][] = [];
  let bandMax = Number.NEGATIVE_INFINITY;
  for (const entry of sorted) {
    if (bands.length === 0 || minOf(entry) > bandMax) {
      bands.push([entry]);
    } else {
      const current = bands[bands.length - 1];
      current?.push(entry);
    }
    bandMax = Math.max(bandMax, maxOf(entry));
  }
  if (bands.length < 2) return undefined;
  if (axis === "x" && isRowAlignedGrid(bands)) return undefined;

  const bandStats = bands.map((band) => ({
    min: Math.min(...band.map(minOf)),
    max: Math.max(...band.map(maxOf)),
    scale: median(band.map((entry) => itemScale(entry.bounds))),
  }));

  const groups: BoundedItem[][] = [bands[0] ?? []];
  let maxGap = Number.NEGATIVE_INFINITY;
  let cutSomewhere = false;
  for (let index = 1; index < bands.length; index++) {
    const previous = bandStats[index - 1];
    const current = bandStats[index];
    const band = bands[index];
    if (previous === undefined || current === undefined || band === undefined)
      continue;
    const gap = current.min - previous.max;
    const threshold = Math.max(
      MIN_GAP_FLOOR_PT,
      GAP_RATIO * Math.min(previous.scale, current.scale),
    );
    if (gap >= threshold) {
      groups.push([...band]);
      cutSomewhere = true;
      if (gap > maxGap) maxGap = gap;
    } else {
      const last = groups[groups.length - 1];
      last?.push(...band);
    }
  }
  if (!cutSomewhere) return undefined;
  return { groups, maxGap };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
}

function boundingBox(items: readonly BoundedItem[]): PdfRegionBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { bounds } of items) {
    if (bounds.minX < minX) minX = bounds.minX;
    if (bounds.minY < minY) minY = bounds.minY;
    if (bounds.maxX > maxX) maxX = bounds.maxX;
    if (bounds.maxY > maxY) maxY = bounds.maxY;
  }
  return { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY };
}

// A text baseline cluster: items in one leaf whose vertical anchor (LayoutText.yPt) falls within LINE_TOLERANCE_PT of each other, sorted left to right. Two items on the same visual line rarely share an identical yPt (rounding, mixed font sizes on one baseline), so clustering needs a tolerance rather than an exact match.
const LINE_TOLERANCE_PT = 2;

interface TextLine {
  readonly items: LayoutItem[];
  readonly yPt: number;
}

function groupIntoLines(textItems: readonly LayoutItem[]): TextLine[] {
  const sorted = [...textItems].sort((a, b) => {
    const ay = a.kind === "text" ? a.yPt : 0;
    const by = b.kind === "text" ? b.yPt : 0;
    return by - ay; // top to bottom: PDF y increases upward
  });
  const lines: TextLine[] = [];
  for (const item of sorted) {
    if (item.kind !== "text") continue;
    const last = lines[lines.length - 1];
    if (
      last !== undefined &&
      Math.abs(last.yPt - item.yPt) <= LINE_TOLERANCE_PT
    ) {
      last.items.push(item);
    } else {
      lines.push({ items: [item], yPt: item.yPt });
    }
  }
  for (const line of lines) {
    line.items.sort(
      (a, b) =>
        (a.kind === "text" ? a.xPt : 0) - (b.kind === "text" ? b.xPt : 0),
    );
  }
  return lines;
}

// Within one line, a gap between consecutive text runs wider than this many em (multiples of the runs' own font size) is treated as a cell/column boundary rather than ordinary word spacing -- typical inter-word spacing sits well under one em, so a gap exceeding it is evidence of a deliberately separated column, the same kind of gutter recursiveXYCut looks for at the whole-page scale, just within a single baseline.
const CELL_GAP_EM = 1.2;

// Counts the distinct horizontally-gapped clusters ("cells") on one line -- 1 for an ordinary run of prose, >1 when the line itself contains internal gaps wide enough to be separate table cells or aligned columns.
function cellsInLine(line: TextLine): number {
  let cells = 1;
  for (let index = 1; index < line.items.length; index++) {
    const previous = line.items[index - 1];
    const current = line.items[index];
    if (previous?.kind !== "text" || current?.kind !== "text") continue;
    const previousEnd = previous.xPt + (previous.widthPt ?? 0);
    const gap = current.xPt - previousEnd;
    if (gap > CELL_GAP_EM * current.sizePt) cells++;
  }
  return cells;
}

// A region below this many items carries no structural signal at all, mirroring regions.ts's own MIN_CELLS_FOR_SIGNAL -- one item alone could be a page number, a lone rule, or a stray glyph, and anything beyond 'unknown' here would be guessing.
const MIN_ITEMS_FOR_SIGNAL = 2;
// The score a candidate classification must clear before it is trusted, mirroring regions.ts's SIGNAL_THRESHOLD.
const SIGNAL_THRESHOLD = 0.35;
// How close the top two candidates must be, both already past SIGNAL_THRESHOLD, before the leaf is 'mixed' rather than confidently the top candidate -- mirrors regions.ts's MIXED_MARGIN.
const MIXED_MARGIN = 0.15;

function classifyLeaf(items: readonly BoundedItem[]): {
  classification: RegionClassification;
  confidence: number;
} {
  if (items.length < MIN_ITEMS_FOR_SIGNAL) {
    const only = items[0];
    // A single painted graphic (an image, or a standalone vector shape) is unambiguously a figure on its own -- unlike a lone table cell or a lone word, one photograph is not missing context, it simply IS the whole figure. This is the one exception to "too few items to have a signal": a lone TEXT item genuinely could be anything (a page number, a stray label), which is why that case still falls through to 'unknown' below.
    if (only !== undefined && only.item.kind !== "text") {
      return {
        classification: "figure",
        confidence: only.item.kind === "image" ? 0.9 : 0.6,
      };
    }
    return { classification: "unknown", confidence: 1 };
  }

  const textItems = items
    .map((entry) => entry.item)
    .filter((item) => item.kind === "text");
  const graphicCount = items.length - textItems.length;
  const graphicFraction = graphicCount / items.length;
  const hasImage = items.some((entry) => entry.item.kind === "image");

  const lines = groupIntoLines(textItems);
  const lineCount = lines.length;

  // figure: dominated by non-text painted content (images, vector art) rather than text -- a raster image's presence is a stronger figure signal than vector decoration alone, since a ruled table's grid lines are also non-text but never carry an image.
  const figureScore = clamp01(graphicFraction + (hasImage ? 0.15 : 0));

  let tableScore = 0;
  let columnScore = 0;
  if (lineCount > 1) {
    const cellsPerLine = lines.map(cellsInLine);
    const avgCells = mean(cellsPerLine);
    const cellRegularity = regularity(cellsPerLine);
    const leftStarts = lines.map((line) =>
      line.items[0]?.kind === "text" ? line.items[0].xPt : 0,
    );
    const xStartRegularity = regularity(leftStarts);

    // table: most lines split into multiple cells, and that cell count is consistent line to line -- the geometric signature of a grid, whether or not it is also ruled with visible border graphics.
    const gridGraphicBonus =
      graphicFraction > 0 && graphicFraction < 0.5 ? 0.15 : 0;
    tableScore =
      avgCells > 1.15
        ? clamp01(
            0.5 * clamp01(avgCells - 1) +
              0.35 * cellRegularity +
              gridGraphicBonus,
          )
        : 0;

    // column: lines are each essentially one run (avgCells close to 1) starting from a consistent left edge -- ordinary flowing body text.
    columnScore =
      avgCells <= 1.3
        ? clamp01(0.7 * xStartRegularity + 0.3 * clamp01(2 - avgCells))
        : 0;
  }

  const scored = (
    [
      { kind: "table", score: tableScore },
      { kind: "column", score: columnScore },
      { kind: "figure", score: figureScore },
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

// A short text run is treated as caption-length up to this many characters -- roughly a one-line figure label ("Figure 1: quarterly revenue by region"), not a full paragraph; chosen as a rough sentence-fragment length the same way regions.ts's PROSE_LENGTH_NORM is, not a corpus-fitted constant.
const CAPTION_MAX_CHARS = 160;
// A caption must sit within this many points of the figure it labels, vertically -- comfortably wider than normal line leading (so a caption immediately under a figure still qualifies) but narrow enough that an unrelated block several lines away is never claimed as this figure's caption.
const CAPTION_GAP_PT = 24;

// Second pass: a short text leaf classified 'column' or 'unknown' that sits immediately above or below a 'figure' leaf, and horizontally overlaps it, is a caption -- captions are a RELATIONSHIP to a figure, not a standalone geometric signature, so this can only run after every leaf already has its own first-pass classification.
//
// The relationship is recorded in BOTH directions, which it was not before: the text leaf becomes a
// 'caption' region as it always did, and the figure it labels now carries that text on its own `caption`.
// The pass already had to find which figure a caption belonged to in order to classify it at all, and
// then dropped the answer -- so a consumer wanting a figure's own label had to re-derive the adjacency
// this function had just computed. That matters for the case the field exists to serve: handing a
// figure's region to something that reads it (a vision model, say) is far more useful when the author's
// own caption for that figure comes with it.
function attachCaptions(regions: readonly PdfRegion[]): PdfRegion[] {
  const figures = regions.filter(
    (region) => region.classification === "figure",
  );

  // Figure -> its nearest claiming caption. Nearest, because a figure sandwiched between two short runs
  // has two candidates and only one of them is its label; the same gap that decides the caption's own
  // confidence decides which figure wins it.
  //
  // On an exact tie the run ABOVE the figure wins, because `regions` arrives sorted top-to-bottom (the
  // descending-yPt sort where the leaves are built) and the comparison below is strict. That is the less
  // conventional answer for a figure label, so it is stated here rather than left to be inferred from a
  // sort two hundred lines away, and a test pins it. The same strictness means a run equidistant from
  // two figures is claimed by the upper one.
  //
  // The two views deliberately do not agree on counts, and a consumer should not assume they do: BOTH
  // runs in a sandwich are reclassified 'caption' (behaviour this pass already had), while only one
  // figure carries text. The loser is a 'caption' region that labels nothing.
  const captionFor = new Map<PdfRegion, { text: string; gap: number }>();
  // Caption candidate -> the gap to the figure it claims. Only the gap is kept: which figure won is
  // recorded on the figure's own side, in `captionFor`.
  const claimed = new Map<PdfRegion, number>();

  for (const region of regions) {
    if (
      region.classification !== "column" &&
      region.classification !== "unknown"
    ) {
      continue;
    }
    const text = regionText(region);
    if (text.length === 0 || text.length > CAPTION_MAX_CHARS) continue;

    let nearest: PdfRegion | undefined;
    let nearestGap = Number.POSITIVE_INFINITY;
    for (const figure of figures) {
      if (!horizontallyOverlaps(region.bounds, figure.bounds)) continue;
      const gap = verticalGap(region.bounds, figure.bounds);
      if (gap !== undefined && gap <= CAPTION_GAP_PT && gap < nearestGap) {
        nearest = figure;
        nearestGap = gap;
      }
    }
    if (nearest === undefined) continue;

    claimed.set(region, nearestGap);
    const existing = captionFor.get(nearest);
    if (existing === undefined || nearestGap < existing.gap) {
      captionFor.set(nearest, { text, gap: nearestGap });
    }
  }

  return regions.map((region) => {
    const gap = claimed.get(region);
    if (gap !== undefined) {
      return {
        ...region,
        classification: "caption" as const,
        confidence: clamp01(1 - gap / CAPTION_GAP_PT),
      };
    }
    const caption = captionFor.get(region);
    return caption === undefined
      ? region
      : { ...region, caption: caption.text };
  });
}

// A region's own text content, joined and trimmed. Non-text items contribute nothing.
function regionText(region: PdfRegion): string {
  return region.items
    .map((item) => (item.kind === "text" ? item.text : ""))
    .join(" ")
    .trim();
}

function horizontallyOverlaps(a: PdfRegionBounds, b: PdfRegionBounds): boolean {
  return a.xPt < b.xPt + b.widthPt && b.xPt < a.xPt + a.widthPt;
}

// The vertical whitespace between two bounds when they are stacked with no overlap, or undefined when they overlap on the y-axis (a caption is beside, not inside, its figure).
function verticalGap(
  a: PdfRegionBounds,
  b: PdfRegionBounds,
): number | undefined {
  const aBottom = a.yPt;
  const aTop = a.yPt + a.heightPt;
  const bBottom = b.yPt;
  const bTop = b.yPt + b.heightPt;
  if (aBottom >= bTop) return aBottom - bTop;
  if (bBottom >= aTop) return bBottom - aTop;
  return undefined;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// A coefficient-of-variation-style uniformity score, identical in shape to regions.ts's rowRegularity: 1 for a constant sequence, decaying toward 0 as the spread grows relative to the mean. A single-value sequence is trivially regular.
function regularity(values: readonly number[]): number {
  if (values.length <= 1) return 1;
  const average = mean(values);
  if (average === 0) return values.every((value) => value === 0) ? 1 : 0;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  return clamp01(1 - Math.sqrt(variance) / Math.abs(average));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
