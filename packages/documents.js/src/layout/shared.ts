import { base64ToBytes } from 'ooxml.js';
import type { Box, ContentBorder, ContentCellBorders, ContentImageBlock, ContentRun, ContentTableRow, LayoutImageAsset, LayoutItem } from 'document-schema.js';
import { COLOR_BLACK } from '../model/color';
import type { Alignment, LayoutFont } from '../model/style';
import { DEFAULT_LAYOUT_FONT } from '../model/style';
import type { StyledRun, TextMeasurer, WrappedLine } from 'pdf-codec';
import { crc32, decodePng, readJpegInfo, wrapRunsToWidth } from 'pdf-codec';

// Layout logic genuinely shared between src/layout/slides.ts (pptx, direct placement) and src/layout/engine.ts (docx, flow/pagination): run styling, line-height measurement, alignment, and image-asset registration have no format-specific knowledge of their own -- duplicating them between the two engines would just be two copies to keep in sync.

// A nominal fallback text size, used only when a ContentRun/paragraph has no resolvable size of its own (a wholly empty paragraph, or a run whose cascade never set one) -- ContentParagraph/ContentRun don't retain the cascade-resolved default for this case, only what ended up on an actual run.
export const NOMINAL_TEXT_SIZE_PT = 18;

// An embedded formula has no surrounding run to inherit a font size from the way ordinary text does, so every layout engine in this package picks one from the embedded object's own declared frame height (ContentEmbeddedObject.frame.heightPt -- the ORIGINAL formula's own rendered size in the source document): a single-line formula's total height (ascent + descent across its tallest/deepest element) is typically a little over twice its base font size, so half the frame height is a reasonable single-pass estimate. This is deliberately a one-shot heuristic, not an iterative fit-to-height search -- close enough for a faithful visual approximation (this package's own established bar -- see the README's Fidelity section), not a guarantee of reproducing the source's exact point size. Lives here rather than in any one engine because all three that render a formula (engine.ts's flow placement, slides.ts's shape placement, sheets.ts's cell-anchored placement) need the identical heuristic and there is nothing format-specific about it.
const MIN_FORMULA_SIZE_PT = 8;
export function formulaSizePtFromFrame(frameHeightPt: number): number {
  return Math.max(MIN_FORMULA_SIZE_PT, frameHeightPt / 2);
}

// A table row's own explicit height is present for essentially every real-world docx/pptx table; this is a nominal fallback exercised only for a hand-built or malformed table that omits it.
const FALLBACK_ROW_HEIGHT_PT = 20;

export function runFont(run: ContentRun): LayoutFont {
  return {
    family: run.fontFamily ?? DEFAULT_LAYOUT_FONT.family,
    weight: run.bold === true ? 'bold' : 'normal',
    style: run.italic === true ? 'italic' : 'normal',
  };
}

export function toStyledRuns(runs: readonly ContentRun[], fontScale = 1): StyledRun[] {
  return runs.map((run) => ({
    text: run.text,
    font: runFont(run),
    sizePt: (run.sizePt ?? NOMINAL_TEXT_SIZE_PT) * fontScale,
    color: run.color ?? COLOR_BLACK,
    underline: run.underline,
    hyperlink: run.hyperlink,
    sourcePath: run.sourcePath,
  }));
}

// A paragraph's runs, with a synthesised nominal fallback substituted when there are none at all -- so callers can wrap and measure unconditionally rather than special-casing an empty paragraph.
export function effectiveStyledRuns(runs: readonly ContentRun[], fontScale = 1): StyledRun[] {
  const styled = toStyledRuns(runs, fontScale);
  return styled.length > 0 ? styled : [{ text: '', font: DEFAULT_LAYOUT_FONT, sizePt: NOMINAL_TEXT_SIZE_PT * fontScale, color: COLOR_BLACK }];
}

export function lineNaturalHeightPt(line: WrappedLine, measurer: TextMeasurer, fallback: StyledRun): number {
  if (line.fragments.length === 0) {
    return measurer.lineHeightAtSize(fallback.font, fallback.sizePt);
  }
  let max = 0;
  for (const fragment of line.fragments) {
    max = Math.max(max, measurer.lineHeightAtSize(fragment.font, fragment.sizePt));
  }
  return max;
}

// The whole-line offset for center/right alignment, or the paragraph-start offset (0) for left/justify. Justification's own inter-word stretching is a per-fragment concern, not a single whole-line offset -- see justifyLineGapsPt below, which a justified paragraph's own line-emission loop calls in addition to (not instead of) this function.
export function alignmentOffsetPt(alignment: Alignment | undefined, contentWidthPt: number, lineWidthPt: number): number {
  if (alignment === 'center') {
    return Math.max(0, (contentWidthPt - lineWidthPt) / 2);
  }
  if (alignment === 'right') {
    return Math.max(0, contentWidthPt - lineWidthPt);
  }
  return 0;
}

// Floating-point tolerance for detecting a genuine inter-word gap between two adjacent wrapped-line fragments (see justifyLineGapsPt) -- widths coming out of TextMeasurer are IEEE-754 doubles accumulated across several additions, so an exact-zero comparison would misclassify a genuine touching pair (e.g. a single word split across a run-boundary, which wrapRunsToWidth's own atomizeRuns keeps as one unbreakable box atom with zero gap between its fragments) as a gapped one on some inputs.
const GAP_DETECTION_EPSILON_PT = 0.01;

// The standard justification algorithm: computes, per fragment of one already-wrapped line, the cumulative extra horizontal offset (points) that stretches the line's own natural word/single-space layout out to fill targetWidthPt exactly. wrapRunsToWidth's own WrappedLine carries only natural (unstretched) per-fragment xOffsetPt values with no record of where a word boundary (a consumed glue/space atom) fell versus where two fragments merely abut because they're pieces of one word split across a run boundary -- so this function first recovers that distinction by comparing each fragment's own start offset against the previous fragment's natural end (text width already known to the caller's own measurer): a gap wider than floating-point noise between the two means a space stood there. The slack (targetWidthPt minus the line's own natural widthPt) is then divided evenly across every detected gap and applied as an increasing cumulative offset from that gap onward, so the line's last fragment ends exactly at targetWidthPt. Returns an all-zero array (nothing shifts) when there is nothing to stretch across -- fewer than two fragments (no possible gap), no genuine gap detected between any adjacent pair (a single unbroken word), or the line's natural width already meets or exceeds the target (this function only ever adds space; it never compresses an over-width line). The caller adds `result[i]` onto `line.fragments[i].xOffsetPt` -- the fragment's own content and its unstretched natural offset are otherwise untouched.
export function justifyLineGapsPt(line: WrappedLine, targetWidthPt: number, measurer: TextMeasurer): readonly number[] {
  const fragments = line.fragments;
  const extrasPt = new Array<number>(fragments.length).fill(0);
  if (fragments.length < 2) {
    return extrasPt;
  }

  const gapIndices: number[] = [];
  for (let i = 0; i < fragments.length - 1; i++) {
    const fragment = fragments[i]!;
    const next = fragments[i + 1]!;
    const naturalEndPt = fragment.xOffsetPt + measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt);
    if (next.xOffsetPt - naturalEndPt > GAP_DETECTION_EPSILON_PT) {
      gapIndices.push(i);
    }
  }
  if (gapIndices.length === 0) {
    return extrasPt;
  }

  const slackPt = targetWidthPt - line.widthPt;
  if (slackPt <= 0) {
    return extrasPt;
  }

  const extraPerGapPt = slackPt / gapIndices.length;
  let cumulativePt = 0;
  let gapPointer = 0;
  for (let i = 0; i < fragments.length; i++) {
    extrasPt[i] = cumulativePt;
    if (gapPointer < gapIndices.length && gapIndices[gapPointer] === i) {
      cumulativePt += extraPerGapPt;
      gapPointer++;
    }
  }
  return extrasPt;
}

function pushBorderLine(border: ContentBorder | undefined, x1Pt: number, y1Pt: number, x2Pt: number, y2Pt: number, sourcePath: string | undefined, out: LayoutItem[]): void {
  if (border === undefined) {
    return;
  }
  out.push({ kind: 'line', x1Pt, y1Pt, x2Pt, y2Pt, color: border.color, widthPt: border.widthPt, style: border.style, sourcePath });
}

// One LayoutLine per DECLARED border edge of one cell, given that cell's own frame in y-down space (the convention both callers already hold their cell geometry in) and the page height to flip it through. Shared by src/layout/engine.ts (ContentTableCell.borders -- a docx/odt/pptx/odp table cell) and src/layout/sheets.ts (ContentSheetCell.borders -- an ods/xlsx sheet cell): the two places in this package that render a bordered cell at all, and structurally the identical work in both, four independently-optional edges of one rectangle each becoming a straight line at its own edge position. An absent edge emits nothing at all rather than a zero-width line, so a cell declaring only `bottom` paints exactly one line.
//
// ContentBorder.style ('solid' | 'dashed' | 'dotted' | 'double') now carries straight through onto the emitted LayoutLine's own `style` field, as of document-schema.js 2.1.0 adding that same optional enum to LayoutLineSchema/LayoutPathSchema -- the two layout kinds able to carry a stroke previously had nowhere to put it (LayoutLineSchema was kind/x1/y1/x2/y2/color/widthPt with no style field at all), so this was a genuine schema gap, not a shortcut, until that release closed it. Whether pdf-codec's own write.ts does anything with a non-solid style yet (a real dash array on the PDF `S`/`s` operator) is a separate, pdf-codec-side question -- see that package's own content-write.ts for its current state. Rendering 'double' as two hand-offset parallel lines was still considered and rejected here regardless: the offset distance is nowhere in the model, so it would be an invented constant standing in for information the source never carried.
export function pushCellBorderLines(borders: ContentCellBorders, frameYDown: Box, pageHeightPt: number, sourcePath: string | undefined, out: LayoutItem[]): void {
  const leftXPt = frameYDown.xPt;
  const rightXPt = frameYDown.xPt + frameYDown.widthPt;
  const topYPt = pageHeightPt - frameYDown.yPt;
  const bottomYPt = pageHeightPt - (frameYDown.yPt + frameYDown.heightPt);
  pushBorderLine(borders.top, leftXPt, topYPt, rightXPt, topYPt, sourcePath, out);
  pushBorderLine(borders.bottom, leftXPt, bottomYPt, rightXPt, bottomYPt, sourcePath, out);
  pushBorderLine(borders.left, leftXPt, topYPt, leftXPt, bottomYPt, sourcePath, out);
  pushBorderLine(borders.right, rightXPt, topYPt, rightXPt, bottomYPt, sourcePath, out);
}

function decodeImageDimensions(format: 'png' | 'jpeg', bytes: Uint8Array<ArrayBuffer>): { widthPx: number; heightPx: number } {
  if (format === 'jpeg') {
    const info = readJpegInfo(bytes);
    return { widthPx: info.width, heightPx: info.height };
  }
  const raw = decodePng(bytes);
  return { widthPx: raw.width, heightPx: raw.height };
}

// Registers an image in the document-wide asset registry, deduplicating by content: an identical image (e.g. a repeated logo) reuses the same imageId across every shape/paragraph/slide/page that references it. The id is a short CRC32-derived string rather than the raw base64 itself -- a 32-bit hash's collision risk is negligible at the scale of images in a single document, and it keeps write.ts's resource names readable.
export function registerImage(block: ContentImageBlock, images: Record<string, LayoutImageAsset>): string {
  const bytes = base64ToBytes(block.base64);
  const imageId = `img${crc32(bytes).toString(16)}`;
  if (!(imageId in images)) {
    const { widthPx, heightPx } = decodeImageDimensions(block.format, bytes);
    images[imageId] = { format: block.format, base64: block.base64, widthPx, heightPx };
  }
  return imageId;
}

export function sumColumnWidthsPt(columnWidthsPt: readonly number[], startIndex: number, span: number): number {
  let sum = 0;
  for (let i = startIndex; i < startIndex + span && i < columnWidthsPt.length; i++) {
    sum += columnWidthsPt[i] ?? 0;
  }
  return sum;
}

// A content-derived fallback for a table row with no explicit height of its own: the tallest single line any cell's paragraphs would produce at the given per-cell width. Deliberately approximate (it doesn't account for a cell wrapping to multiple lines) -- a real row height is expected to be present in essentially every real-world table; this only matters for hand-built or malformed input.
export function estimateRowHeightPt(row: ContentTableRow, measurer: TextMeasurer, columnWidthsPt: readonly number[], scale: number): number {
  let max = FALLBACK_ROW_HEIGHT_PT;
  let colIndex = 0;
  for (const cell of row.cells) {
    const span = cell.colSpan ?? 1;
    const cellWidthPt = sumColumnWidthsPt(columnWidthsPt, colIndex, span) * scale;
    for (const block of cell.blocks) {
      if (block.kind !== 'paragraph') {
        continue;
      }
      const runs = effectiveStyledRuns(block.runs);
      const lines = wrapRunsToWidth(runs, measurer, cellWidthPt);
      for (const line of lines) {
        max = Math.max(max, lineNaturalHeightPt(line, measurer, runs[0]!));
      }
    }
    colIndex += span;
  }
  return max;
}
