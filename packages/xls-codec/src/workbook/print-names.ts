import type {
  ContentSheetPrintRange,
  ContentSheetRepeatRange,
} from "document-schema.js";

import { RecordBuilder } from "../biff/builder";
import { BlockCursor } from "../biff/cursor";
import { RECORD_LBL } from "../biff/record-types";
import { writeRecord } from "../biff/record-writer";
import type { RecordGroup } from "../biff/substreams";

// A sheet's print RANGE and its repeated header rows/columns are not in the worksheet substream at all. BIFF8 keeps them in the globals substream, as ordinary defined names ([MS-XLS] 2.4.150's Lbl record) that happen to carry a built-in name index rather than a user-typed name: Print_Area (index 0x06) for the range that prints, Print_Titles (index 0x07) for the bands repeated on every page. Both are LOCAL names -- scoped to one sheet through Lbl's own itab, a one-based index into the BoundSheet8 collection -- which is what lets a workbook carry a different print area per sheet.
//
// This module is both directions of exactly those two names, and nothing else: no other defined name is read (a user-defined name has nowhere to land in document-schema.js's spreadsheet model) or written. It sits in workbook/ rather than biff/ because a print name is a workbook-level fact keyed by sheet, which is what globals.ts reads and globals-writer.ts writes.
//
// The value of each name is a NameParsedFormula ([MS-XLS] 2.5.198.64) -- the same compiled Ptg token stream a cell formula uses. biff/ptg.ts is deliberately not reused for it: that module rebuilds INFIX TEXT for display, and what is wanted here is the range's own four coordinates, which a re-parse of the text it produced would have to recover all over again. The token vocabulary a print name actually uses is also much narrower than a formula's, and includes two tokens ptg.ts explicitly does not resolve (the union operator joining a Print_Titles pair, and the mem token wrapping it).

/** The built-in name index a Print_Area Lbl carries in place of a name ([MS-XLS] 2.4.150's own built-in name table). */
const BUILTIN_NAME_PRINT_AREA = 0x06;
/** The same table's Print_Titles entry. */
const BUILTIN_NAME_PRINT_TITLES = 0x07;

/** Lbl.grbit's fBuiltin bit -- field F of [MS-XLS] 2.4.150 (fHidden, fFunc, fOB, fProc, fCalcExp, fBuiltin, fGrp (6 bits), reserved1, fPublished, fWorkbookParam, reserved2). */
const LBL_FLAG_BUILTIN = 0x0020;

/** The Ptg opcodes a print name's own token stream is built from ([MS-XLS] 2.5.198.25's enumeration). Each reference-class token shares its layout with its value- and array-class spellings, exactly as biff/ptg.ts documents, so all three are accepted. */
const PTG_UNION = 0x10;
const PTG_PAREN = 0x15;
const PTG_REF3D_REF = 0x3a;
const PTG_REF3D_VALUE = 0x5a;
const PTG_REF3D_ARRAY = 0x7a;
const PTG_AREA3D_REF = 0x3b;
const PTG_AREA3D_VALUE = 0x5b;
const PTG_AREA3D_ARRAY = 0x7b;
const PTG_MEMAREA_REF = 0x26;
const PTG_MEMAREA_VALUE = 0x46;
const PTG_MEMAREA_ARRAY = 0x66;
const PTG_MEMFUNC_REF = 0x29;
const PTG_MEMFUNC_VALUE = 0x49;
const PTG_MEMFUNC_ARRAY = 0x69;

/** PtgMemArea ([MS-XLS] 2.5.198.70) carries four unused bytes ahead of its own cce, where PtgMemFunc ([MS-XLS] 2.5.198.71) carries none. */
const PTG_MEMAREA_UNUSED_BYTES = 4;

/** BIFF8's own grid ceilings, which are also how a Print_Titles band says which axis it repeats: a band covering every column of the sheet is a ROW band, and one covering every row is a COLUMN band. */
const MAX_ROW_INDEX = 0xffff;
const MAX_COLUMN_INDEX = 0x00ff;

/** One sheet's print names, as the Lbl records of the globals substream carry them. Every field is absent when the workbook declares no such name for that sheet. */
export interface SheetPrintNames {
  readonly printRange?: ContentSheetPrintRange;
  readonly repeatRows?: ContentSheetRepeatRange;
  readonly repeatColumns?: ContentSheetRepeatRange;
}

/** A rectangular area exactly as a PtgArea3d/PtgRef3d token states it, before deciding what it means. */
interface RawArea {
  readonly rowFirst: number;
  readonly rowLast: number;
  readonly columnFirst: number;
  readonly columnLast: number;
}

/**
 * Reads every Lbl record in a globals substream into per-sheet print names, keyed by ZERO-based sheet index -- Lbl's own itab is one-based, and a sheet index everywhere else in this package is not.
 *
 * A name this reader does not act on leaves nothing behind rather than failing the workbook: a user-defined name (fBuiltin clear), a built-in name other than the two below, a workbook-scoped one (itab 0, which no real producer uses for a print area since a print area belongs to a sheet), and a name whose token stream holds a construct outside the narrow vocabulary parsePrintAreas resolves are all simply not carried. The sheet then reads with no printRange or repeat bands, which is the same answer a sheet that genuinely declares none gives.
 */
export function readPrintNames(
  records: readonly RecordGroup[],
): ReadonlyMap<number, SheetPrintNames> {
  const bySheet = new Map<number, SheetPrintNames>();
  for (const record of records) {
    if (record.type !== RECORD_LBL) {
      continue;
    }
    const label = readLbl(record);
    if (label === undefined) {
      continue;
    }
    const existing = bySheet.get(label.sheetIndex) ?? {};
    if (label.builtinName === BUILTIN_NAME_PRINT_AREA) {
      const range = printRangeOf(label.areas);
      if (range !== undefined) {
        bySheet.set(label.sheetIndex, { ...existing, printRange: range });
      }
    } else {
      bySheet.set(label.sheetIndex, {
        ...existing,
        ...repeatBandsOf(label.areas),
      });
    }
  }
  return bySheet;
}

interface ParsedLbl {
  /** Zero-based, converted from Lbl's own one-based itab. */
  readonly sheetIndex: number;
  readonly builtinName: number;
  readonly areas: readonly RawArea[];
}

/**
 * Lbl ([MS-XLS] 2.4.150): a two-byte grbit, chKey, cch, cce, a two-byte reserved3, itab, four reserved bytes, the Name as an XLUnicodeStringNoCch, then cce bytes of rgce.
 *
 * A built-in name's Name field is that string holding exactly one character whose code unit IS the built-in index ([MS-XLS] 2.4.150: "Each built-in name has a zero-based index value associated with it. A built-in name or its index value MUST be used for this field."), so cch is 1 and the character is read rather than the spelled-out name. A built-in name spelled out in full instead is not resolved -- no producer writes one, and inventing a name-string table to match against would be guessing at which spelling and which locale.
 */
function readLbl(record: RecordGroup): ParsedLbl | undefined {
  const cursor = new BlockCursor(record.blocks);
  const grbit = cursor.u16();
  if ((grbit & LBL_FLAG_BUILTIN) === 0) {
    return undefined;
  }
  cursor.skip(1); // chKey: the macro shortcut key, zero for a name that is not a macro.
  const cch = cursor.u8();
  const cce = cursor.u16();
  cursor.skip(2); // reserved3
  const itab = cursor.u16();
  cursor.skip(4); // reserved4 through reserved7
  // XLUnicodeStringNoCch ([MS-XLS] 2.5.296): a flags byte then the characters, the count coming from the record's own cch above. A built-in name is one compressed character, so anything else is a name this reader does not resolve.
  const highByte = (cursor.u8() & 0x01) !== 0;
  if (cch !== 1 || highByte) {
    return undefined;
  }
  const builtinName = cursor.u8();
  if (
    builtinName !== BUILTIN_NAME_PRINT_AREA &&
    builtinName !== BUILTIN_NAME_PRINT_TITLES
  ) {
    return undefined;
  }
  // itab 0 is a workbook-scoped name, which a print area never is: [MS-XLS] 2.4.150 defines a non-zero itab as "a one-based index to the collection of BoundSheet8 records", and a print area belongs to exactly one of those sheets.
  if (itab === 0) {
    return undefined;
  }
  const areas = parsePrintAreas(cursor.take(cce));
  return areas === undefined
    ? undefined
    : { sheetIndex: itab - 1, builtinName, areas };
}

/**
 * Walks a print name's own rgce into the areas it names, or returns undefined for a token stream outside this vocabulary.
 *
 * The whole vocabulary is: a 3D area or single-cell reference (the areas themselves), the union operator joining two of them in a Print_Titles that repeats both a row band and a column band, a mem token wrapping that union (a real producer emits one -- LibreOffice writes PtgMemFunc, Excel may write PtgMemArea -- to say the enclosed reference expression is a single reference result), and PtgParen, a pure display token restating parentheses. Nothing else appears in a print name a spreadsheet application produced, and anything else aborts rather than being partially resolved: half a print range is a wrong print range, not a smaller one.
 *
 * A mem token's own cce covers exactly the sub-expression that follows it, which is the rest of this stream in every real case, so it is read past rather than used to bound a nested parse -- the tokens after it are walked by this same loop either way.
 */
function parsePrintAreas(rgce: Uint8Array<ArrayBuffer>): RawArea[] | undefined {
  const cursor = new BlockCursor([rgce]);
  const areas: RawArea[] = [];
  while (cursor.remainingInBlock() > 0) {
    const opcode = cursor.u8();
    switch (opcode) {
      case PTG_AREA3D_REF:
      case PTG_AREA3D_VALUE:
      case PTG_AREA3D_ARRAY: {
        cursor.skip(2); // ixti: the sheet the reference names. A local name's own itab already says which sheet this print area belongs to, so resolving the ixti through EXTERNSHEET would only re-derive it.
        areas.push(readArea(cursor));
        break;
      }
      case PTG_REF3D_REF:
      case PTG_REF3D_VALUE:
      case PTG_REF3D_ARRAY: {
        cursor.skip(2); // ixti, as above
        const row = cursor.u16();
        const column = cursor.u16() & 0x3fff;
        areas.push({
          rowFirst: row,
          rowLast: row,
          columnFirst: column,
          columnLast: column,
        });
        break;
      }
      case PTG_MEMAREA_REF:
      case PTG_MEMAREA_VALUE:
      case PTG_MEMAREA_ARRAY:
        cursor.skip(PTG_MEMAREA_UNUSED_BYTES);
        cursor.skip(2); // cce
        break;
      case PTG_MEMFUNC_REF:
      case PTG_MEMFUNC_VALUE:
      case PTG_MEMFUNC_ARRAY:
        cursor.skip(2); // cce
        break;
      case PTG_UNION:
      case PTG_PAREN:
        break;
      default:
        return undefined;
    }
  }
  return areas;
}

/** RgceArea ([MS-XLS] 2.5.198.105), as PtgArea3d carries it: both row bounds, then both ColRelU column fields, whose low 14 bits hold the column index and whose top two bits say whether each coordinate is relative. A print name's coordinates are always absolute in practice, and are read as plain indices either way -- ContentSheetPrintRange has no relative/absolute distinction to carry one into. */
function readArea(cursor: BlockCursor): RawArea {
  const rowFirst = cursor.u16();
  const rowLast = cursor.u16();
  const columnFirst = cursor.u16() & 0x3fff;
  const columnLast = cursor.u16() & 0x3fff;
  return { rowFirst, rowLast, columnFirst, columnLast };
}

/** A Print_Area name's own range. A name declaring several disjoint areas -- legal in BIFF8, and what Excel writes for a multi-area print selection -- yields only the first: ContentSheetPrintSettings.printRange models one rectangle, and merging several into their bounding box would claim cells print that do not. */
function printRangeOf(
  areas: readonly RawArea[],
): ContentSheetPrintRange | undefined {
  const area = areas[0];
  return area === undefined
    ? undefined
    : {
        startRow: area.rowFirst,
        startColumn: area.columnFirst,
        endRow: area.rowLast,
        endColumn: area.columnLast,
      };
}

/**
 * A Print_Titles name's own repeated bands, classified by shape.
 *
 * BIFF8 has no field saying which axis a title band repeats along: a repeated row band is written as an area spanning every column of the sheet ($1:$2, columns 0-255), and a repeated column band as one spanning every row ($A:$A, rows 0-65535). The shape IS the discriminant, and an area that spans both axes at once names the whole sheet, which is neither -- so it is left unclassified rather than being assigned to whichever branch happened to be tested first.
 */
function repeatBandsOf(areas: readonly RawArea[]): {
  repeatRows?: ContentSheetRepeatRange;
  repeatColumns?: ContentSheetRepeatRange;
} {
  const bands: {
    repeatRows?: ContentSheetRepeatRange;
    repeatColumns?: ContentSheetRepeatRange;
  } = {};
  for (const area of areas) {
    const spansEveryRow = area.rowFirst === 0 && area.rowLast === MAX_ROW_INDEX;
    const spansEveryColumn =
      area.columnFirst === 0 && area.columnLast === MAX_COLUMN_INDEX;
    if (spansEveryColumn && !spansEveryRow) {
      bands.repeatRows = { start: area.rowFirst, end: area.rowLast };
    } else if (spansEveryRow && !spansEveryColumn) {
      bands.repeatColumns = { start: area.columnFirst, end: area.columnLast };
    }
  }
  return bands;
}

// --- Write side ---

/** One Lbl record to write: which sheet it is scoped to, and the areas its own token stream names. */
export interface PrintNamePlanEntry {
  /** Zero-based; written out as Lbl's own one-based itab. */
  readonly sheetIndex: number;
  /** The ixti a PtgArea3d in this name's token stream refers to -- an index into the ExternSheet record's own XTI array, which globals-writer.ts writes one entry of per sheet. */
  readonly ixti: number;
  readonly builtinName: number;
  readonly areas: readonly RawArea[];
}

/** The Print_Area and Print_Titles entries one sheet's print settings need, or an empty list when it declares neither a print range nor a repeated band. */
export function printNameEntriesFor(
  sheetIndex: number,
  ixti: number,
  settings: {
    readonly printRange?: ContentSheetPrintRange;
    readonly repeatRows?: ContentSheetRepeatRange;
    readonly repeatColumns?: ContentSheetRepeatRange;
  },
): PrintNamePlanEntry[] {
  const entries: PrintNamePlanEntry[] = [];
  if (settings.printRange !== undefined) {
    entries.push({
      sheetIndex,
      ixti,
      builtinName: BUILTIN_NAME_PRINT_AREA,
      areas: [
        {
          rowFirst: settings.printRange.startRow,
          rowLast: settings.printRange.endRow,
          columnFirst: settings.printRange.startColumn,
          columnLast: settings.printRange.endColumn,
        },
      ],
    });
  }
  // Written in the order the read side classifies them by shape rather than by position, so the two need not agree on an ordering -- but a column band first is what a real LibreOffice-written Print_Titles carries, and matching it keeps the bytes comparable against one.
  const titleAreas: RawArea[] = [];
  if (settings.repeatColumns !== undefined) {
    titleAreas.push({
      rowFirst: 0,
      rowLast: MAX_ROW_INDEX,
      columnFirst: settings.repeatColumns.start,
      columnLast: settings.repeatColumns.end,
    });
  }
  if (settings.repeatRows !== undefined) {
    titleAreas.push({
      rowFirst: settings.repeatRows.start,
      rowLast: settings.repeatRows.end,
      columnFirst: 0,
      columnLast: MAX_COLUMN_INDEX,
    });
  }
  if (titleAreas.length > 0) {
    entries.push({
      sheetIndex,
      ixti,
      builtinName: BUILTIN_NAME_PRINT_TITLES,
      areas: titleAreas,
    });
  }
  return entries;
}

/** PtgArea3d ([MS-XLS] 2.5.198.28), reference class: the opcode, the ixti, then an RgceArea. Every coordinate is written absolute (both ColRelU relative bits clear), which is what a print name means -- a print area does not move relative to anything. */
function writeArea3d(ixti: number, area: RawArea): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u8(PTG_AREA3D_REF)
    .u16(ixti)
    .u16(area.rowFirst)
    .u16(area.rowLast)
    .u16(area.columnFirst)
    .u16(area.columnLast)
    .build();
}

/**
 * One Lbl record ([MS-XLS] 2.4.150) for a built-in print name, the write-side mirror of readLbl above.
 *
 * A single area is written as a bare PtgArea3d. Two are written as [MS-XLS] 2.5.198.71's own mem-area-expression shape -- PtgMemFunc carrying the byte count of what follows, then the two areas and the PtgUnion joining them -- which is what says the pair is one reference result rather than two loose operands, and is byte-for-byte the structure a real LibreOffice-written Print_Titles carries for the same pair.
 */
function writePrintNameRecord(
  entry: PrintNamePlanEntry,
): Uint8Array<ArrayBuffer> {
  const areaTokens = entry.areas.map((area) => writeArea3d(entry.ixti, area));
  const expression = new RecordBuilder();
  for (const token of areaTokens) {
    expression.bytes(token);
  }
  for (let index = 1; index < areaTokens.length; index += 1) {
    expression.u8(PTG_UNION);
  }
  const expressionBytes = expression.build();
  const rgce =
    areaTokens.length > 1
      ? new RecordBuilder()
          .u8(PTG_MEMFUNC_REF)
          .u16(expressionBytes.length)
          .bytes(expressionBytes)
          .build()
      : expressionBytes;

  const data = new RecordBuilder()
    .u16(LBL_FLAG_BUILTIN)
    .u8(0) // chKey: "MUST be 0 (no shortcut key) if fFunc is 1 or if fProc is 0", and this name is neither a macro nor a procedure.
    .u8(1) // cch: a built-in name is the single character holding its own index.
    .u16(rgce.length)
    .u16(0) // reserved3
    .u16(entry.sheetIndex + 1) // itab, one-based
    .u32(0) // reserved4 through reserved7
    .u8(0) // the Name's own XLUnicodeStringNoCch flags byte: compressed, one byte per character
    .u8(entry.builtinName)
    .bytes(rgce)
    .build();
  return writeRecord(RECORD_LBL, data);
}

/** Every planned print name as its own Lbl record, in the order given. */
export function writePrintNameRecords(
  entries: readonly PrintNamePlanEntry[],
): Uint8Array<ArrayBuffer>[] {
  return entries.map(writePrintNameRecord);
}
