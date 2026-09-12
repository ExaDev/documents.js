import { describe, expect, it } from "vitest";
import { packageFromEntries } from "./read";

// looksLikeXml itself is private; every case below drives it indirectly through packageFromEntries's own kind: "xml" vs kind: "binary" classification, which is exactly the observable effect the function exists to produce.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

describe("packageFromEntries: XML classification", () => {
  it("classifies a part starting directly with '<' as xml", () => {
    const result = packageFromEntries({ "a.xml": enc("<a/>") });
    expect(result.parts["a.xml"]?.kind).toBe("xml");
  });

  it("classifies a part starting with a UTF-8 BOM then '<' as xml, skipping exactly the three BOM bytes", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("<a/>")]);
    const result = packageFromEntries({ "a.xml": bytes });
    expect(result.parts["a.xml"]?.kind).toBe("xml");
  });

  it("classifies a part starting with leading whitespace then '<' as xml, for every individual whitespace byte ECMA-376 permits", () => {
    for (const ws of [0x20, 0x09, 0x0a, 0x0d]) {
      const bytes = new Uint8Array([ws, ...enc("<a/>")]);
      const result = packageFromEntries({ "a.xml": bytes });
      expect(result.parts["a.xml"]?.kind).toBe("xml");
    }
  });

  it("classifies a part starting with several whitespace bytes in a row then '<' as xml, proving the skip loop actually advances past each one rather than only the first", () => {
    const bytes = new Uint8Array([0x20, 0x20, 0x09, 0x0a, ...enc("<a/>")]);
    const result = packageFromEntries({ "a.xml": bytes });
    expect(result.parts["a.xml"]?.kind).toBe("xml");
  });

  it("classifies a UTF-8 BOM immediately followed by leading whitespace then '<' as xml", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x20, ...enc("<a/>")]);
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
      "ws.bin": new Uint8Array([0x20, 0x20, 0x20]),
    });
    expect(result.parts["ws.bin"]?.kind).toBe("binary");
  });

  it("classifies a genuine PNG signature as binary", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const result = packageFromEntries({ "a.png": png });
    expect(result.parts["a.png"]?.kind).toBe("binary");
  });

  it("classifies a part whose first three bytes only partially match the UTF-8 BOM as binary, isolating each BOM byte's own necessity", () => {
    // Each variant corrupts exactly one of the three real BOM bytes (0xef, 0xbb, 0xbf) while leaving the other two correct and a real '<' immediately after -- if any single byte's own comparison were dropped from the BOM check, one of these three would be misclassified as xml instead.
    const wrongFirst = new Uint8Array([0x00, 0xbb, 0xbf, ...enc("<a/>")]);
    const wrongSecond = new Uint8Array([0xef, 0x00, 0xbf, ...enc("<a/>")]);
    const wrongThird = new Uint8Array([0xef, 0xbb, 0x00, ...enc("<a/>")]);
    for (const bytes of [wrongFirst, wrongSecond, wrongThird]) {
      const result = packageFromEntries({ "a.bin": bytes });
      expect(result.parts["a.bin"]?.kind).toBe("binary");
    }
  });

  it("classifies a part shorter than a full BOM (one or two bytes) as binary when none of them is '<'", () => {
    expect(
      packageFromEntries({ "a.bin": new Uint8Array([0xef]) }).parts["a.bin"]
        ?.kind,
    ).toBe("binary");
    expect(
      packageFromEntries({ "a.bin": new Uint8Array([0xef, 0xbb]) }).parts[
        "a.bin"
      ]?.kind,
    ).toBe("binary");
  });
});
