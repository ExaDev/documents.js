import {
  cellReference,
  type CellPosition,
  type ContentSheetCell,
} from "document-schema.js";
import { segmentSheetRegions } from "./regions";

// Neighbour-derived labels (ExaDev/documents.js#823, "Ask 2"'s second inference): a cell's meaning comes from the nearest text cells above it and to its left, with the distance recorded as a confidence signal -- not from detecting a header row as a precondition. That single rule covers a real table (the header row is simply the nearest text above, strong and repeated down every column), a scattered label/value pair, and a margin annotation, without requiring the sheet to be tidy. As with segmentSheetRegions in this same package, this is a PURELY ADDITIONAL, OPT-IN artefact: deriveNeighbourLabels never mutates its input, and a consumer who never calls it still has every cell exactly as ContentSheetCell[]/SheetDescriptor.cells already carries it.
//
// A "text cell" here means value.kind === 'string' -- the one ContentCellValue variant that is genuinely free text rather than a formatted number/date/boolean whose displayText happens to render as characters. A label is only ever useful when it is itself prose (a column header, a row title, a margin note); a formatted date or currency cell is data, not a label for something else, however text-shaped its rendering is.
export interface CellNeighbourReference {
  readonly ref: CellPosition;
  readonly text: string;
  readonly distance: number;
  readonly confidence: number;
}

// One cell's derived label context. `above`/`left` are each independently optional -- ABSENCE, not a fabricated placeholder, is how "no label found" is modelled, per this workspace's own no-defensive-over-engineering convention: a cell with nothing findable above it (or to its left) simply carries no `above` (or `left`) field, so a consumer checking `label.above !== undefined` gets a real yes/no rather than having to distinguish a genuine match from a sentinel. One CellLabel is emitted for every populated cell -- including cells with neither `above` nor `left` found -- for the same "advisory, never gates" reason segmentSheetRegions always classifies a region (down to 'unknown') rather than omitting a region it has no confident read on: a consumer can tell "we looked and found nothing" from "we never processed this cell" only if every populated cell gets an entry.
export interface CellLabel {
  readonly cell: CellPosition;
  readonly above?: CellNeighbourReference;
  readonly left?: CellNeighbourReference;
}

// The row/column distance -> confidence mapping: confidence = 1 / distance, the same 0..1 scale segmentSheetRegions introduces for region classification. distance is always >= 1 (searches are strictly above/left, never at the cell's own row/column), so this always yields a value in (0, 1]: an immediately adjacent label (distance 1) is maximal confidence (1), and confidence decays smoothly (1/2, 1/3, 1/4, ...) the further away the nearest text cell is found, never reaching exactly 0 -- a distant match is still weak evidence, never zero evidence, as long as it was found within the same region at all (see the region-boundary rule below).
function confidenceForDistance(distance: number): number {
  return 1 / distance;
}

// Derives a neighbour-based label for every populated cell in a sheet's sparse cell array. For each cell, searches for the nearest text cell strictly above it (same column, smaller row) and the nearest text cell strictly to its left (same row, smaller column), independently.
//
// REGION-BOUNDED SEARCH is the deliberate boundary choice here (the issue itself flags this as a real decision to make, not a detail to improvise): a candidate only counts if it is in the SAME connected region (segmentSheetRegions' own connected-component partition) as the target cell, not merely "somewhere above/left on the sheet, however far". Two cells that are far enough apart to land in different regions are, by segmentSheetRegions' own adjacency rule, cells the sheet's own layout does not treat as related -- an isolated annotation two rows above a completely disconnected table should never be attributed as that table's column header just because it happens to sit in the same column. Bounding the search at the sheet's outer edge alone (ignoring region membership) would let exactly that kind of unrelated, distant match through; bounding it at the region instead reuses the same locality judgement segmentation already made, rather than inventing a second, independent one.
export function deriveNeighbourLabels(
  cells: readonly ContentSheetCell[],
): CellLabel[] {
  const regions = segmentSheetRegions(cells);
  const regionIndexOf = new Map<string, number>();
  regions.forEach((region, index) => {
    for (const cell of region.cells) {
      regionIndexOf.set(cellReference(cell.row, cell.column), index);
    }
  });

  const textCellsByColumn = new Map<number, ContentSheetCell[]>();
  const textCellsByRow = new Map<number, ContentSheetCell[]>();
  for (const cell of cells) {
    if (cell.value.kind !== "string") continue;
    const column = textCellsByColumn.get(cell.column);
    if (column === undefined) textCellsByColumn.set(cell.column, [cell]);
    else column.push(cell);
    const row = textCellsByRow.get(cell.row);
    if (row === undefined) textCellsByRow.set(cell.row, [cell]);
    else row.push(cell);
  }

  return cells.map((cell): CellLabel => {
    const regionIndex = regionIndexOf.get(cellReference(cell.row, cell.column));
    const above = nearestTextCell(
      textCellsByColumn.get(cell.column) ?? [],
      cell.row,
      (candidate) => candidate.row,
      regionIndexOf,
      regionIndex,
    );
    const left = nearestTextCell(
      textCellsByRow.get(cell.row) ?? [],
      cell.column,
      (candidate) => candidate.column,
      regionIndexOf,
      regionIndex,
    );
    return {
      cell: { row: cell.row, column: cell.column },
      ...(above !== undefined ? { above } : {}),
      ...(left !== undefined ? { left } : {}),
    };
  });
}

// Finds the nearest text-cell candidate strictly before `targetPosition` on the given axis (row for the above search, column for the left search), restricted to candidates sharing the target's region. `candidates` is already filtered to the target's own column (for the above search) or row (for the left search) by the caller, so this only needs to compare the one remaining axis.
function nearestTextCell(
  candidates: readonly ContentSheetCell[],
  targetPosition: number,
  positionOf: (cell: ContentSheetCell) => number,
  regionIndexOf: ReadonlyMap<string, number>,
  targetRegionIndex: number | undefined,
): CellNeighbourReference | undefined {
  let nearest: ContentSheetCell | undefined;
  let nearestPosition = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const position = positionOf(candidate);
    if (position >= targetPosition) continue;
    if (position <= nearestPosition) continue;
    if (
      regionIndexOf.get(cellReference(candidate.row, candidate.column)) !==
      targetRegionIndex
    )
      continue;
    nearest = candidate;
    nearestPosition = position;
  }
  if (nearest === undefined) return undefined;
  const distance = targetPosition - nearestPosition;
  return {
    ref: { row: nearest.row, column: nearest.column },
    text: nearest.displayText,
    distance,
    confidence: confidenceForDistance(distance),
  };
}
