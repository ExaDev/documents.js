import type {
  Color,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatValue,
  ContentSheetRange,
} from "document-schema.js";
import { BlockCursor } from "../biff/cursor";
import type { FormulaSheetContext } from "../biff/ptg";
import { extractFirstStringLiteral, parseFormulaText } from "../biff/ptg";
import { BiffFormatError } from "../biff/records";
import type { RecordGroup } from "../biff/substreams";
import { RECORD_CF12 } from "../biff/record-types";
import {
  parseDxfStyle,
  type RawConditionalFormatStyle,
} from "./conditional-format";

// CondFmt12 ([MS-XLS] 2.4.57, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/b891e737-12f6-41dd-b8a8-7360a4826d4a) is CondFmt's own "future record" (FRT) counterpart: it wraps a CondFmtStructure ([MS-XLS] 2.4's own CondFmtStructure, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/1f4b7576-b5e0-40f0-b2c6-b447d0954b17 -- the identical ccf/flags/refBound/sqref shape CondFmt's own body already carries), prefixed by a 12-byte FrtRefHeaderU this reader never needs, and marks the start of the CF12 ([MS-XLS] 2.4.43, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/3b6a364e-8c34-4830-a8b1-5a51476a9934) records it names via mainCF.ccf. A CF12's own ct field picks one of six rule shapes: colour scale (ct 0x03), data bar (ct 0x04), and icon set (ct 0x06) are read via their own array-of-thresholds building block (ExaDev/documents.js#1104); comparison/formula rules re-expressed in this newer record shape (ct 0x01/0x02) stay unread here, since base CF already covers them.
//
// ct 0x05 ("filter") is a further dispatch: icfTemplate (an unsigned integer alongside a 16-byte CFExTemplateParams block, both always present regardless of ct) names one of roughly fifteen templates -- top10, aboveAverage (and its below/or-equal siblings), duplicateValues, uniqueValues, four blank/error conditions, ten date/time periods, and four containsText sub-types. Every one of those except containsText is read here via this ct 0x05 dispatch (ExaDev/documents.js#1106): CFExTemplateParams turns out to need real parsing for only two of its five variants (CFExFilterParams for top10; CFExAveragesTemplateParams for the aboveAverage family) -- CFExDefaultTemplateParams (duplicateValues/uniqueValues/blank/error conditions) is 16 reserved bytes, and CFExDateTemplateParams's own dateOp field is a fixed 1:1 restatement of icfTemplate itself, so both dispatch directly off icfTemplate with no further byte reading at all.
//
// containsText/notContainsText/beginsWith/endsWith (icfTemplate 0x0008, "Contains text") is NOT a ct 0x05 rule at all, despite sharing the same icfTemplate/CFExTemplateParams dispatch mechanism -- CFExTextTemplateParams carries only ctp, which of the four text sub-types the rule is, never the literal search text itself, and ct 0x05's own rgbCT (a CFFilter) has nowhere for one either: [MS-XLS]'s own CFFilter page (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/1fbbdfb0-5320-43bc-a8a5-c81dbeba9b7b) documents exactly fTop/fPercent/iParam and nothing else, confirmed against a second, independent transcription of the same structure (kinkou/unxls's own cffilter reader, https://github.com/kinkou/unxls/blob/master/lib/unxls/biff8/structure.rb, which reads it as an unconditional fixed 6 bytes -- no variable trailer). A text rule instead rides ct 0x02 (a formula condition) with a genuine, non-zero rgce1: read below in readCf12's own final branch, and by conditional-format-ex.ts's readCfEx for the equivalent case where Excel keeps the rule expressible as a legacy (pre-2007) CF's own formula rather than promoting it into a CF12 record. Both paths share readCfTextFilterRule, extracting the search text via ptg.ts's extractFirstStringLiteral -- see that function's own comment, and conditional-format-ex.ts's, for why the text is safe to pull out of the formula's first PtgStr operand without interpreting the formula as a whole.
//
// [MS-XLS] 2.4.43's own ct table constrains DXFN12's own cbDxf to zero ONLY for ct 0x03/0x04/0x06 ("If ct is equal to 0x03, 0x04 or 0x06, then dxf.cbDxf MUST be equal to 0x00000000") -- colour scale/data bar/icon set formatting carries its own colour fields directly, so no style extraction applies to those three. ct 0x05 is NOT covered by that constraint: a filter rule's own DXFN12 can carry a genuine font/fill override, resolved through the identical parseDxfStyle base CF's own DXFN already uses (see readCf12's own ct 0x05 branch).
//
// A CondFmt12/CF12 record longer than the 8224-byte single-record ceiling continues onto one or more ContinueFrt12 records rather than the plain Continue every other reader in this package joins against -- handled once, generically, in biff/substreams.ts's own groupRecords (not here), so record.blocks already spans any such continuation by the time this file ever sees a RecordGroup.

const CFVO_TYPE_TO_VALUE_TYPE: ReadonlyMap<
  number,
  ContentSheetConditionalFormatValue["type"]
> = new Map([
  [0x01, "num"],
  [0x02, "min"],
  [0x03, "max"],
  [0x04, "percent"],
  [0x05, "percentile"],
  [0x07, "formula"],
]);

// A CFVO ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/3cc68999-c2fc-4a57-92a5-94c0720779e9): cfvoType(1) then a CFVOParsedFormula ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/acaed966-4eee-4578-ae5b-a23a781a8944 -- cce(2) + rgce, no "unused" field -- unlike DVParsedFormula/CFParsedFormulaNoCCE, this is the one Ptg-carrying formula structure in this whole conditional-formatting family that omits it), then an Xnum numValue, present only when the formula is empty (cce === 0) and cfvoType is neither 'min' nor 'max' (those two name a bound rather than carrying a value at all, matching ContentSheetConditionalFormatValueSchema's own "absent for 'min'/'max'" contract).
function readCfvo(
  cursor: BlockCursor,
  formulaSheets: FormulaSheetContext,
): ContentSheetConditionalFormatValue | undefined {
  const cfvoType = cursor.u8();
  const type = CFVO_TYPE_TO_VALUE_TYPE.get(cfvoType);
  const cce = cursor.u16();
  const rgce = cursor.take(cce);
  const hasFormula = cce > 0;
  const numValue =
    !hasFormula && type !== "min" && type !== "max" ? cursor.f64() : undefined;
  if (type === undefined) {
    return undefined;
  }
  if (type === "min" || type === "max") {
    return { type };
  }
  const value = hasFormula
    ? parseFormulaText(rgce, formulaSheets)
    : (numValue?.toString() ?? undefined);
  if (value === undefined) {
    return undefined;
  }
  return { type, value };
}

// CFColor ([MS-XLS] 2.4, 16 bytes, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/fd8e679d-069f-486b-ab48-2382cc167305): xclrType (an XColorType, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/7f0948f7-7e7a-4ae7-85e7-7cdf9b83c22a, 4 bytes) names which of ColorICV ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/dcfc4972-68fc-4425-b47d-6cee71be72e7)/LongRGBA ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/ef480296-bdc3-4bcb-bd1e-cd354b79d7c2)/ColorTheme xclrValue(4) actually holds, then an 8-byte tint/shade Xnum -- Excel's own TintAndShade model (a single -1.0..1.0 value; negative shades toward black, positive tints toward white), carried alongside the resolved colour and applied once resolution is complete (mapCfColor in content.ts, via xf-colors.ts's applyTint). Only the two colour-table-independent shapes this package already knows how to resolve are promoted: XCLRINDEXED (a ColorICV, resolved through globals.palette the identical way a regular cell's own fill/border icv already is -- deferred to content.ts, matching that established split) and XCLRRGB (a LongRGBA, resolved here directly since it needs no palette at all). XCLRAUTO and XCLRTHEMED have no fixed RGB this reader can state without a real BIFF8 Theme reader, which this package does not have; XCLRNINCHED is documented as "colour not set". All three degrade to unresolvable -- an honest absence beats a wrong colour, the same "narrow rather than guess" boundary this package's own DXFN reading already draws for a DXFNumUsr's ambiguous length.
export type RawCfColor =
  | { readonly kind: "icv"; readonly icv: number; readonly tint: number }
  | { readonly kind: "rgb"; readonly color: Color; readonly tint: number };

const XCLR_INDEXED = 0x00000001;
const XCLR_RGB = 0x00000002;

function readCfColor(cursor: BlockCursor): RawCfColor | undefined {
  const xclrType = cursor.u32();
  if (xclrType === XCLR_INDEXED) {
    const icv = cursor.u32();
    const tint = cursor.f64();
    return { kind: "icv", icv, tint };
  }
  if (xclrType === XCLR_RGB) {
    const red = cursor.u8();
    const green = cursor.u8();
    const blue = cursor.u8();
    cursor.skip(1); // alpha -- ColorSchema has no alpha channel
    const tint = cursor.f64();
    return {
      kind: "rgb",
      color: { r: red / 255, g: green / 255, b: blue / 255 },
      tint,
    };
  }
  cursor.skip(4 + 8); // xclrValue + numTint, still consumed so the cursor stays correctly positioned for whatever follows
  return undefined;
}

export interface RawConditionalFormat12Common {
  /** CF12's own ipriority field, always genuinely present and meaningful (MUST be unique across every CF12 record in the worksheet substream) -- unlike base CF, which has no priority concept at all, this is never an "absent" or omittable-default value. */
  readonly priority: number;
  readonly stopIfTrue: boolean;
  readonly ranges: ContentSheetRange[];
}

export interface RawColorScaleFormat extends RawConditionalFormat12Common {
  readonly kind: "colorScale";
  readonly stops: readonly {
    readonly value: ContentSheetConditionalFormatValue;
    readonly color: RawCfColor;
  }[];
}

export interface RawDataBarFormat extends RawConditionalFormat12Common {
  readonly kind: "dataBar";
  readonly min: ContentSheetConditionalFormatValue;
  readonly max: ContentSheetConditionalFormatValue;
  readonly color: RawCfColor;
  readonly showValue: boolean;
}

export interface RawIconSetFormat extends RawConditionalFormat12Common {
  readonly kind: "iconSet";
  readonly iconSetType: string;
  readonly thresholds: readonly ContentSheetConditionalFormatValue[];
  readonly reverse: boolean;
  readonly showValue: boolean;
}

// The exact literal union ContentSheetConditionalFormatSchema's own 'timePeriod' variant carries -- derived from the shared schema type rather than duplicated as a free-standing string union, so a schema change that renames or extends the enum is a compile error here, not a silent mismatch.
export type RawTimePeriod = Extract<
  ContentSheetConditionalFormat,
  { readonly type: "timePeriod" }
>["timePeriod"];

// Every ct 0x05 ("filter") rule shares one property none of colour scale/data bar/icon set have at all: [MS-XLS] only forces DXFN12's own cbDxf to zero for ct 0x03/0x04/0x06 -- a ct 0x05 rule's dxf can carry a genuine font/fill override, and ContentSheetConditionalFormatSchema's own top10/aboveAverage/timePeriod/containsBlanks-family variants all have the identical optional `style` field cellIs already does.
interface RawFilterFormatCommon extends RawConditionalFormat12Common {
  readonly style: RawConditionalFormatStyle | undefined;
}

export interface RawTop10Format extends RawFilterFormatCommon {
  readonly kind: "top10";
  readonly rank: number;
  readonly percent: boolean;
  readonly bottom: boolean;
}

export interface RawAboveAverageFormat extends RawFilterFormatCommon {
  readonly kind: "aboveAverage";
  readonly aboveAverage: boolean;
  readonly equalAverage: boolean;
  readonly stdDev: number | undefined;
}

export interface RawTimePeriodFormat extends RawFilterFormatCommon {
  readonly kind: "timePeriod";
  readonly timePeriod: RawTimePeriod;
}

/** duplicateValues/uniqueValues and the four blank/error conditions carry no data beyond which one a rule is -- CFExDefaultTemplateParams is 16 reserved bytes ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/c8f156b6-10ec-4594-adb1-c734fbb1fc11). */
export interface RawSimpleFilterFormat extends RawFilterFormatCommon {
  readonly kind:
    | "containsBlanks"
    | "notContainsBlanks"
    | "containsErrors"
    | "notContainsErrors"
    | "uniqueValues"
    | "duplicateValues";
}

export interface RawTextFilterFormat extends RawFilterFormatCommon {
  readonly kind: "containsText" | "notContainsText" | "beginsWith" | "endsWith";
  readonly text: string;
}

export type RawConditionalFormat12 =
  | RawColorScaleFormat
  | RawDataBarFormat
  | RawIconSetFormat
  | RawTop10Format
  | RawAboveAverageFormat
  | RawTimePeriodFormat
  | RawSimpleFilterFormat
  | RawTextFilterFormat;

// CFGradient ([MS-XLS] 2.4's own colour-scale rgbCT shape, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/dd6c7ea2-f6a9-45e0-9253-0989a7aa8421): two fixed-size counts (cInterpCurve/cGradientCurve, MUST be equal, 2 or 3) followed by rgInterp (that many CFGradientInterpItem, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/166c53dc-edc9-40a7-bd1e-128b7268e344 -- a CFVO then an 8-byte numDomain fraction, discarded) and then rgCurve (that many CFGradientItem, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/84cb4bf3-33d1-4fa3-9346-e0c2c8cbb768 -- an 8-byte numGrange fraction, discarded, then a CFColor). The two arrays are positional, not interleaved -- rgInterp[i] pairs with rgCurve[i] as one stop, the same pairing ooxml.js's own colorScale/cfvo+color reading already assumes.
function readCfGradient(
  cursor: BlockCursor,
  formulaSheets: FormulaSheetContext,
): RawColorScaleFormat["stops"] | undefined {
  cursor.skip(2); // unused
  cursor.skip(1); // reserved1
  const cInterpCurve = cursor.u8();
  const cGradientCurve = cursor.u8();
  cursor.skip(1); // fClamp(1 bit) + fBackground(1 bit) + reserved2(6 bits) -- colour scale formatting is always a background fill (ECMA-376's own convention too) and this schema has no clamp-to-range flag, so neither bit has anywhere to land
  if (cInterpCurve !== cGradientCurve || cInterpCurve < 2 || cInterpCurve > 3) {
    return undefined;
  }
  const values: ContentSheetConditionalFormatValue[] = [];
  for (let index = 0; index < cInterpCurve; index += 1) {
    const value = readCfvo(cursor, formulaSheets);
    cursor.f64(); // numDomain
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  const colors: RawCfColor[] = [];
  for (let index = 0; index < cGradientCurve; index += 1) {
    cursor.f64(); // numGrange
    const color = readCfColor(cursor);
    if (color === undefined) {
      return undefined;
    }
    colors.push(color);
  }
  const stops: RawColorScaleFormat["stops"][number][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const color = colors[index];
    if (value === undefined || color === undefined) {
      return undefined;
    }
    stops.push({ value, color });
  }
  return stops;
}

type RawDataBarFields = Omit<
  RawDataBarFormat,
  keyof RawConditionalFormat12Common | "kind"
>;

// CFDatabar ([MS-XLS] 2.4's own data-bar rgbCT shape, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/893f014a-e4d1-4712-9780-18206a91d254): a flags byte (fRightToLeft/fShowValue/reserved), two cell-width percentage bytes with no schema counterpart, a CFColor, then the two threshold CFVOs (cfvoDB1 for the minimum-width end, cfvoDB2 for the maximum-width end) -- ContentSheetConditionalFormatSchema's own dataBar.min/max.
function readCfDatabar(
  cursor: BlockCursor,
  formulaSheets: FormulaSheetContext,
): RawDataBarFields | undefined {
  cursor.skip(2); // unused
  cursor.skip(1); // reserved1
  const flags = cursor.u8();
  const showValue = ((flags >>> 1) & 0x1) !== 0; // B - fShowValue (A - fRightToLeft has no schema counterpart)
  cursor.skip(1); // iPercentMin -- a display-only bar-width percentage, no schema field
  cursor.skip(1); // iPercentMax
  const color = readCfColor(cursor);
  const min = readCfvo(cursor, formulaSheets);
  const max = readCfvo(cursor, formulaSheets);
  if (color === undefined || min === undefined || max === undefined) {
    return undefined;
  }
  return { min, max, color, showValue };
}

type RawIconSetFields = Omit<
  RawIconSetFormat,
  keyof RawConditionalFormat12Common | "kind"
>;

// ECMA-376's own ST_IconSetType vocabulary (an open, producer-extensible string in ContentSheetConditionalFormatSchema, matching how ooxml.js's own xlsx cfRule reading carries it -- xlsx states this directly as an XML attribute with no fixed table of its own). BIFF8's CFMultistate ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/6c80a1a1-f8c3-4352-891c-31c5ee418ffd) names the identical seventeen built-in sets by a single iIconSet byte instead, so this reader needs the byte -> name mapping xlsx never does.
//
// NOTE: this table's own indices 0x04/0x05 deliberately DIVERGE from the literal reading order of that spec page's own iIconSet value table, which describes 0x04 as "3 colored signs" and 0x05 as "3 round traffic lights with black rectangle borders" -- the opposite of the ordering below. Two independent, real, production implementations were cross-checked and both agree with EACH OTHER against the spec's own prose: Apache POI's IconSet enum (GYR_3_TRAFFIC_LIGHTS_BOX at id 4, GYR_3_SHAPES at id 5) and LibreOffice's ScIconSetType enum (IconSet_3TrafficLights2 at index 4, IconSet_3Signs at index 5). Since a real spec-authoring transcription error in one page's image alt-text is far more plausible than two unrelated, widely-deployed, real-world-interoperability-tested codebases independently making the identical swap, this table follows the two implementations rather than the page's own prose ordering -- the same "don't just trust the prose" standard this package's own DXFN flags-header reading already applied against Apache POI's CFRuleBase.
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

// CFMultistate ([MS-XLS] 2.4's own icon-set rgbCT shape): cStates (the icon count iIconSet itself implies, restated redundantly), iIconSet (the set identifier), a flags byte (fIconOnly/reserved/fReverse/reserved), then that many CFMStateItem ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/c7cb11a4-2242-4d53-aadb-8a2447aa858c) thresholds (a CFVO, an fEqual boundary-inclusion flag with no schema counterpart, and 4 reserved bytes).
function readCfMultistate(
  cursor: BlockCursor,
  formulaSheets: FormulaSheetContext,
): RawIconSetFields | undefined {
  cursor.skip(2); // unused
  cursor.skip(1); // reserved1
  const cStates = cursor.u8();
  const iIconSet = cursor.u8();
  const flags = cursor.u8();
  const showValue = (flags & 0x1) === 0; // A - fIconOnly inverted: the cell's own value is shown unless "icon only" is set
  const reverse = ((flags >>> 2) & 0x1) !== 0; // C - fReverse
  const iconSetType = ICON_SET_TYPE_NAMES[iIconSet];
  if (iconSetType === undefined) {
    return undefined;
  }
  const thresholds: ContentSheetConditionalFormatValue[] = [];
  for (let index = 0; index < cStates; index += 1) {
    const value = readCfvo(cursor, formulaSheets);
    cursor.skip(1); // fEqual -- no per-threshold schema field
    cursor.skip(4); // unused
    if (value === undefined) {
      return undefined;
    }
    thresholds.push(value);
  }
  return { iconSetType, thresholds, reverse, showValue };
}

const ICF_TEMPLATE_CONTAINS_TEXT = 0x0008;

const CTP_TO_TEXT_KIND: ReadonlyMap<number, RawTextFilterFormat["kind"]> =
  new Map([
    [0x0000, "containsText"],
    [0x0001, "notContainsText"],
    [0x0002, "beginsWith"],
    [0x0003, "endsWith"],
  ]);

export function readCfTextFilterRule(
  icfTemplate: number,
  templateParams: Uint8Array<ArrayBuffer>,
  rgce1: Uint8Array<ArrayBuffer>,
  formulaSheets: FormulaSheetContext,
): Omit<RawTextFilterFormat, keyof RawFilterFormatCommon> | undefined {
  if (icfTemplate !== ICF_TEMPLATE_CONTAINS_TEXT) {
    return undefined;
  }
  const cursor = new BlockCursor([templateParams]);
  const ctp = cursor.u16();
  const kind = CTP_TO_TEXT_KIND.get(ctp);
  if (kind === undefined) {
    return undefined;
  }
  const text = extractFirstStringLiteral(rgce1, formulaSheets);
  if (text === undefined) {
    return undefined;
  }
  return { kind, text };
}

// icfTemplate ([MS-XLS] 2.4.43's own field table) names the ct-0x05 rule's real type. Only the values below reach readCfFilterRule at all -- 0x00-0x04 belong to ct 0x01/0x02/0x03/0x04/0x06 instead and are never seen here.
const ICF_TEMPLATE_TOP10 = 0x0005;
const ICF_TEMPLATE_UNIQUE_VALUES = 0x0007;
const ICF_TEMPLATE_CONTAINS_BLANKS = 0x0009;
const ICF_TEMPLATE_CONTAINS_NO_BLANKS = 0x000a;
const ICF_TEMPLATE_CONTAINS_ERRORS = 0x000b;
const ICF_TEMPLATE_CONTAINS_NO_ERRORS = 0x000c;
const ICF_TEMPLATE_ABOVE_AVERAGE = 0x0019;
const ICF_TEMPLATE_BELOW_AVERAGE = 0x001a;
const ICF_TEMPLATE_DUPLICATE_VALUES = 0x001b;
const ICF_TEMPLATE_ABOVE_OR_EQUAL_AVERAGE = 0x001d;
const ICF_TEMPLATE_BELOW_OR_EQUAL_AVERAGE = 0x001e;

// The ten date/time-period icfTemplate values, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/3b6a364e-8c34-4830-a8b1-5a51476a9934's own icfTemplate table (0x0F-0x18). CFExDateTemplateParams's own dateOp field ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/a079f971-f12f-438f-a127-3dee84e94034) is a fixed 1:1 restatement of icfTemplate for every one of these -- confirmed from that structure's own value table -- so it carries no information this reader needs beyond what icfTemplate already states, and this map dispatches on icfTemplate directly rather than reading dateOp at all.
const ICF_TEMPLATE_TO_TIME_PERIOD: ReadonlyMap<number, RawTimePeriod> = new Map(
  [
    [0x000f, "today"],
    [0x0010, "tomorrow"],
    [0x0011, "yesterday"],
    [0x0012, "last7Days"],
    [0x0013, "lastMonth"],
    [0x0014, "nextMonth"],
    [0x0015, "thisWeek"],
    [0x0016, "nextWeek"],
    [0x0017, "lastWeek"],
    [0x0018, "thisMonth"],
  ],
);

const SIMPLE_ICF_TEMPLATE_KIND: ReadonlyMap<
  number,
  RawSimpleFilterFormat["kind"]
> = new Map([
  [ICF_TEMPLATE_UNIQUE_VALUES, "uniqueValues"],
  [ICF_TEMPLATE_CONTAINS_BLANKS, "containsBlanks"],
  [ICF_TEMPLATE_CONTAINS_NO_BLANKS, "notContainsBlanks"],
  [ICF_TEMPLATE_CONTAINS_ERRORS, "containsErrors"],
  [ICF_TEMPLATE_CONTAINS_NO_ERRORS, "notContainsErrors"],
  [ICF_TEMPLATE_DUPLICATE_VALUES, "duplicateValues"],
]);

type RawFilterRule =
  | Omit<RawTop10Format, keyof RawFilterFormatCommon>
  | Omit<RawAboveAverageFormat, keyof RawFilterFormatCommon>
  | Omit<RawTimePeriodFormat, keyof RawFilterFormatCommon>
  | Omit<RawSimpleFilterFormat, keyof RawFilterFormatCommon>;

// Dispatches ct 0x05's icfTemplate against the 16-byte CFExTemplateParams block CF12 always carries just before its own rgbCT (a CFFilter this function otherwise ignores entirely -- see the two comments below). Every branch reads from a cursor over exactly those 16 bytes, never the record's own trailing CFFilter, since CFExFilterParams/CFExAveragesTemplateParams already duplicate everything a top10/aboveAverage rule needs without it. style is deliberately not this function's concern -- readCf12 merges it in from the record's own DXFN12, common to every kind here.
//
// Each branch's return value is built as its own explicitly-typed local first, then returned -- an object literal checked directly against the RawFilterRule union return type does not reliably pick the matching member for its own excess-property check, so this sidesteps that rather than fighting it with a broader type.
function readCfFilterRule(
  icfTemplate: number,
  templateParams: Uint8Array<ArrayBuffer>,
): RawFilterRule | undefined {
  if (icfTemplate === ICF_TEMPLATE_TOP10) {
    // CFExFilterParams ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/796db4e4-43e0-43a5-a4f3-67a43b3bd38d): a flags byte (fTop/fPercent/reserved), then iParam(2), then 13 reserved bytes -- duplicates the sibling CFFilter structure's own fTop/fPercent/iParam fields exactly, so that trailing CFFilter is never read at all.
    const cursor = new BlockCursor([templateParams]);
    const flags = cursor.u8();
    const top = (flags & 0x1) !== 0;
    const percent = ((flags >>> 1) & 0x1) !== 0;
    const rank = cursor.u16();
    if (rank <= 0) {
      // ContentSheetConditionalFormatSchema's own 'top10' rank is z.number().positive() -- a malformed/producer-buggy zero rank degrades the whole rule to absent rather than promoting a value that violates the shared schema's own contract.
      return undefined;
    }
    const top10: Omit<RawTop10Format, keyof RawFilterFormatCommon> = {
      kind: "top10",
      rank,
      percent,
      bottom: !top,
    };
    return top10;
  }
  if (
    icfTemplate === ICF_TEMPLATE_ABOVE_AVERAGE ||
    icfTemplate === ICF_TEMPLATE_BELOW_AVERAGE ||
    icfTemplate === ICF_TEMPLATE_ABOVE_OR_EQUAL_AVERAGE ||
    icfTemplate === ICF_TEMPLATE_BELOW_OR_EQUAL_AVERAGE
  ) {
    // CFExAveragesTemplateParams ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/6b440d01-2af7-4e72-ac36-b6ac189edb80): iParam(2, a standard-deviation count: 0/1/2) then 14 reserved bytes.
    const cursor = new BlockCursor([templateParams]);
    const iParam = cursor.u16();
    const aboveAverage =
      icfTemplate === ICF_TEMPLATE_ABOVE_AVERAGE ||
      icfTemplate === ICF_TEMPLATE_ABOVE_OR_EQUAL_AVERAGE;
    const equalAverage =
      icfTemplate === ICF_TEMPLATE_ABOVE_OR_EQUAL_AVERAGE ||
      icfTemplate === ICF_TEMPLATE_BELOW_OR_EQUAL_AVERAGE;
    const rule: Omit<RawAboveAverageFormat, keyof RawFilterFormatCommon> = {
      kind: "aboveAverage",
      aboveAverage,
      equalAverage,
      stdDev: iParam > 0 ? iParam : undefined,
    };
    return rule;
  }
  const timePeriod = ICF_TEMPLATE_TO_TIME_PERIOD.get(icfTemplate);
  if (timePeriod !== undefined) {
    const rule: Omit<RawTimePeriodFormat, keyof RawFilterFormatCommon> = {
      kind: "timePeriod",
      timePeriod,
    };
    return rule;
  }
  const simpleKind = SIMPLE_ICF_TEMPLATE_KIND.get(icfTemplate);
  if (simpleKind !== undefined) {
    const rule: Omit<RawSimpleFilterFormat, keyof RawFilterFormatCommon> = {
      kind: simpleKind,
    };
    return rule;
  }
  return undefined; // containsText (icfTemplate 0x0008) and anything undocumented -- see this file's own top comment
}

function readCf12(
  record: RecordGroup,
  ranges: ContentSheetRange[],
  formulaSheets: FormulaSheetContext,
): RawConditionalFormat12 | undefined {
  try {
    const cursor = new BlockCursor(record.blocks);
    cursor.skip(12); // frtRefHeader (FrtRefHeader, [MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/21d54bbb-614e-414a-9180-5fffda407d4f) -- every field MUST be zero/ignored for CF12 itself ([MS-XLS] 2.4.43's own prose)
    const ct = cursor.u8();
    cursor.skip(1); // cp -- meaningful only for a ct 0x01 comparison rule, out of scope here (base CF already covers ct 0x01/0x02)
    const cce1 = cursor.u16();
    const cce2 = cursor.u16();
    const cbDxf = cursor.u32(); // DXFN12's own length prefix -- MUST be zero for ct 0x03/0x04/0x06, but NOT for ct 0x05 (a filter rule's own resulting font/fill override), so its bytes are captured, not blindly skipped
    const dxfBytes = cursor.take(cbDxf);
    const rgce1 = cursor.take(cce1); // meaningful only for ct 0x01/0x02
    cursor.skip(cce2); // rgce2 -- meaningful only for ct 0x01 with cp 0x01/0x02
    const cceActive = cursor.u16(); // fmlaActive's own cce
    cursor.skip(cceActive); // fmlaActive's rgce -- the colour scale/data bar/icon set "activity condition" formula; no schema field for a rule's own separate activation expression
    const flags = cursor.u8();
    const stopIfTrue = (flags & 0x2) !== 0; // B - fStopIfTrue (A - unused1 is bit 0)
    const priority = cursor.u16(); // ipriority
    const icfTemplate = cursor.u16(); // meaningful only for the ct 0x05 filter family
    cursor.skip(1); // cbTemplateParm -- MUST be 16, not validated
    const templateParams = cursor.take(16); // rgbTemplateParms (CFExTemplateParams) -- meaningful only for the ct 0x05 filter family
    const common: RawConditionalFormat12Common = {
      priority,
      stopIfTrue,
      ranges,
    };

    if (ct === 0x03) {
      const stops = readCfGradient(cursor, formulaSheets);
      return stops === undefined
        ? undefined
        : { kind: "colorScale", stops, ...common };
    }
    if (ct === 0x04) {
      const databar = readCfDatabar(cursor, formulaSheets);
      return databar === undefined
        ? undefined
        : { kind: "dataBar", ...databar, ...common };
    }
    if (ct === 0x06) {
      const iconSet = readCfMultistate(cursor, formulaSheets);
      return iconSet === undefined
        ? undefined
        : { kind: "iconSet", ...iconSet, ...common };
    }
    if (ct === 0x05) {
      const rule = readCfFilterRule(icfTemplate, templateParams);
      // The trailing CFFilter ([MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/1fbbdfb0-5320-43bc-a8a5-c81dbeba9b7b) is still consumed here regardless of whether templateParams resolved a rule -- cbFilter states its own total length, so skipping by that count (rather than a fixed size) stays correct even for an icfTemplate this reader cannot promote.
      const cbFilter = cursor.u16();
      cursor.skip(cbFilter);
      if (rule === undefined) {
        return undefined;
      }
      const style = parseDxfStyle(dxfBytes);
      return { ...rule, ...common, style };
    }
    if (ct === 0x02) {
      const textRule = readCfTextFilterRule(
        icfTemplate,
        templateParams,
        rgce1,
        formulaSheets,
      );
      if (textRule !== undefined) {
        const style = parseDxfStyle(dxfBytes);
        return { ...textRule, ...common, style };
      }
    }
    return undefined; // ct 0x01, or a ct 0x02 rule with no closed-form structure to promote
  } catch (err) {
    if (!(err instanceof BiffFormatError)) {
      throw err;
    }
    return undefined;
  }
}

export interface CondFmt12GroupResult {
  readonly formats: RawConditionalFormat12[];
  /** How many records (the CondFmt12 itself plus every CF12 it claimed) the caller should advance past, regardless of how many rules actually promoted. */
  readonly recordsConsumed: number;
}

// Reads one CondFmt12 and the mainCF.ccf CF12 records immediately following it -- the identical "wrapper then its own children" shape and malformed-group degrade contract readCondFmtGroup already establishes for base CondFmt/CF, extended to this record family.
export function readCondFmt12Group(
  records: readonly RecordGroup[],
  startIndex: number,
  formulaSheets: FormulaSheetContext,
): CondFmt12GroupResult {
  const condFmt12 = records[startIndex];
  if (condFmt12 === undefined) {
    return { formats: [], recordsConsumed: 1 };
  }
  try {
    const cursor = new BlockCursor(condFmt12.blocks);
    cursor.skip(12); // frtRefHeaderU (FrtRefHeaderU, [MS-XLS] 2.4, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/81109a77-1dbd-43fe-84d2-b5177bb41297) -- redundant with mainCF's own refBound ([MS-XLS] 2.4.57's own prose)
    const ccf = cursor.u16();
    cursor.skip(2); // fToughRecalc + nID -- CFEx's own linkage, unused
    cursor.skip(8); // refBound (Ref8U) -- a redundant bounding superset of sqref, unused
    const crefCount = cursor.u16();
    const ranges: ContentSheetRange[] = [];
    for (let index = 0; index < crefCount; index += 1) {
      const startRow = cursor.u16();
      const endRow = cursor.u16();
      const startColumn = cursor.u16();
      const endColumn = cursor.u16();
      ranges.push({ startRow, startColumn, endRow, endColumn });
    }

    const formats: RawConditionalFormat12[] = [];
    for (let offset = 1; offset <= ccf; offset += 1) {
      const cf12Record = records[startIndex + offset];
      if (cf12Record?.type !== RECORD_CF12) {
        return { formats: [], recordsConsumed: 1 };
      }
      const format = readCf12(cf12Record, ranges, formulaSheets);
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
