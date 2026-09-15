import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes } from "./base64";

describe("bytesToBase64", () => {
  it("pads with two '=' for a length not divisible by 3 with one trailing byte", () => {
    // "Ma==" is the canonical base64 of the single byte 0x4d ("M").
    expect(bytesToBase64(Uint8Array.from([0x4d]))).toBe("TQ==");
  });

  it("pads with one '=' for a length not divisible by 3 with two trailing bytes", () => {
    // "TWE=" is the canonical base64 of the two bytes "Ma".
    expect(bytesToBase64(Uint8Array.from([0x4d, 0x61]))).toBe("TWE=");
  });

  it("pads with nothing for a length exactly divisible by 3", () => {
    // "Man" encodes to "TWFu" with no padding at all.
    expect(bytesToBase64(Uint8Array.from([0x4d, 0x61, 0x6e]))).toBe("TWFu");
  });

  it("does not read past the input on the last group of three", () => {
    // Six bytes is two whole groups of three; a loop reading one byte too far would append a spurious fourth group of padding-only characters.
    expect(
      bytesToBase64(Uint8Array.from([0x4d, 0x61, 0x6e, 0x4d, 0x61, 0x6e])),
    ).toBe("TWFuTWFu");
  });

  it("encodes an empty input as an empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("base64ToBytes", () => {
  it("decodes a real multi-character base64 string back to its exact bytes", () => {
    expect(base64ToBytes("TWFu")).toEqual(Uint8Array.from([0x4d, 0x61, 0x6e]));
  });

  it("decodes a base64 string with two padding characters back to one byte", () => {
    expect(base64ToBytes("TQ==")).toEqual(Uint8Array.from([0x4d]));
  });

  it("decodes a base64 string with one padding character back to two bytes", () => {
    expect(base64ToBytes("TWE=")).toEqual(Uint8Array.from([0x4d, 0x61]));
  });

  it("round-trips every byte value through encode then decode", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("skips whitespace and padding characters rather than rejecting them", () => {
    expect(base64ToBytes("TWFu\n")).toEqual(
      Uint8Array.from([0x4d, 0x61, 0x6e]),
    );
  });

  it("returns undefined for a character outside the base64 alphabet", () => {
    expect(base64ToBytes("T!Fu")).toBeUndefined();
  });
});

describe("bytesToHex", () => {
  it("encodes every byte as two lowercase hex digits", () => {
    expect(bytesToHex(Uint8Array.from([0x00, 0x0f, 0xff, 0xab]))).toBe(
      "000fffab",
    );
  });
});

describe("hexToBytes", () => {
  it("decodes a run of hex digits into their bytes", () => {
    expect(hexToBytes("000fffab")).toEqual(
      Uint8Array.from([0x00, 0x0f, 0xff, 0xab]),
    );
  });

  it("skips whitespace inserted for RTF's own line-wrapping advice", () => {
    expect(hexToBytes("00 0f\r\nff ab")).toEqual(
      Uint8Array.from([0x00, 0x0f, 0xff, 0xab]),
    );
  });

  it("skips a non-hex character rather than rejecting it or treating it as a digit", () => {
    expect(hexToBytes("00zzffab")).toEqual(Uint8Array.from([0x00, 0xff, 0xab]));
  });

  it("drops a trailing unpaired hex digit rather than padding it into a byte", () => {
    expect(hexToBytes("000fa")).toEqual(Uint8Array.from([0x00, 0x0f]));
  });

  it("is case-insensitive", () => {
    expect(hexToBytes("AaBbCcDdEeFf")).toEqual(
      Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
    );
  });
});
