import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetPrintSettings,
  ContentSheetRow,
} from "document-schema.js";

import { writeBofData } from "../biff/bof-writer";
import { RecordBuilder } from "../biff/builder";
import { errorCodeOf } from "../biff/errors";
import {
  packSetupFlags,
  paperSelectionFor,
  WSBOOL_FLAG_FIT_TO_PAGE,
  type SetupFields,
} from "../biff/print-setup";
import {
  BOF_TYPE_WORKSHEET,
  RECORD_BLANK,
  RECORD_BOF,
  RECORD_BOOLERR,
  RECORD_BOTTOMMARGIN,
  RECORD_CALCCOUNT,
  RECORD_CALCDELTA,
  RECORD_CALCITER,
  RECORD_CALCREFMODE,
  RECORD_CALCSAVERECALC,
  RECORD_COLINFO,
  RECORD_DIMENSIONS,
  RECORD_EOF,
  RECORD_HORIZONTALPAGEBREAKS,
  RECORD_LABELSST,
  RECORD_LEFTMARGIN,
  RECORD_MERGECELLS,
  RECORD_NUMBER,
  RECORD_PRINTGRID,
  RECORD_PRINTROWCOL,
  RECORD_RIGHTMARGIN,
  RECORD_ROW,
  RECORD_SETUP,
  RECORD_TOPMARGIN,
  RECORD_VERTICALPAGEBREAKS,
  RECORD_WSBOOL,
} from "../biff/record-types";
import { concatRecords, writeRecord } from "../biff/record-writer";
import { BiffWriteError } from "../biff/write-errors";
import {
  isoDateTimeToSerial,
  isoDateToSerial,
  isoTimeToSerial,
} from "../serial";
import { pointsToColumnWidth, pointsToInches, pointsToTwips } from "../units";
import { cellCarriesDecoration, writesCellRecord } from "../written-cells";
import { GENERAL_CELL_XF_INDEX } from "./globals-writer";

// The worksheet substream ([MS-XLS] 2.1.7.20.5), write side: the page setup, grid geometry, and cell table for one sheet, the counterpart of workbook/sheet.ts's own readSheetRecords. See xls-codec's README for exactly which worksheet-substream records this writer emits (the print-settings group, Dimensions, ColInfo, Row, the value-cell family, MergeCells) and which it deliberately omits (Window2, the calc-state family, Index/DBCell) -- real content, not per-window UI state or a lookup optimisation this reader (or any reader) does not require to find a cell.
//
// A blank cell -- ContentCellValue's own 'empty' kind -- splits in two. One carrying no decoration is written as nothing at all, which is what round-trips: content.ts's mapCell drops an undecorated blank it reads, and applyMerges reconstructs an empty anchor for a merged range from the MergeCells record alone. One carrying a background or a border is a Blank record ([MS-XLS] 2.4.20), because its decoration exists only in the XF that record's ixfe names and there is no other record in the sheet to hang it on. written-cells.ts holds the predicate deciding which, shared with write.ts's own workbook-wide scans so the two cannot disagree.
//
// MulBlank, RK, and MulRk stay unimplemented: unlike Blank, each is a pure compaction optimisation over information a plain Blank/Number record already carries losslessly.

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
  /** The XF index ([MS-XLS] 2.5.168 IXFCell) a cell's own (number format, decoration) combination resolves to -- GENERAL_CELL_XF_INDEX for a cell with General formatting and no background/borders, one of the workbook's other cell XFs otherwise. write.ts's own cell-format interning pass is what assigns and deduplicates these. */
  xfIndexForCell(cell: ContentSheetCell): number;
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

/** Dimensions ([MS-XLS] 2.4.90): the sheet's used range, derived from exactly the cells this writer emits a record for -- so a decorated empty cell counts (a real producer's used range covers a cell carrying direct formatting) while an undecorated one, having neither data nor formatting, does not. */
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

// --- Print settings ---

/** CalcCount's own cIter ([MS-XLS] 2.4.31): "MUST be greater than or equal to one and less than or equal to 32767". Excel's own default iteration limit, and what a real LibreOffice-written BIFF8 carries. */
const CALC_ITERATION_LIMIT = 100;
/** CalcDelta's own numDelta ([MS-XLS] 2.4.32): Excel's own default minimum change for iterative calculation to continue. */
const CALC_ITERATION_DELTA = 0.001;

/**
 * The calculation-state records [MS-XLS] 2.1.7.20.6's GLOBALS production requires ahead of PrintRowCol, none of which carries anything document-schema.js models.
 *
 * They are written for two reasons, one of them empirical. The grammar makes them mandatory -- `GLOBALS = CalcMode CalcCount CalcRefMode CalcIter CalcDelta CalcSaveRecalc PrintRowCol PrintGrid GridSet Guts DefaultRowHeight WsBool ...`, with no brackets on any of them -- so a substream that opens straight with a print setting is not a conformant worksheet at all. And LibreOffice's own BIFF8 importer silently discards whichever page-settings record comes FIRST in a worksheet substream: with PrintRowCol in that slot, a `.xls` this writer produced with row and column headers enabled opened in LibreOffice with them off, while every other print setting in the same file came through correctly. Moving any other record into that slot fixes it, which is what these do -- verified by writing the same workbook with and without them and re-reading each through `soffice --convert-to fods`.
 *
 * The values are Excel's own defaults (automatic recalculation, A1 references, iteration off), matching what a real LibreOffice-written file carries for a workbook nobody has changed the calculation settings of. CalcMode is deliberately not among them: the production names it, but LibreOffice does not write one into a worksheet substream either, and the records below already satisfy the constraint this comment exists for.
 */
function writeCalculationStateRecords(): Uint8Array<ArrayBuffer>[] {
  return [
    writeRecord(
      RECORD_CALCCOUNT,
      new RecordBuilder().u16(CALC_ITERATION_LIMIT).build(),
    ),
    // fRefA1 ([MS-XLS] 2.4.36): 1 is A1 reference style, which is what biff/ptg.ts's own formula-text reader assumes when it rebuilds a reference.
    writeRecord(RECORD_CALCREFMODE, new RecordBuilder().u16(1).build()),
    // vfIter ([MS-XLS] 2.4.33): iterative calculation disabled.
    writeRecord(RECORD_CALCITER, new RecordBuilder().u16(0).build()),
    writeRecord(
      RECORD_CALCDELTA,
      new RecordBuilder().f64(CALC_ITERATION_DELTA).build(),
    ),
    // fSaveRecalc ([MS-XLS] 2.4.37): recalculate before saving, Excel's own default.
    writeRecord(RECORD_CALCSAVERECALC, new RecordBuilder().u16(1).build()),
  ];
}

/** Setup's own iRes/iVRes ([MS-XLS] 2.4.257), a printer resolution in DPI. 300 is what a real LibreOffice-written BIFF8 carries and a sane default for a writer with no printer to ask; the field is undefined whenever fNoPls is set, which this writer never sets, so it must carry something real. */
const SETUP_PRINT_RESOLUTION_DPI = 300;
/** Setup's own iCopies: one copy, the only sensible value for a file that is not being sent to a printer right now. */
const SETUP_COPIES = 1;
/** Setup's own numHdr/numFtr ([MS-XLS] 2.4.257), the header and footer margins in inches. Excel's own Normal preset value; Margins has no header/footer field for a real one to come from, and content.ts's read side discards these for the same reason. */
const SETUP_HEADER_FOOTER_MARGIN_INCHES = 0.3;
/** Setup's own iFitWidth/iFitHeight when the sheet is not in fit-to-page mode at all. Written rather than left at 0 because 0 means "as many pages as necessary" -- a real value a reader must not see while fFitToPage is clear and mistake for an intent the sheet never had. */
const SETUP_INACTIVE_FIT_PAGES = 1;
/** Setup's own iScale when the sheet IS in fit-to-page mode: 100%, actual size, the inactive value a real producer leaves behind (confirmed against LibreOffice-written BIFF8, whose fit-to-page sheets carry exactly this). */
const SETUP_INACTIVE_SCALE_PERCENT = 100;

/**
 * Setup ([MS-XLS] 2.4.257): iPaperSize, iScale, iPageStart, iFitWidth, iFitHeight, the flags word, iRes, iVRes, numHdr, numFtr, iCopies.
 *
 * fNoPls is deliberately never set. It would declare this record's own paper size, scale, and orientation undefined -- exactly the three fields it exists here to carry -- and [MS-XLS] pairs it with a Pls record holding a printer driver's DEVMODE blob, which this writer has none of.
 */
function writeSetupRecord(
  settings: ContentSheetPrintSettings,
): Uint8Array<ArrayBuffer> {
  const paper = paperSelectionFor(settings.pageSize);
  if (paper === undefined) {
    throw new BiffWriteError(
      `sheet page size ${settings.pageSize.widthPt} x ${settings.pageSize.heightPt} pt is not one of the paper sizes [MS-XLS] 2.4.257's own iPaperSize code table names, and a Setup record can address paper only by code; a .xls cannot state this page size`,
    );
  }
  const fitToPages = settings.fitToPages;
  const fields: SetupFields = {
    paperCode: paper.code,
    scalePercent:
      fitToPages === undefined
        ? Math.round(settings.scalePercent ?? SETUP_INACTIVE_SCALE_PERCENT)
        : SETUP_INACTIVE_SCALE_PERCENT,
    fitWidth: fitToPages?.width ?? SETUP_INACTIVE_FIT_PAGES,
    fitHeight: fitToPages?.height ?? SETUP_INACTIVE_FIT_PAGES,
    leftToRight: settings.pageOrder === "overThenDown",
    portrait: paper.portrait,
    noPls: false,
    // fNoOrient clear, so fPortrait above is what selects the orientation -- setting it would make [MS-XLS] 2.4.257's own "Pages are printed using portrait mode" override it and silently lose every landscape page.
    noOrientation: false,
  };
  const data = new RecordBuilder()
    .u16(fields.paperCode)
    .u16(fields.scalePercent)
    .u16(0) // iPageStart: ignored, since fUsePage is clear
    .u16(fields.fitWidth)
    .u16(fields.fitHeight)
    .u16(packSetupFlags(fields))
    .u16(SETUP_PRINT_RESOLUTION_DPI)
    .u16(SETUP_PRINT_RESOLUTION_DPI)
    .f64(SETUP_HEADER_FOOTER_MARGIN_INCHES)
    .f64(SETUP_HEADER_FOOTER_MARGIN_INCHES)
    .u16(SETUP_COPIES)
    .build();
  return writeRecord(RECORD_SETUP, data);
}

/** Any of the four margin records ([MS-XLS] 2.4.151, 2.4.219, 2.4.328, 2.4.27): a single Xnum stating that margin in inches. All four share one field layout, so one writer serves them all -- the mirror of workbook/sheet.ts's own single readMargin. */
function writeMarginRecord(
  recordType: number,
  points: number,
): Uint8Array<ArrayBuffer> {
  return writeRecord(
    recordType,
    new RecordBuilder().f64(pointsToInches(points)).build(),
  );
}

/** PrintGrid ([MS-XLS] 2.4.202) and PrintRowCol ([MS-XLS] 2.4.203), each a single 16-bit boolean. */
function writeBooleanRecord(
  recordType: number,
  value: boolean,
): Uint8Array<ArrayBuffer> {
  return writeRecord(
    recordType,
    new RecordBuilder().u16(value ? 1 : 0).build(),
  );
}

/** WsBool ([MS-XLS] 2.4.351). Only fFitToPage is set from real data; every other bit is written clear, which is what a sheet with no outline, no dialog behaviour, no synchronised scrolling, and no transition formula handling means -- and is exactly the set of facts ContentSheet carries nothing about. */
function writeWsBoolRecord(fitToPage: boolean): Uint8Array<ArrayBuffer> {
  return writeRecord(
    RECORD_WSBOOL,
    new RecordBuilder().u16(fitToPage ? WSBOOL_FLAG_FIT_TO_PAGE : 0).build(),
  );
}

/**
 * HorizontalPageBreaks ([MS-XLS] 2.4.142) or VerticalPageBreaks ([MS-XLS] 2.4.343): a count then that many six-byte structures, each the break's own index followed by the start and end of its extent along the other axis.
 *
 * Both structures share that three-field shape, so one writer serves both -- the extent's own end differs, which is what `extentEnd` carries: ContentSheetPrintSettings models a break as a whole-axis index with no extent, so every break written here runs the full width or height of BIFF8's own grid. Written in ascending index order, which is the sort [MS-XLS] requires of both arrays; the caller's own indices are sorted first rather than assumed sorted.
 */
function writePageBreaksRecord(
  recordType: number,
  indices: readonly number[],
  extentEnd: number,
): Uint8Array<ArrayBuffer> {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const builder = new RecordBuilder().u16(sorted.length);
  for (const index of sorted) {
    builder.u16(index).u16(0).u16(extentEnd);
  }
  return writeRecord(recordType, builder.build());
}

/**
 * Every print-settings record one sheet needs, in [MS-XLS] 2.1.7.20.6's own order.
 *
 * That order is two productions, back to back, both of which the worksheet substream places ahead of COLUMNS, Dimensions, and the cell table: `GLOBALS = ... PrintRowCol PrintGrid GridSet Guts DefaultRowHeight WsBool [Sync] [LPr] [HorizontalPageBreaks] [VerticalPageBreaks]` and `PAGESETUP = Header Footer HCenter VCenter [LeftMargin] [RightMargin] [TopMargin] [BottomMargin] [Pls *Continue] [Setup]`. The mandatory records this writer does not emit at all (the calculation-state family, GridSet, Guts, DefaultRowHeight, Header/Footer, HCenter/VCenter) are the same UI and interoperability bookkeeping it already omits everywhere else -- see this package's README -- so what remains is the optional subset that actually carries print settings, in the relative order those two productions give it.
 *
 * Every record here is written unconditionally, including for a sheet whose settings are exactly the Normal preset. A print setting has no "absent" spelling in ContentSheetPrintSettings -- gridlines, headers, page order, page size, and all four margins are required fields -- so there is no way to tell a sheet that asked for the preset from one that never stated anything, and writing the values out is what makes the round trip exact either way.
 */
function writePrintSettingsRecords(
  settings: ContentSheetPrintSettings,
): Uint8Array<ArrayBuffer>[] {
  const pieces: Uint8Array<ArrayBuffer>[] = [
    ...writeCalculationStateRecords(),
    writeBooleanRecord(RECORD_PRINTROWCOL, settings.headers),
    writeBooleanRecord(RECORD_PRINTGRID, settings.gridlines),
    writeWsBoolRecord(settings.fitToPages !== undefined),
  ];
  const breaks = settings.manualBreaks;
  if (breaks !== undefined && breaks.rows.length > 0) {
    pieces.push(
      // A row break's extent runs across every column of the sheet, so its end is the grid's own last column.
      writePageBreaksRecord(
        RECORD_HORIZONTALPAGEBREAKS,
        breaks.rows,
        MAX_COLUMN_INDEX,
      ),
    );
  }
  if (breaks !== undefined && breaks.columns.length > 0) {
    pieces.push(
      // A column break's extent runs down every row, so its end is the grid's own last row.
      writePageBreaksRecord(
        RECORD_VERTICALPAGEBREAKS,
        breaks.columns,
        MAX_ROW_INDEX,
      ),
    );
  }
  pieces.push(
    writeMarginRecord(RECORD_LEFTMARGIN, settings.margins.leftPt),
    writeMarginRecord(RECORD_RIGHTMARGIN, settings.margins.rightPt),
    writeMarginRecord(RECORD_TOPMARGIN, settings.margins.topPt),
    writeMarginRecord(RECORD_BOTTOMMARGIN, settings.margins.bottomPt),
    writeSetupRecord(settings),
  );
  return pieces;
}

function cellHeader(cell: ContentSheetCell, xfIndex: number): RecordBuilder {
  return new RecordBuilder().u16(cell.row).u16(cell.column).u16(xfIndex);
}

/** One cell record, keyed by ContentCellValue's own discriminant: Number for every numeric/temporal kind ([MS-XLS] 2.4.180 -- always the full IEEE 754 double, never the packed RK encoding, which is a compaction optimisation this writer does not implement), LabelSst for a string ([MS-XLS] 2.4.149, through the workbook-wide shared string table), BoolErr for a boolean or error value ([MS-XLS] 2.4.24), and Blank for an 'empty' cell whose decoration is the only thing it carries ([MS-XLS] 2.4.20 -- a cell header and nothing else, so the XF its ixfe names is the whole content). An undecorated empty cell never reaches here at all: written-cells.ts's own predicate filters it out upstream, since there is nothing for it to say. */
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
      if (!cellCarriesDecoration(cell)) {
        throw new BiffWriteError(
          `internal error: writeCellValueRecord was called for the undecorated empty cell at row ${cell.row}, column ${cell.column}, which written-cells.ts's own predicate must filter out before reaching here`,
        );
      }
      return writeRecord(RECORD_BLANK, cellHeader(cell, xfIndex).build());
  }
}

/** Builds one worksheet's own substream: BOF, the print-settings records, Dimensions, ColInfo per column, Row + value-cell records per populated or declared row (in ascending row then column order), MergeCells if the sheet declares any, EOF. */
export function buildWorksheetSubstream(
  sheet: ContentSheet,
  ctx: SheetWriteContext,
): Uint8Array<ArrayBuffer> {
  for (const cell of sheet.cells) {
    checkedCellPosition(cell);
  }

  const writtenCells = sheet.cells.filter(writesCellRecord);

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
    ...writePrintSettingsRecords(sheet.printSettings),
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
      const xfIndex = ctx.xfIndexForCell(cell);
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
