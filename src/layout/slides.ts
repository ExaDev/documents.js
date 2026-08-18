import type { ContentDocument, ContentEmbeddedObjectBlock, ContentParagraph, ContentShape, ContentSlide, ContentTable, PageSize } from 'document-schema.js';
import { COLOR_BLACK } from 'document-schema.js';
import { layoutFormula } from '../mathml/layout';
import type { Box } from 'document-schema.js';
import { flipY } from '../model/geometry';
import { formulaOfBlock } from '../model/formula';
import type { MathFontMetrics, Point, PositionedFormula, TextMeasurer } from 'document-schema.js';
import { wrapRunsToWidth } from './text-layout';
import { rotatePointAboutCenter } from '../model/geometry';
import { alignmentOffsetPt, effectiveStyledRuns, estimateRowHeightPt, formulaSizePtForFrame, justifyLineGapsPt, lineNaturalHeightPt, layoutDocumentOf, packagePagesOf, registerImage, stampFragmentFrame, stampFrame, sumColumnWidthsPt } from './shared';
import type { LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLink, LayoutPage, LayoutText } from 'pdf-codec';

// ContentDocument (the presentation variant) -> LayoutDocument: pptx's tractable layout direction. No pagination -- one slide is always exactly one PDF page (slide size maps directly to the page's own widthPt/heightPt) -- and no group-transform resolution either, since src/ooxml/pptx/read.ts already flattened every group into absolute shape positions at read time. What's left is genuinely just: wrap each shape's text within its own box (reusing the exact wrapRunsToWidth docx also uses), place images at their shape's frame, render table grids directly from explicit column widths/row heights, and apply the one deliberate Y-flip from OOXML's top-left/y-down space into PDF's bottom-left/y-up space.

export interface SlidesLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly mathMetricsAt: (sizePt: number) => MathFontMetrics;
}

export interface PresentationLayoutResult {
  readonly document: LayoutDocument;
  // Every embedded formula actually rendered via src/mathml, already positioned in PDF page space -- see src/layout/engine.ts's own WordprocessingLayoutResult.formulas for why this can't travel through LayoutDocument.pages[].items itself.
  readonly formulas: readonly PositionedFormula[];
  // The DocumentPackage's own pages array (each rendered page's size, indexed to match every content node's own frames[].pageIndex) -- the input `doc` argument itself comes back with frames stamped in place, which together with this array is the fused unified package a conversion reports through onDocument.
  readonly pages: readonly PageSize[];
}

type PresentationContentDocument = Extract<ContentDocument, { kind: 'presentation' }>;

// Threaded into convertShape (optionally -- see that function's own comment) so a formula-bearing shape can record its positioned result. The MathML itself comes from the block's own document (src/model/formula.ts's formulaOfBlock), so this carries only what a shape genuinely cannot know on its own: which page it is being laid out onto, and the shared accumulator to record into. `positioned` is mutated in place, the same "shared accumulator threaded through a layout pass" pattern src/layout/engine.ts's own `formulas` parameter uses.
export interface ShapeFormulaContext {
  readonly pageIndex: number;
  readonly positioned: PositionedFormula[];
  readonly mathMetricsAt: (sizePt: number) => MathFontMetrics;
}

interface ShapePlacement {
  place(point: Point): Point;
  readonly layoutRotationDeg: number | undefined;
}

// DrawingML rotates a shape about its own bounding-box centre, clockwise; content-write.ts's writer rotates about whatever anchor point it's given, counter-clockwise. rotatePointAboutCenter (pdf-codec's matrix.ts) reconciles the two: feeding it an unrotated point and the shape's own centre computes exactly the point a caller must pass as a LayoutItem's xPt/yPt for the writer's own corner-pivot rotation to reproduce PowerPoint's centre-pivot rotation.
function shapePlacement(flippedFrame: Box, rotationDeg: number | undefined): ShapePlacement {
  if (rotationDeg === undefined || rotationDeg === 0) {
    return { place: (p) => p, layoutRotationDeg: undefined };
  }
  const ccwDeg = -rotationDeg;
  const center: Point = { x: flippedFrame.xPt + flippedFrame.widthPt / 2, y: flippedFrame.yPt + flippedFrame.heightPt / 2 };
  return { place: (p) => rotatePointAboutCenter(p, center, ccwDeg), layoutRotationDeg: ccwDeg };
}

// Lays out one paragraph's wrapped lines, appending LayoutText items (and a LayoutLink per hyperlinked fragment) to `out`, and returns the y-down cursor position immediately after the paragraph (including its own spacingAfterPt).
function layoutParagraph(
  paragraph: ContentParagraph,
  contentLeftXDown: number,
  contentWidthPt: number,
  startYDown: number,
  slideHeightPt: number,
  pageIndex: number,
  placement: ShapePlacement,
  fontScale: number,
  spacingScale: number,
  measurer: TextMeasurer,
  out: LayoutItem[],
): number {
  let cursorYDown = startYDown + (paragraph.spacingBeforePt ?? 0);

  const effectiveRuns = effectiveStyledRuns(paragraph.runs, fontScale);
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
    // Only a WRAPPED, non-final line of a justified paragraph gets its inter-word gaps stretched -- see src/layout/engine.ts's identical note on the same standard justification convention.
    const justifyGapsPt = paragraph.alignment === 'justify' && lineIndex < lines.length - 1 ? justifyLineGapsPt(line, paragraphWidthPt, measurer) : undefined;

    line.fragments.forEach((fragment, fragmentIndex) => {
      const unrotated: Point = { x: paragraphLeftXDown + firstLineIndentPt + alignOffsetPt + fragment.xOffsetPt + (justifyGapsPt?.[fragmentIndex] ?? 0), y: slideHeightPt - baselineYDown };
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
        sourcePath: fragment.sourcePath,
      };
      out.push(textItem);
      // One frame per rendered placement, on the run that placement renders (the placement transform is already baked into the item's own xPt/yPt, so the frame matches the placed geometry exactly); a hyperlinked fragment's LayoutLink rides the same placement and stamps nothing additional.
      stampFragmentFrame(paragraph.runs, fragment, pageIndex, textItem, measurer, line);

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
          sourcePath: fragment.sourcePath,
        };
        out.push(link);
      }
    });
    cursorYDown += scaledLineHeightPt;
  });

  cursorYDown += paragraph.spacingAfterPt ?? 0;
  return cursorYDown;
}

// Renders a table's grid directly from its own explicit column widths and row heights (falling back to content-derived estimates only when a row's own height is missing) rather than proportionally estimating, since pptx tables -- unlike docx's -- already carry this geometry. Cell background rects are skipped entirely when the containing shape is rotated: LayoutRect has no rotation field of its own, and a misplaced (unrotated) rect would be a worse defect than a missing one for what is, in practice, a rare case.
function layoutTable(table: ContentTable, contentLeftXDown: number, contentWidthPt: number, startYDown: number, slideHeightPt: number, pageIndex: number, placement: ShapePlacement, measurer: TextMeasurer, out: LayoutItem[]): number {
  let cursorYDown = startYDown;
  const gridWidthPt = table.columnWidthsPt.reduce((sum, w) => sum + w, 0);
  const scale = gridWidthPt > 0 ? contentWidthPt / gridWidthPt : 1;

  for (const row of table.rows) {
    const rowHeightPt = row.heightPt ?? estimateRowHeightPt(row, measurer, table.columnWidthsPt, scale);
    let cellXDown = contentLeftXDown;
    let colIndex = 0;

    for (const cell of row.cells) {
      const span = cell.colSpan ?? 1;
      const cellWidthPt = sumColumnWidthsPt(table.columnWidthsPt, colIndex, span) * scale;

      // The cell's own frame stamps the CELL node (PDF-space, unrotated -- the same no-rotation constraint the background rect below already obeys); the runs inside stamp their own frames through layoutParagraph below.
      const cellFrame = flipY({ xPt: cellXDown, yPt: cursorYDown, widthPt: cellWidthPt, heightPt: rowHeightPt }, slideHeightPt);
      if (placement.layoutRotationDeg === undefined) {
        stampFrame(cell, pageIndex, cellFrame);
      }
      if (cell.background !== undefined && placement.layoutRotationDeg === undefined) {
        // ContentTableCell has no sourcePath of its own (only ContentTable does -- see document-schema.js), so a per-cell background rect can only be attributed at the table's own granularity, not to the specific cell.
        out.push({ kind: 'rect', xPt: cellFrame.xPt, yPt: cellFrame.yPt, widthPt: cellFrame.widthPt, heightPt: cellFrame.heightPt, fill: cell.background, sourcePath: table.sourcePath });
      }

      let cellCursorYDown = cursorYDown;
      for (const block of cell.blocks) {
        if (block.kind === 'paragraph') {
          cellCursorYDown = layoutParagraph(block, cellXDown, cellWidthPt, cellCursorYDown, slideHeightPt, pageIndex, placement, 1, 1, measurer, out);
        }
      }

      cellXDown += cellWidthPt;
      colIndex += span;
    }
    cursorYDown += rowHeightPt;
  }
  return cursorYDown;
}

// A formula shape's own embedded-object block (see src/odf/odp/read.ts's readOdpContent) is the shape's ONLY block -- odp's own detection replaces a formula-bearing shape's blocks outright rather than appending alongside other content, unlike odt's paragraph-flow case -- so this places the resolved MathBox directly at the shape's own frame, the same "one block, one position" treatment layoutImageFlow (src/layout/engine.ts) and this function's own image branch above already give an image block. Rotation is deliberately NOT applied to a formula shape (unlike text/image, both routed through `placement.place`): pdf-codec's write.ts's own formula content-stream emission has no rotated-CID-text path, only translation -- a real, tracked, bounded gap (position is correct; a rotated formula shape renders unrotated), not a silent one.
function layoutShapeFormula(block: ContentEmbeddedObjectBlock, flippedFrame: Box, formulaContext: ShapeFormulaContext): void {
  const formula = formulaOfBlock(block);
  if (formula === undefined || formula.mathml.length === 0) {
    return;
  }
  const sizePt = formulaSizePtForFrame(formula.mathml, block.frame, formulaContext.mathMetricsAt);
  const metrics = formulaContext.mathMetricsAt(sizePt);
  const { box } = layoutFormula(formula.mathml, { metrics, sizePt, color: COLOR_BLACK });
  formulaContext.positioned.push({ pageIndex: formulaContext.pageIndex, xPt: flippedFrame.xPt, yPt: flippedFrame.yPt, box });
  // The block's frame records where the formula was placed even though its glyphs render through the formulas side channel rather than as a LayoutItem -- see engine.ts's identical note on its own formula-flow stamp.
  stampFrame(block, formulaContext.pageIndex, flippedFrame);
}

// Exported for reuse by src/layout/drawing.ts: a drawing page's own ContentShape entries (draw:frame text/table/image content, and unrecognised custom-shape presets salvaged as text -- see odf.js's typed/draw/shapes.ts) are the exact same ContentShapeSchema-typed value a slide's shapes are, so odg gets slide-quality paragraph flow, image placement, and table layout for free rather than a second, drifting copy of this function. `formulaContext` is optional and appended last precisely so drawing.ts's own existing 5-argument call site keeps compiling unchanged -- readOdgContent runs no embedded-formula detection pass of its own (src/odf/odg/read.ts), so a drawing page never carries a formula block for that call site to need one for, and convertDrawingToLayout has no PositionedFormula output to record one into either.
export function convertShape(shape: ContentShape, slideHeightPt: number, pageIndex: number, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>, out: LayoutItem[], formulaContext?: ShapeFormulaContext): void {
  const flippedFrame = flipY(shape.frame, slideHeightPt);
  // The shape's own placement, stamped on the shape node itself (PDF-space) -- a shape with no renderable content of its own (an empty text box) still records where it sat, and a consumer walking frames knows which page a shape belongs to without consulting any second tree.
  stampFrame(shape, pageIndex, flippedFrame);
  const placement = shapePlacement(flippedFrame, shape.rotationDeg);
  const contentLeftXDown = shape.frame.xPt + shape.insetLeftPt;
  const contentWidthPt = Math.max(0, shape.frame.widthPt - shape.insetLeftPt - shape.insetRightPt);
  const fontScale = shape.fontScale ?? 1;
  const spacingScale = 1 - (shape.lineSpacingReduction ?? 0);
  let cursorYDown = shape.frame.yPt + shape.insetTopPt;

  for (const block of shape.blocks) {
    if (block.kind === 'paragraph') {
      cursorYDown = layoutParagraph(block, contentLeftXDown, contentWidthPt, cursorYDown, slideHeightPt, pageIndex, placement, fontScale, spacingScale, measurer, out);
    } else if (block.kind === 'image') {
      const imageId = registerImage(block, images);
      const placed = placement.place({ x: flippedFrame.xPt, y: flippedFrame.yPt });
      const imageItem: LayoutImage = { kind: 'image', imageId, xPt: placed.x, yPt: placed.y, widthPt: flippedFrame.widthPt, heightPt: flippedFrame.heightPt, rotationDeg: placement.layoutRotationDeg, sourcePath: block.sourcePath };
      out.push(imageItem);
      stampFrame(block, pageIndex, { xPt: placed.x, yPt: placed.y, widthPt: imageItem.widthPt, heightPt: imageItem.heightPt });
    } else if (block.kind === 'table') {
      cursorYDown = layoutTable(block, contentLeftXDown, contentWidthPt, cursorYDown, slideHeightPt, pageIndex, placement, measurer, out);
    } else if (block.kind === 'embeddedObject' && block.objectKind === 'formula' && formulaContext !== undefined) {
      layoutShapeFormula(block, flippedFrame, formulaContext);
    }
    // 'pageBreak' blocks never occur in a pptx-sourced ContentDocument (only docx's reader emits them). Every other 'embeddedObject' objectKind (wordprocessing/presentation/spreadsheet/drawing), and a 'formula' block reached with no formulaContext, fall through unhandled -- present only for ContentBlock's type exhaustiveness. 'constructStart'/'constructEnd' fall through the same way, deliberately: a construct marker is a zero-width boundary sentinel with no content of its own to render, so skipping it here loses nothing -- the paragraphs it wraps are separate blocks in this same flow and lay out exactly as if the marker were not there.
  }
}

function convertSlide(slide: ContentSlide, slideIndex: number, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>, positioned: PositionedFormula[], mathMetricsAt: (sizePt: number) => MathFontMetrics): LayoutPage {
  const items: LayoutItem[] = [];
  const formulaContext: ShapeFormulaContext = { pageIndex: slideIndex, positioned, mathMetricsAt };
  for (const shape of slide.shapes) {
    convertShape(shape, slide.size.heightPt, slideIndex, measurer, images, items, formulaContext);
  }
  // Notes are carried as a private page-dictionary entry (LayoutPage.notes, see pdf/write.ts), never painted as visible content -- PDF has no native concept of hidden presenter notes, so this is purely a round-trip mechanism for this package's own pptxToPdf/pdfToPptx pair, not a real PDF feature.
  return { widthPt: slide.size.widthPt, heightPt: slide.size.heightPt, items, ...(slide.notes.length > 0 ? { notes: slide.notes } : {}) };
}

export function convertPresentationToLayout(doc: PresentationContentDocument, options: SlidesLayoutOptions): PresentationLayoutResult {
  const images: Record<string, LayoutImageAsset> = {};
  const formulas: PositionedFormula[] = [];
  const pages = doc.slides.map((slide, slideIndex) => convertSlide(slide, slideIndex, options.measurer, images, formulas, options.mathMetricsAt));
  // `doc` itself now carries every placement this pass computed, stamped in place on its own nodes (frames); the returned pages array plus that mutated content is the fused unified DocumentPackage a conversion reports through onDocument.
  return { document: layoutDocumentOf(doc.metadata, pages, images), formulas, pages: packagePagesOf(pages) };
}
