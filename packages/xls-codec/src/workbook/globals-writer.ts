import type { Alignment, Color } from "document-schema.js";

import { writeBofData } from "../biff/bof-writer";
import { RecordBuilder } from "../biff/builder";
import {
  BOF_TYPE_WORKBOOK,
  RECORD_BOF,
  RECORD_BOUNDSHEET8,
  RECORD_EOF,
  RECORD_EXTERNSHEET,
  RECORD_SST,
  RECORD_SUPBOOK,
} from "../biff/record-types";
import { concatRecords, writeRecord } from "../biff/record-writer";
import {
  writeRichExtendedString,
  writeShortXLUnicodeString,
} from "../biff/string-writer";
import type { XfDecorationFields } from "../biff/xf-colors";
import {
  writeCellXfRecord,
  writeFontRecord,
  writeFormatRecord,
  writePaletteRecord,
  writeStyleRecord,
  writeStyleXfRecord,
} from "../biff/xf-writer";
import { writePrintNameRecords, type PrintNamePlanEntry } from "./print-names";

// The workbook globals substream ([MS-XLS] 2.1.7.20.3), write side: everything belonging to the workbook rather than to one sheet -- the font, format, and cell-style/cell-format XF tables every cell's own formatting resolves through, the shared string table, and the BoundSheet8 entry naming each sheet's own substream. Grouped and ordered to satisfy [MS-XLS] 2.1.7.20.3's own FORMATTING production (Font*, Format*, XFS, STYLES) ahead of the BoundSheet8 entries and the closing EOF -- see this package's README for exactly which globals-substream records this writer emits and which it deliberately omits (Window1, CodePage, the interface/calc-state record family, and so on: real content, not UI or interoperability bookkeeping).
//
// Only one font is ever written ([MS-XLS] 2.4.122, index 0): this package's own reader never maps a cell's font (see xls-codec's README, "Cell decoration"), so a font table with more than one entry would be unverifiable by round trip and every cell XF this writer emits references font 0.

const GENERAL_FORMAT_ID = 0;
const NORMAL_FONT_INDEX = 0;
const NORMAL_FONT_NAME = "Arial";
/** Excel 97-2003's own Normal-style default: 10pt, in twips (dyHeight's own unit, [MS-XLS] 2.4.122). */
const NORMAL_FONT_HEIGHT_TWIPS = 200;

/** [MS-XLS] "BuiltInStyle" istyBuiltIn values (ECMA-376 Part 1 18.8.7's cellStyle builtinId table): 0 Normal, 1 RowLevel, 2 ColLevel -- the only three this writer emits, since it never groups rows/columns into an outline. */
const BUILTIN_STYLE_NORMAL = 0x00;
const BUILTIN_STYLE_ROW_LEVEL = 0x01;
const BUILTIN_STYLE_COL_LEVEL = 0x02;
/** BuiltInStyle's own iLevel sentinel for a style other than RowLevel/ColLevel: "otherwise, this value MUST be 0xFF". */
const NO_OUTLINE_LEVEL = 0xff;
/** RowLevel/ColLevel each cover seven outline depths ([MS-XLS] "BuiltInStyle"'s own 0x00-0x06 iLevel table). */
const OUTLINE_LEVEL_COUNT = 7;

interface BuiltinStyle {
  readonly istyBuiltIn: number;
  readonly iLevel: number;
}

/** The fifteen built-in cell styles, XF index 0 through 14, in the order every real Excel-written workbook carries them: Normal, then RowLevel_1..7, then ColLevel_1..7. */
const BUILTIN_STYLES: readonly BuiltinStyle[] = [
  { istyBuiltIn: BUILTIN_STYLE_NORMAL, iLevel: NO_OUTLINE_LEVEL },
  ...Array.from({ length: OUTLINE_LEVEL_COUNT }, (_unused, level) => ({
    istyBuiltIn: BUILTIN_STYLE_ROW_LEVEL,
    iLevel: level,
  })),
  ...Array.from({ length: OUTLINE_LEVEL_COUNT }, (_unused, level) => ({
    istyBuiltIn: BUILTIN_STYLE_COL_LEVEL,
    iLevel: level,
  })),
];

/** [MS-XLS] 2.1.7.20.3's own XFS production requires at least sixteen XF records before any cell can reference one: BUILTIN_STYLES.length built-in cell styles, then at least one cell XF -- the "General, no declared format" one every workbook needs unconditionally, written immediately after them. Derived from BUILTIN_STYLES's own length rather than restated as a literal, so the two can never drift apart. */
export const GENERAL_CELL_XF_INDEX = BUILTIN_STYLES.length;

/** One cell XF beyond the implicit General one at GENERAL_CELL_XF_INDEX: the number-format identifier it displays through, the cell's own horizontal/vertical alignment (general/bottom, this writer's own defaults, when omitted), and -- when the cell it serves carries a background or borders -- the fill/border fields its CellXF payload packs. Undefined decoration writes the same undecorated defaults this writer always wrote before decoration existed. */
export interface CellXfPlanEntry {
  readonly formatId: number;
  readonly alignment?: Alignment;
  readonly verticalAlignment?: "top" | "middle" | "bottom";
  readonly decoration?: XfDecorationFields;
}

export interface WorkbookGlobalsPlan {
  readonly sheetNames: readonly string[];
  /** Custom number-format codes needing their own Format record, each with the identifier already assigned to it (always >= 164, [MS-XLS] 2.4.126's own custom-identifier floor). A code equal to one of the built-in table's own strings needs no Format record here -- number-format.ts's BUILTIN_NUMBER_FORMATS already covers ids 0-49 for both this package's reader and any other. */
  readonly customFormats: readonly {
    readonly id: number;
    readonly code: string;
  }[];
  /** Every cell XF beyond the implicit General one at GENERAL_CELL_XF_INDEX, in the order their XF records are written: index GENERAL_CELL_XF_INDEX + 1 + i is entry cellXfEntries[i]. write.ts's own cell-format interning pass assigns one entry to every distinct (number format, decoration) combination the workbook's cells actually use. */
  readonly cellXfEntries: readonly CellXfPlanEntry[];
  /** The shared string table, in SST order -- a LabelSst cell's own isst indexes into this array. */
  readonly sharedStrings: readonly string[];
  /** SST's own cstTotal: the total number of string-cell references across the whole workbook, not just the unique count. Not read by this package's own reader (which discards the field), but a real conformant value rather than a placeholder. */
  readonly sharedStringTotalCount: number;
  /** The workbook's own custom colour table (56 entries, icv 8 first), when write.ts's own palette-interning pass decided the workbook needs one -- undefined when every decoration colour the workbook's cells use already matches the fixed default table, in which case no Palette record is written at all and those colours resolve through the default table instead ([MS-XLS] "Icv"'s own documented fallback). */
  readonly paletteColors?: readonly Color[];
  /** The built-in Print_Area/Print_Titles defined names the workbook's sheets declare, one Lbl record each. Empty when no sheet declares a print range or a repeated header band, in which case no SupBook, ExternSheet, or Lbl record is written at all -- exactly like Palette above, a workbook that needs none stays as minimal as it always was. */
  readonly printNames: readonly PrintNamePlanEntry[];
}

export interface WorkbookGlobalsBuild {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** Byte offset, within `bytes`, of each sheet's own BoundSheet8.lbPlyPos field ([MS-XLS] 2.4.28) -- a 4-byte little-endian integer the caller patches once every sheet substream's own length in the final workbook stream is known. In `plan.sheetNames` order. */
  readonly lbPlyPosOffsets: readonly number[];
}

/** BoundSheet8 ([MS-XLS] 2.4.28) with lbPlyPos left at 0: a placeholder the caller patches in place, since the real value -- the byte offset of this sheet's own BOF within the finished workbook stream -- is only known once every substream's length has been measured. */
function writeBoundSheet8Placeholder(name: string): Uint8Array<ArrayBuffer> {
  const hidden = 0x00; // visible: ContentSheet carries no hidden field for this writer to honour
  const sheetType = 0x00; // worksheet
  const data = new RecordBuilder()
    .u32(0) // lbPlyPos placeholder
    .u8(hidden)
    .u8(sheetType)
    .bytes(writeShortXLUnicodeString(name))
    .build();
  return writeRecord(RECORD_BOUNDSHEET8, data);
}

/** [MS-XLS] 2.4.271's own cch table: the value a self-referencing SupBook -- this workbook itself, rather than another workbook, a DDE/OLE data source, or an add-in -- carries in place of a virtual path. The one kind of supporting link this package writes, and the one kind workbook/globals.ts's own reader resolves a 3D reference through. */
const SUPBOOK_SELF_REFERENCING_CCH = 0x0401;

/** SupBook ([MS-XLS] 2.4.271), self-referencing: a two-byte sheet count then that cch sentinel, and nothing else -- the virtPath/rgst payload a real external link would carry has no meaning for a link that names this same workbook. */
function writeSupBookRecord(sheetCount: number): Uint8Array<ArrayBuffer> {
  return writeRecord(
    RECORD_SUPBOOK,
    new RecordBuilder()
      .u16(sheetCount)
      .u16(SUPBOOK_SELF_REFERENCING_CCH)
      .build(),
  );
}

/**
 * ExternSheet ([MS-XLS] 2.4.106): a two-byte cXTI then that many XTI structures ([MS-XLS] 2.5.344), each an iSupBook and a signed itabFirst/itabLast sheet-scope pair -- the write-side mirror of workbook/globals.ts's own readSheetRanges.
 *
 * One XTI per sheet, each scoped to that one sheet and pointing at the single self-referencing SupBook above, so a print name's own PtgArea3d can name its sheet by using that sheet's index as its ixti. The 3D reference machinery exists here purely because [MS-XLS] gives a defined name no other way to say which sheet its range is on.
 */
function writeExternSheetRecord(sheetCount: number): Uint8Array<ArrayBuffer> {
  const builder = new RecordBuilder().u16(sheetCount);
  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    builder.u16(0).u16(sheetIndex).u16(sheetIndex);
  }
  return writeRecord(RECORD_EXTERNSHEET, builder.build());
}

/** SST ([MS-XLS] 2.4.265): a total reference count, a unique-string count, then that many XLUnicodeRichExtendedStrings, packed with no offsets -- the write-side mirror of workbook/globals.ts's own readSharedStrings. */
function writeSstRecord(
  strings: readonly string[],
  totalCount: number,
): Uint8Array<ArrayBuffer> {
  const builder = new RecordBuilder().i32(totalCount).i32(strings.length);
  for (const text of strings) {
    builder.bytes(writeRichExtendedString(text));
  }
  return writeRecord(RECORD_SST, builder.build());
}

export function buildWorkbookGlobals(
  plan: WorkbookGlobalsPlan,
): WorkbookGlobalsBuild {
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const push = (piece: Uint8Array<ArrayBuffer>): void => {
    pieces.push(piece);
    offset += piece.length;
  };

  push(writeRecord(RECORD_BOF, writeBofData(BOF_TYPE_WORKBOOK)));
  push(writeFontRecord(NORMAL_FONT_NAME, NORMAL_FONT_HEIGHT_TWIPS));

  for (const code of plan.customFormats) {
    push(writeFormatRecord(code.id, code.code));
  }

  BUILTIN_STYLES.forEach(() => {
    push(
      writeStyleXfRecord({
        fontIndex: NORMAL_FONT_INDEX,
        formatId: GENERAL_FORMAT_ID,
      }),
    );
  });
  // XF index GENERAL_CELL_XF_INDEX: the implicit "General" cell format every workbook needs regardless of whether any cell's own numberFormatCode resolves to one of the others below.
  push(
    writeCellXfRecord({
      fontIndex: NORMAL_FONT_INDEX,
      formatId: GENERAL_FORMAT_ID,
    }),
  );
  for (const entry of plan.cellXfEntries) {
    push(
      writeCellXfRecord({
        fontIndex: NORMAL_FONT_INDEX,
        formatId: entry.formatId,
        alignment: entry.alignment,
        verticalAlignment: entry.verticalAlignment,
        decoration: entry.decoration,
      }),
    );
  }

  BUILTIN_STYLES.forEach((builtin, index) => {
    push(
      writeStyleRecord({
        xfIndex: index,
        istyBuiltIn: builtin.istyBuiltIn,
        iLevel: builtin.iLevel,
      }),
    );
  });

  // [MS-XLS] 2.1.7.20.3's own FORMATTING production places Palette immediately after STYLES (Font* Format* XFS STYLES [TABLESTYLES] [Palette] [ClrtClient]) -- written only when write.ts's own palette-interning pass decided the workbook genuinely needs a custom colour table.
  if (plan.paletteColors !== undefined) {
    push(writePaletteRecord(plan.paletteColors));
  }

  // [MS-XLS] 2.1.7.20.3's own WORKBOOKCONTENT production orders BUNDLESHEET (the BoundSheet8 entries) ahead of SHAREDSTRINGS (the SST); this writer follows that order even though its own reader -- and Excel's -- accepts either.
  const lbPlyPosOffsets: number[] = [];
  for (const name of plan.sheetNames) {
    const recordStart = offset;
    const recordHeaderBytes = 4; // [MS-XLS] 2.1.4: a two-byte type then a two-byte size, before lbPlyPos, the record's own first field
    lbPlyPosOffsets.push(recordStart + recordHeaderBytes);
    push(writeBoundSheet8Placeholder(name));
  }

  // [MS-XLS] 2.1.7.20.3's own WORKBOOKCONTENT production places `*SUPBOOK *LBL` between the BoundSheet8 entries and SHAREDSTRINGS, with `SUPBOOK = SupBook [*ExternName *(XCT *CRN)] [ExternSheet] *Continue` -- so the supporting link and its ExternSheet come first, then the defined names whose 3D references resolve through it. Written only when there is a print name to write: a workbook with no print range and no repeated header band needs no defined name, and therefore no supporting link for one to reference.
  if (plan.printNames.length > 0) {
    push(writeSupBookRecord(plan.sheetNames.length));
    push(writeExternSheetRecord(plan.sheetNames.length));
    for (const record of writePrintNameRecords(plan.printNames)) {
      push(record);
    }
  }

  if (plan.sharedStrings.length > 0) {
    push(writeSstRecord(plan.sharedStrings, plan.sharedStringTotalCount));
  }

  push(writeRecord(RECORD_EOF, new Uint8Array(0)));

  return { bytes: concatRecords(...pieces), lbPlyPosOffsets };
}
