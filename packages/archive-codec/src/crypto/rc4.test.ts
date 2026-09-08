import { describe, expect, it } from "vitest";
import { rc4 } from "./rc4";

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

describe("rc4", () => {
  // The widely-published RC4 test vectors (key/plaintext/ciphertext triples that predate any specific implementation, cross-checked here against an independent Python RC4 written from scratch for this check, not against this package's own code).
  it.each([
    ["Key", "Plaintext", "bbf316e8d940af0ad3"],
    ["Wiki", "pedia", "1021bf0420"],
    ["Secret", "Attack at dawn", "45a01f645fc35b383552544b9bf5"],
  ])("encrypts %j under key %j to %s", (key, plaintext, expected) => {
    expect(toHex(rc4(ascii(key), ascii(plaintext)))).toBe(expected);
  });

  it("is its own inverse (decrypting a ciphertext with the same key recovers the plaintext)", () => {
    const key = ascii("a shared secret");
    const plaintext = ascii("round-trip this exact byte sequence");
    const ciphertext = rc4(key, plaintext);
    expect(rc4(key, ciphertext)).toEqual(plaintext);
  });

  it("returns the input unchanged for an empty key rather than dividing by zero", () => {
    const data = ascii("unchanged");
    expect(rc4(new Uint8Array(0), data)).toEqual(data);
  });
});
