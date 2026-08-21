import { base64ToBytes } from 'ooxml.js';
import type { Box, ContentBorder, ContentCellBorders, ContentImageBlock, ContentRun, ContentTableRow, LayoutFrame, MathFontMetrics, MathMlNode, PageSize, TextMeasurer, WrappedLine } from 'document-schema.js';
import { layoutFormula } from '../mathml/layout';
import type { Alignment, LayoutFont, LayoutMetadata, StyledRun } from 'document-schema.js';
import { COLOR_BLACK, DEFAULT_LAYOUT_FONT } from 'document-schema.js';
import { crc32, decodePng, readJpegInfo } from 'byte-codec';
import { wrapRunsToWidth } from './text-layout';
import type { SourcedFragment, SourcedRun } from './text-layout';
import type { LayoutDocument, LayoutImageAsset, LayoutItem, LayoutPage, LayoutText } from 'pdf-codec';
// Deep-imported from pdf-codec's layout module rather than its root barrel: this module sits in the reconstruction path's graph (documents.js/read), and the barrel's write half would drag the vendored font assets into it. See src/read-graph.test.ts.
import { LAYOUT_FORMAT_VERSION } from 'pdf-codec/layout';

// Layout logic genuinely shared between src/layout/slides.ts (pptx, direct placement) and src/layout/engine.ts (docx, flow/pagination): run styling, line-height measurement, alignment, and image-asset registration have no format-specific knowledge of their own -- duplicating them between the two engines would just be two copies to keep in sync.

// Records one rendered placement onto a content node's own frames array, in place -- the single mechanism every layout engine and reconstructor in this package uses to fuse positions into the content tree (the schema's DocumentPackage design: a node's frames ARE its rendered page positions, in PDF user space, so no second LayoutDocument needs to be correlated back by sourcePath). Mutating the caller's own content tree here is the deliberate design, not an oversight: the correspondence between a node and its position is in hand at exactly this moment and would otherwise be thrown away (see ExaDev/documents.js#569).
export function stampFrame(node: { frames?: LayoutFrame[] }, pageIndex: number, box: Box): void {
  const frame: LayoutFrame = { pageIndex, xPt: box.xPt, yPt: box.yPt, widthPt: box.widthPt, heightPt: box.heightPt };
  if (node.frames === undefined) {
    node.frames = [frame];
  } else {
    node.frames.push(frame);
  }
}

// The bounding box of one rendered text placement: the fragment's own measured width, and the vertical extent its line's ascent/descent give around the baseline the item's yPt carries. widthOfTextAtSize is the identical measurement the wrapping pass already made for this fragment, so the frame's width and the emitted LayoutText agree by construction.
export function textBoxForFragment(item: LayoutText, textWidthPt: number, ascentPt: number, descentPt: number): Box {
  return { xPt: item.xPt, yPt: item.yPt + descentPt, widthPt: textWidthPt, heightPt: ascentPt - descentPt };
}

// Stamps one emitted LayoutText's box onto the ContentRun node that fragment came from -- the per-fragment stamping step every text-laying engine (engine.ts's flow and cell paths, slides.ts's shape path) runs right after pushing the item. A fragment with no runIndex (an empty paragraph's synthesised fallback run) or one whose index resolves to no node stamps nothing: there is no real content node to position, and fabricating a position on some other node would be worse than leaving it unplaced. The item is an argument rather than re-derived here so the frame always matches the exact item that was emitted, justify offsets and all.
export function stampFragmentFrame(runs: readonly ContentRun[], fragment: SourcedFragment, pageIndex: number, item: LayoutText, measurer: TextMeasurer, line: { readonly ascentPt: number; readonly descentPt: number }): void {
  if (fragment.runIndex === undefined) {
    return;
  }
  const run = runs[fragment.runIndex];
  if (run === undefined) {
    return;
  }
  stampFrame(run, pageIndex, textBoxForFragment(item, measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt), line.ascentPt, line.descentPt));
}

// Every LayoutDocument this package's own engines produce carries the package's pages array directly derivable from its own pages -- each rendered page's own size, indexed to match every node's own frames[].pageIndex (document-schema.js's DocumentPackageSchema contract). One helper rather than four per-engine copies of the same map.
export function packagePagesOf(pages: readonly LayoutPage[]): PageSize[] {
  return pages.map((page) => ({ widthPt: page.widthPt, heightPt: page.heightPt }));
}

// The LayoutDocument every engine's result carries as its `document` half -- pdf-codec's writePdf contract, unchanged by the frames fusion (the internal LayoutDocument stays the one shape writePdf consumes; frames are the additional record fused onto content).
export function layoutDocumentOf(metadata: LayoutMetadata, pages: LayoutPage[], images: Record<string, LayoutImageAsset>): LayoutDocument {
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata, pages, images };
}

// A nominal fallback text size, used only when a ContentRun/paragraph has no resolvable size of its own (a wholly empty paragraph, or a run whose cascade never set one) -- ContentParagraph/ContentRun don't retain the cascade-resolved default for this case, only what ended up on an actual run.
export const NOMINAL_TEXT_SIZE_PT = 18;

// An embedded formula has no surrounding run to inherit a font size from the way ordinary text does, so every layout engine in this package derives one from the embedded object's own declared frame (ContentEmbeddedObject.frame -- the ORIGINAL formula's own rendered size/position in the source document) via a two-pass fit, not a one-shot height heuristic: lay out once at a reference size to measure the formula's natural width and height, then rescale by the frame's own declared width and height so the laid-out box fits both, whichever is the binding constraint. layoutFormula's output is linear in sizePt (every measurement flows through toPt = designUnits / unitsPerEm * sizePt), so a single rescale reaches the fit with no iteration -- the old height/2 heuristic this replaced would overflow a genuinely stacked formula (a fraction inside a radical is taller than twice its base font size), rendering it larger than the frame the source document drew it at. Lives here rather than in any one engine because all three that render a formula (engine.ts's flow placement, slides.ts's shape placement, sheets.ts's cell-anchored placement) need the identical fit and there is nothing format-specific about it.
const MIN_FORMULA_SIZE_PT = 8;
const REFERENCE_FORMULA_SIZE_PT = 12;
export function formulaSizePtForFrame(mathml: readonly MathMlNode[], frame: Box, mathMetricsAt: (sizePt: number) => MathFontMetrics): number {
  const referenceMetrics = mathMetricsAt(REFERENCE_FORMULA_SIZE_PT);
  const { box } = layoutFormula(mathml, { metrics: referenceMetrics, sizePt: REFERENCE_FORMULA_SIZE_PT, color: COLOR_BLACK });
  // A docx OMML equation records no geometry of its own, so equationFrame synthesises widthPt 0 -- there is nothing to fit a width against in that case, so height alone drives the size (the old heuristic's intent), via an infinite widthScale that never wins the min.
  const heightScale = frame.heightPt / box.heightPt;
  const widthScale = frame.widthPt > 0 ? frame.widthPt / box.widthPt : Number.POSITIVE_INFINITY;
  return Math.max(MIN_FORMULA_SIZE_PT, REFERENCE_FORMULA_SIZE_PT * Math.min(heightScale, widthScale));
}

// A table row's own explicit height is present for essentially every real-world docx/pptx table; this is a nominal fallback exercised only for a hand-built or malformed table that omits it.
const FALLBACK_ROW_HEIGHT_PT = 20;

// Word-processor-conventional heading sizes -- Word/LibreOffice's own Heading1..6 defaults supply these via built-in template styles. Both markdown-codec's lowerHeading and odf.js's readOdtContent independently set only an abstract styleId: "Heading{N}" on a heading paragraph (the two packages don't depend on each other, but happen to already agree on this exact string convention) and never bake concrete bold/sizePt onto its runs -- unlike docx, where ooxml.js resolves the WordprocessingML style cascade into concrete run formatting before this layout engine ever sees a docx-sourced ContentDocument at all. This is this layout engine's own resolution step for that gap, applied only as a fallback when a run has no explicit bold/sizePt of its own.
//
// Deliberately NOT baked onto ContentRun at read time instead (src/markdown/read.ts once tried exactly that): it broke markdown's own write-side round-trip, because markdown-codec's writeMarkdownContent treats run.bold as "wrap in literal **...**" with no way to distinguish structural heading weight from authored inline emphasis -- baking it in would make every read-then-write round trip of a heading come back as `# **Heading**`. Resolving it here, at layout time, only affects what gets rendered to PDF/pptx-shape text -- the ContentDocument itself, and everything else that consumes it (editors, other conversions), is untouched.
// Exported for the odt scaffold (src/edit/odt/scaffold.ts), which writes one Heading_20_N common style per level so an odt this package builds renders its headings the same way odtToPdf does -- the single source of truth for the heading visual convention, shared by the PDF layout engine (below) and the ODF style definitions rather than duplicated.
export const HEADING_STYLES: Record<number, { bold: boolean; sizePt: number }> = {
  1: { bold: true, sizePt: 28 },
  2: { bold: true, sizePt: 22 },
  3: { bold: true, sizePt: 18 },
  4: { bold: true, sizePt: 14 },
  5: { bold: true, sizePt: 12 },
  6: { bold: true, sizePt: 11 },
};

// Resolves a paragraph's styleId into a heading style default, or undefined for a non-heading paragraph (including one carrying some other named style this package doesn't otherwise recognise).
export function headingStyleFor(styleId: string | undefined): { bold: boolean; sizePt: number } | undefined {
  if (styleId === undefined) return undefined;
  const match = /^Heading([1-6])$/.exec(styleId);
  if (match === null) return undefined;
  return HEADING_STYLES[Number(match[1])];
}

export function runFont(run: ContentRun, headingBold?: boolean): LayoutFont {
  const bold = run.bold ?? headingBold ?? false;
  return {
    family: run.fontFamily ?? DEFAULT_LAYOUT_FONT.family,
    weight: bold ? 'bold' : 'normal',
    style: run.italic === true ? 'italic' : 'normal',
  };
}

export function toStyledRuns(runs: readonly ContentRun[], fontScale = 1, headingStyle?: { bold: boolean; sizePt: number }): SourcedRun[] {
  return runs.map((run, runIndex) => ({
    text: run.text,
    font: runFont(run, headingStyle?.bold),
    sizePt: (run.sizePt ?? headingStyle?.sizePt ?? NOMINAL_TEXT_SIZE_PT) * fontScale,
    color: run.color ?? COLOR_BLACK,
    underline: run.underline,
    hyperlink: run.hyperlink,
    sourcePath: run.sourcePath,
    runIndex,
  }));
}

// A paragraph's runs, with a synthesised nominal fallback substituted when there are none at all -- so callers can wrap and measure unconditionally rather than special-casing an empty paragraph. The synthesised run carries no runIndex: it corresponds to no ContentRun node, so a stamping caller finds nothing to stamp -- the correct outcome, not a guard to work around.
export function effectiveStyledRuns(runs: readonly ContentRun[], fontScale = 1, headingStyle?: { bold: boolean; sizePt: number }): SourcedRun[] {
  const styled = toStyledRuns(runs, fontScale, headingStyle);
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
// ContentBorder.style ('solid' | 'dashed' | 'dotted' | 'double') now carries straight through onto the emitted LayoutLine's own `style` field, as of document-schema.js 2.1.0 adding that same optional enum to LayoutLineSchema/LayoutPathSchema -- the two layout kinds able to carry a stroke previously had nowhere to put it (LayoutLineSchema was kind/x1/y1/x2/y2/color/widthPt with no style field at all), so this was a genuine schema gap, not a shortcut, until that release closed it. pdf-codec's own write.ts (from 1.10.0) draws a non-solid style for real: a genuine PDF `d` dash-array operator for 'dashed'/'dotted', and 'double' as two hand-offset parallel strokes using its own internally-chosen offset constant, since the offset distance is nowhere in this model and pdf-codec is the one place a rendering choice for it needs to be made.
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
      const runs = effectiveStyledRuns(block.runs, 1, headingStyleFor(block.styleId));
      const lines = wrapRunsToWidth(runs, measurer, cellWidthPt);
      for (const line of lines) {
        max = Math.max(max, lineNaturalHeightPt(line, measurer, runs[0]!));
      }
    }
    colIndex += span;
  }
  return max;
}
