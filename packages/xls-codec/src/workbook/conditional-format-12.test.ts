import { describe, expect, it } from "vitest";
import type { FormulaSheetContext } from "../biff/ptg";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { readRecords } from "../biff/records";
import { concat, f64, record, u16, u32 } from "../test-support/biff";
import { RECORD_CF12, RECORD_CONDFMT12 } from "../biff/record-types";
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

function cf12Record(
  ct: number,
  rgbCT: readonly number[],
  options: { stopIfTrue?: boolean; priority?: number } = {},
): Uint8Array<ArrayBuffer> {
  return record(RECORD_CF12, [
    ...new Array<number>(12).fill(0), // frtRefHeader
    ct,
    0x00, // cp
    ...u16(0), // cce1
    ...u16(0), // cce2
    ...u32(0), // cbDxf
    ...u16(0), // fmlaActive cce
    options.stopIfTrue === true ? 0x02 : 0x00, // flags: B - fStopIfTrue
    ...u16(options.priority ?? 0), // ipriority
    ...u16(0), // icfTemplate
    16, // cbTemplateParm
    ...new Array<number>(16).fill(0), // rgbTemplateParms
    ...rgbCT,
  ]);
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
          { value: { type: "min" }, color: { kind: "icv", icv: 2 } },
          { value: { type: "max" }, color: { kind: "icv", icv: 3 } },
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
      color: { kind: "rgb", color: { r: 1, g: 1, b: 0 } },
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
});
