import { describe, expect, it } from "vitest";
import { crc32 } from "./crc32";

// The published CRC-32/ISO-HDLC check values (the same polynomial PNG chunks and ZIP entries use), taken from the algorithm's own standard test vectors rather than from this implementation's output -- so they pin the table generation and the fold loop against an external definition, not against themselves.
describe("crc32 against the standard CRC-32/ISO-HDLC check values", () => {
  it("returns the identity value 0 for empty input, since the initial and final complements cancel", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('computes the algorithm\'s canonical check value for "123456789"', () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("computes the published value for a single zero byte", () => {
    expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d);
  });

  it("computes the published value for a single high-bit byte, exercising the table's top entries", () => {
    expect(crc32(new Uint8Array([0xff]))).toBe(0xff000000);
  });

  it('computes the published value for "a"', () => {
    expect(crc32(new TextEncoder().encode("a"))).toBe(0xe8b7be43);
  });

  it('computes the published value for "The quick brown fox jumps over the lazy dog"', () => {
    expect(
      crc32(
        new TextEncoder().encode("The quick brown fox jumps over the lazy dog"),
      ),
    ).toBe(0x414fa339);
  });

  it("is order-sensitive: the same bytes in a different order hash differently", () => {
    expect(crc32(new Uint8Array([1, 2, 3, 4]))).not.toBe(
      crc32(new Uint8Array([4, 3, 2, 1])),
    );
  });

  it("returns an unsigned 32-bit value even when the folded result has its top bit set", () => {
    // 0xff000000 has the sign bit set, so an implementation that skipped the final `>>> 0` would return a negative number here.
    const result = crc32(new Uint8Array([0xff]));
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("distinguishes every single-byte input, proving all 256 table entries are distinct", () => {
    const seen = new Set<number>();
    for (let byte = 0; byte < 256; byte++) {
      seen.add(crc32(new Uint8Array([byte])));
    }
    expect(seen.size).toBe(256);
  });
});
