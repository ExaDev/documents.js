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

// Justification (stretching inter-word spacing to fill the line) is not implemented for v1 -- treated as left-aligned, a documented narrowing rather than a silent approximation left unexplained.
export function alignmentOffsetPt(alignment: Alignment | undefined, contentWidthPt: number, lineWidthPt: number): number {
  if (alignment === 'center') {
    return Math.max(0, (contentWidthPt - lineWidthPt) / 2);
  }
  if (alignment === 'right') {
    return Math.max(0, contentWidthPt - lineWidthPt);
  }
  return 0;
}

function pushBorderLine(border: ContentBorder | undefined, x1Pt: number, y1Pt: number, x2Pt: number, y2Pt: number, sourcePath: string | undefined, out: LayoutItem[]): void {
  if (border === undefined) {
    return;
  }
  out.push({ kind: 'line', x1Pt, y1Pt, x2Pt, y2Pt, color: border.color, widthPt: border.widthPt, sourcePath });
}

// One LayoutLine per DECLARED border edge of one cell, given that cell's own frame in y-down space (the convention both callers already hold their cell geometry in) and the page height to flip it through. Shared by src/layout/engine.ts (ContentTableCell.borders -- a docx/odt/pptx/odp table cell) and src/layout/sheets.ts (ContentSheetCell.borders -- an ods/xlsx sheet cell): the two places in this package that render a bordered cell at all, and structurally the identical work in both, four independently-optional edges of one rectangle each becoming a straight line at its own edge position. An absent edge emits nothing at all rather than a zero-width line, so a cell declaring only `bottom` paints exactly one line.
//
// ContentBorder.style ('solid' | 'dashed' | 'dotted' | 'double') is deliberately NOT expressed here, and this is a real schema gap rather than a shortcut: neither of the two layout kinds able to carry a stroke has anywhere to put it -- LayoutLineSchema is kind/x1/y1/x2/y2/color/widthPt, and LayoutPathSchema's own stroke is color/widthPt (document-schema.js's layout.ts) -- so there is no dash array to write and nothing in pdf-codec's own content-write.ts to read one from if there were. Every border consequently paints solid at its declared colour and width. Rendering 'double' as two hand-offset parallel lines was considered and rejected: the offset distance is nowhere in the model, so it would be an invented constant standing in for information the source never carried.
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
