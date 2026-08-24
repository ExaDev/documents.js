import { describe, expect, it } from "vitest";
import { isCompoundFile } from "./detect";
import { detectArchiveFormat } from "../zip/detect";

// Detection of the classic OLE compound-file signature ([MS-CFB] header bytes D0 CF 11 E0 A1 B1 1A E1) -- the leading magic of every legacy OLE payload (.doc, .xls, .ppt, and the word|ppt/embeddings/oleObject1.bin spelling of an OOXML-embedded object). A byte check, never a parse-and-catch: it says "these bytes start a compound file", not "these bytes are a well-formed one" (structural validation is readCompoundFile's job).

describe("isCompoundFile", () => {
  it("accepts bytes carrying the OLE/CFB signature", () => {
    const bytes = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
    ]);
    expect(isCompoundFile(bytes)).toBe(true);
  });

  it("rejects bytes shorter than the signature", () => {
    expect(isCompoundFile(new Uint8Array([0xd0, 0xcf, 0x11]))).toBe(false);
  });

  it("rejects a non-CFB prefix (including the ZIP signature)", () => {
    expect(isCompoundFile(new TextEncoder().encode("plain text"))).toBe(false);
    expect(isCompoundFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(
      false,
    );
  });

  it("requires the signature at offset zero, not merely somewhere in the bytes", () => {
    const shifted = new Uint8Array([
      0x00, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(isCompoundFile(shifted)).toBe(false);
  });
});

describe("detectArchiveFormat", () => {
  it("reports cfb for compound-file bytes and unknown for anything else", () => {
    expect(
      detectArchiveFormat(
        new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      ),
    ).toBe("cfb");
    expect(detectArchiveFormat(new TextEncoder().encode("nope"))).toBe(
      "unknown",
    );
  });
});
