import type {
  ContentSheet,
  ContentSheetDataValidation,
} from "document-schema.js";
import { BiffWriteError } from "../biff/write-errors";
import { compileFormulaText } from "../biff/ptg-writer";
import { writeRecord } from "../biff/record-writer";
import { RECORD_DVAL, RECORD_DV } from "../biff/record-types";
import { writeXLUnicodeString } from "../biff/string-writer";
import { RecordBuilder } from "../biff/builder";
import type { SheetRuleOperator } from "document-schema.js";

// The write-side inverse of data-validation.ts's readDv ([MS-XLS] 2.4.95): one Dv record per ContentSheetDataValidation rule, preceded by the one Dval record ([MS-XLS] 2.4.96) the worksheet substream's own DataValidationTable grammar names as its wrapper. Everything here is the exact mirror of the reader's own field walk -- the flags word bit-for-bit, the four XLUnicodeStrings in their declared order, the two DVParsedFormula structures (cce, the unused word, then the rgce bytes compileFormulaText produces), and the trailing SqRefU range list -- so a Dv this writer emits reads back through readDv with every field intact.

const VAL_TYPE_BY_TYPE: ReadonlyMap<
  ContentSheetDataValidation["type"],
  number
> = new Map([
  ["whole", 0x1],
  ["decimal", 0x2],
  ["list", 0x3],
  ["date", 0x4],
  ["time", 0x5],
  ["textLength", 0x6],
  // The schema's 'custom' covers both of the reader's own no-real-type-signal values: 0x0 ("any type, no check") and 0x7 (custom). The write side states the genuinely custom one -- 0x0 names no check at all, which would weaken a rule whose formula the schema does carry.
  ["custom", 0x7],
]);

// Dv's own typOperator enumeration is ZERO-based ([MS-XLS] 2.4.95's own field table: 0x0 Between through 0x7 Less than or equal) -- deliberately unlike a CF record's own 1-based cp, a distinction the reader's own OPERATOR_BY_TYP_OPERATOR already encodes and this inverse mirrors.
const TYP_OPERATOR_BY_OPERATOR: ReadonlyMap<SheetRuleOperator, number> =
  new Map([
    ["between", 0x0],
    ["notBetween", 0x1],
    ["equal", 0x2],
    ["notEqual", 0x3],
    ["greaterThan", 0x4],
    ["lessThan", 0x5],
    ["greaterThanOrEqual", 0x6],
    ["lessThanOrEqual", 0x7],
  ]);

const ERR_STYLE_CODE: ReadonlyMap<
  NonNullable<ContentSheetDataValidation["errorStyle"]>,
  number
> = new Map([
  ["stop", 0x0],
  ["warning", 0x1],
  ["information", 0x2],
]);

// A DVParsedFormula ([MS-XLS] 2.2.2): cce (2 bytes), an unused 2-byte word, then the rgce bytes. cce 0 states "no formula" outright -- the spelling the reader trusts rather than inferring from valType/typOperator -- so an absent formula writes exactly that.
function writeDvParsedFormula(
  text: string | undefined,
): [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>] {
  const rgce =
    text === undefined ? new Uint8Array(0) : compileFormulaText(text);
  const header = new RecordBuilder().u16(rgce.length).u16(0);
  return [header.build(), rgce];
}

function writeDvRecord(
  validation: ContentSheetDataValidation,
): Uint8Array<ArrayBuffer> {
  const valType = VAL_TYPE_BY_TYPE.get(validation.type);
  if (valType === undefined) {
    // Unreachable for the schema's closed type union, kept for the same exhaustive-defence reason every map lookup here states its miss.
    throw new BiffWriteError(
      `data validation type "${validation.type}" has no Dv valType value`,
    );
  }
  // The flags word, mirroring readDv's own bit extraction exactly: valType (bits 0-3), errStyle (4-6), fAllowBlank (8), fShowInputMsg (18), fShowErrorMsg (19), typOperator (20-23).
  let flags = valType;
  flags |= (ERR_STYLE_CODE.get(validation.errorStyle ?? "stop") ?? 0x0) << 4;
  if (validation.allowBlank === true) {
    flags |= 0x1 << 8;
  }
  if (validation.showInputMessage === true) {
    flags |= 0x1 << 18;
  }
  if (validation.showErrorMessage === true) {
    flags |= 0x1 << 19;
  }
  // 'list' and 'custom' have no comparison operator in the schema's own contract (its comment: "absent for 'list' and 'custom'"), matching the reader's own rule; every other type requires one, and a rule carrying none is a malformed model rather than a default to guess.
  const hasOperator =
    validation.type !== "list" && validation.type !== "custom";
  if (hasOperator) {
    if (validation.operator === undefined) {
      throw new BiffWriteError(
        `a ${validation.type} data validation over ${validation.ranges.length} range(s) carries no operator; the schema requires one for every type but 'list' and 'custom'`,
      );
    }
    const typOperator = TYP_OPERATOR_BY_OPERATOR.get(validation.operator);
    if (typOperator === undefined) {
      throw new BiffWriteError(
        `data validation operator "${validation.operator}" has no Dv typOperator value`,
      );
    }
    flags |= typOperator << 20;
  }
  const isTwoOperand =
    validation.operator === "between" || validation.operator === "notBetween";
  if (!isTwoOperand && validation.formula2 !== undefined) {
    throw new BiffWriteError(
      `a data validation with operator "${validation.operator}" carries a second formula; only 'between' and 'notBetween' state two operands`,
    );
  }
  if (isTwoOperand && validation.formula2 === undefined) {
    throw new BiffWriteError(
      `a data validation with operator "${validation.operator}" carries no second formula; 'between' and 'notBetween' require two operands`,
    );
  }
  if (validation.ranges.length === 0) {
    throw new BiffWriteError(
      "a data validation carrying no range states nothing; the schema requires at least one",
    );
  }

  const writer = new RecordBuilder();
  writer.u32(flags);
  // The four strings in the reader's own declared order: PromptTitle, ErrorTitle, Prompt, Error -- absent schema fields write the empty string, which mapDataValidations maps straight back to absent.
  writer.bytes(writeXLUnicodeString(validation.promptTitle ?? ""));
  writer.bytes(writeXLUnicodeString(validation.errorTitle ?? ""));
  writer.bytes(writeXLUnicodeString(validation.prompt ?? ""));
  writer.bytes(writeXLUnicodeString(validation.error ?? ""));
  const [f1Header, f1Rgce] = writeDvParsedFormula(validation.formula1);
  writer.bytes(f1Header).bytes(f1Rgce);
  const [f2Header, f2Rgce] = writeDvParsedFormula(validation.formula2);
  writer.bytes(f2Header).bytes(f2Rgce);
  writer.u16(validation.ranges.length);
  for (const range of validation.ranges) {
    writer.u16(range.startRow);
    writer.u16(range.endRow);
    writer.u16(range.startColumn);
    writer.u16(range.endColumn);
  }
  return writeRecord(RECORD_DV, writer.build());
}

// The Dval wrapper, its 18-byte body mirrored byte-for-byte from a real producer's own output (LibreOffice 26.8.0.3, Excel 97 export filter): a zero wArrange word, eight zero bytes, the no-active-dropdown 0xFFFFFFFF word, then the count of Dv records that follow. The spec's own field table for the UI-state fields this record carries is not independently confirmed here, but these exact bytes are what a real, Excel-interoperable implementation writes for the no-dropdown state -- and this package's own reader skips the record entirely, so the round trip is indifferent to it while real Excel sees the wrapper its grammar names.
function writeDvalRecord(ruleCount: number): Uint8Array<ArrayBuffer> {
  const writer = new RecordBuilder()
    .u16(0)
    .u32(0)
    .u32(0)
    .u32(0xffffffff)
    .u32(ruleCount);
  return writeRecord(RECORD_DVAL, writer.build());
}

export function writeSheetDataValidations(
  sheet: ContentSheet,
): Uint8Array<ArrayBuffer>[] {
  const validations = sheet.dataValidations ?? [];
  if (validations.length === 0) {
    return [];
  }
  for (const validation of validations) {
    for (const range of validation.ranges) {
      if (
        range.startRow > 0xffff ||
        range.endRow > 0xffff ||
        range.startColumn > 0xff ||
        range.endColumn > 0xff
      ) {
        throw new BiffWriteError(
          `a data validation range (rows ${range.startRow}-${range.endRow}, columns ${range.startColumn}-${range.endColumn}) is outside BIFF8's own grid; a .xls workbook cannot address it`,
        );
      }
    }
  }
  return [
    writeDvalRecord(validations.length),
    ...validations.map((validation) => writeDvRecord(validation)),
  ];
}
