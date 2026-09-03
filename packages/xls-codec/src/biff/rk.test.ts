import { describe, expect, it } from "vitest";

import { decodeRkNumber } from "./rk";

/** The 32 bits of an RkNumber as they sit on the wire, from the two flags and the 30-bit payload. */
function rk(fx100: boolean, fInt: boolean, payload: number): number {
  return (((payload << 2) | (fInt ? 2 : 0) | (fx100 ? 1 : 0)) >>> 0) >>> 0;
}

describe("decodeRkNumber", () => {
  // [MS-XLS] 2.5.217: bit 0 is fX100 (the value is num/100), bit 1 is fInt (num is a signed integer rather than the top 30 bits of a double), and bits 2..31 are num. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/04fa5340-122f-49db-93ea-00cc75501efc

  it("decodes a positive integer payload", () => {
    expect(decodeRkNumber(rk(false, true, 42))).toBe(42);
  });

  it("decodes a negative integer payload from its 30-bit two's complement", () => {
    // num is a SIGNED 30-bit integer, so the sign bit is bit 29 of the payload, not bit 31 of the word.
    expect(decodeRkNumber(rk(false, true, (-42 >>> 0) & 0x3fffffff))).toBe(-42);
  });

  it("decodes zero", () => {
    expect(decodeRkNumber(rk(false, true, 0))).toBe(0);
  });

  it("divides an integer payload by 100 when fX100 is set", () => {
    expect(decodeRkNumber(rk(true, true, 1234))).toBe(12.34);
  });

  it("decodes a float payload as the top 30 bits of a double whose remaining bits are zero", () => {
    // [MS-XLS] 2.5.217, fInt = 0: "num is the 30 most significant bits of a 64-bit binary floating-point number ... The remaining 34-bits of the floating-point number MUST be 0." 1.5 is 0x3FF8000000000000, whose top 32 bits are 0x3FF80000.
    expect(decodeRkNumber(0x3ff80000)).toBe(1.5);
  });

  it("decodes a negative float payload", () => {
    // -1.5 is 0xBFF8000000000000. The word's own top bit is the double's sign bit, so this must be assembled unsigned rather than through a signed shift.
    expect(decodeRkNumber(0xbff80000)).toBe(-1.5);
  });

  it("divides a float payload by 100 when fX100 is set", () => {
    // 0x40590000 is the top 32 bits of 100.0 (0x4059000000000000); with fX100 set the value is 1.
    expect(decodeRkNumber(0x40590000 | 0x01)).toBe(1);
  });

  it("decodes a float payload whose flag bits would otherwise corrupt the mantissa", () => {
    // The two flag bits occupy the double's own bits 32 and 33, which MUST be zero, so masking them off is what recovers the original value rather than a value 1-3 ULPs away.
    expect(decodeRkNumber((0x3ff80000 | 0x02) & ~0x03)).toBe(1.5);
  });
});
