import { describe, expect, it } from "vitest";
import { RECORD_HEADER_SIZE } from "./header";
import {
  asciiBytes,
  concatBytes,
  i16le,
  i32le,
  u16le,
  u32le,
  u8,
  utf16le,
  writeAtom,
  writeContainer,
} from "./write";

// Direct tests of the byte primitives every writer module in this package composes records from -- exercised indirectly by every other writer's own test suite, but pinned here exactly so a boundary in one of these shared helpers (the loop bound utf16le/asciiBytes write up to, the byte count concatBytes lays out) is checked against its own exact output rather than only through a downstream reader's tolerant round trip.

describe("concatBytes", () => {
  it("lays out several parts back to back with no gap or overlap", () => {
    expect(Array.from(concatBytes(u8(1), u8(2), u8(3)))).toEqual([1, 2, 3]);
  });

  it("returns an empty array for no parts at all", () => {
    expect(concatBytes()).toHaveLength(0);
  });
});

describe("u8", () => {
  it("masks a value down to its low byte", () => {
    expect(Array.from(u8(0x1ff))).toEqual([0xff]);
  });
});

describe("u16le / i16le", () => {
  it("writes an unsigned 16-bit value little-endian", () => {
    expect(Array.from(u16le(0x1234))).toEqual([0x34, 0x12]);
  });

  it("writes a negative signed 16-bit value in two's complement", () => {
    expect(Array.from(i16le(-1))).toEqual([0xff, 0xff]);
  });
});

describe("u32le / i32le", () => {
  it("writes an unsigned 32-bit value little-endian", () => {
    expect(Array.from(u32le(0x01020304))).toEqual([0x04, 0x03, 0x02, 0x01]);
  });

  it("writes a negative signed 32-bit value in two's complement", () => {
    expect(Array.from(i32le(-1))).toEqual([0xff, 0xff, 0xff, 0xff]);
  });
});

describe("asciiBytes", () => {
  it("writes each character's code unit as one byte, in order", () => {
    expect(Array.from(asciiBytes("AB"))).toEqual([0x41, 0x42]);
  });

  it("writes nothing for an empty string", () => {
    expect(asciiBytes("")).toHaveLength(0);
  });
});

describe("utf16le", () => {
  it("writes every character's code unit as a little-endian 16-bit value, up to and including the last one", () => {
    // A two-character string exercises the loop's own upper bound directly: an off-by-one that ran one iteration too many would read past the string (charCodeAt returns NaN) and write past the 4-byte buffer this allocates, throwing rather than merely producing a wrong value.
    expect(Array.from(utf16le("AB"))).toEqual([0x41, 0x00, 0x42, 0x00]);
  });

  it("writes nothing for an empty string", () => {
    expect(utf16le("")).toHaveLength(0);
  });

  it("encodes a non-Latin character's own code unit, not its byte value", () => {
    expect(Array.from(utf16le("é"))).toEqual([0xe9, 0x00]);
  });
});

describe("writeAtom", () => {
  it("writes an 8-byte header whose recLen is the payload's own length, followed by the payload", () => {
    const bytes = writeAtom(0x1234, u8(0xaa));
    expect(bytes).toHaveLength(RECORD_HEADER_SIZE + 1);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(2, true)).toBe(0x1234);
    expect(view.getUint32(4, true)).toBe(1);
    expect(bytes[RECORD_HEADER_SIZE]).toBe(0xaa);
  });

  it("packs recVer into the low 4 bits and recInstance into the high 12 of the leading word", () => {
    const bytes = writeAtom(0, u8(0), { recVer: 0x2, recInstance: 0xabc });
    const versionAndInstance = new DataView(bytes.buffer).getUint16(0, true);
    expect(versionAndInstance & 0xf).toBe(0x2);
    expect((versionAndInstance >> 4) & 0xfff).toBe(0xabc);
  });

  it("defaults recVer and recInstance to zero", () => {
    const bytes = writeAtom(0, u8(0));
    expect(new DataView(bytes.buffer).getUint16(0, true)).toBe(0);
  });
});

describe("writeContainer", () => {
  it("stamps recVer 0xF and a recLen covering every child's header plus data", () => {
    const child = writeAtom(0x0001, u8(0xff));
    const bytes = writeContainer(0x2000, [child, child]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(0, true) & 0xf).toBe(0xf);
    expect(view.getUint32(4, true)).toBe(child.length * 2);
  });
});
