import type {
  Color,
  ContentSheet,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetConditionalFormatValue,
} from "document-schema.js";
import { BiffWriteError } from "../biff/write-errors";
import { RecordBuilder } from "../biff/builder";
import { compileFormulaText } from "../biff/ptg-writer";
import { writeRecord } from "../biff/record-writer";
import {
  RECORD_CF,
  RECORD_CF12,
  RECORD_CONDFMT,
  RECORD_CONDFMT12,
} from "../biff/record-types";
import type { SheetRuleOperator } from "document-schema.js";

// The write-side inverse of conditional-format.ts's readCondFmtGroup/readCf and conditional-format-12.ts's readCondFmt12Group/readCf12: a 'cellIs' rule writes as one CondFmt record ([MS-XLS] 2.4.56) carrying exactly one CF record ([MS-XLS] 2.4.42) -- the schema models a rule's ranges per rule, so there is nothing to group the way a multi-rule CondFmt would -- while every other variant the schema models writes as one CondFmt12 ([MS-XLS] 2.4.57) carrying exactly one CF12 ([MS-XLS] 2.4.43), the CF12-era spelling those rule types have no base-CF record for at all. The two families are emitted base-first within one sheet's CONDFMTS section, whose own ABNF (`*(CONDFMT / CONDFMT12) *(CFEx [CF12])`, [MS-XLS] 2.1.7.20.6) admits them interleaved or grouped; the CFEx compatibility spelling -- a legacy CF-plus-extension pair keeping a pre-2007 Excel able to evaluate the rule -- is deliberately not written, the CF12 spelling being the one this package's own reader resolves either way.

const CP_BY_OPERATOR: ReadonlyMap<SheetRuleOperator, number> = new Map([
  ["between", 0x1],
  ["notBetween", 0x2],
  ["equal", 0x3],
  ["notEqual", 0x4],
  ["greaterThan", 0x5],
  ["lessThan", 0x6],
  ["greaterThanOrEqual", 0x7],
  ["lessThanOrEqual", 0x8],
]);

// DXFFNTD's own fixed length ([MS-XLS] 2.4.97), mirrored from parseDxfStyle's own constant: everything this writer states in the block is zero but icvFore.
const DXFFNTD_LENGTH = 122;
const DXFFNTD_ICV_FORE_OFFSET = 64 + 16;

// The DXFN structure ([MS-XLS] 2.4.97), the exact inverse of parseDxfStyle: the 4+2 flag words (bit 26 = a DXFFntD font block, bit 29 = a DXFPat fill block), then only the blocks the flags name, in the reader's own order (font, alignment, border, pattern -- the middle two never set, since the schema's style carries no alignment or border). The font block states one fact and nothing else: the text colour, as icvFore. The pattern block states a solid fill whose visible colour is the foreground icv, the identical reading resolveFillBackground's own solid case makes on the way back in.
function writeDxfn(
  style: ContentSheetConditionalFormatStyle | undefined,
  icvOf: (color: Color) => number,
): Uint8Array<ArrayBuffer> {
  const textColor = style?.textColor;
  const background = style?.background;
  if (textColor === undefined && background === undefined) {
    return new Uint8Array(0);
  }
  const flags = new RecordBuilder();
  let flagsWord = 0;
  if (textColor !== undefined) {
    flagsWord |= 0x1 << 26;
  }
  if (background !== undefined) {
    flagsWord |= 0x1 << 29;
  }
  flags.u32(flagsWord);
  flags.u16(0); // fIfmtUser clear -- no number-format override
  if (textColor !== undefined) {
    const fontBlock = new Uint8Array(DXFFNTD_LENGTH);
    const view = new DataView(
      fontBlock.buffer,
      fontBlock.byteOffset,
      fontBlock.byteLength,
    );
    view.setInt32(DXFFNTD_ICV_FORE_OFFSET, icvOf(textColor), true);
    flags.bytes(fontBlock);
  }
  if (background !== undefined) {
    // DXFPat's packed word, the mirror of parseDxfStyle's own extraction: unused1(10) fls(6) icvForeground(7) icvBackground(7) unused2(2), LSB first. fls 1 is solid, whose visible colour is the foreground icv; the background icv is unread in the solid case, so 0 states nothing it overrides.
    const patWord = (0x1 << 10) | (icvOf(background) << 16);
    flags.u32(patWord >>> 0);
  }
  return flags.build();
}

function writeCfRecord(
  rule: Extract<ContentSheetConditionalFormat, { type: "cellIs" }>,
  icvOf: (color: Color) => number,
): Uint8Array<ArrayBuffer> {
  const cp = CP_BY_OPERATOR.get(rule.operator);
  if (cp === undefined) {
    throw new BiffWriteError(
      `conditional-format operator "${rule.operator}" has no CF cp value`,
    );
  }
  const rgce1 = compileFormulaText(rule.formula1);
  const rgce2 =
    rule.formula2 !== undefined ? compileFormulaText(rule.formula2) : undefined;
  const dxf = writeDxfn(rule.style, icvOf);
  const writer = new RecordBuilder()
    .u8(0x01) // ct: comparison -- the one condition type a base CF record can state
    .u8(cp)
    .u16(rgce1.length)
    .u16(rgce2?.length ?? 0)
    .bytes(dxf)
    .bytes(rgce1);
  if (rgce2 !== undefined) {
    writer.bytes(rgce2);
  }
  return writeRecord(RECORD_CF, writer.build());
}

// One rule's bounding box, the CondFmt/CondFmt12 header's own refBound ([MS-XLS] 2.5.56's CondFmtStructure): the tight rectangle containing every range the rule names -- redundant with sqref for this reader's purposes, but a real consumer's own grammar expects it and it costs four u16s to state honestly.
function boundingBoxOf(rule: ContentSheetConditionalFormat): {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
} {
  let startRow = Number.MAX_SAFE_INTEGER;
  let endRow = 0;
  let startColumn = Number.MAX_SAFE_INTEGER;
  let endColumn = 0;
  for (const range of rule.ranges) {
    startRow = Math.min(startRow, range.startRow);
    endRow = Math.max(endRow, range.endRow);
    startColumn = Math.min(startColumn, range.startColumn);
    endColumn = Math.max(endColumn, range.endColumn);
  }
  return { startRow, endRow, startColumn, endColumn };
}

// --- The CF12 family ([MS-XLS] 2.4.43), one record per non-cellIs rule ---

// CF12's own ct table: comparison (0x01, base CF's domain), formula (0x02, the text family's carrier), colour scale (0x03), data bar (0x04), filter (0x05), icon set (0x06). Everything this writer states beyond cellIs dispatches through one of 0x02/0x03/0x04/0x05/0x06.
const CT_FORMULA = 0x02;
const CT_COLOR_SCALE = 0x03;
const CT_DATA_BAR = 0x04;
const CT_FILTER = 0x05;
const CT_ICON_SET = 0x06;

// icfTemplate ([MS-XLS] 2.4.43's own field table), the rule-creation template the record names -- for the filter family it doubles as the rule's real type discriminator, since ct alone says only "filter". The values below mirror conditional-format-12.ts's own reader constants, kept per this package's one-module-per-direction convention rather than shared across the boundary.
const ICF_TEMPLATE_COLOR_SCALE = 0x0002;
const ICF_TEMPLATE_DATA_BAR = 0x0003;
const ICF_TEMPLATE_ICON_SET = 0x0004;
const ICF_TEMPLATE_FILTER = 0x0005;
const ICF_TEMPLATE_UNIQUE_VALUES = 0x0007;
const ICF_TEMPLATE_CONTAINS_TEXT = 0x0008;
const ICF_TEMPLATE_CONTAINS_BLANKS = 0x0009;
const ICF_TEMPLATE_CONTAINS_NO_BLANKS = 0x000a;
const ICF_TEMPLATE_CONTAINS_ERRORS = 0x000b;
const ICF_TEMPLATE_CONTAINS_NO_ERRORS = 0x000c;
const ICF_TEMPLATE_ABOVE_AVERAGE = 0x0019;
const ICF_TEMPLATE_BELOW_AVERAGE = 0x001a;
const ICF_TEMPLATE_DUPLICATE_VALUES = 0x001b;
const ICF_TEMPLATE_ABOVE_OR_EQUAL_AVERAGE = 0x001d;
const ICF_TEMPLATE_BELOW_OR_EQUAL_AVERAGE = 0x001e;

// CFExTemplateParams is a fixed 16-byte block CF12 always carries between cbTemplateParm and rgbCT; only its first bytes are meaningful, and which bytes those are depends on the template ([MS-XLS] 2.5.23-2.5.27).
const TEMPLATE_PARAMS_SIZE = 16;

// The CFVO type codes' inverse ([MS-XLS] 2.5.40's own cfvoType table), mirrored from conditional-format-12.ts's CFVO_TYPE_TO_VALUE_TYPE.
function cfvoTypeCodeOf(
  value: ContentSheetConditionalFormatValue,
): number | undefined {
  switch (value.type) {
    case "num":
      return 0x01;
    case "min":
      return 0x02;
    case "max":
      return 0x03;
    case "percent":
      return 0x04;
    case "percentile":
      return 0x05;
    case "formula":
      return 0x07;
    default:
      return undefined;
  }
}

// One CFVO ([MS-XLS] 2.5.40): cfvoType, a CFVOParsedFormula (cce + rgce, no unused word -- the one Ptg-carrying formula structure in this family that omits it), then an Xnum numValue present only when the formula is empty and the type names a value rather than a bound. Every value-bearing type is written through its rgce rather than its numValue: a type-0x04/0x05 numValue is constrained to 0..100 and a type-0x07 one is forbidden outright ([MS-XLS] 2.5.40's own numValue rules), while the compiled-form carrier is legal for every type and is the one spelling a value of any shape (a bare number or a genuine formula) round-trips through losslessly.
function writeCfvo(
  value: ContentSheetConditionalFormatValue,
): Uint8Array<ArrayBuffer> {
  const cfvoType = cfvoTypeCodeOf(value);
  if (cfvoType === undefined) {
    throw new BiffWriteError(
      `internal error: ContentSheetConditionalFormatValue carries type "${value.type}", which cfvoTypeCodeOf has no [MS-XLS] 2.5.40 cfvoType code for`,
    );
  }
  if (value.type === "min" || value.type === "max") {
    // A bound, not a value: no rgce, no numValue.
    return new RecordBuilder().u8(cfvoType).u16(0).build();
  }
  if (value.value === undefined) {
    throw new BiffWriteError(
      `a conditional-format threshold of type "${value.type}" carries no value; the shared schema states a value for every type but "min" and "max", and a CFVO has no spelling for a valueless threshold of any other kind`,
    );
  }
  const rgce = compileFormulaText(value.value);
  return new RecordBuilder().u8(cfvoType).u16(rgce.length).bytes(rgce).build();
}

// CFColor ([MS-XLS] 2.5.21), written only in its LongRGBA shape (xclrType 0x00000002): this writer holds a resolved RGB triple and no theme to reference, and XCLRTHEMED has no resolution without one. numTint is 0.0 -- the schema's colour carries no tint of its own to state.
function writeCfColor(color: Color): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u32(0x00000002) // XCLRRGB
    .u8(Math.round(color.r * 255))
    .u8(Math.round(color.g * 255))
    .u8(Math.round(color.b * 255))
    .u8(0) // alpha -- ColorSchema has no alpha channel
    .f64(0) // numTint
    .build();
}

// CFGradient ([MS-XLS] 2.5.32) for a colour-scale rule's stops: two fixed counts (both the stop count, 2 or 3), then rgInterp (one CFGradientInterpItem per stop: its CFVO plus the fixed domain fraction [MS-XLS] 2.5.33 itself pins to 0.0/0.5/1.0), then rgCurve (one CFGradientItem per stop: the pinned range fraction, then the stop's CFColor). The flags byte sets fBackground (MUST be 1) and fClamp (SHOULD be 1).
function writeCfGradient(
  rule: Extract<ContentSheetConditionalFormat, { type: "colorScale" }>,
): Uint8Array<ArrayBuffer> {
  const count = rule.stops.length;
  const interpFractions = count === 3 ? [0.0, 0.5, 1.0] : [0.0, 1.0];
  const out = new RecordBuilder()
    .u16(0) // unused
    .u8(0) // reserved1
    .u8(count) // cInterpCurve
    .u8(count) // cGradientCurve
    .u8(0b11); // fClamp | fBackground
  rule.stops.forEach((stop, index) => {
    out.bytes(writeCfvo(stop.value)).f64(interpFractions[index] ?? 1.0);
  });
  rule.stops.forEach((stop, index) => {
    out.f64(interpFractions[index] ?? 1.0).bytes(writeCfColor(stop.color));
  });
  return out.build();
}

// CFDatabar ([MS-XLS] 2.5.22): the flags byte states fShowValue only (fRightToLeft clear), the two bar-width percentages are written at their extremes -- a minimum-value bar taking none of the cell and a maximum-value bar taking all of it, the display a data bar has when a file states no narrower band of its own -- then the bar colour and the two threshold CFVOs.
function writeCfDatabar(
  rule: Extract<ContentSheetConditionalFormat, { type: "dataBar" }>,
): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16(0) // unused
    .u8(0) // reserved1
    .u8(rule.showValue === false ? 0 : 0b10) // fShowValue on bit 1
    .u8(0) // iPercentMin
    .u8(100) // iPercentMax
    .bytes(writeCfColor(rule.color))
    .bytes(writeCfvo(rule.min))
    .bytes(writeCfvo(rule.max))
    .build();
}

// CFMultistate's own cStates constraint ([MS-XLS] 2.5.36): the threshold count is not free -- the named icon set fixes it at 3, 4, or 5 icons, so the schema's thresholds array must match the set before the rule can be written at all.
function iconSetThresholdCount(iIconSet: number): number {
  if (iIconSet <= 0x07) {
    return 3;
  }
  if (iIconSet <= 0x0c) {
    return 4;
  }
  return 5;
}

// CFMultistate ([MS-XLS] 2.5.36) for an icon-set rule's thresholds. The iIconSet byte names one of the seventeen built-in sets ([MS-XLS] 2.5.36's own table, in the identical order conditional-format-12.ts's ICON_SET_TYPE_NAMES reads it back through -- including that table's own 0x04/0x05 ordering, which follows the two independent real implementations rather than the spec page's prose, per that reader constant's own comment); a set name outside those seventeen is a producer-extensible vocabulary member with no BIFF8 byte, refused by name rather than written as a set it is not.
const ICON_SET_TYPE_NAMES: readonly string[] = [
  "3Arrows",
  "3ArrowsGray",
  "3Flags",
  "3TrafficLights1",
  "3TrafficLights2",
  "3Signs",
  "3Symbols",
  "3Symbols2",
  "4Arrows",
  "4ArrowsGray",
  "4RedToBlack",
  "4Rating",
  "4TrafficLights",
  "5Arrows",
  "5ArrowsGray",
  "5Rating",
  "5Quarters",
];

function writeCfMultistate(
  rule: Extract<ContentSheetConditionalFormat, { type: "iconSet" }>,
): Uint8Array<ArrayBuffer> {
  const iIconSet = ICON_SET_TYPE_NAMES.indexOf(rule.iconSetType);
  if (iIconSet < 0) {
    throw new BiffWriteError(
      `xls-codec cannot write an icon-set rule naming the icon set "${rule.iconSetType}": [MS-XLS] 2.5.36's own iIconSet table names exactly the seventeen built-in sets, and a custom set has no BIFF8 byte to be written as`,
    );
  }
  const expectedThresholds = iconSetThresholdCount(iIconSet);
  if (rule.thresholds.length !== expectedThresholds) {
    throw new BiffWriteError(
      `an icon-set rule naming the icon set "${rule.iconSetType}" carries ${rule.thresholds.length} thresholds where [MS-XLS] 2.5.36's own cStates table fixes the set at ${expectedThresholds}; the threshold count and the set cannot disagree in one CFMultistate`,
    );
  }
  const out = new RecordBuilder()
    .u16(0) // unused
    .u8(0) // reserved1
    .u8(expectedThresholds) // cStates
    .u8(iIconSet)
    .u8(
      (rule.showValue === false ? 0b1 : 0) | // A - fIconOnly: the cell's own value hidden
        (rule.reverse === true ? 0b100 : 0), // C - fReverse
    );
  for (const threshold of rule.thresholds) {
    out.bytes(writeCfvo(threshold)).u8(0); // fEqual: values equal to the threshold do not pass it
    out.u32(0); // unused
  }
  return out.build();
}

// CFFilter ([MS-XLS] 2.5.30), the rgbCT a ct 0x05 rule always carries: its own size in cbFilter (4, excluding cbFilter itself), then the same fTop/fPercent/iParam triple CFExFilterParams states for a top10 rule. Every non-top10 filter rule writes zeros here -- CFFilter is the top-N structure, and [MS-XLS] gives the other filter templates no rgbCT payload of their own.
function writeCfFilter(
  top10: Extract<ContentSheetConditionalFormat, { type: "top10" }> | undefined,
): Uint8Array<ArrayBuffer> {
  const flags =
    top10 === undefined
      ? 0
      : (top10.bottom === true ? 0 : 1) | // fTop: 1 unless the rule selects from the bottom
        (top10.percent === true ? 0b10 : 0); // fPercent
  return new RecordBuilder()
    .u16(4) // cbFilter: the bytes after this field
    .u8(0) // reserved1
    .u8(flags)
    .u16(top10?.rank ?? 0) // iParam
    .build();
}

// The ten BIFF8 time-period icfTemplate values, the inverse of conditional-format-12.ts's ICF_TEMPLATE_TO_TIME_PERIOD. The schema's thisYear/lastYear/nextYear members are deliberately absent: they exist only as LibreOffice's own calcext:date-is extension values (document-schema.js's own comment on the enum cites the odf.js reading that introduced them), and no icfTemplate names them -- an ODF-only member of the vocabulary with no BIFF8 spelling.
const TIME_PERIOD_TO_ICF_TEMPLATE: ReadonlyMap<
  Extract<ContentSheetConditionalFormat, { type: "timePeriod" }>["timePeriod"],
  number
> = new Map([
  ["today", 0x000f],
  ["tomorrow", 0x0010],
  ["yesterday", 0x0011],
  ["last7Days", 0x0012],
  ["lastMonth", 0x0013],
  ["nextMonth", 0x0014],
  ["thisWeek", 0x0015],
  ["nextWeek", 0x0016],
  ["lastWeek", 0x0017],
  ["thisMonth", 0x0018],
]);

// The operand-free family's icfTemplate values, the inverse of conditional-format-12.ts's SIMPLE_ICF_TEMPLATE_KIND: CFExDefaultTemplateParams is 16 reserved bytes, so the template value is the whole rule.
const SIMPLE_KIND_TO_ICF_TEMPLATE: ReadonlyMap<
  Extract<
    ContentSheetConditionalFormat,
    {
      type:
        | "containsBlanks"
        | "notContainsBlanks"
        | "containsErrors"
        | "notContainsErrors"
        | "uniqueValues"
        | "duplicateValues";
    }
  >["type"],
  number
> = new Map([
  ["containsBlanks", ICF_TEMPLATE_CONTAINS_BLANKS],
  ["notContainsBlanks", ICF_TEMPLATE_CONTAINS_NO_BLANKS],
  ["containsErrors", ICF_TEMPLATE_CONTAINS_ERRORS],
  ["notContainsErrors", ICF_TEMPLATE_CONTAINS_NO_ERRORS],
  ["uniqueValues", ICF_TEMPLATE_UNIQUE_VALUES],
  ["duplicateValues", ICF_TEMPLATE_DUPLICATE_VALUES],
]);

// ctp ([MS-XLS] 2.5.27's CFExTextTemplateParams table): which of the four text sub-types a containsText-family rule is, the inverse of conditional-format-12.ts's CTP_TO_TEXT_KIND.
const CTP_BY_TEXT_TYPE: ReadonlyMap<
  Extract<
    ContentSheetConditionalFormat,
    { type: "containsText" | "notContainsText" | "beginsWith" | "endsWith" }
  >["type"],
  number
> = new Map([
  ["containsText", 0x0000],
  ["notContainsText", 0x0001],
  ["beginsWith", 0x0002],
  ["endsWith", 0x0003],
]);

// The formula a text-predicate rule carries as its ct 0x02 condition: neither CFExTextTemplateParams nor CFFilter has anywhere to state the literal search text, so it lives only as the PtgStr operand of the formula itself -- written in the shape Excel's own rule generator and LibreOffice's own GetFixedFormula both produce (sc/source/filter/excel/xestyle... and xcl97... confirmed shapes; see conditional-format-12.ts's own top comment for the reader-side citation), referencing the rule's own first anchor cell relatively. The first string literal of each shape is the search text, which is exactly what the reader's extractFirstStringLiteral recovers.
function textRuleFormula(
  rule: Extract<
    ContentSheetConditionalFormat,
    { type: "containsText" | "notContainsText" | "beginsWith" | "endsWith" }
  >,
): string {
  const anchor = rule.ranges[0];
  if (anchor === undefined) {
    throw new BiffWriteError(
      "internal error: textRuleFormula was called for a rule whose ranges were never validated",
    );
  }
  const cell = relativeCellRef(anchor.startRow, anchor.startColumn);
  // An Excel string literal escapes a double quote by doubling it -- the identical spelling biff/ptg-writer.ts's own tokenizer reads back -- so the literal is built here rather than through JSON.stringify, whose backslash escape has no meaning in a formula.
  const text = `"${rule.text.replaceAll('"', '""')}"`;
  switch (rule.type) {
    case "containsText":
      return `NOT(ISERROR(SEARCH(${text},${cell})))`;
    case "notContainsText":
      return `ISERROR(SEARCH(${text},${cell}))`;
    case "beginsWith":
      return `LEFT(${cell},LEN(${text}))=${text}`;
    case "endsWith":
      return `RIGHT(${cell},LEN(${text}))=${text}`;
  }
}

// A relative A1 reference (no $ markers) for the anchor a text rule's formula evaluates each cell against -- relative, because Excel's own generated formulas spell it that way and the anchor names the range's first cell, not a fixed reference the rule means to keep.
function relativeCellRef(row: number, column: number): string {
  let letters = "";
  let index = column;
  do {
    letters = String.fromCharCode(0x41 + (index % 26)) + letters;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return `${letters}${row + 1}`;
}

// One CF12 record's full payload, dispatching on the rule's variant. The skeleton every variant shares -- frtRefHeader, ct/cp, the two operand lengths, the DXFN12, the operands, the empty activity formula, flags, ipriority, the template block -- is [MS-XLS] 2.4.43's own field order, the exact inverse of conditional-format-12.ts's readCf12 walk.
function writeCf12Record(
  rule: Exclude<ContentSheetConditionalFormat, { type: "cellIs" }>,
  ipriority: number,
  icvOf: (color: Color) => number,
): Uint8Array<ArrayBuffer> {
  let ct: number;
  let icfTemplate: number;
  let templateParams: Uint8Array<ArrayBuffer>;
  let rgbCt: Uint8Array<ArrayBuffer> | undefined;
  let rgce1: Uint8Array<ArrayBuffer> | undefined;
  let dxf: Uint8Array<ArrayBuffer>;

  switch (rule.type) {
    case "colorScale":
      ct = CT_COLOR_SCALE;
      icfTemplate = ICF_TEMPLATE_COLOR_SCALE;
      templateParams = new Uint8Array(TEMPLATE_PARAMS_SIZE);
      rgbCt = writeCfGradient(rule);
      dxf = new Uint8Array(0); // [MS-XLS] 2.4.43: cbDxf MUST be 0 for ct 0x03
      break;
    case "dataBar":
      ct = CT_DATA_BAR;
      icfTemplate = ICF_TEMPLATE_DATA_BAR;
      templateParams = new Uint8Array(TEMPLATE_PARAMS_SIZE);
      rgbCt = writeCfDatabar(rule);
      dxf = new Uint8Array(0); // cbDxf MUST be 0 for ct 0x04
      break;
    case "iconSet":
      ct = CT_ICON_SET;
      icfTemplate = ICF_TEMPLATE_ICON_SET;
      templateParams = new Uint8Array(TEMPLATE_PARAMS_SIZE);
      rgbCt = writeCfMultistate(rule);
      dxf = new Uint8Array(0); // cbDxf MUST be 0 for ct 0x06
      break;
    case "top10": {
      ct = CT_FILTER;
      icfTemplate = ICF_TEMPLATE_FILTER;
      // CFExFilterParams ([MS-XLS] 2.5.25): the flags byte (fTop/fPercent), iParam, then 13 reserved bytes.
      templateParams = new RecordBuilder()
        .u8((rule.bottom === true ? 0 : 1) | (rule.percent === true ? 0b10 : 0))
        .u16(rule.rank)
        .bytes(new Uint8Array(13))
        .build();
      rgbCt = writeCfFilter(rule);
      dxf = writeDxfn(rule.style, icvOf);
      break;
    }
    case "aboveAverage": {
      ct = CT_FILTER;
      icfTemplate = !(rule.aboveAverage ?? true)
        ? rule.equalAverage === true
          ? ICF_TEMPLATE_BELOW_OR_EQUAL_AVERAGE
          : ICF_TEMPLATE_BELOW_AVERAGE
        : rule.equalAverage === true
          ? ICF_TEMPLATE_ABOVE_OR_EQUAL_AVERAGE
          : ICF_TEMPLATE_ABOVE_AVERAGE;
      // CFExAveragesTemplateParams ([MS-XLS] 2.5.23): iParam -- the standard-deviation count, one of 0/1/2 -- then 14 reserved bytes.
      const stdDev = rule.stdDev ?? 0;
      if (stdDev > 2) {
        throw new BiffWriteError(
          `an aboveAverage rule declaring ${stdDev} standard deviations cannot be written: [MS-XLS] 2.5.23's own iParam table admits only 0, 1, or 2`,
        );
      }
      templateParams = new RecordBuilder()
        .u16(stdDev)
        .bytes(new Uint8Array(14))
        .build();
      rgbCt = writeCfFilter(undefined);
      dxf = writeDxfn(rule.style, icvOf);
      break;
    }
    case "timePeriod": {
      ct = CT_FILTER;
      const template = TIME_PERIOD_TO_ICF_TEMPLATE.get(rule.timePeriod);
      if (template === undefined) {
        throw new BiffWriteError(
          `a timePeriod rule naming "${rule.timePeriod}" cannot be written: that member exists only in LibreOffice's calcext extension vocabulary ([MS-XLS] 2.4.43's own icfTemplate table has no year-scoped period), so no BIFF8 rule names it`,
        );
      }
      icfTemplate = template;
      // CFExDateTemplateParams ([MS-XLS] 2.5.24): dateOp restates icfTemplate, then 14 reserved bytes.
      templateParams = new RecordBuilder()
        .u16(template)
        .bytes(new Uint8Array(14))
        .build();
      rgbCt = writeCfFilter(undefined);
      dxf = writeDxfn(rule.style, icvOf);
      break;
    }
    case "containsBlanks":
    case "notContainsBlanks":
    case "containsErrors":
    case "notContainsErrors":
    case "uniqueValues":
    case "duplicateValues": {
      ct = CT_FILTER;
      const template = SIMPLE_KIND_TO_ICF_TEMPLATE.get(rule.type);
      if (template === undefined) {
        throw new BiffWriteError(
          `internal error: SIMPLE_KIND_TO_ICF_TEMPLATE has no icfTemplate for rule type "${rule.type}"`,
        );
      }
      icfTemplate = template;
      templateParams = new Uint8Array(TEMPLATE_PARAMS_SIZE); // CFExDefaultTemplateParams: 16 reserved bytes
      rgbCt = writeCfFilter(undefined);
      dxf = writeDxfn(rule.style, icvOf);
      break;
    }
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith": {
      ct = CT_FORMULA;
      icfTemplate = ICF_TEMPLATE_CONTAINS_TEXT;
      // CFExTextTemplateParams ([MS-XLS] 2.5.27): ctp, then 14 reserved bytes.
      const ctp = CTP_BY_TEXT_TYPE.get(rule.type);
      if (ctp === undefined) {
        throw new BiffWriteError(
          `internal error: CTP_BY_TEXT_TYPE has no ctp for rule type "${rule.type}"`,
        );
      }
      templateParams = new RecordBuilder()
        .u16(ctp)
        .bytes(new Uint8Array(14))
        .build();
      // ct 0x02's condition is the formula itself; rgbCT MUST be omitted ([MS-XLS] 2.4.43's own ct table).
      rgce1 = compileFormulaText(textRuleFormula(rule));
      dxf = writeDxfn(rule.style, icvOf);
      break;
    }
    default:
      // The switch above is exhaustive over the schema's own rule-type union, so this branch exists only to satisfy the definite-assignment analysis of the shared skeleton fields below.
      throw new BiffWriteError(
        "internal error: writeCf12Record was called for a rule type its own dispatch never names",
      );
  }

  const writer = new RecordBuilder()
    .u16(RECORD_CF12) // frtRefHeader.rt
    .u16(0) // frtRefHeader.grbitFrt: fFrtRef clear
    .bytes(new Uint8Array(8)) // frtRefHeader.ref8: MUST be zero
    .u8(ct)
    .u8(0) // cp: meaningful only for a ct 0x01 comparison, which this writer routes to a base CF record instead
    .u16(rgce1?.length ?? 0) // cce1
    .u16(0) // cce2: meaningful only for ct 0x01 with a two-operand cp
    .u32(dxf.length) // DXFN12's cbDxf
    .bytes(dxf);
  if (rgce1 !== undefined) {
    writer.bytes(rgce1);
  }
  writer
    .u16(0) // fmlaActive.cce: no separate activity condition
    .u8(rule.stopIfTrue === true ? 0b10 : 0) // B - fStopIfTrue on bit 1
    .u16(ipriority)
    .u16(icfTemplate)
    .u8(TEMPLATE_PARAMS_SIZE) // cbTemplateParm: MUST be 16
    .bytes(templateParams);
  if (rgbCt !== undefined) {
    writer.bytes(rgbCt);
  }
  return writeRecord(RECORD_CF12, writer.build());
}

// ipriority MUST be unique across every CF12 record in the worksheet substream ([MS-XLS] 2.4.43). The schema's priority is optional, but the field is not, so a rule stating none is minted the smallest positive integer no other rule of the sheet took -- while two rules stating the same priority is a document whose own ordering contradicts itself, and is refused rather than silently renumbered.
function assignPriorities(
  rules: readonly Exclude<ContentSheetConditionalFormat, { type: "cellIs" }>[],
): number[] {
  const used = new Set<number>();
  for (const rule of rules) {
    if (rule.priority === undefined) {
      continue;
    }
    if (used.has(rule.priority)) {
      throw new BiffWriteError(
        `two conditional-format rules declare priority ${rule.priority}; [MS-XLS] 2.4.43 requires ipriority to be unique across a sheet's CF12 records, so a document repeating one is contradictory rather than orderable`,
      );
    }
    used.add(rule.priority);
  }
  return rules.map((rule) => {
    if (rule.priority !== undefined) {
      return rule.priority;
    }
    let candidate = 1;
    while (used.has(candidate)) {
      candidate += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function writeCondFmt12Record(
  rule: Exclude<ContentSheetConditionalFormat, { type: "cellIs" }>,
  nID: number,
): Uint8Array<ArrayBuffer> {
  const box = boundingBoxOf(rule);
  // FrtRefHeaderU ([MS-XLS] 2.4.57's own prose): rt names this record, fFrtRef is set, and ref8 restates mainCF.refBound field for field (rowFirst, rowLast, colFirst, colLast).
  const header = new RecordBuilder()
    .u16(RECORD_CONDFMT12)
    .u16(0x0001) // grbitFrt: fFrtRef
    .u16(box.startRow)
    .u16(box.endRow)
    .u16(box.startColumn)
    .u16(box.endColumn)
    .u16(1) // ccf: this group carries exactly one CF12
    .u16(nID << 1) // fToughRecalc (bit 0) clear, nID in bits 1-15
    .u16(box.startRow)
    .u16(box.endRow)
    .u16(box.startColumn)
    .u16(box.endColumn)
    .u16(rule.ranges.length);
  for (const range of rule.ranges) {
    header.u16(range.startRow);
    header.u16(range.endRow);
    header.u16(range.startColumn);
    header.u16(range.endColumn);
  }
  return writeRecord(RECORD_CONDFMT12, header.build());
}

function validateRuleGrid(rule: ContentSheetConditionalFormat): void {
  if (rule.ranges.length === 0) {
    throw new BiffWriteError(
      "a conditional-format rule carrying no range states nothing; the schema requires at least one",
    );
  }
  for (const range of rule.ranges) {
    if (
      range.startRow > 0xffff ||
      range.endRow > 0xffff ||
      range.startColumn > 0xff ||
      range.endColumn > 0xff
    ) {
      throw new BiffWriteError(
        `a conditional-format range (rows ${range.startRow}-${range.endRow}, columns ${range.startColumn}-${range.endColumn}) is outside BIFF8's own grid; a .xls workbook cannot address it`,
      );
    }
  }
}

// [MS-XLS] 2.4.43 pins fStopIfTrue to zero for the three visual-scale rule types, so a stopIfTrue colour scale/data bar/icon set is a document the record vocabulary itself cannot state -- refused by name rather than written with the bit silently dropped, the identical refusal the four out-of-scope formula constructs already draw.
function validateStopIfTrue(
  rule: Exclude<ContentSheetConditionalFormat, { type: "cellIs" }>,
): void {
  if (
    rule.stopIfTrue === true &&
    (rule.type === "colorScale" ||
      rule.type === "dataBar" ||
      rule.type === "iconSet")
  ) {
    throw new BiffWriteError(
      `a conditional-format rule of type "${rule.type}" declaring stopIfTrue cannot be written: [MS-XLS] 2.4.43 pins CF12's own fStopIfTrue bit to zero for the visual-scale rule types`,
    );
  }
}

export function writeSheetConditionalFormats(
  sheet: ContentSheet,
  icvOf: (color: Color) => number,
): Uint8Array<ArrayBuffer>[] {
  const rules = sheet.conditionalFormats ?? [];
  if (rules.length === 0) {
    return [];
  }
  const basePieces: Uint8Array<ArrayBuffer>[] = [];
  const cf12Pieces: Uint8Array<ArrayBuffer>[] = [];
  // nID ([MS-XLS] 2.5.56's CondFmtStructure): the group's own identifier, unique per worksheet, minted as the rule's own 1-based position in the sheet's full rule list -- base CondFmt and CondFmt12 groups draw from the one sequence, because a later CFEx record's own nID cross-references either kind. 15 bits is the field's whole width.
  if (rules.length > 0x7fff) {
    throw new BiffWriteError(
      `this sheet's ${rules.length} conditional-format rules exceed CondFmt's own 15-bit nID field`,
    );
  }
  const cf12Rules: {
    readonly rule: Exclude<ContentSheetConditionalFormat, { type: "cellIs" }>;
    readonly nID: number;
  }[] = [];
  rules.forEach((rule, index) => {
    validateRuleGrid(rule);
    if (rule.type === "cellIs") {
      basePieces.push(
        writeCondFmtRecord(rule, index + 1),
        writeCfRecord(rule, icvOf),
      );
      return;
    }
    validateStopIfTrue(rule);
    cf12Rules.push({ rule, nID: index + 1 });
  });
  const priorities = assignPriorities(cf12Rules.map(({ rule }) => rule));
  cf12Rules.forEach(({ rule, nID }, index) => {
    const ipriority = priorities[index];
    if (ipriority === undefined) {
      throw new BiffWriteError(
        "internal error: assignPriorities returned fewer priorities than there are CF12 rules",
      );
    }
    cf12Pieces.push(
      writeCondFmt12Record(rule, nID),
      writeCf12Record(rule, ipriority, icvOf),
    );
  });
  // Base groups first, then the CF12 groups, both inside the one CONDFMTS run -- [MS-XLS] 2.1.7.20.6's own production (`*(CONDFMT / CONDFMT12)`) admits either grouping, and conditional-format.ts's reader walk is order-tolerant across the two families besides.
  return [...basePieces, ...cf12Pieces];
}

// CondFmt ([MS-XLS] 2.4.56): one wrapper per base cellIs rule, carrying the group's own nID -- the rule's 1-based position in the sheet's full rule list, minted by the caller.
function writeCondFmtRecord(
  rule: Extract<ContentSheetConditionalFormat, { type: "cellIs" }>,
  nID: number,
): Uint8Array<ArrayBuffer> {
  const box = boundingBoxOf(rule);
  const header = new RecordBuilder()
    .u16(1) // ccf: this group carries exactly one CF
    .u16(nID << 1) // fToughRecalc (bit 0) clear, nID in bits 1-15
    .u16(box.startRow)
    .u16(box.endRow)
    .u16(box.startColumn)
    .u16(box.endColumn)
    .u16(rule.ranges.length);
  for (const range of rule.ranges) {
    header.u16(range.startRow);
    header.u16(range.endRow);
    header.u16(range.startColumn);
    header.u16(range.endColumn);
  }
  return writeRecord(RECORD_CONDFMT, header.build());
}
