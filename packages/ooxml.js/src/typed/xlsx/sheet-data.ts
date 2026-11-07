import { parseCellReference } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag } from "../util";

// Positions of a worksheet's <row> and <c> elements, with the reference each one omits filled in from document order. ECMA-376 Part 1's schema declares both CT_Row/@r (SS18.3.1.73) and CT_Cell/@r (SS18.3.1.4) optional, and real producers omit them, relying on the position Excel itself gives such an element: a row with no r is the row after the previous one (the first row when none precedes it), and a cell with no r is the column after the previous cell in the same row (column A for the row's first cell). Every reader of sheetData resolves positions through this module so a sheet written without references reads the same as one written with them.
//
// A reference that is present but does not parse (a row r below 1 or not an integer, a cell r that is not an A1 reference) names no position: that element resolves to undefined and leaves the cursor where it was, so the elements after it follow the last position that was readable. That keeps this package's earlier behaviour of dropping such an element rather than guessing where it belongs.

// 0-based row index of a <row>, or undefined when its own r does not parse.
export interface PositionedRow {
  readonly element: XmlElement;
  readonly index: number | undefined;
}

export interface PositionedCell {
  readonly element: XmlElement;
  readonly row: number;
  readonly column: number;
}

function parseRowNumber(raw: string): number | undefined {
  const rowNumber = Number.parseInt(raw, 10);
  return Number.isInteger(rowNumber) && rowNumber >= 1
    ? rowNumber - 1
    : undefined;
}

// Every <row> child of sheetData in document order, each with its resolved 0-based index.
export function positionedRows(sheetData: XmlElement): PositionedRow[] {
  const rows: PositionedRow[] = [];
  let previous = -1;
  for (const element of childrenWithTag(sheetData, "row")) {
    const raw = attr(element, "r");
    const index = raw === undefined ? previous + 1 : parseRowNumber(raw);
    if (index !== undefined) {
      previous = index;
    }
    rows.push({ element, index });
  }
  return rows;
}

// Every <c> child of one positioned row whose position resolves, in document order. A cell with its own r keeps the row that reference names, exactly as before references became optional here; a cell without one takes its row's resolved index, so it is dropped only when that row's own r did not parse.
export function positionedCells(row: PositionedRow): PositionedCell[] {
  const cells: PositionedCell[] = [];
  let previousColumn = -1;
  for (const element of childrenWithTag(row.element, "c")) {
    const reference = attr(element, "r");
    if (reference !== undefined) {
      const position = parseCellReference(reference);
      if (position !== undefined) {
        previousColumn = position.column;
        cells.push({ element, row: position.row, column: position.column });
      }
      continue;
    }
    const column = previousColumn + 1;
    previousColumn = column;
    if (row.index !== undefined) {
      cells.push({ element, row: row.index, column });
    }
  }
  return cells;
}
