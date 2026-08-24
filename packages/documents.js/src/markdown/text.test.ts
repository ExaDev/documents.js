import { describe, expect, it } from "vitest";
import { MarkdownInvalidUtf8Error } from "markdown-codec";
import { decodeMarkdownText, encodeMarkdownText } from "./text";

describe("decodeMarkdownText", () => {
  it("decodes well-formed UTF-8 bytes to text", () => {
    expect(decodeMarkdownText(new TextEncoder().encode("# Hello"))).toBe(
      "# Hello",
    );
  });

  it("throws MarkdownInvalidUtf8Error on malformed UTF-8, rather than silently producing replacement characters", () => {
    const malformed = new Uint8Array([0xff, 0xfe, 0x00]);
    expect(() => decodeMarkdownText(malformed)).toThrow(
      MarkdownInvalidUtf8Error,
    );
  });
});

describe("encodeMarkdownText", () => {
  it("encodes text to UTF-8 bytes", () => {
    const bytes = encodeMarkdownText("# Hello");
    expect(new TextDecoder().decode(bytes)).toBe("# Hello");
  });

  it("round-trips through decodeMarkdownText", () => {
    const text = "# Report Title\n\n**bold** and *italic*.";
    expect(decodeMarkdownText(encodeMarkdownText(text))).toBe(text);
  });
});
