import type {
  ContentBlock,
  ContentDocument,
  ContentDrawPage,
  ContentEmbeddedObjectBlock,
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
  ContentTable,
  ContentTableCell,
  ContentTableRow,
  ContentVector,
  LayoutFrame,
} from 'document-schema.js';

// Deep-imported from pdf-codec's asset-free read-side modules rather than its root barrel: the reconstruction path is part of this package's read-only graph (documents.js/read), and the barrel's write half would drag the vendored font assets into it. See src/read-graph.test.ts.
import { resolveStandardFont } from 'pdf-codec/fonts';
import { STANDARD_METRICS } from 'pdf-codec/afm-widths';
import type { LayoutDocument, LayoutEllipse, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLine, LayoutPage, LayoutPath, LayoutRect, LayoutSubpath, LayoutText } from 'pdf-codec';
import { buildDrawingBlock } from '../model/embedded-drawing';
import type { Box, Margins } from 'document-schema.js';
import { flipY } from '../model/geometry';
import type { Alignment } from 'document-schema.js';
import { throwIfAborted } from '../ports/abort';
import { stampFrame } from './shared';
import type { CellTypeInference, CellTypeInferenceSink } from './cell-typing';
import { inferCellValue } from './cell-typing';
import type { GridLattice } from './lattice';
import { detectGridLattice, findColumnIndex, findRowIndex } from './lattice';

export interface ReconstructOptions {
  readonly signal?: AbortSignal;
  // Called once per recovered spreadsheet cell whose rendered text was either RE-TYPED away from a plain string or deliberately DECLINED as too ambiguous to re-type -- reconstructSpreadsheet's own audit trail for a step that is, unavoidably, probabilistic. See src/layout/cell-typing.ts for the confidence bar each outcome is decided against. Cells whose text is not number/date/boolean-shaped at all are not reported: there was no inference to make, so there is nothing to audit.
  readonly onCellTypeInference?: CellTypeInferenceSink;
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

// The PDF-space box one recovered text item occupied -- the exact frame stamped onto the ContentRun node rebuilt from it (and, aggregated over a line's items, onto the paragraph that line became). Uses the same real AFM ascent/descent metrics textItemVerticalExtent derives, so a run's own frame matches the geometry its source glyph run was rendered with.
function textBoxOfItem(item: LayoutText, pageIndex: number): LayoutFrame {
  const { ascentPt, descentPt } = textItemVerticalExtent(item);
  return { pageIndex, xPt: item.xPt, yPt: item.yPt - descentPt, widthPt: item.widthPt ?? 0, heightPt: ascentPt + descentPt };
}

// The PDF-space bounding box of a whole clustered line -- the frame stamped onto the ContentParagraph a line (or a one-line block) became.
function lineBox(line: TextLine, pageIndex: number): LayoutFrame {
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
  return { pageIndex, xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY };
}

// Appends ContentRuns for one line's items, inserting the word-space or tab a caller reading the reconstructed text needs between them: PDF text extraction carries no literal space characters between separately-shown words (interpret.ts's word-wrapping and per-item positioning use xOffsetPt, not embedded spaces), so a positive gap between consecutive items must be turned back into an actual space (or, when it's large enough to read as tabbed/columnar content, a tab) rather than silently concatenating adjacent words together.
// pageIndex threads through so every run rebuilt from an item carries that item's own rendered position as its frame -- the PDF->X half of the frames fusion, where each reconstructed node's frames are exactly the items it was clustered from (sourcePath survives on items as traceability only).
function pushRunsForLine(runs: ContentRun[], line: TextLine, pageIndex: number): void {
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
    const run = textItemToContentRun(item);
    stampFrame(run, pageIndex, textBoxOfItem(item, pageIndex));
    runs.push(run);
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
  let groupStartPageIndex = 0;
  for (const page of doc.pages) {
    throwIfAborted(signal);
    if (currentGroup.length > 0 && !samePageSize(currentGroup[0]!, page)) {
      sections.push(buildSection(currentGroup, groupStartPageIndex, doc.images));
      groupStartPageIndex += currentGroup.length;
      currentGroup = [];
    }
    currentGroup.push(page);
  }
  if (currentGroup.length > 0) {
    sections.push(buildSection(currentGroup, groupStartPageIndex, doc.images));
  }
  return { kind: 'wordprocessing', metadata: doc.metadata, sections };
}

function samePageSize(a: LayoutPage, b: LayoutPage): boolean {
  return a.widthPt === b.widthPt && a.heightPt === b.heightPt;
}

// Margins have no PDF equivalent to recover -- there is no principled way to distinguish "intentional margin" from "wherever the content happened to start" from geometry alone, so this deliberately reports zero rather than fabricating a plausible-looking value (ZERO_MARGINS, defined above).
// startPageIndex is this section's own first page's absolute index in the whole LayoutDocument -- a frame's pageIndex names a page of the SOURCE document, not a page within one section, so every block this section builds stamps absolute indices derived from it.
function buildSection(pages: readonly LayoutPage[], startPageIndex: number, images: Record<string, LayoutImageAsset>): ContentSection {
  const blocks: ContentBlock[] = [];
  pages.forEach((page, i) => {
    if (i > 0) {
      blocks.push({ kind: 'pageBreak' });
    }
    blocks.push(...reconstructPageBlocks(page, startPageIndex + i, images));
  });
  return { pageSize: { widthPt: pages[0]!.widthPt, heightPt: pages[0]!.heightPt }, margins: ZERO_MARGINS, blocks };
}

// Table recovery runs FIRST, because it decides what is left for everything after it: text inside a recovered lattice belongs to the table, not to the page's paragraph flow, and the lattice's own strokes belong to the table's structure, not to the recovered vector content. Both recoveries are no-ops on a page without the geometry to support them, so a text-only page produces exactly the blocks it always did. See the shared recovery section below for the full reasoning behind each gate.
function reconstructPageBlocks(page: LayoutPage, pageIndex: number, images: Record<string, LayoutImageAsset>): ContentBlock[] {
  const recoveredTable = recoverTable(page, pageIndex);
  const consumedText = recoveredTable?.consumedText;
  const textItems = page.items.filter((i): i is LayoutText => i.kind === 'text' && consumedText?.has(i) !== true);
  const imageItems = page.items.filter((i): i is LayoutImage => i.kind === 'image');
  const lines = clusterIntoLines(textItems);
  const paragraphs = clusterIntoParagraphs(lines);

  const positioned: { yPt: number; block: ContentBlock }[] = [];
  for (const paragraph of paragraphs) {
    positioned.push({ yPt: paragraph.lines[0]!.baselineY, block: paragraphToContentParagraph(paragraph, pageIndex) });
  }
  for (const img of imageItems) {
    const asset = images[img.imageId];
    if (asset !== undefined) {
      const block: ContentBlock = { kind: 'image', format: asset.format, base64: asset.base64, widthPt: img.widthPt, heightPt: img.heightPt };
      stampFrame(block, pageIndex, { xPt: img.xPt, yPt: img.yPt, widthPt: img.widthPt, heightPt: img.heightPt });
      positioned.push({ yPt: img.yPt, block });
    }
  }
  if (recoveredTable !== undefined) {
    positioned.push({ yPt: recoveredTable.topYPt, block: recoveredTable.table });
  }
  const recoveredVectors = recoverPageVectors(page, pageIndex, recoveredTable?.latticeItems ?? NO_ITEMS);
  if (recoveredVectors !== undefined) {
    positioned.push({ yPt: recoveredVectors.topYPt, block: recoveredVectors.block });
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

// Two of the plan's four break signals (vertical gap, indent change) are implemented directly, plus the font-size discontinuity below. The other two (alignment classification changing, a justified block's short final line) need first classifying each line's own alignment from its right-margin distance -- a real additional analysis this pass doesn't attempt; gap and indent already catch the large majority of real paragraph boundaries.
function startsNewParagraph(prev: TextLine, next: TextLine, modalSpacing: number, dominantLeftX: number): boolean {
  const gap = prev.baselineY - next.baselineY;
  if (gap > PARAGRAPH_GAP_MULTIPLIER * modalSpacing) {
    return true;
  }
  // A font-size discontinuity is a paragraph boundary even at ordinary line spacing: a heading sits tight above the body it names, so the gap signal alone merges the two into one glued paragraph (the observed "**Part 1 Scope **This is body..." failure, ExaDev/documents.js#584), and the same discontinuity is what the presentation direction's own clusterIntoBlocks already refuses to merge across -- its fontSizesClose condition -- so this brings the two clusterers onto one rule rather than inventing a new one.
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

const LEFT_ALIGN_TOLERANCE_PT = 2;

function paragraphToContentParagraph(paragraph: TextParagraph, pageIndex: number): ContentParagraph {
  const dominantLeftX = modeOf(paragraph.lines.map((l) => l.items[0]!.xPt), 1);
  const alignment: Alignment | undefined = paragraph.lines.every((l) => Math.abs(l.items[0]!.xPt - dominantLeftX) <= LEFT_ALIGN_TOLERANCE_PT) ? 'left' : undefined;

  const result: ContentParagraph = { kind: 'paragraph', runs: [], alignment };
  paragraph.lines.forEach((line, lineIndex) => {
    // One frame per clustered line, stamped on the paragraph node itself -- the paragraph's own rendered placements, aggregated from exactly the items it was clustered from (the runs inside carry their own finer-grained frames via pushRunsForLine).
    stampFrame(result, pageIndex, lineBox(line, pageIndex));
    // Lines within a paragraph join with a single space -- deliberately not de-hyphenating a trailing hyphen, since the "looks like a soft hyphen" heuristic corrupts genuine hyphenated compounds about as often as it fixes wrapped words (plan Step 10).
    if (lineIndex > 0) {
      const lastRun = result.runs[result.runs.length - 1];
      if (lastRun !== undefined) {
        lastRun.text += ' ';
      }
    }
    pushRunsForLine(result.runs, line, pageIndex);
  });

  return result;
}

// ---------------------------------------------------------------------------
// PDF -> pptx (presentation): page = slide, cluster text into blocks.
// ---------------------------------------------------------------------------

export function reconstructPresentation(doc: LayoutDocument, options?: ReconstructOptions): ContentDocument {
  const signal = options?.signal;
  const slides = doc.pages.map((page, pageIndex) => {
    throwIfAborted(signal);
    return reconstructSlide(page, pageIndex, doc.images);
  });
  return { kind: 'presentation', metadata: doc.metadata, slides };
}

// Table and vector recovery run here on exactly the same terms as in reconstructPageBlocks above -- same detector, same gates, same exclusions -- differing only in the container each result has to be wrapped in: a slide holds nothing but ContentShapes, so a recovered table and a recovered drawing each become a shape framed at the geometry they were recovered from, rather than a bare block placed in a flow.
function reconstructSlide(page: LayoutPage, pageIndex: number, images: Record<string, LayoutImageAsset>): ContentSlide {
  const recoveredTable = recoverTable(page, pageIndex);
  const consumedText = recoveredTable?.consumedText;
  const textItems = page.items.filter((i): i is LayoutText => i.kind === 'text' && consumedText?.has(i) !== true);
  const imageItems = page.items.filter((i): i is LayoutImage => i.kind === 'image');

  const lines = clusterIntoLines(textItems);
  const blocks = clusterIntoBlocks(lines);
  const textShapes = blocks.map((block) => blockToShape(block, page.heightPt, pageIndex));
  const imageShapes: ContentShape[] = [];
  for (const img of imageItems) {
    const shape = imageToShape(img, page.heightPt, pageIndex, images);
    if (shape !== undefined) {
      imageShapes.push(shape);
    }
  }
  const recoveredVectors = recoverPageVectors(page, pageIndex, recoveredTable?.latticeItems ?? NO_ITEMS);
  // Vectors paint behind everything else, matching src/layout/drawing.ts's own documented vectors-then-shapes fallback for a page whose true interleaving is unknown -- and it is unknown here for the same reason: a slide's shapes array carries no ordering field relating it to content recovered outside it.
  const vectorShapes: ContentShape[] = recoveredVectors === undefined ? [] : [wrapBlockInShape(recoveredVectors.block, { xPt: 0, yPt: 0, widthPt: page.widthPt, heightPt: page.heightPt }, page.heightPt, pageIndex)];
  const tableShapes: ContentShape[] = recoveredTable === undefined ? [] : [wrapBlockInShape(recoveredTable.table, recoveredTable.frame, page.heightPt, pageIndex)];

  // Images before text shapes in z-order (plan Step 10). notes recovers LayoutPage's own private page-dictionary entry (see pdf/write.ts/read.ts) when the source PDF was produced by this package's own pptxToPdf -- absent (falls back to '') for a PDF from any other producer, since nothing else would ever write it.
  return { size: { widthPt: page.widthPt, heightPt: page.heightPt }, shapes: [...vectorShapes, ...imageShapes, ...tableShapes, ...textShapes], notes: page.notes ?? '' };
}

// A single recovered block as its own containing shape, with the zero insets and no rotation every other shape this module produces already uses -- a slide has no container for a bare block, and a table or a drawing recovered from a page is exactly one block. The wrapper shape's frame records where the wrapped content sat (frame arrives y-down; the stamped frame is its PDF-space flip).
function wrapBlockInShape(block: ContentBlock, frame: Box, pageHeightPt: number, pageIndex: number): ContentShape {
  const shape: ContentShape = { frame, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, blocks: [block] };
  stampFrame(shape, pageIndex, flipY(frame, pageHeightPt));
  return shape;
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

function lineToParagraph(line: TextLine, pageIndex: number): ContentParagraph {
  const paragraph: ContentParagraph = { kind: 'paragraph', runs: [] };
  stampFrame(paragraph, pageIndex, lineBox(line, pageIndex));
  pushRunsForLine(paragraph.runs, line, pageIndex);
  return paragraph;
}

// A recovered text block's own shape frame is stamped from the PDF-space bounding box of exactly the items clustered into it -- computeBlockFrame returns that same box flipped into top-left/y-down space for the shape's own frame field, so the stamp records the pre-flip original.
function blockToShape(block: TextBlock, slideHeightPt: number, pageIndex: number): ContentShape {
  const shape: ContentShape = {
    frame: computeBlockFrame(block, slideHeightPt),
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: block.lines.map((line) => lineToParagraph(line, pageIndex)),
  };
  stampFrame(shape, pageIndex, flipY(shape.frame, slideHeightPt));
  return shape;
}

// The inverse of content-write.ts's own placement convention: LayoutImage.rotationDeg is counter-clockwise-positive (matrix.ts's convention, via matrixRotationDegrees), while ContentShape.rotationDeg is clockwise (DrawingML's a:xfrm/@rot convention) -- negated here, the one place PDF-space image rotation crosses into OOXML-space.
function imageToShape(img: LayoutImage, slideHeightPt: number, pageIndex: number, images: Record<string, LayoutImageAsset>): ContentShape | undefined {
  const asset = images[img.imageId];
  if (asset === undefined) {
    return undefined;
  }
  const frame = flipY({ xPt: img.xPt, yPt: img.yPt, widthPt: img.widthPt, heightPt: img.heightPt }, slideHeightPt);
  const block: ContentBlock = { kind: 'image', format: asset.format, base64: asset.base64, widthPt: img.widthPt, heightPt: img.heightPt };
  stampFrame(block, pageIndex, { xPt: img.xPt, yPt: img.yPt, widthPt: img.widthPt, heightPt: img.heightPt });
  const shape: ContentShape = {
    frame,
    rotationDeg: img.rotationDeg !== undefined ? -img.rotationDeg : undefined,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [block],
  };
  stampFrame(shape, pageIndex, { xPt: img.xPt, yPt: img.yPt, widthPt: img.widthPt, heightPt: img.heightPt });
  return shape;
}

// ---------------------------------------------------------------------------
// PDF -> odg (drawing): deliberately more tractable than reconstructWordprocessing/reconstructPresentation above, because a drawing has no semantic structure to infer at all -- no baseline clustering, no paragraph inference. Every painted LayoutItem maps close to 1:1 back onto an ODF construct, in the same z-order (array position) it was painted.
// ---------------------------------------------------------------------------

export function reconstructDrawing(doc: LayoutDocument, options?: ReconstructOptions): ContentDocument {
  const signal = options?.signal;
  const pages: ContentDrawPage[] = doc.pages.map((page, pageIndex) => {
    throwIfAborted(signal);
    return reconstructDrawPage(page, pageIndex, doc.images);
  });
  return { kind: 'drawing', metadata: doc.metadata, pages };
}

// ContentDrawPageSchema still keeps shapes and vectors as two separate arrays, but both ContentVector and ContentShape carry a shared `paintOrder` recording their true relative position -- the field drawing.ts's own convertDrawingToLayout merges by when going the other direction. reconstructDrawPage produces exactly that field here: it already walked page.items once in real paint order (a LayoutPage's items ARE its paint order, front-to-back by array position) and bucketed each into whichever array its own kind belongs to, so recording the walk position as it goes is all that is needed for the relative order between the two arrays to survive at all. A page that genuinely interleaves the two consequently round-trips its interleaving exactly, rather than collapsing to all-vectors-then-all-shapes the way it had to before the schema carried the field. 'link' items have no drawing-page equivalent and are dropped, matching reconstructPageBlocks/reconstructSlide's own existing precedent above of ignoring link items entirely -- a dropped item consumes no paintOrder slot either, so the stamped values stay a dense 0..n-1 run over what was actually recovered.
function reconstructDrawPage(page: LayoutPage, pageIndex: number, images: Record<string, LayoutImageAsset>): ContentDrawPage {
  const vectors: ContentVector[] = [];
  const shapes: ContentShape[] = [];
  let paintOrder = 0;
  for (const item of page.items) {
    const vector = layoutItemToVector(item, page.heightPt);
    if (vector !== undefined) {
      stampVectorFrame(vector, item, pageIndex);
      vectors.push({ ...vector, paintOrder: paintOrder++ });
      continue;
    }
    if (item.kind === 'text') {
      const shape = layoutTextToShape(item, page.heightPt, pageIndex);
      stampFrame(shape, pageIndex, flipY(shape.frame, page.heightPt));
      shapes.push({ ...shape, paintOrder: paintOrder++ });
    } else if (item.kind === 'image') {
      const shape = imageToShape(item, page.heightPt, pageIndex, images);
      if (shape !== undefined) {
        shapes.push({ ...shape, paintOrder: paintOrder++ });
      }
    }
  }
  return { size: { widthPt: page.widthPt, heightPt: page.heightPt }, shapes, vectors };
}

// Stamps a recovered vector's frame from the exact item it was recovered from -- the PDF-space box that item painted, so the vector node carries its own rendered position exactly the way an engine-laid-out vector does. Rect/ellipse items carry their own box; a line's is the bounding box of its two endpoints; a path's is the tight hull of every point including cubic controls (collectPathPoints, the same hull rule pathBoundingFrame documents).
function stampVectorFrame(vector: ContentVector, item: LayoutItem, pageIndex: number): void {
  if (item.kind === 'rect' || item.kind === 'ellipse') {
    stampFrame(vector, pageIndex, { xPt: item.xPt, yPt: item.yPt, widthPt: item.widthPt, heightPt: item.heightPt });
    return;
  }
  if (item.kind === 'line') {
    stampFrame(vector, pageIndex, { xPt: Math.min(item.x1Pt, item.x2Pt), yPt: Math.min(item.y1Pt, item.y2Pt), widthPt: Math.abs(item.x2Pt - item.x1Pt), heightPt: Math.abs(item.y2Pt - item.y1Pt) });
    return;
  }
  if (item.kind !== 'path') {
    return; // unreachable from both call sites, which invoke this only once layoutItemToVector proved the item is a vector kind -- the guard exists solely to narrow item to LayoutPath for collectPathPoints.
  }
  const points = collectPathPoints(item.subpaths);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.xPt);
    maxX = Math.max(maxX, point.xPt);
    minY = Math.min(minY, point.yPt);
    maxY = Math.max(maxY, point.yPt);
  }
  stampFrame(vector, pageIndex, { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY });
}

// The ONE LayoutItem -> ContentVector classification in this package, shared verbatim by all three reconstruction directions: reconstructDrawing (above), and -- via recoverPageVectors below -- reconstructWordprocessing and reconstructPresentation. Which items reach it at all is a per-direction decision; what a rect/ellipse/line/path becomes once it does is not, and deliberately has no second implementation anywhere. Returns undefined for every non-vector kind (text/image/link), so a caller can use it as the "is this vector geometry?" test and its own converter in one step.
//
// How much this actually recovers is a property of pdf-codec's own content-stream interpreter, not of this function: its shape-pattern detection recognises an axis-aligned closed four-corner subpath as a real LayoutRect (any fill/stroke combination, and a 90-degree-rotated CTM as well as an unrotated one), a closed four-cubic kappa-ratio subpath as a real LayoutEllipse, and an open single-straight-segment stroke-only subpath as a real LayoutLine. Anything outside those patterns -- an off-axis rotation, a freeform curve, a multi-subpath figure -- stays a generic LayoutPath and is recovered as a 'path' vector, which is an honest narrowing of KIND only: the recovered geometry itself is exact either way.
function layoutItemToVector(item: LayoutItem, pageHeightPt: number): ContentVector | undefined {
  if (item.kind === 'rect') {
    return layoutRectToVector(item, pageHeightPt);
  }
  if (item.kind === 'ellipse') {
    return layoutEllipseToVector(item, pageHeightPt);
  }
  if (item.kind === 'line') {
    return layoutLineToVector(item, pageHeightPt);
  }
  if (item.kind === 'path') {
    return layoutPathToVector(item, pageHeightPt);
  }
  return undefined;
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
function layoutTextToShape(item: LayoutText, pageHeightPt: number, pageIndex: number): ContentShape {
  const frame = computeBlockFrame({ lines: [{ items: [item], baselineY: item.yPt }] }, pageHeightPt);
  const run = textItemToContentRun(item);
  stampFrame(run, pageIndex, textBoxOfItem(item, pageIndex));
  const paragraph: ContentParagraph = { kind: 'paragraph', runs: [run] };
  stampFrame(paragraph, pageIndex, textBoxOfItem(item, pageIndex));
  return {
    frame,
    rotationDeg: item.rotationDeg !== undefined ? -item.rotationDeg : undefined,
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [paragraph],
  };
}

// ---------------------------------------------------------------------------
// Shared: VECTOR and TABLE recovery for the wordprocessing and presentation directions.
//
// reconstructDrawing has always mapped every painted rect/ellipse/line/path back onto a ContentVector, because a drawing page has an array to put one in. reconstructWordprocessing and reconstructPresentation used to drop that geometry on the floor entirely -- filtering each page down to its text and image items and ignoring every stroke and fill -- purely because ContentSection.blocks and ContentSlide.shapes have no vector vocabulary of their own. That is a container gap, not a recovery gap: the classification is identical whichever direction asked for it, so both directions now run the SAME layoutItemToVector above and carry the result in a ContentEmbeddedObjectBlock (see src/model/embedded-drawing.ts for why that is the schema's own answer here rather than a widening of it).
//
// HONEST CONSEQUENCE, stated because it is a change in what these two directions emit: a PDF does not distinguish a stroke drawn to decorate from a stroke drawn as structure. A rule under a heading, an underline (pdf-codec writes one as a filled rectangle), and a table cell's own background fill are all genuine painted geometry, and are all now recovered as vectors rather than silently discarded. That is the intended behaviour -- discarding real content because it might be incidental is exactly the silent loss this package's conventions rule out -- but it does mean a reconstructed document carries more than its text alone. The one case deliberately NOT double-counted is a table's own gridlines: when the table recovery below claims a lattice, the strokes that formed it are excluded from vector recovery, so the structure is reported once, as a table, rather than twice.
//
// WRITE-SIDE STATUS: both recoveries now reach the output bytes for every target. The recovered table becomes a real table (buildDocxPackage/buildOdtPackage append one to the body, buildPptxPackage/buildOdpPackage add a slide table). The recovered VECTORS become real vector shapes -- DrawingML preset and custom geometry for docx and pptx (src/edit/drawingml/vector.ts, wrapped as a page-anchored w:drawing by src/edit/docx/vector.ts and as a p:sp by src/edit/pptx/vector.ts), and draw:rect/draw:ellipse/draw:line/draw:path for odt and odp (src/edit/odg/vector.ts's writer, reused wholesale rather than reimplemented, since ODF's vector vocabulary is identical in a text document, a presentation, and a drawing).
//
// What that does NOT make lossless is the reading back: readDocxContent/readPptxContent are thin adapters over ooxml.js's own readDocx/readPptx, neither of which reads vector geometry into a ContentDocument, and readOdtContent/readOdpContent are the same over odf.js's readOdt/readOdp, where ContentSection.blocks and ContentSlide.shapes have no vector vocabulary to read one into. So a written vector survives into the file and into any real consumer of it, but re-reading that file through this package's own readers does not produce the block back. Closing that is reader-side work -- the OOXML/ODF mirror of the second pass src/odf/formula/detect.ts already runs for embedded formulas -- and is genuinely separate from the writing above.
// ---------------------------------------------------------------------------

// A vector's own topmost edge in PDF space (y up), for positioning a recovered drawing among the text blocks around it. Every kind but 'line' carries a top-left/y-down frame; a line carries two bare endpoints instead.
function vectorTopYDownPt(vector: ContentVector): number {
  return vector.kind === 'line' ? Math.min(vector.from.yPt, vector.to.yPt) : vector.frame.yPt;
}

interface RecoveredVectors {
  readonly block: ContentEmbeddedObjectBlock;
  readonly topYPt: number; // PDF-space y of the topmost recovered vector, for ordering against the page's other content
}

// Every vector primitive on a page, in paint order, as one embedded drawing block -- or undefined when the page has none, so a text-only page's output is byte-identical to what it was before this recovery existed. `excluded` carries the items already claimed as a table's own gridlines.
function recoverPageVectors(page: LayoutPage, pageIndex: number, excluded: ReadonlySet<LayoutItem>): RecoveredVectors | undefined {
  const vectors: ContentVector[] = [];
  for (const item of page.items) {
    if (excluded.has(item)) {
      continue;
    }
    const vector = layoutItemToVector(item, page.heightPt);
    if (vector !== undefined) {
      stampVectorFrame(vector, item, pageIndex);
      // paintOrder is the recovery index, exactly as reconstructDrawPage stamps it: a LayoutPage's items ARE its paint order, front-to-back by array position.
      vectors.push({ ...vector, paintOrder: vectors.length });
    }
  }
  if (vectors.length === 0) {
    return undefined;
  }
  const topYDownPt = Math.min(...vectors.map(vectorTopYDownPt));
  const block = buildDrawingBlock({ widthPt: page.widthPt, heightPt: page.heightPt }, vectors);
  // The wrapper block sat across the whole page -- the vectors inside it are page-anchored by construction (see buildDrawingBlock's own doc), so its own placement is the page itself.
  stampFrame(block, pageIndex, { xPt: 0, yPt: 0, widthPt: page.widthPt, heightPt: page.heightPt });
  return { block, topYPt: page.heightPt - topYDownPt };
}

// --- Table recovery, gated on an unambiguously detected gridline lattice ---------------------------------
//
// A ContentTable is synthesized ONLY from a real, drawn gridline lattice -- the identical detector, thresholds and span-consistency check reconstructSpreadsheet already gates its own cell-boundary recovery on (src/layout/lattice.ts). Text alignment and wide inter-word gaps are deliberately NOT accepted as evidence: several left-aligned lines with a tab-sized gap between their columns are indistinguishable, from geometry alone, from a genuinely tabbed paragraph, an indented code sample, or a two-column page layout, so building a table out of one would be inventing structure the source never had rather than recovering structure it did. That distinction is the whole point of the gate: a drawn lattice IS the table's structure, present in the file as real geometry; alignment merely resembles one.
//
// A lattice with no text inside it at all is rejected too. A grid of empty boxes is far more likely a decorative frame, a chart's plot area, or a form's field outlines than a table, and recovering it as an empty table would add a structure carrying nothing.

interface RecoveredTable {
  readonly table: ContentTable;
  readonly frame: Box; // top-left/y-down, for the presentation direction's own containing shape
  readonly topYPt: number; // PDF-space y of the lattice's top edge, for the wordprocessing direction's own block ordering
  readonly consumedText: ReadonlySet<LayoutText>; // text now living inside the table, and therefore removed from paragraph/block clustering
  readonly latticeItems: ReadonlySet<LayoutItem>; // the strokes that formed the lattice, excluded from vector recovery
}

// One cell's own text, as one ContentParagraph per recovered line. A table cell's text genuinely can wrap across lines (unlike a spreadsheet cell's -- see buildGridFromTextClustering's own note), and geometry alone cannot say whether two stacked lines in a cell were one wrapped paragraph or two separate ones, so each line stays its own paragraph rather than being joined on a guess. This is the same choice reconstructPresentation's own blockToShape already makes for a slide text box, for the same reason.
function cellBlocksFromItems(items: readonly LayoutText[], pageIndex: number): ContentBlock[] {
  return clusterIntoLines(items).map((line) => lineToParagraph(line, pageIndex));
}

function recoverTable(page: LayoutPage, pageIndex: number): RecoveredTable | undefined {
  const lattice = detectGridLattice(page.items);
  if (lattice === undefined) {
    return undefined;
  }
  const rowCount = lattice.rowBoundariesDescPt.length - 1;
  const columnCount = lattice.columnBoundariesAscPt.length - 1;
  const groups = new Map<string, LayoutText[]>();
  const consumedText = new Set<LayoutText>();
  for (const item of page.items) {
    if (item.kind !== 'text') {
      continue;
    }
    const row = findRowIndex(lattice.rowBoundariesDescPt, item.yPt);
    const column = findColumnIndex(lattice.columnBoundariesAscPt, item.xPt);
    if (row === undefined || column === undefined) {
      continue; // outside the lattice entirely -- a caption, a heading above the table
    }
    addToGroup(groups, row, column, item);
    consumedText.add(item);
  }
  if (consumedText.size === 0) {
    return undefined; // an empty lattice is decoration, not a table -- see this section's own note
  }

  const columnWidthsPt: number[] = [];
  for (let j = 0; j < columnCount; j++) {
    columnWidthsPt.push(lattice.columnBoundariesAscPt[j + 1]! - lattice.columnBoundariesAscPt[j]!);
  }
  const rows: ContentTableRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const cells: ContentTableCell[] = [];
    for (let j = 0; j < columnCount; j++) {
      // A cell with no text recovered inside it is emitted as a genuinely empty cell rather than skipped: a ContentTableRow's cells are positional, so dropping one would shift every cell after it into the wrong column. Every cell carries its own lattice-measured frame -- the exact box the drawn gridline lattice gave it, in PDF space.
      const cell: ContentTableCell = { blocks: cellBlocksFromItems(groups.get(groupKey(i, j)) ?? [], pageIndex) };
      const cellLeftXPt = lattice.columnBoundariesAscPt[j]!;
      const cellRightXPt = lattice.columnBoundariesAscPt[j + 1]!;
      const cellTopYPt = lattice.rowBoundariesDescPt[i]!;
      const cellBottomYPt = lattice.rowBoundariesDescPt[i + 1]!;
      stampFrame(cell, pageIndex, { xPt: cellLeftXPt, yPt: cellBottomYPt, widthPt: cellRightXPt - cellLeftXPt, heightPt: cellTopYPt - cellBottomYPt });
      cells.push(cell);
    }
    rows.push({ cells, heightPt: lattice.rowBoundariesDescPt[i]! - lattice.rowBoundariesDescPt[i + 1]! });
  }

  const leftXPt = lattice.columnBoundariesAscPt[0]!;
  const rightXPt = lattice.columnBoundariesAscPt[columnCount]!;
  const topYPt = lattice.rowBoundariesDescPt[0]!;
  const bottomYPt = lattice.rowBoundariesDescPt[rowCount]!;
  const pdfBox = { xPt: leftXPt, yPt: bottomYPt, widthPt: rightXPt - leftXPt, heightPt: topYPt - bottomYPt };
  const frame = flipY(pdfBox, page.heightPt);
  const table: ContentTable = { kind: 'table', rows, columnWidthsPt };
  stampFrame(table, pageIndex, pdfBox);
  return { table, frame, topYPt, consumedText, latticeItems: lattice.sourceItems };
}

const NO_ITEMS: ReadonlySet<LayoutItem> = new Set();

// ---------------------------------------------------------------------------
// PDF -> ods (spreadsheet): recovers what was printed, not what was entered. Every recovered cell keeps its own rendered string verbatim in the REQUIRED displayText field, and additionally gets a heuristically re-typed `value` (number/percentage/currency/date/boolean) wherever src/layout/cell-typing.ts finds exactly one defensible reading of that string -- an explicitly PROBABILISTIC step, not a fidelity guarantee, since a rendered PDF genuinely never carries a cell's own typed value and a numeric-looking string may always have been a genuine string. Read cell-typing.ts's own module doc before relying on a re-typed value: it states the confidence bar, and every re-typing decision (including a deliberate refusal on a named ambiguity) is reported through ReconstructOptions.onCellTypeInference. A formula is still never claimed -- nothing about a rendered value implies one was computed. Two detection paths, tried in this order per page: (1) a real gridline lattice -- a genuine printed spreadsheet with gridlines enabled draws exactly this, see layout/sheets.ts's own renderGridlines -- is used DIRECTLY as cell boundaries, no inference needed; (2) absent a lattice, text is clustered into a grid from geometry alone, reusing this module's own clusterIntoLines for rows (a spreadsheet cell's own text is never wrapped across lines -- sheets.ts's own module doc -- so a text line already IS a row) and a parallel x-position recurrence clustering for columns, generalizing clusterIntoParagraphs's own single dominantLeftX to several recurring column anchors. Column widths, row heights, and a sheet's own page size are all genuinely MEASURED from recovered geometry, never invented; there is no attempt to recover print INTENT (range/scale/repeat-rows) that a rendered page carries no trace of at all.
// ---------------------------------------------------------------------------

// --- Path 1: gridline lattice detection (src/layout/lattice.ts, shared with the wordprocessing/presentation table recovery above) -----------------------------------------------------------

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

// Every recovered cell ALWAYS carries its own rendered text verbatim in displayText, and additionally carries a heuristically re-typed `value` wherever src/layout/cell-typing.ts finds exactly one defensible reading of that text (see its own module doc for the confidence bar, and this section's top-of-block note for why the whole step is probabilistic). A cell whose text is ambiguous, or not number/date/boolean-shaped at all, keeps `value` as the plain string it was recovered as -- so `value.kind !== 'string'` is itself the flag distinguishing an inferred value from an untouched one, with the reporting sink below carrying the reason behind either outcome. A (row, column) position with no text assigned to it at all is simply never emitted, matching the sparse cell model buildOdsPackage's own appendCell already expects.
function buildCellsFromGroups(groups: ReadonlyMap<string, readonly LayoutText[]>, pageIndex: number, context: CellTypingContext): ContentSheetCell[] {
  const cells: ContentSheetCell[] = [];
  for (const [key, items] of groups) {
    const displayText = joinCellText(items);
    if (displayText.length === 0) {
      continue;
    }
    const [rowPart, columnPart] = key.split(',');
    const row = Number(rowPart);
    const column = Number(columnPart);
    const cell: ContentSheetCell = { row, column, value: inferredCellValue(displayText, row, column, context), displayText };
    // The cell's frame is the PDF-space bounding box of exactly the items clustered into it -- the printed extent of that cell's own content, which is all a rendered PDF carries about where the cell was.
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const item of items) {
      const { ascentPt, descentPt } = textItemVerticalExtent(item);
      minX = Math.min(minX, item.xPt);
      maxX = Math.max(maxX, item.xPt + (item.widthPt ?? 0));
      minY = Math.min(minY, item.yPt - descentPt);
      maxY = Math.max(maxY, item.yPt + ascentPt);
    }
    stampFrame(cell, pageIndex, { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY });
    cells.push(cell);
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column);
  return cells;
}

interface CellTypingContext {
  readonly sheetIndex: number;
  readonly sink?: CellTypeInferenceSink;
}

// The one place a recovered cell's re-typed value is decided and reported. A 'retyped' result replaces the plain-string value; a 'declined' one deliberately does not, leaving the string in place -- both are reported, because "we looked and refused" is exactly as much a part of the audit trail as "we looked and re-typed", and a caller cannot reconstruct the refusal from the output alone (a declined cell is indistinguishable from one that was never number-shaped to begin with).
function inferredCellValue(displayText: string, row: number, column: number, context: CellTypingContext): ContentSheetCell['value'] {
  const inference = inferCellValue(displayText);
  if (inference === undefined) {
    return { kind: 'string', value: displayText };
  }
  const reported: CellTypeInference = { sheetIndex: context.sheetIndex, row, column, displayText, ...inference };
  context.sink?.(reported);
  return inference.outcome === 'retyped' ? inference.value : { kind: 'string', value: displayText };
}

interface ReconstructedGrid {
  readonly cells: ContentSheetCell[];
  readonly columns: ContentSheetColumn[];
  readonly rows: ContentSheetRow[];
  readonly gridlines: boolean;
}

// The gridline positions ARE the cell boundaries -- column/row widths are the exact, genuinely measured gap between consecutive drawn lines, not estimated from text at all.
function buildGridFromLattice(textItems: readonly LayoutText[], lattice: GridLattice, pageIndex: number, context: CellTypingContext): ReconstructedGrid {
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
  return { cells: buildCellsFromGroups(groups, pageIndex, context), columns, rows, gridlines: true };
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
function buildGridFromTextClustering(textItems: readonly LayoutText[], pageIndex: number, context: CellTypingContext): ReconstructedGrid {
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

  return { cells: buildCellsFromGroups(groups, pageIndex, context), columns, rows, gridlines: false };
}

// --- Orchestration: one ContentSheet per PDF page -----------------------------------------------------------

// A PDF page carries no sheet name, and no trace of whether the source spreadsheet's own column/row banding split one sheet across several printed pages -- there is no principled way to re-merge pages back into fewer sheets from geometry alone, so this maps one page to one sheet, exactly as reconstructPresentation maps one page to one slide.
function reconstructSheet(page: LayoutPage, pageIndex: number, sink: CellTypeInferenceSink | undefined): ContentSheet {
  const textItems = page.items.filter((i): i is LayoutText => i.kind === 'text');
  const lattice = detectGridLattice(page.items);
  const context: CellTypingContext = { sheetIndex: pageIndex, sink };
  const grid = lattice !== undefined ? buildGridFromLattice(textItems, lattice, pageIndex, context) : buildGridFromTextClustering(textItems, pageIndex, context);

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
    return reconstructSheet(page, index, options?.onCellTypeInference);
  });
  return { kind: 'spreadsheet', metadata: doc.metadata, sheets };
}
