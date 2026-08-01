import type { ContentEmbeddedObjectBlock, ContentParagraph, ContentShape, ContentSlide, ContentTable, LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLink, LayoutPage, LayoutText } from 'document-content-model';
import { COLOR_BLACK, LAYOUT_FORMAT_VERSION } from 'document-content-model';
import { layoutFormula } from '../mathml';
import type { Box } from '../model/geometry';
import { flipY } from '../model/geometry';
import type { ContentDocument } from '../model/content';
import type { EmbeddedFormula, PositionedFormula } from '../model/formula';
import type { Point } from '../pdf/matrix';
import { rotatePointAboutCenter } from '../pdf/matrix';
import { loadMathFont } from '../pdf/math-font';
import type { TextMeasurer } from '../pdf/measure';
import { wrapRunsToWidth } from '../pdf/text-layout';
import { alignmentOffsetPt, effectiveStyledRuns, estimateRowHeightPt, lineNaturalHeightPt, registerImage, sumColumnWidthsPt } from './shared';

// ContentDocument (the presentation variant) -> LayoutDocument: pptx's tractable layout direction. No pagination -- one slide is always exactly one PDF page (slide size maps directly to the page's own widthPt/heightPt) -- and no group-transform resolution either, since src/ooxml/pptx/read.ts already flattened every group into absolute shape positions at read time. What's left is genuinely just: wrap each shape's text within its own box (reusing the exact wrapRunsToWidth docx also uses), place images at their shape's frame, render table grids directly from explicit column widths/row heights, and apply the one deliberate Y-flip from OOXML's top-left/y-down space into PDF's bottom-left/y-up space.

export interface SlidesLayoutOptions {
  readonly measurer: TextMeasurer;
  // Raw MathML for every embedded formula shape in `doc`, keyed by that shape's own placeholder block sourcePath -- see src/odf/odp/read.ts's readOdpContent for how this map is built, and src/layout/engine.ts's own EngineLayoutOptions.formulas for the identical mechanism on the wordprocessing side.
  readonly formulas?: ReadonlyMap<string, EmbeddedFormula>;
}

export interface PresentationLayoutResult {
  readonly document: LayoutDocument;
  // Every embedded formula actually rendered via src/mathml, already positioned in PDF page space -- see src/layout/engine.ts's own WordprocessingLayoutResult.formulas for why this can't travel through LayoutDocument.pages[].items itself.
  readonly formulas: readonly PositionedFormula[];
}

type PresentationContentDocument = Extract<ContentDocument, { kind: 'presentation' }>;

// See src/layout/engine.ts's own identical constant/function for the reasoning -- a formula shape's own declared frame height is the best available proxy for the source formula's own rendered size, absent any surrounding run to inherit a size from.
const MIN_FORMULA_SIZE_PT = 8;
function formulaSizePtFromFrame(frameHeightPt: number): number {
  return Math.max(MIN_FORMULA_SIZE_PT, frameHeightPt / 2);
}

// Threaded into convertShape (optionally -- see that function's own comment) so a formula-bearing shape can resolve its own raw MathML and record its positioned result. `positioned` is mutated in place, the same "shared accumulator threaded through a layout pass" pattern src/layout/engine.ts's own `formulas` parameter uses.
export interface ShapeFormulaContext {
  readonly formulas: ReadonlyMap<string, EmbeddedFormula>;
  readonly pageIndex: number;
  readonly positioned: PositionedFormula[];
}

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
        sourcePath: fragment.sourcePath,
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
          sourcePath: fragment.sourcePath,
        };
        out.push(link);
      }
    }
    cursorYDown += scaledLineHeightPt;
  });

  cursorYDown += paragraph.spacingAfterPt ?? 0;
  return cursorYDown;
}

// Renders a table's grid directly from its own explicit column widths and row heights (falling back to content-derived estimates only when a row's own height is missing) rather than proportionally estimating, since pptx tables -- unlike docx's -- already carry this geometry. Cell background rects are skipped entirely when the containing shape is rotated: LayoutRect has no rotation field of its own, and a misplaced (unrotated) rect would be a worse defect than a missing one for what is, in practice, a rare case.
function layoutTable(table: ContentTable, contentLeftXDown: number, contentWidthPt: number, startYDown: number, slideHeightPt: number, placement: ShapePlacement, measurer: TextMeasurer, out: LayoutItem[]): number {
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

      if (cell.background !== undefined && placement.layoutRotationDeg === undefined) {
        const cellFrame = flipY({ xPt: cellXDown, yPt: cursorYDown, widthPt: cellWidthPt, heightPt: rowHeightPt }, slideHeightPt);
        // ContentTableCell has no sourcePath of its own (only ContentTable does -- see document-content-model), so a per-cell background rect can only be attributed at the table's own granularity, not to the specific cell.
        out.push({ kind: 'rect', xPt: cellFrame.xPt, yPt: cellFrame.yPt, widthPt: cellFrame.widthPt, heightPt: cellFrame.heightPt, fill: cell.background, sourcePath: table.sourcePath });
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

// A formula shape's own placeholder block (see src/odf/odp/read.ts's readOdpContent) is the shape's ONLY block -- odp's own detection replaces a formula-bearing shape's blocks outright rather than appending alongside other content, unlike odt's paragraph-flow case -- so this places the resolved MathBox directly at the shape's own frame, the same "one block, one position" treatment layoutImageFlow (src/layout/engine.ts) and this function's own image branch above already give an image block. Rotation is deliberately NOT applied to a formula shape (unlike text/image, both routed through `placement.place`): src/pdf/write.ts's own formula content-stream emission has no rotated-CID-text path, only translation -- a real, tracked, bounded gap (position is correct; a rotated formula shape renders unrotated), not a silent one.
function layoutShapeFormula(block: ContentEmbeddedObjectBlock, flippedFrame: Box, formulaContext: ShapeFormulaContext): void {
  const embedded = block.sourcePath === undefined ? undefined : formulaContext.formulas.get(block.sourcePath);
  if (embedded === undefined) {
    return;
  }
  const sizePt = formulaSizePtFromFrame(block.frame.heightPt);
  const metrics = loadMathFont().metricsAt(sizePt);
  const { box } = layoutFormula(embedded.mathml, { metrics, sizePt, color: COLOR_BLACK });
  formulaContext.positioned.push({ pageIndex: formulaContext.pageIndex, xPt: flippedFrame.xPt, yPt: flippedFrame.yPt, box });
}

// Exported for reuse by src/layout/drawing.ts: a drawing page's own ContentShape entries (draw:frame text/table/image content, and unrecognised custom-shape presets salvaged as text -- see odf.js's typed/draw/shapes.ts) are the exact same ContentShapeSchema-typed value a slide's shapes are, so odg gets slide-quality paragraph flow, image placement, and table layout for free rather than a second, drifting copy of this function. `formulaContext` is optional and appended last precisely so drawing.ts's own existing 5-argument call site keeps compiling unchanged -- odg embedded-formula support is out of this task's own stated scope (odt/ods/odp only), so a formula block reached with no formulaContext simply falls through unhandled, the same as it always did.
export function convertShape(shape: ContentShape, slideHeightPt: number, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>, out: LayoutItem[], formulaContext?: ShapeFormulaContext): void {
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
      const imageItem: LayoutImage = { kind: 'image', imageId, xPt: placed.x, yPt: placed.y, widthPt: flippedFrame.widthPt, heightPt: flippedFrame.heightPt, rotationDeg: placement.layoutRotationDeg, sourcePath: block.sourcePath };
      out.push(imageItem);
    } else if (block.kind === 'table') {
      cursorYDown = layoutTable(block, contentLeftXDown, contentWidthPt, cursorYDown, slideHeightPt, placement, measurer, out);
    } else if (block.kind === 'embeddedObject' && block.objectKind === 'formula' && formulaContext !== undefined) {
      layoutShapeFormula(block, flippedFrame, formulaContext);
    }
    // 'pageBreak' blocks never occur in a pptx-sourced ContentDocument (only docx's reader emits them). Every other 'embeddedObject' objectKind (wordprocessing/presentation/spreadsheet/drawing), and a 'formula' block reached with no formulaContext, fall through unhandled -- present only for ContentBlock's type exhaustiveness.
  }
}

function convertSlide(slide: ContentSlide, slideIndex: number, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>, formulas: ReadonlyMap<string, EmbeddedFormula> | undefined, positioned: PositionedFormula[]): LayoutPage {
  const items: LayoutItem[] = [];
  const formulaContext: ShapeFormulaContext | undefined = formulas === undefined ? undefined : { formulas, pageIndex: slideIndex, positioned };
  for (const shape of slide.shapes) {
    convertShape(shape, slide.size.heightPt, measurer, images, items, formulaContext);
  }
  // Notes are carried as a private page-dictionary entry (LayoutPage.notes, see pdf/write.ts), never painted as visible content -- PDF has no native concept of hidden presenter notes, so this is purely a round-trip mechanism for this package's own pptxToPdf/pdfToPptx pair, not a real PDF feature.
  return { widthPt: slide.size.widthPt, heightPt: slide.size.heightPt, items, ...(slide.notes.length > 0 ? { notes: slide.notes } : {}) };
}

export function convertPresentationToLayout(doc: PresentationContentDocument, options: SlidesLayoutOptions): PresentationLayoutResult {
  const images: Record<string, LayoutImageAsset> = {};
  const formulas: PositionedFormula[] = [];
  const pages = doc.slides.map((slide, slideIndex) => convertSlide(slide, slideIndex, options.measurer, images, options.formulas, formulas));
  return { document: { formatVersion: LAYOUT_FORMAT_VERSION, metadata: doc.metadata, pages, images }, formulas };
}
