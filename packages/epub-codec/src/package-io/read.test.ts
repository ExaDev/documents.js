import { describe, expect, it } from "vitest";
import { packageFromEntries } from "./read";

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function bytes(...values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

function kindOf(entryBytes: Uint8Array<ArrayBuffer>): "xml" | "binary" {
  const result = packageFromEntries({ part: entryBytes });
  return result.parts.part?.kind ?? "binary";
}

describe("packageFromEntries classification (looksLikeXml)", () => {
  it("classifies a plain XML declaration as xml", () => {
    expect(kindOf(utf8('<?xml version="1.0"?><a/>'))).toBe("xml");
  });

  it("classifies bytes with no leading '<' as binary", () => {
    expect(kindOf(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("binary");
  });

  it("classifies an empty part as binary", () => {
    expect(kindOf(bytes())).toBe("binary");
  });

  it("classifies a part that is only whitespace, with no '<' ever, as binary", () => {
    expect(kindOf(bytes(0x20, 0x09, 0x0a, 0x0d, 0x20))).toBe("binary");
  });

  it("skips a leading UTF-8 BOM before finding '<'", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("<a/>")]);
    expect(kindOf(withBom)).toBe("xml");
  });

  it("does not treat a two-byte prefix as a BOM (needs all three bytes)", () => {
    // Only 2 bytes total: the length guard must reject this before indexing byte 2.
    expect(kindOf(bytes(0xef, 0xbb))).toBe("binary");
  });

  it("does not recognise a BOM whose first byte is wrong", () => {
    expect(kindOf(bytes(0x00, 0xbb, 0xbf, 0x3c))).toBe("binary");
  });

  it("does not recognise a BOM whose second byte is wrong", () => {
    expect(kindOf(bytes(0xef, 0x00, 0xbf, 0x3c))).toBe("binary");
  });

  it("does not recognise a BOM whose third byte is wrong", () => {
    expect(kindOf(bytes(0xef, 0xbb, 0x00, 0x3c))).toBe("binary");
  });

  it("returns binary when a real BOM is immediately followed by end of input", () => {
    expect(kindOf(bytes(0xef, 0xbb, 0xbf))).toBe("binary");
  });

  it("skips a leading space before '<'", () => {
    expect(kindOf(new Uint8Array([0x20, ...utf8("<a/>")]))).toBe("xml");
  });

  it("skips a leading tab before '<'", () => {
    expect(kindOf(new Uint8Array([0x09, ...utf8("<a/>")]))).toBe("xml");
  });

  it("skips a leading line feed before '<'", () => {
    expect(kindOf(new Uint8Array([0x0a, ...utf8("<a/>")]))).toBe("xml");
  });

  it("skips a leading carriage return before '<'", () => {
    expect(kindOf(new Uint8Array([0x0d, ...utf8("<a/>")]))).toBe("xml");
  });

  it("treats a non-whitespace, non-'<' leading byte as binary immediately", () => {
    expect(kindOf(bytes(0x41))).toBe("binary");
  });

  it("stores a binary part as base64", () => {
    const result = packageFromEntries({ "img.png": bytes(0x89, 0x50) });
    const part = result.parts["img.png"];
    expect(part?.kind).toBe("binary");
    if (part?.kind === "binary") {
      expect(part.base64).toBe(Buffer.from([0x89, 0x50]).toString("base64"));
    }
  });

  it("parses an xml part into its own node tree", () => {
    const result = packageFromEntries({ "a.opf": utf8("<root/>") });
    const part = result.parts["a.opf"];
    expect(part?.kind).toBe("xml");
  });

  it("returns one part per entry, keyed by its own path", () => {
    const result = packageFromEntries({
      mimetype: bytes(0x61),
      "OEBPS/content.opf": utf8("<root/>"),
    });
    expect(Object.keys(result.parts).sort()).toEqual([
      "OEBPS/content.opf",
      "mimetype",
    ]);
  });
});
