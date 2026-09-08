import type { ContentSheetRange, SheetRuleOperator } from "document-schema.js";
import { BlockCursor } from "../biff/cursor";
import type { FormulaSheetContext } from "../biff/ptg";
import { parseFormulaText } from "../biff/ptg";
import { BiffFormatError } from "../biff/records";
import { recordByteLength, type RecordGroup } from "../biff/substreams";
import { RECORD_CF } from "../biff/record-types";

// CondFmt ([MS-XLS] 2.4.56) marks the start of 1-3 CF ([MS-XLS] 2.4.42) records sharing one cell-range list -- the binary equivalent of ODF's calcext:conditional-format wrapping several rule children, and xlsx's own conditionalFormatting wrapping several cfRule children (ExaDev/documents.js#758). Base BIFF8 (Excel 97) conditional formatting has exactly two rule shapes, both handled here: a comparison ("Cell Value Is") condition and a formula condition. Every richer rule type Excel 2007+ added -- top10, aboveAverage, colour scale, data bar, icon set, duplicate/unique values, text/date conditions -- has no representation in the base CF record at all; it rides a CF12 record instead, glued to its own CondFmt through a CFEx extension record (ExaDev/documents.js#1100, a separate cycle).
//
// A CF record's own layout is a real, precisely published Microsoft spec (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/d6dcadf2-7e07-4f7d-a60a-0f643780225d), not a producer convention transcribed from source the way ODF's calcext:condition needed: ct (condition type: 0x01 comparison, 0x02 formula -- the latter has no closed-form structure to promote, the same 'expression' boundary xlsx's own cfRule reading and this package's data-validation.ts both already draw), cp (the comparison operator when ct is 0x01), cce1/cce2 (byte lengths of the two formula operands), a DXFN structure naming the rule's own resulting font-colour/fill-background override, then the two CFParsedFormulaNoCCE operands themselves -- the identical Ptg token grammar a cell's own Formula record carries, read with the same parseFormulaText this reader already uses there.

const CP_TO_OPERATOR: ReadonlyMap<number, SheetRuleOperator> = new Map([
  [0x01, "between"],
  [0x02, "notBetween"],
  [0x03, "equal"],
  [0x04, "notEqual"],
  [0x05, "greaterThan"],
  [0x06, "lessThan"],
  [0x07, "greaterThanOrEqual"],
  [0x08, "lessThanOrEqual"],
]);

export interface RawConditionalFormatFill {
  readonly fillPattern: number;
  readonly fillForegroundIcv: number;
  readonly fillBackgroundIcv: number;
}

export interface RawConditionalFormatStyle {
  readonly fontColorIcv: number | undefined;
  readonly fill: RawConditionalFormatFill | undefined;
}

export interface RawConditionalFormat {
  readonly operator: SheetRuleOperator;
  readonly formula1: string;
  readonly formula2: string | undefined;
  readonly style: RawConditionalFormatStyle | undefined;
  readonly ranges: ContentSheetRange[];
}

// DXFN's own leading flags span 6 bytes ([MS-XLS] 2.4.97's own field table -- https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/a1141f1d-f607-45ef-b8dd-4a1f2b27b4f9): a 4-byte word (bits 0-31, LSB first) ending in ibitAtrNum(25)/ibitAtrFnt(26)/ibitAtrAlc(27)/ibitAtrBdr(28)/ibitAtrPat(29), each saying whether that optional sub-structure is present, followed by a 2-byte word whose own bit 0 is fIfmtUser. Cross-checked against Apache POI's own real, interoperability-tested CFRuleBase#readFormatOptions (a completely independent implementation), which reads the identical 4+2=6 byte header before its own font/border/pattern blocks -- confirming this field-table reading, not just trusting the prose alone.
//
// dxfnum (when ibitAtrNum) comes first and is skipped, never read: this reader has no use for a conditional format's own number-format override. Its own length is unambiguous ONLY in the DXFNumIFmt form (ibitAtrNum but not fIfmtUser -- a fixed 2 bytes); the DXFNumUsr form (fIfmtUser set, a user format-code string) states its own total size in a leading cb field, but [MS-XLS]'s own prose for cb ("specifies the size of this structure") does not settle whether cb counts itself, and no second real-world implementation was found to confirm it either way. Rather than guess and risk silently misaligning every field that follows (dxffntd, dxfpat -- exactly the style data this function exists to extract), a CF whose dxf carries a DXFNumUsr degrades to no style at all: an honest "we don't have one" beats a wrong colour, the same "narrow rather than guess" boundary this package's own data-validation.ts and odf.js's conditional-format.ts already draw elsewhere.
const DXFFNTD_LENGTH = 122; // cchFont(1) + [stFontName+unused1, always 63 bytes combined] + Stxp(16) + icvFore(4) + reserved(4) + tsNinch(4) + fSssNinch(4) + fUlsNinch(4) + fBlsNinch(4) + unused2(4) + ich(4) + cch(4) + iFnt(2)
const DXFFNTD_ICV_FORE_OFFSET = 64 + 16; // past the 64-byte font-name block and the 16-byte Stxp
const DXF_DEFAULT_FOREGROUND_TEXT_COLOR = 32767; // DXFFntD.icvFore's own documented "use the default foreground text colour" sentinel -- not a real override

// Exported for reuse by conditional-format-12.ts: DXFN12 ([MS-XLS] 2.4) is a cbDxf-prefixed wrapper around this exact same DXFN payload, so a CF12 ct 0x05 filter rule's style (the one CF12 rule shape [MS-XLS] does not force cbDxf to zero for) resolves through the identical font/fill extraction a base CF record's style already does.
export function parseDxfStyle(
  dxfBytes: Uint8Array<ArrayBuffer>,
): RawConditionalFormatStyle | undefined {
  if (dxfBytes.length === 0) {
    return undefined;
  }
  try {
    const cursor = new BlockCursor([dxfBytes]);
    const flags1 = cursor.u32();
    const flags2 = cursor.u16();
    const hasNum = ((flags1 >>> 25) & 0x1) !== 0;
    const hasFnt = ((flags1 >>> 26) & 0x1) !== 0;
    const hasAlc = ((flags1 >>> 27) & 0x1) !== 0;
    const hasBdr = ((flags1 >>> 28) & 0x1) !== 0;
    const hasPat = ((flags1 >>> 29) & 0x1) !== 0;
    const fIfmtUser = (flags2 & 0x1) !== 0;

    if (hasNum) {
      if (fIfmtUser) {
        return undefined; // DXFNumUsr -- ambiguous length, see top-of-file note
      }
      cursor.skip(2); // DXFNumIFmt: unused(1 byte) + ifmt(1 byte)
    }

    let fontColorIcv: number | undefined;
    if (hasFnt) {
      const fontBlock = cursor.take(DXFFNTD_LENGTH);
      const view = new DataView(
        fontBlock.buffer,
        fontBlock.byteOffset,
        fontBlock.byteLength,
      );
      const icvFore = view.getInt32(DXFFNTD_ICV_FORE_OFFSET, true);
      if (icvFore >= 0 && icvFore !== DXF_DEFAULT_FOREGROUND_TEXT_COLOR) {
        fontColorIcv = icvFore;
      }
    }

    if (hasAlc) {
      cursor.skip(8); // DXFALC, not modelled -- ContentSheetConditionalFormatStyleSchema has no alignment field
    }
    if (hasBdr) {
      cursor.skip(8); // DXFBdr, not modelled -- the schema's own top comment limits style to font colour and fill background
    }

    let fill: RawConditionalFormatFill | undefined;
    if (hasPat) {
      // DXFPat ([MS-XLS] 2.4.97's own nested structure): unused1(10 bits) fls(6) icvForeground(7) icvBackground(7) unused2(2), LSB first -- the identical bit-packing XF's own CellXF fill fields use (biff/xf-colors.ts's resolveFillBackground/resolveIcvColor), so resolution is deferred to content.ts the same way a regular cell's own fill already is.
      const patWord = cursor.u32();
      fill = {
        fillPattern: (patWord >>> 10) & 0x3f,
        fillForegroundIcv: (patWord >>> 16) & 0x7f,
        fillBackgroundIcv: (patWord >>> 23) & 0x7f,
      };
    }

    if (fontColorIcv === undefined && fill === undefined) {
      return undefined;
    }
    return { fontColorIcv, fill };
  } catch (err) {
    if (!(err instanceof BiffFormatError)) {
      throw err;
    }
    return undefined;
  }
}

function readCf(
  record: RecordGroup,
  ranges: ContentSheetRange[],
  formulaSheets: FormulaSheetContext,
): RawConditionalFormat | undefined {
  try {
    const cursor = new BlockCursor(record.blocks);
    const ct = cursor.u8();
    const cp = cursor.u8();
    const cce1 = cursor.u16();
    const cce2 = cursor.u16();
    if (ct === 0x02) {
      // A formula condition has no closed-form structure to promote without a general formula engine -- the same 'expression' boundary drawn everywhere else this shared schema is populated.
      return undefined;
    }
    const operator = CP_TO_OPERATOR.get(cp);
    if (operator === undefined) {
      return undefined;
    }
    const dxfLength = recordByteLength(record) - 6 - cce1 - cce2;
    const dxfBytes = cursor.take(dxfLength);
    const rgce1 = cursor.take(cce1);
    const rgce2 = cursor.take(cce2);
    if (cce1 === 0) {
      // A comparison condition always compares against something -- a zero-length first operand is a malformed record, not a legitimate empty rule, so the whole rule degrades to absent rather than promoting a formula1 the schema requires but this record never actually carried.
      return undefined;
    }
    const formula1 = parseFormulaText(rgce1, formulaSheets);
    if (formula1 === undefined) {
      // ContentSheetConditionalFormatSchema's own 'cellIs' variant requires formula1 -- a Ptg stream this reader cannot render as text (an unsupported token) leaves nothing valid to promote, so the whole rule degrades to absent rather than a fabricated placeholder.
      return undefined;
    }
    const formula2 =
      cce2 > 0 ? parseFormulaText(rgce2, formulaSheets) : undefined;

    return {
      operator,
      formula1,
      formula2,
      style: parseDxfStyle(dxfBytes),
      ranges,
    };
  } catch (err) {
    if (!(err instanceof BiffFormatError)) {
      throw err;
    }
    return undefined;
  }
}

export interface CondFmtGroupResult {
  readonly formats: RawConditionalFormat[];
  /** How many records (the CondFmt itself plus every CF it claimed) the caller should advance past, regardless of how many rules actually promoted. */
  readonly recordsConsumed: number;
}

// Reads one CondFmt and the ccf CF records immediately following it ([MS-XLS] 2.1.7.20.6's own worksheet-substream ABNF places them contiguously, the same "wrapper then its own children" shape MergeCells' own single-record simplicity doesn't need but DV's own sibling records never required either -- this is the one BIFF8 construct in this reader that spans more than one record). A CF this reader cannot promote (a formula condition, an unrecognised cp) is simply omitted rather than degrading the whole group -- the other rules in the same CondFmt, and every other CondFmt on the sheet, are unaffected. records[startIndex] MUST already be RECORD_CONDFMT; a malformed group (a declared ccf running past the end of the record array, or a non-CF record where a CF was expected) degrades the WHOLE group to no formats, consuming only the CondFmt record itself so the caller's own walk can still make sense of whatever follows.
export function readCondFmtGroup(
  records: readonly RecordGroup[],
  startIndex: number,
  formulaSheets: FormulaSheetContext,
): CondFmtGroupResult {
  const condFmt = records[startIndex];
  if (condFmt === undefined) {
    return { formats: [], recordsConsumed: 1 };
  }
  try {
    const cursor = new BlockCursor(condFmt.blocks);
    const ccf = cursor.u16();
    cursor.skip(2); // fToughRecalc + nID -- CFEx's own linkage, not needed while CF12/CFEx stays out of scope (ExaDev/documents.js#1100)
    cursor.skip(8); // refBound (Ref8U) -- a bounding superset of sqref, redundant for this reader's purposes
    const crefCount = cursor.u16();
    const ranges: ContentSheetRange[] = [];
    for (let index = 0; index < crefCount; index += 1) {
      const startRow = cursor.u16();
      const endRow = cursor.u16();
      const startColumn = cursor.u16();
      const endColumn = cursor.u16();
      ranges.push({ startRow, startColumn, endRow, endColumn });
    }

    const formats: RawConditionalFormat[] = [];
    for (let offset = 1; offset <= ccf; offset += 1) {
      const cfRecord = records[startIndex + offset];
      if (cfRecord?.type !== RECORD_CF) {
        return { formats: [], recordsConsumed: 1 };
      }
      const format = readCf(cfRecord, ranges, formulaSheets);
      if (format !== undefined) {
        formats.push(format);
      }
    }
    return { formats, recordsConsumed: 1 + ccf };
  } catch (err) {
    if (!(err instanceof BiffFormatError)) {
      throw err;
    }
    return { formats: [], recordsConsumed: 1 };
  }
}
