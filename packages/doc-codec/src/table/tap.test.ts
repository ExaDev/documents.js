import { describe, expect, it } from "vitest";
import { decodeSprm, SGC, type Prl, type Sprm } from "../prop/sprm";
import { BORDERS_TO_APPLY, writeShd } from "./decoration";
import { applyTableSprms, type TableRowProperties } from "./tap";

function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function tablePrl(value: number, operand: readonly number[]): Prl {
  return { sprm: decodeSprm(value), operand: Uint8Array.from(operand) };
}

/** A minimal sprmTDefTable Prl: `boundaries.length - 1` columns, each with an all-zero 20-byte TC80 (no merge, no border) — unless `tc80Count` states fewer, the format's own "fewer TC80s than columns" case ([MS-DOC] 2.9.313's own "the remaining columns are formatted with the default TC80 formatting"). */
function defTablePrl(
  boundaries: readonly number[],
  tc80Count = boundaries.length - 1,
): Prl {
  const numberOfColumns = boundaries.length - 1;
  const tc80s = Array.from({ length: tc80Count }, () =>
    new Array<number>(20).fill(0),
  ).flat();
  return tablePrl(0xd608, [
    0,
    0, // cb, never read by this reader (only the fixed-offset fields after it are).
    numberOfColumns,
    ...boundaries.flatMap(le16),
    ...tc80s,
  ]);
}

function applied(prls: readonly Prl[]): TableRowProperties {
  return applyTableSprms(prls, {});
}

describe("applyTableSprms", () => {
  it("defaults a column with no TC80 entry of its own to no merge and no border", () => {
    const prl = defTablePrl([0, 100, 200], 1); // 2 columns, only 1 TC80 provided.
    const result = applied([prl]);
    expect(result.definition?.cells).toHaveLength(2);
    expect(result.definition?.cells[1]).toEqual({ horzMerge: 0, vertMerge: 0 });
  });

  it("un-clears a side once a later sprmTSetBrc restates a real border on it, dropping clearedSides once it is empty again", () => {
    const def = defTablePrl([0, 100], 1);
    const nilBrc = new Array<number>(8).fill(0xff); // NilBrc: [MS-DOC]'s own all-bits-set clear sentinel.
    const realBrc = [0x00, 0x00, 0x00, 0x00, 0x02, 0x01, 0x00, 0x00]; // colour black, dptLineWidth 2, brcType single.
    const clear = tablePrl(0xd62f, [11, 0, 1, BORDERS_TO_APPLY.top, ...nilBrc]);
    const restate = tablePrl(0xd62f, [
      11,
      0,
      1,
      BORDERS_TO_APPLY.top,
      ...realBrc,
    ]);
    const result = applied([def, clear, restate]);
    expect(result.definition?.cells[0]?.clearedSides).toBeUndefined();
    expect(result.definition?.cells[0]?.borders?.top).toBeDefined();
  });

  it("does not treat a non-table sprm as sprmTDefTable even when its own value coincides with sprmTDefTable's own opcode", () => {
    const fakeSprm: Sprm = {
      value: 0xd608,
      ispmd: 0,
      fSpec: 0,
      sgc: SGC.paragraph,
      spra: 6,
    };
    const operand = defTablePrl([0, 100]).operand;
    const result = applied([{ sprm: fakeSprm, operand }]);
    expect(result.definition).toBeUndefined();
  });

  it("skips a non-table sprm entirely, even one whose own value coincides with a real table opcode", () => {
    const fakeSprm: Sprm = {
      value: 0x9407, // sprmTDyaRowHeight's own opcode, but stated as a non-table sprm here.
      ispmd: 0,
      fSpec: 0,
      sgc: SGC.paragraph,
      spra: 2,
    };
    const result = applied([
      { sprm: fakeSprm, operand: Uint8Array.from([100, 0]) },
    ]);
    expect(result.heightPt).toBeUndefined();
  });

  it("resolves a dyaRowHeight of exactly 0 to an undefined heightPt, not 0", () => {
    const heightPrl = tablePrl(0x9407, [0, 0]); // dyaRowHeight 0.
    const result = applied([heightPrl]);
    expect(result.heightPt).toBeUndefined();
  });

  it("reads sprmTTableHeader's own flag byte, and treats a zero as the row not being a header", () => {
    expect(applied([tablePrl(0x3404, [1])]).isHeader).toBe(true);
    expect(applied([tablePrl(0x3404, [0])]).isHeader).toBeUndefined();
    expect(applied([]).isHeader).toBeUndefined();
  });

  it("lets a later sprmTTableHeader clear an earlier one in the same grpprl", () => {
    expect(
      applied([tablePrl(0x3404, [1]), tablePrl(0x3404, [0])]).isHeader,
    ).toBeUndefined();
  });

  it("applies sprmTMerge's own ItcFirstLim range exactly, anchor first then continuations, nothing outside it", () => {
    const def = defTablePrl([0, 100, 200, 300, 400, 500]); // 5 columns.
    const merge = tablePrl(0x5624, [1, 3]); // itcFirst=1, itcLim=3 -> cells 1,2.
    const result = applied([def, merge]);
    const cells = result.definition?.cells ?? [];
    expect(cells[0]?.horzMerge).toBe(0);
    expect(cells[1]?.horzMerge).toBe(2); // anchor.
    expect(cells[2]?.horzMerge).toBe(1); // continuation.
    expect(cells[3]?.horzMerge).toBe(0);
    expect(cells[4]?.horzMerge).toBe(0);
  });

  it("restricts sprmTSetBrc and sprmTSetBrc80 to their own ItcFirstLim range, leaving every other cell untouched", () => {
    const def = defTablePrl([0, 100, 200, 300, 400]); // 4 columns.
    const realBrc = [0x00, 0x00, 0xff, 0x00, 0x02, 0x01, 0x00, 0x00]; // exact-colour border.
    const realBrc80 = [0x02, 0x01, 0x01, 0x00]; // Brc80: dptLineWidth 2, brcType single, ico 1.
    const setBrc = tablePrl(0xd62f, [
      11,
      1,
      2,
      BORDERS_TO_APPLY.top,
      ...realBrc,
    ]); // cell 1 only.
    const setBrc80 = tablePrl(0xd620, [
      7,
      3,
      4,
      BORDERS_TO_APPLY.top,
      ...realBrc80,
    ]); // cell 3 only.
    const result = applied([def, setBrc, setBrc80]);
    const cells = result.definition?.cells ?? [];
    expect(cells[0]?.borders?.top).toBeUndefined();
    expect(cells[1]?.borders?.top).toBeDefined();
    expect(cells[2]?.borders?.top).toBeUndefined();
    expect(cells[3]?.borders?.top).toBeDefined();
  });

  it("shades sprmTSetShd's own ItcFirstLim range exactly, cell by cell across every boundary", () => {
    const def = defTablePrl(
      Array.from({ length: 8 }, (_ignored, index) => index * 100),
    ); // 7 columns, cells 0..6.
    const shdBytes = writeShd({ kind: "solid", color: { r: 1, g: 0, b: 0 } });
    const shd = tablePrl(0xd62d, [0, 2, 5, ...shdBytes]); // itcFirst=2, itcLim=5 -> cells 2,3,4.
    const result = applied([def, shd]);
    const cells = result.definition?.cells ?? [];
    expect(cells[0]?.background).toBeUndefined();
    expect(cells[1]?.background).toBeUndefined();
    expect(cells[2]?.background).toBeDefined();
    expect(cells[3]?.background).toBeDefined();
    expect(cells[4]?.background).toBeDefined();
    expect(cells[5]?.background).toBeUndefined();
    expect(cells[6]?.background).toBeUndefined();
  });

  it("shades every other cell from sprmTSetShdOdd's own itcFirst, not every cell in its range", () => {
    const def = defTablePrl(
      Array.from({ length: 9 }, (_ignored, index) => index * 100),
    ); // 8 columns, cells 0..7.
    const shdBytes = writeShd({ kind: "solid", color: { r: 0, g: 1, b: 0 } });
    const shd = tablePrl(0xd62e, [0, 1, 7, ...shdBytes]); // itcFirst=1, itcLim=7, every other from 1: cells 1,3,5.
    const result = applied([def, shd]);
    const cells = result.definition?.cells ?? [];
    expect(cells[0]?.background).toBeUndefined();
    expect(cells[1]?.background).toBeDefined();
    expect(cells[2]?.background).toBeUndefined();
    expect(cells[3]?.background).toBeDefined();
    expect(cells[4]?.background).toBeUndefined();
    expect(cells[5]?.background).toBeDefined();
    expect(cells[6]?.background).toBeUndefined();
    expect(cells[7]?.background).toBeUndefined();
  });

  it("shades a cell from sprmTDefTableShd80's own packed Shd80 word", () => {
    const def = defTablePrl([0, 100, 200]); // 2 columns.
    const shd80Value = 0x0020; // icoFore 0 (auto), icoBack 1 (black), ipat 0 (auto) -> a solid fill from icoBack.
    const shd80 = tablePrl(0xd609, [2, ...le16(shd80Value)]); // cb=2, one Shd80 entry.
    const result = applied([def, shd80]);
    const cells = result.definition?.cells ?? [];
    expect(cells[0]?.background).toBeDefined();
    expect(cells[1]?.background).toBeUndefined();
  });

  it("leaves the row untouched for a table sprm this reader deliberately does not convert", () => {
    const def = defTablePrl([0, 100]);
    const unhandled = tablePrl(0xd6ff, [0, 0]); // an sgc-table opcode this switch has no case for.
    expect(() => applied([def, unhandled])).not.toThrow();
    const result = applied([def, unhandled]);
    expect(result.definition?.cells).toHaveLength(1);
  });
});
