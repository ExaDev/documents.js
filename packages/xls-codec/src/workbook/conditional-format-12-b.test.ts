// The CF12 group suite, split from conditional-format-12.test.ts, restating its harness verbatim.

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

/** CFGradient ([MS-XLS] 2.4's own colour-scale rgbCT shape). Each stop pairs a cfvo (rgInterp, plus its own 8-byte numDomain fraction) with a colour (rgCurve, its own 8-byte numGrange fraction then a CFColor) — the two arrays are positional and written here fully separately, matching the record's own non-interleaved layout. */
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
    /** rgce1's own bytes ([MS-XLS] 2.4.43's own CFParsedFormulaNoCCE) — meaningful only for ct 0x01/0x02, empty (cce1 0) for every other ct this file already exercises. */
    formula1?: readonly number[];
    /** rgce2's own bytes — meaningful only for ct 0x01 with cp 0x01/0x02, empty for every other ct. Filler content this reader never reads (skipped by its own declared cce2), so its only purpose here is proving the skip advances the cursor by exactly that many bytes rather than by none at all. */
    rgce2?: readonly number[];
    /** fmlaActive's own rgce bytes (the colour scale/data bar/icon set "activity condition" formula) — filler this reader always skips over regardless of ct, for the identical reason rgce2 above is. */
    fmlaActiveRgce?: readonly number[];
  } = {},
): number[] {
  const templateParams =
    options.templateParams ?? new Array<number>(16).fill(0);
  if (templateParams.length !== 16) {
    throw new Error("templateParams must be exactly 16 bytes");
  }
  const dxf = options.dxf ?? [];
  const formula1 = options.formula1 ?? [];
  const rgce2 = options.rgce2 ?? [];
  const fmlaActiveRgce = options.fmlaActiveRgce ?? [];
  return [
    ...new Array<number>(12).fill(0), // frtRefHeader
    ct,
    0x00, // cp
    ...u16(formula1.length), // cce1
    ...u16(rgce2.length), // cce2
    ...u32(dxf.length), // cbDxf
    ...dxf,
    ...formula1, // rgce1
    ...rgce2,
    ...u16(fmlaActiveRgce.length), // fmlaActive cce
    ...fmlaActiveRgce,
    options.stopIfTrue === true ? 0x02 : 0x00, // flags: B - fStopIfTrue
    ...u16(options.priority ?? 0), // ipriority
    ...u16(options.icfTemplate ?? 0), // icfTemplate
    16, // cbTemplateParm
    ...templateParams, // rgbTemplateParms (CFExTemplateParams)
    ...rgbCT,
  ];
}

/** A minimal CFFilter ([MS-XLS] 2.4): cbFilter(2) then that many bytes — content is irrelevant for every ct 0x05 rule this reader promotes, since CFExFilterParams/CFExAveragesTemplateParams already duplicate whatever it would carry; only its own declared length matters, to prove the reader skips exactly that far. */
function cfFilterBytes(body: readonly number[] = [0, 0, 0, 0]): number[] {
  return [...u16(body.length), ...body];
}

/** CFExFilterParams ([MS-XLS] 2.4): a flags byte (fTop/fPercent/reserved) then iParam(2) then 13 reserved bytes — top10's own rgbTemplateParms shape. */

/** CFExAveragesTemplateParams ([MS-XLS] 2.4): iParam(2, a standard-deviation count) then 14 reserved bytes — the aboveAverage family's own rgbTemplateParms shape. */

function cf12Record(
  ct: number,
  rgbCT: readonly number[],
  options: Parameters<typeof cf12Bytes>[2] = {},
): Uint8Array<ArrayBuffer> {
  return record(RECORD_CF12, cf12Bytes(ct, rgbCT, options));
}

/** PtgStr ([MS-XLS] 2.5.198.something, opcode 0x17): a ShortXLUnicodeString operand — the literal search text a containsText-family formula always carries somewhere in its own token stream, wrapped in whatever function shape the sub-type needs (see readCfTextFilterRule's own comment in conditional-format-12.ts). */
function ptgStr(text: string): number[] {
  return [0x17, ...shortXlUnicodeString(text)];
}

/** A fully-relative PtgRef (value class, [MS-XLS] 2.5.198.61): opcode 0x44, then row and a relative ColRelU column field — what a bare `A1` reference compiles to. */
function ptgRef(row: number, column: number): number[] {
  return [0x44, ...u16(row), ...u16(0xc000 | column)];
}

/** CFExTextTemplateParams ([MS-XLS] 2.4): ctp(2) then 14 reserved bytes — the containsText family's own rgbTemplateParms shape, naming which of the four text sub-types a rule is. */
function cfExTextTemplateParams(ctp: number): number[] {
  return [...u16(ctp), ...new Array<number>(14).fill(0)];
}

/** A minimal DXFN ([MS-XLS] 2.4.97) naming only a font colour: the 6-byte flags header (ibitAtrFnt only) then a 122-byte DXFFntD with icvFore set at its own documented offset — everything conditional-format.test.ts's own sibling dxf() helper already builds for base CF's identical DXFN, written independently here since DXFN12 wraps this exact same payload behind its own cbDxf prefix rather than sharing test fixture code across files. */

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
    expect(result.formats).toStrictEqual([
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
    expect(format.stops[1]).toStrictEqual({
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
    expect(format.stops[0]?.value).toStrictEqual({
      type: "formula",
      value: "5",
    });
  });

  it("degrades a colour scale whole rule when a threshold's own formula does not resolve to any text at all", () => {
    // Two bare references with no combining operator between them (ptg.ts's own "leaves more than one value on the stack" abort case) is a malformed formula parseFormulaText genuinely cannot render, distinct from a threshold that simply carries no formula at all (cce 0, the numValue path every other formula-less test here already exercises).
    const malformedFormula = [...ptgRef(0, 0), ...ptgRef(0, 1)];
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(
        0x03,
        cfGradient([
          {
            cfvo: cfvo(0x07, { formula: malformedFormula }),
            color: cfColorIcv(2),
          },
          { cfvo: cfvo(0x03), color: cfColorIcv(3) },
        ]),
      ),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([]);
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

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([]);
  });

  // Every well-formed fixture above states matching, in-range cInterpCurve/cGradientCurve counts (2 or 3, always equal), so none of them can tell this guard's own <2/>3/mismatch checks apart from a bypass that would let the read continue — each of the three cases below supplies exactly as many stop bytes as a bypassed read would consume, so a wrongly-skipped guard produces a genuine, differently-shaped colour scale rather than the same "record not promoted" outcome the guard's own correct refusal already gives.
  it("degrades a colour scale whose own cInterpCurve and cGradientCurve counts disagree, even where both individually parse", () => {
    const rgbCT = [
      ...u16(0), // unused
      0x00, // reserved1
      2, // cInterpCurve
      3, // cGradientCurve — disagrees with cInterpCurve above
      0x03, // fClamp + fBackground
      ...[cfvo(0x02), cfvo(0x03)].flatMap((v) => [...v, ...f64(0)]), // 2 rgInterp entries
      ...[cfColorIcv(1), cfColorIcv(2), cfColorIcv(3)].flatMap((c) => [
        ...f64(0),
        ...c,
      ]), // 3 rgCurve entries
    ];
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x03, rgbCT),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([]);
  });

  it("degrades a colour scale with fewer than 2 stops", () => {
    const rgbCT = [
      ...u16(0),
      0x00,
      1, // cInterpCurve
      1, // cGradientCurve
      0x03,
      ...[cfvo(0x02)].flatMap((v) => [...v, ...f64(0)]),
      ...[cfColorIcv(1)].flatMap((c) => [...f64(0), ...c]),
    ];
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x03, rgbCT),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([]);
  });

  it("degrades a colour scale with more than 3 stops", () => {
    const values = [
      cfvo(0x02),
      cfvo(0x01, { num: 25 }),
      cfvo(0x01, { num: 75 }),
      cfvo(0x03),
    ];
    const colors = [1, 2, 3, 4].map((icv) => cfColorIcv(icv));
    const rgbCT = [
      ...u16(0),
      0x00,
      4, // cInterpCurve
      4, // cGradientCurve
      0x03,
      ...values.flatMap((v) => [...v, ...f64(0)]),
      ...colors.flatMap((c) => [...f64(0), ...c]),
    ];
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x03, rgbCT),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([]);
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

    expect(result.formats).toStrictEqual([
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

    expect(result.formats).toStrictEqual([
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
      // 0x04/0x05 deliberately diverge from the raw spec page's own prose ordering — see this table's own top comment in conditional-format-12.ts. Cross-checked against Apache POI's IconSet enum and LibreOffice's ScIconSetType enum, which independently agree with each other on this exact pairing.
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

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([]);
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
      expect(result.formats).toStrictEqual([]);
      expect(result.recordsConsumed).toBe(2);
    }
  });

  it("does not promote a ct 0x01 record even when its icfTemplate/templateParams/rgce1 happen to be shaped exactly like a valid containsText rule", () => {
    // ct itself, not merely what templateParams/rgce1 happen to contain, must gate the ct 0x02 branch: this fixture states ct 0x01 but otherwise supplies precisely the fixture the containsText describe block below proves DOES promote under a genuine ct 0x02.
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x01, [], {
        icfTemplate: 0x0008,
        templateParams: cfExTextTemplateParams(0x0000),
        formula1: ptgStr("needle"),
      }),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([]);
  });

  it("skips exactly rgce2's own declared length, leaving priority/stopIfTrue readable afterwards", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), {
        icfTemplate: 0x001b, // duplicateValues — needs no template data of its own
        rgce2: [0xaa, 0xbb, 0xcc, 0xdd, 0xee], // filler this reader never reads, only skips past
        priority: 7,
        stopIfTrue: true,
      }),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([
      {
        kind: "duplicateValues",
        priority: 7,
        stopIfTrue: true,
        ranges: ONE_RANGE,
        style: undefined,
      },
    ]);
  });

  it("skips exactly fmlaActive's own declared length, leaving priority/stopIfTrue readable afterwards", () => {
    const groups = groupsFrom(
      condFmt12Record(1, ONE_RANGE),
      cf12Record(0x05, cfFilterBytes(), {
        icfTemplate: 0x001b,
        fmlaActiveRgce: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77],
        priority: 9,
        stopIfTrue: true,
      }),
    );

    expect(readCondFmt12Group(groups, 0, NO_SHEETS).formats).toStrictEqual([
      {
        kind: "duplicateValues",
        priority: 9,
        stopIfTrue: true,
        ranges: ONE_RANGE,
        style: undefined,
      },
    ]);
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
      expect(format.ranges).toStrictEqual(ranges);
    }
  });
});
