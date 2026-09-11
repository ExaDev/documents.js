import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";

// Direct unit coverage for the RFC 4648 base64 encoder, isolated from the image/OLE integration tests that only ever exercise it indirectly through a real embedded payload.
describe("bytesToBase64", () => {
  it("encodes an empty buffer as an empty string", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  it("encodes a length divisible by three with no padding", () => {
    // "Man" -> "TWFu", the canonical RFC 4648 example.
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe("TWFu");
  });

  it("encodes exactly one trailing byte with two padding characters", () => {
    // "M" -> "TQ==".
    expect(bytesToBase64(new Uint8Array([0x4d]))).toBe("TQ==");
  });

  it("encodes exactly two trailing bytes with one padding character", () => {
    // "Ma" -> "TWE=".
    expect(bytesToBase64(new Uint8Array([0x4d, 0x61]))).toBe("TWE=");
  });

  it("uses every character of the alphabet across its full input range", () => {
    // 0x00 through 0xff, 256 bytes: exercises b0/b1/b2 across every 6-bit slice value at least once, so a truncated or wrong alphabet index cannot go unnoticed the way a single short input would.
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i;
    }
    const encoded = bytesToBase64(bytes);
    expect(encoded).toHaveLength(344);
    // Cross-check against the platform's own base64 decoder rather than a second hand-rolled implementation.
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
