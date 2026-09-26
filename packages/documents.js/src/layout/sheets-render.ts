// The per-cell and per-page rendering half of the spreadsheet layout pass, split from sheets.ts: anchored-formula resolution, cell text styling/truncation/positioning, cell backgrounds and borders, header-gutter labels, gridlines, and the anchored formula/image renderers. sheets.ts keeps the step pipeline (print range, axes, gutter, scale, banding) and the per-page orchestration that calls these.
import type {
  Alignment,
  Box,
  ContentCellValue,
  ContentEmbeddedObject,
  ContentFormula,
  ContentSheet,
  ContentSheetCell,
  ContentSheetImage,
  MathFontMetrics,
  PositionedFormula,
  StyledFragment,
  StyledRun,
  TextMeasurer,
} from "document-schema.js";
import {
  COLOR_BLACK,
  columnIndexToLetters,
  DEFAULT_LAYOUT_FONT,
  resolveCellFillColor,
} from "document-schema.js";
import { layoutFormula } from "../mathml/layout";
import { flipY } from "../model/geometry";
import { wrapRunsToWidth } from "./text-layout";
import {
  alignmentOffsetPt,
  formulaSizePtForFrame,
  justifyLineGapsPt,
  lineNaturalHeightPt,
  registerImage,
  stampFragmentFrame,
  stampFrame,
  sumColumnWidthsPt,
  toStyledRuns,
} from "./shared";
import type {
  LayoutImage,
  LayoutImageAsset,
  LayoutItem,
  LayoutLine,
  LayoutText,
} from "pdf-codec";
import type { HeaderGutter } from "./sheets";
import {
  CELL_TEXT_PADDING_PT,
  GRIDLINE_COLOR,
  GRIDLINE_WIDTH_PT,
  HEADER_LABEL_COLOR,
  HEADER_LABEL_PADDING_PT,
  HEADER_LABEL_SIZE_PT,
  NOMINAL_CELL_TEXT_SIZE_PT,
  NUMERIC_OVERFLOW_TEXT,
} from "./sheets";

// --- Cell-anchored embedded formulas ------------------------------------------------------------

// One ContentSheet.embeddedObjects entry this module can genuinely place and typeset: a formula-kind object whose own document really carries MathML, anchored to a concrete cell. Resolving the entry once, up front, is what lets both resolvePrintRange (which must widen the printed area to cover an anchor cell outside the populated-cell extent) and the per-page emission below work off the same narrowed shape rather than each repeating the same four-way check.
export interface AnchoredFormula {
  readonly formula: ContentFormula;
  readonly anchorRow: number;
  readonly anchorColumn: number;
  // Both relative to the anchor CELL's own top-left corner, y-down — ODF's own draw:frame svg:x/svg:y inside a table:table-cell, which odf.js's readOdsContent surfaces verbatim. A page-anchored (table:shapes) object is encoded by that same reader as anchor cell (0, 0) plus an offset that is already absolute in sheet space, so it needs no separate branch here.
  readonly offsetXPt: number;
  readonly offsetYPt: number;
  readonly frame: Box;
}

// Narrows a sheet's own embedded objects to the ones renderable here. An entry is skipped — deliberately, and only for a named reason — when: its objectKind is not 'formula' (a nested wordprocessing/presentation/spreadsheet/drawing sub-document has no layout path of its own in this package, from a sheet or anywhere else); its document is not a formula document or carries no MathML nodes to typeset (nothing to render, and unlike engine.ts's flow placement there is no surrounding text flow for a plain-text stand-in to occupy — a stand-in dropped at an arbitrary cell offset would be new invented content, not a degraded rendering of real content); or it carries no anchor row/column pair. That last case is not a fallback opportunity: ContentEmbeddedObject.frame means document space for an odt block and slide space for an odp shape, but for a sheet odf.js populates it with the CELL-relative offsets, so an entry with no anchor has no coordinate space its frame can be interpreted in at all.
export function anchoredFormulas(sheet: ContentSheet): AnchoredFormula[] {
  const resolved: AnchoredFormula[] = [];
  for (const object of sheet.embeddedObjects ?? []) {
    const anchored = resolveAnchoredFormula(object);
    if (anchored !== undefined) {
      resolved.push(anchored);
    }
  }
  return resolved;
}

export function resolveAnchoredFormula(
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

// --- Cell text: styling, alignment, and overflow ---------------------------------------------------

// A cell's own runs when present, otherwise a single synthetic run built from its own displayText at the nominal cell text size — ContentSheetCellSchema carries no cell-level font/size/colour of its own to fall back to otherwise. A real reader populates `runs` far more often than ContentSheetCellSchema's own doc comment ("the rare case of genuinely mixed inline formatting") suggests — confirmed via this module's own real-file verification against odf.js's readOdsContent: EVERY cell with any text at all gets a `runs` array (readCellText always calls readOdfParagraph), not only cells with genuinely mixed formatting, and those runs carry no sizePt of their own for ordinary unstyled text. Passing such a run straight to toStyledRuns would fall through to ITS OWN default (shared.ts's NOMINAL_TEXT_SIZE_PT, 18pt, a docx-PARAGRAPH fallback) rather than this module's own 10pt spreadsheet-cell nominal size — exactly the mismatch this module's own top-of-file doc comment already warns about for the no-runs case, so each run missing its own sizePt is defaulted here, before toStyledRuns ever sees it, rather than left to toStyledRuns's own unrelated default.
export function cellStyledRuns(cell: ContentSheetCell): StyledRun[] {
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

// number/percentage/currency/date/time/dateTime are all numeric-NATURED values (ContentCellValueSchema's own comment: it "mirrors ODF's own office:value-type vocabulary", and ODF itself stores date/time/dateTime as numeric serial values under the hood) — the task's own literal list ("numeric/percentage/currency -> right") names the three most common members as a proxy for this whole numeric-natured bucket, not an exhaustive exclusion of date/time/dateTime; a real spreadsheet application right-aligns and '###'-overflows dates, times, and combined date-times exactly the same way it does plain numbers. dateTime is document-schema.js 2.0.0's own new ContentCellValue kind (a combined office:value-type="date" ISO-8601 dateTime value, distinct from a bare date or bare time) — included here on the same "numeric-natured" reasoning as its date/time siblings, not left to default to 'string' treatment by omission. Extended deliberately, not silently — see this module's own doc comment.
export function isNumericLikeValue(kind: ContentCellValue["kind"]): boolean {
  return (
    kind === "number" ||
    kind === "percentage" ||
    kind === "currency" ||
    kind === "date" ||
    kind === "time" ||
    kind === "dateTime"
  );
}

export function defaultAlignmentForValue(
  kind: ContentCellValue["kind"],
): Alignment {
  if (isNumericLikeValue(kind)) {
    return "right";
  }
  if (kind === "boolean" || kind === "error") {
    return "center";
  }
  return "left"; // 'string' and 'empty'
}

export function isCellVisuallyEmpty(
  cell: ContentSheetCell | undefined,
): boolean {
  return (
    cell === undefined ||
    (cell.value.kind === "empty" && cell.displayText.length === 0)
  );
}

// Truncates a wrapped line's own fragments to fit maxWidthPt, stopping at the fragment that crosses the boundary and character-truncating just that one — deliberately simpler than pdf-codec's text-layout.ts's own (private) splitBoxToWidth: a spreadsheet cell's overflow has no "rest" to requeue onto a following line, since a cell never wraps to a second line for width reasons — it simply stops rendering at the boundary.
export function truncateFragmentsToWidth(
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
export interface PositionedAxis {
  readonly indices: readonly number[]; // real sheet column/row indices, ascending, contiguous
  readonly sizesPt: readonly number[]; // SCALED size per position (band content) or unscaled (repeat/gutter, which never scale)
  readonly offsetsPt: readonly number[]; // cumulative offset per position, relative to the grid's own left/top edge
  readonly positionByIndex: ReadonlyMap<number, number>;
}

// Concatenates a fixed "repeat" axis (rendered at scale 1, identical on every page) with one page's own scaled band axis into a single grid-local PositionedAxis — so cell lookup/rendering never needs to know whether a given column/row came from the repeat band or the page's own band.
export function buildPositionedAxis(
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

// Sums a positioned axis's own sizes over [startIndex, startIndex + span), clamped to the axis's own bounds — reused verbatim via shared.ts's sumColumnWidthsPt (a plain array + start + span sum, equally valid read as a column-width sum or a row-height sum) rather than a second, duplicate implementation.
export function axisSpanSizePt(
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

// One cell's own box in GRID-local-plus-page space, still y-down (gridLeftXPt/gridTopYDownPt place the grid's own local origin within the page), spanning its full colSpan/rowSpan. undefined when the cell's own anchor position isn't on this page at all — a merge continuation, or a row/column belonging to another band — in which case nothing about that cell (background, borders, or text) is drawn here.
export function resolveCellFrame(
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

// A backgrounded cell's own fill, as a real LayoutRect covering the cell's whole (merge-spanning) frame — the exact shape src/layout/engine.ts's own table-cell background emission already produces for a docx/odt/pptx/odp table cell, applied to the spreadsheet grid. Unlike that one, a ContentSheetCell always has a genuine sourcePath of its own to attribute the rect to.
export function renderCellBackground(
  cell: ContentSheetCell,
  frameYDown: Box,
  pageHeightPt: number,
  out: LayoutItem[],
): void {
  if (cell.background === undefined) {
    return;
  }
  // A rect's own fill is one flat colour, so a 'pattern' fill (ExaDev/documents.js#951) renders as resolveCellFillColor's own single representative colour rather than the genuine two-colour pattern PDF rendering has no primitive for — and that resolution can itself come back undefined (an unresolvable theme/indexed colour, or the reserved gray125 pattern with no explicit colours), which is genuinely no fill rather than a reason to skip resolving at all, so the guard below checks the RESOLVED colour, not merely whether the cell declared a background object.
  const fill = resolveCellFillColor(cell.background);
  if (fill === undefined) {
    return;
  }
  const flipped = flipY(frameYDown, pageHeightPt);
  out.push({
    kind: "rect",
    xPt: flipped.xPt,
    yPt: flipped.yPt,
    widthPt: flipped.widthPt,
    heightPt: flipped.heightPt,
    fill,
    sourcePath: cell.sourcePath,
  });
}

// The default vertical placement for a cell that declares none — matching every real spreadsheet application's own default, and preserving exactly the behaviour this module had before ContentSheetCell.verticalAlignment existed to override it.
const DEFAULT_CELL_VERTICAL_ALIGNMENT = "bottom";

// The y-down top of a single rendered line within its own cell, for each of the three vertical alignments ContentSheetCellSchema models. Every branch is clamped to at least one padding inset below the cell's own top, so a line taller than its own cell overflows downward (visible, overlapping the row below) rather than upward into the row above — the same clamping the bottom-aligned case has always applied, generalised rather than special-cased.
export function verticalLineTopYDownPt(
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
export function renderCellText(
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
  // The full wrapped-line array is kept (not just its own first entry) purely so a justified cell can tell whether its rendered (always first, per this module's own single-line scope — see its top-of-file doc comment) line is genuinely non-final: a cell's own source text carrying an explicit line break produces more than one WrappedLine here, of which only the first is ever rendered, so THAT first line is the non-final one a justified paragraph's own convention (src/layout/engine.ts) stretches.
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
  // Only a genuinely non-final, non-overflowing line gets its inter-word gaps stretched — see src/layout/engine.ts's identical convention. A cell that triggered the numeric-'###'/string-spill-or-truncate overflow path above is never justified (its own fragments no longer reflect the natural, unstretched layout this function needs), and neither is the ordinary single-line cell (lines.length === 1), matching every real spreadsheet application's own "justify only wraps, never a single line" behaviour.
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
    // Stamps the run the fragment came from; a synthesised fallback run (a cell with no runs of its own) or an overflow replacement ('###' stand-in text) has no originating node, and stamps nothing — the run's own text genuinely did not render there.
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

export function renderHeaderLabels(
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

// One LayoutLine per row/column boundary spanning the FULL grid extent — never one per cell, both for correctness (a per-cell line would double-paint every interior boundary) and for output size on a large sheet.
export function renderGridlines(
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

// Typesets every anchored formula whose own anchor cell falls on the page currently being built, recording each into the shared `out` accumulator in true PDF page space — the sheets-side counterpart to engine.ts's layoutFormulaFlow and slides.ts's layoutShapeFormula, and the same "shared accumulator threaded through a layout pass" pattern both of those use.
//
// The anchor cell's own top-left comes straight from the already-positioned axes, so band membership, the repeat band, the header gutter, and fit-to-page scaling are all accounted for by construction rather than recomputed here. The formula's own offset WITHIN that cell is applied unscaled, matching this module's own existing treatment of every other cell-local inset (CELL_TEXT_PADDING_PT, the header-label padding): fit-to-page scales the grid's geometry, never a cell's internal padding or its text's point size, so scaling a formula's cell offset alone would place it inconsistently with the cell text beside it. A formula anchored to a hidden row or column is skipped outright, exactly as its cells are.
//
// A formula anchored inside the repeat row/column band therefore renders on every page that band appears on, which is what a repeat band means — no special case needed, since it is simply present in every page's own PositionedAxis.
export function renderAnchoredFormulas(
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
    // No frame is stamped here, unlike engine.ts's and slides.ts's own formula placements: a sheet-anchored embedded object is a ContentEmbeddedObject, the one embedded-object shape document-schema.js deliberately left WITHOUT a frames field (only the in-flow ContentEmbeddedObjectBlock carries one), so there is no node field to stamp — the rendered position lives in the PositionedFormula array this loop already records.
  }
}

// The image-side counterpart to renderAnchoredFormulas above: a ContentSheetImage carries the identical anchor quartet and resolves through the same axis lookup, but emits a real LayoutImage into the page's own items (an image IS a LayoutItem, unlike a formula's CID-font glyph runs which have no item kind and travel separately). Asset registration goes through the document-wide `images` record shared.ts's registerImage deduplicates into, exactly as engine.ts's layoutImageFlow and slides.ts's convertShape already do. The same skip rules apply: an anchor outside the resolved axis range, or in a hidden column/row, renders nothing — matching how that cell's own content is skipped, and how renderAnchoredFormulas handles an anchored formula.
export function renderAnchoredImages(
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
