import type { Color } from "document-schema.js";

import { BlockCursor } from "../biff/cursor";
import type { ExternalSheetLabel, SheetRange } from "../biff/ptg";
import {
  RECORD_BOUNDSHEET8,
  RECORD_DATE1904,
  RECORD_EXTERNSHEET,
  RECORD_FORMAT,
  RECORD_PALETTE,
  RECORD_SST,
  RECORD_SUPBOOK,
  RECORD_XF,
} from "../biff/record-types";
import { BiffFormatError } from "../biff/records";
import {
  readRichExtendedString,
  readShortXLUnicodeString,
  readXLUnicodeString,
  readXLUnicodeStringNoCch,
} from "../biff/strings";
import { recordByteLength, type RecordGroup } from "../biff/substreams";
import {
  PALETTE_ENTRY_COUNT,
  readLongRgbColor,
  unpackXfAlignment,
  unpackXfDecoration,
  type XfAlignmentFields,
  type XfDecorationFields,
} from "../biff/xf-colors";
import { BUILTIN_NUMBER_FORMATS } from "excel-number-format";
import { readPrintNames, type SheetPrintNames } from "./print-names";

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

/** One XF record's fixed prefix ([MS-XLS] 2.4.353) plus its trailing CellXF/StyleXF payload's own alignment and fill/border fields. */
export interface CellFormat {
  /** ifnt: the index of the Font record this format uses. */
  readonly fontIndex: number;
  /** ifmt: the number-format identifier, resolved against the Format records and the built-in table. */
  readonly formatId: number;
  /** fStyle: true when this record describes a cell STYLE rather than a cell format. */
  readonly isStyle: boolean;
  /** The trailing payload's own leading word, resolved into document-schema.js's Alignment/verticalAlignment members directly (undefined already means what an absent ContentSheetCell.alignment/verticalAlignment means, so content.ts consumes this without a further resolution step). */
  readonly alignment: XfAlignmentFields;
  /** The trailing payload's own fill pattern/colour and per-side border fields, raw -- resolved into document-schema.js's Color/ContentCellBorders by content.ts, through this same globals object's own `palette`. */
  readonly decoration: XfDecorationFields;
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
  /**
   * A PtgRef3d/PtgArea3d's own ixti, resolved to the sheet scope it names -- one entry per XTI in the EXTERNSHEET record's rgXTI array, in that array's own order (an ixti is an index into it).
   *
   * A plain SheetRange when the XTI's own SupBook is this same, self-referencing workbook and both itabFirst/itabLast name a real sheet. An ExternalSheetLabel -- a fully-formatted label text, diagnostic placeholder included -- for everything else this reader cannot turn into direct BoundSheet8 indices: a genuinely external workbook (resolved as far as its own virtPath and rgst allow, see readSupBook/fileNameFromVirtPath), a DDE/OLE/add-in/same-sheet/unused supporting link (no sheet name to resolve at all), or a sheet index [MS-XLS] 2.5.344 itself marks unresolvable (`-1`, "sheet could not be found") or workbook-level (`-2`). Only an ixti past the end of EXTERNSHEET's own array is genuinely undefined -- every other case now carries SOME label text, so a 3D reference into it no longer drops the whole formula the way an unresolvable one used to.
   */
  readonly sheetRanges: readonly (
    SheetRange | ExternalSheetLabel | undefined
  )[];
  /**
   * The workbook's own custom colour table, from a Palette record ([MS-XLS] 2.4.188) -- 56 entries, index 0 being icv 8. Undefined when the file carries no Palette record at all, which is common: a real file relying purely on the fixed default 8-colour-plus-56-entry table (this package's own `resolveIcvColor` falls back to that same default table, matching [MS-XLS] "Icv"'s own documented fallback) never needs one.
   */
  readonly palette: readonly Color[] | undefined;
  /**
   * The print range and repeated header bands each sheet's own built-in Print_Area/Print_Titles defined names declare, keyed by zero-based sheet index -- see workbook/print-names.ts for why a sheet's print settings are split between here and its own substream.
   *
   * A sheet with no entry declares neither, which is the common case: a workbook nobody has set a print area on carries no Lbl record at all.
   */
  readonly printNames: ReadonlyMap<number, SheetPrintNames>;
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
  // SupBook records ([MS-XLS] 2.4.271) precede the single EXTERNSHEET record that resolves against them, but this reader does not lean on that ordering: every SupBook is collected here, in arrival order, and EXTERNSHEET is resolved against the finished collection once the whole substream has been walked.
  const supBooks: SupBookInfo[] = [];
  let sharedStrings: readonly string[] = [];
  let date1904 = false;
  let externSheet: RecordGroup | undefined;
  let palette: readonly Color[] | undefined;

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
      case RECORD_SUPBOOK:
        supBooks.push(readSupBookSafely(record));
        break;
      case RECORD_EXTERNSHEET:
        externSheet = record;
        break;
      case RECORD_PALETTE:
        palette = readPalette(record);
        break;
      default:
        // Every other record in the globals substream -- the window settings, the theme, the drawing group -- carries nothing this reader acts on yet.
        break;
    }
  }

  // A file's own Format records lay OVER the built-in table rather than replacing it: a producer may redefine an identifier the built-in table also names, and the file's own definition is the one that applies.
  const numberFormats = new Map(BUILTIN_NUMBER_FORMATS);
  for (const [id, code] of customFormats) {
    numberFormats.set(id, code);
  }

  const sheetRanges =
    externSheet === undefined ? [] : readSheetRanges(externSheet, supBooks);

  return {
    sheets,
    sharedStrings,
    cellFormats,
    numberFormats,
    date1904,
    sheetRanges,
    palette,
    // Walked as its own pass over the same records rather than folded into the switch above: an Lbl's meaning depends only on the record itself, and keeping the whole built-in-print-name vocabulary in one module is what stops it leaking into this reader's general record loop.
    printNames: readPrintNames(records),
  };
}

/** [MS-XLS] 2.4.271's own cch table: a SupBook whose cch is exactly this value is a self-referencing supporting link -- this workbook itself -- rather than another workbook, a DDE/OLE data source, or an add-in. */
const SUPBOOK_SELF_REFERENCING_CCH = 0x0401;
/** The cch table's other named sentinel: an add-in-referencing supporting link, whose ExternName records name add-in functions this reader has no workbook or sheet to resolve a name from. */
const SUPBOOK_ADDIN_CCH = 0x3a01;
/** The inclusive cch range meaning "virtPath is present, and its own grammar (rather than a further sentinel) says what kind of supporting link this is" ([MS-XLS] 2.4.271's own cch table). */
const SUPBOOK_VIRTPATH_MAX_CCH = 0x00ff;
/** virtPath's own single-character sentinels ([MS-XLS] 31ed3738's own virtPath value table): a lone NUL marks a same-sheet reference, a lone SPACE an unused supporting link. */
const SUPBOOK_SAME_SHEET_CHAR = "\u0000";
const SUPBOOK_UNUSED_CHAR = " ";

/**
 * One SupBook record's own resolution, keyed by kind ([MS-XLS] 2.4.271's cch/virtPath table) -- see readSupBook. "self" needs no further data, since the workbook's own BoundSheet8 list already resolves it elsewhere. "external-workbook" carries what this reader could recover from virtPath and rgst. "unresolvable" carries a short, fixed diagnostic for every other kind (add-in, DDE/OLE data source, same-sheet, unused, a virtPath shape fileNameFromVirtPath's own deliberately partial VirtualPath decoding does not attempt, or a record too malformed for readSupBookSafely to finish reading at all).
 */
type SupBookInfo =
  | { readonly kind: "self" }
  | {
      readonly kind: "external-workbook";
      /** The workbook's own display name, isolated from virtPath by fileNameFromVirtPath -- undefined when virtPath uses a form that function does not decode (an absolute drive volume, a UNC share, a transfer-protocol URL), in which case the sheet name(s) below are still fully resolvable and are shown against a placeholder workbook label rather than being discarded. */
      readonly fileName: string | undefined;
      /** rgst, in the same zero-based order an XTI's own itabFirst/itabLast index into it ([MS-XLS] 5adbad90: "this value specifies the zero-based index of an XLUnicodeString in the rgst field"). */
      readonly sheetNames: readonly string[];
    }
  | { readonly kind: "unresolvable"; readonly diagnostic: string };

/**
 * SupBook ([MS-XLS] 2.4.271): a two-byte ctab, a two-byte cch, then -- for every kind but self-referencing and add-in-referencing -- a virtPath (an XLUnicodeStringNoCch, cch characters long) and, for an external-workbook or unused link specifically, ctab sheet names (XLUnicodeString) in rgst.
 */
function readSupBook(record: RecordGroup): SupBookInfo {
  const cursor = new BlockCursor(record.blocks);
  const ctab = cursor.u16();
  const cch = cursor.u16();
  if (cch === SUPBOOK_SELF_REFERENCING_CCH) {
    return { kind: "self" };
  }
  if (cch === SUPBOOK_ADDIN_CCH) {
    return { kind: "unresolvable", diagnostic: "add-in function reference" };
  }
  if (cch < 1 || cch > SUPBOOK_VIRTPATH_MAX_CCH) {
    return {
      kind: "unresolvable",
      diagnostic: `supporting link of unrecognised type (cch=0x${cch.toString(16).padStart(4, "0")})`,
    };
  }
  const virtPath = readXLUnicodeStringNoCch(cursor, cch);
  if (virtPath === SUPBOOK_SAME_SHEET_CHAR) {
    return { kind: "unresolvable", diagnostic: "same-sheet reference" };
  }
  if (virtPath === SUPBOOK_UNUSED_CHAR) {
    return { kind: "unresolvable", diagnostic: "unused supporting link" };
  }
  if (ctab === 0) {
    // Same-sheet, DDE, and OLE data source referencing all declare ctab reserved-zero ([MS-XLS] 2.4.271's own ctab table); a virtPath reaching here without matching either single-character sentinel above is therefore a DDE or OLE link, whose virtPath conforms to the grammar's own ole-link production (two path-strings joined by a single directory separator) rather than a plain file path this reader resolves a workbook name from.
    return {
      kind: "unresolvable",
      diagnostic: "DDE or OLE data source reference",
    };
  }
  const fileName = fileNameFromVirtPath(virtPath);
  const sheetNames: string[] = [];
  for (let index = 0; index < ctab; index += 1) {
    sheetNames.push(readXLUnicodeString(cursor));
  }
  return { kind: "external-workbook", fileName, sheetNames };
}

/**
 * readSupBook, degrading a malformed record (an rgst shorter than its own declared ctab, most concretely) to an unresolvable diagnostic rather than letting a BiffFormatError propagate out of this one SupBook and abort the whole globals read -- and with it, the whole workbook. This is entirely new territory added alongside external-3D-reference resolution: before it, this reader never walked a SupBook's own virtPath/rgst at all, so a malformed one had nothing here to trip over. The per-record boundary keeps the damage to the XTI entries that resolve through this one SupBook, which already carry their own `unresolvable` label path for every other kind this reader cannot fully resolve.
 */
function readSupBookSafely(record: RecordGroup): SupBookInfo {
  try {
    return readSupBook(record);
  } catch (error) {
    if (!(error instanceof BiffFormatError)) {
      throw error;
    }
    return { kind: "unresolvable", diagnostic: "malformed supporting link" };
  }
}

/** [MS-XLS] 480c3d2a's own VirtualPath grammar directory separator (U+0003) -- never a printable character a real file or sheet name may contain, so splitting on it to find the trailing segment is unambiguous. */
const VIRTPATH_DIRECTORY_SEPARATOR = "\u0003";

/** [MS-XLS] 480c3d2a's own two-character virt-path markers this reader still resolves a trailing file name through: rel-volume, startup, alt-startup, and library -- each %x0001 followed by one of these bytes, then file-path itself. Distinct from simple-file-path, whose own leading %x0001 (when present at all) stands ALONE, with no second marker byte, directly followed by file-path -- so any OTHER second character belongs to that file-path, not to a marker this function should also consume. */
const VIRTPATH_REL_VOLUME_MARKER = 0x02;
const VIRTPATH_STARTUP_MARKER = 0x06;
const VIRTPATH_ALT_STARTUP_MARKER = 0x07;
const VIRTPATH_LIBRARY_MARKER = 0x08;

/**
 * Isolates a plain trailing file name from a SupBook's own virtPath, when it uses one of the VirtualPath grammar's simpler forms: simple-file-path (no marker at all, or its own optional lone %x0001 with no second marker byte), or a genuine two-character marker saying the path is relative to the referencing workbook's own drive, the startup directory, the alternate startup directory, or the library directory (rel-volume/startup/alt-startup/library -- [MS-XLS] 480c3d2a's own virt-path alternatives). An absolute drive volume, a UNC share, or a transfer-protocol URL needs more of the grammar than a trailing path segment to reproduce faithfully, so those return undefined rather than a guess -- readSupBook's own caller then shows the sheet name(s) (still fully resolvable from rgst) against a placeholder workbook label instead of discarding them. file-path's own bracketed form (`"[" relative-path "]" sheet-name`, naming a sheet directly in the path rather than through SupBook's separate rgst array) is outside what this reader reconstructs too, and is declined the same way rather than folded into the file name and doubled up with the caller's own `[bookLabel]` bracketing.
 */
function fileNameFromVirtPath(virtPath: string): string | undefined {
  let path = virtPath;
  if (path.startsWith("\u0001")) {
    const marker = path.codePointAt(1);
    switch (marker) {
      // A volume/unc-volume (both open with a SECOND 0x01) or a transfer-protocol URL (whose own "count" field is a raw byte rather than a character this reader could safely treat as part of the path) needs more of the grammar than a trailing segment can supply.
      case 0x01:
      case 0x05:
        return undefined;
      case VIRTPATH_REL_VOLUME_MARKER:
      case VIRTPATH_STARTUP_MARKER:
      case VIRTPATH_ALT_STARTUP_MARKER:
      case VIRTPATH_LIBRARY_MARKER:
        path = path.slice(2);
        break;
      default:
        // simple-file-path: the lone %x0001 marker stands alone -- whatever follows (including this "marker" character, undefined when virtPath is the single byte on its own) is already the start of file-path itself, not a second marker byte to also discard.
        path = path.slice(1);
        break;
    }
  }
  if (path.length === 0) {
    return undefined;
  }
  const segments = path.split(VIRTPATH_DIRECTORY_SEPARATOR);
  const last = segments.at(-1);
  if (last === undefined || last.length === 0) {
    return undefined;
  }
  // A real file name never legitimately carries an unescaped bracket -- the grammar reserves both characters for the bracketed sheet-name form -- so any segment carrying one is declined exactly like that form is, rather than passed through with the bracket still embedded in it. Checked on the EXTRACTED FINAL SEGMENT rather than on the whole path up front: a bracketed sheet-name reached through a directory separator (`sub`, a separator, then `[Book.xlsx]Sheet1`) or an unbalanced bracket with no separator at all (`abc[def`) both leave the leading character untouched by a start-of-path check, and both would otherwise return a segment carrying a raw bracket as if it were a plain file name -- doubling up with resolveXti's own `[${fileName}]` bracketing into a mangled label, with the caller's own `diagnostic` flag left FALSE for it since this function has already reported success by returning a defined string.
  return last.includes("[") || last.includes("]") ? undefined : last;
}

/** A bracketed diagnostic placeholder for a sheet label this reader could not fully resolve -- deliberately distinct from Excel's own bare `#REF!` error literal (which is valid, retypeable formula syntax on its own): this always carries a parenthesised reason, and resolveSheetLabel's own quoting (biff/ptg.ts) wraps the whole thing in single quotes regardless, since neither the reason text nor the surrounding punctuation matches a bare sheet-name pattern. */
function diagnosticLabel(reason: string): string {
  return `#REF!(${reason})`;
}

/**
 * One XTI's own scope resolved against its SupBook -- a plain SheetRange when the SupBook is this same, self-referencing workbook and both sheet indices are real ([MS-XLS] 2.5.344's own `-1` "could not be found" and `-2` "workbook-level" sentinels aside), otherwise an ExternalSheetLabel carrying whatever this reader could recover (an external workbook's own file name and sheet name(s), when the SupBook resolves that far) or a diagnostic placeholder, for a supporting-link kind or a sheet index this reader does not resolve a name from at all.
 *
 * The SupBook's own kind is checked before the `-2` sentinel, not after: [MS-XLS] 2.5.344's itabFirst/itabLast table produces `-2` for a same-sheet, add-in, DDE, and OLE supporting link alike (none of them names a sheet at all), so treating every `-2` as a generic "workbook-level reference" before asking what kind of SupBook it belongs to would overwrite each of those already-specific `unresolvable` diagnostics with a less useful, wrong one. `-2` only means "workbook-level" for the two kinds that otherwise resolve a real sheet scope -- self and external-workbook -- so the sentinel is scoped to those.
 */
function resolveXti(
  supBook: SupBookInfo | undefined,
  itabFirst: number,
  itabLast: number,
): SheetRange | ExternalSheetLabel {
  if (supBook === undefined) {
    return {
      label: diagnosticLabel("supporting link index out of range"),
      diagnostic: true,
    };
  }
  if (supBook.kind === "unresolvable") {
    return { label: diagnosticLabel(supBook.diagnostic), diagnostic: true };
  }
  if (itabFirst === -2 || itabLast === -2) {
    return {
      label: diagnosticLabel("workbook-level reference"),
      diagnostic: true,
    };
  }
  if (supBook.kind === "self") {
    return itabFirst >= 0 && itabLast >= 0
      ? { firstSheetIndex: itabFirst, lastSheetIndex: itabLast }
      : { label: diagnosticLabel("sheet not found"), diagnostic: true };
  }
  const first = itabFirst >= 0 ? supBook.sheetNames[itabFirst] : undefined;
  const last = itabLast >= 0 ? supBook.sheetNames[itabLast] : undefined;
  if (first === undefined || last === undefined) {
    const bookLabel = supBook.fileName ?? "EXTERNAL";
    return {
      label: `[${bookLabel}]${diagnosticLabel("sheet not found")}`,
      diagnostic: true,
    };
  }
  if (supBook.fileName === undefined) {
    // The sheet name(s) are real, recovered data, but the workbook's own name is not -- "EXTERNAL" is this reader's own placeholder rather than anything the file actually said, so the label as a whole is still not safe to treat as real formula text.
    return {
      label: `[EXTERNAL]${first === last ? first : `${first}:${last}`}`,
      diagnostic: true,
    };
  }
  return {
    label: `[${supBook.fileName}]${first === last ? first : `${first}:${last}`}`,
    diagnostic: false,
  };
}

/** ExternSheet ([MS-XLS] 2.4.106): a two-byte cXTI then that many XTI structures ([MS-XLS] 2.5.344) -- a two-byte iSupBook and two signed 16-bit sheet-scope bounds each. iSupBook indexes the SupBook collection positionally, in the order those records appeared. */
function readSheetRanges(
  record: RecordGroup,
  supBooks: readonly SupBookInfo[],
): readonly (SheetRange | ExternalSheetLabel)[] {
  const cursor = new BlockCursor(record.blocks);
  const count = cursor.u16();
  const ranges: (SheetRange | ExternalSheetLabel)[] = [];
  for (let index = 0; index < count; index += 1) {
    const iSupBook = cursor.u16();
    const itabFirst = cursor.i16();
    const itabLast = cursor.i16();
    ranges.push(resolveXti(supBooks[iSupBook], itabFirst, itabLast));
  }
  return ranges;
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
  const totalBytes = recordByteLength(record);
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

/** XF ([MS-XLS] 2.4.353): a font index, a number-format identifier, a flags field whose fStyle bit says whether the trailing payload is a CellXF or a StyleXF, then that 14-byte trailing payload itself -- the leading alignment word xf-colors.ts's unpackXfAlignment resolves into this format's own `alignment`, then the border word, fill-pattern word, and fill-colour word its unpackXfDecoration resolves into this format's own `decoration`. CellXF and StyleXF share the identical alignment/border/fill bit layout ([MS-XLS] 2.4.353's own field table), so this reads both shapes uniformly regardless of isStyle -- a cell only ever references a CellXF entry by its own ixfe (workbook/sheet.ts's cell reading), so a StyleXF's alignment/decoration are parsed but never consulted downstream. */
function readCellFormat(record: RecordGroup): CellFormat {
  const cursor = new BlockCursor(record.blocks);
  const fontIndex = cursor.u16();
  const formatId = cursor.u16();
  const flags = cursor.u16();
  const word1 = cursor.u32();
  const word2 = cursor.u32();
  const word3 = cursor.u32();
  const word4 = cursor.u16();
  return {
    fontIndex,
    formatId,
    isStyle: (flags & XF_FLAG_STYLE) !== 0,
    alignment: unpackXfAlignment(word1),
    decoration: unpackXfDecoration(word2, word3, word4),
  };
}

/**
 * Palette ([MS-XLS] 2.4.188): ccv, a signed colour count the spec states "MUST be 56", then that many LongRGB entries -- the write-side mirror is xf-writer.ts's own writePaletteRecord.
 *
 * A ccv that is not 56 is refused rather than honoured. This reader resolves every icv 8-63 positionally through this table, so a short (or zero, or negative) one does not degrade gracefully: every colour past its end silently becomes unresolvable, and a workbook's fills and borders all vanish at once with nothing to say why. A file declaring a count its own spec forbids is malformed, and saying so is the only honest answer.
 */
function readPalette(record: RecordGroup): readonly Color[] {
  const cursor = new BlockCursor(record.blocks);
  const count = cursor.i16();
  if (count !== PALETTE_ENTRY_COUNT) {
    throw new BiffFormatError(
      `Palette declares ${count} colour entries, but [MS-XLS] 2.4.188's own ccv field MUST be ${PALETTE_ENTRY_COUNT}`,
    );
  }
  const colors: Color[] = [];
  for (let index = 0; index < count; index += 1) {
    colors.push(readLongRgbColor(cursor));
  }
  return colors;
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
