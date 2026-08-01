import type { ContentEmbeddedObjectBlock, ContentImageBlock, ContentParagraph, ContentSection, ContentTable, LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLink, LayoutPage, LayoutText } from 'document-content-model';
import { COLOR_BLACK, LAYOUT_FORMAT_VERSION } from 'document-content-model';
import { layoutFormula } from '../mathml';
import { flipY } from '../model/geometry';
import type { ContentDocument } from '../model/content';
import type { EmbeddedFormula } from '../model/formula';
import type { PositionedFormula, TextMeasurer } from 'pdf-codec';
import { loadMathFont, wrapRunsToWidth } from 'pdf-codec';
import { alignmentOffsetPt, effectiveStyledRuns, estimateRowHeightPt, lineNaturalHeightPt, registerImage, sumColumnWidthsPt } from './shared';

// ContentDocument (the wordprocessing variant) -> LayoutDocument: docx's hard direction. A docx page isn't a fixed canvas the way a pptx slide is -- content flows and paginates, so this engine tracks a vertical cursor per page and starts a new page whenever the next line (or table row) would overflow the current one, honoring explicit page breaks, w:pageBreakBefore, and a per-section page-size/margin change. Headers/footers and live PAGE/NUMPAGES substitution are not laid out here -- src/ooxml/docx/read.ts doesn't read them either, a deliberate, tracked narrowing from the plan's original scope (see that file's own module doc).

export interface EngineLayoutOptions {
  readonly measurer: TextMeasurer;
  // Raw MathML for every embedded formula block in `doc`, keyed by that block's own sourcePath -- see src/model/formula.ts's own comment on why a formula's real content can't live inside the ContentDocument itself, and src/odf/odt/read.ts's readOdtContent for how this map is built. Omitted (or missing an entry for a particular formula block) falls back to rendering that block's own placeholder ContentDocument as ordinary text -- see layoutEmbeddedObjectFlow below.
  readonly formulas?: ReadonlyMap<string, EmbeddedFormula>;
}

export interface WordprocessingLayoutResult {
  readonly document: LayoutDocument;
  // Every embedded formula actually rendered via src/mathml, already positioned in PDF page space (bottom-left origin, y-up) -- pdf-codec's write.ts's own WritePdfOptions.formulas consumes this directly. See that module's own comment for why a formula's CID-font glyph runs can't travel through LayoutDocument.pages[].items itself.
  readonly formulas: readonly PositionedFormula[];
}

type WordprocessingContentDocument = Extract<ContentDocument, { kind: 'wordprocessing' }>;

// A formula embedded inline in running text has no surrounding run to inherit a font size from the way ordinary text does, so this engine picks one from the embedded object's own declared frame height (ContentEmbeddedObjectBlock.frame.heightPt -- the ORIGINAL formula's own rendered size in the source document): a single-line formula's total height (ascent + descent across its tallest/deepest element) is typically a little over twice its base font size, so half the frame height is a reasonable single-pass estimate. This is deliberately a one-shot heuristic, not an iterative fit-to-height search -- close enough for a faithful visual approximation (this package's own established bar -- see the README's Fidelity section), not a guarantee of reproducing the source's exact point size.
const MIN_FORMULA_SIZE_PT = 8;
function formulaSizePtFromFrame(frameHeightPt: number): number {
  return Math.max(MIN_FORMULA_SIZE_PT, frameHeightPt / 2);
}

// Mutated in place across an entire section's content: `items`/`cursorYDown` describe the page currently being built. Passing this single object around (rather than reassigning a `let` the way a simpler "current page" variable would) is what lets nested layout functions (table cells, individual lines) trigger a page break mid-paragraph or mid-table without every caller needing to thread a replacement value back up.
interface FlowState {
  items: LayoutItem[];
  cursorYDown: number;
}

function newFlowState(section: ContentSection): FlowState {
  return { items: [], cursorYDown: section.margins.topPt };
}

function flushPage(state: FlowState, section: ContentSection, pages: LayoutPage[]): void {
  pages.push({ widthPt: section.pageSize.widthPt, heightPt: section.pageSize.heightPt, items: state.items });
  state.items = [];
  state.cursorYDown = section.margins.topPt;
}

// Starts a fresh page only when there is already content on the current one and the next item wouldn't fit -- an empty page is never flushed just because a single, page-exceeding item doesn't fit either (that item is placed on the fresh page regardless and simply overflows its bottom margin, the same "at least make progress" guarantee pdf-codec's text-layout.ts's own emergency word-split gives at the character level).
function ensureRoom(state: FlowState, section: ContentSection, pages: LayoutPage[], neededHeightPt: number, contentBottomYDown: number): void {
  if (state.items.length > 0 && state.cursorYDown + neededHeightPt > contentBottomYDown) {
    flushPage(state, section, pages);
  }
}

// Lays out one paragraph's wrapped lines directly into `state`, checking for a page break before each line (so a paragraph can split across a page boundary, unlike pptx's shape-bounded text). spacingBeforePt is skipped when the paragraph starts a fresh, otherwise-empty page -- the same "don't stack whitespace at the top of a page" behaviour real word processors apply.
function layoutParagraphFlow(
  paragraph: ContentParagraph,
  section: ContentSection,
  pages: LayoutPage[],
  state: FlowState,
  contentLeftXDown: number,
  contentWidthPt: number,
  contentBottomYDown: number,
  measurer: TextMeasurer,
): void {
  if (state.items.length > 0) {
    state.cursorYDown += paragraph.spacingBeforePt ?? 0;
  }

  const effectiveRuns = effectiveStyledRuns(paragraph.runs);
  const fallbackRun = effectiveRuns[0]!;
  const paragraphLeftXDown = contentLeftXDown + (paragraph.indentLeftPt ?? 0);
  const paragraphWidthPt = Math.max(0, contentWidthPt - (paragraph.indentLeftPt ?? 0));
  const lines = wrapRunsToWidth(effectiveRuns, measurer, paragraphWidthPt);

  lines.forEach((line, lineIndex) => {
    const lineHeightPt = lineNaturalHeightPt(line, measurer, fallbackRun) * (paragraph.lineSpacing ?? 1);
    ensureRoom(state, section, pages, lineHeightPt, contentBottomYDown);

    const baselineYDown = state.cursorYDown + line.ascentPt;
    // First-line indent shifts only where the first line starts, not its wrap point -- see src/layout/slides.ts's identical note on the same simplification.
    const firstLineIndentPt = lineIndex === 0 ? (paragraph.indentFirstLinePt ?? 0) : 0;
    const alignOffsetPt = alignmentOffsetPt(paragraph.alignment, paragraphWidthPt, line.widthPt);

    for (const fragment of line.fragments) {
      const xPt = paragraphLeftXDown + firstLineIndentPt + alignOffsetPt + fragment.xOffsetPt;
      const yPt = section.pageSize.heightPt - baselineYDown;
      const textItem: LayoutText = {
        kind: 'text',
        text: fragment.text,
        xPt,
        yPt,
        font: fragment.font,
        sizePt: fragment.sizePt,
        color: fragment.color,
        underline: fragment.underline,
        sourcePath: fragment.sourcePath,
      };
      state.items.push(textItem);

      if (fragment.hyperlink !== undefined) {
        const fragmentWidthPt = measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt);
        const link: LayoutLink = {
          kind: 'link',
          uri: fragment.hyperlink,
          xPt,
          yPt: section.pageSize.heightPt - baselineYDown + line.descentPt,
          widthPt: fragmentWidthPt,
          heightPt: line.ascentPt - line.descentPt,
          sourcePath: fragment.sourcePath,
        };
        state.items.push(link);
      }
    }
    state.cursorYDown += lineHeightPt;
  });

  state.cursorYDown += paragraph.spacingAfterPt ?? 0;
}

// A simpler variant for text inside a table cell: the row's own row-atomic placement (see layoutTableFlow) already guaranteed the whole row fits before any cell content is laid out, so no page-break checking happens per line here -- only wrapping and stacking, returning the new cursor position. Nested tables inside a cell are not laid out (read.ts can represent one recursively, but rendering one is out of v1 scope -- rare in practice, and cheap to add later without touching this function's contract).
function layoutParagraphInCell(paragraph: ContentParagraph, cellLeftXDown: number, cellWidthPt: number, startYDown: number, pageHeightPt: number, measurer: TextMeasurer, out: LayoutItem[]): number {
  let cursorYDown = startYDown + (paragraph.spacingBeforePt ?? 0);
  const effectiveRuns = effectiveStyledRuns(paragraph.runs);
  const fallbackRun = effectiveRuns[0]!;
  const paragraphLeftXDown = cellLeftXDown + (paragraph.indentLeftPt ?? 0);
  const paragraphWidthPt = Math.max(0, cellWidthPt - (paragraph.indentLeftPt ?? 0));
  const lines = wrapRunsToWidth(effectiveRuns, measurer, paragraphWidthPt);

  lines.forEach((line, lineIndex) => {
    const lineHeightPt = lineNaturalHeightPt(line, measurer, fallbackRun) * (paragraph.lineSpacing ?? 1);
    const baselineYDown = cursorYDown + line.ascentPt;
    const firstLineIndentPt = lineIndex === 0 ? (paragraph.indentFirstLinePt ?? 0) : 0;
    const alignOffsetPt = alignmentOffsetPt(paragraph.alignment, paragraphWidthPt, line.widthPt);
    for (const fragment of line.fragments) {
      out.push({
        kind: 'text',
        text: fragment.text,
        xPt: paragraphLeftXDown + firstLineIndentPt + alignOffsetPt + fragment.xOffsetPt,
        yPt: pageHeightPt - baselineYDown,
        font: fragment.font,
        sizePt: fragment.sizePt,
        color: fragment.color,
        underline: fragment.underline,
        sourcePath: fragment.sourcePath,
      });
    }
    cursorYDown += lineHeightPt;
  });

  return cursorYDown + (paragraph.spacingAfterPt ?? 0);
}

// Row-atomic: a row that doesn't fit in the remaining space on the current page moves to a fresh page as a whole, never splitting its own content across the boundary (cell-level splitting would roughly double the paginator's complexity for what is, in practice, a rare case -- see the implementation plan's own reasoning). Column widths scale proportionally to fit the available content width.
function layoutTableFlow(table: ContentTable, section: ContentSection, pages: LayoutPage[], state: FlowState, contentLeftXDown: number, contentWidthPt: number, contentBottomYDown: number, measurer: TextMeasurer): void {
  const gridWidthPt = table.columnWidthsPt.reduce((sum, w) => sum + w, 0);
  const scale = gridWidthPt > 0 ? contentWidthPt / gridWidthPt : 1;

  for (const row of table.rows) {
    const rowHeightPt = row.heightPt ?? estimateRowHeightPt(row, measurer, table.columnWidthsPt, scale);
    ensureRoom(state, section, pages, rowHeightPt, contentBottomYDown);

    let cellXDown = contentLeftXDown;
    let colIndex = 0;
    for (const cell of row.cells) {
      const span = cell.colSpan ?? 1;
      const cellWidthPt = sumColumnWidthsPt(table.columnWidthsPt, colIndex, span) * scale;

      if (cell.background !== undefined) {
        const cellFrame = flipY({ xPt: cellXDown, yPt: state.cursorYDown, widthPt: cellWidthPt, heightPt: rowHeightPt }, section.pageSize.heightPt);
        // ContentTableCell has no sourcePath of its own (only ContentTable does -- see document-content-model), so a per-cell background rect can only be attributed at the table's own granularity, not to the specific cell.
        state.items.push({ kind: 'rect', xPt: cellFrame.xPt, yPt: cellFrame.yPt, widthPt: cellFrame.widthPt, heightPt: cellFrame.heightPt, fill: cell.background, sourcePath: table.sourcePath });
      }

      let cellCursorYDown = state.cursorYDown;
      for (const block of cell.blocks) {
        if (block.kind === 'paragraph') {
          cellCursorYDown = layoutParagraphInCell(block, cellXDown, cellWidthPt, cellCursorYDown, section.pageSize.heightPt, measurer, state.items);
        }
      }

      cellXDown += cellWidthPt;
      colIndex += span;
    }
    state.cursorYDown += rowHeightPt;
  }
}

function layoutImageFlow(block: ContentImageBlock, section: ContentSection, pages: LayoutPage[], state: FlowState, contentLeftXDown: number, contentBottomYDown: number, images: Record<string, LayoutImageAsset>): void {
  ensureRoom(state, section, pages, block.heightPt, contentBottomYDown);
  const imageId = registerImage(block, images);
  const flippedFrame = flipY({ xPt: contentLeftXDown, yPt: state.cursorYDown, widthPt: block.widthPt, heightPt: block.heightPt }, section.pageSize.heightPt);
  const imageItem: LayoutImage = { kind: 'image', imageId, xPt: flippedFrame.xPt, yPt: flippedFrame.yPt, widthPt: flippedFrame.widthPt, heightPt: flippedFrame.heightPt, sourcePath: block.sourcePath };
  state.items.push(imageItem);
  state.cursorYDown += block.heightPt;
}

// The one ContentEmbeddedObjectBlock kind this engine actually renders (objectKind: 'formula') -- reserves flow space the same way layoutImageFlow does for an ordinary image, but via src/mathml's own layoutFormula rather than a static width/height, and records the result into `formulas` (consumed by pdf-codec's write.ts, not LayoutDocument.pages[].items -- see WordprocessingLayoutResult's own comment on why). Falls back to laying out the placeholder document's own first paragraph as plain text -- the formula's own StarMath annotation, or the literal "[formula]" -- when `options.formulas` has no entry for this block's sourcePath at all (should not happen for a block this package's own readers produced, but a real, honest fallback rather than a silent no-op for a block a caller constructed by hand).
function layoutFormulaFlow(block: ContentEmbeddedObjectBlock, section: ContentSection, pages: LayoutPage[], state: FlowState, contentLeftXDown: number, contentWidthPt: number, contentBottomYDown: number, measurer: TextMeasurer, options: EngineLayoutOptions, formulas: PositionedFormula[]): void {
  const embedded = block.sourcePath === undefined ? undefined : options.formulas?.get(block.sourcePath);
  if (embedded === undefined) {
    const fallbackParagraph = block.document.kind === 'wordprocessing' ? block.document.sections[0]?.blocks[0] : undefined;
    if (fallbackParagraph?.kind === 'paragraph') {
      layoutParagraphFlow(fallbackParagraph, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer);
    }
    return;
  }

  const sizePt = formulaSizePtFromFrame(block.frame.heightPt);
  const metrics = loadMathFont().metricsAt(sizePt);
  const { box } = layoutFormula(embedded.mathml, { metrics, sizePt, color: COLOR_BLACK });

  ensureRoom(state, section, pages, box.heightPt, contentBottomYDown);
  const flippedFrame = flipY({ xPt: contentLeftXDown, yPt: state.cursorYDown, widthPt: box.widthPt, heightPt: box.heightPt }, section.pageSize.heightPt);
  formulas.push({ pageIndex: pages.length, xPt: flippedFrame.xPt, yPt: flippedFrame.yPt, box });
  state.cursorYDown += box.heightPt;
}

// Paginates one section's own blocks into one or more pages, all sharing that section's page size and margins -- a w:sectPr boundary (see read.ts) just means the next section starts this whole function over with a different pageSize/margins, which is what makes multi-section support fall out for free rather than needing special-casing here.
function paginateSection(section: ContentSection, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>, pages: LayoutPage[], options: EngineLayoutOptions, formulas: PositionedFormula[]): void {
  const contentLeftXDown = section.margins.leftPt;
  const contentWidthPt = Math.max(0, section.pageSize.widthPt - section.margins.leftPt - section.margins.rightPt);
  const contentBottomYDown = section.pageSize.heightPt - section.margins.bottomPt;
  const state = newFlowState(section);

  for (const block of section.blocks) {
    if (block.kind === 'pageBreak') {
      if (state.items.length > 0) {
        flushPage(state, section, pages);
      }
    } else if (block.kind === 'paragraph') {
      layoutParagraphFlow(block, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer);
    } else if (block.kind === 'table') {
      layoutTableFlow(block, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer);
    } else if (block.kind === 'image') {
      layoutImageFlow(block, section, pages, state, contentLeftXDown, contentBottomYDown, images);
    } else if (block.kind === 'embeddedObject' && block.objectKind === 'formula') {
      layoutFormulaFlow(block, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer, options, formulas);
    }
    // Every other 'embeddedObject' objectKind (wordprocessing/presentation/spreadsheet/drawing) is not produced by any reader this package depends on yet (document-content-model's forward-looking schema addition -- see edit/docx/content.ts's own note on the same gap), so there is nothing to lay out for those here today.
  }

  flushPage(state, section, pages);
}

export function convertWordprocessingToLayout(doc: WordprocessingContentDocument, options: EngineLayoutOptions): WordprocessingLayoutResult {
  const images: Record<string, LayoutImageAsset> = {};
  const pages: LayoutPage[] = [];
  const formulas: PositionedFormula[] = [];
  for (const section of doc.sections) {
    paginateSection(section, options.measurer, images, pages, options, formulas);
  }
  return { document: { formatVersion: LAYOUT_FORMAT_VERSION, metadata: doc.metadata, pages, images }, formulas };
}
