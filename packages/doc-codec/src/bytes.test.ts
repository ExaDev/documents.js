import { describe, expect, it } from "vitest";
import { DocFormatError } from "./errors";
import {
  readInt16LE,
  readInt32LE,
  readUint16LE,
  readUint32LE,
  slice,
} from "./bytes";

// Every [MS-DOC] structure is little-endian, and the spec's own field tables mix signed and unsigned integers of the same width in adjacent fields (PrcData.cbGrpprl is signed where Pcdt.lcb is unsigned), so both signednesses are first-class here rather than one being derived at each call site.
describe("little-endian readers", () => {
  const bytes = new Uint8Array([
    0x01, 0x02, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff,
  ]);

  it("reads an unsigned 16-bit value least-significant byte first", () => {
    expect(readUint16LE(bytes, 0)).toBe(0x0201);
  });

  it("reads an unsigned 32-bit value least-significant byte first", () => {
    expect(readUint32LE(bytes, 0)).toBe(0x04030201);
  });

  it("reads 0xFFFF as 65535 unsigned and -1 signed", () => {
    expect(readUint16LE(bytes, 4)).toBe(0xffff);
    expect(readInt16LE(bytes, 4)).toBe(-1);
  });

  it("reads 0xFFFFFFFF as 4294967295 unsigned and -1 signed", () => {
    expect(readUint32LE(bytes, 4)).toBe(0xffffffff);
    expect(readInt32LE(bytes, 4)).toBe(-1);
  });

  it("rejects a read that runs past the end of the buffer rather than returning a partial value", () => {
    expect(() => readUint32LE(bytes, 5)).toThrow(DocFormatError);
    expect(() => readUint16LE(bytes, 7)).toThrow(DocFormatError);
  });

  it("rejects a negative offset", () => {
    expect(() => readUint16LE(bytes, -1)).toThrow(DocFormatError);
  });
});

describe("slice", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);

  it("returns the requested range", () => {
    expect(Array.from(slice(bytes, 2, 3, "test"))).toEqual([2, 3, 4]);
  });

  it("returns an empty view for a zero length", () => {
    expect(slice(bytes, 2, 0, "test").length).toBe(0);
  });

  it("rejects a range that runs past the end, naming the structure that asked for it", () => {
    expect(() => slice(bytes, 4, 3, "Clx")).toThrow(/Clx/);
    expect(() => slice(bytes, 4, 3, "Clx")).toThrow(DocFormatError);
  });
});
