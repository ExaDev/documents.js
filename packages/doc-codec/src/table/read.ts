import type {
  ContentBlock,
  ContentParagraph,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { DocFormatError, DocUnsupportedError } from "../errors";
import type { ParagraphEntry } from "../read";
import {
  HORZ_MERGE_CONTINUATION,
  VERT_MERGE_CONTINUATION,
  applyTableSprms,
  type TableRowDefinition,
} from "./tap";
import { CELL_MARK } from "../text/special";

// Groups the flat paragraph-entry sequence read.ts produces into the final ContentBlock list, folding every contiguous run of table-depth-1 paragraphs into a real ContentTable with row/cell/merge structure -- [MS-DOC] 2.4.3's own Overview of Tables model: a table is a run of paragraphs each marked sprmPFInTable, cells delimited by cell-mark (0x07) characters (a cell holding more than one paragraph ends every paragraph but its last with an ordinary 0x0D mark), and each row closed by a row-ending mark of its own (sprmPFTtp, itself a 0x07 mark) that carries the row's TAP -- its column layout and every physical cell's own horizontal/vertical merge state, resolved by tap.ts. A non-table entry passes through untouched.

const TWIPS_PER_POINT = 20;

interface RawCell {
  readonly horzMerge: number;
  readonly vertMerge: number;
  readonly blocks: ContentBlock[];
}

export function assembleBlocks(
  entries: readonly ParagraphEntry[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (entry === undefined) break;
    if (entry.properties.inTable !== true) {
      blocks.push(entry.paragraph);
      index += 1;
      continue;
    }
    const { table, nextIndex } = readTable(entries, index);
    blocks.push(table);
    index = nextIndex;
  }
  return blocks;
}

function readTable(
  entries: readonly ParagraphEntry[],
  start: number,
): { table: ContentTable; nextIndex: number } {
  const rawRows: RawCell[][] = [];
  const rowDefinitions: TableRowDefinition[] = [];
  const rowHeights: (number | undefined)[] = [];

  let cellParagraphs: ContentParagraph[] = [];
  let rowCells: { blocks: ContentBlock[] }[] = [];
  let index = start;

  while (index < entries.length) {
    const entry = entries[index];
    if (entry?.properties.inTable !== true) break;
    if (
      (entry.properties.tableDepth !== undefined &&
        entry.properties.tableDepth > 1) ||
      entry.properties.nestedTableMark === true
    ) {
      throw new DocUnsupportedError(
        "doc-codec does not support a table nested inside a table cell (table depth greater than 1)",
      );
    }

    cellParagraphs.push(entry.paragraph);

    if (entry.properties.tableRowEnd === true) {
      const rowProperties = applyTableSprms(entry.grpprl, {});
      const definition = rowProperties.definition;
      if (definition === undefined) {
        throw new DocFormatError(
          "a table row's own terminating mark carries no sprmTDefTable, so its column layout and cell merge state cannot be resolved",
        );
      }
      if (rowCells.length !== definition.cells.length) {
        throw new DocFormatError(
          `a table row's own TAP declares ${definition.cells.length} physical cells, but its cell marks delimit ${rowCells.length}`,
        );
      }
      rawRows.push(
        rowCells.map((cell, cellIndex): RawCell => {
          const merge = definition.cells[cellIndex];
          if (merge === undefined) {
            throw new DocFormatError(
              `internal defect: table row cell ${cellIndex} has no TAP merge entry despite the length check above`,
            );
          }
          return {
            horzMerge: merge.horzMerge,
            vertMerge: merge.vertMerge,
            blocks: cell.blocks,
          };
        }),
      );
      rowDefinitions.push(definition);
      rowHeights.push(rowProperties.heightPt);
      rowCells = [];
      cellParagraphs = [];
      index += 1;
      continue;
    }

    if (entry.terminator === CELL_MARK) {
      // An ordinary cell mark -- not the row's own -- closes the cell that was accumulating: everything from the last cell (or row) boundary up to and including this paragraph.
      rowCells.push({ blocks: cellParagraphs });
      cellParagraphs = [];
    }
    index += 1;
  }

  if (cellParagraphs.length > 0 || rowCells.length > 0) {
    throw new DocFormatError(
      "a table's paragraphs end without a row-ending mark to close the row's last cell",
    );
  }
  if (rawRows.length === 0) {
    throw new DocFormatError(
      "a run of table-depth paragraphs produced no complete row",
    );
  }

  return {
    table: {
      kind: "table",
      rows: buildRows(rawRows, rowHeights),
      columnWidthsPt: columnWidthsFromDefinition(rowDefinitions[0]),
    },
    nextIndex: index,
  };
}

function columnWidthsFromDefinition(
  definition: TableRowDefinition | undefined,
): number[] {
  if (definition === undefined) return [];
  const boundaries = definition.columnBoundariesTwips;
  const widths: number[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const left = boundaries[index];
    const right = boundaries[index + 1];
    if (left === undefined || right === undefined) continue;
    widths.push((right - left) / TWIPS_PER_POINT);
  }
  return widths;
}

// Folds each row's physical cells (one per grid column, horizontally- and vertically-merged-away cells included, exactly as the raw rows carry them) into the shared schema's own anchor-carries-the-span convention: a horizontal-continuation cell is dropped from the output row (it only widens the preceding real cell's colSpan), while a vertical-continuation cell is kept as its own `{blocks: []}` entry -- mirroring ooxml.js's own docx table reader, which the shared schema's colSpan/rowSpan fields were designed to hold either format's cousin of. Column index tracking is a plain physical-position count here (never ooxml.js's cumulative-gridSpan arithmetic), because [MS-DOC] never omits a horizontally-merged-away cell from the physical stream the way OOXML's gridSpan model does.
function buildRows(
  rawRows: readonly RawCell[][],
  rowHeights: readonly (number | undefined)[],
): ContentTableRow[] {
  return rawRows.map((row, rowIndex): ContentTableRow => {
    const cells: ContentTableCell[] = [];
    let physicalIndex = 0;
    while (physicalIndex < row.length) {
      const cell = row[physicalIndex];
      if (cell === undefined) break;
      if (cell.horzMerge === HORZ_MERGE_CONTINUATION) {
        physicalIndex += 1;
        continue;
      }
      const colIndex = physicalIndex;
      let span = 1;
      while (row[physicalIndex + span]?.horzMerge === HORZ_MERGE_CONTINUATION) {
        span += 1;
      }
      if (cell.vertMerge === VERT_MERGE_CONTINUATION) {
        cells.push({ blocks: [] });
      } else {
        let rowSpan = 1;
        for (let r = rowIndex + 1; r < rawRows.length; r += 1) {
          const below = rawRows[r]?.[colIndex];
          if (below?.vertMerge !== VERT_MERGE_CONTINUATION) break;
          rowSpan += 1;
        }
        cells.push({
          blocks: cell.blocks,
          colSpan: span > 1 ? span : undefined,
          rowSpan: rowSpan > 1 ? rowSpan : undefined,
        });
      }
      physicalIndex += span;
    }
    const heightPt = rowHeights[rowIndex];
    return heightPt !== undefined ? { cells, heightPt } : { cells };
  });
}
