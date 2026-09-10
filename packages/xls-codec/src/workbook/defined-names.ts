import { BlockCursor } from "../biff/cursor";
import { parseFormulaText, type FormulaSheetContext } from "../biff/ptg";
import { RECORD_LBL } from "../biff/record-types";
import { BiffFormatError } from "../biff/records";
import { readXLUnicodeStringNoCch } from "../biff/strings";
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
    if (!(error instanceof BiffFormatError)) {
      throw error;
    }
    return undefined;
  }
}
