import type {
  Color,
  ContentSheetConditionalFormatValue,
  ContentSheetRange,
} from "document-schema.js";
import { BlockCursor } from "../biff/cursor";
import type { FormulaSheetContext } from "../biff/ptg";
import { parseFormulaText } from "../biff/ptg";
import { BiffFormatError } from "../biff/records";
import type { RecordGroup } from "../biff/substreams";
import { RECORD_CF12 } from "../biff/record-types";

// CondFmt12 ([MS-XLS] 2.4.57, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/b891e737-12f6-41dd-b8a8-7360a4826d4a) is CondFmt's own "future record" (FRT) counterpart: it wraps a CondFmtStructure ([MS-XLS] 2.4's own CondFmtStructure, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/1f4b7576-b5e0-40f0-b2c6-b447d0954b17 -- the identical ccf/flags/refBound/sqref shape CondFmt's own body already carries), prefixed by a 12-byte FrtRefHeaderU this reader never needs, and marks the start of the CF12 ([MS-XLS] 2.4.43, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/3b6a364e-8c34-4830-a8b1-5a51476a9934) records it names via mainCF.ccf. A CF12's own ct field picks one of six rule shapes; this reader promotes only the three that share a genuine array-of-thresholds building block already modelled in document-schema.js -- colour scale (ct 0x03), data bar (ct 0x04), and icon set (ct 0x06) -- since ooxml.js's xlsx cfRule reading and odf.js's ods reading already populate the identical ContentSheetConditionalFormatValueSchema/colorScale/dataBar/iconSet shapes (ExaDev/documents.js#1104). Comparison (ct 0x01) and formula (ct 0x02) rules re-expressed in this newer record shape, and the filter-dispatched template family (ct 0x05: top10, aboveAverage, duplicateValues, containsText, date/time periods, …), stay unread here -- tracked separately on ExaDev/documents.js#1100.
//
// Every rule type this reader promotes carries a DXFN12 whose own cbDxf MUST be zero ([MS-XLS] 2.4.43's own ct table: "If ct is equal to 0x03, 0x04 or 0x06, then dxf.cbDxf MUST be equal to 0x00000000"), since colour scale/data bar/icon set formatting carries its own colour fields directly rather than through a differential-format override -- so, unlike base CF's own DXFN reading, no style extraction is needed here at all.
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

interface RawConditionalFormat12Common {
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

export type RawConditionalFormat12 =
  RawColorScaleFormat | RawDataBarFormat | RawIconSetFormat;

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
    const cbDxf = cursor.u32(); // DXFN12's own length prefix -- MUST be zero for every ct this reader promotes (see this file's own top comment)
    cursor.skip(cbDxf);
    cursor.skip(cce1); // rgce1 -- meaningful only for ct 0x01/0x02
    cursor.skip(cce2); // rgce2 -- meaningful only for ct 0x01 with cp 0x01/0x02
    const cceActive = cursor.u16(); // fmlaActive's own cce
    cursor.skip(cceActive); // fmlaActive's rgce -- the colour scale/data bar/icon set "activity condition" formula; no schema field for a rule's own separate activation expression
    const flags = cursor.u8();
    const stopIfTrue = (flags & 0x2) !== 0; // B - fStopIfTrue (A - unused1 is bit 0)
    const priority = cursor.u16(); // ipriority
    cursor.skip(2); // icfTemplate -- meaningful only for the ct 0x05 filter family (ExaDev/documents.js#1100)
    cursor.skip(1); // cbTemplateParm -- MUST be 16, not validated
    cursor.skip(16); // rgbTemplateParms (CFExTemplateParams) -- meaningful only for the ct 0x05 filter family
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
    return undefined; // ct 0x01/0x02/0x05 -- out of scope for this reader, see this file's own top comment
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
