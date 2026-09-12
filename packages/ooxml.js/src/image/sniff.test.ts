import { describe, expect, it } from "vitest";
import { sniffImageFormat } from "./sniff";

function enc(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

describe("sniffImageFormat: PNG", () => {
  it("detects a genuine PNG signature", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    expect(sniffImageFormat(bytes)).toBe("png");
  });

  it("does not match a truncated PNG signature (shorter than the real one)", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("does not match bytes that agree with the PNG signature's prefix but diverge partway through", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a,
    ]);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});

describe("sniffImageFormat: JPEG", () => {
  it("detects a genuine JPEG signature", () => {
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "jpeg",
    );
  });

  it("does not match a signature that diverges on the final byte", () => {
    expect(
      sniffImageFormat(new Uint8Array([0xff, 0xd8, 0x00])),
    ).toBeUndefined();
  });
});

describe("sniffImageFormat: GIF", () => {
  it("detects the GIF87a signature", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 1, 2]);
    expect(sniffImageFormat(bytes)).toBe("gif");
  });

  it("detects the GIF89a signature", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
    expect(sniffImageFormat(bytes)).toBe("gif");
  });

  it("does not match a GIF-like prefix that diverges on the version byte", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x30, 0x61]);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});

describe("sniffImageFormat: SVG", () => {
  it("detects an SVG that opens directly with the root <svg> tag", () => {
    const bytes = new Uint8Array(enc('<svg xmlns="x"><path/></svg>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("detects an SVG whose root tag is preceded by an XML prolog", () => {
    const bytes = new Uint8Array(
      enc('<?xml version="1.0"?><svg xmlns="x"></svg>'),
    );
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("detects an SVG whose root/prolog is preceded by leading whitespace", () => {
    const bytes = new Uint8Array(enc('   \n\t<svg xmlns="x"></svg>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("does not detect an SVG signature in plain, unrelated text", () => {
    const bytes = new Uint8Array(enc("just some text, not a document"));
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("does not detect an SVG signature in an empty byte array", () => {
    expect(sniffImageFormat(new Uint8Array([]))).toBeUndefined();
  });

  it("only sniffs the leading 1024-byte window, never a '<svg' tag that appears only later in a longer document", () => {
    // 2000 bytes of non-SVG filler, with a real '<svg' root tag starting well past the 1024-byte sniff window: the real function must never find it there.
    const filler = new Uint8Array(2000).fill(0x2e); // '.'
    const svgTail = enc("<svg xmlns='x'></svg>");
    const bytes = new Uint8Array(2000 + svgTail.length);
    bytes.set(filler, 0);
    bytes.set(svgTail, 1500);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});

describe("sniffImageFormat: no format recognised", () => {
  it("returns undefined for bytes matching none of the known signatures", () => {
    expect(sniffImageFormat(new Uint8Array([1, 2, 3, 4, 5]))).toBeUndefined();
  });
});
