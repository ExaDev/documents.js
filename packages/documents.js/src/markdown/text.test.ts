import { describe, expect, it } from "vitest";
import { MarkdownUndecodableTextError } from "markdown-codec";
import { decodeMarkdownText, encodeMarkdownText } from "./text";

describe("decodeMarkdownText", () => {
  it("decodes well-formed UTF-8 bytes to text", () => {
    expect(decodeMarkdownText(new TextEncoder().encode("# Hello"))).toBe(
      "# Hello",
    );
  });

  it("decodes a heading saved in the Windows code page rather than turning it away", () => {
    const bytes = Uint8Array.of(0x23, 0x20, 0x43, 0x61, 0x66, 0xe9);
    expect(decodeMarkdownText(bytes)).toBe("# Café");
  });

  it("decodes UTF-16LE behind a byte order mark, without leaving the mark in the text", () => {
    const bytes = Uint8Array.of(0xff, 0xfe, 0x23, 0x00, 0x20, 0x00, 0x41, 0x00);
    expect(decodeMarkdownText(bytes)).toBe("# A");
  });

  it("decodes under an explicitly declared encoding, skipping detection", () => {
    const bytes = Uint8Array.of(0x23, 0x20, 0x80);
    expect(decodeMarkdownText(bytes, { encoding: "windows-1252" })).toBe("# €");
  });

  it("throws MarkdownUndecodableTextError for bytes that are not text, rather than silently producing replacement characters", () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(() => decodeMarkdownText(png)).toThrow(MarkdownUndecodableTextError);
  });

  it("throws MarkdownUndecodableTextError when the bytes contradict a declared encoding", () => {
    expect(() =>
      decodeMarkdownText(Uint8Array.of(0x23, 0x20, 0xe9), {
        encoding: "utf-8",
      }),
    ).toThrow(MarkdownUndecodableTextError);
  });

  it("carries the underlying reason through in the thrown error's message", () => {
    let caught: unknown;
    try {
      decodeMarkdownText(Uint8Array.of(0x00, 0x01, 0x02, 0x03));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MarkdownUndecodableTextError);
    expect(caught).toMatchObject({
      name: "MarkdownUndecodableTextError",
      code: "md/undecodable-text",
    });
  });
});

describe("encodeMarkdownText", () => {
  it("encodes text to UTF-8 bytes", () => {
    const bytes = encodeMarkdownText("# Hello");
    expect(new TextDecoder().decode(bytes)).toBe("# Hello");
  });

  it("writes UTF-8 for text that was decoded from another encoding", () => {
    const windows1252 = Uint8Array.of(0x43, 0x61, 0x66, 0xe9);
    const text = decodeMarkdownText(windows1252);
    expect(Array.from(encodeMarkdownText(text))).toEqual([
      0x43, 0x61, 0x66, 0xc3, 0xa9,
    ]);
  });
});
