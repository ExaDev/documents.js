import { base64ToBytes } from 'ooxml.js';
import { crc32 } from '../bytes/crc32';
import { readJpegInfo } from '../image/jpeg-info';
import { decodePng } from '../image/png-decode';
import { COLOR_BLACK } from '../model/color';
import type { ContentDocument, ContentImageBlock, ContentParagraph, ContentRun, ContentShape, ContentSlide, ContentTable, ContentTableRow } from '../model/content';
import type { Box } from '../model/geometry';
import { flipY } from '../model/geometry';
import type { LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLink, LayoutPage, LayoutText } from '../model/layout';
import { LAYOUT_FORMAT_VERSION } from '../model/layout';
import type { Alignment, LayoutFont } from '../model/style';
import { DEFAULT_LAYOUT_FONT } from '../model/style';
import type { Point } from '../pdf/matrix';
import { rotatePointAboutCenter } from '../pdf/matrix';
import type { TextMeasurer } from '../pdf/measure';
import type { StyledRun, WrappedLine } from '../pdf/text-layout';
import { wrapRunsToWidth } from '../pdf/text-layout';

// ContentDocument (the presentation variant) -> LayoutDocument: pptx's tractable layout direction. No pagination -- one slide is always exactly one PDF page (slide size maps directly to the page's own widthPt/heightPt) -- and no group-transform resolution either, since src/ooxml/pptx/read.ts already flattened every group into absolute shape positions at read time. What's left is genuinely just: wrap each shape's text within its own box (reusing the exact wrapRunsToWidth docx will also use), place images at their shape's frame, render table grids directly from explicit column widths/row heights, and apply the one deliberate Y-flip from OOXML's top-left/y-down space into PDF's bottom-left/y-up space.

export interface SlidesLayoutOptions {
  readonly measurer: TextMeasurer;
}

type PresentationContentDocument = Extract<ContentDocument, { kind: 'presentation' }>;

// PowerPoint's own conventional default body-text size, used only as a last-resort height for a wholly empty paragraph (no runs at all) whose own resolved default size isn't available at this layer -- ContentParagraph doesn't retain the cascade-resolved default for a paragraph with zero runs, only what ended up on its actual runs.
const NOMINAL_EMPTY_PARAGRAPH_SIZE_PT = 18;

// A table row's own explicit height (a:tr/@h) is present for essentially every real-world pptx table; this is a nominal fallback exercised only for a hand-built or malformed table that omits it.
const FALLBACK_ROW_HEIGHT_PT = 20;

interface ShapePlacement {
  place(point: Point): Point;
  readonly layoutRotationDeg: number | undefined;
}

// DrawingML rotates a shape about its own bounding-box centre, clockwise; content-write.ts's writer rotates about whatever anchor point it's given, counter-clockwise. rotatePointAboutCenter (src/pdf/matrix.ts) reconciles the two: feeding it an unrotated point and the shape's own centre computes exactly the point a caller must pass as a LayoutItem's xPt/yPt for the writer's own corner-pivot rotation to reproduce PowerPoint's centre-pivot rotation.
function shapePlacement(flippedFrame: Box, rotationDeg: number | undefined): ShapePlacement {
  if (rotationDeg === undefined || rotationDeg === 0) {
    return { place: (p) => p, layoutRotationDeg: undefined };
  }
  const ccwDeg = -rotationDeg;
  const center: Point = { x: flippedFrame.xPt + flippedFrame.widthPt / 2, y: flippedFrame.yPt + flippedFrame.heightPt / 2 };
  return { place: (p) => rotatePointAboutCenter(p, center, ccwDeg), layoutRotationDeg: ccwDeg };
}

function runFont(run: ContentRun): LayoutFont {
  return {
    family: run.fontFamily ?? DEFAULT_LAYOUT_FONT.family,
    weight: run.bold === true ? 'bold' : 'normal',
    style: run.italic === true ? 'italic' : 'normal',
  };
}

function toStyledRuns(runs: readonly ContentRun[], fontScale: number): StyledRun[] {
  return runs.map((run) => ({
    text: run.text,
    font: runFont(run),
    sizePt: (run.sizePt ?? NOMINAL_EMPTY_PARAGRAPH_SIZE_PT) * fontScale,
    color: run.color ?? COLOR_BLACK,
    underline: run.underline,
    hyperlink: run.hyperlink,
  }));
}

function lineNaturalHeightPt(line: WrappedLine, measurer: TextMeasurer, fallback: StyledRun): number {
  if (line.fragments.length === 0) {
    return measurer.lineHeightAtSize(fallback.font, fallback.sizePt);
  }
  let max = 0;
  for (const fragment of line.fragments) {
    max = Math.max(max, measurer.lineHeightAtSize(fragment.font, fragment.sizePt));
  }
  return max;
}

// Justification (stretching inter-word spacing to fill the line) is not implemented for v1 -- treated as left-aligned, a documented narrowing rather than a silent approximation left unexplained.
function alignmentOffsetPt(alignment: Alignment | undefined, contentWidthPt: number, lineWidthPt: number): number {
  if (alignment === 'center') {
    return Math.max(0, (contentWidthPt - lineWidthPt) / 2);
  }
  if (alignment === 'right') {
    return Math.max(0, contentWidthPt - lineWidthPt);
  }
  return 0;
}

// Lays out one paragraph's wrapped lines, appending LayoutText items (and a LayoutLink per hyperlinked fragment) to `out`, and returns the y-down cursor position immediately after the paragraph (including its own spacingAfterPt).
function layoutParagraph(
  paragraph: ContentParagraph,
  contentLeftXDown: number,
  contentWidthPt: number,
  startYDown: number,
  slideHeightPt: number,
  placement: ShapePlacement,
  fontScale: number,
  spacingScale: number,
  measurer: TextMeasurer,
  out: LayoutItem[],
): number {
  let cursorYDown = startYDown + (paragraph.spacingBeforePt ?? 0);

  const styledRuns = toStyledRuns(paragraph.runs, fontScale);
  const effectiveRuns: StyledRun[] = styledRuns.length > 0 ? styledRuns : [{ text: '', font: DEFAULT_LAYOUT_FONT, sizePt: NOMINAL_EMPTY_PARAGRAPH_SIZE_PT * fontScale, color: COLOR_BLACK }];
  const fallbackRun = effectiveRuns[0]!;

  const paragraphLeftXDown = contentLeftXDown + (paragraph.indentLeftPt ?? 0);
  const paragraphWidthPt = Math.max(0, contentWidthPt - (paragraph.indentLeftPt ?? 0));
  const lines = wrapRunsToWidth(effectiveRuns, measurer, paragraphWidthPt);

  lines.forEach((line, lineIndex) => {
    const naturalLineHeightPt = lineNaturalHeightPt(line, measurer, fallbackRun);
    const scaledLineHeightPt = naturalLineHeightPt * (paragraph.lineSpacing ?? 1) * spacingScale;
    const baselineYDown = cursorYDown + line.ascentPt;
    // First-line indent shifts only where the first line starts, not its wrap point -- wrapRunsToWidth already computed every line at one fixed width, so retroactively narrowing line 0's width isn't possible without re-wrapping. A documented simplification, not a silent one.
    const firstLineIndentPt = lineIndex === 0 ? (paragraph.indentFirstLinePt ?? 0) : 0;
    const alignOffsetPt = alignmentOffsetPt(paragraph.alignment, paragraphWidthPt, line.widthPt);

    for (const fragment of line.fragments) {
      const unrotated: Point = { x: paragraphLeftXDown + firstLineIndentPt + alignOffsetPt + fragment.xOffsetPt, y: slideHeightPt - baselineYDown };
      const placed = placement.place(unrotated);
      const textItem: LayoutText = {
        kind: 'text',
        text: fragment.text,
        xPt: placed.x,
        yPt: placed.y,
        font: fragment.font,
        sizePt: fragment.sizePt,
        color: fragment.color,
        underline: fragment.underline,
        rotationDeg: placement.layoutRotationDeg,
      };
      out.push(textItem);

      if (fragment.hyperlink !== undefined) {
        const fragmentWidthPt = measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt);
        const linkBottomLeft = placement.place({ x: unrotated.x, y: unrotated.y + line.descentPt });
        const link: LayoutLink = {
          kind: 'link',
          uri: fragment.hyperlink,
          xPt: linkBottomLeft.x,
          yPt: linkBottomLeft.y,
          widthPt: fragmentWidthPt,
          heightPt: line.ascentPt - line.descentPt,
        };
        out.push(link);
      }
    }
    cursorYDown += scaledLineHeightPt;
  });

  cursorYDown += paragraph.spacingAfterPt ?? 0;
  return cursorYDown;
}

function decodeImageDimensions(format: 'png' | 'jpeg', bytes: Uint8Array<ArrayBuffer>): { widthPx: number; heightPx: number } {
  if (format === 'jpeg') {
    const info = readJpegInfo(bytes);
    return { widthPx: info.width, heightPx: info.height };
  }
  const raw = decodePng(bytes);
  return { widthPx: raw.width, heightPx: raw.height };
}

// Registers an image in the document-wide asset registry, deduplicating by content: an identical image (e.g. a repeated logo) reuses the same imageId across every shape/slide that references it. The id is a short CRC32-derived string rather than the raw base64 itself -- a 32-bit hash's collision risk is negligible at the scale of images in a single presentation, and it keeps write.ts's resource names readable.
function registerImage(block: ContentImageBlock, images: Record<string, LayoutImageAsset>): string {
  const bytes = base64ToBytes(block.base64);
  const imageId = `img${crc32(bytes).toString(16)}`;
  if (!(imageId in images)) {
    const { widthPx, heightPx } = decodeImageDimensions(block.format, bytes);
    images[imageId] = { format: block.format, base64: block.base64, widthPx, heightPx };
  }
  return imageId;
}

function sumColumnWidthsPt(columnWidthsPt: readonly number[], startIndex: number, span: number): number {
  let sum = 0;
  for (let i = startIndex; i < startIndex + span && i < columnWidthsPt.length; i++) {
    sum += columnWidthsPt[i] ?? 0;
  }
  return sum;
}

function estimateRowHeightPt(row: ContentTableRow, measurer: TextMeasurer): number {
  let max = FALLBACK_ROW_HEIGHT_PT;
  for (const cell of row.cells) {
    for (const block of cell.blocks) {
      if (block.kind !== 'paragraph') {
        continue;
      }
      const styledRuns = toStyledRuns(block.runs, 1);
      const fallback: StyledRun = styledRuns[0] ?? { text: '', font: DEFAULT_LAYOUT_FONT, sizePt: NOMINAL_EMPTY_PARAGRAPH_SIZE_PT, color: COLOR_BLACK };
      max = Math.max(max, measurer.lineHeightAtSize(fallback.font, fallback.sizePt));
    }
  }
  return max;
}

// Renders a table's grid directly from its own explicit column widths and row heights (falling back to content-derived estimates only when a row's own height is missing) rather than proportionally estimating, since pptx tables -- unlike docx's -- already carry this geometry. Cell background rects are skipped entirely when the containing shape is rotated: LayoutRect has no rotation field of its own, and a misplaced (unrotated) rect would be a worse defect than a missing one for what is, in practice, a rare case.
function layoutTable(table: ContentTable, contentLeftXDown: number, contentWidthPt: number, startYDown: number, slideHeightPt: number, placement: ShapePlacement, measurer: TextMeasurer, out: LayoutItem[]): number {
  let cursorYDown = startYDown;
  const gridWidthPt = table.columnWidthsPt.reduce((sum, w) => sum + w, 0);
  const scale = gridWidthPt > 0 ? contentWidthPt / gridWidthPt : 1;

  for (const row of table.rows) {
    const rowHeightPt = row.heightPt ?? estimateRowHeightPt(row, measurer);
    let cellXDown = contentLeftXDown;
    let colIndex = 0;

    for (const cell of row.cells) {
      const span = cell.colSpan ?? 1;
      const cellWidthPt = sumColumnWidthsPt(table.columnWidthsPt, colIndex, span) * scale;

      if (cell.background !== undefined && placement.layoutRotationDeg === undefined) {
        const cellFrame = flipY({ xPt: cellXDown, yPt: cursorYDown, widthPt: cellWidthPt, heightPt: rowHeightPt }, slideHeightPt);
        out.push({ kind: 'rect', xPt: cellFrame.xPt, yPt: cellFrame.yPt, widthPt: cellFrame.widthPt, heightPt: cellFrame.heightPt, fill: cell.background });
      }

      let cellCursorYDown = cursorYDown;
      for (const block of cell.blocks) {
        if (block.kind === 'paragraph') {
          cellCursorYDown = layoutParagraph(block, cellXDown, cellWidthPt, cellCursorYDown, slideHeightPt, placement, 1, 1, measurer, out);
        }
      }

      cellXDown += cellWidthPt;
      colIndex += span;
    }
    cursorYDown += rowHeightPt;
  }
  return cursorYDown;
}

function convertShape(shape: ContentShape, slideHeightPt: number, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>, out: LayoutItem[]): void {
  const flippedFrame = flipY(shape.frame, slideHeightPt);
  const placement = shapePlacement(flippedFrame, shape.rotationDeg);
  const contentLeftXDown = shape.frame.xPt + shape.insetLeftPt;
  const contentWidthPt = Math.max(0, shape.frame.widthPt - shape.insetLeftPt - shape.insetRightPt);
  const fontScale = shape.fontScale ?? 1;
  const spacingScale = 1 - (shape.lineSpacingReduction ?? 0);
  let cursorYDown = shape.frame.yPt + shape.insetTopPt;

  for (const block of shape.blocks) {
    if (block.kind === 'paragraph') {
      cursorYDown = layoutParagraph(block, contentLeftXDown, contentWidthPt, cursorYDown, slideHeightPt, placement, fontScale, spacingScale, measurer, out);
    } else if (block.kind === 'image') {
      const imageId = registerImage(block, images);
      const placed = placement.place({ x: flippedFrame.xPt, y: flippedFrame.yPt });
      const imageItem: LayoutImage = { kind: 'image', imageId, xPt: placed.x, yPt: placed.y, widthPt: flippedFrame.widthPt, heightPt: flippedFrame.heightPt, rotationDeg: placement.layoutRotationDeg };
      out.push(imageItem);
    } else if (block.kind === 'table') {
      cursorYDown = layoutTable(block, contentLeftXDown, contentWidthPt, cursorYDown, slideHeightPt, placement, measurer, out);
    }
    // 'pageBreak' blocks never occur in a pptx-sourced ContentDocument (only docx's reader emits them) -- present only for ContentBlock's type exhaustiveness.
  }
}

function convertSlide(slide: ContentSlide, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>): LayoutPage {
  const items: LayoutItem[] = [];
  for (const shape of slide.shapes) {
    convertShape(shape, slide.size.heightPt, measurer, images, items);
  }
  return { widthPt: slide.size.widthPt, heightPt: slide.size.heightPt, items };
}

// Speaker notes are deliberately not laid out here -- out of v1 scope for pptx->PDF (see the implementation plan's v1 OUT list); ContentSlide.notes is simply not read.
export function convertPresentationToLayout(doc: PresentationContentDocument, options: SlidesLayoutOptions): LayoutDocument {
  const images: Record<string, LayoutImageAsset> = {};
  const pages = doc.slides.map((slide) => convertSlide(slide, options.measurer, images));
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata: doc.metadata, pages, images };
}
