import { BlockCursor } from "../biff/cursor";
import {
  RECORD_BOUNDSHEET8,
  RECORD_DATE1904,
  RECORD_FORMAT,
  RECORD_SST,
  RECORD_XF,
} from "../biff/record-types";
import { BiffFormatError } from "../biff/records";
import {
  readRichExtendedString,
  readShortXLUnicodeString,
  readXLUnicodeString,
} from "../biff/strings";
import type { RecordGroup } from "../biff/substreams";
import { BUILTIN_NUMBER_FORMATS } from "../number-format";

// The workbook globals substream ([MS-XLS] 2.1.7.20.3): everything that belongs to the workbook rather than to one sheet -- which sheets exist and in what order, the shared string table every string cell indexes into, the number-format and cell-format tables every numeric cell's meaning depends on, and which date epoch the whole file counts serials from. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/ca4c1748-8729-4a93-abb9-4602b3a01fb1
//
// Read before any sheet, because a worksheet substream is close to meaningless on its own: a LabelSst cell carries only an index into the SST, and an RK cell carries only a number whose kind lives in the Format record its XF points at.

/** One sheet, as its BoundSheet8 record describes it ([MS-XLS] 2.4.28). */
export interface SheetEntry {
  /** The sheet's name, from stName. */
  readonly name: string;
  /** True for both the Hidden and Very Hidden states -- the schema's own ContentSheet has no place for either, so the distinction is not carried further. */
  readonly hidden: boolean;
  /** The dt field: 0x00 worksheet or dialog sheet, 0x01 macro sheet, 0x02 chart sheet, 0x06 VBA module. */
  readonly sheetType: number;
  /** lbPlyPos: the byte offset, within the workbook stream, of this sheet's own BOF record. */
  readonly bofPosition: number;
}

/** One XF record's fixed prefix ([MS-XLS] 2.4.353). Only the fields the value path needs are carried: the trailing CellXF/StyleXF payload holds alignment, fill, and border properties whose colours are palette indices needing the Palette record to resolve, which this package does not yet read. */
export interface CellFormat {
  /** ifnt: the index of the Font record this format uses. */
  readonly fontIndex: number;
  /** ifmt: the number-format identifier, resolved against the Format records and the built-in table. */
  readonly formatId: number;
  /** fStyle: true when this record describes a cell STYLE rather than a cell format. */
  readonly isStyle: boolean;
}

/** Everything the globals substream contributes to reading the sheets that follow it. */
export interface WorkbookGlobals {
  /** The sheets, in BoundSheet8 order -- which is the workbook's own tab order, and not necessarily the order the substreams appear in the stream. */
  readonly sheets: readonly SheetEntry[];
  /** The shared string table, indexed by a LabelSst record's isst. */
  readonly sharedStrings: readonly string[];
  /** The XF table, indexed by a cell's own ixfe. */
  readonly cellFormats: readonly CellFormat[];
  /** Number-format codes by identifier: the file's own Format records laid over the built-in table. */
  readonly numberFormats: ReadonlyMap<number, string>;
  /** Whether serials count from the 1904 epoch rather than the 1900 one ([MS-XLS] 2.4.77). */
  readonly date1904: boolean;
}

/** [MS-XLS] 2.4.28's own hsState values; 0x01 is Hidden and 0x02 Very Hidden. */
const HIDDEN_STATE_MASK = 0x03;
const HIDDEN_STATE_VISIBLE = 0x00;

/** A cell format's fStyle bit within the XF record's third 16-bit field. */
const XF_FLAG_STYLE = 0x0004;

/** An SST declaring more unique strings than the record could possibly carry is malformed; a string is at minimum three bytes (cch, flags) so this bounds the loop against the actual data. */
const MIN_SST_ENTRY_BYTES = 3;

/** Reads the globals substream's records into the tables the sheet reader needs. */
export function readWorkbookGlobals(
  records: readonly RecordGroup[],
): WorkbookGlobals {
  const sheets: SheetEntry[] = [];
  const cellFormats: CellFormat[] = [];
  const customFormats = new Map<number, string>();
  let sharedStrings: readonly string[] = [];
  let date1904 = false;

  for (const record of records) {
    switch (record.type) {
      case RECORD_BOUNDSHEET8:
        sheets.push(readBoundSheet(record));
        break;
      case RECORD_SST:
        sharedStrings = readSharedStrings(record);
        break;
      case RECORD_FORMAT: {
        const format = readFormat(record);
        customFormats.set(format.id, format.code);
        break;
      }
      case RECORD_XF:
        cellFormats.push(readCellFormat(record));
        break;
      case RECORD_DATE1904:
        date1904 = readDate1904(record);
        break;
      default:
        // Every other record in the globals substream -- the window settings, the palette, the theme, the drawing group, the external-workbook references -- carries nothing this reader acts on yet.
        break;
    }
  }

  // A file's own Format records lay OVER the built-in table rather than replacing it: a producer may redefine an identifier the built-in table also names, and the file's own definition is the one that applies.
  const numberFormats = new Map(BUILTIN_NUMBER_FORMATS);
  for (const [id, code] of customFormats) {
    numberFormats.set(id, code);
  }

  return { sheets, sharedStrings, cellFormats, numberFormats, date1904 };
}

/** BoundSheet8 ([MS-XLS] 2.4.28): a four-byte stream position, a byte of hidden state, a byte of sheet type, then the name as a ShortXLUnicodeString. */
function readBoundSheet(record: RecordGroup): SheetEntry {
  const cursor = new BlockCursor(record.blocks);
  const bofPosition = cursor.u32();
  const state = cursor.u8();
  const sheetType = cursor.u8();
  return {
    name: readShortXLUnicodeString(cursor),
    hidden: (state & HIDDEN_STATE_MASK) !== HIDDEN_STATE_VISIBLE,
    sheetType,
    bofPosition,
  };
}

/** SST ([MS-XLS] 2.4.265): a total reference count, a unique-string count, then that many XLUnicodeRichExtendedStrings -- packed, with no offsets, so a single mis-sized string desynchronises every string after it. This is why the string reader consumes each one's trailing formatting-run and phonetic payloads exactly rather than ignoring them. */
function readSharedStrings(record: RecordGroup): readonly string[] {
  const cursor = new BlockCursor(record.blocks);
  cursor.i32();
  const uniqueCount = cursor.i32();
  if (uniqueCount < 0) {
    throw new BiffFormatError(
      `SST declares a negative unique-string count (${uniqueCount})`,
    );
  }
  const totalBytes = record.blocks.reduce(
    (sum, block) => sum + block.length,
    0,
  );
  if (uniqueCount * MIN_SST_ENTRY_BYTES > totalBytes) {
    throw new BiffFormatError(
      `SST declares ${uniqueCount} unique strings, more than its ${totalBytes} bytes could carry`,
    );
  }
  const strings: string[] = [];
  for (let index = 0; index < uniqueCount; index += 1) {
    strings.push(readRichExtendedString(cursor));
  }
  return strings;
}

/** Format ([MS-XLS] 2.4.126): a two-byte identifier then the format string as an XLUnicodeString. */
function readFormat(record: RecordGroup): { id: number; code: string } {
  const cursor = new BlockCursor(record.blocks);
  const id = cursor.u16();
  return { id, code: readXLUnicodeString(cursor) };
}

/** XF ([MS-XLS] 2.4.353): a font index, a number-format identifier, then a flags field whose fStyle bit says whether the trailing payload is a CellXF or a StyleXF. */
function readCellFormat(record: RecordGroup): CellFormat {
  const cursor = new BlockCursor(record.blocks);
  const fontIndex = cursor.u16();
  const formatId = cursor.u16();
  const flags = cursor.u16();
  return { fontIndex, formatId, isStyle: (flags & XF_FLAG_STYLE) !== 0 };
}

/** Date1904 ([MS-XLS] 2.4.77): a two-byte boolean. */
function readDate1904(record: RecordGroup): boolean {
  return new BlockCursor(record.blocks).u16() !== 0;
}

/**
 * The number-format code a cell's own XF index resolves to, or undefined when it resolves to none.
 *
 * Undefined is a real answer rather than a failure: [MS-XLS] permits an XF to name a reserved identifier that no built-in code covers, and ContentSheetCell's own numberFormatCode is documented as absent for a cell with no producer-declared format -- never a fabricated empty string or a silently substituted General.
 */
export function formatCodeOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): string | undefined {
  const format = globals.cellFormats[xfIndex];
  return format === undefined
    ? undefined
    : globals.numberFormats.get(format.formatId);
}
