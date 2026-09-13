import { columnLettersToIndex } from "document-schema.js";
import type { ContentDefinedName } from "document-schema.js";

import { RecordBuilder } from "../biff/builder";
import { BlockCursor } from "../biff/cursor";
import { parseFormulaText, type FormulaSheetContext } from "../biff/ptg";
import { RECORD_LBL } from "../biff/record-types";
import { writeRecord } from "../biff/record-writer";
import { recoverFromFormatError } from "../biff/records";
import { readXLUnicodeStringNoCch } from "../biff/strings";
import { writeXLUnicodeStringNoCch } from "../biff/string-writer";
import { BiffWriteError } from "../biff/write-errors";
import type { RecordGroup } from "../biff/substreams";

// A workbook's own defined names, as the Lbl records ([MS-XLS] 2.4.150, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/d148e898-4504-4841-a793-ee85f3ea9eef) of its globals substream carry them -- one record per name, each scoped either to the whole workbook (itab 0) or to one sheet (a non-zero itab, a one-based index into the BoundSheet8 collection). The workbook/ half of the module: content.ts maps these onto document-schema.js's own document-level `names` array, translating that BoundSheet8 scope into the document's own sheets-array index.
//
// The read half lives here and the write half below in the same module, so the one record layout and the one built-in-name table have the one home -- the discipline print-names.ts already draws for the two built-in print names, which this module deliberately does NOT touch: _xlnm.Print_Area and _xlnm.Print_Titles are print-settings facts that print-names.ts reads onto ContentSheetPrintSettings and writes back from there, so surfacing them as document-level names too would state one fact twice and write one Lbl record twice.

/** Lbl.grbit's fBuiltin bit -- field F of [MS-XLS] 2.4.150's own grbit layout. */
const LBL_FLAG_BUILTIN = 0x0020;

/** [MS-XLS] 2.4.150's own built-in name table: the index a built-in name's single-character Name field carries, and the name it spells. The `_xlnm.` prefix is ECMA-376's own reserved spelling for the identical names in an xlsx (the two print ones confirmed against real LibreOffice-written markup in ooxml.js's own fixture), so a built-in rides through the shared schema under the spelling every other member of this format family already uses for it. */
const BUILTIN_NAME_SPELLINGS: readonly string[] = [
  "_xlnm.Consolidate_Area", // 0x00
  "_xlnm.Auto_Open", // 0x01
  "_xlnm.Auto_Close", // 0x02
  "_xlnm.Extract", // 0x03
  "_xlnm.Database", // 0x04
  "_xlnm.Criteria", // 0x05
  "_xlnm.Print_Area", // 0x06
  "_xlnm.Print_Titles", // 0x07
  "_xlnm.Recorder", // 0x08
  "_xlnm.Data_Form", // 0x09
  "_xlnm.Auto_Activate", // 0x0A
  "_xlnm.Auto_Deactivate", // 0x0B
  "_xlnm.Sheet_Title", // 0x0C
  "_xlnm._FilterDatabase", // 0x0D
];

/** The two built-in names print-names.ts owns end to end: read there onto ContentSheetPrintSettings, written there from them, and therefore skipped here rather than stated twice. */
const BUILTIN_NAME_PRINT_AREA = 0x06;
const BUILTIN_NAME_PRINT_TITLES = 0x07;

/** The `_xlnm.` prefix ECMA-376 reserves for built-in defined names, which is also the spelling this package reads them under -- so a name carrying it on write resolves back through the built-in table below, and one the table does not know is refused rather than written as a user name Excel itself forbids the prefix for. */
const XLNM_PREFIX = "_xlnm.";

/** One defined name as an Lbl record states it, before content.ts translates its scope. */
export interface RawDefinedName {
  readonly name: string;
  /** The formula text a spreadsheet application would show for the name's Refers To box, rebuilt from the record's own compiled Ptg stream by the same parser a cell formula's uses. */
  readonly refersTo: string;
  /** Zero-based index into the FULL BoundSheet8 collection ([MS-XLS] 2.4.150's itab is one-based); undefined for a workbook-scoped name (itab 0). */
  readonly sheetIndex: number | undefined;
}

/**
 * Reads every Lbl record in a globals substream into a defined name, or skips it: the two print built-ins (print-names.ts owns them), a built-in index past the table above (no spelling to give it), a name whose rgce resolves to no formula text (a construct outside parseFormulaText's vocabulary, or a stream too malformed to walk -- ContentDefinedNameSchema requires refersTo, and a fabricated placeholder is not formula text), and a record whose own bytes overrun (caught per record rather than letting one malformed Lbl abort every other name, the identical per-record boundary sheet.ts's resolveFormulaText draws for a malformed cell formula).
 */
export function readDefinedNames(
  records: readonly RecordGroup[],
  formulaSheets: FormulaSheetContext,
): readonly RawDefinedName[] {
  const names: RawDefinedName[] = [];
  for (const record of records) {
    if (record.type !== RECORD_LBL) {
      continue;
    }
    const parsed = readLblRecord(record, formulaSheets);
    if (parsed !== undefined) {
      names.push(parsed);
    }
  }
  return names;
}

/** Lbl ([MS-XLS] 2.4.150): grbit, chKey, cch, cce, reserved3, itab, four reserved bytes, the Name as an XLUnicodeStringNoCch, then cce bytes of rgce (NameParsedFormula) and whatever rgcb trailer follows. */
function readLblRecord(
  record: RecordGroup,
  formulaSheets: FormulaSheetContext,
): RawDefinedName | undefined {
  try {
    const cursor = new BlockCursor(record.blocks);
    const grbit = cursor.u16();
    const isBuiltin = (grbit & LBL_FLAG_BUILTIN) !== 0;
    cursor.skip(1); // chKey: the macro shortcut key, zero for a name that is not a macro
    const cch = cursor.u8();
    const cce = cursor.u16();
    cursor.skip(2); // reserved3
    const itab = cursor.u16();
    cursor.skip(4); // reserved4 through reserved7
    let name: string;
    if (isBuiltin) {
      // A built-in name's Name field is that string holding exactly one character whose code unit IS the built-in index ([MS-XLS] 2.4.150: "Each built-in name has a zero-based index value associated with it. A built-in name or its index value MUST be used for this field."), so cch is 1 and the character is read rather than the spelled-out name.
      const highByte = (cursor.u8() & 0x01) !== 0;
      if (cch !== 1 || highByte) {
        return undefined;
      }
      const builtinIndex = cursor.u8();
      if (
        builtinIndex === BUILTIN_NAME_PRINT_AREA ||
        builtinIndex === BUILTIN_NAME_PRINT_TITLES
      ) {
        return undefined;
      }
      const spelling = BUILTIN_NAME_SPELLINGS[builtinIndex];
      if (spelling === undefined) {
        return undefined;
      }
      name = spelling;
    } else {
      name = readXLUnicodeStringNoCch(cursor, cch);
    }
    const rgce = cursor.take(cce);
    // NameParsedFormula's own rgcb trailer ([MS-XLS] 2.5.198.64) is never length-declared: it is whatever bytes remain once rgce is accounted for, exactly the inference sheet.ts's own Array-group reading makes for the identical structure. Handing it to parseFormulaText is what lets a name whose value is an array constant still resolve rather than fail on its PtgArray tokens.
    const rgcb = cursor.take(cursor.remainingInBlock());
    const refersTo = parseFormulaText(rgce, formulaSheets, { rgcb });
    return refersTo === undefined
      ? undefined
      : {
          name,
          refersTo,
          sheetIndex: itab === 0 ? undefined : itab - 1,
        };
  } catch (error) {
    recoverFromFormatError(error, undefined);
    return undefined;
  }
}

// --- Write side ---

/** One Lbl record to write: the name (user-spelled, or a built-in index when the entry's name is an _xlnm spelling), the sheet it is scoped to, and the compiled token stream of what it refers to. */
export interface DefinedNamePlanEntry {
  readonly name: string;
  /** The built-in name index, when `name` is an _xlnm spelling this package knows -- undefined for a user-defined name. */
  readonly builtinName: number | undefined;
  /** Zero-based position in the document's own sheets array; undefined for a workbook-scoped name. */
  readonly sheetIndex: number | undefined;
  readonly rgce: Uint8Array<ArrayBuffer>;
}

/** The reverse of BUILTIN_NAME_SPELLINGS: an _xlnm spelling back to the built-in index a single-character Name field would carry. */
const BUILTIN_INDEX_BY_NAME = new Map(
  BUILTIN_NAME_SPELLINGS.map((spelling, index) => [spelling, index] as const),
);

/** One corner of an A1-style reference as the refersTo text states it: the 0-based row/column plus each coordinate's own $ marker, which is what decides the ColRelU relative bits the written token carries. */
interface ReferenceCorner {
  readonly row: number;
  readonly column: number;
  readonly columnAbsolute: boolean;
  readonly rowAbsolute: boolean;
}

/** A single A1-style corner, with or without its $ markers -- the identical shape biff/ptg.ts's own formatPoint produces, parsed back the other way. A `$` is honoured per coordinate rather than normalised away, because a relative coordinate in a defined name is genuine, retypeable formula semantics Excel re-interprets against the name's own scope, not a display detail. */
const REFERENCE_CORNER_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,5})$/;

/** A full refersTo this writer can compile: one sheet-qualified corner or corner pair, nothing more. */
const SHEET_QUALIFIED_REFERENCE_RE =
  /^(.*)!((?:\$?[A-Za-z]{1,3}\$?[0-9]{1,5})(?::(?:\$?[A-Za-z]{1,3}\$?[0-9]{1,5}))?)$/;

/** A user-defined name shaped like a cell reference ("A1", "$B$2", "A1:B2") is forbidden by [MS-XLS] 2.5.295's own name restrictions, since a formula using it would be indistinguishable from the reference itself. */
const CELL_REFERENCE_NAME_RE =
  /^\$?[A-Za-z]{1,3}\$?[0-9]{1,5}(:\$?[A-Za-z]{1,3}\$?[0-9]{1,5})?$/;

function parseCorner(text: string): ReferenceCorner | undefined {
  const match = REFERENCE_CORNER_RE.exec(text);
  if (match === null) {
    return undefined;
  }
  const column = columnLettersToIndex(match[2] ?? "");
  const row = Number.parseInt(match[4] ?? "", 10) - 1;
  if (column === undefined || row < 0) {
    return undefined;
  }
  return {
    row,
    column,
    columnAbsolute: (match[1] ?? "") === "$",
    rowAbsolute: (match[3] ?? "") === "$",
  };
}

/** BIFF8's own grid ceilings, which a defined name's reference shares with every other reference in the format. */
const MAX_ROW_INDEX = 0xffff;
const MAX_COLUMN_INDEX = 0x00ff;

/** ColRelU's own relative bits ([MS-XLS] 2.5.198.105): bit 14 (0x4000) says the COLUMN coordinate is relative, bit 15 (0x8000) the ROW -- clear means absolute, exactly as biff/ptg.ts's pointFrom decodes them on read. */
const COLUMN_RELATIVE_BIT = 0x4000;
const ROW_RELATIVE_BIT = 0x8000;

/** PtgArea3d, reference class ([MS-XLS] 2.5.198.28): opcode 0x3b, the ixti, then an RgceArea -- the same token write-side print-names.ts builds for a print name's range, since a defined name has no other way to say which sheet its reference is on. */
function writeArea3dToken(
  ixti: number,
  first: ReferenceCorner,
  last: ReferenceCorner,
): Uint8Array<ArrayBuffer> {
  const columnFieldOf = (corner: ReferenceCorner): number =>
    corner.column |
    (corner.columnAbsolute ? 0 : COLUMN_RELATIVE_BIT) |
    (corner.rowAbsolute ? 0 : ROW_RELATIVE_BIT);
  return new RecordBuilder()
    .u8(0x3b)
    .u16(ixti)
    .u16(first.row)
    .u16(last.row)
    .u16(columnFieldOf(first))
    .u16(columnFieldOf(last))
    .build();
}

/** Strips the single-quote wrapping a sheet label carries when the sheet name is not a bare identifier, unescaping the doubled quote inside -- the inverse of biff/ptg.ts's quoteSheetLabel. A string must actually be quoted on both ends to unwrap; a bare name is taken verbatim. */
function unquoteSheetLabel(label: string): string {
  if (label.startsWith("'") && label.endsWith("'") && label.length >= 2) {
    return label.slice(1, -1).replaceAll("''", "'");
  }
  return label;
}

/**
 * Compiles the document's defined names into the Lbl records the workbook stream carries.
 *
 * The refersTo vocabulary this writer can compile is exactly one sheet-qualified A1 reference -- `Sheet1!$A$1`, `Sheet1!$A$1:$B$2`, the sheet name quoted when it is not a bare identifier -- which is the shape every named range carries and the shape this package's own reader produces for one. A refersTo outside that vocabulary (a computed formula, a constant, an external-workbook reference) throws a BiffWriteError naming the construct rather than emitting a token stream this writer cannot prove round-trips, the identical refusal the cell-formula writer draws for the constructs outside its own vocabulary.
 */
export function definedNameEntriesFor(
  names: readonly ContentDefinedName[],
  sheets: readonly { readonly name: string }[],
): DefinedNamePlanEntry[] {
  return names.map((defined) => {
    const builtinName = defined.name.startsWith(XLNM_PREFIX)
      ? builtinIndexOf(defined.name)
      : undefined;
    if (builtinName === undefined) {
      validateUserName(defined.name);
    }
    return {
      name: defined.name,
      builtinName,
      sheetIndex: scopeOf(defined, sheets.length),
      rgce: compileRefersTo(defined, sheets).rgce,
    };
  });
}

/** Resolves an _xlnm spelling to its built-in index, refusing the two print built-ins (print-names.ts owns them -- a document stating its print area as a names entry is stating a fact the print settings already carry, and writing both would emit the same Lbl record twice) and any spelling the table does not know. */
function builtinIndexOf(name: string): number {
  const index = BUILTIN_INDEX_BY_NAME.get(name);
  if (index === undefined) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(name)}: the "_xlnm." prefix is reserved for built-in names, and this one is not in [MS-XLS] 2.4.150's own built-in name table`,
    );
  }
  if (
    index === BUILTIN_NAME_PRINT_AREA ||
    index === BUILTIN_NAME_PRINT_TITLES
  ) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(name)}: the print built-ins are print-settings facts, stated through a sheet's printSettings (printRange/repeatRows/repeatColumns) rather than as document-level names -- writing both would emit the same Lbl record twice`,
    );
  }
  return index;
}

/** A user-defined name must fit the record's own one-byte cch and must not be shaped like a cell reference, the one restriction of [MS-XLS] 2.5.295's own name grammar a writer can enforce without guessing at Excel's full validity table. */
function validateUserName(name: string): void {
  if (name.length < 1 || name.length > 0xff) {
    throw new BiffWriteError(
      `xls-codec cannot write a defined name of ${name.length} characters: Lbl's own cch field is one byte, so a name must be 1-255 UTF-16 code units`,
    );
  }
  if (CELL_REFERENCE_NAME_RE.test(name)) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(name)}: a name shaped like a cell reference is forbidden, since a formula using it would be indistinguishable from the reference itself`,
    );
  }
}

/** A scopeSheetIndex past the end of the document's own sheets array names a sheet that does not exist, so it is refused rather than written as an itab no BoundSheet8 answers to. */
function scopeOf(
  defined: ContentDefinedName,
  sheetCount: number,
): number | undefined {
  if (defined.scopeSheetIndex === undefined) {
    return undefined;
  }
  if (defined.scopeSheetIndex >= sheetCount) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(defined.name)}: its scopeSheetIndex ${defined.scopeSheetIndex} is past the end of the document's own ${sheetCount}-sheet array`,
    );
  }
  return defined.scopeSheetIndex;
}

/** Parses and compiles one entry's refersTo, throwing for anything outside the single sheet-qualified reference vocabulary documented on definedNameEntriesFor. */
function compileRefersTo(
  defined: ContentDefinedName,
  sheets: readonly { readonly name: string }[],
): { readonly sheetIndex: number; readonly rgce: Uint8Array<ArrayBuffer> } {
  const match = SHEET_QUALIFIED_REFERENCE_RE.exec(defined.refersTo);
  if (match === null) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(defined.name)}: its refersTo ${JSON.stringify(defined.refersTo)} is not a sheet-qualified cell or range reference, the one vocabulary this writer compiles for a name`,
    );
  }
  // The sheet-name prefix ends at the LAST "!": Excel sheet names cannot contain "!" (a reserved formula character), so this split is unambiguous without parsing the quoting, the same rule ooxml.js's own stripSheetPrefix applies.
  const sheetName = unquoteSheetLabel(match[1] ?? "");
  const sheetIndex = sheets.findIndex((sheet) => sheet.name === sheetName);
  if (sheetIndex === -1) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(defined.name)}: its refersTo names the sheet ${JSON.stringify(sheetName)}, which the document's own sheets do not carry`,
    );
  }
  const referenceText = match[2] ?? "";
  const [firstText, lastText] = referenceText.split(":");
  const first = parseCorner(firstText ?? "");
  const last = lastText === undefined ? first : parseCorner(lastText);
  if (first === undefined || last === undefined) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(defined.name)}: its refersTo ${JSON.stringify(defined.refersTo)} does not name an A1-style reference this writer can compile`,
    );
  }
  if (
    first.row > MAX_ROW_INDEX ||
    last.row > MAX_ROW_INDEX ||
    first.column > MAX_COLUMN_INDEX ||
    last.column > MAX_COLUMN_INDEX
  ) {
    throw new BiffWriteError(
      `xls-codec cannot write the defined name ${JSON.stringify(defined.name)}: its refersTo ${JSON.stringify(defined.refersTo)} reaches outside BIFF8's own grid (rows 0-${MAX_ROW_INDEX}, columns 0-${MAX_COLUMN_INDEX})`,
    );
  }
  return { sheetIndex, rgce: writeArea3dToken(sheetIndex, first, last) };
}

/** One Lbl record ([MS-XLS] 2.4.150) for a planned defined name, the write-side mirror of readLblRecord above: grbit carries only fBuiltin when it is set, the Name is a compressed single character for a built-in and a real XLUnicodeStringNoCch otherwise, and itab restates the entry's scope one-based. */
export function writeDefinedNameRecord(
  entry: DefinedNamePlanEntry,
): Uint8Array<ArrayBuffer> {
  const nameBytes =
    entry.builtinName === undefined
      ? writeXLUnicodeStringNoCch(entry.name)
      : new RecordBuilder().u8(0).u8(entry.builtinName).build();
  const data = new RecordBuilder()
    .u16(entry.builtinName === undefined ? 0x0000 : LBL_FLAG_BUILTIN)
    .u8(0) // chKey: no macro shortcut key
    .u8(entry.builtinName === undefined ? entry.name.length : 1)
    .u16(entry.rgce.length)
    .u16(0) // reserved3
    .u16(entry.sheetIndex === undefined ? 0 : entry.sheetIndex + 1)
    .u32(0) // reserved4 through reserved7
    .bytes(nameBytes)
    .bytes(entry.rgce)
    .build();
  return writeRecord(RECORD_LBL, data);
}

/** Every planned defined name as its own Lbl record, in the order given. */
export function writeDefinedNameRecords(
  entries: readonly DefinedNamePlanEntry[],
): Uint8Array<ArrayBuffer>[] {
  return entries.map(writeDefinedNameRecord);
}
