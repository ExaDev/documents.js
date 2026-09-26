import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintRange,
  ContentSheetPrintSettings,
  PageSize,
} from "document-schema.js";
import type { Color as LayoutColor } from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import { DEFAULT_LAYOUT_FONT } from "document-schema.js";
import { flipY } from "../model/geometry";
import { throwIfAborted } from "../ports/abort";
import type {
  MathFontMetrics,
  PositionedFormula,
  TextMeasurer,
} from "document-schema.js";
import {
  layoutDocumentOf,
  packagePagesOf,
  pushCellBorderLines,
  stampFrame,
} from "./shared";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
} from "pdf-codec";
import {
  anchoredFormulas,
  buildPositionedAxis,
  renderAnchoredFormulas,
  renderAnchoredImages,
  renderCellBackground,
  renderCellText,
  renderGridlines,
  renderHeaderLabels,
  resolveCellFrame,
  type AnchoredFormula,
} from "./sheets-render";

// A percentage is hundredths of the whole.
const PERCENT_SCALE = 100;

// ContentDocument (the spreadsheet variant) -> LayoutDocument: ods/xlsx's own layout direction, genuinely distinct from both docx's flow/pagination (engine.ts) and pptx's direct placement (slides.ts). A sheet paginates over TWO axes at once (column bands x row bands, not just rows), print settings (range/scale/fit-to-page/repeat rows-columns/gridlines/headers/page order/manual breaks) drive the page grid directly rather than being ignored the way a docx section's margins alone would be, and cell overflow is bounded per cell (###, spill, truncate) rather than wrapped the way paragraph text is. This is also the first layout algorithm in the package genuinely long-running enough (a real sheet can carry tens of thousands of populated cells) to need cooperative cancellation wired into its own per-cell emission loop, not just checked once at the top of the function the way reconstruct.ts's own page/slide loops do.
//
// ContentSheetCellSchema carries real per-cell decoration as of document-schema.js 2.0.0 — background, borders, alignment, and verticalAlignment — all four of which odf.js's own readOdsContent genuinely populates from a cell's resolved style chain (typed/shared/table.ts's readCellStyleDecoration), so every one of them is live data here, not a speculatively-consumed field. The z-order below emits a real background LayoutRect and real border LayoutLines accordingly, and a cell's own explicit alignment/verticalAlignment override the value-kind default rather than being ignored. A border's own dash STYLE now carries through too, as of document-schema.js 2.1.0 adding that same optional enum to LayoutLineSchema/LayoutPathSchema — see pushCellBorderLines (src/layout/shared.ts) for the mechanism, and for the separate, still-open question of whether pdf-codec's own write.ts does anything with it yet.
//
// A cell's own text is laid out as a SINGLE line, never wrapped or stacked — deliberate, narrower scope than docx/pptx paragraph flow: a spreadsheet cell's overflow rule (###, spill, truncate) is a single-line concept in every real spreadsheet application, and the task this module implements specifies exactly that. A cell whose own source text contains an explicit line break (readOdsContent's own multi text:p-per-cell join, a rare Alt+Enter case) has wrapRunsToWidth produce more than one WrappedLine; only the FIRST is rendered here, a documented, narrow scope boundary rather than a silent truncation.

export interface SheetsLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly mathMetricsAt: (sizePt: number) => MathFontMetrics;
  // The only layout engine in this package that needs one: a 50k-cell sheet's own cell-emission loop can run long enough to be worth cancelling mid-page, unlike a docx/pptx document's own, much smaller, page/slide count.
  readonly signal?: AbortSignal;
}

export interface SpreadsheetLayoutResult {
  readonly document: LayoutDocument;
  // Every cell-anchored embedded formula actually rendered via src/mathml, already positioned in PDF page space (bottom-left origin, y-up) — pdf-codec's write.ts's own WritePdfOptions.formulas consumes this directly. Structurally identical to src/layout/engine.ts's WordprocessingLayoutResult.formulas and src/layout/slides.ts's PresentationLayoutResult.formulas; see the former's own comment for why a formula's CID-font glyph runs can't travel through LayoutDocument.pages[].items itself.
  readonly formulas: readonly PositionedFormula[];
  // The DocumentTree's own pages array (each rendered page's size, indexed to match every content node's own frames[].pageIndex) — the input `doc` argument itself comes back with frames stamped in place, which together with this array is the fused unified package a conversion reports through onDocument.
  readonly pages: readonly PageSize[];
}

type SpreadsheetContentDocument = Extract<
  ContentDocument,
  { kind: "spreadsheet" }
>;

// --- Nominal fallbacks and rendering constants, each documented rather than a bare literal -----

// A column/row with no explicit ContentSheetColumn/ContentSheetRow entry of its own falls back to these — exercised only for malformed or hand-built input; every real producer (confirmed for LibreOffice via odf.js's own readOdsContent) emits an explicit entry for every real column/row it ever touched. Values match Excel/Calc's own real default column width (8.43 characters at the default font, ~64pt) and default row height (~15pt at the default 10-11pt body font).
const DEFAULT_COLUMN_WIDTH_PT = 64;
const DEFAULT_ROW_HEIGHT_PT = 15;

// A nominal fallback text size for a cell with no runs of its own (the common case — ContentSheetCell.runs is populated only for genuinely mixed inline formatting, per its own schema comment) and therefore no resolvable size anywhere in the model. Deliberately its own constant, distinct from shared.ts's NOMINAL_TEXT_SIZE_PT (18pt, a docx/pptx PARAGRAPH fallback) — applying that size to an ordinary spreadsheet cell would visually swamp a real row height. Matches Excel/Calc's own common 10-11pt body-cell default.
export const NOMINAL_CELL_TEXT_SIZE_PT = 10;
// The row/column header-gutter's own label size — smaller again, matching Excel/Calc's own small grey header-label chrome.
export const HEADER_LABEL_SIZE_PT = 8;

// Inset between a cell's own frame edge and its rendered text, and between a header-gutter label and its own gutter edge — ordinary spreadsheet cell/label padding.
export const CELL_TEXT_PADDING_PT = 2;
export const HEADER_LABEL_PADDING_PT = 2;

// A misconfigured page/margin/gutter/repeat-band combination could otherwise leave zero or negative available print area, which would divide the band-partition boundary by zero (or a negative number) computing a descaled boundary — clamped to a small positive floor so band partitioning always terminates with well-defined positive widths rather than Infinity/NaN geometry, the same "at least make progress on pathological input" reasoning pdf-codec's text-layout.ts's own emergency character split documents.
const MINIMUM_SCALE = 0.01;

// The literal sentinel spreadsheet applications universally render for a numeric-kind value that doesn't fit its own column — not a computed fill-to-width run of '#' the way a real spreadsheet UI does, since the task this module implements pins down this exact literal.
export const NUMERIC_OVERFLOW_TEXT = "###";

export const GRIDLINE_COLOR: LayoutColor = rgbHexToColor("#D0D0D0");
export const GRIDLINE_WIDTH_PT = 0.5;
export const HEADER_LABEL_COLOR: LayoutColor = rgbHexToColor("#606060");

// --- Step 1: resolve the print range -----------------------------------------------------------

// The sheet's own explicit table:print-ranges-derived range if set, else the full extent of populated cells (accounting for a merged anchor cell's own colSpan/rowSpan reaching beyond its own row/column) UNION every renderable formula's own anchor cell and every floating image's own anchor cell. undefined when the sheet has no explicit range, no cells, no anchored formula, and no floating image at all — nothing to lay out.
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
  readonly sizePt: number; // 0 for a hidden index — contributes nothing to any cumulative offset, matching "skip hidden entirely"
  readonly hidden: boolean;
}

// Resolves one size (and hidden-ness) per index across [start, end] from a sparse, run-length-compressed entries array (document order; real producers emit exactly one entry per STARTING index of a repeated run — see odf.js's own readOdsContent module doc) — entry N's own size/hidden-ness applies to every index from its own index up to (but not including) the next entry's index, mirroring how the source format itself compresses a run of identically-formatted columns/rows. An index before the first entry, or with no entries at all, falls back to defaultSizePt.
//
// entries[i].sizePt is `number | undefined` (ContentSheetColumn.widthPt/ContentSheetRow.heightPt, both optional since document-schema.js 2.0.0) because the two real producers behind this shared field disagree on when a size is knowable at all: odf.js's own readOdsContent always resolves a concrete number for a real column/row element (0 when it carries no explicit style — see src/edit/ods/column-row.ts's own top-of-file note for why THAT zero is deliberately treated as authoritative below, not defaulted), whereas ooxml.js's readXlsxContent genuinely omits the field outright when an xlsx column has no explicit <col> width. `?? defaultSizePt` below only ever fires for the latter, genuinely-absent case; an ODS-sourced entry's own explicit 0 is a real number, not undefined, so it flows through unchanged exactly as it always has.
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

export interface HeaderGutter {
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

// Explicit printSettings.scalePercent (a raw percentage, e.g. 150 for "150%" — odf.js's own readOdsContent reads it this way, confirmed by its own test suite) takes priority; else a non-iterative fit-to-page computed directly from the ratio of available-print-area-across-N-pages to total unscaled content size, clamped to never upscale; else 1. Header-gutter and repeat-row/column space is deliberately NOT scaled (reserved at a fixed size on every page, the same "fixed chrome" treatment a spreadsheet UI itself gives its own row/column address labels) — only the print range's own bandable cell content scales.
function resolveScale(
  printSettings: ContentSheetPrintSettings,
  availableWidthPt: number,
  availableHeightPt: number,
  totalContentWidthPt: number,
  totalContentHeightPt: number,
): number {
  if (printSettings.scalePercent !== undefined) {
    return Math.max(printSettings.scalePercent / PERCENT_SCALE, MINIMUM_SCALE);
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

// Walks `indices` (already limited to the bandable set — i.e. excluding any repeat-row/column range, which is reserved and re-emitted separately, never banded) in order, closing the current band and starting a fresh one whenever the next index would overflow the available space, honoring a manual break as an unconditional close. Mirrors src/layout/engine.ts's own ensureRoom exactly: an index whose own size alone exceeds availablePt still gets exactly one band to itself (added to an EMPTY band unconditionally) and simply overflows, rather than looping forever trying to fit it — the identical "oversized item gets its own page" guarantee, applied to the column/row axis instead of the paragraph-flow axis.
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

// --- Orchestration: steps 1-6, plus per-page step 7 -----------------------------------------------

// The print range's own [start, end] on one axis, with any repeat-band sub-range removed — the repeat band is reserved and re-emitted separately on every page (step 3), never itself subject to banding.
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
  // "Skip hidden entirely" (step 2) means the CELL, not merely its column/row's own contribution to cumulative offsets: a hidden column still resolves to width 0 (so its anchored cell's own available text width is 0), which would otherwise trigger the numeric/string overflow path and render a stray '###' or truncated fragment at zero width, overlapping whatever visible column happens to sit at that same x position — confirmed by manually rendering and pdftotext-inspecting a real fixture with a hidden column during this module's own real-file verification. Anchor-position hidden-ness is checked directly against these two sets before a cell is ever handed to renderCellText, rather than relying on its own zero-width overflow behaviour to happen to look empty.
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

  // Step 6: emit pages in printSettings.pageOrder across the column-band x row-band grid. 'overThenDown' completes a full row of column bands before moving to the next row band (columns vary fastest); 'downThenOver' completes a full column of row bands before moving to the next column band (rows vary fastest) — ODF's own real default, per odf.js's readOdsContent module doc.
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

    // Z-order step 7, now emitted in full: cell backgrounds -> gridlines -> cell borders -> headers -> cell text. The three cell-derived layers are collected into their own arrays during ONE walk over the populated cells (rather than three separate walks over the same 50k cells), then concatenated in that order — so a cell's own declared border paints over the generic gridline underneath it, and every cell's text paints over every cell's background, exactly as a real spreadsheet renders them.
    const backgroundItems: LayoutItem[] = [];
    const borderItems: LayoutItem[] = [];
    const textItems: LayoutItem[] = [];

    for (const rowIndex of rowAxis.indices) {
      const rowCells = cellsByRow.get(rowIndex);
      if (rowCells === undefined) {
        continue;
      }
      for (const [columnIndex, cell] of rowCells) {
        throwIfAborted(signal); // the main cell-emission loop — checked per populated cell, not merely once per page, since a single band can carry the large majority of a 50k-cell sheet's own content.
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

    // pageIndex is this page's own index in the whole LayoutDocument, so it is read BEFORE the push — `out` is shared across every sheet in the document, exactly as PositionedFormula.pageIndex requires.
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
    // Images are LayoutItems (unlike formulas), so they push straight into this page's own `items` rather than a separate out-array — appended after cell text so a floating image paints over the grid, matching how a real spreadsheet layers a floating draw:frame above the cells it overlaps.
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

// ContentSheet.embeddedObjects now genuinely drives a formula-rendering branch here (renderAnchoredFormulas above), the sheets-side equivalent of engine.ts's and slides.ts's own, closing what was a two-sided upstream gap: odf.js's spreadsheet reader had to learn to emit a cell-anchored formula sub-object at all, and document-schema.js's ContentEmbeddedObject had to gain somewhere to record which cell it is anchored to. Both landed — odf.js 2.2.0's spreadsheet reader (readOdsContent since odf.js 5.0.0) walks each table:table-cell's children with a real TableCursor and classifies a formula sub-document alongside the wordprocessing/presentation/spreadsheet/drawing kinds its 2.1.0 classifier already recognised, and document-schema.js 2.2.0 adds the optional anchorRow/anchorColumn/offsetXPt/offsetYPt quartet to ContentEmbeddedObject. That quartet is exactly what makes placement possible: a cell-anchored draw:frame's own svg:x/svg:y is relative to THAT CELL's own top-left corner, not the sheet's origin, so an anchor is needed to resolve the offset against this module's own axis geometry at layout time.
//
// ContentSheet.images drives the image-rendering branch alongside it (renderAnchoredImages above): a sheet's own floating images carry the identical anchor quartet a formula does and resolve through the same axis lookup, but emit a real LayoutImage into the page's own items (and register their bytes in the document-wide image registry shared.ts's registerImage deduplicates into, exactly as engine.ts/slides.ts already do). The print range widens to cover an image's anchor cell the same way it widens for a formula's — see resolvePrintRange.
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
