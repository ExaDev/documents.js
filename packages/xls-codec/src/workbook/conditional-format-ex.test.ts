import { describe, expect, it } from "vitest";
import type { FormulaSheetContext } from "../biff/ptg";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { readRecords } from "../biff/records";
import {
  concat,
  record,
  shortXlUnicodeString,
  u16,
  u32,
} from "../test-support/biff";
import { RECORD_CF, RECORD_CFEX, RECORD_CONDFMT } from "../biff/record-types";
import type { RawCfOperand } from "./conditional-format";
import { readCfEx, type CfExTarget } from "./conditional-format-ex";
import {
  readCondFmtGroup,
  type CondFmtGroupResult,
} from "./conditional-format";

// CFEx/CFExNonCF12 ([MS-XLS] 2.4.63/2.4.64): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/60d13d2f-8eb7-41bf-975c-8a1a51ad58b6, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/bc6f3168-a2fd-4f26-8cdc-d0a11b5f6ac3. Every byte layout exercised here is built directly to those published field tables, the same "state the real grammar, not a producer convention" approach conditional-format.test.ts and conditional-format-12.test.ts already take for their own sibling records.

const NO_SHEETS: FormulaSheetContext = { sheets: [], sheetRanges: [] };

interface TestRange {
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

const ONE_RANGE: TestRange[] = [
  { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 },
];

/** PtgStr ([MS-XLS] 2.5.198's own string-literal operand, opcode 0x17): a ShortXLUnicodeString -- the search text a containsText-family formula always carries somewhere in its own token stream. */
function ptgStr(text: string): number[] {
  return [0x17, ...shortXlUnicodeString(text)];
}

/** A fully-relative PtgRef (value class, [MS-XLS] 2.5.198.61): opcode 0x44, row, then a relative ColRelU column field -- what a bare `A1` reference compiles to. */
function ptgRef(row: number, column: number): number[] {
  return [0x44, ...u16(row), ...u16(0xc000 | column)];
}

/** CFExTextTemplateParams ([MS-XLS] 2.4): ctp(2) then 14 reserved bytes. */
function cfExTextTemplateParams(ctp: number): number[] {
  return [...u16(ctp), ...new Array<number>(14).fill(0)];
}

const DXFFNTD_LENGTH = 122;
const DXFFNTD_ICV_FORE_OFFSET = 80;

/** A minimal DXFN12 ([MS-XLS] 2.4) naming only a font colour: the 6-byte flags header (ibitAtrFnt only) then a 122-byte DXFFntD with icvFore set at its own documented offset -- the same payload conditional-format-12.test.ts's own dxfFontColor builds, written independently here per this file's own top comment. */
function dxfFontColor(icvFore: number): number[] {
  const block = new Array<number>(DXFFNTD_LENGTH).fill(0);
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setInt32(0, icvFore, true);
  block.splice(DXFFNTD_ICV_FORE_OFFSET, 4, ...new Uint8Array(buffer));
  return [...u32(1 << 26), ...u16(0), ...block];
}

/** CFExNonCF12 ([MS-XLS] 2.4.64): icf(2) cp(1) icfTemplate(1) ipriority(2) [A-fActive/B-fStopIfTrue/reserved](1) fHasDXF(1) [dxf(cbDxf-prefixed) if fHasDXF] cbTemplateParm(1) rgbTemplateParms(16). */
function cfExNonCf12Bytes(options: {
  icf?: number;
  icfTemplate?: number;
  priority?: number;
  active?: boolean;
  stopIfTrue?: boolean;
  dxf?: readonly number[];
  templateParams?: readonly number[];
}): number[] {
  const templateParams =
    options.templateParams ?? new Array<number>(16).fill(0);
  if (templateParams.length !== 16) {
    throw new Error("templateParams must be exactly 16 bytes");
  }
  const active = options.active ?? true;
  const flags =
    (active ? 0x1 : 0x0) | (options.stopIfTrue === true ? 0x2 : 0x0);
  const dxf = options.dxf;
  return [
    ...u16(options.icf ?? 0),
    0x00, // cp
    options.icfTemplate ?? 0x08,
    ...u16(options.priority ?? 0),
    flags,
    dxf === undefined ? 0x00 : 0x01, // fHasDXF
    ...(dxf === undefined ? [] : [...u32(dxf.length), ...dxf]),
    16, // cbTemplateParm
    ...templateParams,
  ];
}

interface CfExOptions {
  readonly fIsCF12?: number;
  readonly icf?: number;
  readonly icfTemplate?: number;
  readonly priority?: number;
  readonly active?: boolean;
  readonly stopIfTrue?: boolean;
  readonly dxf?: readonly number[];
  readonly templateParams?: readonly number[];
}

/** CFEx ([MS-XLS] 2.4.63): a 12-byte frtRefHeaderU, fIsCF12(4), nID(2), then CFExNonCF12 when fIsCF12 is 0. */
function cfExBytes(
  nID: number,
  options: CfExOptions = {},
): Uint8Array<ArrayBuffer> {
  const fIsCF12 = options.fIsCF12 ?? 0;
  return record(RECORD_CFEX, [
    ...new Array<number>(12).fill(0), // frtRefHeaderU
    ...u32(fIsCF12),
    ...u16(nID),
    ...(fIsCF12 === 0 ? cfExNonCf12Bytes(options) : []),
  ]);
}

function groupsFrom(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): RecordGroup[] {
  return [...groupRecords(readRecords(concat(...records)))];
}

/** A single CFEx record, already grouped into the RecordGroup shape readCfEx itself consumes (its own Continue records, if any, joined in) -- readCfEx never sees the raw framed bytes cfExBytes produces, exactly as workbook/sheet.ts never hands it one either. */
function cfExRecordGroup(nID: number, options: CfExOptions = {}): RecordGroup {
  const group = groupsFrom(cfExBytes(nID, options))[0];
  if (group === undefined) {
    throw new Error("expected a CFEx record group");
  }
  return group;
}

function targetFrom(
  ranges: readonly TestRange[],
  cfs: readonly (RawCfOperand | undefined)[],
): CfExTarget {
  return { ranges: [...ranges], cfs };
}

describe("readCfEx", () => {
  it("reads a containsText rule extending a legacy CF's own formula operand", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("needle")) },
    ]);
    const targets = new Map([[5, target]]);
    const cfExGroup = cfExRecordGroup(5, {
      icf: 0,
      icfTemplate: 0x08,
      priority: 3,
      templateParams: cfExTextTemplateParams(0x0000), // containsText
    });

    const result = readCfEx(cfExGroup, targets, NO_SHEETS);

    expect(result).toEqual({
      kind: "containsText",
      text: "needle",
      priority: 3,
      stopIfTrue: false,
      ranges: ONE_RANGE,
      style: undefined,
    });
  });

  it("reads all four ctp sub-types via the same legacy-CF operand", () => {
    const cases: [number, string][] = [
      [0x0000, "containsText"],
      [0x0001, "notContainsText"],
      [0x0002, "beginsWith"],
      [0x0003, "endsWith"],
    ];
    for (const [ctp, kind] of cases) {
      const target = targetFrom(ONE_RANGE, [
        { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("needle")) },
      ]);
      const targets = new Map([[1, target]]);
      const cfExGroup = cfExRecordGroup(1, {
        icfTemplate: 0x08,
        templateParams: cfExTextTemplateParams(ctp),
      });

      const result = readCfEx(cfExGroup, targets, NO_SHEETS);

      expect(result).toMatchObject({ kind, text: "needle" });
    }
  });

  it("resolves the icf-th CF among several sharing one CondFmt group", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x01, cp: 0x03, rgce1: new Uint8Array() }, // icf 0: an unrelated comparison rule
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("second")) }, // icf 1: the one this CFEx extends
    ]);
    const targets = new Map([[9, target]]);
    const cfExGroup = cfExRecordGroup(9, {
      icf: 1,
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
    });

    const result = readCfEx(cfExGroup, targets, NO_SHEETS);

    expect(result).toMatchObject({ kind: "containsText", text: "second" });
  });

  it("reads a resulting font colour override from its own DXFN12", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("needle")) },
    ]);
    const targets = new Map([[1, target]]);
    const cfExGroup = cfExRecordGroup(1, {
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
      dxf: dxfFontColor(2), // icv 2, Red
    });

    const result = readCfEx(cfExGroup, targets, NO_SHEETS);

    expect(result).toMatchObject({
      style: { fontColorIcv: 2, fill: undefined },
    });
  });

  it("reads a stopIfTrue rule", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("needle")) },
    ]);
    const targets = new Map([[1, target]]);
    const cfExGroup = cfExRecordGroup(1, {
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
      stopIfTrue: true,
    });

    const result = readCfEx(cfExGroup, targets, NO_SHEETS);

    expect(result).toMatchObject({ stopIfTrue: true });
  });

  it("does not promote an inactive rule (fActive 0) -- Excel itself ignores it", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("needle")) },
    ]);
    const targets = new Map([[1, target]]);
    const cfExGroup = cfExRecordGroup(1, {
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
      active: false,
    });

    expect(readCfEx(cfExGroup, targets, NO_SHEETS)).toBeUndefined();
  });

  it("does not promote a rule extending a CF12 record (fIsCF12 nonzero) -- that CF12 carries no ranges of its own, see this file's own top comment", () => {
    const targets = new Map<number, CfExTarget>();
    const cfExGroup = cfExRecordGroup(1, { fIsCF12: 1 });

    expect(readCfEx(cfExGroup, targets, NO_SHEETS)).toBeUndefined();
  });

  it("does not promote a rule whose nID names no CondFmt group this reader has seen", () => {
    const targets = new Map<number, CfExTarget>();
    const cfExGroup = cfExRecordGroup(404, { icfTemplate: 0x08 });

    expect(readCfEx(cfExGroup, targets, NO_SHEETS)).toBeUndefined();
  });

  it("does not promote a rule whose icf names no CF in the referenced group", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("needle")) },
    ]);
    const targets = new Map([[1, target]]);
    const cfExGroup = cfExRecordGroup(1, {
      icf: 5, // only index 0 exists
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
    });

    expect(readCfEx(cfExGroup, targets, NO_SHEETS)).toBeUndefined();
  });

  it("does not promote a rule whose referenced CF this reader could not itself parse", () => {
    const target = targetFrom(ONE_RANGE, [undefined]);
    const targets = new Map([[1, target]]);
    const cfExGroup = cfExRecordGroup(1, {
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
    });

    expect(readCfEx(cfExGroup, targets, NO_SHEETS)).toBeUndefined();
  });

  it("does not promote a rule whose referenced CF's own formula carries no string literal", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgRef(0, 0)) }, // =A1, no PtgStr anywhere
    ]);
    const targets = new Map([[1, target]]);
    const cfExGroup = cfExRecordGroup(1, {
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
    });

    expect(readCfEx(cfExGroup, targets, NO_SHEETS)).toBeUndefined();
  });

  it("does not promote a rule whose icfTemplate is not the containsText family", () => {
    const target = targetFrom(ONE_RANGE, [
      { ct: 0x02, cp: 0x00, rgce1: new Uint8Array(ptgStr("needle")) },
    ]);
    const targets = new Map([[1, target]]);
    const cfExGroup = cfExRecordGroup(1, {
      icfTemplate: 0x01, // "Formula" -- not a text template
      templateParams: cfExTextTemplateParams(0x0000),
    });

    expect(readCfEx(cfExGroup, targets, NO_SHEETS)).toBeUndefined();
  });

  it("degrades to undefined on a truncated CFEx record rather than throwing", () => {
    const targets = new Map<number, CfExTarget>();
    const truncatedGroup = groupsFrom(
      record(RECORD_CFEX, [...new Array<number>(8).fill(0)]),
    )[0];
    if (truncatedGroup === undefined) {
      throw new Error("expected a CFEx record group");
    }

    expect(readCfEx(truncatedGroup, targets, NO_SHEETS)).toBeUndefined();
  });
});

// End-to-end: a real worksheet substream carries the base CondFmt/CF group first, then the CFEx that extends one of its CF children -- this proves readCondFmtGroup's own nID/rawCfs and readCfEx actually compose the way workbook/sheet.ts wires them together, not just that each function is individually correct against a hand-built CfExTarget.
describe("readCondFmtGroup + readCfEx integration", () => {
  it("resolves a CFEx against the CondFmt group it names by nID", () => {
    const cfBytes = (
      ct: number,
      cp: number,
      formula1: readonly number[],
    ): Uint8Array<ArrayBuffer> =>
      record(RECORD_CF, [
        ct,
        cp,
        ...u16(formula1.length),
        ...u16(0),
        ...formula1,
      ]);
    const nID = 42;
    const condFmtBytes = record(RECORD_CONDFMT, [
      ...u16(1), // ccf
      ...u16(nID << 1), // A-fToughRecalc(0) + nID
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0), // refBound
      ...u16(1), // crefCount
      ...u16(ONE_RANGE[0]?.startRow ?? 0),
      ...u16(ONE_RANGE[0]?.endRow ?? 0),
      ...u16(ONE_RANGE[0]?.startColumn ?? 0),
      ...u16(ONE_RANGE[0]?.endColumn ?? 0),
    ]);
    const groups = groupsFrom(
      condFmtBytes,
      cfBytes(0x02, 0x00, ptgStr("needle")),
    );
    const condFmtResult: CondFmtGroupResult = readCondFmtGroup(
      groups,
      0,
      NO_SHEETS,
    );
    expect(condFmtResult.nID).toBe(nID);

    const targets = new Map([
      [
        condFmtResult.nID,
        { ranges: condFmtResult.ranges, cfs: condFmtResult.rawCfs },
      ],
    ]);
    const cfExGroup = cfExRecordGroup(nID, {
      icfTemplate: 0x08,
      templateParams: cfExTextTemplateParams(0x0000),
    });

    const result = readCfEx(cfExGroup, targets, NO_SHEETS);

    expect(result).toEqual({
      kind: "containsText",
      text: "needle",
      priority: 0,
      stopIfTrue: false,
      ranges: condFmtResult.ranges,
      style: undefined,
    });
  });
});
