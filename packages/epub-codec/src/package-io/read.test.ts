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

// Mirrors read.ts's own private looksLikeXml constants (BOM bytes, whitespace bytes, and '<') so these fixtures stay tied to the sniff's real byte values rather than restating them as independent literals.
const UTF8_BOM_BYTE_0 = 0xef;
const UTF8_BOM_BYTE_1 = 0xbb;
const UTF8_BOM_BYTE_2 = 0xbf;
const WHITESPACE_SPACE = 0x20;
const WHITESPACE_TAB = 0x09;
const WHITESPACE_LF = 0x0a;
const WHITESPACE_CR = 0x0d;
const XML_LESS_THAN = 0x3c;
// The first four bytes of a PNG signature: an arbitrary non-'<' prefix standing in for any binary format.
const PNG_SIG_HIGH_BIT_MARKER = 0x89;
const PNG_SIG_P = 0x50;
const PNG_SIG_N = 0x4e;
const PNG_SIG_G = 0x47;
const PNG_SIG_PREFIX = [
  PNG_SIG_HIGH_BIT_MARKER,
  PNG_SIG_P,
  PNG_SIG_N,
  PNG_SIG_G,
];
const WRONG_BOM_BYTE = 0x00;
// 'A': an arbitrary non-whitespace, non-'<' byte.
const NON_XML_LEADING_BYTE = 0x41;
// The first two bytes of a PNG signature, standing in for arbitrary binary content whose exact bytes don't matter beyond round-tripping through base64.
const PNG_SIG_SAMPLE = [PNG_SIG_HIGH_BIT_MARKER, PNG_SIG_P];
// 'a': an arbitrary single byte for a part whose content doesn't matter, only its key.
const ARBITRARY_BYTE = 0x61;

describe("packageFromEntries classification (looksLikeXml)", () => {
  it("classifies a plain XML declaration as xml", () => {
    expect(kindOf(utf8('<?xml version="1.0"?><a/>'))).toBe("xml");
  });

  it("classifies bytes with no leading '<' as binary", () => {
    expect(kindOf(bytes(...PNG_SIG_PREFIX))).toBe("binary");
  });

  it("classifies an empty part as binary", () => {
    expect(kindOf(bytes())).toBe("binary");
  });

  it("classifies a part that is only whitespace, with no '<' ever, as binary", () => {
    expect(
      kindOf(
        bytes(
          WHITESPACE_SPACE,
          WHITESPACE_TAB,
          WHITESPACE_LF,
          WHITESPACE_CR,
          WHITESPACE_SPACE,
        ),
      ),
    ).toBe("binary");
  });

  it("skips a leading UTF-8 BOM before finding '<'", () => {
    const withBom = new Uint8Array([
      UTF8_BOM_BYTE_0,
      UTF8_BOM_BYTE_1,
      UTF8_BOM_BYTE_2,
      ...utf8("<a/>"),
    ]);
    expect(kindOf(withBom)).toBe("xml");
  });

  it("does not treat a two-byte prefix as a BOM (needs all three bytes)", () => {
    // Only 2 bytes total: the length guard must reject this before indexing byte 2.
    expect(kindOf(bytes(UTF8_BOM_BYTE_0, UTF8_BOM_BYTE_1))).toBe("binary");
  });

  it("does not recognise a BOM whose first byte is wrong", () => {
    expect(
      kindOf(
        bytes(WRONG_BOM_BYTE, UTF8_BOM_BYTE_1, UTF8_BOM_BYTE_2, XML_LESS_THAN),
      ),
    ).toBe("binary");
  });

  it("does not recognise a BOM whose second byte is wrong", () => {
    expect(
      kindOf(
        bytes(UTF8_BOM_BYTE_0, WRONG_BOM_BYTE, UTF8_BOM_BYTE_2, XML_LESS_THAN),
      ),
    ).toBe("binary");
  });

  it("does not recognise a BOM whose third byte is wrong", () => {
    expect(
      kindOf(
        bytes(UTF8_BOM_BYTE_0, UTF8_BOM_BYTE_1, WRONG_BOM_BYTE, XML_LESS_THAN),
      ),
    ).toBe("binary");
  });

  it("returns binary when a real BOM is immediately followed by end of input", () => {
    expect(
      kindOf(bytes(UTF8_BOM_BYTE_0, UTF8_BOM_BYTE_1, UTF8_BOM_BYTE_2)),
    ).toBe("binary");
  });

  it("skips a leading space before '<'", () => {
    expect(kindOf(new Uint8Array([WHITESPACE_SPACE, ...utf8("<a/>")]))).toBe(
      "xml",
    );
  });

  it("skips a leading tab before '<'", () => {
    expect(kindOf(new Uint8Array([WHITESPACE_TAB, ...utf8("<a/>")]))).toBe(
      "xml",
    );
  });

  it("skips a leading line feed before '<'", () => {
    expect(kindOf(new Uint8Array([WHITESPACE_LF, ...utf8("<a/>")]))).toBe(
      "xml",
    );
  });

  it("skips a leading carriage return before '<'", () => {
    expect(kindOf(new Uint8Array([WHITESPACE_CR, ...utf8("<a/>")]))).toBe(
      "xml",
    );
  });

  it("treats a non-whitespace, non-'<' leading byte as binary immediately", () => {
    expect(kindOf(bytes(NON_XML_LEADING_BYTE))).toBe("binary");
  });

  it("stores a binary part as base64", () => {
    const result = packageFromEntries({
      "img.png": bytes(...PNG_SIG_SAMPLE),
    });
    const part = result.parts["img.png"];
    expect(part?.kind).toBe("binary");
    if (part?.kind === "binary") {
      expect(part.base64).toBe(Buffer.from(PNG_SIG_SAMPLE).toString("base64"));
    }
  });

  it("parses an xml part into its own node tree", () => {
    const result = packageFromEntries({ "a.opf": utf8("<root/>") });
    const part = result.parts["a.opf"];
    expect(part?.kind).toBe("xml");
  });

  it("returns one part per entry, keyed by its own path", () => {
    const result = packageFromEntries({
      mimetype: bytes(ARBITRARY_BYTE),
      "OEBPS/content.opf": utf8("<root/>"),
    });
    expect(Object.keys(result.parts).sort()).toEqual([
      "OEBPS/content.opf",
      "mimetype",
    ]);
  });
});
