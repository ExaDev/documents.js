import { describe, expect, it } from "vitest";
import { DocFormatError } from "./errors";
import { findLargestAtMost, parsePlc } from "./plc";

// Bytes assembled by hand from [MS-DOC] 2.2.2's own PLC definition rather than dumped from a real file: "The PLC structure is an array of character positions followed by an array of data elements ... The number of CPs MUST be one more than the number of data elements", with n = (cbPlc - 4) / (4 + cbData).
function plcBytes(cps: number[], data: number[][]): Uint8Array {
  const elementSize = data[0]?.length ?? 0;
  const bytes = new Uint8Array(cps.length * 4 + data.length * elementSize);
  const view = new DataView(bytes.buffer);
  cps.forEach((cp, index) => {
    view.setUint32(index * 4, cp, true);
  });
  data.forEach((element, index) => {
    bytes.set(element, cps.length * 4 + index * elementSize);
  });
  return bytes;
}

describe("parsePlc", () => {
  it("derives the element count from the spec's own n = (cbPlc - 4) / (4 + cbData) formula", () => {
    // Three 8-byte data elements: (4 * 4 + 3 * 8 - 4) / (4 + 8) = 36 / 12 = 3.
    const bytes = plcBytes(
      [0, 6, 13, 14],
      [
        new Array<number>(8).fill(1),
        new Array<number>(8).fill(2),
        new Array<number>(8).fill(3),
      ],
    );
    const plc = parsePlc(bytes, 8, "PlcPcd");
    expect(plc.count).toBe(3);
    expect(plc.keys).toEqual([0, 6, 13, 14]);
    expect(Array.from(plc.element(0))).toEqual(new Array<number>(8).fill(1));
    expect(Array.from(plc.element(2))).toEqual(new Array<number>(8).fill(3));
  });

  it("handles a 4-byte data element, the PlcBteChpx shape", () => {
    const bytes = plcBytes(
      [0x200, 0x400, 0x600],
      [
        [1, 0, 0, 0],
        [2, 0, 0, 0],
      ],
    );
    const plc = parsePlc(bytes, 4, "PlcBteChpx");
    expect(plc.count).toBe(2);
    expect(plc.keys).toEqual([0x200, 0x400, 0x600]);
  });

  it("rejects a size that does not divide into a whole number of elements", () => {
    // 4 + 4 + 8 = 16 bytes with an 8-byte element gives (16 - 4) / 12 = 1, so add one stray byte to break it.
    const bytes = new Uint8Array(17);
    expect(() => parsePlc(bytes, 8, "PlcPcd")).toThrow(DocFormatError);
    expect(() => parsePlc(bytes, 8, "PlcPcd")).toThrow(/whole number/);
  });

  it("rejects a PLC too short to hold even its own single terminating CP", () => {
    expect(() => parsePlc(new Uint8Array(3), 8, "PlcPcd")).toThrow(
      DocFormatError,
    );
  });

  it("rejects keys that are not in ascending order, which the spec requires of every PLC", () => {
    const bytes = plcBytes([10, 5], [new Array<number>(8).fill(0)]);
    expect(() => parsePlc(bytes, 8, "PlcPcd")).toThrow(/ascending/);
  });

  it("accepts an empty PLC of one terminating key and no data elements", () => {
    const plc = parsePlc(plcBytes([0], []), 8, "PlcPcd");
    expect(plc.count).toBe(0);
    expect(plc.keys).toEqual([0]);
  });

  it("rejects an element index outside the parsed range rather than reading adjacent bytes", () => {
    const plc = parsePlc(
      plcBytes([0, 1], [new Array<number>(8).fill(0)]),
      8,
      "PlcPcd",
    );
    expect(() => plc.element(1)).toThrow(DocFormatError);
    expect(() => plc.element(-1)).toThrow(DocFormatError);
  });
});

// The lookup every [MS-DOC] algorithm phrases as "find the largest i such that a[i] <= x", used against PlcPcd.aCp, PlcBteChpx.aFc, ChpxFkp.rgfc and PapxFkp.rgfc alike.
describe("findLargestAtMost", () => {
  const keys = [0, 10, 20, 30];

  it("finds the index of the containing range", () => {
    expect(findLargestAtMost(keys, 0)).toBe(0);
    expect(findLargestAtMost(keys, 9)).toBe(0);
    expect(findLargestAtMost(keys, 10)).toBe(1);
    expect(findLargestAtMost(keys, 29)).toBe(2);
  });

  it("returns undefined when the value is below the first key", () => {
    expect(findLargestAtMost(keys, -1)).toBeUndefined();
  });

  it("returns undefined at or past the last key, which every algorithm treats as out of range", () => {
    expect(findLargestAtMost(keys, 30)).toBeUndefined();
    expect(findLargestAtMost(keys, 31)).toBeUndefined();
  });
});
