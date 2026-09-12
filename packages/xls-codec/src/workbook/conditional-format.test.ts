import { describe, expect, it } from "vitest";
import type { FormulaSheetContext } from "../biff/ptg";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { readRecords } from "../biff/records";
import { concat, record, u16, u32 } from "../test-support/biff";
import { RECORD_CF, RECORD_CONDFMT } from "../biff/record-types";
import { readCondFmtGroup } from "./conditional-format";

// CondFmt/CF ([MS-XLS] 2.4.56/2.4.42): https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/d6dcadf2-7e07-4f7d-a60a-0f643780225d. Every byte layout exercised here is built directly to that published field table, the same "state the real grammar, not a producer convention" approach data-validation.test.ts already takes for its sibling Dv/DVal records.

const NO_SHEETS: FormulaSheetContext = { sheets: [], sheetRanges: [] };

/** PtgInt ([MS-XLS] 2.5.198.66): opcode 0x1E then an unsigned 16-bit value -- the simplest possible formula token, used here only to prove formula bytes are read and handed to parseFormulaText, not to exercise that parser's own grammar. */
function ptgInt(value: number): number[] {
  return [0x1e, ...u16(value)];
}

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

const DXFFNTD_LENGTH = 122;
const DXFFNTD_ICV_FORE_OFFSET = 80;

/** A DXFFntD block ([MS-XLS] 2.4.298) with every byte zero except icvFore (a signed 32-bit LE value at its own documented offset) -- the only field parseDxfStyle reads out of it. */
function dxfFontBlock(icvFore: number): number[] {
  const block = new Array<number>(DXFFNTD_LENGTH).fill(0);
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setInt32(0, icvFore, true);
  const icvBytes = new Uint8Array(buffer);
  block.splice(DXFFNTD_ICV_FORE_OFFSET, 4, ...icvBytes);
  return block;
}

/** DXFPat's own bit-packed word ([MS-XLS] 2.4.97's nested structure), LSB first: unused1(10) fls(6) icvForeground(7) icvBackground(7) unused2(2) -- the same packing parseDxfStyle's own comment cites. */
function dxfPatWord(fls: number, foreIcv: number, backIcv: number): number {
  return (
    (((fls & 0x3f) << 10) |
      ((foreIcv & 0x7f) << 16) |
      ((backIcv & 0x7f) << 23)) >>>
    0
  );
}

/** A DXFN structure ([MS-XLS] 2.4.97): the 6-byte flags header, then only whichever of dxfnum/dxffntd/dxfpat the caller asks for -- dxfalc/dxfbdr/dxfprot are never exercised here since parseDxfStyle never reads them either. */
function dxf(
  options: {
    fontColorIcv?: number;
    fill?: { fls: number; foreIcv: number; backIcv: number };
    numUser?: boolean;
  } = {},
): number[] {
  const { fontColorIcv, fill, numUser } = options;
  const hasNum = numUser === true;
  let flags1 = 0;
  if (hasNum) flags1 |= 1 << 25;
  if (fontColorIcv !== undefined) flags1 |= 1 << 26;
  if (fill !== undefined) flags1 |= 1 << 29;
  const flags2 = hasNum ? 1 : 0;
  const bytes: number[] = [...u32(flags1 >>> 0), ...u16(flags2)];
  if (hasNum) {
    // DXFNumUsr: cb(2 bytes) then a format-code string -- content is irrelevant, since parseDxfStyle degrades to no style the moment fIfmtUser is set, before reading any of these bytes.
    bytes.push(...u16(2), 0x30, 0x00);
  }
  if (fontColorIcv !== undefined) {
    bytes.push(...dxfFontBlock(fontColorIcv));
  }
  if (fill !== undefined) {
    bytes.push(...u32(dxfPatWord(fill.fls, fill.foreIcv, fill.backIcv)));
  }
  return bytes;
}

function cf(
  ct: number,
  cp: number,
  formula1: readonly number[],
  formula2: readonly number[],
  dxfBytes: readonly number[],
): Uint8Array<ArrayBuffer> {
  return record(RECORD_CF, [
    ct,
    cp,
    ...u16(formula1.length),
    ...u16(formula2.length),
    ...dxfBytes,
    ...formula1,
    ...formula2,
  ]);
}

function condFmt(
  ccf: number,
  ranges: readonly TestRange[],
): Uint8Array<ArrayBuffer> {
  return record(RECORD_CONDFMT, [
    ...u16(ccf),
    ...u16(0), // fToughRecalc(1 bit) + nID(15 bits) -- CFEx's own linkage, unused
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0), // refBound (Ref8U, 8 bytes) -- a redundant bounding superset of sqref, unused
    ...sqRefU(...ranges),
  ]);
}

function groupsFrom(
  ...records: readonly Uint8Array<ArrayBuffer>[]
): RecordGroup[] {
  return [...groupRecords(readRecords(concat(...records)))];
}

const ONE_RANGE: TestRange[] = [
  { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 },
];

describe("readCondFmtGroup", () => {
  it("reads a single comparison rule with one formula", () => {
    const groups = groupsFrom(
      condFmt(1, ONE_RANGE),
      cf(0x01, 0x05, ptgInt(10), [], []),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.recordsConsumed).toBe(2);
    expect(result.formats).toStrictEqual([
      {
        operator: "greaterThan",
        formula1: "10",
        formula2: undefined,
        style: undefined,
        ranges: ONE_RANGE,
      },
    ]);
  });

  it("reads a 'between' rule with two formulas", () => {
    const groups = groupsFrom(
      condFmt(1, ONE_RANGE),
      cf(0x01, 0x01, ptgInt(1), ptgInt(10), []),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.formats).toStrictEqual([
      {
        operator: "between",
        formula1: "1",
        formula2: "10",
        style: undefined,
        ranges: ONE_RANGE,
      },
    ]);
  });

  it("reads every cp value against SheetRuleOperator, its own distinct 1-indexed ordering", () => {
    const cases: [number, string][] = [
      [0x01, "between"],
      [0x02, "notBetween"],
      [0x03, "equal"],
      [0x04, "notEqual"],
      [0x05, "greaterThan"],
      [0x06, "lessThan"],
      [0x07, "greaterThanOrEqual"],
      [0x08, "lessThanOrEqual"],
    ];
    for (const [cp, operator] of cases) {
      const groups = groupsFrom(
        condFmt(1, ONE_RANGE),
        cf(0x01, cp, ptgInt(1), [], []),
      );
      const result = readCondFmtGroup(groups, 0, NO_SHEETS);
      expect(result.formats[0]?.operator).toBe(operator);
    }
  });

  it("does not promote a formula-type condition (ct 0x02)", () => {
    const groups = groupsFrom(
      condFmt(1, ONE_RANGE),
      cf(0x02, 0x00, ptgInt(1), [], []),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.formats).toStrictEqual([]);
    expect(result.recordsConsumed).toBe(2);
  });

  it("reads a resulting font colour override", () => {
    const groups = groupsFrom(
      condFmt(1, ONE_RANGE),
      cf(0x01, 0x03, ptgInt(0), [], dxf({ fontColorIcv: 10 })),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.formats[0]?.style).toStrictEqual({
      fontColorIcv: 10,
      fill: undefined,
    });
  });

  it("reads a resulting fill background override", () => {
    const groups = groupsFrom(
      condFmt(1, ONE_RANGE),
      cf(
        0x01,
        0x03,
        ptgInt(0),
        [],
        dxf({ fill: { fls: 1, foreIcv: 12, backIcv: 9 } }),
      ),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.formats[0]?.style).toStrictEqual({
      fontColorIcv: undefined,
      fill: { fillPattern: 1, fillForegroundIcv: 12, fillBackgroundIcv: 9 },
    });
  });

  it("degrades to no style when the dxf carries a DXFNumUsr, an ambiguous-length structure", () => {
    const groups = groupsFrom(
      condFmt(1, ONE_RANGE),
      cf(0x01, 0x03, ptgInt(0), [], dxf({ numUser: true, fontColorIcv: 10 })),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    // The rule itself still promotes (condition/operator/formula are unaffected -- their position is computed independently of the dxf's own internal layout), only its style is dropped.
    expect(result.formats[0]?.operator).toBe("equal");
    expect(result.formats[0]?.style).toBeUndefined();
  });

  it("reads 2-3 CF children sharing one CondFmt's own ranges", () => {
    const ranges: TestRange[] = [
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 2, endRow: 4, startColumn: 1, endColumn: 3 },
    ];
    const groups = groupsFrom(
      condFmt(3, ranges),
      cf(0x01, 0x03, ptgInt(1), [], []),
      cf(0x01, 0x04, ptgInt(2), [], []),
      cf(0x01, 0x05, ptgInt(3), [], []),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.recordsConsumed).toBe(4);
    expect(result.formats).toHaveLength(3);
    expect(result.formats.map((f) => f.operator)).toStrictEqual([
      "equal",
      "notEqual",
      "greaterThan",
    ]);
    for (const format of result.formats) {
      expect(format.ranges).toStrictEqual(ranges);
    }
  });

  it("degrades the whole group to no formats when a declared ccf runs past the end of the record array", () => {
    const groups = groupsFrom(
      condFmt(2, ONE_RANGE),
      cf(0x01, 0x03, ptgInt(1), [], []),
      // only one CF record follows, though ccf declared 2
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.formats).toStrictEqual([]);
    expect(result.recordsConsumed).toBe(1);
  });

  it("degrades the whole group to no formats when a non-CF record follows in place of a declared CF", () => {
    const groups = groupsFrom(
      condFmt(1, ONE_RANGE),
      record(RECORD_CONDFMT, [...u16(0)]), // some other record, not a CF
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.formats).toStrictEqual([]);
    expect(result.recordsConsumed).toBe(1);
  });

  it("degrades to no formats on a truncated CondFmt record rather than throwing", () => {
    const bytes = record(RECORD_CONDFMT, [...u16(1)]);
    const groups = [...groupRecords(readRecords(bytes))];

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.formats).toStrictEqual([]);
    expect(result.recordsConsumed).toBe(1);
  });

  it("omits a single CF this reader cannot promote without degrading its sibling rules in the same group", () => {
    const groups = groupsFrom(
      condFmt(2, ONE_RANGE),
      cf(0x02, 0x00, ptgInt(1), [], []), // formula-type condition, not promoted
      cf(0x01, 0x03, ptgInt(2), [], []),
    );

    const result = readCondFmtGroup(groups, 0, NO_SHEETS);

    expect(result.recordsConsumed).toBe(3);
    expect(result.formats).toHaveLength(1);
    expect(result.formats[0]?.operator).toBe("equal");
  });
});
