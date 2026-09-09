import type {
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetPrintSettings,
  ContentSheetRow,
} from "document-schema.js";
import { XlsCell } from "./cell";

// BIFF8's own grid ceiling: 65536 rows and 256 columns ([MS-XLS]'s Dimensions record is 16-bit row / 8-bit column). xls-codec's writer refuses a grid outside it outright; cell() refuses the same here so the edit fails at the editing surface, not at save time.
const BIFF8_MAX_ROWS = 65536;
const BIFF8_MAX_COLUMNS = 256;

// A live view over one ContentSheet object inside the editor's own sheets array. The surface mirrors OdsSheet's (name, printSettings, per-axis sizing/hidden, cell addressing) with two model-driven differences: the cells array is the schema's own sparse by-position array (a cell at (500, 50) costs one entry, not a materialised grid), and printSettings is a plain required field rather than a style-minting setter (there is no style chain under a ContentDocument -- xls-codec's writer consumes ContentSheetPrintSettings directly).
export class XlsSheet {
  private readonly container: ContentSheet[];
  private readonly node: ContentSheet;
  private removed = false;

  constructor(container: ContentSheet[], node: ContentSheet) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentSheet {
    if (this.removed) {
      throw new Error(
        "this XlsSheet has been removed from its workbook and can no longer be used",
      );
    }
    return this.node;
  }

  get name(): string {
    return this.live().name;
  }

  set name(value: string) {
    this.live().name = value;
  }

  get printSettings(): ContentSheetPrintSettings {
    return this.live().printSettings;
  }

  set printSettings(value: ContentSheetPrintSettings) {
    this.live().printSettings = value;
  }

  // The sheet's sparse cells, re-read on every call (the live-view contract -- a caller holding an earlier array sees later edits only through a fresh call).
  cells(): XlsCell[] {
    return this.live().cells.map(
      (cell) => new XlsCell(this.live().cells, cell),
    );
  }

  // The per-axis geometry entries, as the schema's own sparse arrays (an entry exists only for a column or row carrying a size or hidden flag). Read views over live nodes: mutating the returned objects edits the sheet, the same live-view contract every accessor here follows.
  columns(): ContentSheet["columns"] {
    return this.live().columns;
  }

  rows(): ContentSheet["rows"] {
    return this.live().rows;
  }

  // Finds the cell at (row, column), creating an empty one when none exists yet -- the find-or-create counterpart of OdsSheet.cell's materialise-on-demand, but one array entry rather than a split repeated run. Coordinates are 0-based.
  cell(row: number, column: number): XlsCell {
    if (row < 0 || row >= BIFF8_MAX_ROWS) {
      throw new Error(
        `row ${row} is outside BIFF8's 0..${BIFF8_MAX_ROWS - 1} row range`,
      );
    }
    if (column < 0 || column >= BIFF8_MAX_COLUMNS) {
      throw new Error(
        `column ${column} is outside BIFF8's 0..${BIFF8_MAX_COLUMNS - 1} column range`,
      );
    }
    const cells = this.live().cells;
    const existing = cells.find(
      (cell) => cell.row === row && cell.column === column,
    );
    if (existing !== undefined) {
      return new XlsCell(cells, existing);
    }
    const node: ContentSheetCell = {
      row,
      column,
      value: { kind: "empty" },
      displayText: "",
    };
    cells.push(node);
    return new XlsCell(cells, node);
  }

  setColumnWidth(index: number, widthPt: number): void {
    this.columnEntry(index).widthPt = widthPt;
  }

  setColumnHidden(index: number, hidden: boolean): void {
    this.columnEntry(index).hidden = hidden;
  }

  setRowHeight(index: number, heightPt: number): void {
    this.rowEntry(index).heightPt = heightPt;
  }

  setRowHidden(index: number, hidden: boolean): void {
    this.rowEntry(index).hidden = hidden;
  }

  private columnEntry(index: number): ContentSheetColumn {
    const entry = this.live().columns.find((column) => column.index === index);
    if (entry !== undefined) {
      return entry;
    }
    const fresh: ContentSheetColumn = { index };
    this.live().columns.push(fresh);
    return fresh;
  }

  private rowEntry(index: number): ContentSheetRow {
    const entry = this.live().rows.find((row) => row.index === index);
    if (entry !== undefined) {
      return entry;
    }
    const fresh: ContentSheetRow = { index };
    this.live().rows.push(fresh);
    return fresh;
  }

  remove(): void {
    // A workbook with no sheet at all has nothing for BoundSheet8 to name -- refuse here rather than at write time, mirroring DocSection.remove's own last-one guard.
    if (this.container.length === 1) {
      throw new Error(
        "an xls workbook must carry at least one sheet; the last one cannot be removed",
      );
    }
    const index = this.container.indexOf(this.node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}
