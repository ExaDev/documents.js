import type {
  ContentBlock,
  ContentDrawPage,
  ContentParagraph,
  ContentPathPoint,
  ContentRun,
  ContentSection,
  ContentShape,
  ContentSlide,
  ContentSubpath,
  ContentVector,
  LayoutDocument,
  LayoutEllipse,
  LayoutImage,
  LayoutImageAsset,
  LayoutLine,
  LayoutPage,
  LayoutPath,
  LayoutRect,
  LayoutSubpath,
  LayoutText,
} from 'document-content-model';
import { STANDARD_METRICS } from '../pdf/afm-widths';
import { resolveStandardFont } from '../pdf/fonts';
import type { Box, Margins } from '../model/geometry';
import { flipY } from '../model/geometry';
import type { ContentDocument } from '../model/content';
import { CONTENT_FORMAT_VERSION } from '../model/content';
import type { Alignment } from '../model/style';
import { throwIfAborted } from '../ports/abort';

export interface ReconstructOptions {
  readonly signal?: AbortSignal;
}

// LayoutDocument -> ContentDocument: PDF has no semantic paragraph/shape structure, just positioned glyphs and images, so both directions here are necessarily best-effort reconstructions from geometry -- this is the plan's most explicit fidelity trade-off, not a bug to be perfected later. Every threshold below is either the exact value the implementation plan specifies (cited inline) or a documented, deliberately bounded heuristic.

const ZERO_MARGINS: Margins = { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 };

// --- Shared: cluster positioned text into lines, then measure per-item vertical extent from real AFM ascent/descent (not a generic guess -- afm-widths.ts already carries verified per-face metrics from the same data the write path itself uses). ---

interface TextLine {
  readonly items: readonly LayoutText[]; // left-to-right
  readonly baselineY: number;
}

// Baseline-proximity tolerance of 0.5x font size -- wide enough to catch superscripts into their own line, tight enough to never merge two genuinely separate lines (plan Step 10).
const LINE_BASELINE_TOLERANCE_FACTOR = 0.5;

function clusterIntoLines(items: readonly LayoutText[]): TextLine[] {
  const sorted = [...items].sort((a, b) => b.yPt - a.yPt || a.xPt - b.xPt);
  const working: { items: LayoutText[]; baselineY: number }[] = [];
  for (const item of sorted) {
    const tolerance = LINE_BASELINE_TOLERANCE_FACTOR * item.sizePt;
    const line = working.find((l) => Math.abs(l.baselineY - item.yPt) <= tolerance);
    if (line === undefined) {
      working.push({ items: [item], baselineY: item.yPt });
    } else {
      line.items.push(item);
    }
  }
  for (const line of working) {
    line.items.sort((a, b) => a.xPt - b.xPt);
  }
  working.sort((a, b) => b.baselineY - a.baselineY);
  return working;
}

function textItemVerticalExtent(item: LayoutText): { ascentPt: number; descentPt: number } {
  const { standardName } = resolveStandardFont(item.font.family, item.font.weight === 'bold', item.font.style === 'italic');
  const metrics = STANDARD_METRICS[standardName];
  return { ascentPt: (metrics.ascender / 1000) * item.sizePt, descentPt: (Math.abs(metrics.descender) / 1000) * item.sizePt };
}

function textItemToContentRun(item: LayoutText): ContentRun {
  return {
    text: item.text,
    bold: item.font.weight === 'bold' ? true : undefined,
    italic: item.font.style === 'italic' ? true : undefined,
    fontFamily: item.font.family,
    sizePt: item.sizePt,
    color: item.color,
  };
}

// A small absolute floor (not font-size-relative) below which two adjacent items are treated as directly continuing the same word (e.g. a bold/italic sub-run split mid-word) rather than separate words needing a space -- guards against float-rounding noise producing a spurious tiny positive gap.
const MIN_WORD_GAP_PT = 0.5;

// Appends ContentRuns for one line's items, inserting the word-space or tab a caller reading the reconstructed text needs between them: PDF text extraction carries no literal space characters between separately-shown words (interpret.ts's word-wrapping and per-item positioning use xOffsetPt, not embedded spaces), so a positive gap between consecutive items must be turned back into an actual space (or, when it's large enough to read as tabbed/columnar content, a tab) rather than silently concatenating adjacent words together.
function pushRunsForLine(runs: ContentRun[], line: TextLine): void {
  line.items.forEach((item, itemIndex) => {
    if (itemIndex > 0) {
      const prevItem = line.items[itemIndex - 1]!;
      const gap = item.xPt - (prevItem.xPt + (prevItem.widthPt ?? 0));
      if (gap > LARGE_GAP_EM_MULTIPLIER * item.sizePt) {
        runs.push({ text: '\t' });
      } else if (gap > MIN_WORD_GAP_PT) {
        runs[runs.length - 1]!.text += ' ';
      }
    }
    runs.push(textItemToContentRun(item));
  });
}

function bucketCounts(values: readonly number[], bucketSize: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const v of values) {
    const bucket = Math.round(v / bucketSize) * bucketSize;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return counts;
}

function modeOf(values: readonly number[], bucketSize: number): number {
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

// A "mode" with no actual repetition (every gap in the sample distinct) isn't a meaningful modal line spacing -- with all counts tied at 1, modeOf would just return whichever bucket happened to be inserted first, which is arbitrary. The smallest observed gap is a more defensible "this counts as normal line spacing" baseline in that case, since a paragraph or section break is by definition larger than ordinary single-line spacing, never smaller.
function modalLineGap(gaps: readonly number[]): number {
  const counts = bucketCounts(gaps, 0.5);
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

// A horizontal gap exceeding 2 em within a line reads as tabbed/columnar content, not natural word spacing (plan Step 10, both the docx tab-insertion rule and the pptx same-line block split).
const LARGE_GAP_EM_MULTIPLIER = 2;

// A vertical gap exceeding 1.25x the page's own modal line spacing reads as a paragraph break in docx, or as leaving one pptx text block for another (plan Step 10) -- the same underlying "is this still the same flow of text" signal in both directions, so both reuse this one constant.
const PARAGRAPH_GAP_MULTIPLIER = 1.25;

// A typical single-line leading ratio (matching the general range of afm-widths.ts's own per-face lineHeightEm values, 1.133-1.150), used as the "normal spacing" baseline when there are too few lines on the page to derive a meaningful mode from their own gaps.
const NOMINAL_LINE_SPACING_RATIO = 1.2;
// Below this many lines, the mode of the observed gaps is not a meaningful sample -- with exactly one gap, it trivially equals its own mode, so nothing could ever be classified as "larger than normal" no matter how large the gap actually is (the failure this guards against: two isolated, widely-separated lines being merged into one paragraph because the single gap between them "is" the modal spacing by definition).
const MIN_LINES_FOR_GAP_MODE = 3;

function estimateModalLineSpacing(lines: readonly TextLine[]): number {
  if (lines.length < MIN_LINES_FOR_GAP_MODE) {
    const dominantSizePt = modeOf(lines.map((l) => l.items[0]!.sizePt), 0.5);
    return dominantSizePt * NOMINAL_LINE_SPACING_RATIO;
  }
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(lines[i - 1]!.baselineY - lines[i]!.baselineY);
  }
  return modalLineGap(gaps);
}

// ---------------------------------------------------------------------------
// PDF -> docx (wordprocessing): line clustering, then paragraph clustering.
// ---------------------------------------------------------------------------

export function reconstructWordprocessing(doc: LayoutDocument, options?: ReconstructOptions): ContentDocument {
  const signal = options?.signal;
  const sections: ContentSection[] = [];
  let currentGroup: LayoutPage[] = [];
  for (const page of doc.pages) {
    throwIfAborted(signal);
    if (currentGroup.length > 0 && !samePageSize(currentGroup[0]!, page)) {
      sections.push(buildSection(currentGroup, doc.images));
      currentGroup = [];
    }
    currentGroup.push(page);
  }
  if (currentGroup.length > 0) {
    sections.push(buildSection(currentGroup, doc.images));
  }
  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: doc.metadata, sections };
}

function samePageSize(a: LayoutPage, b: LayoutPage): boolean {
  return a.widthPt === b.widthPt && a.heightPt === b.heightPt;
}

// Margins have no PDF equivalent to recover -- there is no principled way to distinguish "intentional margin" from "wherever the content happened to start" from geometry alone, so this deliberately reports zero rather than fabricating a plausible-looking value (ZERO_MARGINS, defined above).
function buildSection(pages: readonly LayoutPage[], images: Record<string, LayoutImageAsset>): ContentSection {
  const blocks: ContentBlock[] = [];
  pages.forEach((page, i) => {
    if (i > 0) {
      blocks.push({ kind: 'pageBreak' });
    }
    blocks.push(...reconstructPageBlocks(page, images));
  });
  return { pageSize: { widthPt: pages[0]!.widthPt, heightPt: pages[0]!.heightPt }, margins: ZERO_MARGINS, blocks };
}

function reconstructPageBlocks(page: LayoutPage, images: Record<string, LayoutImageAsset>): ContentBlock[] {
  const textItems = page.items.filter((i): i is LayoutText => i.kind === 'text');
  const imageItems = page.items.filter((i): i is LayoutImage => i.kind === 'image');
  const lines = clusterIntoLines(textItems);
  const paragraphs = clusterIntoParagraphs(lines);

  const positioned: { yPt: number; block: ContentBlock }[] = [];
  for (const paragraph of paragraphs) {
    positioned.push({ yPt: paragraph.lines[0]!.baselineY, block: paragraphToContentParagraph(paragraph) });
  }
  for (const img of imageItems) {
    const asset = images[img.imageId];
    if (asset !== undefined) {
      positioned.push({ yPt: img.yPt, block: { kind: 'image', format: asset.format, base64: asset.base64, widthPt: img.widthPt, heightPt: img.heightPt } });
    }
  }
  positioned.sort((a, b) => b.yPt - a.yPt);
  return positioned.map((p) => p.block);
}

interface TextParagraph {
  readonly lines: TextLine[];
}

function clusterIntoParagraphs(lines: readonly TextLine[]): TextParagraph[] {
  if (lines.length === 0) {
    return [];
  }
  const modalSpacing = estimateModalLineSpacing(lines);
  const dominantLeftX = modeOf(lines.map((l) => l.items[0]!.xPt), 1);

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

// Two of the plan's four break signals (vertical gap, indent change) are implemented directly. The other two (alignment classification changing, a justified block's short final line) need first classifying each line's own alignment from its right-margin distance -- a real additional analysis this pass doesn't attempt; gap and indent already catch the large majority of real paragraph boundaries.
function startsNewParagraph(prev: TextLine, next: TextLine, modalSpacing: number, dominantLeftX: number): boolean {
  const gap = prev.baselineY - next.baselineY;
  if (gap > PARAGRAPH_GAP_MULTIPLIER * modalSpacing) {
    return true;
  }
  const nextLeft = next.items[0]!.xPt;
  const prevLeft = prev.items[0]!.xPt;
  const emPt = next.items[0]!.sizePt;
  const nextIndented = Math.abs(nextLeft - dominantLeftX) > emPt;
  const prevAtMargin = Math.abs(prevLeft - dominantLeftX) <= emPt;
  return nextIndented && prevAtMargin;
}

const LEFT_ALIGN_TOLERANCE_PT = 2;

function paragraphToContentParagraph(paragraph: TextParagraph): ContentParagraph {
  const dominantLeftX = modeOf(paragraph.lines.map((l) => l.items[0]!.xPt), 1);
  const alignment: Alignment | undefined = paragraph.lines.every((l) => Math.abs(l.items[0]!.xPt - dominantLeftX) <= LEFT_ALIGN_TOLERANCE_PT) ? 'left' : undefined;

  const runs: ContentRun[] = [];
  paragraph.lines.forEach((line, lineIndex) => {
    // Lines within a paragraph join with a single space -- deliberately not de-hyphenating a trailing hyphen, since the "looks like a soft hyphen" heuristic corrupts genuine hyphenated compounds about as often as it fixes wrapped words (plan Step 10).
    if (lineIndex > 0) {
      const lastRun = runs[runs.length - 1];
      if (lastRun !== undefined) {
        lastRun.text += ' ';
      }
    }
    pushRunsForLine(runs, line);
  });

  return { kind: 'paragraph', runs, alignment };
}

// ---------------------------------------------------------------------------
// PDF -> pptx (presentation): page = slide, cluster text into blocks.
// ---------------------------------------------------------------------------

export function reconstructPresentation(doc: LayoutDocument, options?: ReconstructOptions): ContentDocument {
  const signal = options?.signal;
  const slides = doc.pages.map((page) => {
    throwIfAborted(signal);
    return reconstructSlide(page, doc.images);
  });
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: doc.metadata, slides };
}

function reconstructSlide(page: LayoutPage, images: Record<string, LayoutImageAsset>): ContentSlide {
  const textItems = page.items.filter((i): i is LayoutText => i.kind === 'text');
  const imageItems = page.items.filter((i): i is LayoutImage => i.kind === 'image');

  const lines = clusterIntoLines(textItems);
  const blocks = clusterIntoBlocks(lines);
  const textShapes = blocks.map((block) => blockToShape(block, page.heightPt));
  const imageShapes: ContentShape[] = [];
  for (const img of imageItems) {
    const shape = imageToShape(img, page.heightPt, images);
    if (shape !== undefined) {
      imageShapes.push(shape);
    }
  }

  // Images before text shapes in z-order (plan Step 10). notes recovers LayoutPage's own private page-dictionary entry (see pdf/write.ts/read.ts) when the source PDF was produced by this package's own pptxToPdf -- absent (falls back to '') for a PDF from any other producer, since nothing else would ever write it.
  return { size: { widthPt: page.widthPt, heightPt: page.heightPt }, shapes: [...imageShapes, ...textShapes], notes: page.notes ?? '' };
}

interface TextBlock {
  readonly lines: TextLine[];
}

function splitLineByLargeGaps(line: TextLine): TextLine[] {
  const segments: TextLine[] = [];
  let current: LayoutText[] = [];
  line.items.forEach((item, i) => {
    if (i > 0) {
      const prev = line.items[i - 1]!;
      const gap = item.xPt - (prev.xPt + (prev.widthPt ?? 0));
      if (gap > LARGE_GAP_EM_MULTIPLIER * item.sizePt) {
        segments.push({ items: current, baselineY: line.baselineY });
        current = [];
      }
    }
    current.push(item);
  });
  if (current.length > 0) {
    segments.push({ items: current, baselineY: line.baselineY });
  }
  return segments;
}

const FONT_SIZE_CLOSE_TOLERANCE_PT = 1;
const FONT_SIZE_CLOSE_TOLERANCE_RATIO = 0.15;

function fontSizesClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= FONT_SIZE_CLOSE_TOLERANCE_PT || Math.abs(a - b) / Math.max(a, b) <= FONT_SIZE_CLOSE_TOLERANCE_RATIO;
}

// Consecutive lines merge into one text block when their left edges align, the baseline gap still looks like ordinary single-line spacing (not a paragraph-sized jump -- reusing PARAGRAPH_GAP_MULTIPLIER, the same "still the same flow" signal the docx path uses), and their dominant font sizes are close (plan Step 10). Each merged line keeps its own ContentParagraph within the shape, rather than being joined into one paragraph the way docx lines are -- pptx text boxes commonly hold several genuinely distinct short paragraphs (list items, separate sentences), and there is no reliable signal from geometry alone for whether two stacked lines were one wrapped paragraph or two.
function clusterIntoBlocks(pageLines: readonly TextLine[]): TextBlock[] {
  const segments = pageLines.flatMap(splitLineByLargeGaps);
  const blocks: TextBlock[] = [];
  for (const segment of segments) {
    const leftX = segment.items[0]!.xPt;
    const sizePt = segment.items[0]!.sizePt;
    const matched = blocks.find((block) => {
      const lastLine = block.lines[block.lines.length - 1]!;
      const lastLeftX = lastLine.items[0]!.xPt;
      const lastSizePt = lastLine.items[0]!.sizePt;
      const gap = lastLine.baselineY - segment.baselineY;
      if (gap <= 0) {
        return false; // only extend downward, in reading order
      }
      const leftAligned = Math.abs(leftX - lastLeftX) <= LEFT_ALIGN_TOLERANCE_PT;
      return leftAligned && fontSizesClose(sizePt, lastSizePt) && gap <= PARAGRAPH_GAP_MULTIPLIER * lastSizePt;
    });
    if (matched !== undefined) {
      matched.lines.push(segment);
    } else {
      blocks.push({ lines: [segment] });
    }
  }
  return blocks;
}

function computeBlockFrame(block: TextBlock, slideHeightPt: number): Box {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const line of block.lines) {
    for (const item of line.items) {
      const { ascentPt, descentPt } = textItemVerticalExtent(item);
      minX = Math.min(minX, item.xPt);
      maxX = Math.max(maxX, item.xPt + (item.widthPt ?? 0));
      minY = Math.min(minY, item.yPt - descentPt);
      maxY = Math.max(maxY, item.yPt + ascentPt);
    }
  }
  return flipY({ xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY }, slideHeightPt);
}

function lineToParagraph(line: TextLine): ContentParagraph {
  const runs: ContentRun[] = [];
  pushRunsForLine(runs, line);
  return { kind: 'paragraph', runs };
}

function blockToShape(block: TextBlock, slideHeightPt: number): ContentShape {
  return {
    frame: computeBlockFrame(block, slideHeightPt),
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: block.lines.map(lineToParagraph),
  };
}

// The inverse of content-write.ts's own placement convention: LayoutImage.rotationDeg is counter-clockwise-positive (matrix.ts's convention, via matrixRotationDegrees), while ContentShape.rotationDeg is clockwise (DrawingML's a:xfrm/@rot convention) -- negated here, the one place PDF-space image rotation crosses into OOXML-space.
function imageToShape(img: LayoutImage, slideHeightPt: number, images: Record<string, LayoutImageAsset>): ContentShape | undefined {
  const asset = images[img.imageId];
  if (asset === undefined) {
    return undefined;
  }
  const frame = flipY({ xPt: img.xPt, yPt: img.yPt, widthPt: img.widthPt, heightPt: img.heightPt }, slideHeightPt);
  return {
    frame,
    rotationDeg: img.rotationDeg !== undefined ? -img.rotationDeg : undefined,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [{ kind: 'image', format: asset.format, base64: asset.base64, widthPt: img.widthPt, heightPt: img.heightPt }],
  };
}

// ---------------------------------------------------------------------------
// PDF -> odg (drawing): deliberately more tractable than reconstructWordprocessing/reconstructPresentation above, because a drawing has no semantic structure to infer at all -- no baseline clustering, no paragraph inference. Every painted LayoutItem maps close to 1:1 back onto an ODF construct, in the same z-order (array position) it was painted.
// ---------------------------------------------------------------------------

export function reconstructDrawing(doc: LayoutDocument, options?: ReconstructOptions): ContentDocument {
  const signal = options?.signal;
  const pages: ContentDrawPage[] = doc.pages.map((page) => {
    throwIfAborted(signal);
    return reconstructDrawPage(page, doc.images);
  });
  return { kind: 'drawing', formatVersion: CONTENT_FORMAT_VERSION, metadata: doc.metadata, pages };
}

// ContentDrawPageSchema keeps shapes and vectors as two independently paint-ordered arrays with no field recording their relative order -- the same documented gap drawing.ts's own convertDrawingToLayout resolves one way (vectors always paint before shapes) when going the other direction. reconstructDrawPage resolves it in reverse identically: walk page.items in original paint order once, bucketing each item into whichever array its own kind belongs to, so each array keeps the relative order its own items appeared in overall. A page built by convertDrawingToLayout itself (vectors-then-shapes, by construction) round-trips its own paint order exactly this way; a LayoutDocument from any other producer gets the same bucketing, the only ordering ContentDrawPageSchema's own shape is able to express at all. 'link' items have no drawing-page equivalent and are dropped, matching reconstructPageBlocks/reconstructSlide's own existing precedent above of ignoring link items entirely.
function reconstructDrawPage(page: LayoutPage, images: Record<string, LayoutImageAsset>): ContentDrawPage {
  const vectors: ContentVector[] = [];
  const shapes: ContentShape[] = [];
  for (const item of page.items) {
    if (item.kind === 'rect') {
      vectors.push(layoutRectToVector(item, page.heightPt));
    } else if (item.kind === 'ellipse') {
      vectors.push(layoutEllipseToVector(item, page.heightPt));
    } else if (item.kind === 'line') {
      vectors.push(layoutLineToVector(item, page.heightPt));
    } else if (item.kind === 'path') {
      vectors.push(layoutPathToVector(item, page.heightPt));
    } else if (item.kind === 'text') {
      shapes.push(layoutTextToShape(item, page.heightPt));
    } else if (item.kind === 'image') {
      const shape = imageToShape(item, page.heightPt, images);
      if (shape !== undefined) {
        shapes.push(shape);
      }
    }
  }
  return { size: { widthPt: page.widthPt, heightPt: page.heightPt }, shapes, vectors };
}

// The exact inverse of drawing.ts's own convertRectVector/convertEllipseVector: flipY is its own exact inverse (see model/geometry.ts's own doc comment), so re-flipping a LayoutRect/LayoutEllipse's bottom-left/y-up box recovers the identical top-left/y-down frame convertDrawingToLayout started from.
function layoutRectToVector(item: LayoutRect, pageHeightPt: number): ContentVector {
  const frame = flipY({ xPt: item.xPt, yPt: item.yPt, widthPt: item.widthPt, heightPt: item.heightPt }, pageHeightPt);
  return { kind: 'rect', frame, fill: item.fill, stroke: item.stroke, sourcePath: item.sourcePath };
}

function layoutEllipseToVector(item: LayoutEllipse, pageHeightPt: number): ContentVector {
  const frame = flipY({ xPt: item.xPt, yPt: item.yPt, widthPt: item.widthPt, heightPt: item.heightPt }, pageHeightPt);
  return { kind: 'ellipse', frame, fill: item.fill, stroke: item.stroke, sourcePath: item.sourcePath };
}

// The exact inverse of drawing.ts's own convertLineVector: a bare point flip (pageHeightPt - yPt), not a box flip, since a line's two endpoints carry no independent width/height to preserve.
function layoutLineToVector(item: LayoutLine, pageHeightPt: number): ContentVector {
  return {
    kind: 'line',
    from: { xPt: item.x1Pt, yPt: pageHeightPt - item.y1Pt },
    to: { xPt: item.x2Pt, yPt: pageHeightPt - item.y2Pt },
    stroke: { color: item.color, widthPt: item.widthPt },
    sourcePath: item.sourcePath,
  };
}

interface PathPointRef {
  readonly xPt: number;
  readonly yPt: number;
}

function collectPathPoints(subpaths: readonly LayoutSubpath[]): PathPointRef[] {
  const points: PathPointRef[] = [];
  for (const subpath of subpaths) {
    points.push({ xPt: subpath.startXPt, yPt: subpath.startYPt });
    for (const segment of subpath.segments) {
      if (segment.kind === 'cubic') {
        points.push({ xPt: segment.c1xPt, yPt: segment.c1yPt });
        points.push({ xPt: segment.c2xPt, yPt: segment.c2yPt });
      }
      points.push({ xPt: segment.xPt, yPt: segment.yPt });
    }
  }
  return points;
}

// Unlike a rect/ellipse/line item, a LayoutPath carries no frame of its own -- drawing.ts's own convertPathVector resolves each point through the ORIGINAL ContentVector frame, information a PDF's recovered geometry no longer carries at all. The frame reconstructed here is instead the tight bounding box of every point in the path, including cubic control points, not just line/curve endpoints: a cubic Bezier curve is guaranteed to lie within the convex hull of its four control points, so including them guarantees the frame fully contains the rendered curve rather than clipping it. A cubic segment's own control points are never on the curve itself, so this frame is not necessarily identical to whatever frame the path originally had in a hand-authored ODF file -- it is the tightest one derivable from the recovered geometry alone, an honest, bounded reconstruction choice rather than an attempt at exactly recovering an original frame that no longer exists anywhere in a PDF's own geometry.
function pathBoundingFrame(points: readonly PathPointRef[], pageHeightPt: number): Box {
  if (points.length === 0) {
    return { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minYDown = Number.POSITIVE_INFINITY;
  let maxYDown = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const yDown = pageHeightPt - point.yPt;
    minX = Math.min(minX, point.xPt);
    maxX = Math.max(maxX, point.xPt);
    minYDown = Math.min(minYDown, yDown);
    maxYDown = Math.max(maxYDown, yDown);
  }
  return { xPt: minX, yPt: minYDown, widthPt: maxX - minX, heightPt: maxYDown - minYDown };
}

// The exact inverse of drawing.ts's own placePathPoint (frame.xPt + point.xPt, pageHeightPt - frame.yPt - point.yPt): solved for point.xPt/point.yPt given an absolute PDF-space point and the frame computed above.
function localizePathPoint(frame: Box, point: PathPointRef, pageHeightPt: number): ContentPathPoint {
  return { xPt: point.xPt - frame.xPt, yPt: pageHeightPt - frame.yPt - point.yPt };
}

function layoutPathToVector(item: LayoutPath, pageHeightPt: number): ContentVector {
  const points = collectPathPoints(item.subpaths);
  const frame = pathBoundingFrame(points, pageHeightPt);
  const subpaths: ContentSubpath[] = item.subpaths.map((subpath) => ({
    start: localizePathPoint(frame, { xPt: subpath.startXPt, yPt: subpath.startYPt }, pageHeightPt),
    closed: subpath.closed,
    segments: subpath.segments.map((segment) => {
      if (segment.kind === 'line') {
        return { kind: 'line' as const, to: localizePathPoint(frame, { xPt: segment.xPt, yPt: segment.yPt }, pageHeightPt) };
      }
      return {
        kind: 'cubic' as const,
        control1: localizePathPoint(frame, { xPt: segment.c1xPt, yPt: segment.c1yPt }, pageHeightPt),
        control2: localizePathPoint(frame, { xPt: segment.c2xPt, yPt: segment.c2yPt }, pageHeightPt),
        to: localizePathPoint(frame, { xPt: segment.xPt, yPt: segment.yPt }, pageHeightPt),
      };
    }),
  }));
  return { kind: 'path', frame, subpaths, fill: item.fill, fillRule: item.fillRule, stroke: item.stroke, sourcePath: item.sourcePath };
}

// A single LayoutText item maps to exactly one ContentShape holding one single-run paragraph -- reuses computeBlockFrame/textItemToContentRun verbatim rather than inventing a second frame-estimation approach (the same real AFM ascent/descent math reconstructPresentation's own blockToShape already uses above, degenerating correctly to a one-line, one-item block). Unlike blockToShape (which can merge several LayoutText items into one block and therefore cannot assign a single rotation to the merged result), this mapping is genuinely 1:1, so item.rotationDeg carries straight across, negated -- the same LayoutImage counter-clockwise -> ContentShape clockwise convention imageToShape already applies below.
function layoutTextToShape(item: LayoutText, pageHeightPt: number): ContentShape {
  const frame = computeBlockFrame({ lines: [{ items: [item], baselineY: item.yPt }] }, pageHeightPt);
  return {
    frame,
    rotationDeg: item.rotationDeg !== undefined ? -item.rotationDeg : undefined,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [{ kind: 'paragraph', runs: [textItemToContentRun(item)] }],
  };
}
