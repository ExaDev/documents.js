import { describe, expect, it } from "vitest";
import { isDocBytes, WORD_DOCUMENT_STREAM } from "./detect";
import { compoundFile } from "./test-support/cfb";
import { buildDoc } from "./test-support/doc";

describe("isDocBytes", () => {
  it("recognises a genuine Word Binary File", () => {
    const doc = buildDoc({ paragraphs: [{ runs: [{ text: "Hello" }] }] });
    expect(isDocBytes(doc)).toBe(true);
  });

  it("rejects bytes with no compound-file signature at all", () => {
    expect(isDocBytes(new TextEncoder().encode("not a compound file"))).toBe(
      false,
    );
  });

  it("rejects an empty byte array", () => {
    expect(isDocBytes(new Uint8Array(0))).toBe(false);
  });

  it("rejects a genuine compound file with the signature but too short to hold a real header", () => {
    // The 8-byte magic alone, with no header behind it -- readCompoundFile throws for this, and isDocBytes reports it as "not a .doc" rather than propagating the parse error.
    const magic = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(isDocBytes(magic)).toBe(false);
  });

  it("rejects a well-formed compound file that carries no WordDocument stream at all", () => {
    const notADoc = compoundFile([
      { path: "SomeOtherStream", bytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect(isDocBytes(notADoc)).toBe(false);
  });

  it("rejects a WordDocument stream one byte too short to hold even the FIB's own 2-byte wIdent", () => {
    const tooShort = compoundFile([
      { path: WORD_DOCUMENT_STREAM, bytes: new Uint8Array([0xec]) },
    ]);
    expect(isDocBytes(tooShort)).toBe(false);
  });

  it("accepts a WordDocument stream of exactly 2 bytes when those two bytes are the real FIB signature", () => {
    const minimal = compoundFile([
      // 0xA5EC little-endian -- the exact FIB_W_IDENT this function checks for.
      { path: WORD_DOCUMENT_STREAM, bytes: new Uint8Array([0xec, 0xa5]) },
    ]);
    expect(isDocBytes(minimal)).toBe(true);
  });

  it("rejects a WordDocument stream of exactly 2 bytes whose signature does not match", () => {
    const wrongSignature = compoundFile([
      { path: WORD_DOCUMENT_STREAM, bytes: new Uint8Array([0x00, 0x00]) },
    ]);
    expect(isDocBytes(wrongSignature)).toBe(false);
  });
});
