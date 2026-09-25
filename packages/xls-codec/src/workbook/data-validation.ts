import type { ContentSheetRange, SheetRuleOperator } from "document-schema.js";
import { BlockCursor } from "../biff/cursor";
import type { FormulaSheetContext } from "../biff/ptg";
import { parseFormulaText } from "../biff/ptg";
import { recoverFromFormatError } from "../biff/records";
import { readXLUnicodeString } from "../biff/strings";
import type { RecordGroup } from "../biff/substreams";

// DvCommon's own flags word bit layout ([MS-XLS] 2.4.77): a 4-bit valType, a 3-bit errStyle at bit 4, single-bit allow-blank, show-input-message and show-error-message flags, and a 4-bit typOperator at bit 20.
const VAL_TYPE_MASK = 0xf;
const ERR_STYLE_SHIFT = 4;
const ERR_STYLE_MASK = 0x7;
const ALLOW_BLANK_SHIFT = 8;
const SHOW_INPUT_MSG_SHIFT = 18;
const SHOW_ERROR_MSG_SHIFT = 19;
const TYP_OPERATOR_SHIFT = 20;
const TYP_OPERATOR_MASK = 0xf;
const FLAG_MASK = 0x1;

// Dv ([MS-XLS] 2.4.95): one set of data-validation criteria for a range collection on this sheet, the binary equivalent of ODF's table:content-validation and xlsx's dataValidation — https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/862bbc7c-009a-4fd6-a93e-3e32e591c2f8. Unlike either of those, every field here is a fixed-layout binary structure with a real published grammar (no LibreOffice-source-transcription needed the way odf.js's own calcext:condition reading required): a 32-bit bit-packed flags field, four XLUnicodeStrings (PromptTitle/ErrorTitle/Prompt/Error), one or two DVParsedFormula structures (a cce-prefixed Ptg token stream — read with the same parseFormulaText this reader already uses for ordinary cell formulas, since DVParsedFormula's own rgce is the identical Ptg grammar), and a trailing SqRefU range list (a cref count then that many Ref8U row/column-bound quads, zero-based, the same shape MergeCells already reads).
//
// Bit layout of the flags DWORD, LSB first, per the spec's own field table: valType(4) errStyle(3) fStrLookup(1) fAllowBlank(1) fSuppressCombo(1) mdImeMode(8) fShowInputMsg(1) fShowErrorMsg(1) typOperator(4) reserved(8). fStrLookup/fSuppressCombo/mdImeMode have no counterpart in ContentSheetDataValidationSchema and are read only to advance past correctly — they are already implied by/irrelevant to the fields the schema does carry (fStrLookup only disambiguates how a 'list' rule's own formula1 was authored in the Excel UI, not what it means; mdImeMode is IME input-restriction state with no cross-format analogue at all).

const VALUE_TYPE_BY_VAL_TYPE: ReadonlyMap<
  number,
  "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom"
> = new Map(
  // valType in [MS-XLS] order. 0x0 ("any type, no check") has no dedicated schema member and degrades to 'custom' with no operator/formula, the same "no real type signal" default readContentValidation (odf.js's own data-validation.ts) already uses for a condition it cannot parse at all; 0x7 is the genuinely custom one.
  (
    [
      "custom",
      "whole",
      "decimal",
      "list",
      "date",
      "time",
      "textLength",
      "custom",
    ] as const
  ).map((type, index) => [index, type] as const),
);

// typOperator's own value table is a different ordering from SheetRuleOperatorSchema's, so this is a real mapping, not a reinterpretation of the same enum under a new name.
const OPERATOR_BY_TYP_OPERATOR: ReadonlyMap<number, SheetRuleOperator> =
  new Map(
    // typOperator's value table in spec order, zero-based per [MS-XLS] 2.4.95.
    (
      [
        "between",
        "notBetween",
        "equal",
        "notEqual",
        "greaterThan",
        "lessThan",
        "greaterThanOrEqual",
        "lessThanOrEqual",
      ] as const
    ).map((operator, index) => [index, operator] as const),
  );

const ERROR_STYLE_BY_ERR_STYLE: ReadonlyMap<
  number,
  "stop" | "warning" | "information"
> = new Map([
  [0x0, "stop"],
  [0x1, "warning"],
  [0x2, "information"],
]);

export interface RawDataValidation {
  readonly type:
    "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom";
  readonly operator: SheetRuleOperator | undefined;
  readonly formula1: string | undefined;
  readonly formula2: string | undefined;
  readonly allowBlank: boolean;
  readonly showInputMessage: boolean;
  readonly showErrorMessage: boolean;
  readonly errorStyle: "stop" | "warning" | "information";
  readonly promptTitle: string;
  readonly errorTitle: string;
  readonly prompt: string;
  readonly error: string;
  readonly ranges: ContentSheetRange[];
}

// A DVParsedFormula ([MS-XLS] 2.2.2 / this reader's own citation on DVParsedFormula): cce (2 bytes), an unused 2-byte field, then cce bytes of Ptg tokens — structurally simpler than a cell Formula record's own CellParsedFormula (no rgcb trailer: [MS-XLS] itself forbids a DV formula from containing a PtgArray at all). cce === 0 means "no formula" (valType 0's own formula1, or either formula whenever the Dv record's own valType/typOperator combination doesn't use it); no early return is needed to say so, since parseFormulaText resolves a zero-length rgce to undefined on its own (an empty token stream never pushes onto its own operand stack, so its own final "exactly one operand left" check already fails) — the file states "no formula" directly rather than leaving it for a reader to infer from valType/typOperator, and this function trusts cce rather than re-deriving when a formula "should" be absent either way.
function readDvParsedFormula(
  cursor: BlockCursor,
  formulaSheets: FormulaSheetContext,
): string | undefined {
  const cce = cursor.u16();
  cursor.skip(2); // unused
  return parseFormulaText(cursor.take(cce), formulaSheets);
}

// Reads one Dv record, or degrades the whole rule to undefined on a malformed length field (a cce, or the trailing SqRefU's own cref, claiming more bytes than the record actually carries) — the same per-record boundary readFormula (./sheet.ts) already draws around the identical BiffFormatError hazard on a cell's own Formula record, so one corrupt validation rule cannot abort every other rule (or every other cell) on the sheet.
export function readDv(
  record: RecordGroup,
  formulaSheets: FormulaSheetContext,
): RawDataValidation | undefined {
  try {
    const cursor = new BlockCursor(record.blocks);
    const flags = cursor.u32();
    const valType = flags & VAL_TYPE_MASK;
    const errStyleBits = (flags >>> ERR_STYLE_SHIFT) & ERR_STYLE_MASK;
    const fAllowBlank = ((flags >>> ALLOW_BLANK_SHIFT) & FLAG_MASK) !== 0;
    const fShowInputMsg = ((flags >>> SHOW_INPUT_MSG_SHIFT) & FLAG_MASK) !== 0;
    const fShowErrorMsg = ((flags >>> SHOW_ERROR_MSG_SHIFT) & FLAG_MASK) !== 0;
    const typOperator = (flags >>> TYP_OPERATOR_SHIFT) & TYP_OPERATOR_MASK;

    const promptTitle = readXLUnicodeString(cursor);
    const errorTitle = readXLUnicodeString(cursor);
    const prompt = readXLUnicodeString(cursor);
    const error = readXLUnicodeString(cursor);

    const formula1 = readDvParsedFormula(cursor, formulaSheets);
    const formula2 = readDvParsedFormula(cursor, formulaSheets);

    const rangeCount = cursor.u16();
    const ranges: ContentSheetRange[] = [];
    for (let index = 0; index < rangeCount; index += 1) {
      const startRow = cursor.u16();
      const endRow = cursor.u16();
      const startColumn = cursor.u16();
      const endColumn = cursor.u16();
      ranges.push({ startRow, startColumn, endRow, endColumn });
    }

    // typOperator (and therefore any comparison operator) is undefined/ignored for 'list' and 'custom', matching ContentSheetDataValidationSchema's own "absent for 'list' and 'custom'" contract.
    const type = VALUE_TYPE_BY_VAL_TYPE.get(valType) ?? "custom";
    const operator =
      type === "list" || type === "custom"
        ? undefined
        : OPERATOR_BY_TYP_OPERATOR.get(typOperator);

    return {
      type,
      operator,
      formula1,
      formula2,
      allowBlank: fAllowBlank,
      showInputMessage: fShowInputMsg,
      showErrorMessage: fShowErrorMsg,
      errorStyle: ERROR_STYLE_BY_ERR_STYLE.get(errStyleBits) ?? "stop",
      promptTitle,
      errorTitle,
      prompt,
      error,
      ranges,
    };
  } catch (err) {
    recoverFromFormatError(err, undefined);
    return undefined;
  }
}
