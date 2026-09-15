import { describe, expect, it } from "vitest";
import { randomBytes } from "./random";

describe("randomBytes", () => {
  it("returns a buffer of exactly the requested length", () => {
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(0).length).toBe(0);
  });

  it("actually fills the buffer from the CSPRNG rather than leaving it zeroed", () => {
    // 32 bytes of true zero from a CSPRNG has a chance of roughly 1 in 2^256 -- indistinguishable from zero for test purposes, so this reliably catches a no-op stand-in for the real getRandomValues call.
    const bytes = randomBytes(32);
    expect(bytes.some((b) => b !== 0)).toBe(true);
  });

  it("does not return the same bytes on successive calls", () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
