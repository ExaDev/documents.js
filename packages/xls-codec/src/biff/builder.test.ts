import { describe, expect, it } from "vitest";

import { RecordBuilder } from "./builder";

function view(bytes: Uint8Array<ArrayBuffer>): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe("RecordBuilder", () => {
  it("writes a u8 as a single byte", () => {
    const bytes = new RecordBuilder().u8(0xab).build();
    expect(Array.from(bytes)).toEqual([0xab]);
  });

  it("writes a u16 little-endian", () => {
    const bytes = new RecordBuilder().u16(0x1234).build();
    expect(Array.from(bytes)).toEqual([0x34, 0x12]);
  });

  it("truncates a u16 to its own 16 bits", () => {
    const bytes = new RecordBuilder().u16(0x12345).build();
    expect(view(bytes).getUint16(0, true)).toBe(0x2345);
  });

  it("writes a u32 little-endian, including a value with the top bit set", () => {
    // The value composed via multiplication, not a signed left shift, matching biff/cursor.ts's own u32 reader -- 0xffffffff must round-trip as an unsigned 32-bit value, not become -1.
    const bytes = new RecordBuilder().u32(0xffffffff).build();
    expect(view(bytes).getUint32(0, true)).toBe(0xffffffff);
  });

  it("writes an f64 as a little-endian IEEE 754 double", () => {
    const bytes = new RecordBuilder().f64(3.14159).build();
    expect(view(bytes).getFloat64(0, true)).toBeCloseTo(3.14159, 10);
  });

  it("appends raw bytes verbatim", () => {
    const bytes = new RecordBuilder()
      .u8(0x01)
      .bytes(new Uint8Array([0xaa, 0xbb]))
      .u8(0x02)
      .build();
    expect(Array.from(bytes)).toEqual([0x01, 0xaa, 0xbb, 0x02]);
  });

  it("chains fields in call order into one contiguous buffer", () => {
    const bytes = new RecordBuilder().u16(1).u16(2).u32(3).build();
    expect(bytes.length).toBe(8);
    expect(view(bytes).getUint16(0, true)).toBe(1);
    expect(view(bytes).getUint16(2, true)).toBe(2);
    expect(view(bytes).getUint32(4, true)).toBe(3);
  });

  it("builds an empty buffer with no fields", () => {
    expect(new RecordBuilder().build().length).toBe(0);
  });
});
