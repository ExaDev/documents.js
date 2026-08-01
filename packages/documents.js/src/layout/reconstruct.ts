import type {
  ContentBlock,
  ContentDrawPage,
  ContentParagraph,
  ContentPathPoint,
  ContentRun,
  ContentSection,
  ContentShape,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetPrintSettings,
  ContentSheetRow,
  ContentSlide,
  ContentSubpath,
  ContentVector,
  LayoutDocument,
  LayoutEllipse,
  LayoutImage,
  LayoutImageAsset,
  LayoutItem,
  LayoutLine,
  LayoutPage,
  LayoutPath,
  LayoutRect,
  LayoutSubpath,
  LayoutText,
} from 'document-content-model';
import { resolveStandardFont, STANDARD_METRICS } from 'pdf-codec';
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

// ---------------------------------------------------------------------------
// PDF -> ods (spreadsheet): recovers what was printed, not what was entered. Every recovered cell is a bare string carrying only its own extracted displayText -- never re-parsed into a number/date/boolean, never claimed as a formula, matching this module's own consistent "geometry in, no semantic invention" discipline throughout. Two detection paths, tried in this order per page: (1) a real gridline lattice -- a genuine printed spreadsheet with gridlines enabled draws exactly this, see layout/sheets.ts's own renderGridlines -- is used DIRECTLY as cell boundaries, no inference needed; (2) absent a lattice, text is clustered into a grid from geometry alone, reusing this module's own clusterIntoLines for rows (a spreadsheet cell's own text is never wrapped across lines -- sheets.ts's own module doc -- so a text line already IS a row) and a parallel x-position recurrence clustering for columns, generalizing clusterIntoParagraphs's own single dominantLeftX to several recurring column anchors. Column widths, row heights, and a sheet's own page size are all genuinely MEASURED from recovered geometry, never invented; there is no attempt to recover print INTENT (range/scale/repeat-rows) that a rendered page carries no trace of at all.
// ---------------------------------------------------------------------------

// --- Path 1: gridline lattice detection -----------------------------------------------------------

interface LineSegment {
  readonly x1Pt: number;
  readonly y1Pt: number;
  readonly x2Pt: number;
  readonly y2Pt: number;
}

// A gridline written by this package's own convertSpreadsheetToLayout (src/layout/sheets.ts's renderGridlines) survives a real PDF round trip as a generic LayoutPath, not a LayoutLine: pdf-codec's writeLine (content-write.ts) writes an m/l/S sequence that reads back through pdf-codec's own interpret.ts's general path tracking as a single-subpath, single-line-segment, stroke-only LayoutPath -- readPdf never reconstructs a 'line' kind item at all (a pre-existing, already-documented gap; see the README's own interpret.ts gotcha). Both shapes are accepted here so a hand-built LayoutDocument using genuine LayoutLine items (this module's own test fixtures, or a LayoutDocument from a producer other than readPdf) and a real PDF-round-tripped LayoutDocument both detect identically.
function extractLineCandidates(items: readonly LayoutItem[]): LineSegment[] {
  const segments: LineSegment[] = [];
  for (const item of items) {
    if (item.kind === 'line') {
      segments.push({ x1Pt: item.x1Pt, y1Pt: item.y1Pt, x2Pt: item.x2Pt, y2Pt: item.y2Pt });
      continue;
    }
    if (item.kind === 'path' && item.stroke !== undefined && item.subpaths.length === 1) {
      const subpath = item.subpaths[0]!;
      if (subpath.segments.length === 1 && subpath.segments[0]!.kind === 'line') {
        const segment = subpath.segments[0]!;
        segments.push({ x1Pt: subpath.startXPt, y1Pt: subpath.startYPt, x2Pt: segment.xPt, y2Pt: segment.yPt });
      }
    }
  }
  return segments;
}

// Tolerance for treating a segment as exactly horizontal/vertical -- generous enough to absorb the sub-point rounding a real PDF content-stream number format (4 decimal places, pdf-codec's serialize.ts) introduces on a round trip, tight enough that a genuinely diagonal line (a chart axis, a decorative rule) is never misread as a gridline.
const AXIS_ALIGNMENT_TOLERANCE_PT = 0.5;

// A stray tick mark or cell-border fragment is not evidence of a page-spanning gridline lattice -- only a segment at least this long is considered a lattice candidate at all.
const MIN_GRIDLINE_LENGTH_PT = 4;

interface AxisLine {
  readonly position: number; // y for a horizontal candidate, x for a vertical one
  readonly spanPt: number; // the segment's own length along its own axis
}

function classifyAxisLine(seg: LineSegment): ({ readonly axis: 'horizontal' | 'vertical' } & AxisLine) | undefined {
  const dx = Math.abs(seg.x2Pt - seg.x1Pt);
  const dy = Math.abs(seg.y2Pt - seg.y1Pt);
  if (dy <= AXIS_ALIGNMENT_TOLERANCE_PT && dx >= MIN_GRIDLINE_LENGTH_PT) {
    return { axis: 'horizontal', position: (seg.y1Pt + seg.y2Pt) / 2, spanPt: dx };
  }
  if (dx <= AXIS_ALIGNMENT_TOLERANCE_PT && dy >= MIN_GRIDLINE_LENGTH_PT) {
    return { axis: 'vertical', position: (seg.x1Pt + seg.x2Pt) / 2, spanPt: dy };
  }
  return undefined;
}

// Positions within this of each other are the same drawn boundary, not two distinct ones -- generous enough to absorb the same sub-point PDF rounding AXIS_ALIGNMENT_TOLERANCE_PT above already accounts for.
const POSITION_DEDUPE_TOLERANCE_PT = 0.5;

// Merges near-duplicate positions (keeping the largest observed span for each -- generous, never lossy) and sorts them: descending for rows (PDF y grows upward, so the FIRST row boundary is the largest y, i.e. the top of the grid), ascending for columns (left to right).
function dedupeAxisLines(lines: readonly AxisLine[], descending: boolean): AxisLine[] {
  const sorted = [...lines].sort((a, b) => (descending ? b.position - a.position : a.position - b.position));
  const result: { position: number; spanPt: number }[] = [];
  for (const candidate of sorted) {
    const last = result[result.length - 1];
    if (last !== undefined && Math.abs(candidate.position - last.position) <= POSITION_DEDUPE_TOLERANCE_PT) {
      last.spanPt = Math.max(last.spanPt, candidate.spanPt);
    } else {
      result.push({ position: candidate.position, spanPt: candidate.spanPt });
    }
  }
  return result;
}

// At least 2 bounded rows/columns (3 boundary lines) before this counts as a lattice at all -- fewer is a page border or a couple of decorative rules, not a printed grid.
const MIN_GRIDLINE_COUNT_PER_AXIS = 3;

// A genuine gridline lattice draws every line the identical full grid width/height (layout/sheets.ts's own renderGridlines) -- so requiring most lines on an axis to reach close to that axis's own longest observed span is what actually distinguishes "these lines form a grid" from "these are just a few horizontal and vertical strokes that happen to coexist on the page" (a chart axis, an unrelated table border, a couple of decorative rules). 0.9 is generous enough to tolerate the sub-point rounding a real round trip introduces while still rejecting a scatter of unrelated short strokes.
const GRID_SPAN_CONSISTENCY_RATIO = 0.9;

function isRegularLattice(lines: readonly AxisLine[]): boolean {
  if (lines.length < MIN_GRIDLINE_COUNT_PER_AXIS) {
    return false;
  }
  const maxSpanPt = Math.max(...lines.map((l) => l.spanPt));
  const consistentCount = lines.filter((l) => l.spanPt >= maxSpanPt * GRID_SPAN_CONSISTENCY_RATIO).length;
  return consistentCount >= MIN_GRIDLINE_COUNT_PER_AXIS;
}

interface GridLattice {
  readonly rowBoundariesDescPt: readonly number[]; // top-to-bottom, PDF y descending
  readonly columnBoundariesAscPt: readonly number[]; // left-to-right, PDF x ascending
}

function detectGridLattice(items: readonly LayoutItem[]): GridLattice | undefined {
  const horizontal: AxisLine[] = [];
  const vertical: AxisLine[] = [];
  for (const seg of extractLineCandidates(items)) {
    const classified = classifyAxisLine(seg);
    if (classified === undefined) {
      continue;
    }
    (classified.axis === 'horizontal' ? horizontal : vertical).push(classified);
  }
  const rowBoundaries = dedupeAxisLines(horizontal, true);
  const columnBoundaries = dedupeAxisLines(vertical, false);
  if (!isRegularLattice(rowBoundaries) || !isRegularLattice(columnBoundaries)) {
    return undefined;
  }
  return { rowBoundariesDescPt: rowBoundaries.map((l) => l.position), columnBoundariesAscPt: columnBoundaries.map((l) => l.position) };
}

// Only the OUTER edge of the whole lattice gets any tolerance -- generous enough to keep an item sitting just past the grid's own outermost boundary (sub-point PDF-round-trip rounding) inside it. An INTERIOR boundary gets none at all: giving one would open an ambiguous zone straddling two adjacent bands (a real, caught bug -- a column narrow enough that CELL_TEXT_PADDING_PT-scale tolerance on both sides of its own shared boundary let a neighbouring column's own text match the WRONG band first). A cell's own text sits comfortably away from its own band's far edge under ordinary conditions (near the bottom of its own row, near the left of its own column, per sheets.ts's own vertical-bottom alignment and per-cell inset), so a bare half-open partition at every interior boundary is both correct and unambiguous.
const OUTER_EDGE_TOLERANCE_PT = 3;

function findRowIndex(rowBoundariesDescPt: readonly number[], yPt: number): number | undefined {
  const lastIndex = rowBoundariesDescPt.length - 1;
  if (yPt > rowBoundariesDescPt[0]! + OUTER_EDGE_TOLERANCE_PT || yPt < rowBoundariesDescPt[lastIndex]! - OUTER_EDGE_TOLERANCE_PT) {
    return undefined;
  }
  for (let i = 0; i < lastIndex; i++) {
    if (yPt > rowBoundariesDescPt[i + 1]!) {
      return i;
    }
  }
  return lastIndex - 1;
}

function findColumnIndex(columnBoundariesAscPt: readonly number[], xPt: number): number | undefined {
  const lastIndex = columnBoundariesAscPt.length - 1;
  if (xPt < columnBoundariesAscPt[0]! - OUTER_EDGE_TOLERANCE_PT || xPt > columnBoundariesAscPt[lastIndex]! + OUTER_EDGE_TOLERANCE_PT) {
    return undefined;
  }
  for (let j = 0; j < lastIndex; j++) {
    if (xPt < columnBoundariesAscPt[j + 1]!) {
      return j;
    }
  }
  return lastIndex - 1;
}

// --- Shared: joining several LayoutText items already known to belong to one recovered cell, and turning row/column groups into ContentSheetCell[] -----

// Reuses this module's own MIN_WORD_GAP_PT threshold (defined above for paragraph/line text) to decide whether consecutive items need a space between them, but never inserts a tab the way pushRunsForLine does: a tab reads as columnar structure WITHIN a line of prose, which is meaningless once the grid itself has already resolved the column structure.
function joinCellText(items: readonly LayoutText[]): string {
  const sorted = [...items].sort((a, b) => a.xPt - b.xPt);
  let text = '';
  sorted.forEach((item, i) => {
    if (i > 0) {
      const prev = sorted[i - 1]!;
      const gap = item.xPt - (prev.xPt + (prev.widthPt ?? 0));
      if (gap > MIN_WORD_GAP_PT) {
        text += ' ';
      }
    }
    text += item.text;
  });
  return text;
}

function groupKey(row: number, column: number): string {
  return `${row},${column}`;
}

function addToGroup(groups: Map<string, LayoutText[]>, row: number, column: number, item: LayoutText): void {
  const key = groupKey(row, column);
  const existing = groups.get(key);
  if (existing === undefined) {
    groups.set(key, [item]);
  } else {
    existing.push(item);
  }
}

// Every recovered cell is a bare string carrying only its own displayText -- see this section's own top-of-block note. A (row, column) position with no text assigned to it at all is simply never emitted, matching the sparse cell model buildOdsPackage's own appendCell already expects.
function buildCellsFromGroups(groups: ReadonlyMap<string, readonly LayoutText[]>): ContentSheetCell[] {
  const cells: ContentSheetCell[] = [];
  for (const [key, items] of groups) {
    const displayText = joinCellText(items);
    if (displayText.length === 0) {
      continue;
    }
    const [rowPart, columnPart] = key.split(',');
    cells.push({ row: Number(rowPart), column: Number(columnPart), value: { kind: 'string', value: displayText }, displayText });
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column);
  return cells;
}

interface ReconstructedGrid {
  readonly cells: ContentSheetCell[];
  readonly columns: ContentSheetColumn[];
  readonly rows: ContentSheetRow[];
  readonly gridlines: boolean;
}

// The gridline positions ARE the cell boundaries -- column/row widths are the exact, genuinely measured gap between consecutive drawn lines, not estimated from text at all.
function buildGridFromLattice(textItems: readonly LayoutText[], lattice: GridLattice): ReconstructedGrid {
  const groups = new Map<string, LayoutText[]>();
  for (const item of textItems) {
    const row = findRowIndex(lattice.rowBoundariesDescPt, item.yPt);
    const column = findColumnIndex(lattice.columnBoundariesAscPt, item.xPt);
    if (row === undefined || column === undefined) {
      continue; // outside the detected grid entirely -- a header-gutter row/column label, a title above the sheet, and so on.
    }
    addToGroup(groups, row, column, item);
  }
  const columns: ContentSheetColumn[] = [];
  for (let j = 0; j < lattice.columnBoundariesAscPt.length - 1; j++) {
    columns.push({ index: j, widthPt: lattice.columnBoundariesAscPt[j + 1]! - lattice.columnBoundariesAscPt[j]! });
  }
  const rows: ContentSheetRow[] = [];
  for (let i = 0; i < lattice.rowBoundariesDescPt.length - 1; i++) {
    rows.push({ index: i, heightPt: lattice.rowBoundariesDescPt[i]! - lattice.rowBoundariesDescPt[i + 1]! });
  }
  return { cells: buildCellsFromGroups(groups), columns, rows, gridlines: true };
}

// --- Path 2: text-position clustering, no gridlines present -----------------------------------------------------------

// Column x-position tolerance for treating two items across different rows as belonging to the same recovered column -- generous enough to absorb ordinary alignment jitter, tight enough not to merge two genuinely adjacent narrow columns. Reused as bucketCounts' own bucket size, the same recurring-position technique clusterIntoParagraphs's own dominantLeftX already uses for a single margin, generalized here to several.
const COLUMN_ALIGNMENT_TOLERANCE_PT = 3;

// A recurring x-position must be seen on at least this many distinct rows before it counts as a real column, not a one-off item at a stray x position (a title, a footnote) -- the same "recurring left margin, not a one-off indent" reasoning clusterIntoParagraphs already applies to a single dominant margin.
const MIN_COLUMN_RECURRENCE = 2;

// Nothing recurred across rows at all (a single-row page, or genuinely unique text at every position) falls back to every distinct position found, so a sparse or single-row page still resolves to a sensible (if narrower) grid rather than an empty one. Takes one anchor x-position per SEGMENT (see splitLineByLargeGaps below), not per raw LayoutText item -- a single cell's own text can legitimately arrive as several directly adjacent items (a run-level style change mid-cell), and clustering on their individual x-positions would scatter one cell's own fragments across several spurious columns instead of treating them as the one candidate they are.
function detectColumnPositions(segmentsByLine: readonly (readonly TextLine[])[]): number[] {
  const allXs = segmentsByLine.flatMap((segments) => segments.map((segment) => segment.items[0]!.xPt));
  if (allXs.length === 0) {
    return [];
  }
  const counts = bucketCounts(allXs, COLUMN_ALIGNMENT_TOLERANCE_PT);
  const recurring = [...counts.entries()].filter(([, count]) => count >= MIN_COLUMN_RECURRENCE).map(([bucket]) => bucket);
  const positions = recurring.length > 0 ? recurring : [...counts.keys()];
  positions.sort((a, b) => a - b);
  return positions;
}

function nearestColumnIndex(positions: readonly number[], xPt: number): number {
  let bestIndex = 0;
  let bestDistancePt = Number.POSITIVE_INFINITY;
  positions.forEach((position, index) => {
    const distancePt = Math.abs(position - xPt);
    if (distancePt < bestDistancePt) {
      bestDistancePt = distancePt;
      bestIndex = index;
    }
  });
  return bestIndex;
}

// A modest, deliberately nominal fallback for the rare edge case where even the widest measured text extent in the last recovered column is zero (e.g. a LayoutText item carrying no widthPt at all) -- not claimed as a real recovered value, just enough to keep the resulting ContentSheetColumn structurally sane.
const DEFAULT_COLUMN_WIDTH_FALLBACK_PT = 40;

// The last recovered column has no following anchor to measure a gap against, unlike every other column, whose width is the genuinely measured distance to the next anchor. Falls back to the widest actually-measured text extent within that column (anchor to the item's own right edge) -- still a real geometric measurement, never an invented default.
function lastColumnWidthPt(groups: ReadonlyMap<string, readonly LayoutText[]>, columnIndex: number, anchorXPt: number): number {
  let maxWidthPt = 0;
  for (const [key, items] of groups) {
    const [, columnPart] = key.split(',');
    if (Number(columnPart) !== columnIndex) {
      continue;
    }
    for (const item of items) {
      maxWidthPt = Math.max(maxWidthPt, item.xPt + (item.widthPt ?? 0) - anchorXPt);
    }
  }
  return maxWidthPt > 0 ? maxWidthPt : DEFAULT_COLUMN_WIDTH_FALLBACK_PT;
}

// Rows reuse clusterIntoLines directly -- a spreadsheet cell's own text is never wrapped across lines (sheets.ts's own module doc), so a text line already IS a row, with no separate row-clustering pass needed. Each line is then split into segments wherever a large horizontal gap occurs, reusing splitLineByLargeGaps verbatim -- the same >2em-gap signal reconstructPresentation's own block clustering already uses to tell "still one cluster of text" from "a new one" -- since a single cell's own text can arrive as several directly adjacent LayoutText fragments (a run-level style change mid-cell) that must be treated as one cell candidate, not several. Row heights are the genuinely measured baseline-to-baseline gap to the next row; the last row (no following baseline to measure against) falls back to this page's own modal line spacing, the same already-justified estimateModalLineSpacing this module uses for paragraph/block clustering above.
function buildGridFromTextClustering(textItems: readonly LayoutText[]): ReconstructedGrid {
  const lines = clusterIntoLines(textItems);
  if (lines.length === 0) {
    return { cells: [], columns: [], rows: [], gridlines: false };
  }
  const segmentsByLine = lines.map((l) => splitLineByLargeGaps(l));
  const columnPositions = detectColumnPositions(segmentsByLine);
  const groups = new Map<string, LayoutText[]>();
  segmentsByLine.forEach((segments, rowIndex) => {
    for (const segment of segments) {
      const columnIndex = nearestColumnIndex(columnPositions, segment.items[0]!.xPt);
      const key = groupKey(rowIndex, columnIndex);
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, [...segment.items]);
      } else {
        existing.push(...segment.items);
      }
    }
  });

  const nominalRowHeightPt = estimateModalLineSpacing(lines);
  const rows: ContentSheetRow[] = lines.map((line, i) => {
    const nextBaselineY = lines[i + 1]?.baselineY;
    const heightPt = nextBaselineY !== undefined ? line.baselineY - nextBaselineY : nominalRowHeightPt;
    return { index: i, heightPt: heightPt > 0 ? heightPt : nominalRowHeightPt };
  });

  const columns: ContentSheetColumn[] = columnPositions.map((position, j) => {
    const nextPosition = columnPositions[j + 1];
    return { index: j, widthPt: nextPosition !== undefined ? nextPosition - position : lastColumnWidthPt(groups, j, position) };
  });

  return { cells: buildCellsFromGroups(groups), columns, rows, gridlines: false };
}

// --- Orchestration: one ContentSheet per PDF page -----------------------------------------------------------

// A PDF page carries no sheet name, and no trace of whether the source spreadsheet's own column/row banding split one sheet across several printed pages -- there is no principled way to re-merge pages back into fewer sheets from geometry alone, so this maps one page to one sheet, exactly as reconstructPresentation maps one page to one slide.
function reconstructSheet(page: LayoutPage, pageIndex: number): ContentSheet {
  const textItems = page.items.filter((i): i is LayoutText => i.kind === 'text');
  const lattice = detectGridLattice(page.items);
  const grid = lattice !== undefined ? buildGridFromLattice(textItems, lattice) : buildGridFromTextClustering(textItems);

  // Margins have no PDF equivalent to recover, mirroring buildSection's own ZERO_MARGINS reasoning above. gridlines reflects whichever detection path actually ran; headers is always false -- a header-gutter row-number/column-letter label has no reliable geometric signal distinguishing it from an ordinary short cell, so this makes no attempt to detect one (any such label sitting outside the detected grid lattice is simply dropped by findRowIndex/findColumnIndex returning undefined for it, rather than being misread as real cell content). No print range/scale/fit-to-page/repeat-rows/repeat-columns/manual-breaks assumption is made at all -- a rendered page carries no trace of print INTENT, only what was visually printed.
  const printSettings: ContentSheetPrintSettings = {
    pageSize: { widthPt: page.widthPt, heightPt: page.heightPt },
    margins: ZERO_MARGINS,
    gridlines: grid.gridlines,
    headers: false,
    pageOrder: 'downThenOver',
  };

  return { name: `Sheet${pageIndex + 1}`, cells: grid.cells, columns: grid.columns, rows: grid.rows, images: [], printSettings };
}

export function reconstructSpreadsheet(doc: LayoutDocument, options?: ReconstructOptions): ContentDocument {
  const signal = options?.signal;
  const sheets: ContentSheet[] = doc.pages.map((page, index) => {
    throwIfAborted(signal);
    return reconstructSheet(page, index);
  });
  return { kind: 'spreadsheet', formatVersion: CONTENT_FORMAT_VERSION, metadata: doc.metadata, sheets };
}
