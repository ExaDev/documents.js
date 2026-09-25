import { describe, expect, it } from "vitest";
import { packageFromEntries } from "./read";

// looksLikeXml itself is private; every case below drives it indirectly through packageFromEntries's own kind: "xml" vs kind: "binary" classification, which is exactly the observable effect the function exists to produce.

// UTF-8 BOM bytes (EF BB BF), named individually because several cases below corrupt exactly one of the three at a time, proving each byte's own comparison is load-bearing in the BOM-skip logic rather than the check succeeding on a partial match.
const UTF8_BOM_FIRST_BYTE = 0xef;
const UTF8_BOM_SECOND_BYTE = 0xbb;
const UTF8_BOM_THIRD_BYTE = 0xbf;

// XML whitespace bytes permitted before the root element, per XML 1.0's own S production (referenced by ECMA-376): space, tab, line feed, carriage return.
const XML_WHITESPACE_SPACE = 0x20;
const XML_WHITESPACE_TAB = 0x09;
const XML_WHITESPACE_LF = 0x0a;
const XML_WHITESPACE_CR = 0x0d;

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

describe("packageFromEntries: XML classification", () => {
  it("classifies a part starting directly with '<' as xml", () => {
    const result = packageFromEntries({ "a.xml": enc("<a/>") });
    expect(result.parts["a.xml"]?.kind).toBe("xml");
  });

  it("classifies a part starting with a UTF-8 BOM then '<' as xml, skipping exactly the three BOM bytes", () => {
    const bytes = new Uint8Array([
      UTF8_BOM_FIRST_BYTE,
      UTF8_BOM_SECOND_BYTE,
      UTF8_BOM_THIRD_BYTE,
      ...enc("<a/>"),
    ]);
    const result = packageFromEntries({ "a.xml": bytes });
    expect(result.parts["a.xml"]?.kind).toBe("xml");
  });

  it("classifies a part starting with leading whitespace then '<' as xml, for every individual whitespace byte ECMA-376 permits", () => {
    for (const ws of [
      XML_WHITESPACE_SPACE,
      XML_WHITESPACE_TAB,
      XML_WHITESPACE_LF,
      XML_WHITESPACE_CR,
    ]) {
      const bytes = new Uint8Array([ws, ...enc("<a/>")]);
      const result = packageFromEntries({ "a.xml": bytes });
      expect(result.parts["a.xml"]?.kind).toBe("xml");
    }
  });

  it("classifies a part starting with several whitespace bytes in a row then '<' as xml, proving the skip loop actually advances past each one rather than only the first", () => {
    const bytes = new Uint8Array([
      XML_WHITESPACE_SPACE,
      XML_WHITESPACE_SPACE,
      XML_WHITESPACE_TAB,
      XML_WHITESPACE_LF,
      ...enc("<a/>"),
    ]);
    const result = packageFromEntries({ "a.xml": bytes });
    expect(result.parts["a.xml"]?.kind).toBe("xml");
  });

  it("classifies a UTF-8 BOM immediately followed by leading whitespace then '<' as xml", () => {
    const bytes = new Uint8Array([
      UTF8_BOM_FIRST_BYTE,
      UTF8_BOM_SECOND_BYTE,
      UTF8_BOM_THIRD_BYTE,
      XML_WHITESPACE_SPACE,
      ...enc("<a/>"),
    ]);
    const result = packageFromEntries({ "a.xml": bytes });
    expect(result.parts["a.xml"]?.kind).toBe("xml");
  });
});

describe("packageFromEntries: binary classification", () => {
  it("classifies an empty part as binary (there is no '<' to find)", () => {
    const result = packageFromEntries({ "empty.bin": new Uint8Array([]) });
    expect(result.parts["empty.bin"]?.kind).toBe("binary");
  });

  it("classifies a part that is entirely whitespace, with no non-whitespace byte at all, as binary", () => {
    const result = packageFromEntries({
      "ws.bin": new Uint8Array([
        XML_WHITESPACE_SPACE,
        XML_WHITESPACE_SPACE,
        XML_WHITESPACE_SPACE,
      ]),
    });
    expect(result.parts["ws.bin"]?.kind).toBe("binary");
  });

  it("classifies a genuine PNG signature as binary", () => {
    // The 8-byte PNG file signature (PNG spec section 5.2): a byte with the high bit set to catch 7-bit transmission paths that strip it, the ASCII text "PNG", a CR LF pair to detect line-ending translation corrupting the file, a control-Z to stop a naive DOS "type" of the file, and a final LF to detect the inverse (LF-to-CRLF) translation problem.
    const PNG_HIGH_BIT_BYTE = 0x89;
    const PNG_TEXT_P = 0x50;
    const PNG_TEXT_N = 0x4e;
    const PNG_TEXT_G = 0x47;
    const PNG_LINE_ENDING_CR = 0x0d;
    const PNG_LINE_ENDING_LF = 0x0a;
    const PNG_DOS_EOF_CONTROL_Z = 0x1a;
    const PNG_TRAILING_LF = 0x0a;
    const png = new Uint8Array([
      PNG_HIGH_BIT_BYTE,
      PNG_TEXT_P,
      PNG_TEXT_N,
      PNG_TEXT_G,
      PNG_LINE_ENDING_CR,
      PNG_LINE_ENDING_LF,
      PNG_DOS_EOF_CONTROL_Z,
      PNG_TRAILING_LF,
    ]);
    const result = packageFromEntries({ "a.png": png });
    expect(result.parts["a.png"]?.kind).toBe("binary");
  });

  it("classifies a part whose first three bytes only partially match the UTF-8 BOM as binary, isolating each BOM byte's own necessity", () => {
    // Each variant corrupts exactly one of the three real BOM bytes while leaving the other two correct and a real '<' immediately after — if any single byte's own comparison were dropped from the BOM check, one of these three would be misclassified as xml instead. The corrupted byte is 0x00, which needs no name of its own: it isn't standing in for anything, it's simply "not the real BOM byte here".
    const wrongFirst = new Uint8Array([
      0x00,
      UTF8_BOM_SECOND_BYTE,
      UTF8_BOM_THIRD_BYTE,
      ...enc("<a/>"),
    ]);
    const wrongSecond = new Uint8Array([
      UTF8_BOM_FIRST_BYTE,
      0x00,
      UTF8_BOM_THIRD_BYTE,
      ...enc("<a/>"),
    ]);
    const wrongThird = new Uint8Array([
      UTF8_BOM_FIRST_BYTE,
      UTF8_BOM_SECOND_BYTE,
      0x00,
      ...enc("<a/>"),
    ]);
    for (const bytes of [wrongFirst, wrongSecond, wrongThird]) {
      const result = packageFromEntries({ "a.bin": bytes });
      expect(result.parts["a.bin"]?.kind).toBe("binary");
    }
  });

  it("classifies a part shorter than a full BOM (one or two bytes) as binary when none of them is '<'", () => {
    expect(
      packageFromEntries({ "a.bin": new Uint8Array([UTF8_BOM_FIRST_BYTE]) })
        .parts["a.bin"]?.kind,
    ).toBe("binary");
    expect(
      packageFromEntries({
        "a.bin": new Uint8Array([UTF8_BOM_FIRST_BYTE, UTF8_BOM_SECOND_BYTE]),
      }).parts["a.bin"]?.kind,
    ).toBe("binary");
  });
});
