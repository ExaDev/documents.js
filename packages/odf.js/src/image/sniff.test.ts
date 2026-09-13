import { describe, expect, it } from "vitest";
import { sniffImageFormat } from "./sniff";

function bytesOf(values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

function asciiBytes(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

describe("sniffImageFormat", () => {
  it("detects a PNG from its 8-byte magic signature", () => {
    expect(
      sniffImageFormat(
        bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]),
      ),
    ).toBe("png");
  });

  it("detects a JPEG from its 3-byte magic signature", () => {
    expect(sniffImageFormat(bytesOf([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  });

  it("detects a GIF87a header", () => {
    expect(sniffImageFormat(bytesOf(asciiBytes("GIF87a").concat([0x00])))).toBe(
      "gif",
    );
  });

  it("detects a GIF89a header", () => {
    expect(sniffImageFormat(bytesOf(asciiBytes("GIF89a").concat([0x00])))).toBe(
      "gif",
    );
  });

  it("returns undefined for bytes shorter than every signature it checks", () => {
    expect(sniffImageFormat(bytesOf([0x89, 0x50]))).toBeUndefined();
  });

  it("returns undefined for an empty byte array", () => {
    expect(sniffImageFormat(bytesOf([]))).toBeUndefined();
  });

  it("detects SVG from an XML prolog, with no '<svg' tag present in the sniffed window", () => {
    const bytes = bytesOf(asciiBytes('<?xml version="1.0"?><notsvg/>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("detects SVG from a bare '<svg' root tag, with no XML prolog", () => {
    const bytes = bytesOf(
      asciiBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    );
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("skips leading whitespace before the '<?xml' prolog", () => {
    const bytes = bytesOf(asciiBytes('   <?xml version="1.0"?><svg/>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("returns undefined for text that starts with neither '<?xml' nor '<svg'", () => {
    const bytes = bytesOf(asciiBytes("<html><body/></html>"));
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("never finds a root element hidden behind more leading whitespace than the sniff window covers", () => {
    // The sniff window is capped at a fixed size specifically so a caller can't be made to scan an unboundedly large file — a real SVG's root element always appears well within it (see sniff.ts's own comment), so padding past the window with plain spaces before the real tag is exactly the case the cap is meant to give up on, not a bug to work around.
    const paddingLength = 2000;
    const bytes = bytesOf([
      ...Array<number>(paddingLength).fill(0x20),
      ...asciiBytes("<?xml?>"),
    ]);
    expect(bytes.length).toBeGreaterThan(1024);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("does not match bytes that merely end with, rather than start with, an SVG marker", () => {
    const bytes = bytesOf(
      asciiBytes("<html>embeds a literal <?xml tag</html>"),
    );
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});
