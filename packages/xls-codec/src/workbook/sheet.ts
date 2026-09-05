import { BlockCursor } from "../biff/cursor";
import { errorTextOf } from "../biff/errors";
import {
  unpackSetupFlags,
  WSBOOL_FLAG_FIT_TO_PAGE,
  type SetupFields,
} from "../biff/print-setup";
import {
  parseFormulaText,
  readPtgExpBase,
  type FormulaSheetContext,
} from "../biff/ptg";
import {
  RECORD_ARRAY,
  RECORD_BLANK,
  RECORD_BOOLERR,
  RECORD_BOTTOMMARGIN,
  RECORD_COLINFO,
  RECORD_DIMENSIONS,
  RECORD_FORMULA,
  RECORD_HORIZONTALPAGEBREAKS,
  RECORD_LABEL,
  RECORD_LABELSST,
  RECORD_LEFTMARGIN,
  RECORD_MERGECELLS,
  RECORD_MULBLANK,
  RECORD_MULRK,
  RECORD_NUMBER,
  RECORD_PRINTGRID,
  RECORD_PRINTROWCOL,
  RECORD_RIGHTMARGIN,
  RECORD_RK,
  RECORD_ROW,
  RECORD_SETUP,
  RECORD_SHRFMLA,
  RECORD_STRING,
  RECORD_TABLE,
  RECORD_TOPMARGIN,
  RECORD_VERTICALPAGEBREAKS,
  RECORD_WSBOOL,
} from "../biff/record-types";
import { BiffFormatError } from "../biff/records";
import { decodeRkNumber } from "../biff/rk";
import { readXLUnicodeString } from "../biff/strings";
import { recordByteLength, type RecordGroup } from "../biff/substreams";
import { columnWidthToPoints, inchesToPoints, twipsToPoints } from "../units";

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
  /** True when the value is a Formula record's CACHED result rather than a literal. */
  readonly fromFormula: boolean;
  /** The formula's own text, recovered from its compiled Ptg token stream ([MS-XLS] 2.5.198), when every token in it is one this reader resolves -- absent for a defined-name or natural-language reference, or a data table (see biff/ptg.ts). */
  readonly formula?: string;
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

/**
 * The page-setup half of a sheet's print settings, as the worksheet substream's own records carry them.
 *
 * Every field is optional because every record behind it is: [MS-XLS] 2.1.7.20.6's PAGESETUP production makes each of the four margins and Setup itself optional, and a sheet that never had its page setup touched carries none of them. An absent field is therefore "this file states nothing here", which is a different fact from "this file states the default", and content.ts is where the distinction is resolved into the required ContentSheetPrintSettings fields.
 *
 * The other half -- the print range and the repeated header bands -- is not here at all, because BIFF8 does not put it in the worksheet substream; see workbook/print-names.ts.
 */
export interface RawPrintSettings {
  /** The Setup record's own fields ([MS-XLS] 2.4.257). */
  readonly setup?: SetupFields;
  /** Each page margin in points, from its own record ([MS-XLS] 2.4.151, 2.4.219, 2.4.328, 2.4.27), which states it in inches. */
  readonly marginsPt: {
    readonly left?: number;
    readonly right?: number;
    readonly top?: number;
    readonly bottom?: number;
  };
  /** PrintGrid's fPrintGrid ([MS-XLS] 2.4.202). */
  readonly printGridlines?: boolean;
  /** PrintRowCol's printRwCol ([MS-XLS] 2.4.203): whether the row and column headers print. */
  readonly printHeaders?: boolean;
  /** WsBool's fFitToPage ([MS-XLS] 2.4.351), which decides whether Setup's iScale or its iFitWidth/iFitHeight pair is the live one. */
  readonly fitToPage?: boolean;
  /** Zero-based row indices an explicit page break falls immediately above ([MS-XLS] 2.4.142), ascending and deduplicated. */
  readonly rowBreaks: readonly number[];
  /** Zero-based column indices an explicit page break falls immediately to the left of ([MS-XLS] 2.4.343). */
  readonly columnBreaks: readonly number[];
}

/** One worksheet's records, read but not yet mapped onto the shared schema. */
export interface RawSheet {
  readonly cells: readonly RawCell[];
  readonly rows: readonly RawRow[];
  readonly columns: readonly RawColumn[];
  readonly merges: readonly RawRange[];
  /** The used range from the Dimensions record ([MS-XLS] 2.4.90), when the sheet declared one. */
  readonly usedRange?: RawRange;
  /** The sheet's own page setup, as far as its records state it. */
  readonly print: RawPrintSettings;
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

/** No sheets and no resolvable 3D references -- the default a caller with nothing formula-relevant to offer (every existing test fixture that predates formula-text recovery) gets, so a 3D reference simply fails to resolve rather than throwing on an absent context. */
const EMPTY_FORMULA_SHEET_CONTEXT: FormulaSheetContext = {
  sheets: [],
  sheetRanges: [],
};

/** A shared formula's real expression, from the SharedParsedFormula a ShrFmla record following the group's base Formula record carries -- expanded relative to each referencing cell's own position by parseFormulaText's `relativeTo` option (see resolveFormulaText). */
interface SharedFormulaGroup {
  readonly kind: "shared";
  readonly rgce: Uint8Array<ArrayBuffer>;
}

/** An array (CSE) formula's real expression, from the ArrayParsedFormula an Array record following the group's base Formula record carries -- identical, unadjusted text for every cell in the array's range (ArrayParsedFormula's own grammar forbids PtgRefN/PtgAreaN, so there is no per-cell expansion to do), wrapped in Excel's own `{...}` array-formula braces by resolveFormulaText. `rgcb` is undefined both when the record genuinely carries none (rgce has no PtgArray to feed) and when readArrayGroup could not make sense of what should have been one -- the two are indistinguishable from here, and parseFormulaText's own rgcb-absent handling is already the correct behaviour for both: rgce is trusted only up to its own PtgArray tokens, which then simply fail to resolve. */
interface ArrayFormulaGroup {
  readonly kind: "array";
  readonly rgce: Uint8Array<ArrayBuffer>;
  readonly rgcb: Uint8Array<ArrayBuffer> | undefined;
}

type FormulaGroup = SharedFormulaGroup | ArrayFormulaGroup;

/** The key collectFormulaGroups and its lookup agree on: a shared/array formula group's own base cell, the same (row, column) a PtgExp token elsewhere in the sheet points back to. */
function groupKey(row: number, column: number): string {
  return `${row},${column}`;
}

/**
 * Walks every record once, looking for a Formula record immediately followed by a ShrFmla or Array record ([MS-XLS] 2.1.7.20.6's own FORMULA production, and 984826cc/c6ee7512's own "this record is preceded by a single Formula record"), and returns the shared/array expression each one carries, keyed by that Formula record's own cell -- the same (row, column) a PtgExp token names when it points back to this group (see readPtgExpBase, and readFormula below which performs the actual lookup).
 *
 * Built as a single upfront pass over the whole sheet rather than interleaved into readSheetRecords' own per-record loop: every Formula record that uses a shared/array formula (including the group's own base cell, which points at itself) needs this map already complete when it is reached, and although [MS-XLS] guarantees the base pair precedes every other use, resolving the whole map first removes that ordering as a correctness dependency rather than merely relying on it.
 */
function collectFormulaGroups(
  records: readonly RecordGroup[],
): ReadonlyMap<string, FormulaGroup> {
  const groups = new Map<string, FormulaGroup>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const next = records[index + 1];
    if (record === undefined || next === undefined) {
      continue;
    }
    if (record.type !== RECORD_FORMULA) {
      continue;
    }
    if (next.type === RECORD_SHRFMLA) {
      const header = readCellHeader(new BlockCursor(record.blocks));
      groups.set(groupKey(header.row, header.column), readShrFmlaGroup(next));
    } else if (next.type === RECORD_ARRAY) {
      const header = readCellHeader(new BlockCursor(record.blocks));
      groups.set(groupKey(header.row, header.column), readArrayGroup(next));
    }
  }
  return groups;
}

/** ShrFmla ([MS-XLS] 984826cc): a RefU range (6 bytes, not needed here -- the group is looked up by its base cell's own coordinates, not by re-deriving them from this range), a reserved byte, a cUse byte, then a SharedParsedFormula (458bbec0): a two-byte cce and that many bytes of rgce. Its own rgce is forbidden from containing PtgArray ([MS-XLS] 458bbec0's own "MUST NOT contain... PtgArray"), so no rgcb is read here. */
const SHRFMLA_HEADER_BYTES = 8;

function readShrFmlaGroup(record: RecordGroup): SharedFormulaGroup {
  const cursor = new BlockCursor(record.blocks);
  cursor.skip(SHRFMLA_HEADER_BYTES);
  const cce = cursor.u16();
  return { kind: "shared", rgce: cursor.take(cce) };
}

/** Array ([MS-XLS] c6ee7512): a Ref range (6 bytes), a flags word (fAlwaysCalc plus reserved bits), four unused bytes, then an ArrayParsedFormula (242bcf20): a two-byte cce, that many bytes of rgce, and -- unlike ShrFmla's own SharedParsedFormula -- a real rgcb trailer, since an array formula's rgce CAN contain a PtgArray for an array-constant literal used within it (e.g. `{=A1:A3+{1;2;3}}`). rgcb's own length is never stated directly: it is whatever bytes remain in the record once the header and rgce are accounted for. */
const ARRAY_HEADER_BYTES = 12;

function readArrayGroup(record: RecordGroup): ArrayFormulaGroup {
  const cursor = new BlockCursor(record.blocks);
  cursor.skip(ARRAY_HEADER_BYTES);
  const cce = cursor.u16();
  const rgce = cursor.take(cce);
  const rgcbLength = recordByteLength(record) - (ARRAY_HEADER_BYTES + 2 + cce);
  // A non-positive length means the record's own declared byte total does not even cover its header and rgce -- malformed, and genuinely undefined rather than a fake empty buffer: an empty Uint8Array would claim "this record legitimately carries zero bytes of rgcb," which is a real, valid state (an array formula whose rgce has no PtgArray at all) that this distinguishes from. Reading a rgcbLength byte count larger than what the record actually holds (an overrun, as opposed to this too-short case) throws BiffFormatError instead, caught the same way for the same reason: both are this one Array record's own malformed trailer, and neither should stop any OTHER cell's formula from resolving.
  if (rgcbLength <= 0) {
    return { kind: "array", rgce, rgcb: undefined };
  }
  try {
    return { kind: "array", rgce, rgcb: cursor.take(rgcbLength) };
  } catch (error) {
    if (!(error instanceof BiffFormatError)) {
      throw error;
    }
    return { kind: "array", rgce, rgcb: undefined };
  }
}

/** Reads one worksheet substream's records. */
export function readSheetRecords(
  records: readonly RecordGroup[],
  sharedStrings: readonly string[],
  formulaSheets: FormulaSheetContext = EMPTY_FORMULA_SHEET_CONTEXT,
): RawSheet {
  const formulaGroups = collectFormulaGroups(records);
  const cells: RawCell[] = [];
  const rows: RawRow[] = [];
  const columns: RawColumn[] = [];
  const merges: RawRange[] = [];
  let usedRange: RawRange | undefined;
  const marginsPt: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  } = {};
  const rowBreaks: number[] = [];
  const columnBreaks: number[] = [];
  let setup: SetupFields | undefined;
  let printGridlines: boolean | undefined;
  let printHeaders: boolean | undefined;
  let fitToPage: boolean | undefined;

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
        cells.push(
          readFormula(
            record,
            stringResultAfter(records, index),
            formulaSheets,
            formulaGroups,
          ),
        );
        break;
      case RECORD_SETUP:
        setup = readSetup(record);
        break;
      case RECORD_LEFTMARGIN:
        marginsPt.left = readMargin(record);
        break;
      case RECORD_RIGHTMARGIN:
        marginsPt.right = readMargin(record);
        break;
      case RECORD_TOPMARGIN:
        marginsPt.top = readMargin(record);
        break;
      case RECORD_BOTTOMMARGIN:
        marginsPt.bottom = readMargin(record);
        break;
      case RECORD_PRINTGRID:
        printGridlines = readGridlineBooleanRecord(record);
        break;
      case RECORD_PRINTROWCOL:
        printHeaders = readBooleanRecord(record);
        break;
      case RECORD_WSBOOL:
        fitToPage =
          (new BlockCursor(record.blocks).u16() & WSBOOL_FLAG_FIT_TO_PAGE) !==
          0;
        break;
      case RECORD_HORIZONTALPAGEBREAKS:
        rowBreaks.push(...readPageBreaks(record));
        break;
      case RECORD_VERTICALPAGEBREAKS:
        columnBreaks.push(...readPageBreaks(record));
        break;
      default:
        // Every other record a worksheet substream carries -- the window settings, the drawing objects, the row-block index -- is not read yet.
        break;
    }
  }

  // Spread rather than assigned field by field, so an absent record leaves its field genuinely absent rather than present-and-undefined: RawPrintSettings documents absence as "this file states nothing here", and content.ts's own fallbacks turn on exactly that.
  const print: RawPrintSettings = {
    marginsPt,
    rowBreaks: ascendingDistinct(rowBreaks),
    columnBreaks: ascendingDistinct(columnBreaks),
    ...(setup === undefined ? {} : { setup }),
    ...(printGridlines === undefined ? {} : { printGridlines }),
    ...(printHeaders === undefined ? {} : { printHeaders }),
    ...(fitToPage === undefined ? {} : { fitToPage }),
  };

  return usedRange === undefined
    ? { cells, rows, columns, merges, print }
    : { cells, rows, columns, merges, usedRange, print };
}

/** Setup ([MS-XLS] 2.4.257): iPaperSize, iScale, iPageStart, iFitWidth, iFitHeight, a flags word, iRes, iVRes, an eight-byte header margin, an eight-byte footer margin, and iCopies. The starting page number, the two print resolutions, the header/footer margins, and the copy count are read past: ContentSheetPrintSettings has no field for any of them, and Margins models only the four page edges. */
function readSetup(record: RecordGroup): SetupFields {
  const cursor = new BlockCursor(record.blocks);
  const paperCode = cursor.u16();
  const scalePercent = cursor.u16();
  cursor.skip(2); // iPageStart
  const fitWidth = cursor.u16();
  const fitHeight = cursor.u16();
  return {
    paperCode,
    scalePercent,
    fitWidth,
    fitHeight,
    ...unpackSetupFlags(cursor.u16()),
  };
}

/** Any of the four margin records ([MS-XLS] 2.4.151, 2.4.219, 2.4.328, 2.4.27): a single Xnum stating that margin in inches. All four share the identical one-field layout, so one reader serves them all. */
function readMargin(record: RecordGroup): number {
  return inchesToPoints(new BlockCursor(record.blocks).f64());
}

/** PrintRowCol ([MS-XLS] 2.4.203): a single 16-bit `Boolean` field (2.5.14), whose whole word is the value. [MS-XLS] 2.4.203's own value table states both 0x0000 and 0x0001 as "Row and column headers are not printed", which is a typo in that table rather than two spellings of one meaning -- the record exists precisely to distinguish them, and every real producer writes 1 for printed (confirmed against LibreOffice-written BIFF8, where a sheet with header printing enabled carries 0x0001 and one without carries 0x0000). */
function readBooleanRecord(record: RecordGroup): boolean {
  return new BlockCursor(record.blocks).u16() !== 0;
}

/** PrintGrid ([MS-XLS] 2.4.202): unlike PrintRowCol above, its 16-bit field is only ONE bit wide (`fPrintGrid`) with the remaining 15 "Undefined, and MUST be ignored" -- so a producer leaving anything in those bits would read as gridlines-on under a bare `!== 0` test. No real producer does (LibreOffice writes 0x0000/0x0001, confirmed against its own BIFF8 output), but masking to the one bit the spec actually defines is what the field's own layout says to do. */
function readGridlineBooleanRecord(record: RecordGroup): boolean {
  return (new BlockCursor(record.blocks).u16() & 0x0001) !== 0;
}

/**
 * HorizontalPageBreaks ([MS-XLS] 2.4.142) and VerticalPageBreaks ([MS-XLS] 2.4.343): a count then that many six-byte structures, each an index on the break's own axis followed by the start and end of the break's extent on the other one.
 *
 * Only the index is taken. HorzBrk's colStart/colEnd and VertBrk's rowStart/rowEnd say how far along the perpendicular axis the break runs -- a BIFF8 page break can be partial -- and ContentSheetPrintSettings.manualBreaks models a break as a whole-axis index with no extent, so a partial break is carried as a full one rather than dropped. Both structures have the identical three-field shape, so one reader serves both.
 */
function readPageBreaks(record: RecordGroup): number[] {
  const cursor = new BlockCursor(record.blocks);
  const count = cursor.u16();
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    indices.push(cursor.u16());
    cursor.skip(4); // the break's extent along the other axis
  }
  return indices;
}

/** Page-break indices, ascending and with duplicates collapsed: two records naming the same row are one page break as far as the schema's own index-only model of a break can express. */
function ascendingDistinct(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
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
  const total = recordByteLength(record);
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

/** The Formula record's own flags field ([MS-XLS] 2.4.127) and calculation cache, between the cached value and the compiled expression -- neither read for its own content; see the two-byte and four-byte skips in readFormula. */
const FORMULA_FLAGS_BYTES = 2;
const FORMULA_CALC_CACHE_BYTES = 4;
/** The Cell (6 bytes) and FormulaValue (8 bytes) fields readFormula has already consumed by the time it reaches cce, plus the flags and calculation-cache fields above and the cce field itself (2 bytes) -- what's left of the record past `FORMULA_HEADER_BYTES + cce` is the CellParsedFormula's own rgcb trailer. */
const FORMULA_HEADER_BYTES =
  6 + 8 + FORMULA_FLAGS_BYTES + FORMULA_CALC_CACHE_BYTES + 2;

/**
 * Formula ([MS-XLS] 2.4.127): a Cell, an eight-byte FormulaValue, flags, a calculation cache, then a CellParsedFormula -- a two-byte cce, that many bytes of compiled Ptg tokens ([MS-XLS] 2.5.198.3), and (whenever rgce contains a PtgArray -- an inline array-constant literal like `=SUM({1,2,3})`, unrelated to whether the cell itself is CSE-array-entered) an RgbExtra trailer of whatever bytes remain in the record.
 *
 * Both the cached value and the expression are read: the value from the FormulaValue exactly as before, and the expression by resolveFormulaText below, which joins a lone PtgExp against the shared/array formula group collectFormulaGroups found for it and otherwise hands the token bytes straight to biff/ptg.ts's parseFormulaText. `formula` is attached only when it resolves; a cell it does not resolve for keeps exactly the behaviour this reader always had, its cached value present and `formula` absent.
 */
function readFormula(
  record: RecordGroup,
  next: RecordGroup | undefined,
  formulaSheets: FormulaSheetContext,
  formulaGroups: ReadonlyMap<string, FormulaGroup>,
): RawCell {
  const cursor = new BlockCursor(record.blocks);
  const header = readCellHeader(cursor);
  const bytes = cursor.take(8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagged = view.getUint16(6, true) === FORMULA_VALUE_TAGGED;
  const value = tagged
    ? taggedFormulaValue(view, next)
    : { kind: "number" as const, value: view.getFloat64(0, true) };
  cursor.skip(FORMULA_FLAGS_BYTES);
  cursor.skip(FORMULA_CALC_CACHE_BYTES);
  const cce = cursor.u16();
  const rgce = cursor.take(cce);
  // This record's own rgcb trailer (present only when rgce contains an inline PtgArray, e.g. `=SUM({1,2,3})` in a cell that is not itself CSE-array-entered) is read past the point cce already bounds, and its own length is inferred the same way readArrayGroup's is -- so the same malformed-trailer risk applies. Caught here rather than left to propagate: a bad rgcb degrades only THIS cell's formula to absent, exactly like any other construct this reader cannot resolve, rather than aborting every other cell's read too.
  let formula: string | undefined;
  try {
    const rgcbLength = recordByteLength(record) - (FORMULA_HEADER_BYTES + cce);
    const rgcb = rgcbLength > 0 ? cursor.take(rgcbLength) : undefined;
    formula = resolveFormulaText(
      rgce,
      rgcb,
      header,
      formulaSheets,
      formulaGroups,
    );
  } catch (error) {
    if (!(error instanceof BiffFormatError)) {
      throw error;
    }
    formula = undefined;
  }
  return formula === undefined
    ? { ...header, value, fromFormula: true }
    : { ...header, value, fromFormula: true, formula };
}

/**
 * A Formula record's rgce resolves one of three ways: a lone PtgExp pointing back to a shared-formula base cell, whose real expression (a ShrFmla's SharedParsedFormula) is expanded relative to THIS cell's own position; a lone PtgExp pointing back to an array-formula base cell, whose real expression (an Array's ArrayParsedFormula) is identical for every cell in the range and gets Excel's own `{...}` array-formula wrapping; or an ordinary rgce, handed to parseFormulaText as-is (with this record's own rgcb, for an inline array-constant literal). A PtgExp with no matching group -- a dangling or malformed reference this reader cannot join -- resolves to undefined exactly like any other unsupported construct.
 */
function resolveFormulaText(
  rgce: Uint8Array<ArrayBuffer>,
  rgcb: Uint8Array<ArrayBuffer> | undefined,
  header: { readonly row: number; readonly column: number },
  formulaSheets: FormulaSheetContext,
  formulaGroups: ReadonlyMap<string, FormulaGroup>,
): string | undefined {
  const base = readPtgExpBase(rgce);
  if (base === undefined) {
    return parseFormulaText(rgce, formulaSheets, { rgcb });
  }
  const group = formulaGroups.get(groupKey(base.row, base.column));
  if (group === undefined) {
    return undefined;
  }
  if (group.kind === "shared") {
    return parseFormulaText(group.rgce, formulaSheets, {
      relativeTo: header,
    });
  }
  const text = parseFormulaText(group.rgce, formulaSheets, {
    rgcb: group.rgcb,
  });
  return text === undefined ? undefined : `{${text}}`;
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
