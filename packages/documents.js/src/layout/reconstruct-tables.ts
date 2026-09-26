// The table-recovery family, split from reconstruct.ts: recovering grid tables from a sheet's positioned text, through lattice detection, text-clustering fallback, cell grouping and grid construction. reconstructSpreadsheet calls recoverTables; the shared line-clustering and stamping helpers stay behind in their original modules and are imported back.
import type {
  ContentBlock,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetRow,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
  PositionedTableCell,
  PositionedTableRow,
} from "document-schema.js";
import {
  DEFAULT_COLUMN_WIDTH_FALLBACK_PT,
  nearestOfType,
  NO_ITEMS,
} from "./reconstruct";
import {
  bucketCounts,
  clusterIntoLines,
  estimateModalLineSpacing,
  gapExceeds,
  MIN_WORD_GAP_PT,
  textItemVerticalExtent,
} from "./reconstruct-lines";
import { CELL_TYPES, ROW_TYPES, TABLE_TYPES } from "./reconstruct";
import {
  type CellTypeInference,
  type CellTypeInferenceSink,
} from "./cell-typing";
import { denseTableRows } from "document-schema.js";
import type { StructureIndex, StructureNode } from "./reconstruct";
import type { TextLine } from "./reconstruct-lines";
import {
  lineToParagraph,
  splitLineByLargeGaps,
} from "./reconstruct-presentations-prod";
import type { RecoveredTable } from "./reconstruct-presentations-prod";
import type { TableRegion } from "./lattice";
import type {} from "document-schema.js";
import type { LayoutItem, LayoutPage, LayoutText } from "pdf-codec";
import { stampFrame } from "./shared";
import { flipY } from "../model/geometry";
import { findColumnIndex } from "./lattice";
import { detectGridLattice, findRowIndex } from "./lattice";
import type { GridLattice } from "./lattice";
import { inferCellValue } from "./cell-typing";

export function recoverTables(
  page: LayoutPage,
  pageIndex: number,
  structure: StructureIndex | undefined,
): RecoveredTable[] {
  if (structure !== undefined) {
    const tagged = recoverTaggedTables(page, pageIndex, structure);
    if (tagged.length > 0) {
      return tagged;
    }
  }
  const lattice = recoverTable(page, pageIndex);
  return lattice === undefined ? [] : [lattice];
}

// One tagged table: rows are the /TR descendants of its /Table element in document order, cells positional by their TD/TH order within the row, every cell's blocks built from exactly the text items its owning cell element claims. A /TH degrades to an ordinary cell — the content vocabulary has no header-cell spelling to state one with (the same honest narrowing radio fields took), while the structure table the reader emitted still carries the fact. Column widths are the only geometry-derived values, measured from the cells' own item extents.
function recoverTaggedTables(
  page: LayoutPage,
  pageIndex: number,
  structure: StructureIndex,
): RecoveredTable[] {
  interface TaggedCell {
    readonly table: StructureNode;
    readonly row: StructureNode;
    readonly cell: StructureNode;
    readonly items: LayoutText[];
  }
  const cellsByTable = new Map<
    string,
    { table: StructureNode; cellsById: Map<string, TaggedCell> }
  >();
  for (const item of page.items) {
    if (item.kind !== "text") {
      continue;
    }
    const cell = nearestOfType(structure.nodeOfItem(item), CELL_TYPES);
    // A cell not under a TR under a Table is a malformed chain — the file's tagging cannot state a grid for it, so the lattice-or-nothing fallback decides.
    const row = nearestOfType(cell?.parent, ROW_TYPES);
    const table = nearestOfType(row?.parent, TABLE_TYPES);
    if (cell === undefined || row === undefined || table === undefined) {
      continue;
    }
    const entry = cellsByTable.get(table.id) ?? {
      table,
      cellsById: new Map<string, TaggedCell>(),
    };
    // Several text items — one per PDF text-showing operation — routinely share one tagged cell (any cell whose value is more than a single unstyled word), and must accumulate into that one cell's own items rather than each minting its own positional entry: keying by the item instead of by the cell it belongs to split every multi-run cell into several bogus single-item cells, pushing every later cell in the row out of its real column and scattering that row's own text across its neighbours' columns.
    const existing = entry.cellsById.get(cell.id);
    if (existing === undefined) {
      entry.cellsById.set(cell.id, { table, row, cell, items: [item] });
    } else {
      existing.items.push(item);
    }
    cellsByTable.set(table.id, entry);
  }
  if (cellsByTable.size === 0) {
    return [];
  }
  // A tagged table with drawn rules claims them as its own structure exactly as the lattice path does, so the same strokes never recover twice (once as a table's gridlines, once as free vectors).
  const latticeItems: ReadonlySet<LayoutItem> =
    detectGridLattice(page.items)?.sourceItems ?? NO_ITEMS;
  const recovered: RecoveredTable[] = [];
  for (const { cellsById } of cellsByTable.values()) {
    const cells = [...cellsById.values()];
    const rowsById = new Map<
      string,
      { row: StructureNode; cells: TaggedCell[] }
    >();
    for (const cellEntry of cells) {
      const rowEntry = rowsById.get(cellEntry.row.id) ?? {
        row: cellEntry.row,
        cells: [],
      };
      rowEntry.cells.push(cellEntry);
      rowsById.set(cellEntry.row.id, rowEntry);
    }
    const rows = [...rowsById.values()].sort(
      (a, b) => a.row.order - b.row.order,
    );
    for (const row of rows) {
      row.cells.sort((a, b) => a.cell.order - b.cell.order);
    }
    const columnCount = Math.max(...rows.map((row) => row.cells.length));
    const columns: ContentTable["columns"] = [];
    for (let j = 0; j < columnCount; j++) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      for (const row of rows) {
        const cellEntry = row.cells[j];
        if (cellEntry === undefined) {
          continue;
        }
        for (const item of cellEntry.items) {
          minX = Math.min(minX, item.xPt);
          maxX = Math.max(maxX, item.xPt + (item.widthPt ?? 0));
        }
      }
      const width = maxX - minX;
      // The same nominal fallback the spreadsheet direction's last-column measurement takes: only reached when no item in the column reports a width at all.
      columns.push({
        widthPt: width > 0 ? width : DEFAULT_COLUMN_WIDTH_FALLBACK_PT,
      });
    }
    const allItems = cells.flatMap((cellEntry) => cellEntry.items);
    const contentRows: ContentTableRow[] = rows.map((row) => {
      const contentCells: ContentTableCell[] = [];
      for (let j = 0; j < columnCount; j++) {
        const cellEntry = row.cells[j];
        const cell: ContentTableCell = {
          blocks: cellBlocksFromItems(cellEntry?.items ?? [], pageIndex),
        };
        if (cellEntry !== undefined) {
          stampFrame(cell, pageIndex, textItemsPdfBox(cellEntry.items));
        }
        contentCells.push(cell);
      }
      return { cells: contentCells };
    });
    const box = textItemsPdfBox(allItems);
    const table: ContentTable = {
      kind: "table",
      rows: contentRows,
      columns,
    };
    stampFrame(table, pageIndex, box);
    recovered.push({
      table,
      frame: flipY(box, page.heightPt),
      topYPt: box.yPt + box.heightPt,
      consumedText: new Set(allItems),
      latticeItems,
    });
  }
  return recovered;
}

// The PDF-space bounding box of a set of text items, using the same real AFM ascent/descent extents every other frame stamp in this module measures with.
function textItemsPdfBox(items: readonly LayoutText[]): {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const { ascentPt, descentPt } = textItemVerticalExtent(item);
    minX = Math.min(minX, item.xPt);
    maxX = Math.max(maxX, item.xPt + (item.widthPt ?? 0));
    minY = Math.min(minY, item.yPt - descentPt);
    maxY = Math.max(maxY, item.yPt + ascentPt);
  }
  return { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY };
}

// One cell's own text, as one ContentParagraph per recovered line. A table cell's text genuinely can wrap across lines (unlike a spreadsheet cell's — see buildGridFromTextClustering's own note), and geometry alone cannot say whether two stacked lines in a cell were one wrapped paragraph or two separate ones, so each line stays its own paragraph rather than being joined on a guess. This is the same choice reconstructPresentation's own blockToShape already makes for a slide text box, for the same reason.
function cellBlocksFromItems(
  items: readonly LayoutText[],
  pageIndex: number,
): ContentBlock[] {
  return clusterIntoLines(items).map((line) =>
    lineToParagraph(line, pageIndex),
  );
}

// Every atomic [row, column] cell the lattice's own boundaries admit, mapped to the TableRegion that owns it — several atomic cells share one region wherever no drawn stroke separated them (a colSpan/rowSpan merge, ExaDev/documents.js#810).
function indexRegions(
  lattice: GridLattice,
  rowCount: number,
  columnCount: number,
): TableRegion[][] {
  const regionAt: TableRegion[][] = Array.from(
    { length: rowCount },
    () => new Array<TableRegion>(columnCount),
  );
  for (const region of lattice.regions) {
    for (let i = region.rowStart; i < region.rowEnd; i++) {
      for (let j = region.colStart; j < region.colEnd; j++) {
        regionAt[i]![j] = region;
      }
    }
  }
  return regionAt;
}

function recoverTable(
  page: LayoutPage,
  pageIndex: number,
): RecoveredTable | undefined {
  const lattice = detectGridLattice(page.items);
  if (lattice === undefined) {
    return undefined;
  }
  const rowCount = lattice.rowBoundariesDescPt.length - 1;
  const columnCount = lattice.columnBoundariesAscPt.length - 1;
  const regionAt = indexRegions(lattice, rowCount, columnCount);
  const textByRegion = new Map<TableRegion, LayoutText[]>();
  const consumedText = new Set<LayoutText>();
  for (const item of page.items) {
    if (item.kind !== "text") {
      continue;
    }
    const row = findRowIndex(lattice.rowBoundariesDescPt, item.yPt);
    const column = findColumnIndex(lattice.columnBoundariesAscPt, item.xPt);
    if (row === undefined || column === undefined) {
      continue; // outside the lattice entirely — a caption, a heading above the table
    }
    const region = regionAt[row]![column]!;
    const existing = textByRegion.get(region);
    if (existing === undefined) {
      textByRegion.set(region, [item]);
    } else {
      existing.push(item);
    }
    consumedText.add(item);
  }
  if (consumedText.size === 0) {
    return undefined; // an empty lattice is decoration, not a table — see this section's own note
  }

  const columns: ContentTable["columns"] = [];
  for (let j = 0; j < columnCount; j++) {
    columns.push({
      widthPt:
        lattice.columnBoundariesAscPt[j + 1]! -
        lattice.columnBoundariesAscPt[j]!,
    });
  }
  // Each region contributes one anchor at its top-left atomic position, and denseTableRows fills every other position the region covers (further columns of its first row, and every column of its later rows) with an empty covered cell, so each row holds one entry per grid column as ContentTable's own grid rule requires.
  const positionedRows: PositionedTableRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const positioned: PositionedTableCell[] = [];
    for (let j = 0; j < columnCount; j++) {
      const region = regionAt[i]![j]!;
      if (region.rowStart !== i || region.colStart !== j) {
        continue;
      }
      const colSpan = region.colEnd - region.colStart;
      const rowSpan = region.rowEnd - region.rowStart;
      const cell: ContentTableCell = {
        blocks: cellBlocksFromItems(textByRegion.get(region) ?? [], pageIndex),
        colSpan: colSpan > 1 ? colSpan : undefined,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
      };
      const cellLeftXPt = lattice.columnBoundariesAscPt[region.colStart]!;
      const cellRightXPt = lattice.columnBoundariesAscPt[region.colEnd]!;
      const cellTopYPt = lattice.rowBoundariesDescPt[region.rowStart]!;
      const cellBottomYPt = lattice.rowBoundariesDescPt[region.rowEnd]!;
      stampFrame(cell, pageIndex, {
        xPt: cellLeftXPt,
        yPt: cellBottomYPt,
        widthPt: cellRightXPt - cellLeftXPt,
        heightPt: cellTopYPt - cellBottomYPt,
      });
      positioned.push({ columnIndex: j, cell });
    }
    positionedRows.push({
      cells: positioned,
      heightPt:
        lattice.rowBoundariesDescPt[i]! - lattice.rowBoundariesDescPt[i + 1]!,
    });
  }
  const rows = denseTableRows(positionedRows, columnCount);

  const leftXPt = lattice.columnBoundariesAscPt[0]!;
  const rightXPt = lattice.columnBoundariesAscPt[columnCount]!;
  const topYPt = lattice.rowBoundariesDescPt[0]!;
  const bottomYPt = lattice.rowBoundariesDescPt[rowCount]!;
  const pdfBox = {
    xPt: leftXPt,
    yPt: bottomYPt,
    widthPt: rightXPt - leftXPt,
    heightPt: topYPt - bottomYPt,
  };
  const frame = flipY(pdfBox, page.heightPt);
  const table: ContentTable = { kind: "table", rows, columns };
  stampFrame(table, pageIndex, pdfBox);
  return {
    table,
    frame,
    topYPt,
    consumedText,
    latticeItems: lattice.sourceItems,
  };
}

// ---------------------------------------------------------------------------
// PDF -> ods (spreadsheet): recovers what was printed, not what was entered. Every recovered cell keeps its own rendered string verbatim in the REQUIRED displayText field, and additionally gets a heuristically re-typed `value` (number/percentage/currency/date/boolean) wherever src/layout/cell-typing.ts finds exactly one defensible reading of that string — an explicitly PROBABILISTIC step, not a fidelity guarantee, since a rendered PDF genuinely never carries a cell's own typed value and a numeric-looking string may always have been a genuine string. Read cell-typing.ts's own module doc before relying on a re-typed value: it states the confidence bar, and every re-typing decision (including a deliberate refusal on a named ambiguity) is reported through ReconstructOptions.onCellTypeInference. A formula is still never claimed — nothing about a rendered value implies one was computed. Two detection paths, tried in this order per page: (1) a real gridline lattice — a genuine printed spreadsheet with gridlines enabled draws exactly this, see layout/sheets.ts's own renderGridlines — is used DIRECTLY as cell boundaries, no inference needed; (2) absent a lattice, text is clustered into a grid from geometry alone, reusing this module's own clusterIntoLines for rows (a spreadsheet cell's own text is never wrapped across lines — sheets.ts's own module doc — so a text line already IS a row) and a parallel x-position recurrence clustering for columns, generalizing clusterIntoParagraphs's own single dominantLeftX to several recurring column anchors. Column widths, row heights, and a sheet's own page size are all genuinely MEASURED from recovered geometry, never invented; there is no attempt to recover print INTENT (range/scale/repeat-rows) that a rendered page carries no trace of at all.
// ---------------------------------------------------------------------------

// --- Path 1: gridline lattice detection (src/layout/lattice.ts, shared with the wordprocessing/presentation table recovery above) -----------------------------------------------------------

// --- Shared: joining several LayoutText items already known to belong to one recovered cell, and turning row/column groups into ContentSheetCell[] -----

// Reuses this module's own MIN_WORD_GAP_PT threshold (defined above for paragraph/line text) to decide whether consecutive items need a space between them, but never inserts a tab the way pushRunsForLine does: a tab reads as columnar structure WITHIN a line of prose, which is meaningless once the grid itself has already resolved the column structure.
function joinCellText(items: readonly LayoutText[]): string {
  const sorted = [...items].sort((a, b) => a.xPt - b.xPt);
  let text = "";
  sorted.forEach((item, i) => {
    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (gapExceeds(prev, item, MIN_WORD_GAP_PT)) {
        text += " ";
      }
    }
    text += item.text;
  });
  return text;
}

function groupKey(row: number, column: number): string {
  return `${row},${column}`;
}

function addToGroup(
  groups: Map<string, LayoutText[]>,
  row: number,
  column: number,
  item: LayoutText,
): void {
  const key = groupKey(row, column);
  const existing = groups.get(key);
  if (existing === undefined) {
    groups.set(key, [item]);
  } else {
    existing.push(item);
  }
}

// Every recovered cell ALWAYS carries its own rendered text verbatim in displayText, and additionally carries a heuristically re-typed `value` wherever src/layout/cell-typing.ts finds exactly one defensible reading of that text (see its own module doc for the confidence bar, and this section's top-of-block note for why the whole step is probabilistic). A cell whose text is ambiguous, or not number/date/boolean-shaped at all, keeps `value` as the plain string it was recovered as — so `value.kind !== 'string'` is itself the flag distinguishing an inferred value from an untouched one, with the reporting sink below carrying the reason behind either outcome. A (row, column) position with no text assigned to it at all is simply never emitted, matching the sparse cell model buildOdsPackage's own appendCell already expects.
function buildCellsFromGroups(
  groups: ReadonlyMap<string, readonly LayoutText[]>,
  pageIndex: number,
  context: CellTypingContext,
): ContentSheetCell[] {
  const cells: ContentSheetCell[] = [];
  for (const [key, items] of groups) {
    const displayText = joinCellText(items);
    if (displayText.length === 0) {
      continue;
    }
    const [rowPart, columnPart] = key.split(",");
    const row = Number(rowPart);
    const column = Number(columnPart);
    const cell: ContentSheetCell = {
      row,
      column,
      value: inferredCellValue(displayText, row, column, context),
      displayText,
    };
    // The cell's frame is the PDF-space bounding box of exactly the items clustered into it — the printed extent of that cell's own content, which is all a rendered PDF carries about where the cell was.
    stampFrame(cell, pageIndex, textItemsPdfBox(items));
    cells.push(cell);
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column);
  return cells;
}

export interface CellTypingContext {
  readonly sheetIndex: number;
  readonly sink?: CellTypeInferenceSink;
}

// The one place a recovered cell's re-typed value is decided and reported. A 'retyped' result replaces the plain-string value; a 'declined' one deliberately does not, leaving the string in place — both are reported, because "we looked and refused" is exactly as much a part of the audit trail as "we looked and re-typed", and a caller cannot reconstruct the refusal from the output alone (a declined cell is indistinguishable from one that was never number-shaped to begin with).
function inferredCellValue(
  displayText: string,
  row: number,
  column: number,
  context: CellTypingContext,
): ContentSheetCell["value"] {
  const inference = inferCellValue(displayText);
  if (inference === undefined) {
    return { kind: "string", value: displayText };
  }
  const reported: CellTypeInference = {
    sheetIndex: context.sheetIndex,
    row,
    column,
    displayText,
    ...inference,
  };
  context.sink?.(reported);
  return inference.outcome === "retyped"
    ? inference.value
    : { kind: "string", value: displayText };
}

interface ReconstructedGrid {
  readonly cells: ContentSheetCell[];
  readonly columns: ContentSheetColumn[];
  readonly rows: ContentSheetRow[];
  readonly gridlines: boolean;
}

// The gridline positions ARE the cell boundaries — column/row widths are the exact, genuinely measured gap between consecutive drawn lines, not estimated from text at all.
export function buildGridFromLattice(
  textItems: readonly LayoutText[],
  lattice: GridLattice,
  pageIndex: number,
  context: CellTypingContext,
): ReconstructedGrid {
  const groups = new Map<string, LayoutText[]>();
  for (const item of textItems) {
    const row = findRowIndex(lattice.rowBoundariesDescPt, item.yPt);
    const column = findColumnIndex(lattice.columnBoundariesAscPt, item.xPt);
    if (row === undefined || column === undefined) {
      continue; // outside the detected grid entirely — a header-gutter row/column label, a title above the sheet, and so on.
    }
    addToGroup(groups, row, column, item);
  }
  const columns: ContentSheetColumn[] = [];
  for (let j = 0; j < lattice.columnBoundariesAscPt.length - 1; j++) {
    columns.push({
      index: j,
      widthPt:
        lattice.columnBoundariesAscPt[j + 1]! -
        lattice.columnBoundariesAscPt[j]!,
    });
  }
  const rows: ContentSheetRow[] = [];
  for (let i = 0; i < lattice.rowBoundariesDescPt.length - 1; i++) {
    rows.push({
      index: i,
      heightPt:
        lattice.rowBoundariesDescPt[i]! - lattice.rowBoundariesDescPt[i + 1]!,
    });
  }
  return {
    cells: buildCellsFromGroups(groups, pageIndex, context),
    columns,
    rows,
    gridlines: true,
  };
}

// --- Path 2: text-position clustering, no gridlines present -----------------------------------------------------------

// Column x-position tolerance for treating two items across different rows as belonging to the same recovered column — generous enough to absorb ordinary alignment jitter, tight enough not to merge two genuinely adjacent narrow columns. Reused as bucketCounts' own bucket size, the same recurring-position technique clusterIntoParagraphs's own dominantLeftX already uses for a single margin, generalized here to several.
const COLUMN_ALIGNMENT_TOLERANCE_PT = 3;

// A recurring x-position must be seen on at least this many distinct rows before it counts as a real column, not a one-off item at a stray x position (a title, a footnote) — the same "recurring left margin, not a one-off indent" reasoning clusterIntoParagraphs already applies to a single dominant margin.
const MIN_COLUMN_RECURRENCE = 2;

// Nothing recurred across rows at all (a single-row page, or genuinely unique text at every position) falls back to every distinct position found, so a sparse or single-row page still resolves to a sensible (if narrower) grid rather than an empty one. Takes one anchor x-position per SEGMENT (see splitLineByLargeGaps below), not per raw LayoutText item — a single cell's own text can legitimately arrive as several directly adjacent items (a run-level style change mid-cell), and clustering on their individual x-positions would scatter one cell's own fragments across several spurious columns instead of treating them as the one candidate they are.
function detectColumnPositions(
  segmentsByLine: readonly (readonly TextLine[])[],
): number[] {
  const allXs = segmentsByLine.flatMap((segments) =>
    segments.map((segment) => segment.items[0]!.xPt),
  );
  if (allXs.length === 0) {
    return [];
  }
  const counts = bucketCounts(allXs, COLUMN_ALIGNMENT_TOLERANCE_PT);
  const recurring = [...counts.entries()]
    .filter(([, count]) => count >= MIN_COLUMN_RECURRENCE)
    .map(([bucket]) => bucket);
  const positions = recurring.length > 0 ? recurring : [...counts.keys()];
  positions.sort((a, b) => a - b);
  return positions;
}

function nearestColumnIndex(positions: readonly number[], xPt: number): number {
  let bestIndex = 0;
  let bestDistancePt = Number.POSITIVE_INFINITY;
  positions.forEach((position, index) => {
    const distancePt = Math.abs(position - xPt);
    if (distancePt < bestDistancePt) {
      bestDistancePt = distancePt;
      bestIndex = index;
    }
  });
  return bestIndex;
}

// The last recovered column has no following anchor to measure a gap against, unlike every other column, whose width is the genuinely measured distance to the next anchor. Falls back to the widest actually-measured text extent within that column (anchor to the item's own right edge) — still a real geometric measurement, never an invented default.
function lastColumnWidthPt(
  groups: ReadonlyMap<string, readonly LayoutText[]>,
  columnIndex: number,
  anchorXPt: number,
): number {
  let maxWidthPt = 0;
  for (const [key, items] of groups) {
    const [, columnPart] = key.split(",");
    if (Number(columnPart) !== columnIndex) {
      continue;
    }
    for (const item of items) {
      maxWidthPt = Math.max(
        maxWidthPt,
        item.xPt + (item.widthPt ?? 0) - anchorXPt,
      );
    }
  }
  return maxWidthPt > 0 ? maxWidthPt : DEFAULT_COLUMN_WIDTH_FALLBACK_PT;
}

// Rows reuse clusterIntoLines directly — a spreadsheet cell's own text is never wrapped across lines (sheets.ts's own module doc), so a text line already IS a row, with no separate row-clustering pass needed. Each line is then split into segments wherever a large horizontal gap occurs, reusing splitLineByLargeGaps verbatim — the same >2em-gap signal reconstructPresentation's own block clustering already uses to tell "still one cluster of text" from "a new one" — since a single cell's own text can arrive as several directly adjacent LayoutText fragments (a run-level style change mid-cell) that must be treated as one cell candidate, not several. Row heights are the genuinely measured baseline-to-baseline gap to the next row; the last row (no following baseline to measure against) falls back to this page's own modal line spacing, the same already-justified estimateModalLineSpacing this module uses for paragraph/block clustering above.
export function buildGridFromTextClustering(
  textItems: readonly LayoutText[],
  pageIndex: number,
  context: CellTypingContext,
): ReconstructedGrid {
  const lines = clusterIntoLines(textItems);
  if (lines.length === 0) {
    return { cells: [], columns: [], rows: [], gridlines: false };
  }
  const segmentsByLine = lines.map((l) => splitLineByLargeGaps(l));
  const columnPositions = detectColumnPositions(segmentsByLine);
  const groups = new Map<string, LayoutText[]>();
  segmentsByLine.forEach((segments, rowIndex) => {
    for (const segment of segments) {
      const columnIndex = nearestColumnIndex(
        columnPositions,
        segment.items[0]!.xPt,
      );
      const key = groupKey(rowIndex, columnIndex);
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, [...segment.items]);
      } else {
        existing.push(...segment.items);
      }
    }
  });

  const nominalRowHeightPt = estimateModalLineSpacing(lines);
  const rows: ContentSheetRow[] = lines.map((line, i) => {
    const nextBaselineY = lines[i + 1]?.baselineY;
    const heightPt =
      nextBaselineY !== undefined
        ? line.baselineY - nextBaselineY
        : nominalRowHeightPt;
    return { index: i, heightPt: heightPt > 0 ? heightPt : nominalRowHeightPt };
  });

  const columns: ContentSheetColumn[] = columnPositions.map((position, j) => {
    const nextPosition = columnPositions[j + 1];
    return {
      index: j,
      widthPt:
        nextPosition !== undefined
          ? nextPosition - position
          : lastColumnWidthPt(groups, j, position),
    };
  });

  return {
    cells: buildCellsFromGroups(groups, pageIndex, context),
    columns,
    rows,
    gridlines: false,
  };
}

// --- Orchestration: one ContentSheet per PDF page -----------------------------------------------------------
