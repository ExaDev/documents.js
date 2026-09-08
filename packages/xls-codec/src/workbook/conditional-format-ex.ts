import type { ContentSheetRange } from "document-schema.js";
import { BlockCursor } from "../biff/cursor";
import type { FormulaSheetContext } from "../biff/ptg";
import { BiffFormatError } from "../biff/records";
import type { RecordGroup } from "../biff/substreams";
import { parseDxfStyle, type RawCfOperand } from "./conditional-format";
import {
  readCfTextFilterRule,
  type RawConditionalFormat12,
  type RawConditionalFormat12Common,
} from "./conditional-format-12";

// CFEx ([MS-XLS] 2.4.63, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/60d13d2f-8eb7-41bf-975c-8a1a51ad58b6) extends an EXISTING CondFmt-owned rule with metadata a legacy (Excel 97) CF record has no field for -- the counterpart to CF12 for the specific case where the underlying rule stays expressible as a plain BIFF8 CF (a formula condition, ct 0x02) and Excel prefers to keep it readable by pre-2007 Excel rather than promote it into a CF12 record an old reader would silently skip over as an unrecognised "future record type". [MS-XLS] 2.1.7.20.6's own worksheet-substream ABNF (`CONDFMTS = *(CONDFMT / CONDFMT12) *(CFEx [CF12])`) places every CFEx after every CondFmt/CondFmt12 group on the sheet, referencing back to one of them by nID rather than sitting inside it -- so readCfEx below is handed every earlier CondFmt group's own resolved ranges and raw CF operands (keyed by nID, collected as workbook/sheet.ts walks the substream) rather than reading them itself.
//
// fIsCF12 distinguishes the two ways a CFEx can attach: 0 means it extends a legacy CF (this file's only handled case, via CFExNonCF12, [MS-XLS] 2.4.64); nonzero means it precedes and extends a genuine CF12 record instead ([MS-XLS] 2.4.43's own top line: "All CF12 records MUST follow a CondFmt12 record, another CF12 record, or a CFEx record"). That CF12 record carries no ranges of its own -- a CondFmt12 normally supplies them -- and this reader has no established link back to one for a bare CFEx-preceded CF12, so that case stays unread here; the CF12 record itself simply falls through workbook/sheet.ts's own record dispatch unclaimed, exactly as any other record type this reader has no case for already does.
//
// containsText/notContainsText/beginsWith/endsWith (CF12's own icfTemplate 0x0008, "Contains text") is the one rule family CFExTextTemplateParams cannot fully describe on its own: it carries only ctp, which of the four text-comparison sub-types the rule is, never the literal search text itself ([MS-XLS] 2.5.29, confirmed against a second independent transcription of the same structure -- kinkou/unxls's own CFExTextTemplateParams reader, https://github.com/kinkou/unxls/blob/master/lib/unxls/biff8/structure.rb). The literal text lives instead in the extended CF's own rgce1 formula, as Excel's real, independently-confirmed generated formula for these four rule kinds -- LibreOffice's own xecontent.cxx GetFixedFormula (https://docs.libreoffice.org/sc/html/xecontent_8cxx_source.html) emits `NOT(ISERROR(SEARCH("text",cell)))` for containsText, `ISERROR(SEARCH("text",cell))` for notContainsText, `LEFT(cell,LEN("text"))="text"` for beginsWith, and the RIGHT/LEN equivalent for endsWith -- so the search text is always present as a literal string-constant (PtgStr) operand in the formula regardless of which of the four shapes wraps it. conditional-format-12.ts's readCfTextFilterRule extracts it via ptg.ts's extractFirstStringLiteral, the same way whether the extended record is a legacy CF (this file) or a genuine ct 0x02 CF12 record (conditional-format-12.ts's own readCf12).
export interface CfExTarget {
  readonly ranges: ContentSheetRange[];
  readonly cfs: readonly (RawCfOperand | undefined)[];
}

export function readCfEx(
  record: RecordGroup,
  targetsByNID: ReadonlyMap<number, CfExTarget>,
  formulaSheets: FormulaSheetContext,
): RawConditionalFormat12 | undefined {
  try {
    const cursor = new BlockCursor(record.blocks);
    cursor.skip(12); // frtRefHeaderU ([MS-XLS] 2.4) -- ref8 restates the target CondFmt's own sqref, redundant with the ranges this function already resolves via nID
    const fIsCF12 = cursor.u32();
    const nID = cursor.u16();
    if (fIsCF12 !== 0) {
      return undefined; // extends a CF12 record instead of a legacy CF -- see this file's own top comment
    }
    const target = targetsByNID.get(nID);
    if (target === undefined) {
      return undefined;
    }
    const icf = cursor.u16();
    cursor.skip(1); // cp -- SHOULD equal the referenced CF's own cp ([MS-XLS] 2.4.64's own prose), redundant with reading it there directly
    const icfTemplate = cursor.u8();
    const priority = cursor.u16(); // ipriority
    const flags = cursor.u8();
    const active = (flags & 0x1) !== 0; // A - fActive
    const stopIfTrue = ((flags >>> 1) & 0x1) !== 0; // B - fStopIfTrue
    const fHasDxf = cursor.u8();
    let dxfBytes: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    if (fHasDxf !== 0) {
      const cbDxf = cursor.u32(); // DXFN12's own length prefix, the same cbDxf-prefixed shape CF12's own dxf field carries
      dxfBytes = cursor.take(cbDxf);
    }
    cursor.skip(1); // cbTemplateParm -- MUST be 16, not validated
    const templateParams = cursor.take(16); // rgbTemplateParms (CFExTemplateParams)
    if (!active) {
      // fActive = 0: Excel itself ignores this rule, so nothing here should be promoted either.
      return undefined;
    }
    const cf = target.cfs[icf];
    if (cf === undefined) {
      return undefined;
    }
    const textRule = readCfTextFilterRule(
      icfTemplate,
      templateParams,
      cf.rgce1,
      formulaSheets,
    );
    if (textRule === undefined) {
      return undefined;
    }
    const common: RawConditionalFormat12Common = {
      priority,
      stopIfTrue,
      ranges: target.ranges,
    };
    const style = parseDxfStyle(dxfBytes);
    return { ...textRule, ...common, style };
  } catch (err) {
    if (!(err instanceof BiffFormatError)) {
      throw err;
    }
    return undefined;
  }
}
