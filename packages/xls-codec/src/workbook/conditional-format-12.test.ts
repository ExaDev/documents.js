import { describe, expect, it } from "vitest";
import type { FormulaSheetContext } from "../biff/ptg";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { readRecords } from "../biff/records";
import {
  concat,
  f64,
  record,
  shortXlUnicodeString,
  u16,
  u32,
} from "../test-support/biff";
import {
  RECORD_CF12,
  RECORD_CONDFMT12,
  RECORD_CONTINUEFRT12,
} from "../biff/record-types";
import { readCondFmt12Group } from "./conditional-format-12";

// CondFmt12/CF12 ([MS-XLS] 2.4.57/2.4.43): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/3b6a364e-8c34-4830-a8b1-5a51476a9934. Every byte layout exercised here is built directly to that published field table, the same "state the real grammar, not a producer convention" approach conditional-format.test.ts already takes for base CondFmt/CF.

const NO_SHEETS: FormulaSheetContext = { sheets: [], sheetRanges: [] };

interface TestRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

function sqRefU(...ranges: readonly TestRange[]): number[] {
  return [
    ...u16(ranges.length),
    ...ranges.flatMap((r) => [
      ...u16(r.startRow),
      ...u16(r.endRow),
      ...u16(r.startColumn),
      ...u16(r.endColumn),
    ]),
  ];
}

const ONE_RANGE: TestRange[] = [
  { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 },
];

/** PtgInt ([MS-XLS] 2.5.198.66), for the rare cfvoType 0x07 (formula) case. */
function ptgInt(value: number): number[] {
  return [0x1e, ...u16(value)];
}

/** A CFVO ([MS-XLS] 2.4's own CFVO structure): cfvoType then a CFVOParsedFormula (cce + rgce, no "unused" field) then, when the formula is empty and the type isn't 'min'/'max', an Xnum numValue. */
function cfvo(
  type: number,
  options: { formula?: number[]; num?: number } = {},
): number[] {
  const formula = options.formula ?? [];
  const bytes = [type, ...u16(formula.length), ...formula];
  if (formula.length === 0 && type !== 0x02 && type !== 0x03) {
    bytes.push(...f64(options.num ?? 0));
  }
  return bytes;
}

/** CFColor ([MS-XLS] 2.4's own CFColor structure, 16 bytes): xclrType(4) + xclrValue(4) + numTint(8). */
function cfColorIcv(icv: number): number[] {
  return [...u32(0x00000001), ...u32(icv), ...f64(0)];
}
function cfColorRgb(r: number, g: number, b: number): number[] {
  return [...u32(0x00000002), r, g, b, 0x00, ...f64(0)];
}
function cfColorAuto(): number[] {
  return [...u32(0x00000000), ...u32(0), ...f64(0)];
}

/** CFGradient ([MS-XLS] 2.4's own colour-scale rgbCT shape). Each stop pairs a cfvo (rgInterp, plus its own 8-byte numDomain fraction) with a colour (rgCurve, its own 8-byte numGrange fraction then a CFColor) -- the two arrays are positional and written here fully separately, matching the record's own non-interleaved layout. */
function cfGradient(
  stops: readonly { cfvo: number[]; color: number[] }[],
): number[] {
  const count = stops.length;
  return [
    ...u16(0), // unused
    0x00, // reserved1
    count, // cInterpCurve
    count, // cGradientCurve
    0x03, // fClamp + fBackground
    ...stops.flatMap((s) => [...s.cfvo, ...f64(0)]), // rgInterp: cfvo + numDomain
    ...stops.flatMap((s) => [...f64(0), ...s.color]), // rgCurve: numGrange + color
  ];
}

/** CFDatabar ([MS-XLS] 2.4's own data-bar rgbCT shape). */
function cfDatabar(options: {
  showValue?: boolean;
  color: number[];
  min: number[];
  max: number[];
}): number[] {
  return [
    ...u16(0), // unused
    0x00, // reserved1
    options.showValue === true ? 0x02 : 0x00, // B - fShowValue
    0x00, // iPercentMin
    0x64, // iPercentMax
    ...options.color,
    ...options.min,
    ...options.max,
  ];
}

/** CFMultistate ([MS-XLS] 2.4's own icon-set rgbCT shape). */
function cfMultistate(options: {
  iIconSet: number;
  reverse?: boolean;
  iconOnly?: boolean;
  thresholds: readonly number[][];
}): number[] {
  const flags =
    (options.iconOnly === true ? 0x01 : 0x00) |
    (options.reverse === true ? 0x04 : 0x00);
  return [
    ...u16(0), // unused
    0x00, // reserved1
    options.thresholds.length, // cStates
    options.iIconSet,
    flags,
    ...options.thresholds.flatMap((t) => [
      ...t,
      0x00,
      ...new Array<number>(4).fill(0),
    ]), // cfvo + fEqual + unused
  ];
}

function condFmt12Record(
  ccf: number,
  ranges: readonly TestRange[],
): Uint8Array<ArrayBuffer> {
  return record(RECORD_CONDFMT12, [
    ...new Array<number>(12).fill(0), // frtRefHeaderU
    ...u16(ccf),
    ...u16(0), // fToughRecalc + nID
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0), // refBound (Ref8U)
    ...sqRefU(...ranges),
  ]);
}

function cf12Bytes(
  ct: number,
  rgbCT: readonly number[],
  options: {
    stopIfTrue?: boolean;
    priority?: number;
    icfTemplate?: number;
    templateParams?: readonly number[];
    dxf?: readonly number[];
    /** rgce1's own bytes ([MS-XLS] 2.4.43's own CFParsedFormulaNoCCE) -- meaningful only for ct 0x01/0x02, empty (cce1 0) for every other ct this file already exercises. */
    formula1?: readonly number[];
  } = {},
): number[] {
  const templateParams =
    options.templateParams ?? new Array<number>(16).fill(0);
  if (templateParams.length !== 16) {
    throw new Error("templateParams must be exactly 16 bytes");
  }
  const dxf = options.dxf ?? [];
  const formula1 = options.formula1 ?? [];
  return [
    ...new Array<number>(12).fill(0), // frtRefHeader
    ct,
    0x00, // cp
    ...u16(formula1.length), // cce1
    ...u16(0), // cce2
    ...u32(dxf.length), // cbDxf
    ...dxf,
    ...formula1, // rgce1
    ...u16(0), // fmlaActive cce
    options.stopIfTrue === true ? 0x02 : 0x00, // flags: B - fStopIfTrue
    ...u16(options.priority ?? 0), // ipriority
    ...u16(options.icfTemplate ?? 0), // icfTemplate
    16, // cbTemplateParm
    ...templateParams, // rgbTemplateParms (CFExTemplateParams)
    ...rgbCT,
  ];
}

/** A minimal CFFilter ([MS-XLS] 2.4): cbFilter(2) then that many bytes -- content is irrelevant for every ct 0x05 rule this reader promotes, since CFExFilterParams/CFExAveragesTemplateParams already duplicate whatever it would carry; only its own declared length matters, to prove the reader skips exactly that far. */
function cfFilterBytes(body: readonly number[] = [0, 0, 0, 0]): number[] {
  return [...u16(body.length), ...body];
}

/** CFExFilterParams ([MS-XLS] 2.4): a flags byte (fTop/fPercent/reserved) then iParam(2) then 13 reserved bytes -- top10's own rgbTemplateParms shape. */
function cfExFilterParams(options: {
  top?: boolean;
  percent?: boolean;
  iParam: number;
}): number[] {
  const flags =
    (options.top === true ? 0x01 : 0x00) |
    (options.percent === true ? 0x02 : 0x00);
  return [flags, ...u16(options.iParam), ...new Array<number>(13).fill(0)];
}

/** CFExAveragesTemplateParams ([MS-XLS] 2.4): iParam(2, a standard-deviation count) then 14 reserved bytes -- the aboveAverage family's own rgbTemplateParms shape. */
function cfExAveragesTemplateParams(stdDev: number): number[] {
  return [...u16(stdDev), ...new Array<number>(14).fill(0)];
}

function cf12Record(
  ct: number,
  rgbCT: readonly number[],
  options: {
    stopIfTrue?: boolean;
    priority?: number;
    icfTemplate?: number;
    templateParams?: readonly number[];
    dxf?: readonly number[];
    formula1?: readonly number[];
  } = {},
): Uint8Array<ArrayBuffer> {
  return record(RECORD_CF12, cf12Bytes(ct, rgbCT, options));
}

/** PtgStr ([MS-XLS] 2.5.198.something, opcode 0x17): a ShortXLUnicodeString operand -- the literal search text a containsText-family formula always carries somewhere in its own token stream, wrapped in whatever function shape the sub-type needs (see readCfTextFilterRule's own comment in conditional-format-12.ts). */
function ptgStr(text: string): number[] {
  return [0x17, ...shortXlUnicodeString(text)];
}

/** A fully-relative PtgRef (value class, [MS-XLS] 2.5.198.61): opcode 0x44, then row and a relative ColRelU column field -- what a bare `A1` reference compiles to. */
function ptgRef(row: number, column: number): number[] {
  return [0x44, ...u16(row), ...u16(0xc000 | column)];
}

/** CFExTextTemplateParams ([MS-XLS] 2.4): ctp(2) then 14 reserved bytes -- the containsText family's own rgbTemplateParms shape, naming which of the four text sub-types a rule is. */
function cfExTextTemplateParams(ctp: number): number[] {
  return [...u16(ctp), ...new Array<number>(14).fill(0)];
}

const DXFFNTD_LENGTH = 122;
const DXFFNTD_ICV_FORE_OFFSET = 80;

/** A minimal DXFN ([MS-XLS] 2.4.97) naming only a font colour: the 6-byte flags header (ibitAtrFnt only) then a 122-byte DXFFntD with icvFore set at its own documented offset -- everything conditional-format.test.ts's own sibling dxf() helper already builds for base CF's identical DXFN, written independently here since DXFN12 wraps this exact same payload behind its own cbDxf prefix rather than sharing test fixture code across files. */
function dxfFontColor(icvFore: number): number[] {
  const block = new Array<number>(DXFFNTD_LENGTH).fill(0);
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setInt32(0, icvFore, true);
  block.splice(DXFFNTD_ICV_FORE_OFFSET, 4, ...new Uint8Array(buffer));
  return [...u32(1 << 26), ...u16(0), ...block];
}

function groupsFrom(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): RecordGroup[] {
  return [...groupRecords(readRecords(concat(...records)))];
}

describe("readCondFmt12Group", () => {
  it("reads a two-stop colour scale with indexed colours", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x03,
        cfGradient([
          { cfvo: cfvo(0x02), color: cfColorIcv(2) }, // min, red
          { cfvo: cfvo(0x03), color: cfColorIcv(3) }, // max, green
        ]),
      ),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.recordsConsumed).toBe(2);
    expect(result.formats).toEqual([
      {
        kind: "colorScale",
        stops: [
          { value: { type: "min" }, color: { kind: "icv", icv: 2, tint: 0 } },
          { value: { type: "max" }, color: { kind: "icv", icv: 3, tint: 0 } },
        ],
        priority: 0,
        stopIfTrue: false,
        ranges: ONE_RANGE,
      },
    ]);
  });

  it("reads a three-stop colour scale with a numeric threshold and an RGB colour", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x03,
        cfGradient([
          { cfvo: cfvo(0x02), color: cfColorRgb(255, 0, 0) },
          { cfvo: cfvo(0x01, { num: 50 }), color: cfColorRgb(255, 255, 0) },
          { cfvo: cfvo(0x03), color: cfColorRgb(0, 255, 0) },
        ]),
      ),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.formats).toHaveLength(1);
    const format = result.formats[0];
    expect(format?.kind).toBe("colorScale");
    if (format?.kind !== "colorScale") throw new Error("expected colorScale");
    expect(format.stops).toHaveLength(3);
    expect(format.stops[1]).toEqual({
      value: { type: "num", value: "50" },
      color: { kind: "rgb", color: { r: 1, g: 1, b: 0 }, tint: 0 },
    });
  });

  it("reads a colour scale threshold as a formula", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x03,
        cfGradient([
          { cfvo: cfvo(0x07, { formula: ptgInt(5) }), color: cfColorIcv(2) },
          { cfvo: cfvo(0x03), color: cfColorIcv(3) },
        ]),
      ),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    const format = result.formats[0];
    if (format?.kind !== "colorScale") throw new Error("expected colorScale");
    expect(format.stops[0]?.value).toEqual({ type: "formula", value: "5" });
  });

  it("degrades a colour scale whole rule when a stop's colour is unresolvable (automatic/theme)", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x03,
        cfGradient([
          { cfvo: cfvo(0x02), color: cfColorAuto() },
          { cfvo: cfvo(0x03), color: cfColorIcv(3) },
        ]),
      ),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([]);
  });

  it("reads a data bar with its min/max thresholds, colour, and showValue", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x04,
        cfDatabar({
          showValue: true,
          color: cfColorRgb(99, 190, 123),
          min: cfvo(0x02),
          max: cfvo(0x03),
        }),
      ),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.formats).toEqual([
      {
        kind: "dataBar",
        min: { type: "min" },
        max: { type: "max" },
        color: {
          kind: "rgb",
          color: { r: 99 / 255, g: 190 / 255, b: 123 / 255 },
          tint: 0,
        },
        showValue: true,
        priority: 0,
        stopIfTrue: false,
        ranges: ONE_RANGE,
      },
    ]);
  });

  it("reads a data bar's showValue as false when its own flag bit is unset", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x04,
        cfDatabar({
          showValue: false,
          color: cfColorIcv(10),
          min: cfvo(0x01, { num: 0 }),
          max: cfvo(0x01, { num: 100 }),
        }),
      ),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats[0]).toMatchObject({
      showValue: false,
    });
  });

  it("reads an icon set's type name, thresholds, and reverse flag", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x06,
        cfMultistate({
          iIconSet: 0x03, // 3TrafficLights1
          reverse: true,
          thresholds: [
            cfvo(0x01, { num: 0 }),
            cfvo(0x01, { num: 33 }),
            cfvo(0x01, { num: 67 }),
          ],
        }),
      ),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.formats).toEqual([
      {
        kind: "iconSet",
        iconSetType: "3TrafficLights1",
        thresholds: [
          { type: "num", value: "0" },
          { type: "num", value: "33" },
          { type: "num", value: "67" },
        ],
        reverse: true,
        showValue: true,
        priority: 0,
        stopIfTrue: false,
        ranges: ONE_RANGE,
      },
    ]);
  });

  it("reads every documented icon-set byte against its own ECMA-376 name", () => {
    const cases: [number, string][] = [
      [0x00, "3Arrows"],
      [0x03, "3TrafficLights1"],
      // 0x04/0x05 deliberately diverge from the raw spec page's own prose ordering -- see this table's own top comment in conditional-format-12.ts. Cross-checked against Apache POI's IconSet enum and LibreOffice's ScIconSetType enum, which independently agree with each other on this exact pairing.
      [0x04, "3TrafficLights2"],
      [0x05, "3Signs"],
      [0x07, "3Symbols2"],
      [0x08, "4Arrows"],
      [0x0c, "4TrafficLights"],
      [0x0d, "5Arrows"],
      [0x10, "5Quarters"],
    ];
    for (const [iIconSet, name] of cases) {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(
          0x06,
          cfMultistate({ iIconSet, thresholds: [cfvo(0x02), cfvo(0x03)] }),
        ),
      );
      const format = readCondFmt12Group(groups, 0, NO_SHEETS).formats[0];
      expect(format?.kind === "iconSet" ? format.iconSetType : undefined).toBe(
        name,
      );
    }
  });

  it("degrades an icon set whose iIconSet the specification does not define", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x06,
        cfMultistate({ iIconSet: 0x99, thresholds: [cfvo(0x02), cfvo(0x03)] }),
      ),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([]);
  });

  it("reads showValue as false when an icon set's own fIconOnly bit is set", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x06,
        cfMultistate({
          iIconSet: 0x00,
          iconOnly: true,
          thresholds: [cfvo(0x02), cfvo(0x03)],
        }),
      ),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats[0]).toMatchObject({
      showValue: false,
    });
  });

  it("does not promote a comparison (ct 0x01) or filter (ct 0x05) rule", () => {
    for (const ct of [0x01, 0x05]) {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(ct, []),
      );
      const result = readCondFmt12Group(groups, 0, NO_SHEETS);
      expect(result.formats).toEqual([]);
      expect(result.recordsConsumed).toBe(2);
    }
  });

  it("reads priority and stopIfTrue", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x03,
        cfGradient([
          { cfvo: cfvo(0x02), color: cfColorIcv(2) },
          { cfvo: cfvo(0x03), color: cfColorIcv(3) },
        ]),
        {
          stopIfTrue: true,
          priority: 7,
        },
      ),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats[0]).toMatchObject({
      priority: 7,
      stopIfTrue: true,
    });
  });

  it("reads 2-3 CF12 children sharing one CondFmt12's own ranges", () => {
    const ranges: TestRange[] = [
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 2, endRow: 4, startColumn: 1, endColumn: 3 },
    ];
    const groups = groupsFrom(
      condFmt12Record(2, ranges),
      cf12Record(
        0x03,
        cfGradient([
          { cfvo: cfvo(0x02), color: cfColorIcv(2) },
          { cfvo: cfvo(0x03), color: cfColorIcv(3) },
        ]),
      ),
      cf12Record(
        0x04,
        cfDatabar({ color: cfColorIcv(4), min: cfvo(0x02), max: cfvo(0x03) }),
      ),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.recordsConsumed).toBe(3);
    expect(result.formats).toHaveLength(2);
    for (const format of result.formats) {
      expect(format.ranges).toEqual(ranges);
    }
  });

  it("degrades the whole group to no formats when a declared ccf runs past the end of the record array", () => {
    const groups = groupsFrom(
      condFmt12Record(2, ONE_RANGE),
      cf12Record(
        0x03,
        cfGradient([
          { cfvo: cfvo(0x02), color: cfColorIcv(2) },
          { cfvo: cfvo(0x03), color: cfColorIcv(3) },
        ]),
      ),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.formats).toEqual([]);
    expect(result.recordsConsumed).toBe(1);
  });

  it("degrades to no formats on a truncated CondFmt12 record rather than throwing", () => {
    const bytes = record(RECORD_CONDFMT12, [
      ...new Array<number>(12).fill(0),
      ...u16(1),
    ]);
    const groups = [...groupRecords(readRecords(bytes))];

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.formats).toEqual([]);
    expect(result.recordsConsumed).toBe(1);
  });

  it("reads a CF12 record correctly when its own data is split across a ContinueFrt12", () => {
    const fullBytes = cf12Bytes(
      0x03,
      cfGradient([
        { cfvo: cfvo(0x02), color: cfColorIcv(2) },
        { cfvo: cfvo(0x03), color: cfColorIcv(3) },
      ]),
    );
    const splitPoint = 20; // somewhere inside the fixed frtRefHeader/ct/cp/cce prefix
    const first = fullBytes.slice(0, splitPoint);
    const rest = fullBytes.slice(splitPoint);
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      record(RECORD_CF12, first),
      record(RECORD_CONTINUEFRT12, [
        ...new Array<number>(12).fill(0), // frtRefHeader, stripped by groupRecords
        ...rest,
      ]),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    // groupRecords has already joined the CF12 base record and its ContinueFrt12 into one logical record by this point, so recordsConsumed still counts 2 -- the CondFmt12 plus that one (now complete) CF12, the same as an unsplit CF12 would.
    expect(result.recordsConsumed).toBe(2);
    expect(result.formats).toEqual([
      {
        kind: "colorScale",
        stops: [
          { value: { type: "min" }, color: { kind: "icv", icv: 2, tint: 0 } },
          { value: { type: "max" }, color: { kind: "icv", icv: 3, tint: 0 } },
        ],
        priority: 0,
        stopIfTrue: false,
        ranges: ONE_RANGE,
      },
    ]);
  });

  it("reads a top10 rule from CFExFilterParams", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), {
        icfTemplate: 0x0005,
        templateParams: cfExFilterParams({
          top: true,
          percent: false,
          iParam: 10,
        }),
      }),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([
      {
        kind: "top10",
        rank: 10,
        percent: false,
        bottom: false,
        priority: 0,
        stopIfTrue: false,
        ranges: ONE_RANGE,
      },
    ]);
  });

  it("reads a bottom-percent top10 rule", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), {
        icfTemplate: 0x0005,
        templateParams: cfExFilterParams({
          top: false,
          percent: true,
          iParam: 25,
        }),
      }),
    );

    const format = readCondFmt12Group(groups, 0, NO_SHEETS).formats[0];
    expect(format).toMatchObject({
      kind: "top10",
      rank: 25,
      percent: true,
      bottom: true,
    });
  });

  it("reads every above/below-average icfTemplate against its own aboveAverage/equalAverage pairing, with a standard-deviation count", () => {
    const cases: [number, boolean, boolean][] = [
      [0x0019, true, false], // Above average
      [0x001a, false, false], // Below average
      [0x001d, true, true], // Above or equal to average
      [0x001e, false, true], // Below or equal to average
    ];
    for (const [icfTemplate, aboveAverage, equalAverage] of cases) {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x05, cfFilterBytes(), {
          icfTemplate,
          templateParams: cfExAveragesTemplateParams(1),
        }),
      );
      const format = readCondFmt12Group(groups, 0, NO_SHEETS).formats[0];
      expect(format).toMatchObject({
        kind: "aboveAverage",
        aboveAverage,
        equalAverage,
        stdDev: 1,
      });
    }
  });

  it("omits stdDev for an aboveAverage rule with no standard-deviation offset", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), {
        icfTemplate: 0x0019,
        templateParams: cfExAveragesTemplateParams(0),
      }),
    );

    const format = readCondFmt12Group(groups, 0, NO_SHEETS).formats[0];
    expect(format).toMatchObject({ kind: "aboveAverage", stdDev: undefined });
  });

  it("reads every documented date/time-period icfTemplate", () => {
    const cases: [number, string][] = [
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
    ];
    for (const [icfTemplate, timePeriod] of cases) {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x05, cfFilterBytes(), { icfTemplate }),
      );
      const format = readCondFmt12Group(groups, 0, NO_SHEETS).formats[0];
      expect(format).toMatchObject({ kind: "timePeriod", timePeriod });
    }
  });

  it("reads every icfTemplate needing no extra data beyond its own tag", () => {
    const cases: [number, string][] = [
      [0x0007, "uniqueValues"],
      [0x0009, "containsBlanks"],
      [0x000a, "notContainsBlanks"],
      [0x000b, "containsErrors"],
      [0x000c, "notContainsErrors"],
      [0x001b, "duplicateValues"],
    ];
    for (const [icfTemplate, kind] of cases) {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x05, cfFilterBytes(), { icfTemplate }),
      );
      expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([
        { kind, priority: 0, stopIfTrue: false, ranges: ONE_RANGE },
      ]);
    }
  });

  it("does not promote a containsText rule (icfTemplate 0x0008) carried as a ct 0x05 filter -- containsText is never expressed this way in a genuine file, since neither CFExTextTemplateParams nor CFFilter has anywhere to carry the search text; see readCf12Group's own ct 0x02 handling below for the real containsText path", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), { icfTemplate: 0x0008 }),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.formats).toEqual([]);
    expect(result.recordsConsumed).toBe(2);
  });

  it("does not promote an undocumented icfTemplate", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), { icfTemplate: 0x00ff }),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([]);
  });

  it("reads a filter rule's own DXFN12 style -- unlike colour scale/data bar/icon set, [MS-XLS] does not force ct 0x05's own cbDxf to zero", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), {
        icfTemplate: 0x001b, // duplicateValues -- needs no CFExTemplateParams data of its own, isolating the style extraction under test
        dxf: dxfFontColor(2), // icv 2, Red
      }),
    );

    const format = readCondFmt12Group(groups, 0, NO_SHEETS).formats[0];

    expect(format).toMatchObject({
      kind: "duplicateValues",
      style: { fontColorIcv: 2, fill: undefined },
    });
  });

  it("rejects a top10 rule with a zero rank rather than promoting a value the schema itself forbids", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), {
        icfTemplate: 0x0005,
        templateParams: cfExFilterParams({ top: true, iParam: 0 }),
      }),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([]);
  });

  it("still finds the record after a ct 0x05 rule's own CFFilter, proving cbFilter-driven skip advances correctly", () => {
    const groups = groupsFrom(
      condFmt12Record(2, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes([1, 2, 3, 4, 5, 6, 7, 8]), {
        icfTemplate: 0x0007,
      }),
      cf12Record(0x05, cfFilterBytes(), { icfTemplate: 0x001b }),
    );

    const result = readCondFmt12Group(groups, 0, NO_SHEETS);

    expect(result.recordsConsumed).toBe(3);
    expect(result.formats.map((f) => f.kind)).toEqual([
      "uniqueValues",
      "duplicateValues",
    ]);
  });

  describe("containsText/notContainsText/beginsWith/endsWith (ct 0x02, icfTemplate 0x0008)", () => {
    it("reads all four ctp sub-types, each from a bare PtgStr formula", () => {
      const cases: [number, string][] = [
        [0x0000, "containsText"],
        [0x0001, "notContainsText"],
        [0x0002, "beginsWith"],
        [0x0003, "endsWith"],
      ];
      for (const [ctp, kind] of cases) {
        const groups = groupsFrom(
          condFmt12Record(1, ONE_RANGE),
          cf12Record(0x02, [], {
            icfTemplate: 0x0008,
            templateParams: cfExTextTemplateParams(ctp),
            formula1: ptgStr("needle"),
          }),
        );
        const result = readCondFmt12Group(groups, 0, NO_SHEETS);
        expect(result.formats).toEqual([
          {
            kind,
            text: "needle",
            priority: 0,
            stopIfTrue: false,
            ranges: ONE_RANGE,
            style: undefined,
          },
        ]);
      }
    });

    it('extracts the literal text from inside a realistic ISNUMBER(SEARCH("text",A1)) formula, not just a bare PtgStr', () => {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x02, [], {
          icfTemplate: 0x0008,
          templateParams: cfExTextTemplateParams(0x0000), // containsText
          formula1: [
            ...ptgStr("needle"),
            ...ptgRef(0, 0),
            0x42,
            0x02,
            ...u16(0x0052), // PtgFuncVar, SEARCH, cparams=2
            0x41,
            ...u16(0x0080), // PtgFunc, ISNUMBER
          ],
        }),
      );

      const result = readCondFmt12Group(groups, 0, NO_SHEETS);

      expect(result.formats).toEqual([
        {
          kind: "containsText",
          text: "needle",
          priority: 0,
          stopIfTrue: false,
          ranges: ONE_RANGE,
          style: undefined,
        },
      ]);
    });

    it("reads a containsText rule's own resulting style", () => {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x02, [], {
          icfTemplate: 0x0008,
          templateParams: cfExTextTemplateParams(0x0000),
          formula1: ptgStr("needle"),
          dxf: dxfFontColor(2), // icv 2, Red
        }),
      );

      const format = readCondFmt12Group(groups, 0, NO_SHEETS).formats[0];

      expect(format).toMatchObject({
        kind: "containsText",
        text: "needle",
        style: { fontColorIcv: 2, fill: undefined },
      });
    });

    it("does not promote a ctp value outside the four documented sub-types", () => {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x02, [], {
          icfTemplate: 0x0008,
          templateParams: cfExTextTemplateParams(0x00ff),
          formula1: ptgStr("needle"),
        }),
      );

      expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([]);
    });

    it("does not promote a containsText-templated rule whose formula carries no string literal at all", () => {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x02, [], {
          icfTemplate: 0x0008,
          templateParams: cfExTextTemplateParams(0x0000),
          formula1: ptgRef(0, 0), // =A1, no PtgStr anywhere
        }),
      );

      expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([]);
    });

    it("does not promote a ct 0x02 rule whose icfTemplate is not the containsText family -- the same 'expression' boundary base CF's own formula-condition reading draws", () => {
      const groups = groupsFrom(
        condFmt12Record(1, ONE_RANGE),
        cf12Record(0x02, [], {
          icfTemplate: 0x0001, // "Formula" -- a plain formula condition, not a text template
          formula1: ptgInt(1),
        }),
      );

      expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toEqual([]);
    });
  });
});
