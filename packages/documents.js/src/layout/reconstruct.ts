import { STANDARD_METRICS } from '../pdf/afm-widths';
import { resolveStandardFont } from '../pdf/fonts';
import type { Box, Margins } from '../model/geometry';
import { flipY } from '../model/geometry';
import type { ContentBlock, ContentDocument, ContentParagraph, ContentRun, ContentSection, ContentShape, ContentSlide } from '../model/content';
import { CONTENT_FORMAT_VERSION } from '../model/content';
import type { LayoutDocument, LayoutImage, LayoutImageAsset, LayoutPage, LayoutText } from '../model/layout';
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
    line.items.forEach((item, itemIndex) => {
      if (itemIndex > 0) {
        const prevItem = line.items[itemIndex - 1]!;
        const gap = item.xPt - (prevItem.xPt + (prevItem.widthPt ?? 0));
        if (gap > LARGE_GAP_EM_MULTIPLIER * item.sizePt) {
          runs.push({ text: '\t' });
        }
      }
      runs.push(textItemToContentRun(item));
    });
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

  // Images before text shapes in z-order (plan Step 10).
  return { size: { widthPt: page.widthPt, heightPt: page.heightPt }, shapes: [...imageShapes, ...textShapes], notes: '' };
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
  return { kind: 'paragraph', runs: line.items.map(textItemToContentRun) };
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
