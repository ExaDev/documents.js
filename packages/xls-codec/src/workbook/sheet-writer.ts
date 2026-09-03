import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetRow,
} from "document-schema.js";

import { writeBofData } from "../biff/bof-writer";
import { RecordBuilder } from "../biff/builder";
import { errorCodeOf } from "../biff/errors";
import {
  BOF_TYPE_WORKSHEET,
  RECORD_BOF,
  RECORD_BOOLERR,
  RECORD_COLINFO,
  RECORD_DIMENSIONS,
  RECORD_EOF,
  RECORD_LABELSST,
  RECORD_MERGECELLS,
  RECORD_NUMBER,
  RECORD_ROW,
} from "../biff/record-types";
import { concatRecords, writeRecord } from "../biff/record-writer";
import { BiffWriteError } from "../biff/write-errors";
import {
  isoDateTimeToSerial,
  isoDateToSerial,
  isoTimeToSerial,
} from "../serial";
import { pointsToColumnWidth, pointsToTwips } from "../units";
import { GENERAL_CELL_XF_INDEX } from "./globals-writer";

// The worksheet substream ([MS-XLS] 2.1.7.20.5), write side: the grid geometry and cell table for one sheet, the counterpart of workbook/sheet.ts's own readSheetRecords. See xls-codec's README for exactly which worksheet-substream records this writer emits (Dimensions, ColInfo, Row, the value-cell family, MergeCells) and which it deliberately omits (Window2, the calc-state/print-settings record family, Index/DBCell) -- real content, not per-window UI state or a lookup optimisation this reader (or any reader) does not require to find a cell.
//
// A blank cell -- ContentCellValue's own 'empty' kind -- is never written as a Blank record: content.ts's own mapCell drops every blank cell it reads (see its own comment), and applyMerges independently reconstructs an empty anchor for a merged range from the MergeCells record alone. Writing nothing for an 'empty' cell is therefore not a gap; it is what round-trips back to the identical read, and it is why this writer implements no Blank/MulBlank/RK/MulRk records at all -- RK and the Mul* runs are pure compaction optimisations over the same information a plain Number/LabelSst/BoolErr record already carries losslessly.

/** BIFF8's own 16-bit row index and 8-bit column index ceilings ([MS-XLS] 2.4.221's Rw structure and 2.4.53's Col256U structure): 65536 rows (0-65535), 256 columns (0-255) -- unlike xlsx's much larger grid. A cell outside this range cannot be expressed in BIFF8 at all, so it is refused rather than silently truncated into a wrapped index. */
const MAX_ROW_INDEX = 0xffff;
const MAX_COLUMN_INDEX = 0xff;

/** Excel 97-2003's own classic default row height (12.75pt) and default column width (in coldx units), used for a row/column this writer emits a record for but that carries no explicit size of its own -- a row with only `hidden` declared, or a ColInfo entry with no `widthPt`. */
const DEFAULT_ROW_HEIGHT_TWIPS = 255;
const DEFAULT_COLUMN_WIDTH_UNITS = 2340;

/** [MS-XLS] 2.4.221's own Row.reserved3: "MUST be 1, and MUST be ignored." */
const ROW_RESERVED3 = 1;

const ROW_FLAG_HIDDEN_BIT = 5;
const ROW_FLAG_UNSYNCED_BIT = 6;
const COLINFO_FLAG_HIDDEN = 0x0001;

export interface SheetWriteContext {
  /** The formatId ([MS-XLS] Format/XF's own ifmt) a cell's numberFormatCode (or, when absent, a representative default for its value kind) resolves to. */
  formatIdForCell(cell: ContentSheetCell): number;
  /** The XF index ([MS-XLS] 2.5.168 IXFCell) carrying the given formatId -- GENERAL_CELL_XF_INDEX for formatId 0, one of the workbook's other cell XFs otherwise. */
  xfIndexForFormatId(formatId: number): number;
  /** The shared string table index for a string cell's own text; every string a sheet writes must already be registered in the workbook-wide table before this is called. */
  sstIndexFor(text: string): number;
}

function checkedCellPosition(cell: ContentSheetCell): void {
  if (cell.row > MAX_ROW_INDEX || cell.column > MAX_COLUMN_INDEX) {
    throw new BiffWriteError(
      `cell at row ${cell.row}, column ${cell.column} is outside BIFF8's own grid (rows 0-${MAX_ROW_INDEX}, columns 0-${MAX_COLUMN_INDEX}); a .xls workbook cannot address it`,
    );
  }
}

/** The smallest and largest of a number list (undefined for an empty one), computed by a single reduce pass rather than `Math.min(...values)`/`Math.max(...values)` -- a spread call over a large cell/row list would risk the same argument-count ceiling biff/strings.ts's own readCharacters comment notes for String.fromCharCode. Folded through `reduce` rather than indexed (`values[0]`) so the accumulator's own null-check is what narrows the running min/max, never an assertion that the array is non-empty. */
function minMax(
  values: readonly number[],
): { min: number; max: number } | undefined {
  return values.reduce<{ min: number; max: number } | undefined>(
    (running, value) =>
      running === undefined
        ? { min: value, max: value }
        : {
            min: Math.min(running.min, value),
            max: Math.max(running.max, value),
          },
    undefined,
  );
}

/** Dimensions ([MS-XLS] 2.4.90): the sheet's used range, derived from the cells this writer actually emits a value record for -- 'empty'-kind cells carry no value and so contribute nothing to the used range, matching how a real producer's own used range excludes a cell with neither data nor direct formatting. */
function writeDimensionsRecord(
  writtenCells: readonly ContentSheetCell[],
): Uint8Array<ArrayBuffer> {
  const rows = minMax(writtenCells.map((cell) => cell.row));
  const columns = minMax(writtenCells.map((cell) => cell.column));
  const rwMic = rows?.min ?? 0;
  const rwMac = rows === undefined ? 0 : rows.max + 1;
  const colMic = columns?.min ?? 0;
  const colMac = columns === undefined ? 0 : columns.max + 1;
  const data = new RecordBuilder()
    .u32(rwMic)
    .u32(rwMac)
    .u16(colMic)
    .u16(colMac)
    .u16(0) // reserved
    .build();
  return writeRecord(RECORD_DIMENSIONS, data);
}

/** ColInfo ([MS-XLS] 2.4.53): one record per input column entry, covering exactly that one column (colFirst === colLast) rather than merging adjacent same-width columns into a range -- both are legal, and workbook/sheet.ts's own readColInfo expands either shape back into one RawColumn per column, so the two round-trip identically. */
function writeColInfoRecord(
  column: ContentSheetColumn,
): Uint8Array<ArrayBuffer> {
  if (column.index > MAX_COLUMN_INDEX) {
    throw new BiffWriteError(
      `column ${column.index} is outside BIFF8's own 256-column grid (columns 0-${MAX_COLUMN_INDEX})`,
    );
  }
  const coldx =
    column.widthPt !== undefined
      ? pointsToColumnWidth(column.widthPt)
      : DEFAULT_COLUMN_WIDTH_UNITS;
  const flags = column.hidden === true ? COLINFO_FLAG_HIDDEN : 0;
  const data = new RecordBuilder()
    .u16(column.index)
    .u16(column.index)
    .u16(coldx)
    .u16(GENERAL_CELL_XF_INDEX)
    .u16(flags)
    .u16(0) // unused2
    .build();
  return writeRecord(RECORD_COLINFO, data);
}

/** Row ([MS-XLS] 2.4.221): the row's own populated-column range (from its cells, not the sheet's own Dimensions), height, and hidden/manually-set flags. */
function writeRowRecord(
  rowIndex: number,
  cellsInRow: readonly ContentSheetCell[],
  declared: ContentSheetRow | undefined,
): Uint8Array<ArrayBuffer> {
  const columnRange = minMax(cellsInRow.map((cell) => cell.column));
  const colMic = columnRange?.min ?? 0;
  const colMac = columnRange === undefined ? 0 : columnRange.max + 1;
  const heightTwips =
    declared?.heightPt !== undefined
      ? pointsToTwips(declared.heightPt)
      : DEFAULT_ROW_HEIGHT_TWIPS;
  const fDyZero = declared?.hidden === true ? 1 : 0;
  const fUnsynced = declared?.heightPt !== undefined ? 1 : 0;
  const flagsByte =
    (fDyZero << ROW_FLAG_HIDDEN_BIT) | (fUnsynced << ROW_FLAG_UNSYNCED_BIT);
  const data = new RecordBuilder()
    .u16(rowIndex)
    .u16(colMic)
    .u16(colMac)
    .u16(heightTwips)
    .u16(0) // reserved1
    .u16(0) // unused1
    .u8(flagsByte)
    .u8(ROW_RESERVED3)
    .u16(0) // ixfe_val (undefined: fGhostDirty is clear) | fExAsc | fExDes | fPhonetic | unused2, all 0
    .build();
  return writeRecord(RECORD_ROW, data);
}

interface MergeRange {
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}

/** Every merged range the sheet's own cells declare via colSpan/rowSpan, regardless of whether the anchor cell carries a value -- an 'empty'-kind anchor still merges, and content.ts's own applyMerges reconstructs it independently from the MergeCells record this produces. */
function mergedRangesOf(cells: readonly ContentSheetCell[]): MergeRange[] {
  const ranges: MergeRange[] = [];
  for (const cell of cells) {
    const rowSpan = cell.rowSpan ?? 1;
    const colSpan = cell.colSpan ?? 1;
    if (rowSpan > 1 || colSpan > 1) {
      ranges.push({
        startRow: cell.row,
        startColumn: cell.column,
        endRow: cell.row + rowSpan - 1,
        endColumn: cell.column + colSpan - 1,
      });
    }
  }
  return ranges;
}

/** MergeCells ([MS-XLS] 2.4.168): a count then that many Ref8 structures ([MS-XLS] 2.5.208), each rowFirst/rowLast/colFirst/colLast -- the order workbook/sheet.ts's own readMergeCells reads them in. */
function writeMergeCellsRecord(
  ranges: readonly MergeRange[],
): Uint8Array<ArrayBuffer> {
  const builder = new RecordBuilder().u16(ranges.length);
  for (const range of ranges) {
    builder
      .u16(range.startRow)
      .u16(range.endRow)
      .u16(range.startColumn)
      .u16(range.endColumn);
  }
  return writeRecord(RECORD_MERGECELLS, builder.build());
}

function cellHeader(cell: ContentSheetCell, xfIndex: number): RecordBuilder {
  return new RecordBuilder().u16(cell.row).u16(cell.column).u16(xfIndex);
}

/** One value-cell record, keyed by ContentCellValue's own discriminant: Number for every numeric/temporal kind ([MS-XLS] 2.4.180 -- always the full IEEE 754 double, never the packed RK encoding, which is a compaction optimisation this writer does not implement), LabelSst for a string ([MS-XLS] 2.4.149, through the workbook-wide shared string table), BoolErr for a boolean or error value ([MS-XLS] 2.4.24). 'empty' never reaches here -- the caller filters it out before this is called, since an empty cell has no value record to write at all (see this module's own top comment). */
function writeCellValueRecord(
  cell: ContentSheetCell,
  xfIndex: number,
  ctx: SheetWriteContext,
): Uint8Array<ArrayBuffer> {
  const value: ContentCellValue = cell.value;
  switch (value.kind) {
    case "number":
    case "percentage":
    case "currency":
      return writeRecord(
        RECORD_NUMBER,
        cellHeader(cell, xfIndex).f64(value.value).build(),
      );
    case "date":
      return writeRecord(
        RECORD_NUMBER,
        cellHeader(cell, xfIndex)
          .f64(isoDateToSerial(value.value, false))
          .build(),
      );
    case "time":
      return writeRecord(
        RECORD_NUMBER,
        cellHeader(cell, xfIndex).f64(isoTimeToSerial(value.value)).build(),
      );
    case "dateTime":
      return writeRecord(
        RECORD_NUMBER,
        cellHeader(cell, xfIndex)
          .f64(isoDateTimeToSerial(value.value, false))
          .build(),
      );
    case "string": {
      const index = ctx.sstIndexFor(value.value);
      return writeRecord(
        RECORD_LABELSST,
        cellHeader(cell, xfIndex).u32(index).build(),
      );
    }
    case "boolean":
      return writeRecord(
        RECORD_BOOLERR,
        cellHeader(cell, xfIndex)
          .u8(value.value ? 1 : 0)
          .u8(0)
          .build(),
      );
    case "error": {
      const code = errorCodeOf(value.value);
      if (code === undefined) {
        throw new BiffWriteError(
          `cell at row ${cell.row}, column ${cell.column} carries error text ${JSON.stringify(value.value)}, which is not one of the eight error values [MS-XLS] 2.5.10 defines`,
        );
      }
      return writeRecord(
        RECORD_BOOLERR,
        cellHeader(cell, xfIndex).u8(code).u8(1).build(),
      );
    }
    case "empty":
      throw new BiffWriteError(
        "writeCellValueRecord was called for an 'empty' cell, which the caller must filter out before reaching here",
      );
  }
}

/** Builds one worksheet's own substream: BOF, Dimensions, ColInfo per column, Row + value-cell records per populated or declared row (in ascending row then column order), MergeCells if the sheet declares any, EOF. */
export function buildWorksheetSubstream(
  sheet: ContentSheet,
  ctx: SheetWriteContext,
): Uint8Array<ArrayBuffer> {
  for (const cell of sheet.cells) {
    checkedCellPosition(cell);
  }

  const writtenCells = sheet.cells.filter(
    (cell) => cell.value.kind !== "empty",
  );

  const cellsByRow = new Map<number, ContentSheetCell[]>();
  for (const cell of writtenCells) {
    const existing = cellsByRow.get(cell.row);
    if (existing === undefined) {
      cellsByRow.set(cell.row, [cell]);
    } else {
      existing.push(cell);
    }
  }
  for (const cells of cellsByRow.values()) {
    cells.sort((a, b) => a.column - b.column);
  }

  const declaredRows = new Map(sheet.rows.map((row) => [row.index, row]));
  const rowIndices = new Set<number>([
    ...cellsByRow.keys(),
    ...declaredRows.keys(),
  ]);
  const sortedRowIndices = [...rowIndices].sort((a, b) => a - b);

  const pieces: Uint8Array<ArrayBuffer>[] = [
    writeRecord(RECORD_BOF, writeBofData(BOF_TYPE_WORKSHEET)),
    writeDimensionsRecord(writtenCells),
  ];

  for (const column of sheet.columns) {
    pieces.push(writeColInfoRecord(column));
  }

  for (const rowIndex of sortedRowIndices) {
    const cellsInRow = cellsByRow.get(rowIndex) ?? [];
    pieces.push(
      writeRowRecord(rowIndex, cellsInRow, declaredRows.get(rowIndex)),
    );
    for (const cell of cellsInRow) {
      const formatId = ctx.formatIdForCell(cell);
      const xfIndex = ctx.xfIndexForFormatId(formatId);
      pieces.push(writeCellValueRecord(cell, xfIndex, ctx));
    }
  }

  const merges = mergedRangesOf(sheet.cells);
  if (merges.length > 0) {
    pieces.push(writeMergeCellsRecord(merges));
  }

  pieces.push(writeRecord(RECORD_EOF, new Uint8Array(0)));

  return concatRecords(...pieces);
}
