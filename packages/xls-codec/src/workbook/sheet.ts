import { BlockCursor } from "../biff/cursor";
import { errorTextOf } from "../biff/errors";
import {
  RECORD_ARRAY,
  RECORD_BLANK,
  RECORD_BOOLERR,
  RECORD_COLINFO,
  RECORD_DIMENSIONS,
  RECORD_FORMULA,
  RECORD_LABEL,
  RECORD_LABELSST,
  RECORD_MERGECELLS,
  RECORD_MULBLANK,
  RECORD_MULRK,
  RECORD_NUMBER,
  RECORD_RK,
  RECORD_ROW,
  RECORD_SHRFMLA,
  RECORD_STRING,
  RECORD_TABLE,
} from "../biff/record-types";
import { BiffFormatError } from "../biff/records";
import { decodeRkNumber } from "../biff/rk";
import { readXLUnicodeString } from "../biff/strings";
import type { RecordGroup } from "../biff/substreams";
import { columnWidthToPoints, twipsToPoints } from "../units";

// The worksheet substream ([MS-XLS] 2.1.7.20.5): the grid geometry and the cell table for one sheet. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/f41c06f2-9057-49a1-8c3f-a4a4d211fc56
//
// Its record sequence is defined by that section's own ABNF, whose relevant productions are (from [MS-XLS] 2.1.7.20.6, Common Productions):
//
// * `CELLTABLE = 1*(1*Row *CELL 1*DBCell) *EntExU2`
// * `CELL = FORMULA / Blank / MulBlank / RK / MulRk / BoolErr / Number / LabelSst`
// * `FORMULA = [Uncalced] Formula [Array / Table / ShrFmla / SUB] [String *Continue]`
// * `COLUMNS = DefColWidth *255ColInfo`
//
// This reader walks the records rather than parsing that grammar: a real file's ordering is reliable enough that a state machine over record types reads it correctly, and being tolerant of a producer that puts a record slightly out of the ABNF's order is worth more here than rejecting it.
//
// The output is deliberately a RAW shape rather than document-schema.js's own, because the mapping needs the workbook globals (the shared string table, the number formats) that this sheet's own records do not carry. content.ts joins the two.

/** A cell's value as its own record carries it, before number-format classification decides whether a number is really a date, a percentage, or an amount of money. */
export type RawCellValue =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "error"; value: string }
  | { kind: "blank" };

/** One cell of the cell table. */
export interface RawCell {
  readonly row: number;
  readonly column: number;
  /** The cell's own ixfe ([MS-XLS] 2.5.168): an index into the globals substream's XF table. */
  readonly xfIndex: number;
  readonly value: RawCellValue;
  /** True when the value is a Formula record's CACHED result rather than a literal. The formula expression itself is not read: BIFF8 stores it as a compiled Ptg token stream, not as text. */
  readonly fromFormula: boolean;
}

export interface RawRow {
  readonly index: number;
  /** The row's declared height in points, absent when the record declared none. */
  readonly heightPt?: number;
  readonly hidden: boolean;
}

export interface RawColumn {
  readonly index: number;
  readonly widthPt?: number;
  readonly hidden: boolean;
}

export interface RawRange {
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}

/** One worksheet's records, read but not yet mapped onto the shared schema. */
export interface RawSheet {
  readonly cells: readonly RawCell[];
  readonly rows: readonly RawRow[];
  readonly columns: readonly RawColumn[];
  readonly merges: readonly RawRange[];
  /** The used range from the Dimensions record ([MS-XLS] 2.4.90), when the sheet declared one. */
  readonly usedRange?: RawRange;
}

/** Row record flag bits, in the 32-bit field following unused1 ([MS-XLS] 2.4.221). */
const ROW_FLAG_HIDDEN = 0x20;
/** fUnsynced: the row height was set manually. When clear the height is the sheet default rather than a per-row declaration. */
const ROW_FLAG_UNSYNCED = 0x40;

/** ColInfo flag bits ([MS-XLS] 2.4.53). */
const COLINFO_FLAG_HIDDEN = 0x0001;

/** A FormulaValue whose fExprO field is this is not an Xnum but a tagged non-numeric value ([MS-XLS] 2.5.133). */
const FORMULA_VALUE_TAGGED = 0xffff;
/** The tag byte's own vocabulary in that case. */
const FORMULA_VALUE_STRING = 0x00;
const FORMULA_VALUE_BOOLEAN = 0x01;
const FORMULA_VALUE_ERROR = 0x02;
const FORMULA_VALUE_BLANK = 0x03;

/** MulRk carries rw, colFirst, N six-byte RkRecs, then colLast; MulBlank the same with two-byte ixfe entries. */
const MUL_FIXED_BYTES = 6;
const MULRK_ENTRY_BYTES = 6;
const MULBLANK_ENTRY_BYTES = 2;

/** Reads one worksheet substream's records. */
export function readSheetRecords(
  records: readonly RecordGroup[],
  sharedStrings: readonly string[],
): RawSheet {
  const cells: RawCell[] = [];
  const rows: RawRow[] = [];
  const columns: RawColumn[] = [];
  const merges: RawRange[] = [];
  let usedRange: RawRange | undefined;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    switch (record.type) {
      case RECORD_DIMENSIONS:
        usedRange = readDimensions(record);
        break;
      case RECORD_ROW:
        rows.push(readRow(record));
        break;
      case RECORD_COLINFO:
        columns.push(...readColInfo(record));
        break;
      case RECORD_MERGECELLS:
        merges.push(...readMergeCells(record));
        break;
      case RECORD_BLANK:
        cells.push(readBlank(record));
        break;
      case RECORD_MULBLANK:
        cells.push(...readMulBlank(record));
        break;
      case RECORD_RK:
        cells.push(readRk(record));
        break;
      case RECORD_MULRK:
        cells.push(...readMulRk(record));
        break;
      case RECORD_NUMBER:
        cells.push(readNumber(record));
        break;
      case RECORD_BOOLERR: {
        const cell = readBoolErr(record);
        if (cell !== undefined) {
          cells.push(cell);
        }
        break;
      }
      case RECORD_LABELSST:
        cells.push(readLabelSst(record, sharedStrings));
        break;
      case RECORD_LABEL:
        cells.push(readLabel(record));
        break;
      case RECORD_FORMULA:
        // A Formula whose cached result is a string is followed by a String record carrying it, so the formula reader is given whichever record that turns out to be.
        cells.push(readFormula(record, stringResultAfter(records, index)));
        break;
      default:
        // Every other record a worksheet substream carries -- the window settings, the page setup, the drawing objects, the row-block index -- is not read yet.
        break;
    }
  }

  return usedRange === undefined
    ? { cells, rows, columns, merges }
    : { cells, rows, columns, merges, usedRange };
}

/**
 * Finds the String record carrying a Formula's cached string result, if it has one.
 *
 * [MS-XLS] 2.5.133 says the String "immediately follows" the Formula, but the FORMULA production of [MS-XLS] 2.1.7.20.6 is wider than that -- `[Uncalced] Formula [Array / Table / ShrFmla / SUB] [String *Continue]` -- so an array formula, a data table, or a member of a shared-formula run puts one record in between. Skipping exactly those three finds the String in both shapes; anything else ends the search, so a Formula with no string result never reaches past its own cell into the next one's records.
 */
function stringResultAfter(
  records: readonly RecordGroup[],
  formulaIndex: number,
): RecordGroup | undefined {
  for (let index = formulaIndex + 1; index < records.length; index += 1) {
    const candidate = records[index];
    if (candidate === undefined) {
      return undefined;
    }
    if (candidate.type === RECORD_STRING) {
      return candidate;
    }
    if (
      candidate.type !== RECORD_ARRAY &&
      candidate.type !== RECORD_TABLE &&
      candidate.type !== RECORD_SHRFMLA
    ) {
      return undefined;
    }
  }
  return undefined;
}

/** Dimensions ([MS-XLS] 2.4.90): a four-byte first row, a four-byte past-the-end row, a two-byte first column, and a two-byte past-the-end column. */
function readDimensions(record: RecordGroup): RawRange | undefined {
  const cursor = new BlockCursor(record.blocks);
  const rwMic = cursor.u32();
  const rwMac = cursor.u32();
  const colMic = cursor.u16();
  const colMac = cursor.u16();
  // Both past-the-end fields being zero is the spec's own spelling of "no cells on this sheet are used cells", not a range ending at row/column zero.
  if (rwMac === 0 || colMac === 0) {
    return undefined;
  }
  return {
    startRow: rwMic,
    startColumn: colMic,
    endRow: rwMac - 1,
    endColumn: colMac - 1,
  };
}

/** Row ([MS-XLS] 2.4.221): sixteen bytes, of which this reader uses the index, the height, and the hidden and manually-set flags. */
function readRow(record: RecordGroup): RawRow {
  const cursor = new BlockCursor(record.blocks);
  const index = cursor.u16();
  cursor.skip(4); // colMic and colMac: the row's own first and past-the-end populated column, which the cell records already say.
  const heightTwips = cursor.u16();
  cursor.skip(4); // reserved1 and unused1.
  const flags = cursor.u8();
  const hidden = (flags & ROW_FLAG_HIDDEN) !== 0;
  // fUnsynced alone, which [MS-XLS] 2.4.221 defines as "whether the row height was manually set" -- the only flag that says miyRw is a real declaration rather than a restatement of the sheet default. fGhostDirty is deliberately NOT consulted here despite also being about the row: it says the row was FORMATTED (and governs whether ixfe_val is meaningful), which is a different fact and says nothing about the height. ContentSheetRow documents an absent height as "no declared size, use the application default" rather than as a fabricated one.
  const declared = (flags & ROW_FLAG_UNSYNCED) !== 0;
  const heightPt = twipsToPoints(heightTwips);
  return declared && heightPt > 0
    ? { index, heightPt, hidden }
    : { index, hidden };
}

/** ColInfo ([MS-XLS] 2.4.53): one record covering an inclusive RANGE of columns, so it expands to one entry per column it names. */
function readColInfo(record: RecordGroup): RawColumn[] {
  const cursor = new BlockCursor(record.blocks);
  const first = cursor.u16();
  const last = cursor.u16();
  const coldx = cursor.u16();
  cursor.skip(2); // ixfe: the columns' default cell format, which this reader does not map yet.
  const flags = cursor.u16();
  const hidden = (flags & COLINFO_FLAG_HIDDEN) !== 0;
  const widthPt = columnWidthToPoints(coldx);
  const columns: RawColumn[] = [];
  // colLast is inclusive, and [MS-XLS] caps a column index at 0x00FF; a record naming a wider range is malformed, and clamping keeps a single bad record from allocating an unbounded array.
  const end = Math.min(last, 0xff);
  for (let index = first; index <= end; index += 1) {
    columns.push(widthPt > 0 ? { index, widthPt, hidden } : { index, hidden });
  }
  return columns;
}

/** MergeCells ([MS-XLS] 2.4.168): a count then that many Ref8 structures ([MS-XLS] 2.5.208), each an inclusive row and column range. */
function readMergeCells(record: RecordGroup): RawRange[] {
  const cursor = new BlockCursor(record.blocks);
  const count = cursor.u16();
  const ranges: RawRange[] = [];
  for (let index = 0; index < count; index += 1) {
    const startRow = cursor.u16();
    const endRow = cursor.u16();
    const startColumn = cursor.u16();
    const endColumn = cursor.u16();
    ranges.push({ startRow, startColumn, endRow, endColumn });
  }
  return ranges;
}

/** The Cell structure ([MS-XLS] 2.5.19) every single-cell record opens with. */
function readCellHeader(cursor: BlockCursor): {
  row: number;
  column: number;
  xfIndex: number;
} {
  return { row: cursor.u16(), column: cursor.u16(), xfIndex: cursor.u16() };
}

function readBlank(record: RecordGroup): RawCell {
  const header = readCellHeader(new BlockCursor(record.blocks));
  return { ...header, value: { kind: "blank" }, fromFormula: false };
}

/** MulBlank ([MS-XLS] 2.4.174): a run of blank cells in one row, each with its own format index. The entry count is derived from the record's own length rather than from colLast, which sits AFTER the variable-length array. */
function readMulBlank(record: RecordGroup): RawCell[] {
  const cursor = new BlockCursor(record.blocks);
  const row = cursor.u16();
  const first = cursor.u16();
  const count = mulEntryCount(record, MULBLANK_ENTRY_BYTES);
  const cells: RawCell[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    cells.push({
      row,
      column: first + offset,
      xfIndex: cursor.u16(),
      value: { kind: "blank" },
      fromFormula: false,
    });
  }
  return cells;
}

function readRk(record: RecordGroup): RawCell {
  const cursor = new BlockCursor(record.blocks);
  const row = cursor.u16();
  const column = cursor.u16();
  const xfIndex = cursor.u16();
  return {
    row,
    column,
    xfIndex,
    value: { kind: "number", value: decodeRkNumber(cursor.u32()) },
    fromFormula: false,
  };
}

/** MulRk ([MS-XLS] 2.4.175): a run of RK-encoded numeric cells in one row, each an RkRec ([MS-XLS] 2.5.218) of a format index and an RK word. */
function readMulRk(record: RecordGroup): RawCell[] {
  const cursor = new BlockCursor(record.blocks);
  const row = cursor.u16();
  const first = cursor.u16();
  const count = mulEntryCount(record, MULRK_ENTRY_BYTES);
  const cells: RawCell[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const xfIndex = cursor.u16();
    cells.push({
      row,
      column: first + offset,
      xfIndex,
      value: { kind: "number", value: decodeRkNumber(cursor.u32()) },
      fromFormula: false,
    });
  }
  return cells;
}

/** Both Mul records put colLast after their variable-length array, so the entry count follows from the record's own length: total = rw + colFirst + N*entry + colLast. */
function mulEntryCount(record: RecordGroup, entryBytes: number): number {
  const total = record.blocks.reduce((sum, block) => sum + block.length, 0);
  const payload = total - MUL_FIXED_BYTES;
  if (payload < 0 || payload % entryBytes !== 0) {
    throw new BiffFormatError(
      `multiple-cell record of ${total} bytes does not hold a whole number of ${entryBytes}-byte entries`,
    );
  }
  return payload / entryBytes;
}

function readNumber(record: RecordGroup): RawCell {
  const cursor = new BlockCursor(record.blocks);
  const header = readCellHeader(cursor);
  return {
    ...header,
    value: { kind: "number", value: cursor.f64() },
    fromFormula: false,
  };
}

/** BoolErr ([MS-XLS] 2.4.24): a Cell then a Bes ([MS-XLS] 2.5.10), whose second byte says whether the first is a boolean or an error code. An error code the specification does not define yields no cell at all rather than a fabricated spelling. */
function readBoolErr(record: RecordGroup): RawCell | undefined {
  const cursor = new BlockCursor(record.blocks);
  const header = readCellHeader(cursor);
  const value = cursor.u8();
  const isError = cursor.u8() !== 0;
  if (!isError) {
    return {
      ...header,
      value: { kind: "boolean", value: value !== 0 },
      fromFormula: false,
    };
  }
  const text = errorTextOf(value);
  return text === undefined
    ? undefined
    : { ...header, value: { kind: "error", value: text }, fromFormula: false };
}

/** LabelSst ([MS-XLS] 2.4.149): a Cell then a four-byte index into the shared string table. An index the table does not hold yields an empty string rather than throwing, since one dangling index should not fail a whole workbook. */
function readLabelSst(
  record: RecordGroup,
  sharedStrings: readonly string[],
): RawCell {
  const cursor = new BlockCursor(record.blocks);
  const header = readCellHeader(cursor);
  const index = cursor.u32();
  return {
    ...header,
    value: { kind: "string", value: sharedStrings[index] ?? "" },
    fromFormula: false,
  };
}

/**
 * Label ([MS-XLS] 2.4.148): a Cell then an inline XLUnicodeString.
 *
 * In BIFF8 proper a string cell is a LabelSst indexing the shared string table, and [MS-XLS] documents this record in its charting sense. It is read as a string cell anyway because the layout is identical either way and third-party producers -- and files converted up from BIFF5, where Label WAS the string cell record -- still emit it in a worksheet's cell table, where reading it costs nothing and skipping it would silently drop real text.
 */
function readLabel(record: RecordGroup): RawCell {
  const cursor = new BlockCursor(record.blocks);
  const header = readCellHeader(cursor);
  return {
    ...header,
    value: { kind: "string", value: readXLUnicodeString(cursor) },
    fromFormula: false,
  };
}

/**
 * Formula ([MS-XLS] 2.4.127): a Cell, an eight-byte FormulaValue, flags, a calculation cache, then the compiled expression.
 *
 * Only the cached VALUE is read. The expression is a CellParsedFormula -- a compiled Ptg token stream rather than text -- and turning one back into a formula string means implementing the whole Ptg vocabulary plus shared-formula and external-reference resolution, which is its own substantial piece of work. So the cell's displayed value is correct and its `formula` field stays absent, rather than a plausible-looking expression being invented for it.
 */
function readFormula(
  record: RecordGroup,
  next: RecordGroup | undefined,
): RawCell {
  const cursor = new BlockCursor(record.blocks);
  const header = readCellHeader(cursor);
  const bytes = cursor.take(8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagged = view.getUint16(6, true) === FORMULA_VALUE_TAGGED;
  if (!tagged) {
    return {
      ...header,
      value: { kind: "number", value: view.getFloat64(0, true) },
      fromFormula: true,
    };
  }
  return {
    ...header,
    value: taggedFormulaValue(view, next),
    fromFormula: true,
  };
}

/** The non-numeric readings of a FormulaValue ([MS-XLS] 2.5.133), selected by its first byte. */
function taggedFormulaValue(
  view: DataView,
  next: RecordGroup | undefined,
): RawCellValue {
  switch (view.getUint8(0)) {
    case FORMULA_VALUE_STRING: {
      // "The string value is stored in a String record that immediately follows this record." A missing one leaves the cell empty rather than failing the sheet.
      if (next?.type !== RECORD_STRING) {
        return { kind: "string", value: "" };
      }
      return {
        kind: "string",
        value: readXLUnicodeString(new BlockCursor(next.blocks)),
      };
    }
    case FORMULA_VALUE_BOOLEAN:
      return { kind: "boolean", value: view.getUint8(2) !== 0 };
    case FORMULA_VALUE_ERROR: {
      const text = errorTextOf(view.getUint8(2));
      return text === undefined
        ? { kind: "blank" }
        : { kind: "error", value: text };
    }
    case FORMULA_VALUE_BLANK:
      return { kind: "string", value: "" };
    default:
      return { kind: "blank" };
  }
}
