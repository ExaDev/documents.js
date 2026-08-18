import type { ContentDocument, ContentEmbeddedObjectBlock, ContentImageBlock, ContentListMembership, ContentParagraph, ContentSection, ContentTable, PageSize } from 'document-schema.js';
import { COLOR_BLACK } from 'document-schema.js';
import { parseListNumId } from 'markdown-codec';
import { layoutFormula } from '../mathml/layout';
import { flipY } from '../model/geometry';
import { formulaOfBlock, formulaPlaceholderText } from '../model/formula';
import type { MathFontMetrics, PositionedFormula, TextMeasurer } from 'document-schema.js';
import { wrapRunsToWidth } from './text-layout';
import { alignmentOffsetPt, effectiveStyledRuns, estimateRowHeightPt, formulaSizePtForFrame, headingStyleFor, justifyLineGapsPt, lineNaturalHeightPt, layoutDocumentOf, packagePagesOf, pushCellBorderLines, registerImage, stampFragmentFrame, stampFrame, sumColumnWidthsPt, textBoxForFragment } from './shared';
import type { LayoutDocument, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLink, LayoutPage, LayoutText } from 'pdf-codec';

// ContentDocument (the wordprocessing variant) -> LayoutDocument: docx's hard direction. A docx page isn't a fixed canvas the way a pptx slide is -- content flows and paginates, so this engine tracks a vertical cursor per page and starts a new page whenever the next line (or table row) would overflow the current one, honoring explicit page breaks, w:pageBreakBefore, and a per-section page-size/margin change. Headers/footers and live PAGE/NUMPAGES substitution are not laid out here -- src/ooxml/docx/read.ts doesn't read them either, a deliberate, tracked narrowing from the plan's original scope (see that file's own module doc).

// One indent step per list nesting level, applied both to the marker glyph's own gutter position and, cumulatively, to the hanging indent of the paragraph's own wrapped text -- level 0 gets one step of hanging indent (room for its own marker), level 1 gets two, and so on.
const LIST_INDENT_STEP_PT = 18;

// ContentListMembership carries only { numId, level } -- no marker format -- so every list this package can't otherwise identify degrades to a plain bullet, cycling by nesting depth the way Word/LibreOffice conventionally vary marker glyph per level. This is the same documented limitation src/edit/docx/numbering.ts's write side already accepts (search that file for "BULLET template"): preserving real ordered-vs-bullet/per-source glyph fidelity needs a format field on ContentListMembership, a document-schema.js change out of scope for this interim, read-side fix.
//
// '•' (U+2022) is the only one of the conventional Word/LibreOffice bullet glyphs (•/◦/▪) that's actually in the standard-14 fonts' glyph coverage this package falls back to when a document embeds no font of its own -- confirmed by rendering: U+25E6/U+25AA came back as literal "?" missing-glyph boxes. '-' and '*' are plain ASCII, guaranteed present in any font, so the cycle uses those for deeper levels instead of risking an unrenderable Unicode bullet variant.
const BULLET_GLYPHS = ['•', '-', '*'];

// One counter per distinct numId -- a new list instance always mints a fresh numId in both docx and markdown-codec's own conventions, so there is no cross-list bleed to guard against; a single Map threaded through one convertWordprocessingToLayout call is enough.
type ListCounters = Map<string, number>;

// markdown-codec mints its own numId as "md{n}:bullet|ordered@start" (see that package's list-id.ts) -- parseListNumId is already public from there specifically so a consumer can recover this. docx numIds are plain "1", "2", ...; odt's are "list1", "list2", ... -- neither follows markdown-codec's convention, so a docx/odt-sourced ordered list still degrades to a bullet here, same as the write-side limitation noted above. Only markdown gets real sequential numbering, which is still a strict improvement over no marker at all.
function listMarkerText(list: ContentListMembership, counters: ListCounters): string {
  // numId is optional since schema 4.0.0 (an OOXML drawing paragraph carries only a level; markdown-codec mints its own md{n}: ids), and only a minted markdown id can name an ORDERED list -- no numId means no ordering information at all, so the glyph cycle below is the only honest marker.
  const { numId } = list;
  if (numId !== undefined) {
    const info = parseListNumId(numId);
    if (info?.type === 'ordered') {
      const next = counters.get(numId) ?? info.start ?? 1;
      counters.set(numId, next + 1);
      return `${next}.`;
    }
  }
  return BULLET_GLYPHS[list.level % BULLET_GLYPHS.length]!;
}

export interface EngineLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly mathMetricsAt: (sizePt: number) => MathFontMetrics;
}

export interface WordprocessingLayoutResult {
  readonly document: LayoutDocument;
  // Every embedded formula actually rendered via src/mathml, already positioned in PDF page space (bottom-left origin, y-up) -- pdf-codec's write.ts's own WritePdfOptions.formulas consumes this directly. See that module's own comment for why a formula's CID-font glyph runs can't travel through LayoutDocument.pages[].items itself.
  readonly formulas: readonly PositionedFormula[];
  // The DocumentPackage's own pages array (each rendered page's size, indexed to match every content node's own frames[].pageIndex) -- the input `doc` argument itself comes back with frames stamped in place, which together with this array is the fused unified package a conversion reports through onDocument.
  readonly pages: readonly PageSize[];
}

type WordprocessingContentDocument = Extract<ContentDocument, { kind: 'wordprocessing' }>;

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
  listCounters: ListCounters,
): void {
  if (state.items.length > 0) {
    state.cursorYDown += paragraph.spacingBeforePt ?? 0;
  }

  const effectiveRuns = effectiveStyledRuns(paragraph.runs, 1, headingStyleFor(paragraph.styleId));
  const fallbackRun = effectiveRuns[0]!;
  // A list item reserves one hanging-indent step per nesting level (0-indexed level 0 still gets one step, for its own marker's gutter) -- see LIST_INDENT_STEP_PT's own comment.
  const listIndentPt = paragraph.list !== undefined ? (paragraph.list.level + 1) * LIST_INDENT_STEP_PT : 0;
  const paragraphLeftXDown = contentLeftXDown + (paragraph.indentLeftPt ?? 0) + listIndentPt;
  const paragraphWidthPt = Math.max(0, contentWidthPt - (paragraph.indentLeftPt ?? 0) - listIndentPt);
  const lines = wrapRunsToWidth(effectiveRuns, measurer, paragraphWidthPt);

  lines.forEach((line, lineIndex) => {
    const lineHeightPt = lineNaturalHeightPt(line, measurer, fallbackRun) * (paragraph.lineSpacing ?? 1);
    ensureRoom(state, section, pages, lineHeightPt, contentBottomYDown);
    // Read after ensureRoom, not before: a mid-paragraph page break means different lines of this one paragraph place on different pages, and each line's own stamps must carry the page it actually landed on. pages.length is the index of the page currently being filled (flushPage is what increments it).
    const pageIndex = pages.length;

    const baselineYDown = state.cursorYDown + line.ascentPt;
    // First-line indent shifts only where the first line starts, not its wrap point -- see src/layout/slides.ts's identical note on the same simplification.
    const firstLineIndentPt = lineIndex === 0 ? (paragraph.indentFirstLinePt ?? 0) : 0;
    const alignOffsetPt = alignmentOffsetPt(paragraph.alignment, paragraphWidthPt, line.widthPt);
    // Only a WRAPPED, non-final line of a justified paragraph gets its inter-word gaps stretched -- the paragraph's own final line (or a paragraph that never wraps at all, i.e. lines.length === 1) renders left-aligned instead, the standard justification convention Word/LibreOffice both follow.
    const justifyGapsPt = paragraph.alignment === 'justify' && lineIndex < lines.length - 1 ? justifyLineGapsPt(line, paragraphWidthPt, measurer) : undefined;

    // The marker sits one indent step to the left of the paragraph's own (already-indented) text, on the paragraph's first line only -- the same hanging-indent convention a word processor uses, so wrapped continuation lines line up under the text, not under the marker. The marker derives from the paragraph's own list membership rather than from any run, so its frame stamps the PARAGRAPH node itself.
    if (lineIndex === 0 && paragraph.list !== undefined) {
      const markerText = listMarkerText(paragraph.list, listCounters);
      const markerItem: LayoutText = {
        kind: 'text',
        text: markerText,
        xPt: paragraphLeftXDown - LIST_INDENT_STEP_PT,
        yPt: section.pageSize.heightPt - baselineYDown,
        font: fallbackRun.font,
        sizePt: fallbackRun.sizePt,
        color: fallbackRun.color,
        sourcePath: paragraph.sourcePath,
      };
      state.items.push(markerItem);
      stampFrame(paragraph, pageIndex, textBoxForFragment(markerItem, measurer.widthOfTextAtSize(markerText, fallbackRun.font, fallbackRun.sizePt), line.ascentPt, line.descentPt));
    }

    line.fragments.forEach((fragment, fragmentIndex) => {
      const xPt = paragraphLeftXDown + firstLineIndentPt + alignOffsetPt + fragment.xOffsetPt + (justifyGapsPt?.[fragmentIndex] ?? 0);
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
      // One frame per rendered placement, on the run that placement renders -- a hyperlinked fragment's LayoutLink rides the same placement, so it stamps nothing additional.
      stampFragmentFrame(paragraph.runs, fragment, pageIndex, textItem, measurer, line);

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
    });
    state.cursorYDown += lineHeightPt;
  });

  state.cursorYDown += paragraph.spacingAfterPt ?? 0;
}

// A simpler variant for text inside a table cell: the row's own row-atomic placement (see layoutTableFlow) already guaranteed the whole row fits before any cell content is laid out, so no page-break checking happens per line here -- only wrapping and stacking, returning the new cursor position. `pageIndex` is that row's own settled page, threaded in once per row rather than re-derived per line. Nested tables inside a cell are not laid out (read.ts can represent one recursively, but rendering one is out of v1 scope -- rare in practice, and cheap to add later without touching this function's contract).
function layoutParagraphInCell(paragraph: ContentParagraph, cellLeftXDown: number, cellWidthPt: number, startYDown: number, pageHeightPt: number, pageIndex: number, measurer: TextMeasurer, out: LayoutItem[], listCounters: ListCounters): number {
  let cursorYDown = startYDown + (paragraph.spacingBeforePt ?? 0);
  const effectiveRuns = effectiveStyledRuns(paragraph.runs, 1, headingStyleFor(paragraph.styleId));
  const fallbackRun = effectiveRuns[0]!;
  const listIndentPt = paragraph.list !== undefined ? (paragraph.list.level + 1) * LIST_INDENT_STEP_PT : 0;
  const paragraphLeftXDown = cellLeftXDown + (paragraph.indentLeftPt ?? 0) + listIndentPt;
  const paragraphWidthPt = Math.max(0, cellWidthPt - (paragraph.indentLeftPt ?? 0) - listIndentPt);
  const lines = wrapRunsToWidth(effectiveRuns, measurer, paragraphWidthPt);

  lines.forEach((line, lineIndex) => {
    const lineHeightPt = lineNaturalHeightPt(line, measurer, fallbackRun) * (paragraph.lineSpacing ?? 1);
    const baselineYDown = cursorYDown + line.ascentPt;
    const firstLineIndentPt = lineIndex === 0 ? (paragraph.indentFirstLinePt ?? 0) : 0;
    const alignOffsetPt = alignmentOffsetPt(paragraph.alignment, paragraphWidthPt, line.widthPt);
    // See layoutParagraphFlow's identical note: only a wrapped, non-final line of a justified paragraph gets stretched.
    const justifyGapsPt = paragraph.alignment === 'justify' && lineIndex < lines.length - 1 ? justifyLineGapsPt(line, paragraphWidthPt, measurer) : undefined;
    if (lineIndex === 0 && paragraph.list !== undefined) {
      const markerText = listMarkerText(paragraph.list, listCounters);
      const markerItem: LayoutText = {
        kind: 'text',
        text: markerText,
        xPt: paragraphLeftXDown - LIST_INDENT_STEP_PT,
        yPt: pageHeightPt - baselineYDown,
        font: fallbackRun.font,
        sizePt: fallbackRun.sizePt,
        color: fallbackRun.color,
        sourcePath: paragraph.sourcePath,
      };
      out.push(markerItem);
      stampFrame(paragraph, pageIndex, textBoxForFragment(markerItem, measurer.widthOfTextAtSize(markerText, fallbackRun.font, fallbackRun.sizePt), line.ascentPt, line.descentPt));
    }
    line.fragments.forEach((fragment, fragmentIndex) => {
      const textItem: LayoutText = {
        kind: 'text',
        text: fragment.text,
        xPt: paragraphLeftXDown + firstLineIndentPt + alignOffsetPt + fragment.xOffsetPt + (justifyGapsPt?.[fragmentIndex] ?? 0),
        yPt: pageHeightPt - baselineYDown,
        font: fragment.font,
        sizePt: fragment.sizePt,
        color: fragment.color,
        underline: fragment.underline,
        sourcePath: fragment.sourcePath,
      };
      out.push(textItem);
      stampFragmentFrame(paragraph.runs, fragment, pageIndex, textItem, measurer, line);
    });
    cursorYDown += lineHeightPt;
  });

  return cursorYDown + (paragraph.spacingAfterPt ?? 0);
}

// Row-atomic: a row that doesn't fit in the remaining space on the current page moves to a fresh page as a whole, never splitting its own content across the boundary (cell-level splitting would roughly double the paginator's complexity for what is, in practice, a rare case -- see the implementation plan's own reasoning). Column widths scale proportionally to fit the available content width.
function layoutTableFlow(table: ContentTable, section: ContentSection, pages: LayoutPage[], state: FlowState, contentLeftXDown: number, contentWidthPt: number, contentBottomYDown: number, measurer: TextMeasurer, listCounters: ListCounters): void {
  const gridWidthPt = table.columnWidthsPt.reduce((sum, w) => sum + w, 0);
  const scale = gridWidthPt > 0 ? contentWidthPt / gridWidthPt : 1;

  for (const row of table.rows) {
    const rowHeightPt = row.heightPt ?? estimateRowHeightPt(row, measurer, table.columnWidthsPt, scale);
    ensureRoom(state, section, pages, rowHeightPt, contentBottomYDown);
    // The row's own settled page -- read after ensureRoom, and shared by every cell in it (row-atomic placement means the whole row, decorations and content, is one page's content).
    const pageIndex = pages.length;

    let cellXDown = contentLeftXDown;
    let colIndex = 0;
    for (const cell of row.cells) {
      const span = cell.colSpan ?? 1;
      const cellWidthPt = sumColumnWidthsPt(table.columnWidthsPt, colIndex, span) * scale;

      // A cell's decoration paints under its own content, in the order a real word processor draws it: background fill first, then the border lines sitting on that same frame's edges, then (below) the cell's paragraphs on top of both. ContentTableCell carries a real sourcePath of its own now, so a cell's rect/lines are attributed to the exact cell that declared them, falling back to the containing table only for a cell that has none. The cell's own frame stamps the CELL node once, PDF-space -- background, borders, and any content runs inside all belong to this one placement of this one cell.
      const cellFrameYDown = { xPt: cellXDown, yPt: state.cursorYDown, widthPt: cellWidthPt, heightPt: rowHeightPt };
      const cellSourcePath = cell.sourcePath ?? table.sourcePath;
      const cellFrame = flipY(cellFrameYDown, section.pageSize.heightPt);
      stampFrame(cell, pageIndex, cellFrame);
      if (cell.background !== undefined) {
        state.items.push({ kind: 'rect', xPt: cellFrame.xPt, yPt: cellFrame.yPt, widthPt: cellFrame.widthPt, heightPt: cellFrame.heightPt, fill: cell.background, sourcePath: cellSourcePath });
      }
      if (cell.borders !== undefined) {
        pushCellBorderLines(cell.borders, cellFrameYDown, section.pageSize.heightPt, cellSourcePath, state.items);
      }

      let cellCursorYDown = state.cursorYDown;
      for (const block of cell.blocks) {
        if (block.kind === 'paragraph') {
          cellCursorYDown = layoutParagraphInCell(block, cellXDown, cellWidthPt, cellCursorYDown, section.pageSize.heightPt, pageIndex, measurer, state.items, listCounters);
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
  stampFrame(block, pages.length, flippedFrame);
  state.cursorYDown += block.heightPt;
}

// The one ContentEmbeddedObjectBlock kind this engine actually renders (objectKind: 'formula') -- reserves flow space the same way layoutImageFlow does for an ordinary image, but via src/mathml's own layoutFormula rather than a static width/height, and records the result into `formulas` (consumed by pdf-codec's write.ts, not LayoutDocument.pages[].items -- see WordprocessingLayoutResult's own comment on why). The MathML comes straight out of the block's own document (src/model/formula.ts's formulaOfBlock), so no side-channel map, and no sourcePath lookup, is involved at all.
//
// Falls back to laying out the formula's own plain-text stand-in -- its StarMath annotation, or the literal "[formula]" -- when the block carries no MathML nodes to typeset: either its document is not a formula document at all (a block a caller constructed by hand), or it is one whose mathml array is empty. A real, honest fallback rather than a silent no-op, since the alternative is a block that occupies no space and renders nothing.
function layoutFormulaFallback(block: ContentEmbeddedObjectBlock, section: ContentSection, pages: LayoutPage[], state: FlowState, contentLeftXDown: number, contentWidthPt: number, contentBottomYDown: number, measurer: TextMeasurer, listCounters: ListCounters): void {
  const formula = formulaOfBlock(block);
  if (formula === undefined) {
    return;
  }
  layoutParagraphFlow({ kind: 'paragraph', runs: [{ text: formulaPlaceholderText(formula) }] }, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer, listCounters);
}

function layoutFormulaFlow(block: ContentEmbeddedObjectBlock, section: ContentSection, pages: LayoutPage[], state: FlowState, contentLeftXDown: number, contentWidthPt: number, contentBottomYDown: number, measurer: TextMeasurer, mathMetricsAt: (sizePt: number) => MathFontMetrics, formulas: PositionedFormula[], listCounters: ListCounters): void {
  const formula = formulaOfBlock(block);
  if (formula === undefined || formula.mathml.length === 0) {
    layoutFormulaFallback(block, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer, listCounters);
    return;
  }

  const sizePt = formulaSizePtForFrame(formula.mathml, block.frame, mathMetricsAt);
  const metrics = mathMetricsAt(sizePt);
  const { box } = layoutFormula(formula.mathml, { metrics, sizePt, color: COLOR_BLACK });

  ensureRoom(state, section, pages, box.heightPt, contentBottomYDown);
  const flippedFrame = flipY({ xPt: contentLeftXDown, yPt: state.cursorYDown, widthPt: box.widthPt, heightPt: box.heightPt }, section.pageSize.heightPt);
  formulas.push({ pageIndex: pages.length, xPt: flippedFrame.xPt, yPt: flippedFrame.yPt, box });
  // The block's frame records where the formula was placed even though its glyphs render through the formulas side channel rather than as a LayoutItem -- a consumer rebuilding a layout from frames (src/convert/from-package.ts) still knows where the block sat, and can still not re-render its math (the same honest limit that side channel has always had).
  stampFrame(block, pages.length, flippedFrame);
  state.cursorYDown += box.heightPt;
}

// Paginates one section's own blocks into one or more pages, all sharing that section's page size and margins -- a w:sectPr boundary (see read.ts) just means the next section starts this whole function over with a different pageSize/margins, which is what makes multi-section support fall out for free rather than needing special-casing here.
function paginateSection(section: ContentSection, measurer: TextMeasurer, images: Record<string, LayoutImageAsset>, pages: LayoutPage[], options: EngineLayoutOptions, formulas: PositionedFormula[], listCounters: ListCounters): void {
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
      layoutParagraphFlow(block, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer, listCounters);
    } else if (block.kind === 'table') {
      layoutTableFlow(block, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer, listCounters);
    } else if (block.kind === 'image') {
      layoutImageFlow(block, section, pages, state, contentLeftXDown, contentBottomYDown, images);
    } else if (block.kind === 'embeddedObject' && block.objectKind === 'formula') {
      layoutFormulaFlow(block, section, pages, state, contentLeftXDown, contentWidthPt, contentBottomYDown, measurer, options.mathMetricsAt, formulas, listCounters);
    }
    // Every other 'embeddedObject' objectKind (wordprocessing/presentation/spreadsheet/drawing) is not produced by any reader this package depends on yet (document-schema.js's forward-looking schema addition -- see edit/docx/content.ts's own note on the same gap), so there is nothing to lay out for those here today. 'constructStart'/'constructEnd' fall through the same way, but deliberately rather than by omission: a construct marker is a zero-width boundary sentinel with no content of its own to render, so skipping it here loses nothing -- the paragraphs/tables it wraps are separate blocks in this same flow and lay out exactly as if the marker were not there.
  }

  flushPage(state, section, pages);
}

export function convertWordprocessingToLayout(doc: WordprocessingContentDocument, options: EngineLayoutOptions): WordprocessingLayoutResult {
  const images: Record<string, LayoutImageAsset> = {};
  const pages: LayoutPage[] = [];
  const formulas: PositionedFormula[] = [];
  // One counter map for the whole document -- see ListCounters' own comment on why a fresh numId per list instance makes this safe across section boundaries too.
  const listCounters: ListCounters = new Map();
  for (const section of doc.sections) {
    paginateSection(section, options.measurer, images, pages, options, formulas, listCounters);
  }
  // `doc` itself now carries every placement this pass computed, stamped in place on its own nodes (frames); the returned pages array plus that mutated content is the fused unified DocumentPackage a conversion reports through onDocument.
  return { document: layoutDocumentOf(doc.metadata, pages, images), formulas, pages: packagePagesOf(pages) };
}
