import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

function bytesOfAscii(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
}

// The classic Wikipedia "Man"/"Many hands..." progressive vectors, computed via Node's own Buffer.from(s, "utf8").toString("base64"): one entry per length mod 4 (0, 1, 2, 3 leftover bytes) so every branch of bytesToBase64's per-3-byte padding logic gets a case where it is exercised both true and false.
const KNOWN_VECTORS: readonly [string, string][] = [
  ["", ""],
  ["M", "TQ=="],
  ["Ma", "TWE="],
  ["Man", "TWFu"],
  ["Many", "TWFueQ=="],
  ["Many ", "TWFueSA="],
  ["Many h", "TWFueSBo"],
  ["Many ha", "TWFueSBoYQ=="],
  ["Many han", "TWFueSBoYW4="],
  ["Many hand", "TWFueSBoYW5k"],
];

describe("bytesToBase64", () => {
  it.each(KNOWN_VECTORS)("encodes %j to %j", (text, expected) => {
    expect(bytesToBase64(bytesOfAscii(text))).toBe(expected);
  });
});

describe("base64ToBytes", () => {
  it.each(KNOWN_VECTORS)(
    "decodes %2$j back to the bytes of %1$j",
    (text, encoded) => {
      expect(base64ToBytes(encoded)).toEqual(bytesOfAscii(text));
    },
  );

  it("strips whitespace interspersed in the input before decoding", () => {
    expect(base64ToBytes("TW Fu\n")).toEqual(bytesOfAscii("Man"));
  });

  it("throws when a '=' padding character appears in the first position of a 4-char group", () => {
    expect(() => base64ToBytes("=BCD")).toThrow("invalid base64 input");
  });

  it("throws when a '=' padding character appears in the second position of a 4-char group", () => {
    expect(() => base64ToBytes("A=CD")).toThrow("invalid base64 input");
  });

  it("bounds a malformed, non-4-multiple-length input to its declared scratch size rather than growing to fit it", () => {
    // clean.length here is 5, one char short of a second full 4-char group: the loop's second iteration reads two out-of-range indices via charCodeAt (NaN, decoding to a byte anyway) and would write a 4th, 5th and 6th output byte past the 3-byte buffer ((5*3)/4|0 == 3) this input's own length declares, a Uint8Array silently drops writes past its own length rather than growing, so the result is exactly the first full group's 3 bytes, not whatever the malformed second group's partial contents happen to decode to.
    expect(base64ToBytes("TWFuT")).toEqual(bytesOfAscii("Man"));
  });
});
