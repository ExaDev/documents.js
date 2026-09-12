import { describe, expect, it } from "vitest";
import { appendBytes, asciiStringFromBytes, rtfBytesFromLatin1 } from "./bytes";
import { RtfParseError } from "./diagnostics";

describe("asciiStringFromBytes", () => {
  it("converts a short byte run to its ASCII string", () => {
    expect(asciiStringFromBytes(Uint8Array.from([0x41, 0x42, 0x43]))).toBe(
      "ABC",
    );
  });

  it("does not drop or duplicate bytes at the chunk boundary", () => {
    // ASCII_CHUNK_SIZE is 8192; one byte either side of that boundary is exactly where an off-by-one in the chunking loop would show up.
    const length = 8193;
    const input = Uint8Array.from(
      { length },
      (_, index) => 0x30 + (index % 10),
    );
    const expected = Array.from(input, (byte) =>
      String.fromCharCode(byte),
    ).join("");
    expect(asciiStringFromBytes(input)).toBe(expected);
  });

  it("converts an empty input to an empty string", () => {
    expect(asciiStringFromBytes(new Uint8Array(0))).toBe("");
  });
});

describe("appendBytes", () => {
  it("appends every byte of the input onto the target array, in order", () => {
    const target = [0x01];
    appendBytes(target, Uint8Array.from([0x02, 0x03, 0x04]));
    expect(target).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it("appends nothing for an empty input", () => {
    const target = [0x01];
    appendBytes(target, new Uint8Array(0));
    expect(target).toEqual([0x01]);
  });
});

describe("rtfBytesFromLatin1", () => {
  it("converts every character to its own byte, one code unit per byte", () => {
    expect(rtfBytesFromLatin1("ABC")).toEqual(
      Uint8Array.from([0x41, 0x42, 0x43]),
    );
  });

  it("converts a code unit at the U+00FF boundary without throwing", () => {
    expect(rtfBytesFromLatin1("ÿ")).toEqual(Uint8Array.from([0xff]));
  });

  it("converts an empty string to an empty byte array", () => {
    expect(rtfBytesFromLatin1("")).toEqual(new Uint8Array(0));
  });

  it("throws a named, coded RtfParseError for a code unit above U+00FF", () => {
    let caught: unknown;
    try {
      rtfBytesFromLatin1("Ā");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RtfParseError);
    const error = caught as RtfParseError;
    expect(error.code).toBe("rtf/not-byte-preserving-string");
    expect(error.message).toBe(
      "character at index 0 is U+0100, above U+00FF: this string was decoded through a multi-byte encoding and no longer holds the file's bytes. Read the .rtf file as bytes and pass the Uint8Array directly.",
    );
  });

  it("names the actual index of the offending character, not always 0", () => {
    let caught: unknown;
    try {
      rtfBytesFromLatin1("ABĀ");
    } catch (error) {
      caught = error;
    }
    expect((caught as RtfParseError).message).toContain("index 2");
  });

  it("upper-cases the hex code point in the message", () => {
    let caught: unknown;
    try {
      rtfBytesFromLatin1("ƫ");
    } catch (error) {
      caught = error;
    }
    expect((caught as RtfParseError).message).toContain("U+01AB");
  });
});
