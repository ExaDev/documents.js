import type {
  Alignment,
  ContentCellFill,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { denseTableRows } from "document-schema.js";
import { WpdDiagnosticCodes, type WpdDiagnosticSink } from "./diagnostics";
import { flushParagraphIfContent, reportOnce, targetBlocks } from "./read-runs";
import type { ReaderState, TableState } from "./read-state";
import {
  CELL_FILL_COLORS_SUBFUNCTION,
  CELL_FORMULA_SUBFUNCTION,
  CELL_INFORMATION_SUBFUNCTION,
  CELL_SPANNING_SUBFUNCTION,
  findEmbeddedSubfunction,
  readCellFill,
  readCellInformation,
  readCellSpanning,
  readEmbeddedSubfunctions,
  readRowInformation,
  ROW_INFORMATION_SUBFUNCTION,
} from "./stream/table";
import { readTableFormula } from "./stream/formula";

// Table handling split out of read.ts: reading an End-of-Line function's own embedded cell attributes, and closing a cell, a row, or a whole table into the shared schema's grid.

// A span count of one covers only the cell stating it, which is what every unmerged cell says, so it carries no merge at all and the shared schema's colSpan/rowSpan stay absent.
const NO_SPAN = 1;

// The cell attributes an End-of-Line function's own embedded subfunctions state about the cell it closes.
export interface CellAttributes {
  readonly alignment: Alignment | undefined;
  readonly background: ContentCellFill | undefined;
  readonly columnSpan: number;
  readonly rowSpan: number;
  readonly covered: boolean;
  readonly formula: string | undefined;
}

// Reads the cell attributes an End-of-Line function carries for the cell it closes, out of its own embedded subfunction list.
export function readCellAttributes(
  state: ReaderState,
  nonDeletable: Uint8Array,
  sink: WpdDiagnosticSink,
): {
  attributes: CellAttributes;
  rowHeightPt: number | undefined;
  rowIsHeader: boolean;
} {
  const { subfunctions, truncated } = readEmbeddedSubfunctions(nonDeletable);
  if (truncated) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.TableAttributesTruncated,
      "A cell's embedded attribute list held a record of undocumented length, so the attributes after it were not read.",
    );
  }

  const information = findEmbeddedSubfunction(
    subfunctions,
    CELL_INFORMATION_SUBFUNCTION,
  );
  const spanning = findEmbeddedSubfunction(
    subfunctions,
    CELL_SPANNING_SUBFUNCTION,
  );
  const fill = findEmbeddedSubfunction(
    subfunctions,
    CELL_FILL_COLORS_SUBFUNCTION,
  );
  const row = findEmbeddedSubfunction(
    subfunctions,
    ROW_INFORMATION_SUBFUNCTION,
  );
  const formulaData = findEmbeddedSubfunction(
    subfunctions,
    CELL_FORMULA_SUBFUNCTION,
  );
  const formula =
    formulaData === undefined ? undefined : readTableFormula(formulaData);
  if (formulaData !== undefined && formula === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.TableFormulaUnresolved,
      "A table cell carries a formula this reader could not decode with confidence, so the cell keeps its displayed text but not the formula that produced it.",
    );
  }

  const cellSpanning =
    spanning === undefined ? undefined : readCellSpanning(spanning);
  const cellFill = fill === undefined ? undefined : readCellFill(fill);
  if (cellFill?.blended === true) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.CellFillBlended,
      "A cell is filled with a shaded blend of two colours, resolved to a 'pattern' fill whose density is this reader's own best-effort derivation, not a value confirmed against a specification.",
    );
  }

  return {
    attributes: {
      alignment:
        information === undefined
          ? undefined
          : readCellInformation(information)?.alignment,
      background: cellFill?.fill,
      columnSpan: cellSpanning?.columnSpan ?? NO_SPAN,
      rowSpan: cellSpanning?.rowSpan ?? NO_SPAN,
      covered:
        cellSpanning?.coveredFromLeft === true ||
        cellSpanning?.coveredFromAbove === true,
      formula,
    },
    rowHeightPt:
      row === undefined ? undefined : readRowInformation(row)?.heightPt,
    // The Row Information subfunction's own header-row flag (stream/table.ts's ROW_FLAG_HEADER_ROW), which WordPerfect repeats at the top of each page the table continues onto: ContentTableRow.isHeader, in this format's own spelling.
    rowIsHeader:
      row === undefined ? false : readRowInformation(row)?.headerRow === true,
  };
}

// Closes the cell currently being built and appends it to the row under construction. A cell the spanning subfunction marks as covered by a neighbour's merge still holds its own grid position (the shared schema's grid rule gives every position an entry), so it is appended as a block-less entry carrying the one property the stream states for it that a covered entry can hold, its own fill. Its justification has no paragraph to land on and its spans and formula belong to the region's anchor, so none of those are carried; any content it holds is not carried either and is reported, since the region's content belongs to its anchor.
export function closeCell(
  state: ReaderState,
  table: TableState,
  attributes: CellAttributes,
  sink: WpdDiagnosticSink,
): void {
  flushParagraphIfContent(state, sink);
  const blocks = table.cellBlocks;
  table.cellBlocks = [];
  // ContentTableCell.background is document-schema.js's discriminated ContentCellFill (ExaDev/documents.js#951); readCellFill (stream/table.ts) already resolves the real 'solid'/'pattern' shape, including a genuine two-colour blend (ExaDev/documents.js#1024), so this just passes it through.
  const background =
    attributes.background === undefined
      ? {}
      : { background: attributes.background };
  if (attributes.covered) {
    if (blocks.length > 0) {
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.CoveredCellContentDropped,
        "A table cell covered by a neighbouring cell's merge held content of its own, which was not carried: a merged region's content belongs to the cell that anchors it.",
      );
    }
    table.cells.push({ blocks: [], ...background });
    return;
  }
  // A cell states its own justification ("bit 1: 1 = use cell justification"), and the shared schema carries alignment on the paragraph rather than the cell, so the cell's statement lands on the paragraphs it holds, overriding the document-level justification they were built with. A cell whose flag leaves justification inherited states nothing, and its paragraphs keep what they had.
  if (attributes.alignment !== undefined) {
    for (const block of blocks) {
      if (block.kind === "paragraph") {
        block.alignment = attributes.alignment;
      }
    }
  }
  const cell: ContentTableCell = {
    blocks,
    ...(attributes.columnSpan > NO_SPAN
      ? { colSpan: attributes.columnSpan }
      : {}),
    ...(attributes.rowSpan > NO_SPAN ? { rowSpan: attributes.rowSpan } : {}),
    ...background,
    ...(attributes.formula === undefined
      ? {}
      : { formula: attributes.formula }),
  };
  table.cells.push(cell);
}

export function closeRow(table: TableState): void {
  if (table.cells.length === 0) {
    return;
  }
  const row: ContentTableRow = {
    cells: table.cells,
    ...(table.rowHeightPt === undefined ? {} : { heightPt: table.rowHeightPt }),
    ...(table.rowIsHeader ? { isHeader: true } : {}),
  };
  table.cells = [];
  table.rowHeightPt = undefined;
  table.rowIsHeader = false;
  table.rows.push(row);
}

// Closes the table and appends it to whatever block list encloses it. A table with no rows at all, a definition the document never filled, is dropped rather than emitted as an empty grid.
export function closeTable(state: ReaderState): void {
  const table = state.table;
  if (table === undefined) {
    return;
  }
  state.table = undefined;
  if (table.rows.length === 0) {
    return;
  }
  targetBlocks(state).push({
    kind: "table",
    // Every cell the stream states holds its own grid position, in order, so a row's cell index is its grid column; a row the stream leaves short of the defined grid is filled out with block-less entries, since the shared schema's grid rule requires every row to be as long as the table's own columns array.
    rows: denseTableRows(
      table.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell, columnIndex) => ({ columnIndex, cell })),
      })),
      table.columnWidthsPt.length,
    ),
    columns: table.columnWidthsPt.map((widthPt) => ({ widthPt })),
  });
}
