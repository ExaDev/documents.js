import type {
  Box,
  ContentCellValue,
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintRange,
  ContentSheetPrintSettings,
  LayoutDocument,
  LayoutItem,
  LayoutLine,
  LayoutPage,
  LayoutText,
} from 'document-schema.js';
import { LAYOUT_FORMAT_VERSION } from 'document-schema.js';
import type { LayoutColor } from '../model/color';
import { COLOR_BLACK, rgbHexToColor } from '../model/color';
import type { Alignment } from '../model/style';
import { DEFAULT_LAYOUT_FONT } from '../model/style';
import { flipY } from '../model/geometry';
import { throwIfAborted } from '../ports/abort';
import type { StyledFragment, StyledRun, TextMeasurer } from 'pdf-codec';
import { wrapRunsToWidth } from 'pdf-codec';
import { alignmentOffsetPt, justifyLineGapsPt, lineNaturalHeightPt, pushCellBorderLines, sumColumnWidthsPt, toStyledRuns } from './shared';

// ContentDocument (the spreadsheet variant) -> LayoutDocument: ods/xlsx's own layout direction, genuinely distinct from both docx's flow/pagination (engine.ts) and pptx's direct placement (slides.ts). A sheet paginates over TWO axes at once (column bands x row bands, not just rows), print settings (range/scale/fit-to-page/repeat rows-columns/gridlines/headers/page order/manual breaks) drive the page grid directly rather than being ignored the way a docx section's margins alone would be, and cell overflow is bounded per cell (###, spill, truncate) rather than wrapped the way paragraph text is. This is also the first layout algorithm in the package genuinely long-running enough (a real sheet can carry tens of thousands of populated cells) to need cooperative cancellation wired into its own per-cell emission loop, not just checked once at the top of the function the way reconstruct.ts's own page/slide loops do.
//
// ContentSheetCellSchema carries real per-cell decoration as of document-schema.js 2.0.0 -- background, borders, alignment, and verticalAlignment -- all four of which odf.js's own readOds genuinely populates from a cell's resolved style chain (typed/shared/table.ts's readCellStyleDecoration), so every one of them is live data here, not a speculatively-consumed field. The z-order below emits a real background LayoutRect and real border LayoutLines accordingly, and a cell's own explicit alignment/verticalAlignment override the value-kind default rather than being ignored. The one part of this decoration that still cannot be expressed is a border's own dash STYLE -- see pushCellBorderLines (src/layout/shared.ts) for why that is a gap in the layout schema rather than in this module.
//
// A cell's own text is laid out as a SINGLE line, never wrapped or stacked -- deliberate, narrower scope than docx/pptx paragraph flow: a spreadsheet cell's overflow rule (###, spill, truncate) is a single-line concept in every real spreadsheet application, and the task this module implements specifies exactly that. A cell whose own source text contains an explicit line break (readOds's own multi text:p-per-cell join, a rare Alt+Enter case) has wrapRunsToWidth produce more than one WrappedLine; only the FIRST is rendered here, a documented, narrow scope boundary rather than a silent truncation.

export interface SheetsLayoutOptions {
  readonly measurer: TextMeasurer;
  // The only layout engine in this package that needs one: a 50k-cell sheet's own cell-emission loop can run long enough to be worth cancelling mid-page, unlike a docx/pptx document's own, much smaller, page/slide count.
  readonly signal?: AbortSignal;
}

type SpreadsheetContentDocument = Extract<ContentDocument, { kind: 'spreadsheet' }>;

// --- Nominal fallbacks and rendering constants, each documented rather than a bare literal -----

// A column/row with no explicit ContentSheetColumn/ContentSheetRow entry of its own falls back to these -- exercised only for malformed or hand-built input; every real producer (confirmed for LibreOffice via odf.js's own readOds) emits an explicit entry for every real column/row it ever touched. Values match Excel/Calc's own real default column width (8.43 characters at the default font, ~64pt) and default row height (~15pt at the default 10-11pt body font).
const DEFAULT_COLUMN_WIDTH_PT = 64;
const DEFAULT_ROW_HEIGHT_PT = 15;

// A nominal fallback text size for a cell with no runs of its own (the common case -- ContentSheetCell.runs is populated only for genuinely mixed inline formatting, per its own schema comment) and therefore no resolvable size anywhere in the model. Deliberately its own constant, distinct from shared.ts's NOMINAL_TEXT_SIZE_PT (18pt, a docx/pptx PARAGRAPH fallback) -- applying that size to an ordinary spreadsheet cell would visually swamp a real row height. Matches Excel/Calc's own common 10-11pt body-cell default.
const NOMINAL_CELL_TEXT_SIZE_PT = 10;
// The row/column header-gutter's own label size -- smaller again, matching Excel/Calc's own small grey header-label chrome.
const HEADER_LABEL_SIZE_PT = 8;

// Inset between a cell's own frame edge and its rendered text, and between a header-gutter label and its own gutter edge -- ordinary spreadsheet cell/label padding.
const CELL_TEXT_PADDING_PT = 2;
const HEADER_LABEL_PADDING_PT = 2;

// A misconfigured page/margin/gutter/repeat-band combination could otherwise leave zero or negative available print area, which would divide the band-partition boundary by zero (or a negative number) computing a descaled boundary -- clamped to a small positive floor so band partitioning always terminates with well-defined positive widths rather than Infinity/NaN geometry, the same "at least make progress on pathological input" reasoning pdf-codec's text-layout.ts's own emergency character split documents.
const MINIMUM_SCALE = 0.01;

// The literal sentinel spreadsheet applications universally render for a numeric-kind value that doesn't fit its own column -- not a computed fill-to-width run of '#' the way a real spreadsheet UI does, since the task this module implements pins down this exact literal.
const NUMERIC_OVERFLOW_TEXT = '###';

const GRIDLINE_COLOR: LayoutColor = rgbHexToColor('#D0D0D0');
const GRIDLINE_WIDTH_PT = 0.5;
const HEADER_LABEL_COLOR: LayoutColor = rgbHexToColor('#606060');

// --- Column-letter conversion (A, B, ..., Z, AA, AB, ...) -- a pure spreadsheet-addressing convention with no I/O dependency of its own, so written locally rather than importing odf.js's own columnIndexToLetters: src/layout/* imports only ./model (and sibling layout modules), never a format package. ---
function columnLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// --- Step 1: resolve the print range -----------------------------------------------------------

// The sheet's own explicit table:print-ranges-derived range if set, else the full extent of populated cells (accounting for a merged anchor cell's own colSpan/rowSpan reaching beyond its own row/column). undefined when the sheet has no explicit range and no cells at all -- nothing to lay out.
function resolvePrintRange(sheet: ContentSheet): ContentSheetPrintRange | undefined {
  if (sheet.printSettings.printRange !== undefined) {
    return sheet.printSettings.printRange;
  }
  if (sheet.cells.length === 0) {
    return undefined;
  }
  let startRow = Number.POSITIVE_INFINITY;
  let startColumn = Number.POSITIVE_INFINITY;
  let endRow = Number.NEGATIVE_INFINITY;
  let endColumn = Number.NEGATIVE_INFINITY;
  for (const cell of sheet.cells) {
    startRow = Math.min(startRow, cell.row);
    startColumn = Math.min(startColumn, cell.column);
    endRow = Math.max(endRow, cell.row + (cell.rowSpan ?? 1) - 1);
    endColumn = Math.max(endColumn, cell.column + (cell.colSpan ?? 1) - 1);
  }
  return { startRow, startColumn, endRow, endColumn };
}

// --- Step 2: cumulative column/row offset arrays, skipping hidden entirely ---------------------

interface AxisEntry {
  readonly index: number;
  readonly sizePt: number; // 0 for a hidden index -- contributes nothing to any cumulative offset, matching "skip hidden entirely"
  readonly hidden: boolean;
}

// Resolves one size (and hidden-ness) per index across [start, end] from a sparse, run-length-compressed entries array (document order; real producers emit exactly one entry per STARTING index of a repeated run -- see odf.js's own readOds module doc) -- entry N's own size/hidden-ness applies to every index from its own index up to (but not including) the next entry's index, mirroring how the source format itself compresses a run of identically-formatted columns/rows. An index before the first entry, or with no entries at all, falls back to defaultSizePt.
//
// entries[i].sizePt is `number | undefined` (ContentSheetColumn.widthPt/ContentSheetRow.heightPt, both optional since document-schema.js 2.0.0) because the two real producers behind this shared field disagree on when a size is knowable at all: odf.js's own readOds always resolves a concrete number for a real column/row element (0 when it carries no explicit style -- see src/edit/ods/column-row.ts's own top-of-file note for why THAT zero is deliberately treated as authoritative below, not defaulted), whereas ooxml.js's readXlsxContent genuinely omits the field outright when an xlsx column has no explicit <col> width. `?? defaultSizePt` below only ever fires for the latter, genuinely-absent case; an ODS-sourced entry's own explicit 0 is a real number, not undefined, so it flows through unchanged exactly as it always has.
function resolveAxis(entries: readonly { readonly index: number; readonly sizePt: number | undefined; readonly hidden?: boolean }[], start: number, end: number, defaultSizePt: number): AxisEntry[] {
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const resolved: AxisEntry[] = [];
  let pointer = 0;
  let currentSizePt = defaultSizePt;
  let currentHidden = false;
  for (let index = start; index <= end; index++) {
    while (pointer < sorted.length && sorted[pointer]!.index <= index) {
      currentSizePt = sorted[pointer]!.sizePt ?? defaultSizePt;
      currentHidden = sorted[pointer]!.hidden ?? false;
      pointer++;
    }
    resolved.push({ index, sizePt: currentHidden ? 0 : currentSizePt, hidden: currentHidden });
  }
  return resolved;
}

// --- Step 3: header-gutter and repeat-row/column reservation -----------------------------------

interface HeaderGutter {
  readonly widthPt: number; // reserved at the page's own left edge for row-number labels
  readonly heightPt: number; // reserved at the page's own top edge for column-letter labels
}

// Sized directly from real font metrics rather than a flat guess: the row-number gutter is exactly as wide as the LARGEST row number that can appear (the print range's own last row, 1-based for display) needs at the header label's own font/size, and the column-letter gutter is exactly one header-label line tall.
function computeHeaderGutter(printSettings: ContentSheetPrintSettings, range: ContentSheetPrintRange, measurer: TextMeasurer): HeaderGutter {
  if (!printSettings.headers) {
    return { widthPt: 0, heightPt: 0 };
  }
  const widestRowLabel = String(range.endRow + 1);
  return {
    widthPt: measurer.widthOfTextAtSize(widestRowLabel, DEFAULT_LAYOUT_FONT, HEADER_LABEL_SIZE_PT) + HEADER_LABEL_PADDING_PT * 2,
    heightPt: measurer.lineHeightAtSize(DEFAULT_LAYOUT_FONT, HEADER_LABEL_SIZE_PT),
  };
}

// --- Step 4: resolve scale -----------------------------------------------------------------------

// Explicit printSettings.scalePercent (a raw percentage, e.g. 150 for "150%" -- odf.js's own readOds reads it this way, confirmed by its own test suite) takes priority; else a non-iterative fit-to-page computed directly from the ratio of available-print-area-across-N-pages to total unscaled content size, clamped to never upscale; else 1. Header-gutter and repeat-row/column space is deliberately NOT scaled (reserved at a fixed size on every page, the same "fixed chrome" treatment a spreadsheet UI itself gives its own row/column address labels) -- only the print range's own bandable cell content scales.
function resolveScale(printSettings: ContentSheetPrintSettings, availableWidthPt: number, availableHeightPt: number, totalContentWidthPt: number, totalContentHeightPt: number): number {
  if (printSettings.scalePercent !== undefined) {
    return Math.max(printSettings.scalePercent / 100, MINIMUM_SCALE);
  }
  if (printSettings.fitToPages !== undefined) {
    const budgetWidthPt = availableWidthPt * printSettings.fitToPages.width;
    const budgetHeightPt = availableHeightPt * printSettings.fitToPages.height;
    const widthRatio = totalContentWidthPt > 0 ? budgetWidthPt / totalContentWidthPt : 1;
    const heightRatio = totalContentHeightPt > 0 ? budgetHeightPt / totalContentHeightPt : 1;
    return Math.max(Math.min(widthRatio, heightRatio, 1), MINIMUM_SCALE);
  }
  return 1;
}

// --- Step 5: partition into column/row bands -----------------------------------------------------

// Walks `indices` (already limited to the bandable set -- i.e. excluding any repeat-row/column range, which is reserved and re-emitted separately, never banded) in order, closing the current band and starting a fresh one whenever the next index would overflow the available space, honoring a manual break as an unconditional close. Mirrors src/layout/engine.ts's own ensureRoom exactly: an index whose own size alone exceeds availablePt still gets exactly one band to itself (added to an EMPTY band unconditionally) and simply overflows, rather than looping forever trying to fit it -- the identical "oversized item gets its own page" guarantee, applied to the column/row axis instead of the paragraph-flow axis.
function partitionIndices(indices: readonly number[], sizeOf: (index: number) => number, availablePt: number, manualBreaks: ReadonlySet<number>): number[][] {
  const bands: number[][] = [];
  let current: number[] = [];
  let currentSizePt = 0;
  for (const index of indices) {
    if (manualBreaks.has(index) && current.length > 0) {
      bands.push(current);
      current = [];
      currentSizePt = 0;
    }
    const sizePt = sizeOf(index);
    if (current.length > 0 && currentSizePt + sizePt > availablePt) {
      bands.push(current);
      current = [];
      currentSizePt = 0;
    }
    current.push(index);
    currentSizePt += sizePt;
  }
  if (current.length > 0) {
    bands.push(current);
  }
  return bands;
}

// --- Cell text: styling, alignment, and overflow ---------------------------------------------------

// A cell's own runs when present, otherwise a single synthetic run built from its own displayText at the nominal cell text size -- ContentSheetCellSchema carries no cell-level font/size/colour of its own to fall back to otherwise. A real reader populates `runs` far more often than ContentSheetCellSchema's own doc comment ("the rare case of genuinely mixed inline formatting") suggests -- confirmed via this module's own real-file verification against odf.js's readOds: EVERY cell with any text at all gets a `runs` array (readCellText always calls readOdfParagraph), not only cells with genuinely mixed formatting, and those runs carry no sizePt of their own for ordinary unstyled text. Passing such a run straight to toStyledRuns would fall through to ITS OWN default (shared.ts's NOMINAL_TEXT_SIZE_PT, 18pt, a docx-PARAGRAPH fallback) rather than this module's own 10pt spreadsheet-cell nominal size -- exactly the mismatch this module's own top-of-file doc comment already warns about for the no-runs case, so each run missing its own sizePt is defaulted here, before toStyledRuns ever sees it, rather than left to toStyledRuns's own unrelated default.
function cellStyledRuns(cell: ContentSheetCell): StyledRun[] {
  if (cell.runs !== undefined && cell.runs.length > 0) {
    const runsWithNominalSize = cell.runs.map((run) => (run.sizePt === undefined ? { ...run, sizePt: NOMINAL_CELL_TEXT_SIZE_PT } : run));
    return toStyledRuns(runsWithNominalSize);
  }
  return [{ text: cell.displayText, font: DEFAULT_LAYOUT_FONT, sizePt: NOMINAL_CELL_TEXT_SIZE_PT, color: COLOR_BLACK }];
}

// number/percentage/currency/date/time/dateTime are all numeric-NATURED values (ContentCellValueSchema's own comment: it "mirrors ODF's own office:value-type vocabulary", and ODF itself stores date/time/dateTime as numeric serial values under the hood) -- the task's own literal list ("numeric/percentage/currency -> right") names the three most common members as a proxy for this whole numeric-natured bucket, not an exhaustive exclusion of date/time/dateTime; a real spreadsheet application right-aligns and '###'-overflows dates, times, and combined date-times exactly the same way it does plain numbers. dateTime is document-schema.js 2.0.0's own new ContentCellValue kind (a combined office:value-type="date" ISO-8601 dateTime value, distinct from a bare date or bare time) -- included here on the same "numeric-natured" reasoning as its date/time siblings, not left to default to 'string' treatment by omission. Extended deliberately, not silently -- see this module's own doc comment.
function isNumericLikeValue(kind: ContentCellValue['kind']): boolean {
  return kind === 'number' || kind === 'percentage' || kind === 'currency' || kind === 'date' || kind === 'time' || kind === 'dateTime';
}

function defaultAlignmentForValue(kind: ContentCellValue['kind']): Alignment {
  if (isNumericLikeValue(kind)) {
    return 'right';
  }
  if (kind === 'boolean' || kind === 'error') {
    return 'center';
  }
  return 'left'; // 'string' and 'empty'
}

function isCellVisuallyEmpty(cell: ContentSheetCell | undefined): boolean {
  return cell === undefined || (cell.value.kind === 'empty' && cell.displayText.length === 0);
}

// Truncates a wrapped line's own fragments to fit maxWidthPt, stopping at the fragment that crosses the boundary and character-truncating just that one -- deliberately simpler than pdf-codec's text-layout.ts's own (private) splitBoxToWidth: a spreadsheet cell's overflow has no "rest" to requeue onto a following line, since a cell never wraps to a second line for width reasons -- it simply stops rendering at the boundary.
function truncateFragmentsToWidth(fragments: readonly (StyledFragment & { readonly xOffsetPt: number })[], measurer: TextMeasurer, maxWidthPt: number): (StyledFragment & { readonly xOffsetPt: number })[] {
  const result: (StyledFragment & { readonly xOffsetPt: number })[] = [];
  for (const fragment of fragments) {
    if (fragment.xOffsetPt >= maxWidthPt) {
      break;
    }
    const remainingWidthPt = maxWidthPt - fragment.xOffsetPt;
    const fullWidthPt = measurer.widthOfTextAtSize(fragment.text, fragment.font, fragment.sizePt);
    if (fullWidthPt <= remainingWidthPt) {
      result.push(fragment);
      continue;
    }
    const chars = Array.from(fragment.text);
    let width = 0;
    let fitCount = 0;
    for (const char of chars) {
      const charWidthPt = measurer.widthOfTextAtSize(char, fragment.font, fragment.sizePt);
      if (width + charWidthPt > remainingWidthPt) {
        break;
      }
      width += charWidthPt;
      fitCount++;
    }
    if (fitCount > 0) {
      result.push({ ...fragment, text: chars.slice(0, fitCount).join('') });
    }
    break;
  }
  return result;
}

// A band's own axis, positioned in GRID-local space (offsetsPt[0] === 0 at the grid's own left/top edge): parallel index/offset/size arrays plus an index -> position lookup for O(1) colSpan/rowSpan-aware sums via shared.ts's sumColumnWidthsPt.
interface PositionedAxis {
  readonly indices: readonly number[]; // real sheet column/row indices, ascending, contiguous
  readonly sizesPt: readonly number[]; // SCALED size per position (band content) or unscaled (repeat/gutter, which never scale)
  readonly offsetsPt: readonly number[]; // cumulative offset per position, relative to the grid's own left/top edge
  readonly positionByIndex: ReadonlyMap<number, number>;
}

// Concatenates a fixed "repeat" axis (rendered at scale 1, identical on every page) with one page's own scaled band axis into a single grid-local PositionedAxis -- so cell lookup/rendering never needs to know whether a given column/row came from the repeat band or the page's own band.
function buildPositionedAxis(repeatIndices: readonly number[], repeatSizePtOf: (index: number) => number, bandIndices: readonly number[], bandSizePtOf: (index: number) => number): PositionedAxis {
  const indices = [...repeatIndices, ...bandIndices];
  const sizesPt = [...repeatIndices.map(repeatSizePtOf), ...bandIndices.map(bandSizePtOf)];
  const offsetsPt: number[] = [0];
  let running = 0;
  for (const size of sizesPt) {
    running += size;
    offsetsPt.push(running);
  }
  const positionByIndex = new Map(indices.map((index, position) => [index, position]));
  return { indices, sizesPt, offsetsPt, positionByIndex };
}

// Sums a positioned axis's own sizes over [startIndex, startIndex + span), clamped to the axis's own bounds -- reused verbatim via shared.ts's sumColumnWidthsPt (a plain array + start + span sum, equally valid read as a column-width sum or a row-height sum) rather than a second, duplicate implementation.
function axisSpanSizePt(axis: PositionedAxis, startIndex: number, span: number): number {
  const startPosition = axis.positionByIndex.get(startIndex);
  if (startPosition === undefined) {
    return 0;
  }
  return sumColumnWidthsPt(axis.sizesPt, startPosition, span);
}

// One cell's own box in GRID-local-plus-page space, still y-down (gridLeftXPt/gridTopYDownPt place the grid's own local origin within the page), spanning its full colSpan/rowSpan. undefined when the cell's own anchor position isn't on this page at all -- a merge continuation, or a row/column belonging to another band -- in which case nothing about that cell (background, borders, or text) is drawn here.
function resolveCellFrame(cell: ContentSheetCell, columnAxis: PositionedAxis, rowAxis: PositionedAxis, gridLeftXPt: number, gridTopYDownPt: number): Box | undefined {
  const columnPosition = columnAxis.positionByIndex.get(cell.column);
  const rowPosition = rowAxis.positionByIndex.get(cell.row);
  if (columnPosition === undefined || rowPosition === undefined) {
    return undefined;
  }
  return {
    xPt: gridLeftXPt + columnAxis.offsetsPt[columnPosition]!,
    yPt: gridTopYDownPt + rowAxis.offsetsPt[rowPosition]!,
    widthPt: axisSpanSizePt(columnAxis, cell.column, cell.colSpan ?? 1),
    heightPt: axisSpanSizePt(rowAxis, cell.row, cell.rowSpan ?? 1),
  };
}

// A backgrounded cell's own fill, as a real LayoutRect covering the cell's whole (merge-spanning) frame -- the exact shape src/layout/engine.ts's own table-cell background emission already produces for a docx/odt/pptx/odp table cell, applied to the spreadsheet grid. Unlike that one, a ContentSheetCell always has a genuine sourcePath of its own to attribute the rect to.
function renderCellBackground(cell: ContentSheetCell, frameYDown: Box, pageHeightPt: number, out: LayoutItem[]): void {
  if (cell.background === undefined) {
    return;
  }
  const flipped = flipY(frameYDown, pageHeightPt);
  out.push({ kind: 'rect', xPt: flipped.xPt, yPt: flipped.yPt, widthPt: flipped.widthPt, heightPt: flipped.heightPt, fill: cell.background, sourcePath: cell.sourcePath });
}

// The default vertical placement for a cell that declares none -- matching every real spreadsheet application's own default, and preserving exactly the behaviour this module had before ContentSheetCell.verticalAlignment existed to override it.
const DEFAULT_CELL_VERTICAL_ALIGNMENT = 'bottom';

// The y-down top of a single rendered line within its own cell, for each of the three vertical alignments ContentSheetCellSchema models. Every branch is clamped to at least one padding inset below the cell's own top, so a line taller than its own cell overflows downward (visible, overlapping the row below) rather than upward into the row above -- the same clamping the bottom-aligned case has always applied, generalised rather than special-cased.
function verticalLineTopYDownPt(verticalAlignment: 'top' | 'middle' | 'bottom', cellTopYDownPt: number, cellHeightPt: number, lineHeightPt: number): number {
  if (verticalAlignment === 'top') {
    return cellTopYDownPt + CELL_TEXT_PADDING_PT;
  }
  if (verticalAlignment === 'middle') {
    return cellTopYDownPt + Math.max(CELL_TEXT_PADDING_PT, (cellHeightPt - lineHeightPt) / 2);
  }
  return cellTopYDownPt + Math.max(CELL_TEXT_PADDING_PT, cellHeightPt - CELL_TEXT_PADDING_PT - lineHeightPt);
}

// Renders one populated cell's text into `out`, in true PAGE space, within the frame resolveCellFrame already resolved for it. Applies the cell's own explicit alignment/verticalAlignment when it declares one (falling back to the value-kind default and to bottom respectively), and the numeric-'###'/string-spill-then-truncate overflow rules, bounded to the current page's own two axes (a spilled string can extend into a later column on the SAME page, never onto a following page/band).
//
// Overflow still keys off the VALUE kind, never the resolved alignment: '###' is what a spreadsheet shows for a too-narrow numeric cell regardless of which way that cell happens to be aligned, and a right-aligned string still spills into an empty neighbour rather than becoming '###'.
function renderCellText(
  cell: ContentSheetCell,
  frameYDown: Box,
  rowCells: ReadonlyMap<number, ContentSheetCell> | undefined,
  columnAxis: PositionedAxis,
  pageHeightPt: number,
  measurer: TextMeasurer,
  out: LayoutItem[],
): void {
  const { xPt: xLeftPt, yPt: yTopDownPt, widthPt: ownWidthPt, heightPt } = frameYDown;

  const alignment = cell.alignment ?? defaultAlignmentForValue(cell.value.kind);
  const numericLike = isNumericLikeValue(cell.value.kind);
  const styledRuns = cellStyledRuns(cell);
  // The full wrapped-line array is kept (not just its own first entry) purely so a justified cell can tell whether its rendered (always first, per this module's own single-line scope -- see its top-of-file doc comment) line is genuinely non-final: a cell's own source text carrying an explicit line break produces more than one WrappedLine here, of which only the first is ever rendered, so THAT first line is the non-final one a justified paragraph's own convention (src/layout/engine.ts) stretches.
  const lines = wrapRunsToWidth(styledRuns, measurer, Number.POSITIVE_INFINITY);
  const naturalLine = lines[0]!;
  const insetWidthPt = Math.max(0, ownWidthPt - CELL_TEXT_PADDING_PT * 2);

  let availableWidthPt = insetWidthPt;
  let fragments = naturalLine.fragments;
  let lineWidthPt = naturalLine.widthPt;
  let overflowed = false;

  if (lineWidthPt > availableWidthPt) {
    overflowed = true;
    if (numericLike) {
      const overflowRuns: StyledRun[] = [{ text: NUMERIC_OVERFLOW_TEXT, font: styledRuns[0]!.font, sizePt: styledRuns[0]!.sizePt, color: styledRuns[0]!.color }];
      const overflowLine = wrapRunsToWidth(overflowRuns, measurer, Number.POSITIVE_INFINITY)[0]!;
      fragments = overflowLine.fragments;
      lineWidthPt = overflowLine.widthPt;
    } else if (cell.value.kind === 'string') {
      let spillColumn = cell.column + (cell.colSpan ?? 1);
      while (lineWidthPt > availableWidthPt) {
        const neighborPosition = columnAxis.positionByIndex.get(spillColumn);
        if (neighborPosition === undefined || !isCellVisuallyEmpty(rowCells?.get(spillColumn))) {
          break;
        }
        availableWidthPt += columnAxis.sizesPt[neighborPosition]!;
        spillColumn++;
      }
      if (lineWidthPt > availableWidthPt) {
        fragments = truncateFragmentsToWidth(fragments, measurer, availableWidthPt);
      }
    } else {
      fragments = truncateFragmentsToWidth(fragments, measurer, availableWidthPt);
    }
  }

  const alignOffsetPt = alignmentOffsetPt(alignment, availableWidthPt, lineWidthPt);
  const textStartXPt = xLeftPt + CELL_TEXT_PADDING_PT + alignOffsetPt;
  const lineHeightPt = lineNaturalHeightPt(naturalLine, measurer, styledRuns[0]!);
  const lineTopYDownPt = verticalLineTopYDownPt(cell.verticalAlignment ?? DEFAULT_CELL_VERTICAL_ALIGNMENT, yTopDownPt, heightPt, lineHeightPt);
  const baselineYDownPt = lineTopYDownPt + naturalLine.ascentPt;
  // Only a genuinely non-final, non-overflowing line gets its inter-word gaps stretched -- see src/layout/engine.ts's identical convention. A cell that triggered the numeric-'###'/string-spill-or-truncate overflow path above is never justified (its own fragments no longer reflect the natural, unstretched layout this function needs), and neither is the ordinary single-line cell (lines.length === 1), matching every real spreadsheet application's own "justify only wraps, never a single line" behaviour.
  const justifyGapsPt = alignment === 'justify' && !overflowed && lines.length > 1 ? justifyLineGapsPt(naturalLine, availableWidthPt, measurer) : undefined;

  fragments.forEach((fragment, fragmentIndex) => {
    const textItem: LayoutText = {
      kind: 'text',
      text: fragment.text,
      xPt: textStartXPt + fragment.xOffsetPt + (justifyGapsPt?.[fragmentIndex] ?? 0),
      yPt: pageHeightPt - baselineYDownPt,
      font: fragment.font,
      sizePt: fragment.sizePt,
      color: fragment.color,
      underline: fragment.underline,
      sourcePath: fragment.sourcePath,
    };
    out.push(textItem);
  });
}

// --- Header-gutter labels and gridlines -------------------------------------------------------

function renderHeaderLabels(gutter: HeaderGutter, columnAxis: PositionedAxis, rowAxis: PositionedAxis, gridLeftXPt: number, gridTopYDownPt: number, pageHeightPt: number, measurer: TextMeasurer, out: LayoutItem[]): void {
  const lineHeightPt = measurer.lineHeightAtSize(DEFAULT_LAYOUT_FONT, HEADER_LABEL_SIZE_PT);
  const ascentPt = measurer.ascenderAtSize(DEFAULT_LAYOUT_FONT, HEADER_LABEL_SIZE_PT);

  columnAxis.indices.forEach((columnIndex, position) => {
    const label = columnLetters(columnIndex);
    const widthPt = columnAxis.sizesPt[position]!;
    const labelWidthPt = measurer.widthOfTextAtSize(label, DEFAULT_LAYOUT_FONT, HEADER_LABEL_SIZE_PT);
    const xPt = gridLeftXPt + columnAxis.offsetsPt[position]! + alignmentOffsetPt('center', widthPt, labelWidthPt);
    const baselineYDownPt = gridTopYDownPt - gutter.heightPt + (gutter.heightPt - lineHeightPt) / 2 + ascentPt;
    out.push({ kind: 'text', text: label, xPt, yPt: pageHeightPt - baselineYDownPt, font: DEFAULT_LAYOUT_FONT, sizePt: HEADER_LABEL_SIZE_PT, color: HEADER_LABEL_COLOR });
  });

  rowAxis.indices.forEach((rowIndex, position) => {
    const label = String(rowIndex + 1);
    const heightPt = rowAxis.sizesPt[position]!;
    const labelWidthPt = measurer.widthOfTextAtSize(label, DEFAULT_LAYOUT_FONT, HEADER_LABEL_SIZE_PT);
    const xPt = gridLeftXPt - gutter.widthPt + Math.max(HEADER_LABEL_PADDING_PT, gutter.widthPt - HEADER_LABEL_PADDING_PT - labelWidthPt);
    const rowTopYDownPt = gridTopYDownPt + rowAxis.offsetsPt[position]!;
    const baselineYDownPt = rowTopYDownPt + Math.max(0, (heightPt - lineHeightPt) / 2) + ascentPt;
    out.push({ kind: 'text', text: label, xPt, yPt: pageHeightPt - baselineYDownPt, font: DEFAULT_LAYOUT_FONT, sizePt: HEADER_LABEL_SIZE_PT, color: HEADER_LABEL_COLOR });
  });
}

// One LayoutLine per row/column boundary spanning the FULL grid extent -- never one per cell, both for correctness (a per-cell line would double-paint every interior boundary) and for output size on a large sheet.
function renderGridlines(gridLeftXPt: number, gridTopYDownPt: number, gridWidthPt: number, gridHeightPt: number, columnOffsetsPt: readonly number[], rowOffsetsPt: readonly number[], pageHeightPt: number, out: LayoutItem[]): void {
  for (const offsetPt of columnOffsetsPt) {
    const xPt = gridLeftXPt + offsetPt;
    const line: LayoutLine = { kind: 'line', x1Pt: xPt, y1Pt: pageHeightPt - gridTopYDownPt, x2Pt: xPt, y2Pt: pageHeightPt - (gridTopYDownPt + gridHeightPt), color: GRIDLINE_COLOR, widthPt: GRIDLINE_WIDTH_PT };
    out.push(line);
  }
  for (const offsetPt of rowOffsetsPt) {
    const yDownPt = gridTopYDownPt + offsetPt;
    const line: LayoutLine = { kind: 'line', x1Pt: gridLeftXPt, y1Pt: pageHeightPt - yDownPt, x2Pt: gridLeftXPt + gridWidthPt, y2Pt: pageHeightPt - yDownPt, color: GRIDLINE_COLOR, widthPt: GRIDLINE_WIDTH_PT };
    out.push(line);
  }
}

// --- Orchestration: steps 1-6, plus per-page step 7 -----------------------------------------------

// The print range's own [start, end] on one axis, with any repeat-band sub-range removed -- the repeat band is reserved and re-emitted separately on every page (step 3), never itself subject to banding.
function bandableIndices(start: number, end: number, repeat: { readonly start: number; readonly end: number } | undefined): number[] {
  const indices: number[] = [];
  for (let i = start; i <= end; i++) {
    if (repeat !== undefined && i >= repeat.start && i <= repeat.end) {
      continue;
    }
    indices.push(i);
  }
  return indices;
}

function rangeIndices(start: number, end: number): number[] {
  const indices: number[] = [];
  for (let i = start; i <= end; i++) {
    indices.push(i);
  }
  return indices;
}

function convertSheetToPages(sheet: ContentSheet, measurer: TextMeasurer, signal: AbortSignal | undefined, out: LayoutPage[]): void {
  throwIfAborted(signal);
  const range = resolvePrintRange(sheet);
  if (range === undefined) {
    return;
  }
  const { printSettings } = sheet;
  const { pageSize, margins } = printSettings;
  const pageContentWidthPt = Math.max(0, pageSize.widthPt - margins.leftPt - margins.rightPt);
  const pageContentHeightPt = Math.max(0, pageSize.heightPt - margins.topPt - margins.bottomPt);

  const columnEntries = resolveAxis(sheet.columns.map((c) => ({ index: c.index, sizePt: c.widthPt, hidden: c.hidden })), range.startColumn, range.endColumn, DEFAULT_COLUMN_WIDTH_PT);
  const rowEntries = resolveAxis(sheet.rows.map((r) => ({ index: r.index, sizePt: r.heightPt, hidden: r.hidden })), range.startRow, range.endRow, DEFAULT_ROW_HEIGHT_PT);
  const columnSizeByIndex = new Map(columnEntries.map((e) => [e.index, e.sizePt]));
  const rowSizeByIndex = new Map(rowEntries.map((e) => [e.index, e.sizePt]));
  // "Skip hidden entirely" (step 2) means the CELL, not merely its column/row's own contribution to cumulative offsets: a hidden column still resolves to width 0 (so its anchored cell's own available text width is 0), which would otherwise trigger the numeric/string overflow path and render a stray '###' or truncated fragment at zero width, overlapping whatever visible column happens to sit at that same x position -- confirmed by manually rendering and pdftotext-inspecting a real fixture with a hidden column during this module's own real-file verification. Anchor-position hidden-ness is checked directly against these two sets before a cell is ever handed to renderCellText, rather than relying on its own zero-width overflow behaviour to happen to look empty.
  const hiddenColumnIndices = new Set(columnEntries.filter((e) => e.hidden).map((e) => e.index));
  const hiddenRowIndices = new Set(rowEntries.filter((e) => e.hidden).map((e) => e.index));

  const gutter = computeHeaderGutter(printSettings, range, measurer);

  const repeatColumns = printSettings.repeatColumns;
  const repeatRows = printSettings.repeatRows;
  const repeatColumnIndices = repeatColumns === undefined ? [] : rangeIndices(repeatColumns.start, repeatColumns.end);
  const repeatRowIndices = repeatRows === undefined ? [] : rangeIndices(repeatRows.start, repeatRows.end);
  const repeatColumnsWidthPt = repeatColumnIndices.reduce((sum, i) => sum + (columnSizeByIndex.get(i) ?? 0), 0);
  const repeatRowsHeightPt = repeatRowIndices.reduce((sum, i) => sum + (rowSizeByIndex.get(i) ?? 0), 0);

  const bandableColumnIndices = bandableIndices(range.startColumn, range.endColumn, repeatColumns);
  const bandableRowIndices = bandableIndices(range.startRow, range.endRow, repeatRows);

  const availableWidthPt = Math.max(0, pageContentWidthPt - gutter.widthPt - repeatColumnsWidthPt);
  const availableHeightPt = Math.max(0, pageContentHeightPt - gutter.heightPt - repeatRowsHeightPt);
  const totalBandableWidthPt = bandableColumnIndices.reduce((sum, i) => sum + (columnSizeByIndex.get(i) ?? 0), 0);
  const totalBandableHeightPt = bandableRowIndices.reduce((sum, i) => sum + (rowSizeByIndex.get(i) ?? 0), 0);

  const scale = resolveScale(printSettings, availableWidthPt, availableHeightPt, totalBandableWidthPt, totalBandableHeightPt);
  const descaledAvailableWidthPt = availableWidthPt / scale;
  const descaledAvailableHeightPt = availableHeightPt / scale;

  const manualBreakColumns = new Set(printSettings.manualBreaks?.columns ?? []);
  const manualBreakRows = new Set(printSettings.manualBreaks?.rows ?? []);
  throwIfAborted(signal);
  const columnBands = partitionIndices(bandableColumnIndices, (i) => columnSizeByIndex.get(i) ?? 0, descaledAvailableWidthPt, manualBreakColumns);
  const rowBands = partitionIndices(bandableRowIndices, (i) => rowSizeByIndex.get(i) ?? 0, descaledAvailableHeightPt, manualBreakRows);

  const cellsByRow = new Map<number, Map<number, ContentSheetCell>>();
  for (const cell of sheet.cells) {
    let row = cellsByRow.get(cell.row);
    if (row === undefined) {
      row = new Map();
      cellsByRow.set(cell.row, row);
    }
    row.set(cell.column, cell);
  }

  const scaledSizeOf = (sizeByIndex: ReadonlyMap<number, number>) => (index: number) => (sizeByIndex.get(index) ?? 0) * scale;
  const unscaledSizeOf = (sizeByIndex: ReadonlyMap<number, number>) => (index: number) => sizeByIndex.get(index) ?? 0;

  // Step 6: emit pages in printSettings.pageOrder across the column-band x row-band grid. 'overThenDown' completes a full row of column bands before moving to the next row band (columns vary fastest); 'downThenOver' completes a full column of row bands before moving to the next column band (rows vary fastest) -- ODF's own real default, per odf.js's readOds module doc.
  const bandPairs: { readonly columnBand: readonly number[]; readonly rowBand: readonly number[] }[] =
    printSettings.pageOrder === 'overThenDown'
      ? rowBands.flatMap((rowBand) => columnBands.map((columnBand) => ({ columnBand, rowBand })))
      : columnBands.flatMap((columnBand) => rowBands.map((rowBand) => ({ columnBand, rowBand })));

  for (const { columnBand, rowBand } of bandPairs) {
    throwIfAborted(signal);
    const columnAxis = buildPositionedAxis(repeatColumnIndices, unscaledSizeOf(columnSizeByIndex), columnBand, scaledSizeOf(columnSizeByIndex));
    const rowAxis = buildPositionedAxis(repeatRowIndices, unscaledSizeOf(rowSizeByIndex), rowBand, scaledSizeOf(rowSizeByIndex));

    const gridLeftXPt = margins.leftPt + gutter.widthPt;
    const gridTopYDownPt = margins.topPt + gutter.heightPt;
    const gridWidthPt = columnAxis.offsetsPt[columnAxis.offsetsPt.length - 1]!;
    const gridHeightPt = rowAxis.offsetsPt[rowAxis.offsetsPt.length - 1]!;

    // Z-order step 7, now emitted in full: cell backgrounds -> gridlines -> cell borders -> headers -> cell text. The three cell-derived layers are collected into their own arrays during ONE walk over the populated cells (rather than three separate walks over the same 50k cells), then concatenated in that order -- so a cell's own declared border paints over the generic gridline underneath it, and every cell's text paints over every cell's background, exactly as a real spreadsheet renders them.
    const backgroundItems: LayoutItem[] = [];
    const borderItems: LayoutItem[] = [];
    const textItems: LayoutItem[] = [];

    for (const rowIndex of rowAxis.indices) {
      const rowCells = cellsByRow.get(rowIndex);
      if (rowCells === undefined) {
        continue;
      }
      for (const [columnIndex, cell] of rowCells) {
        throwIfAborted(signal); // the main cell-emission loop -- checked per populated cell, not merely once per page, since a single band can carry the large majority of a 50k-cell sheet's own content.
        if (!columnAxis.positionByIndex.has(columnIndex) || hiddenColumnIndices.has(columnIndex) || hiddenRowIndices.has(cell.row)) {
          continue;
        }
        const cellFrame = resolveCellFrame(cell, columnAxis, rowAxis, gridLeftXPt, gridTopYDownPt);
        if (cellFrame === undefined) {
          continue;
        }
        renderCellBackground(cell, cellFrame, pageSize.heightPt, backgroundItems);
        if (cell.borders !== undefined) {
          pushCellBorderLines(cell.borders, cellFrame, pageSize.heightPt, cell.sourcePath, borderItems);
        }
        renderCellText(cell, cellFrame, rowCells, columnAxis, pageSize.heightPt, measurer, textItems);
      }
    }

    const items: LayoutItem[] = [...backgroundItems];
    if (printSettings.gridlines) {
      renderGridlines(gridLeftXPt, gridTopYDownPt, gridWidthPt, gridHeightPt, columnAxis.offsetsPt, rowAxis.offsetsPt, pageSize.heightPt, items);
    }
    items.push(...borderItems);
    if (printSettings.headers) {
      renderHeaderLabels(gutter, columnAxis, rowAxis, gridLeftXPt, gridTopYDownPt, pageSize.heightPt, measurer, items);
    }
    items.push(...textItems);

    out.push({ widthPt: pageSize.widthPt, heightPt: pageSize.heightPt, items });
  }
}

// ContentSheet.embeddedObjects (an objectKind: 'formula' entry among them would be this module's own equivalent of engine.ts's/slides.ts's formula-rendering branch) is never populated by odf.js's own readOds, unlike readOdt's/readOdp's readers, so an embedded formula inside an ods sheet does not render as MathML today. Re-verified against the installed odf.js 2.0.0 rather than assumed: its own readSheet (typed/ods/read.ts) returns `{ name, cells, columns, rows, images: [], printSettings }` -- `images` hardcoded empty, `embeddedObjects` never set at all -- and readOds itself only ever walks the `table:table` children of `office:spreadsheet`, so a floating `draw:frame` on a sheet is not merely unresolved, it is never visited. There is consequently no anchor-resolution result for a formula-detection pass to hang a position off, which is exactly what src/odf/odt/read.ts's and src/odf/odp/read.ts's own passes DO have (readOdt's own per-child block counting, readOdp's own walkDrawShapes shape indices) and what makes theirs able to place a formula precisely rather than guess. ContentSheetImage is the identical, pre-existing gap on the write side -- see buildOdsPackage's own module comment in src/edit/ods/content.ts. A real, tracked, bounded gap inherited from upstream, not one this module introduces.
export function convertSpreadsheetToLayout(doc: SpreadsheetContentDocument, options: SheetsLayoutOptions): LayoutDocument {
  const pages: LayoutPage[] = [];
  for (const sheet of doc.sheets) {
    convertSheetToPages(sheet, options.measurer, options.signal, pages);
  }
  return { formatVersion: LAYOUT_FORMAT_VERSION, metadata: doc.metadata, pages, images: {} };
}
