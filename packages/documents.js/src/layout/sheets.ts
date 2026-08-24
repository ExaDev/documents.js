import type {
  Box,
  ContentCellValue,
  ContentDocument,
  ContentEmbeddedObject,
  ContentFormula,
  ContentSheet,
  ContentSheetCell,
  ContentSheetImage,
  ContentSheetPrintRange,
  ContentSheetPrintSettings,
  PageSize,
} from "document-schema.js";
import { columnIndexToLetters } from "document-schema.js";
import { layoutFormula } from "../mathml/layout";
import type { Color as LayoutColor } from "document-schema.js";
import { COLOR_BLACK, rgbHexToColor } from "document-schema.js";
import type { Alignment } from "document-schema.js";
import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import { flipY } from "../model/geometry";
import { throwIfAborted } from "../ports/abort";
import type {
  MathFontMetrics,
  PositionedFormula,
  StyledFragment,
  StyledRun,
  TextMeasurer,
} from "document-schema.js";
import { wrapRunsToWidth } from "./text-layout";
import {
  alignmentOffsetPt,
  formulaSizePtForFrame,
  justifyLineGapsPt,
  lineNaturalHeightPt,
  layoutDocumentOf,
  packagePagesOf,
  pushCellBorderLines,
  registerImage,
  stampFragmentFrame,
  stampFrame,
  sumColumnWidthsPt,
  toStyledRuns,
} from "./shared";
import type {
  LayoutDocument,
  LayoutImage,
  LayoutImageAsset,
  LayoutItem,
  LayoutLine,
  LayoutPage,
  LayoutText,
} from "pdf-codec";

// ContentDocument (the spreadsheet variant) -> LayoutDocument: ods/xlsx's own layout direction, genuinely distinct from both docx's flow/pagination (engine.ts) and pptx's direct placement (slides.ts). A sheet paginates over TWO axes at once (column bands x row bands, not just rows), print settings (range/scale/fit-to-page/repeat rows-columns/gridlines/headers/page order/manual breaks) drive the page grid directly rather than being ignored the way a docx section's margins alone would be, and cell overflow is bounded per cell (###, spill, truncate) rather than wrapped the way paragraph text is. This is also the first layout algorithm in the package genuinely long-running enough (a real sheet can carry tens of thousands of populated cells) to need cooperative cancellation wired into its own per-cell emission loop, not just checked once at the top of the function the way reconstruct.ts's own page/slide loops do.
//
// ContentSheetCellSchema carries real per-cell decoration as of document-schema.js 2.0.0 -- background, borders, alignment, and verticalAlignment -- all four of which odf.js's own readOdsContent genuinely populates from a cell's resolved style chain (typed/shared/table.ts's readCellStyleDecoration), so every one of them is live data here, not a speculatively-consumed field. The z-order below emits a real background LayoutRect and real border LayoutLines accordingly, and a cell's own explicit alignment/verticalAlignment override the value-kind default rather than being ignored. A border's own dash STYLE now carries through too, as of document-schema.js 2.1.0 adding that same optional enum to LayoutLineSchema/LayoutPathSchema -- see pushCellBorderLines (src/layout/shared.ts) for the mechanism, and for the separate, still-open question of whether pdf-codec's own write.ts does anything with it yet.
//
// A cell's own text is laid out as a SINGLE line, never wrapped or stacked -- deliberate, narrower scope than docx/pptx paragraph flow: a spreadsheet cell's overflow rule (###, spill, truncate) is a single-line concept in every real spreadsheet application, and the task this module implements specifies exactly that. A cell whose own source text contains an explicit line break (readOdsContent's own multi text:p-per-cell join, a rare Alt+Enter case) has wrapRunsToWidth produce more than one WrappedLine; only the FIRST is rendered here, a documented, narrow scope boundary rather than a silent truncation.

export interface SheetsLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly mathMetricsAt: (sizePt: number) => MathFontMetrics;
  // The only layout engine in this package that needs one: a 50k-cell sheet's own cell-emission loop can run long enough to be worth cancelling mid-page, unlike a docx/pptx document's own, much smaller, page/slide count.
  readonly signal?: AbortSignal;
}

export interface SpreadsheetLayoutResult {
  readonly document: LayoutDocument;
  // Every cell-anchored embedded formula actually rendered via src/mathml, already positioned in PDF page space (bottom-left origin, y-up) -- pdf-codec's write.ts's own WritePdfOptions.formulas consumes this directly. Structurally identical to src/layout/engine.ts's WordprocessingLayoutResult.formulas and src/layout/slides.ts's PresentationLayoutResult.formulas; see the former's own comment for why a formula's CID-font glyph runs can't travel through LayoutDocument.pages[].items itself.
  readonly formulas: readonly PositionedFormula[];
  // The DocumentTree's own pages array (each rendered page's size, indexed to match every content node's own frames[].pageIndex) -- the input `doc` argument itself comes back with frames stamped in place, which together with this array is the fused unified package a conversion reports through onDocument.
  readonly pages: readonly PageSize[];
}

type SpreadsheetContentDocument = Extract<
  ContentDocument,
  { kind: "spreadsheet" }
>;

// --- Cell-anchored embedded formulas ------------------------------------------------------------

// One ContentSheet.embeddedObjects entry this module can genuinely place and typeset: a formula-kind object whose own document really carries MathML, anchored to a concrete cell. Resolving the entry once, up front, is what lets both resolvePrintRange (which must widen the printed area to cover an anchor cell outside the populated-cell extent) and the per-page emission below work off the same narrowed shape rather than each repeating the same four-way check.
interface AnchoredFormula {
  readonly formula: ContentFormula;
  readonly anchorRow: number;
  readonly anchorColumn: number;
  // Both relative to the anchor CELL's own top-left corner, y-down -- ODF's own draw:frame svg:x/svg:y inside a table:table-cell, which odf.js's readOdsContent surfaces verbatim. A page-anchored (table:shapes) object is encoded by that same reader as anchor cell (0, 0) plus an offset that is already absolute in sheet space, so it needs no separate branch here.
  readonly offsetXPt: number;
  readonly offsetYPt: number;
  readonly frame: Box;
}

// Narrows a sheet's own embedded objects to the ones renderable here. An entry is skipped -- deliberately, and only for a named reason -- when: its objectKind is not 'formula' (a nested wordprocessing/presentation/spreadsheet/drawing sub-document has no layout path of its own in this package, from a sheet or anywhere else); its document is not a formula document or carries no MathML nodes to typeset (nothing to render, and unlike engine.ts's flow placement there is no surrounding text flow for a plain-text stand-in to occupy -- a stand-in dropped at an arbitrary cell offset would be new invented content, not a degraded rendering of real content); or it carries no anchor row/column pair. That last case is not a fallback opportunity: ContentEmbeddedObject.frame means document space for an odt block and slide space for an odp shape, but for a sheet odf.js populates it with the CELL-relative offsets, so an entry with no anchor has no coordinate space its frame can be interpreted in at all.
function anchoredFormulas(sheet: ContentSheet): AnchoredFormula[] {
  const resolved: AnchoredFormula[] = [];
  for (const object of sheet.embeddedObjects ?? []) {
    const anchored = resolveAnchoredFormula(object);
    if (anchored !== undefined) {
      resolved.push(anchored);
    }
  }
  return resolved;
}

function resolveAnchoredFormula(
  object: ContentEmbeddedObject,
): AnchoredFormula | undefined {
  if (
    object.objectKind !== "formula" ||
    object.document.kind !== "formula" ||
    object.document.formula.mathml.length === 0
  ) {
    return undefined;
  }
  const { anchorRow, anchorColumn, offsetXPt, offsetYPt } = object;
  if (
    anchorRow === undefined ||
    anchorColumn === undefined ||
    offsetXPt === undefined ||
    offsetYPt === undefined
  ) {
    return undefined;
  }
  return {
    formula: object.document.formula,
    anchorRow,
    anchorColumn,
    offsetXPt,
    offsetYPt,
    frame: object.frame,
  };
}

// --- Nominal fallbacks and rendering constants, each documented rather than a bare literal -----

// A column/row with no explicit ContentSheetColumn/ContentSheetRow entry of its own falls back to these -- exercised only for malformed or hand-built input; every real producer (confirmed for LibreOffice via odf.js's own readOdsContent) emits an explicit entry for every real column/row it ever touched. Values match Excel/Calc's own real default column width (8.43 characters at the default font, ~64pt) and default row height (~15pt at the default 10-11pt body font).
const DEFAULT_COLUMN_WIDTH_PT = 64;
const DEFAULT_ROW_HEIGHT_PT = 15;

// A nominal fallback text size for a cell with no runs of its own (the common case -- ContentSheetCell.runs is populated only for genuinely mixed inline formatting, per its own schema comment) and therefore no resolvable size anywhere in the model. Deliberately its own constant, distinct from shared.ts's NOMINAL_TEXT_SIZE_PT (18pt, a docx/pptx PARAGRAPH fallback) -- applying that size to an ordinary spreadsheet cell would visually swamp a real row height. Matches Excel/Calc's own common 10-11pt body-cell default.
export const NOMINAL_CELL_TEXT_SIZE_PT = 10;
// The row/column header-gutter's own label size -- smaller again, matching Excel/Calc's own small grey header-label chrome.
const HEADER_LABEL_SIZE_PT = 8;

// Inset between a cell's own frame edge and its rendered text, and between a header-gutter label and its own gutter edge -- ordinary spreadsheet cell/label padding.
const CELL_TEXT_PADDING_PT = 2;
const HEADER_LABEL_PADDING_PT = 2;

// A misconfigured page/margin/gutter/repeat-band combination could otherwise leave zero or negative available print area, which would divide the band-partition boundary by zero (or a negative number) computing a descaled boundary -- clamped to a small positive floor so band partitioning always terminates with well-defined positive widths rather than Infinity/NaN geometry, the same "at least make progress on pathological input" reasoning pdf-codec's text-layout.ts's own emergency character split documents.
const MINIMUM_SCALE = 0.01;

// The literal sentinel spreadsheet applications universally render for a numeric-kind value that doesn't fit its own column -- not a computed fill-to-width run of '#' the way a real spreadsheet UI does, since the task this module implements pins down this exact literal.
const NUMERIC_OVERFLOW_TEXT = "###";

const GRIDLINE_COLOR: LayoutColor = rgbHexToColor("#D0D0D0");
const GRIDLINE_WIDTH_PT = 0.5;
const HEADER_LABEL_COLOR: LayoutColor = rgbHexToColor("#606060");

// --- Step 1: resolve the print range -----------------------------------------------------------

// The sheet's own explicit table:print-ranges-derived range if set, else the full extent of populated cells (accounting for a merged anchor cell's own colSpan/rowSpan reaching beyond its own row/column) UNION every renderable formula's own anchor cell and every floating image's own anchor cell. undefined when the sheet has no explicit range, no cells, no anchored formula, and no floating image at all -- nothing to lay out.
//
// A cell-anchored drawing genuinely extends a sheet's used area in a real spreadsheet application (Calc/Excel both treat a cell an object is anchored to as part of the sheet's own used extent, and both print it), so a formula or image anchored below or to the right of the last populated cell must widen the range rather than fall outside every band and silently never render. The union is over anchor CELLS only, not over each formula's/image's own rendered box: a drawing overflowing past its anchor cell's bounds paints over whatever follows exactly as it does in Calc, the same way an oversized cell's own text already overflows here, rather than reserving further empty rows/columns nothing else occupies.
function resolvePrintRange(
  sheet: ContentSheet,
  formulas: readonly AnchoredFormula[],
): ContentSheetPrintRange | undefined {
  if (sheet.printSettings.printRange !== undefined) {
    return sheet.printSettings.printRange;
  }
  if (
    sheet.cells.length === 0 &&
    formulas.length === 0 &&
    sheet.images.length === 0
  ) {
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
  for (const formula of formulas) {
    startRow = Math.min(startRow, formula.anchorRow);
    startColumn = Math.min(startColumn, formula.anchorColumn);
    endRow = Math.max(endRow, formula.anchorRow);
    endColumn = Math.max(endColumn, formula.anchorColumn);
  }
  for (const image of sheet.images) {
    startRow = Math.min(startRow, image.anchorRow);
    startColumn = Math.min(startColumn, image.anchorColumn);
    endRow = Math.max(endRow, image.anchorRow);
    endColumn = Math.max(endColumn, image.anchorColumn);
  }
  return { startRow, startColumn, endRow, endColumn };
}

// --- Step 2: cumulative column/row offset arrays, skipping hidden entirely ---------------------

interface AxisEntry {
  readonly index: number;
  readonly sizePt: number; // 0 for a hidden index -- contributes nothing to any cumulative offset, matching "skip hidden entirely"
  readonly hidden: boolean;
}

// Resolves one size (and hidden-ness) per index across [start, end] from a sparse, run-length-compressed entries array (document order; real producers emit exactly one entry per STARTING index of a repeated run -- see odf.js's own readOdsContent module doc) -- entry N's own size/hidden-ness applies to every index from its own index up to (but not including) the next entry's index, mirroring how the source format itself compresses a run of identically-formatted columns/rows. An index before the first entry, or with no entries at all, falls back to defaultSizePt.
//
// entries[i].sizePt is `number | undefined` (ContentSheetColumn.widthPt/ContentSheetRow.heightPt, both optional since document-schema.js 2.0.0) because the two real producers behind this shared field disagree on when a size is knowable at all: odf.js's own readOdsContent always resolves a concrete number for a real column/row element (0 when it carries no explicit style -- see src/edit/ods/column-row.ts's own top-of-file note for why THAT zero is deliberately treated as authoritative below, not defaulted), whereas ooxml.js's readXlsxContent genuinely omits the field outright when an xlsx column has no explicit <col> width. `?? defaultSizePt` below only ever fires for the latter, genuinely-absent case; an ODS-sourced entry's own explicit 0 is a real number, not undefined, so it flows through unchanged exactly as it always has.
function resolveAxis(
  entries: readonly {
    readonly index: number;
    readonly sizePt: number | undefined;
    readonly hidden?: boolean;
  }[],
  start: number,
  end: number,
  defaultSizePt: number,
): AxisEntry[] {
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
    resolved.push({
      index,
      sizePt: currentHidden ? 0 : currentSizePt,
      hidden: currentHidden,
    });
  }
  return resolved;
}

// --- Step 3: header-gutter and repeat-row/column reservation -----------------------------------

interface HeaderGutter {
  readonly widthPt: number; // reserved at the page's own left edge for row-number labels
  readonly heightPt: number; // reserved at the page's own top edge for column-letter labels
}

// Sized directly from real font metrics rather than a flat guess: the row-number gutter is exactly as wide as the LARGEST row number that can appear (the print range's own last row, 1-based for display) needs at the header label's own font/size, and the column-letter gutter is exactly one header-label line tall.
function computeHeaderGutter(
  printSettings: ContentSheetPrintSettings,
  range: ContentSheetPrintRange,
  measurer: TextMeasurer,
): HeaderGutter {
  if (!printSettings.headers) {
    return { widthPt: 0, heightPt: 0 };
  }
  const widestRowLabel = String(range.endRow + 1);
  return {
    widthPt:
      measurer.widthOfTextAtSize(
        widestRowLabel,
        DEFAULT_LAYOUT_FONT,
        HEADER_LABEL_SIZE_PT,
      ) +
      HEADER_LABEL_PADDING_PT * 2,
    heightPt: measurer.lineHeightAtSize(
      DEFAULT_LAYOUT_FONT,
      HEADER_LABEL_SIZE_PT,
    ),
  };
}

// --- Step 4: resolve scale -----------------------------------------------------------------------

// Explicit printSettings.scalePercent (a raw percentage, e.g. 150 for "150%" -- odf.js's own readOdsContent reads it this way, confirmed by its own test suite) takes priority; else a non-iterative fit-to-page computed directly from the ratio of available-print-area-across-N-pages to total unscaled content size, clamped to never upscale; else 1. Header-gutter and repeat-row/column space is deliberately NOT scaled (reserved at a fixed size on every page, the same "fixed chrome" treatment a spreadsheet UI itself gives its own row/column address labels) -- only the print range's own bandable cell content scales.
function resolveScale(
  printSettings: ContentSheetPrintSettings,
  availableWidthPt: number,
  availableHeightPt: number,
  totalContentWidthPt: number,
  totalContentHeightPt: number,
): number {
  if (printSettings.scalePercent !== undefined) {
    return Math.max(printSettings.scalePercent / 100, MINIMUM_SCALE);
  }
  if (printSettings.fitToPages !== undefined) {
    const budgetWidthPt = availableWidthPt * printSettings.fitToPages.width;
    const budgetHeightPt = availableHeightPt * printSettings.fitToPages.height;
    const widthRatio =
      totalContentWidthPt > 0 ? budgetWidthPt / totalContentWidthPt : 1;
    const heightRatio =
      totalContentHeightPt > 0 ? budgetHeightPt / totalContentHeightPt : 1;
    return Math.max(Math.min(widthRatio, heightRatio, 1), MINIMUM_SCALE);
  }
  return 1;
}

// --- Step 5: partition into column/row bands -----------------------------------------------------

// Walks `indices` (already limited to the bandable set -- i.e. excluding any repeat-row/column range, which is reserved and re-emitted separately, never banded) in order, closing the current band and starting a fresh one whenever the next index would overflow the available space, honoring a manual break as an unconditional close. Mirrors src/layout/engine.ts's own ensureRoom exactly: an index whose own size alone exceeds availablePt still gets exactly one band to itself (added to an EMPTY band unconditionally) and simply overflows, rather than looping forever trying to fit it -- the identical "oversized item gets its own page" guarantee, applied to the column/row axis instead of the paragraph-flow axis.
function partitionIndices(
  indices: readonly number[],
  sizeOf: (index: number) => number,
  availablePt: number,
  manualBreaks: ReadonlySet<number>,
): number[][] {
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

// A cell's own runs when present, otherwise a single synthetic run built from its own displayText at the nominal cell text size -- ContentSheetCellSchema carries no cell-level font/size/colour of its own to fall back to otherwise. A real reader populates `runs` far more often than ContentSheetCellSchema's own doc comment ("the rare case of genuinely mixed inline formatting") suggests -- confirmed via this module's own real-file verification against odf.js's readOdsContent: EVERY cell with any text at all gets a `runs` array (readCellText always calls readOdfParagraph), not only cells with genuinely mixed formatting, and those runs carry no sizePt of their own for ordinary unstyled text. Passing such a run straight to toStyledRuns would fall through to ITS OWN default (shared.ts's NOMINAL_TEXT_SIZE_PT, 18pt, a docx-PARAGRAPH fallback) rather than this module's own 10pt spreadsheet-cell nominal size -- exactly the mismatch this module's own top-of-file doc comment already warns about for the no-runs case, so each run missing its own sizePt is defaulted here, before toStyledRuns ever sees it, rather than left to toStyledRuns's own unrelated default.
function cellStyledRuns(cell: ContentSheetCell): StyledRun[] {
  if (cell.runs !== undefined && cell.runs.length > 0) {
    const runsWithNominalSize = cell.runs.map((run) =>
      run.sizePt === undefined
        ? { ...run, sizePt: NOMINAL_CELL_TEXT_SIZE_PT }
        : run,
    );
    return toStyledRuns(runsWithNominalSize);
  }
  return [
    {
      text: cell.displayText,
      font: DEFAULT_LAYOUT_FONT,
      sizePt: NOMINAL_CELL_TEXT_SIZE_PT,
      color: COLOR_BLACK,
    },
  ];
}

// number/percentage/currency/date/time/dateTime are all numeric-NATURED values (ContentCellValueSchema's own comment: it "mirrors ODF's own office:value-type vocabulary", and ODF itself stores date/time/dateTime as numeric serial values under the hood) -- the task's own literal list ("numeric/percentage/currency -> right") names the three most common members as a proxy for this whole numeric-natured bucket, not an exhaustive exclusion of date/time/dateTime; a real spreadsheet application right-aligns and '###'-overflows dates, times, and combined date-times exactly the same way it does plain numbers. dateTime is document-schema.js 2.0.0's own new ContentCellValue kind (a combined office:value-type="date" ISO-8601 dateTime value, distinct from a bare date or bare time) -- included here on the same "numeric-natured" reasoning as its date/time siblings, not left to default to 'string' treatment by omission. Extended deliberately, not silently -- see this module's own doc comment.
function isNumericLikeValue(kind: ContentCellValue["kind"]): boolean {
  return (
    kind === "number" ||
    kind === "percentage" ||
    kind === "currency" ||
    kind === "date" ||
    kind === "time" ||
    kind === "dateTime"
  );
}

function defaultAlignmentForValue(kind: ContentCellValue["kind"]): Alignment {
  if (isNumericLikeValue(kind)) {
    return "right";
  }
  if (kind === "boolean" || kind === "error") {
    return "center";
  }
  return "left"; // 'string' and 'empty'
}

function isCellVisuallyEmpty(cell: ContentSheetCell | undefined): boolean {
  return (
    cell === undefined ||
    (cell.value.kind === "empty" && cell.displayText.length === 0)
  );
}

// Truncates a wrapped line's own fragments to fit maxWidthPt, stopping at the fragment that crosses the boundary and character-truncating just that one -- deliberately simpler than pdf-codec's text-layout.ts's own (private) splitBoxToWidth: a spreadsheet cell's overflow has no "rest" to requeue onto a following line, since a cell never wraps to a second line for width reasons -- it simply stops rendering at the boundary.
function truncateFragmentsToWidth(
  fragments: readonly (StyledFragment & { readonly xOffsetPt: number })[],
  measurer: TextMeasurer,
  maxWidthPt: number,
): (StyledFragment & { readonly xOffsetPt: number })[] {
  const result: (StyledFragment & { readonly xOffsetPt: number })[] = [];
  for (const fragment of fragments) {
    if (fragment.xOffsetPt >= maxWidthPt) {
      break;
    }
    const remainingWidthPt = maxWidthPt - fragment.xOffsetPt;
    const fullWidthPt = measurer.widthOfTextAtSize(
      fragment.text,
      fragment.font,
      fragment.sizePt,
    );
    if (fullWidthPt <= remainingWidthPt) {
      result.push(fragment);
      continue;
    }
    const chars = Array.from(fragment.text);
    let width = 0;
    let fitCount = 0;
    for (const char of chars) {
      const charWidthPt = measurer.widthOfTextAtSize(
        char,
        fragment.font,
        fragment.sizePt,
      );
      if (width + charWidthPt > remainingWidthPt) {
        break;
      }
      width += charWidthPt;
      fitCount++;
    }
    if (fitCount > 0) {
      result.push({ ...fragment, text: chars.slice(0, fitCount).join("") });
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
function buildPositionedAxis(
  repeatIndices: readonly number[],
  repeatSizePtOf: (index: number) => number,
  bandIndices: readonly number[],
  bandSizePtOf: (index: number) => number,
): PositionedAxis {
  const indices = [...repeatIndices, ...bandIndices];
  const sizesPt = [
    ...repeatIndices.map(repeatSizePtOf),
    ...bandIndices.map(bandSizePtOf),
  ];
  const offsetsPt: number[] = [0];
  let running = 0;
  for (const size of sizesPt) {
    running += size;
    offsetsPt.push(running);
  }
  const positionByIndex = new Map(
    indices.map((index, position) => [index, position]),
  );
  return { indices, sizesPt, offsetsPt, positionByIndex };
}

// Sums a positioned axis's own sizes over [startIndex, startIndex + span), clamped to the axis's own bounds -- reused verbatim via shared.ts's sumColumnWidthsPt (a plain array + start + span sum, equally valid read as a column-width sum or a row-height sum) rather than a second, duplicate implementation.
function axisSpanSizePt(
  axis: PositionedAxis,
  startIndex: number,
  span: number,
): number {
  const startPosition = axis.positionByIndex.get(startIndex);
  if (startPosition === undefined) {
    return 0;
  }
  return sumColumnWidthsPt(axis.sizesPt, startPosition, span);
}

// One cell's own box in GRID-local-plus-page space, still y-down (gridLeftXPt/gridTopYDownPt place the grid's own local origin within the page), spanning its full colSpan/rowSpan. undefined when the cell's own anchor position isn't on this page at all -- a merge continuation, or a row/column belonging to another band -- in which case nothing about that cell (background, borders, or text) is drawn here.
function resolveCellFrame(
  cell: ContentSheetCell,
  columnAxis: PositionedAxis,
  rowAxis: PositionedAxis,
  gridLeftXPt: number,
  gridTopYDownPt: number,
): Box | undefined {
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
function renderCellBackground(
  cell: ContentSheetCell,
  frameYDown: Box,
  pageHeightPt: number,
  out: LayoutItem[],
): void {
  if (cell.background === undefined) {
    return;
  }
  const flipped = flipY(frameYDown, pageHeightPt);
  out.push({
    kind: "rect",
    xPt: flipped.xPt,
    yPt: flipped.yPt,
    widthPt: flipped.widthPt,
    heightPt: flipped.heightPt,
    fill: cell.background,
    sourcePath: cell.sourcePath,
  });
}

// The default vertical placement for a cell that declares none -- matching every real spreadsheet application's own default, and preserving exactly the behaviour this module had before ContentSheetCell.verticalAlignment existed to override it.
const DEFAULT_CELL_VERTICAL_ALIGNMENT = "bottom";

// The y-down top of a single rendered line within its own cell, for each of the three vertical alignments ContentSheetCellSchema models. Every branch is clamped to at least one padding inset below the cell's own top, so a line taller than its own cell overflows downward (visible, overlapping the row below) rather than upward into the row above -- the same clamping the bottom-aligned case has always applied, generalised rather than special-cased.
function verticalLineTopYDownPt(
  verticalAlignment: "top" | "middle" | "bottom",
  cellTopYDownPt: number,
  cellHeightPt: number,
  lineHeightPt: number,
): number {
  if (verticalAlignment === "top") {
    return cellTopYDownPt + CELL_TEXT_PADDING_PT;
  }
  if (verticalAlignment === "middle") {
    return (
      cellTopYDownPt +
      Math.max(CELL_TEXT_PADDING_PT, (cellHeightPt - lineHeightPt) / 2)
    );
  }
  return (
    cellTopYDownPt +
    Math.max(
      CELL_TEXT_PADDING_PT,
      cellHeightPt - CELL_TEXT_PADDING_PT - lineHeightPt,
    )
  );
}

// Renders one populated cell's text into `out`, in true PAGE space, within the frame resolveCellFrame already resolved for it. Applies the cell's own explicit alignment/verticalAlignment when it declares one (falling back to the value-kind default and to bottom respectively), and the numeric-'###'/string-spill-then-truncate overflow rules, bounded to the current page's own two axes (a spilled string can extend into a later column on the SAME page, never onto a following page/band).
//
// Overflow still keys off the VALUE kind, never the resolved alignment: '###' is what a spreadsheet shows for a too-narrow numeric cell regardless of which way that cell happens to be aligned, and a right-aligned string still spills into an empty neighbour rather than becoming '###'.
function renderCellText(
  cell: ContentSheetCell,
  frameYDown: Box,
  pageIndex: number,
  rowCells: ReadonlyMap<number, ContentSheetCell> | undefined,
  columnAxis: PositionedAxis,
  pageHeightPt: number,
  measurer: TextMeasurer,
  out: LayoutItem[],
): void {
  const {
    xPt: xLeftPt,
    yPt: yTopDownPt,
    widthPt: ownWidthPt,
    heightPt,
  } = frameYDown;

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
      const overflowRuns: StyledRun[] = [
        {
          text: NUMERIC_OVERFLOW_TEXT,
          font: styledRuns[0]!.font,
          sizePt: styledRuns[0]!.sizePt,
          color: styledRuns[0]!.color,
        },
      ];
      const overflowLine = wrapRunsToWidth(
        overflowRuns,
        measurer,
        Number.POSITIVE_INFINITY,
      )[0]!;
      fragments = overflowLine.fragments;
      lineWidthPt = overflowLine.widthPt;
    } else if (cell.value.kind === "string") {
      let spillColumn = cell.column + (cell.colSpan ?? 1);
      while (lineWidthPt > availableWidthPt) {
        const neighborPosition = columnAxis.positionByIndex.get(spillColumn);
        if (
          neighborPosition === undefined ||
          !isCellVisuallyEmpty(rowCells?.get(spillColumn))
        ) {
          break;
        }
        availableWidthPt += columnAxis.sizesPt[neighborPosition]!;
        spillColumn++;
      }
      if (lineWidthPt > availableWidthPt) {
        fragments = truncateFragmentsToWidth(
          fragments,
          measurer,
          availableWidthPt,
        );
      }
    } else {
      fragments = truncateFragmentsToWidth(
        fragments,
        measurer,
        availableWidthPt,
      );
    }
  }

  const alignOffsetPt = alignmentOffsetPt(
    alignment,
    availableWidthPt,
    lineWidthPt,
  );
  const textStartXPt = xLeftPt + CELL_TEXT_PADDING_PT + alignOffsetPt;
  const lineHeightPt = lineNaturalHeightPt(
    naturalLine,
    measurer,
    styledRuns[0]!,
  );
  const lineTopYDownPt = verticalLineTopYDownPt(
    cell.verticalAlignment ?? DEFAULT_CELL_VERTICAL_ALIGNMENT,
    yTopDownPt,
    heightPt,
    lineHeightPt,
  );
  const baselineYDownPt = lineTopYDownPt + naturalLine.ascentPt;
  // Only a genuinely non-final, non-overflowing line gets its inter-word gaps stretched -- see src/layout/engine.ts's identical convention. A cell that triggered the numeric-'###'/string-spill-or-truncate overflow path above is never justified (its own fragments no longer reflect the natural, unstretched layout this function needs), and neither is the ordinary single-line cell (lines.length === 1), matching every real spreadsheet application's own "justify only wraps, never a single line" behaviour.
  const justifyGapsPt =
    alignment === "justify" && !overflowed && lines.length > 1
      ? justifyLineGapsPt(naturalLine, availableWidthPt, measurer)
      : undefined;

  fragments.forEach((fragment, fragmentIndex) => {
    const textItem: LayoutText = {
      kind: "text",
      text: fragment.text,
      xPt:
        textStartXPt +
        fragment.xOffsetPt +
        (justifyGapsPt?.[fragmentIndex] ?? 0),
      yPt: pageHeightPt - baselineYDownPt,
      font: fragment.font,
      sizePt: fragment.sizePt,
      color: fragment.color,
      underline: fragment.underline,
      sourcePath: fragment.sourcePath,
    };
    out.push(textItem);
    // Stamps the run the fragment came from; a synthesised fallback run (a cell with no runs of its own) or an overflow replacement ('###' stand-in text) has no originating node, and stamps nothing -- the run's own text genuinely did not render there.
    stampFragmentFrame(
      cell.runs ?? [],
      fragment,
      pageIndex,
      textItem,
      measurer,
      naturalLine,
    );
  });
}

// --- Header-gutter labels and gridlines -------------------------------------------------------

function renderHeaderLabels(
  gutter: HeaderGutter,
  columnAxis: PositionedAxis,
  rowAxis: PositionedAxis,
  gridLeftXPt: number,
  gridTopYDownPt: number,
  pageHeightPt: number,
  measurer: TextMeasurer,
  out: LayoutItem[],
): void {
  const lineHeightPt = measurer.lineHeightAtSize(
    DEFAULT_LAYOUT_FONT,
    HEADER_LABEL_SIZE_PT,
  );
  const ascentPt = measurer.ascenderAtSize(
    DEFAULT_LAYOUT_FONT,
    HEADER_LABEL_SIZE_PT,
  );

  columnAxis.indices.forEach((columnIndex, position) => {
    const label = columnIndexToLetters(columnIndex);
    const widthPt = columnAxis.sizesPt[position]!;
    const labelWidthPt = measurer.widthOfTextAtSize(
      label,
      DEFAULT_LAYOUT_FONT,
      HEADER_LABEL_SIZE_PT,
    );
    const xPt =
      gridLeftXPt +
      columnAxis.offsetsPt[position]! +
      alignmentOffsetPt("center", widthPt, labelWidthPt);
    const baselineYDownPt =
      gridTopYDownPt -
      gutter.heightPt +
      (gutter.heightPt - lineHeightPt) / 2 +
      ascentPt;
    out.push({
      kind: "text",
      text: label,
      xPt,
      yPt: pageHeightPt - baselineYDownPt,
      font: DEFAULT_LAYOUT_FONT,
      sizePt: HEADER_LABEL_SIZE_PT,
      color: HEADER_LABEL_COLOR,
    });
  });

  rowAxis.indices.forEach((rowIndex, position) => {
    const label = String(rowIndex + 1);
    const heightPt = rowAxis.sizesPt[position]!;
    const labelWidthPt = measurer.widthOfTextAtSize(
      label,
      DEFAULT_LAYOUT_FONT,
      HEADER_LABEL_SIZE_PT,
    );
    const xPt =
      gridLeftXPt -
      gutter.widthPt +
      Math.max(
        HEADER_LABEL_PADDING_PT,
        gutter.widthPt - HEADER_LABEL_PADDING_PT - labelWidthPt,
      );
    const rowTopYDownPt = gridTopYDownPt + rowAxis.offsetsPt[position]!;
    const baselineYDownPt =
      rowTopYDownPt + Math.max(0, (heightPt - lineHeightPt) / 2) + ascentPt;
    out.push({
      kind: "text",
      text: label,
      xPt,
      yPt: pageHeightPt - baselineYDownPt,
      font: DEFAULT_LAYOUT_FONT,
      sizePt: HEADER_LABEL_SIZE_PT,
      color: HEADER_LABEL_COLOR,
    });
  });
}

// One LayoutLine per row/column boundary spanning the FULL grid extent -- never one per cell, both for correctness (a per-cell line would double-paint every interior boundary) and for output size on a large sheet.
function renderGridlines(
  gridLeftXPt: number,
  gridTopYDownPt: number,
  gridWidthPt: number,
  gridHeightPt: number,
  columnOffsetsPt: readonly number[],
  rowOffsetsPt: readonly number[],
  pageHeightPt: number,
  out: LayoutItem[],
): void {
  for (const offsetPt of columnOffsetsPt) {
    const xPt = gridLeftXPt + offsetPt;
    const line: LayoutLine = {
      kind: "line",
      x1Pt: xPt,
      y1Pt: pageHeightPt - gridTopYDownPt,
      x2Pt: xPt,
      y2Pt: pageHeightPt - (gridTopYDownPt + gridHeightPt),
      color: GRIDLINE_COLOR,
      widthPt: GRIDLINE_WIDTH_PT,
    };
    out.push(line);
  }
  for (const offsetPt of rowOffsetsPt) {
    const yDownPt = gridTopYDownPt + offsetPt;
    const line: LayoutLine = {
      kind: "line",
      x1Pt: gridLeftXPt,
      y1Pt: pageHeightPt - yDownPt,
      x2Pt: gridLeftXPt + gridWidthPt,
      y2Pt: pageHeightPt - yDownPt,
      color: GRIDLINE_COLOR,
      widthPt: GRIDLINE_WIDTH_PT,
    };
    out.push(line);
  }
}

// Typesets every anchored formula whose own anchor cell falls on the page currently being built, recording each into the shared `out` accumulator in true PDF page space -- the sheets-side counterpart to engine.ts's layoutFormulaFlow and slides.ts's layoutShapeFormula, and the same "shared accumulator threaded through a layout pass" pattern both of those use.
//
// The anchor cell's own top-left comes straight from the already-positioned axes, so band membership, the repeat band, the header gutter, and fit-to-page scaling are all accounted for by construction rather than recomputed here. The formula's own offset WITHIN that cell is applied unscaled, matching this module's own existing treatment of every other cell-local inset (CELL_TEXT_PADDING_PT, the header-label padding): fit-to-page scales the grid's geometry, never a cell's internal padding or its text's point size, so scaling a formula's cell offset alone would place it inconsistently with the cell text beside it. A formula anchored to a hidden row or column is skipped outright, exactly as its cells are.
//
// A formula anchored inside the repeat row/column band therefore renders on every page that band appears on, which is what a repeat band means -- no special case needed, since it is simply present in every page's own PositionedAxis.
function renderAnchoredFormulas(
  formulas: readonly AnchoredFormula[],
  columnAxis: PositionedAxis,
  rowAxis: PositionedAxis,
  gridLeftXPt: number,
  gridTopYDownPt: number,
  pageHeightPt: number,
  pageIndex: number,
  hiddenColumnIndices: ReadonlySet<number>,
  hiddenRowIndices: ReadonlySet<number>,
  out: PositionedFormula[],
  mathMetricsAt: (sizePt: number) => MathFontMetrics,
): void {
  for (const anchored of formulas) {
    const columnPosition = columnAxis.positionByIndex.get(
      anchored.anchorColumn,
    );
    const rowPosition = rowAxis.positionByIndex.get(anchored.anchorRow);
    if (
      columnPosition === undefined ||
      rowPosition === undefined ||
      hiddenColumnIndices.has(anchored.anchorColumn) ||
      hiddenRowIndices.has(anchored.anchorRow)
    ) {
      continue;
    }
    const sizePt = formulaSizePtForFrame(
      anchored.formula.mathml,
      anchored.frame,
      mathMetricsAt,
    );
    const metrics = mathMetricsAt(sizePt);
    const { box } = layoutFormula(anchored.formula.mathml, {
      metrics,
      sizePt,
      color: COLOR_BLACK,
    });
    const boxYDown: Box = {
      xPt:
        gridLeftXPt +
        columnAxis.offsetsPt[columnPosition]! +
        anchored.offsetXPt,
      yPt:
        gridTopYDownPt + rowAxis.offsetsPt[rowPosition]! + anchored.offsetYPt,
      widthPt: box.widthPt,
      heightPt: box.heightPt,
    };
    const flipped = flipY(boxYDown, pageHeightPt);
    out.push({ pageIndex, xPt: flipped.xPt, yPt: flipped.yPt, box });
    // No frame is stamped here, unlike engine.ts's and slides.ts's own formula placements: a sheet-anchored embedded object is a ContentEmbeddedObject, the one embedded-object shape document-schema.js deliberately left WITHOUT a frames field (only the in-flow ContentEmbeddedObjectBlock carries one), so there is no node field to stamp -- the rendered position lives in the PositionedFormula array this loop already records.
  }
}

// The image-side counterpart to renderAnchoredFormulas above: a ContentSheetImage carries the identical anchor quartet and resolves through the same axis lookup, but emits a real LayoutImage into the page's own items (an image IS a LayoutItem, unlike a formula's CID-font glyph runs which have no item kind and travel separately). Asset registration goes through the document-wide `images` record shared.ts's registerImage deduplicates into, exactly as engine.ts's layoutImageFlow and slides.ts's convertShape already do. The same skip rules apply: an anchor outside the resolved axis range, or in a hidden column/row, renders nothing -- matching how that cell's own content is skipped, and how renderAnchoredFormulas handles an anchored formula.
function renderAnchoredImages(
  sheetImages: readonly ContentSheetImage[],
  columnAxis: PositionedAxis,
  rowAxis: PositionedAxis,
  gridLeftXPt: number,
  gridTopYDownPt: number,
  pageHeightPt: number,
  pageIndex: number,
  hiddenColumnIndices: ReadonlySet<number>,
  hiddenRowIndices: ReadonlySet<number>,
  out: LayoutItem[],
  images: Record<string, LayoutImageAsset>,
): void {
  for (const image of sheetImages) {
    const columnPosition = columnAxis.positionByIndex.get(image.anchorColumn);
    const rowPosition = rowAxis.positionByIndex.get(image.anchorRow);
    if (
      columnPosition === undefined ||
      rowPosition === undefined ||
      hiddenColumnIndices.has(image.anchorColumn) ||
      hiddenRowIndices.has(image.anchorRow)
    ) {
      continue;
    }
    const imageId = registerImage(image, images);
    const boxYDown: Box = {
      xPt:
        gridLeftXPt + columnAxis.offsetsPt[columnPosition]! + image.offsetXPt,
      yPt: gridTopYDownPt + rowAxis.offsetsPt[rowPosition]! + image.offsetYPt,
      widthPt: image.widthPt,
      heightPt: image.heightPt,
    };
    const flipped = flipY(boxYDown, pageHeightPt);
    const imageItem: LayoutImage = {
      kind: "image",
      imageId,
      xPt: flipped.xPt,
      yPt: flipped.yPt,
      widthPt: image.widthPt,
      heightPt: image.heightPt,
      sourcePath: image.sourcePath,
    };
    out.push(imageItem);
    stampFrame(image, pageIndex, {
      xPt: imageItem.xPt,
      yPt: imageItem.yPt,
      widthPt: imageItem.widthPt,
      heightPt: imageItem.heightPt,
    });
  }
}

// --- Orchestration: steps 1-6, plus per-page step 7 -----------------------------------------------

// The print range's own [start, end] on one axis, with any repeat-band sub-range removed -- the repeat band is reserved and re-emitted separately on every page (step 3), never itself subject to banding.
function bandableIndices(
  start: number,
  end: number,
  repeat: { readonly start: number; readonly end: number } | undefined,
): number[] {
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

function convertSheetToPages(
  sheet: ContentSheet,
  measurer: TextMeasurer,
  signal: AbortSignal | undefined,
  out: LayoutPage[],
  formulasOut: PositionedFormula[],
  images: Record<string, LayoutImageAsset>,
  mathMetricsAt: (sizePt: number) => MathFontMetrics,
): void {
  throwIfAborted(signal);
  const formulas = anchoredFormulas(sheet);
  const range = resolvePrintRange(sheet, formulas);
  if (range === undefined) {
    return;
  }
  const { printSettings } = sheet;
  const { pageSize, margins } = printSettings;
  const pageContentWidthPt = Math.max(
    0,
    pageSize.widthPt - margins.leftPt - margins.rightPt,
  );
  const pageContentHeightPt = Math.max(
    0,
    pageSize.heightPt - margins.topPt - margins.bottomPt,
  );

  const columnEntries = resolveAxis(
    sheet.columns.map((c) => ({
      index: c.index,
      sizePt: c.widthPt,
      hidden: c.hidden,
    })),
    range.startColumn,
    range.endColumn,
    DEFAULT_COLUMN_WIDTH_PT,
  );
  const rowEntries = resolveAxis(
    sheet.rows.map((r) => ({
      index: r.index,
      sizePt: r.heightPt,
      hidden: r.hidden,
    })),
    range.startRow,
    range.endRow,
    DEFAULT_ROW_HEIGHT_PT,
  );
  const columnSizeByIndex = new Map(
    columnEntries.map((e) => [e.index, e.sizePt]),
  );
  const rowSizeByIndex = new Map(rowEntries.map((e) => [e.index, e.sizePt]));
  // "Skip hidden entirely" (step 2) means the CELL, not merely its column/row's own contribution to cumulative offsets: a hidden column still resolves to width 0 (so its anchored cell's own available text width is 0), which would otherwise trigger the numeric/string overflow path and render a stray '###' or truncated fragment at zero width, overlapping whatever visible column happens to sit at that same x position -- confirmed by manually rendering and pdftotext-inspecting a real fixture with a hidden column during this module's own real-file verification. Anchor-position hidden-ness is checked directly against these two sets before a cell is ever handed to renderCellText, rather than relying on its own zero-width overflow behaviour to happen to look empty.
  const hiddenColumnIndices = new Set(
    columnEntries.filter((e) => e.hidden).map((e) => e.index),
  );
  const hiddenRowIndices = new Set(
    rowEntries.filter((e) => e.hidden).map((e) => e.index),
  );

  const gutter = computeHeaderGutter(printSettings, range, measurer);

  const repeatColumns = printSettings.repeatColumns;
  const repeatRows = printSettings.repeatRows;
  const repeatColumnIndices =
    repeatColumns === undefined
      ? []
      : rangeIndices(repeatColumns.start, repeatColumns.end);
  const repeatRowIndices =
    repeatRows === undefined
      ? []
      : rangeIndices(repeatRows.start, repeatRows.end);
  const repeatColumnsWidthPt = repeatColumnIndices.reduce(
    (sum, i) => sum + (columnSizeByIndex.get(i) ?? 0),
    0,
  );
  const repeatRowsHeightPt = repeatRowIndices.reduce(
    (sum, i) => sum + (rowSizeByIndex.get(i) ?? 0),
    0,
  );

  const bandableColumnIndices = bandableIndices(
    range.startColumn,
    range.endColumn,
    repeatColumns,
  );
  const bandableRowIndices = bandableIndices(
    range.startRow,
    range.endRow,
    repeatRows,
  );

  const availableWidthPt = Math.max(
    0,
    pageContentWidthPt - gutter.widthPt - repeatColumnsWidthPt,
  );
  const availableHeightPt = Math.max(
    0,
    pageContentHeightPt - gutter.heightPt - repeatRowsHeightPt,
  );
  const totalBandableWidthPt = bandableColumnIndices.reduce(
    (sum, i) => sum + (columnSizeByIndex.get(i) ?? 0),
    0,
  );
  const totalBandableHeightPt = bandableRowIndices.reduce(
    (sum, i) => sum + (rowSizeByIndex.get(i) ?? 0),
    0,
  );

  const scale = resolveScale(
    printSettings,
    availableWidthPt,
    availableHeightPt,
    totalBandableWidthPt,
    totalBandableHeightPt,
  );
  const descaledAvailableWidthPt = availableWidthPt / scale;
  const descaledAvailableHeightPt = availableHeightPt / scale;

  const manualBreakColumns = new Set(printSettings.manualBreaks?.columns ?? []);
  const manualBreakRows = new Set(printSettings.manualBreaks?.rows ?? []);
  throwIfAborted(signal);
  const columnBands = partitionIndices(
    bandableColumnIndices,
    (i) => columnSizeByIndex.get(i) ?? 0,
    descaledAvailableWidthPt,
    manualBreakColumns,
  );
  const rowBands = partitionIndices(
    bandableRowIndices,
    (i) => rowSizeByIndex.get(i) ?? 0,
    descaledAvailableHeightPt,
    manualBreakRows,
  );

  const cellsByRow = new Map<number, Map<number, ContentSheetCell>>();
  for (const cell of sheet.cells) {
    let row = cellsByRow.get(cell.row);
    if (row === undefined) {
      row = new Map();
      cellsByRow.set(cell.row, row);
    }
    row.set(cell.column, cell);
  }

  const scaledSizeOf =
    (sizeByIndex: ReadonlyMap<number, number>) => (index: number) =>
      (sizeByIndex.get(index) ?? 0) * scale;
  const unscaledSizeOf =
    (sizeByIndex: ReadonlyMap<number, number>) => (index: number) =>
      sizeByIndex.get(index) ?? 0;

  // Step 6: emit pages in printSettings.pageOrder across the column-band x row-band grid. 'overThenDown' completes a full row of column bands before moving to the next row band (columns vary fastest); 'downThenOver' completes a full column of row bands before moving to the next column band (rows vary fastest) -- ODF's own real default, per odf.js's readOdsContent module doc.
  const bandPairs: {
    readonly columnBand: readonly number[];
    readonly rowBand: readonly number[];
  }[] =
    printSettings.pageOrder === "overThenDown"
      ? rowBands.flatMap((rowBand) =>
          columnBands.map((columnBand) => ({ columnBand, rowBand })),
        )
      : columnBands.flatMap((columnBand) =>
          rowBands.map((rowBand) => ({ columnBand, rowBand })),
        );

  for (const { columnBand, rowBand } of bandPairs) {
    throwIfAborted(signal);
    const columnAxis = buildPositionedAxis(
      repeatColumnIndices,
      unscaledSizeOf(columnSizeByIndex),
      columnBand,
      scaledSizeOf(columnSizeByIndex),
    );
    const rowAxis = buildPositionedAxis(
      repeatRowIndices,
      unscaledSizeOf(rowSizeByIndex),
      rowBand,
      scaledSizeOf(rowSizeByIndex),
    );

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
        if (
          !columnAxis.positionByIndex.has(columnIndex) ||
          hiddenColumnIndices.has(columnIndex) ||
          hiddenRowIndices.has(cell.row)
        ) {
          continue;
        }
        const cellFrame = resolveCellFrame(
          cell,
          columnAxis,
          rowAxis,
          gridLeftXPt,
          gridTopYDownPt,
        );
        if (cellFrame === undefined) {
          continue;
        }
        // The cell's own placement stamps the CELL node once per page it renders on (a repeat-row cell, or a cell re-printed across column bands, genuinely occupies several pages); the runs inside stamp their own finer-grained frames through renderCellText below.
        stampFrame(cell, out.length, flipY(cellFrame, pageSize.heightPt));
        renderCellBackground(
          cell,
          cellFrame,
          pageSize.heightPt,
          backgroundItems,
        );
        if (cell.borders !== undefined) {
          pushCellBorderLines(
            cell.borders,
            cellFrame,
            pageSize.heightPt,
            cell.sourcePath,
            borderItems,
          );
        }
        renderCellText(
          cell,
          cellFrame,
          out.length,
          rowCells,
          columnAxis,
          pageSize.heightPt,
          measurer,
          textItems,
        );
      }
    }

    const items: LayoutItem[] = [...backgroundItems];
    if (printSettings.gridlines) {
      renderGridlines(
        gridLeftXPt,
        gridTopYDownPt,
        gridWidthPt,
        gridHeightPt,
        columnAxis.offsetsPt,
        rowAxis.offsetsPt,
        pageSize.heightPt,
        items,
      );
    }
    items.push(...borderItems);
    if (printSettings.headers) {
      renderHeaderLabels(
        gutter,
        columnAxis,
        rowAxis,
        gridLeftXPt,
        gridTopYDownPt,
        pageSize.heightPt,
        measurer,
        items,
      );
    }
    items.push(...textItems);

    // pageIndex is this page's own index in the whole LayoutDocument, so it is read BEFORE the push -- `out` is shared across every sheet in the document, exactly as PositionedFormula.pageIndex requires.
    renderAnchoredFormulas(
      formulas,
      columnAxis,
      rowAxis,
      gridLeftXPt,
      gridTopYDownPt,
      pageSize.heightPt,
      out.length,
      hiddenColumnIndices,
      hiddenRowIndices,
      formulasOut,
      mathMetricsAt,
    );
    // Images are LayoutItems (unlike formulas), so they push straight into this page's own `items` rather than a separate out-array -- appended after cell text so a floating image paints over the grid, matching how a real spreadsheet layers a floating draw:frame above the cells it overlaps.
    renderAnchoredImages(
      sheet.images,
      columnAxis,
      rowAxis,
      gridLeftXPt,
      gridTopYDownPt,
      pageSize.heightPt,
      out.length,
      hiddenColumnIndices,
      hiddenRowIndices,
      items,
      images,
    );
    out.push({ widthPt: pageSize.widthPt, heightPt: pageSize.heightPt, items });
  }
}

// ContentSheet.embeddedObjects now genuinely drives a formula-rendering branch here (renderAnchoredFormulas above), the sheets-side equivalent of engine.ts's and slides.ts's own, closing what was a two-sided upstream gap: odf.js's spreadsheet reader had to learn to emit a cell-anchored formula sub-object at all, and document-schema.js's ContentEmbeddedObject had to gain somewhere to record which cell it is anchored to. Both landed -- odf.js 2.2.0's spreadsheet reader (readOdsContent since odf.js 5.0.0) walks each table:table-cell's children with a real TableCursor and classifies a formula sub-document alongside the wordprocessing/presentation/spreadsheet/drawing kinds its 2.1.0 classifier already recognised, and document-schema.js 2.2.0 adds the optional anchorRow/anchorColumn/offsetXPt/offsetYPt quartet to ContentEmbeddedObject. That quartet is exactly what makes placement possible: a cell-anchored draw:frame's own svg:x/svg:y is relative to THAT CELL's own top-left corner, not the sheet's origin, so an anchor is needed to resolve the offset against this module's own axis geometry at layout time.
//
// ContentSheet.images drives the image-rendering branch alongside it (renderAnchoredImages above): a sheet's own floating images carry the identical anchor quartet a formula does and resolve through the same axis lookup, but emit a real LayoutImage into the page's own items (and register their bytes in the document-wide image registry shared.ts's registerImage deduplicates into, exactly as engine.ts/slides.ts already do). The print range widens to cover an image's anchor cell the same way it widens for a formula's -- see resolvePrintRange.
export function convertSpreadsheetToLayout(
  doc: SpreadsheetContentDocument,
  options: SheetsLayoutOptions,
): SpreadsheetLayoutResult {
  const pages: LayoutPage[] = [];
  const formulas: PositionedFormula[] = [];
  const images: Record<string, LayoutImageAsset> = {};
  for (const sheet of doc.sheets) {
    convertSheetToPages(
      sheet,
      options.measurer,
      options.signal,
      pages,
      formulas,
      images,
      options.mathMetricsAt,
    );
  }
  // `doc` itself now carries every placement this pass computed, stamped in place on its own nodes (frames); the returned pages array plus that mutated content is the fused unified DocumentTree a conversion reports through onDocument.
  return {
    document: layoutDocumentOf(doc.metadata, pages, images),
    formulas,
    pages: packagePagesOf(pages),
  };
}
