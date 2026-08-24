import { describe, expect, it } from "vitest";
import { sniffImageFormat } from "./sniff";

// Ported verbatim from documents.js's src/image/sniff.test.ts.
describe("sniffImageFormat", () => {
  it("recognises a PNG signature", () => {
    expect(
      sniffImageFormat(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
      ),
    ).toBe("png");
  });

  it("recognises a JPEG signature", () => {
    expect(
      sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])),
    ).toBe("jpeg");
  });

  it("returns undefined for unrecognised bytes", () => {
    expect(sniffImageFormat(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it("returns undefined for bytes shorter than the shortest signature", () => {
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8]))).toBeUndefined();
  });
});
