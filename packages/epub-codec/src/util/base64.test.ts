import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

describe("bytesToBase64 / base64ToBytes", () => {
  it("round-trips arbitrary binary content", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips a length not a multiple of 3", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips an empty array", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(
      new Uint8Array(0),
    );
  });

  it("produces standard base64 padding", () => {
    expect(bytesToBase64(new TextEncoder().encode("a"))).toBe("YQ==");
    expect(bytesToBase64(new TextEncoder().encode("ab"))).toBe("YWI=");
    expect(bytesToBase64(new TextEncoder().encode("abc"))).toBe("YWJj");
  });

  it("throws when a padding character appears where a data character is required", () => {
    expect(() => base64ToBytes("A===")).toThrow("invalid base64 input");
  });
});
